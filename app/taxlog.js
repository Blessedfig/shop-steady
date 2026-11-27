// Tax records: the things owners forget until tax time.
//   - Mileage log (what the IRS asks for: date, where, business purpose, miles), with saved places for one tap.
//   - Receipts with a photo, in the same expense list the Expenses screen uses.
//   - Write-offs of stock: damaged, stolen, expired, donated or given away, at cost.
//   - Anything else for the books (cash paid out, a home-office change, a question for the accountant).
// Staff can log from the store-mode screen during a shift; a manager or owner approves before it counts.
// Year-end summary and a QuickBooks-ready file. This is record keeping, not tax advice: the accountant decides.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, download, toCsv, money, isoDay, uid} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier);
  const REASONS = {damaged:'Damaged', stolen:'Stolen or missing', expired:'Expired or spoiled', donated:'Donated to a charity or school', giveaway:'Given away (event, promo, sample)', used:'Used in the store'};
  const OTHER = {cashout:'Cash paid out of the drawer', homeoffice:'Home office or home storage', question:'Question for the accountant', other:'Something else for the books'};

  function T(){ const s = S(); s.tax = s.tax || {trips:[], writeoffs:[], notes:[], places:[], rate:0.70, rateYear:2025, vehicle:'', office:{sqft:0, method:'simplified'}};
    const t = s.tax; ['trips','writeoffs','notes','places'].forEach(k => t[k] = t[k] || []);
    if (!t.places.length) t.places = [{n:'Post office', mi:2}, {n:'Bank', mi:2}, {n:'Office supply store', mi:6}];
    s.exp = s.exp || []; return t; }
  const here = list => list.filter(x => x.site === S().site);
  const who = () => S().kioskWho ? S().kioskWho.n : A.tier().name;
  // In store mode the person who tapped in counts, not the device's view: their entries wait for a manager unless they are one.
  const actorTier = () => { const k = S().kioskWho; if (!k) return S().tier; const sh = S().shifts || {}, team = (sh.team && sh.team[S().site]) || []; const p = team.find(x => x.n === k.n); return p ? p.tier : 'staff'; };
  const status = () => MGR.includes(actorTier()) ? 'ok' : 'pending';

  // ---------- receipt photos live in IndexedDB (too big for the main saved state) ----------
  const PH = { db:null,
    open(){ return this.db || (this.db = new Promise((ok, no) => { try { const r = indexedDB.open('shop-steady-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch(e){ no(e); } })); },
    async put(id, data){ const db = await this.open(); return new Promise((ok, no) => { const t = db.transaction('p','readwrite'); t.objectStore('p').put(data, id); t.oncomplete = ok; t.onerror = () => no(t.error); }); },
    async get(id){ const db = await this.open(); return new Promise(ok => { const q = db.transaction('p').objectStore('p').get(id); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); } };
  A.photos = PH;
  function takePhoto(){ return new Promise(res => {
    const inp = h('input',{type:'file',accept:'image/*',capture:'environment',style:'display:none'}); document.body.append(inp);
    inp.addEventListener('change', () => { const f = inp.files[0]; inp.remove(); if (!f) return res(null);
      const img = new Image(); img.onload = () => { const sc = Math.min(1, 1400/Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width*sc); cv.height = Math.round(img.height*sc); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src); res(cv.toDataURL('image/jpeg', 0.75)); };
      img.onerror = () => res(null); img.src = URL.createObjectURL(f); });
    inp.click(); }); }
  const viewPhoto = async id => { const d = await PH.get(id); if (!d) return toast('That photo is only on the device that took it'); const w = window.open(); if (w){ w.document.title = 'Receipt'; const im = w.document.createElement('img'); im.src = d; im.style.maxWidth = '100%'; w.document.body.append(im); } };

  // ---------- the quick log forms (used on the Log it screen and in store mode) ----------
  function forms(onDone){
    const t = T(), box = h('div',{class:'grid'});
    const tabs = [['trip','🚗 Trip'],['receipt','🧾 Receipt'],['writeoff','📦 Write-off'],['other','📝 Other']];
    let cur = 'trip';
    const bar = h('div',{class:'row',role:'tablist'}), body = h('div');
    const draw = () => { bar.replaceChildren(...tabs.map(([k,l]) => h('button',{class:'btn sm '+(k===cur?'':'quiet'),type:'button',role:'tab','aria-selected':String(k===cur),onclick:()=>{ cur = k; draw(); }}, l)));
      body.replaceChildren(({trip, receipt, writeoff, other})[cur]()); };
    const done = msg => { A.save(); toast(msg + (status() === 'ok' ? '' : ' A manager will check it.')); onDone ? onDone() : A.route(); };

    function trip(){
      const f = h('form',{class:'grid'},
        h('p',{class:'small muted'},'Driving for the business: bank, post office, picking up stock, a book fair. Not your commute from home to the store.'),
        h('div',{class:'row'}, t.places.map(p => h('button',{class:'btn ghost sm',type:'button',onclick:()=>{ f.to.value = p.n; f.mi.value = p.mi; f.why.focus(); }}, p.n+' · '+p.mi+' mi'))),
        h('label',{class:'f'},'Date', h('input',{type:'date',name:'date',value:isoDay(new Date()),required:true})),
        h('label',{class:'f'},'Where to', h('input',{type:'text',name:'to',maxlength:'80',required:true})),
        h('label',{class:'f'},'Business purpose', h('input',{type:'text',name:'why',maxlength:'120',required:true,placeholder:'e.g. Deposit and mail special orders'})),
        h('label',{class:'f'},'Miles (one way)', h('input',{type:'number',name:'mi',step:'0.1',min:'0.1',required:true})),
        h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'rt',checked:true}), 'Round trip (doubles the miles)'),
        h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'save'}), 'Save this place for one tap next time'),
        h('button',{class:'btn',type:'submit'},'Log trip'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), mi = +d.get('mi') * (d.get('rt') ? 2 : 1), to = String(d.get('to')).trim();
        t.trips.push({id:uid(), site:S().site, date:String(d.get('date')), to, why:String(d.get('why')).trim(), mi:Math.round(mi*10)/10, by:who(), status:status()});
        if (d.get('save') && !t.places.some(p => p.n.toLowerCase() === to.toLowerCase())) t.places.push({n:to, mi:+d.get('mi')});
        done('Trip logged: '+(Math.round(mi*10)/10)+' miles.'); });
      return f; }

    function receipt(){
      let photo = null; const pv = h('p',{class:'small muted'},'No photo yet.');
      const f = h('form',{class:'grid'},
        h('button',{class:'btn ghost',type:'button',onclick:async()=>{ photo = await takePhoto(); pv.textContent = photo ? '✓ Photo added' : 'No photo yet.'; }},'📷 Photo of the receipt'), pv,
        h('label',{class:'f'},'Date', h('input',{type:'date',name:'date',value:isoDay(new Date()),required:true})),
        h('label',{class:'f'},'Paid to', h('input',{type:'text',name:'payee',maxlength:'80',required:true,placeholder:'Store or company'})),
        h('label',{class:'f'},'Category', h('select',{name:'cat'}, A.D.EXP_CATS.map(c => h('option',null,c)))),
        h('label',{class:'f'},'Amount ($)', h('input',{type:'number',name:'amt',step:'0.01',min:'0',required:true})),
        h('label',{class:'f'},'Paid with', h('select',{name:'pay'}, ['Business card','Business account','Cash from the drawer','My own money (pay me back)'].map(x => h('option',null,x)))),
        h('label',{class:'f'},'What it was for', h('input',{type:'text',name:'note',maxlength:'120'})),
        h('p',{class:'small muted'},'Meals: write who you met and the business reason. Usually only half of a business meal counts.'),
        h('button',{class:'btn',type:'submit'},'Save receipt'));
      f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f), id = uid();
        let rid = null; if (photo){ try { await PH.put(id, photo); rid = id; } catch(err){ toast('The photo could not be saved on this device'); } }
        S().exp.push({id, site:S().site, date:String(d.get('date')), cat:String(d.get('cat')), amt:+d.get('amt'), note:String(d.get('note')||''), payee:String(d.get('payee')).trim(), pay:String(d.get('pay')), receipt:rid, by:who(), status:status()});
        done('Receipt saved.'); });
      return f; }

    function writeoff(){
      const f = h('form',{class:'grid'},
        h('p',{class:'small muted'},'Stock that left without a sale. Write it down the day it happens, with what it cost you.'),
        h('label',{class:'f'},'Date', h('input',{type:'date',name:'date',value:isoDay(new Date()),required:true})),
        h('label',{class:'f'},'What happened', h('select',{name:'why'}, Object.entries(REASONS).map(([k,l]) => h('option',{value:k},l)))),
        h('label',{class:'f'},'Item (title, ISBN or SKU)', h('input',{type:'text',name:'item',maxlength:'120',required:true})),
        h('label',{class:'f'},'How many', h('input',{type:'number',name:'qty',min:'1',value:'1',required:true})),
        h('label',{class:'f'},'Cost each ($, what you paid)', h('input',{type:'number',name:'cost',step:'0.01',min:'0'})),
        h('label',{class:'f'},'Given to (donations only)', h('input',{type:'text',name:'to',maxlength:'80',placeholder:'Charity, school or library'})),
        h('button',{class:'btn',type:'submit'},'Log write-off'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f);
        T().writeoffs.push({id:uid(), site:S().site, date:String(d.get('date')), why:String(d.get('why')), item:String(d.get('item')).trim(), qty:+d.get('qty')||1, cost:+d.get('cost')||0, to:String(d.get('to')||'').trim(), by:who(), status:status()});
        done('Write-off logged. Remember to lower the count in Shopify.'); });
      return f; }

    function other(){
      const ta = h('textarea',{name:'text',rows:'3',maxlength:'1000',required:true});
      const f = h('form',{class:'grid'},
        h('label',{class:'f'},'Type', h('select',{name:'kind'}, Object.entries(OTHER).map(([k,l]) => h('option',{value:k},l)))),
        h('label',{class:'f'},'Date', h('input',{type:'date',name:'date',value:isoDay(new Date()),required:true})),
        h('label',{class:'f'},'Amount ($, if any)', h('input',{type:'number',name:'amt',step:'0.01',min:'0'})),
        h('label',{class:'f'},'Details', ta), A.polishButton ? A.polishButton(ta, {kind:'update'}) : null,
        h('button',{class:'btn',type:'submit'},'Save'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f);
        T().notes.push({id:uid(), site:S().site, date:String(d.get('date')), kind:String(d.get('kind')), amt:+d.get('amt')||0, text:String(d.get('text')).trim(), by:who(), status:status()});
        done('Saved.'); });
      return f; }

    draw(); box.append(bar, body); return box;
  }
  // Store mode (shifts.js) shows this under the checklist.
  A.quickLog = () => h('details',{class:'card'}, h('summary',null, h('b',null,'Log a trip, receipt or write-off')), forms(() => A.route()));

  // ---------- screens ----------
  function logView(v){
    v.append(head('Tax records · '+A.site().name, 'Log it for the books', 'Trips, receipts, write-offs and anything your accountant will ask about. Takes a minute now, saves hours in April.'));
    v.append(h('div',{class:'card'}, forms()));
    const t = T(), pend = [...here(t.trips).map(x => ['Trip', x, x.date+' · '+x.mi+' mi to '+x.to+' · '+x.why]), ...here(S().exp).filter(x => x.status === 'pending').map(x => ['Receipt', x, x.date+' · '+money(x.amt)+' · '+(x.payee||'')+' · '+x.cat]),
      ...here(t.writeoffs).map(x => ['Write-off', x, x.date+' · '+x.qty+' × '+x.item+' · '+REASONS[x.why]]), ...here(t.notes).map(x => ['Note', x, x.date+' · '+OTHER[x.kind]+' · '+x.text.slice(0,80)])].filter(([,x]) => x.status === 'pending');
    if (isMgr()) v.append(h('div',{class:'card'}, h('h2',null,'Waiting for your OK'),
      pend.length ? h('div',{class:'list'}, pend.map(([k,x,txt]) => h('div',{class:'item'}, h('b',null,k), h('span',{class:'small'}, txt), h('span',{class:'small muted'},'Logged by '+x.by),
        h('div',{class:'row'}, x.receipt ? h('button',{class:'btn quiet sm',type:'button',onclick:()=>viewPhoto(x.receipt)},'See receipt') : null,
          h('button',{class:'btn sm',type:'button',onclick:()=>{ x.status = 'ok'; A.save(); A.route(); }},'Approve'),
          h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ x.status = 'no'; A.save(); A.route(); }},'Not business'))))) : h('p',{class:'muted'},'Nothing waiting.')));
  }

  function yearOf(){ const y = +(S().taxYear || new Date().getFullYear()); return y; }
  function mileage(v){
    const t = T(), y = String(yearOf());
    v.append(head('Tax records · '+A.site().name, 'Mileage log', 'The record the IRS asks for: date, destination, business purpose and miles for every trip.'));
    const trips = here(t.trips).filter(x => x.date.startsWith(y) && x.status === 'ok').sort((a,b) => a.date.localeCompare(b.date));
    const miles = trips.reduce((a,x) => a + x.mi, 0);
    v.append(h('div',{class:'card'}, h('h2',null, y+': '+miles.toLocaleString(undefined,{maximumFractionDigits:1})+' business miles'),
      h('p',null,'At '+money(t.rate)+' a mile that is about '+money(miles*t.rate)+'.'),
      h('p',{class:'small muted'},'The standard rate changes every January. Check the IRS rate for '+y+' and update it below. If you deduct mileage this way, you usually can\'t also deduct gas and repairs for that vehicle.'),
      isMgr() ? h('form',{class:'row',onsubmit:e=>{ e.preventDefault(); const d = new FormData(e.target); t.rate = +d.get('rate') || t.rate; t.vehicle = String(d.get('veh')||''); t.rateYear = +y; A.save(); toast('Saved'); A.route(); }},
        h('label',{class:'f'},'Rate per mile ($)', h('input',{type:'number',name:'rate',step:'0.005',min:'0',value:String(t.rate)})),
        h('label',{class:'f'},'Vehicle', h('input',{type:'text',name:'veh',maxlength:'60',value:t.vehicle,placeholder:'e.g. 2019 Subaru Outback'})),
        h('button',{class:'btn sm',type:'submit'},'Save')) : null,
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('mileage-log-'+y+'.csv','text/csv',toCsv([['Date','Destination','Business purpose','Miles','Driver','Vehicle'], ...trips.map(x => [x.date,x.to,x.why,x.mi,x.by,t.vehicle])]))},'Download mileage log (.csv)'))));
    v.append(h('div',{class:'card'}, h('h2',null,'Trips'), trips.length ? h('div',{class:'list'}, trips.slice().reverse().map(x => h('div',{class:'item'}, h('b',null, x.mi+' mi · '+x.to), h('span',{class:'small muted'}, A.fmtDate(x.date)+' · '+x.why+' · '+x.by)))) : h('p',{class:'muted'},'No trips logged for '+y+' yet.')));
  }

  function summary(v){
    const t = T(), y = String(yearOf()), inY = x => x.date && x.date.startsWith(y) && x.status !== 'pending' && x.status !== 'no';
    v.append(head('Tax records · all locations', 'Year-end summary', 'Everything logged for the year, in one place for your accountant. Record keeping only, not tax advice.'));
    const years = [...new Set([new Date().getFullYear(), new Date().getFullYear()-1, ...S().exp.map(x => +x.date.slice(0,4))])].sort((a,b) => b-a);
    v.append(h('label',{class:'f'},'Tax year', h('select',{onchange:e=>{ S().taxYear = +e.target.value; A.save(); A.route(); }}, years.map(n => h('option',{value:String(n),selected:String(n)===y},String(n))))));
    const ex = S().exp.filter(inY), byCat = {}; ex.forEach(x => byCat[x.cat] = (byCat[x.cat]||0) + x.amt);
    const trips = t.trips.filter(inY), miles = trips.reduce((a,x) => a + x.mi, 0);
    const wo = t.writeoffs.filter(inY), woBy = {}; wo.forEach(x => woBy[x.why] = (woBy[x.why]||0) + x.qty*x.cost);
    const notes = t.notes.filter(inY), owed = ex.filter(x => /own money/.test(x.pay||''));
    const noReceipt = ex.filter(x => x.amt >= 75 && !x.receipt).length;
    const sq = +(t.office.sqft||0), office = Math.min(sq, 300) * 5;
    v.append(h('div',{class:'card'}, h('h2',null,'Expenses by category'), Object.keys(byCat).length ? h('ul',null, Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([c,a]) => h('li',null, c+': '+money(a)+(/meal/i.test(c) ? ' (usually 50% counts: '+money(a/2)+')' : '')))) : h('p',{class:'muted'},'No expenses for '+y+'.'),
      noReceipt ? h('p',{class:'small'},'⚠ '+noReceipt+' expenses of $75 or more have no receipt photo.') : null,
      owed.length ? h('p',{class:'small'},'Paid with personal money (check they were paid back): '+money(owed.reduce((a,x) => a + x.amt, 0))) : null));
    v.append(h('div',{class:'card'}, h('h2',null,'Mileage'), h('p',null, miles.toLocaleString(undefined,{maximumFractionDigits:1})+' business miles · about '+money(miles*t.rate)+' at '+money(t.rate)+'/mile'), h('a',{href:'#/mileage'},'Open the mileage log')));
    v.append(h('div',{class:'card'}, h('h2',null,'Stock write-offs (at cost)'), Object.keys(woBy).length ? h('ul',null, Object.entries(woBy).map(([k,a]) => h('li',null, REASONS[k]+': '+money(a)))) : h('p',{class:'muted'},'None logged.'),
      h('p',{class:'small muted'},'Donations of stock to a qualified charity: keep the letter or receipt from them. Most stores deduct damaged or stolen stock through cost of goods sold; ask your accountant which way you file.')));
    v.append(h('div',{class:'card'}, h('h2',null,'Home office'), h('p',{class:'small muted'},'If you use part of your home only and regularly for the business. The simplified method is $5 a square foot, up to 300 square feet.'),
      isMgr() ? h('label',{class:'f'},'Square feet used only for the business', h('input',{type:'number',min:'0',max:'2000',value:String(sq||''),onchange:e=>{ t.office.sqft = +e.target.value||0; A.save(); A.route(); }})) : null,
      sq ? h('p',null,'Simplified method: about '+money(office)) : null));
    if (notes.length) v.append(h('div',{class:'card'}, h('h2',null,'Other notes for the books'), h('div',{class:'list'}, notes.map(x => h('div',{class:'item'}, h('b',null, OTHER[x.kind]+(x.amt ? ' · '+money(x.amt) : '')), h('span',{class:'small'}, x.text), h('span',{class:'small muted'}, A.fmtDate(x.date)+' · '+x.by))))));
    // exports
    const qb = () => download('quickbooks-expenses-'+y+'.csv','text/csv',toCsv([['Date','Payee','Account','Amount','Memo','Payment','Location'], ...ex.map(x => [x.date, x.payee||'', x.cat, x.amt.toFixed(2), x.note||'', x.pay||'', A.setupOf(x.site).name])]));
    const pack = () => download('tax-records-'+y+'.csv','text/csv',toCsv([['Section','Date','Item','Amount','Detail','Logged by'],
      ...ex.map(x => ['Expense', x.date, x.cat+(x.payee ? ' · '+x.payee : ''), x.amt.toFixed(2), (x.note||'')+(x.receipt ? ' (receipt photo)' : ''), x.by||'']),
      ...trips.map(x => ['Mileage', x.date, x.to, (x.mi*t.rate).toFixed(2), x.mi+' mi · '+x.why, x.by]),
      ...wo.map(x => ['Write-off', x.date, x.item, (x.qty*x.cost).toFixed(2), x.qty+' × '+REASONS[x.why]+(x.to ? ' · to '+x.to : ''), x.by]),
      ...notes.map(x => ['Note', x.date, OTHER[x.kind], x.amt ? x.amt.toFixed(2) : '', x.text, x.by]),
      ...(sq ? [['Home office', y+'-12-31', sq+' sq ft (simplified)', office.toFixed(2), '', '']] : [])]));
    v.append(h('div',{class:'card'}, h('h2',null,'Send to your accountant or QuickBooks'),
      h('p',{class:'small muted'},'The QuickBooks file lists each expense with its account, ready to map in QuickBooks\' import. The full records file has everything above in one sheet. Receipt photos stay on the device that took them for now.'),
      h('div',{class:'row'}, h('button',{class:'btn',type:'button',onclick:qb},'QuickBooks expenses (.csv)'), h('button',{class:'btn ghost',type:'button',onclick:pack},'Full tax records (.csv)'))));
  }

  A.register({id:'taxlog', name:'Tax records', what:'Mileage log, receipt photos, stock write-offs and notes for the books, logged during shifts. Year-end summary and QuickBooks-ready export.', tiers:['staff','lead','manager','owner'],
    views:{taxlog:{t:'Log it for the books', ic:'🗂️', render:logView}, mileage:{t:'Mileage log', ic:'🚗', render:mileage}, taxsum:{t:'Tax summary', ic:'📒', render:summary}}});
  A.ownerHooks.push(v => { const t = T(), y = String(new Date().getFullYear()), miles = t.trips.filter(x => x.date.startsWith(y) && x.status === 'ok').reduce((a,x) => a + x.mi, 0);
    const pend = [...t.trips, ...t.writeoffs, ...t.notes, ...S().exp].filter(x => x.status === 'pending').length;
    v.append(h('div',{class:'card'}, h('h2',null,'Tax records '+y), h('p',null, miles.toLocaleString(undefined,{maximumFractionDigits:1})+' business miles'+(pend ? ' · '+pend+' items waiting for your OK' : '')), h('a',{href:'#/taxsum'},'See the year-end summary'))); });
})();
