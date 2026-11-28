// Receiving: track what you ordered and check it in when it arrives (Penguin Random House, Faire, Amazon, anyone).
//   1. Start a shipment: who it is from and the order or invoice number.
//   2. Get the lines in, whichever is easiest:
//      - a PDF or Word invoice or packing slip, or a photo of one: the AI reads the lines (Edge Function doc-import),
//      - a CSV order export (Faire, Amazon Business and most portals have one): columns are matched by name,
//      - or just scan the boxes' contents as you unpack.
//   3. Check in: scan or tap what actually arrived. Short, extra and damaged items stand out.
//   4. Finish: cost and vendor are remembered for reordering, the invoice can go to Expenses, and you get a file
//      for Shopify that adds the received copies to your counts (uses the inventory export loaded in Stock count).
// The AI only reads documents; a person checks every line before anything counts.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, download, toCsv, isoDay, uid} = A;
  const S = () => A.state();
  const LEAD = ['lead','manager','owner'], MGR = ['manager','owner'];
  const can = list => list.includes(S().tier);
  const norm = c => A.normCode ? A.normCode(c) : String(c||'').replace(/[\s-]/g,'').toUpperCase();
  function R(){ const s = S(); s.receiving = s.receiving || []; return s.receiving; }
  const here = () => R().filter(x => x.site === S().site);
  const STATUS = {ordered:'Ordered', arrived:'Arrived, not checked in', done:'Checked in'};

  // ---------- reading documents ----------
  let pdfReady = null;
  const loadScript = src => new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => no(new Error('Could not load '+src)); document.head.append(sc); });
  async function pdfText(buf){
    pdfReady = pdfReady || loadScript('vendor/pdf.min.js').then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; });
    await pdfReady; const doc = await window.pdfjsLib.getDocument({data:buf}).promise; let out = '';
    for (let i = 1; i <= doc.numPages; i++){ const pg = await doc.getPage(i), tc = await pg.getTextContent(); out += tc.items.map(t => t.str).join(' ') + '\n'; }
    return out; }
  async function docxText(buf){ if (!window.mammoth) await loadScript('vendor/mammoth.browser.min.js'); return (await window.mammoth.extractRawText({arrayBuffer:buf})).value; }
  const scrub = t => t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,'[email]').replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,'[phone]').replace(/\b(?:\d[ -]?){13,19}\b(?!\d)/g, m => /^(97[89])/.test(m.replace(/\D/g,'')) && m.replace(/\D/g,'').length === 13 ? m : '[number]');
  function shrink(file){ return new Promise(res => { const img = new Image(); img.onload = () => { const sc = Math.min(1, 2000/Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = Math.round(img.width*sc); cv.height = Math.round(img.height*sc); cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); URL.revokeObjectURL(img.src); res(cv.toDataURL('image/jpeg',0.8)); };
    img.onerror = () => res(null); img.src = URL.createObjectURL(file); }); }
  async function aiRead(file, vendor){
    if (A.demo || !A.sb) throw new Error('Reading invoices needs you signed in (not the demo). CSV files and scanning work here.');
    let body;
    if (/^image\//.test(file.type)){ const image = await shrink(file); if (!image) throw new Error('That photo could not be opened.'); body = {image, source:vendor}; }
    else { const buf = await file.arrayBuffer(); const text = /pdf$/i.test(file.name) || file.type === 'application/pdf' ? await pdfText(buf) : /docx$/i.test(file.name) ? await docxText(buf) : new TextDecoder().decode(buf);
      if (!text.trim()) throw new Error('No text found in that file. If it is a scan, take a photo of it instead.'); body = {text:scrub(text), source:vendor}; }
    const {data, error} = await A.sb.functions.invoke('doc-import', {body});
    if (error){ let code = ''; try { code = (await error.context.json()).error; } catch(e){} throw new Error(code === 'not-configured' ? 'AI reading is not switched on yet.' : code === 'busy' ? 'The reader is busy. Try again in a minute.' : 'The document could not be read ('+(code||'error')+').'); }
    return {lines:(data.items||[]).map(it => ({id:uid(), code:it.isbn || '', t:it.title || '', a:it.author || '', qty:it.quantity || 0, cost:it.unit_cost, price:it.list_price, got:0, bad:0, quote:it.quote || '', check:it.isbn ? (it.isbn_valid ? '' : 'Check the ISBN') : ''})),
      charges:data.other_charges || [], date:data.document_date || ''};
  }

  // CSV order exports: match columns by common names.
  function parseCsv(text){ const rows = []; let row = [], cell = '', q = false; text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++){ const c = text[i];
      if (q){ if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ','){ row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r'){ if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c; }
    if (cell !== '' || row.length){ row.push(cell); rows.push(row); } return rows.filter(r => r.some(x => x.trim())); }
  function csvLines(text){
    const rows = parseCsv(text); if (rows.length < 2) return null;
    const hdr = rows[0].map(x => x.trim().toLowerCase());
    const find = (...pats) => hdr.findIndex(x => pats.some(p => p.test(x)));
    const iT = find(/^title$/, /product name/, /^item$/, /item name/, /^product$/, /description/, /^name$/);
    const iC = find(/isbn/, /upc/, /barcode/, /gtin/, /ean/, /^sku$/, /variant sku/, /asin/, /item number/);
    const iQ = find(/^qty/, /quantity/, /units/, /ordered/);
    const iP = find(/wholesale/, /unit cost/, /unit price/, /item price/, /^price$/, /cost/);
    const iR = find(/retail|msrp|list price/);
    if (iT < 0 && iC < 0) return null;
    const num = v => { const n = parseFloat(String(v||'').replace(/[$,]/g,'')); return isNaN(n) ? null : n; };
    return rows.slice(1).map(r => ({id:uid(), code:iC >= 0 ? norm(r[iC]) : '', t:iT >= 0 ? r[iT].trim() : '', a:'', qty:iQ >= 0 ? (num(r[iQ]) || 0) : 0, cost:iP >= 0 ? num(r[iP]) : null, price:iR >= 0 ? num(r[iR]) : null, got:0, bad:0, quote:'', check:''})).filter(l => l.t || l.code);
  }

  // ---------- screens ----------
  function list(v){
    v.append(head('Stock · '+A.site().name, 'Receiving', 'What you ordered and what actually came in. Check shipments in as you unpack so counts, costs and reorders stay right.'));
    if (!can(LEAD)){ v.append(h('div',{class:'card'},'A shift lead, manager or owner checks shipments in.')); return; }
    const vendors = ((S().people && S().people.vendors && S().people.vendors[S().site]) || []).map(x => x.name);
    const f = h('form',{class:'card grid'}, h('h2',null,'New shipment'),
      h('label',{class:'f'},'From', h('input',{type:'text',name:'ven',list:'rcvVen',required:true,maxlength:'80',placeholder:'Penguin Random House, Faire: maker name, Amazon…'})),
      h('datalist',{id:'rcvVen'}, vendors.map(n => h('option',{value:n}))),
      h('label',{class:'f'},'Order or invoice number', h('input',{type:'text',name:'ref',maxlength:'60'})),
      h('label',{class:'f'},'Expected by (optional)', h('input',{type:'date',name:'eta'})),
      h('button',{class:'btn',type:'submit'},'Start'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), id = uid();
      R().unshift({id, site:S().site, ven:String(d.get('ven')).trim(), ref:String(d.get('ref')||'').trim(), eta:String(d.get('eta')||''), at:isoDay(new Date()), status:'ordered', lines:[], charges:[], by:A.me()}); A.save(); A.go('shipment/'+id); });
    v.append(f);
    const rows = here().slice(0, 60);
    v.append(h('div',{class:'card'}, h('h2',null,'Shipments'), rows.length ? h('div',{class:'list'}, rows.map(x => { const exp = x.lines.reduce((a,l) => a + (l.qty||0), 0), got = x.lines.reduce((a,l) => a + (l.got||0), 0);
      return h('a',{class:'item',href:'#/shipment/'+x.id}, h('b',null, x.ven+(x.ref ? ' · '+x.ref : '')), h('span',{class:'small muted'}, STATUS[x.status]+' · '+x.lines.length+' lines · '+got+' of '+exp+' received · '+A.fmtDate(x.at)+(x.eta && x.status === 'ordered' ? ' · expected '+A.fmtDate(x.eta) : '')+(x.claimBy && !x.claimed ? ' · claim by '+A.fmtDate(x.claimBy) : ''))); })) : h('p',{class:'muted'},'No shipments yet.')));
    v.append(h('div',{class:'card soft'}, h('h2',null,'Getting orders in'), h('ul',{class:'small'},
      h('li',null,'Penguin Random House and other publishers: save the invoice or packing slip PDF from the email or portal and add it to the shipment. A phone photo of the paper slip works too.'),
      h('li',null,'Faire: open the order and download its invoice or packing slip, or export orders as CSV, then add the file.'),
      h('li',null,'Amazon Business: download the order report (CSV) or the invoice PDF and add it.'),
      h('li',null,'No paperwork? Start the shipment and scan the items as you unpack.'))));
  }

  async function shipment(v){
    const x = R().find(s => s.id === A.param());
    if (!x){ v.append(head('Receiving','Shipment not found'), h('a',{href:'#/receiving'},'Back to Receiving')); return; }
    const showCost = can(MGR);
    v.append(h('a',{href:'#/receiving',class:'small'},'← All shipments'), head('Receiving · '+x.ven, (x.ref ? x.ref+' · ' : '')+STATUS[x.status], 'Started '+A.fmtDate(x.at)+' by '+x.by+'.'));
    // add lines
    const fi = h('input',{type:'file',accept:'.pdf,.docx,.txt,.csv,image/*','aria-label':'Invoice, packing slip, order CSV or photo'});
    const msg = h('p',{class:'small muted','aria-live':'polite'},'');
    fi.addEventListener('change', async () => { const file = fi.files[0]; if (!file) return; msg.textContent = 'Reading '+file.name+'…';
      try {
        let got;
        if (/csv$/i.test(file.name) || file.type === 'text/csv'){ const lines = csvLines(await file.text()); if (!lines) throw new Error('No product columns found in that CSV.'); got = {lines, charges:[]}; }
        else got = await aiRead(file, x.ven);
        x.lines.push(...got.lines); x.charges.push(...got.charges); if (got.date && !x.docDate) x.docDate = got.date; x.file = file.name; A.save();
        toast(got.lines.length+' lines added. Check them below.'); A.route();
      } catch(e){ msg.textContent = e.message; } });
    if (x.status !== 'done') v.append(h('div',{class:'card grid'}, h('h2',null,'1. What was ordered'),
      h('label',{class:'f'},'Add the invoice, packing slip or order file (PDF, Word, CSV or a photo)', fi), msg,
      h('p',{class:'small muted'},'The reader lists each line with a short quote so you can check it. Nothing is final until you check it in.')));
    // check in by scanning
    const cat = await (A.countCatalog ? A.countCatalog().catch(() => null) : null);
    const titleOf = code => { if (!cat) return ''; const k = cat.codes[code]; return k && cat.items[k] ? cat.items[k].t : ''; };
    const inp = h('input',{type:'text',inputmode:'numeric',autocomplete:'off',placeholder:'Scan or type each item as you unpack, then Enter','aria-label':'Barcode'});
    const last = h('p',{class:'msg big','aria-live':'polite'},'Ready.');
    inp.addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); const code = norm(inp.value); inp.value = ''; if (!code) return;
      let l = x.lines.find(l => norm(l.code) === code);
      if (!l){ l = {id:uid(), code, t:titleOf(code) || '', a:'', qty:0, cost:null, price:null, got:0, bad:0, quote:'', check:'Not on the order'}; x.lines.push(l); }
      l.got = (l.got||0) + 1; if (x.status === 'ordered') x.status = 'arrived'; A.save();
      last.textContent = (!l.qty ? '⚠ Not on the order: ' : l.got > l.qty ? '⚠ Extra: ' : '✓ ')+(l.t || code)+' · '+l.got+(l.qty ? ' of '+l.qty : '');
      last.className = 'msg big'+(l.qty && l.got > l.qty || !l.qty ? ' err' : ''); draw(); });
    if (x.status !== 'done') v.append(h('div',{class:'card grid'}, h('h2',null,'2. Check in what arrived'), inp, last,
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>{ x.lines.forEach(l => l.got = Math.max(l.got||0, l.qty||0)); if (x.status === 'ordered') x.status = 'arrived'; A.save(); draw(); }},'Everything on the list arrived'))));
    // lines table
    const box = h('div',{class:'tablewrap',tabindex:'0',role:'region','aria-label':'Shipment lines'});
    function draw(){
      const tb = h('tbody');
      x.lines.forEach(l => { const short = (l.qty||0) - (l.got||0);
        const numIn = (k, w) => h('input',{type:'number',min:'0',step:k==='cost'?'0.01':'1',value:l[k] == null ? '' : String(l[k]),style:'width:'+w,'aria-label':k+' for '+(l.t||l.code),disabled:x.status === 'done',onchange:e=>{ l[k] = e.target.value === '' ? null : +e.target.value; A.save(); draw(); }});
        tb.append(h('tr',null,
          h('td',null, h('div',null, l.t || h('i',null,'Unknown item')), h('div',{class:'small muted'}, [l.code, l.a].filter(Boolean).join(' · ')), l.check ? h('span',{class:'chip amber'}, l.check) : null, l.quote ? h('div',{class:'small muted'},'“'+l.quote+'”') : null),
          h('td',null, numIn('qty','4.5em')), h('td',null, numIn('got','4.5em')), h('td',null, numIn('bad','4em')),
          showCost ? h('td',null, numIn('cost','6em')) : null,
          h('td',null, short > 0 ? h('span',{class:'chip amber'}, short+' short') : short < 0 ? h('span',{class:'chip amber'}, (-short)+' extra') : l.qty ? h('span',{class:'chip calm'},'OK') : null,
            x.status !== 'done' ? h('button',{class:'linkbtn small',type:'button',onclick:()=>{ x.lines = x.lines.filter(y => y !== l); A.save(); draw(); }},'Remove') : null)));
      });
      box.replaceChildren(x.lines.length ? h('table',{class:'t'}, h('thead',null, h('tr',null, h('th',null,'Item'), h('th',null,'Ordered'), h('th',null,'Received'), h('th',null,'Damaged'), showCost ? h('th',null,'Cost each') : null, h('th',null,''))), tb) : h('p',{class:'muted'},'No lines yet.'));
      tot.textContent = summary(); }
    const summary = () => { const exp = x.lines.reduce((a,l) => a + (l.qty||0), 0), got = x.lines.reduce((a,l) => a + (l.got||0), 0), bad = x.lines.reduce((a,l) => a + (l.bad||0), 0), cost = x.lines.reduce((a,l) => a + (l.qty||l.got||0)*(l.cost||0), 0), extra = x.charges.reduce((a,c) => a + (c.amount||0), 0);
      return got+' of '+exp+' received'+(bad ? ' · '+bad+' damaged' : '')+(showCost && cost ? ' · goods '+money(cost)+(extra ? ' + '+money(extra)+' shipping and fees' : '') : ''); };
    const tot = h('p',{class:'small'},'');
    v.append(h('div',{class:'card'}, h('h2',null,'Lines'), tot, box)); draw();
    // finish
    if (x.status !== 'done' && can(LEAD)){
      const toExp = h('input',{type:'checkbox',checked:showCost});
      v.append(h('div',{class:'card grid'}, h('h2',null,'3. Finish'),
        showCost ? h('label',{class:'checkrow'}, toExp, 'Add this invoice to Expenses (Inventory purchases)') : null,
        h('p',{class:'small muted'},'Short or damaged items: contact the vendor for a credit. Freight claims for hidden damage or shortages are usually due within 5 days, so the app sets a claim date. Keep the box and take photos. Damaged stock can be logged under Tax records as a write-off.'),
        h('button',{class:'btn',type:'button',onclick:()=>{ if (!x.lines.some(l => l.got)) return toast('Nothing has been checked in yet');
          finish(x, showCost && toExp.checked); A.save(); toast('Checked in'); A.route(); }},'Check in shipment')));
    }
    if (x.status === 'done' && x.claimBy) v.append(claimCard(x));
    if (x.status === 'done') v.append(h('div',{class:'card grid'}, h('h2',null,'Update Shopify'),
      h('p',{class:'small muted'},'Download a file that adds the good copies to your Shopify counts. It uses the inventory export loaded under Stock count, so load a fresh one first if it is old.'),
      h('div',{class:'row'}, h('button',{class:'btn',type:'button',onclick:()=>shopifyFile(x, cat)},'Download Shopify file'),
        h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('received-'+(x.ven+'-'+(x.ref||x.at)).replace(/\W+/g,'-').toLowerCase()+'.csv','text/csv',toCsv([['Code','Title','Ordered','Received','Damaged','Cost each'], ...x.lines.map(l => [l.code,l.t,l.qty||0,l.got||0,l.bad||0,l.cost == null ? '' : l.cost])]))},'Download received list'))));
  }

  // Vendor and freight claims (ABA/PartnerShip guidance): hidden damage or shortage within 5 days of delivery;
  // publisher billing and shipping claims often within 60 days (Hachette 2024 terms). We remind at the shorter one.
  const CLAIM_DAYS = 5;
  const problems = x => x.lines.reduce((a,l) => ({short:a.short + Math.max(0,(l.qty||0)-(l.got||0)), bad:a.bad + (l.bad||0), extra:a.extra + Math.max(0,(l.got||0)-(l.qty||0))}), {short:0, bad:0, extra:0});
  function claimCard(x){
    const p = problems(x), left = Math.round((new Date(x.claimBy+'T12:00:00') - new Date(isoDay(new Date())+'T12:00:00')) / 864e5);
    const card = h('div',{class:'card grid'}, h('h2',null, x.claimed ? 'Claim sent' : 'Claim with the vendor'),
      h('p',null, [p.short ? p.short+' short' : '', p.bad ? p.bad+' damaged' : '', p.extra ? p.extra+' extra (tell them, so you aren\'t billed twice)' : ''].filter(Boolean).join(' · ')),
      x.claimed ? h('p',{class:'small muted'}, 'Sent '+A.fmtDate(x.claimed.at.slice(0,10))+' by '+x.claimed.by+(x.claimed.note ? ' · '+x.claimed.note : ''))
        : h('p',null, h('span',{class:'chip '+(left < 0 ? 'red' : left <= 2 ? 'amber' : '')}, left < 0 ? 'Claim date passed '+A.fmtDate(x.claimBy) : 'Claim by '+A.fmtDate(x.claimBy)+' ('+left+' day'+(left===1?'':'s')+' left)')));
    if (!x.claimed && can(LEAD)){
      const f = h('form',{class:'row'}, h('input',{type:'text',name:'n',maxlength:'140','aria-label':'Claim note',placeholder:'Who you contacted, claim number'}), h('button',{class:'btn sm',type:'submit'},'Mark claim sent'));
      f.addEventListener('submit', e => { e.preventDefault(); x.claimed = {at:new Date().toISOString(), by:A.me(), note:String(new FormData(f).get('n')||'').trim()}; A.save(); toast('Claim marked as sent'); A.route(); });
      card.append(f, h('p',{class:'small muted'},'Include the order number, the lines, and your photos. Credit usually comes on a later invoice.'));
    }
    return card;
  }

  function finish(x, toExp){
    x.status = 'done'; x.doneAt = new Date().toISOString(); x.doneBy = A.me();
    { const p = problems(x); if (p.short || p.bad || p.extra) x.claimBy = A.addDays(isoDay(new Date()), CLAIM_DAYS); }
    // remember cost and vendor per code for reorders and special-order quotes
    const s = S(); s.costs = s.costs || {};
    x.lines.forEach(l => { if (l.code && l.cost != null) s.costs[norm(l.code)] = {cost:l.cost, ven:x.ven, at:isoDay(new Date())}; });
    if (toExp){ const amt = x.lines.reduce((a,l) => a + (l.qty||l.got||0)*(l.cost||0), 0) + x.charges.reduce((a,c) => a + (c.amount||0), 0);
      if (amt > 0) (s.exp = s.exp || []).push({id:uid(), site:x.site, date:x.docDate && /^\d{4}-\d{2}-\d{2}$/.test(x.docDate) ? x.docDate : isoDay(new Date()), cat:'Inventory purchases', amt:Math.round(amt*100)/100, payee:x.ven, note:'Shipment'+(x.ref ? ' '+x.ref : '')+' ('+x.lines.length+' lines)', by:A.me(), status:'ok'}); }
  }
  function shopifyFile(x, cat){
    if (!cat || !cat.inv) return toast('Load the Shopify inventory export under Stock count first');
    const {hdr, rows} = cat.inv, col = n => hdr.findIndex(c => c.toLowerCase() === n.toLowerCase()), iH = col('Handle'), iS = col('SKU'), iL = col('Location'), iOn = col('On hand (current)'), iNew = col('On hand (new)');
    const add = {}, missing = [];
    x.lines.forEach(l => { const good = (l.got||0) - (l.bad||0); if (good <= 0) return; const k = cat.codes[norm(l.code)]; if (k) add[k] = (add[k]||0) + good; else missing.push(l); });
    let n = 0; const out = rows.map(r => { r = r.slice(); while (r.length < hdr.length) r.push(''); const k = r[iH]+'|'+(iS >= 0 ? r[iS] : '');
      if (r[iL] === cat.location && add[k]){ r[iNew] = String((parseInt(r[iOn],10)||0) + add[k]); n++; } else r[iNew] = ''; return r; }).filter(r => r[iNew] !== '');
    if (!n) return toast('None of these items matched Shopify products. Add new ones in Shopify first.');
    const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    download('shopify-received-'+isoDay(new Date())+'.csv','text/csv',[hdr, ...out].map(r => r.map(esc).join(',')).join('\r\n')+'\r\n');
    toast(n+' products updated in the file'+(missing.length ? '. '+missing.length+' items are not in Shopify yet; add them there.' : '. Import it under Products > Inventory > Import.'));
  }

  A.register({id:'receiving', name:'Receiving', what:'Track orders from publishers, Faire, Amazon and others; read invoices and packing slips; check shipments in and update Shopify counts.', tiers:['lead','manager','owner'],
    views:{receiving:{t:'Receiving', ic:'📦', render:list}, shipment:{t:'Shipment', ic:'📦', render:shipment, hidden:true}}});
  A.ownerHooks.push(v => { const open = here().filter(x => x.status !== 'done'), claims = here().filter(x => x.status === 'done' && x.claimBy && !x.claimed);
    if (!open.length && !claims.length) return;
    v.append(h('div',{class:'card'}, h('h2',null,'Shipments'), open.length ? h('p',null, open.length+' not checked in yet') : null,
      claims.map(x => h('p',null, h('a',{href:'#/shipment/'+x.id}, x.ven+(x.ref ? ' '+x.ref : '')), ': vendor claim due '+A.fmtDate(x.claimBy))),
      h('a',{href:'#/receiving'},'Open Receiving'))); });
})();
