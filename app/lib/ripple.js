// Ripple explainers: move a slider and see how one change ripples through the business.
//   raise  - give someone a raise: weekly/monthly/yearly cost, employer taxes, workers' comp, overtime, the write-off,
//            the real cost after tax, and the extra sales it takes to cover it.
//   hire   - add a person: the same, plus the payroll service and training.
//   order  - order products: landed cost, margin vs markup, cash out the door, sell-through, break-even, and why stock
//            you haven't sold isn't a write-off yet (inventory -> cost of goods sold when it sells).
//   price  - change a price: how many sales you can lose (or must gain) before profit moves.
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
      intro:'Slide the cost, quantity, price, freight and how much sells. See your margin, the cash it ties up, when you break even, and what counts as a write-off this year.',
      sliders:[['cost','Cost per item from the supplier',0.5,100,0.25,9,'$','Books: the publisher\'s discount, often 40 to 46% off the printed price'],['qty','How many you order',1,200,1,24,''],
        ['price','Your selling price',1,150,0.5,17.99,'$'],['freight','Shipping and freight for the order',0,200,1,18,'$'],['sell','How many sell (sell-through)',0,100,5,70,'%','Within the season or the tax year']],
      calc(v, s){
        const buy = v.cost*v.qty, out = buy + v.freight, landed = out / Math.max(1, v.qty);
        const fee = v.price * s.cardFee/100, net = v.price - fee;
        const sold = Math.round(v.qty * v.sell/100), left = v.qty - sold;
        const revenue = sold*v.price, fees = sold*fee, cogs = sold*landed, gp = revenue - cogs - fees;
        const margin = (v.price - landed)/v.price, markup = (v.price - landed)/landed;
        const be = net > 0 ? Math.ceil(out / net) : Infinity;
        const tr = taxRate(s), tax = Math.max(0, gp) * tr.all;
        return {buy, out, landed, fee, net, sold, left, revenue, fees, cogs, gp, margin, markup, be, tax, leftCost:left*landed, tr, allGp:v.qty*(net - landed)};
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
      const say = 'You pay '+$$(r.out)+' up front. Each one really costs '+$$(r.landed)+' with freight, so your margin is '+pct(r.margin,0)+'. If '+v.sell+'% sell, you make '+$$(r.gp)+' before tax, and '+r.left+' sit on the shelf holding '+$$(r.leftCost)+' of your cash.';
      const units = h('div',{class:'rp-units', role:'img', 'aria-label':r.sold+' of '+v.qty+' sold, '+r.left+' left on the shelf'});
      for (let i = 0; i < Math.min(v.qty, 200); i++) units.append(h('i',{class:i < r.sold ? 'sold' : 'left'}));
      const beTxt = isFinite(r.be) ? (r.be <= v.qty ? 'Sell '+r.be+' of '+v.qty+' ('+pct(r.be/v.qty,0)+') to get your cash back.' : 'Even selling all '+v.qty+' won\'t get your cash back at this price.') : 'The price is below the card fee. Nothing comes back.';
      return {say, chain:[
        step('📦','You pay the supplier', $$(r.buy), $$(v.cost)+' × '+v.qty+'.', 'cost', 0),
        step('🚚','Shipping and freight in', $$(v.freight), 'Freight to get stock to you is part of what the stock costs: '+$$(v.freight/Math.max(1,v.qty))+' added to each item.', 'cost', 1),
        step('💰','Cash out the door', $$(r.out), 'All of it leaves your bank now, before anything sells.', 'cost total', 2),
        step('🏷️','Each one really costs', $$(r.landed), 'Margin '+pct(r.margin,1)+' of the price. Markup '+pct(r.markup,0)+' on cost. (Doubling the cost is a 100% markup but only a 50% margin.)', r.margin < 0.3 ? 'bad' : 'good', 3),
        step('🛍️','If '+v.sell+'% sell', $$(r.revenue), r.sold+' sold at '+$$(v.price)+'. Card fees take '+$$(r.fees)+' ('+s.cardFee+'%).', 'good', 4),
        step('📈','Gross profit on what sold', $$(r.gp), 'Sales minus what those '+r.sold+' cost you (cost of goods sold, '+$$(r.cogs)+') minus card fees. If all '+v.qty+' sell: '+$$(r.allGp)+'.', r.gp >= 0 ? 'good' : 'bad', 5),
        step('📚','Still on the shelf', $$(r.leftCost), r.left+' items. This is cash tied up, and it is not a write-off yet: unsold stock is inventory (something you own). It becomes a deduction as cost of goods sold when it sells, or when you mark it down, donate it or throw it out.', 'tax', 5),
        step('✂️','Tax this year', $$(r.tax), 'Only the cost of what sold and the card fees come off your sales this year. At '+pct(r.tr.all,1)+' you owe about this on the profit, leaving '+$$(r.gp - r.tax)+'. Shipping you pay to send orders to customers is a regular expense, written off right away.', 'tax', 6),
        step('⚖️','Break-even', isFinite(r.be) ? r.be+' sold' : '—', beTxt, isFinite(r.be) && r.be <= v.qty ? 'good' : 'bad', 6)
      ], visuals:[
        bar('Where each '+$$(v.price)+' sale goes', [{l:'Item cost',v:v.cost,t:'pine'},{l:'Freight',v:v.freight/Math.max(1,v.qty),t:'pinesoft'},{l:'Card fee',v:r.fee,t:'brandy'},{l:'Your profit',v:Math.max(0, v.price - r.landed - r.fee),t:'calm'}]),
        h('div',{class:'rp-bar'}, h('h4',null,'Sold and still on the shelf'), units,
          h('ul',{class:'rp-key'}, h('li',null,h('i',{class:'t-calm','aria-hidden':'true'}),'Sold '+r.sold), h('li',null,h('i',{style:'border:2px solid var(--rp-brandy)','aria-hidden':'true'}),'On the shelf '+r.left)))],
      learn:[
        'Margin is profit as a share of the price; markup is profit as a share of the cost. Books at a 40% discount off the printed price give about a 40% margin before freight.',
        'Freight in (from the supplier) becomes part of the stock\'s cost. It is written off only as those items sell. Shipping out to customers is a regular expense.',
        'Stock you buy is not a write-off when you pay for it. Your yearly cost of goods sold is: stock at the start of the year + what you bought - stock at the end of the year. Counting stock on December 31 matters.',
        'Slow sellers tie up cash. Returnable books (most publishers allow returns for credit) lower the risk; non-returnable gifts and sidelines need a higher margin.',
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

  // ---------- mount ----------
  // opts: {kinds, start, store:{rate, people, avgDay, margin, avgSale}, settings, onSettings(s), firstHire, auto (website dark mode), fromNote}
  function mount(el, opts){
    opts = opts || {};
    const kinds = (opts.kinds || Object.keys(KINDS)).filter(k => KINDS[k]);
    const s = Object.assign({}, DEFAULTS, {cardFee:RATES.cardFee}, opts.settings || {});
    const st = opts.store || {}, touched = new Set(s.touched || []);
    // the store's own margin and average sale win, unless the owner typed their own
    if (st.margin && !touched.has('margin')) s.margin = Math.round(st.margin);
    if (st.avgSale && !touched.has('avgSale')) s.avgSale = Math.round(st.avgSale);
    let kind = kinds.includes(opts.start) ? opts.start : kinds[0], per = 'month';
    const vals = {};
    kinds.forEach(k => { vals[k] = {}; KINDS[k].sliders.forEach(([key,,,,,d]) => vals[k][key] = d); });
    if (st.rate){ ['raise','hire'].forEach(k => { if (vals[k]) vals[k].rate = Math.max(RATES.minWage, Math.round(st.rate*4)/4); }); }
    if (st.people && vals.raise) vals.raise.people = Math.min(15, st.people);
    const firstHire = opts.firstHire != null ? opts.firstHire : !(st.people > 0);

    el.textContent = '';
    const root = h('div',{class:'rp'+(opts.auto ? ' rp-auto' : '')});
    el.append(root);
    const tabs = h('div',{class:'rp-tabs', role:'tablist', 'aria-label':'Pick a change'});
    const panel = h('div',{class:'rp-box', role:'tabpanel', id:'rp-panel-'+Math.random().toString(36).slice(2,7)});
    const tbtn = {};
    kinds.forEach(k => { const b = h('button',{type:'button', role:'tab', id:panel.id+'-'+k, 'aria-controls':panel.id, 'aria-selected':String(k === kind), tabindex:k === kind ? '0' : '-1',
      onclick:()=>{ kind = k; sync(); draw(); },
      onkeydown:e=>{ const i = kinds.indexOf(k), n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!n) return; e.preventDefault(); kind = kinds[(i+n+kinds.length)%kinds.length]; sync(); draw(); tbtn[kind].focus(); }},
      h('span',{'aria-hidden':'true'}, KINDS[k].ic), KINDS[k].t); tbtn[k] = b; tabs.append(b); });
    function sync(){ kinds.forEach(k => { tbtn[k].setAttribute('aria-selected', String(k === kind)); tbtn[k].tabIndex = k === kind ? 0 : -1; }); panel.setAttribute('aria-labelledby', tbtn[kind].id); }
    root.append(tabs, panel, settingsBox());

    // sliders on the left, the ripple on the right
    let out;
    function draw(){
      const K = KINDS[kind], v = vals[kind];
      panel.textContent = '';
      panel.append(h('h3',null, K.t), h('p',{class:'rp-intro'}, K.intro));
      const left = h('div',{class:'rp-sliders'});
      K.sliders.forEach(([key, label, min, max, stp, , unit, hint]) => {
        const id = panel.id+'-'+kind+'-'+key, nid = id+'-n';
        const range = h('input',{type:'range', id, min, max, step:stp, value:v[key], 'aria-describedby':hint ? id+'-h' : null});
        const box = h('input',{type:'number', id:nid, min, max:max*10, step:stp, value:v[key], inputmode:'decimal', 'aria-label':label+(unit && unit !== '$' ? ' ('+unit+')' : unit === '$' ? ' (dollars)' : '')});
        const set = (x, from) => { x = +x; if (!isFinite(x)) return; v[key] = x; if (from !== range) range.value = String(Math.min(max, Math.max(min, x))); if (from !== box) box.value = String(x); recalc(); };
        range.addEventListener('input', () => set(range.value, range));
        box.addEventListener('input', () => { if (box.value !== '') set(Math.max(min, +box.value), box); });
        left.append(h('div',{class:'rp-sl'}, h('div',{class:'rp-top'}, h('label',{for:id}, label), h('span',{class:'val'}, unit === '$' ? h('span',{'aria-hidden':'true'},'$') : null, box, unit && unit !== '$' ? h('span',{'aria-hidden':'true'}, unit === 'hrs' || unit === 'wks' ? ' '+unit : unit) : null)),
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
      out.textContent = '';
      out.append(h('p',{class:'rp-say', 'aria-live':'polite'}, o.say), h('ol',{class:'rp-chain'}, o.chain), ...o.visuals,
        h('details',{class:'rp-settings'}, h('summary',null,'Good to know'), h('ul',{class:'rp-learn'}, o.learn.map(x => h('li',null,x)))));
    }

    // the owner's tax picture and store numbers, shared by every explainer
    function settingsBox(){
      const tr = h('span',{class:'rp-from'});
      const showTr = () => { const t = taxRate(s); tr.textContent = 'Each $1 you write off saves about '+$$(t.all, true).replace('$','')+' in tax ('+pct(t.all,1)+'): federal '+pct(t.fed,1)+', Wisconsin '+pct(t.wi,1)+(s.se ? ', self-employment '+pct(t.se,1) : '')+'.'; };
      const changed = key => { touched.add(key); s.touched = [...touched]; showTr(); if (opts.onSettings) opts.onSettings(Object.assign({}, s)); if (out) recalc(); };
      const sel = (label, key, list) => h('label',{class:'f'}, label, h('select',{onchange:e=>{ s[key] = +e.target.value; changed(key); }}, list.map(([val, t]) => h('option',{value:val, selected:+val === +s[key]}, t))));
      const chk = (label, key) => h('label',{class:'chk'}, h('input',{type:'checkbox', checked:!!s[key], onchange:e=>{ s[key] = e.target.checked; changed(key); }}), h('span',null,label));
      const numIn = (label, key, min, max, stp, hint) => h('label',{class:'f'}, label, h('input',{type:'number', min, max, step:stp, value:s[key], style:'border:1px solid var(--rp-line);border-radius:10px;padding:.45rem .6rem;min-height:44px;background:var(--rp-bg);color:var(--rp-ink);font:inherit;max-width:10rem', oninput:e=>{ if (e.target.value !== ''){ s[key] = +e.target.value; changed(key); } }}), hint ? h('span',{class:'rp-fine'}, hint) : null);
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
          tr,
          h('p',{class:'rp-fine'},'Estimates for learning and planning, not tax advice. '+RATES.year+' federal and Wisconsin figures. Your accountant has the final numbers.')));
    }
    sync(); draw();
    return {set(k){ if (KINDS[k] && kinds.includes(k)){ kind = k; sync(); draw(); } }};
  }

  window.Ripple = {RATES, KINDS, DEFAULTS, taxRate, payYear, employerCost, mount};
})();
