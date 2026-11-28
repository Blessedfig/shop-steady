// Training: short courses for every job, each a few lessons and a quick check (all answers right to pass).
//   - Built-in courses cover the everyday work; the owner can edit any of them, hide ones that don't fit,
//     and add their own (store policies, how we greet people, anything).
//   - "Who it's for" sets the lowest level that sees a course (Ordering from vendors is managers only).
//   - Cash handling stays in the Cash drawer module (passing it is what unlocks the register); it is listed here.
//   - Passes are kept per person and shown to managers, and in store mode the tapped-in person is the one who passes.
// Data: the shared doc 'training' = {edits:{id:course}, custom:[course], hidden:{id:true}, done:{id:{name:iso}}}.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, uid} = A;
  const S = () => A.state();
  const RANK = {staff:1, lead:2, manager:3, owner:4};
  const TR = () => { const s = S(); const t = s.training = s.training || {}; t.edits = t.edits || {}; t.custom = t.custom || []; t.hidden = t.hidden || {}; t.done = t.done || {}; return t; };
  const tapped = () => { const k = S().kioskWho; return k && Date.now() - k.at < 120000 ? k : null; };
  const teamHere = () => ((S().shifts && S().shifts.team && S().shifts.team[S().site]) || []);
  const actor = () => { const k = tapped(); if (k){ const p = teamHere().find(x => x.n === k.n); return {n:k.n, tier:p ? p.tier : 'staff'}; } return {n:A.me(), tier:S().tier}; };
  const touch = () => { const k = S().kioskWho; if (k){ k.at = Date.now(); A.save(true); } };
  const isOwner = () => S().tier === 'owner' && (A.demo || !A.myRole || A.myRole === 'owner');
  const isMgr = () => RANK[S().tier] >= 3 && (A.demo || !A.myRole || RANK[A.myRole] >= 3);

  // [id, icon, title, for (lowest level), minutes, lessons [[title, text]], quiz [[question, [options], right index]]]
  const BUILT = [
    {id:'frontdesk', ic:'🛎️', t:'Front desk basics', for:'staff', min:5, lessons:[
      ['Greet everyone', 'Say hello to each person within a few seconds of them coming in, even if you are busy. Eye contact and a smile are enough while you finish what you are doing.'],
      ['Customer pickup', 'Open Customer pickup, type part of their name or phone number and you will see what is waiting. Hand it over, ring it up on the register, then tap Picked up.'],
      ['Check in a delivery', 'Open Check in a delivery, pick the shipment that matches the packing slip and scan each item. Tap + damaged for anything bent, torn or wet and set it aside. Tap Done checking in when the box is empty.'],
      ['We\'re out of…', 'When something runs out or runs low, scan it or type it in We\'re out of… and tap Out or Running low. Tick "A customer asked" if someone wanted it. The manager sees the list.'],
      ['When you are not sure', 'Use Ask a question in the app, or ask the shift lead. It is always fine to tell a customer "Let me find out for you."']],
      quiz:[
      ['A customer walks in while you are on the phone. What do you do?', ['Ignore them until the call ends','Smile or wave so they know you saw them','Hang up right away'], 1],
      ['A box arrives with one book bent. What do you do?', ['Shelve it anyway','Tap + damaged on its line and set it aside','Throw it away'], 1],
      ['A customer asks for a title we are out of. What else do you do?', ['Nothing','Add it in We\'re out of… and tick "A customer asked"','Tell them to try online'], 1]]},
    {id:'specialorders', ic:'📚', t:'Special orders and pickups', for:'staff', min:4, types:['bookstore','retail'], lessons:[
      ['Taking an order', 'Write down the exact item (title, author or product, and the ISBN or SKU if you can find it), the customer\'s name and the best phone number. Tell them how long it usually takes and ask a shift lead to place it if you cannot.'],
      ['Deposits', 'Follow the store\'s rule on deposits or prepaying. If you are not sure, ask before promising anything.'],
      ['When it arrives', 'Checking in a delivery tells you when an item is a special order. Put it on the hold shelf with the customer\'s name, then call or text them and tap "It\'s here, told them".'],
      ['Pickup', 'Find them in Customer pickup, ring it up on the register and tap Picked up.']],
      quiz:[
      ['What do you always write down on a special order?', ['Only the title','The item, the customer\'s name and phone number','Their home address'], 1],
      ['A scanned item says "Special order for Sam". Where does it go?', ['On the regular shelf','On the hold shelf with Sam\'s name','Back in the box'], 1]]},
    {id:'service', ic:'😊', t:'Customer service', for:'staff', min:4, lessons:[
      ['Help them find it', 'Walk them to the item when you can instead of pointing. If we don\'t have it, offer to order it or suggest something close.'],
      ['Returns and complaints', 'Listen to the whole story without arguing, say sorry that it happened, and follow the store\'s return rules. If it is outside the rules, ask a manager instead of saying no yourself.'],
      ['Upset customers', 'Stay calm and keep your voice low. You never have to put up with threats or abuse: get a manager, and if you feel unsafe, step away.'],
      ['Remember what they ask for', 'Log requests in A customer asked. It is how the store decides what to stock.']],
      quiz:[
      ['A customer wants to return something past the return window. What do you do?', ['Say no and walk away','Listen, then ask a manager','Give cash back from the drawer'], 1],
      ['A customer asks for something we don\'t carry. What helps most?', ['Say we don\'t have it','Offer to order it and log it in A customer asked','Send them to another store'], 1]]},
    {id:'openclose', ic:'🔑', t:'Opening and closing', for:'staff', min:3, lessons:[
      ['Use the checklist', 'Opening and closing steps are in Today\'s checklist. Tick each step as you do it. If you cannot do one, tap "Report not done" and say why.'],
      ['Clock in and out', 'Tap in on the store tablet with your PIN to clock in. Clock out before you leave, and count the cash drawer out first if you had it.'],
      ['Locking up', 'Check the back door, bathrooms and lights, and make sure no one is still in the store before you lock the front.']],
      quiz:[
      ['You cannot finish a closing step. What do you do?', ['Skip it quietly','Tap "Report not done" and say why','Tick it anyway'], 1],
      ['What comes before clocking out if you ran the register?', ['Count the cash drawer out','Nothing','Turn off the lights'], 0]]},
    {id:'safety', ic:'🛟', t:'Safety', for:'staff', min:3, lessons:[
      ['You come first', 'If anyone threatens you or demands money, do what they ask and stay safe. Call 911 when it is safe, then the manager.'],
      ['Emergencies', 'Know where the first aid kit, fire extinguisher and exits are. In a fire, get everyone out and call 911 from outside.'],
      ['Slips and lifting', 'Clean up spills right away or block them off. Lift boxes with your legs, and split heavy boxes instead of straining.'],
      ['Report it', 'Tell a manager about any injury, even a small one, the same day.']],
      quiz:[
      ['Someone demands the money in the drawer. What do you do?', ['Refuse','Give it and stay safe, then call 911 and the manager','Chase them'], 1],
      ['You cut your hand on a box cutter. It is small. What do you do?', ['Nothing','Treat it and tell a manager the same day','Wait until your next shift'], 1]]},
    {id:'pos', ic:'🧾', t:'The register (Shopify POS)', for:'staff', min:3, lessons:[
      ['Ringing up', 'Scan each item. If it will not scan, search by title or type the barcode. Check the total with the customer before they pay.'],
      ['Discounts', 'Only use the discounts the store allows, and only when they apply. Ask a lead if you are not sure.'],
      ['Cash', 'Count change back to the customer. Keep large bills on top of the drawer until the sale is done.']],
      quiz:[
      ['An item will not scan. What do you do?', ['Guess the price','Search for it by title or type the barcode','Give it away'], 1]]},
    {id:'ordering', ic:'🗂️', t:'Ordering from vendors', for:'manager', min:4, lessons:[
      ['What to reorder', 'Check the "Out or running low" list on Home and the reorder hints on the Shopify screen. Customer requests come first.'],
      ['Placing orders', 'Use the vendor\'s own site or rep. Add the order in Receiving so the front desk can check it in when it comes.'],
      ['Finishing a delivery', 'After the front desk checks a box in, open it in Receiving, review short and damaged items, and finish it so costs and stock are right.']],
      quiz:[
      ['Why add an order in Receiving when you place it?', ['So the front desk can check it in','It is not needed','To pay the bill'], 0]]},
    {id:'policies', ic:'📋', t:'Store policies', for:'staff', min:3, ownerFirst:true, lessons:[
      ['Returns', 'Owner: write your return rule here (for example, receipt within 30 days for store credit).'],
      ['Dress and phones', 'Owner: what to wear, and when phones are fine.'],
      ['Calling in', 'Owner: who to call and how early if you are sick or late.']],
      quiz:[]}
  ];
  const CASH = {id:'cash', ic:'💵', t:'Cash handling', for:'staff', min:5, link:'#/cashtrain'};

  const courses = () => { const t = TR(), type = A.btype && A.btype().id;
    return [CASH, ...BUILT.map(c => t.edits[c.id] ? {...c, ...t.edits[c.id], edited:true} : c), ...t.custom]
      .filter(c => !c.types || !type || c.types.includes(type)); };
  const visible = c => !TR().hidden[c.id] && RANK[S().tier] >= RANK[c.for || 'staff'] && !(c.ownerFirst && !c.edited && !isOwner());
  const passed = (c, n) => c.id === 'cash' ? (S().till && S().till.trained && S().till.trained[n]) : (TR().done[c.id] || {})[n];

  function list(v){
    const me = actor();
    v.append(head('Training', 'Training', 'Short courses for your job. Read the lessons, then answer a few questions.'));
    const all = courses().filter(visible);
    v.append(h('div',{class:'list'}, all.map(c => { const p = passed(c, me.n);
      return h('a',{class:'item',href:c.link || '#/course/'+c.id,style:'display:block;text-decoration:none;color:inherit;padding:.9rem'},
        h('b',{style:'font-size:1.1rem'}, (c.ic || '🎓')+' '+c.t), ' ',
        p ? h('span',{class:'chip calm'},'Done') : h('span',{class:'chip grey'},'About '+(c.min || 3)+' min'),
        c.for !== 'staff' ? h('span',{class:'small muted'},' · '+A.tierName(c.for)+' and up') : null,
        c.ownerFirst && !c.edited ? h('div',{class:'small muted'},'Only you see this until you fill it in.') : null); })));
    if (isMgr()) v.append(progress(all));
    if (isOwner()) v.append(ownerTools());
  }

  function progress(all){
    const names = teamHere().filter(p => p.tier !== 'owner');
    if (!names.length) return h('div',{class:'card'}, h('h2',null,'Who has finished'), h('p',{class:'small muted'},'Add your team on the Team screen and their progress shows here.'));
    return h('div',{class:'card'}, h('h2',null,'Who has finished'), h('div',{style:'overflow-x:auto'}, h('table',{class:'tbl'},
      h('thead',null, h('tr',null, h('th',null,''), all.map(c => h('th',{class:'small'}, c.t)))),
      h('tbody',null, names.map(p => h('tr',null, h('td',null,p.n), all.map(c => h('td',null, RANK[p.tier] < RANK[c.for || 'staff'] ? '' : passed(c, p.n) ? '✓' : '·'))))))));
  }

  function course(v){
    const c = courses().find(x => x.id === A.param());
    v.append(h('a',{class:'small',href:'#/training'},'← All training'));
    if (!c || !visible(c)){ v.append(h('div',{class:'card'},'That course was not found.')); return; }
    if (c.link){ location.hash = c.link; return; }
    const me = actor(), p = passed(c, me.n);
    v.append(head('Training', c.t, (c.quiz||[]).length ? 'Read it through, then answer '+c.quiz.length+' question'+(c.quiz.length > 1 ? 's' : '')+'.' : 'Read it through, then tap I\'ve read it.'));
    if (p) v.append(h('div',{class:'msg'}, '✓ '+me.n+' finished this on '+A.fmtDate(String(p).slice(0,10))+'. You can read it again any time.'));
    v.append(h('div',{class:'card'}, h('ol',{class:'grid'}, (c.lessons||[]).map(([t,b]) => h('li',null, h('b',null,t), h('p',{class:'small'},b))))));
    const pass = () => { TR().done[c.id] = TR().done[c.id] || {}; TR().done[c.id][me.n] = new Date().toISOString(); A.save(); toast('Done. Nice work!'); A.go('training'); };
    if (!(c.quiz||[]).length){ v.append(h('button',{class:'btn',type:'button',onclick:pass},'I\'ve read it')); }
    else {
      const f = h('form',{class:'card grid'}, h('h2',null,'Quick check'), c.quiz.map(([q,opts], i) => h('fieldset',{class:'grid'}, h('legend',null, (i+1)+'. '+q),
        opts.map((o, j) => h('label',{class:'checkrow'}, h('input',{type:'radio',name:'q'+i,value:String(j),required:true,onchange:touch}), o)))),
        h('button',{class:'btn',type:'submit'},'Check my answers'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), wrong = c.quiz.map(([,,a], i) => +d.get('q'+i) === a ? null : i+1).filter(Boolean);
        if (wrong.length) return toast('Not yet: look again at question'+(wrong.length > 1 ? 's ' : ' ')+wrong.join(', ')+'.'); pass(); });
      v.append(f);
    }
    if (isOwner()) v.append(h('p',null, h('a',{class:'btn ghost sm',href:'#/courseedit/'+c.id},'Edit this course')));
  }

  // ---------- owner: edit, hide, add ----------
  // Lessons are typed as "Title: text", one per paragraph. Questions as a block: the question, then each answer
  // on its own line, with a * in front of the right one; a blank line between questions.
  const lessonsText = c => (c.lessons||[]).map(([t,b]) => t+': '+b).join('\n\n');
  const quizText = c => (c.quiz||[]).map(([q,o,a]) => [q, ...o.map((x,j) => (j === a ? '* ' : '- ')+x)].join('\n')).join('\n\n');
  const parseLessons = s => s.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf(':'); return i > 0 && i < 60 ? [x.slice(0,i).trim(), x.slice(i+1).trim()] : ['', x]; });
  const parseQuiz = s => s.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(b => { const ls = b.split('\n').map(x => x.trim()).filter(Boolean);
    const q = ls[0], opts = ls.slice(1).map(x => x.replace(/^[-*•]\s*/,'')), right = ls.slice(1).findIndex(x => x.startsWith('*'));
    return [q, opts, right]; });

  function edit(v){
    v.append(h('a',{class:'small',href:'#/training'},'← All training'));
    if (!isOwner()){ v.append(h('div',{class:'card'},'Only the owner can change training.')); return; }
    const id = A.param(), t = TR(), isNew = id === 'new';
    const c = isNew ? {id:'c'+uid(), ic:'🎓', t:'', for:'staff', min:3, lessons:[], quiz:[]} : courses().find(x => x.id === id);
    if (!c || c.link){ v.append(h('div',{class:'card'},'That course can\'t be edited here.')); return; }
    const custom = isNew || t.custom.some(x => x.id === c.id);
    v.append(head('Owner · Training', isNew ? 'New course' : 'Edit: '+c.t, 'Keep lessons short. One idea each.'));
    const f = h('form',{class:'card grid'},
      h('label',null,'Course name', h('input',{type:'text',name:'t',value:c.t,required:true,maxlength:'60'})),
      h('label',null,'Who it\'s for', h('select',{name:'for'}, ['staff','lead','manager'].map(x => h('option',{value:x,selected:c.for === x}, A.tierName(x)+(x === 'staff' ? ' (everyone)' : ' and up'))))),
      h('label',null,'Lessons: "Title: text", with a blank line between lessons', h('textarea',{name:'lessons',rows:'10'}, lessonsText(c))),
      h('label',null,'Questions (optional): the question, then each answer on its own line. Put * in front of the right answer and - in front of the others. Blank line between questions.', h('textarea',{name:'quiz',rows:'8'}, quizText(c))),
      h('div',{class:'row'}, h('button',{class:'btn',type:'submit'},'Save'),
        !isNew && !custom && t.edits[c.id] ? h('button',{class:'btn ghost',type:'button',onclick:()=>{ delete t.edits[c.id]; A.save(); toast('Back to the original'); A.go('training'); }},'Back to the original') : null,
        custom && !isNew ? h('button',{class:'btn ghost',type:'button',onclick:()=>{ if (!confirm('Delete this course?')) return; t.custom = t.custom.filter(x => x.id !== c.id); A.save(); A.go('training'); }},'Delete course') : null));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f);
      const quiz = parseQuiz(String(d.get('quiz')||'')), bad = quiz.findIndex(([q,o,a]) => !q || o.length < 2 || a < 0);
      if (bad >= 0) return toast('Question '+(bad+1)+' needs at least two answers, with a * in front of the right one.');
      const out = {t:String(d.get('t')).trim(), for:String(d.get('for')), lessons:parseLessons(String(d.get('lessons')||'')), quiz};
      out.min = Math.max(2, Math.round((out.lessons.length + out.quiz.length) * 0.7));
      if (custom){ const x = t.custom.find(y => y.id === c.id); if (x) Object.assign(x, out); else t.custom.push({id:c.id, ic:'🎓', ...out}); }
      else t.edits[c.id] = out;
      A.save(); toast('Saved'); location.hash = '#/course/'+c.id; });
    v.append(f);
  }

  function ownerTools(){
    const t = TR();
    return h('div',{class:'card'}, h('h2',null,'Your courses'), h('p',{class:'small muted'},'Edit any course to match how your store works, hide ones that don\'t fit, or add your own.'),
      h('div',{class:'list'}, courses().map(c => h('div',{class:'item'}, h('b',null,c.t), c.for !== 'staff' ? h('span',{class:'small muted'},' · '+A.tierName(c.for)+' and up') : null,
        h('div',{class:'row'},
          c.link ? h('span',{class:'small muted'},'Lives in Cash drawer') : h('a',{class:'btn quiet sm',href:'#/courseedit/'+c.id},'Edit'),
          h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ if (t.hidden[c.id]) delete t.hidden[c.id]; else t.hidden[c.id] = true; A.save(); A.route(); }}, t.hidden[c.id] ? 'Show it' : 'Hide it'))))),
      h('a',{class:'btn',href:'#/courseedit/new'},'Add a course'));
  }

  A.register({id:'training', name:'Training', what:'Short courses for every job with a quick check: front desk, special orders, customer service, opening and closing, safety, the register, cash and ordering. The owner can edit them and add their own.', tiers:['staff','lead','manager','owner'],
    views:{training:{t:'Training', ic:'🎓', render:list}, course:{t:'Course', ic:'🎓', render:course, hidden:true}, courseedit:{t:'Edit course', ic:'🎓', render:edit, hidden:true, min:'owner'}}});
})();
