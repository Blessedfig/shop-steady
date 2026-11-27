// Tests for the product fix rules (app/lib/fixrules.js) and the copy inside the product-fix Edge Function.
// Run: node tests/fixrules-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../app/lib/fixrules.js');
let n = 0; const t = (name, f) => { f(); n++; };

t('codes', () => {
  assert.equal(R.readCode('978-0-306-40615-7').code, '9780306406157');
  assert.ok(R.readCode('9780306406157').valid);
  assert.ok(!R.readCode('9780306406158').valid);
  assert.equal(R.readCode('0-306-40615-2').code, '9780306406157');
  assert.equal(R.readCode('0-306-40615-2').kind, 'isbn10');
  assert.equal(R.readCode("'036000291452").kind, 'upc');
  assert.ok(R.readCode('036000291452').valid);
  assert.equal(R.readCode('9.78031E+12').kind, 'mangled');
  assert.equal(R.readCode('BFT-0001'), null);
  assert.equal(R.readCode(''), null);
});
t('pack size', () => {
  assert.equal(R.packSize('Bookmarks, Set of 6'), 6);
  assert.equal(R.packSize('Sticker 12-Pack'), 12);
  assert.equal(R.packSize('Candle (4 ct)'), 4);
  assert.equal(R.packSize('Mug'), null);
  assert.equal(R.packSize('Set of 1'), null);
});

const V = (o) => Object.assign({ variant_id: Math.floor(Math.random() * 1e9), product_id: Math.floor(Math.random() * 1e9), product_title: 'Thing', variant_title: 'Default Title', sku: '', barcode: '', vendor: 'Brand', product_type: 'Gifts', status: 'ACTIVE', price: 20, cost: 10, tracked: true, on_hand: 3, tags: '' }, o);
const rules = (list) => list.map(p => (p.kind === 'check' ? 'check-X' : p.rule) + ':' + (p.new_value ?? '-')).sort();

t('barcode rules', () => {
  assert.deepEqual(rules(R.scan([V({ barcode: '978-0-306-40615-7' })])), ['barcode-format:9780306406157']);
  assert.deepEqual(rules(R.scan([V({ barcode: '0306406152' })])), ['isbn10-to-13:9780306406157']);
  assert.deepEqual(rules(R.scan([V({ sku: '9780306406157' })])), ['barcode-from-sku:9780306406157', 'type-book:Books'].filter(x => !x.startsWith('type')));
  assert.deepEqual(rules(R.scan([V({ product_type: '', sku: '9780306406157' })])), ['barcode-from-sku:9780306406157', 'type-book:Books']);
  assert.deepEqual(rules(R.scan([V({ product_title: 'Book (9780306406157)' })])), ['barcode-from-text:9780306406157']);
  assert.deepEqual(rules(R.scan([V({ barcode: '9.78031E+12' })])), ['check-X:-']);
  assert.deepEqual(rules(R.scan([V({ barcode: '9780306406158' })])), ['check-X:-']);
  assert.deepEqual(rules(R.scan([V({ barcode: 'BFT-0001' })])), []);
  const a = V({ barcode: '9780306406157', product_title: 'A' }), b = V({ barcode: '9780306406157', product_title: 'B' });
  assert.equal(R.scan([a, b]).filter(p => p.kind === 'check').length, 2);
});
t('book type follows the store', () => {
  const list = [V({ barcode: '9780306406157', product_type: 'Books - New and used' }), V({ product_type: '', sku: '9781566199094' })];
  assert.ok(rules(R.scan(list)).includes('type-book:Books - New and used'));
});
t('isbn lookup', () => {
  const v = V({ product_title: 'Uzumaki by Junji Ito' });
  const one = R.scan([v], { lookups: { [v.variant_id]: [{ isbn: '9781421561325', title: 'Uzumaki' }] } });
  assert.deepEqual(rules(one), ['barcode-lookup:9781421561325']);
  const two = R.scan([v], { lookups: { [v.variant_id]: [{ isbn: '9781421561325' }, { isbn: '9781974704361' }] } });
  assert.equal(two[0].new_value, null); assert.equal(two[0].evidence.choices.length, 2);
});
t('faire cost and price', () => {
  const lines = [{ order_no: 'F1', day: '2026-11-01', brand: 'Paper Co', product: 'Fox Notebook', sku: 'PC-FOX', units: 6, unit_cost: 5, line_total: 30, msrp: 10 }];
  // whole line recorded as cost
  assert.deepEqual(rules(R.scan([V({ product_title: 'Fox Notebook', sku: 'PC-FOX', cost: 30, price: 10 })], { faireLines: lines })), ['cost-case-total:5.00']);
  // no cost, no price
  assert.deepEqual(rules(R.scan([V({ product_title: 'Fox Notebook', cost: null, price: 0 })], { faireLines: lines })), ['cost-from-faire:5.00', 'price-from-faire:10.00']);
  // price is the case retail
  assert.deepEqual(rules(R.scan([V({ product_title: 'Fox Notebook', cost: 5, price: 60 })], { faireLines: lines })), ['price-case-total:10.00']);
  // a cost that simply changed
  assert.deepEqual(rules(R.scan([V({ product_title: 'Fox Notebook', cost: 5.5, price: 10 })], { faireLines: lines })), ['cost-differs-faire:5.00']);
  // all good
  assert.deepEqual(rules(R.scan([V({ product_title: 'Fox Notebook', cost: 5, price: 10 })], { faireLines: lines })), []);
});
t('faire without an order export', () => {
  assert.deepEqual(rules(R.scan([V({ cost: 60, price: 10, tags: 'Faire' })])), ['cost-keystone-multiple:5.00']);
  assert.deepEqual(rules(R.scan([V({ product_title: 'Pins, Set of 4', cost: 32, price: 12, tags: 'Faire' })])), ['cost-pack-size:8.00']);
  assert.deepEqual(rules(R.scan([V({ cost: 23, price: 20, tags: 'Faire' })])), ['cost-estimate:10.00']);
  assert.deepEqual(rules(R.scan([V({ cost: null, price: 20, tags: 'Faire' })])), ['cost-estimate:10.00']);
  assert.deepEqual(rules(R.scan([V({ cost: 23, price: 20 })])), ['check-X:-']);
  assert.deepEqual(rules(R.scan([V({ tags: 'Faire', tracked: false })])), ['tracking-on:true']);
  assert.deepEqual(rules(R.scan([V({ cost: 23, price: 20, status: 'ARCHIVED' })])), []);
});
t('csv import', () => {
  const csv = 'Order Number,Order Date,Brand Name,Product Name,Option,SKU,Quantity,Case Size,Wholesale Price,Retail Price,Total\n"F-77","2026-10-03","Paper Co","Fox Notebook","",PC-FOX,2,6,30.00,10.00,60.00\n';
  const rows = R.parseCsv(csv); const map = R.guessColumns(rows[0]);
  const out = R.faireRows(rows.slice(1), map);
  assert.equal(out.length, 1);
  assert.equal(out[0].units, 12); assert.equal(out[0].unit_cost, 5); assert.equal(out[0].msrp, 10); assert.equal(out[0].day, '2026-10-03');
  assert.equal(out[0].order_no, 'F-77'); assert.equal(out[0].sku, 'PC-FOX'); assert.equal(out[0].brand, 'Paper Co');
  const simple = R.faireRows(R.parseCsv('Product,Quantity,Unit Price,MSRP\nOwl Mug,4,8.5,17\n').slice(1), R.guessColumns(['Product', 'Quantity', 'Unit Price', 'MSRP']));
  assert.equal(simple[0].units, 4); assert.equal(simple[0].unit_cost, 8.5); assert.equal(simple[0].msrp, 17);
});
t('edge function carries the same rules', () => {
  const fn = path.join(__dirname, '../supabase/functions/product-fix/index.ts');
  let src = fs.readFileSync(fn, 'utf8');
  const rulesSrc = fs.readFileSync(path.join(__dirname, '../app/lib/fixrules.js'), 'utf8');
  if (process.argv.includes('--sync')) {
    src = src.replace(/(\/\/ ===== RULES START[^\n]*\n)[\s\S]*?(\/\/ ===== RULES END)/, (_, a, b) => a + rulesSrc + b);
    fs.writeFileSync(fn, src);
  }
  const m = src.match(/\/\/ ===== RULES START[^\n]*\n([\s\S]*?)\/\/ ===== RULES END/);
  assert.ok(m, 'rules markers missing in product-fix/index.ts');
  assert.equal(m[1], fs.readFileSync(path.join(__dirname, '../app/lib/fixrules.js'), 'utf8'), 'copy app/lib/fixrules.js into product-fix/index.ts (node tests/fixrules-test.js --sync)');
});
console.log(n + ' fixrules tests passed');
