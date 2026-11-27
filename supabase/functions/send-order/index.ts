// Supabase Edge Function "send-order": emails an order built in the app to the signed-in manager or owner
// (their own sign-in address only, never anyone else), with the order as a CSV attachment ready to upload or forward.
// It does not contact the vendor. Needs two Supabase secrets:
//   RESEND_API_KEY : from resend.com (or any account there; free tier covers a store's orders)
//   ORDER_FROM     : the sender, e.g. "Downtown Stube <orders@your-verified-domain>". While testing, Resend's
//                    "onboarding@resend.dev" can send only to the Resend account's own address.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const cell = (s: unknown) => { const v = String(s ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const money = (n: unknown) => n == null || n === "" ? "" : "$" + Number(n).toFixed(2);
const STOCK: Record<string, string> = { in_stock: "In stock", low: "Low stock", backorder: "Backorder", forthcoming: "Not out yet",
  out_of_print: "Out of print", not_available: "Not available", unknown: "Stock unknown" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("ORDER_FROM");
  if (!key || !from) return json({ error: "not-configured" }, 503);
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await asUser.auth.getUser();
  const to = u?.user?.email;
  if (!to) return json({ error: "signin" }, 401);
  const { data: role } = await asUser.rpc("my_role");
  if (role !== "owner" && role !== "manager") return json({ error: "manager-only" }, 403);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad-json" }, 400); }
  const store = String(body.store ?? "").slice(0, 80);
  // Read the order through the same rules as the app (list_orders runs as this user).
  const { data: orders, error } = await asUser.rpc("list_orders", { p_status: null });
  if (error) return json({ error: "orders", detail: error.message }, 502);
  // deno-lint-ignore no-explicit-any
  const o = (orders ?? []).find((x: any) => x.id === body.po);
  if (!o) return json({ error: "unknown-order" }, 404);
  if (!o.lines.length) return json({ error: "empty" }, 400);

  // deno-lint-ignore no-explicit-any
  const lines: any[] = o.lines;
  const code = (l: { item_key: string }) => l.item_key.replace(/^sku:/, "");
  const total = lines.reduce((a, l) => a + (l.unit_cost == null ? 0 : l.qty * l.unit_cost), 0);
  const csv = [["ISBN/UPC/SKU", "Quantity", "Title", "Our PO", "Stock at vendor", "Cost each", "Note"],
    ...lines.map((l) => [code(l), l.qty, l.title, o.po_number, STOCK[l.availability] ?? "", l.unit_cost ?? "", l.note ?? ""])]
    .map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const paste = lines.map((l) => code(l) + "\t" + l.qty).join("\n");
  const rows = lines.map((l) => `<tr><td>${esc(code(l))}</td><td style="text-align:right">${l.qty}</td><td>${esc(l.title)}${l.note ? `<br><small>${esc(l.note)}</small>` : ""}</td><td>${esc(STOCK[l.availability] ?? "")}${l.better ? `<br><small>In stock at ${esc(l.better.vendor)}</small>` : ""}</td><td style="text-align:right">${money(l.unit_cost)}</td></tr>`).join("");
  const v = o.vendor;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1d2b24">
<h2 style="margin:0 0 4px">${esc(o.po_number)} · ${esc(v.name)}</h2>
<p style="margin:0 0 12px;color:#555">${esc(store)} · ${lines.length} titles, ${lines.reduce((a, l) => a + l.qty, 0)} copies${total ? " · about " + money(total) : ""}. Not sent to the vendor yet.</p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #ddd"><tr style="background:#f2efe6"><th align="left">ISBN</th><th>Qty</th><th align="left">Title</th><th align="left">Stock</th><th>Cost</th></tr>${rows}</table>
<h3>To place it</h3>
<ul>${v.order_url ? `<li>Ordering page: <a href="${esc(v.order_url)}">${esc(v.order_url)}</a></li>` : ""}
<li>Paste these into the vendor's quick order (PRH Self-Service: Cart &gt; Add ISBNs/UPCs), or upload the attached CSV:<pre style="background:#f6f6f6;padding:8px">${esc(paste)}</pre></li>
${v.order_email ? `<li>Or forward this email to ${esc(v.order_email)}.</li>` : ""}
<li>Then mark it sent in the app's Orders screen with their order number.</li></ul></div>`;
  const text = `${o.po_number} · ${v.name}\n${store}\n\n` + lines.map((l) => `${code(l)}  x${l.qty}  ${l.title}${l.note ? "  (" + l.note + ")" : ""}`).join("\n") +
    `\n\nPaste list:\n${paste}\n\nThen mark it sent in the app's Orders screen.\n`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [to], subject: `Order ${o.po_number} for ${v.name} (not sent to the vendor yet)`, html, text,
      attachments: [{ filename: `${o.po_number}-${String(v.name).replace(/\W+/g, "-").toLowerCase()}.csv`, content: btoa(unescape(encodeURIComponent(csv))) }],
    }),
  });
  if (!r.ok) return json({ error: "send-failed", detail: (await r.text()).slice(0, 300) }, 502);
  return json({ ok: true, to });
});
