// Ripple explainers: move a slider and see how one change ripples through the business.
//   raise  - give someone a raise: weekly/monthly/yearly cost, employer taxes, workers' comp, overtime, the write-off,
//            the real cost after tax, and the extra sales it takes to cover it.
//   hire   - add a person: the same, plus the payroll service and training.
//   order  - order products: landed cost, margin vs markup, cash out the door, sell-through, break-even, and why stock
//            you haven't sold isn't a write-off yet (inventory -> cost of goods sold when it sells).
//   price  - change a price: how many sales you can lose (or must gain) before profit moves.
//   leftover - stock that isn't selling: hold, mark down (even below cost), return, donate, give away, write off.
//   hours, purchase, loan, line, event, other - the Decision planner's kinds, also used on Loans and Equipment.
// Every decision also lists the proof to keep and what skipping it could cost in an audit.
// Shared by the app (app/ripple.js passes the store's own numbers) and the website demo (ripple.html, sample numbers).
// Estimates for learning, not tax advice. Yearly figures live in RATES: check them every January.
(function(){
  // ---------- 2026 figures (federal and Wisconsin), checked Nov 2026 ----------
  const RATES = {
    year: 2026,
    ss: 0.062, ssBase: 184500, medicare: 0.0145,          // employer FICA 7.65% (SSA 2026 wage base $184,500)
    futa: 0.006, futaBase: 7000,                          // 6.0% less the 5.4% state credit; Wisconsin is not a credit-reduction state
    suta: 0.0305, sutaBase: 14000,                        // Wisconsin UI: new employers with payroll under $500k start at 3.05% on the first $14,000
    otAfter: 40, otTimes: 1.5,                            // FLSA and Wisconsin: 1.5x after 40 hours in a workweek
    minWage: 7.25,                                        // Wisconsin = federal
    se: 0.153 * 0.9235,                                   // self-employment tax on 92.35% of Schedule C profit (owner taking draws)
    qbi: 0.20,                                            // federal qualified business income deduction (made permanent in 2025); Wisconsin has none
    wc: 1.00,                                             // workers' comp, $ per $100 of pay: a retail store in Wisconsin often pays roughly $0.70-$2. Your policy has the real rate.
    cardFee: 2.7,                                         // card processing, % of the sale (Shopify in person is about 2.4-2.7% plus a few cents)
    payrollBase: 49, payrollPer: 6,                       // Gusto Simple per month: $49 base + $6 per person
    fed: [[10,'10%: taxable income up to $12,400 (single)'],[12,'12%: $12,400 to $50,400 (single)'],[22,'22%: $50,400 to $105,700 (single)'],[24,'24%: $105,700 to $201,775'],[32,'32%'],[35,'35%'],[37,'37%']],
    wi: [[3.5,'3.5%: lowest bracket'],[4.4,'4.4%: second bracket'],[5.3,'5.3%: most middle incomes'],[7.65,'7.65%: top bracket']]
  };
  const DEFAULTS = {fed:12, wi:5.3, se:true, qbi:true, margin:42, avgSale:22, wc:RATES.wc, suta:RATES.suta*100};

  // ---------- helpers ----------
  function h(tag, attrs, ...kids){
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs){ const v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.setAttribute('style', v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else e.setAttribute(k, v); }
    for (const c of kids.flat(9)){ if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return e;
  }
  const $$ = (n, cents) => { const a = Math.abs(n), c = cents != null ? cents : a < 100;
    return (n < -0.004 ? '-$' : '$') + a.toLocaleString('en-US', {minimumFractionDigits:c?2:0, maximumFractionDigits:c?2:0}); };
  const pct = (n, d) => (n*100).toLocaleString('en-US', {maximumFractionDigits: d == null ? 1 : d}) + '%';
  const num = n => Math.round(n).toLocaleString('en-US');
  const cap = (amt, base) => Math.min(Math.max(amt, 0), base);
  // what $1 of business expense saves in tax for an owner of a sole-member LLC (Schedule C)
  function taxRate(s){
    const fed = s.fed/100 * (s.qbi ? 1 - RATES.qbi : 1), wi = s.wi/100, se = s.se ? RATES.se : 0;
    return {all: fed + wi + se, fed, wi, se};
  }
  const PER = {week:52, month:12, year:1};
  const PER_T = {week:'a week', month:'a month', year:'a year'};

  // ---------- payroll math (per year) ----------
  function payYear(rate, hours, weeks){
    const reg = Math.min(hours, RATES.otAfter), ot = Math.max(0, hours - RATES.otAfter);
    return {reg, ot, weekly: rate*reg + rate*RATES.otTimes*ot, year: (rate*reg + rate*RATES.otTimes*ot) * weeks};
  }
  function employerCost(before, after, s){ // yearly wages before and after; returns the extra employer cost on the difference
    const wages = after - before;
    const fica = RATES.ss * (cap(after, RATES.ssBase) - cap(before, RATES.ssBase)) + RATES.medicare * wages;
    const futa = RATES.futa * (cap(after, RATES.futaBase) - cap(before, RATES.futaBase));
    const suta = s.suta/100 * (cap(after, RATES.sutaBase) - cap(before, RATES.sutaBase));
    const wc = s.wc/100 * wages;
    return {wages, fica, futa, suta, wc, total: wages + fica + futa + suta + wc};
  }

  // ---------- the explainers ----------
  // sliders: [key, label, min, max, step, default, unit, hint]
  const KINDS = {
    raise: {t:'Give a raise', ic:'💵', periodic:true,
      intro:'Pick a raise and watch it ripple: their paycheck, your payroll taxes and insurance, the tax write-off, what it really costs you, and how much more you would need to sell.',
      sliders:[['raise','Raise per hour',0.25,5,0.25,1,'$'],['rate','Their pay now, per hour',RATES.minWage,30,0.25,13,'$','Wisconsin minimum wage is $7.25'],
        ['hours','Hours a week',4,50,1,25,'hrs','Past 40 hours, every hour is paid at 1.5 times'],['people','People getting it',1,15,1,1,''],['weeks','Weeks worked a year',10,52,1,50,'wks']],
      calc(v, s){
        const b = payYear(v.rate, v.hours, v.weeks), a = payYear(v.rate + v.raise, v.hours, v.weeks);
        const one = employerCost(b.year, a.year, s), n = v.people;
        const y = {wages:one.wages*n, fica:one.fica*n, futa:one.futa*n, suta:one.suta*n, wc:one.wc*n}; y.total = one.total*n;
        return {y, b, a, one};
      }},
    hire: {t:'Hire someone', ic:'🧑‍💼', periodic:true,
      intro:'A new person costs more than their wage. See the full cost, the write-off, and how much more the store has to sell to carry them.',
      sliders:[['rate','Hourly pay',RATES.minWage,30,0.25,13,'$'],['hours','Hours a week',4,50,1,20,'hrs','Past 40 hours, every hour is paid at 1.5 times'],
        ['weeks','Weeks worked a year',4,52,1,50,'wks'],['train','Training hours (paid, one time)',0,80,1,16,'hrs'],['your','Your own hours a week it frees up',0,40,1,8,'hrs','Time you can spend on buying, events or marketing']],
      calc(v, s, o){
        const p = payYear(v.rate, v.hours, v.weeks), one = employerCost(0, p.year + v.rate*v.train, s);
        const service = (o.firstHire ? RATES.payrollBase : 0)*12 + RATES.payrollPer*12;
        const y = {wages:one.wages, fica:one.fica, futa:one.futa, suta:one.suta, wc:one.wc, service}; y.total = one.total + service;
        return {y, p, one, service};
      }},
    order: {t:'Order products', ic:'📦', periodic:false,
      intro:'Slide the cost, quantity, price, freight, rush shipping, losses and how much sells. See the risk, the gross and net cost, how many must sell to profit, where it turns into a loss, and what counts as a write-off.',
      sliders:[['cost','Cost per item from the supplier',0.5,100,0.25,9,'$','Books: the publisher\'s discount, often 40 to 46% off the printed price'],['qty','How many you order',1,200,1,24,''],
        ['price','Your selling price',1,150,0.5,17.99,'$'],['freight','Shipping and freight for the order',0,300,1,18,'$'],['rush','Extra to expedite (rush shipping)',0,300,1,0,'$','Leave at 0 for regular shipping'],
        ['sell','How many sell (sell-through)',0,100,5,70,'%','Within the season or the tax year'],['shrink','Lost, damaged or stolen',0,25,1,2,'%','Retail averages about 1.5%; books often less'],
        ['months','Months until most of it sells',1,24,1,3,'mo']],
      calc(v, s){
        const tr = taxRate(s), buy = v.cost*v.qty, ship = v.freight + v.rush, out = buy + ship, q = Math.max(1, v.qty);
        const landed = out/q, landedNoRush = (buy + v.freight)/q, fee = v.price*s.cardFee/100, net = v.price - fee;
        const lost = Math.round(v.qty*v.shrink/100), sold = Math.round((v.qty - lost)*v.sell/100), left = v.qty - lost - sold;
        const revenue = sold*v.price, fees = sold*fee, cogs = sold*landed, gp = revenue - cogs - fees;
        const margin = (v.price - landed)/v.price, marginNoRush = (v.price - landedNoRush)/v.price, markup = (v.price - landed)/landed;
        const be = net > 0 ? Math.ceil(out/net) : Infinity, sellable = v.qty - lost;
        const lossPrice = landed/(1 - s.cardFee/100), lossSell = sellable ? be/sellable : Infinity;
        const carry = out/2*0.015*v.months; // money tied up and shelf space: about 1.5% a month on the average stock
        const tax = Math.max(0, gp)*tr.all, lostCost = lost*landed, leftCost = left*landed;
        const risk = !isFinite(lossSell) || lossSell > 0.8 ? 'high' : lossSell > 0.55 ? 'medium' : 'low';
        const unitNoRush = v.price - landedNoRush - fee, rushEach = v.rush/q, rushNeed = unitNoRush > 0 ? Math.ceil(v.rush/unitNoRush) : Infinity;
        return {tr, buy, ship, out, landed, landedNoRush, fee, net, lost, sold, left, revenue, fees, cogs, gp, margin, marginNoRush, markup, be, sellable, lossPrice, lossSell, carry, tax,
          lostCost, leftCost, risk, rushEach, rushNeed, netCost: out*(1 - tr.all), allGp: sellable*(net - landed) - lostCost};
      }},
    price: {t:'Change a price', ic:'🏷️', periodic:true,
      intro:'Raise or lower a price and see how many sales you can lose, or must win, before your profit moves. Best for things you set the price on (gifts, used books, coffee), not books with a printed price.',
      sliders:[['price','Price now',1,150,0.5,24,'$'],['cost','What one costs you (landed)',0.5,100,0.25,12,'$'],['units','How many sell a month now',1,500,1,40,''],
        ['change','Price change',-30,30,1,8,'%'],['vol','Your guess: change in how many sell',-50,50,1,-5,'%']],
      calc(v, s){
        const p2 = v.price*(1 + v.change/100), fee = s.cardFee/100;
        const per1 = v.price*(1-fee) - v.cost, per2 = p2*(1-fee) - v.cost;
        const u2 = v.units*(1 + v.vol/100);
        const gp1 = per1*v.units*12, gp2 = per2*u2*12;
        const beUnits = per2 > 0 ? v.units*per1/per2 : Infinity, beChange = beUnits/v.units - 1;
        const tr = taxRate(s);
        return {p2, per1, per2, u2, gp1, gp2, beUnits, beChange, diff:gp2 - gp1, tr};
      }}
  };

  // ---------- drawing ----------
  function step(ic, label, amt, sub, tone, d){
    return h('li',{class:'rp-step '+(tone||'cost'), style:'--d:'+(d||0)}, h('span',{class:'ring','aria-hidden':'true'}, ic), h('b',null,label), h('span',{class:'amt'}, amt), sub ? h('span',{class:'sub'}, sub) : null);
  }
  function bar(title, parts){
    const tot = parts.reduce((a,p) => a + Math.max(0, p.v), 0) || 1;
    const label = title + ': ' + parts.map(p => p.l + ' ' + $$(p.v) + ' (' + pct(Math.max(0,p.v)/tot, 0) + ')').join(', ');
    return h('div',{class:'rp-bar'}, h('h4',null,title),
      h('div',{class:'track', role:'img', 'aria-label':label}, parts.map(p => h('span',{class:'part t-'+p.t, style:'width:'+(100*Math.max(0,p.v)/tot)+'%'}))),
      h('ul',{class:'rp-key'}, parts.map(p => h('li',null, h('i',{class:'t-'+p.t,'aria-hidden':'true'}), p.l+' '+$$(p.v)+' · '+pct(Math.max(0,p.v)/tot, 0)))));
  }
  const tiles = (label, yearAmt) => h('div',{class:'rp-tiles'}, ['week','month','year'].map(p => h('div',{class:'rp-tile'}, h('span',null, label+' '+PER_T[p]), h('b',null, $$(yearAmt/PER[p])))));

  function payrollTaxSub(x, perDiv, s){
    const bits = ['Social Security and Medicare (7.65%) '+$$(x.fica/perDiv)];
    bits.push(x.futa > 0.005 ? 'federal unemployment '+$$(x.futa/perDiv) : 'federal unemployment $0 (only the first $7,000 a person earns each year is taxed, 0.6%)');
    bits.push(x.suta > 0.005 ? 'Wisconsin unemployment '+$$(x.suta/perDiv) : 'Wisconsin unemployment $0 (only the first $14,000 is taxed, '+s.suta+'%)');
    return bits.join('; ');
  }

  const RENDER = {
    raise(v, s, r, per, o){
      const d = PER[per], y = r.y, tr = taxRate(s), saved = y.total*tr.all, real = y.total - saved;
      const sales = y.total / (s.margin/100), items = sales / Math.max(1, s.avgSale);
      const theirs = (r.a.weekly - r.b.weekly) * (1 - 0.0765 - 0.12 - 0.044); // their own FICA plus typical federal 12% and Wisconsin 4.4% withholding
      const otNote = r.a.ot ? ' Includes '+r.a.ot+' overtime hours a week at 1.5 times, so the raise costs '+$$(v.raise*1.5)+' on those hours.' : '';
      const say = 'A '+$$(v.raise)+' raise for '+(v.people === 1 ? 'one person' : v.people+' people')+' costs the store '+$$(y.total/d)+' '+PER_T[per]+'. After the write-off it really costs you about '+$$(real/d)+', and to keep your profit the same you need about '+$$(sales/d)+' more in sales '+PER_T[per]+'.';
      return {say, chain:[
        step('💵','The raise itself', $$(y.wages/d), $$(v.raise)+' × '+v.hours+' hours × '+v.people+(v.people === 1 ? ' person' : ' people')+' × '+v.weeks+' weeks a year.'+otNote, 'cost', 0),
        step('🏛️','Your payroll taxes', $$((y.fica+y.futa+y.suta)/d), payrollTaxSub(y, d, s)+'.', 'tax', 1),
        step('🦺','Workers\' comp insurance', $$(y.wc/d), 'Priced per $100 of pay: about $'+s.wc.toFixed(2)+' per $100. Your policy has the real rate.', 'cost', 2),
        step('🧾','Total cost to the store', $$(y.total/d), pct(y.total/Math.max(0.01,y.wages),0)+' of the raise itself. Same in every period: '+$$(y.total/52)+' a week, '+$$(y.total/12)+' a month, '+$$(y.total, false)+' a year.', 'cost total', 3),
        step('✂️','Tax write-off', '-'+$$(saved/d), 'Wages, payroll taxes and workers\' comp are deductible business expenses. At your combined rate of '+pct(tr.all,1)+' (federal'+(s.qbi?' after the 20% QBI deduction':'')+', Wisconsin'+(s.se?', self-employment tax':'')+') you owe about this much less tax.', 'save', 4),
        step('💡','Real cost to you', $$(real/d), 'What actually leaves your pocket after the write-off.', 'bad', 5),
        step('🛒','Extra sales to cover it', $$(sales/d), 'At your '+s.margin+'% margin: about '+num(items/d)+' more '+$$(s.avgSale, false)+' sales '+PER_T[per]+'. The write-off makes the raise cheaper, but extra profit is taxed too, so to keep your profit where it was you still need the full cost back.'+(o.avgDay ? ' That is '+pct(sales/52/(o.avgDay*7),1)+' more than your average week.' : ''), 'good', 6),
        step('👤','Their paycheck', '+'+$$(r.a.weekly - r.b.weekly)+'/wk', 'About '+$$(theirs)+' a week after their own Social Security, Medicare and typical withholding. Pay goes from '+$$(v.rate)+' to '+$$(v.rate+v.raise)+' an hour.', 'good', 0)
      ], visuals:[tiles('Costs the store', y.total),
        bar('Where the money goes', [{l:'Raise',v:y.wages,t:'pine'},{l:'Payroll taxes',v:y.fica+y.futa+y.suta,t:'brandy'},{l:'Workers\' comp',v:y.wc,t:'pinesoft'}]),
        bar('Who carries the cost', [{l:'Lower taxes',v:saved,t:'mustard'},{l:'You',v:real,t:'brandy'}])],
      learn:[
        'Overtime: a raise costs 1.5 times as much on any hours past 40 in a workweek (federal law and Wisconsin).',
        'Federal unemployment (0.6%) stops after the first $7,000 a person earns in a year, and Wisconsin unemployment ('+s.suta+'% for a new employer) after $14,000. A raise late in the year often adds nothing there.',
        'Your own pay as the owner (draws) is not a wage and is not deductible. Wages you pay staff are.',
        'A raise also raises holiday and paid time off pay, and the gap to anyone paid a little more. Think about the whole team.',
        'Compare it with losing the person: hiring and training someone new takes weeks of pay and your time.'
      ]};
    },
    hire(v, s, r, per, o){
      const d = PER[per], y = r.y, tr = taxRate(s), saved = y.total*tr.all, real = y.total - saved;
      const sales = y.total / (s.margin/100), items = sales / Math.max(1, s.avgSale);
      const say = 'Hiring someone at '+$$(v.rate)+' for '+v.hours+' hours a week costs about '+$$(y.total/d)+' '+PER_T[per]+' in the first year. After the write-off it is about '+$$(real/d)+', and the store needs about '+$$(sales/d)+' more in sales '+PER_T[per]+' to carry it.';
      return {say, chain:[
        step('💵','Wages', $$((y.wages - v.rate*v.train)/d), $$(v.rate)+' × '+v.hours+' hours × '+v.weeks+' weeks'+(r.p.ot ? ', '+r.p.ot+' of those hours at 1.5 times' : '')+'.', 'cost', 0),
        step('🎓','Paid training', $$(v.rate*v.train/d), v.train+' hours once, spread over the year here.', 'cost', 1),
        step('🏛️','Your payroll taxes', $$((y.fica+y.futa+y.suta)/d), payrollTaxSub(y, d, s)+'. Unemployment taxes are capped, so they are front-loaded early in the year.', 'tax', 2),
        step('🦺','Workers\' comp insurance', $$(y.wc/d), 'Required in Wisconsin once you have 3 or more employees (or pay $500+ in a quarter). About $'+s.wc.toFixed(2)+' per $100 of pay.', 'cost', 3),
        step('🧮','Payroll service', $$(y.service/d), (o.firstHire ? 'First employee: $'+RATES.payrollBase+' a month base plus ' : '')+'$'+RATES.payrollPer+' a month per person (Gusto Simple). It files the taxes and W-2s for you.', 'cost', 3),
        step('🧾','Total cost to the store', $$(y.total/d), $$(y.total/52)+' a week, '+$$(y.total/12)+' a month, '+$$(y.total, false)+' a year.', 'cost total', 4),
        step('✂️','Tax write-off', '-'+$$(saved/d), 'All of it is deductible. At your combined rate of '+pct(tr.all,1)+' you owe about this much less tax.', 'save', 5),
        step('💡','Real cost to you', $$(real/d), 'What actually leaves your pocket after the write-off.', 'bad', 6),
        step('🛒','Extra sales to carry them', $$(sales/d), 'At your '+s.margin+'% margin: about '+num(items/d)+' more '+$$(s.avgSale, false)+' sales '+PER_T[per]+(o.avgDay ? ', or '+pct(sales/52/(o.avgDay*7),1)+' more than your average week' : '')+'.', 'good', 6),
        v.your ? step('⏳','Your time back', num(v.your*v.weeks/PER[per])+' hrs', 'If those hours bring in sales (buying, events, marketing, special orders), each hour needs about '+$$(sales/Math.max(1, v.your*v.weeks), true)+' in sales to pay for the hire.', 'good', 0) : null
      ], visuals:[tiles('Costs the store', y.total),
        bar('Where the money goes', [{l:'Wages',v:y.wages,t:'pine'},{l:'Payroll taxes',v:y.fica+y.futa+y.suta,t:'brandy'},{l:'Workers\' comp',v:y.wc,t:'pinesoft'},{l:'Payroll service',v:y.service,t:'line'}]),
        bar('Who carries the cost', [{l:'Lower taxes',v:saved,t:'mustard'},{l:'You',v:real,t:'brandy'}])],
      learn:[
        'Before the first paycheck: register with the Wisconsin Department of Revenue (withholding) and Workforce Development (unemployment), file a new-hire report within 20 days, and collect a W-4, WT-4 and I-9.',
        'Wisconsin minimum wage is $7.25. Overtime is 1.5 times past 40 hours in a workweek.',
        'The unemployment taxes stop once the person passes $7,000 (federal) and $14,000 (Wisconsin) for the year.',
        'A payroll service handles withholding, deposits and filings. It is a write-off too.'
      ]};
    },
    order(v, s, r){
      const riskTxt = {low:'Low risk', medium:'Medium risk', high:'High risk'}[r.risk];
      const say = riskTxt+': you pay '+$$(r.out)+' up front (about '+$$(r.netCost)+' once it is all written off). '+(isFinite(r.be) && r.be <= r.sellable ? 'Sell '+r.be+' of '+v.qty+' to get your money back; ' : 'Even selling every one won\'t get your money back; ')+'below '+$$(r.lossPrice)+' each, every sale loses money. If '+v.sell+'% sell, you make '+$$(r.gp)+' before tax.';
      const units = h('div',{class:'rp-units', role:'img', 'aria-label':r.sold+' of '+v.qty+' sold, '+r.left+' left on the shelf, '+r.lost+' lost or damaged'});
      for (let i = 0; i < Math.min(v.qty, 200); i++) units.append(h('i',{class:i < r.sold ? 'sold' : i < r.sold + r.left ? 'left' : 'lost'}));
      const bePct = isFinite(r.lossSell) ? pct(Math.min(r.lossSell, 9.99),0) : 'never';
      return {say, chain:[
        step('⚠️','Risk', riskTxt, 'You break even at '+bePct+' sell-through. Under 55% is low risk, over 80% is high. Returnable stock (most publishers take books back for credit) lowers it.', r.risk === 'low' ? 'good' : r.risk === 'medium' ? 'tax' : 'bad', 0),
        step('📦','You pay the supplier', $$(r.buy), $$(v.cost)+' × '+v.qty+'.', 'cost', 0),
        step('🚚','Shipping and freight in', $$(r.ship), 'Part of what the stock costs: '+$$(r.ship/Math.max(1,v.qty))+' added to each item.'+(v.rush ? ' Includes '+$$(v.rush)+' to expedite.' : ''), 'cost', 1),
        v.rush ? step('⚡','Expediting', '+'+$$(r.rushEach)+' each', 'Margin drops from '+pct(r.marginNoRush,0)+' to '+pct(r.margin,0)+'. Worth it only if the rush brings at least '+(isFinite(r.rushNeed) ? r.rushNeed : '—')+' sales you would otherwise miss (a customer waiting, an event date).', 'bad', 1) : null,
        step('💰','Gross cost: cash out the door', $$(r.out), 'All of it leaves your bank now, before anything sells.', 'cost total', 2),
        step('✂️','Net cost after write-offs', $$(r.netCost), 'All of it is deductible in the end, but only as it sells, gets lost or is written down, never when you pay for it. At '+pct(r.tr.all,1)+'.', 'save', 2),
        step('🏷️','Each one really costs', $$(r.landed), 'Margin '+pct(r.margin,1)+' of the price, markup '+pct(r.markup,0)+' on cost. (Doubling the cost is a 100% markup but only a 50% margin.)', r.margin < 0.3 ? 'bad' : 'good', 3),
        step('🎯','To return a profit', isFinite(r.be) ? r.be+' sold' : '—', isFinite(r.be) ? (r.be <= r.sellable ? 'Sell '+r.be+' of '+v.qty+' ('+pct(r.be/v.qty,0)+') to get your cash back. Every one after that is profit: '+$$(r.net - r.landed)+' each.' : 'Even selling all of them won\'t get your cash back at this price.') : 'The price is below the card fee.', isFinite(r.be) && r.be <= r.sellable ? 'good' : 'bad', 3),
        step('📉','When it becomes a loss', 'under '+$$(r.lossPrice), 'Selling for less than this loses money on each sale. Selling fewer than '+bePct+' of them loses money on the order. Holding it '+v.months+' months costs about '+$$(r.carry)+' in tied-up cash and shelf space.', 'bad', 4),
        step('🛍️','If '+v.sell+'% sell', $$(r.revenue), r.sold+' sold at '+$$(v.price)+'. Card fees take '+$$(r.fees)+' ('+s.cardFee+'%).', 'good', 4),
        step('📈','Gross profit on what sold', $$(r.gp), 'Sales minus what those '+r.sold+' cost (cost of goods sold, '+$$(r.cogs)+') minus card fees. If every sellable one sells: '+$$(r.allGp)+'.', r.gp >= 0 ? 'good' : 'bad', 5),
        r.lost ? step('💔','Lost, damaged or stolen', $$(r.lostCost), r.lost+' items. No sale, but the cost still counts through cost of goods sold (your year-end count catches it), saving about '+$$(r.lostCost*r.tr.all)+'. You lose '+$$(r.lostCost*(1 - r.tr.all))+' after tax, plus the profit you would have made.', 'bad', 5) : null,
        step('📚','Still on the shelf', $$(r.leftCost), r.left+' items: cash tied up and not a write-off yet. They count when they sell, or when you mark them down, donate, give away or throw them out. Compare those choices under "Stock that isn\'t selling".', 'tax', 5),
        step('🏛️','Tax this year', $$(r.tax), 'On the profit, at '+pct(r.tr.all,1)+', leaving '+$$(r.gp - r.tax)+'. Shipping you pay to send orders to customers is a regular expense, written off right away.', 'tax', 6)
      ], visuals:[
        bar('Where each '+$$(v.price)+' sale goes', [{l:'Item cost',v:v.cost,t:'pine'},{l:'Freight',v:r.ship/Math.max(1,v.qty),t:'pinesoft'},{l:'Card fee',v:r.fee,t:'brandy'},{l:'Your profit',v:Math.max(0, v.price - r.landed - r.fee),t:'calm'}]),
        h('div',{class:'rp-bar'}, h('h4',null,'Sold, on the shelf, lost'), units,
          h('ul',{class:'rp-key'}, h('li',null,h('i',{class:'t-calm','aria-hidden':'true'}),'Sold '+r.sold), h('li',null,h('i',{style:'border:2px solid var(--rp-brandy)','aria-hidden':'true'}),'On the shelf '+r.left),
            r.lost ? h('li',null,h('i',{class:'t-lost','aria-hidden':'true'}),'Lost '+r.lost) : null))],
      learn:[
        'Margin is profit as a share of the price; markup is profit as a share of the cost. Books at a 40% discount off the printed price give about a 40% margin before freight.',
        'Freight in (from the supplier) becomes part of the stock\'s cost and is written off only as those items sell. Shipping out to customers is a regular expense.',
        'Stock you buy is not a write-off when you pay for it. Your yearly cost of goods sold is: stock at the start of the year + what you bought - stock at the end. Counting stock on December 31 matters, and it is how losses get counted.',
        'Combine orders to reach free-freight minimums instead of paying to rush. Rush only for a customer special order or an event date.',
        'Special orders are already sold before you order them: the safest margin there is.'
      ]};
    },
    price(v, s, r, per){
      const d = PER[per], up = v.change >= 0;
      const be = isFinite(r.beUnits) ? r.beChange : null;
      const say = up
        ? 'Raising the price '+v.change+'% means you can sell up to '+(be != null ? pct(-be,0) : 'all')+' fewer and still make the same profit. With your guess ('+(v.vol>0?'+':'')+v.vol+'%), profit '+(r.diff >= 0 ? 'goes up ' : 'goes down ')+$$(Math.abs(r.diff)/d)+' '+PER_T[per]+'.'
        : 'Cutting the price '+(-v.change)+'% means you need to sell '+(be != null ? pct(be,0) : 'endlessly')+' more just to make the same profit. With your guess ('+(v.vol>0?'+':'')+v.vol+'%), profit '+(r.diff >= 0 ? 'goes up ' : 'goes down ')+$$(Math.abs(r.diff)/d)+' '+PER_T[per]+'.';
      return {say, chain:[
        step('🏷️','New price', $$(r.p2), 'From '+$$(v.price)+' ('+(up?'+':'')+v.change+'%).', 'cost', 0),
        step('🪙','Profit on each one', $$(r.per2), 'Was '+$$(r.per1)+' after cost and the card fee. Margin goes from '+pct(r.per1/v.price,0)+' to '+pct(r.per2/Math.max(0.01,r.p2),0)+'.', r.per2 >= r.per1 ? 'good' : 'bad', 1),
        step('⚖️','Break-even sales', isFinite(r.beUnits) ? num(r.beUnits)+'/mo' : '—', isFinite(r.beUnits) ? 'Selling '+num(r.beUnits)+' a month at the new price makes the same profit as '+v.units+' at the old one ('+(be>=0?'+':'')+pct(be,0)+').' : 'At this price each sale loses money.', 'tax', 2),
        step('📊','Your guess', num(r.u2)+'/mo', (v.vol>0?'+':'')+v.vol+'% from '+v.units+' a month.', 'cost', 3),
        step('📈','Gross profit', $$(r.gp2/d), 'Was '+$$(r.gp1/d)+' '+PER_T[per]+'.', r.diff >= 0 ? 'good' : 'bad', 4),
        step(r.diff >= 0 ? '➕' : '➖','Change before tax', (r.diff >= 0 ? '+' : '')+$$(r.diff/d), 'After tax at '+pct(r.tr.all,1)+': '+(r.diff >= 0 ? '+' : '')+$$(r.diff*(1 - r.tr.all)/d)+' '+PER_T[per]+'.', r.diff >= 0 ? 'good' : 'bad', 5)
      ], visuals:[
        bar('Each sale at the old price', [{l:'Cost',v:v.cost,t:'pine'},{l:'Card fee',v:v.price*s.cardFee/100,t:'brandy'},{l:'Profit',v:Math.max(0,r.per1),t:'calm'}]),
        bar('Each sale at the new price', [{l:'Cost',v:v.cost,t:'pine'},{l:'Card fee',v:r.p2*s.cardFee/100,t:'brandy'},{l:'Profit',v:Math.max(0,r.per2),t:'calm'}])],
      learn:[
        'Discounts hurt more than they look: at a 40% margin, 20% off cuts the profit on each sale in half, so you need to sell twice as many.',
        'Small price increases are often safer than they feel: most regulars don\'t notice $1 on a $24 gift, and you can lose a few sales and still come out ahead.',
        'Books carry a printed price. Use price changes on sidelines, used books, events and services, and use margin (better discounts, fewer freight charges) for new books.',
        'Wisconsin sales tax is charged on top of the price, so it doesn\'t change your margin.'
      ]};
    }
  };


  // ---------- more decisions: open hours, equipment, loans, a new product line, events, anything ----------
  const PAST_CAPS = 20000; // someone already working all year is past the unemployment-tax caps
  Object.assign(KINDS, {
    hours: {t:'Change store hours', ic:'🕰️', periodic:true,
      intro:'Extra open hours cost wages and payroll taxes for sure, and bring sales only maybe. See what each hour has to sell to pay for itself.',
      sliders:[['extra','Extra open hours a week',1,40,1,4,'hrs'],['staff','People working those hours',1,5,1,1,''],['rate','Their hourly pay',RATES.minWage,30,0.25,13,'$'],
        ['perhour','Expected sales per extra hour',0,500,5,60,'$'],['weeks','Weeks a year',4,52,1,52,'wks']],
      calc(v, s){
        const one = employerCost(PAST_CAPS, PAST_CAPS + v.extra*v.rate*v.weeks, s), n = v.staff;
        const y = {wages:one.wages*n, fica:one.fica*n, futa:0, suta:0, wc:one.wc*n}; y.total = one.total*n;
        const sales = v.extra*v.perhour*v.weeks, gp = sales*s.margin/100, net = gp - y.total, tr = taxRate(s);
        return {y, sales, gp, net, tr, beHour: y.total/(v.extra*v.weeks)/(s.margin/100)};
      }},
    purchase: {t:'Big purchase', ic:'🛒', periodic:false,
      intro:'Equipment, shelving, a computer, a vehicle or building work. See the write-off now or spread out, the real cost after tax, and how long it takes to pay for itself.',
      sliders:[['price','Price',50,50000,50,1200,'$'],['biz','Business use',0,100,5,100,'%'],['life','Years it lasts',1,39,1,7,'yrs','Shelving and fixtures 7, computers 5, store improvements 15'],
        ['saves','Money it saves or earns a month',0,5000,10,100,'$'],['monthly','Running cost a month',0,2000,5,0,'$']],
      calc(v, s){
        const tr = taxRate(s), basis = v.price*v.biz/100, nowSave = basis*tr.all, spreadFirst = basis/v.life/2, spreadSave = spreadFirst*tr.all;
        const netMo = v.saves - v.monthly, afterMo = netMo*(1 - tr.all), real = v.price - nowSave;
        return {tr, basis, nowSave, spreadFirst, spreadSave, netMo, afterMo, real, payback: afterMo > 0 ? real/afterMo : Infinity, minis: v.price <= 2500};
      }},
    loan: {t:'Take a loan or advance', ic:'🏦', periodic:false,
      intro:'Shopify Capital, a bank loan or a line of credit. See what it really costs, what part is a write-off, and how much of every sale it takes while you pay it back.',
      sliders:[['amount','Amount you get',500,150000,500,14000,'$'],['fee','Fixed fee or total interest',0,30000,10,1638,'$','Shopify Capital shows a fixed fee; for a bank loan, the total interest'],
        ['hold','Share of daily sales it takes',0,40,1,25,'%','Shopify Capital "remittance rate". 0 for a regular monthly payment'],['sales','Your sales a month',500,150000,500,12000,'$'],
        ['pay','Or: fixed monthly payment',0,20000,25,0,'$','Bank loans']],
      calc(v, s){
        const tr = taxRate(s), total = v.amount + v.fee, perMonth = v.hold ? v.sales*v.hold/100 : v.pay;
        const months = perMonth > 0 ? total/perMonth : Infinity, yrs = months/12;
        const apr = isFinite(months) && months > 0 && v.amount ? (v.fee/(v.amount/2))/yrs : null; // average balance is about half the amount
        const gpMo = v.sales*s.margin/100;
        return {tr, total, perMonth, months, apr, feeSave: v.fee*tr.all, gpMo, leftMo: gpMo - perMonth, salesForFee: v.fee/(s.margin/100)};
      }},
    line: {t:'Add a product line', ic:'🧸', periodic:false,
      intro:'Opening stock and fixtures go out the door first; the profit comes back slowly as it sells. See the cash tied up, what counts as a write-off when, and the payback.',
      sliders:[['stock','Opening stock (your cost)',0,30000,50,1500,'$'],['fixtures','Fixtures and display',0,10000,25,200,'$'],['sales','Expected sales a month',0,30000,25,800,'$'],
        ['lineMargin','Margin on this line',5,90,1,50,'%','Gifts and sidelines usually 50% or more; books about 40%'],['turns','Times the stock sells through a year',1,12,0.5,3,'×','Bookstores average about 3 to 4']],
      calc(v, s){
        const tr = taxRate(s), out = v.stock + v.fixtures, gpMo = v.sales*v.lineMargin/100, after = gpMo*(1 - tr.all);
        const fixSave = v.fixtures*tr.all, real = out - fixSave, held = v.sales*12*(1 - v.lineMargin/100)/v.turns;
        return {tr, out, gpMo, after, fixSave, real, held, payback: after > 0 ? real/after : Infinity};
      }},
    event: {t:'Plan an event', ic:'🎉', periodic:false,
      intro:'An author visit, a story time or a sale night. See the break-even crowd, the write-off and what the store keeps.',
      sliders:[['cost','Costs: author fee, food, ads',0,5000,25,250,'$'],['people','Expected people',0,400,5,30,''],['spend','Average spend per person',0,200,1,25,'$'],
        ['hours','Staff hours for it',0,60,1,6,'hrs'],['rate','Their hourly pay',RATES.minWage,30,0.25,13,'$']],
      calc(v, s){
        const tr = taxRate(s), sales = v.people*v.spend, gp = sales*s.margin/100, labor = employerCost(PAST_CAPS, PAST_CAPS + v.hours*v.rate, s).total;
        const costs = v.cost + labor, net = gp - costs, perHead = v.spend*s.margin/100;
        return {tr, sales, gp, labor, costs, net, after: net*(1 - tr.all), be: perHead > 0 ? Math.ceil(costs/perHead) : Infinity};
      }},
    other: {t:'Something else', ic:'🤔', periodic:false,
      intro:'Any cost or idea. See the write-off, the real cost and how long it takes to pay back.',
      sliders:[['oneTime','One-time cost',0,50000,25,0,'$'],['monthlyCost','Monthly cost',0,10000,5,0,'$'],['monthlyGain','Monthly gain (extra gross profit or savings)',0,10000,5,0,'$']],
      calc(v, s){
        const tr = taxRate(s), netMo = v.monthlyGain - v.monthlyCost, after = netMo*(1 - tr.all), oneSave = v.oneTime*tr.all, real = v.oneTime - oneSave;
        return {tr, netMo, after, oneSave, real, payback: after > 0 ? real/after : Infinity, salesForMonthly: v.monthlyCost/(s.margin/100)};
      }}
  });
  const months = m => !isFinite(m) ? 'never at these numbers' : m < 1 ? 'under a month' : m < 24 ? Math.ceil(m)+' months' : (m/12).toFixed(1)+' years';
  Object.assign(RENDER, {
    hours(v, s, r, per){
      const d = PER[per], y = r.y, saved = y.total*r.tr.all;
      const say = v.extra+' more hours a week costs '+$$(y.total/d)+' '+PER_T[per]+' in pay, taxes and insurance. Each extra hour needs about '+$$(r.beHour)+' in sales to break even; at '+$$(v.perhour)+' an hour you '+(r.net >= 0 ? 'come out '+$$(r.net/d)+' ahead' : 'lose '+$$(-r.net/d))+' '+PER_T[per]+' before tax.';
      return {say, chain:[
        step('💵','Wages', $$(y.wages/d), v.extra+' hours × '+v.staff+(v.staff === 1 ? ' person' : ' people')+' × '+$$(v.rate)+'. If this pushes anyone past 40 hours, those hours cost 1.5 times.', 'cost', 0),
        step('🏛️','Payroll taxes and workers\' comp', $$((y.fica+y.wc)/d), 'Social Security and Medicare 7.65% plus workers\' comp. Unemployment taxes are usually already capped for people working all year.', 'tax', 1),
        step('🧾','Total cost', $$(y.total/d), $$(y.total/52)+' a week, '+$$(y.total/12)+' a month, '+$$(y.total, false)+' a year.', 'cost total', 2),
        step('🛍️','Sales in those hours', $$(r.sales/d), $$(v.perhour)+' an hour. Gross profit at your '+s.margin+'% margin: '+$$(r.gp/d)+'.', 'good', 3),
        step('⚖️','Break-even per hour', $$(r.beHour), 'Each extra hour must sell this much for the store to come out even.', v.perhour >= r.beHour ? 'good' : 'bad', 4),
        step(r.net >= 0 ? '📈' : '📉','Result before tax', (r.net >= 0 ? '+' : '')+$$(r.net/d), 'After tax: '+(r.net >= 0 ? '+' : '')+$$(r.net*(1 - r.tr.all)/d)+'. The wages are a write-off (saves '+$$(saved/d)+'), but so is any loss: it only softens it.', r.net >= 0 ? 'good' : 'bad', 5)
      ], visuals:[tiles('Costs the store', y.total), bar('Each extra hour', [{l:'Pay and taxes',v:y.total/(v.extra*v.weeks),t:'pine'},{l:'Profit it brings',v:r.gp/(v.extra*v.weeks),t:'calm'}])],
      learn:['Try it for a set time (for example 6 weekends) and compare sales hour by hour in Shopify.','Evening and Sunday hours often bring people who can\'t come otherwise; first weeks are slow while word spreads.','Opening longer also adds utilities and your own time.']};
    },
    purchase(v, s, r){
      const say = 'It costs '+$$(r.real)+' after the write-off if you count it all this year, and pays for itself in '+months(r.payback)+'.'+(r.minis ? ' At $2,500 or less you can simply expense it.' : '');
      return {say, chain:[
        step('💳','Cash out now', $$(v.price), 'Leaves your bank today, whatever the tax treatment.', 'cost total', 0),
        step('✂️','Write it all off this year', '-'+$$(r.nowSave), (r.minis ? 'At $2,500 or less, the de minimis rule lets you expense it like supplies. ' : 'Section 179 (and federal bonus depreciation) let you count it all in the year you start using it. ')+'Business share '+v.biz+'%: '+$$(r.basis)+' at '+pct(r.tr.all,1)+'.', 'save', 1),
        step('📆','Or spread it out', '-'+$$(r.spreadSave)+' yr 1', 'Regular depreciation over '+v.life+' years counts about '+$$(r.spreadFirst)+' the first year (half a year), more later. Better if you expect higher profits ahead.', 'tax', 2),
        step('💡','Real cost to you', $$(r.real), 'Counting it all this year. Buying just to save tax still costs you '+pct(1 - r.tr.all,0)+' of every dollar.', 'bad', 3),
        step('🔁','Each month after', (r.netMo >= 0 ? '+' : '')+$$(r.netMo), 'Saved or earned, minus running costs. After tax: '+$$(r.afterMo)+' (savings raise profit, and profit is taxed).', r.netMo >= 0 ? 'good' : 'bad', 4),
        step('⏳','Pays for itself in', months(r.payback), 'Real cost divided by what it brings each month after tax.', isFinite(r.payback) && r.payback <= v.life*12 ? 'good' : 'bad', 5)
      ], visuals:[bar('Who carries the cost', [{l:'Lower taxes',v:r.nowSave,t:'mustard'},{l:'You',v:r.real,t:'brandy'}])],
      learn:['Section 179 for '+RATES.year+': up to $2,560,000 a year, and it can\'t create a loss. Wisconsin follows Section 179 but not bonus depreciation.','A vehicle needs more than 50% business use for Section 179 or bonus, and cars have yearly caps.','If you sell it later, the depreciation you took can come back as income.','Add it on the Equipment list so the books count it right.']};
    },
    loan(v, s, r){
      const say = 'You get '+$$(v.amount)+' and pay back '+$$(r.total)+'. '+(v.hold ? 'Taking '+v.hold+'% of sales, that is about '+$$(r.perMonth)+' a month for '+months(r.months)+'. ' : '')+(r.apr != null ? 'That works out to roughly '+pct(r.apr,0)+' a year. ' : '')+'Only the '+$$(v.fee)+' fee is a write-off.';
      return {say, chain:[
        step('💰','Money in', $$(v.amount), 'Not income, so no tax on it. Paying it back is not a write-off either.', 'good', 0),
        step('🧾','What it costs', $$(v.fee), 'The fixed fee or interest: '+pct(v.fee/Math.max(1,v.amount),1)+' of the amount.', 'cost total', 1),
        step('📅','Paid back over', months(r.months), $$(r.perMonth)+' a month'+(v.hold ? ' ('+v.hold+'% of '+$$(v.sales, false)+' in sales). Slow months take less, busy months more.' : '.'), 'cost', 2),
        step('📈','As a yearly rate', r.apr != null ? 'about '+pct(r.apr,0) : '—', 'A fixed fee paid back fast is an expensive yearly rate: the faster you repay, the higher it is. Compare with a bank or SBA loan at 8 to 13%.', r.apr != null && r.apr > 0.2 ? 'bad' : 'tax', 3),
        step('✂️','Tax write-off', '-'+$$(r.feeSave), 'The fee counts as you pay it (Schedule C line 16b). The '+$$(v.amount)+' you pay back does not.', 'save', 4),
        step('🫙','Left of your gross profit', $$(r.leftMo)+'/mo', 'At '+s.margin+'% margin your sales bring about '+$$(r.gpMo)+' a month in gross profit. After the payment, '+$$(r.leftMo)+' is left for rent, wages and you.', r.leftMo > 0 ? 'tax' : 'bad', 5),
        step('🛒','Sales to cover the fee', $$(r.salesForFee), 'Extra sales at your margin just to pay for the money.', 'good', 6)
      ], visuals:[bar('Every month of sales', [{l:'Cost of goods',v:v.sales*(1 - s.margin/100),t:'pine'},{l:'Loan payment',v:Math.min(r.perMonth, v.sales),t:'brandy'},{l:'Left for everything else',v:Math.max(0, r.leftMo),t:'calm'}])],
      learn:['Borrow for something that earns it back (holiday stock that sells, equipment that saves time), not to cover a gap that will come back.','Shopify Capital has no interest rate on paper, but the fee over a short payback can equal a high yearly rate.','Track each payment on the Loans screen so the write-off is right.','Wisconsin and SBA micro-loans and local revolving-loan funds often cost less; ask your bank or the county economic development office.']};
    },
    line(v, s, r){
      const say = 'You put '+$$(r.out)+' in up front. It brings about '+$$(r.gpMo)+' gross profit a month and pays back in '+months(r.payback)+'. To keep it stocked, about '+$$(r.held)+' of your cash stays on the shelf.';
      return {say, chain:[
        step('📦','Opening stock', $$(v.stock), 'Not a write-off yet: it becomes cost of goods sold as it sells.', 'tax', 0),
        step('🪑','Fixtures and display', $$(v.fixtures), (v.fixtures <= 2500 ? 'Written off this year (de minimis).' : 'Section 179 can count it this year.')+' Saves about '+$$(r.fixSave)+'.', 'save', 1),
        step('💳','Cash out the door', $$(r.out), 'Real cost after the fixtures write-off: '+$$(r.real)+'.', 'cost total', 2),
        step('📈','Gross profit a month', $$(r.gpMo), $$(v.sales)+' in sales at '+v.lineMargin+'%. After tax about '+$$(r.after)+'.', 'good', 3),
        step('📚','Cash on the shelf to keep it going', $$(r.held), 'Stock at cost you carry on average, selling through '+v.turns+' times a year.', 'tax', 4),
        step('⏳','Pays back in', months(r.payback), 'Up-front cost after the write-off, divided by after-tax profit a month.', isFinite(r.payback) && r.payback <= 12 ? 'good' : 'bad', 5)
      ], visuals:[bar('Each '+$$(100, false)+' of sales on this line', [{l:'What the goods cost',v:100 - v.lineMargin,t:'pine'},{l:'Gross profit',v:v.lineMargin,t:'calm'}])],
      learn:['Ask vendors for minimums, terms (net 30 lets sales pay for the stock) and whether unsold items can come back.','Pick a number to judge it by in 3 months, like sales a month or sell-through.','What comes off the floor to make room has a cost too.']};
    },
    event(v, s, r){
      const say = 'You need about '+(isFinite(r.be) ? r.be : 'endless')+' people to break even. With '+v.people+', the store '+(r.net >= 0 ? 'keeps '+$$(r.net) : 'loses '+$$(-r.net))+' before tax'+(r.net >= 0 ? ' ('+$$(r.after)+' after)' : '')+'.';
      return {say, chain:[
        step('🎟️','Costs', $$(v.cost), 'Author fee, food, ads, supplies. All of it is a write-off (food for a public event counts in full).', 'cost', 0),
        step('🧑‍💼','Staff time', $$(r.labor), v.hours+' hours with payroll taxes and workers\' comp.', 'cost', 1),
        step('🛍️','Sales', $$(r.sales), v.people+' people × '+$$(v.spend)+'. Gross profit at '+s.margin+'%: '+$$(r.gp)+'.', 'good', 2),
        step('⚖️','Break-even crowd', isFinite(r.be) ? r.be+' people' : '—', 'Each person brings about '+$$(v.spend*s.margin/100)+' in profit.', isFinite(r.be) && r.be <= v.people ? 'good' : 'bad', 3),
        step(r.net >= 0 ? '📈' : '📉','Result', (r.net >= 0 ? '+' : '')+$$(r.net), 'After tax: '+(r.net >= 0 ? '+' : '')+$$(r.after)+'. Events also bring new regulars and community goodwill that don\'t show up here.', r.net >= 0 ? 'good' : 'bad', 4)
      ], visuals:[bar('Where the money goes', [{l:'Costs',v:v.cost,t:'brandy'},{l:'Staff',v:r.labor,t:'pine'},{l:'Profit kept',v:Math.max(0, r.net),t:'calm'}])],
      learn:['Ask the publisher to share costs (co-op), or sell tickets that include the book.','Pre-orders and signed stock sell after the event too.','Count who came and what sold, so the next one is easier to judge.']};
    },
    other(v, s, r){
      const say = (v.oneTime ? 'Up front '+$$(v.oneTime)+', really '+$$(r.real)+' after the write-off. ' : '')+'Each month '+(r.netMo >= 0 ? '+' : '')+$$(r.netMo)+' before tax, '+(r.after >= 0 ? '+' : '')+$$(r.after)+' after.'+(v.oneTime ? ' Pays back in '+months(r.payback)+'.' : '');
      return {say, chain:[
        step('💳','One-time cost', $$(v.oneTime), 'Write-off saves about '+$$(r.oneSave)+' if it counts this year (equipment may be spread out).', 'cost', 0),
        step('🔁','Each month', (r.netMo >= 0 ? '+' : '')+$$(r.netMo), 'Gain minus cost. After tax: '+$$(r.after)+'.', r.netMo >= 0 ? 'good' : 'bad', 1),
        v.monthlyCost ? step('🛒','Sales to cover the monthly cost', $$(r.salesForMonthly), 'At your '+s.margin+'% margin.', 'good', 2) : null,
        v.oneTime ? step('⏳','Pays back in', months(r.payback), 'Real up-front cost divided by the monthly gain after tax.', isFinite(r.payback) ? 'good' : 'bad', 3) : null
      ], visuals:[], learn:['What is the cheapest way to try it first?','What would make you undo it?']};
    }
  });


  // ---------- stock that isn't selling: compare every way out ----------
  KINDS.leftover = {t:'Stock that isn\'t selling', ic:'🧺', periodic:false,
    intro:'Compare what each choice really leaves you after tax: hold it, mark it down (even below what you paid), send it back, donate it, give it away as promotion, or write it off.',
    sliders:[['units','How many',1,200,1,10,''],['cost','What each cost you (with freight)',0.5,100,0.25,9,'$'],['price','Regular price',1,150,0.5,17.99,'$'],
      ['disc','Markdown price',0,150,0.25,6,'$','Can be below what you paid'],['credit','Supplier return credit',0,100,5,0,'%','Most publishers credit returned books in full; gifts are rarely returnable'],
      ['retShip','Shipping it back, per item',0,10,0.25,1,'$'],['months','If you hold it: months',1,24,1,6,'mo'],['chance','If you hold it: share that sells at full price',0,100,5,20,'%']],
    calc(v, s){
      const tr = taxRate(s), C = v.units*v.cost, fee = s.cardFee/100, rate = tr.all, after = p => p*(1 - rate);
      const inc = (s.fed/100) + (s.wi/100); // a personal charity deduction saves income tax only, not self-employment tax
      const opts = [];
      const discCash = v.units*v.disc*(1 - fee);
      opts.push({k:'disc', ic:'🏷️', t:'Mark it down to '+$$(v.disc), cash:discCash, res:after(discCash - C),
        why:(v.disc < v.cost ? 'Below what you paid: each sale loses '+$$(v.cost - v.disc*(1-fee))+', but that loss lowers your tax. ' : 'Still above cost, so each sale makes a little. ')+'Cash comes back now and frees the shelf. Selling below cost is legal; it just counts as a lower profit.'});
      const holdCash = v.units*v.chance/100*v.price*(1 - fee), carry = C*0.015*v.months;
      opts.push({k:'hold', ic:'⏳', t:'Hold it '+v.months+' months', cash:holdCash, res:after(holdCash - C) - carry, guess:true,
        why:'A guess: '+v.chance+'% sell at full price and the rest is written off later. Tied-up cash and shelf space cost about '+$$(carry)+'. Nothing counts for tax until it sells or goes.'});
      if (v.credit > 0){ const cr = v.units*(v.cost*v.credit/100 - v.retShip);
        opts.push({k:'return', ic:'↩️', t:'Send it back for credit', cash:cr, res:after(cr - C),
          why:v.credit+'% credit minus '+$$(v.units*v.retShip)+' shipping. Usually store credit with that supplier, so it only helps if you order from them again.'}); }
      opts.push({k:'promo', ic:'🎁', t:'Give it to customers as promotion', cash:0, res:after(-C),
        why:'Free with a purchase, a giveaway or a prize. The cost stays a write-off (as cost of goods sold or advertising). It pays off if it brings '+$$(C/(s.margin/100))+' in sales you wouldn\'t have had.'});
      opts.push({k:'donate', ic:'🤝', t:'Donate it to a cause', cash:0, res:after(-C),
        why:'For your LLC the simplest way: the cost stays in cost of goods sold, so it still saves the full '+pct(rate,0)+'. There is no extra deduction at the price; that is only for corporations. Counts in your community impact report.'});
      opts.push({k:'donateA', ic:'📝', t:'Donate it, taken on your personal return', cash:0, res:-C + C*inc*(s.itemize ? 1 : 0),
        why:(s.itemize ? 'Cost removed from the business and deducted on Schedule A: saves income tax only ('+pct(inc,0)+'), not self-employment tax, so it is worth less than the line above.' : 'Only helps if you itemize. Most owners take the standard deduction ($16,100 single in 2026), so this saves nothing.')+' Only stock bought in an earlier year can go this way.'});
      opts.push({k:'toss', ic:'🗑️', t:'Write it off as lost, damaged or thrown out', cash:0, res:after(-C),
        why:'No cash back. The cost counts through cost of goods sold when your count shows it gone. Keep a photo or a note of what and why.'});
      opts.sort((a,b) => b.res - a.res);
      return {tr, C, opts, sunk: C, best: opts[0]};
    }};
  RENDER.leftover = (v, s, r) => {
    const say = 'You already paid '+$$(r.C)+'; that money is gone whatever you do. The best way out here is "'+r.best.t+'": '+(r.best.res >= 0 ? 'you end up '+$$(r.best.res)+' ahead' : 'it costs you '+$$(-r.best.res))+' after tax, compared with a '+$$(r.C*(1 - r.tr.all))+' cost for writing it off.';
    const max = Math.max(...r.opts.map(o => Math.abs(o.res)), 1);
    const cmp = h('div',{class:'rp-bar'}, h('h4',null,'After tax, compared'), h('ul',{class:'rp-cmp'}, r.opts.map(o => h('li',null,
      h('span',{class:'lab'}, o.t), h('span',{class:'track'}, h('span',{class:'part '+(o.res >= 0 ? 't-calm' : 't-brandy'), style:'width:'+(100*Math.abs(o.res)/max)+'%'})), h('b',null, (o.res >= 0 ? '+' : '')+$$(o.res))))));
    return {say, chain:[
      step('🧾','Already spent', $$(r.C), v.units+' × '+$$(v.cost)+'. A sunk cost: decide on what each choice brings from here, not on what you paid.', 'cost total', 0),
      ...r.opts.map((o, i) => step(o.ic, o.t+(i === 0 ? ' · best here' : ''), (o.res >= 0 ? '+' : '')+$$(o.res), (o.cash ? 'Cash back '+$$(o.cash)+'. ' : '')+o.why, o.res >= 0 ? 'good' : i === 0 ? 'save' : 'bad', Math.min(i+1, 6)))
    ], visuals:[cmp],
    learn:['Results are after tax: a loss lowers your tax at your combined rate, so a markdown below cost often still beats a write-off because cash comes back.','Wisconsin sales tax: charge it on the markdown price. A free giveaway with no sale has no sales tax.','Damaged books from most publishers can be returned or "stripped" for credit; ask before throwing them out.','Log giveaways and donations as write-offs in the app so the year-end count and the books match.']};
  };

  // ---------- proof to keep: what backs up each decision, captured when it happens, not at year end ----------
  // Each item: [what to keep, why it matters]. The app shows what a missing record could cost if the IRS or Wisconsin asks.
  const AUDIT = {penalty: 0.20, interest: 0.07}; // accuracy-related penalty (IRC 6662) and the IRS underpayment rate, about 7% a year in 2026
  const PROOF = {
    raise:[['The new pay rate in writing, with the date it starts','Settles any question about what was owed, and Wisconsin requires pay records for 3 years.'],
      ['Time clock or timesheets for the hours paid','Wages are deductible only for work actually done; the hours prove it, and they back overtime pay.'],
      ['Payroll reports from your payroll service','Show the wages and the payroll taxes you paid, which is what you deduct.']],
    hire:[['W-4 and Wisconsin WT-4','Tell you how much to withhold. Without them you must withhold as single with no adjustments.'],
      ['I-9, with ID seen within 3 days of starting','Required by federal law for every hire. Missing forms carry fines per person, separate from taxes.'],
      ['New-hire report to Wisconsin within 20 days','Required by the state (it helps child-support orders); late reports can be fined.'],
      ['Offer letter with pay rate and start date','Proves the agreed pay if there is ever a question.'],
      ['Workers\' comp policy that covers them','Working without it once required can cost a penalty and every injury claim out of pocket.'],
      ['Time clock records and payroll reports','Prove the wages you deduct and that overtime was paid right.']],
    order:[['Supplier invoice and packing slip, checked in when the box arrives','Prove what you bought and what it cost. Cost of goods sold is your biggest deduction: no invoice, no deduction.'],
      ['Freight or shipping bill, rush charges too','Freight is part of what the stock cost. Without the bill it can\'t be counted.'],
      ['Proof of payment (card, bank or check)','Shows you actually paid, and when.'],
      ['A stock count on December 31','Cost of goods sold is start + purchases - end. The count proves the end number, and it is how losses get counted.']],
    price:[['The price change in Shopify','Keeps sales records right, so reported sales match the register.'],
      ['Discounts rung in the register, never as cash off','A discount lowers the sale. Cash taken off outside the register makes sales and cash not match, which is exactly what an auditor looks for.']],
    hours:[['The schedule and time clock for those hours','Prove the wages you deduct.'],['Shopify sales by hour','Not for taxes: it tells you whether the hours worked.']],
    purchase:[['Receipt or invoice','Proves the cost you deduct or depreciate.'],['The date you started using it','The write-off starts in the year it is put in service, not when you paid.'],
      ['Business-use share if under 100% (a mileage log for a vehicle)','Only the business share counts. A vehicle without a log can lose the whole write-off.'],['Its line on the Equipment list','Keeps the yearly depreciation right and tracks it if you sell it.']],
    loan:[['The loan or advance agreement','Shows it is a loan (not income) and what the fee or interest is.'],['Every payment (Shopify admin > Finance > Capital, or statements)','Splits each payment into the deductible fee or interest and the non-deductible principal.'],['What the money paid for','Business use of the money is what makes the interest deductible.']],
    line:[['Vendor invoices','Prove the cost of the stock (cost of goods sold).'],['Opening stock count for the line','Starting point for measuring how it sells and for your year-end count.'],['Fixture receipts','Prove the fixtures you deduct now or depreciate.']],
    event:[['Receipts for every cost','No receipt, no deduction. Under $75 a note can do, but receipts are safer.'],['Author or performer agreement, and a W-9 before you pay them','Paying a person $2,000 or more in 2026 ($600 for Wisconsin) means a 1099; without a W-9 you may have to hold back 24% of the payment.'],
      ['Event sales in Shopify (tag the day)','Shows the event was for the business.'],['A photo or flyer','Shows it promoted the store, which is what makes it advertising.']],
    other:[['Receipt or invoice','No receipt, no deduction.'],['A note of what it was for','The business reason is what makes it deductible.']]
  };
  const PROOF_LEFT = {
    disc:[['Markdown rung in Shopify','The sale shows the lower price, so your books match the register.']],
    hold:[['Count it in your next stock count','Unsold stock stays on the books until it sells or goes.']],
    return:[['Return authorization from the supplier','Shows it went back, not missing.'],['Credit memo when it is applied','Lowers your purchases by the credit, keeping cost of goods sold right.'],['Shipping label or receipt','Shows when it left.']],
    promo:[['A log: what, how many, at cost, date, and who got it or why','Shows it was a business promotion, not a personal gift.'],['A photo of the display, giveaway or prize','Easy proof it promoted the store.'],['Lower the count in Shopify','Your year-end count then matches the books.']],
    donate:[['Written acknowledgment from the charity for gifts of $250 or more','Required by law for any deduction of $250+ taken as a charitable gift; it must be in hand by the time you file.'],['What you gave, how many and your cost','Your cost is the most you can count.'],['Lower the count in Shopify','Your year-end count then matches the books.']],
    donateA:[['Written acknowledgment from the charity ($250 or more)','Required for any charitable deduction of $250+.'],['Form 8283 if your noncash gifts total over $500','Required with your return; missing it can lose the deduction.'],['Stock removed from opening inventory','Stops the cost from being counted twice.']],
    toss:[['A photo of the damage, or a note of what went missing','Proves the loss. Unexplained missing stock looks like unreported sales.'],['Date, item, how many and your cost','The loss counts at cost.'],['Lower the count in Shopify','Your year-end count then matches the books.']]
  };
  // the write-off this decision depends on, so the app can show what a missing record could cost
  const STAKE = {raise:r => r.y.total, hire:r => r.y.total, hours:r => r.y.total, order:r => r.out, purchase:r => r.basis, loan:(r, v) => v.fee, line:r => r.out,
    event:r => r.costs, other:(r, v) => v.oneTime + v.monthlyCost*12, price:() => 0, leftover:r => r.C};
  function proofBox(kind, v, r, s, optKey){
    const ok = optKey || (r.best && r.best.k), opt = kind === 'leftover' ? (r.opts.find(o => o.k === ok) || r.best) : null;
    const items = kind === 'leftover' ? (PROOF_LEFT[ok] || []) : (PROOF[kind] || []);
    if (!items.length) return null;
    const D = kind === 'leftover' ? (['promo','donate','donateA','toss'].includes(ok) ? r.C : 0) : (STAKE[kind] || (() => 0))(r, v, s), tr = taxRate(s), tax = D*tr.all, pen = tax*AUDIT.penalty, int = tax*AUDIT.interest*2;
    return h('div',{class:'rp-proof'}, h('h4',null, kind === 'leftover' ? 'Proof to keep for "'+opt.t+'"' : 'Proof to keep, and why'),
      h('ul',null, items.map(([t, why]) => h('li',null, h('b',null,t), h('span',null, why)))),
      D > 0 ? h('p',{class:'rp-risk'}, 'Without the records, the '+$$(D)+' write-off can be thrown out: '+$$(tax)+' more tax. If it comes up in an audit two years later, add the 20% accuracy penalty ('+$$(pen)+') and about 7% a year interest ('+$$(int)+'): about '+$$(tax + pen + int)+' in all.') : null,
      h('p',{class:'rp-fine'},'Keep records at least 3 years after you file (7 for losses, payroll records 4). A photo in the app counts.'));
  }
  KINDS.leftover.record = {promo:'promo', donate:'charity', donateA:'charity', toss:'damaged'};

  // ---------- mount ----------
  // Ripple.use(cfg) sets what every panel on the page starts from (the app passes the store's numbers and the owner's
  // tax picture once). mount(el, opts) draws the tabbed explainer; panel(el, kind, opts) draws one decision's hidden
  // effects anywhere a money decision happens (Decision planner, Loans, Equipment, Tax year).
  // opts: {kinds, start, only, title, values, onValues(v), onRecord(kind, rec), store, settings, onSettings(s), firstHire, auto, fromNote}
  let CFG = {};
  function use(cfg){ CFG = Object.assign({}, CFG, cfg || {}); }
  function mount(el, opts){
    opts = Object.assign({}, CFG, opts || {});
    const kinds = opts.only ? [opts.only] : (opts.kinds || ['raise','hire','order','leftover','price','hours','purchase','loan','line','event']).filter(k => KINDS[k]);
    const s = Object.assign({}, DEFAULTS, {cardFee:RATES.cardFee, itemize:false}, opts.settings || {});
    const st = opts.store || {}, touched = new Set(s.touched || []);
    // the store's own margin and average sale win, unless the owner typed their own
    if (st.margin && !touched.has('margin')) s.margin = Math.round(st.margin);
    if (st.avgSale && !touched.has('avgSale')) s.avgSale = Math.round(st.avgSale);
    let kind = kinds.includes(opts.start) ? opts.start : kinds[0], per = 'month';
    const vals = {};
    kinds.forEach(k => { vals[k] = {}; KINDS[k].sliders.forEach(([key,,,,,d]) => vals[k][key] = d); });
    if (st.rate){ ['raise','hire','hours','event'].forEach(k => { if (vals[k]) vals[k].rate = Math.max(RATES.minWage, Math.round(st.rate*4)/4); }); }
    if (st.people && vals.raise) vals.raise.people = Math.min(15, st.people);
    if (st.avgDay && vals.loan) vals.loan.sales = Math.round(st.avgDay*30/100)*100;
    if (opts.values && vals[kind]) for (const k in opts.values) if (k in vals[kind] && isFinite(+opts.values[k])) vals[kind][k] = +opts.values[k];
    const firstHire = opts.firstHire != null ? opts.firstHire : !(st.people > 0);
    const uidp = 'rp'+Math.random().toString(36).slice(2,7);

    el.textContent = '';
    const root = h('div',{class:'rp'+(opts.auto ? ' rp-auto' : '')});
    el.append(root);
    const panel = h('div',{class:'rp-box', id:uidp});
    const tbtn = {};
    if (kinds.length > 1){
      const tabs = h('div',{class:'rp-tabs', role:'tablist', 'aria-label':'Pick a change'});
      panel.setAttribute('role','tabpanel');
      kinds.forEach(k => { const b = h('button',{type:'button', role:'tab', id:uidp+'-'+k, 'aria-controls':uidp, 'aria-selected':String(k === kind), tabindex:k === kind ? '0' : '-1',
        onclick:()=>{ kind = k; sync(); draw(); },
        onkeydown:e=>{ const i = kinds.indexOf(k), n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!n) return; e.preventDefault(); kind = kinds[(i+n+kinds.length)%kinds.length]; sync(); draw(); tbtn[kind].focus(); }},
        h('span',{'aria-hidden':'true'}, KINDS[k].ic), KINDS[k].t); tbtn[k] = b; tabs.append(b); });
      root.append(tabs);
    }
    function sync(){ if (kinds.length < 2) return; kinds.forEach(k => { tbtn[k].setAttribute('aria-selected', String(k === kind)); tbtn[k].tabIndex = k === kind ? 0 : -1; }); panel.setAttribute('aria-labelledby', tbtn[kind].id); }
    root.append(panel, settingsBox());

    // sliders on the left, the ripple on the right
    let out, last = null;
    function draw(){
      const K = KINDS[kind], v = vals[kind];
      panel.textContent = '';
      panel.append(h('h3',null, opts.title || (opts.only ? 'Hidden effects: '+K.t.toLowerCase() : K.t)), h('p',{class:'rp-intro'}, K.intro));
      const left = h('div',{class:'rp-sliders'});
      K.sliders.forEach(([key, label, min, max, stp, , unit, hint]) => {
        const id = uidp+'-'+kind+'-'+key, nid = id+'-n';
        const range = h('input',{type:'range', id, min, max, step:stp, value:Math.min(max, v[key]), 'aria-describedby':hint ? id+'-h' : null});
        const box = h('input',{type:'number', id:nid, min, max:max*10, step:stp, value:v[key], inputmode:'decimal', 'aria-label':label+(unit && unit !== '$' ? ' ('+unit+')' : unit === '$' ? ' (dollars)' : '')});
        const set = (x, from) => { x = +x; if (!isFinite(x)) return; v[key] = x; if (from !== range) range.value = String(Math.min(max, Math.max(min, x))); if (from !== box) box.value = String(x); recalc();
          if (opts.onValues) opts.onValues(Object.assign({}, v)); };
        range.addEventListener('input', () => set(range.value, range));
        box.addEventListener('input', () => { if (box.value !== '') set(Math.max(min, +box.value), box); });
        left.append(h('div',{class:'rp-sl'}, h('div',{class:'rp-top'}, h('label',{for:id}, label), h('span',{class:'val'}, unit === '$' ? h('span',{'aria-hidden':'true'},'$') : null, box, unit && unit !== '$' ? h('span',{'aria-hidden':'true'}, /^(hrs|wks|mo|yrs)$/.test(unit) ? ' '+unit : unit) : null)),
          range, hint ? h('span',{class:'hint', id:id+'-h'}, hint) : null));
      });
      if (opts.fromNote && (kind === 'raise' || kind === 'hire') && st.rate) left.append(h('p',{class:'rp-from'}, opts.fromNote));
      const right = h('div',{class:'rp-sliders'});
      const headRow = h('div',{class:'rp-head'}, h('h4',null,'The ripple'));
      if (K.periodic){ const seg = h('div',{class:'rp-seg', role:'group', 'aria-label':'Show amounts per'});
        ['week','month','year'].forEach(p => seg.append(h('button',{type:'button', 'aria-pressed':String(p === per), onclick:()=>{ per = p; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.textContent.toLowerCase() === p))); recalc(); }}, p[0].toUpperCase()+p.slice(1))));
        headRow.append(seg); }
      out = h('div',{class:'rp-sliders'});
      right.append(headRow, out);
      panel.append(h('div',{class:'rp-body'}, left, right));
      recalc();
    }
    function recalc(){
      const K = KINDS[kind], v = vals[kind], r = K.calc(v, s, {firstHire});
      const o = RENDER[kind](v, s, r, per, {avgDay:st.avgDay, firstHire});
      last = {kind, v, r};
      out.textContent = '';
      const pw = h('div');
      out.append(h('p',{class:'rp-say', 'aria-live':'polite'}, o.say), h('ol',{class:'rp-chain'}, o.chain), ...o.visuals, pw);
      const showProof = k => pw.replaceChildren(proofBox(kind, v, r, s, k) || '');
      showProof(kind === 'leftover' && opts.onRecord ? (r.opts.find(x => K.record[x.k]) || r.best).k : null);
      // record it now so the books and Tax year update today, not at year end
      if (kind === 'leftover' && opts.onRecord){
        const pick = h('select',{'aria-label':'Which choice to record', onchange:e => showProof(e.target.value)},r.opts.filter(x => K.record[x.k]).map(x => h('option',{value:x.k}, x.t)));
        out.append(h('div',{class:'rp-proof'}, h('h4',null,'Record it now'),
          h('p',{class:'rp-fine'},'Adds it to your write-offs today, so the Tax year and stock numbers are right now, not at year end. Then add the photo or the charity\'s letter there.'),
          h('div',{class:'rp-head'}, pick, h('button',{type:'button', class:'rp-btn', onclick:()=>{ const x = r.opts.find(o => o.k === pick.value);
            opts.onRecord('leftover', {why:K.record[x.k], qty:v.units, cost:v.cost, retail:v.price, label:x.t}); }}, 'Record it'))));
      }
      out.append(h('details',{class:'rp-settings'}, h('summary',null,'Good to know'), h('ul',{class:'rp-learn'}, o.learn.map(x => h('li',null,x)))));
    }

    // the owner's tax picture and store numbers, shared by every explainer
    function settingsBox(){
      const tr = h('span',{class:'rp-from'});
      const showTr = () => { const t = taxRate(s); tr.textContent = 'Each $1 you write off saves about '+$$(t.all, true).replace('$','')+' in tax ('+pct(t.all,1)+'): federal '+pct(t.fed,1)+', Wisconsin '+pct(t.wi,1)+(s.se ? ', self-employment '+pct(t.se,1) : '')+'.'; };
      const changed = key => { touched.add(key); s.touched = [...touched]; showTr(); if (opts.onSettings) opts.onSettings(Object.assign({}, s)); if (out) recalc(); };
      const sel = (label, key, list) => h('label',{class:'f'}, label, h('select',{onchange:e=>{ s[key] = +e.target.value; changed(key); }}, list.map(([val, t]) => h('option',{value:val, selected:+val === +s[key]}, t))));
      const chk = (label, key) => h('label',{class:'chk'}, h('input',{type:'checkbox', checked:!!s[key], onchange:e=>{ s[key] = e.target.checked; changed(key); }}), h('span',null,label));
      const numIn = (label, key, min, max, stp, hint) => h('label',{class:'f'}, label, h('input',{type:'number', min, max, step:stp, value:s[key], class:'rp-num', oninput:e=>{ if (e.target.value !== ''){ s[key] = +e.target.value; changed(key); } }}), hint ? h('span',{class:'rp-fine'}, hint) : null);
      showTr();
      return h('details',{class:'rp-settings'}, h('summary',null,'Your numbers and tax picture'),
        h('div',{class:'in'},
          h('div',{class:'rp-g2'},
            numIn('Your gross margin on sales (%)','margin',1,95,1, st.margin ? 'From your Shopify sales and costs.' : 'Sales minus what the goods cost you. Bookstores often run 38 to 46%.'),
            numIn('Average sale ($)','avgSale',1,500,1, st.avgSale ? 'From your Shopify sales.' : null),
            numIn('Workers\' comp ($ per $100 of pay)','wc',0,10,0.05,'On your policy\'s declarations page.'),
            numIn('Wisconsin unemployment rate (%)','suta',0,12,0.05,'New employers start at 3.05%. DWD mails your rate each December.'),
            numIn('Card fee (% of each sale)','cardFee',0,6,0.1,null)),
          h('div',{class:'rp-g2'}, sel('Federal tax bracket','fed',RATES.fed), sel('Wisconsin tax bracket','wi',RATES.wi)),
          chk('I take owner\'s draws from a sole-member LLC (self-employment tax applies to profit, so every write-off also saves 14.1%)','se'),
          chk('Count the 20% qualified business income deduction (federal)','qbi'),
          chk('I itemize deductions on my personal return (most people take the standard deduction)','itemize'),
          tr,
          h('p',{class:'rp-fine'},'Estimates for learning and planning, not tax advice. '+RATES.year+' federal and Wisconsin figures. Your accountant has the final numbers.')));
    }
    sync(); draw();
    return {set(k){ if (KINDS[k] && kinds.includes(k)){ kind = k; sync(); draw(); } }, values:() => Object.assign({}, vals[kind]), result:() => last};
  }
  const panel = (el, kind, opts) => mount(el, Object.assign({}, opts || {}, {only:kind}));

  window.Ripple = {RATES, KINDS, DEFAULTS, AUDIT, taxRate, payYear, employerCost, use, mount, panel};
})();
