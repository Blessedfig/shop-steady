// Shifts and staff: team list with pay rates and personal PINs, a weekly schedule, store mode (a shared tablet
// that stays signed in and opens to a PIN pad), time clock, daily checklists, and timesheets with overtime.
// Patterns from Steady Shift's schedule.js and time.js, rewritten small for shops (no care-home rules).
// Test version: everything lives in this browser. PINs are stored only as salted SHA-256 hashes.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, download, toCsv, isoDay, addDays, uid} = A;
  const S = () => A.state();
  const pad = n => String(n).padStart(2,'0');
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const tmin = t => { const [a,b] = String(t||'0:0').split(':').map(Number); return a*60+(b||0); };
  const tShort = t => { const m = tmin(t), hh = Math.floor(m/60), mm = m%60; return (hh%12||12)+(mm?':'+pad(mm):'')+(hh<12?'am':'pm'); };
  const shiftMin = s => { let d = tmin(s.end) - tmin(s.start); if (d <= 0) d += 1440; return d; };
  const hrs = m => Math.round(m/6)/10;
  const weekStart = iso => { const d = new Date(iso+'T12:00:00'); return addDays(iso, -d.getDay()); }; // workweek Sunday to Saturday
  const OT_WEEK = 40; // federal FLSA and Wisconsin: 1.5x pay after 40 hours in a workweek
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier);

  // ---------- sample team and checklists, by business type ----------
  const CHECKLISTS = {
    bookstore: {open:['Count the cash drawer and note the starting amount','Lights, music and open sign on','Check the special-order and holds shelf','Straighten the front tables and new releases','Check messages and online orders'],
                close:['Count the drawer and fill in the cash sheet','Reshelve books left out','Note anything sold out for reordering','Tidy the register area','Lights off, doors locked, alarm set']},
    retail:    {open:['Count the cash drawer','Lights, music and open sign on','Walk the floor and face the shelves','Check online orders and holds'],
                close:['Count the drawer and fill in the cash sheet','Note low stock for reordering','Tidy the floor and fitting area','Lights off, doors locked, alarm set']},
    cafe:      {open:['Count the cash drawer','Turn on and check equipment temperatures','Prep and date-label today\'s items','Restock cups, lids and napkins'],
                close:['Count the drawer','Clean and sanitize all surfaces and equipment','Log waste and low supplies','Lights off, doors locked']},
    services:  {open:['Check today\'s bookings and arrivals','Confirm rooms or spaces are ready','Check messages and reviews'],
                close:['Note supplies that are running low','Report anything that needs repair','Confirm tomorrow\'s arrivals have their instructions']}
  };
  const SEED_TEAM = {
    main:  [{n:'Alex (sample)', tier:'staff', rate:13.00, pin:'1111'}, {n:'Sam (sample)', tier:'staff', rate:13.50, pin:'2222'},
            {n:'Jordan (sample)', tier:'manager', rate:17.00, pin:'3333'}, {n:'Owner', tier:'owner', rate:0, pin:'9999'}],
    stays: [{n:'Riley (sample)', tier:'staff', rate:15.00, pin:'4444'}, {n:'Owner', tier:'owner', rate:0, pin:'9999'}]
  };
  async function hashPin(site, pin){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shop-steady:'+site+':'+pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  function seedShifts(site, team){
    const out = [], w0 = weekStart(isoDay(new Date()));
    const people = team.filter(p => p.tier !== 'owner');
    for (let w = -1; w <= 1; w++) for (let i = 2; i <= 6; i++){ // Tuesday to Saturday, like a typical small shop
      const date = addDays(w0, w*7+i);
      if (site === 'main'){
        out.push({id:uid(), date, start:'10:00', end:'15:00', who:people[i%2].n});
        out.push({id:uid(), date, start:'14:00', end:'19:00', who:people[(i+1)%2].n});
        if (i === 6) out.push({id:uid(), date, start:'10:00', end:'18:00', who:people[2].n});
      } else if (i === 3 || i === 6) out.push({id:uid(), date, start:'11:00', end:'14:00', who:people[0].n});
    }
    return out;
  }
  let ready = null;
  function ensure(){ // builds the sample team once per browser; PINs are hashed before saving
    const s = S();
    if (s.shifts && s.shifts.v === 1) return Promise.resolve(s.shifts);
    if (ready) return ready;
    ready = (async () => {
      const team = {}, sched = {};
      for (const site in SEED_TEAM){
        team[site] = [];
        for (const p of SEED_TEAM[site]) team[site].push({id:uid(), n:p.n, tier:p.tier, rate:p.rate, pinHash:await hashPin(site, p.pin)});
        sched[site] = seedShifts(site, SEED_TEAM[site]);
      }
      s.shifts = {v:1, team, sched, punches:{}, checks:{}, lists:{}, published:{}};
      A.save(); ready = null; return s.shifts;
    })();
    return ready;
  }
  const X = () => S().shifts;
  const team = () => (X().team[S().site] = X().team[S().site] || []);
  const sched = () => (X().sched[S().site] = X().sched[S().site] || []);
  const punches = () => (X().punches[S().site] = X().punches[S().site] || []);
  const lists = () => X().lists[S().site] || CHECKLISTS[A.site().type] || CHECKLISTS.retail;
  const person = n => team().find(p => p.n === n);
  const whoAmI = () => { // in the test version, "View as" picks a sample person of that tier
    const t = team().find(p => p.tier === S().tier) || team()[0]; return t ? t.n : '';
  };
  const openPunch = n => punches().find(p => p.who === n && !p.out);

  // ---------- hours and pay ----------
  function weekHours(site, wk){ // worked minutes per person for the week starting wk, from time clock punches
    const end = addDays(wk, 7), byWho = {};
    (X().punches[site]||[]).forEach(p => {
      const d = p.in.slice(0,10); if (d < wk || d >= end) return;
      const outAt = p.out ? new Date(p.out) : new Date();
      const m = Math.max(0, Math.round((outAt - new Date(p.in))/60000) - (p.brk||0));
      byWho[p.who] = (byWho[p.who]||0) + m;
    });
    return byWho;
  }
  function payFor(rate, minutes){
    const reg = Math.min(minutes, OT_WEEK*60), ot = Math.max(0, minutes - OT_WEEK*60);
    return {reg, ot, pay:+(rate*reg/60 + rate*1.5*ot/60).toFixed(2)};
  }

  // ---------- schedule (week view) ----------
  function schedule(v){
    v.append(head('Shifts · '+A.site().name, 'Schedule', isMgr() ? 'Plan the week. Staff see their own shifts on their phones.' : 'Your upcoming shifts.'));
    ensure().then(() => {
      const wk = S().schedWeek || weekStart(isoDay(new Date()));
      const days = [...Array(7)].map((_,i) => addDays(wk, i));
      const nav = h('div',{class:'row'},
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().schedWeek = addDays(wk,-7); A.save(); A.route(); }},'‹ Last week'),
        h('b',null,'Week of '+A.fmtDate(wk)),
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().schedWeek = addDays(wk,7); A.save(); A.route(); }},'Next week ›'));
      v.append(nav);
      const mine = isMgr() ? null : whoAmI();
      const grid = h('div',{class:'grid g3'});
      days.forEach(d => {
        const list = sched().filter(s => s.date === d && (!mine || s.who === mine)).sort((a,b) => a.start.localeCompare(b.start));
        const day = new Date(d+'T12:00:00');
        grid.append(h('div',{class:'card'}, h('h3',null, DOW[day.getDay()]+' '+A.fmtDate(d)),
          list.length ? h('div',{class:'list'}, list.map(s => h('div',{class:'item'},
            h('b',null, s.who || 'Open shift'), h('span',{class:'small muted'}, tShort(s.start)+' to '+tShort(s.end)+' · '+hrs(shiftMin(s))+' h'),
            isMgr() ? h('div',{class:'row'}, h('button',{class:'linkbtn',type:'button',onclick:()=>{ X().sched[S().site] = sched().filter(x => x.id !== s.id); A.save(); A.route(); }},'Remove')) : null)))
            : h('p',{class:'small muted'}, mine ? 'Not scheduled' : 'No shifts')));
      });
      v.append(grid);
      if (!isMgr()) return;
      // add a shift
      const f = h('form',{class:'card grid'}, h('h2',null,'Add a shift'),
        h('label',{class:'f'},'Day', h('select',{name:'date'}, days.map(d => h('option',{value:d}, DOW[new Date(d+'T12:00:00').getDay()]+' '+A.fmtDate(d))))),
        h('label',{class:'f'},'Start', h('input',{type:'time',name:'start',value:'10:00',required:true})),
        h('label',{class:'f'},'End', h('input',{type:'time',name:'end',value:'15:00',required:true})),
        h('label',{class:'f'},'Who', h('select',{name:'who'}, h('option',{value:''},'Open shift (anyone can pick it up)'), team().filter(p=>p.tier!=='owner').map(p => h('option',{value:p.n},p.n)))),
        h('button',{class:'btn',type:'submit'},'Add shift'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f);
        sched().push({id:uid(), date:d.get('date'), start:d.get('start'), end:d.get('end'), who:d.get('who')||null}); A.save(); toast('Shift added'); A.route(); });
      v.append(f);
      // week totals against overtime
      const planned = {}; sched().filter(s => s.date >= wk && s.date < addDays(wk,7) && s.who).forEach(s => planned[s.who] = (planned[s.who]||0) + shiftMin(s));
      v.append(h('div',{class:'card'}, h('h2',null,'Planned hours this week'),
        Object.keys(planned).length ? h('ul',null, Object.entries(planned).map(([n,m]) => h('li',null, n+': '+hrs(m)+' h', m > OT_WEEK*60 ? h('span',{class:'chip amber'},'over 40 h: overtime') : null))) : h('p',{class:'muted'},'Nothing planned yet.'),
        h('div',{class:'row'},
          h('button',{class:'btn ghost sm',type:'button',onclick:()=>{ // copy last week's shifts into this week
            const prev = sched().filter(s => s.date >= addDays(wk,-7) && s.date < wk);
            if (!prev.length) return toast('Last week has no shifts to copy');
            prev.forEach(s => sched().push(Object.assign({}, s, {id:uid(), date:addDays(s.date,7)}))); A.save(); toast('Copied '+prev.length+' shifts'); A.route(); }},'Copy last week'),
          h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('schedule-'+wk+'.ics','text/calendar', A.toIcs(sched().filter(s => s.date >= wk && s.date < addDays(wk,7)).map(s => ({id:s.id, date:s.date, time:s.start, dur:shiftMin(s), title:(s.who||'Open shift')+' · '+A.site().name, note:'Shift', link:'#/schedule'}))))},'Add week to calendars (.ics)'))));
    });
  }

  // ---------- team: people, pay rates, PINs ----------
  function teamView(v){
    v.append(head('People · '+A.site().name, 'Team, pay and PINs', 'Each person gets a 4 to 6 digit PIN for the store tablet. Only managers and owners see pay.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only managers and owners can change the team.')); return; }
    ensure().then(() => {
      v.append(h('div',{class:'card'}, h('h2',null,'Team'), h('div',{class:'list'}, team().map(p => h('div',{class:'item'},
        h('b',null,p.n), h('span',{class:'small muted'}, A.tierName(p.tier)+(p.rate ? ' · '+money(p.rate)+'/h' : '')),
        h('div',{class:'row'},
          h('button',{class:'btn quiet sm',type:'button',onclick:async ()=>{ const pin = prompt('New PIN for '+p.n+' (4 to 6 digits)'); if (!pin) return;
            if (!/^\d{4,6}$/.test(pin)) return toast('Use 4 to 6 digits');
            const hsh = await hashPin(S().site, pin); if (team().some(x => x !== p && x.pinHash === hsh)) return toast('Someone already has that PIN');
            p.pinHash = hsh; A.save(); toast('PIN changed'); }},'Change PIN'),
          p.tier !== 'owner' ? h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ const r = prompt('Hourly pay for '+p.n, String(p.rate||'')); if (r == null) return; const n = parseFloat(r); if (!(n >= 0)) return toast('Type a number'); p.rate = n; A.save(); A.route(); }},'Change pay') : null))))));
      const f = h('form',{class:'card grid'}, h('h2',null,'Add someone'),
        h('label',{class:'f'},'Name', h('input',{type:'text',name:'n',maxlength:'40',required:true})),
        h('label',{class:'f'},'Role', h('select',{name:'tier'}, A.D.TIERS.map(t => h('option',{value:t.id},A.tierName(t.id))))),
        h('label',{class:'f'},'Hourly pay ($)', h('input',{type:'number',name:'rate',step:'0.25',min:'0'})),
        h('label',{class:'f'},'PIN (4 to 6 digits)', h('input',{type:'password',name:'pin',inputmode:'numeric',pattern:'\\d{4,6}',autocomplete:'off',required:true})),
        h('button',{class:'btn',type:'submit'},'Add to team'));
      f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f);
        const hsh = await hashPin(S().site, d.get('pin')); if (team().some(x => x.pinHash === hsh)) return toast('Someone already has that PIN');
        team().push({id:uid(), n:String(d.get('n')).trim(), tier:d.get('tier'), rate:+d.get('rate')||0, pinHash:hsh}); A.save(); toast('Added'); A.route(); });
      v.append(f);
    });
  }

  // ---------- store mode: shared tablet, PIN pad, clock in and out, checklist ----------
  function setKiosk(on){ try { on ? localStorage.setItem('shop-steady-kiosk', S().site) : localStorage.removeItem('shop-steady-kiosk'); } catch(e){} document.body.classList.toggle('kiosk', !!on); }
  const kioskOn = () => { try { return !!localStorage.getItem('shop-steady-kiosk'); } catch(e){ return false; } };
  function pinPad(onDone, label){
    let val = '';
    const out = h('div',{class:'pinout','aria-live':'polite'}, '');
    const show = () => { out.textContent = val ? '•'.repeat(val.length) : label; };
    const press = k => { if (k === 'clear') val = ''; else if (k === 'ok'){ const x = val; val = ''; show(); return onDone(x); } else if (val.length < 6) val += k; show(); };
    show();
    const keys = ['1','2','3','4','5','6','7','8','9','clear','0','ok'];
    return h('div',{class:'pinpad'}, out, h('div',{class:'pinkeys'}, keys.map(k => h('button',{class:'btn '+(k==='ok'?'':'ghost'),type:'button','aria-label':k==='clear'?'Clear':k==='ok'?'Enter':k,onclick:()=>press(k)}, k==='clear'?'Clear':k==='ok'?'Enter':k))));
  }
  function today(){ return isoDay(new Date()); }
  function checklistCard(who){
    const d = today(), key = S().site+':'+d, done = (X().checks[key] = X().checks[key] || {});
    const L = lists(), card = h('div',{class:'card'}, h('h2',null,'Today\'s checklist'));
    [['open','Opening'],['close','Closing']].forEach(([k,name]) => {
      card.append(h('h3',null,name));
      L[k].forEach((task,i) => { const id = k+i, c = done[id];
        card.append(h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:!!c,onchange:e=>{ if (e.target.checked) done[id] = {by:who, at:new Date().toISOString()}; else delete done[id]; A.save(); A.route(); }}),
          h('span',null, task, c ? h('span',{class:'small muted'},' · '+c.by.replace(' (sample)','')+' '+A.fmtTime(c.at)) : null))); });
    });
    return card;
  }
  function kiosk(v){
    setKiosk(true);
    v.append(head('Store mode · '+A.site().name, 'Tap in with your PIN', 'Clock in or out and see today\'s checklist. This screen stays open, and reopens here after a restart.'));
    ensure().then(() => {
      const who = S().kioskWho && Date.now() - S().kioskWho.at < 120000 ? S().kioskWho.n : null; // a tapped-in person stays for 2 minutes
      if (!who){
        v.append(h('div',{class:'card kioskcard'}, pinPad(async pin => {
          const hsh = await hashPin(S().site, pin), p = team().find(x => x.pinHash === hsh);
          if (!p) return toast('That PIN did not match. Try again.');
          S().kioskWho = {n:p.n, at:Date.now()}; A.save(); A.route();
        }, 'Enter your PIN')));
        if (A.demo) v.append(h('p',{class:'small muted'},'Sample PINs: 1111 or 2222 staff, 3333 manager, 9999 owner.'));
        return;
      }
      setTimeout(() => { if (/^#\/kiosk/.test(location.hash)) A.route(); }, 121000); // back to the PIN pad
      const p = person(who), open = openPunch(who);
      const sch = sched().filter(s => s.date === today() && s.who === who);
      const card = h('div',{class:'card kioskcard'}, h('h2',null,'Hi, '+who.replace(' (sample)','')),
        h('p',null, open ? 'Clocked in since '+A.fmtTime(open.in)+'.' : 'You are clocked out.'),
        sch.length ? h('p',{class:'small muted'},'Scheduled today: '+sch.map(s => tShort(s.start)+' to '+tShort(s.end)).join(', ')) : null,
        h('div',{class:'row'},
          open ? h('button',{class:'btn',type:'button',onclick:()=>{ open.out = new Date().toISOString(); A.save(); toast('Clocked out. Thanks!'); S().kioskWho = null; A.save(); A.route(); }},'Clock out')
               : h('button',{class:'btn',type:'button',onclick:()=>{ punches().push({id:uid(), who, in:new Date().toISOString(), out:null, brk:0}); A.save(); toast('Clocked in'); A.route(); }},'Clock in'),
          open ? h('button',{class:'btn ghost',type:'button',onclick:()=>{ open.brk = (open.brk||0) + 30; A.save(); toast('30-minute unpaid break added'); A.route(); }},'Add 30 min break') : null,
          h('button',{class:'btn quiet',type:'button',onclick:()=>{ S().kioskWho = null; A.save(); A.route(); }},'Done')));
      v.append(card, checklistCard(who));
      if (p && MGR.includes(p.tier)) v.append(h('div',{class:'card soft'}, h('b',null,'Manager options'),
        h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>{ setKiosk(false); S().kioskWho = null; A.save(); A.go('home'); }},'Leave store mode on this device'))));
    });
  }

  // ---------- timesheets (managers): hours, overtime, pay estimate, payroll CSV ----------
  function timesheets(v){
    v.append(head('Pay · '+A.site().name, 'Timesheets', 'Hours from the time clock, overtime after 40 hours a week, and a pay estimate before taxes.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only managers and owners see timesheets.')); return; }
    ensure().then(() => {
      const wk = S().tsWeek || weekStart(today()), byWho = weekHours(S().site, wk);
      v.append(h('div',{class:'row'},
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().tsWeek = addDays(wk,-7); A.save(); A.route(); }},'‹ Last week'),
        h('b',null,'Week of '+A.fmtDate(wk)),
        h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ S().tsWeek = addDays(wk,7); A.save(); A.route(); }},'Next week ›')));
      const rows = team().filter(p => p.tier !== 'owner').map(p => { const m = byWho[p.n]||0, x = payFor(p.rate||0, m); return {p, m, x}; });
      const tb = h('tbody');
      rows.forEach(r => tb.append(h('tr',null, h('td',null,r.p.n), h('td',null,hrs(r.x.reg)+' h'),
        h('td',null, r.x.ot ? h('span',{class:'chip amber'}, hrs(r.x.ot)+' h') : '0'), h('td',null,money(r.p.rate||0)), h('td',null,money(r.x.pay)))));
      const total = rows.reduce((t,r) => t + r.x.pay, 0);
      v.append(h('div',{class:'card'},
        h('div',{class:'tablewrap',tabindex:'0',role:'region','aria-label':'Timesheet'},
          h('table',{class:'t'}, h('thead',null,h('tr',null,h('th',null,'Person'),h('th',null,'Regular'),h('th',null,'Overtime'),h('th',null,'Rate'),h('th',null,'Pay before taxes'))), tb)),
        h('p',null, h('b',null,'Total: '+money(total)), h('span',{class:'small muted'},' Employer payroll taxes add roughly 8 to 10% on top (Social Security, Medicare, unemployment). The hiring planner will break this down.')),
        h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('payroll-'+wk+'.csv','text/csv',
          toCsv([['Week starting','Name','Regular hours','Overtime hours','Rate','Gross pay'], ...rows.map(r => [wk, r.p.n, hrs(r.x.reg), hrs(r.x.ot), (r.p.rate||0).toFixed(2), r.x.pay.toFixed(2)])]))},'Download for payroll (.csv)'))));
      const recent = punches().filter(p => p.in.slice(0,10) >= wk && p.in.slice(0,10) < addDays(wk,7)).sort((a,b) => b.in.localeCompare(a.in));
      v.append(h('div',{class:'card'}, h('h2',null,'Clock-ins this week'),
        recent.length ? h('div',{class:'list'}, recent.map(p => h('div',{class:'item'}, h('b',null,p.who), h('span',{class:'small muted'}, A.fmtTime(p.in)+' to '+(p.out ? A.fmtTime(p.out) : 'still clocked in')+(p.brk ? ' · '+p.brk+' min break' : ''))))) : h('p',{class:'muted'},'No one has clocked in this week. Try Store mode.')));
    });
  }

  // ---------- checklists editor (managers) ----------
  function checklists(v){
    v.append(head('Daily · '+A.site().name, 'Checklists', 'Opening and closing steps your team ticks off in store mode. One step per line.'));
    ensure().then(() => {
      if (!isMgr()){ v.append(checklistCard(whoAmI())); return; }
      const L = lists();
      const f = h('form',{class:'card grid'},
        h('label',{class:'f'},'Opening steps', h('textarea',{name:'open',rows:'6'}, L.open.join('\n'))),
        h('label',{class:'f'},'Closing steps', h('textarea',{name:'close',rows:'6'}, L.close.join('\n'))),
        h('button',{class:'btn',type:'submit'},'Save checklists'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), split = s => String(s).split('\n').map(x => x.trim()).filter(Boolean);
        X().lists[S().site] = {open:split(d.get('open')), close:split(d.get('close'))}; A.save(); toast('Saved'); A.route(); });
      v.append(f, checklistCard(whoAmI()));
    });
  }

  A.register({id:'shifts', name:'Shifts and time clock', what:'Weekly schedule, store-mode tablet with PINs, clock in and out, timesheets with overtime and a payroll export.', tiers:['staff','lead','manager','owner'],
    views:{schedule:{t:'Schedule', ic:'📅', render:schedule}, kiosk:{t:'Store mode', ic:'🔢', render:kiosk},
           checklists:{t:'Checklists', ic:'✅', render:checklists}, team:{t:'Team', ic:'👥', render:teamView}, timesheets:{t:'Timesheets', ic:'⏱️', render:timesheets}}});
  // Owner card on Home: who is clocked in right now and this week's labor estimate
  A.ownerHooks.push(v => { ensure().then(() => {
    const on = punches().filter(p => !p.out), wk = weekStart(today()), byWho = weekHours(S().site, wk);
    const cost = team().reduce((t,p) => t + payFor(p.rate||0, byWho[p.n]||0).pay, 0);
    v.append(h('div',{class:'card'}, h('h2',null,'Staff right now'),
      h('p',null, on.length ? 'Clocked in: '+on.map(p => p.who).join(', ') : 'Nobody is clocked in.'),
      h('p',{class:'small muted'},'Labor so far this week: '+money(cost)+' before taxes.')));
  }); });
  // A device left in store mode opens straight to the PIN pad, even after a restart.
  if (kioskOn()){ try { const ks = localStorage.getItem('shop-steady-kiosk'); if (A.D.SITES.some(x => x.id === ks)){ S().site = ks; A.save(); } } catch(e){}
    document.body.classList.add('kiosk'); if (!/^#\/kiosk/.test(location.hash)) location.replace('#/kiosk'); }
  window.SSShifts = {ensure, weekHours, payFor, hashPin};
})();
