// Product fix rules for Downtown Stube's product cleaner. Pure functions, no network, no database.
// The same file runs in two places:
//   - the browser (app/fix.js, demo mode and the review screen), as window.FixRules
//   - the product-fix Edge Function (a copy between the RULES markers in supabase/functions/product-fix/index.ts;
//     tests/fixrules-test.js fails if the two copies differ).
// scan(variants, ctx) looks at every product variant and returns proposed fixes. Nothing here changes anything:
// a proposal goes to Shopify only after the owner approves it (or turns on an automatic rule for it).
//
// A proposal: {variant_id, product_id, title, kind, old_value, new_value, confidence, rule, reason, evidence}
//   kind: barcode | cost | price | type | tracked | check (check = needs a person; no automatic fix)
//   confidence: high (clear evidence) | medium (very likely) | low (an estimate)
(function (root) {
  'use strict';
  const digits = s => String(s == null ? '' : s).replace(/[^0-9Xx]/g, '').toUpperCase();
  const money = n => (Math.round(Number(n) * 100) / 100).toFixed(2);
  const num = x => { if (x == null || x === '') return null; const n = Number(String(x).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null; };
  const near = (a, b, tol) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * tol);

  function gtinValid(d) { // EAN-13, UPC-A (12), EAN-8: weights 3,1 from the right, before the check digit
    if (!/^\d+$/.test(d) || ![8, 12, 13, 14].includes(d.length)) return false;
    let s = 0; for (let i = d.length - 2, w = 3; i >= 0; i--, w = 4 - w) s += Number(d[i]) * w;
    return (10 - (s % 10)) % 10 === Number(d[d.length - 1]);
  }
  function isbn10Valid(d) {
    if (!/^\d{9}[\dX]$/.test(d)) return false;
    let s = 0; for (let i = 0; i < 10; i++) s += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i);
    return s % 11 === 0;
  }
  function isbn10to13(d) {
    const b = '978' + d.slice(0, 9); let s = 0;
    for (let i = 0; i < 12; i++) s += Number(b[i]) * (i % 2 ? 3 : 1);
    return b + ((10 - (s % 10)) % 10);
  }
  // Reads a barcode, ISBN or SKU the way a person may have typed it ("978-1-2345-6789-0", "'9781234567890", "0-123-45678-X").
  // Returns {code, kind, valid} or null when it does not look like a standard code at all.
  function readCode(raw) {
    const t = String(raw == null ? '' : raw).trim().replace(/^'+/, '');
    if (!t) return null;
    if (/^\d(\.\d+)?E\+?\d+$/i.test(t)) return { code: t, kind: 'mangled', valid: false };     // 9.78123E+12 from a spreadsheet
    if (/[A-WYZa-wyz]/.test(t.replace(/^(isbn|upc|ean)[:\s-]*/i, ''))) return null;           // letters: a store's own SKU
    const d = digits(t);
    if (d.length === 10 && isbn10Valid(d)) return { code: isbn10to13(d), kind: 'isbn10', valid: true, from: d };
    if (/X/.test(d)) return null;
    if (d.length === 13) return { code: d, kind: /^97[89]/.test(d) ? 'isbn13' : 'ean13', valid: gtinValid(d) };
    if (d.length === 12) return { code: d, kind: 'upc', valid: gtinValid(d) };
    if (d.length === 14 && d[0] === '0') return { code: d.slice(1), kind: 'ean13', valid: gtinValid(d) };
    if (d.length === 8) return { code: d, kind: 'ean8', valid: gtinValid(d) };
    if (d.length === 10) return { code: d, kind: 'isbn10', valid: false };
    return null;
  }
  const isIsbn = c => !!c && c.valid && /^97[89]/.test(c.code);
  // An ISBN written into the title, e.g. "Some Book (9781234567890)"
  function codeInText(s) {
    const m = String(s || '').match(/(?:^|[^\d])(97[89][\d-]{10,14})(?:[^\d]|$)/);
    const c = m && readCode(m[1]); return c && c.valid ? c : null;
  }
  // "Set of 6", "6-Pack", "Pack of 12", "12 ct", "Case of 24", "Box of 10", "(4 count)", "Bundle of 3"
  function packSize(text) {
    const s = String(text || '').toLowerCase();
    const m = s.match(/\b(?:set|pack|case|box|bundle|lot|carton)\s+of\s+(\d{1,3})\b/) || s.match(/\b(\d{1,3})\s*[- ]?\s*(?:pack|pk|ct|count|piece case|units?)\b/);
    const n = m ? Number(m[1]) : 0;
    return n >= 2 && n <= 144 ? n : null;
  }
  // A case or display sold as one item: "24ct Display", "12ct", "Display of 6", "144 Sticks", "Case of 12".
  // Not "Set of 3" (sets are sold as sets) and not piece counts ("1000 Piece" puzzles).
  function caseCount(text) {
    const s = String(text || '').toLowerCase();
    const m = s.match(/\b(?:case|box|display|tray|carton|caddy|pack)\s+of\s+(\d{1,3})\b/) || s.match(/\b(\d{1,3})\s*[- ]?\s*(?:ct|count|pk|sticks|bars|packets|units?)\b/)
      || s.match(/\bcase\s*\/\s*(\d{1,3})\b/);
    const n = m ? Number(m[1]) : 0;
    return n >= 2 && n <= 500 ? n : null;
  }
  const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const titleKey = (p, o) => norm(p + (o && !/^default( title)?$/i.test(o) ? ' ' + o : ''));
  const isFaire = (v, ctx) => /(^|[\s,])faire([\s,]|$)/i.test(v.tags || '') || !!(ctx.faireBrands && ctx.faireBrands.has(norm(v.vendor)));

  // Faire order lines as imported (see import in app/fix.js): {order_no, day, brand, product, option, sku, barcode,
  // units, unit_cost, line_total, msrp}. Index by SKU and by title, newest first.
  function faireIndex(lines) {
    const bySku = new Map(), byTitle = new Map(), brands = new Set();
    const sorted = (lines || []).slice().sort((a, b) => String(b.day || '').localeCompare(String(a.day || '')));
    for (const l of sorted) {
      if (l.brand) brands.add(norm(l.brand));
      const k = String(l.sku || '').trim().toLowerCase();
      if (k && !bySku.has(k)) bySku.set(k, l);
      for (const t of [titleKey(l.product, l.option), norm(l.product)]) if (t && !byTitle.has(t)) byTitle.set(t, l);
    }
    return { bySku, byTitle, brands };
  }
  function unitCostOf(l) {
    const u = num(l.unit_cost), t = num(l.line_total), n = num(l.units);
    if (u != null && u > 0) return u;
    if (t != null && n) return t / n;
    return null;
  }

  const RULES = {
    'barcode-format':    { kind: 'barcode', label: 'Clean up barcode formatting', what: 'A valid barcode typed with dashes, spaces or a leading apostrophe; the clean number scans at the register.' },
    'isbn10-to-13':      { kind: 'barcode', label: 'ISBN-10 to ISBN-13', what: 'Books printed since 2007 carry the 13-digit ISBN on the back. The 10-digit one does not scan.' },
    'barcode-from-sku':  { kind: 'barcode', label: 'Barcode from the SKU', what: 'The barcode is empty or broken, but the SKU holds a valid ISBN or UPC.' },
    'barcode-from-text': { kind: 'barcode', label: 'Barcode from the title', what: 'The barcode is empty, but the title holds a valid ISBN.' },
    'barcode-from-faire':{ kind: 'barcode', label: 'Barcode from the Faire order', what: 'The Faire order export lists the UPC or ISBN for this item.' },
    'barcode-lookup':    { kind: 'barcode', label: 'ISBN found by title and author', what: 'Looked up in Google Books and Open Library. When a book has several editions you pick the one you stock.' },
    'cost-from-faire':   { kind: 'cost', label: 'Cost from the Faire order', what: 'No cost in Shopify; the Faire order says what you paid for each one.' },
    'cost-case-total':   { kind: 'cost', label: 'Case total to cost per item', what: 'The cost in Shopify is the whole line or case from the Faire order. Divided by the units in it.' },
    'cost-differs-faire':{ kind: 'cost', label: 'Cost differs from the last Faire order', what: 'Shopify\'s cost does not match what the latest Faire order paid for each one.' },
    'cost-pack-size':    { kind: 'cost', label: 'Pack size in the name', what: 'Cost is at or above the selling price and the name says how many are in the pack, so the cost is likely for the whole pack.' },
    'cost-keystone-multiple': { kind: 'cost', label: 'Cost is a multiple of the case', what: 'Cost is exactly 3, 4, 6... times half the retail price, the usual sign of a case total for a Faire item.' },
    'cost-estimate':     { kind: 'cost', label: 'Estimated Faire cost', what: 'Faire brands usually sell to stores at half of retail. Only an estimate; a Faire order export makes it exact.' },
    'price-from-faire':  { kind: 'price', label: 'Retail price from Faire', what: 'No selling price in Shopify; the Faire order lists the brand\'s suggested retail price.' },
    'price-case-total':  { kind: 'price', label: 'Case retail to one item', what: 'The selling price is the retail of the whole case, not one item.' },
    'case-in-name':      { kind: 'price', label: 'Whole case sold as one item', what: 'The name says a case or display (24ct, Display of 6, 144 sticks) and the price is for all of it, so one piece would ring up at the case price. Splits price and cost per piece; count the stock too.' },
    'case-in-name-cost': { kind: 'cost', label: 'Whole case cost on one item', what: 'Goes with "Whole case sold as one item": the cost of the case divided by the pieces in it.' },
    'price-keystone':    { kind: 'price', label: 'Price at twice cost', what: 'No selling price; suggests twice the cost per item (keystone), the usual Faire retail price.' },
    'type-book':         { kind: 'type', label: 'Product type for books', what: 'An ISBN but no product type; uses the type most of your books already have.' },
    'tracking-on':       { kind: 'tracked', label: 'Track stock for Faire items', what: 'Faire items with stock tracking off show as always available and never come up for reorder.' },
    'check-barcode':     { kind: 'check', label: 'Broken barcode', what: 'A barcode that fails its check digit or was mangled by a spreadsheet, with no good code to replace it.' },
    'check-duplicate':   { kind: 'check', label: 'Same barcode on two products', what: 'Two different products share a barcode, so the register may ring up the wrong one.' },
    'check-cost':        { kind: 'check', label: 'Cost at or above price', what: 'Cost is at or above the selling price and no rule can tell why.' },
    'check-price':       { kind: 'check', label: 'Sells below cost', what: 'The selling price is below the cost per item.' },
  };

  // variants: [{variant_id, product_id, product_title, variant_title, sku, barcode, vendor, product_type, status,
  //             price, cost, tracked, on_hand, tags}]
  // ctx: {faireLines, lookups: {variant_id: [{isbn, title, authors, publisher, year, source}]}, bookType}
  function scan(variants, ctx) {
    ctx = ctx || {};
    const fx = faireIndex(ctx.faireLines);
    ctx.faireBrands = fx.brands;
    const out = [];
    const live = (variants || []).filter(v => !/^archived$/i.test(v.status || ''));
    // the product type most books already have
    let bookType = ctx.bookType;
    if (!bookType) {
      const cnt = {};
      for (const v of live) { const c = readCode(v.barcode); if (isIsbn(c) && v.product_type) cnt[v.product_type] = (cnt[v.product_type] || 0) + 1; }
      bookType = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || 'Books';
    }
    // barcodes shared by different products
    const seen = new Map();
    for (const v of live) { const c = readCode(v.barcode); if (c && c.valid) { const a = seen.get(c.code) || []; a.push(v); seen.set(c.code, a); } }

    for (const v of live) {
      const name = v.product_title + (v.variant_title && !/^default title$/i.test(v.variant_title) ? ' · ' + v.variant_title : '');
      const base = { variant_id: v.variant_id, product_id: v.product_id, title: name };
      const add = (rule, old_value, new_value, confidence, reason, evidence) =>
        out.push(Object.assign({}, base, { kind: RULES[rule].kind, rule, old_value: old_value == null ? null : String(old_value), new_value: new_value == null ? null : String(new_value), confidence, reason, evidence: evidence || {} }));
      const faire = isFaire(v, ctx);
      const skuKey = v.sku && String(v.sku).trim().toLowerCase();
      const line = (skuKey && fx.bySku.get(skuKey)) || fx.byTitle.get(titleKey(v.product_title, v.variant_title)) || fx.byTitle.get(norm(v.product_title)) || null;
      const lineEv = line ? { faire_order: line.order_no || null, faire_day: line.day || null, units: num(line.units), line_total: num(line.line_total), unit_cost: unitCostOf(line), msrp: num(line.msrp) } : null;

      // ---------- barcode ----------
      const bc = readCode(v.barcode), sc = readCode(v.sku);
      let barcodeNow = bc && bc.valid ? bc.code : null;
      if (String(v.barcode || '').trim()) {
        if (bc && bc.kind === 'mangled') {
          if (sc && sc.valid) { add('barcode-from-sku', v.barcode, sc.code, 'high', 'The barcode was turned into a number like 9.78E+12 by a spreadsheet. The SKU holds the real code.'); barcodeNow = sc.code; }
          else add('check-barcode', v.barcode, null, 'high', 'The barcode was turned into a number like 9.78E+12 by a spreadsheet, so it will not scan. Retype it from the item.');
        } else if (bc && bc.valid && bc.kind === 'isbn10') {
          add('isbn10-to-13', v.barcode, bc.code, 'high', 'ISBN-10 ' + bc.from + ' is the same book as ISBN-13 ' + bc.code + ', which is the one printed on the barcode.');
        } else if (bc && bc.valid && bc.code !== String(v.barcode)) {
          add('barcode-format', v.barcode, bc.code, 'high', 'Same number without the dashes, spaces or apostrophe, so it matches what the scanner reads.');
        } else if (bc && !bc.valid) {
          if (sc && sc.valid && sc.code !== bc.code) { add('barcode-from-sku', v.barcode, sc.code, 'high', 'The barcode fails its check digit (a typo). The SKU holds a valid code.'); barcodeNow = sc.code; }
          else add('check-barcode', v.barcode, null, 'medium', 'The barcode fails its check digit, so it is probably mistyped. Scan the item to fix it.');
        }
      } else {
        const fromText = codeInText(v.product_title + ' ' + (v.variant_title || ''));
        const fb = line && readCode(line.barcode);
        const looked = ctx.lookups && ctx.lookups[v.variant_id];
        if (sc && sc.valid) { add('barcode-from-sku', '', sc.code, 'high', 'No barcode, but the SKU is a valid ' + (isIsbn(sc) ? 'ISBN' : 'UPC/EAN') + '.'); barcodeNow = sc.code; }
        else if (fromText) { add('barcode-from-text', '', fromText.code, 'high', 'No barcode, but the title includes ISBN ' + fromText.code + '.'); barcodeNow = fromText.code; }
        else if (fb && fb.valid) { add('barcode-from-faire', '', fb.code, 'high', 'No barcode in Shopify; Faire order ' + (line.order_no || '') + ' lists ' + fb.code + '.', lineEv); barcodeNow = fb.code; }
        else if (looked && looked.length) {
          const ok = looked.filter(c => { const r = readCode(c.isbn); return r && r.valid && !seen.has(r.code); });
          if (ok.length === 1) { add('barcode-lookup', '', ok[0].isbn, 'medium', 'Found one matching edition: ' + [ok[0].title, ok[0].publisher, ok[0].year].filter(Boolean).join(', ') + '. Check it against the book.', { choices: ok }); barcodeNow = ok[0].isbn; }
          else if (ok.length > 1) add('barcode-lookup', '', null, 'medium', ok.length + ' editions match. Pick the one on your shelf (check the back cover).', { choices: ok.slice(0, 6) });
        }
      }
      if (bc && bc.valid && (seen.get(bc.code) || []).some(o => o.product_id !== v.product_id))
        add('check-duplicate', v.barcode, null, 'medium', 'Another product has the same barcode (' + seen.get(bc.code).filter(o => o.product_id !== v.product_id).map(o => o.product_title).slice(0, 2).join('; ') + '). The register may ring up the wrong one. Merge them or fix one.');

      // ---------- a whole case or display priced as one item (no Faire order on file to say otherwise) ----------
      const price = num(v.price), cost = num(v.cost);
      const caseN = !line && faire ? caseCount(name) : null;
      const onHand = num(v.on_hand) || 0;
      const caseWhole = caseN && price && price / caseN >= 0.5 && (price >= 30 || (price >= 15 && onHand < caseN));
      if (caseWhole) {
        const stock = onHand > 0 && onHand < caseN ? ' Shopify shows ' + onHand + ' on hand; if those are unopened cases you have about ' + onHand * caseN + ' pieces, so count them.' : '';
        const twin = bc && bc.valid && (seen.get(bc.code) || []).find(o => o.variant_id !== v.variant_id && num(o.price) && num(o.price) < price / 2);
        const dup = twin ? ' You already sell it one at a time as "' + twin.product_title + '" at $' + money(num(twin.price)) + ' with the same barcode, so the simpler fix is to move this stock there and archive this listing.' : '';
        add('case-in-name', money(price), money(price / caseN), 'medium', 'The name says ' + caseN + ' to a case and the price $' + money(price) + ' is for all ' + caseN + '. One costs $' + money(price / caseN) + ' at the same markup.' + stock + dup);
        if (cost) add('case-in-name-cost', money(cost), money(cost / caseN), 'medium', 'The $' + money(cost) + ' cost is for the case of ' + caseN + ', so $' + money(cost / caseN) + ' each.');
      }

      // ---------- cost ----------
      let unitCost = cost && cost > 0 ? (caseWhole ? cost / caseN : cost) : null;
      const fUnit = line ? unitCostOf(line) : null;
      if (caseWhole) { /* handled above */ }
      else if (fUnit) {
        const units = num(line.units) || 0, total = num(line.line_total);
        if (!cost) { add('cost-from-faire', cost, money(fUnit), 'high', 'Faire order ' + (line.order_no || '') + (line.day ? ' (' + line.day + ')' : '') + ': ' + (units ? units + ' for ' + (total != null ? '$' + money(total) : '') + ', ' : '') + '$' + money(fUnit) + ' each.', lineEv); unitCost = fUnit; }
        else if (!near(cost, fUnit, 0.01)) {
          const k = Math.round(cost / fUnit);
          if ((total != null && units > 1 && near(cost, total, 0.01)) || (k >= 2 && near(cost, fUnit * k, 0.02))) {
            add('cost-case-total', money(cost), money(fUnit), 'high', 'Shopify has $' + money(cost) + ', which is ' + (total != null && near(cost, total, 0.01) ? 'the whole Faire line (' + units + ' units)' : k + ' units') + '. One costs $' + money(fUnit) + '.', lineEv);
            unitCost = fUnit;
          } else add('cost-differs-faire', money(cost), money(fUnit), 'medium', 'Shopify has $' + money(cost) + '; the latest Faire order paid $' + money(fUnit) + ' each.', lineEv);
        }
      } else if (cost && price && price > 0 && cost >= price * 0.9) {
        const n = packSize(name), k = Math.round(cost / (price / 2));
        if (n && cost >= price * 1.5 && cost / n < price) { add('cost-pack-size', money(cost), money(cost / n), 'medium', 'Cost $' + money(cost) + ' is at or above the price $' + money(price) + ', and the name says ' + n + ' in the pack. $' + money(cost / n) + ' each.'); unitCost = cost / n; }
        else if (faire && k >= 3 && k <= 144 && near(cost, k * price / 2, 0.02)) { add('cost-keystone-multiple', money(cost), money(cost / k), 'medium', 'Cost $' + money(cost) + ' is exactly ' + k + ' × $' + money(price / 2) + ' (half the $' + money(price) + ' retail), so it looks like the total for ' + k + ' units.'); unitCost = cost / k; }
        else if (faire) { add('cost-estimate', money(cost), money(price / 2), 'low', 'Cost $' + money(cost) + ' is at or above the $' + money(price) + ' price. Faire items usually cost half of retail; a Faire order export makes this exact.'); unitCost = price / 2; }
        else if (cost > price) { add('check-cost', money(cost), null, 'medium', 'Cost $' + money(cost) + ' is at or above the selling price $' + money(price) + '. Check the invoice.'); unitCost = null; }
        else if (cost === price && faire) add('check-cost', money(cost), null, 'medium', 'Cost and price are both $' + money(price) + ', so it sells with no margin. One of them is wrong; check the Faire invoice.');
      } else if (!cost && faire && price && price > 0) {
        add('cost-estimate', cost, money(price / 2), 'low', 'No cost. Faire items usually cost half of the $' + money(price) + ' retail; a Faire order export makes this exact.');
      }

      // ---------- price ----------
      const msrp = line ? num(line.msrp) : null;
      if (caseWhole) { /* handled above */ }
      else if (msrp && msrp > 0) {
        const k = price ? Math.round(price / msrp) : 0;
        if (!price) add('price-from-faire', v.price, money(msrp), 'high', 'No selling price; the brand\'s suggested retail on Faire is $' + money(msrp) + '.', lineEv);
        else if (k >= 2 && near(price, msrp * k, 0.02)) add('price-case-total', money(price), money(msrp), 'high', 'The price $' + money(price) + ' is ' + k + ' × the suggested retail of one ($' + money(msrp) + ').', lineEv);
      } else if (!price && unitCost) {
        add('price-keystone', v.price, money(unitCost * 2), 'low', 'No selling price. Twice the $' + money(unitCost) + ' cost is $' + money(unitCost * 2) + '.');
      } else if (price && unitCost && price < unitCost) {
        add('check-price', money(price), null, 'medium', 'Sells for $' + money(price) + ' but costs $' + money(unitCost) + '.');
      }

      // ---------- type and tracking ----------
      if (!String(v.product_type || '').trim() && barcodeNow && /^97[89]/.test(barcodeNow) && bookType)
        add('type-book', '', bookType, 'medium', 'Has an ISBN but no product type. Most of your books are "' + bookType + '".');
      if (faire && v.tracked === false && /^active$/i.test(v.status || 'active'))
        add('tracking-on', 'false', 'true', 'medium', 'Stock tracking is off, so Shopify always shows it as available and it never comes up for reorder.');
    }
    return out;
  }

  // Reads a Faire order export (or any wholesale order CSV) once its columns are mapped. map: {field: column index}
  const FIELDS = {
    order_no: /order\s*(number|no\.?|#|id)|^order$/i, day: /date|ordered|placed/i, brand: /brand|maker|vendor|supplier/i,
    product: /product|item|title|^name$|description/i, option: /option|variant|style|size|color/i, sku: /sku|item\s*code|style\s*number/i,
    barcode: /gtin|upc|barcode|ean|isbn/i, qty: /^qty|quantity|units\s*ordered|^units$/i, case_size: /case|pack\s*size|units?\s*per|per\s*(case|pack)|multiple/i,
    unit_cost: /wholesale|unit\s*(price|cost)|cost\s*per|^price$|^cost$/i, msrp: /retail|msrp|suggested/i, line_total: /total|subtotal|amount|extended/i,
  };
  function guessColumns(header) {
    const map = {}, used = new Set();
    const order = ['msrp', 'case_size', 'order_no', 'barcode', 'sku', 'qty', 'line_total', 'unit_cost', 'day', 'brand', 'option', 'product'];
    for (const f of order) {
      const i = header.findIndex((h, j) => !used.has(j) && FIELDS[f].test(String(h).trim()) && !(f === 'line_total' && /order\s*total|grand/i.test(h)));
      if (i >= 0) { map[f] = i; used.add(i); }
    }
    return map;
  }
  function faireRows(rows, map) {
    const get = (r, f) => map[f] == null ? '' : String(r[map[f]] == null ? '' : r[map[f]]).trim();
    const out = [];
    for (const r of rows) {
      const product = get(r, 'product'); if (!product) continue;
      const qty = num(get(r, 'qty')) || 1, cs = num(get(r, 'case_size')) || 1;
      const units = qty * cs, total = num(get(r, 'line_total'));
      let unit = num(get(r, 'unit_cost'));
      if (unit != null && cs > 1 && total != null && near(unit * qty, total, 0.01)) unit = unit / cs; // price was per case
      if (unit == null && total != null) unit = total / units;
      let msrp = num(get(r, 'msrp'));
      if (msrp != null && unit != null && cs > 1 && msrp > unit * cs * 1.2) msrp = msrp / cs;          // retail given per case
      let day = get(r, 'day'); const d = day && new Date(day); day = d && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
      out.push({ order_no: get(r, 'order_no'), day: day || null, brand: get(r, 'brand'), product, option: get(r, 'option'), sku: get(r, 'sku').replace(/^'/, ''),
        barcode: get(r, 'barcode').replace(/^'/, ''), units, unit_cost: unit == null ? null : Math.round(unit * 10000) / 10000, line_total: total, msrp });
    }
    return out;
  }
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false; text = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c !== '')) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell); if (row.some(c => c !== '')) rows.push(row);
    return rows;
  }

  const api = { readCode, isbn10to13, gtinValid, isbn10Valid, packSize, caseCount, codeInText, scan, RULES, FIELDS, guessColumns, faireRows, parseCsv, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FixRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
