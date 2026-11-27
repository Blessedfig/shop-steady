// Supabase Edge Function "invite-member": the owner adds someone under Team logins, and this sends them
// Supabase's invite email so they can sign in. Only someone whose role is "owner" (supabase/sync.sql) can use it,
// and only for an address already on the members list. The service key it needs is provided by Supabase
// to every Edge Function; it never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const APP_URL = Deno.env.get("APP_URL") ?? "https://blessedfig.github.io/shop-steady/app/";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user?.email) return json({ error: "signin" }, 401);
  const { data: role } = await asUser.rpc("my_role");
  if (role !== "owner") return json({ error: "owner-only" }, 403);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad-json" }, 400); }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "bad-email" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: m } = await admin.from("desk_members").select("email").eq("email", email).maybeSingle();
  if (!m) return json({ error: "not-on-list" }, 400);
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL });
  if (error) {
    if (/already been registered|already registered|exists/i.test(error.message)) return json({ ok: true, existed: true });
    return json({ error: "invite-failed", detail: error.message }, 502);
  }
  return json({ ok: true });
});
