// Opportunities (store manager and owner): grants, loans, tax credits, rebates and free help matched to this store.
//   - Set where the store is and a few yes/no facts (downtown? own the building? hiring?). The list matches itself:
//     "Good fit", "Maybe" (with what to check) or "Not now" (with why).
//   - Each one shows the amount, the next deadline, what the application needs, and the hidden effects.
//   - Net effect sliders: what a grant really leaves you after the match and tax, what a loan really costs per year
//     (including fees, and Shopify Capital style "% of daily sales" loans), what a rebate or credit is worth.
//   - Track status, set a reminder, add it to your calendar. Owners can add their own local programs.
// The catalog lives in opps-data.js (add other towns and states there). Saved in the private shared area 'opps'
// (supabase/opportunities.sql); until that has run it stays on this device.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, uid, isoDay, money} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier) && (A.demo || MGR.includes(A.myRole));
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');
  const today = () => isoDay(new Date());
  const r0 = n => Math.round(n);
  const usd = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const pctf = n => (Math.round(n*10)/10) + '%';

  const KIND = {grant:['Grant','🎁'], loan:['Loan','🏦'], credit:['Tax credit','🧾'], rebate:['Rebate','💡'], help:['Free help','🤝']};
  const PLURAL = {grant:'Grants', loan:'Loans', credit:'Tax credits', rebate:'Rebates', help:'Free help'};
  const STATUS = ['Not started','Looking into it','Applying','Sent','Won','Passed'];

  // ---------- saved state ----------
  function O(){ const s = S(); s.opps = s.opps || {}; const o = s.opps;
    o.profile = o.profile || {}; o.track = o.track || {}; o.custom = o.custom || []; o.kit = o.kit || {}; return o; }
  const BLANK = {state:'', county:'', city:'', downtown:'unsure', owns:'no', historic:'unsure', hiring:'no', jobs:'yes', partner:'no', tax:29};
  function profile(){ const o = O(), id = S().site;
    if (!o.profile[id]){
      // The demo's first store is the Blessed Fig Tree in downtown Antigo; every other store starts blank.
      const fig = /blessed fig/i.test(A.site().name);
      o.profile[id] = Object.assign({}, BLANK, fig ? {state:'WI', county:'Langlade', city:'Antigo', downtown:'yes'} : {});
    }
    return o.profile[id]; }
  const trackOf = id => { const o = O(), k = S().site+':'+id; return o.track[k] = o.track[k] || {status:'Not started', done:{}}; };
  const norm = s => String(s||'').trim().toLowerCase().replace(/\s+county$/,'');

  function catalog(){
    const p = profile(), type = A.site().type;
    const mine = O().custom.filter(c => c.site === S().site).map(c => Object.assign({custom:true}, c));
    return (window.OPPS_CATALOG || []).concat(mine).filter(o => {
      if (o.types && !o.types.includes(type)) return false;
      const w = o.where || {};
      if (w.state && norm(w.state) !== norm(p.state)) return false;
      if (w.county && norm(w.county) !== norm(p.county)) return false;
      if (w.city && norm(w.city) !== norm(p.city)) return false;
      return true;
    });
  }

  // ---------- fit ----------
  function fit(o){
    const p = profile(), q = o.req || {}, no = [], maybe = [];
    if (q.downtown){ if (p.downtown === 'no') no.push('Only for shops inside the downtown district.'); else if (p.downtown !== 'yes') maybe.push('Check that the shop is inside the downtown map.'); }
    if (q.ownsBuilding && p.owns !== 'yes') no.push('Fits when you own or buy the building.');
    if (q.historic){ if (p.historic === 'no') no.push('Only for historic buildings.'); else if (p.historic !== 'yes') maybe.push('Check whether the building is historic.'); }
    if (q.hiring && p.hiring !== 'yes') no.push('Only matters when you hire.');
    if (q.jobs && p.jobs !== 'yes') maybe.push('Usually needs you to add or keep a full-time job.');
    if (q.forProfitDirect === false && p.partner !== 'yes') maybe.push('A nonprofit, library or the city has to apply with you.');
    if (o.fitNote) maybe.push(o.fitNote);
    if (o.check) maybe.push('Confirm it is still open before you count on it.');
    return {level: no.length ? 'no' : maybe.length ? 'maybe' : 'good', why: no.concat(maybe)};
  }
  const FIT = {good:['Good fit','calm'], maybe:['Maybe','amber'], no:['Not now','grey']};

  // ---------- deadlines ----------
  function nextDue(o){
    const t = today(), y = +t.slice(0,4);
    if (o.due) return o.due >= t ? {date:o.due} : null;
    if (o.windows){
      const c = [];
      for (const yr of [y, y+1]) o.windows.forEach(([a,b]) => { const close = yr+'-'+b, open = yr+'-'+a; if (close >= t) c.push({date:close, open: open > t ? open : null}); });
      c.sort((a,b) => a.date < b.date ? -1 : 1); return c[0] || null;
    }
    return null;
  }
  function dueText(o){
    const n = nextDue(o);
    if (n) return (n.open ? 'Opens '+A.fmtDate(n.open)+', due ' : 'Due ')+A.fmtDate(n.date);
    return o.rolling ? 'Anytime' : 'No date set';
  }
  const daysTo = d => Math.round((new Date(d+'T12:00:00') - new Date(today()+'T12:00:00')) / 864e5);

  // ---------- money math ----------
  const pmt = (P, yr, n) => { const i = yr/1200; return i ? P*i/(1-Math.pow(1+i,-n)) : P/n; };
  // yearly rate that makes the payments worth what you actually got in hand
  function trueRate(got, pay, n, perYear){
    let lo = 0, hi = 5; const pv = i => i ? pay*(1-Math.pow(1+i,-n))/i : pay*n;
    if (pv(0) <= got) return 0;
    for (let k = 0; k < 80; k++){ const m = (lo+hi)/2; if (pv(m) > got) lo = m; else hi = m; }
    return lo*perYear*100;
  }

  // Sliders: each returns its rows and a list of hidden effects, recomputed on every move.
  function slider(label, val, min, max, step, fmt, on){
    const out = h('b',null,fmt(val));
    const inp = h('input',{type:'range',min:String(min),max:String(max),step:String(step),value:String(val),'aria-label':label,
      oninput:e=>{ const x = +e.target.value; out.textContent = fmt(x); on(x); }});
    return h('label',{class:'f'}, h('span',null,label+': ', out), inp);
  }
  function table(rows){ return h('table',{class:'tbl'}, h('tbody',null, rows.map(([a,b,strong]) => h('tr',null, h('td',null,a), h('td',null, strong ? h('b',null,b) : b))))); }

  function netEffect(o, box){
    const p = profile(), tax = (+p.tax || 0)/100, res = h('div'), notes = h('ul',{class:'small'});
    const put = (rows, extra) => { res.replaceChildren(table(rows)); notes.replaceChildren(...(extra||[]).concat(o.hidden||[]).map(t => h('li',null,t))); };
    const sl = h('div',{class:'grid'});
    box.append(h('h2',null,'Net effect'), sl, res, h('h3',null,'Hidden effects'), notes,
      h('p',{class:'small muted'},'Estimates only. Tax rate '+(+p.tax||0)+'% (change it under "About your store"). Ask your accountant before you decide.'));

    if (o.kind === 'grant' && o.share){
      const v = {cost: Math.min(20000, Math.max(1000, r0((o.max||5000)/o.share)))};
      const draw = () => { const g = Math.min(o.max || Infinity, v.cost*o.share), you = v.cost - g, t = g*tax;
        put([['Project cost', usd(v.cost)], ['Grant pays', usd(g), true], ['You pay', usd(you)], ['Tax on the grant (est.)', usd(t)],
             ['What the grant leaves you', usd(g - t), true], ['Cash you need up front', usd(o.reimburse ? v.cost : you)]],
          [g >= (o.max||Infinity) ? 'You are at the cap: spending more adds no grant.' : 'Below the cap: each extra $1 of project adds '+usd(o.share*100).replace('$','')+'¢ of grant.']); };
      sl.append(slider('Project cost', v.cost, 500, Math.max(20000, r0((o.max||5000)/o.share*2)), 250, usd, x => { v.cost = x; draw(); })); draw();
    } else if (o.kind === 'loan'){
      const v = {amt: Math.min(o.max || 20000, 20000), rate: o.rate || 10, months: o.months || 60, fee: o.fee || 0, sales: avgDay || 500, hold: 25, sfee: 11.7};
      const draw = () => {
        const pay = pmt(v.amt, v.rate, v.months), total = pay*v.months, interest = total - v.amt, fees = v.amt*v.fee/100;
        const rTrue = trueRate(v.amt - fees, pay, v.months, 12);
        // Shopify Capital style: a flat fee, paid back as a share of each day's sales
        const sTotal = v.amt*(1+v.sfee/100), perDay = v.sales*v.hold/100, days = Math.ceil(sTotal/Math.max(1, perDay));
        const sRate = trueRate(v.amt, sTotal/days, days, 365);
        put([['Monthly payment', usd(pay), true], ['Interest over the loan', usd(interest)], ['Fees at closing', usd(fees)],
             ['Total cost of the money', usd(interest + fees), true], ['True yearly rate with fees', pctf(rTrue), true],
             ['Tax saved (interest and fees are write-offs)', usd((interest+fees)*tax)],
             ['— Same amount as a "% of daily sales" loan', ''], ['Flat fee', usd(sTotal - v.amt)], ['Paid off in', days+' days (about '+Math.round(days/30)+' months)'],
             ['Its true yearly rate', pctf(sRate), true], ['— Same amount as a grant', ''], ['Payback', '$0'], ['Tax on it (est.)', usd(v.amt*tax)]],
          ['The loan itself is not income and paying it back is not a write-off; only interest and fees are.',
           'A smaller fee paid back fast can cost more per year than a bigger interest bill paid over years.',
           'A fixed monthly payment is due in slow months too; a % of sales loan takes a bite out of every good day.']); };
      sl.append(slider('Amount', v.amt, 1000, Math.max(5000, Math.min(o.max || 50000, 150000)), 500, usd, x => { v.amt = x; draw(); }),
        slider('Yearly rate', v.rate, 0, 25, 0.25, pctf, x => { v.rate = x; draw(); }),
        slider('Months to pay', v.months, 6, 144, 6, x => x+' months', x => { v.months = x; draw(); }),
        slider('Fees at closing', v.fee, 0, 10, 0.5, pctf, x => { v.fee = x; draw(); }),
        slider('Your average sales per day (for the % of sales comparison)', v.sales, 100, 5000, 50, usd, x => { v.sales = x; draw(); }));
      draw();
    } else if (o.kind === 'rebate' && o.per){
      const v = {}; o.per.forEach(([t]) => v[t] = 0);
      const draw = () => { const rows = o.per.filter(([t]) => v[t]).map(([t,each]) => [v[t]+' × '+t, usd(v[t]*each)]); const sum = o.per.reduce((a,[t,each]) => a + v[t]*each, 0);
        put(rows.concat([['Rebate total', usd(sum), true], ['Tax on it (est.)', usd(sum*tax)]]), ['Rebates lower what you paid, so the write-off for the equipment is smaller by the same amount.']); };
      o.per.forEach(([t,each]) => sl.append(slider(t+' ('+usd(each)+' each)', 0, 0, 60, 1, String, x => { v[t] = x; draw(); }))); draw();
    } else if (o.kind === 'credit'){
      const v = {amt: o.max || 10000};
      const label = o.pct ? 'Rehab cost' : 'Credit';
      const draw = () => { const c = o.pct ? v.amt*o.pct/100 : v.amt;
        put([['Tax credit', usd(c), true], ['Same dollars as a write-off would save', usd(c*tax)], ['Extra value of a credit', usd(c - c*tax)]],
          ['A credit comes off the tax you owe, dollar for dollar. A write-off only lowers the income the tax is figured on.']); };
      sl.append(slider(label, v.amt, o.pct ? 50000 : 0, o.pct ? 1000000 : Math.max(2400, o.max||2400), o.pct ? 5000 : 100, usd, x => { v.amt = x; draw(); })); draw();
    } else {
      put([['Cost to you', o.max ? usd(o.max) : '$0, or a small group fee']], []);
    }
  }

  // the store's average sales per day from Shopify (last 30 days), for the "% of daily sales" comparison
  let avgDay = null;
  async function loadSales(){
    if (A.demo || !A.sb || avgDay !== null) return;
    try { const r = await A.sb.from('shopify_sales_day').select('net').order('day',{ascending:false}).limit(30);
      avgDay = r.data && r.data.length ? Math.round(r.data.reduce((a,b) => a + (+b.net||0), 0) / r.data.length) : 0; } catch(e){ avgDay = 0; }
  }

  // ---------- list ----------
  let filter = 'all', showNo = false;
  function list(v){
    v.append(head('Store manager and owner', 'Opportunities', 'Grants, loans, tax credits, rebates and free help matched to this store, with deadlines and what each one really leaves you.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can see opportunities.')); return; }
    if (!A.demo && A.sync && A.sync.oppsOk && !A.sync.oppsOk()) v.append(h('div',{class:'msg'},'Saved on this device only until the owner runs supabase/opportunities.sql.'));
    const p = profile();

    // about your store
    const sel = (k, label, opts) => h('label',{class:'f'}, label, h('select',{onchange:e=>{ p[k] = e.target.value; A.save(); A.route(); }},
      opts.map(([val,t]) => h('option',{value:val,selected:p[k]===val},t))));
    const txt = (k, label, ph) => h('label',{class:'f'}, label, h('input',{type:'text',maxlength:'40',value:p[k]||'',placeholder:ph,onchange:e=>{ p[k] = e.target.value.trim(); A.save(); A.route(); }}));
    const yn = [['yes','Yes'],['no','No'],['unsure','Not sure']];
    const where = [p.city, p.county && p.county+' County', p.state].filter(Boolean).join(', ');
    v.append(h('details',{class:'card help',open:!p.state}, h('summary',null,'About your store'+(where ? ': '+where : '')),
      h('p',{class:'small muted'},'These answers decide what shows as a good fit. Nothing leaves the app.'),
      h('div',{class:'grid g3'}, txt('state','State (2 letters)','WI'), txt('county','County','Langlade'), txt('city','City or town','Antigo'),
        sel('downtown','In the downtown district?',yn), sel('owns','Own the building?',yn.slice(0,2)), sel('historic','Historic building?',yn),
        sel('hiring','Hiring in the next year?',yn.slice(0,2)), sel('jobs','Adding or keeping a full-time job?',yn.slice(0,2)), sel('partner','Have a nonprofit partner (library, museum)?',yn.slice(0,2)),
        h('label',{class:'f'},'Tax rate on extra profit (%)', h('input',{type:'number',min:'0',max:'60',step:'1',value:String(p.tax),onchange:e=>{ p.tax = Math.max(0, Math.min(60, +e.target.value||0)); A.save(); }})))));
    if (!p.state) v.append(h('div',{class:'msg'},'Add your state, county and town to see local programs. Nationwide ones show below.'));

    const all = catalog().map(o => ({o, f:fit(o), n:nextDue(o), t:trackOf(o.id)}));
    // coming up
    const soon = all.filter(x => !['Won','Passed'].includes(x.t.status) && ((x.n && daysTo(x.n.date) <= 60 && x.f.level !== 'no') || (x.t.remind && x.t.remind <= A.addDays(today(), 14))))
      .sort((a,b) => (a.t.remind || (a.n && a.n.date) || '9') < (b.t.remind || (b.n && b.n.date) || '9') ? -1 : 1);
    if (soon.length) v.append(h('div',{class:'card'}, h('h2',null,'Coming up'), h('div',{class:'list'}, soon.map(x => h('a',{class:'item',href:'#/opp/'+x.o.id,style:'display:block;text-decoration:none;color:inherit'},
      h('b',null,x.o.name), h('div',{class:'small muted'}, (x.t.remind ? 'Reminder '+A.fmtDate(x.t.remind)+' · ' : '') + dueText(x.o)))))));

    // filters
    const fb = (k, t) => h('button',{class:'chip',type:'button','aria-pressed':String(filter===k),onclick:()=>{ filter = k; A.route(); }},t);
    v.append(h('div',{class:'chips',role:'group','aria-label':'Show'}, fb('all','All'), Object.entries(PLURAL).map(([k,t]) => fb(k,t)),
      h('button',{class:'chip',type:'button','aria-pressed':String(showNo),onclick:()=>{ showNo = !showNo; A.route(); }},'Show "not now"')));

    const order = {good:0, maybe:1, no:2};
    const shown = all.filter(x => (filter === 'all' || x.o.kind === filter) && (showNo || x.f.level !== 'no'))
      .sort((a,b) => order[a.f.level]-order[b.f.level] || (b.o.max||0)-(a.o.max||0));
    const hiddenN = all.filter(x => x.f.level === 'no' && (filter === 'all' || x.o.kind === filter)).length;
    v.append(h('div',{class:'card'}, shown.length ? h('div',{class:'list'}, shown.map(x => h('a',{class:'item',href:'#/opp/'+x.o.id,style:'display:block;text-decoration:none;color:inherit'},
      h('span',{'aria-hidden':'true'},KIND[x.o.kind][1]+' '), h('b',null,x.o.name), ' ', h('span',{class:'chip '+FIT[x.f.level][1]},FIT[x.f.level][0]),
      x.t.status !== 'Not started' ? h('span',{class:'chip grey'},x.t.status) : null,
      h('div',{class:'small'}, x.o.amount), h('div',{class:'small muted'}, KIND[x.o.kind][0]+' · '+dueText(x.o) + (x.f.why[0] ? ' · '+x.f.why[0] : ''))))) : h('p',{class:'muted'},'Nothing here yet.'),
      !showNo && hiddenN ? h('p',{class:'small muted'}, hiddenN+' more marked "not now". ') : null));

    // paperwork kit
    const kit = O().kit[S().site] = O().kit[S().site] || {};
    const items = window.OPPS_KIT || [];
    v.append(h('div',{class:'card'}, h('h2',null,'Paperwork kit ('+items.filter((_,i) => kit[i]).length+' of '+items.length+')'),
      h('p',{class:'small muted'},'Most applications ask for the same pile. Gather it once.'),
      items.map((t,i) => h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:!!kit[i],onchange:e=>{ kit[i] = e.target.checked; A.save(); }}), t))));

    // calendar + add your own
    const dated = all.filter(x => x.f.level !== 'no' && !['Won','Passed'].includes(x.t.status));
    v.append(h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:()=>{
      const ev = []; dated.forEach(x => { if (x.n) ev.push({id:'opp-'+x.o.id, date:x.n.date, title:'Due: '+x.o.name, note:x.o.amount, link:'#/opp/'+x.o.id});
        if (x.t.remind) ev.push({id:'oppr-'+x.o.id, date:x.t.remind, title:'Reminder: '+x.o.name, note:x.t.notes||'', link:'#/opp/'+x.o.id}); });
      if (!ev.length) return toast('No dates to add yet'); A.download('opportunities.ics','text/calendar',A.toIcs(ev)); }},'Add deadlines to my calendar')));
    if (isOwner()) v.append(addForm());
    v.append(h('p',{class:'small muted'},'Programs checked Nov 28, 2026. Amounts and dates change; open the link before you apply.'));
  }

  function addForm(){
    const f = {name:h('input',{type:'text',maxlength:'100'}), kind:h('select',null, Object.entries(KIND).map(([k,[t]]) => h('option',{value:k},t))),
      amount:h('input',{type:'text',maxlength:'120',placeholder:'Up to $2,000'}), max:h('input',{type:'number',min:'0',step:'100'}),
      due:h('input',{type:'date'}), link:h('input',{type:'url',maxlength:'300',placeholder:'https://'}), who:h('input',{type:'text',maxlength:'200'})};
    return h('details',{class:'card help'}, h('summary',null,'Add a local program'),
      h('p',{class:'small muted'},'A town fund, a foundation, a chamber prize: anything this store could use.'),
      h('div',{class:'grid g2'}, h('label',{class:'f'},'Name',f.name), h('label',{class:'f'},'Kind',f.kind), h('label',{class:'f'},'Amount, in words',f.amount),
        h('label',{class:'f'},'Largest amount ($)',f.max), h('label',{class:'f'},'Deadline',f.due), h('label',{class:'f'},'Who can apply',f.who), h('label',{class:'f'},'Link',f.link)),
      h('button',{class:'btn sm',type:'button',onclick:()=>{ const name = f.name.value.trim(); if (!name) return toast('Give it a name');
        const link = /^https:\/\//.test(f.link.value.trim()) ? f.link.value.trim() : '';
        const max = +f.max.value || 0, kind = f.kind.value;
        O().custom.push({id:'c-'+uid(), site:S().site, name, kind, amount:f.amount.value.trim() || (max ? 'Up to '+usd(max) : ''), max, due:f.due.value || null, rolling:!f.due.value,
          who:f.who.value.trim(), link, share: kind === 'grant' ? 0.5 : undefined, rate: kind === 'loan' ? 8 : undefined, months: kind === 'loan' ? 60 : undefined, hidden:[], needs:[]});
        A.save(); toast('Added'); A.route(); }},'Add'));
  }

  // ---------- one opportunity ----------
  function one(v){
    v.append(h('a',{class:'small',href:'#/opps'},'← All opportunities'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can see opportunities.')); return; }
    const o = catalog().find(x => x.id === A.param()) || (window.OPPS_CATALOG||[]).find(x => x.id === A.param());
    if (!o){ v.append(h('div',{class:'card'},'That opportunity was not found for this store.')); return; }
    const f = fit(o), t = trackOf(o.id);
    v.append(h('div',{class:'card'}, h('span',{class:'eyebrow'},KIND[o.kind][1]+' '+KIND[o.kind][0]), h('h1',null,o.name),
      h('p',null, h('span',{class:'chip '+FIT[f.level][1]},FIT[f.level][0]), ' ', h('b',null,o.amount)),
      f.why.length ? h('ul',{class:'small'}, f.why.map(w => h('li',null,w))) : null,
      table([['Who can apply', o.who||''], ['Deadline', dueText(o) + (o.note ? '. '+o.note : '')], o.uses ? ['Pays for', o.uses] : null, o.contact ? ['Contact', o.contact] : null].filter(Boolean)),
      o.link ? h('p',null, h('a',{href:o.link,target:'_blank',rel:'noopener'},'Open the program page')) : null));

    const nb = h('div',{class:'card grid'}); netEffect(o, nb); v.append(nb);
    if (o.kind === 'loan' && avgDay === null) loadSales().then(() => { if (avgDay){ nb.replaceChildren(); netEffect(o, nb); } });

    if ((o.needs||[]).length) v.append(h('div',{class:'card'}, h('h2',null,'What you need to apply'),
      o.needs.map((n,i) => h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:!!t.done[i],onchange:e=>{ t.done[i] = e.target.checked; A.save(); }}), n))));

    const st = h('select',{onchange:e=>{ t.status = e.target.value; A.save(); }}, STATUS.map(s => h('option',{value:s,selected:t.status===s},s)));
    const rm = h('input',{type:'date',value:t.remind||'',onchange:e=>{ t.remind = e.target.value || null; A.save(); }});
    const nt = h('textarea',{rows:'3',maxlength:'2000',onchange:e=>{ t.notes = e.target.value; A.save(); }}, t.notes || '');
    v.append(h('div',{class:'card grid'}, h('h2',null,'Track it'), h('div',{class:'grid g2'}, h('label',{class:'f'},'Status',st), h('label',{class:'f'},'Remind me on',rm)),
      h('label',{class:'f'},'Notes (who you talked to, what they said)',nt),
      h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ const n = nextDue(o), ev = [];
        if (n) ev.push({id:'opp-'+o.id, date:n.date, title:'Due: '+o.name, note:o.amount, link:'#/opp/'+o.id});
        if (t.remind) ev.push({id:'oppr-'+o.id, date:t.remind, title:'Reminder: '+o.name, note:t.notes||'', link:'#/opp/'+o.id});
        if (!ev.length) return toast('Set a reminder date first'); A.download(o.id+'.ics','text/calendar',A.toIcs(ev)); }},'Add to calendar'),
        o.custom && isOwner() ? h('button',{class:'linkbtn small',type:'button',onclick:()=>{ if (!confirm('Remove this program?')) return;
          const c = O().custom, i = c.findIndex(x => x.id === o.id); if (i >= 0) c.splice(i,1); A.save(); location.hash = '#/opps'; }},'Remove') : null)));
  }

  A.register({id:'opps', name:'Opportunities', what:'Grants, loans, tax credits and rebates matched to the store, with deadlines, reminders and the true net effect of each.', tiers:['manager','owner'],
    views:{opps:{t:'Opportunities', ic:'🌱', render:list, min:'manager'}, opp:{t:'Opportunity', ic:'🌱', render:one, min:'manager', hidden:true}}});
  A.ownerHooks.push(v => {
    const soon = catalog().filter(o => { const t = trackOf(o.id), n = nextDue(o); if (['Won','Passed'].includes(t.status)) return false;
      return (t.remind && t.remind <= today()) || (n && daysTo(n.date) <= 30 && fit(o).level !== 'no'); });
    if (soon.length) v.append(h('div',{class:'card'}, h('h2',null,'Opportunities'), h('p',null, soon.length+' with a deadline or reminder soon: '+soon.slice(0,2).map(o => o.name).join(', ')+'. ', h('a',{href:'#/opps'},'Open'))));
  });
  A.opps = {pmt, trueRate}; // for tests
})();
