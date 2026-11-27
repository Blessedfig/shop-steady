// Events and community impact.
// Events: author visits, story times, book clubs, school and library visits, fundraisers, markets. Log each one in a
// minute (date, what, how many came, partners, money raised for a cause). Leads and up can log; everyone sees the list.
// Impact report (manager and owner): one page a shop can hand to a landlord, banker, grant maker or city council.
// It adds up what the app already knows (events, people employed, hours worked, giving) for a quarter or a year.
// Main Street research (Nov 2026): 70% of Main Street owners gave to local causes in 2025, and no shop software we
// found shows that value. Numbers come only from what the shop logged; nothing is estimated or made up.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, download, toCsv, isoDay, uid} = A;
  const S = () => A.state();
  const LEAD = ['lead','manager','owner'], MGR = ['manager','owner'];
  const can = list => list.includes(S().tier);
  const KINDS = {author:'Author or artist visit', story:'Story time or kids\' event', club:'Book club or group meeting', school:'School, library or classroom visit',
    fundraiser:'Fundraiser or benefit', market:'Market, festival or downtown event', workshop:'Class or workshop', other:'Other'};
  const GIVING = 'Donations and sponsorships';
  if (!A.D.EXP_CATS.includes(GIVING)) A.D.EXP_CATS.splice(A.D.EXP_CATS.length - 1, 0, GIVING);

  function E(){ const s = S(); s.events = s.events || []; return s.events; }
  const here = () => E().filter(x => x.site === S().site);

  function eventsView(v){
    v.append(head('Community · '+A.site().name, 'Events', 'Log each event in a minute. It adds up into your community impact report.'));
    if (can(LEAD)){
      const f = h('form',{class:'card grid g2'}, h('h2',null,'Log an event'),
        h('label',{class:'f'},'Date', h('input',{type:'date',name:'date',value:isoDay(new Date()),required:true})),
        h('label',{class:'f'},'Kind', h('select',{name:'kind'}, Object.entries(KINDS).map(([k,t]) => h('option',{value:k},t)))),
        h('label',{class:'f'},'What it was', h('input',{type:'text',name:'title',required:true,maxlength:'120',placeholder:'Author talk with a local writer'})),
        h('label',{class:'f'},'How many came', h('input',{type:'number',name:'people',min:'0',step:'1',value:'0'})),
        h('label',{class:'f'},'Partners (school, library, nonprofit, other shops)', h('input',{type:'text',name:'partners',maxlength:'160',placeholder:'Separate with commas'})),
        h('label',{class:'f'},'Raised or given to a cause ($)', h('input',{type:'number',name:'raised',min:'0',step:'0.01',value:'0'})),
        h('label',{class:'f'},'Volunteer or staff hours given (optional)', h('input',{type:'number',name:'hours',min:'0',step:'0.5',value:'0'})),
        h('label',{class:'f'},'Note (optional)', h('input',{type:'text',name:'note',maxlength:'200'})),
        h('button',{class:'btn',type:'submit'},'Save event'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f);
        E().push({id:uid(), site:S().site, date:d.get('date'), kind:d.get('kind'), title:String(d.get('title')).trim(), people:Math.max(0, parseInt(d.get('people'),10)||0),
          partners:String(d.get('partners')||'').split(',').map(x => x.trim()).filter(Boolean), raised:Math.round((+d.get('raised')||0)*100)/100,
          hours:Math.max(0, +d.get('hours')||0), note:String(d.get('note')||'').trim(), by:A.me()});
        A.save(); toast('Event saved'); A.route(); });
      v.append(f);
    }
    const list = here().slice().sort((a,b) => b.date.localeCompare(a.date));
    v.append(h('div',{class:'card'}, h('h2',null,'Past and upcoming'),
      list.length ? h('div',{class:'list'}, list.map(x => h('div',{class:'item'}, h('b',null, x.title),
        h('span',{class:'small muted'}, A.fmtDate(x.date)+' · '+(KINDS[x.kind]||x.kind)+(x.people ? ' · '+x.people+' came' : '')+(x.partners.length ? ' · with '+x.partners.join(', ') : '')+(x.raised ? ' · raised '+money(x.raised) : '')),
        x.note ? h('span',{class:'small'}, x.note) : null,
        can(MGR) ? h('div',{class:'row'}, h('button',{class:'linkbtn',type:'button',onclick:()=>{ S().events = E().filter(y => y.id !== x.id); A.save(); A.route(); }},'Remove')) : null)))
        : h('p',{class:'muted'},'No events logged yet. Even a small story time counts.')));
  }

  // ---------- impact report ----------
  function range(which){
    const t = isoDay(new Date()), y = +t.slice(0,4), q = Math.floor((+t.slice(5,7) - 1) / 3);
    const qs = (yy, qq) => yy+'-'+String(qq*3+1).padStart(2,'0')+'-01';
    if (which === 'lastq'){ const yy = q ? y : y-1, qq = q ? q-1 : 3; return {from:qs(yy,qq), to:qq === 3 ? (yy+1)+'-01-01' : qs(yy,qq+1), name:'Q'+(qq+1)+' '+yy}; }
    if (which === 'year') return {from:y+'-01-01', to:(y+1)+'-01-01', name:String(y)+' so far'};
    if (which === 'lastyear') return {from:(y-1)+'-01-01', to:y+'-01-01', name:String(y-1)};
    return {from:qs(y,q), to:q === 3 ? (y+1)+'-01-01' : qs(y,q+1), name:'Q'+(q+1)+' '+y+' so far'};
  }
  function numbers(r){
    const site = S().site, inR = d => d && d >= r.from && d < r.to;
    const ev = here().filter(x => inR(x.date));
    const people = ev.reduce((a,x) => a + x.people, 0), raised = ev.reduce((a,x) => a + x.raised, 0), given = ev.reduce((a,x) => a + (x.hours||0), 0);
    const partners = [...new Set(ev.flatMap(x => x.partners))].sort();
    const byKind = {}; ev.forEach(x => byKind[x.kind] = (byKind[x.kind]||0) + 1);
    const gifts = (S().exp||[]).filter(x => x.site === site && x.cat === GIVING && inR(x.date)).reduce((a,x) => a + (+x.amt||0), 0);
    const sh = S().shifts || {}, team = ((sh.team||{})[site] || []).filter(p => !/\(sample\)/.test(p.n||''));
    const worked = {}; ((sh.punches||{})[site] || []).forEach(p => { const d = (p.in||'').slice(0,10); if (!inR(d) || !p.out) return;
      worked[p.who] = (worked[p.who]||0) + Math.max(0, (new Date(p.out) - new Date(p.in)) / 36e5 - ((p.brk||0) >= 30 ? p.brk/60 : 0)); });
    const hours = Object.values(worked).reduce((a,b) => a + b, 0);
    const vendors = (((S().people||{}).vendors||{})[site] || []).filter(x => x.status === 'Active');
    const local = vendors.filter(x => x.local);
    const asked = ((S().voice||{}).cust || []).filter(x => x.site === site && inR(x.at)).length;
    return {ev, people, raised, given, partners, byKind, gifts, team:team.length, paid:Object.keys(worked).length, hours, vendors:vendors.length, local:local.map(x => x.name), asked};
  }
  function summaryText(n, r){
    const store = A.site().name, L = [];
    L.push(store+': community impact, '+r.name);
    L.push('');
    if (n.ev.length) L.push('We hosted '+n.ev.length+' event'+(n.ev.length===1?'':'s')+' with '+n.people+' people attending'+(n.partners.length ? ', working with '+n.partners.length+' local partner'+(n.partners.length===1?'':'s')+' ('+n.partners.join(', ')+')' : '')+'.');
    if (n.raised || n.gifts) L.push('We raised or gave '+money(n.raised + n.gifts)+' for local causes'+(n.raised && n.gifts ? ' ('+money(n.raised)+' at events, '+money(n.gifts)+' in donations and sponsorships)' : '')+'.');
    if (n.given) L.push('Our team gave '+Math.round(n.given)+' hours to community events.');
    if (n.paid || n.team) L.push('We employed '+(n.paid || n.team)+' '+((n.paid||n.team) === 1 ? 'person' : 'people')+(n.hours ? ', who worked '+Math.round(n.hours).toLocaleString()+' paid hours here' : '')+'.');
    if (n.local.length) L.push('We buy from '+n.local.length+' local or regional supplier'+(n.local.length===1?'':'s')+': '+n.local.join(', ')+'.');
    if (n.asked) L.push('Customers made '+n.asked+' requests we logged and used to decide what to carry.');
    L.push(''); L.push('All figures come from our own records in Downtown Stube.');
    return L.join('\n');
  }
  function impactView(v){
    v.append(head('Community · '+A.site().name, 'Community impact report', 'What your shop gives back, in numbers you can hand to a landlord, banker, grant maker or the city.'));
    if (!can(MGR)){ v.append(h('div',{class:'card'},'Store managers and the owner see this report.')); return; }
    const which = S().impactRange || 'quarter', r = range(which), n = numbers(r);
    v.append(h('div',{class:'card'}, h('label',{class:'f'},'Period', h('select',{onchange:e => { S().impactRange = e.target.value; A.save(true); A.route(); }},
      [['quarter','This quarter'],['lastq','Last quarter'],['year','This year'],['lastyear','Last year']].map(([k,t]) => h('option',{value:k,selected:k===which},t))))));
    const stat = (b, t) => h('div',{class:'card stat'}, h('b',null,b), h('span',null,t));
    v.append(h('div',{class:'grid g3'},
      stat(String(n.ev.length), 'events hosted'), stat(String(n.people), 'people attended'), stat(String(n.partners.length), 'local partners'),
      stat(money(n.raised + n.gifts), 'raised or given locally'), stat(String(n.paid || n.team), 'people employed'), stat(Math.round(n.hours).toLocaleString(), 'paid hours worked here')));
    const text = summaryText(n, r);
    v.append(h('div',{class:'card grid'}, h('h2',null,'Ready to share'),
      h('pre',{class:'out',tabindex:'0'}, text),
      h('div',{class:'row'}, h('button',{class:'btn',type:'button',onclick:e => A.copy(text, e.target)},'Copy the summary'),
        h('button',{class:'btn ghost',type:'button',onclick:()=>download('community-impact-'+r.name.replace(/\W+/g,'-').toLowerCase()+'.csv','text/csv',
          toCsv([['Date','Event','Kind','Attended','Partners','Raised','Hours given'], ...n.ev.map(x => [x.date, x.title, KINDS[x.kind]||x.kind, x.people, x.partners.join('; '), x.raised.toFixed(2), x.hours||0])]))},'Download events (.csv)')),
      h('p',{class:'small muted'},'Add donations under Expenses with the category "'+GIVING+'". Mark local suppliers under Vendors. Paste the summary into a letter, a grant form or your newsletter.')));
    const kinds = Object.entries(n.byKind).sort((a,b) => b[1]-a[1]);
    if (kinds.length) v.append(h('div',{class:'card'}, h('h2',null,'Events by kind'), h('ul',null, kinds.map(([k,c]) => h('li',null, (KINDS[k]||k)+': '+c)))));
  }

  A.register({id:'events', name:'Events and community impact', what:'Log events, partners and giving, and get a community impact report to share with your landlord, bank, grant makers or the city.', tiers:['lead','manager','owner'],
    views:{events:{t:'Events', ic:'🎉', render:eventsView}, impact:{t:'Community impact', ic:'🌳', render:impactView, min:'manager'}}});
  A.ownerHooks.push(v => { const r = range('quarter'), n = numbers(r); if (!n.ev.length) return;
    v.append(h('div',{class:'card'}, h('h2',null,'Community this quarter'), h('p',null, n.ev.length+' events, '+n.people+' people'+(n.raised + n.gifts ? ', '+money(n.raised + n.gifts)+' given' : '')+'. ', h('a',{href:'#/impact'},'See the impact report')))); });
})();
