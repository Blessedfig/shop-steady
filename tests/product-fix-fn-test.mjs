// Runs supabase/functions/product-fix/index.ts in Node with a fake Supabase client and fake web lookups:
// lookups, scan, saving findings, automatic rules, no repeats, dismissed stays dismissed, fixed items drop off.
// Run: node --experimental-strip-types --no-warnings tests/product-fix-fn-test.mjs
import fs from 'fs'; import assert from 'assert'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../supabase/functions/product-fix/index.ts'), 'utf8')
  .replace(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";/m, 'const createClient = (globalThis as any).__createClient;');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pfix-')), 'fn.ts');
fs.writeFileSync(tmp, src);

const T = { shopify_conn: [{ id: 1, cron_key: 'k' }], shopify_variants: [], shopify_costs: [], faire_order_lines: [], product_lookups: [], product_fixes: [], product_fix_rules: [], shopify_changes: [], shopify_sync_log: [] };
const PK = { product_lookups: 'variant_id', shopify_variants: 'variant_id', shopify_costs: 'inventory_item_id' };
let seq = 100;
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.lim = null; this.rng = null; this.ord = null; this.one = null; }
  select() { if (this.op === 'select') this.op = 'select'; else this.ret = true; return this; }
  eq(c, v) { this.f.push(r => r[c] == v); return this; }
  neq(c, v) { this.f.push(r => r[c] != v); return this; }
  in(c, a) { this.f.push(r => a.includes(r[c])); return this; }
  not(c, op, v) { this.f.push(r => r[c] != null); return this; }
  lt(c, v) { this.f.push(r => r[c] < v); return this; }
  order(c, o) { this.ord = [c, !(o && o.ascending === false)]; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
  upsert(rows) { this.op = 'upsert'; this.rows = [].concat(rows); return this; }
  update(o) { this.op = 'update'; this.patch = o; return this; }
  delete() { this.op = 'delete'; return this; }
  then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }
  run() {
    const tab = T[this.t]; const pk = PK[this.t] || 'id';
    if (this.op === 'insert' || this.op === 'upsert') {
      const out = [];
      for (const r of this.rows) {
        const ex = r[pk] != null && tab.find(x => x[pk] == r[pk]);
        if (ex && this.op === 'upsert') { Object.assign(ex, r); out.push(ex); continue; }
        if (this.t === 'product_fixes' && tab.some(x => x.variant_id === r.variant_id && x.rule === r.rule && (x.new_value ?? null) === (r.new_value ?? null))) return { data: null, error: { message: 'duplicate key' } };
        const row = Object.assign({ status: this.t === 'product_fixes' ? 'open' : this.t === 'shopify_changes' ? 'pending' : undefined }, r); if (row[pk] == null) row[pk] = seq++;
        tab.push(row); out.push(row);
      }
      return { data: this.one ? out[0] : out, error: null };
    }
    let rows = tab.filter(r => this.f.every(f => f(r)));
    if (this.op === 'update') { rows.forEach(r => Object.assign(r, this.patch)); return { data: rows, error: null }; }
    if (this.op === 'delete') { T[this.t] = tab.filter(r => !rows.includes(r)); return { data: rows, error: null }; }
    if (this.ord) { const [c, asc] = this.ord; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim) rows = rows.slice(0, this.lim);
    rows = rows.map(r => JSON.parse(JSON.stringify(r)));
    if (this.one) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}
globalThis.__createClient = () => ({ from: t => new Q(t), rpc: async () => ({ data: 'owner' }), auth: { getUser: async () => ({ data: { user: { email: 'owner@x' } } }) } });
const calls = [];
globalThis.fetch = async (u, o) => {
  u = String(u); calls.push(u);
  const J = (b) => ({ ok: true, status: 200, json: async () => b });
  if (u.includes('googleapis.com/books')) return J({ items: [
    { volumeInfo: { title: 'Uzumaki', subtitle: '3-in-1 Deluxe Edition', authors: ['Junji Ito'], publisher: 'VIZ Media', publishedDate: '2013-10-15', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781421561325' }] } },
    { volumeInfo: { title: 'Gyo', authors: ['Junji Ito'], industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781421579153' }] } }] });
  if (u.includes('openlibrary')) return J({ docs: [] });
  if (u.includes('/functions/v1/shopify-sync')) { const n = T.shopify_changes.filter(c => c.auto_rule && c.status === 'pending'); n.forEach(c => c.status = 'applied'); return J({ applied: n.length, failed: 0 }); }
  throw new Error('unexpected fetch ' + u);
};
let handler; globalThis.Deno = { serve: h => { handler = h; }, env: { get: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a' })[k] } };
await import(pathToFileURL(tmp).href);
const tick = async () => (await handler(new Request('https://x/', { method: 'POST', headers: { 'x-sync-key': 'k' }, body: '{"action":"tick"}' }))).json();

T.shopify_variants = [
  { variant_id: 1, product_id: 1, inventory_item_id: 1, product_title: 'Fox Notebook', variant_title: 'Default Title', sku: 'FOX', barcode: '', vendor: 'Paper Co', product_type: 'Stationery', status: 'ACTIVE', price: 14, tracked: true, on_hand: 6, tags: 'Faire' },
  { variant_id: 2, product_id: 2, inventory_item_id: 2, product_title: 'Uzumaki (3-in-1 Deluxe Edition) by Junji Ito', variant_title: 'Default Title', sku: '', barcode: '', vendor: 'S&S', product_type: 'Books', status: 'ACTIVE', price: 35, tracked: true, on_hand: 35, tags: '' },
  { variant_id: 3, product_id: 3, inventory_item_id: 3, product_title: 'Old', variant_title: '', sku: '', barcode: '0-547-92821-1', vendor: 'X', product_type: 'Books', status: 'ARCHIVED', price: 5, tracked: true, on_hand: 0, tags: '' },
  { variant_id: 4, product_id: 4, inventory_item_id: 4, product_title: 'Hobbit', variant_title: '', sku: '', barcode: '0-547-92821-1', vendor: 'X', product_type: 'Books', status: 'ACTIVE', price: 15, tracked: true, on_hand: 2, tags: '' },
];
T.shopify_costs = [{ inventory_item_id: 1, cost: 42 }, { inventory_item_id: 2, cost: null }, { inventory_item_id: 4, cost: 8 }];
T.faire_order_lines = [{ line_key: 'a', order_no: 'F1', day: '2026-11-01', brand: 'Paper Co', product: 'Fox Notebook', sku: 'FOX', units: 6, unit_cost: 7, line_total: 42, msrp: 14 }];
T.product_fix_rules = [{ rule: 'cost-case-total', auto: true }];

let r = await tick();
const show = () => T.product_fixes.map(f => [f.id, f.variant_id, f.rule, f.new_value, f.status, f.confidence].join(' '));
assert.ok(r.ok, JSON.stringify(r));

assert.equal(T.product_lookups.length, 1, 'one lookup (the book with no code)');
assert.equal(T.product_lookups[0].found.length, 1, 'Gyo filtered out by title match');
const caseFix = T.product_fixes.find(f => f.rule === 'cost-case-total');
assert.equal(caseFix.status, 'approved'); assert.equal(T.shopify_changes[0].auto_rule, 'cost-case-total'); assert.equal(T.shopify_changes[0].status, 'applied');
assert.ok(T.product_fixes.find(f => f.rule === 'barcode-lookup' && f.new_value === '9781421561325' && f.status === 'open'));
assert.ok(T.product_fixes.find(f => f.rule === 'isbn10-to-13' && f.variant_id === 4));
assert.ok(!T.product_fixes.find(f => f.variant_id === 3), 'archived skipped');
const n1 = T.product_fixes.length;
// second run: nothing new, no repeat lookup
const gb = calls.filter(u => u.includes('googleapis')).length;
r = await tick();
assert.equal(T.product_fixes.length, n1); assert.equal(calls.filter(u => u.includes('googleapis')).length, gb, 'no repeat lookup within 30 days');
// dismissed stays dismissed; fixed in Shopify -> open one removed
T.product_fixes.find(f => f.rule === 'barcode-lookup').status = 'dismissed';
T.shopify_variants[3].barcode = '9780547928210';
r = await tick();
assert.ok(!T.product_fixes.find(f => f.rule === 'isbn10-to-13'), 'removed once Shopify is fixed');
assert.equal(T.product_fixes.find(f => f.rule === 'barcode-lookup').status, 'dismissed');
console.log('product-fix function test passed');
