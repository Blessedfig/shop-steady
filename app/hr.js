// HR files (store manager and owner): one file per person on the team.
//   - Basics: start date, status (active or left), phone and emergency contact.
//   - Paperwork checklist: which new-hire forms are done and when (the papers themselves stay in the locked file
//     cabinet: this app never stores ID copies, Social Security or bank numbers).
//   - Reviews: strengths, what to work on, goals, and a follow-up date.
//   - Coaching and write-ups: what happened, what is expected, next step, and whether the person was told and signed.
//     Employee file notes from Notes show here too.
//   - Medical papers are kept out of the app on purpose: the file says where they belong instead.
//   - Time records are never trimmed: Wisconsin and federal rules ask for 3 years (they live in Shifts).
// The file lives in the private shared area 'hr' (supabase/hr.sql); until that has run it stays on this device.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, uid, isoDay} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier) && (A.demo || MGR.includes(A.myRole));
  const HR = () => { const s = S(); s.hr = s.hr && typeof s.hr === 'object' ? s.hr : {}; s.hr.people = s.hr.people || {}; return s.hr; };
  const file = id => { const f = HR().people[id] = HR().people[id] || {}; f.paper = f.paper || {}; f.reviews = f.reviews || []; f.actions = f.actions || []; return f; };
  const team = () => ((S().shifts && S().shifts.team && S().shifts.team[S().site]) || []).filter(p => !/\(sample\)/.test(p.n));
  const PAPER = [
    ['w4','Federal W-4 (tax withholding)'],
    ['wt4','State withholding form (Wisconsin WT-4)'],
    ['i9','I-9 checked within 3 days of starting (kept in its own folder, apart from HR files)'],
    ['newhire','Reported as a new hire to the state (Wisconsin: within 20 days)'],
    ['deposit','Direct deposit or paycheck set up'],
    ['handbook','Handbook or store rules read and signed'],
    ['emergency','Emergency contact on file'],
    ['permit','Work permit, if under 16'],
    ['cash','Cash training passed'],
    ['keys','Keys or alarm code given (note which)']];
  const ACTION = {coach:'Coaching talk', verbal:'Verbal warning', written:'Written warning', final:'Final warning', praise:'Recognition', end:'Separation'};
  const today = () => isoDay(new Date());
  const ago = d => d ? Math.floor((Date.now() - new Date(d+'T12:00:00')) / 864e5) : null;

  function paperDone(p){ const f = file(p.id); return PAPER.filter(([k]) => k === 'cash' ? !!(S().till && S().till.trained && S().till.trained[p.n]) : !!(f.paper[k] && f.paper[k].done)).length; }
  function shareNote(){
    if (A.demo || !A.sync || !A.sync.gateOk || A.sync.gateOk()) return null;
    return h('div',{class:'msg'},'HR files are saved on this device only until the owner runs supabase/hr.sql. After that they sync privately to managers and the owner.');
  }

  function list(v){
    v.append(head('Store manager and owner', 'HR files', 'One file per person: paperwork, reviews, coaching and write-ups. Papers with ID or bank numbers stay in your locked file, not here.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can open HR files.')); return; }
    const n = shareNote(); if (n) v.append(n);
    const ppl = team();
    if (!ppl.length){ v.append(h('div',{class:'card'}, h('p',null,'No one on the team yet. Add people on the Team screen first.'), h('a',{href:'#/team'},'Open Team'))); return; }
    const due = [];
    v.append(h('div',{class:'card'}, h('div',{class:'list'}, ppl.map(p => { const f = file(p.id), done = paperDone(p), last = f.reviews.slice().sort((a,b) => String(b.at).localeCompare(String(a.at)))[0];
      const reviewDue = !last ? ago(f.start) > 90 : ago(last.at) > 365;
      const follow = f.actions.filter(a => a.follow && a.follow <= today() && !a.closed);
      if (reviewDue) due.push(p.n+': review due'); follow.forEach(a => due.push(p.n+': follow up on '+ACTION[a.kind].toLowerCase()));
      return h('a',{class:'item',href:'#/hrfile/'+encodeURIComponent(p.id),style:'display:block;text-decoration:none;color:inherit'},
        h('b',null,p.n), ' ', f.status === 'left' ? h('span',{class:'chip grey'},'Left') : null,
        h('div',{class:'small muted'}, A.tierName(p.tier)+(f.start ? ' · started '+A.fmtDate(f.start) : '')+' · paperwork '+done+'/'+PAPER.length+(last ? ' · last review '+A.fmtDate(last.at) : '')),
        reviewDue ? h('span',{class:'chip amber'},'Review due') : null, follow.length ? h('span',{class:'chip amber'},'Follow-up due') : null); }))));
    if (due.length) v.prepend(h('div',{class:'card'}, h('h2',null,'Coming up'), h('ul',null, due.map(x => h('li',null,x)))));
  }

  function person(v){
    const id = A.param(), p = team().find(x => x.id === id) || ((S().shifts && S().shifts.team && S().shifts.team[S().site]) || []).find(x => x.id === id);
    v.append(h('a',{class:'small',href:'#/hr'},'← All HR files'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can open HR files.')); return; }
    if (!p){ v.append(h('div',{class:'card'},'That person is not on this location\'s team.')); return; }
    const f = file(p.id);
    v.append(head('HR file', p.n, A.tierName(p.tier)));
    const n = shareNote(); if (n) v.append(n);

    // basics
    const b = h('form',{class:'card grid'}, h('h2',null,'Basics'),
      h('label',{class:'f'},'Start date', h('input',{type:'date',name:'start',value:f.start||''})),
      h('label',{class:'f'},'Status', h('select',{name:'status'}, [['active','Active'],['left','Left the job']].map(([k,t]) => h('option',{value:k,selected:(f.status||'active')===k},t)))),
      h('label',{class:'f'},'Last day (if they left)', h('input',{type:'date',name:'end',value:f.end||''})),
      h('label',{class:'f'},'Phone', h('input',{type:'tel',name:'phone',value:f.phone||'',maxlength:'30',autocomplete:'off'})),
      h('label',{class:'f'},'Emergency contact (name and phone)', h('input',{type:'text',name:'emerg',value:f.emerg||'',maxlength:'120',autocomplete:'off'})),
      h('button',{class:'btn sm',type:'submit'},'Save'));
    b.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(b);
      Object.assign(f, {start:String(d.get('start')||''), status:String(d.get('status')), end:String(d.get('end')||''), phone:String(d.get('phone')||'').trim(), emerg:String(d.get('emerg')||'').trim()}); A.save(); toast('Saved'); });
    v.append(b);

    // paperwork
    const pc = h('div',{class:'card'}, h('h2',null,'New-hire paperwork'), h('p',{class:'small muted'},'Tick each one when it is done. Keep the papers themselves in the locked file. Rules vary by state; check with your accountant.'));
    PAPER.forEach(([k,t]) => {
      if (k === 'cash'){ const at = S().till && S().till.trained && S().till.trained[p.n];
        return pc.append(h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:!!at,disabled:true}), t+(at ? ' · '+A.fmtDate(String(at).slice(0,10)) : ' (they take it in the app)'))); }
      const x = f.paper[k];
      pc.append(h('label',{class:'checkrow'}, h('input',{type:'checkbox',checked:!!(x && x.done),onchange:e=>{
        if (e.target.checked){ const note = k === 'keys' ? (prompt('Which keys or code? (no alarm codes themselves)') || '') : ''; f.paper[k] = {done:true, at:today(), by:A.me(), note}; }
        else delete f.paper[k]; A.save(); A.route(); }}), t+(x && x.done ? ' · '+A.fmtDate(x.at)+(x.note ? ' · '+x.note : '') : '')));
    });
    const i9 = i9Until(f); if (i9) pc.append(h('p',{class:'small'}, h('b',null,'I-9: '), i9));
    v.append(pc);

    // reviews
    const rv = h('div',{class:'card'}, h('h2',null,'Reviews'));
    f.reviews.slice().sort((a,b) => String(b.at).localeCompare(String(a.at))).forEach(r => rv.append(h('div',{class:'item'},
      h('span',{class:'small muted'}, A.fmtDate(r.at)+' · by '+r.by+(r.rating ? ' · '+['','Needs a lot of work','Needs some work','Meets expectations','Above expectations','Outstanding'][r.rating] : '')),
      r.strengths ? h('p',null, h('b',null,'Going well: '), r.strengths) : null,
      r.grow ? h('p',null, h('b',null,'To work on: '), r.grow) : null,
      r.goals ? h('p',null, h('b',null,'Goals: '), r.goals) : null,
      r.next ? h('p',{class:'small muted'},'Next check-in '+A.fmtDate(r.next)) : null)));
    const rf = h('form',{class:'grid'}, h('h3',null,'Add a review'),
      h('label',{class:'f'},'Date', h('input',{type:'date',name:'at',value:today(),required:true})),
      h('label',{class:'f'},'Overall', h('select',{name:'rating'}, [['','(no rating)'],['5','Outstanding'],['4','Above expectations'],['3','Meets expectations'],['2','Needs some work'],['1','Needs a lot of work']].map(([k,t]) => h('option',{value:k},t)))),
      h('label',{class:'f'},'What is going well', h('textarea',{name:'strengths',rows:'2',maxlength:'2000'})),
      h('label',{class:'f'},'What to work on', h('textarea',{name:'grow',rows:'2',maxlength:'2000'})),
      h('label',{class:'f'},'Goals until next time', h('textarea',{name:'goals',rows:'2',maxlength:'2000'})),
      h('label',{class:'f'},'Next check-in', h('input',{type:'date',name:'next'})),
      h('button',{class:'btn sm',type:'submit'},'Save review'));
    rf.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(rf);
      f.reviews.push({id:uid(), at:String(d.get('at')), by:A.me(), rating:+d.get('rating')||null, strengths:String(d.get('strengths')||'').trim(), grow:String(d.get('grow')||'').trim(), goals:String(d.get('goals')||'').trim(), next:String(d.get('next')||'')});
      A.save(); toast('Review saved'); A.route(); });
    rv.append(h('details',null, h('summary',null,'Add a review'), rf));
    v.append(rv);

    // coaching and write-ups
    const ac = h('div',{class:'card'}, h('h2',null,'Coaching, warnings and recognition'),
      h('p',{class:'small muted'},'Write what happened in plain facts (date, time, what was seen or said), what is expected from now on, and the next step. Tell the person, and have them sign the printed copy.'));
    f.actions.slice().sort((a,b) => String(b.at).localeCompare(String(a.at))).forEach(a => ac.append(h('div',{class:'item'},
      h('span',{class:'small muted'}, h('b',null, ACTION[a.kind] || a.kind), ' · '+A.fmtDate(a.at)+' · by '+a.by),
      h('p',null, a.what), a.expect ? h('p',null, h('b',null,'Expected: '), a.expect) : null,
      h('p',{class:'small muted'}, (a.told ? '✓ Talked with them' : 'Not discussed yet')+(a.signed ? ' · ✓ Signed' : '')+(a.follow ? ' · follow up '+A.fmtDate(a.follow) : '')+(a.closed ? ' · closed' : '')),
      h('div',{class:'row'},
        !a.told ? h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ a.told = today(); A.save(); A.route(); }},'Mark discussed') : null,
        !a.signed ? h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ a.signed = today(); A.save(); A.route(); }},'Mark signed') : null,
        a.follow && !a.closed ? h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ a.closed = today(); A.save(); A.route(); }},'Follow-up done') : null,
        h('button',{class:'linkbtn small',type:'button',onclick:()=>printAction(p, a)},'Print to sign')))));
    const what = h('textarea',{name:'what',rows:'3',maxlength:'4000',required:true,placeholder:'e.g. 11/22 came in 40 min late, no call. Third time this month.'});
    const af = h('form',{class:'grid'}, h('h3',null,'Add an entry'),
      h('label',{class:'f'},'Type', h('select',{name:'kind'}, Object.entries(ACTION).map(([k,t]) => h('option',{value:k},t)))),
      h('label',{class:'f'},'Date', h('input',{type:'date',name:'at',value:today(),required:true})),
      h('label',{class:'f'},'What happened', what),
      A.polishButton ? A.polishButton(what, {kind:'staff', about:p.n}) : null,
      h('label',{class:'f'},'What is expected from now on', h('textarea',{name:'expect',rows:'2',maxlength:'2000'})),
      h('label',{class:'f'},'Follow up on', h('input',{type:'date',name:'follow'})),
      h('button',{class:'btn sm',type:'submit'},'Save entry'));
    af.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(af), t = String(d.get('what')||'').trim(); if (!t) return;
      f.actions.push({id:uid(), kind:String(d.get('kind')), at:String(d.get('at')), by:A.me(), what:t, original:what.dataset.original && what.dataset.original !== t ? what.dataset.original : '', expect:String(d.get('expect')||'').trim(), follow:String(d.get('follow')||'')});
      A.save(); toast('Saved'); A.route(); });
    ac.append(h('details',null, h('summary',null,'Add an entry'), af));
    v.append(ac);

    // employee file notes written in Notes
    const sn = (Array.isArray(S().staffnotes) ? S().staffnotes : []).filter(x => x.site === S().site && String(x.about||'').trim().toLowerCase() === p.n.toLowerCase());
    if (sn.length) v.append(h('div',{class:'card'}, h('h2',null,'Employee file notes'), h('div',{class:'list'}, sn.map(x => h('div',{class:'item'},
      h('span',{class:'small muted'}, A.fmtDate(String(x.when||x.at).slice(0,10))+' · by '+x.by), h('p',null,x.text))))));

    // medical: kept out of the app on purpose
    v.append(h('div',{class:'card'}, h('h2',null,'Medical papers'),
      h('p',{class:'small muted'},'Doctor\'s notes, medical forms and anything about health go in a separate locked folder, not in this app and not in the regular HR file. If someone needs a schedule change (for example "no lifting over 20 lb until 1/15"), write just that as a note on the schedule, without the reason.')));
  }

  // I-9s are kept for 3 years after hiring or 1 year after the job ends, whichever is later, then destroyed.
  function i9Until(f){
    if (!f.start) return '';
    const plus = (d, y) => { const x = new Date(d+'T12:00:00'); x.setFullYear(x.getFullYear()+y); return isoDay(x); };
    if (f.status !== 'left' || !f.end) return 'keep while they work here, and at least until '+A.fmtDate(plus(f.start, 3))+'.';
    const until = [plus(f.start, 3), plus(f.end, 1)].sort().pop();
    return (until <= today() ? 'can be shredded now (kept until ' : 'shred after ')+A.fmtDate(until)+(until <= today() ? ').' : '.');
  }
  function printAction(p, a){
    const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print');
    const esc = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    w.document.write('<!doctype html><meta charset="utf-8"><title>'+esc(ACTION[a.kind])+'</title><style>body{font:14px/1.5 system-ui;max-width:680px;margin:2rem auto}h1{font-size:20px}.sig{margin-top:3rem;display:flex;gap:2rem}.sig div{flex:1;border-top:1px solid #000;padding-top:.3rem}</style>'+
      '<h1>'+esc(A.site().name)+' · '+esc(ACTION[a.kind])+'</h1><p><b>Employee:</b> '+esc(p.n)+'<br><b>Date:</b> '+esc(a.at)+'<br><b>Written by:</b> '+esc(a.by)+'</p>'+
      '<h2>What happened</h2><p>'+esc(a.what)+'</p>'+(a.expect ? '<h2>What is expected from now on</h2><p>'+esc(a.expect)+'</p>' : '')+(a.follow ? '<p><b>Follow-up:</b> '+esc(a.follow)+'</p>' : '')+
      '<h2>Employee comments</h2><p style="height:6rem;border:1px solid #ccc"></p><p>Signing means you received this, not that you agree.</p>'+
      '<div class="sig"><div>Employee signature and date</div><div>Manager signature and date</div></div>');
    w.document.close(); w.focus(); w.print();
  }

  A.register({id:'hr', name:'HR files', what:'One file per person: new-hire paperwork with I-9 dates, reviews, coaching and write-ups with a printable sign-off. Medical papers stay out of the app.', tiers:['manager','owner'],
    views:{hr:{t:'HR files', ic:'🗂️', render:list, min:'manager'}, hrfile:{t:'HR file', ic:'🗂️', render:person, min:'manager', hidden:true}}});
  A.ownerHooks.push(v => { const ppl = team(); if (!ppl.length) return; let due = 0;
    ppl.forEach(p => { const f = file(p.id), last = f.reviews.slice().sort((a,b) => String(b.at).localeCompare(String(a.at)))[0];
      if (f.status !== 'left' && (!last ? ago(f.start) > 90 : ago(last.at) > 365)) due++; due += f.actions.filter(a => a.follow && a.follow <= today() && !a.closed).length; });
    if (due) v.append(h('div',{class:'card'}, h('h2',null,'HR'), h('p',null, due+' review'+(due > 1 ? 's or follow-ups' : ' or follow-up')+' due. ', h('a',{href:'#/hr'},'Open HR files')))); });
})();
