// Payroll (OWNER ONLY): turns time clock hours into a pay run, hands it to a licensed payroll service that
// withholds and files the taxes, and keeps the records.
//   Why a service: federal income tax (IRS Pub 15-T), Social Security and Medicare, Wisconsin withholding (Pub W-166),
//   the tax deposits, Form 941 every quarter, 940, WT-6/WT-7, unemployment reports, W-2s and the new-hire report
//   all carry penalties when they are late or wrong. Gusto or QuickBooks Payroll do all of that from each person's
//   W-4 and WT-4 and pay staff by direct deposit. This screen does the part they can't: the hours.
//   Pay run   : pay periods (weekly, every two weeks, twice a month or monthly), hours per workweek from the time
//               clock, overtime at 1.5x after 40 hours in each Sunday to Saturday workweek (federal FLSA and Wisconsin
//               have no daily overtime), gross pay, a file for the payroll service, and the employer's cost.
//   Paid      : the owner types what the service actually charged and the run is locked; wages and employer taxes go
//               into Expenses (Payroll, Payroll taxes) so the Tax year screen and QuickBooks see them.
//   Setup     : the one-time accounts and the paperwork for each new hire, with what the law requires and when.
// Data lives in the 'payroll' area, which only the owner can read or save (supabase/payroll.sql). Hourly rates stay
// in 'pay' (Team screen) so managers can still see timesheets.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, download, toCsv, isoDay, addDays, uid} = A;
  const S = () => A.state();
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');
  Object.values(A.D.BUSINESS_TYPES).forEach(t => { if (t.modules && !t.modules.includes('payroll')) t.modules.push('payroll'); });

  // Rates that change by year. Checked Nov 2026; update each January (see the Setup tab for where).
  const RATES = {
    ss:0.062, ssBase:184500,          // Social Security, employee and employer each; 2026 wage base
    med:0.0145,                       // Medicare, each (plus 0.9% employee-only over $200,000, the service handles it)
    futa:0.006, futaBase:7000,        // federal unemployment after the 5.4% state credit, first $7,000 per person per year
    suiBase:14000, suiNew:3.05,       // Wisconsin unemployment: first $14,000 per person per year; new-employer rate (%),
                                      // 2.90 to 3.25 by payroll size and industry. Use the rate on your DWD notice.
    minWage:7.25                      // Wisconsin and federal minimum wage per hour
  };
  const FREQ = {weekly:'Every week', biweekly:'Every two weeks', semimonthly:'Twice a month (1st to 15th, 16th to end)', monthly:'Once a month'};
  const PROVIDERS = {gusto:'Gusto', quickbooks:'QuickBooks Payroll', self:'I do it myself'};

  // ---------- state ----------
  const P = () => { const s = S(); s.payroll = s.payroll || {}; const p = s.payroll;
    p.settings = p.settings || {provider:'gusto', freq:'biweekly', anchor:'', lag:5, sui:RATES.suiNew};
    if (!p.settings.ownerMode) p.settings.ownerMode = 'draws'; // 'draws' (sole owner, partner) or 'salary' (S-corp or C-corp owner on payroll)
    p.runs = p.runs || []; p.people = p.people || {}; p.check = p.check || {}; p.est = p.est || []; return p; };
  const site = () => S().site;
  const team = () => ((S().shifts || {}).team || {})[site()] || [];
  const staff = () => team().filter(p => p.tier !== 'owner');
  const owners = () => team().filter(p => p.tier === 'owner');
  const salaryMode = () => P().settings.ownerMode === 'salary';
  const rateOf = p => { const e = ((S().pay || {}).people || {})[p.id] || {}; return e.rate != null ? +e.rate : +(p.rate || 0); };
  const payName = p => (P().people[p.id] || {}).name || p.n.replace(/ \(sample\)$/, '');
  const r2 = n => Math.round(n*100)/100;
  const hrs = m => Math.round(m/6)/10;
  const today = () => isoDay(new Date());
  const pct = x => +(x*100).toFixed(2)+'%', usd = n => '$'+Math.round(n).toLocaleString('en-US');
  const sunday = iso => { const d = new Date(iso+'T12:00:00'); return addDays(iso, -d.getDay()); };
  const lastDay = (y, m) => isoDay(new Date(y, m, 0, 12)); // m is 1-12

  // ---------- pay periods ----------
  // Weekly and every-two-weeks periods start on a Sunday so each workweek sits wholly inside one period.
  // For twice-a-month and monthly, a workweek is paid in the period where it ends (its Saturday), with its overtime.
  function periodOf(iso){
    const st = P().settings, f = st.freq;
    if (f === 'weekly' || f === 'biweekly'){
      const len = f === 'weekly' ? 7 : 14, anchor = sunday(st.anchor || '2026-01-04');
      const diff = Math.round((new Date(iso+'T12:00:00') - new Date(anchor+'T12:00:00')) / 864e5), k = Math.floor(diff / len);
      const start = addDays(anchor, k*len); return {start, end:addDays(start, len-1)};
    }
    const y = +iso.slice(0,4), m = +iso.slice(5,7), d = +iso.slice(8,10), ym = iso.slice(0,7);
    if (f === 'monthly') return {start:ym+'-01', end:lastDay(y, m)};
    return d <= 15 ? {start:ym+'-01', end:ym+'-15'} : {start:ym+'-16', end:lastDay(y, m)};
  }
  const payday = per => addDays(per.end, +P().settings.lag || 0);
  function workweeks(per){ // Sundays of the workweeks paid in this period
    const out = []; let wk = sunday(per.start); if (addDays(wk, 6) < per.start) wk = addDays(wk, 7);
    for (; addDays(wk, 6) <= per.end; wk = addDays(wk, 7)) out.push(wk);
    if (!['weekly','biweekly'].includes(P().settings.freq)){ // twice a month or monthly: by the workweek's Saturday
      out.length = 0; for (let w = sunday(addDays(per.start, -6)); w <= per.end; w = addDays(w, 7)){ const sat = addDays(w, 6); if (sat >= per.start && sat <= per.end) out.push(w); }
    }
    return out;
  }

  // minutes worked by person in the workweek starting wk; open punches are left out and reported
  function weekMinutes(wk){
    const end = addDays(wk, 7), by = {}, open = [];
    (((S().shifts || {}).punches || {})[site()] || []).forEach(p => {
      const d = p.in.slice(0,10); if (d < wk || d >= end) return;
      if (!p.out){ open.push(p); return; }
      const m = Math.max(0, Math.round((new Date(p.out) - new Date(p.in))/60000) - ((p.brk||0) >= 30 ? p.brk : 0)); // breaks under 30 minutes are paid (Wisconsin)
      by[p.who] = (by[p.who]||0) + m;
    });
    return {by, open};
  }

  // the pay run for a period, worked out fresh from the time clock
  function figure(per){
    const weeks = workweeks(per), open = [], rows = [];
    const mins = weeks.map(wk => { const x = weekMinutes(wk); open.push(...x.open); return x.by; });
    staff().forEach(p => {
      const rate = rateOf(p), wks = weeks.map((wk, i) => { const m = mins[i][p.n] || 0, reg = Math.min(m, 2400), ot = Math.max(0, m - 2400);
        return {wk, reg, ot, gross:r2(rate*reg/60 + rate*1.5*ot/60)}; }).filter(w => w.reg || w.ot);
      if (!wks.length) return;
      const reg = wks.reduce((a,w) => a + w.reg, 0), ot = wks.reduce((a,w) => a + w.ot, 0), gross = r2(wks.reduce((a,w) => a + w.gross, 0));
      rows.push({id:p.id, n:p.n, name:payName(p), rate, reg, ot, gross, weeks:wks});
    });
    // An owner on salary is paid like any other worker: a set amount each pay period, not from the time clock.
    if (salaryMode()) owners().forEach(p => { const g = r2(+P().settings.ownerSalary || 0); if (g > 0) rows.push({id:p.id, n:p.n, name:payName(p), rate:0, reg:0, ot:0, gross:g, weeks:[], salaried:true}); });
    return {weeks, rows, open};
  }

  // wages already paid this calendar year, by person (from paid runs), for the unemployment wage caps
  function ytd(year, beforeRun){
    const by = {}; P().runs.filter(r => r.status === 'paid' && r.site === site() && r.payday.slice(0,4) === String(year) && r !== beforeRun && (!beforeRun || r.payday <= beforeRun.payday))
      .forEach(r => r.rows.forEach(x => { by[x.id] = (by[x.id]||0) + x.gross; }));
    return by;
  }
  function employerCost(rows, year, run){
    const done = ytd(year, run), sui = (+P().settings.sui || RATES.suiNew)/100; let fica = 0, futa = 0, suta = 0, held = 0;
    rows.forEach(x => { const before = done[x.id] || 0, g = x.gross;
      const inBase = base => Math.max(0, Math.min(before + g, base) - Math.min(before, base));
      fica += inBase(RATES.ssBase)*RATES.ss + g*RATES.med; held += inBase(RATES.ssBase)*RATES.ss + g*RATES.med;
      futa += inBase(RATES.futaBase)*RATES.futa; suta += inBase(RATES.suiBase)*sui; });
    return {fica:r2(fica), futa:r2(futa), suta:r2(suta), total:r2(fica+futa+suta), heldFica:r2(held)};
  }

  // ---------- files for the payroll service ----------
  const wkLabel = wk => wk+' to '+addDays(wk, 6);
  function byWeekCsv(run){ // Gusto reads a workweek column to check overtime per week
    return toCsv([['Employee','Workweek','Regular hours','Overtime hours','Hourly rate','Gross pay'],
      ...run.rows.flatMap(x => x.salaried ? [[x.name, 'Salary '+run.start+' to '+run.end, '', '', '', x.gross.toFixed(2)]] : x.weeks.map(w => [x.name, wkLabel(w.wk), hrs(w.reg), hrs(w.ot), x.rate.toFixed(2), w.gross.toFixed(2)]))]);
  }
  function totalsCsv(run){
    return toCsv([['Employee','Pay period start','Pay period end','Pay date','Regular hours','Overtime hours','Hourly rate','Gross pay'],
      ...run.rows.map(x => [x.name, run.start, run.end, run.payday, x.salaried ? 'salary' : hrs(x.reg), x.salaried ? '' : hrs(x.ot), x.salaried ? '' : x.rate.toFixed(2), x.gross.toFixed(2)])]);
  }

  // ---------- screens ----------
  const card = (t, ...kids) => h('div',{class:'card'}, h('h2',null,t), ...kids);
  const tabs = cur => h('div',{class:'row'}, [['ownerpay','Owner pay'],['payroll','Pay run'],['payrollpaid','Paid'],['payrollsetup','Setup and the law']].map(([id,t]) =>
    h('a',{class:'btn '+(cur === id ? '' : 'quiet ')+'sm', href:'#/'+id, 'aria-current':cur === id ? 'page' : null}, t)));
  const ownerOnly = v => { if (isOwner()) return false; v.append(card('Owner only', h('p',null,'Only the owner can see payroll.'))); return true; };
  const providerName = () => PROVIDERS[P().settings.provider] || 'your payroll service';
  const ready = () => (window.SSShifts ? window.SSShifts.ensure() : Promise.resolve());

  function runView(v){
    v.append(head('Owner · '+A.site().name, 'Payroll', 'Hours from the time clock become a pay run. '+providerName()+' withholds the taxes, pays your team and files the forms.'), tabs('payroll'));
    if (ownerOnly(v)) return;
    ready().then(() => {
      const st = P().settings;
      if (!st.anchor) return setupFirst(v);
      const per = S().payPer && S().payPer.start ? S().payPer : periodOf(addDays(periodOf(today()).start, -1)); // default: the last finished period
      const pd = payday(per), done = P().runs.find(r => r.site === site() && r.start === per.start && r.end === per.end);
      const move = dir => { const p = dir < 0 ? periodOf(addDays(per.start, -1)) : periodOf(addDays(per.end, 1)); S().payPer = p; A.save(); A.route(); };
      v.append(h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:()=>move(-1)},'‹ Earlier'),
        h('b',null, A.fmtDate(per.start)+' to '+A.fmtDate(per.end)+' · payday '+A.fmtDate(pd)),
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>move(1)},'Later ›')));
      if (done) return runCard(v, done);
      const f = figure(per), run = {start:per.start, end:per.end, payday:pd, rows:f.rows};
      if (per.end >= today()) v.append(h('div',{class:'card'}, h('p',null,'This pay period is not over yet. These are the hours so far.')));
      if (f.open.length) v.append(h('div',{class:'card'}, h('h2',null,'Fix these first'),
        h('p',null,'Still clocked in, so their hours are not counted: '+f.open.map(p => p.who+' since '+A.fmtTime(p.in)).join('; ')+'. Fix the clock-out on the ', h('a',{href:'#/timesheets'},'Timesheets'),' screen.')));
      const low = f.rows.filter(x => !x.salaried && x.rate < RATES.minWage);
      if (low.length) v.append(h('div',{class:'card'}, h('p',null, h('b',null,'Below minimum wage: '), low.map(x => x.n+' at '+money(x.rate)+'/h').join(', ')+'. Wisconsin and federal minimum is '+money(RATES.minWage)+' an hour. Change it on the Team screen.')));
      v.append(table(run), costCard(run));
      const go = h('div',{class:'row'},
        h('button',{class:'btn',type:'button',disabled:!f.rows.length || !!f.open.length || per.end >= today(),onclick:()=>{
          P().runs.push({id:uid(), site:site(), start:per.start, end:per.end, payday:pd, rows:f.rows, status:'ready', made:new Date().toISOString(), provider:st.provider}); A.save(); toast('Pay run saved'); A.route(); }},'Save this pay run'));
      v.append(card('Next', h('p',{class:'small muted'},'Saving keeps a copy of these hours even if a punch is changed later. Then download the file for '+providerName()+'.'), go));
    });
  }

  function table(run){
    const tb = h('tbody'); run.rows.forEach(x => tb.append(h('tr',null, h('td',null,x.name), h('td',null,hrs(x.reg)+' h'),
      h('td',null, x.ot ? h('span',{class:'chip amber'}, hrs(x.ot)+' h') : '0'), h('td',null, x.salaried ? 'Salary' : money(x.rate)), h('td',null,money(x.gross)))));
    const total = r2(run.rows.reduce((a,x) => a + x.gross, 0));
    return card('Hours and gross pay',
      run.rows.length ? h('div',{class:'tablewrap',tabindex:'0',role:'region','aria-label':'Pay run'},
        h('table',{class:'t'}, h('thead',null,h('tr',null,h('th',null,'Person'),h('th',null,'Regular'),h('th',null,'Overtime'),h('th',null,'Rate'),h('th',null,'Gross pay'))), tb)) : h('p',{class:'muted'},'No hours on the time clock for this period.'),
      h('p',null, h('b',null,'Gross pay: '+money(total))),
      h('p',{class:'small muted'},'Overtime is 1.5 times the rate after 40 hours in a Sunday to Saturday workweek. Breaks under 30 minutes are paid. Take-home pay is gross pay minus federal and Wisconsin income tax (from each person\'s W-4 and WT-4), 7.65% Social Security and Medicare, and any deductions. '+providerName()+' works that out.'));
  }

  function costCard(run){
    const c = employerCost(run.rows, run.payday.slice(0,4), run.status === 'paid' ? run : null), gross = r2(run.rows.reduce((a,x) => a + x.gross, 0));
    return card('What it costs the store',
      h('ul',null, h('li',null,'Gross pay: '+money(gross)), h('li',null,'Your share of Social Security and Medicare (7.65%): '+money(c.fica)),
        h('li',null,'Federal unemployment (FUTA, 0.6% of the first $7,000 a year each): '+money(c.futa)),
        h('li',null,'Wisconsin unemployment ('+(+P().settings.sui || RATES.suiNew)+'% of the first $14,000 a year each): '+money(c.suta))),
      h('p',null, h('b',null,'About '+money(gross + c.total)+' in total'), h('span',{class:'small muted'},', plus the service\'s fee. Have it in the bank account two business days before payday.')));
  }

  function runCard(v, run){
    const paid = run.status === 'paid';
    v.append(h('div',{class:'card'}, h('p',null, h('span',{class:'chip '+(paid ? 'calm' : 'amber')}, paid ? 'Paid' : 'Saved, not paid yet'),
      paid ? ' Paid '+A.fmtDate(run.payday)+'. Locked.' : ' Saved '+A.fmtTime(run.made)+'.')));
    v.append(table(run));
    if (paid){ v.append(card('Recorded', h('p',null,'Wages '+money(run.paid.gross)+' · employer taxes '+money(run.paid.tax)+(run.paid.fee ? ' · fee '+money(run.paid.fee) : '')+'. In Expenses as Payroll and Payroll taxes.'))); return; }
    v.append(costCard(run));
    const pv = run.provider || P().settings.provider;
    v.append(card('1. Send the hours to '+providerName(),
      pv === 'gusto' ? h('ol',null, h('li',null,'Download the file below.'), h('li',null,'In Gusto: Pay, then Run payroll, then Import payroll data. Upload the file. Gusto matches the columns and checks overtime by workweek.'),
        h('li',null,'Check each name matches Gusto. If a name is different, set it under Setup (Names in the payroll service).'), h('li',null,'Review and submit by Gusto\'s deadline (usually 4 business days before payday, or the day before with next-day pay).'))
      : pv === 'quickbooks' ? h('ol',null, h('li',null,'Download the totals file below.'), h('li',null,'In QuickBooks: Payroll, then Run payroll. Type each person\'s regular and overtime hours from the file.'), h('li',null,'Preview and submit by 5 PM Pacific the business day before payday for next-day direct deposit.'))
      : h('p',null,'You are doing payroll yourself: work out federal withholding with IRS Publication 15-T and Wisconsin withholding with DOR Publication W-166 from each W-4 and WT-4, deposit the taxes on time and file 941, WT-6 and UCT-101. Setup has the list.'),
      h('div',{class:'row'},
        h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('payroll-by-workweek-'+run.start+'.csv','text/csv',byWeekCsv(run))},'Download by workweek (.csv)'),
        h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('payroll-totals-'+run.start+'.csv','text/csv',totalsCsv(run))},'Download totals (.csv)'),
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ if (!confirm('Delete this saved pay run and work it out again from the time clock?')) return;
          P().runs = P().runs.filter(r => r !== run); A.save(); A.route(); }},'Start this run over'))));
    const est = employerCost(run.rows, run.payday.slice(0,4), null), gross = r2(run.rows.reduce((a,x) => a + x.gross, 0));
    const f = h('form',{class:'grid'},
      h('label',{class:'f'},'Gross wages from the payroll report ($)', h('input',{type:'number',name:'gross',step:'0.01',min:'0',value:gross.toFixed(2),required:true})),
      h('label',{class:'f'},'Employer taxes from the payroll report ($)', h('input',{type:'number',name:'tax',step:'0.01',min:'0',value:est.total.toFixed(2),required:true})),
      h('label',{class:'f'},'Service fee this run, if any ($)', h('input',{type:'number',name:'fee',step:'0.01',min:'0',value:''})),
      h('button',{class:'btn',type:'submit'},'Mark as paid'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), num = k => r2(+d.get(k) || 0);
      run.status = 'paid'; run.paid = {gross:num('gross'), tax:num('tax'), fee:num('fee'), at:new Date().toISOString()};
      const ex = S().exp = S().exp || [], note = 'Payroll '+run.start+' to '+run.end+' ('+providerName()+')';
      ex.push({id:uid(), site:site(), date:run.payday, cat:'Payroll', amt:run.paid.gross, payee:providerName(), note, status:'ok', src:'payroll:'+run.id});
      if (run.paid.tax) ex.push({id:uid(), site:site(), date:run.payday, cat:'Payroll taxes', amt:run.paid.tax, payee:providerName(), note, status:'ok', src:'payroll:'+run.id});
      if (run.paid.fee) ex.push({id:uid(), site:site(), date:run.payday, cat:'Software and subscriptions', amt:run.paid.fee, payee:providerName(), note:note+' fee', status:'ok', src:'payroll:'+run.id});
      A.save(); toast('Paid and recorded'); A.route(); });
    v.append(card('2. After payday', h('p',{class:'small muted'},'Copy the totals from '+providerName()+'\'s payroll summary so the books match what really left the bank. This locks the run and adds it to Expenses.'), f));
  }

  function setupFirst(v){
    const st = P().settings, sug = sunday(today());
    const f = h('form',{class:'card grid'}, h('h2',null,'Set up pay periods'),
      h('label',{class:'f'},'Payroll service', h('select',{name:'provider'}, Object.entries(PROVIDERS).map(([k,t]) => h('option',{value:k,selected:st.provider === k},t)))),
      h('label',{class:'f'},'How often you pay', h('select',{name:'freq'}, Object.entries(FREQ).map(([k,t]) => h('option',{value:k,selected:st.freq === k},t)))),
      h('label',{class:'f'},'First day of a pay period (weekly or every two weeks: a Sunday)', h('input',{type:'date',name:'anchor',value:st.anchor || sug,required:true})),
      h('label',{class:'f'},'Payday: days after the period ends', h('input',{type:'number',name:'lag',min:'0',max:'31',value:String(st.lag == null ? 5 : st.lag)})),
      h('p',{class:'small muted'},'Wisconsin law: pay at least once a month, within 31 days of the work. Every two weeks with payday the following Friday (5 days) is the most common.'),
      h('button',{class:'btn',type:'submit'},'Save'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), lag = Math.max(0, Math.min(31, +d.get('lag') || 0));
      Object.assign(st, {provider:String(d.get('provider')), freq:String(d.get('freq')), anchor:sunday(String(d.get('anchor'))), lag}); delete S().payPer; A.save(); toast('Saved'); A.route(); });
    v.append(f);
  }

  function historyView(v){
    v.append(head('Owner · '+A.site().name, 'Paid pay runs', 'Every pay run, what it cost, and each person\'s wages so far this year.'), tabs('payrollpaid'));
    if (ownerOnly(v)) return;
    const y = S().payYear || new Date().getFullYear(), runs = P().runs.filter(r => r.site === site() && r.payday.slice(0,4) === String(y)).sort((a,b) => b.payday.localeCompare(a.payday));
    v.append(h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().payYear = y-1; A.save(); A.route(); }},'‹ '+(y-1)), h('b',null,String(y)),
      h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().payYear = y+1; A.save(); A.route(); }},(y+1)+' ›')));
    v.append(card('Pay runs', runs.length ? h('div',{class:'list'}, runs.map(r => h('div',{class:'item'},
      h('b',null,'Payday '+A.fmtDate(r.payday)), h('span',{class:'small muted'}, A.fmtDate(r.start)+' to '+A.fmtDate(r.end)+' · '+r.rows.length+' people · '+money(r.paid ? r.paid.gross : r.rows.reduce((a,x) => a + x.gross, 0))),
      h('span',{class:'chip '+(r.status === 'paid' ? 'calm' : 'amber')}, r.status === 'paid' ? 'Paid' : 'Not paid yet'),
      h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().payPer = {start:r.start, end:r.end}; A.save(); A.go('payroll'); }},'Open')))) : h('p',{class:'muted'},'No pay runs this year.')));
    const by = {}; runs.filter(r => r.status === 'paid').forEach(r => r.rows.forEach(x => { const e = by[x.id] = by[x.id] || {name:x.name, reg:0, ot:0, gross:0}; e.reg += x.reg; e.ot += x.ot; e.gross = r2(e.gross + x.gross); }));
    const rows = Object.values(by), q = {}; runs.filter(r => r.status === 'paid').forEach(r => { const k = 'Q'+Math.ceil(+r.payday.slice(5,7)/3); const e = q[k] = q[k] || {gross:0, tax:0}; e.gross = r2(e.gross + r.paid.gross); e.tax = r2(e.tax + r.paid.tax); });
    v.append(card('Wages so far this year', rows.length ? h('ul',null, rows.map(e => h('li',null, e.name+': '+money(e.gross)+' ('+hrs(e.reg)+' h regular, '+hrs(e.ot)+' h overtime)'))) : h('p',{class:'muted'},'Nothing paid yet.'),
      Object.keys(q).length ? h('p',{class:'small muted'}, 'By quarter (what Form 941 and the Wisconsin UCT-101 report): '+Object.keys(q).sort().map(k => k+' wages '+money(q[k].gross)+', employer taxes '+money(q[k].tax)).join(' · ')) : null,
      h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('payroll-'+y+'.csv','text/csv',
        toCsv([['Pay date','Period start','Period end','Employee','Regular hours','Overtime hours','Rate','Gross pay','Status'], ...runs.flatMap(r => r.rows.map(x => [r.payday, r.start, r.end, x.name, hrs(x.reg), hrs(x.ot), x.rate.toFixed(2), x.gross.toFixed(2), r.status]))]))},'Download the year (.csv)'))));
  }

  // one-time accounts and per-hire paperwork; what the law requires
  const ONCE = [
    ['ein','Federal employer ID number (EIN)','From the IRS (free, online at irs.gov). You need it before the first payday.'],
    ['wt','Wisconsin withholding account','Register with the Department of Revenue (My Tax Account, form BTR-101). The DOR tells you how often to deposit (WT-6).'],
    ['ui','Wisconsin unemployment account','Register with the Department of Workforce Development. Your rate notice gives the unemployment rate; type it below.'],
    ['wc','Workers\' compensation insurance','Required in Wisconsin once you have 3 or more employees, or pay $500 or more in wages to anyone in a calendar quarter.'],
    ['svc','Payroll service set up and bank verified','Gusto or QuickBooks Payroll: add the EIN and both Wisconsin account numbers so they can deposit and file for you.'],
    ['post','Workplace posters up','Federal minimum wage, OSHA, EEO, FMLA (50+ staff) and the Wisconsin posters (minimum wage, unemployment, fair employment). Free from DOL and DWD; your payroll service may supply them.']
  ];
  const HIRE = [
    ['w4','Form W-4 (federal withholding)','Before the first payday. Without one, withhold as single with no adjustments.'],
    ['wt4','Form WT-4 (Wisconsin withholding)','Before the first payday. Without one, withhold as single with no exemptions.'],
    ['i9','Form I-9','Section 1 on the first day; you check documents within 3 business days. Keep 3 years after hire or 1 year after they leave, whichever is later. (Also on the HR file screen.)'],
    ['nh','Wisconsin new-hire report','Within 20 days of the start date. Gusto and QuickBooks Payroll file it for you; confirm it is on.'],
    ['dd','Direct deposit details','Bank details go straight into the payroll service (the person can enter them there), never into this app.']
  ];
  function setupView(v){
    v.append(head('Owner · '+A.site().name, 'Payroll setup and the law', 'Accounts to open once, paperwork for each new hire, and what is due when.'), tabs('payrollsetup'));
    if (ownerOnly(v)) return;
    ready().then(() => {
      const p = P(), st = p.settings;
      setupFirst(v);
      const ck = (k, t, why) => h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:!!p.check[k],onchange:e=>{ p.check[k] = e.target.checked ? today() : null; A.save(); }}), h('span',null, h('b',null,t), h('br'), h('span',{class:'small muted'},why)));
      v.append(card('Once, before the first payday', ...ONCE.map(([k,t,w]) => ck(k,t,w))));
      const uf = h('form',{class:'row'}, h('label',{class:'f'},'Wisconsin unemployment rate (%)', h('input',{type:'number',name:'sui',step:'0.01',min:'0',max:'15',value:String(st.sui || RATES.suiNew)})), h('button',{class:'btn ghost sm',type:'submit'},'Save rate'));
      uf.addEventListener('submit', e => { e.preventDefault(); st.sui = +new FormData(uf).get('sui') || RATES.suiNew; A.save(); toast('Saved'); });
      v.append(card('Unemployment rate', h('p',{class:'small muted'},'New Wisconsin employers pay '+RATES.suiNew+'% for their first years (2.90% to 3.25% by payroll size and industry). It changes each January; use the number on your DWD rate notice.'), uf));
      v.append(card('Each new hire', h('p',{class:'small muted'},'Tick these per person. The forms themselves go to the payroll service or a locked folder, not this app (they hold Social Security numbers).'),
        ...staff().map(m => { const e = p.people[m.id] = p.people[m.id] || {}, done = e.hire || (e.hire = {});
          const nameIn = h('input',{type:'text',value:e.name || '','aria-label':'Name in the payroll service for '+m.n,placeholder:m.n.replace(/ \(sample\)$/,''),onchange:ev=>{ e.name = ev.target.value.trim(); A.save(); }});
          return h('details',{class:'item'}, h('summary',null, h('b',null,m.n), ' ', h('span',{class:'small muted'}, HIRE.filter(([k]) => done[k]).length+' of '+HIRE.length+' done')),
            h('label',{class:'f'},'Name in the payroll service (if different)', nameIn),
            ...HIRE.map(([k,t,w]) => h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:!!done[k],onchange:ev=>{ done[k] = ev.target.checked ? today() : null; A.save(); }}), h('span',null, h('b',null,t), h('br'), h('span',{class:'small muted'},w))))); })));
      v.append(card('What is due when',
        h('p',{class:'small muted'},'With Gusto or QuickBooks Payroll, the service files and pays all of these. You only check they did. Doing it yourself, these are yours.'),
        h('ul',null,
          h('li',null,h('b',null,'Every payday: '),'pay at least monthly; pay stubs (the service makes them); tax deposits (federal on the IRS monthly or semiweekly schedule, Wisconsin on the schedule the DOR gave you).'),
          h('li',null,h('b',null,'Each quarter (by Apr 30, Jul 31, Oct 31, Jan 31): '),'IRS Form 941; Wisconsin unemployment report UCT-101.'),
          h('li',null,h('b',null,'By January 31: '),'W-2s to each person and to the government; Wisconsin WT-7 reconciliation; IRS Form 940 (federal unemployment).'),
          h('li',null,h('b',null,'When someone leaves: '),'final pay by the next regular payday.'),
          h('li',null,h('b',null,'Keep: '),'time and pay records at least 4 years (IRS); Wisconsin requires 3.'))));
      v.append(card('Yearly figures in this screen', h('p',{class:'small muted'},'Social Security '+pct(RATES.ss)+' up to '+usd(RATES.ssBase)+', Medicare '+pct(RATES.med)+', FUTA '+pct(RATES.futa)+' of the first '+usd(RATES.futaBase)+', Wisconsin unemployment wage base '+usd(RATES.suiBase)+', minimum wage '+money(RATES.minWage)+'. Checked November 2026; they are in app/payroll.js (RATES) and change each January. Income tax withholding is not figured here: the payroll service uses the IRS and Wisconsin tables.')));
    });
  }


  // ---------- owner pay: draws and quarterly estimated tax ----------
  // A sole proprietor or single-member LLC owner can't be on payroll: they take draws (not a write-off) and pay
  // income tax plus self-employment tax (15.3% of 92.35% of profit; Social Security part stops at the wage base)
  // through quarterly estimates: federal 1040-ES and Wisconsin 1-ES. An S-corp owner instead needs a reasonable
  // W-2 salary through payroll (the Pay run tab).
  const DRAW = 'Owner draw or personal';
  const dueDates = y => [['Q1', y+'-04-15', 'Jan to Mar'], ['Q2', y+'-06-15', 'Apr and May'], ['Q3', y+'-09-15', 'Jun to Aug'], ['Q4', (y+1)+'-01-15', 'Sep to Dec']];
  const nextBizDay = iso => { let d = iso; for (;;){ const w = new Date(d+'T12:00:00').getDay(); if (w !== 0 && w !== 6) return d; d = addDays(d, 1); } };
  function ownerView(v){
    v.append(head('Owner · '+A.site().name, 'Owner pay', 'What you take out of the store, and the quarterly tax that goes with it.'), tabs('ownerpay'));
    if (ownerOnly(v)) return;
    const y = S().payYear || new Date().getFullYear(), ys = String(y), p = P();
    v.append(h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().payYear = y-1; A.save(); A.route(); }},'‹ '+(y-1)), h('b',null,ys),
      h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().payYear = y+1; A.save(); A.route(); }},(y+1)+' ›')));
    const st = p.settings, sal = salaryMode();
    const pick = (val, t, why) => h('label',{class:'checkrow'}, h('input',{type:'radio',name:'om',value:val,checked:st.ownerMode === val,onchange:()=>{ st.ownerMode = val; A.save(); A.route(); }}), h('span',null, h('b',null,t), h('br'), h('span',{class:'small muted'},why)));
    const sf = h('form',{class:'row'}, h('label',{class:'f'},'Your salary each pay period, before tax ($)', h('input',{type:'number',name:'s',step:'0.01',min:'0',value:String(st.ownerSalary || '')})), h('button',{class:'btn sm',type:'submit'},'Save salary'));
    sf.addEventListener('submit', e => { e.preventDefault(); st.ownerSalary = r2(+new FormData(sf).get('s') || 0); A.save(); toast('Saved'); A.route(); });
    v.append(card('How you get paid',
      pick('draws','Owner\'s draws (no salary)','Sole owner, single-member LLC or partnership. You are not on payroll. A draw is not a write-off and has no tax taken out; you pay income and self-employment tax on the whole profit through quarterly estimates.'),
      pick('salary','Salary through payroll','S-corp (or corporation) owner. You are on payroll like your staff, with taxes withheld. Your salary is a wage expense, so it lowers the profit; what you take beyond it is a distribution, not an expense.'),
      sal ? h('div',null, sf, h('p',{class:'small muted'},'The IRS expects a reasonable salary for the work you do before any distributions. Each pay run adds you with this amount. '+(st.anchor ? '' : 'Set up pay periods on the Pay run tab first.'))) : null,
      h('details',null, h('summary',null,'Not sure which you are? Ask your accountant'),
        h('ul',{class:'small'}, h('li',null,'Is the store a sole proprietorship, a single-member LLC, or an LLC taxed as an S-corp (Form 2553 filed)? Your last return shows it: Schedule C means sole owner; Form 1120-S means S-corp.'),
          h('li',null,'What should my four estimated payments be this year, federal and Wisconsin?'),
          h('li',null,'Does anyone I pay count as an employee (W-2) rather than a contractor (1099)? Employees need payroll; the Pay run tab handles them.'),
          h('li',null,'Would an S-corp election save me money at my profit level, after the cost of running payroll?')))));
    // draws
    const draws = (S().exp || []).filter(x => x.cat === DRAW && x.site === site() && String(x.date||'').startsWith(ys)).sort((a,b) => b.date.localeCompare(a.date));
    const drawn = r2(draws.reduce((a,x) => a + (+x.amt||0), 0));
    const df = h('form',{class:'row'}, h('label',{class:'f'},'Date', h('input',{type:'date',name:'d',value:today(),required:true})),
      h('label',{class:'f'},'Amount ($)', h('input',{type:'number',name:'a',step:'0.01',min:'0.01',required:true})),
      h('label',{class:'f'},'Note', h('input',{type:'text',name:'n',placeholder:'Transfer to personal checking'})), h('button',{class:'btn sm',type:'submit'},sal ? 'Add distribution' : 'Add draw'));
    df.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(df);
      (S().exp = S().exp || []).push({id:uid(), site:site(), date:String(d.get('d')), cat:DRAW, amt:r2(+d.get('a')), payee:'Owner', note:String(d.get('n')||'Owner draw'), status:'ok'}); A.save(); toast('Draw added'); A.route(); });
    v.append(card((sal ? 'Distributions in ' : 'Draws in ')+ys, h('p',null, h('b',null, money(drawn)), ' taken out in '+draws.length+(sal ? ' distribution' : ' draw')+(draws.length === 1 ? '' : 's')+'.'),
      draws.length ? h('ul',{class:'small'}, draws.slice(0,12).map(x => h('li',null, A.fmtDate(x.date)+': '+money(+x.amt)+(x.note ? ' · '+x.note : '')))) : null, df,
      h('p',{class:'small muted'},'Draws are saved in Expenses under "'+DRAW+'", which the Tax year screen leaves out of write-offs.')));
    // estimated tax
    const est = p.est.filter(x => x.y === y), paid = k => r2(est.filter(x => x.to === k).reduce((a,x) => a + x.amt, 0));
    const box = card('Quarterly estimated tax', h('p',{class:'small muted'},'Working it out from the Tax year screen…')); v.append(box);
    const fill = c => { box.lastChild.remove();
      const profit = c ? Math.max(0, c.profit) : 0, rate = c ? c.rate : 0.28, setAside = r2(profit * rate);
      const se = sal ? 0 : r2(Math.min(profit*0.9235, RATES.ssBase)*0.124 + profit*0.9235*0.029);
      const salYtd = r2(p.runs.filter(r => r.status === 'paid' && r.site === site() && r.payday.slice(0,4) === ys).reduce((a,r) => a + r.rows.filter(x => x.salaried).reduce((b,x) => b + x.gross, 0), 0));
      const tot = r2(paid('fed') + paid('wi')), owe = r2(Math.max(0, setAside - tot));
      box.append(sal ? h('p',null,'Your salary paid so far: '+money(salYtd)+' (tax already withheld through payroll). Profit after salary '+money(profit)+' passes to your personal return with no self-employment tax: set aside about '+money(setAside)+' at '+Math.round(rate*100)+'% (Tax year rate).')
          : h('p',null,'Profit so far '+money(profit)+' · set aside about '+money(setAside)+' at '+Math.round(rate*100)+'% (from Tax year) · of that, self-employment tax about '+money(se)+'.'),
        h('p',null, h('b',null,'Paid so far: '+money(tot)), ' (federal '+money(paid('fed'))+', Wisconsin '+money(paid('wi'))+') · ', h('b',null,'still to cover about '+money(owe))),
        h('ul',null, dueDates(y).map(([q, d, span]) => { const due = nextBizDay(d), got = est.filter(x => x.q === q);
          return h('li',null, h('b',null, q+' due '+A.fmtDate(due)), ' (profit earned '+span+')'+(got.length ? ': paid '+money(got.reduce((a,x) => a + x.amt, 0)) : due < today() ? ': nothing recorded' : '')); })),
        h('p',{class:'small muted'},'Pay federal at irs.gov/payments (Direct Pay or EFTPS, Form 1040-ES) and Wisconsin at revenue.wi.gov (My Tax Account, Form 1-ES). Federal estimates are needed when you expect to owe $1,000 or more for the year; Wisconsin when $500 or more. To avoid an underpayment penalty, pay at least 90% of this year\'s tax or 100% of last year\'s (110% if your income was over $150,000), in four equal parts. Your accountant can give you the four amounts.'));
      const ef = h('form',{class:'row'}, h('label',{class:'f'},'Paid on', h('input',{type:'date',name:'d',value:today(),required:true})),
        h('label',{class:'f'},'To', h('select',{name:'to'}, h('option',{value:'fed'},'IRS (1040-ES)'), h('option',{value:'wi'},'Wisconsin (1-ES)'))),
        h('label',{class:'f'},'For', h('select',{name:'q'}, dueDates(y).map(([q]) => h('option',{value:q},q)))),
        h('label',{class:'f'},'Amount ($)', h('input',{type:'number',name:'a',step:'0.01',min:'0.01',required:true})), h('button',{class:'btn sm',type:'submit'},'Record payment'));
      ef.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(ef);
        p.est.push({id:uid(), y, q:String(d.get('q')), to:String(d.get('to')), date:String(d.get('d')), amt:r2(+d.get('a'))}); A.save(); toast('Recorded'); A.route(); });
      box.append(ef); if (est.length) box.append(h('ul',{class:'small'}, est.slice().sort((a,b) => b.date.localeCompare(a.date)).map(x => h('li',null, A.fmtDate(x.date)+' · '+(x.to === 'fed' ? 'IRS' : 'Wisconsin')+' '+x.q+' · '+money(x.amt)+' ',
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ if (!confirm('Remove this payment record?')) return; p.est = p.est.filter(z => z !== x); A.save(); A.route(); }},'Remove')))));
  };
    (A.books && A.books.compute ? A.books.compute(y, 'all') : Promise.reject()).then(fill).catch(() => fill(null));
  }

  A.register({id:'payroll', name:'Payroll and owner pay', what:'Owner only. Owner\'s draws and quarterly estimated tax (1040-ES, Wisconsin 1-ES). Pay runs from the time clock with overtime by workweek, a file for Gusto or QuickBooks Payroll (they withhold and file the taxes), employer cost, paid runs in the books, and the new-hire paperwork and deadlines.', tiers:['owner'],
    views:{payroll:{t:'Payroll', ic:'💸', render:runView, min:'owner'}, ownerpay:{t:'Owner pay', ic:'🧑‍💼', render:ownerView, min:'owner'}, 'payrollpaid':{t:'Paid pay runs', ic:'🗂️', render:historyView, min:'owner', hidden:true},
      'payrollsetup':{t:'Payroll setup', ic:'🧾', render:setupView, min:'owner', hidden:true}}});

  // Home: the next payday and whether the last finished period still needs a pay run
  A.ownerHooks.push(v => { if (!isOwner()) return; ready().then(() => {
    const y = +today().slice(0,4), next = [...dueDates(y-1), ...dueDates(y)].map(([q, d]) => [q, nextBizDay(d)]).find(([, d]) => d >= today());
    if (next) v.append(card('Owner pay', h('p',null,'Next estimated tax payment ('+next[0]+'): '+A.fmtDate(next[1])+', federal and Wisconsin. ', h('a',{href:'#/ownerpay'},'Open'))));
    const st = P().settings; if (!st.anchor) return; // payroll for staff only once the owner sets up pay periods
    const last = periodOf(addDays(periodOf(today()).start, -1)), run = P().runs.find(r => r.site === site() && r.start === last.start);
    const due = payday(last), msg = run && run.status === 'paid' ? 'Last payroll is paid. Next payday '+A.fmtDate(payday(periodOf(today())))+'.'
      : run ? 'Pay run saved: send it to '+providerName()+' for payday '+A.fmtDate(due)+'.' : 'The pay period ended '+A.fmtDate(last.end)+'. Payday is '+A.fmtDate(due)+': save the pay run.';
    v.append(card('Payroll', h('p',null, msg+' ', h('a',{href:'#/payroll'},'Open'))));
  }); });
  const ownerWeekly = () => { if (!S().payroll || !salaryMode()) return 0; const st = P().settings, days = {weekly:7, biweekly:14, semimonthly:365/24, monthly:365/12}[st.freq] || 14;
    return r2((+st.ownerSalary || 0) * 7 / days * owners().length); };
  A.payroll = {ownerWeekly, mode:() => (S().payroll && S().payroll.settings && S().payroll.settings.ownerMode) || 'draws', periodOf, workweeks, figure, employerCost, byWeekCsv, totalsCsv, RATES};
})();
