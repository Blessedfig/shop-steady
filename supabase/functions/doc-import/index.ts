// Supabase Edge Function "doc-import": (mode "vendors": supplier notes or applications -> vendor records, managers only)
// turn a document's text (distributor invoice, packing slip,
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

// mode "vendors": notes, research, terms or an application about suppliers -> vendor records and a setup checklist.
const VENDOR_SYSTEM = `You read a retail or service business owner's notes, research, terms sheets or account applications about
suppliers (manufacturers, brands, publishers, distributors, wholesalers, marketplaces) and turn them into vendor records the store can act on.
For each supplier named: its name; kind; which publishers, imprints or lines it covers; website; how the store orders
from it and the ordering link or order email; a stock check link if one is given; its usual discount off list (as a
fraction, 0.46 for 46%), terms, minimum order and returnability if stated; where the store is in opening an account
(status); the application link or email; what the application asks for (needs); and a short checklist of the next steps,
each marked by who does it: "owner" (only the owner can: signatures, resale certificate, tax id, references, payment
choice, captchas), "app" (filling and sending forms or emails that need no private data) or "vendor" (waiting on them).
Opening an account: the supplier's own online application or sign-up form always comes first. Put its link in apply_url
and make the first step "Fill in the online application"; give apply_email and an email step only when no online form
is known, and then add a step to check the supplier's website for one.
Use status "Active" only for suppliers the store already orders from. If the document says the store will not use a
supplier, give status "Not using" and the reason in notes.
Never output passwords, account numbers, tax ids, social security numbers, bank or card numbers, or signatures, even if
the document contains them. Never invent links, emails or discounts: leave a field empty when the document does not give it.
Give a short quote (under 150 characters) from the document for each supplier so a person can check it.`;
const VENDOR_SCHEMA = {
  type: "object", additionalProperties: false, required: ["vendors"],
  properties: { vendors: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["name", "kind", "covers", "website", "how_to_order", "order_method", "order_url", "order_email", "stock_check_url",
      "default_discount", "returnable", "terms", "min_order", "status", "apply_url", "apply_email", "needs", "steps", "notes", "quote"],
    properties: {
      name: { type: "string" },
      kind: { type: "string", enum: ["publisher", "distributor", "wholesaler", "marketplace", "audiobook", "general", "consignor", "other"] },
      covers: { type: "string" }, website: { type: "string" }, how_to_order: { type: "string" },
      order_method: { type: "string", enum: ["file", "email", "site", "phone", "edi", "marketplace", ""] },
      order_url: { type: "string" }, order_email: { type: "string" }, stock_check_url: { type: "string" },
      default_discount: { type: ["number", "null"] }, returnable: { type: ["boolean", "null"] },
      terms: { type: "string" }, min_order: { type: "string" },
      status: { type: "string", enum: ["To apply", "Applying", "Approved, not ordering yet", "Active", "Paused", "Not using"] },
      apply_url: { type: "string" }, apply_email: { type: "string" }, needs: { type: "string" },
      steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["step", "who", "done"],
        properties: { step: { type: "string" }, who: { type: "string", enum: ["owner", "app", "vendor"] }, done: { type: "boolean" } } } },
      notes: { type: "string" }, quote: { type: "string" },
    } } } },
};
// Anything shaped like a tax id, SSN or card/bank number is removed before and after the model sees the text.
const PRIVATE = /\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b|\b(?:\d[ -]?){12,19}\b/g;
const unprivate = (t: string) => t.replace(PRIVATE, (m) => /^97[89]\d{10}$/.test(m.replace(/\D/g, "")) ? m : "[removed]");

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
  // A photo of a packing slip or invoice also works: a JPEG data URL from the phone camera, shrunk in the browser.
  const img = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image ?? ""));
  if (!text.trim() && !img) return json({ error: "no-input" }, 400);
  if (text.length > 200000) return json({ error: "too-long", hint: "Split the document and send it in parts." }, 413);
  if (img && img[2].length > 6_000_000) return json({ error: "too-long", hint: "Take the photo again a little farther away." }, 413);

  const client = new Anthropic({ apiKey });
  if (body.mode === "vendors") {
    const { data: role } = await db.rpc("my_role");
    if (role !== "owner" && role !== "manager") return json({ error: "manager-only" }, 403);
    if (!text.trim()) return json({ error: "no-input" }, 400);
    try {
      // deno-lint-ignore no-explicit-any
      const params: any = {
        model: MODEL, max_tokens: 32000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: VENDOR_SCHEMA } },
        system: [{ type: "text", text: VENDOR_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `Document "${String(body.source ?? "").slice(0, 120)}":\n\n${unprivate(text)}` }],
      };
      const res = await client.beta.messages.create(params);
      if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
      if (res.stop_reason === "max_tokens") return json({ error: "too-long", hint: "Split the document and send it in parts." }, 413);
      const block = res.content.find((b) => b.type === "text");
      if (!block) return json({ error: "no-output" }, 502);
      // deno-lint-ignore no-explicit-any
      const out = JSON.parse((block as any).text);
      const okUrl = (u: string) => /^https:\/\/[^\s]+$/.test(u) ? u.slice(0, 300) : "";
      const okMail = (m: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(m) ? m.slice(0, 120) : "";
      // deno-lint-ignore no-explicit-any
      const vendors = (out.vendors ?? []).slice(0, 60).map((v: any) => ({
        ...v, name: String(v.name).trim().slice(0, 80), website: okUrl(v.website), order_url: okUrl(v.order_url), stock_check_url: okUrl(v.stock_check_url),
        apply_url: okUrl(v.apply_url), order_email: okMail(v.order_email), apply_email: okMail(v.apply_email),
        notes: unprivate(String(v.notes ?? "")), needs: unprivate(String(v.needs ?? "")), terms: unprivate(String(v.terms ?? "")),
        default_discount: typeof v.default_discount === "number" && v.default_discount > 0 && v.default_discount < 0.95 ? v.default_discount : null,
      })).filter((v: { name: string }) => v.name);
      return json({ vendors });
    } catch (e) {
      if (e instanceof SyntaxError) return json({ error: "bad-output" }, 502);
      if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad-key" }, 503);
      if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status }, 502);
      return json({ error: "server" }, 500);
    }
  }
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: img
        ? [{ type: "image", source: { type: "base64", media_type: `image/${img[1]}`, data: img[2] } },
           { type: "text", text: `Photo of a document from "${String(body.source ?? "").slice(0, 120)}". Read every line item.` }]
        : `Document "${String(body.source ?? "").slice(0, 120)}":\n\n${text}` }],
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
