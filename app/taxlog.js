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
  // Write-offs and giveaways, grouped by how an accountant usually treats them. Managers and owners only.
  //   group: promo = advertising and promotion (at cost), charity = charitable gift (at cost, keep the letter),
  //          loss = inventory loss (usually through cost of goods sold), sales = discounts (lower sales, not an expense),
  //          giftcard = donated gift cards (no cost until redeemed; track what is still out).
  const REASONS = {
    promo:{l:'Free samples, candy or promo items', g:'promo'},
    sponsor:{l:'Event sponsorship (store named or shown)', g:'promo'},
    raffle:{l:'Raffle basket or prize for an event', g:'promo'},
    charity:{l:'Donation to a charity, school or library', g:'charity'},
    giftcard:{l:'Gift card donated (event, raffle, charity)', g:'giftcard'},
    discount:{l:'Discount or comp for a customer', g:'sales'},
    damaged:{l:'Damaged', g:'loss'}, stolen:{l:'Stolen or missing', g:'loss'}, expired:{l:'Expired or spoiled', g:'loss'}, used:{l:'Used in the store', g:'loss'},
    donated:{l:'Donated (older entry)', g:'charity'}, giveaway:{l:'Given away (older entry)', g:'promo'} };
  const GROUPS = {promo:'Advertising and promotion (at cost)', charity:'Charitable donations (at cost)', loss:'Inventory losses (at cost)', sales:'Discounts and comps (retail value, reduces sales)', giftcard:'Gift cards donated (face value still out)'};
  const rl = k => (REASONS[k] || {l:k}).l;
  const canWriteOff = () => MGR.includes(actorTier());
  const OTHER = {cashout:'Cash paid out of the drawer', homeoffice:'Home office or home storage', question:'Question for the accountant', other:'Something else for the books'};

  function T(){ const s = S(); s.tax = s.tax || {trips:[], writeoffs:[], notes:[], places:[], rate:0.70, rateYear:2025, vehicle:'', office:{sqft:0, method:'simplified'}};
    const t = s.tax; ['trips','writeoffs','notes','places'].forEach(k => t[k] = t[k] || []);
    s.writeoffs = s.writeoffs || []; if (t.writeoffs.length){ s.writeoffs.push(...t.writeoffs); t.writeoffs = []; }
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
    const tabs = [['trip','🚗 Trip'],['receipt','🧾 Receipt']].concat(canWriteOff() ? [['writeoff','🎁 Write-off or giveaway']] : []).concat([['other','📝 Other']]);
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
      if (!canWriteOff()) return h('p',{class:'muted'},'Only a store manager or the owner records write-offs and giveaways.');
      let photo = null; const pv = h('span',{class:'small muted'},'');
      const f = h('form',{class:'grid'},
        h('p',{class:'small muted'},'Anything that leaves without a full sale: candy and samples, raffle baskets, gift cards for events, donations, discounts, damaged or stolen stock. Record it the day it happens.'),
        h('label',{class:'f'},'Date', h('input',{type:'date',name:'date',value:isoDay(new Date()),required:true})),
        h('label',{class:'f'},'What happened', h('select',{name:'why',onchange:()=>show()}, Object.entries(REASONS).filter(([k]) => k !== 'donated' && k !== 'giveaway').map(([k,r]) => h('option',{value:k},r.l)))),
        h('label',{class:'f'},'Item or items', h('input',{type:'text',name:'item',maxlength:'160',required:true,placeholder:'e.g. Fig candy bags, 3 novels and a mug'})),
        h('label',{class:'f qty'},'How many', h('input',{type:'number',name:'qty',min:'1',value:'1',required:true})),
        h('label',{class:'f cost'},'Cost each ($, what you paid)', h('input',{type:'number',name:'cost',step:'0.01',min:'0'})),
        h('label',{class:'f retail'},'Retail value each ($, optional)', h('input',{type:'number',name:'retail',step:'0.01',min:'0'})),
        h('label',{class:'f gc',hidden:true},'Gift card amount ($)', h('input',{type:'number',name:'face',step:'0.01',min:'0'})),
        h('label',{class:'f to'},'Given to or event', h('input',{type:'text',name:'to',maxlength:'100',placeholder:'Charity, school, event or customer'})),
        h('label',{class:'checkrow c501',hidden:true}, h('input',{type:'checkbox',name:'c501'}), 'They are a registered charity (501(c)(3)) and gave a receipt or letter'),
        h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:async()=>{ photo = await takePhoto(); pv.textContent = photo ? '✓ Photo added' : ''; }},'📷 Photo (letter, receipt or the items)'), pv),
        h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'stock',checked:true}), 'It came out of stock (lower the count in Shopify)'),
        h('p',{class:'small muted tip'},''),
        h('button',{class:'btn',type:'submit'},'Save'));
      const TIPS = {promo:'Usually advertising: what it cost you.', sponsor:'Usually advertising when the store is named or shown. Keep a photo of the sign or program.', raffle:'Advertising if it promotes the store; a donation if it goes to a charity. Note which.',
        charity:'For stock given to a charity, the deduction is usually what it cost you. Keep their letter or receipt.', giftcard:'A donated gift card costs nothing until someone uses it. Track it here; it shows as still out.',
        discount:'A discount lowers the sale; it is not an expense. Ring it in the register too so sales are right.', damaged:'Usually goes through cost of goods sold. Lower the Shopify count.', stolen:'Usually goes through cost of goods sold. Lower the Shopify count.', expired:'Usually goes through cost of goods sold.', used:'Supplies taken from stock for the store.'};
      const q = sel => f.querySelector(sel);
      function show(){ const k = f.why.value, g = REASONS[k].g;
        q('.gc').hidden = g !== 'giftcard'; q('.qty').hidden = q('.cost').hidden = g === 'giftcard'; q('.c501').hidden = !(g === 'charity' || k === 'raffle'); q('.tip').textContent = TIPS[k] || '';
        f.stock.checked = g !== 'giftcard' && g !== 'sales'; }
      show();
      f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f), id = uid(), k = String(d.get('why'));
        let pid = null; if (photo){ try { await PH.put(id, photo); pid = id; } catch(err){} }
        S().writeoffs.push({id, site:S().site, date:String(d.get('date')), why:k, item:String(d.get('item')).trim(), qty:REASONS[k].g === 'giftcard' ? 1 : (+d.get('qty')||1), cost:REASONS[k].g === 'giftcard' ? 0 : (+d.get('cost')||0),
          retail:+d.get('retail')||0, face:+d.get('face')||0, to:String(d.get('to')||'').trim(), c501:!!d.get('c501'), stock:!!d.get('stock'), photo:pid, redeemed:0, by:who(), status:'ok'});
        done(d.get('stock') ? 'Saved. Remember to lower the count in Shopify.' : 'Saved.'); });
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
      ...here(S().writeoffs).map(x => ['Write-off', x, x.date+' · '+x.qty+' × '+x.item+' · '+rl(x.why)]), ...here(t.notes).map(x => ['Note', x, x.date+' · '+OTHER[x.kind]+' · '+x.text.slice(0,80)])].filter(([,x]) => x.status === 'pending');
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
    const wo = (S().writeoffs || []).filter(inY), woBy = {}, gc = [];
    wo.forEach(x => { const g = (REASONS[x.why] || {g:'loss'}).g; if (g === 'giftcard'){ gc.push(x); return; } woBy[g] = woBy[g] || {cost:0, retail:0, n:0}; woBy[g].cost += x.qty*x.cost; woBy[g].retail += x.qty*(x.retail||0); woBy[g].n++; });
    const noLetter = wo.filter(x => (REASONS[x.why] || {}).g === 'charity' && !x.c501).length;
    const notes = t.notes.filter(inY), owed = ex.filter(x => /own money/.test(x.pay||''));
    const noReceipt = ex.filter(x => x.amt >= 75 && !x.receipt).length;
    const sq = +(t.office.sqft||0), office = Math.min(sq, 300) * 5;
    v.append(h('div',{class:'card'}, h('h2',null,'Expenses by category'), Object.keys(byCat).length ? h('ul',null, Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([c,a]) => h('li',null, c+': '+money(a)+(/meal/i.test(c) ? ' (usually 50% counts: '+money(a/2)+')' : '')))) : h('p',{class:'muted'},'No expenses for '+y+'.'),
      noReceipt ? h('p',{class:'small'},'⚠ '+noReceipt+' expenses of $75 or more have no receipt photo.') : null,
      owed.length ? h('p',{class:'small'},'Paid with personal money (check they were paid back): '+money(owed.reduce((a,x) => a + x.amt, 0))) : null));
    v.append(h('div',{class:'card'}, h('h2',null,'Mileage'), h('p',null, miles.toLocaleString(undefined,{maximumFractionDigits:1})+' business miles · about '+money(miles*t.rate)+' at '+money(t.rate)+'/mile'), h('a',{href:'#/mileage'},'Open the mileage log')));
    v.append(h('div',{class:'card'}, h('h2',null,'Write-offs and giveaways'),
      Object.keys(woBy).length || gc.length ? h('ul',null, Object.entries(woBy).map(([g,a]) => h('li',null, GROUPS[g]+': '+(g === 'sales' ? money(a.retail) : money(a.cost))+' · '+a.n+' entr'+(a.n===1?'y':'ies'))),
        gc.length ? h('li',null, GROUPS.giftcard+': '+money(gc.reduce((a,x) => a + x.face - (x.redeemed||0), 0))+' of '+money(gc.reduce((a,x) => a + x.face, 0))+' donated') : null) : h('p',{class:'muted'},'None logged.'),
      noLetter ? h('p',{class:'small'},'⚠ '+noLetter+' donation'+(noLetter>1?'s':'')+' without a charity receipt or letter marked.') : null,
      gc.length && isMgr() ? h('details',null, h('summary',null,'Mark donated gift cards as used'), h('div',{class:'list'}, gc.map(x => h('div',{class:'item'}, h('b',null, money(x.face)+' · '+(x.to||x.item)), h('span',{class:'small muted'}, A.fmtDate(x.date)+(x.redeemed ? ' · '+money(x.redeemed)+' used' : ' · not used yet')),
        h('label',{class:'f'},'Amount used so far ($)', h('input',{type:'number',step:'0.01',min:'0',max:String(x.face),value:String(x.redeemed||''),onchange:e=>{ x.redeemed = Math.min(x.face, +e.target.value||0); A.save(); A.route(); }})))))) : null,
      h('p',{class:'small muted'},'Your accountant decides the final treatment. Charities: keep their letter. Discounts: ring them in the register too.')));
    v.append(h('div',{class:'card'}, h('h2',null,'Home office'), h('p',{class:'small muted'},'If you use part of your home only and regularly for the business. The simplified method is $5 a square foot, up to 300 square feet.'),
      isMgr() ? h('label',{class:'f'},'Square feet used only for the business', h('input',{type:'number',min:'0',max:'2000',value:String(sq||''),onchange:e=>{ t.office.sqft = +e.target.value||0; A.save(); A.route(); }})) : null,
      sq ? h('p',null,'Simplified method: about '+money(office)) : null));
    if (notes.length) v.append(h('div',{class:'card'}, h('h2',null,'Other notes for the books'), h('div',{class:'list'}, notes.map(x => h('div',{class:'item'}, h('b',null, OTHER[x.kind]+(x.amt ? ' · '+money(x.amt) : '')), h('span',{class:'small'}, x.text), h('span',{class:'small muted'}, A.fmtDate(x.date)+' · '+x.by))))));
    // exports
    const qb = () => download('quickbooks-expenses-'+y+'.csv','text/csv',toCsv([['Date','Payee','Account','Amount','Memo','Payment','Location'], ...ex.map(x => [x.date, x.payee||'', x.cat, x.amt.toFixed(2), x.note||'', x.pay||'', A.setupOf(x.site).name])]));
    const pack = () => download('tax-records-'+y+'.csv','text/csv',toCsv([['Section','Date','Item','Amount','Detail','Logged by'],
      ...ex.map(x => ['Expense', x.date, x.cat+(x.payee ? ' · '+x.payee : ''), x.amt.toFixed(2), (x.note||'')+(x.receipt ? ' (receipt photo)' : ''), x.by||'']),
      ...trips.map(x => ['Mileage', x.date, x.to, (x.mi*t.rate).toFixed(2), x.mi+' mi · '+x.why, x.by]),
      ...wo.map(x => ['Write-off: '+GROUPS[(REASONS[x.why]||{g:'loss'}).g], x.date, x.item, ((REASONS[x.why]||{}).g === 'giftcard' ? x.face : (REASONS[x.why]||{}).g === 'sales' ? x.qty*(x.retail||0) : x.qty*x.cost).toFixed(2), x.qty+' × '+rl(x.why)+(x.to ? ' · to '+x.to : '')+(x.c501 ? ' · charity letter' : '')+(x.photo ? ' (photo)' : ''), x.by]),
      ...notes.map(x => ['Note', x.date, OTHER[x.kind], x.amt ? x.amt.toFixed(2) : '', x.text, x.by]),
      ...(sq ? [['Home office', y+'-12-31', sq+' sq ft (simplified)', office.toFixed(2), '', '']] : [])]));
    v.append(h('div',{class:'card'}, h('h2',null,'Send to your accountant or QuickBooks'),
      h('p',{class:'small muted'},'The QuickBooks file lists each expense with its account, ready to map in QuickBooks\' import. The full records file has everything above in one sheet. Receipt photos stay on the device that took them for now.'),
      h('div',{class:'row'}, h('button',{class:'btn',type:'button',onclick:qb},'QuickBooks expenses (.csv)'), h('button',{class:'btn ghost',type:'button',onclick:pack},'Full tax records (.csv)'))));
  }

  A.register({id:'taxlog', name:'Tax records', what:'Mileage log, receipt photos, stock write-offs and notes for the books, logged during shifts. Year-end summary and QuickBooks-ready export.', tiers:['staff','lead','manager','owner'],
    views:{taxlog:{t:'Log it for the books', ic:'🗂️', render:logView}, mileage:{t:'Mileage log', ic:'🚗', render:mileage}, taxsum:{t:'Tax summary', ic:'📒', render:summary}}});
  A.ownerHooks.push(v => { const t = T(), y = String(new Date().getFullYear()), miles = t.trips.filter(x => x.date.startsWith(y) && x.status === 'ok').reduce((a,x) => a + x.mi, 0);
    const pend = [...t.trips, ...(S().writeoffs||[]), ...t.notes, ...S().exp].filter(x => x.status === 'pending').length;
    v.append(h('div',{class:'card'}, h('h2',null,'Tax records '+y), h('p',null, miles.toLocaleString(undefined,{maximumFractionDigits:1})+' business miles'+(pend ? ' · '+pend+' items waiting for your OK' : '')), h('a',{href:'#/taxsum'},'See the year-end summary'))); });
})();
