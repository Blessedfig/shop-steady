// Downtown Stube app shell. Generic core lifted from the Steady Shift test app (app/app.js):
// tiny element builder, saved state, hash router, role ("View as") and store switchers, switchable modules,
// calendar/ICS/CSV/Teams/Google Chat helpers, and Supabase sign-in (password, emailed code, persistent session).
// Feature modules (inventory.js, and later schedule.js, time.js...) plug in through window.SSApp.
(function(){
  const D = window.APP_DATA;
  const $ = id => document.getElementById(id);

  // ---------- tiny element builder (never sets innerHTML from user text) ----------
  function h(tag, attrs, ...kids){
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs){
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat(9)){
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  const pad = n => String(n).padStart(2,'0');
  const isoDay = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  function addDays(s, n){ const d = new Date(s+'T12:00:00'); d.setDate(d.getDate()+n); return isoDay(d); }
  const fmtDate = s => { if(!s) return ''; const d = new Date(s.length === 10 ? s+'T12:00:00' : s); return isNaN(d) ? s : d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); };
  const fmtTime = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };
  const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  const uid = () => Math.random().toString(36).slice(2,9);
  function toast(msg){ const t = h('div',{class:'toast',role:'status'},msg); document.body.append(t); setTimeout(()=>t.remove(),2600); }
  function copy(text, btn){
    const done = () => { if(btn){ const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(()=>btn.textContent=o,1500);} else toast('Copied'); };
    try { navigator.clipboard.writeText(text).then(done, ()=>toast('Select the text and copy it')); } catch(e){ toast('Select the text and copy it'); }
  }
  function head(eyebrow, title, lede){ return h('div',{class:'head'}, h('span',{class:'eyebrow'},eyebrow), h('h1',null,title), lede ? h('p',{class:'muted'},lede) : null); }

  // ---------- saved state (this browser only; move to Supabase tables when ready) ----------
  const KEY = 'shop-steady-v1';
  const fresh = () => Object.assign(JSON.parse(JSON.stringify(D.SEED)), {tier:'owner', site:D.SITES[0].id, mods:{}, setup:{}});
  let S; try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch(e){ S = fresh(); }
  S.setup = S.setup || {};
  // save(true) stores on this device only; a plain save() also tells sync.js to send the change to the server.
  function save(localOnly){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} if (!localOnly && window.SSApp && window.SSApp.onSave) window.SSApp.onSave(); }
  // Setup per location: the owner's name for it, its business type and any renamed tiers.
  const setupOf = id => { const base = D.SITES.find(x => x.id === id) || D.SITES[0]; const o = S.setup[base.id] || {};
    return {id:base.id, name:o.name || base.name, type:(D.BUSINESS_TYPES[o.type] ? o.type : base.type) || 'retail', tiers:o.tiers || {}}; };
  const site = () => setupOf(S.site);
  const btype = () => D.BUSINESS_TYPES[site().type] || Object.values(D.BUSINESS_TYPES)[0];
  const tierName = id => (site().tiers[id] || (btype().tiers||{})[id] || (D.TIERS.find(t => t.id === id)||{}).name || id);
  const tier = () => { const t = D.TIERS.find(t => t.id === S.tier) || D.TIERS[0]; return {id:t.id, name:tierName(t.id)}; };

  // ---------- views, modules and role tiers ----------
  // VIEWS: id -> {t:title, ic:icon, mod:module id}. Modules switch on/off per store and per role (owner decides).
  const VIEWS = {home:{t:'Home', ic:'🏠'}}, R = {}, homeHooks = [], ownerHooks = [];
  // A view can also say min:'manager' (that role and up, whatever the module allows) and hidden:true (reached by link only).
  function register(mod){ // mod: {id, name, what, tiers:[...], views:{id:{t,ic,render,min,hidden}}}
    D.MODULES[mod.id] = D.MODULES[mod.id] || {name:mod.name, what:mod.what, tiers:mod.tiers};
    for (const v in mod.views){ const x = mod.views[v]; VIEWS[v] = {t:x.t, ic:x.ic, mod:mod.id, min:x.min, hidden:!!x.hidden}; R[v] = x.render; }
  }
  // A module starts on when the location's business type lists it (or lists no modules at all); the owner can change it.
  const modState = m => ((S.mods[S.site]||{})[m]) || {on:!btype().modules || btype().modules.includes(m), tiers:(D.MODULES[m]||{}).tiers || D.TIERS.map(t=>t.id)};
  const RANK = {staff:1, lead:2, manager:3, owner:4};
  const viewOn = v => { const m = VIEWS[v] && VIEWS[v].mod; if (!m) return true; if (VIEWS[v].min && (RANK[S.tier]||1) < RANK[VIEWS[v].min]) return false;
    const st = modState(m); return st.on && st.tiers.includes(S.tier); };
  const listed = v => viewOn(v) && !VIEWS[v].hidden;

  // The first level (Front desk) gets a simple app: a few big buttons, no side menu, no level switcher.
  const SIMPLE = [['checklists','✅','Today\'s checklist'],['till','💵','Cash drawer'],['pickup','🛍️','Customer pickup'],['checkin','📦','Check in a delivery'],
                  ['out','📝','We\'re out of…'],['custvoice','🗣️','A customer asked'],['teamvoice','💬','Message the owner'],['schedule','📅','My schedule and pay'],
                  ['ask','🙋','Ask a question'],['training','🎓','Training']];
  const simple = () => S.tier === 'staff';
  function simpleHome(v){
    const name = (window.SSApp.myName || '').split(/[ @]/)[0];
    v.append(h('h1',{class:'simplehi'}, name ? 'Hi, '+name : 'Hi!'));
    v.append(h('div',{class:'bigtiles'}, SIMPLE.filter(([k]) => VIEWS[k] && viewOn(k)).map(([k,ic,t]) => h('a',{class:'tile big',href:'#/'+k}, h('span',{class:'ic','aria-hidden':'true'},ic), h('b',null,t)))));
    if (VIEWS.kiosk && viewOn('kiosk')) v.append(h('p',{class:'small muted'},'Clock in and out on the store tablet.'));
  }
  R.home = v => {
    if (simple()) return simpleHome(v);
    v.append(head(site().name+' · '+btype().name, 'Good to see you', 'Pick what you need. Owners can turn modules on or off for each role under Modules.'));
    const g = h('div',{class:'grid g3'});
    Object.keys(VIEWS).filter(k => k !== 'home' && listed(k)).forEach(k => g.append(h('a',{class:'tile',href:'#/'+k}, h('span',{class:'ic','aria-hidden':'true'},VIEWS[k].ic), h('b',null,VIEWS[k].t))));
    v.append(g);
    homeHooks.forEach(f => { try { f(v); } catch(e){ console.error(e); } });
    if (S.tier === 'owner') ownerHooks.forEach(f => { try { f(v); } catch(e){ console.error(e); } });
  };
  VIEWS.modules = {t:'Modules', ic:'🧩'};
  R.modules = v => {
    v.append(head('Owner', 'Modules and who sees them', 'Sell or switch on each module separately, or as a bundle. Changes apply to this store.'));
    if (S.tier !== 'owner'){ v.append(h('div',{class:'card'},'Only the owner can change modules.')); return; }
    for (const m in D.MODULES){
      if (m === 'setup') continue; // always on for the owner
      const st = modState(m), card = h('div',{class:'card'}, h('h2',null,D.MODULES[m].name), h('p',{class:'small muted'},D.MODULES[m].what));
      const set = () => { S.mods[S.site] = S.mods[S.site] || {}; S.mods[S.site][m] = st; save(); renderNav(current); };
      card.append(h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:st.on,onchange:e=>{st.on = e.target.checked; set();}}), 'On for this store'));
      D.TIERS.forEach(t => card.append(h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:st.tiers.includes(t.id),onchange:e=>{st.tiers = e.target.checked ? [...new Set([...st.tiers,t.id])] : st.tiers.filter(x=>x!==t.id); set();}}), tierName(t.id))));
      v.append(card);
    }
  };

  function renderNav(view){
    const nav = $('nav'); nav.textContent = '';
    Object.keys(VIEWS).filter(listed).filter(k => k !== 'modules' || S.tier === 'owner')
      .forEach(k => nav.append(h('a',{href:'#/'+k,'aria-current':k===view?'page':null}, h('span',{class:'ic','aria-hidden':'true'},VIEWS[k].ic), VIEWS[k].t)));
  }
  function fillSwitchers(){
    const ts = $('tierSel'), ss = $('siteSel'); ts.textContent = ''; ss.textContent = '';
    D.TIERS.forEach(t => ts.append(h('option',{value:t.id,selected:t.id===S.tier},tierName(t.id))));
    D.SITES.forEach(s => ss.append(h('option',{value:s.id,selected:s.id===S.site},setupOf(s.id).name)));
  }
  $('tierSel').addEventListener('change', e => { S.tier = e.target.value; save(); go('home'); });
  $('siteSel').addEventListener('change', e => { S.site = e.target.value; save(); fillSwitchers(); route(); });
  let current = 'home', param = '';
  function go(v){ if (location.hash === '#/'+v) route(); else location.hash = '#/'+v; }
  // Nov 2026: the first level (Bookseller) became the basic one: store mode, checklists, schedule, own pay, Team voice.
  // Stock, receiving, customers and vendors, notes and tax records start at Shift lead. Owners who saved module
  // settings before that get the change once; they can still turn any module back on for the first level.
  const BASIC_OFF = ['count','inventory','notes','people','taxlog','receiving'];
  function basicTier(){
    if (!S.mods || S.mods._basic2 || (window.SSApp.myRole && window.SSApp.myRole !== 'owner')) return;
    for (const site in S.mods) if (site !== '_basic2' && S.mods[site]) BASIC_OFF.forEach(m => { const st = S.mods[site][m]; if (st && st.tiers) st.tiers = st.tiers.filter(t => t !== 'staff'); });
    S.mods._basic2 = true; save();
  }
  function route(){
    basicTier();
    const m = (location.hash||'').match(/^#\/([a-z]+)(?:\/(.*))?/);
    current = m && VIEWS[m[1]] && viewOn(m[1]) ? m[1] : 'home';
    param = m && m[2] ? decodeURIComponent(m[2]) : '';
    renderNav(current);
    const main = $('main'); main.textContent = '';
    document.body.classList.toggle('simple', simple());
    document.body.classList.toggle('stafflogin', window.SSApp.myRole === 'staff');
    const view = h('div',{class:'view'});
    if (simple() && current !== 'home') view.append(h('a',{class:'btn ghost sm backhome',href:'#/home'},'← Home'));
    (R[current] || R.home)(view); main.append(view);
    window.scrollTo(0,0);
  }
  window.addEventListener('hashchange', () => { if (!$('app').hidden) route(); });

  // ---------- calendar, spreadsheet and chat helpers (no customer details leave the app: title, role, link) ----------
  const TZ = D.TIMEZONE || 'America/Chicago';
  const appUrl = e => location.origin + location.pathname + (e.link || '');
  const compact = (date, time) => date.replace(/-/g,'') + (time ? 'T'+time.replace(':','')+'00' : '');
  function addMin(time, m){ const [hh,mm] = time.split(':').map(Number); const t = hh*60+mm+m; return pad(Math.floor(t/60)%24)+':'+pad(t%60); }
  function gcalUrl(e){
    const dates = e.time ? compact(e.date,e.time)+'/'+compact(e.date,addMin(e.time,e.dur||60)) : compact(e.date)+'/'+compact(addDays(e.date,1));
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(e.title)+'&dates='+dates+'&ctz='+encodeURIComponent(TZ)+'&details='+encodeURIComponent((e.note||'')+'\n\n'+appUrl(e));
  }
  function outlookUrl(e){
    const p = new URLSearchParams({path:'/calendar/action/compose', rru:'addevent', subject:e.title, body:(e.note||'')+'\n\n'+appUrl(e)});
    if (e.time){ p.set('startdt', e.date+'T'+e.time+':00'); p.set('enddt', e.date+'T'+addMin(e.time,e.dur||60)+':00'); }
    else { p.set('startdt', e.date); p.set('enddt', addDays(e.date,1)); p.set('allday','true'); }
    return 'https://outlook.office.com/calendar/0/deeplink/compose?'+p.toString();
  }
  const icsEsc = s => String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
  function icsFold(line){ const out = []; while (line.length > 74){ out.push(line.slice(0,74)); line = ' '+line.slice(74); } out.push(line); return out.join('\r\n'); }
  function toIcs(list){ // US Central time zone block; change TZID rules if the store is elsewhere
    const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
    const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Downtown Stube//App//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',
      'BEGIN:VTIMEZONE','TZID:'+TZ,'BEGIN:DAYLIGHT','TZOFFSETFROM:-0600','TZOFFSETTO:-0500','TZNAME:CDT','DTSTART:19700308T020000','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU','END:DAYLIGHT',
      'BEGIN:STANDARD','TZOFFSETFROM:-0500','TZOFFSETTO:-0600','TZNAME:CST','DTSTART:19701101T020000','RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU','END:STANDARD','END:VTIMEZONE'];
    list.forEach(e => {
      L.push('BEGIN:VEVENT','UID:'+e.id+'-'+e.date+'@shop-steady.app','DTSTAMP:'+stamp);
      if (e.time) L.push('DTSTART;TZID='+TZ+':'+compact(e.date,e.time),'DTEND;TZID='+TZ+':'+compact(e.date,addMin(e.time,e.dur||60)));
      else L.push('DTSTART;VALUE=DATE:'+compact(e.date),'DTEND;VALUE=DATE:'+compact(addDays(e.date,1)));
      L.push('SUMMARY:'+icsEsc(e.title),'DESCRIPTION:'+icsEsc((e.note||'')+'\n'+appUrl(e)),'URL:'+appUrl(e),'END:VEVENT');
    });
    L.push('END:VCALENDAR'); return L.map(icsFold).join('\r\n')+'\r\n';
  }
  const csvCell = s => { s = String(s==null?'':s); if (/^[=+\-@]/.test(s)) s = "'"+s; return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n')+'\r\n';
  function download(name, type, text){
    const a = h('a',{href:URL.createObjectURL(new Blob([text],{type})), download:name});
    document.body.append(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Downloaded '+name);
  }
  // Microsoft Teams: Workflows "Send webhook alerts to a channel" (old Office 365 connectors were retired). Google Chat: incoming webhook.
  const teamsPayload = e => ({type:'message', attachments:[{contentType:'application/vnd.microsoft.card.adaptive', content:{type:'AdaptiveCard', version:'1.4',
    body:[{type:'TextBlock', text:e.title, wrap:true, weight:'Bolder'},{type:'TextBlock', text:fmtDate(e.date)+(e.time?' · '+e.time:''), isSubtle:true},{type:'TextBlock', text:e.note||'', wrap:true}],
    actions:[{type:'Action.OpenUrl', title:'Open in the app', url:appUrl(e)}]}}]});
  const chatPayload = e => ({text:'*'+e.title+'*\n'+fmtDate(e.date)+(e.time?' · '+e.time:'')+'\n'+(e.note||'')+'\n<'+appUrl(e)+'|Open in the app>'});

  // The person doing something: who tapped in on the store tablet, else the signed-in person's name, else the level.
  const me = () => (S.kioskWho && Date.now() - S.kioskWho.at < 120000 && S.kioskWho.n) || (window.SSApp && window.SSApp.myName) || tier().name;
  window.SSApp = {D, h, me, state:()=>S, save, toast, copy, site, tier, btype, tierName, setupOf, fresh, fmtDate, fmtTime, money, head, download, toIcs, toCsv, gcalUrl, outlookUrl, csvCell,
    teamsPayload, chatPayload, R, VIEWS, register, viewOn, route:()=>route(), go, isoDay, addDays, uid, renderNav:()=>renderNav(current), fillSwitchers, param:()=>param, homeHooks, ownerHooks};

  // ---------- sign-in: password, emailed code fallback, persistent session, invite only ----------
  function gate(msg, err){ $('app').hidden = true; $('gate').hidden = false; const m = $('gateMsg'); m.textContent = msg||''; m.hidden = !msg; m.className = 'msg'+(err?' err':''); }
  const cfg = window.DESK_CONFIG || {};
  // Demo mode: no Supabase set up yet, or someone chose "Try the demo" (?demo in the address). Sample data only.
  let demo = /[?&]demo\b/.test(location.search); try { demo = demo || sessionStorage.getItem('shop-steady-demo') === '1'; } catch(e){}
  window.SSApp.demo = demo || !cfg.supabaseUrl || !window.supabase || /YOUR-PROJECT-REF/.test(cfg.supabaseUrl);
  $('demoBtn') && $('demoBtn').addEventListener('click', () => { try { sessionStorage.setItem('shop-steady-demo','1'); } catch(e){} location.reload(); });
  if (window.SSApp.demo){
    $('gate').hidden = true; $('app').hidden = false; $('whoEmail').textContent = 'Demo with sample data';
    document.addEventListener('DOMContentLoaded', () => { fillSwitchers(); route(); }); if (document.readyState !== 'loading'){ fillSwitchers(); route(); }
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {auth:{flowType:'implicit',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  window.SSApp.sb = sb;
  let user = null, how = '';
  const emailVal = () => $('email').value.trim().toLowerCase();
  $('pwForm').addEventListener('submit', async e => {
    e.preventDefault(); gate(''); how = 'password';
    const msg = window.SSPw ? await SSPw.signIn(sb, emailVal(), $('password').value) : 'Password sign-in is not available. Use the email code.';
    if (msg){ gate(msg, true); $('password').value = ''; }
  });
  $('sendBtn').addEventListener('click', async () => {
    const email = emailVal(); if (!email){ gate('Type your email above first.', true); return; }
    const {error} = await sb.auth.signInWithOtp({email, options:{shouldCreateUser:false, emailRedirectTo:location.origin+location.pathname}});
    if (error) return gate(/signups? not allowed|not found/i.test(error.message) ? 'That email is not set up yet. Ask the owner to add you.' : 'Could not send the email: '+error.message, true);
    gate('Check '+email+' for a sign-in email. Type the code below, or tap the link.'); $('codeForm').hidden = false; $('code').focus();
  });
  $('codeForm').addEventListener('submit', async e => {
    e.preventDefault(); how = 'code';
    const {error} = await sb.auth.verifyOtp({email:emailVal(), token:$('code').value.replace(/\D/g,''), type:'email'});
    if (error) gate('That code did not work or has expired. Send a new one.', true);
  });
  $('signOut').addEventListener('click', () => sb.auth.signOut());
  $('pwChange').addEventListener('click', () => { if (window.SSPw && user) SSPw.change(sb, user); });
  async function onSession(session){
    if (!session){ user = null; gate(''); return; }
    if (user && user.id === session.user.id) return;
    const r = await sb.rpc('is_desk_member');
    if (r.error || !r.data){ gate(r.error ? 'Could not check access. Try reloading.' : 'This email is not on the staff list yet. Ask the owner to add you.', true); await sb.auth.signOut(); return; }
    user = session.user;
    if (location.hash && /access_token|error/.test(location.hash)) history.replaceState(null,'',location.pathname+'#/home');
    $('whoEmail').textContent = user.email || ''; $('gate').hidden = true; $('app').hidden = false;
    if (window.SSApp.sync) try { await window.SSApp.sync.start(sb); } catch(e){ console.error(e); }
    fillSwitchers(); route();
    if (window.SSPw) SSPw.afterSignIn(sb, user, how);
  }
  (window.SSIdle ? SSIdle.guard(sb) : Promise.resolve()).then(() => {
    sb.auth.onAuthStateChange((_e, session) => setTimeout(() => onSession(session), 0));
    sb.auth.getSession().then(({data}) => onSession(data.session));
  });
})();
