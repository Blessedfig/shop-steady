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

  // ---------- storage ----------
  // The Shopify catalog can be tens of thousands of rows (megabytes), too big for the app's main saved state,
  // so it lives in this browser's IndexedDB. Scans are small and stay in the main state as raw codes.
  // Phones that only scan don't need the catalog at all: their scans are merged on the device that has it.
  const IDB = {
    db: null,
    open(){ return this.db || (this.db = new Promise((ok, no) => { try { const r = indexedDB.open('shop-steady-count', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch(e){ no(e); } })); },
    async get(k){ const db = await this.open(); return new Promise((ok, no) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); },
    async set(k, v){ const db = await this.open(); return new Promise((ok, no) => { const t = db.transaction('kv','readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => no(t.error); }); }
  };
  let CAT = null; // {items:{key:{handle,sku,t,vendor,onhand}}, codes:{code:key}, inv:{hdr,rows}|null, location}
  const emptyCat = () => ({items:{}, codes:{}, inv:null, location:''});
  async function loadCat(){ if (CAT) return CAT; try { CAT = (await IDB.get('catalog')) || emptyCat(); } catch(e){ CAT = emptyCat(); }
    const s = S(); if (s.count && s.count.items){ // move an older, smaller catalog out of the main state
      Object.assign(CAT.items, s.count.items); Object.assign(CAT.codes, s.count.codes || {}); if (s.count.inv) CAT.inv = s.count.inv; if (s.count.location) CAT.location = s.count.location;
      const old = s.count; s.count = {raw:{}, zeroMissing:old.zeroMissing !== false, src:old.src || {}, merged:[]};
      Object.entries(old.counts || {}).forEach(([k,n]) => { const it = CAT.items[k], code = it && (it.codes||[])[0] || it && it.sku; if (code) s.count.raw[norm(code)] = n; });
      Object.entries(old.unknown || {}).forEach(([code,n]) => s.count.raw[code] = (s.count.raw[code]||0) + n);
      A.save(); saveCat(); }
    return CAT; }
  const saveCat = () => IDB.set('catalog', CAT).catch(() => toast('This browser could not save the Shopify files. They work until you close the page.'));

  function C(){ const s = S(); s.count = s.count || {raw:{}, zeroMissing:true, src:{}, merged:[]}; const c = s.count; c.raw = c.raw || {}; c.merged = c.merged || []; c.src = c.src || {}; return c; }
  // counts per Shopify product, from raw scanned codes
  function resolve(){ const c = C(), counts = {}, unknown = {};
    Object.entries(c.raw).forEach(([code, n]) => { const k = CAT && CAT.codes[code]; if (k) counts[k] = (counts[k]||0) + n; else unknown[code] = n; });
    return {counts, unknown}; }

  // Products export: one row per variant. Columns: Handle (or URL handle), Title, Vendor, Variant SKU (or SKU), Variant Barcodes (or Barcodes).
  // Big stores get the export split into several files; load them all.
  function loadProducts(text){
    const {hdr, rows} = parseCsv(text);
    const iH = col(hdr,'URL handle','Handle'), iT = col(hdr,'Title'), iV = col(hdr,'Vendor'), iS = col(hdr,'Variant SKU','SKU'), iB = col(hdr,'Variant Barcodes','Barcodes','Variant Barcode','Barcode');
    if (iH < 0) return 'That does not look like a Shopify products export (no handle column).';
    let n = 0; const lastTitle = {}, lastVendor = {};
    rows.forEach(r => {
      const handle = r[iH]; if (!handle) return;
      if (iT >= 0 && r[iT]) lastTitle[handle] = r[iT];
      if (iV >= 0 && r[iV]) lastVendor[handle] = r[iV];
      const sku = iS >= 0 ? String(r[iS]).trim().replace(/^'/, '') : '', codes = [sku].concat(iB >= 0 ? String(r[iB]||'').split(/[;,]/) : []).map(norm).filter(Boolean);
      if (!codes.length && !(iT >= 0 && r[iT])) return; // image-only rows
      const k = keyOf(handle, sku), it = CAT.items[k] = CAT.items[k] || {handle, sku};
      it.t = lastTitle[handle] || it.t || handle; it.vendor = lastVendor[handle] || it.vendor || '';
      codes.forEach(code => CAT.codes[code] = k); n++;
    });
    return n ? null : 'No products found in that file.';
  }
  // Inventory export, "All states" format: Handle, Title, Option..., SKU, ..., Location, ..., On hand (current), On hand (new).
  function loadInventory(text){
    const {hdr, rows} = parseCsv(text);
    const iH = col(hdr,'Handle'), iS = col(hdr,'SKU'), iL = col(hdr,'Location'), iOn = col(hdr,'On hand (current)'), iNew = col(hdr,'On hand (new)'), iT = col(hdr,'Title');
    if (iH < 0 || iL < 0 || iOn < 0 || iNew < 0) return 'Use Shopify\'s inventory export in the "All states" format (it has On hand (current) and On hand (new) columns).';
    CAT.inv = {hdr, rows};
    const locs = [...new Set(rows.map(r => r[iL]).filter(Boolean))];
    if (!locs.includes(CAT.location)) CAT.location = locs[0] || '';
    rows.forEach(r => { const sku = iS >= 0 ? r[iS] : '', k = keyOf(r[iH], sku);
      CAT.items[k] = CAT.items[k] || {handle:r[iH], sku, t:r[iT] || r[iH], vendor:''};
      if (sku) CAT.codes[norm(sku)] = CAT.codes[norm(sku)] || k; });
    setOnhand(); return null;
  }
  function setOnhand(){ // current Shopify counts for the chosen location
    if (!CAT.inv) return; const {hdr, rows} = CAT.inv, iH = col(hdr,'Handle'), iS = col(hdr,'SKU'), iL = col(hdr,'Location'), iOn = col(hdr,'On hand (current)');
    Object.values(CAT.items).forEach(it => delete it.onhand);
    rows.forEach(r => { if (r[iL] !== CAT.location) return; const it = CAT.items[keyOf(r[iH], iS >= 0 ? r[iS] : '')]; if (it) it.onhand = parseInt(r[iOn], 10) || 0; });
  }

  // ---------- scanning ----------
  let ctx; // short beep and buzz so counters can keep their eyes on the shelf
  function feedback(ok){ try { navigator.vibrate && navigator.vibrate(ok ? 30 : [60,40,60]); } catch(e){}
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.06 : 0.25)); } catch(e){} }
  function scan(raw){
    const code = norm(raw); if (!code) return;
    const c = C(); c.raw[code] = (c.raw[code] || 0) + 1; c.last = {code, at:Date.now()}; c.n = (c.n||0) + 1;
    A.save(); const known = !CAT || !Object.keys(CAT.codes).length ? null : !!CAT.codes[code];
    feedback(known !== false); return known;
  }

  // ---------- several phones at once ----------
  // Each phone scans its own section, then taps "Send my scans" (a small CSV). The device with the Shopify files
  // adds every phone's file. Each file carries an id, so adding the same file twice is caught.
  function myScansCsv(){ const c = C(); c.dev = c.dev || Math.random().toString(36).slice(2,8);
    const id = c.dev+'-'+Date.now(), who = A.tier().name + (c.area ? ' · '+c.area : '');
    return '# shop-steady-scans,'+id+','+who.replace(/[,\n]/g,' ')+'\r\nBarcode,Copies\r\n'+Object.entries(c.raw).map(([k,n]) => k+','+n).join('\r\n')+'\r\n'; }
  function addScans(text, name){
    const lines = text.replace(/^﻿/,'').split(/\r?\n/), c = C();
    const m = /^# shop-steady-scans,([^,]+),?(.*)$/.exec(lines[0] || '');
    if (!m) return 'That isn\'t a scans file from this app.';
    if (c.merged.some(x => x.id === m[1])) return 'Those scans were already added.';
    let n = 0; lines.slice(2).forEach(l => { const [code, k] = l.split(','); const v = parseInt(k, 10); if (code && v > 0){ c.raw[code] = (c.raw[code]||0) + v; n += v; } });
    c.merged.push({id:m[1], who:m[2] || name, n, at:new Date().toISOString()}); A.save(); return null;
  }

  function exportInventory(){
    if (!CAT || !CAT.inv) return toast('Load the Shopify inventory export first');
    const {counts} = resolve(), c = C();
    const {hdr, rows} = CAT.inv, iH = col(hdr,'Handle'), iS = col(hdr,'SKU'), iL = col(hdr,'Location'), iNew = col(hdr,'On hand (new)');
    const out = rows.map(r => { r = r.slice(); while (r.length < hdr.length) r.push('');
      if (r[iL] === CAT.location){ const n = counts[keyOf(r[iH], iS >= 0 ? r[iS] : '')];
        r[iNew] = n != null ? String(n) : (c.zeroMissing ? '0' : ''); } else r[iNew] = '';
      return r; });
    // Shopify reads this file as-is, so cells are written plainly (no spreadsheet-formula guard on numbers or handles).
    const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    download('shopify-inventory-counted-'+isoDay(new Date())+'.csv', 'text/csv', [hdr, ...out].map(r => r.map(esc).join(',')).join('\r\n')+'\r\n');
  }

  // Camera scanning. Chrome on Android has a built-in barcode reader. iPhones and others load the open-source
  // reader in vendor/ (barcode-detector 3.2.5 + zxing-wasm 3.1.8, served from this site, about 1 MB, only when needed).
  let poly = null;
  function loadPoly(){ return poly || (poly = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'vendor/barcode-detector.js';
    sc.onload = () => { const m = window.BarcodeDetectionAPI; if (!m) return no(new Error('reader missing'));
      m.setZXingModuleOverrides({locateFile:(path, prefix) => /\.wasm$/.test(path) ? new URL('vendor/zxing_reader.wasm', location.href).href : prefix + path}); ok(m); };
    sc.onerror = () => { poly = null; no(new Error('reader did not load')); }; document.head.append(sc); })); }
  async function detector(){
    const F = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39'];
    if ('BarcodeDetector' in window){ try { const ok = await window.BarcodeDetector.getSupportedFormats(); if (ok.includes('ean_13')) return new window.BarcodeDetector({formats:F}); } catch(e){} }
    try { const m = await loadPoly(); return new m.BarcodeDetector({formats:F}); } catch(e){ return null; }
  }
  async function cameraScan(onCode, box){
    box.textContent = 'Starting the camera…';
    const det = await detector();
    if (!det){ box.textContent = ''; return toast('The camera scanner could not load. Use a barcode scanner or type the code.'); }
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment', width:{ideal:1280}}}); } catch(e){ box.textContent = ''; return toast('Camera permission was not given'); }
    const vid = h('video',{playsinline:true,muted:true,class:'camview'}); vid.setAttribute('playsinline',''); vid.srcObject = stream; await vid.play();
    const stop = h('button',{class:'btn ghost sm',type:'button'},'Stop camera'); box.textContent = ''; box.append(vid, h('p',{class:'small muted'},'Hold each barcode in the middle. It beeps once per copy; wait for the beep before the next copy of the same book.'), stop);
    let on = true, lastCode = '', lastAt = 0;
    stop.onclick = () => { on = false; stream.getTracks().forEach(t => t.stop()); box.textContent = ''; };
    (async function loop(){ while (on && document.body.contains(vid)){ try { const found = await det.detect(vid);
      if (found[0]){ const v = found[0].rawValue; if (v !== lastCode || Date.now() - lastAt > 2000){ lastCode = v; lastAt = Date.now(); onCode(v); } } } catch(e){} await new Promise(r => setTimeout(r, 150)); }
      stream.getTracks().forEach(t => t.stop()); })();
  }

  const SOURCES = ['Publisher (direct)','Faire','Amazon','Distributor','Local maker or consignor','Used buyback','Other'];

  function count(v){
    v.append(head('Stock · '+A.site().name, 'Count and sync with Shopify', 'Scan what you actually have, on as many phones as you like, then send Shopify the real numbers. Anything you don\'t find can be set to 0.'));
    const wait = h('p',{class:'muted'},'Loading…'); v.append(wait);
    loadCat().then(() => { wait.remove(); render(v); });
  }
  function render(v){
    const c = C(), isMgr = MGR.includes(S().tier), nItems = Object.keys(CAT.items).length;
    // step 1: files
    const pf = h('input',{type:'file',multiple:true,accept:'.csv,text/csv','aria-label':'Shopify products export'}), inf = h('input',{type:'file',accept:'.csv,text/csv','aria-label':'Shopify inventory export'});
    const read = (inp, fn) => inp.addEventListener('change', async () => { const fs = [...inp.files]; if (!fs.length) return; toast('Reading… big files take a few seconds');
      let err = null; for (const f of fs){ err = fn(await f.text()) || err; } await saveCat(); toast(err || 'Loaded '+fs.map(f => f.name).join(', ')); A.route(); });
    read(pf, loadProducts); read(inf, loadInventory);
    if (isMgr) v.append(h('details',{class:'card',open:!nItems || !CAT.inv}, h('summary',null, h('b',null,'1. Load your Shopify files'), nItems ? ' · '+nItems.toLocaleString()+' products'+(CAT.inv ? ', counts for '+CAT.location : '') : ''),
      h('p',{class:'small muted'},'Only the device that makes the final Shopify file needs these. Phones that only scan can skip this step.'),
      h('ol',{class:'small'}, h('li',null,'Shopify admin > Products > Export > All products, CSV for Excel or Numbers. Big stores get several files: load them all.'),
        h('li',null,'Shopify admin > Products > Inventory > Export > All states.')),
      h('label',{class:'f'},'Products export files (barcodes and vendors)', pf),
      h('label',{class:'f'},'Inventory export (current counts)', inf),
      CAT.inv ? h('label',{class:'f'},'Location being counted', h('select',{onchange:async e=>{ CAT.location = e.target.value; setOnhand(); await saveCat(); A.route(); }},
        [...new Set(CAT.inv.rows.map(r => r[col(CAT.inv.hdr,'Location')]).filter(Boolean))].map(l => h('option',{value:l,selected:l===CAT.location},l)))) : null));
    // step 2: scan
    const inp = h('input',{type:'text',inputmode:'numeric',autocomplete:'off',enterkeyhint:'done',placeholder:'Scan or type a barcode, ISBN or SKU, then Enter','aria-label':'Barcode'});
    const camBox = h('div');
    const title = code => { const k = CAT.codes[code], it = k && CAT.items[k]; return it ? it.t : null; };
    const lastLine = () => { const l = c.last; if (!l) return 'Ready to scan.'; const t = title(l.code);
      if (t) return '✓ '+t+' · '+c.raw[l.code]+' scanned'; return nItems ? '⚠ '+l.code+' is not in Shopify. Set it aside to add later.' : '✓ '+l.code+' · '+c.raw[l.code]+' scanned'; };
    const status = h('p',{class:'msg big','aria-live':'polite'}, lastLine());
    const summaryText = () => { const n = Object.values(c.raw).reduce((a,b) => a+b, 0); return n.toLocaleString()+' copies scanned · '+Object.keys(c.raw).length.toLocaleString()+' different codes'+(c.merged.length ? ' · includes '+c.merged.length+' other device'+(c.merged.length>1?'s':'') : ''); };
    const totals = h('p',{class:'small muted'}, summaryText());
    const doScan = raw => { const known = scan(raw); status.textContent = lastLine(); status.className = 'msg big'+(known === false ? ' err' : ''); totals.textContent = summaryText(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); doScan(inp.value); inp.value = ''; } });
    const area = h('input',{type:'text',maxlength:'40',value:c.area||'',placeholder:'e.g. Manga wall, back room shelf 3','aria-label':'Section you are scanning',onchange:e=>{ c.area = e.target.value.trim(); A.save(); }});
    v.append(h('div',{class:'card'}, h('h2',null,'2. Scan'),
      h('p',{class:'small muted'},'Fastest: a Bluetooth or USB barcode scanner (about $30 to $60) types into this box by itself. Scan every copy once. The count saves as you go.'),
      h('label',{class:'f'},'Section you are scanning (optional)', area),
      inp, status, totals,
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>cameraScan(doScan, camBox)},'Scan with camera'),
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ const l = c.last; if (!l || !c.raw[l.code]) return toast('Nothing to undo'); c.raw[l.code]--; if (c.raw[l.code] <= 0) delete c.raw[l.code]; c.last = null; A.save(); A.route(); }},'Undo last scan')),
      camBox));
    setTimeout(() => inp.focus(), 50);
    // step 2b: more phones
    const sf = h('input',{type:'file',multiple:true,accept:'.csv,text/csv','aria-label':'Scans from other devices'});
    sf.addEventListener('change', async () => { const msgs = []; for (const f of sf.files){ const e = addScans(await f.text(), f.name); msgs.push(e ? f.name+': '+e : 'Added '+f.name); } toast(msgs.join(' · ')); A.route(); });
    const sendScans = async () => { const text = myScansCsv(), name = 'scans-'+(c.area||A.tier().name).replace(/[^\w-]+/g,'-').toLowerCase()+'-'+isoDay(new Date())+'.csv';
      try { const file = new File([text], name, {type:'text/csv'}); if (navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:'Stock count scans'}); return; } } catch(e){ if (e.name === 'AbortError') return; }
      download(name, 'text/csv', text); };
    v.append(h('div',{class:'card'}, h('h2',null,'Counting with several phones'),
      h('ol',{class:'small'}, h('li',null,'Each person opens this page on their phone, types their section, and scans. No Shopify files needed on the phones.'),
        h('li',null,'When a section is done, they tap Send my scans and text, email or AirDrop the file to the person running the count.'),
        h('li',null,'On the main device, add each file below. The same file can\'t be added twice.')),
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:sendScans},'Send my scans')),
      isMgr ? h('label',{class:'f'},'Add scans from other phones', sf) : null,
      c.merged.length ? h('ul',{class:'small'}, c.merged.map(x => h('li',null, x.who+' · '+x.n.toLocaleString()+' copies · '+A.fmtTime(x.at)))) : null));
    // step 3: review and export
    const {counts, unknown} = resolve(), counted = Object.keys(counts).length;
    const items = Object.entries(CAT.items);
    const diffs = items.filter(([k,it]) => it.onhand != null && (counts[k]||0) !== it.onhand);
    const missing = items.filter(([k,it]) => (it.onhand||0) > 0 && !counts[k]);
    const tb = h('tbody');
    diffs.slice(0,200).forEach(([k,it]) => tb.append(h('tr',null, h('td',null,it.t, h('div',{class:'small muted'},it.sku||'')), h('td',null,String(it.onhand)), h('td',null,String(counts[k]||0)),
      h('td',null, (counts[k]||0) > it.onhand ? h('span',{class:'chip calm'},'+'+((counts[k]||0)-it.onhand)) : h('span',{class:'chip amber'},String((counts[k]||0)-it.onhand))))));
    if (isMgr) v.append(h('div',{class:'card'}, h('h2',null,'3. Check the differences and update Shopify'),
      CAT.inv ? h('p',null, diffs.length.toLocaleString()+' products differ from Shopify. '+missing.length.toLocaleString()+' that Shopify says you have were not scanned.'+(diffs.length > 200 ? ' Showing the first 200.' : '')) : h('p',{class:'muted'},'Load the inventory export to compare.'),
      diffs.length ? h('div',{class:'tablewrap',tabindex:'0',role:'region','aria-label':'Differences'}, h('table',{class:'t'}, h('thead',null,h('tr',null,h('th',null,'Product'),h('th',null,'Shopify'),h('th',null,'Counted'),h('th',null,'Change'))), tb)) : null,
      h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:c.zeroMissing,onchange:e=>{ c.zeroMissing = e.target.checked; A.save(); }}), 'Set anything nobody scanned to 0 at this location'),
      h('div',{class:'row'},
        h('button',{class:'btn',type:'button',disabled:!CAT.inv || !counted,onclick:exportInventory},'Download file for Shopify'),
        Object.keys(unknown).length ? h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('not-in-shopify-'+isoDay(new Date())+'.csv','text/csv',toCsv([['Barcode or code','Copies found'], ...Object.entries(unknown)])) },'Download '+Object.keys(unknown).length+' unknown codes') : null),
      h('p',{class:'small muted'},'Then in Shopify: Products > Inventory > Import, choose this file, review, and confirm. Only the location above changes. Add every phone\'s scans first, and avoid selling during the count, or recount what sold.'),
      h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ if (!confirm('Clear all scans on this device, including added phones?')) return; c.raw = {}; c.merged = []; c.last = null; c.n = 0; A.save(); toast('Count cleared'); A.route(); }},'Start a new count (clears scans)')));
    // step 4: where each product comes from
    const vendors = [...new Set(items.map(([,it]) => it.vendor).filter(Boolean))].sort();
    if (vendors.length && isMgr){
      const per = {}; items.forEach(([,it]) => { if (it.vendor) per[it.vendor] = (per[it.vendor]||0) + 1; });
      v.append(h('details',{class:'card'}, h('summary',null, h('b',null,'4. Where you buy from')),
        h('p',{class:'small muted'},'Tell the app how you order from each Shopify vendor. Reorder lists group by this.'),
        vendors.slice(0,80).map(ven => h('label',{class:'f'}, ven+' ('+per[ven]+' products)',
          h('select',{onchange:e=>{ c.src[ven] = e.target.value; A.save(); }}, h('option',{value:''},'How do you order this?'), SOURCES.map(s => h('option',{value:s,selected:c.src[ven]===s},s)))))));
    }
  }

  A.register({id:'count', name:'Stock count and Shopify sync', what:'Scan everything you have, compare with Shopify, set the real counts (missing items to 0) with a Shopify import file, and record where you buy each vendor\'s products.', tiers:['staff','lead','manager','owner'],
    views:{count:{t:'Stock count', ic:'🔎', render:count}}});
  window.SSCount = {parseCsv, loadProducts, loadInventory, scan, norm};
})();
