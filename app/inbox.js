// Owner inbox on Home: every message from the team in one list, newest first. Team voice posts and check-ins,
// notes, "not done" reports and customer notes. The owner marks each one seen (or all at once).
// The person who sent it sees checkmarks next to their own posts:
//   ✓  Sent       the shared copy on the server has it (other devices can see it)
//   ✓✓ Seen       the owner marked it seen, with the time
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, toast} = A;
  const S = () => A.state();
  const STAFF = {idea:'Idea', concern:'Concern', want:'Needs or wants', gripe:'Gripe', question:'Question', praise:'Shout-out'};
  const NOTE = {update:'Shift log', customer:'Customer note', incident:'Incident', staff:'Employee file', task:'Task not done', vendor:'Vendor note'};
  const CUST = {asked:'Customer asked for', passed:'Customer passed on', disliked:'Customer disliked', praised:'Customer praised', question:'Customer question'};
  const DAYS = 45;

  // every message, with where it lives (shared area) so the sender's checkmarks can tell if it reached the server
  function items(){
    const s = S(), site = s.site, since = new Date(Date.now() - DAYS*864e5).toISOString().slice(0,10), out = [];
    const vo = s.voice || {};
    (vo.staff || []).forEach(x => out.push({key:'voice', x, at:x.at, kind:STAFF[x.kind] || 'Team voice', text:x.what, by:x.anon ? 'Anonymous' : x.by, href:'#/teamvoice'}));
    (vo.checkins || []).forEach(x => out.push({key:'voice', x, at:x.at, kind:'Check-in', text:(x.score ? 'Score '+x.score+'/5. ' : '')+(x.a || []).filter(Boolean).join(' · '), by:x.by || 'Anonymous', href:'#/teamvoice'}));
    (vo.cust || []).forEach(x => out.push({key:'voice', x, at:x.at, kind:CUST[x.kind] || 'Customer note', text:x.what, by:x.by, href:'#/custvoice'}));
    (Array.isArray(s.staffnotes) ? s.staffnotes : []).forEach(x => out.push({key:'staffnotes', x, at:x.at, kind:NOTE[x.kind] || 'Note', text:(x.about ? x.about+': ' : '')+x.text, by:x.by, href:'#/notes'}));
    (s.notes || []).forEach(x => out.push({key:'notes', x, at:x.at, kind:NOTE[x.kind] || 'Note', text:(x.about ? x.about+': ' : '')+x.text, by:x.by, href:'#/notes'}));
    ((s.shifts && s.shifts.reports) || []).forEach(x => out.push({key:'shifts', x, at:x.at || x.date, kind:'Not done', text:x.task+(x.note ? ' · '+x.note : ''), by:x.by, href:'#/checklists'}));
    return out.filter(i => i.x && i.x.site === site && String(i.at||'') >= since).sort((a,b) => String(b.at).localeCompare(String(a.at)));
  }
  const when = at => /T/.test(at || '') ? A.fmtTime(at) : A.fmtDate(at);
  const markSeen = list => { const t = new Date().toISOString(), by = A.me(); list.forEach(i => { i.x.seen = {at:t, by}; }); A.save(); };

  // sender side: checkmarks for one record in a shared area
  A.delivery = (key, x) => {
    const sent = A.demo || !A.sync || !A.sync.onServer ? true : A.sync.onServer(key, x.id);
    return h('span',{class:'small muted delivery'},
      x.seen ? h('span',{class:'chip calm',title:'Seen by the owner'}, '✓✓ Seen '+A.fmtTime(x.seen.at))
        : sent ? h('span',{class:'chip grey',title:'Sent: on the shared copy'}, '✓ Sent')
        : h('span',{class:'chip amber',title:'Saved on this device, sends when online'}, 'Sending…'));
  };

  A.ownerHooks.unshift(v => {
    const all = items(), unseen = all.filter(i => !i.x.seen), shown = (S().inboxAll ? all : unseen).slice(0, 40);
    const card = h('div',{class:'card'}, h('h2',null,'Inbox', unseen.length ? h('span',{class:'chip amber',style:'margin-left:.5rem'}, unseen.length+' new') : null),
      h('p',{class:'small muted'},'Every message from the team. Mark each one seen; the person who sent it sees ✓✓.'));
    card.append(shown.length ? h('div',{class:'list'}, shown.map(i => h('div',{class:'item'},
      h('span',{class:'small muted'}, h('b',null,i.kind), ' · '+(i.by || 'Someone')+' · '+when(i.at)),
      h('p',null, i.text),
      h('div',{class:'row'}, h('a',{class:'small',href:i.href},'Open'),
        i.x.seen ? h('span',{class:'chip calm'},'✓✓ Seen') : h('button',{class:'btn sm',type:'button',onclick:()=>{ markSeen([i]); A.route(); }},'✓ Seen'))))) :
      h('p',{class:'muted'}, all.length ? 'All caught up.' : 'No messages yet.'));
    card.append(h('div',{class:'row'},
      unseen.length > 1 ? h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ markSeen(unseen); toast('All marked seen'); A.route(); }},'Mark all seen') : null,
      h('button',{class:'linkbtn small',type:'button',onclick:()=>{ S().inboxAll = !S().inboxAll; A.save(true); A.route(); }}, S().inboxAll ? 'Show only new' : 'Show seen ones too')));
    v.append(card);
  });
})();
