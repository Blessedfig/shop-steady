// Year-end tax plan (OWNER ONLY), next to Tax year (books.js).
//   Where you stand : profit so far and at this pace by Dec 31, the tax that means (self-employment, federal with the
//                     20% QBI deduction, Wisconsin), what is already paid, and a monthly / weekly savings goal for it.
//   The big question: "If I spend $X before Dec 31 to cut my tax": each $1 written off saves only your marginal
//                     rate (about 30 cents for most small shops), so spending to dodge tax leaves you poorer unless
//                     the spending earns its money back. A slider shows exactly how much.
//   Year-end moves  : retirement (SEP-IRA / Solo 401(k)), HSA, health insurance, advertising, equipment (Section 179 /
//                     de minimis), repairs and supplies, prepaying up to 12 months, paying your children, renting your
//                     home for meetings (the "Augusta rule"), and why buying stock does not cut this year's tax.
//                     Each shows tax saved, cash out, what it really costs, the payback, the deadline, the proof
//                     needed, and how much IRS attention it draws.
//   Legal strategies: what else to ask the accountant (S-corp election, WOTC, timing, donations, vehicles).
// Settings live with the year (books_years.data.plan). Estimates only, not tax advice: confirm with the accountant
// before Dec 31. Figures are set per year in TAX below; check them every January.
(function(){
  const A = window.SSApp; if (!A || !A.books) return;
  const {h, toast} = A;
  const B = A.books, S = () => A.state();
  const usd = B.usd, card = B.card, stat = B.stat, tbl = B.tbl;
  Object.values(A.D.BUSINESS_TYPES).forEach(t => { if (t.modules && !t.modules.includes('yearend')) t.modules.push('yearend'); });

  // ---------- yearly tax figures (IRS IR-2025-103, IR-2025-111, Rev. Proc. 2025-19; Wisconsin 2026 Form 1-ES) ----------
  const TAX = {2026:{
    std:{single:16100, mfj:32200},
    fed:{single:[[12400,.10],[50400,.12],[105700,.22],[201775,.24],[256225,.32],[640600,.35],[Infinity,.37]],
         mfj:[[24800,.10],[100800,.12],[211400,.22],[403550,.24],[512450,.32],[768700,.35],[Infinity,.37]]},
    ssBase:184500, qbiLimit:{single:201750, mfj:403500},
    wi:{single:[[15110,.035],[51950,.044],[332720,.053],[Infinity,.0765]], mfj:[[20150,.035],[69260,.044],[443630,.053],[Infinity,.0765]]},
    wiStd:{single:[13930,19070,.12], mfj:[25890,27580,.19778]}, wiExempt:700,
    k401:24500, k401catch:8000, dc:72000, hsa:{self:4400, family:8750}, hsaCatch:1000}};
  const T = y => TAX[y] || TAX[Math.max(...Object.keys(TAX).map(Number).filter(k => k <= y))] || TAX[2026];
  const brackets = (inc, list) => { let tax = 0, lo = 0; for (const [top, r] of list){ if (inc <= lo) break; tax += (Math.min(inc, top) - lo) * r; lo = top; } return tax; };

  // The whole year's tax for a profit. x: {retire, hsa, health, kids, other, withheld}
  function taxFor(y, profit, f, x){
    const t = T(y), fs = f === 'mfj' ? 'mfj' : 'single';
    const p = Math.max(0, profit - (x.kids || 0)), base = p * 0.9235;
    const se = base < 400 ? 0 : Math.min(base, t.ssBase) * 0.124 + base * 0.029;
    const agi = Math.max(0, p - se / 2 - (x.retire || 0) - (x.hsa || 0) - Math.min(x.health || 0, Math.max(0, p - se / 2 - (x.retire || 0))) + (x.other || 0));
    const qbiBase = Math.max(0, p - se / 2 - (x.retire || 0) - (x.health || 0));
    const beforeQbi = Math.max(0, agi - t.std[fs]);
    const qbi = 0.2 * Math.min(qbiBase, beforeQbi);
    const fed = brackets(Math.max(0, beforeQbi - qbi), t.fed[fs]);
    const [mx, from, cut] = t.wiStd[fs], wiStd = Math.max(0, mx - Math.max(0, agi - from) * cut);
    const wi = brackets(Math.max(0, agi - wiStd - t.wiExempt * (fs === 'mfj' ? 2 : 1)), t.wi[fs]);
    return {se, fed, wi, qbi, agi, total:se + fed + wi, overQbi:beforeQbi > t.qbiLimit[fs]}; }

  // Same profit, taxed as an S-corp paying the owner a salary (payroll tax on the salary only, plus yearly cost).
  function taxScorp(y, profit, f, salary, cost, other){
    const t = T(y), fs = f === 'mfj' ? 'mfj' : 'single';
    salary = Math.max(0, Math.min(salary, profit)); const fica = Math.min(salary, t.ssBase) * 0.124 + salary * 0.029, er = fica / 2;
    const dist = Math.max(0, profit - salary - er - cost), agi = salary + dist + (other || 0);
    const beforeQbi = Math.max(0, agi - t.std[fs]), qbi = 0.2 * Math.min(dist, beforeQbi);
    const fed = brackets(Math.max(0, beforeQbi - qbi), t.fed[fs]);
    const [mx, from, cut] = t.wiStd[fs], wiStd = Math.max(0, mx - Math.max(0, agi - from) * cut);
    const wi = brackets(Math.max(0, agi - wiStd - t.wiExempt * (fs === 'mfj' ? 2 : 1)), t.wi[fs]);
    return {fica, fed, wi, total:fica + fed + wi + cost}; }

  const nowIso = () => A.isoDay(new Date());
  const pct = r => Math.round(r * 100) + '%';
  const cents = r => Math.round(r * 100) + '¢';

  // ---------- the moves ----------
  // kind: spend (cash leaves, counts now), keep (money moves to your own account), stock (no deduction this year), family
  const MOVES = [
    {k:'retire', kind:'keep', t:'Retirement: SEP-IRA or Solo 401(k)', max:c => c.retireMax,
      why:'The biggest legal move. The money is still yours, in your own retirement account, and it cuts federal and Wisconsin income tax (not the self-employment tax).',
      ret:'You keep every dollar plus its growth. Taxed later when you take it out, often at a lower rate.',
      when:'Solo 401(k): open it by Dec 31 to be safe (your part must be chosen by then). SEP-IRA: open and fund up to your filing date, even April.',
      proof:'Plan papers from the bank or brokerage and the deposit record.', risk:'low'},
    {k:'hsa', kind:'keep', t:'Health savings account (HSA)', max:c => c.hsaMax,
      why:'Only if you have a high-deductible health plan. It cuts income tax now, and the money is tax-free later for medical bills.',
      ret:'Yours to keep and invest. Tax-free going in, growing and coming out for medical costs.',
      when:'Fund it by the April filing date.', proof:'Your plan must qualify as an HDHP. Keep the HSA statement.', risk:'low'},
    {k:'health', kind:'keep', t:'Health insurance you pay yourself', max:() => 30000,
      why:'Premiums for you and your family count, as long as you could not join a spouse\'s or another employer\'s plan that month. They cut income tax, not self-employment tax.',
      ret:'Coverage you likely need anyway. Type what you already pay.',
      when:'Premiums paid in the year.', proof:'Premium statements. The policy can be in your name or the business\'s.', risk:'low'},
    {k:'ads', kind:'spend', t:'Advertising and promotion', max:() => 30000, payback:true,
      why:'Counts in full this year (line 8): ads, printing, sponsorships, event booths, signs, a website.',
      ret:'Only worth it if it brings sales. Type the extra profit you expect it to bring.',
      when:'Paid (or charged to a card) by Dec 31.', proof:'Invoices and a copy of each ad or the event flyer.', risk:'low'},
    {k:'equip', kind:'spend', t:'Equipment and fixtures (shelves, computers, a POS iPad)', max:() => 50000, payback:true,
      why:'Section 179 or bonus depreciation lets the full price count this year. Items of $2,500 or less count right away (de minimis).',
      ret:'Lasts for years. The tax is not gone for good: you get no write-off for it in later years.',
      when:'Bought AND set up in use by Dec 31. Ordered but not delivered does not count.', proof:'Invoice, and the date it was put to use.', risk:'low'},
    {k:'repairs', kind:'spend', t:'Repairs, upkeep and supplies', max:() => 20000, payback:true,
      why:'Counts in full this year. Repairs keep things working. A big improvement (new roof, remodel) goes on the Equipment list instead.',
      ret:'Worth doing if it was needed soon anyway: you pay it either way, this just moves the write-off into this year.',
      when:'Work done and paid by Dec 31.', proof:'Invoices with what was done.', risk:'low'},
    {k:'prepay', kind:'spend', t:'Prepay up to 12 months (insurance, software, rent)', max:() => 30000,
      why:'The 12-month rule: costs that cover no more than 12 months (and not past the end of next year) can count when paid.',
      ret:'No new spending, only earlier. It lowers this year\'s tax and raises next year\'s by about the same.',
      when:'Paid by Dec 31.', proof:'Invoice showing the period covered.', risk:'low'},
    {k:'kids', kind:'family', t:'Pay your children for real work', max:() => 16100,
      why:'Your LLC is taxed like a sole proprietorship, so wages to your own child under 18 have no Social Security or Medicare tax, and up to $16,100 (2026) is covered by the child\'s own standard deduction.',
      ret:'The money stays in the family (it can fund the child\'s Roth IRA). Pay only for real work at a normal rate.',
      when:'Work done and paid in the year, through payroll, with a W-2.', proof:'Timesheets, job description, pay by check or deposit to the child\'s account. Wisconsin child-labor limits apply.', risk:'medium'},
    {k:'augusta', kind:'family', t:'Rent your home for business meetings (Augusta rule)', max:() => 14 * 600,
      why:'Your home can be rented to the business for up to 14 days a year. The business deducts the rent and you do not pay tax on it.',
      ret:'Only for real meetings (staff, planning, events) at a fair day rate for your area.',
      when:'Meetings held and rent paid in the year.', proof:'Written rental agreement, 2 or 3 local venue quotes for the rate, agendas, attendee lists, invoice and payment.', risk:'high'},
    {k:'stock', kind:'stock', t:'Stock up on inventory', max:() => 30000,
      why:'This does NOT cut this year\'s tax. Books and goods you buy count only when they sell (cost of goods sold). Unsold stock on Dec 31 is still an asset.',
      ret:'Worth it for the holidays or a vendor deal, not for taxes. Cash sits on the shelf until it sells.',
      when:'—', proof:'—', risk:'low'}];
  const RISK = {low:['Low IRS attention','calm'], medium:['Some IRS attention: keep the proof','warnc'], high:['Draws IRS attention: do it by the book','red']};

  const IDEAS = [
    ['QBI deduction (20%)', 'Already counted above. Most small shops get 20% of profit off federal income tax. Retirement contributions and half your self-employment tax reduce it a little.', 'Nothing to do; your accountant files Form 8995.', 'low'],
    ['Elect S-corporation taxes (next year)', 'Once profit stays above roughly $50,000-$60,000, paying yourself a reasonable salary and taking the rest as distributions can save several thousand a year in self-employment tax. Costs payroll and about $1,500-$3,000 more accounting. It also lowers the QBI deduction and the retirement amount you can put in.', 'Form 2553, by Mar 15 for that year. Talk to your accountant first.', 'medium'],
    ['Work Opportunity Tax Credit', 'Up to $2,400 per new hire from certain groups (veterans, people on SNAP, long-term unemployed, and others). A credit, so it cuts tax dollar for dollar.', 'File Form 8850 with the Wisconsin DWD within 28 days of the hire date.', 'low'],
    ['Home office', 'Simplified: $5 a square foot up to 300 sq ft ($1,500). Only for space used regularly and only for the business. Set it in Tax records.', 'Floor plan or photo and measurements.', 'medium'],
    ['Mileage', 'Each business mile counts at 72.5¢ (2026): bank runs, supply pickups, deliveries, events. Not home to the store.', 'A trip log in Tax records with date, place and why.', 'medium'],
    ['Timing', 'Cash-basis: an expense counts when paid or charged to a credit card. Paying in late December instead of January moves the write-off a year earlier. Shopify sales count when made, so they cannot be pushed into next year.', 'Card statement or receipt dated by Dec 31.', 'low'],
    ['Giving stock to charity', 'For your LLC the deduction is only what the stock cost you, and it moves from cost of goods sold to your personal itemized deductions. If you take the standard deduction, it may save nothing extra. Giving it as a promotion (a giveaway, a prize) keeps it a business expense.', 'Letter from the charity for $250 or more, plus your cost.', 'low'],
    ['Heavy vehicle (over 6,000 lbs)', 'A truck or large SUV used more than 50% for business can be written off mostly or fully in year one. Only if you truly need it: a vehicle you would not otherwise buy is a poor trade, and personal use must be tracked.', 'A mileage log for the whole year, and the title.', 'high'],
    ['Estimated tax payments', 'Not a write-off, but it avoids the IRS underpayment penalty. You are safe if you pay at least your last year\'s total tax (110% if your income was over $150,000) in four payments, or 90% of this year\'s.', 'IRS Direct Pay and Wisconsin My Tax Account; due Apr 15, Jun 15, Sep 15 and Jan 15.', 'low']];
  const AVOID = 'Skip anything sold as a way to make tax disappear: paying personal bills through the business, "hiring" family who do no work, rent far above market, trusts or captive insurance pitched to small shops. These are the first things an audit looks at, and the cost is the tax plus a 20% penalty and interest.';

  // ---------- the screen ----------
  async function view(v){ await B.guarded(v, 'Year-end tax plan', 'What you will owe at this pace, a savings goal for it, and which moves before Dec 31 really pay off. Built from your Tax year numbers.', (box, c) => draw(box, c)); }

  function draw(box, c){
    const y = c.y, P = Object.assign({filing:'single', other:0, withheld:0, paid:0, lastTax:'', age50:false, hsaFamily:false, mode:'pace', profitTyped:'', amt:{}, back:{}}, c.Y.plan || {});
    P.amt = P.amt || {}; P.back = P.back || {};
    const save = () => { const Y = Object.assign({}, c.Y, {plan:P}); delete Y.linked; return B.DB.saveYear(y, Y).catch(e => toast('Not saved: ' + (e.message || e))); };
    const thisYear = y === new Date().getFullYear();
    const withSales = c.months.filter(m => m.sales != null).length, monthsDone = thisYear ? new Date().getMonth() + (new Date().getDate() >= 25 ? 1 : 0) : 12;
    const pace = withSales && thisYear && withSales < 12 ? c.profit * 12 / Math.max(withSales, 1) : c.profit;
    const out = h('div',{class:'grid'}); box.append(settings(), out);

    function settings(){
      const f = h('form',{class:'card',onsubmit:e => e.preventDefault()}, h('h2',null,'About you'),
        h('div',{class:'row'},
          h('label',{class:'f'},'Filing', h('select',{name:'filing'}, h('option',{value:'single',selected:P.filing!=='mfj'},'Single'), h('option',{value:'mfj',selected:P.filing==='mfj'},'Married, filing jointly'))),
          h('label',{class:'f'},'Profit to plan with', h('select',{name:'mode'}, h('option',{value:'pace',selected:P.mode==='pace'},'At this pace to Dec 31'), h('option',{value:'sofar',selected:P.mode==='sofar'},'So far only'), h('option',{value:'typed',selected:P.mode==='typed'},'My own number'))),
          h('label',{class:'f'},'My own Dec 31 profit', h('input',{type:'number',name:'profitTyped',step:'100',value:String(P.profitTyped ?? ''),placeholder:usd(pace),style:'width:8rem'}))),
        h('div',{class:'row'},
          h('label',{class:'f'},'Other household income (wages, spouse)', h('input',{type:'number',name:'other',step:'100',min:'0',value:String(P.other||0),style:'width:8rem'})),
          h('label',{class:'f'},'Tax withheld from those wages', h('input',{type:'number',name:'withheld',step:'100',min:'0',value:String(P.withheld||0),style:'width:8rem'})),
          h('label',{class:'f'},'Estimated tax paid for '+y+' so far', h('input',{type:'number',name:'paid',step:'100',min:'0',value:String(P.paid||0),style:'width:8rem'})),
          h('label',{class:'f'},'Total tax last year (optional)', h('input',{type:'number',name:'lastTax',step:'100',min:'0',value:String(P.lastTax||''),style:'width:8rem'}))),
        h('div',{class:'row small'},
          h('label',null, h('input',{type:'checkbox',name:'age50',checked:!!P.age50}),' I am 50 or older'),
          h('label',null, h('input',{type:'checkbox',name:'hsaFamily',checked:!!P.hsaFamily}),' Family health plan (HSA family limit)')));
      f.addEventListener('change', e => { const n = e.target.name; if (!n) return;
        P[n] = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : e.target.value === '' ? '' : +e.target.value;
        if (n === 'profitTyped' && e.target.value !== '') P.mode = 'typed';
        save(); render(); });
      return f; }

    function render(){
      out.replaceChildren();
      const t = T(y), profit = P.mode === 'sofar' ? c.profit : P.mode === 'typed' && P.profitTyped !== '' ? +P.profitTyped : pace;
      const ext = {other:+P.other || 0, health:+P.amt.health || 0};
      const now = taxFor(y, profit, P.filing, ext);
      const m1 = taxFor(y, profit - 1000, P.filing, ext), marg = Math.max(0, (now.total - m1.total) / 1000);
      const margInc = Math.max(0, ((now.fed + now.wi) - (m1.fed + m1.wi)) / 1000);
      const seNet = Math.max(0, profit * 0.9235 - now.se / 2);
      c.retireMax = Math.min(t.dc, t.k401 + (P.age50 ? t.k401catch : 0) + 0.2 * seNet, seNet);
      c.hsaMax = (P.hsaFamily ? t.hsa.family : t.hsa.self) + (P.age50 ? 0 : 0);
      const paid = (+P.paid || 0) + (+P.withheld || 0), owe = Math.max(0, now.total - paid);
      // savings goal: to the Jan 15 last estimate, and to the April filing date
      const jan = new Date(y + 1, 0, 15), apr = new Date(y + 1, 3, 15), today = new Date();
      const weeksTo = d => Math.max(1, Math.ceil((d - today) / (7 * 864e5))), monthsTo = d => Math.max(1, Math.ceil((d - today) / (30.4 * 864e5)));
      const safe = P.lastTax !== '' && P.lastTax != null ? (+P.lastTax) * ((profit + (+P.other||0)) > 150000 ? 1.1 : 1) : null;
      out.append(card('Where you stand for ' + y,
        h('div',{class:'grid g3'},
          stat(usd(c.profit), 'Profit so far' + (withSales ? ' (' + withSales + ' months of sales)' : '')),
          stat(usd(profit), P.mode === 'pace' ? 'Profit by Dec 31 at this pace' : P.mode === 'typed' ? 'Your Dec 31 profit' : 'Profit used'),
          stat(usd(now.total), 'Tax on it, about', 'warnc'),
          stat(usd(paid), 'Already paid or withheld'),
          stat(usd(owe), 'Still to pay, about', owe > 0 ? 'warnc' : 'good'),
          stat(cents(marg), 'Tax saved per $1 written off')),
        tbl(['Part','About'], [
          h('tr',null, h('td',null,'Self-employment tax (Social Security and Medicare, 15.3%)'), h('td',null, usd(now.se))),
          h('tr',null, h('td',null,'Federal income tax, after the ' + usd(t.std[P.filing === 'mfj' ? 'mfj' : 'single']) + ' standard deduction and ' + usd(now.qbi) + ' QBI deduction'), h('td',null, usd(now.fed))),
          h('tr',null, h('td',null,'Wisconsin income tax'), h('td',null, usd(now.wi)))]),
        owe > 0 ? h('p',null, h('b',null,'Savings goal: '), usd(owe / monthsTo(apr)) + ' a month (' + usd(owe / weeksTo(apr)) + ' a week) into a separate tax savings account gets you to ' + usd(owe) + ' by Apr 15, ' + (y + 1) + '. ',
          today < jan ? 'To avoid an underpayment penalty, pay about ' + usd(Math.max(0, now.total * 0.9 - paid)) + ' by Jan 15 (the last estimated payment for ' + y + ').' : '') : h('p',null,'What is paid already covers the estimate.'),
        safe != null ? h('p',{class:'small'}, 'Penalty safe harbor: paying ' + usd(safe) + ' in total for ' + y + ' (last year\'s tax' + (safe > +P.lastTax ? ' × 110%' : '') + ') avoids the penalty even if you owe more in April. ' + (paid >= safe ? 'You are there.' : usd(safe - paid) + ' to go.')) : null,
        now.overQbi ? h('p',{class:'small'},'⚠ Income is above the QBI limit (' + usd(t.qbiLimit[P.filing === 'mfj' ? 'mfj' : 'single']) + '): the 20% deduction may be smaller. Ask your accountant.') : null,
        P.mode === 'pace' && thisYear ? h('p',{class:'small muted'},'"At this pace" stretches the months with sales to 12. December is often a bookstore\'s biggest month, so the real number may be higher. Type your own if you know better.') : null,
        c.monthsMissing.length ? h('p',{class:'small'},'⚠ No sales yet for ' + c.monthsMissing.map(m => m.n).join(', ') + ' (Tax year screen), so profit looks lower than it is.') : null));

      out.append(bigQuestion(profit, ext, now, marg));
      out.append(moves(profit, ext, now, marg));
      out.append(ranking(profit, ext, now));
      out.append(expenses());
      out.append(structure(profit, now));
      out.append(insurance());
      out.append(guides());
      out.append(card('Other legal ways to lower tax: ask your accountant',
        h('ul',null, IDEAS.map(([t1, why, how, r]) => h('li',null, h('b',null, t1), ' ', h('span',{class:'chip ' + RISK[r][1]}, RISK[r][0]), h('div',{class:'small'}, why), h('div',{class:'small muted'}, 'How: ' + how)))),
        h('p',{class:'small'}, h('b',null,'Stay away from: '), AVOID),
        h('p',{class:'small muted'},'Before Dec 31, bring this page to your accountant. Most of these moves have to happen by Dec 31, and a few need paperwork set up first.')));
    }


    function ranking(profit, ext, now){
      const list = MOVES.filter(m => m.kind !== 'stock').map(m => { const v = +(P.amt[m.k] || 0) || Math.min(5000, Math.round(m.max(c)) || 5000), x = Object.assign({}, ext, {health:0}); let p2 = profit;
        if (m.kind === 'spend') p2 -= v; else if (m.k === 'kids') x.kids = v; else if (m.kind === 'family') p2 -= v; else x[m.k] = v;
        const base = taxFor(y, profit, P.filing, Object.assign({}, ext, {health:0})), saved = base.total - taxFor(y, p2, P.filing, x).total;
        const gain = +(P.back[m.k] || 0), out = m.kind === 'spend' ? v : 0, net = saved + gain - out;
        return {m, v, saved, gain, out, net}; }).sort((a, b) => b.net - a.net);
      return card('What is worth doing, best first',
        h('p',{class:'small muted'},'Each at the amount you set below (or $5,000 to compare). Net = tax saved + the extra profit you typed it brings in a year − the cash that is gone. Money moved into your own retirement or health savings is not gone.'),
        tbl(['','Move','Amount','Tax saved','Net for you'], list.map((r, i) => h('tr',null, h('td',null, String(i + 1)), h('td',null, r.m.t), h('td',null, usd(r.v)), h('td',null, usd(r.saved)),
          h('td',null, h('b',{class:r.net >= 0 ? '' : 'warn'}, (r.net >= 0 ? '+' : '') + usd(r.net)), r.m.kind === 'spend' && !r.gain ? h('div',{class:'small muted'},'Only worth it if it brings sales') : null)))),
        h('p',{class:'small'},'Stocking up on inventory is left out: it does not lower this year\'s tax.')); }

    function expenses(){
      const L = c.lines, names = {'8':'Advertising','9':'Car and truck (mileage)','10':'Card and Shopify fees','11':'Contract labor','13':'Equipment and depreciation','15':'Insurance','16b':'Loan interest and Capital fee','17':'Accountant and legal','18':'Office expense','20b':'Rent','21':'Repairs','22':'Supplies','23':'Taxes and licenses','25':'Utilities','26':'Wages','27a':'Software, dues, bank fees and other','30':'Home office'};
      const LINES = Object.keys(L).sort((a,b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
      const missing = Object.keys(names).filter(k => !L[k] && !['11','16b','20b','26','13'].includes(k));
      return card('All your ' + y + ' expenses so far',
        tbl(['What','Amount'], [h('tr',null, h('td',null,'Cost of goods sold (stock that sold)'), h('td',null, usd(c.cogs)))].concat(
          LINES.map(k => h('tr',null, h('td',null, (names[k] || 'Line ' + k)), h('td',null, usd(L[k]))))).concat(
          [h('tr',null, h('td',null, h('b',null,'Total write-offs')), h('td',null, h('b',null, usd(c.cogs + c.deductions))))])),
        missing.length ? h('div',null, h('p',null, h('b',null,'Nothing logged yet for: '), missing.map(k => names[k]).join(', ') + '.'),
          h('p',{class:'small'},'Most stores pay some of these. Shopify and card processing fees come out of payouts, so they are easy to miss: find them in Shopify > Finance > Payouts, or the yearly Shopify fee report. Add them in Expenses, and trips and the home office in Tax records.')) : h('p',{class:'small'},'Every usual category has something logged.'),
        h('p',{class:'small'}, h('a',{href:'#/purchases'},'See each purchase and how it counts'))); }

    function insurance(){
      const I = [['General liability','A customer slips, or a product hurts someone.','Usually yes, from day one. Landlords often require it.'],
        ['Business property (building or contents)','Fire, theft, water: your stock, fixtures and computers. Owning the building means insuring it too.','Yes. Check the stock limit covers your holiday peak.'],
        ['Business owner\'s policy (BOP)','Liability and property bundled, often with business interruption (lost income while closed).','The usual choice for a small shop. Often cheaper than buying them separately.'],
        ['Workers\' compensation','Staff injured at work.','Required in Wisconsin once you have 3 or more employees, or pay $500 or more in wages in a calendar quarter. Owners of an LLC can choose to leave themselves off.'],
        ['Commercial auto','A vehicle used for the business (deliveries, book fairs).','If you drive for the store often. Personal auto policies may refuse business claims.'],
        ['Cyber liability','A data breach or ransom hits your POS, email or customer list.','Worth a quote if you keep customer emails or take online orders.'],
        ['Health insurance','You and your family.','Premiums count on your return (Year-end moves above).'],
        ['Umbrella','Extra liability over the other policies.','Cheap once you own a building or have events.']];
      return card('Insurance: what a shop like yours should have',
        tbl(['Policy','Covers','Do you need it?'], I.map(([a,b,cc]) => h('tr',null, h('td',null, h('b',null,a)), h('td',null,b), h('td',null,cc)))),
        h('p',{class:'small'},'Business insurance premiums count in full (line 15) in the year you pay them; a 12-month policy can be prepaid in December. Life insurance and disability insurance on yourself do not count. Ask your agent for a BOP quote each year; they shop several companies.')); }

    function structure(profit, now){
      const box3 = h('div'), cost = +(P.scorpCost ?? 2500), sal0 = P.salary ?? Math.round(Math.max(0, profit) * 0.45 / 1000) * 1000;
      const r = h('input',{type:'range',min:'0',max:String(Math.max(10000, Math.round(profit))),step:'1000',value:String(sal0),'aria-label':'S-corp salary'});
      const n = h('input',{type:'number',min:'0',step:'1000',value:String(sal0),style:'width:7rem','aria-label':'S-corp salary'});
      const kc = h('input',{type:'number',min:'0',step:'100',value:String(cost),style:'width:6rem','aria-label':'Extra yearly cost of an S-corp'});
      const show = () => { const sal = +r.value || 0, k = +kc.value || 0, sc = taxScorp(y, profit, P.filing, sal, k, +P.other || 0), diff = now.total - sc.total;
        let be = null; for (let p = 20000; p <= 400000; p += 2500){ const lp = taxFor(y, p, P.filing, {other:+P.other||0}).total, sp = taxScorp(y, p, P.filing, p * (sal / Math.max(profit, 1)), k, +P.other || 0).total; if (sp < lp){ be = p; break; } }
        box3.replaceChildren(
          tbl(['','Your LLC as it is','LLC taxed as an S-corp'], [
            h('tr',null, h('td',null,'Social Security and Medicare'), h('td',null, usd(now.se)), h('td',null, usd(sc.fica) + ' (on the salary only)')),
            h('tr',null, h('td',null,'Federal and Wisconsin income tax'), h('td',null, usd(now.fed + now.wi)), h('td',null, usd(sc.fed + sc.wi))),
            h('tr',null, h('td',null,'Extra yearly cost (payroll, tax return)'), h('td',null,'$0'), h('td',null, usd(k))),
            h('tr',null, h('td',null, h('b',null,'Total')), h('td',null, h('b',null, usd(now.total))), h('td',null, h('b',null, usd(sc.total))))]),
          h('p',null, diff > 0 ? 'At ' + usd(profit) + ' profit and a ' + usd(sal) + ' salary, an S-corp would save about ' + usd(diff) + ' a year.' : 'At ' + usd(profit) + ' profit, an S-corp would cost about ' + usd(-diff) + ' more than it saves. Stay as you are for now.',
            be ? ' It starts paying off at about ' + usd(be) + ' profit with a salary at this share.' : ''),
          h('p',{class:'small muted'},'The salary has to be "reasonable" for the work you do (what you would pay a store manager). Too low is the main thing the IRS checks. A lower salary also lowers what you can put in a Solo 401(k) and your future Social Security.')); };
      [r, n, kc].forEach(el => el.addEventListener('input', () => { if (el === r) n.value = r.value; if (el === n) r.value = n.value; show(); }));
      [r, n, kc].forEach(el => el.addEventListener('change', () => { P.salary = +r.value; P.scorpCost = +kc.value; save(); }));
      show();
      const S2 = [['Single-member LLC (now)','Profit taxed on your own return (Schedule C). Simple, cheap, liability protection. Self-employment tax on all profit.'],
        ['LLC taxed as an S-corp','Same LLC, different tax filing. You become an employee with a salary; profit above it skips the 15.3%. Needs payroll, a separate return (Form 1120-S), and a reasonable salary.'],
        ['Partnership (LLC with 2+ members)','When you add a partner or investor. Files Form 1065; each member pays tax on their share.'],
        ['C-corporation','21% corporate tax, then tax again on dividends. Rarely good for a shop that pays its profit to the owner.']];
      return card('Business structure: is an S-corp worth it?',
        h('div',{class:'row'}, h('label',{class:'f',style:'flex:1'},'Salary you would pay yourself', r), n, h('label',{class:'f'},'Extra yearly cost', kc)), box3,
        tbl(['Structure','How it works'], S2.map(([a,b]) => h('tr',null, h('td',null, h('b',null,a)), h('td',null,b))))); }

    function guides(){
      const G = [
        ['Elect S-corp taxes for your LLC', ['Run the numbers above with your accountant and agree on a reasonable salary.', 'File IRS Form 2553 by March 15 for the year you want it to start (it can be filed up to 2 months and 15 days into the year). Wisconsin follows the federal election.', 'Set up payroll for yourself: Wisconsin withholding (Form BTR-101 registration), unemployment account, W-4 and WT-4 for yourself.', 'Pay yourself through payroll every month; take the rest as distributions.', 'File Form 1120-S and Wisconsin Form 5S each March 15; you get a K-1 for your own return.', 'Keep business and personal money fully separate.']],
        ['Hire your first employee', ['Get the Wisconsin withholding number and unemployment account (My Tax Account and DWD UI registration).', 'New employee fills out Form I-9 (check their ID within 3 days), W-4 and Wisconsin WT-4.', 'Report the new hire to Wisconsin within 20 days (DWD new hire reporting).', 'Get workers\' compensation insurance before they start if you will pay $500+ in a quarter.', 'Pay through a payroll service or the app\'s payroll; file Forms 941 quarterly, WT-6 deposits, and W-2s by Jan 31.', 'Post the required federal and Wisconsin labor posters.']],
        ['Add a partner or investor', ['Write down what each person puts in and gets (an amended operating agreement). Have a lawyer review it.', 'The LLC becomes a partnership for tax: it files Form 1065 (and Wisconsin Form 3) every March 15 and gives each member a K-1.', 'Update the LLC with Wisconsin DFI if your managers or registered agent change.', 'Tell your bank and update who can sign.', 'Decide how profits, losses and decisions are split, and what happens if someone leaves.']],
        ['Close out the year (every December)', ['Log every expense, trip and stock giveaway (Expenses and Tax records).', 'Make the year-end moves you chose above by Dec 31.', 'Count stock on Dec 31, or let the app record the Shopify value.', 'Pay the Jan 15 estimated tax.', 'Send 1099-NEC forms by Jan 31 to people you paid $2,000 or more (2026 federal; Wisconsin still $600).', 'Download the files on the Tax year screen for your accountant.']]];
      return card('Step-by-step guides', G.map(([t1, steps]) => h('details',null, h('summary',null, h('b',null, t1)), h('ol',{class:'small'}, steps.map(x => h('li',null, x)))))); }

    function bigQuestion(profit, ext, now, marg){
      const box2 = h('div'), max = Math.max(50000, Math.ceil(profit / 10000) * 10000);
      const r = h('input',{type:'range',min:'0',max:String(max),step:'500',value:String(P.big ?? 30000),'aria-label':'Amount to spend'});
      const n = h('input',{type:'number',min:'0',step:'500',value:String(P.big ?? 30000),style:'width:7rem','aria-label':'Amount to spend'});
      const show = () => { const amt = Math.max(0, +r.value || 0), after = taxFor(y, profit - amt, P.filing, ext), saved = now.total - after.total;
        box2.replaceChildren(
          h('div',{class:'grid g3'}, stat(usd(amt), 'Cash spent'), stat(usd(saved), 'Tax it saves', 'good'), stat(usd(amt - saved), 'You end up poorer by', 'warnc')),
          h('p',null,'Spending ' + usd(amt) + ' on write-offs cuts your tax by about ' + usd(saved) + ' (' + pct(amt ? saved / amt : marg) + ' of it). The other ' + usd(amt - saved) + ' is gone unless what you bought earns it back. ',
            'To come out even it has to bring about ' + usd(amt - saved) + ' more profit, which at your margin is roughly ' + usd((amt - saved) / Math.min(0.9, Math.max(0.2, c.salesTotal && c.cogs > 0 ? 1 - c.cogs / c.salesTotal : 0.42))) + ' more in sales.'),
          h('p',{class:'small'},'Buy what the store needs anyway, earlier. Put money into retirement rather than spending it. Don\'t buy things just for the write-off.')); };
      r.addEventListener('input', () => { n.value = r.value; show(); }); n.addEventListener('input', () => { r.value = n.value; show(); });
      r.addEventListener('change', () => { P.big = +r.value; save(); }); n.addEventListener('change', () => { P.big = +n.value; save(); });
      show();
      return card('"Should I spend money so I don\'t owe?"', h('div',{class:'row'}, h('label',{class:'f',style:'flex:1'},'If I spend this before Dec 31', r), n), box2); }

    function moves(profit, ext, now, marg){
      const sum = h('div'), body = h('div');
      const rows = MOVES.map(m => {
        const max = Math.max(0, Math.round(m.max(c))), val = Math.min(+(P.amt[m.k] || 0), Math.max(max, +(P.amt[m.k] || 0)));
        const r = h('input',{type:'range',min:'0',max:String(Math.max(max, 100)),step:'100',value:String(val),'aria-label':m.t});
        const n = h('input',{type:'number',min:'0',step:'100',value:String(val),style:'width:6.5rem','aria-label':m.t + ' amount'});
        const back = m.payback ? h('input',{type:'number',min:'0',step:'100',value:String(P.back[m.k] || ''),placeholder:'0',style:'width:6.5rem','aria-label':m.t + ' extra yearly profit it brings'}) : null;
        const cell = h('div',{style:'margin-top:.3rem'}), tr = h('div',{style:'border-top:1px solid var(--line,#ddd);padding:.7rem 0'},
          h('div',null, h('b',null, m.t), ' ', h('span',{class:'chip ' + RISK[m.risk][1]}, RISK[m.risk][0]),
            h('details',{class:'small'}, h('summary',null,'Why, deadline and proof'), h('p',null, m.why), h('p',null, h('b',null,'Payback: '), m.ret), h('p',null, h('b',null,'Deadline: '), m.when), h('p',null, h('b',null,'Proof to keep: '), m.proof))),
          h('div',null, h('div',{class:'row'}, r, n), max ? h('div',{class:'small muted'}, m.k === 'retire' ? 'Most you can put in: about ' + usd(max) : m.k === 'hsa' ? 'Limit: ' + usd(max) : '') : null,
            back ? h('label',{class:'small f'},'Extra profit it brings a year', back) : null),
          cell);
        const one = () => { const v = +r.value || 0, x = Object.assign({}, ext); let p2 = profit;
          if (m.kind === 'spend') p2 -= v; else if (m.kind === 'family') { if (m.k === 'kids') x.kids = v; else p2 -= v; }
          else if (m.kind === 'keep') x[m.k] = (m.k === 'health' ? 0 : (x[m.k] || 0)) + v;
          const base = m.k === 'health' ? taxFor(y, profit, P.filing, Object.assign({}, ext, {health:0})) : now;
          const saved = m.kind === 'stock' ? 0 : base.total - taxFor(y, p2, P.filing, x).total, gain = back ? +back.value || 0 : 0;
          cell.replaceChildren(
            h('div',null, 'Saves ', h('b',null, usd(saved))),
            m.kind === 'keep' ? h('div',{class:'small'}, m.k === 'health' ? 'Coverage you pay for anyway' : usd(v) + ' stays yours') :
            m.kind === 'family' ? h('div',{class:'small'}, usd(v) + ' goes to ' + (m.k === 'kids' ? 'your child' : 'you')) :
            m.kind === 'stock' ? h('div',{class:'small'},'Counts only as it sells') :
            h('div',{class:'small'}, 'Really costs ' + usd(v - saved) + (gain ? ', pays back in about ' + (Math.round(10 * (v - saved) / gain) / 10) + ' years' : '')));
          return {v, saved}; };
        const upd = () => { one(); total(); };
        r.addEventListener('input', () => { n.value = r.value; upd(); }); n.addEventListener('input', () => { r.value = n.value; upd(); });
        const keep = () => { P.amt[m.k] = +r.value || 0; if (back) P.back[m.k] = +back.value || 0; save(); };
        r.addEventListener('change', keep); n.addEventListener('change', keep);
        if (back){ back.addEventListener('input', upd); back.addEventListener('change', keep); }
        body.append(tr); return {m, r}; });
      function total(){
        const x = Object.assign({}, ext); let p2 = profit, spent = 0, kept = 0;
        rows.forEach(({m, r}) => { const v = +r.value || 0;
          if (m.kind === 'spend'){ p2 -= v; spent += v; }
          else if (m.kind === 'family'){ if (m.k === 'kids') x.kids = v; else p2 -= v; }
          else if (m.kind === 'keep'){ x[m.k] = v; if (m.k !== 'health') kept += v; }
          else if (m.kind === 'stock') spent += v; });
        const base = taxFor(y, profit, P.filing, Object.assign({}, ext, {health:0})), after = taxFor(y, p2, P.filing, x), saved = base.total - after.total;
        const paid = (+P.paid || 0) + (+P.withheld || 0);
        sum.replaceChildren(h('div',{class:'grid g3'},
          stat(usd(saved), 'Tax saved by all of these', 'good'), stat(usd(after.total), 'Tax after them, about'), stat(usd(Math.max(0, after.total - paid)), 'Still to pay after them')),
          h('p',{class:'small'}, (kept ? usd(kept) + ' moved into your own retirement or health savings. ' : '') + (spent ? usd(spent) + ' spent. ' : '') + 'Each $1 that is deductible now saves about ' + cents(marg) + '; retirement and health savings skip the self-employment part, so they save about ' + cents(Math.max(0, (now.fed + now.wi - taxFor(y, profit - 1000, P.filing, ext).fed - taxFor(y, profit - 1000, P.filing, ext).wi) / 1000)) + ' per $1.')); }
      rows.forEach(({r}) => r.dispatchEvent(new Event('input')));
      total();
      return card('Year-end moves: what each really does', h('p',{class:'small muted'},'Slide each one. Retirement and health savings keep the money yours; spending only pays if it earns back what the tax does not cover.'),
        sum, body); }

    render();
  }

  A.register({id:'yearend', name:'Year-end tax plan', what:'Owner only. What you will owe at this pace, a savings goal for the IRS, and which moves before Dec 31 (retirement, equipment, advertising and more) really pay off.', tiers:['owner'],
    views:{yearend:{t:'Year-end plan', ic:'🎯', render:v => { view(v); }, min:'owner', hidden:true}}});
  A.yearend = {taxFor, TAX};
})();
