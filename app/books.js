// Tax year and write-offs (OWNER ONLY): the store's books for one tax year, tied to Shopify sales.
//   Tax year   : sales from Shopify month by month (typed or imported for months before the sync started),
//                cost of goods sold the way the tax return figures it (inventory at the start of the year
//                + inventory bought - inventory at the end), every other expense on its Schedule C line,
//                equipment depreciation, mileage and home office, estimated profit and what to set aside for tax.
//                Building and property costs, monthly burn rate, and this year's limits (Section 179, the
//                $2,500 de minimis rule, home office, meals, 1099s).
//   Purchases  : every purchase of the year with how it counts (now, half, through cost of goods, over years,
//                or not at all), what counts this year and roughly how much tax that saves. The owner can change any.
//   Equipment  : shelving, computers, vehicles, building work: Section 179, bonus or regular depreciation,
//                with the Wisconsin figure next to the federal one (Wisconsin does not allow bonus depreciation).
// Data lives in owner-only tables (supabase/books.sql); in the demo it stays on this device.
// These are estimates to take to the accountant, not tax advice. Rates and limits are set per year below.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, download, toCsv, isoDay, uid} = A;
  const S = () => A.state();
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');
  const local = () => A.demo || !A.sb;

  // ---------- categories: more for the building, utilities and upkeep (added to the shared Expenses list) ----------
  const MORE = ['Property taxes','Mortgage interest','Building repairs and upkeep','Cleaning and janitorial','Equipment or furniture','Building improvements',
    'Contract labor','Bank fees','Dues and memberships','Donations (charity)','Loan payment (principal)','Owner draw or personal'];
  MORE.forEach(c => { if (!A.D.EXP_CATS.includes(c)) A.D.EXP_CATS.splice(A.D.EXP_CATS.indexOf('Other') < 0 ? A.D.EXP_CATS.length : A.D.EXP_CATS.indexOf('Other'), 0, c); });
  Object.values(A.D.BUSINESS_TYPES).forEach(t => { if (t.modules && !t.modules.includes('books')) t.modules.push('books'); });

  // how: full (counts this year), half (meals), cogs (through cost of goods sold), asset (depreciated: Equipment list),
  //      none (not deductible), check (counts in full but often needs splitting). line: Schedule C line. qb: usual QuickBooks account.
  const RULES = {
    'Inventory purchases':{how:'cogs', line:'Part III 36', qb:'Inventory Asset', why:'Stock you resell counts when it sells, through cost of goods sold, not the day you buy it.'},
    'Supplies':{how:'full', line:'22', qb:'Supplies & Materials', why:'Used up running the store. Counts the year you buy it.'},
    'Shipping and postage':{how:'full', line:'27a', qb:'Shipping & Postage', why:'Mailing to customers counts now. Freight on stock you bought can go into cost of goods instead.'},
    'Rent or mortgage':{how:'check', line:'20b', qb:'Rent & Lease', why:'Rent counts in full. A mortgage payment does not: only the interest counts, and the building is depreciated. If this is a mortgage, change it to the interest part.'},
    'Utilities':{how:'full', line:'25', qb:'Utilities', why:'Heat, electric, water, trash for the store. If part of the building is your home, only the business part counts.'},
    'Phone and internet':{how:'full', line:'25', qb:'Utilities:Phone & Internet', why:'The store line counts in full. A personal phone counts only for its business-use share.'},
    'Payroll':{how:'full', line:'26', qb:'Payroll Expenses:Wages', why:'Wages for employees. What you take out as owner is a draw, not a wage.'},
    'Payroll taxes':{how:'full', line:'23', qb:'Payroll Expenses:Taxes', why:'Your employer share of Social Security, Medicare and unemployment taxes.'},
    'Insurance':{how:'full', line:'15', qb:'Insurance', why:'Business, liability and building insurance. Health insurance goes on your personal return instead.'},
    'Licenses and permits':{how:'full', line:'23', qb:'Taxes & Licenses', why:'Seller\'s permit, local licenses and fees.'},
    'Card processing fees':{how:'full', line:'10', qb:'Merchant Fees', why:'Shopify Payments and card fees.'},
    'Software and subscriptions':{how:'full', line:'18', qb:'Software & Subscriptions', why:'Shopify plan, apps, this app and other software you rent.'},
    'Marketing and events':{how:'full', line:'8', qb:'Advertising & Marketing', why:'Ads, signs, flyers, events that promote the store.'},
    'Meals (business)':{how:'half', line:'24b', qb:'Meals', why:'Business meals usually count at 50%. Note who and the business reason.'},
    'Travel':{how:'full', line:'24a', qb:'Travel', why:'Overnight business trips: lodging, airfare, book fairs and trade shows.'},
    'Vehicle (actual costs)':{how:'check', line:'9', qb:'Car & Truck', why:'Only if you use actual costs for this vehicle. If you use the mileage rate, gas and repairs do not count (parking and tolls still do).'},
    'Professional fees':{how:'full', line:'17', qb:'Legal & Professional Fees', why:'Accountant, lawyer, bookkeeper.'},
    'Education and training':{how:'full', line:'27a', qb:'Training', why:'Courses and training for running this business.'},
    'Repairs':{how:'full', line:'21', qb:'Repairs & Maintenance', why:'Keeping equipment working. A big job that makes something better or last much longer may have to be depreciated instead.'},
    'Property taxes':{how:'full', line:'23', qb:'Taxes & Licenses:Property Tax', why:'Real estate and personal property taxes on business property.'},
    'Mortgage interest':{how:'full', line:'16a', qb:'Interest Paid:Mortgage', why:'Interest on the building\'s mortgage. The principal part of the payment does not count.'},
    'Building repairs and upkeep':{how:'full', line:'21', qb:'Repairs & Maintenance:Building', why:'Fixing and maintaining the building: patching, painting, plumbing, snow removal. Improvements (new roof, remodel) go under Building improvements.'},
    'Cleaning and janitorial':{how:'full', line:'27a', qb:'Janitorial', why:'Cleaning service and cleaning supplies.'},
    'Equipment or furniture':{how:'asset', line:'13', qb:'Furniture & Equipment', why:'$2,500 or less per item can count now (de minimis rule). More than that goes on the Equipment list: Section 179, bonus or depreciation.'},
    'Building improvements':{how:'asset', line:'13', qb:'Building Improvements', why:'Improvements are depreciated, often over 15 or 39 years, or taken now with Section 179 or bonus where allowed. Add it on the Equipment list.'},
    'Contract labor':{how:'full', line:'11', qb:'Contract Labor', why:'People you pay who are not employees. You may owe them a 1099-NEC (see Limits).'},
    'Bank fees':{how:'full', line:'27a', qb:'Bank Charges', why:'Business account fees.'},
    'Dues and memberships':{how:'full', line:'27a', qb:'Dues & Subscriptions', why:'Trade groups (bookseller associations), chamber of commerce.'},
    'Donations (charity)':{how:'none', line:'Personal', qb:'Charitable Contributions', why:'For a one-owner LLC, charity gifts go on your personal return (Schedule A), not the business. Kept here so the accountant sees them.'},
    'Loan payment (principal)':{how:'none', line:'—', qb:'Loan Payable', why:'Paying back a loan does not count. The interest part does (log it as interest).'},
    'Owner draw or personal':{how:'none', line:'—', qb:'Owner\'s Draw', why:'Money you take out for yourself is not a business expense.'},
    'Other':{how:'full', line:'27a', qb:'Other Business Expenses', why:'Check with your accountant what this is.'}
  };
  const rule = c => RULES[c] || RULES.Other;
  const HOW = {full:'Counts this year', half:'Half counts (meals)', cogs:'Through cost of goods sold', asset:'Equipment: over years', none:'Not deductible', check:'Counts, check it', custom:'My own amount'};
  const LINES = {'8':'Advertising','9':'Car and truck','10':'Commissions and fees','11':'Contract labor','13':'Depreciation and Section 179','15':'Insurance','16a':'Mortgage interest','16b':'Other interest (loans, Shopify Capital fee)','17':'Legal and professional',
    '18':'Office expense','20b':'Rent (other business property)','21':'Repairs and maintenance','22':'Supplies','23':'Taxes and licenses','24a':'Travel','24b':'Meals (50%)','25':'Utilities','26':'Wages','27a':'Other expenses','30':'Home office'};
  const LINE_ORDER = ['8','9','10','11','13','15','16a','16b','17','18','20b','21','22','23','24a','24b','25','26','27a','30'];
  const usd = n => '$' + Math.round(n).toLocaleString('en-US');
  const BUILDING = ['Rent or mortgage','Mortgage interest','Property taxes','Utilities','Phone and internet','Insurance','Building repairs and upkeep','Repairs','Cleaning and janitorial'];

  // ---------- yearly figures (check them every January) ----------
  const YEARLY = {
    2024:{mile:0.67, s179:1220000, s179out:3050000, nec:600},
    2025:{mile:0.70, s179:2500000, s179out:4000000, nec:600},
    2026:{mile:0.725, s179:2560000, s179out:4090000, nec:2000}};
  const yr = y => YEARLY[y] || YEARLY[Math.max(...Object.keys(YEARLY).map(Number).filter(k => k <= y))] || YEARLY[2026];
  const DEMIN = 2500, WI_NEC = 600;

  // ---------- depreciation ----------
  const T5 = [20,32,19.2,11.52,11.52,5.76], T7 = [14.29,24.49,17.49,12.49,8.93,8.92,8.93,4.46], T15 = [5,9.5,8.55,7.7,6.93,6.23,5.9,5.9,5.91,5.9,5.91,5.9,5.91,5.9,5.91,2.95];
  const CLASSES = {
    furniture:{l:'Shelving, fixtures, furniture, signs, store equipment', life:'7 years', t:T7, s179:true, bonus:true},
    computer:{l:'Computers, register and POS hardware, printers', life:'5 years', t:T5, s179:true, bonus:true},
    vehicle:{l:'Car, van or truck', life:'5 years', t:T5, s179:true, bonus:true, warn:'Used for business more than half the time to use Section 179 or bonus. Cars have yearly dollar caps; trucks and SUVs over 6,000 lb differ. Ask your accountant.'},
    improvement:{l:'Inside improvements to the store (lighting, flooring, interior walls, built-ins)', life:'15 years', t:T15, s179:true, bonus:true},
    systems:{l:'Roof, heating and cooling, fire alarm or security system on the store building', life:'39 years', sl:39, s179:true, bonus:false},
    building:{l:'The building itself or a structural change', life:'39 years', sl:39, s179:false, bonus:false},
    software:{l:'Software bought outright (not a subscription)', life:'3 years', sw:true, s179:true, bonus:true},
    land:{l:'Land (never depreciated)', life:'not depreciated', none:true}};
  const METHODS = {deminimis:'Count it now: $2,500 or less (de minimis)', s179:'Section 179: count it all the first year', bonus:'Bonus depreciation: count it all the first year', macrs:'Regular depreciation over its life'};
  const yOf = d => +String(d||'').slice(0,4), mOf = d => +String(d||'').slice(5,7) || 1;
  function bonusRate(a){ const acq = a.bought || a.in_service; if (acq > '2025-01-19') return 1; const y = yOf(a.in_service); return y <= 2022 ? 1 : ({2023:0.8, 2024:0.6, 2025:0.4, 2026:0.2})[y] || 0; }
  function regular(basis, a, y){ // the year's regular depreciation on basis (half-year convention; buildings mid-month)
    const c = CLASSES[a.class] || CLASSES.furniture, k = y - yOf(a.in_service); if (k < 0 || c.none || basis <= 0) return 0;
    if (c.t) return basis * (c.t[k] || 0) / 100;
    if (c.sl){ const first = (12 - mOf(a.in_service) + 0.5) / 12 / c.sl, before = k === 0 ? 0 : first + (k - 1) / c.sl; return Math.max(0, Math.min(k === 0 ? first : 1/c.sl, 1 - before)) * basis; }
    if (c.sw){ const first = (13 - mOf(a.in_service)) / 36, before = k === 0 ? 0 : first + (k - 1) * 12/36; return Math.max(0, Math.min(k === 0 ? first : 12/36, 1 - before)) * basis; }
    return 0; }
  // {fed, wi, note, used179, bonus}
  function depFor(a, y){
    const c = CLASSES[a.class] || CLASSES.furniture, basis = (+a.cost || 0) * (+a.business_pct || 0) / 100, first = y === yOf(a.in_service);
    const out = {fed:0, wi:0, note:'', used179:0, basis};
    if (c.none || y < yOf(a.in_service) || (a.sold_on && yOf(a.sold_on) < y)) return out;
    let m = a.method;
    if (m === 'deminimis' && +a.cost > DEMIN){ out.note = 'Over $2,500, so the de minimis rule does not fit. Shown as regular depreciation.'; m = 'macrs'; }
    if ((m === 's179' || m === 'bonus') && a.class === 'vehicle' && +a.business_pct <= 50){ out.note = 'Business use is 50% or less, so only regular depreciation is allowed.'; m = 'macrs'; }
    if (m === 's179' && !c.s179){ out.note = 'Section 179 does not apply to this kind of property. Shown as regular depreciation.'; m = 'macrs'; }
    if (m === 'bonus' && !c.bonus){ out.note = 'Bonus depreciation does not apply to this kind of property. Shown as regular depreciation.'; m = 'macrs'; }
    if (m === 'deminimis' || m === 's179'){ out.fed = out.wi = first ? basis : 0; if (m === 's179' && first) out.used179 = basis; return out; }
    if (m === 'bonus'){ const r = bonusRate(a), b = basis * r, rest = basis - b;
      out.fed = (first ? b : 0) + regular(rest, a, y); out.wi = regular(basis, a, y);
      if (first) out.note = (r < 1 ? Math.round(r*100)+'% bonus (bought before Jan 20, 2025). ' : '') + 'Wisconsin does not allow bonus depreciation, so its figure is regular depreciation.';
      return out; }
    out.fed = out.wi = regular(basis, a, y); return out; }

  // ---------- loans and advances ----------
  const LOAN_KINDS = {capital:'Shopify Capital or another advance with one fixed fee', loan:'Bank or SBA loan (interest rate)', line:'Line of credit', card:'Business credit card balance', owner:'Your own money put into the business'};
  // Splits every payment into fee or interest (deductible when paid) and principal (not deductible).
  function loanMath(loan, pays){
    const ps = pays.filter(p => p.loan_id === loan.id).sort((a,b) => a.paid_on.localeCompare(b.paid_on)), amt = +loan.amount || 0, fee = +loan.fee || 0;
    let bal = amt, feeLeft = fee, last = loan.started, paidSoFar = 0; const rows = [];
    ps.forEach(p => { const pay = +p.amount || 0; let int;
      if (loan.kind === 'owner') int = 0;
      else if (p.interest != null && p.interest !== '') int = Math.min(pay, +p.interest);
      else if (loan.kind === 'capital'){ paidSoFar += pay; int = paidSoFar >= amt + fee - 0.005 ? feeLeft : Math.min(feeLeft, amt + fee ? pay * fee / (amt + fee) : 0); }
      else { const days = Math.max(0, (new Date(p.paid_on) - new Date(last)) / 864e5); int = Math.min(pay, Math.max(0, bal) * (+loan.rate || 0) / 100 * days / 365); }
      int = Math.round(int * 100) / 100; if (loan.kind === 'capital') feeLeft = Math.max(0, Math.round((feeLeft - int) * 100) / 100);
      const prin = Math.round((pay - int) * 100) / 100; bal = Math.round((bal - prin) * 100) / 100; last = p.paid_on;
      rows.push({p, pay, int, prin, bal, est:p.interest == null || p.interest === ''}); });
    const owed = loan.kind === 'capital' ? Math.max(0, bal + feeLeft) : Math.max(0, bal);
    const year = y => { const r = rows.filter(x => x.p.paid_on.startsWith(String(y))); return {paid:r.reduce((a,x) => a + x.pay, 0), int:r.reduce((a,x) => a + x.int, 0), prin:r.reduce((a,x) => a + x.prin, 0), n:r.length}; };
    return {rows, owed, principalLeft:Math.max(0, bal), feeLeft, year, ded:loan.kind !== 'owner'}; }

  // ---------- storage: owner-only tables, or this device in the demo ----------
  const L = () => { const s = S(); s.booksLocal = s.booksLocal || {years:{}, assets:[], inv:[]}; return s.booksLocal; };
  const DB = {
    async year(y){ if (local()) return JSON.parse(JSON.stringify(L().years[y] || {}));
      const r = await A.sb.from('books_years').select('data').eq('year', y).maybeSingle(); if (r.error) throw r.error; return (r.data && r.data.data) || {}; },
    async saveYear(y, data){ if (local()){ L().years[y] = data; A.save(true); return; }
      const r = await A.sb.from('books_years').upsert({year:y, data, updated_at:new Date().toISOString()}); if (r.error) throw r.error; },
    async assets(){ if (local()) return L().assets.slice();
      const r = await A.sb.from('books_assets').select('*').order('in_service'); if (r.error) throw r.error; return r.data || []; },
    async saveAsset(a){ if (local()){ const l = L().assets, i = l.findIndex(x => x.id === a.id); if (i < 0) l.push(Object.assign({id:uid()}, a)); else l[i] = a; A.save(true); return; }
      const r = a.id ? await A.sb.from('books_assets').update(a).eq('id', a.id) : await A.sb.from('books_assets').insert(a); if (r.error) throw r.error; },
    async delAsset(id){ if (local()){ L().assets = L().assets.filter(x => x.id !== id); A.save(true); return; }
      const r = await A.sb.from('books_assets').delete().eq('id', id); if (r.error) throw r.error; },
    async inv(){ if (local()) return L().inv.slice().sort((a,b) => b.as_of.localeCompare(a.as_of));
      const r = await A.sb.from('books_inventory').select('*').order('as_of', {ascending:false}).limit(400); if (r.error) throw r.error; return r.data || []; },
    async snapshot(){ if (local()) throw new Error('Recording the stock value needs Shopify connected (not the demo). Type a counted value instead.');
      const r = await A.sb.rpc('books_snapshot', {p_note:null}); if (r.error) throw r.error; return r.data; },
    async addCount(as_of, value, note){ if (local()){ L().inv.push({id:uid(), as_of, kind:'count', units:0, value_cost:value, no_cost:0, note}); A.save(true); return; }
      const r = await A.sb.from('books_inventory').insert({as_of, kind:'count', value_cost:value, note}); if (r.error) throw r.error; },
    async loans(){ if (local()) return {loans:L().loans || [], pays:L().pays || []};
      const a = await A.sb.from('books_loans').select('*').order('started'), b = await A.sb.from('books_loan_payments').select('*').order('paid_on');
      if (a.error) throw a.error; if (b.error) throw b.error; return {loans:a.data || [], pays:b.data || []}; },
    async saveLoan(x){ if (local()){ const l = L().loans = L().loans || [], i = l.findIndex(o => o.id === x.id); if (i < 0) l.push(Object.assign({id:uid()}, x)); else l[i] = x; A.save(true); return; }
      const r = x.id ? await A.sb.from('books_loans').update(x).eq('id', x.id) : await A.sb.from('books_loans').insert(x); if (r.error) throw r.error; },
    async delLoan(id){ if (local()){ L().loans = (L().loans || []).filter(o => o.id !== id); L().pays = (L().pays || []).filter(p => p.loan_id !== id); A.save(true); return; }
      const r = await A.sb.from('books_loans').delete().eq('id', id); if (r.error) throw r.error; },
    async addPays(rows){ if (local()){ L().pays = (L().pays || []).concat(rows.map(r => Object.assign({id:uid()}, r))); A.save(true); return; }
      const r = await A.sb.from('books_loan_payments').insert(rows); if (r.error) throw r.error; },
    async delPay(id){ if (local()){ L().pays = (L().pays || []).filter(p => p.id !== id); A.save(true); return; }
      const r = await A.sb.from('books_loan_payments').delete().eq('id', id); if (r.error) throw r.error; },
    async sales(y){ if (local()) return [];
      const r = await A.sb.rpc('books_sales_year', {p_year:y}); if (r.error) throw r.error; return r.data || []; }
  };

  // ---------- the year's numbers ----------
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const curYear = () => +(S().booksYear || new Date().getFullYear());
  const siteSel = () => S().booksSite || 'all';
    const counted = x => x.status !== 'pending' && x.status !== 'no';
  const WO = {promo:'promo', sponsor:'promo', raffle:'promo', giveaway:'promo', charity:'charity', donated:'charity', damaged:'loss', stolen:'loss', expired:'loss', used:'loss', discount:'sales', giftcard:'giftcard'};

  // Older expenses have no id: key them by what they are, so a change to one never touches another.
  const key = x => x.id || 'k:'+[x.date, x.site, x.cat, (+x.amt||0).toFixed(2), x.note||''].join('|');
  function treat(x, Y){ // how one expense counts this year
    const r = rule(x.cat), o = (Y.over || {})[key(x)], amt = +x.amt || 0;
    if (Y.linked && Y.linked[key(x)]) return {how:'asset', line:'13', ded:0, note:'On the Equipment list: it counts there.', rule:r};
    let how = o && o.how && o.how !== 'auto' ? o.how : r.how, line = r.line, note = '';
    if (how === 'asset' && amt <= DEMIN && !(o && o.how === 'asset')){ how = 'full'; line = '22'; note = '$2,500 or less: counted now under the de minimis rule.'; }
    else if (how === 'asset'){ note = Y.linked && Y.linked[key(x)] ? 'On the Equipment list.' : 'Over $2,500: add it to the Equipment list so it counts.'; }
    if (r.how === 'full' && amt > DEMIN && ['Supplies','Repairs','Building repairs and upkeep','Other'].includes(x.cat) && !o) note = 'Over $2,500: if this improved or replaced something big, it may belong on the Equipment list.';
    const ded = how === 'full' || how === 'check' ? amt : how === 'half' ? amt/2 : how === 'custom' ? Math.min(amt, +(o.amt)||0) : 0;
    if (how === 'custom') line = o.line || line;
    return {how, line: how === 'half' ? '24b' : line, ded, note, rule:r}; }

  async function compute(y, site){
    site = site || siteSel(); const inSite = x => site === 'all' || x.site === site;
    const Y = await DB.year(y), assets = await DB.assets(), inv = await DB.inv();
    let LN = {loans:[], pays:[]}, loanErr = ''; try { LN = await DB.loans(); } catch(e){ loanErr = e.message || String(e); }
    const loans = LN.loans.map(l => Object.assign({l}, loanMath(l, LN.pays)));
    let sales = []; let salesErr = ''; try { sales = await DB.sales(y); } catch(e){ salesErr = e.message || String(e); }
    const ys = String(y), rate = Y.rate != null ? +Y.rate : 0.28;
    const exp = (S().exp || []).filter(x => x.date && x.date.startsWith(ys) && counted(x) && inSite(x));
    Y.linked = {}; assets.forEach(a => { if (a.exp_id) Y.linked[a.exp_id] = a.id; });
    const rows = exp.map(x => Object.assign({x}, treat(x, Y)));
    // sales by month: typed/imported wins over synced (synced may start mid-year)
    const byM = {}; sales.forEach(r => byM[r.month] = r); const firstM = sales.length ? sales[0].month : null;
    const months = MONTHS.map((n, i) => { const k = ys+'-'+String(i+1).padStart(2,'0'), s = byM[k], typed = (Y.salesTyped || {})[k];
      const spent = exp.filter(x => x.date.startsWith(k)), invBuy = spent.filter(x => rule(x.cat).how === 'cogs').reduce((a,x) => a + +x.amt, 0);
      const draws = spent.filter(x => x.cat === 'Owner draw or personal').reduce((a,x) => a + +x.amt, 0);
      const other = spent.reduce((a,x) => a + +x.amt, 0) - invBuy - draws;
      const loanPaid = LN.pays.filter(p => p.paid_on.startsWith(k) && (LN.loans.find(l => l.id === p.loan_id) || {}).kind !== 'owner').reduce((a,p) => a + +p.amount, 0);
      return {k, n, loanPaid, synced:s ? +s.net : null, partial:s && k === firstM && s.first_day > k+'-01' ? s.first_day : null, typed:typed != null ? +typed : null,
        sales:typed != null ? +typed : s ? +s.net : null, cost:s ? +s.cost : 0, netWithCost:s ? +s.net_with_cost : 0, noCost:s ? s.lines_no_cost : 0, invBuy, other, draws}; });
    const salesTotal = months.reduce((a,m) => a + (m.sales || 0), 0), monthsMissing = months.filter(m => m.sales == null && m.k <= isoDay(new Date()).slice(0,7));
    // inventory: Dec 31 of last year and this year (a count beats the automatic Shopify value)
    const near = d => { const at = inv.filter(r => r.as_of === d); return at.find(r => r.kind === 'count') || at.find(r => r.kind === 'owner') || at[0] || null; };
    const begSnap = near((y-1)+'-12-31'), endSnap = near(y+'-12-31'), latest = inv.find(r => r.as_of.startsWith(ys)) || null;
    const beg = Y.begInv != null ? {v:+Y.begInv, src:'you typed it'} : begSnap ? {v:+begSnap.value_cost, src:begSnap.kind === 'count' ? 'your Dec 31 count' : 'Shopify value on Dec 31'} : null;
    const end = Y.endInv != null ? {v:+Y.endInv, src:'you typed it'} : endSnap ? {v:+endSnap.value_cost, src:endSnap.kind === 'count' ? 'your Dec 31 count' : 'Shopify value on Dec 31'}
      : latest ? {v:+latest.value_cost, src:'latest value ('+A.fmtDate(latest.as_of)+'), so far', soFar:true} : null;
    const wo = (S().writeoffs || []).filter(x => x.date && x.date.startsWith(ys) && counted(x) && inSite(x));
    const woCost = g => wo.filter(x => WO[x.why] === g).reduce((a,x) => a + (x.qty||1) * (+x.cost||0), 0);
    const promo = woCost('promo'), charity = woCost('charity'), loss = woCost('loss');
    // Donated stock stays in cost of goods sold (it is simply not on the shelf at year end). For a one-owner LLC that
    // saves more than moving it to Schedule A: it also lowers self-employment tax, and Schedule A helps only if you
    // itemize. There is no second deduction for it. Accountant to confirm.
    const purchases = rows.filter(r => r.how === 'cogs').reduce((a,r) => a + +r.x.amt, 0) - promo;
    const shopCogs = months.reduce((a,m) => a + m.cost, 0), shopCovered = months.reduce((a,m) => a + m.netWithCost, 0), shopSynced = months.reduce((a,m) => a + (m.synced||0), 0);
    let cogs, cogsSrc;
    if (beg && end){ cogs = beg.v + purchases - end.v; cogsSrc = 'books'; }
    else if (shopCovered > 0){ cogs = shopCogs * (salesTotal && shopCovered ? salesTotal / shopCovered : 1); cogsSrc = 'shopify'; }
    else { cogs = purchases; cogsSrc = 'purchases'; }
    // equipment
    const dep = assets.map(a => Object.assign({a}, depFor(a, y)));
    const depFed = dep.reduce((s,d) => s + (d.a.method === 'deminimis' && d.fed && !d.note ? 0 : d.fed), 0), demin = dep.reduce((s,d) => s + (d.a.method === 'deminimis' && !d.note ? d.fed : 0), 0);
    const depWi = dep.reduce((s,d) => s + d.wi, 0), used179 = dep.reduce((s,d) => s + d.used179, 0);
    // mileage and home office (from Tax records)
    const t = S().tax || {}, trips = (S().trips || []).filter(x => x.date && x.date.startsWith(ys) && x.status === 'ok' && inSite(x)), miles = trips.reduce((a,x) => a + +x.mi, 0);
    const mile = miles * yr(y).mile, sq = +((t.office || {}).sqft || 0), office = Math.min(sq, 300) * 5;
    // Schedule C lines
    const lines = {}; const add = (l, v) => { if (v) lines[l] = (lines[l] || 0) + v; };
    rows.forEach(r => { if (r.ded && r.line !== 'Personal' && r.line !== '—') add(r.line, r.ded); });
    const loanInt = loans.filter(x => x.ded).reduce((a,x) => a + x.year(y).int, 0), loanPrin = loans.filter(x => x.ded).reduce((a,x) => a + x.year(y).prin, 0);
    const capitalIn = loans.filter(x => x.l.started.startsWith(ys)).reduce((a,x) => a + +x.l.amount, 0);
    add('16b', loanInt); add('8', promo); add('9', mile); add('13', depFed); add('22', demin); add('30', office);
    const deductions = Object.values(lines).reduce((a,v) => a + v, 0);
    const profit = salesTotal - cogs - deductions;
    const vehicleBoth = miles > 0 && rows.some(r => r.x.cat === 'Vehicle (actual costs)' && r.ded > 0);
    return {y, Y, rate, exp, rows, months, salesTotal, monthsMissing, salesErr, shopSynced, beg, end, purchases, promo, charity, loss, cogs, cogsSrc, shopCogs, shopCovered,
      loans, loanInt, loanPrin, capitalIn, loanErr, assets, dep, depFed, depWi, used179, demin, miles, mile, sq, office, lines, deductions, profit, wo, inv, vehicleBoth}; }

  // ---------- small helpers ----------
  const pct = (a, b) => b ? Math.round(1000*a/b)/10+'%' : '—';
  const card = (title, ...kids) => h('div',{class:'card'}, h('h2',null,title), ...kids);
  const stat = (v, l, cls) => h('div',{class:'stat'+(cls?' '+cls:'')}, h('b',null,v), h('span',null,l));
  const tbl = (heads, body) => h('div',{class:'tablewrap'}, h('table',{class:'t'}, h('thead',null, h('tr',null, heads.map(x => h('th',null,x)))), h('tbody',null, body)));
  const NOTADVICE = h('p',{class:'small muted'},'Estimates from what is logged in the app, to take to your accountant. Not tax advice. Your accountant decides the final numbers.');
  function controls(){
    const now = new Date().getFullYear(), years = [now+1, now, now-1, now-2].filter(y => y <= now);
    return h('div',{class:'row'},
      h('label',{class:'f'},'Tax year', h('select',{onchange:e=>{ S().booksYear = +e.target.value; A.save(true); A.route(); }}, years.map(y => h('option',{value:String(y),selected:y===curYear()},String(y))))),
      h('label',{class:'f'},'Location', h('select',{onchange:e=>{ S().booksSite = e.target.value; A.save(true); A.route(); }},
        h('option',{value:'all',selected:siteSel()==='all'},'All locations'), A.D.SITES.map(s => h('option',{value:s.id,selected:siteSel()===s.id}, A.setupOf(s.id).name)))),
      h('nav',{class:'row small'}, h('a',{href:'#/books'},'Tax year'), h('a',{href:'#/purchases'},'Each purchase'), h('a',{href:'#/equipment'},'Equipment'), h('a',{href:'#/loans'},'Loans and capital'), h('a',{href:'#/taxsum'},'Tax records')));
  }
  async function guarded(v, title, lede, body){
    v.append(head('Owner only', title, lede));
    if (!isOwner()){ v.append(card('Owner only', h('p',null,'Only the owner can see the books.'))); return; }
    v.append(controls());
    const box = h('div',{class:'grid'}, h('p',{class:'muted'},'Adding it up…')); v.append(box);
    try { const c = await compute(curYear()); box.replaceChildren(); await body(box, c); box.append(NOTADVICE); }
    catch(e){ box.replaceChildren(card('Could not load the books', h('p',null, String(e.message || e)), /books_|relation|function/.test(e.message||'') ? h('p',{class:'small'},'Run supabase/books.sql once in the Supabase SQL editor (owner).') : null)); }
  }
  async function saveY(c, f){ f(c.Y); delete c.Y.linked; await DB.saveYear(c.y, c.Y); A.route(); }

  // ---------- Tax year ----------
  function overview(box, c){
    const y = c.y, set = Math.max(0, c.profit) * c.rate;
    box.append(card(y+' at a glance',
      h('div',{class:'grid g3'}, stat(money(c.salesTotal), 'Sales (before sales tax)'), stat(money(c.cogs), 'Cost of goods sold'), stat(money(c.deductions), 'Other write-offs'),
        stat(money(c.profit), 'Estimated profit', c.profit >= 0 ? 'good' : 'warnc'), stat(money(c.deductions * c.rate), 'Tax the write-offs save (about)'), stat(money(set), 'Set aside for tax (about)')),
      h('p',{class:'small muted'},'Tax figures use '+Math.round(c.rate*100)+'% for self-employment, federal and Wisconsin tax together. Ask your accountant for your own rate and change it here:'),
      h('form',{class:'row',onsubmit:async e=>{ e.preventDefault(); const r = +new FormData(e.target).get('r'); if (!(r >= 0 && r <= 60)) return toast('Use a percent between 0 and 60'); await saveY(c, Y => Y.rate = r/100); toast('Saved'); }},
        h('label',{class:'f'},'Combined tax rate (%)', h('input',{type:'number',name:'r',min:'0',max:'60',step:'0.5',value:String(Math.round(c.rate*1000)/10)})), h('button',{class:'btn sm',type:'submit'},'Save')),
      c.monthsMissing.length ? h('p',{class:'small'},'⚠ No sales yet for '+c.monthsMissing.map(m => m.n).join(', ')+'. Type or import them under Sales by month.') : null,
      c.salesErr ? h('p',{class:'small'},'⚠ Shopify sales could not be read: '+c.salesErr) : null,
      h('p',{class:'small muted'},'Estimated tax payments for '+y+' are due Apr 15, Jun 15 and Sep 15, and Jan 15 '+(y+1)+' (federal and Wisconsin).')));
  }
  function monthly(box, c){
    const ys = String(c.y), rows = c.months.map(m => {
      const inp = h('input',{type:'number',step:'0.01',min:'0','aria-label':'Sales typed for '+m.n,value:m.typed != null ? String(m.typed) : '',placeholder:m.synced != null ? m.synced.toFixed(2) : '',style:'width:6.5rem;min-width:6.5rem',
        onchange:async e=>{ const v = e.target.value; await saveY(c, Y => { Y.salesTyped = Y.salesTyped || {}; if (v === '') delete Y.salesTyped[m.k]; else Y.salesTyped[m.k] = +v; }); }});
      const net = m.sales == null ? null : m.sales - m.invBuy - m.other - m.loanPaid;
      return h('tr',null, h('td',null, m.n), h('td',null, m.synced != null ? money(m.synced) : '—', m.partial ? h('div',{class:'small muted'},'from '+A.fmtDate(m.partial)) : null), h('td',null, inp),
        h('td',null, money(m.invBuy)), h('td',null, money(m.other)), h('td',null, money(m.loanPaid)), h('td',null, net == null ? '—' : h('b',null, money(net)))); });
    const fi = h('input',{type:'file',accept:'.csv,text/csv','aria-label':'Shopify sales report CSV'});
    fi.addEventListener('change', async () => { const f = fi.files[0]; if (!f) return;
      try { const got = shopifyMonths(await f.text(), ys); const n = Object.keys(got).length; if (!n) throw new Error('No '+ys+' months with a Net sales column found in that file.');
        await saveY(c, Y => { Y.salesTyped = Object.assign(Y.salesTyped || {}, got); }); toast(n+' months imported'); } catch(e){ toast(e.message); } });
    box.append(card('Sales by month (from your POS)',
      h('p',{class:'small muted'},'Synced: Shopify sales after discounts, before sales tax, since the sync started. Typed: your own number for a month, which wins. For months before the sync, or to match Shopify exactly with returns, use Shopify Analytics > Reports > "Sales over time" by month, export it, and import it here.'),
      tbl(['Month','Synced','Typed (wins)','Stock bought','Other costs','Loan payments','Cash left'], rows),
      h('div',{class:'row'}, h('label',{class:'f'},'Import Shopify "Sales over time" (.csv)', fi)),
      h('p',{class:'small muted'},'Sales tax you collect is not your income: Shopify keeps it out of these numbers, and you pay it to the Wisconsin Department of Revenue. Shipping you charge customers is income; add it if it is not in your Net sales.')));
  }
  function shopifyMonths(text, ys){
    const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(l => { const out = []; let cell = '', q = false;
      for (let i = 0; i < l.length; i++){ const ch = l[i]; if (q){ if (ch === '"'){ if (l[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"') q = true; else if (ch === ','){ out.push(cell); cell = ''; } else cell += ch; }
      out.push(cell); return out; });
    if (rows.length < 2) return {};
    const hd = rows[0].map(x => x.trim().toLowerCase()), iD = hd.findIndex(x => /^(month|day|date)$/.test(x) || /^(month|day|date)\b/.test(x)), iN = hd.findIndex(x => /net sales/.test(x));
    if (iD < 0 || iN < 0) return {};
    const out = {}, MN = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    rows.slice(1).forEach(r => { const d = String(r[iD]||'').trim(), n = parseFloat(String(r[iN]||'').replace(/[$,]/g,'')); if (isNaN(n)) return;
      let k = (d.match(/^(\d{4})-(\d{2})/) || [])[0];
      if (!k){ const m = d.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/); if (m && MN[m[1].toLowerCase()]) k = m[2]+'-'+String(MN[m[1].toLowerCase()]).padStart(2,'0'); }
      if (!k){ const m = d.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/); if (m) k = m[2]+'-'+m[1].padStart(2,'0'); }
      if (k && k.startsWith(ys)) out[k] = Math.round(((out[k] || 0) + n) * 100) / 100; });
    return out; }

  function cogsCard(box, c){
    const y = c.y;
    const inp = (name, val, label) => h('label',{class:'f'}, label, h('input',{type:'number',name,step:'0.01',min:'0',value:val != null ? String(val) : ''}));
    const f = h('form',{class:'row',onsubmit:async e=>{ e.preventDefault(); const d = new FormData(f), b = d.get('beg'), en = d.get('end');
      await saveY(c, Y => { Y.begInv = b === '' ? null : +b; Y.endInv = en === '' ? null : +en; }); toast('Saved'); }},
      inp('beg', c.Y.begInv, 'Inventory Jan 1 (blank = automatic)'), inp('end', c.Y.endInv, 'Inventory Dec 31 (blank = automatic)'), h('button',{class:'btn sm',type:'submit'},'Save'));
    const row = (l, v, note) => h('tr',null, h('td',null,l), h('td',null, v == null ? '—' : money(v)), h('td',{class:'small muted'}, note || ''));
    box.append(card('Cost of goods sold (inventory)',
      h('p',{class:'small muted'},'Books and other stock you resell are not written off when you buy them. They count when they sell. The tax return figures it as: inventory at the start of the year, plus what you bought, minus what is left at the end.'),
      tbl(['', y, 'Where it comes from'], [
        row('Inventory Jan 1', c.beg && c.beg.v, c.beg ? c.beg.src : 'Not recorded yet. Type last Dec 31\'s value, or it fills itself from now on.'),
        row('+ Inventory bought', c.purchases, 'Expenses marked Inventory purchases (Receiving adds these)'+(c.promo ? ', minus '+money(c.promo)+' of stock given away to promote the store (counted as advertising instead)' : '')),
        row('− Inventory Dec 31', c.end && c.end.v, c.end ? c.end.src : 'Recorded automatically on Dec 31 from Shopify'),
        h('tr',null, h('td',null, h('b',null,'= Cost of goods sold')), h('td',null, h('b',null, money(c.cogs))), h('td',{class:'small muted'},
          c.cogsSrc === 'books' ? (c.end.soFar ? 'So far: the year is not over' : 'Schedule C, Part III, line 42') : c.cogsSrc === 'shopify' ? 'Estimate from Shopify costs of what sold, until both inventory values are in' : 'Only purchases so far: add the inventory values'))]),
      c.shopCovered ? h('p',{class:'small muted'},'Check: Shopify says the items sold since the sync started cost '+money(c.shopCogs)+' (margin '+pct(c.shopCovered - c.shopCogs, c.shopCovered)+' on lines that have a cost). A big gap from the line above usually means purchases not logged, missing costs in Shopify, or stock lost.') : null,
      c.loss ? h('p',{class:'small muted'},'Damaged, stolen or expired stock this year: '+money(c.loss)+' at cost. It is already inside cost of goods sold (it is not on the shelf at the end), so it is not counted twice.') : null,
      f,
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:async()=>{ try { const r = await DB.snapshot(); toast('Recorded: '+money(+r.value_cost)+' at cost'+(r.no_cost ? ' ('+r.no_cost+' items have no cost)' : '')); A.route(); } catch(e){ toast(e.message || String(e)); } }},'Record stock value now (from Shopify)'),
        h('a',{class:'btn ghost sm',href:'#/count'},'Do a physical count')),
      h('details',null, h('summary',null,'Type a counted value'), countForm()),
      h('p',{class:'small muted'},'The app records the stock value from Shopify at the end of every month by itself. A physical count around Dec 31 is best: type its total at cost here and it is used instead.')));
  }
  function countForm(){
    const f = h('form',{class:'row'}, h('label',{class:'f'},'Date', h('input',{type:'date',name:'d',value:curYear()+'-12-31',required:true})),
      h('label',{class:'f'},'Total at cost ($)', h('input',{type:'number',name:'v',step:'0.01',min:'0',required:true})), h('button',{class:'btn sm',type:'submit'},'Save count'));
    f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f); try { await DB.addCount(String(d.get('d')), +d.get('v'), 'Physical count'); toast('Count saved'); A.route(); } catch(err){ toast(err.message); } });
    return f; }

  function linesCard(box, c){
    const order = LINE_ORDER, rows = order.filter(l => c.lines[l]).map(l => h('tr',null, h('td',null, l), h('td',null, LINES[l]), h('td',null, money(c.lines[l])), h('td',null, money(c.lines[l] * c.rate))));
    box.append(card('Write-offs by tax line (Schedule C)',
      rows.length ? tbl(['Line','What','Counts','Saves about'], rows.concat([h('tr',null, h('td',null,''), h('td',null,h('b',null,'Total')), h('td',null,h('b',null,money(c.deductions))), h('td',null,h('b',null,money(c.deductions*c.rate))))])) : h('p',{class:'muted'},'Nothing logged for '+c.y+' yet.'),
      h('ul',{class:'small muted'},
        c.loanInt ? h('li',null,'Line 16b: '+money(c.loanInt)+' of loan interest and Shopify Capital fees paid this year. The '+money(c.loanPrin)+' of principal paid back does not count. ', h('a',{href:'#/loans'},'Loans')) : null,
        c.mile ? h('li',null,'Line 9 includes '+c.miles.toFixed(1)+' business miles at '+(yr(c.y).mile*100).toFixed(1)+'¢ (IRS rate for '+c.y+').') : null,
        c.office ? h('li',null,'Line 30: home office, simplified method, '+Math.min(c.sq,300)+' sq ft × $5.') : null,
        c.promo ? h('li',null,'Line 8 includes '+money(c.promo)+' of stock given away to promote the store (at cost).') : null,
        c.charity ? h('li',null, money(c.charity)+' of stock donated to charities is counted in cost of goods sold, not as a separate charity gift. For a one-owner LLC that usually saves the most: it lowers self-employment tax too (about 14% more than a personal deduction), and a personal charity deduction only helps if you itemize. You can\'t count it both ways. Keep the charity\'s letter for gifts of $250 or more. Your accountant should confirm.') : null,
        h('li',null,'Your own pay (owner draws) and personal spending never count. If the LLC has more than one owner or is taxed as an S corporation, the lines differ; your accountant maps them.')),
      c.vehicleBoth ? h('p',{class:'small'},'⚠ You have both mileage and actual vehicle costs. For one vehicle you use one or the other, not both.') : null));
  }
  function building(box, c){
    const by = {}; c.exp.filter(x => BUILDING.includes(x.cat)).forEach(x => by[x.cat] = (by[x.cat]||0) + +x.amt);
    const bdep = c.dep.filter(d => ['building','systems','improvement'].includes(d.a.class)).reduce((a,d) => a + d.fed, 0);
    const total = Object.values(by).reduce((a,v) => a + v, 0) + bdep, monthsIn = c.y < new Date().getFullYear() ? 12 : new Date().getMonth() + 1;
    const rows = Object.entries(by).sort((a,b) => b[1]-a[1]).map(([k,v]) => h('tr',null, h('td',null,k), h('td',null,money(v)), h('td',null,money(v/monthsIn)), h('td',{class:'small muted'}, rule(k).how === 'check' ? 'Check: '+rule(k).why : '')));
    if (bdep) rows.push(h('tr',null, h('td',null,'Building and improvement depreciation'), h('td',null,money(bdep)), h('td',null,money(bdep/monthsIn)), h('td',{class:'small muted'},'From the Equipment list')));
    box.append(card('Building, property, utilities and upkeep',
      rows.length ? tbl(['', c.y+' so far','Per month',''], rows.concat([h('tr',null, h('td',null,h('b',null,'Total')), h('td',null,h('b',null,money(total))), h('td',null,h('b',null,money(total/monthsIn))), h('td',null,''))])) : h('p',{class:'muted'},'No building costs logged for '+c.y+' yet. Log rent or mortgage interest, property taxes, utilities, insurance, repairs and upkeep in Expenses.'),
      h('ul',{class:'small muted'}, h('li',null,'Repairs and upkeep count now. Improvements (new roof, remodel, new heating) go on the Equipment list.'),
        h('li',null,'If you own the building: mortgage interest and property taxes count, the payment\'s principal does not, and the building is depreciated over 39 years (not the land).'),
        h('li',null,'If part of the building is your home or a separate rental (like upstairs rooms), split utilities and upkeep by the share each part uses, or pick that location above.'))));
  }
  function burn(box, c){
    const now = isoDay(new Date()).slice(0,7), done = c.months.filter(m => m.k < now && (m.sales != null || m.invBuy || m.other || m.loanPaid)).slice(-3);
    if (!done.length){ box.append(card('Monthly burn rate', h('p',{class:'muted'},'Once a full month of '+c.y+' has sales and expenses, the burn rate shows here.'))); return; }
    const avg = f => done.reduce((a,m) => a + f(m), 0) / done.length;
    const sales = avg(m => m.sales || 0), stock = avg(m => m.invBuy), other = avg(m => m.other), draws = avg(m => m.draws), debt = avg(m => m.loanPaid);
    const margin = c.shopCovered ? (c.shopCovered - c.shopCogs) / c.shopCovered : null, fixed = other;
    const left = sales - stock - other - draws - debt;
    const cashIn = c.Y.cash != null ? +c.Y.cash : null;
    box.append(card('Monthly burn rate',
      h('p',{class:'small muted'},'Average of '+done.map(m => m.n).join(', ')+'.'),
      h('div',{class:'grid g3'}, stat(money(other), 'Running costs per month (rent, utilities, pay, everything but stock)'), stat(money(stock), 'Stock bought per month'), debt ? stat(money(debt), 'Loan and Shopify Capital payments per month') : null, stat(money(sales), 'Sales per month'),
        stat(money(left), 'Cash left per month'+(draws ? ' after '+money(draws)+' owner draws' : ''), left >= 0 ? 'good' : 'warnc'),
        margin != null ? stat(money(fixed / Math.max(margin, 0.01)), 'Sales needed to break even (at '+pct(margin,1)+' margin)') : null,
        cashIn != null && left < 0 ? stat((cashIn / -left).toFixed(1)+' months', 'Until '+money(cashIn)+' runs out at this rate', 'warnc') : null),
      h('form',{class:'row',onsubmit:async e=>{ e.preventDefault(); const v = new FormData(e.target).get('c'); await saveY(c, Y => Y.cash = v === '' ? null : +v); toast('Saved'); }},
        h('label',{class:'f'},'Cash in the business account now (optional, for runway)', h('input',{type:'number',name:'c',step:'0.01',min:'0',value:cashIn != null ? String(cashIn) : ''})), h('button',{class:'btn sm',type:'submit'},'Save'))));
  }
  function limits(box, c){
    const y = c.y, L = yr(y), ys = String(y);
    const payees = {}; (S().exp || []).filter(x => x.date && x.date.startsWith(ys) && counted(x) && ['Contract labor','Professional fees','Repairs','Building repairs and upkeep','Cleaning and janitorial'].includes(x.cat) && /card/i.test(x.pay||'') === false)
      .forEach(x => { const p = (x.payee || x.note || '').trim(); if (p) payees[p] = (payees[p] || 0) + +x.amt; });
    const fed = Object.entries(payees).filter(([,v]) => v >= L.nec), wi = Object.entries(payees).filter(([,v]) => v >= WI_NEC && v < L.nec);
    const big = c.rows.filter(r => r.note && /add it to the Equipment list/.test(r.note)).length;
    const row = (what, lim, you) => h('tr',null, h('td',null,what), h('td',null,lim), h('td',{class:'small'}, you || ''));
    box.append(card(y+' limits and rules',
      tbl(['Rule','Limit for '+y,'You'], [
        row('De minimis rule (count small equipment now)', '$2,500 per item or invoice', big ? '⚠ '+big+' purchase'+(big>1?'s':'')+' over $2,500 not on the Equipment list yet' : 'Your accountant attaches the yearly election to the return'),
        row('Section 179 (count equipment all at once)', usd(L.s179)+', shrinking after '+usd(L.s179out)+' of equipment bought; cannot be more than business profit', money(c.used179)+' used'+(c.used179 > Math.max(0, c.profit + c.used179) ? ' ⚠ more than this year\'s profit: the extra carries forward' : '')),
        row('Bonus depreciation', '100% for things bought after Jan 19, 2025. Wisconsin does not allow it', c.depFed !== c.depWi ? 'Wisconsin depreciation differs by '+money(c.depFed - c.depWi)+' this year' : ''),
        row('Business meals', '50%', ''),
        row('Gifts to customers or others', '$25 per person per year', ''),
        row('Home office (simplified)', '$5 per sq ft, up to 300 sq ft ($1,500)', c.sq ? money(c.office)+' at '+c.sq+' sq ft' : 'Not set (Tax records summary)'),
        row('Mileage rate', (L.mile*100).toFixed(1)+'¢ a mile', c.miles ? c.miles.toFixed(1)+' miles = '+money(c.mile) : ''),
        row('1099-NEC to people you paid (not by card)', 'Federal: '+usd(L.nec)+' or more · Wisconsin: $600 or more', (fed.length ? fed.length+' need a federal and Wisconsin 1099' : '')+(wi.length ? (fed.length ? '; ' : '')+wi.length+' need a Wisconsin one only' : '') || 'None found in Expenses'),
        row('W-2s for employees', 'Due Jan 31, '+(y+1), '')]),
      fed.length || wi.length ? h('ul',{class:'small'}, fed.concat(wi).map(([p,v]) => h('li',null, p+': '+money(v)))) : null,
      h('p',{class:'small muted'},'Limits change every year. These were checked in November 2026 (IRS and Wisconsin Department of Revenue). 1099 list: guessed from Expenses paid by check, cash or account; ask each one for a W-9.')));
  }
  function exportsCard(box, c){
    const y = c.y, name = siteSel() === 'all' ? 'all' : siteSel();
    const summary = () => download('tax-year-'+y+'-'+name+'.csv','text/csv', toCsv([['Tax year '+y,'','Estimates from Downtown Stube for the accountant. Not tax advice.'], [],
      ['Section','Line','Amount','Note'],
      ['Income','1',c.salesTotal.toFixed(2),'Shopify sales after discounts, before sales tax'+(c.monthsMissing.length ? '; missing: '+c.monthsMissing.map(m => m.n).join(' ') : '')],
      ['Cost of goods sold','35',c.beg ? c.beg.v.toFixed(2) : '','Inventory at start: '+(c.beg ? c.beg.src : 'missing')],
      ['Cost of goods sold','36',c.purchases.toFixed(2),'Purchases less stock given away'],
      ['Cost of goods sold','41',c.end ? c.end.v.toFixed(2) : '','Inventory at end: '+(c.end ? c.end.src : 'missing')],
      ['Cost of goods sold','42',c.cogs.toFixed(2), ({books:'Start + purchases - end', shopify:'Estimate from Shopify item costs', purchases:'Purchases only (inventory values missing)'})[c.cogsSrc]],
      ...LINE_ORDER.filter(l => c.lines[l]).map(l => ['Expenses', l, c.lines[l].toFixed(2), LINES[l]]),
      ['Loans','16b',c.loanInt.toFixed(2),'Interest and advance fees paid (principal paid back: '+c.loanPrin.toFixed(2)+', not deductible)'],
      ['Loans','',c.capitalIn.toFixed(2),'New loans, advances and owner money in this year (not income)'],
      ['Expenses','28',c.deductions.toFixed(2),'Total expenses'],
      ['Profit','31',c.profit.toFixed(2),'Estimate'],
      ['Cost of goods sold','in 42',c.charity.toFixed(2), 'Stock donated to charities at cost: kept in cost of goods sold, not deducted again on Schedule A (please confirm)'],
      ['Personal return','Sch. A',c.exp.filter(x => x.cat === 'Donations (charity)').reduce((a,x) => a + +x.amt, 0).toFixed(2),'Cash donations'],
      ['Depreciation','Form 4562',c.depFed.toFixed(2),'Federal (incl. Section 179 '+c.used179.toFixed(2)+')'],
      ['Depreciation','Wisconsin',c.depWi.toFixed(2),'Wisconsin (no bonus depreciation)'],
      ['Inventory loss','in 42',c.loss.toFixed(2),'Damaged, stolen or expired stock at cost (already in cost of goods sold)']]));
    const detail = () => download('purchases-'+y+'-'+name+'.csv','text/csv', toCsv([['Date','Location','Paid to','Category','Amount','How it counts','Counts this year','Schedule C line','QuickBooks account','Note','Receipt photo'],
      ...c.rows.map(r => [r.x.date, A.setupOf(r.x.site).name, r.x.payee || '', r.x.cat, (+r.x.amt).toFixed(2), HOW[r.how], r.ded.toFixed(2), r.line, r.rule.qb, (r.x.note||'')+(r.note ? ' · '+r.note : ''), r.x.receipt ? 'yes' : ''])]));
    const assets = () => download('equipment-'+y+'.csv','text/csv', toCsv([['Item','Kind','Bought','In service','Cost','Business %','Method','Federal '+y,'Wisconsin '+y,'Note'],
      ...c.dep.map(d => [d.a.name, (CLASSES[d.a.class]||{}).l, d.a.bought || '', d.a.in_service, (+d.a.cost).toFixed(2), d.a.business_pct, METHODS[d.a.method], d.fed.toFixed(2), d.wi.toFixed(2), d.note])]));
    // QuickBooks Online journal import: one year-end entry for depreciation.
    const je = () => { const amt = c.depFed; if (amt <= 0) return toast('No depreciation to post for '+y);
      download('quickbooks-journal-'+y+'.csv','text/csv', toCsv([['Journal No','Journal Date','Account Name','Debits','Credits','Description'],
        ['DEP-'+y, y+'-12-31','Depreciation Expense', amt.toFixed(2), '', 'Depreciation and Section 179 for '+y+' (Downtown Stube estimate; accountant to confirm)'],
        ['DEP-'+y, y+'-12-31','Accumulated Depreciation', '', amt.toFixed(2), 'Depreciation and Section 179 for '+y]])); };
    box.append(card('For your accountant and QuickBooks',
      h('p',{class:'small muted'},'The summary lists each Schedule C line with where it came from. The purchases file has every expense with its tax line and the usual QuickBooks account name. The journal file posts the year\'s depreciation in QuickBooks Online (Settings > Import data > Journal entries).'),
      h('div',{class:'row'}, h('button',{class:'btn',type:'button',onclick:summary},'Year summary (.csv)'), h('button',{class:'btn ghost',type:'button',onclick:detail},'Every purchase (.csv)'),
        h('button',{class:'btn ghost',type:'button',onclick:assets},'Equipment and depreciation (.csv)'), h('button',{class:'btn ghost',type:'button',onclick:je},'QuickBooks depreciation entry (.csv)'))));
  }
  // ---------- hidden effects of a decision, in place (app/ripple.js) ----------
  function rippleCard(box, title, kind, values){
    if (!A.ripplePanel) return;
    const pane = h('div'); box.append(card(title, pane)); A.ripplePanel(pane, kind, values, null, 'Move the sliders');
  }
  async function yearView(v){ await guarded(v, 'Tax year and write-offs', 'Sales from your POS, cost of goods sold, every write-off on its tax line, and what to set aside. Pick the year above.', (box, c) => {
    overview(box, c); monthly(box, c); cogsCard(box, c); linesCard(box, c); building(box, c); burn(box, c); limits(box, c);
    rippleCard(box, 'Spending before December 31 to save tax?', 'purchase', {price:2000, saves:0});
    exportsCard(box, c); }); }

  // ---------- Each purchase ----------
  async function purchasesView(v){ await guarded(v, 'Each purchase and how it counts', 'Every expense this year: whether it is written off now, half, through cost of goods sold, over several years, or not at all. Change any line that is wrong.', (box, c) => {
    const pick = S().booksHow || 'all', sorted = c.rows.slice().sort((a,b) => b.x.date.localeCompare(a.x.date)).filter(r => pick === 'all' || r.how === pick || (pick === 'flag' && r.note));
    const tot = how => c.rows.filter(r => r.how === how).reduce((a,r) => a + +r.x.amt, 0);
    box.append(h('div',{class:'grid g3'}, stat(money(c.rows.reduce((a,r) => a + r.ded, 0)), 'Counts this year'), stat(money(tot('cogs')), 'Stock: counts when it sells'), stat(money(c.rows.reduce((a,r) => a + r.ded, 0) * c.rate), 'Tax saved, about')));
    box.append(h('label',{class:'f'},'Show', h('select',{onchange:e=>{ S().booksHow = e.target.value; A.save(true); A.route(); }},
      [['all','Everything'],['flag','Needs a look'],...Object.entries(HOW)].map(([k,l]) => h('option',{value:k,selected:k===pick}, l)))));
    const list = h('div',{class:'list'}, sorted.slice(0, 300).map(r => {
      const x = r.x, k = key(x), o = (c.Y.over || {})[k] || {};
      const sel = h('select',{'aria-label':'How it counts', onchange:async e=>{ const how = e.target.value;
        await saveY(c, Y => { Y.over = Y.over || {}; if (how === 'auto') delete Y.over[k]; else Y.over[k] = how === 'custom' ? {how, amt:+x.amt || 0} : {how}; }); }},
        h('option',{value:'auto',selected:!o.how},'Automatic: '+HOW[rule(x.cat).how]), Object.entries(HOW).map(([k,l]) => h('option',{value:k,selected:o.how===k},l)));
      return h('div',{class:'item'}, h('b',null, money(+x.amt)+' · '+(x.payee || x.note || x.cat)),
        h('span',{class:'small'}, A.fmtDate(x.date)+' · '+x.cat+' · '+A.setupOf(x.site).name),
        h('span',{class:'small'}, h('b',null, HOW[r.how]), r.ded ? ': '+money(r.ded)+' counts on line '+r.line+', saves about '+money(r.ded*c.rate) : r.how === 'cogs' ? ': counts as it sells' : ''),
        h('span',{class:'small muted'}, r.note || r.rule.why),
        h('div',{class:'row'}, sel, o.how === 'custom' ? h('label',{class:'f'},'Part that counts ($)', h('input',{type:'number',step:'0.01',min:'0',max:String(+x.amt||0),value:String(o.amt != null ? o.amt : ''),
          onchange:async e=>{ const v = Math.min(+x.amt || 0, Math.max(0, +e.target.value || 0)); await saveY(c, Y => { Y.over = Y.over || {}; Y.over[k] = {how:'custom', amt:v}; }); }})) : null, r.how === 'asset' && !(c.Y.linked||{})[k] ? h('a',{class:'btn sm',href:'#/equipment/'+encodeURIComponent(k)},'Add to Equipment') : null)); }));
    box.append(card(sorted.length+' purchase'+(sorted.length===1?'':'s'), sorted.length ? list : h('p',{class:'muted'},'Nothing here. Expenses and receipts logged in the app show up here.'),
      sorted.length > 300 ? h('p',{class:'small muted'},'Showing the newest 300. The download on Tax year has them all.') : null));
  }); }
  // ---------- Equipment ----------
  async function equipmentView(v){ await guarded(v, 'Equipment, fixtures and building work', 'Things that last more than a year: shelving, computers, a vehicle, a new roof. They count over several years, or all at once with Section 179 or bonus depreciation.', async (box, c) => {
    const from = A.param() ? (S().exp || []).find(x => key(x) === A.param()) : null, edit = from ? null : c.assets.find(a => a.id === S().booksEdit);
    const a0 = edit || (from ? {name:from.note || from.payee || from.cat, vendor:from.payee || '', bought:from.date, in_service:from.date, cost:+from.amt, business_pct:100, class:from.cat === 'Building improvements' ? 'improvement' : 'furniture', method:'s179', exp_id:key(from), site:from.site}
      : {name:'', vendor:'', bought:'', in_service:isoDay(new Date()), cost:'', business_pct:100, class:'furniture', method:'s179', site:S().site});
    const f = h('form',{class:'grid'},
      h('label',{class:'f'},'What it is', h('input',{type:'text',name:'name',maxlength:'160',required:true,value:a0.name})),
      h('label',{class:'f'},'Kind', h('select',{name:'class'}, Object.entries(CLASSES).map(([k,x]) => h('option',{value:k,selected:a0.class===k}, x.l+' ('+x.life+')')))),
      h('div',{class:'row'}, h('label',{class:'f'},'Cost ($)', h('input',{type:'number',name:'cost',step:'0.01',min:'0',required:true,value:String(a0.cost)})),
        h('label',{class:'f'},'Business use (%)', h('input',{type:'number',name:'pct',min:'0',max:'100',step:'1',required:true,value:String(a0.business_pct)}))),
      h('div',{class:'row'}, h('label',{class:'f'},'Bought', h('input',{type:'date',name:'bought',value:a0.bought||''})),
        h('label',{class:'f'},'Put to use (in service)', h('input',{type:'date',name:'ins',required:true,value:a0.in_service}))),
      h('label',{class:'f'},'How to count it', h('select',{name:'method'}, Object.entries(METHODS).map(([k,l]) => h('option',{value:k,selected:a0.method===k},l)))),
      h('label',{class:'f'},'From (store or contractor)', h('input',{type:'text',name:'vendor',maxlength:'100',value:a0.vendor||''})),
      h('label',{class:'f'},'Sold or thrown out (date, if any)', h('input',{type:'date',name:'sold',value:a0.sold_on||''})),
      h('p',{class:'small muted'},'Section 179 or bonus usually gives the biggest write-off now; regular depreciation spreads it out, which can be better if you expect higher profits later. Your accountant picks on the return; this is a starting point.'),
      h('div',{class:'row'}, h('button',{class:'btn',type:'submit'}, edit ? 'Save changes' : 'Add'), edit ? h('button',{class:'btn quiet',type:'button',onclick:()=>{ S().booksEdit = null; A.route(); }},'Cancel') : null));
    f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f);
      const a = {name:String(d.get('name')).trim(), class:String(d.get('class')), cost:+d.get('cost'), business_pct:+d.get('pct'), bought:String(d.get('bought')) || null, in_service:String(d.get('ins')),
        method:String(d.get('method')), vendor:String(d.get('vendor')||'').trim() || null, sold_on:String(d.get('sold')) || null, exp_id:a0.exp_id || null, site:a0.site || S().site};
      if (edit) a.id = edit.id;
      try { await DB.saveAsset(a); if (from) await saveY(c, Y => { Y.over = Y.over || {}; Y.over[key(from)] = {how:'asset'}; });
        S().booksEdit = null; toast('Saved'); if (from) A.go('equipment'); else A.route(); } catch(err){ toast(err.message || String(err)); } });
    box.append(card(edit ? 'Change '+edit.name : from ? 'Add this purchase to Equipment' : 'Add equipment or building work', f));
    rippleCard(box, 'What it really costs', 'purchase', {price:+a0.cost || 1200, biz:+a0.business_pct || 100, life:({computer:5, vehicle:5, improvement:15, systems:39, building:39, software:3})[a0.class] || 7});
    const rows = c.dep.map(d => h('tr',null, h('td',null, h('b',null,d.a.name), h('div',{class:'small muted'}, (CLASSES[d.a.class]||{}).l)), h('td',null, A.fmtDate(d.a.in_service)), h('td',null, money(+d.a.cost)+(+d.a.business_pct < 100 ? ' · '+d.a.business_pct+'%' : '')),
      h('td',{class:'small'}, METHODS[d.a.method]), h('td',null, money(d.fed)), h('td',null, money(d.wi)), h('td',{class:'small muted'}, d.note || ''),
      h('td',null, h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().booksEdit = d.a.id; A.save(true); A.go('equipment'); }},'Change'),
        h('button',{class:'btn quiet sm',type:'button',onclick:async()=>{ if (S().booksDel !== d.a.id){ S().booksDel = d.a.id; toast('Tap Remove again to remove '+d.a.name); return; } S().booksDel = null; await DB.delAsset(d.a.id); A.route(); }},'Remove'))));
    box.append(card('Equipment list · '+c.y,
      rows.length ? tbl(['Item','In service','Cost','Method','Federal '+c.y,'Wisconsin '+c.y,'',''], rows) : h('p',{class:'muted'},'Nothing yet. Add shelving, computers, the register, a vehicle or building work.'),
      h('p',{class:'small'}, 'This year: federal '+money(c.depFed)+' · Wisconsin '+money(c.depWi)+' · Section 179 used '+money(c.used179)+' of '+usd(yr(c.y).s179)),
      h('p',{class:'small muted'},'Regular depreciation uses the half-year convention (the building uses mid-month). If more than 40% of a year\'s equipment went into service in Oct to Dec, a different rule (mid-quarter) applies; your accountant will adjust.')));
  }); }

  // ---------- Loans and capital ----------
  async function loansView(v){ await guarded(v, 'Loans, Shopify Capital and money put in', 'What you borrowed, what you have paid back, and which part of each payment is a write-off. The fee or interest counts as you pay it; paying back what you borrowed does not.', async (box, c) => {
    if (c.loanErr) box.append(card('Loans are not set up yet', h('p',null, c.loanErr), h('p',{class:'small'},'Run supabase/books.sql again in the Supabase SQL editor.')));
    const y = c.y;
    box.append(h('div',{class:'grid g3'}, stat(money(c.loanInt), 'Fees and interest paid in '+y+' (write-off)', 'good'), stat(money(c.loanInt * c.rate), 'Tax that saves, about'),
      stat(money(c.loanPrin), 'Principal paid back (not a write-off)'), stat(money(c.loans.filter(x => x.l.kind !== 'owner').reduce((a,x) => a + x.owed, 0)), 'Still owed, all loans'), stat(money(c.capitalIn), 'New money in during '+y+' (not income)')));
    c.loans.forEach(x => { const l = x.l, yy = x.year(y), kindCap = l.kind === 'capital';
      const pf = h('form',{class:'row'}, h('label',{class:'f'},'Paid on', h('input',{type:'date',name:'d',required:true,value:isoDay(new Date())})),
        h('label',{class:'f'},'Amount ($)', h('input',{type:'number',name:'a',step:'0.01',min:'0',required:true})),
        l.kind === 'owner' ? null : h('label',{class:'f'},'Fee or interest part ($, blank = work it out)', h('input',{type:'number',name:'i',step:'0.01',min:'0'})),
        h('button',{class:'btn sm',type:'submit'},'Add payment'));
      pf.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(pf), i = d.get('i');
        try { await DB.addPays([{loan_id:l.id, paid_on:String(d.get('d')), amount:+d.get('a'), interest:i == null || i === '' ? null : +i}]); toast('Payment added'); A.route(); } catch(err){ toast(err.message); } });
      const fi = h('input',{type:'file',accept:'.csv,text/csv','aria-label':'Payments file for '+l.lender});
      fi.addEventListener('change', async () => { const f = fi.files[0]; if (!f) return;
        try { const rows = payCsv(await f.text()); if (!rows.length) throw new Error('No rows with a date and an amount found.'); await DB.addPays(rows.map(r => Object.assign({loan_id:l.id}, r))); toast(rows.length+' payments added'); A.route(); } catch(err){ toast(err.message); } });
      const list = x.rows.slice().reverse().slice(0, 60).map(r => h('tr',null, h('td',null, A.fmtDate(r.p.paid_on)), h('td',null, money(r.pay)), h('td',null, money(r.int)+(r.est && l.kind !== 'owner' ? ' (est.)' : '')), h('td',null, money(r.prin)),
        h('td',null, h('button',{class:'btn quiet sm',type:'button',onclick:async()=>{ await DB.delPay(r.p.id); A.route(); }},'Remove'))));
      box.append(card(l.lender+' · '+LOAN_KINDS[l.kind],
        h('p',{class:'small muted'}, 'Started '+A.fmtDate(l.started)+' · '+money(+l.amount)+(kindCap ? ' + '+money(+l.fee)+' fee = '+money(+l.amount + +l.fee)+' to pay back'+(l.holdback ? ', '+l.holdback+'% of daily sales' : '') : +l.rate ? ' at '+l.rate+'% a year' : '')+(l.use_for ? ' · for '+l.use_for : '')),
        l.kind === 'owner' ? h('p',null,'Money you put in is not income and not a write-off. Paying yourself back is not a write-off either.')
          : h('p',null, y+': paid '+money(yy.paid)+' in '+yy.n+' payment'+(yy.n===1?'':'s')+' · ', h('b',null, money(yy.int)+' fee or interest counts'), ' (saves about '+money(yy.int*c.rate)+') · '+money(yy.prin)+' principal does not · '+money(x.owed)+' left to pay'),
        kindCap ? h('p',{class:'small muted'},'The fee is fixed, so each payment carries the same share of it: '+((+l.amount + +l.fee) ? (100 * l.fee / (+l.amount + +l.fee)).toFixed(1) : 0)+'% of every dollar paid back. Fee still to come: '+money(x.feeLeft)+'.') : null,
        list.length ? tbl(['Paid','Amount','Fee/interest','Principal',''], list) : h('p',{class:'muted small'},'No payments yet.'),
        pf, h('div',{class:'row'}, h('label',{class:'f'},'Or import payments (.csv with a date and an amount column)', fi)),
        h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:async()=>{ if (S().booksDelLoan !== l.id){ S().booksDelLoan = l.id; toast('Tap again to remove '+l.lender+' and its payments'); return; } await DB.delLoan(l.id); A.route(); }},'Remove this loan')))); });
    const f = h('form',{class:'grid'},
      h('label',{class:'f'},'Kind', h('select',{name:'kind'}, Object.entries(LOAN_KINDS).map(([k,t]) => h('option',{value:k},t)))),
      h('label',{class:'f'},'From', h('input',{type:'text',name:'lender',maxlength:'120',required:true,placeholder:'Shopify Capital, bank name, yourself'})),
      h('div',{class:'row'}, h('label',{class:'f'},'Date received', h('input',{type:'date',name:'started',required:true})), h('label',{class:'f'},'Amount received ($)', h('input',{type:'number',name:'amount',step:'0.01',min:'0',required:true}))),
      h('div',{class:'row'}, h('label',{class:'f'},'Fixed fee ($, Shopify Capital)', h('input',{type:'number',name:'fee',step:'0.01',min:'0'})), h('label',{class:'f'},'Interest rate (% a year, loans)', h('input',{type:'number',name:'rate',step:'0.001',min:'0',max:'100'})),
        h('label',{class:'f'},'Share of daily sales (%)', h('input',{type:'number',name:'hold',step:'0.01',min:'0',max:'100'}))),
      h('label',{class:'f'},'What it paid for (optional)', h('input',{type:'text',name:'use',maxlength:'120',placeholder:'Holiday stock, shelving, roof'})),
      h('p',{class:'small muted'},'Shopify Capital: Shopify admin > Finance > Capital shows each offer\'s amount, fee and payment history.'),
      h('button',{class:'btn',type:'submit'},'Add'));
    f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f);
      try { await DB.saveLoan({kind:String(d.get('kind')), lender:String(d.get('lender')).trim(), started:String(d.get('started')), amount:+d.get('amount'), fee:+d.get('fee')||0, rate:+d.get('rate')||0, holdback:d.get('hold') ? +d.get('hold') : null, use_for:String(d.get('use')||'').trim() || null}); toast('Added'); A.route(); } catch(err){ toast(err.message); } });
    const lastLoan = c.loans.map(x => x.l).filter(l => l.kind !== 'owner').sort((a,b) => String(b.started).localeCompare(String(a.started)))[0];
    rippleCard(box, lastLoan ? 'What '+lastLoan.lender+' really costs' : 'What a loan really costs', 'loan',
      lastLoan ? {amount:+lastLoan.amount, fee:+lastLoan.fee || 0, hold:+lastLoan.holdback || 0} : {});
    box.append(card('Add a loan, advance or money you put in', f));
    box.append(card('How it counts', h('ul',{class:'small'},
      h('li',null,'Money you borrow is not income, and paying it back is not a write-off. Only the fee or interest counts, in the year you pay it (Schedule C line 16b).'),
      h('li',null,'Shopify Capital: the fixed fee is spread over the payments, so the write-off grows as Shopify takes its share of your sales. This is the common way to count it; your accountant confirms.'),
      h('li',null,'What the money bought counts on its own: stock through cost of goods sold, equipment on the Equipment list.'),
      h('li',null,'Credit card interest on business purchases counts; the purchases themselves are logged in Expenses.'))));
  }); }
  function payCsv(text){
    const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(l => { const out = []; let cell = '', q = false;
      for (let i = 0; i < l.length; i++){ const ch = l[i]; if (q){ if (ch === '"'){ if (l[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"') q = true; else if (ch === ','){ out.push(cell); cell = ''; } else cell += ch; }
      out.push(cell); return out; });
    if (rows.length < 2) return [];
    const hd = rows[0].map(x => x.trim().toLowerCase()), iD = hd.findIndex(x => /date|day/.test(x)), iA = hd.findIndex((x, i) => i !== iD && /amount|payment|paid|remit/.test(x)), iI = hd.findIndex(x => /fee|interest/.test(x));
    if (iD < 0 || iA < 0) return [];
    const num = v => { const n = parseFloat(String(v||'').replace(/[$,()]/g,'')); return isNaN(n) ? null : Math.abs(n); };
    return rows.slice(1).map(r => { const d = String(r[iD]||'').trim(); let iso = (d.match(/^\d{4}-\d{2}-\d{2}/) || [])[0];
      if (!iso){ const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) iso = m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0'); }
      if (!iso){ const t = new Date(d); if (!isNaN(t)) iso = isoDay(t); }
      return {paid_on:iso, amount:num(r[iA]), interest:iI >= 0 ? num(r[iI]) : null}; }).filter(r => r.paid_on && r.amount); }

  A.register({id:'books', name:'Tax year and write-offs', what:'Owner only. Yearly books tied to Shopify: sales by month, cost of goods sold, each purchase on its tax line with an estimate of what it saves, equipment depreciation, building costs, burn rate, limits, and files for the accountant and QuickBooks.', tiers:['owner'],
    views:{books:{t:'Tax year', ic:'🧮', render:v => { yearView(v); }, min:'owner'}, purchases:{t:'Each purchase', ic:'🧾', render:v => { purchasesView(v); }, min:'owner', hidden:true},
      equipment:{t:'Equipment', ic:'🪑', render:v => { equipmentView(v); }, min:'owner', hidden:true},
      loans:{t:'Loans and capital', ic:'🏦', render:v => { loansView(v); }, min:'owner', hidden:true}}});
  A.ownerHooks.push(v => { if (!isOwner()) return; const c0 = h('div',{class:'card'}, h('h2',null,'Tax year '+new Date().getFullYear()), h('p',{class:'small muted'},'Adding it up…')); v.append(c0);
    compute(new Date().getFullYear(), 'all').then(c => { c0.lastChild.remove(); c0.append(h('p',null,'Profit so far about '+money(c.profit)+' · write-offs '+money(c.deductions + c.cogs)+' · set aside about '+money(Math.max(0, c.profit) * c.rate)+' for tax. ', h('a',{href:'#/books'},'Open'))); })
      .catch(() => { c0.lastChild.remove(); c0.append(h('p',{class:'small muted'},'Run supabase/books.sql to turn on the tax year. ', h('a',{href:'#/books'},'Open'))); }); });
  A.books = {loanMath, payCsv, depFor, regular, treat, shopifyMonths, compute, CLASSES, RULES, YEARLY};
})();
