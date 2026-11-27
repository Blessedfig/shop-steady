// Supabase Edge Function "note-polish": turn a quick note written in someone's own words
// ("edna ate here, went out w guardian 3-5") into a clear, factual, professional note for the record.
//   - The AI only rewrites. It must not add facts, guesses or opinions. Anything a good report needs
//     that the note doesn't say (who, when, where, what happened next) comes back as questions in "missing".
//   - The app always keeps the original words next to the polished version, and the person picks which to save.
//   - The Anthropic API key lives only here, as the secret ANTHROPIC_API_KEY. Never put it in the repo or page.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("NOTE_MODEL") ?? "claude-sonnet-5-5";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KINDS: Record<string, string> = {
  update: "a routine update for the shift log",
  customer: "a note about a customer or guest interaction",
  incident: "an incident report",
  staff: "a note in an employee's file (performance, coaching or write-up)",
  task: "a report that a task was not done",
  voice: "a message from an employee to their managers",
  vendor: "a note about a supplier or vendor",
};

const SYSTEM = `You help staff at a small business turn quick notes into clear, professional notes for the record.
Rewrite the note so a manager, owner, inspector or lawyer could read it later and understand exactly what happened.
Rules:
- Keep every fact from the original: names, times, places, amounts, quotes. Never add facts, causes, motives, diagnoses or opinions that are not in the note.
- Write in plain, neutral, past-tense sentences. Use full names or roles as given. Use the date, time and author details you are given only as context; do not invent any.
- Report what was seen and said, not judgments. If the original contains a judgment ("she was lazy"), keep it only as attributed opinion ("The writer felt...") or leave it out if it adds nothing, and mention that in "missing".
- Keep it short: one to five sentences for most notes. No headings, no bullet points, no sign-off.
- If the note is for a message to managers, keep the writer's meaning and tone respectful; do not soften a real concern away.
- In "missing", list up to four short questions about details a good record would need but the note does not give (for example who was present, exact times, what happened next). Leave it empty if nothing important is missing.`;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["note", "missing"],
  properties: {
    note: { type: "string" },
    missing: { type: "array", items: { type: "string" } },
  },
};

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
  const text = String(body.text ?? "").trim();
  if (!text) return json({ error: "no-input" }, 400);
  if (text.length > 4000) return json({ error: "too-long", hint: "Keep a note under 4,000 characters." }, 413);
  const kind = KINDS[String(body.kind)] ? String(body.kind) : "update";
  const ctx = [
    `This is ${KINDS[kind]}.`,
    body.business ? `Business: ${String(body.business).slice(0, 80)}.` : "",
    body.about ? `About: ${String(body.about).slice(0, 80)}.` : "",
    body.when ? `Date and time of the note: ${String(body.when).slice(0, 40)}.` : "",
    body.by ? `Written by: ${String(body.by).slice(0, 80)}.` : "",
  ].filter(Boolean).join(" ");

  const client = new Anthropic({ apiKey });
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${ctx}\n\nThe quick note, in the writer's own words:\n<note>\n${text}\n</note>` }],
    };
    const res = await client.beta.messages.create(params);
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    const block = res.content.find((b) => b.type === "text");
    if (!block) return json({ error: "no-output" }, 502);
    // deno-lint-ignore no-explicit-any
    const out = JSON.parse((block as any).text);
    return json({ note: String(out.note ?? ""), missing: (out.missing ?? []).slice(0, 4).map(String) });
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "bad-output" }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad-key" }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status }, 502);
    return json({ error: "server" }, 500);
  }
});
