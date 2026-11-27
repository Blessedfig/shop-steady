// Supabase Edge Function "shopify-sync": keeps the app's copy of the Shopify store current, and sends approved
// changes back.
//   tick   (every 15 minutes from the database timer, header x-sync-key) or sync (a manager or owner taps
//          "Sync now"):
//            1. Products and stock: a Shopify bulk export of every variant (title, codes, vendor, price, cost,
//               available, on hand). It runs on Shopify's side; a later run collects it. Repeats hourly.
//            2. Sales: orders changed since the last run (Shopify allows the last 60 days), line by line.
//   apply  (owner only): sends pending cost and vendor changes from shopify_changes to Shopify, one by one,
//          and records what happened.
// The access token lives only in shopify_conn (see supabase/shopify.sql) and in this function's memory.
// "Verify JWT with legacy secret" must be OFF: the timer has no sign-in; this code checks the key or the person.
import { createClient } from "npm:@supabase/supabase-js@2";

const API = Deno.env.get("SHOPIFY_API_VERSION") ?? "2026-07";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const num = (gid: string | null | undefined) => gid ? Number(String(gid).split("/").pop()) : null;
const sameText = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

const BULK = `{ productVariants { edges { node { id title sku barcode price
  product { id title vendor productType status }
  inventoryItem { id tracked unitCost { amount }
    inventoryLevels { edges { node { location { id } quantities(names: ["available", "on_hand"]) { name quantity } } } } } } } } }`;
const ORDERS = `query($q: String, $after: String) { shop { ianaTimezone }
  orders(first: 25, after: $after, query: $q, sortKey: UPDATED_AT) { pageInfo { hasNextPage endCursor }
    edges { node { id name createdAt updatedAt cancelledAt sourceName paymentGatewayNames
      lineItems(first: 40) { edges { node { id title currentQuantity variant { id }
        originalTotalSet { shopMoney { amount } } discountedTotalSet { shopMoney { amount } } } } } } } } }`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: conn } = await admin.from("shopify_conn").select("*").eq("id", 1).single();
  // deno-lint-ignore no-explicit-any
  let body: any; try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action ?? "sync");

  // who is calling: the timer (key) or a signed-in manager / owner
  let who = "timer", role = "";
  const key = req.headers.get("x-sync-key");
  if (key) {
    if (!conn?.cron_key || !sameText(key, conn.cron_key)) return json({ error: "bad-key" }, 401);
  } else {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user?.email) return json({ error: "signin" }, 401);
    const { data: r } = await asUser.rpc("my_role");
    role = String(r ?? "");
    if (role !== "owner" && role !== "manager") return json({ error: "manager-only" }, 403);
    who = u.user.email.toLowerCase();
  }
  if (!conn?.access_token || !conn.shop) return json({ error: "not-connected" }, 409);
  const log = (kind: string, ok: boolean, note: string) => admin.from("shopify_sync_log").insert({ kind, ok, note: note.slice(0, 500) });

  // deno-lint-ignore no-explicit-any
  async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
    const r = await fetch(`https://${conn.shop}/admin/api/${API}/graphql.json`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.access_token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 401 || r.status === 403) throw new Error("Shopify refused the connection (" + r.status + "). Connect the store again.");
    if (!r.ok) throw new Error("Shopify answered " + r.status);
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
    return j.data;
  }

  // ---------- apply approved changes (owner) ----------
  if (action === "apply") {
    if (role !== "owner") return json({ error: "owner-only" }, 403);
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean).slice(0, 200) : [];
    let q = admin.from("shopify_changes").select("*").eq("status", "pending").in("kind", ["cost", "vendor"]).order("id").limit(200);
    if (ids.length) q = q.in("id", ids);
    const { data: list } = await q;
    let done = 0, failed = 0;
    for (const c of list ?? []) {
      const { data: v } = await admin.from("shopify_variants").select("product_id,inventory_item_id").eq("variant_id", c.variant_id).maybeSingle();
      let err = "";
      try {
        if (!v) err = "That item is not in the synced product list.";
        else if (c.kind === "cost") {
          const cost = Number(c.new_value);
          if (!(cost >= 0)) err = "Cost must be a number.";
          else {
            const d = await gql(`mutation($id: ID!, $cost: Decimal) { inventoryItemUpdate(id: $id, input: { cost: $cost }) { userErrors { message } } }`,
              { id: "gid://shopify/InventoryItem/" + v.inventory_item_id, cost: cost.toFixed(2) });
            err = (d.inventoryItemUpdate.userErrors ?? []).map((e: { message: string }) => e.message).join("; ");
            if (!err) await admin.from("shopify_costs").upsert({ inventory_item_id: v.inventory_item_id, cost, updated_at: new Date().toISOString() });
          }
        } else {
          const vendor = String(c.new_value).trim().slice(0, 255);
          const d = await gql(`mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { message } } }`,
            { p: { id: "gid://shopify/Product/" + v.product_id, vendor } });
          err = (d.productUpdate.userErrors ?? []).map((e: { message: string }) => e.message).join("; ");
          if (!err) await admin.from("shopify_variants").update({ vendor }).eq("product_id", v.product_id);
        }
      } catch (e) { err = (e as Error).message; }
      await admin.from("shopify_changes").update(err ? { status: "failed", error: err.slice(0, 300) } : { status: "applied", applied_by: who, applied_at: new Date().toISOString(), error: null }).eq("id", c.id);
      err ? failed++ : done++;
    }
    await log("apply", failed === 0, `${done} applied, ${failed} failed, by ${who}`);
    return json({ applied: done, failed });
  }

  // ---------- sync ----------
  const notes: string[] = [];
  let ok = true;
  try {
    // 1. products and stock through a bulk export
    if (conn.bulk_id) {
      const d = await gql(`query($id: ID!) { node(id: $id) { ... on BulkOperation { status url errorCode objectCount } } }`, { id: conn.bulk_id });
      const b = d.node;
      if (b?.status === "COMPLETED") {
        const n = b.url ? await ingest(b.url) : 0;
        await admin.from("shopify_conn").update({ bulk_id: null, full_at: new Date().toISOString() }).eq("id", 1);
        notes.push(`${n} products and stock updated`);
      } else if (!b || ["FAILED", "CANCELED", "EXPIRED"].includes(b.status)) {
        await admin.from("shopify_conn").update({ bulk_id: null }).eq("id", 1);
        notes.push("Product export " + (b?.status ?? "missing") + (b?.errorCode ? " (" + b.errorCode + ")" : "")); ok = false;
      } else notes.push("Product export still running");
    } else if (!conn.full_at || Date.now() - new Date(conn.full_at).getTime() > 55 * 60 * 1000 || action === "full") {
      const d = await gql(`mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { message } } }`, { q: BULK });
      const r = d.bulkOperationRunQuery;
      if (r.userErrors?.length) { notes.push("Export not started: " + r.userErrors.map((e: { message: string }) => e.message).join("; ")); ok = false; }
      else { await admin.from("shopify_conn").update({ bulk_id: r.bulkOperation.id, bulk_started: new Date().toISOString() }).eq("id", 1); notes.push("Product export started"); }
    }

    // 2. sales since the last run
    const since = conn.orders_at ?? new Date(Date.now() - 59 * 864e5).toISOString();
    let after: string | null = null, pages = 0, lines = 0, newest = since;
    const t0 = Date.now();
    do {
      const d = await gql(ORDERS, { q: `updated_at:>'${since}'`, after });
      const tz = d.shop.ianaTimezone || "America/Chicago";
      const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
      const rows = [];
      for (const e of d.orders.edges) {
        const o = e.node, cash = (o.paymentGatewayNames ?? []).some((g: string) => /cash/i.test(g));
        if (o.updatedAt > newest) newest = o.updatedAt;
        for (const le of o.lineItems.edges) {
          const l = le.node, qty = l.currentQuantity ?? 0;
          const gross = Number(l.originalTotalSet?.shopMoney?.amount ?? 0), net = Number(l.discountedTotalSet?.shopMoney?.amount ?? 0);
          rows.push({ line_id: num(l.id), order_id: num(o.id), order_name: o.name, day: dayOf(o.createdAt), at: o.createdAt,
            variant_id: num(l.variant?.id), title: l.title, qty, gross: qty ? gross : 0, net: qty ? net : 0,
            source: o.sourceName ?? "", cash, cancelled: !!o.cancelledAt });
        }
      }
      if (rows.length) { const { error } = await admin.from("shopify_order_lines").upsert(rows); if (error) throw new Error(error.message); }
      lines += rows.length; pages++;
      after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    } while (after && pages < 40 && Date.now() - t0 < 60000);
    await admin.from("shopify_conn").update({ orders_at: newest }).eq("id", 1);
    notes.push(`${lines} sales lines` + (after ? " (more next run)" : ""));
  } catch (e) { ok = false; notes.push((e as Error).message); }
  await log(action === "tick" ? "auto" : "sync", ok, notes.join(" · "));
  return json({ ok, notes });

  // reads the bulk export (one JSON object per line: variants, then their stock levels) into the tables
  async function ingest(fileUrl: string) {
    const text = await (await fetch(fileUrl)).text();
    // deno-lint-ignore no-explicit-any
    const vars = new Map<string, any>(), costs = new Map<number, number | null>();
    for (const line of text.split("\n")) {
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.__parentId && o.quantities) { // a stock level row for the variant above it
        const v = vars.get(o.__parentId); if (!v) continue;
        for (const q of o.quantities) { if (q.name === "available") v.available += q.quantity ?? 0; if (q.name === "on_hand") v.on_hand += q.quantity ?? 0; }
        continue;
      }
      if (!String(o.id ?? "").includes("ProductVariant")) continue;
      const ii = o.inventoryItem ?? {};
      vars.set(o.id, { variant_id: num(o.id), product_id: num(o.product?.id), inventory_item_id: num(ii.id),
        product_title: o.product?.title ?? "", variant_title: o.title ?? "", sku: (o.sku ?? "").replace(/^'/, ""), barcode: o.barcode ?? "",
        vendor: o.product?.vendor ?? "", product_type: o.product?.productType ?? "", status: o.product?.status ?? "",
        price: o.price == null ? null : Number(o.price), tracked: !!ii.tracked, available: 0, on_hand: 0, updated_at: new Date().toISOString() });
      if (ii.id) costs.set(num(ii.id)!, ii.unitCost?.amount == null ? null : Number(ii.unitCost.amount));
    }
    const all = [...vars.values()];
    for (let i = 0; i < all.length; i += 1000) { const { error } = await admin.from("shopify_variants").upsert(all.slice(i, i + 1000)); if (error) throw new Error(error.message); }
    const cs = [...costs.entries()].map(([k, c]) => ({ inventory_item_id: k, cost: c, updated_at: new Date().toISOString() }));
    for (let i = 0; i < cs.length; i += 1000) { const { error } = await admin.from("shopify_costs").upsert(cs.slice(i, i + 1000)); if (error) throw new Error(error.message); }
    // variants deleted in Shopify drop out of the copy
    const seen = new Set(all.map((v) => v.variant_id));
    const { data: old } = await admin.from("shopify_variants").select("variant_id").lt("updated_at", new Date(Date.now() - 2 * 3600 * 1000).toISOString()).limit(5000);
    const gone = (old ?? []).map((r) => r.variant_id).filter((id) => !seen.has(id));
    if (gone.length && all.length > 100) await admin.from("shopify_variants").delete().in("variant_id", gone);
    return all.length;
  }
});
