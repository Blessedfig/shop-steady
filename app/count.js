// Stock count: scan everything you actually have, compare it with Shopify, and make a file Shopify imports
// to set the real counts (items you didn't find go to 0). Works with no Shopify connection at all:
//   1. In Shopify admin, export Products (for barcodes and vendors) and Inventory ("All states" format).
//   2. Load both files here, then scan with a barcode scanner, the phone camera, or by typing.
//   3. Download the corrected inventory file and import it in Shopify (Products > Inventory > Import).
// Shopify's inventory import sets "On hand (new)"; rows left blank stay as they are.
// Each item also gets a supplier and origin here (Faire, Amazon, a publisher...) for reorders.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, download, toCsv, isoDay} = A;
  const S = () => A.state();
  const MGR = ['lead','manager','owner'];

  // ---------- CSV reading (handles quotes, commas and line breaks inside quotes) ----------
  function parseCsv(text){
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++){
      const c = text[i];
      if (q){ if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ','){ row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r'){ if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length){ row.push(cell); rows.push(row); }
    const hdr = (rows.shift() || []).map(x => x.trim());
    return {hdr, rows:rows.filter(r => r.some(x => x.trim() !== ''))};
  }
  const col = (hdr, ...names) => { for (const n of names){ const i = hdr.findIndex(x => x.toLowerCase() === n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const norm = s => String(s||'').trim().replace(/^'/, '').replace(/^(gtin|upc|ean|isbn):/i, '').replace(/[\s-]/g, '').toUpperCase();
  const keyOf = (handle, sku) => handle + '|' + (sku || '');

  function C(){ const s = S(); s.count = s.count || {items:{}, codes:{}, counts:{}, unknown:{}, inv:null, location:'', zeroMissing:true, src:{}}; return s.count; }

  // Products export: one row per variant. Columns: URL handle (or Handle), Title, Vendor, SKU (or Variant SKU), Barcodes (or Variant Barcode).
  function loadProducts(text){
    const {hdr, rows} = parseCsv(text), c = C();
    const iH = col(hdr,'URL handle','Handle'), iT = col(hdr,'Title'), iV = col(hdr,'Vendor'), iS = col(hdr,'SKU','Variant SKU'), iB = col(hdr,'Barcodes','Variant Barcode','Barcode');
    if (iH < 0) return 'That does not look like a Shopify products export (no handle column).';
    let n = 0, lastTitle = {}, lastVendor = {};
    rows.forEach(r => {
      const handle = r[iH]; if (!handle) return;
      if (iT >= 0 && r[iT]) lastTitle[handle] = r[iT];
      if (iV >= 0 && r[iV]) lastVendor[handle] = r[iV];
      const sku = iS >= 0 ? r[iS] : '', k = keyOf(handle, sku);
      const it = c.items[k] = Object.assign(c.items[k] || {}, {handle, sku, t:lastTitle[handle] || handle, vendor:lastVendor[handle] || ''});
      const codes = [sku].concat(iB >= 0 ? String(r[iB]||'').split(';') : []).map(norm).filter(Boolean);
      codes.forEach(code => c.codes[code] = k); it.codes = codes; n++;
    });
    A.save(); return n ? null : 'No products found in that file.';
  }
  // Inventory export, "All states" format: Handle, Title, Option..., SKU, ..., Location, ..., On hand (current), On hand (new).
  function loadInventory(text){
    const {hdr, rows} = parseCsv(text), c = C();
    const iH = col(hdr,'Handle'), iS = col(hdr,'SKU'), iL = col(hdr,'Location'), iOn = col(hdr,'On hand (current)'), iNew = col(hdr,'On hand (new)'), iT = col(hdr,'Title');
    if (iH < 0 || iL < 0 || iOn < 0 || iNew < 0) return 'Use Shopify\'s inventory export in the "All states" format (it has On hand (current) and On hand (new) columns).';
    c.inv = {hdr, rows};
    const locs = [...new Set(rows.map(r => r[iL]).filter(Boolean))];
    if (!locs.includes(c.location)) c.location = locs[0] || '';
    rows.forEach(r => { const k = keyOf(r[iH], iS >= 0 ? r[iS] : ''); c.items[k] = Object.assign(c.items[k] || {handle:r[iH], sku:iS >= 0 ? r[iS] : '', t:r[iT] || r[iH], codes:[]}, {});
      if (r[iL] === c.location) c.items[k].onhand = parseInt(r[iOn], 10) || 0;
      if (iS >= 0 && r[iS]) c.codes[norm(r[iS])] = c.codes[norm(r[iS])] || k; });
    A.save(); return null;
  }

  function setOnhand(){ // current Shopify counts for the chosen location
    const c = C(); if (!c.inv) return; const {hdr, rows} = c.inv, iH = col(hdr,'Handle'), iS = col(hdr,'SKU'), iL = col(hdr,'Location'), iOn = col(hdr,'On hand (current)');
    Object.values(c.items).forEach(it => delete it.onhand);
    rows.forEach(r => { if (r[iL] !== c.location) return; const it = c.items[keyOf(r[iH], iS >= 0 ? r[iS] : '')]; if (it) it.onhand = parseInt(r[iOn], 10) || 0; });
  }
  function scan(raw){
    const code = norm(raw); if (!code) return;
    const c = C(), k = c.codes[code];
    if (k){ c.counts[k] = (c.counts[k] || 0) + 1; c.last = {k, at:Date.now()}; }
    else { c.unknown[code] = (c.unknown[code] || 0) + 1; c.last = {code, at:Date.now()}; }
    A.save(); return k;
  }

  function exportInventory(){
    const c = C(); if (!c.inv) return toast('Load the Shopify inventory export first');
    const {hdr, rows} = c.inv, iH = col(hdr,'Handle'), iS = col(hdr,'SKU'), iL = col(hdr,'Location'), iNew = col(hdr,'On hand (new)');
    const out = rows.map(r => { r = r.slice(); while (r.length < hdr.length) r.push('');
      if (r[iL] === c.location){ const k = keyOf(r[iH], iS >= 0 ? r[iS] : ''), n = c.counts[k];
        r[iNew] = n != null ? String(n) : (c.zeroMissing ? '0' : ''); } else r[iNew] = '';
      return r; });
    // Shopify reads this file as-is, so cells are written plainly (no spreadsheet-formula guard on numbers or handles).
    const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    download('shopify-inventory-counted-'+isoDay(new Date())+'.csv', 'text/csv', [hdr, ...out].map(r => r.map(esc).join(',')).join('\r\n')+'\r\n');
  }

  // Camera scanning where the browser supports it (Chrome on Android and desktop). Otherwise use a scanner or type.
  async function cameraScan(onCode, box){
    if (!('BarcodeDetector' in window)) return toast('This browser can\'t scan with the camera. Use a barcode scanner or type the code.');
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); } catch(e){ return toast('Camera permission was not given'); }
    const det = new window.BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code']});
    const vid = h('video',{playsinline:true,muted:true,class:'camview'}); vid.srcObject = stream; await vid.play();
    const stop = h('button',{class:'btn ghost sm',type:'button'},'Stop camera'); box.textContent = ''; box.append(vid, stop);
    let on = true, lastCode = '', lastAt = 0;
    stop.onclick = () => { on = false; stream.getTracks().forEach(t => t.stop()); box.textContent = ''; };
    (async function loop(){ while (on){ try { const found = await det.detect(vid);
      if (found[0]){ const v = found[0].rawValue; if (v !== lastCode || Date.now() - lastAt > 2500){ lastCode = v; lastAt = Date.now(); onCode(v); } } } catch(e){} await new Promise(r => setTimeout(r, 250)); } })();
  }

  const SOURCES = ['Publisher (direct)','Faire','Amazon','Distributor','Local maker or consignor','Used buyback','Other'];

  function count(v){
    const c = C();
    v.append(head('Stock · '+A.site().name, 'Count and sync with Shopify', 'Scan what you actually have, then send Shopify the real numbers. Anything you don\'t find can be set to 0.'));
    if (!MGR.includes(S().tier)){ v.append(h('div',{class:'card'},'A shift lead, manager or owner starts a count. You can still help scan once one is started.')); }
    // step 1: files
    const pf = h('input',{type:'file',accept:'.csv,text/csv','aria-label':'Shopify products export'}), inf = h('input',{type:'file',accept:'.csv,text/csv','aria-label':'Shopify inventory export'});
    const read = (inp, fn) => inp.addEventListener('change', async () => { const f = inp.files[0]; if (!f) return; const err = fn(await f.text()); toast(err || 'Loaded '+f.name); A.route(); });
    read(pf, loadProducts); read(inf, loadInventory);
    const nItems = Object.keys(c.items).length;
    v.append(h('div',{class:'card'}, h('h2',null,'1. Load your Shopify files'),
      h('ol',{class:'small'}, h('li',null,'Shopify admin > Products > Export > All products, CSV for Excel or Numbers.'),
        h('li',null,'Shopify admin > Products > Inventory > Export > All states.')),
      h('label',{class:'f'},'Products export (gives barcodes and vendors)', pf),
      h('label',{class:'f'},'Inventory export (gives current counts)', inf),
      h('p',{class:'small muted'}, nItems ? nItems+' products and variants loaded'+(c.inv ? ', inventory loaded for '+(c.location||'?') : ', inventory not loaded yet')+'.' : 'Nothing loaded yet. Your files stay in this browser.'),
      c.inv ? h('label',{class:'f'},'Location being counted', h('select',{onchange:e=>{ c.location = e.target.value; setOnhand(); A.save(); A.route(); }},
        [...new Set(c.inv.rows.map(r => r[col(c.inv.hdr,'Location')]).filter(Boolean))].map(l => h('option',{value:l,selected:l===c.location},l)))) : null));
    // step 2: scan
    const inp = h('input',{type:'text',inputmode:'numeric',autocomplete:'off',placeholder:'Scan or type a barcode, ISBN or SKU, then Enter','aria-label':'Barcode'});
    const camBox = h('div');
    const lastLine = () => { const l = c.last; if (!l) return 'Ready to scan.'; if (l.k){ const it = c.items[l.k]; return '✓ '+(it ? it.t : l.k)+' · counted '+c.counts[l.k]; } return '⚠ '+l.code+' is not in Shopify. Set it aside to add later.'; };
    const status = h('p',{class:'msg','aria-live':'polite'}, lastLine());
    const doScan = raw => { scan(raw); status.textContent = lastLine(); status.className = 'msg'+(c.last && c.last.code ? ' err' : ''); totals.textContent = summaryText(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); doScan(inp.value); inp.value = ''; } });
    const counted = Object.values(c.counts).reduce((a,b) => a+b, 0);
    const summaryText = () => Object.values(c.counts).reduce((a,b) => a+b, 0)+' items scanned · '+Object.keys(c.counts).length+' different products · '+Object.keys(c.unknown).length+' unknown codes';
    const totals = h('p',{class:'small muted'}, summaryText());
    v.append(h('div',{class:'card'}, h('h2',null,'2. Scan everything on the shelves and in back'),
      h('p',{class:'small muted'},'A USB or Bluetooth barcode scanner types into this box by itself. Scan each copy once. You can stop and come back: the count is saved.'),
      inp, status, totals,
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>cameraScan(doScan, camBox)},'Scan with camera'),
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ if (!c.last || !c.last.k) return toast('Nothing to undo'); c.counts[c.last.k]--; if (c.counts[c.last.k] <= 0) delete c.counts[c.last.k]; c.last = null; A.save(); A.route(); }},'Undo last scan')),
      camBox));
    setTimeout(() => inp.focus(), 50);
    // step 3: review and export
    const items = Object.entries(c.items);
    const diffs = items.filter(([k,it]) => it.onhand != null && (c.counts[k]||0) !== it.onhand);
    const missing = items.filter(([k,it]) => (it.onhand||0) > 0 && !c.counts[k]);
    const tb = h('tbody');
    diffs.slice(0,200).forEach(([k,it]) => tb.append(h('tr',null, h('td',null,it.t, h('div',{class:'small muted'},it.sku||'')), h('td',null,String(it.onhand)), h('td',null,String(c.counts[k]||0)),
      h('td',null, (c.counts[k]||0) > it.onhand ? h('span',{class:'chip calm'},'+'+((c.counts[k]||0)-it.onhand)) : h('span',{class:'chip amber'},String((c.counts[k]||0)-it.onhand))))));
    v.append(h('div',{class:'card'}, h('h2',null,'3. Check the differences and update Shopify'),
      c.inv ? h('p',null, diffs.length+' products differ from Shopify. '+missing.length+' that Shopify says you have were not scanned.') : h('p',{class:'muted'},'Load the inventory export to compare.'),
      diffs.length ? h('div',{class:'tablewrap',tabindex:'0',role:'region','aria-label':'Differences'}, h('table',{class:'t'}, h('thead',null,h('tr',null,h('th',null,'Product'),h('th',null,'Shopify'),h('th',null,'Counted'),h('th',null,'Change'))), tb)) : null,
      h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:c.zeroMissing,onchange:e=>{ c.zeroMissing = e.target.checked; A.save(); }}), 'Set anything I didn\'t scan to 0 at this location'),
      h('div',{class:'row'},
        h('button',{class:'btn',type:'button',disabled:!c.inv || !counted,onclick:exportInventory},'Download file for Shopify'),
        Object.keys(c.unknown).length ? h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('not-in-shopify-'+isoDay(new Date())+'.csv','text/csv',toCsv([['Barcode or code','Copies found'], ...Object.entries(c.unknown)])) },'Download unknown codes') : null),
      h('p',{class:'small muted'},'Then in Shopify: Products > Inventory > Import, choose this file, review, and confirm. Only the location above changes. Finish all scanning before importing, and avoid selling during the count, or recount the items you sold.'),
      MGR.includes(S().tier) ? h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ c.counts = {}; c.unknown = {}; c.last = null; A.save(); toast('Count cleared'); A.route(); }},'Start a new count (clears scans)') : null));
    // step 4: where each product comes from
    const vendors = [...new Set(items.map(([,it]) => it.vendor).filter(Boolean))].sort();
    if (vendors.length && MGR.includes(S().tier)){
      v.append(h('div',{class:'card'}, h('h2',null,'4. Where you buy from'),
        h('p',{class:'small muted'},'Tell the app how you order from each Shopify vendor. Reorder lists group by this.'),
        vendors.slice(0,60).map(ven => h('label',{class:'f'}, ven+' ('+items.filter(([,it]) => it.vendor === ven).length+' products)',
          h('select',{onchange:e=>{ c.src[ven] = e.target.value; A.save(); }}, h('option',{value:''},'How do you order this?'), SOURCES.map(s => h('option',{value:s,selected:c.src[ven]===s},s)))))));
    }
  }

  A.register({id:'count', name:'Stock count and Shopify sync', what:'Scan everything you have, compare with Shopify, set the real counts (missing items to 0) with a Shopify import file, and record where you buy each vendor\'s products.', tiers:['staff','lead','manager','owner'],
    views:{count:{t:'Stock count', ic:'🔎', render:count}}});
  window.SSCount = {parseCsv, loadProducts, loadInventory, scan, norm};
})();
