// Supabase Edge Function "doc-import": turn a document's text (distributor invoice, packing slip,
// publisher catalog, consignment agreement list, vendor price sheet) into structured inventory rows.
// Pattern reused from Steady Shift's procedure import:
//   - The page extracts text in the browser (pdf.js for PDF, mammoth for Word) and strips phone numbers,
//     emails and card-like numbers before sending.
//   - The AI only extracts. The app checks every row (ISBN checksum, quantities, prices) in code and a
//     person approves before anything is saved, so a model mistake never changes stock by itself.
//   - The Anthropic API key lives only here, as the secret ANTHROPIC_API_KEY. Never put it in the repo or page.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("IMPORT_MODEL") ?? "claude-opus-5-5";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You read one document from a bookstore's suppliers and list its line items.
For each line item give: isbn (13 or 10 digits, no dashes, "" if none is printed), title, author ("" if not printed),
quantity (number shipped or offered; null if not printed), unit_cost (what the store pays, null if not printed),
list_price (retail or cover price, null if not printed), condition ("new", "used", or "" if unclear),
and a short quote (under 150 characters) copied from the line so a person can check it.
Never invent numbers or ISBNs. Put anything that is not a product line (shipping, fees, discounts, totals) in "other_charges".`;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["supplier", "document_date", "items", "other_charges"],
  properties: {
    supplier: { type: "string" },
    document_date: { type: "string" },
    items: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["isbn", "title", "author", "quantity", "unit_cost", "list_price", "condition", "quote"],
      properties: {
        isbn: { type: "string" }, title: { type: "string" }, author: { type: "string" },
        quantity: { type: ["number", "null"] }, unit_cost: { type: ["number", "null"] }, list_price: { type: ["number", "null"] },
        condition: { type: "string", enum: ["new", "used", ""] }, quote: { type: "string" },
      } } },
    other_charges: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "amount"],
      properties: { label: { type: "string" }, amount: { type: ["number", "null"] } } } },
  },
};

// ISBN checks run in code, never trusted from the model.
function isbnOk(s: string): boolean {
  if (/^\d{13}$/.test(s)) { let t = 0; for (let i = 0; i < 13; i++) t += +s[i] * (i % 2 ? 3 : 1); return t % 10 === 0; }
  if (/^\d{9}[\dX]$/.test(s)) { let t = 0; for (let i = 0; i < 10; i++) t += (s[i] === "X" ? 10 : +s[i]) * (10 - i); return t % 11 === 0; }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await db.auth.getUser();
  if (!u?.user?.email) return json({ error: "signin" }, 401);
  const { data: member } = await db.rpc("is_desk_member"); // from supabase/setup.sql
  if (!member) return json({ error: "not-member" }, 403);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad-json" }, 400); }
  if (body.ping) return json({ ok: !!apiKey });
  if (!apiKey) return json({ error: "not-configured" }, 503);
  const text = String(body.text ?? "");
  if (!text.trim()) return json({ error: "no-input" }, 400);
  if (text.length > 200000) return json({ error: "too-long", hint: "Split the document and send it in parts." }, 413);

  const client = new Anthropic({ apiKey });
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Document "${String(body.source ?? "").slice(0, 120)}":\n\n${text}` }],
    };
    const res = await client.beta.messages.create(params);
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "too-long", hint: "Split the document and send it in parts." }, 413);
    const block = res.content.find((b) => b.type === "text");
    if (!block) return json({ error: "no-output" }, 502);
    // deno-lint-ignore no-explicit-any
    const out = JSON.parse((block as any).text);
    // deno-lint-ignore no-explicit-any
    const items = (out.items ?? []).map((it: any) => ({ ...it, isbn_valid: it.isbn ? isbnOk(it.isbn) : false }));
    return json({ supplier: out.supplier, document_date: out.document_date, items, other_charges: out.other_charges ?? [] });
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "bad-output" }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad-key" }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status }, 502);
    return json({ error: "server" }, 500);
  }
});
