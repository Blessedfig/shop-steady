// Voice: what customers ask for, pass on or dislike, and what staff want, worry about or complain about.
// Quick to log (a few taps at the counter), with an anonymous option for staff, replies from managers,
// and a summary that rolls up for owners and managers. Pattern from Steady Shift's "Ideas and fixes" review queue.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, download, toCsv, isoDay, addDays, uid} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier);

  const CUST = {asked:'Asked for something we don\'t carry', passed:'Passed on a product (price, condition, other)', disliked:'Disliked something', praised:'Praised something', question:'Asked a question we couldn\'t answer'};
  const STAFF = {idea:'Idea', concern:'Concern', want:'Something I need or want', gripe:'Gripe (let it out)', question:'Question', praise:'Shout-out'};
  const CHECKIN = ['How was this week, 1 to 5?','What got in your way?','What would make your job easier?','Anything you want the owner to know?'];

  function V(){ const s = S(); s.voice = s.voice || {cust:[], staff:[], checkins:[]};
    if (!s.voice.seeded){ s.voice.seeded = true; const d = isoDay(new Date()), site = 'main';
      s.voice.cust.push({id:uid(), site, at:addDays(d,-3), kind:'asked', what:'Asked for volume 12 of a manga series (sample)', cat:'Manga', by:'Staff'},
                        {id:uid(), site, at:addDays(d,-2), kind:'passed', what:'Put back a hardcover at $32, said too pricey (sample)', cat:'Fiction', by:'Staff'},
                        {id:uid(), site, at:addDays(d,-1), kind:'asked', what:'Asked for volume 12 again, different customer (sample)', cat:'Manga', by:'Staff'});
      s.voice.staff.push({id:uid(), site, at:addDays(d,-2), kind:'want', what:'A step stool for the top manga shelf (sample)', anon:false, by:'Alex (sample)', status:'open', replies:[]},
                         {id:uid(), site, at:addDays(d,-1), kind:'gripe', what:'Closing alone on Saturdays is a lot (sample)', anon:true, by:'', status:'open', replies:[]});
      A.save(); }
    return s.voice; }
  const me = () => A.me();
  const here = list => list.filter(x => x.site === S().site);

  function customers(v){
    v.append(head('Voice · '+A.site().name, 'What customers tell us', 'Log it in a few taps when a customer asks for something, passes on something, or tells you what they think. It adds up into what to stock and change.'));
    const f = h('form',{class:'card grid'},
      h('label',{class:'f'},'What happened', h('select',{name:'kind'}, Object.entries(CUST).map(([k,t]) => h('option',{value:k},t)))),
      h('label',{class:'f'},'Details', h('input',{type:'text',name:'what',maxlength:'160',required:true,placeholder:'Title, product or what they said'})),
      h('label',{class:'f'},'Section or category (optional)', h('input',{type:'text',name:'cat',maxlength:'40'})),
      h('p',{class:'small muted'},'Don\'t write customer names or contact details here. Use a customer\'s account for special orders.'),
      h('button',{class:'btn',type:'submit'},'Log it'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f);
      V().cust.push({id:uid(), site:S().site, at:isoDay(new Date()), kind:d.get('kind'), what:String(d.get('what')).trim(), cat:String(d.get('cat')||'').trim(), by:me()}); A.save(); toast('Logged. Thanks!'); A.route(); });
    v.append(f);
    const list = here(V().cust).sort((a,b) => b.at.localeCompare(a.at));
    v.append(h('div',{class:'card'}, h('h2',null,'Recent'), list.length ? h('div',{class:'list'}, list.slice(0,30).map(x => h('div',{class:'item'},
      h('b',null,x.what), h('span',{class:'small muted'}, CUST[x.kind]+(x.cat?' · '+x.cat:'')+' · '+A.fmtDate(x.at))))) : h('p',{class:'muted'},'Nothing logged yet.'),
      isMgr() ? h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:()=>download('customer-voice-'+isoDay(new Date())+'.csv','text/csv',toCsv([['Date','Type','Details','Category'], ...list.map(x=>[x.at,CUST[x.kind],x.what,x.cat])]))},'Download (.csv)')) : null));
  }

  function staff(v){
    const ta = h('textarea',{name:'what',rows:'3',maxlength:'600',required:true});
    v.append(head('Voice · '+A.site().name, 'Team voice', 'Ideas, needs, worries and gripes, all welcome. Post with your name or anonymously. Managers answer here.'));
    const f = h('form',{class:'card grid'},
      h('label',{class:'f'},'Type', h('select',{name:'kind'}, Object.entries(STAFF).map(([k,t]) => h('option',{value:k},t)))),
      h('label',{class:'f'},'What\'s on your mind', ta),
      A.polishButton ? A.polishButton(ta, {kind:'voice'}) : null,
      h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'anon'}), 'Post anonymously (managers won\'t see your name)'),
      h('button',{class:'btn',type:'submit'},'Send'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), anon = !!d.get('anon');
      V().staff.push({id:uid(), site:S().site, at:isoDay(new Date()), kind:d.get('kind'), what:String(d.get('what')).trim(), anon, by:anon ? '' : me(), status:'open', replies:[]}); A.save(); toast('Sent. Thank you for saying it.'); A.route(); });
    v.append(f);
    // weekly check-in: four short questions
    const ci = h('form',{class:'card grid'}, h('h2',null,'Weekly check-in'), h('p',{class:'small muted'},'Two minutes. Answers go to managers, and you can skip any question.'),
      CHECKIN.map((q,i) => h('label',{class:'f'}, q, i === 0 ? h('select',{name:'q0'}, ['','1','2','3','4','5'].map(n => h('option',{value:n}, n || 'Pick one'))) : h('input',{type:'text',name:'q'+i,maxlength:'300'}))),
      h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'anon'}), 'Anonymous'),
      h('button',{class:'btn ghost',type:'submit'},'Send check-in'));
    ci.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(ci), anon = !!d.get('anon');
      V().checkins.push({id:uid(), site:S().site, at:isoDay(new Date()), score:+d.get('q0')||null, a:CHECKIN.slice(1).map((_,i) => String(d.get('q'+(i+1))||'').trim()), by:anon ? '' : me()}); A.save(); toast('Check-in sent'); A.route(); });
    v.append(ci);
    const list = here(V().staff).filter(x => isMgr() || x.by === me() || x.anon).sort((a,b) => b.at.localeCompare(a.at));
    v.append(h('div',{class:'card'}, h('h2',null, isMgr() ? 'Everything from the team' : 'Posts and answers'), list.length ? h('div',{class:'list'}, list.map(x => {
      const it = h('div',{class:'item'}, h('b',null,x.what), h('span',{class:'small muted'}, STAFF[x.kind]+' · '+(x.anon ? 'Anonymous' : x.by)+' · '+A.fmtDate(x.at)+' · ', h('span',{class:'chip '+(x.status==='open'?'amber':'calm')}, x.status==='open'?'Open':'Answered')), !isMgr() && x.by === me() && A.delivery ? A.delivery('voice', x) : null);
      x.replies.forEach(r => it.append(h('div',{class:'small'}, h('b',null,r.by+': '), r.text)));
      if (isMgr()){ const rf = h('form',{class:'row'}, h('input',{type:'text',name:'r',maxlength:'300','aria-label':'Reply',placeholder:'Reply'}), h('button',{class:'btn sm',type:'submit'},'Reply'));
        rf.addEventListener('submit', e => { e.preventDefault(); const t = String(new FormData(rf).get('r')||'').trim(); if (!t) return; x.replies.push({by:me(), text:t}); x.status = 'answered'; A.save(); A.route(); }); it.append(rf); }
      return it; })) : h('p',{class:'muted'},'Nothing yet.')));
  }

  // Summary for owners and managers: patterns, not single complaints.
  function summary(v){
    v.append(head('Voice · '+A.site().name, 'Summary for decisions', 'What customers and staff keep telling you, counted. Use it for ordering, pricing, scheduling and reviews.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only managers and owners see the summary.')); return; }
    const since = addDays(isoDay(new Date()), -30), cust = here(V().cust).filter(x => x.at >= since), st = here(V().staff).filter(x => x.at >= since), ci = here(V().checkins).filter(x => x.at >= since);
    const count = (arr, key) => { const m = {}; arr.forEach(x => { const k = key(x); if (k) m[k] = (m[k]||0)+1; }); return Object.entries(m).sort((a,b) => b[1]-a[1]); };
    const asked = count(cust.filter(x => x.kind==='asked'), x => x.what.replace(/\s*\(sample\)$/,'').replace(/, different customer$/,'').replace(/ again$/,'').toLowerCase());
    const byKind = count(cust, x => CUST[x.kind]), byCat = count(cust.filter(x => x.kind==='passed'||x.kind==='disliked'), x => x.cat || 'No category');
    const scores = ci.map(x => x.score).filter(Boolean), avg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';
    const li = arr => arr.length ? h('ul',null, arr.slice(0,8).map(([k,n]) => h('li',null, k+' ('+n+')'))) : h('p',{class:'muted'},'Nothing in the last 30 days.');
    v.append(h('div',{class:'grid g3'},
      h('div',{class:'card stat'}, h('b',null,String(cust.length)), h('span',null,'customer notes, 30 days')),
      h('div',{class:'card stat warnc'}, h('b',null,String(st.filter(x => x.status==='open').length)), h('span',null,'team posts waiting for an answer')),
      h('div',{class:'card stat good'}, h('b',null,avg), h('span',null,'team check-in score (1 to 5)'))));
    v.append(h('div',{class:'card'}, h('h2',null,'Most asked for'), li(asked)),
             h('div',{class:'card'}, h('h2',null,'Customer notes by type'), li(byKind)),
             h('div',{class:'card'}, h('h2',null,'Where customers pass or complain'), li(byCat)),
             h('div',{class:'card'}, h('h2',null,'Team posts by type'), li(count(st, x => STAFF[x.kind]))));
  }

  A.register({id:'voice', name:'Customer and team voice', what:'Log what customers ask for or pass on, collect staff ideas, needs and gripes (with an anonymous option), weekly check-ins, and a summary for decisions.', tiers:['staff','lead','manager','owner'],
    views:{custvoice:{t:'Customer notes', ic:'🗣️', render:customers}, teamvoice:{t:'Team voice', ic:'💬', render:staff}, voicesum:{t:'Voice summary', ic:'📊', render:summary, min:'manager'}}});
  A.ownerHooks.push(v => { const open = here(V().staff).filter(x => x.status==='open').length, asked = here(V().cust).filter(x => x.kind==='asked' && x.at >= addDays(isoDay(new Date()),-7)).length;
    v.append(h('div',{class:'card'}, h('h2',null,'Voice this week'), h('p',null, asked+' customer requests for things we don\'t carry · '+open+' team posts waiting for an answer'), h('a',{href:'#/voicesum'},'See the summary'))); });
})();
