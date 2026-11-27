// Supabase Edge Function "mailbox": reads the store mailbox for the buying side. Read only.
//   tick  (every 30 minutes from the database timer, header x-sync-key):
//         1. Shipping emails -> record_shipment_notice, which attaches carrier and tracking to the matching order.
//            PRH "Email ASN" messages are read exactly in code; other vendors' shipping emails (Amazon, Faire...)
//            are read by the AI, which only extracts.
//         2. Supplier replies: mail from the domains of vendors you are opening accounts with (and bounces of mail
//            sent to them) is filed in vendor_mail, so Vendor setup shows what is waiting on you.
//   paste (manager or owner): the same for a shipping email or notice pasted on the Orders screen.
// Secrets: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN (a Zoho "Self Client" with scope
// ZohoMail.messages.READ; see supabase/CATALOG.md), optional ZOHO_DC (default "com"), ANTHROPIC_API_KEY for non-PRH emails.
// The function only reads mail. It never sends, moves or deletes anything in the mailbox.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parsePrhAsn } from "./prh.js";

const MODEL = Deno.env.get("IMPORT_MODEL") ?? "claude-opus-5-5";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sameText = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export type Notice = { source_id?: string; vendor_name: string; po_ref: string | null; order_ref: string | null; carrier: string;
  tracking: string[]; ship_date: string | null; lines: { isbn: string; qty: number; unit_price: number | null; title: string }[] };

// ---------- any other shipping email (AI extracts, code checks) ----------
const SYSTEM = `You read one shipping or order-status email sent to a bookstore by a supplier (publisher, distributor,
Amazon, Faire or similar). Give the supplier name, the store's purchase order number if shown (po_ref), the supplier's
own order number (order_ref), the carrier, every package tracking number, the ship date (YYYY-MM-DD) and the items with
ISBN (13 digits, "" if none), title and quantity. If the email is not about a shipment, return an empty tracking list.
Never invent numbers.`;
const SCHEMA = { type: "object", additionalProperties: false, required: ["vendor_name", "po_ref", "order_ref", "carrier", "tracking", "ship_date", "lines"],
  properties: { vendor_name: { type: "string" }, po_ref: { type: "string" }, order_ref: { type: "string" }, carrier: { type: "string" },
    tracking: { type: "array", items: { type: "string" } }, ship_date: { type: "string" },
    lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["isbn", "title", "qty"],
      properties: { isbn: { type: "string" }, title: { type: "string" }, qty: { type: "number" } } } } } };
async function aiRead(text: string): Promise<Notice | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY"); if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  // deno-lint-ignore no-explicit-any
  const params: any = { model: MODEL, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM, messages: [{ role: "user", content: text.slice(0, 60000) }] };
  const res = await client.beta.messages.create(params);
  const block = res.content.find((b) => b.type === "text"); if (!block) return null;
  // deno-lint-ignore no-explicit-any
  const o = JSON.parse((block as any).text);
  const tracking = (o.tracking ?? []).map((t: string) => String(t).replace(/\s/g, "").toUpperCase()).filter((t: string) => /^[A-Z0-9]{8,40}$/.test(t));
  if (!tracking.length) return null;
  return { vendor_name: String(o.vendor_name ?? "").slice(0, 80), po_ref: o.po_ref || null, order_ref: o.order_ref || null, carrier: String(o.carrier ?? "").slice(0, 60),
    tracking, ship_date: /^\d{4}-\d{2}-\d{2}$/.test(o.ship_date) ? o.ship_date : null,
    lines: (o.lines ?? []).filter((l: { isbn: string }) => /^97[89]\d{10}$/.test(l.isbn)).map((l: { isbn: string; title: string; qty: number }) => ({ isbn: l.isbn, title: l.title, qty: l.qty, unit_price: null })) };
}
const htmlToText = (h: string) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|tr|div)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

// ---------- Zoho Mail (read only) ----------
const SEARCHES = [
  { key: "sender:sdbatch@prh.com", exact: true },             // PRH Email ASN
  { key: "sender:shipment-tracking@amazon.com", exact: false }, // Amazon shipped
  { key: "subject:shipped AND sender:faire.com", exact: false }, // Faire shipped
];
async function zoho() {
  const id = Deno.env.get("ZOHO_CLIENT_ID"), secret = Deno.env.get("ZOHO_CLIENT_SECRET"), refresh = Deno.env.get("ZOHO_REFRESH_TOKEN");
  if (!id || !secret || !refresh) return null;
  const dc = Deno.env.get("ZOHO_DC") ?? "com";
  const t = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token?` + new URLSearchParams({ refresh_token: refresh, client_id: id, client_secret: secret, grant_type: "refresh_token" }), { method: "POST" }).then((r) => r.json());
  if (!t.access_token) throw new Error("Zoho sign-in failed: " + (t.error ?? "no token"));
  const api = `https://mail.zoho.${dc}/api`, h = { Authorization: "Zoho-oauthtoken " + t.access_token };
  const acct = Deno.env.get("ZOHO_ACCOUNT_ID") ?? (await fetch(`${api}/accounts`, { headers: h }).then((r) => r.json())).data?.[0]?.accountId;
  if (!acct) throw new Error("No Zoho mail account found");
  return {
    // deno-lint-ignore no-explicit-any
    search: async (key: string): Promise<any[]> => (await fetch(`${api}/accounts/${acct}/messages/search?` + new URLSearchParams({ searchKey: key, limit: "25" }), { headers: h }).then((r) => r.json())).data ?? [],
    content: async (folderId: string, messageId: string) => (await fetch(`${api}/accounts/${acct}/folders/${folderId}/messages/${messageId}/content`, { headers: h }).then((r) => r.json())).data?.content ?? "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // deno-lint-ignore no-explicit-any
  let body: any; try { body = await req.json(); } catch { body = {}; }

  if (body.action === "paste") {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: role } = await asUser.rpc("my_role");
    if (role !== "owner" && role !== "manager") return json({ error: "manager-only" }, 403);
    const text = String(body.text ?? "").slice(0, 200000);
    if (!text.trim()) return json({ error: "no-input" }, 400);
    let n: Notice | null = parsePrhAsn(text);
    try { if (!n) n = await aiRead(/<[a-z][\s\S]*>/i.test(text) ? htmlToText(text) : text); } catch (e) { return json({ error: "ai", detail: (e as Error).message }, 502); }
    if (!n || !n.tracking.length) return json({ error: "no-tracking" }, 422);
    const { data, error } = await asUser.rpc("record_shipment_notice", { p: n });
    if (error) return json({ error: error.message }, 400);
    return json({ notice: n, result: data });
  }

  // timer
  const { data: conn } = await admin.from("shopify_conn").select("cron_key").eq("id", 1).maybeSingle();
  const key = req.headers.get("x-sync-key") ?? "";
  if (!conn?.cron_key || !sameText(key, conn.cron_key)) return json({ error: "bad-key" }, 401);
  let mail; try { mail = await zoho(); } catch (e) { return json({ error: (e as Error).message }, 502); }
  if (!mail) return json({ skipped: "Zoho Mail is not connected" });
  let read = 0, matched = 0, ai = 0;
  for (const s of SEARCHES) {
    for (const m of await mail.search(s.key)) {
      const sid = "zoho:" + m.messageId;
      const { data: seen } = await admin.from("shipment_notices").select("id").eq("source_id", sid).maybeSingle();
      if (seen) continue;
      if (Date.now() - Number(m.receivedTime) > 45 * 864e5) continue;
      const html = await mail.content(m.folderId, m.messageId);
      let n = s.exact ? parsePrhAsn(html) : null;
      if (!n && !s.exact && ai < 10) { ai++; try { n = await aiRead(htmlToText(html)); } catch (_) { n = null; } }
      if (!n) continue;
      const { data } = await admin.rpc("record_shipment_notice", { p: { ...n, source_id: sid } });
      read++; if (data?.matched) matched++;
    }
  }
  // 2. supplier replies and bounces
  const { data: watch } = await admin.from("vendor_mail_watch").select("vendor_id,domain");
  let filed = 0;
  const since = Date.now() - 60 * 864e5;
  const file = async (m: { messageId: string; fromAddress?: string; sender?: string; subject?: string; summary?: string; receivedTime: string }, vendor_id: string, kind: string) => {
    const { error } = await admin.from("vendor_mail").insert({ source_id: "zoho:" + m.messageId, vendor_id, kind,
      sender: String(m.fromAddress ?? m.sender ?? "").slice(0, 200), subject: String(m.subject ?? "").slice(0, 300),
      summary: String(m.summary ?? "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").slice(0, 600), received_at: new Date(Number(m.receivedTime)).toISOString() });
    if (!error) filed++;
  };
  const AUTO = /ticket|received your|we have received|thank you for (contacting|reaching)|out of (the )?office|closure|automatic|auto-?reply|do not reply/i;
  for (const d of [...new Set((watch ?? []).map((w) => w.domain))]) {
    const vid = watch!.find((w) => w.domain === d)!.vendor_id;
    for (const m of await mail.search("sender:" + d)) {
      if (Number(m.receivedTime) < since) continue;
      await file(m, vid, AUTO.test(`${m.subject} ${m.summary}`) || /no-?reply/i.test(m.fromAddress ?? "") ? "auto" : "reply");
    }
  }
  for (const m of await mail.search("sender:mailer-daemon")) {
    if (Number(m.receivedTime) < since) continue;
    const to = /([\w.+-]+@([\w-]+\.[\w.-]+))/.exec(String(m.summary ?? ""));
    const w = to && (watch ?? []).find((x) => x.domain === to[2].toLowerCase().replace(/\.+$/, ""));
    if (w) await file({ ...m, subject: "Bounced: " + to![1] }, w.vendor_id, "bounce");
  }
  return json({ read, matched, filed });
});
