// Supabase Edge Function "product-fix": the product fixer. Keeps Shopify product data clean on its own, Faire items first.
//   tick   (every hour from the database timer, header x-sync-key) or scan (a manager or owner taps "Check now"):
//            1. Looks up ISBNs by title and author for up to 25 books with no barcode (Google Books, then Open Library).
//            2. Rereads every product variant with its cost, the Faire order lines and the lookups, runs the rules
//               (the RULES block below, a copy of app/lib/fixrules.js) and updates product_fixes: new findings are
//               added, findings that no longer apply are removed, dismissed ones stay dismissed.
//            3. For rules the owner switched to automatic: queues their high and medium fixes in shopify_changes and
//               asks shopify-sync to send them. Every other fix waits for the owner in the app.
//   lookup (manager or owner, body.variant_ids): look up those books now, then scan.
// Nothing here writes to Shopify directly; shopify-sync does, and only owner-approved or owner-automated changes.
// Deploy with "Verify JWT with legacy secret" OFF (the timer has no sign-in; this code checks the key or the person).
// Optional secret GOOGLE_BOOKS_KEY raises Google Books' daily limit; it works without one.
import { createClient } from "npm:@supabase/supabase-js@2";

// ===== RULES START (copy of app/lib/fixrules.js; run node tests/fixrules-test.js --sync after changing it) =====
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
// ===== RULES END
// deno-lint-ignore no-explicit-any
const FixRules = (globalThis as any).FixRules;

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://blessedfig.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sameText = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const UA = "DowntownStube-ProductFixer/1.0 (independent bookstore inventory tool)";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: conn } = await admin.from("shopify_conn").select("cron_key").eq("id", 1).single();
  let body: Row; try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action ?? "scan");

  let who = "timer";
  const key = req.headers.get("x-sync-key");
  if (key) {
    if (!conn?.cron_key || !sameText(key, conn.cron_key)) return json({ error: "bad-key" }, 401);
  } else {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user?.email) return json({ error: "signin" }, 401);
    const { data: r } = await asUser.rpc("my_role");
    if (r !== "owner" && r !== "manager") return json({ error: "manager-only" }, 403);
    who = u.user.email.toLowerCase();
  }
  const log = (ok: boolean, note: string) => admin.from("shopify_sync_log").insert({ kind: "fix", ok, note: note.slice(0, 500) });

  const notes: string[] = [];
  let ok = true;
  try {
    const t0 = Date.now();
    const variants = await loadVariants();
    if (!variants.length) return json({ ok: true, notes: ["No products synced from Shopify yet."] });

    // 1. ISBN lookups
    const want: number[] = action === "lookup" && Array.isArray(body.variant_ids) ? body.variant_ids.map(Number).filter(Boolean).slice(0, 25) : [];
    const found = await lookups(variants, want, 25, t0);
    if (found.tried) notes.push(`${found.tried} ${found.tried === 1 ? "book" : "books"} looked up, ${found.hits} found`);

    // 2. scan
    const faireLines = await loadAll("faire_order_lines", "order_no,day,brand,product,option,sku,barcode,units,unit_cost,line_total,msrp", (q) => q.order("line_key"));
    const lk = await loadAll("product_lookups", "variant_id,found", (q) => q.order("variant_id"));
    const lookupMap: Record<string, Row[]> = {};
    for (const l of lk) if (Array.isArray(l.found) && l.found.length) lookupMap[l.variant_id] = l.found;
    const proposals: Row[] = FixRules.scan(variants, { faireLines, lookups: lookupMap });
    const r = await store(proposals);
    notes.push(`${variants.length} products checked: ${r.open} fixes waiting (${r.added} new), ${r.checks} to look at`);

    // 3. automatic rules
    const a = await automatic();
    if (a.queued) notes.push(`${a.queued} fixed automatically` + (a.failed ? `, ${a.failed} failed` : ""));
  } catch (e) { ok = false; notes.push((e as Error).message); }
  await log(ok, (who === "timer" ? "" : "by " + who + ": ") + notes.join(" · "));
  return json({ ok, notes });

  async function loadAll(table: string, cols: string, filter?: (q: Row) => Row): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      let q = admin.from(table).select(cols).range(from, from + 999);
      if (filter) q = filter(q);
      const { data, error } = await q;
      if (error) throw new Error(table + ": " + error.message);
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function loadVariants() {
    const vs = await loadAll("shopify_variants", "variant_id,product_id,inventory_item_id,product_title,variant_title,sku,barcode,vendor,product_type,status,price,tracked,on_hand,tags",
      (q) => q.neq("status", "ARCHIVED").order("variant_id"));
    const cs = await loadAll("shopify_costs", "inventory_item_id,cost", (q) => q.order("inventory_item_id"));
    const cost = new Map(cs.map((c) => [c.inventory_item_id, c.cost]));
    for (const v of vs) v.cost = cost.get(v.inventory_item_id) ?? null;
    return vs;
  }

  // Books with no usable barcode or ISBN SKU, not looked up in the last 30 days; most stock first.
  async function lookups(variants: Row[], ids: number[], max: number, t0: number) {
    const done = new Map((await loadAll("product_lookups", "variant_id,tried_at", (q) => q.order("variant_id"))).map((l) => [l.variant_id, l.tried_at]));
    const month = Date.now() - 30 * 864e5;
    const isBook = (v: Row) => /book|novel|manga|comic|graphic|fiction|poetry|cookbook/i.test((v.product_type || "") + " " + (v.tags || "")) || / by [A-Z]/.test(v.product_title || "");
    const needs = (v: Row) => { const b = FixRules.readCode(v.barcode), s = FixRules.readCode(v.sku);
      return !(b && b.valid) && !(s && s.valid) && !FixRules.codeInText(v.product_title) && !String(v.barcode || "").trim(); };
    const list = ids.length ? variants.filter((v) => ids.includes(Number(v.variant_id)))
      : variants.filter((v) => /^active$/i.test(v.status) && isBook(v) && needs(v) && !(done.has(v.variant_id) && new Date(done.get(v.variant_id)).getTime() > month))
          .sort((a, b) => (b.on_hand ?? 0) - (a.on_hand ?? 0)).slice(0, max);
    let tried = 0, hits = 0;
    for (const v of list) {
      if (Date.now() - t0 > 45000) break;
      const { title, author } = splitTitle(v.product_title);
      let found: Row[] = [];
      let note = "";
      try {
        found = await googleBooks(title, author);
        if (!found.length) found = await openLibrary(title, author);
      } catch (e) { note = (e as Error).message.slice(0, 200); }
      await admin.from("product_lookups").upsert({ variant_id: v.variant_id, tried_at: new Date().toISOString(), query: [title, author].filter(Boolean).join(" / "), found, note: note || null });
      tried++; if (found.length) hits++;
    }
    return { tried, hits };
  }
  function splitTitle(t: string) {
    let s = String(t || "").replace(/\s*[\(\[][^\)\]]*(edition|paperback|hardcover|signed|used|copy)[^\)\]]*[\)\]]/gi, "").trim();
    let author = "";
    const m = s.match(/^(.*\S)\s+(?:by|-|–|—)\s+([A-Z][^:]{2,60})$/);
    if (m && / by /i.test(s)) { s = m[1]; author = m[2]; }
    return { title: s.replace(/\s+/g, " ").slice(0, 120), author: author.trim() };
  }
  function words(s: string): string[] { return FixRules.norm(s).split(" ").filter((w: string) => w.length > 2 && !["the", "and", "for", "with"].includes(w)); }
  function titleMatch(want: string, got: string) {
    const a = words(want), b = new Set(words(got));
    if (!a.length) return false;
    return a.filter((w: string) => b.has(w)).length / a.length >= 0.75;
  }
  function authorMatch(want: string, got: string[] | undefined) {
    if (!want) return true;
    const last = words(want).pop();
    return !last || (got ?? []).some((a) => FixRules.norm(a).includes(last));
  }
  async function getJson(u: string) {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ac.signal });
      if (r.status === 429) throw new Error("Lookup service busy, try later");
      if (!r.ok) return null;
      return await r.json();
    } finally { clearTimeout(tm); }
  }
  async function googleBooks(title: string, author: string): Promise<Row[]> {
    const q = `intitle:"${title.replace(/"/g, "")}"` + (author ? `+inauthor:"${author.replace(/"/g, "")}"` : "");
    const k = Deno.env.get("GOOGLE_BOOKS_KEY");
    const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books` + (k ? `&key=${k}` : ""));
    const out: Row[] = [], seen = new Set<string>();
    for (const it of j?.items ?? []) {
      const vi = it.volumeInfo ?? {};
      if (!titleMatch(title, (vi.title ?? "") + " " + (vi.subtitle ?? "")) || !authorMatch(author, vi.authors)) continue;
      const id = (vi.industryIdentifiers ?? []).find((x: Row) => x.type === "ISBN_13");
      const c = id && FixRules.readCode(id.identifier);
      if (!c || !c.valid || seen.has(c.code)) continue;
      seen.add(c.code);
      out.push({ isbn: c.code, title: [vi.title, vi.subtitle].filter(Boolean).join(": "), authors: (vi.authors ?? []).join(", "), publisher: vi.publisher ?? "",
        year: String(vi.publishedDate ?? "").slice(0, 4), pages: vi.pageCount ?? null, source: "Google Books", link: vi.infoLink ?? "" });
    }
    return out.slice(0, 6);
  }
  async function openLibrary(title: string, author: string): Promise<Row[]> {
    const j = await getJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}${author ? "&author=" + encodeURIComponent(author) : ""}&limit=5&fields=key,title,author_name,isbn,publisher,first_publish_year`);
    const out: Row[] = [], seen = new Set<string>();
    for (const d of j?.docs ?? []) {
      if (!titleMatch(title, d.title ?? "") || !authorMatch(author, d.author_name)) continue;
      for (const i of d.isbn ?? []) {
        const c = FixRules.readCode(i);
        if (!c || !c.valid || !/^97[89]/.test(c.code) || seen.has(c.code)) continue;
        seen.add(c.code);
        out.push({ isbn: c.code, title: d.title, authors: (d.author_name ?? []).join(", "), publisher: (d.publisher ?? [])[0] ?? "", year: String(d.first_publish_year ?? ""),
          source: "Open Library", link: "https://openlibrary.org/isbn/" + c.code });
        if (out.length >= 6) break;
      }
      if (out.length >= 6) break;
    }
    return out;
  }

  // Saves the scan: add new findings, refresh open ones, remove open ones that no longer apply.
  async function store(props: Row[]) {
    const existing = await loadAll("product_fixes", "id,variant_id,rule,new_value,status,decided_at", (q) => q.order("id"));
    const keyOf = (x: Row) => x.variant_id + "|" + x.rule + "|" + (x.new_value ?? "");
    const have = new Map(existing.map((x) => [keyOf(x), x]));
    const now = new Date().toISOString();
    const fresh = new Set<string>(), inserts: Row[] = [], updates: Row[] = [], reopens: Row[] = [];
    for (const p of props) {
      const k = keyOf(p); if (fresh.has(k)) continue; fresh.add(k);
      const row = { variant_id: p.variant_id, product_id: p.product_id, title: String(p.title ?? "").slice(0, 300), kind: p.kind, rule: p.rule, old_value: p.old_value,
        new_value: p.new_value, confidence: p.confidence, reason: p.reason, evidence: p.evidence ?? {}, seen_at: now };
      const e = have.get(k);
      if (!e) inserts.push({ ...row, status: "open", found_at: now });
      else if (e.status === "open") updates.push({ id: e.id, ...row });
      // Fixed before, but Shopify has the old value again (something put it back, e.g. a re-import): open it again.
      else if (e.status === "applied" && e.decided_at && Date.now() - new Date(e.decided_at).getTime() > 3 * 3600e3)
        reopens.push({ id: e.id, ...row, status: "open", reason: "Came back after it was fixed. " + (row.reason ?? ""), change_id: null, found_at: now });
      // dismissed / approved: leave as decided. failed: stays failed until retried or dismissed.
    }
    const gone = existing.filter((x) => x.status === "open" && !fresh.has(keyOf(x))).map((x) => x.id);
    for (let i = 0; i < inserts.length; i += 500) { const { error } = await admin.from("product_fixes").insert(inserts.slice(i, i + 500)); if (error) throw new Error("save: " + error.message); }
    for (let i = 0; i < updates.length; i += 500) { const { error } = await admin.from("product_fixes").upsert(updates.slice(i, i + 500)); if (error) throw new Error("update: " + error.message); }
    for (let i = 0; i < reopens.length; i += 500) { const { error } = await admin.from("product_fixes").upsert(reopens.slice(i, i + 500)); if (error) throw new Error("reopen: " + error.message); }
    for (let i = 0; i < gone.length; i += 500) await admin.from("product_fixes").delete().in("id", gone.slice(i, i + 500));
    const stillOpen = [...inserts, ...updates, ...reopens];
    const open = stillOpen.filter((p) => p.kind !== "check").length, checks = stillOpen.length - open;
    return { added: inserts.length, open, checks };
  }

  // Rules the owner switched to automatic: queue their open fixes (never low-confidence estimates or edition picks).
  async function automatic() {
    const { data: on } = await admin.from("product_fix_rules").select("rule").eq("auto", true);
    const rules = (on ?? []).map((r) => r.rule).filter((r) => !r.startsWith("check"));
    if (!rules.length) return { queued: 0, failed: 0 };
    const { data: fixes } = await admin.from("product_fixes").select("*").eq("status", "open").in("rule", rules).in("confidence", ["high", "medium"])
      .not("new_value", "is", null).neq("kind", "check").order("id").limit(200);
    let queued = 0;
    for (const f of fixes ?? []) {
      const { data: c, error } = await admin.from("shopify_changes").insert({ kind: f.kind, variant_id: f.variant_id, old_value: f.old_value, new_value: f.new_value,
        note: String(f.title ?? "").slice(0, 200) + " · " + f.rule, fix_id: f.id, auto_rule: f.rule, created_by: "automatic rule" }).select("id").single();
      if (error) continue;
      await admin.from("product_fixes").update({ status: "approved", change_id: c.id, decided_by: "automatic rule", decided_at: new Date().toISOString() }).eq("id", f.id);
      queued++;
    }
    if (!queued) return { queued: 0, failed: 0 };
    const r = await fetch(url + "/functions/v1/shopify-sync", { method: "POST", headers: { "Content-Type": "application/json", "x-sync-key": conn!.cron_key },
      body: JSON.stringify({ action: "apply-auto" }) });
    const j = await r.json().catch(() => ({}));
    return { queued: j.applied ?? 0, failed: j.failed ?? 0 };
  }
});
