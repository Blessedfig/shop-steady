// The five areas: how shift leads, managers and the owner find things. (Front desk keeps its own big-button home.)
// Laws of UX behind it: few choices at the top (Hick's law), related screens chunked together, detail only after a tap
// (progressive disclosure), and one headline number per area so you can tell at a glance if you need to go in.
//
//   Today   what needs you now, and the shift's everyday jobs
//   Money   how the week went, books and taxes, loans and owner pay, cash
//   People  schedule and time clock, pay, training and HR files, what the team says
//   Stock   shelves and counts, ordering and receiving, vendors, the online store
//   Grow    customers and community, plans, decisions, opportunities and "what if"
//   Settings (owner) store setup, modules, logins
//
// Where a screen goes: AREA_OF below, or the screen says it itself in SSApp.register (views:{x:{..., area:'stock', group:'Ordering'}}).
// A screen nobody placed yet shows under its module's area, else under Grow > More, so it never disappears.
// A Home card (ownerHooks / homeHooks) shows on the area of the module that added it; MOD_AREA overrides that.
// Headline numbers: SSAreas.headline(area, () => ({n:'12', label:'to reorder', sub:'…'})) replaces the default one.
// Things that need you: SSAreas.needs.push(() => [{t:'3 shipments to check in', href:'#/receiving', area:'stock'}]).
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, money, isoDay, addDays, VIEWS, R} = A;
  const S = () => A.state();

  const AREAS = [
    {id:'home',   t:'Today',  ic:'☀️', what:'What needs you now'},
    {id:'money',  t:'Money',  ic:'💰', what:'How the week went, books, taxes, loans and owner pay'},
    {id:'people', t:'People', ic:'👥', what:'Schedule, time clock, pay, training and HR files'},
    {id:'stock',  t:'Stock',  ic:'📚', what:'Shelves, counts, ordering, receiving and vendors'},
    {id:'grow',   t:'Grow',   ic:'🌱', what:'Customers, plans, decisions and opportunities'},
    {id:'settings', t:'Settings', ic:'⚙️', what:'Store setup, modules and logins', owner:true}
  ];
  // Group order inside each area. Screens listed here that are not built yet (open pull requests) are simply skipped.
  const GROUPS = {
    home:   {'Run the shift':['checklists','kiosk','till','pickup','checkin','out'], 'Write it down':['notes','ask']},
    money:  {'How it\'s going':['week','yearend'], 'Books and taxes':['books','taxsum','taxlog','expenses','mileage','equipment','records','importrec'],
             'Loans and owner pay':['loans','ownerpay'], 'Cash':['safe']},
    people: {'Schedule and time clock':['schedule','timesheets','team'], 'Pay':['payroll','payrollpaid','payrollsetup'],
             'Training and files':['training','hr'], 'Hear from the team':['teamvoice','voicesum']},
    stock:  {'Shelves':['inventory','count','shopify','productfix','onlinestore'], 'Ordering':['titles','orders','catalogs','pricing','receiving'],
             'Vendors':['vendors','vendorsetup']},
    grow:   {'Customers and community':['customers','custvoice','events','impact'], 'Plans':['decide','ripple','opps'], 'More':[]},
    settings: {'This store':['setup','modules','logins']}
  };
  // Screens reached by link only, so the right area lights up and the back link goes there.
  const HIDDEN_AREA = {shipment:'stock', decision:'grow', hrfile:'people', purchases:'money', course:'people', courseedit:'people', cashtrain:'home', opp:'grow'};
  // Home cards whose module lives elsewhere but belong on Today ("this week's money in one line", who's working, the drawer).
  const MOD_AREA = {weekly:'home', shifts:'home', till:'home', frontdesk:'home'};
  // Screens their module reaches by link only, worth a tile of their own in an area.
  const PROMOTE = ['loans','equipment'];

  const AREA_OF = {}; const GROUP_OF = {};
  for (const a in GROUPS) for (const g in GROUPS[a]) GROUPS[a][g].forEach(v => { AREA_OF[v] = a; GROUP_OF[v] = g; });
  const areaOf = v => (VIEWS[v] && VIEWS[v].area) || AREA_OF[v] || HIDDEN_AREA[v] || modArea(VIEWS[v] && VIEWS[v].mod) || 'grow';
  const groupOf = v => (VIEWS[v] && VIEWS[v].group) || GROUP_OF[v] || 'More';
  // A module's area is where its first placed screen sits.
  function modArea(m){ if (!m) return null; for (const k in VIEWS) if (VIEWS[k].mod === m && (VIEWS[k].area || AREA_OF[k])) return VIEWS[k].area || AREA_OF[k]; return null; }
  const isOwner = () => S().tier === 'owner';
  const isMgr = () => A.RANK[S().tier] >= A.RANK.manager;

  // Screens in an area this person can open, grouped in order.
  function screens(area){
    const out = {}; Object.keys(GROUPS[area] || {}).forEach(g => out[g] = []);
    const order = k => { const g = GROUPS[area] && GROUPS[area][groupOf(k)]; const i = g ? g.indexOf(k) : -1; return i < 0 ? 99 : i; };
    Object.keys(VIEWS).filter(k => k !== 'home' && !AREAS.some(a => a.id === k) && (A.listed(k) || (PROMOTE.includes(k) && A.viewOn(k))) && areaOf(k) === area)
      .filter(k => k !== 'modules' || isOwner())
      .sort((a,b) => order(a) - order(b)).forEach(k => (out[groupOf(k)] = out[groupOf(k)] || []).push(k));
    for (const g in out) if (!out[g].length) delete out[g];
    return out;
  }
  const count = area => Object.values(screens(area)).reduce((n, l) => n + l.length, 0);
  const visibleAreas = () => AREAS.filter(a => a.id === 'home' || (a.owner ? isOwner() : count(a.id) > 0));

  // ---------- headline numbers (one per area) ----------
  const HEAD = {};
  const site = () => S().site;
  const inv = () => (S().inv && S().inv[site()]) || [];
  const thisMonth = () => isoDay(new Date()).slice(0,7);
  function needsList(){
    const out = [];
    SSAreas.needs.forEach(f => { try { (f() || []).forEach(x => out.push(x)); } catch(e){ console.error(e); } });
    return out.filter(x => !x.href || A.listed((x.href.match(/^#\/([a-z]+)/) || [])[1]));
  }
  HEAD.home = () => { const n = needsList().length; return {n:String(n), label: n === 1 ? 'thing needs you' : 'things need you', sub: n ? 'Tap one to go straight there.' : 'Nothing waiting. Have a good shift.'}; };
  HEAD.money = () => { const ex = (S().exp || []).filter(x => x.site === site() && String(x.date).startsWith(thisMonth())).reduce((t,x) => t + (+x.amt || 0), 0);
    return {n:'$'+Math.round(ex).toLocaleString(), label:'spent this month', sub:'From the expenses logged for this store.'}; };
  HEAD.people = () => { const x = S().shifts || {}, on = ((x.punches && x.punches[site()]) || []).filter(p => !p.out).length;
    let hrs = 0; try { const d = new Date(); const wk = addDays(isoDay(d), -d.getDay()); const by = window.SSShifts ? window.SSShifts.weekHours(site(), wk) : {}; hrs = Object.values(by).reduce((t,v) => t + (+v || 0), 0); } catch(e){}
    return {n:String(on), label: on === 1 ? 'person on the clock' : 'people on the clock', sub: Math.round(hrs*10)/10+' hours worked this week so far.'}; };
  HEAD.stock = () => { const low = inv().filter(i => (i.min || 0) > 0 && (i.have || 0) < i.min).length, val = inv().reduce((t,i) => t + (i.have||0) * (i.cost||0), 0);
    return {n:String(low), label: low === 1 ? 'item to reorder' : 'items to reorder', sub:'Stock on hand is worth '+money(val)+' at cost.'}; };
  HEAD.grow = () => { const ds = (S().decisions || []).filter(x => x.site === site()), open = ds.filter(x => x.status !== 'decided' && x.status !== 'done').length;
    const asked = ((S().voice && S().voice.cust) || []).filter(x => x.site === site() && x.kind === 'asked' && x.at >= addDays(isoDay(new Date()), -30)).length;
    return {n:String(open), label: open === 1 ? 'decision in the works' : 'decisions in the works', sub: asked+' customer request'+(asked === 1 ? '' : 's')+' for things we don\'t carry in the last 30 days.'}; };
  HEAD.settings = () => ({n:A.site().name, label:'', sub:A.btype().name});

  // ---------- things that need you (Today) ----------
  const needs = [];
  needs.push(() => { const n = inv().filter(i => (i.min || 0) > 0 && (i.have || 0) < i.min).length; return n ? [{t:n+' item'+(n>1?'s':'')+' below the reorder point', href:'#/inventory', area:'stock'}] : []; });
  needs.push(() => { const n = (S().requests || []).filter(r => r.site === site() && r.status === 'open').length; return n ? [{t:n+' "we\'re out of" note'+(n>1?'s':'')+' from the counter', href:'#/out', area:'stock'}] : []; });
  needs.push(() => { const n = (S().receiving || []).filter(x => x.site === site() && x.status !== 'done').length; return n ? [{t:n+' shipment'+(n>1?'s':'')+' not checked in yet', href:'#/receiving', area:'stock'}] : []; });
  needs.push(() => { const st = S().till && S().till.sites && S().till.sites[site()]; if (!st || !st.sessions) return [];
    const n = st.sessions.filter(x => x.closeAt && Math.abs(x.diff) > (st.allow == null ? 5 : st.allow) && !x.note).length; return n ? [{t:n+' drawer count'+(n>1?'s':'')+' over or short', href:'#/till', area:'home'}] : []; });
  needs.push(() => { const today = isoDay(new Date()), n = (S().decisions || []).filter(x => x.site === site() && x.status === 'decided' && x.reviewAt && x.reviewAt <= today && !x.outcome).length;
    return n ? [{t:n+' decision'+(n>1?'s':'')+' to look back on', href:'#/decide', area:'grow'}] : []; });
  needs.push(() => { if (!isMgr()) return []; const n = ((S().voice && S().voice.staff) || []).filter(x => x.site === site() && x.status === 'open').length;
    return n ? [{t:n+' team post'+(n>1?'s':'')+' waiting for an answer', href:'#/teamvoice', area:'people'}] : []; });

  // ---------- drawing ----------
  function headline(area){
    let x = null; try { x = (SSAreas.heads[area] || HEAD[area])(); } catch(e){ console.error(e); }
    if (!x) return null;
    return h('div',{class:'headline'}, h('span',{class:'bignum'}, x.n), x.label ? h('span',{class:'biglabel'}, x.label) : null, x.sub ? h('p',{class:'small muted'}, x.sub) : null);
  }
  function tiles(area){
    const sc = screens(area), wrap = h('div',{class:'areagroups'});
    for (const g in sc) wrap.append(h('section',{class:'areagroup','aria-label':g}, h('h2',null,g),
      h('div',{class:'grid g3 tiles'}, sc[g].map(k => h('a',{class:'tile',href:'#/'+k}, h('span',{class:'ic','aria-hidden':'true'},VIEWS[k].ic), h('b',null,VIEWS[k].t))))));
    return wrap;
  }
  function cards(v, area){
    const box = h('div',{class:'grid g2 glance'});
    const run = f => { const a = MOD_AREA[f.mod] || modArea(f.mod) || 'home'; if (a !== area) return; try { f(box); } catch(e){ console.error(e); } };
    if (area === 'home') A.homeHooks.forEach(f => { try { f(box); } catch(e){ console.error(e); } });
    if (isOwner()) A.ownerHooks.forEach(run);
    v.append(box);
  }
  function today(v){
    const a = AREAS[0];
    v.append(h('div',{class:'head'}, h('span',{class:'eyebrow'}, A.site().name+' · Today'), headline('home')));
    const list = needsList();
    if (list.length) v.append(h('div',{class:'card needs'}, h('h2',null,'Needs you'),
      h('ul',{class:'needlist'}, list.map(x => h('li',null, h('a',{href:x.href}, h('span',null,x.t), h('span',{class:'chip grey'}, (AREAS.find(y => y.id === x.area) || a).t)))))));
    v.append(tiles('home'));
    cards(v, 'home');
    v.append(h('nav',{class:'areadoors','aria-label':'Areas'}, visibleAreas().filter(x => x.id !== 'home' && !x.owner).map(x => door(x))));
  }
  function door(x){
    let hd = null; try { hd = (SSAreas.heads[x.id] || HEAD[x.id])(); } catch(e){}
    return h('a',{class:'tile door',href:'#/'+x.id}, h('span',{class:'ic','aria-hidden':'true'},x.ic), h('b',null,x.t),
      hd ? h('span',null, h('strong',null,hd.n), ' '+hd.label) : h('span',null,x.what));
  }
  function areaView(id){
    return v => {
      if (A.simple()) return A.go('home');
      const a = AREAS.find(x => x.id === id);
      v.append(h('div',{class:'head'}, h('span',{class:'eyebrow'}, a.t), headline(id) || h('h1',null,a.t)));
      v.append(tiles(id));
      cards(v, id);
    };
  }
  AREAS.filter(a => a.id !== 'home').forEach(a => { VIEWS[a.id] = {t:a.t, ic:a.ic, hidden:true}; R[a.id] = areaView(a.id); });

  function nav(el, view){
    const cur = view === 'home' || AREAS.some(a => a.id === view) ? view : areaOf(view);
    visibleAreas().forEach(a => el.append(h('a',{href:'#/'+a.id,class:a.owner?'settings':null,'aria-current':a.id===cur?'page':null}, h('span',{class:'ic','aria-hidden':'true'},a.ic), a.t)));
  }
  function crumb(v, view){
    if (view === 'home' || AREAS.some(a => a.id === view)) return;
    const a = AREAS.find(x => x.id === areaOf(view)); if (!a) return;
    v.append(h('a',{class:'crumb',href:'#/'+a.id}, '← '+a.t));
  }

  const SSAreas = window.SSAreas = {AREAS, GROUPS, AREA_OF, areaOf, today, nav, crumb, needs, heads:{}, headline:(area, f) => { SSAreas.heads[area] = f; }};
})();
