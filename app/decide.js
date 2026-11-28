// Decision planners (store manager and owner): think a decision through before spending money, then check later
// whether it worked.
//   - Pick a kind: hire someone, add a product category, change store hours, a big purchase, an event, or anything.
//   - Each kind asks the questions that matter and does the math: monthly cost, how much more you'd need to sell to
//     cover it at your margin, and how many months to pay it back. It uses your own numbers where the app has them
//     (average sales per day from Shopify, average pay rate from the Team screen).
//   - Write the options, pros and cons, decide, and set a date to look back: "Did it work?"
// Saved in the private shared area 'decisions' (supabase/hr.sql); until that has run it stays on this device.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, uid, isoDay, money} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier) && (A.demo || MGR.includes(A.myRole));
  const D = () => { const s = S(); if (!Array.isArray(s.decisions)) s.decisions = []; return s.decisions; };
  const here = () => D().filter(x => x.site === S().site);
  const r2 = n => Math.round(n*100)/100;
  const WEEKS = 4.33, PAYROLL = 1.11; // payroll taxes and insurance on top of wages: about 11% for a small shop

  // kinds: the fields each one asks for, the questions to think about, and the math
  const KINDS = {
    hire: {t:'Hire someone', ic:'🧑‍💼', rk:'hire', from:x => ({rate:x.rate, hours:x.hours, train:x.rate ? Math.round((x.training||0)/x.rate) : 16}), fields:[['hours','Hours per week',20],['rate','Hourly pay ($)',13],['margin','Your gross margin on sales (%)',40],['training','One-time cost to hire and train ($)',300]],
      math: x => { const m = x.hours*x.rate*WEEKS*PAYROLL; return {monthly:m, oneTime:x.training, need:m/(x.margin/100)}; },
      ask:['What will this person do that isn\'t getting done now?','Could more hours for someone already here do it?','Which days and times are busiest?','Can sales actually grow by the amount below, or does this free up your own time for something that pays?','Who trains them, and for how long?']},
    category: {t:'Add a product category', ic:'🧸', rk:'line', from:x => ({stock:x.stock, fixtures:x.fixtures, sales:x.sales, lineMargin:x.margin}), fields:[['stock','Opening stock cost ($)',1500],['fixtures','Fixtures and display ($)',200],['sales','Expected sales per month ($)',800],['margin','Gross margin on it (%)',50]],
      math: x => { const g = x.sales*x.margin/100; return {monthly:-g, oneTime:x.stock+x.fixtures, gain:g}; },
      ask:['Have customers asked for it? (check Customer voice)','Who are the vendors, minimum orders and terms?','What comes off the floor to make room?','How will you know in 3 months if it\'s working? Pick a number.','Can you return or mark down what doesn\'t sell?']},
    hours: {t:'Change store hours', ic:'🕰️', rk:'hours', from:x => ({extra:x.extra, staff:x.staff, rate:x.rate, perhour:x.perhour}), fields:[['extra','Extra open hours per week',4],['staff','People working those hours',1],['rate','Average hourly pay ($)',13],['perhour','Expected sales per extra hour ($)',60],['margin','Gross margin (%)',40]],
      math: x => { const cost = x.extra*x.staff*x.rate*WEEKS*PAYROLL, g = x.extra*x.perhour*WEEKS*x.margin/100; return {monthly:cost - g, oneTime:0, gain:g, cost}; },
      ask:['What do neighbors and the downtown do at those hours?','Is foot traffic there, or would you be open to an empty street?','Try it for a set time (for example 6 weekends) and compare sales.','Who wants the hours on the team?']},
    purchase: {t:'Big purchase', ic:'🛒', rk:'purchase', from:x => ({price:x.cost, monthly:x.monthly, saves:x.saves, life:x.life}), fields:[['cost','Price ($)',1200],['monthly','Monthly running cost ($)',0],['saves','Money saved or earned per month ($)',100],['life','How many years it lasts',5]],
      math: x => ({monthly:x.monthly - x.saves, oneTime:x.cost, gain:x.saves - x.monthly, perYear:x.cost/Math.max(1, x.life)}),
      ask:['What happens if you don\'t buy it?','Is there a used, rented or cheaper version?','Can it be a business expense for taxes (ask your accountant)?','Who will use it, and do they need training?']},
    event: {t:'Plan an event', ic:'🎉', rk:'event', from:x => ({cost:x.cost, people:x.people, spend:x.spend}), fields:[['cost','Cost: author fee, food, ads ($)',250],['people','Expected people',30],['spend','Average spend per person ($)',25],['margin','Gross margin (%)',40]],
      math: x => { const g = x.people*x.spend*x.margin/100; return {monthly:0, oneTime:x.cost, gain:g, net:g - x.cost, breakeven:x.cost/Math.max(0.01, x.spend*x.margin/100)}; },
      ask:['Who is it for, and how will they hear about it?','Can a publisher, author or partner share the cost?','What will people buy there (signed copies, pre-orders)?','Count who came and what sold, so the next one is easier to judge.']},
    raise: {t:'Give a raise', ic:'💵', fields:[], rk:'raise',
      ask:['What has this person taken on, or what would you lose if they left?','Does it change the gap to anyone paid a little more?','Is it tied to something they can see (a date, a skill, a result)?','Could part of it be a bonus instead, if cash is tight?']},
    order: {t:'Place a big order', ic:'📦', fields:[], rk:'order',
      ask:['What sold last time, and how fast? (check Shopify)','Can it come back for credit if it doesn\'t sell?','Can you combine orders to reach free freight instead of rushing?','Where will it go on the floor, and what moves?']},
    leftover: {t:'Stock that isn\'t selling', ic:'🧺', fields:[], rk:'leftover',
      ask:['Has it been in a good spot, faced out, and hand-sold?','Can it go back to the supplier for credit?','Is there a school, library or cause that would put it to use?','Would it work as a gift-with-purchase or an event prize?']},
    price: {t:'Change a price', ic:'🏷️', fields:[], rk:'price',
      ask:['What do nearby stores and online charge?','Do regulars buy this for the price or for the store?','Try it for a month and compare units sold.']},
    loan: {t:'Take a loan or advance', ic:'🏦', fields:[], rk:'loan',
      ask:['What will the money buy, and how does that pay it back?','What happens in a slow month while it takes its share of sales?','Have you compared a bank, SBA or local revolving-loan fund?']},
    other: {t:'Something else', ic:'🤔', rk:'other', from:x => x, fields:[['oneTime','One-time cost ($)',0],['monthlyCost','Monthly cost ($)',0],['monthlyGain','Monthly gain ($)',0]],
      math: x => ({monthly:x.monthlyCost - x.monthlyGain, oneTime:x.oneTime, gain:x.monthlyGain}),
      ask:['What problem does this solve?','What is the cheapest way to try it first?','What would make you undo it?']}
  };

  // the store's own numbers, when the app has them
  let avgDay = null;
  async function loadSales(){
    if (A.demo || !A.sb || avgDay !== null) return;
    try { const r = await A.sb.from('shopify_sales_day').select('net').order('day',{ascending:false}).limit(30);
      avgDay = r.data && r.data.length ? r.data.reduce((a,b) => a + (+b.net||0), 0) / r.data.length : 0; } catch(e){ avgDay = 0; }
  }
  function avgRate(){ const pay = S().pay && S().pay.people || {}, rates = Object.values(pay).map(x => +x.rate).filter(x => x > 0); return rates.length ? r2(rates.reduce((a,b) => a+b, 0)/rates.length) : null; }

  function summary(k, x){
    const kd = KINDS[k], m = kd.math(x), out = [];
    if (m.oneTime) out.push(['Up-front', money(m.oneTime)]);
    if (k === 'hire'){ out.push(['Monthly cost with payroll taxes', money(m.monthly)]); out.push(['Extra sales needed each month to cover it', money(m.need)]);
      if (avgDay) out.push(['That is more than now by', Math.round(100*m.need/(avgDay*30))+'% (you average '+money(avgDay)+' a day)']); }
    else if (k === 'event'){ out.push(['Profit from sales at the event', money(m.gain)]); out.push(['Net after costs', money(m.net)]); out.push(['People needed to break even', String(Math.ceil(m.breakeven/Math.max(1,x.spend)) || '—')]); }
    else {
      if (m.cost) out.push(['Monthly wages for the extra hours', money(m.cost)]);
      if (m.gain) out.push(['Monthly gross profit it brings', money(m.gain)]);
      out.push([m.monthly > 0 ? 'Costs you each month' : 'Adds each month', money(Math.abs(m.monthly))]);
      if (m.oneTime && m.monthly < 0) out.push(['Pays back in', Math.ceil(m.oneTime/(-m.monthly))+' months']);
      if (m.oneTime && m.monthly >= 0) out.push(['Pays back', 'never at these numbers']);
      if (m.perYear) out.push(['Cost per year of use', money(m.perYear)]);
    }
    return out;
  }

  function list(v){
    v.append(head('Store manager and owner', 'Decision planner', 'Think it through, run the numbers, decide, and check back later whether it worked.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can use the decision planner.')); return; }
    if (!A.demo && A.sync && A.sync.gateOk && !A.sync.gateOk()) v.append(h('div',{class:'msg'},'Decisions are saved on this device only until the owner runs supabase/hr.sql. After that they sync privately to managers and the owner.'));
    v.append(h('div',{class:'grid g3'}, Object.entries(KINDS).map(([k,kd]) => h('button',{class:'tile',type:'button',onclick:()=>{
      const x = {id:uid(), site:S().site, at:isoDay(new Date()), by:A.me(), kind:k, title:kd.t, nums:{}, options:'', pros:'', cons:'', status:'open'};
      (kd.fields || []).forEach(([f,,d]) => x.nums[f] = d); if (k === 'hire' || k === 'hours'){ const r = avgRate(); if (r) x.nums.rate = r; }
      D().unshift(x); A.save(); location.hash = '#/decision/'+x.id; }}, h('span',{class:'ic','aria-hidden':'true'},kd.ic), h('b',null,kd.t)))));
    const all = here();
    const due = all.filter(x => x.status === 'decided' && x.reviewAt && x.reviewAt <= isoDay(new Date()) && !x.outcome);
    if (due.length) v.append(h('div',{class:'card'}, h('h2',null,'Time to look back'), h('div',{class:'list'}, due.map(x => h('a',{class:'item',href:'#/decision/'+x.id}, h('b',null,x.title), h('div',{class:'small muted'},'Decided '+A.fmtDate(x.decidedAt||x.at)+': '+(x.choice||'')))))));
    v.append(h('div',{class:'card'}, h('h2',null,'Your decisions'), all.length ? h('div',{class:'list'}, all.map(x => h('a',{class:'item',href:'#/decision/'+x.id,style:'display:block;text-decoration:none;color:inherit'},
      h('b',null,x.title), ' ', h('span',{class:'chip '+(x.status === 'open' ? 'amber' : x.outcome ? 'calm' : 'grey')}, x.status === 'open' ? 'Thinking' : x.status === 'dropped' ? 'Dropped' : x.outcome ? 'Reviewed' : 'Decided'),
      h('div',{class:'small muted'}, KINDS[x.kind].t+' · '+A.fmtDate(x.at)+' · '+x.by)))) : h('p',{class:'muted'},'Nothing yet. Pick a kind above to start.')));
  }

  function one(v){
    const x = D().find(d => d.id === A.param());
    v.append(h('a',{class:'small',href:'#/decide'},'← All decisions'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can use the decision planner.')); return; }
    if (!x){ v.append(h('div',{class:'card'},'That decision was not found.')); return; }
    const kd = KINDS[x.kind] || KINDS.other;
    const title = h('input',{type:'text',value:x.title,maxlength:'100','aria-label':'Title',style:'font-size:1.3rem;font-weight:600',onchange:e=>{ x.title = e.target.value.trim() || kd.t; A.save(); }});
    v.append(h('div',{class:'card'}, title, h('p',{class:'small muted'}, kd.t+' · started '+A.fmtDate(x.at)+' by '+x.by)));

    // numbers: the Ripple sliders with every hidden effect (taxes, write-off, net cost, cash, risk, proof to keep)
    if (A.ripplePanel && kd.rk){
      const nc = h('div',{class:'card'}, h('h2',null,'The numbers and what they ripple into')), pane = h('div');
      nc.append(pane); v.append(nc);
      if (!x.ripple){ x.ripple = kd.from ? kd.from(x.nums || {}) : {}; Object.keys(x.ripple).forEach(k => { if (x.ripple[k] == null) delete x.ripple[k]; }); }
      let t = null;
      A.ripplePanel(pane, kd.rk, x.ripple, vals => { x.ripple = vals; clearTimeout(t); t = setTimeout(() => A.save(), 600); }, 'Move the sliders');
    } else {
    const res = h('div');
    const draw = () => { res.replaceChildren(h('table',{class:'tbl'}, h('tbody',null, summary(x.kind, x.nums).map(([a,b]) => h('tr',null, h('td',null,a), h('td',null, h('b',null,b))))))); };
    const nc = h('div',{class:'card'}, h('h2',null,'The numbers'),
      h('div',{class:'grid'}, kd.fields.map(([f,t]) => h('label',{class:'f'}, t, h('input',{type:'number',step:'any',value:String(x.nums[f] ?? ''),oninput:e=>{ x.nums[f] = +e.target.value || 0; draw(); },onchange:()=>A.save()})))), res,
      h('p',{class:'small muted'},'Estimates only: payroll taxes and insurance counted as about 11% on top of wages. Your accountant can give exact numbers.'));
    draw(); v.append(nc);
    if (x.kind === 'hire') loadSales().then(() => { if (avgDay) draw(); });
    }

    // think it through
    const tt = (k, label, rows) => h('label',{class:'f'}, label, h('textarea',{rows:String(rows||3),maxlength:'4000',onchange:e=>{ x[k] = e.target.value; A.save(); }}, x[k] || ''));
    v.append(h('div',{class:'card grid'}, h('h2',null,'Think it through'),
      h('ul',{class:'small'}, kd.ask.map(q => h('li',null,q))),
      tt('options','The options (including doing nothing)'), tt('pros','Good things'), tt('cons','Risks and downsides'), tt('notes','Notes and what others said')));

    // decide and look back
    const dc = h('div',{class:'card grid'}, h('h2',null,'Decide'));
    if (x.status === 'open'){
      const ch = h('input',{type:'text',maxlength:'200',placeholder:'What you decided'}), rv = h('input',{type:'date',value:A.addDays ? A.addDays(isoDay(new Date()), 90) : ''});
      dc.append(h('label',{class:'f'},'Decision', ch), h('label',{class:'f'},'Look back on', rv),
        h('div',{class:'row'}, h('button',{class:'btn',type:'button',onclick:()=>{ if (!ch.value.trim()) return toast('Write what you decided');
          Object.assign(x, {status:'decided', choice:ch.value.trim(), decidedAt:isoDay(new Date()), decidedBy:A.me(), reviewAt:rv.value}); A.save(); toast('Decided. You\'ll be reminded on '+A.fmtDate(rv.value)); A.route(); }},'Decide'),
          h('button',{class:'btn quiet',type:'button',onclick:()=>{ x.status = 'dropped'; A.save(); A.route(); }},'Drop it')));
    } else if (x.status === 'decided'){
      dc.append(h('p',null, h('b',null,'Decided: '), x.choice, h('span',{class:'small muted'},' · '+A.fmtDate(x.decidedAt)+' by '+x.decidedBy)),
        x.reviewAt ? h('p',{class:'small muted'},'Look back on '+A.fmtDate(x.reviewAt)) : null);
      const oc = h('textarea',{rows:'3',maxlength:'4000',placeholder:'Did it work? What would you do differently?'}, x.outcome || '');
      dc.append(h('label',{class:'f'},'How it went', oc), h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ x.outcome = oc.value.trim(); x.outcomeAt = isoDay(new Date()); A.save(); toast('Saved'); A.route(); }},'Save'));
    } else dc.append(h('p',{class:'muted'},'Dropped.'), h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ x.status = 'open'; A.save(); A.route(); }},'Reopen'));
    v.append(dc);
    v.append(h('button',{class:'linkbtn small',type:'button',onclick:()=>{ if (!confirm('Delete this decision?')) return; const i = D().indexOf(x); if (i >= 0) D().splice(i,1); A.save(); location.hash = '#/decide'; }},'Delete'));
  }

  A.register({id:'decide', name:'Decision planner', what:'Think through a raise, a hire, an order, stock that isn\'t selling, prices, hours, a big purchase, a loan or an event, with sliders that show every hidden effect, then look back on whether it worked.', tiers:['manager','owner'],
    views:{decide:{t:'Decisions', ic:'⚖️', render:list, min:'manager'}, decision:{t:'Decision', ic:'⚖️', render:one, min:'manager', hidden:true}}});
  A.ownerHooks.push(v => { const due = here().filter(x => x.status === 'decided' && x.reviewAt && x.reviewAt <= isoDay(new Date()) && !x.outcome);
    if (due.length) v.append(h('div',{class:'card'}, h('h2',null,'Decisions'), h('p',null, due.length+' to look back on. ', h('a',{href:'#/decide'},'Open')))); });
})();
