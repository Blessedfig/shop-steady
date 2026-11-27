// Business records (OWNER ONLY): bring in a whole folder of the business's papers and sort them into the app.
//   Import records : the owner picks a folder (or drags one in) from the computer: receipts, invoices, statements,
//                    vendor papers, HR forms, leases, loans, insurance, licenses, tax forms. Each file gets a suggested
//                    place, and the owner checks or changes every one before anything is saved.
//                      Free      : suggestions from file and folder names, and (still free, still on this device) from
//                                  the words inside PDFs, Word and text files: dates, totals, payee, kind of paper.
//                      AI (paid) : "AI onboarding" reads each file (Edge Function records-import) and fills in the
//                                  details. Uses a per-store allowance of files (supabase/records.sql).
//                    Where things go: receipts and bills -> Expenses; supplier papers -> Vendors; employee forms ->
//                    the person's HR file (marked done; the paper itself stays in the locked file cabinet);
//                    leases, loans, insurance, licenses, tax forms, statements, contracts -> Business records below.
//                    Medical papers are kept out: never read by the AI, never saved.
//   Business records: key facts and dates for those papers, with reminders on Home before something renews or ends.
// The files themselves are not uploaded or stored: the app keeps the file name and folder so the owner can find the
// original. Receipt photos (JPEG or PNG) are kept as a small copy on this device, like the Tax records receipts.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, isoDay, uid} = A;
  const S = () => A.state();
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');
  const local = () => A.demo || !A.sb;
  const today = () => isoDay(new Date());
  // Proposed price for the AI tier (market research: flat per-store pricing). Change here.
  const AI_OFFER = {price:'$49 one time', files:1000};

  const DEST = {expense:'Expense', vendor:'Vendor', hr:'HR file', record:'Business record', medical:'Keep out (medical)', skip:'Skip', '':'Not sorted yet'};
  const KINDS = {lease:'Lease or rent', loan:'Loan or credit line', insurance:'Insurance', license:'License or permit', tax:'Tax form or bill',
    bank:'Bank or card statement', contract:'Contract or agreement', property:'Building or property', hr:'HR paper (owner only)', other:'Other paper'};
  const PAPERS = {w4:'W-4', wt4:'State withholding (WT-4)', i9:'I-9', newhire:'New-hire report', deposit:'Direct deposit form', handbook:'Handbook sign-off',
    emergency:'Emergency contact', permit:'Work permit', application:'Job application', offer:'Offer letter', review:'Review or write-up', other:'Other HR paper'};
  const CHECKLIST = ['w4','wt4','i9','newhire','deposit','handbook','emergency','permit']; // these tick the HR file's paperwork list

  // ---------- free sorting: words in file names, folders and (optionally) the text ----------
  const RX = {
    medical:/medical|doctor|physician|clinic|hospital|fmla|disabilit|prescription|\brx\b|hipaa|drug.?test|diagnos|health.?(record|form|history)|immuni[sz]/,
    hr:/\bw-?4\b|\bwt-?4\b|\bi-?9\b|new.?hire|direct.?deposit|handbook|emergency.?contact|work.?permit|employment.?application|job.?app|application.?for.?employment|offer.?letter|performance.?review|write.?up|warning|personnel|employee|\bhr\b|onboarding.?forms?/,
    lease:/\blease|rental.?agreement|rent.?agreement|landlord/,
    loan:/\bloan|\bsba\b|promissory|note.?payable|line.?of.?credit|\bheloc\b|amortization|mortgage.?(statement|note)/,
    insurance:/insurance|\bpolicy\b|premium|liability|certificate.?of.?insurance|\bcoi\b|declarations|workers.?comp/,
    license:/license|licence|permit|seller.?s.?permit|registration|articles.?of|\bllc\b|business.?certificate|\bdba\b|resale.?cert|\bs-?211\b|\bein.?letter|cp.?575/,
    tax:/\b1099|\bw-?2\b|\bw-?3\b|\b94[01]\b|\birs\b|\b1040|schedule.?c|sales.?tax|\bst-?12\b|property.?tax|\btax(es)?\b|\bdor\b|estimated.?tax/,
    bank:/statement|\bbank|checking|savings|credit.?card.?statement|merchant.?statement|deposit.?slip/,
    contract:/contract|agreement|\bterms.?of.?service|\bmou\b|consignment.?agreement|\bnda\b/,
    property:/\bdeed|title.?(insurance|commitment)|appraisal|inspection|survey|closing|plat\b|building.?permit|blueprint|floor.?plan/,
    vendor:/vendor|supplier|wholesale|price.?list|catalog|line.?sheet|credit.?application|account.?application|new.?account|distributor|terms.?sheet|rep.?contact/,
    expense:/receipt|invoice|\bbill\b|\binv[-_ #]?\d|order.?(confirmation|#|\d)|purchase|\bpaid\b|payment.?confirmation|packing.?slip/
  };
  const CAT_RX = [
    ['Inventory purchases',/faire|ingram|penguin|\bprh\b|harper|simon|schuster|hachette|macmillan|bookazine|scholastic|publisher|wholesale|\bipg\b|baker.?taylor|lunar|diamond/],
    ['Utilities',/electric|\bgas\b|water|sewer|\bwps\b|we.?energies|alliant|xcel|utility|trash|garbage/],
    ['Phone and internet',/verizon|at&?t|t-?mobile|spectrum|charter|frontier|internet|cellular|\bphone\b/],
    ['Insurance',/insurance|premium|\bpolicy\b/],
    ['Rent or mortgage',/\brent\b|lease.?payment/],
    ['Shipping and postage',/usps|\bups\b|fedex|postage|shipping|stamps\.com|pirate.?ship/],
    ['Software and subscriptions',/shopify|quickbooks|intuit|adobe|google.?workspace|microsoft|canva|subscription|software|\bapp\b/],
    ['Card processing fees',/square.?fees|stripe|merchant.?fee|processing.?fee|clover/],
    ['Payroll',/payroll|gusto|\badp\b|paychex|wages/],
    ['Professional fees',/\bcpa\b|accountant|attorney|lawyer|legal|bookkeep/],
    ['Licenses and permits',/license|permit|registration.?fee/],
    ['Marketing and events',/advert|marketing|facebook.?ads|meta.?ads|flyer|signage|printing|event/],
    ['Meals (business)',/restaurant|\bcafe\b|coffee|lunch|dinner|meal|grubhub|doordash/],
    ['Travel',/hotel|airline|flight|motel|airbnb|travel/],
    ['Repairs',/repair|plumb|electrician|hvac|fix/],
    ['Bank fees',/bank.?fee|service.?charge|overdraft/],
    ['Supplies',/staples|office.?depot|uline|amazon|walmart|target|menards|home.?depot|lowe|supplies|costco|sam.?s.?club/]
  ];
  const lc = s => String(s||'').toLowerCase().replace(/[_]+/g,' ');
  function dateIn(s){
    let m = /\b(20\d{2})[-_. /]?(0[1-9]|1[0-2])[-_. /]?(0[1-9]|[12]\d|3[01])\b/.exec(s); if (m) return m[1]+'-'+m[2]+'-'+m[3];
    m = /\b(0?[1-9]|1[0-2])[-_. /](0?[1-9]|[12]\d|3[01])[-_. /](20\d{2})\b/.exec(s); if (m) return m[3]+'-'+String(m[1]).padStart(2,'0')+'-'+String(m[2]).padStart(2,'0');
    return ''; }
  function totalIn(s){ // "Total $212.40", "Amount due: 1,050.00", or a $ figure in the name
    const re = /(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+paid|amount\s+paid|\btotal)\s*:?\s*(?:usd)?\s*\$?\s*(-?[\d,]+\.\d{2})/gi;
    let m, last = null; while ((m = re.exec(s))) last = m[1];
    if (!last){ const d = /\$\s?([\d,]+\.\d{2})/.exec(s); if (d) last = d[1]; }
    const n = last ? +last.replace(/,/g,'') : NaN; return isFinite(n) && n > 0 && n < 1e7 ? n : null; }
  function vendorNames(){ const p = S().people; return ((p && p.vendors && p.vendors[S().site]) || []).map(v => v.name).filter(Boolean); }
  function payeeIn(s){
    const hay = lc(s);
    const v = vendorNames().find(n => { const k = lc(n).replace(/\s*\(.*\)$/,'').trim(); return k.length > 2 && hay.includes(k); });
    if (v) return v.replace(/\s*\(.*\)$/,'');
    for (const [, rx] of CAT_RX){ const m = rx.exec(hay); if (m && m[0].length > 3 && !/\b(fee|bill|policy|rent|event|meal|lunch|app)\b/.test(m[0])) return m[0].replace(/\b\w/g, c => c.toUpperCase()); }
    return ''; }
  function catIn(s){ const hay = lc(s); for (const [c, rx] of CAT_RX) if (rx.test(hay)) return c; return ''; }
  const paperIn = s => { s = lc(s);
    return /\bw-?4\b/.test(s) ? 'w4' : /\bwt-?4\b/.test(s) ? 'wt4' : /\bi-?9\b/.test(s) ? 'i9' : /new.?hire/.test(s) ? 'newhire' : /direct.?deposit/.test(s) ? 'deposit'
      : /handbook/.test(s) ? 'handbook' : /emergency/.test(s) ? 'emergency' : /work.?permit/.test(s) ? 'permit' : /application/.test(s) ? 'application'
      : /offer/.test(s) ? 'offer' : /review|warning|write.?up/.test(s) ? 'review' : 'other'; };
  const team = () => ((S().shifts && S().shifts.team && S().shifts.team[S().site]) || []).filter(p => !/\(sample\)/.test(p.n));
  function personIn(s){ const hay = lc(s); const p = team().find(p => { const parts = lc(p.n).split(/\s+/).filter(x => x.length > 2); return parts.length && parts.every(x => hay.includes(x)); })
    || team().find(p => { const f = lc(p.n).split(/\s+/)[0]; return f && f.length > 2 && new RegExp('\\b'+f.replace(/[^a-z]/g,'')+'\\b').test(hay); });
    return p ? p.id : ''; }

  // Sort one file from its name, folders and any text read on this device. Owner-made choices are never overwritten.
  function suggest(r){
    if (r.by === 'owner' || r.by === 'ai') return;
    const hay = lc(r.path+' '+r.name+' '+(r.text || '').slice(0, 4000)), nameHay = lc(r.path+' '+r.name);
    const f = r.f, kindOf = () => ['lease','loan','insurance','license','tax','bank','contract','property'].find(k => RX[k].test(nameHay)) || ['lease','loan','insurance','license','tax','bank','contract','property'].find(k => RX[k].test(hay));
    let dest = '', why = '';
    if (RX.medical.test(hay)){ dest = 'medical'; why = 'Medical words in the name or text'; }
    else if (RX.hr.test(nameHay) || (r.text && /form\s+w-?4|employment eligibility verification|form\s+i-?9/i.test(r.text))){ dest = 'hr'; why = 'Looks like an employee paper'; }
    else if (RX.expense.test(nameHay) && !RX.bank.test(nameHay)){ dest = 'expense'; why = 'Receipt or invoice in the name'; }
    else if (RX.vendor.test(nameHay)){ dest = 'vendor'; why = 'Supplier paper in the name'; }
    else if (kindOf()){ dest = 'record'; why = KINDS[kindOf()]+' in the name'+(r.text ? ' or text' : ''); }
    else if (r.text && RX.expense.test(hay)){ dest = 'expense'; why = 'Receipt or invoice words inside'; }
    else if (r.text && RX.vendor.test(hay)){ dest = 'vendor'; why = 'Supplier words inside'; }
    else if (/^image\//.test(r.type)){ dest = 'expense'; why = 'A photo: often a receipt. Check it.'; }
    r.dest = dest; r.why = why; r.conf = dest ? (RX[dest] && RX[dest].test(nameHay) ? 'medium' : 'low') : ''; r.by = 'rules';
    fill(r);
  }
  // Fill in the details the chosen place needs (only empty ones), from the name, folders and text.
  function fill(r){
    const f = r.f, hay = lc(r.path+' '+r.name+' '+(r.text || '').slice(0, 4000)), nameHay = lc(r.path+' '+r.name), dest = r.dest;
    const KS = ['lease','loan','insurance','license','tax','bank','contract','property'];
    f.date = f.date || dateIn(r.name) || dateIn(r.text || '') || '';
    if (dest === 'expense'){ f.amount = f.amount != null ? f.amount : (totalIn(r.name.replace(/_/g,'.')) || totalIn(r.text || ''));
      f.payee = f.payee || payeeIn(r.path+' '+r.name+' '+(r.text||'').slice(0,600)); f.cat = f.cat || catIn(hay) || 'Other'; }
    if (dest === 'vendor') f.vname = f.vname || payeeIn(r.path+' '+r.name) || r.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').slice(0,60);
    if (dest === 'hr'){ f.paper = f.paper || paperIn(hay); f.person = f.person || personIn(r.path+' '+r.name+' '+(r.text||'').slice(0,800)); }
    if (dest === 'record'){ const t = r.text || ''; if (!f.ends){ const m = /(?:ends?|ending|expires?|expiration(?: date)?|through|until|\bto)\s*:?\s*((?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})|(?:\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}))/i.exec(t); if (m){ f.ends = dateIn(m[1].replace(/\b(\d)\b/g,'0$1')); if (f.date === f.ends) f.date = dateIn(r.name) || ''; } }
      f.kind = f.kind || KS.find(k => RX[k].test(nameHay)) || KS.find(k => RX[k].test(hay)) || 'other'; f.amount = f.amount != null ? f.amount : totalIn(r.text || ''); }
    f.title = f.title || r.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').slice(0,120);
  }
  function setDest(r, d){ r.dest = d; r.by = 'owner'; r.why = 'You chose'; r.status = ''; if (d === 'medical'){ r.f = {}; r.text = ''; } else fill(r); }

  // ---------- reading files on this device ----------
  let pdfReady = null;
  const loadScript = src => new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => no(new Error('Could not load '+src)); document.head.append(sc); });
  const pdfLib = () => (pdfReady = pdfReady || loadScript('vendor/pdf.min.js').then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; }));
  async function pdfDoc(file){ await pdfLib(); return window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise; }
  async function pdfText(doc, maxPages){ let out = ''; for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++){ const pg = await doc.getPage(i), tc = await pg.getTextContent(); out += tc.items.map(t => t.str).join(' ') + '\n'; } return out; }
  async function pdfImage(doc){ const pg = await doc.getPage(1), vp0 = pg.getViewport({scale:1}), sc = Math.min(2, 1600/Math.max(vp0.width, vp0.height)), vp = pg.getViewport({scale:sc});
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height); await pg.render({canvasContext:cv.getContext('2d'), viewport:vp}).promise; return cv.toDataURL('image/jpeg', 0.8); }
  function shrink(file, max){ return new Promise(res => { const img = new Image(); img.onload = () => { const sc = Math.min(1, max/Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = Math.round(img.width*sc); cv.height = Math.round(img.height*sc); cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); URL.revokeObjectURL(img.src); res(cv.toDataURL('image/jpeg',0.8)); };
    img.onerror = () => { URL.revokeObjectURL(img.src); res(null); }; img.src = URL.createObjectURL(file); }); }
  const isPdf = r => /\.pdf$/i.test(r.name) || r.type === 'application/pdf';
  const isDocx = r => /\.docx$/i.test(r.name);
  const isText = r => /\.(txt|csv|md|tsv|eml|html?)$/i.test(r.name) || /^text\//.test(r.type);
  const isImg = r => /^image\/(jpeg|png|webp|gif|bmp)$/.test(r.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(r.name);
  const readable = r => isPdf(r) || isDocx(r) || isText(r);
  // Social Security, tax id, card and bank-style numbers never leave the device (the server removes them again).
  const scrub = t => t.replace(/\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b|\b(?:\d[ -]?){9,19}\b/g, m => /^97[89]\d{10}$/.test(m.replace(/\D/g,'')) ? m : '[removed]');
  async function readText(r){
    if (r.text != null) return r.text;
    try {
      if (r.size > 40e6) throw new Error('big');
      if (isPdf(r)){ const doc = await pdfDoc(r.file); r.pages = doc.numPages; r.text = await pdfText(doc, 8); r._doc = doc; }
      else if (isDocx(r)){ if (!window.mammoth) await loadScript('vendor/mammoth.browser.min.js'); r.text = (await window.mammoth.extractRawText({arrayBuffer:await r.file.arrayBuffer()})).value; }
      else if (isText(r)) r.text = (await r.file.slice(0, 400000).text());
      else r.text = '';
    } catch(e){ r.text = ''; }
    return r.text; }

  // ---------- the folder being imported (kept in memory until the owner saves; files can't be kept across a reload) ----------
  let rows = [], filter = 'all', busy = '', aiLeft = null, aiChecked = false, stopAI = false;
  const SKIP_FILE = /^(\.|~\$|thumbs\.db$|desktop\.ini$|icon\r?$)/i;
  const fileKey = f => [f.name, f.size, f.lastModified].join('|');
  function imported(){ const s = S(); s.recimp = s.recimp && typeof s.recimp === 'object' ? s.recimp : {}; return s.recimp; } // this device: files already saved
  function addFiles(list){
    const have = new Set(rows.map(r => r.key)); let added = 0, seen = 0;
    for (const x of list){ const file = x.file || x, path = (x.path || file.webkitRelativePath || '').split('/').slice(0,-1).join('/');
      if (SKIP_FILE.test(file.name) || !file.size) continue;
      const key = fileKey(file); if (have.has(key)) continue; have.add(key);
      const r = {id:uid(), file, name:file.name, path, size:file.size, type:file.type || '', key, text:null, dest:'', by:'', conf:'', why:'', f:{}, include:true, done:!!imported()[key]};
      if (r.done){ r.include = false; seen++; }
      suggest(r); rows.push(r); added++; }
    rows.sort((a,b) => (a.path+'/'+a.name).localeCompare(b.path+'/'+b.name));
    toast(added ? added+' files added'+(seen ? ' ('+seen+' were imported before and are left out)' : '') : 'No new files there'); A.route(); }
  // drag and drop of a whole folder: walk it with the File and Directory Entries API
  async function walk(entry, path, out){
    if (out.length > 5000) return;
    if (entry.isFile) await new Promise(ok => entry.file(f => { out.push({file:f, path:(path ? path+'/' : '')+f.name}); ok(); }, ok));
    else if (entry.isDirectory){ const rd = entry.createReader(); let batch;
      do { batch = await new Promise(ok => rd.readEntries(ok, () => ok([]))); for (const e of batch) await walk(e, (path ? path+'/' : '')+entry.name, out); } while (batch.length); } }
  async function onDrop(e){ e.preventDefault(); const items = [...(e.dataTransfer.items || [])], out = [];
    if (items.length && items[0].webkitGetAsEntry){ for (const it of items){ const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) await walk(en, '', out); } }
    else [...e.dataTransfer.files].forEach(f => out.push({file:f, path:f.name}));
    addFiles(out); }

  // ---------- AI onboarding (paid) ----------
  async function aiStatus(){
    if (local()){ aiLeft = 0; aiChecked = true; return; }
    try { const r = await A.sb.from('records_ai').select('files_left').eq('id',1).maybeSingle(); aiLeft = r.error ? null : (r.data ? r.data.files_left : 0); } catch(e){ aiLeft = null; }
    aiChecked = true; }
  async function aiOne(r){
    let body = {name:r.name, path:r.path};
    if (isImg(r)){ const image = await shrink(r.file, 1600); if (!image) throw new Error('That picture could not be opened'); body.image = image; }
    else { const t = await readText(r);
      if (t && t.trim().length > 40) body.text = scrub(t);
      else if (isPdf(r) && r._doc) body.image = await pdfImage(r._doc); // a scanned PDF: send a picture of page 1
      else throw new Error('No words found in this file'); }
    const {data, error} = await A.sb.functions.invoke('records-import', {body});
    if (error){ let code = ''; try { code = (await error.context.json()).error; } catch(e){}
      const e = new Error(code === 'no-allowance' ? 'AI onboarding has no files left' : code === 'busy' ? 'The reader is busy' : code === 'not-configured' ? 'AI reading is not switched on yet' : code === 'not-set-up' ? 'Run supabase/records.sql first' : 'Could not read it ('+(code||'error')+')');
      e.stop = ['no-allowance','not-configured','not-set-up','owner-only'].includes(code); throw e; }
    if (typeof data.files_left === 'number' && data.files_left >= 0) aiLeft = data.files_left;
    const f = r.f; r.dest = data.dest; r.conf = data.confidence; r.why = data.why || ''; r.by = 'ai';
    if (data.dest === 'medical'){ r.f = {}; return; }
    f.title = data.title || f.title; f.date = data.date || f.date;
    if (data.amount != null) f.amount = data.amount;
    if (data.dest === 'expense'){ f.payee = data.payee || f.payee; f.cat = data.category || f.cat || 'Other'; }
    if (data.dest === 'vendor'){ const v = data.vendor || {}; f.vname = v.name || data.payee || f.vname; f.vcovers = v.covers; f.vhow = v.how; f.vterms = v.terms; f.vemail = v.email; f.vphone = v.phone; f.vweb = v.website; }
    if (data.dest === 'hr'){ f.paper = (data.hr && data.hr.paper) || paperIn(r.name); f.pname = (data.hr && data.hr.person) || ''; f.person = personIn(f.pname) || f.person || ''; }
    if (data.dest === 'record'){ const x = data.record || {}; f.kind = x.kind || f.kind || 'other'; f.party = x.party || data.payee; f.renews = x.renews_on; f.ends = x.ends_on; f.rate = x.rate; f.term = x.term; f.notes = x.notes; }
  }
  async function runAI(list){
    stopAI = false; let done = 0, failed = 0; busy = 'ai';
    const queue = list.slice(), work = async () => { while (queue.length && !stopAI){ const r = queue.shift(); r.status = 'Reading…'; paint();
      try { await aiOne(r); r.status = ''; done++; } catch(e){ r.status = e.message; failed++; if (e.stop) stopAI = true; } paint(); } };
    await Promise.all([work(), work(), work()]);
    busy = ''; toast('AI sorted '+done+' files'+(failed ? ', '+failed+' could not be read' : '')); A.route(); }
  async function readAll(){
    busy = 'read'; const list = rows.filter(r => readable(r) && r.text == null && r.by !== 'owner'); let n = 0;
    for (const r of list){ r.status = 'Reading on this device…'; paint(); await readText(r); r.status = ''; if (r.by === 'rules' || !r.by){ r.by = ''; r.f = {}; suggest(r); } n++; paint(); }
    busy = ''; toast('Read '+n+' files on this device'); A.route(); }

  // ---------- saving: each file to its place ----------
  async function save(){
    const all = rows.filter(r => r.include && !r.done && ['expense','vendor','hr','record'].includes(r.dest)), todo = all.filter(r => !problem(r)), waiting = all.length - todo.length;
    if (!todo.length){ filter = 'check'; A.route(); return toast('Nothing ready yet: the files shown need a detail first'); }
    busy = 'save'; paint();
    const site = S().site, who = A.me(), counts = {expense:0, vendor:0, hr:0, record:0}, recs = [];
    // vendors: make sure the store's vendor list exists (the Vendors screen fills in the usual suppliers the first time)
    if (todo.some(r => r.dest === 'vendor') && !(S().people && S().people.vendors && S().people.vendors[site]) && A.R.vendors){ try { A.R.vendors(h('div')); } catch(e){} }
    for (const r of todo){ const f = r.f, from = 'From '+(r.path ? r.path+'/' : '')+r.name;
      if (r.dest === 'expense'){
        let receipt = null; if (isImg(r) && A.photos){ try { const p = await shrink(r.file, 1400); if (p){ const id = uid(); await A.photos.put(id, p); receipt = id; } } catch(e){} }
        S().exp.push({id:uid(), site, date:f.date, cat:f.cat || 'Other', amt:+f.amount, note:(f.title || '').slice(0,120), payee:(f.payee || '').trim(), pay:'', receipt, by:who, status:'ok', src:'import', file:from.slice(5, 300)});
        counts.expense++; }
      else if (r.dest === 'vendor'){
        const s = S(); s.people = s.people || {vendors:{}, customers:{}, margin:{tiers:[[50,0.45],[200,0.35],[500,0.28],[1e9,0.22]], ship:0}};
        const list = s.people.vendors[site] = s.people.vendors[site] || [], name = String(f.vname).trim();
        const v = list.find(x => lc(x.name).replace(/\s*\(.*\)$/,'') === lc(name).replace(/\s*\(.*\)$/,''));
        const add = {covers:f.vcovers || '', how:f.vhow || '', terms:f.vterms || '', email:f.vemail || '', phone:f.vphone || '', website:f.vweb || ''};
        if (v){ for (const k in add) if (add[k] && !v[k]) v[k] = add[k]; v.notes = ((v.notes || '') + (v.notes ? '\n' : '') + from).slice(0, 1000); }
        else list.push(Object.assign({id:uid(), name, status:'Active', contact:'', min:'', lead:null, notes:from}, add));
        counts.vendor++; }
      else if (r.dest === 'hr' && f.person && CHECKLIST.includes(f.paper)){
        const s = S(); s.hr = s.hr && typeof s.hr === 'object' ? s.hr : {}; s.hr.people = s.hr.people || {};
        const file = s.hr.people[f.person] = s.hr.people[f.person] || {}; file.paper = file.paper || {}; file.reviews = file.reviews || []; file.actions = file.actions || [];
        file.paper[f.paper] = {done:true, at:f.date || today(), by:who, note:'On file: '+r.name};
        counts.hr++; }
      else { // business records, and HR papers that are not on the checklist (owner only)
        const person = f.person ? (team().find(p => p.id === f.person) || {}).n : f.pname;
        recs.push({r, row:{site, kind:r.dest === 'hr' ? 'hr' : (f.kind || 'other'), title:(r.dest === 'hr' ? PAPERS[f.paper] + (person ? ': '+person : '') : (f.title || r.name)).slice(0,200),
          party:f.party || null, doc_date:f.date || null, amount:f.amount != null && f.amount !== '' && isFinite(+f.amount) ? +f.amount : null, renews_on:f.renews || null, ends_on:f.ends || null,
          facts:{rate:f.rate || '', term:f.term || '', notes:f.notes || ''}, file_name:r.name, file_path:r.path, file_key:r.key, sorted_by:r.by === 'ai' ? 'ai' : r.by === 'owner' ? 'owner' : 'rules'}}); }
      if (r.dest !== 'record' && !(r.dest === 'hr' && !(f.person && CHECKLIST.includes(f.paper)))){ r.done = true; imported()[r.key] = today(); }
    }
    let recErr = '';
    if (recs.length){
      if (local()){ const s = S(); s.ownrec = s.ownrec || []; recs.forEach(x => { s.ownrec.push(Object.assign({id:uid(), created_at:new Date().toISOString()}, x.row)); x.r.done = true; imported()[x.r.key] = today(); }); counts.record += recs.length; }
      else { const res = await A.sb.from('owner_records').upsert(recs.map(x => x.row), {onConflict:'file_key', ignoreDuplicates:true});
        if (res.error) recErr = /owner_records|schema cache|relation/.test(res.error.message) ? 'Business records need supabase/records.sql run once first.' : res.error.message;
        else { recs.forEach(x => { x.r.done = true; imported()[x.r.key] = today(); }); counts.record += recs.length; } } }
    A.save(); busy = '';
    toast('Saved: '+counts.expense+' expenses, '+counts.vendor+' vendors, '+counts.hr+' HR papers, '+counts.record+' business records');
    if (recErr) setTimeout(() => toast(recErr), 2700);
    else if (waiting) setTimeout(() => toast(waiting+' files still need a detail: they are under "Needs a look"'), 2700);
    if (waiting) filter = 'check';
    A.route(); }
  function problem(r){ const f = r.f;
    if (r.dest === 'expense') return !f.date ? 'Add the date' : !(+f.amount > 0) ? 'Add the amount' : '';
    if (r.dest === 'vendor') return !String(f.vname||'').trim() ? 'Add the vendor name' : '';
    if (r.dest === 'hr') return !f.paper ? 'Pick which paper' : (CHECKLIST.includes(f.paper) && !f.person) ? 'Pick the person' : '';
    if (r.dest === 'record') return !String(f.title||'').trim() ? 'Add a title' : '';
    return ''; }
  function dupOf(r){ if (r.dest !== 'expense' || !r.f.date || !(+r.f.amount > 0)) return false;
    return S().exp.some(x => x.site === S().site && x.date === r.f.date && Math.abs(x.amt - r.f.amount) < 0.005); }

  // ---------- screens ----------
  let paintFn = null; const paint = () => { if (paintFn) paintFn(); };
  function field(label, val, on, attrs){ return h('label',{class:'f'}, label, h('input',Object.assign({value:val == null ? '' : String(val), onchange:e => on(e.target.value)}, attrs || {type:'text'}))); }
  function pick(label, val, opts, on){ return h('label',{class:'f'}, label, h('select',{onchange:e => on(e.target.value)}, Object.entries(opts).map(([k,t]) => h('option',{value:k, selected:k === (val||'')}, t)))); }
  function details(r){
    const f = r.f, set = k => v => { f[k] = v; r.by = r.by === 'ai' ? 'ai' : 'owner'; paint(); }, num = k => v => { f[k] = v === '' ? null : +v; r.by = r.by === 'ai' ? 'ai' : 'owner'; paint(); };
    const box = h('div',{class:'grid g2'});
    if (r.dest === 'expense'){ const cats = {}; A.D.EXP_CATS.forEach(c => cats[c] = c);
      box.append(field('Date', f.date, set('date'), {type:'date'}), field('Amount ($)', f.amount, num('amount'), {type:'number', step:'0.01', min:'0'}),
        field('Paid to', f.payee, set('payee'), {type:'text', maxlength:'100'}), pick('Category', f.cat || 'Other', cats, set('cat')),
        field('What it was for', f.title, set('title'), {type:'text', maxlength:'120'})); }
    else if (r.dest === 'vendor') box.append(field('Vendor name', f.vname, set('vname'), {type:'text', maxlength:'80'}), field('What they sell', f.vcovers, set('vcovers'), {type:'text', maxlength:'200'}),
        field('How to order', f.vhow, set('vhow'), {type:'text', maxlength:'200'}), field('Terms', f.vterms, set('vterms'), {type:'text', maxlength:'200'}),
        field('Business email', f.vemail, set('vemail'), {type:'email', maxlength:'120'}), field('Phone', f.vphone, set('vphone'), {type:'tel', maxlength:'30'}));
    else if (r.dest === 'hr'){ const ppl = {'':'Pick the person'}; team().forEach(p => ppl[p.id] = p.n);
      box.append(pick('Which paper', f.paper, PAPERS, set('paper')), pick('Person', f.person, ppl, set('person')), field('Date signed or done', f.date, set('date'), {type:'date'}));
      box.append(h('p',{class:'small muted'}, CHECKLIST.includes(f.paper) ? 'Ticks this paper on the person\'s HR file. Keep the paper itself in the locked file cabinet.' : 'Saved as an owner-only business record that points to the file.')); }
    else if (r.dest === 'record') box.append(pick('Kind', f.kind || 'other', KINDS, set('kind')), field('Title', f.title, set('title'), {type:'text', maxlength:'200'}),
        field('Other party (landlord, lender, insurer, agency)', f.party, set('party'), {type:'text', maxlength:'100'}), field('Main amount ($)', f.amount, num('amount'), {type:'number', step:'0.01'}),
        field('Dated', f.date, set('date'), {type:'date'}), field('Renews or due on', f.renews, set('renews'), {type:'date'}), field('Ends on', f.ends, set('ends'), {type:'date'}),
        field('Rate or term', [f.rate, f.term].filter(Boolean).join(' · '), v => { f.rate = v; f.term = ''; r.by = 'owner'; }, {type:'text', maxlength:'80'}),
        field('Notes', f.notes, set('notes'), {type:'text', maxlength:'240'}));
    else if (r.dest === 'medical') box.append(h('p',{class:'small'},'Medical papers are not read by the AI and not saved in the app. Keep them in a separate locked folder, apart from HR files.'));
    return box; }
  function rowView(r){
    const p = r.include && !r.done ? problem(r) : '', dup = !r.done && dupOf(r);
    const sum = h('summary',null, h('b',null, r.name), ' ',
      h('span',{class:'chip '+(r.done ? 'calm' : r.dest === 'medical' ? 'red' : !r.dest || r.dest === 'skip' ? 'grey' : '')}, r.done ? 'Saved' : DEST[r.dest]),
      r.by === 'ai' ? h('span',{class:'chip'},'AI'+(r.conf ? ': '+r.conf : '')) : null,
      p ? h('span',{class:'chip amber'}, p) : null, dup ? h('span',{class:'chip amber'},'Possible duplicate') : null,
      h('div',{class:'small muted'}, (r.path || '(top folder)')+' · '+(r.size > 1e6 ? (r.size/1e6).toFixed(1)+' MB' : Math.max(1, Math.round(r.size/1e3))+' KB')
        + (r.dest === 'expense' && r.f.amount ? ' · '+money(+r.f.amount)+(r.f.payee ? ' to '+r.f.payee : '')+(r.f.date ? ' · '+A.fmtDate(r.f.date) : '') : '')
        + (r.why ? ' · '+r.why : '') + (r.status ? ' · '+r.status : '')));
    const d = h('details',{class:'item'}, sum);
    d.addEventListener('toggle', () => { if (d.open && d.children.length === 1){
      d.append(h('div',{class:'row'}, pick('Goes to', r.dest, DEST, v => { setDest(r, v); paint(); }),
        h('label',{class:'checkrow'}, h('input',{type:'checkbox', checked:r.include && !r.done, disabled:r.done, onchange:e => { r.include = e.target.checked; paint(); }}), 'Include when saving')), details(r)); } });
    return d; }
  function importView(v){
    v.append(head('Owner', 'Import business records', 'Bring in a folder of papers from your computer: receipts, invoices, statements, vendor papers, employee forms, leases, loans, insurance, tax forms. Every file gets a suggested place, and nothing is saved until you check it and tap Save.'));
    if (!isOwner()){ v.append(h('div',{class:'card'},'Only the owner can import business records.')); return; }
    if (!aiChecked) aiStatus().then(() => { if (A.VIEWS && location.hash.startsWith('#/importrec')) paint(); });
    const pickDir = h('input',{type:'file', multiple:true, webkitdirectory:true, style:'display:none', 'aria-label':'Pick a folder', onchange:e => { addFiles([...e.target.files]); e.target.value = ''; }});
    const pickFiles = h('input',{type:'file', multiple:true, style:'display:none', 'aria-label':'Pick files', onchange:e => { addFiles([...e.target.files].map(f => ({file:f, path:''}))); e.target.value = ''; }});
    const drop = h('div',{class:'card soft', style:'border-style:dashed;text-align:center', ondragover:e => e.preventDefault(), ondrop:onDrop},
      h('p',null, h('b',null,'Drag a folder here'), ' or'),
      h('div',{class:'row', style:'justify-content:center'}, h('button',{class:'btn',type:'button',onclick:() => pickDir.click()},'📁 Pick a folder'), h('button',{class:'btn ghost',type:'button',onclick:() => pickFiles.click()},'Pick files')),
      h('p',{class:'small muted'},'Files stay on your computer. The app keeps the facts it needs and where each file is, so you can find the original.'), pickDir, pickFiles);
    v.append(drop);
    const tiers = h('div',{class:'grid g2'},
      h('div',{class:'card'}, h('h2',null,'Free: you sort, the app suggests'),
        h('p',{class:'small'},'Suggestions come from file and folder names, like "Receipts/2025/Staples 2025-03-14.pdf". Read inside the files for better ones: dates, totals and kinds of paper. That reading happens on this computer and is free.'),
        h('button',{class:'btn ghost', type:'button', disabled:!rows.some(r => readable(r) && r.text == null) || !!busy, onclick:readAll}, busy === 'read' ? 'Reading…' : 'Read inside the files (free)')),
      h('div',{class:'card'}, h('h2',null,'AI onboarding: the app sorts for you'),
        h('p',{class:'small'},'The AI reads each file and fills in the details: totals, payees, vendor terms, lease and loan dates. You still check before anything is saved. Social Security, tax id, card and bank numbers are removed first, and medical papers are never sent.'),
        h('p',{class:'small muted'}, local() ? 'Sign in to use it (not in the demo). '+AI_OFFER.price+' for up to '+AI_OFFER.files.toLocaleString()+' files.'
          : aiLeft == null ? (aiChecked ? 'Not set up yet: run supabase/records.sql.' : 'Checking…') : aiLeft > 0 ? aiLeft.toLocaleString()+' files left in your AI onboarding.' : 'Not on for this store yet: '+AI_OFFER.price+' for up to '+AI_OFFER.files.toLocaleString()+' files.'),
        (() => { const list = rows.filter(r => !r.done && r.by !== 'owner' && r.by !== 'ai' && r.dest !== 'medical' && (readable(r) || isImg(r)));
          return busy === 'ai' ? h('button',{class:'btn ghost',type:'button',onclick:() => { stopAI = true; }},'Stop')
            : h('button',{class:'btn', type:'button', disabled:local() || !aiLeft || !list.length || !!busy, onclick:() => { const n = Math.min(list.length, aiLeft || 0); if (!confirm('Let the AI read '+n+' files? This uses '+n+' of your '+aiLeft+' AI files. You check everything before it is saved.')) return; runAI(list.slice(0, n)); }},
              'Sort '+(list.length ? Math.min(list.length, aiLeft || list.length)+' files ' : '')+'with AI'); })()));
    v.append(tiers);
    if (!rows.length){ v.append(h('p',{class:'small muted'},'Where things go: receipts and bills to Expenses, supplier papers to Vendors, employee forms to HR files, and leases, loans, insurance, licenses, tax forms and statements to Business records.')); return; }

    const list = h('div',{class:'list'}), counts = {};
    rows.forEach(r => { const k = r.done ? 'done' : r.dest || ''; counts[k] = (counts[k]||0) + 1; });
    const need = rows.filter(r => r.include && !r.done && (problem(r) || !r.dest)).length;
    const TABS = [['all','All '+rows.length], ['check','Needs a look '+need], ...Object.keys(DEST).filter(k => counts[k]).map(k => [k, DEST[k]+' '+counts[k]]), counts.done ? ['done','Saved '+counts.done] : null].filter(Boolean);
    const tabs = h('div',{class:'row', role:'group', 'aria-label':'Show'}, TABS.map(([k,t]) => h('button',{class:'chip', type:'button', 'aria-pressed':String(filter === k), onclick:() => { filter = k; paint(); }}, t)));
    // change a whole folder at once
    const folders = [...new Set(rows.map(r => r.path))];
    let bulkF = folders[0], bulkD = 'expense';
    const bulk = h('details',{class:'card'}, h('summary',null, h('b',null,'Sort a whole folder at once')),
      h('div',{class:'row'}, h('label',{class:'f'},'Folder', h('select',{onchange:e => bulkF = e.target.value}, folders.map(x => h('option',{value:x}, x || '(top folder)')))),
        pick('Goes to', bulkD, Object.fromEntries(Object.entries(DEST).filter(([k]) => k)), x => bulkD = x),
        h('button',{class:'btn ghost', type:'button', onclick:() => { let n = 0; rows.filter(r => r.path === bulkF && !r.done).forEach(r => { setDest(r, bulkD); n++; }); toast(n+' files changed'); paint(); }}, 'Apply')));
    const show = rows.filter(r => filter === 'all' ? true : filter === 'check' ? r.include && !r.done && (problem(r) || !r.dest) : filter === 'done' ? r.done : !r.done && (r.dest || '') === filter);
    show.slice(0, 300).forEach(r => list.append(rowView(r)));
    if (show.length > 300) list.append(h('p',{class:'small muted'}, 'Showing the first 300. Use the buttons above to narrow it down.'));
    const ready = rows.filter(r => r.include && !r.done && ['expense','vendor','hr','record'].includes(r.dest) && !problem(r)).length;
    v.append(h('div',{class:'card'}, h('h2',null, rows.length+' files'), tabs, bulk, list,
      h('div',{class:'row'}, h('button',{class:'btn', type:'button', disabled:!ready || !!busy, onclick:save}, busy === 'save' ? 'Saving…' : 'Save '+ready+' files that are ready'),
        h('button',{class:'btn quiet sm', type:'button', disabled:!!busy, onclick:() => { if (confirm('Clear this list? Saved records stay saved.')){ rows = []; filter = 'all'; A.route(); } }}, 'Clear the list')),
      h('p',{class:'small muted'},'Medical papers and anything marked Skip are never saved. Files saved before are left out the next time you import the same folder.')));
  }

  // ---------- business records ----------
  async function loadRecs(){
    if (local()) return (S().ownrec || []).slice();
    const r = await A.sb.from('owner_records').select('*').order('created_at', {ascending:false}).limit(2000); if (r.error) throw r.error; return r.data || []; }
  async function delRec(x){ if (local()){ S().ownrec = (S().ownrec || []).filter(y => y.id !== x.id); A.save(); }
    else { const r = await A.sb.from('owner_records').delete().eq('id', x.id); if (r.error) return toast(r.error.message); }
    if (x.file_key) delete imported()[x.file_key]; A.save(); toast('Removed'); A.route(); }
  const soon = x => [['renews_on','renews'],['ends_on','ends']].map(([k,w]) => x[k] && x[k] >= today() && x[k] <= A.addDays(today(), 60) ? KINDS[x.kind]+': '+x.title+' '+w+' '+A.fmtDate(x[k]) : null).filter(Boolean);
  function recordsView(v){
    v.append(head('Owner', 'Business records', 'Leases, loans, insurance, licenses, tax forms, statements and contracts: the key facts and dates, and where each original file is. Only the owner sees these.'));
    if (!isOwner()){ v.append(h('div',{class:'card'},'Only the owner can see business records.')); return; }
    v.append(h('div',{class:'row'}, h('a',{class:'btn',href:'#/importrec'},'📁 Import a folder'), h('button',{class:'btn ghost',type:'button',onclick:() => { addForm.style.display = addForm.style.display === 'none' ? '' : 'none'; }},'Add one by hand')));
    const addForm = h('form',{class:'card grid g2', style:'display:none'},
      h('label',{class:'f'},'Kind', h('select',{name:'kind'}, Object.entries(KINDS).map(([k,t]) => h('option',{value:k},t)))),
      h('label',{class:'f'},'Title', h('input',{name:'title', required:true, maxlength:'200'})),
      h('label',{class:'f'},'Other party', h('input',{name:'party', maxlength:'100'})),
      h('label',{class:'f'},'Main amount ($)', h('input',{name:'amount', type:'number', step:'0.01'})),
      h('label',{class:'f'},'Renews or due on', h('input',{name:'renews_on', type:'date'})),
      h('label',{class:'f'},'Ends on', h('input',{name:'ends_on', type:'date'})),
      h('label',{class:'f'},'Where the original is', h('input',{name:'file_path', maxlength:'300', placeholder:'Filing cabinet, drawer 2'})),
      h('button',{class:'btn', type:'submit'},'Add'));
    addForm.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(addForm), row = {site:S().site, kind:String(d.get('kind')), title:String(d.get('title')).trim(), party:String(d.get('party')||'') || null,
      amount:d.get('amount') ? +d.get('amount') : null, renews_on:d.get('renews_on') || null, ends_on:d.get('ends_on') || null, file_path:String(d.get('file_path')||'') || null, facts:{}, sorted_by:'owner'};
      if (local()){ S().ownrec = S().ownrec || []; S().ownrec.push(Object.assign({id:uid(), created_at:new Date().toISOString()}, row)); A.save(); }
      else { const r = await A.sb.from('owner_records').insert(row); if (r.error) return toast(r.error.message); }
      toast('Added'); A.route(); });
    v.append(addForm);
    const box = h('div',{class:'list'}, h('p',{class:'muted'},'Loading…')); v.append(box);
    loadRecs().then(list => {
      if (!list.length) return box.replaceChildren(h('div',{class:'card'}, h('p',null,'No business records yet. Import a folder, or add one by hand.')));
      const up = list.flatMap(soon); const out = [];
      if (up.length) out.push(h('div',{class:'card'}, h('h2',null,'Coming up in the next 60 days'), h('ul',null, up.map(x => h('li',null,x)))));
      Object.keys(KINDS).forEach(k => { const g = list.filter(x => x.kind === k); if (!g.length) return;
        out.push(h('div',{class:'card'}, h('h2',null, KINDS[k]+' ('+g.length+')'), h('div',{class:'list'}, g.map(x => h('div',{class:'item'},
          h('b',null, x.title), h('div',{class:'small muted'}, [x.party, x.amount != null ? money(+x.amount) : '', x.doc_date ? 'dated '+A.fmtDate(x.doc_date) : '', x.renews_on ? 'renews '+A.fmtDate(x.renews_on) : '', x.ends_on ? 'ends '+A.fmtDate(x.ends_on) : '',
            x.facts && x.facts.rate ? x.facts.rate : '', x.facts && x.facts.term ? x.facts.term : ''].filter(Boolean).join(' · ')),
          x.facts && x.facts.notes ? h('div',{class:'small'}, x.facts.notes) : null,
          x.file_path || x.file_name ? h('div',{class:'small muted'}, '📄 '+[x.file_path, x.file_name].filter(Boolean).join('/')) : null,
          h('div',{class:'row'}, x.sorted_by === 'ai' ? h('span',{class:'chip grey'},'Sorted by AI') : null, h('button',{class:'btn quiet sm', type:'button', onclick:() => { if (confirm('Remove "'+x.title+'" from business records? The file itself is not touched.')) delRec(x); }},'Remove')))))));
      });
      box.replaceChildren(...out);
    }).catch(e => box.replaceChildren(h('div',{class:'msg err'}, /owner_records|schema cache|relation/.test(e.message||'') ? 'Business records are not set up yet: run supabase/records.sql once in Supabase.' : 'Could not load: '+e.message)));
  }

  Object.values(A.D.BUSINESS_TYPES).forEach(t => { if (t.modules && !t.modules.includes('records')) t.modules.push('records'); });
  A.register({id:'records', name:'Business records', what:'Import a folder of the business\'s papers and sort them into Expenses, Vendors, HR files and owner-only records (leases, loans, insurance, licenses, tax forms). Free sorting with suggestions, or paid AI onboarding that reads the files for you.', tiers:['owner'],
    views:{records:{t:'Business records', ic:'🗄️', render:recordsView, min:'owner'}, importrec:{t:'Import records', ic:'📁', render:v => { paintFn = () => { if (location.hash.startsWith('#/importrec')){ const open = new Set([...document.querySelectorAll('#main details[open]')].map(d => d.querySelector('summary b') && d.querySelector('summary b').textContent)); const y = window.scrollY; A.route(); document.querySelectorAll('#main details').forEach(d => { const b = d.querySelector('summary b'); if (b && open.has(b.textContent)) d.open = true; }); window.scrollTo(0, y); } }; importView(v); }, min:'owner'}}});
  // Owner's Home: anything renewing or ending soon
  A.ownerHooks.push(v => { if (!isOwner()) return;
    loadRecs().then(list => { const up = list.flatMap(soon); if (up.length) v.append(h('div',{class:'card'}, h('h2',null,'Papers renewing or ending soon'), h('ul',null, up.slice(0,6).map(x => h('li',null,x))), h('a',{href:'#/records'},'Open business records'))); }).catch(() => {}); });
  window.SSRecords = {suggest, dateIn, totalIn, catIn, paperIn};
})();
