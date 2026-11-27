// Supabase Edge Function "records-import": the paid "AI onboarding" for a folder of business records.
// The owner drops a folder (receipts, invoices, statements, vendor papers, HR forms, leases, loans, tax forms...).
// The page reads each file's text in the browser (pdf.js, mammoth) or shrinks a photo/scan to a small JPEG,
// removes Social Security, tax id, card and bank numbers, and sends ONE file per call here. This function asks
// Claude where the file belongs and pulls out the few facts that place needs. Nothing is saved here: the owner
// reviews every suggestion on the page and taps Save. Owner only. Each file read takes one from the allowance in
// public.records_ai (supabase/records.sql), so the cost is capped.
//   - Files that look medical are never sent (the page keeps them out); if one slips through, the answer is
//     reduced to "medical" with no details.
//   - The Anthropic API key lives only here, as the secret ANTHROPIC_API_KEY.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("RECORDS_MODEL") ?? "claude-opus-5-5";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Same list as the app's expense categories (app/data.js plus the tax-year additions).
const CATS = ["Inventory purchases", "Supplies", "Shipping and postage", "Rent or mortgage", "Utilities", "Phone and internet", "Payroll",
  "Payroll taxes", "Insurance", "Licenses and permits", "Card processing fees", "Software and subscriptions", "Marketing and events",
  "Meals (business)", "Travel", "Vehicle (actual costs)", "Professional fees", "Education and training", "Repairs", "Property taxes",
  "Mortgage interest", "Building repairs and upkeep", "Cleaning and janitorial", "Equipment or furniture", "Building improvements",
  "Contract labor", "Bank fees", "Dues and memberships", "Donations (charity)", "Loan payment (principal)", "Owner draw or personal", "Other"];

const SYSTEM = `You sort one file from a small business owner's records (a shop, cafe, bookstore or service business) into the right
place in their management app, and pull out only the facts that place needs. Places:
- "expense": a receipt, bill or invoice the business paid or must pay (one total). Give date, payee, amount (total paid, a number)
  and the best expense category.
- "vendor": about a supplier rather than one purchase: account application, terms sheet, price list, catalog, rep's contact sheet.
  Give the supplier's name, what they sell, how to order, terms, and business contact email, phone and website if printed.
- "hr": an employee paper: W-4, WT-4 or other state withholding form, I-9, new-hire report, direct deposit form, handbook
  acknowledgment, emergency contact form, work permit, job application, offer letter, review or write-up. Give the person's name
  as printed and which paper it is.
- "record": lease, loan or line of credit, insurance policy, business license or permit, tax form or return (1099, 941, sales tax,
  property tax bill), bank or card statement, contract, deed, appraisal or other building paper, or another paper the owner keeps.
  Give its kind, a short title, the other party, the main amount (monthly rent or payment, premium, balance or tax due), the date
  it renews or is due, the date it ends, the interest rate and term if printed, and one line of notes.
- "medical": doctor's notes, medical leave or disability papers, health or drug test results, prescriptions. Give nothing else.
- "skip": blank, duplicate cover pages, personal papers that are not the business's, ads, or files you cannot read.
Dates as YYYY-MM-DD ("" if none). Never invent numbers, names or dates: leave them empty or null when not printed.
Never output Social Security numbers, tax ids, full account or card numbers, dates of birth or signatures.
Give "why": a few words a person can check (for example "Invoice #4410 from Faire, total $212.40").
Give confidence "high", "medium" or "low".`;

const str = { type: "string" };
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["dest", "confidence", "why", "title", "date", "amount", "payee", "category", "vendor", "hr", "record"],
  properties: {
    dest: { type: "string", enum: ["expense", "vendor", "hr", "record", "medical", "skip"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    why: str, title: str, date: str, amount: { type: ["number", "null"] }, payee: str,
    category: { type: "string", enum: [...CATS, ""] },
    vendor: { type: "object", additionalProperties: false, required: ["name", "covers", "how", "terms", "email", "phone", "website"],
      properties: { name: str, covers: str, how: str, terms: str, email: str, phone: str, website: str } },
    hr: { type: "object", additionalProperties: false, required: ["person", "paper"],
      properties: { person: str, paper: { type: "string", enum: ["w4", "wt4", "i9", "newhire", "deposit", "handbook", "emergency", "permit", "application", "offer", "review", "other", ""] } } },
    record: { type: "object", additionalProperties: false, required: ["kind", "party", "renews_on", "ends_on", "rate", "term", "notes"],
      properties: { kind: { type: "string", enum: ["lease", "loan", "insurance", "license", "tax", "bank", "contract", "property", "other", ""] },
        party: str, renews_on: str, ends_on: str, rate: str, term: str, notes: str } },
  },
};

// Social Security, EIN, card and bank-style numbers are removed before and after the model sees the text (ISBNs stay).
const PRIVATE = /\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b|\b(?:\d[ -]?){9,19}\b/g;
const unprivate = (t: string) => t.replace(PRIVATE, (m) => /^97[89]\d{10}$/.test(m.replace(/\D/g, "")) ? m : "[removed]");
const day = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
const clip = (s: unknown, n: number) => unprivate(String(s ?? "")).trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await db.auth.getUser();
  if (!u?.user?.email) return json({ error: "signin" }, 401);
  const { data: owner } = await db.rpc("is_owner"); // supabase/records.sql
  if (!owner) return json({ error: "owner-only" }, 403);
  const { data: allow, error: aErr } = await db.from("records_ai").select("files_left").eq("id", 1).maybeSingle();
  if (aErr) return json({ error: "not-set-up" }, 503);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad-json" }, 400); }
  if (body.ping) return json({ ok: !!apiKey, files_left: allow?.files_left ?? 0 });
  if (!apiKey) return json({ error: "not-configured" }, 503);
  if (!allow || allow.files_left <= 0) return json({ error: "no-allowance", files_left: 0 }, 402);

  const name = clip(body.name, 200), path = clip(body.path, 300);
  const text = unprivate(String(body.text ?? "")).slice(0, 20000);
  const cut = String(body.text ?? "").length > 20000;
  const img = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image ?? ""));
  if (!text.trim() && !img) return json({ error: "no-input" }, 400);
  if (img && img[2].length > 4_000_000) return json({ error: "too-long" }, 413);
  const label = `File "${name}" in folder "${path}".` + (cut ? " Only the first part of a long file is shown." : "");

  const client = new Anthropic({ apiKey });
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: img
        ? [{ type: "image", source: { type: "base64", media_type: `image/${img[1]}`, data: img[2] } }, { type: "text", text: label }]
        : `${label}\n\n${text}` }],
    };
    const res = await client.beta.messages.create(params);
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "bad-output" }, 502);
    const block = res.content.find((b) => b.type === "text");
    if (!block) return json({ error: "no-output" }, 502);
    // deno-lint-ignore no-explicit-any
    const o = JSON.parse((block as any).text);
    const { data: left } = await db.rpc("records_ai_take");
    if (o.dest === "medical") return json({ dest: "medical", confidence: o.confidence, why: "Looks medical: kept out of the app", files_left: left });
    const url = (s: string) => /^https?:\/\/\S+$/.test(s) ? s.slice(0, 200) : "";
    const mail = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? s.slice(0, 120) : "";
    return json({
      dest: o.dest, confidence: o.confidence, why: clip(o.why, 160), title: clip(o.title, 160), date: day(o.date),
      amount: typeof o.amount === "number" && isFinite(o.amount) && Math.abs(o.amount) < 1e8 ? Math.round(o.amount * 100) / 100 : null,
      payee: clip(o.payee, 100), category: CATS.includes(o.category) ? o.category : "",
      vendor: { name: clip(o.vendor?.name, 80), covers: clip(o.vendor?.covers, 200), how: clip(o.vendor?.how, 200), terms: clip(o.vendor?.terms, 200),
        email: mail(o.vendor?.email ?? ""), phone: clip(o.vendor?.phone, 30), website: url(o.vendor?.website ?? "") },
      hr: { person: clip(o.hr?.person, 80), paper: String(o.hr?.paper ?? "") },
      record: { kind: String(o.record?.kind ?? ""), party: clip(o.record?.party, 100), renews_on: day(o.record?.renews_on ?? ""), ends_on: day(o.record?.ends_on ?? ""),
        rate: clip(o.record?.rate, 40), term: clip(o.record?.term, 60), notes: clip(o.record?.notes, 240) },
      files_left: left,
    });
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "bad-output" }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad-key" }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status }, 502);
    return json({ error: "server" }, 500);
  }
});
