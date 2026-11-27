// Supabase Edge Function "shopify-auth": connects the store's own Shopify app (made in Shopify's Dev Dashboard,
// custom distribution to this one store) and keeps the access token on the server.
//   POST {action:"start", shop}  from the app, owner only: returns Shopify's approval page URL.
//   GET  ?shop&hmac&...           Shopify opens this when the app is installed from its install link: we check
//                                 Shopify's signature and send the owner on to the approval page.
//   GET  ?code&state&hmac&shop    Shopify's answer after the owner approves: we check the signature and the
//                                 one-time state, swap the code for an access token, and store it in
//                                 shopify_conn (no one can read that table from the web).
// Secrets (Supabase > Edge Functions > Secrets, added by the owner): SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET.
// "Verify JWT with legacy secret" must be OFF: Shopify's redirects carry no sign-in; this code checks everything.
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = Deno.env.get("APP_URL") ?? "https://blessedfig.github.io/shop-steady/app/";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const SCOPES = "read_products,write_products,read_inventory,write_inventory,read_orders,read_locations";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const back = (msg: string) => Response.redirect(APP_URL + "#/shopify/" + encodeURIComponent(msg), 302);
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a: string, b: string) { // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// Shopify signs the query string: every parameter except hmac, sorted, joined as k=v&k=v.
async function signedByShopify(u: URL, secret: string) {
  const hmac = u.searchParams.get("hmac") ?? "";
  const parts = [...u.searchParams.entries()].filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("&");
  return hmac.length === 64 && sameText(await hmacHex(secret, parts), hmac.toLowerCase());
}
const randomState = () => Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID"), secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const self = url + "/functions/v1/shopify-auth";
  const approveUrl = (shop: string, state: string) =>
    `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId!)}&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(self)}&state=${state}`;
  const newState = async (shop: string) => {
    const state = randomState();
    await admin.from("shopify_conn").update({ oauth_state: state, state_at: new Date().toISOString(), shop }).eq("id", 1);
    return state;
  };

  if (req.method === "POST") {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user?.email) return json({ error: "signin" }, 401);
    const { data: role } = await asUser.rpc("my_role");
    if (role !== "owner") return json({ error: "owner-only" }, 403);
    if (!clientId || !secret) return json({ error: "not-configured" }, 503);
    // deno-lint-ignore no-explicit-any
    let body: any; try { body = await req.json(); } catch { return json({ error: "bad-json" }, 400); }
    const shop = String(body.shop ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!SHOP_RE.test(shop)) return json({ error: "bad-shop", hint: "Use the store's .myshopify.com address." }, 400);
    await admin.from("shopify_conn").update({ installed_by: u.user.email.toLowerCase() }).eq("id", 1);
    return json({ url: approveUrl(shop, await newState(shop)) });
  }
  if (req.method !== "GET") return json({ error: "method" }, 405);
  if (!clientId || !secret) return back("not-configured");

  const u = new URL(req.url), shop = (u.searchParams.get("shop") ?? "").toLowerCase();
  if (!SHOP_RE.test(shop) || !(await signedByShopify(u, secret))) return back("bad-signature");
  const code = u.searchParams.get("code");
  if (!code) return Response.redirect(approveUrl(shop, await newState(shop)), 302); // opened from the install link

  const { data: conn } = await admin.from("shopify_conn").select("oauth_state,state_at,shop").eq("id", 1).single();
  const fresh = conn?.state_at && Date.now() - new Date(conn.state_at).getTime() < 15 * 60 * 1000;
  if (!conn?.oauth_state || !fresh || !sameText(conn.oauth_state, u.searchParams.get("state") ?? "") || conn.shop !== shop) return back("expired");
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
  });
  if (!r.ok) return back("token-failed");
  const t = await r.json();
  if (!t.access_token) return back("token-failed");
  await admin.from("shopify_conn").update({
    access_token: t.access_token, scope: t.scope ?? "", installed_at: new Date().toISOString(),
    oauth_state: null, state_at: null, full_at: null, orders_at: null, bulk_id: null,
  }).eq("id", 1);
  await admin.from("shopify_sync_log").insert({ kind: "connect", ok: true, note: "Connected " + shop + " (" + (t.scope ?? "") + ")" });
  return back("connected");
});
