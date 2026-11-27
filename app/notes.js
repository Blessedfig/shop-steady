// Notes and logs: write a quick note in your own words, then turn it into a clear, professional note for the record.
// "edna ate here" becomes "Edna ate lunch in the store at about 12:30 PM." The original words are always kept next to it.
// A.polishButton(field, ctx) adds the same "Make it professional" helper to any text box in other modules.
// The rewrite runs in the Supabase Edge Function "note-polish" (supabase/functions/note-polish). Until the owner adds
// the AI key, or in demo mode, the button does a basic tidy only (capital letters, common shorthand spelled out).
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, download, toCsv, isoDay, uid} = A;
  const S = () => A.state();
  const MGR = ['lead','manager','owner'];
  const isMgr = () => MGR.includes(S().tier);
  const KINDS = {update:'Shift log update', customer:'Customer or guest', incident:'Incident', staff:'Employee file note', task:'Task not done', vendor:'Supplier or vendor'};
  const PRIVATE = ['staff']; // employee file notes: managers and owners only

  // ---------- basic tidy, used when AI help is not set up ----------
  const SHORT = [[/\bw\/o\b/gi,'without'],[/\bw\//gi,'with '],[/\bw (?=[a-z])/gi,'with '],[/\bb\/c\b/gi,'because'],[/\bcust\b/gi,'customer'],[/\bmgr\b/gi,'manager'],[/\bapprox\b\.?/gi,'approximately'],
    [/\bpls\b/gi,'please'],[/\bppl\b/gi,'people'],[/\bthru\b/gi,'through'],[/\bu\b/g,'you'],[/\bbc\b/gi,'because'],[/\bidk\b/gi,'I do not know'],[/\b(\d{1,2})\s*-\s*(\d{1,2})\s*(am|pm)\b/gi,'$1 to $2 $3']];
  function tidy(t){
    let s = String(t||'').replace(/\s+/g,' ').trim(); SHORT.forEach(([re,to]) => s = s.replace(re,to));
    s = s.replace(/\s+([.,!?])/g,'$1').replace(/(^|[.!?]\s+)([a-z])/g, (m,a,b) => a+b.toUpperCase()).replace(/\bi\b/g,'I');
    if (s && !/[.!?]$/.test(s)) s += '.';
    return s.replace(/\s+/g,' ');
  }

  // ---------- AI rewrite ----------
  async function polish(text, ctx){
    ctx = ctx || {};
    if (A.demo || !A.sb) return {note:tidy(text), missing:[], basic:true, why:'demo'};
    try {
      const {data, error} = await A.sb.functions.invoke('note-polish', {body:{text, kind:ctx.kind||'update', about:ctx.about||'', when:ctx.when||'', by:ctx.by||A.me(), business:A.site().name}});
      if (error){ let code = ''; try { code = (await error.context.json()).error; } catch(_){}
        return {note:tidy(text), missing:[], basic:true, why: code === 'not-configured' ? 'nokey' : 'error'}; }
      return data;
    } catch(e){ return {note:tidy(text), missing:[], basic:true, why:'offline'}; }
  }
  const WHY = {demo:'This is a basic tidy. Full rewriting turns on once you sign in and the owner connects AI writing help.', nokey:'This is a basic tidy. The owner can turn on full rewriting by adding the AI key in Supabase.', error:'Couldn\'t reach the writing helper, so this is a basic tidy.', offline:'You look offline, so this is a basic tidy.'};

  // Adds "Make it professional" under a text box. The suggestion is editable. "Use this" swaps it in and remembers
  // the original words on field.dataset.original, so the saving code can keep both.
  function polishButton(field, ctx){
    const box = h('div',{class:'polish'});
    const btn = h('button',{class:'btn ghost sm',type:'button'},'✨ Make it professional');
    btn.addEventListener('click', async () => {
      const text = field.value.trim(); if (!text) return toast('Write a quick note first');
      btn.disabled = true; btn.textContent = 'Writing…';
      const c = typeof ctx === 'function' ? ctx() : ctx, r = await polish(text, c);
      btn.disabled = false; btn.textContent = '✨ Make it professional';
      if (r.error || !r.note) return toast('That didn\'t work. Your words are still here.');
      const out = h('textarea',{rows:'4','aria-label':'Professional version'}, r.note);
      box.replaceChildren(h('div',{class:'card inset grid'},
        h('b',null,'Suggested version (you can edit it)'), out,
        r.missing && r.missing.length ? h('div',{class:'small'}, h('b',null,'A good record would also say:'), h('ul',null, r.missing.map(q => h('li',null,q)))) : null,
        r.basic ? h('p',{class:'small muted'}, WHY[r.why] || WHY.error) : h('p',{class:'small muted'},'Check it says only what happened. Your original words are kept with the note.'),
        h('div',{class:'row'},
          h('button',{class:'btn sm',type:'button',onclick:()=>{ if (!field.dataset.original) field.dataset.original = text; field.value = out.value.trim(); box.replaceChildren(btn); field.focus(); toast('Using the professional version'); }},'Use this'),
          h('button',{class:'btn quiet sm',type:'button',onclick:()=>box.replaceChildren(btn)},'Keep mine'))));
    });
    box.append(btn);
    return box;
  }
  A.polish = polish; A.polishButton = polishButton; A.tidy = tidy;

  // ---------- Notes and logs view ----------
  function N(){ const s = S(); s.notes = s.notes || []; return s.notes; }
  const pad = n => String(n).padStart(2,'0');
  const localNow = () => { const d = new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); };
  const fmtWhen = w => { const d = new Date(w); return isNaN(d) ? w : A.fmtTime(d.toISOString()); };
  function names(){ const s = S(), out = new Set();
    ((s.shifts && s.shifts.team && s.shifts.team[s.site]) || []).forEach(p => out.add(p.n));
    ((s.people && s.people.customers && s.people.customers[s.site]) || []).forEach(c => out.add(c.n));
    return [...out]; }

  function view(v){
    v.append(head('Notes · '+A.site().name, 'Notes and logs', 'Jot it down the way you\'d say it, then tap Make it professional for a clean version for the record. Both are kept.'));
    const kinds = Object.entries(KINDS).filter(([k]) => isMgr() || !PRIVATE.includes(k));
    const text = h('textarea',{name:'text',rows:'4',maxlength:'4000',required:true,placeholder:'e.g. edna ate here, left w her guardian 3-5pm'});
    const f = h('form',{class:'card grid'},
      h('label',{class:'f'},'Type', h('select',{name:'kind'}, kinds.map(([k,t]) => h('option',{value:k},t)))),
      h('label',{class:'f'},'About (optional)', h('input',{type:'text',name:'about',maxlength:'80',list:'noteNames',placeholder:'A person, customer, guest, room or item'})),
      h('datalist',{id:'noteNames'}, names().map(n => h('option',{value:n}))),
      h('label',{class:'f'},'When', h('input',{type:'datetime-local',name:'when',value:localNow(),required:true})),
      h('label',{class:'f'},'Note', text),
      polishButton(text, () => { const d = new FormData(f); return {kind:d.get('kind'), about:d.get('about'), when:fmtWhen(d.get('when'))}; }),
      h('button',{class:'btn',type:'submit'},'Save note'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), t = String(d.get('text')).trim(); if (!t) return;
      N().unshift({id:uid(), site:S().site, at:new Date().toISOString(), when:String(d.get('when')), kind:String(d.get('kind')), about:String(d.get('about')||'').trim(), by:A.me(), text:t, original:text.dataset.original && text.dataset.original !== t ? text.dataset.original : ''});
      if (N().length > 500) N().length = 500;
      A.save(); toast('Note saved'); A.route(); });
    v.append(f);

    const me = A.me();
    let list = N().filter(x => x.site === S().site && (isMgr() ? true : (x.by === me && !PRIVATE.includes(x.kind))));
    const filt = h('input',{type:'search','aria-label':'Search notes',placeholder:'Search notes or a name'});
    const body = h('div',{class:'list'});
    const draw = () => { const q = filt.value.trim().toLowerCase(), rows = q ? list.filter(x => (x.text+' '+x.about+' '+x.by).toLowerCase().includes(q)) : list;
      body.replaceChildren(...(rows.length ? rows.slice(0,100).map(x => h('div',{class:'item'},
        h('span',{class:'small muted'}, KINDS[x.kind]+(x.about ? ' · '+x.about : '')+' · '+fmtWhen(x.when)+' · by '+x.by),
        h('p',null,x.text),
        x.original ? h('details',{class:'small muted'}, h('summary',null,'Original words'), h('p',null,x.original)) : null,
        h('div',{class:'row'}, h('button',{class:'linkbtn small',type:'button',onclick:()=>A.copy(fmtWhen(x.when)+(x.about ? ' · '+x.about : '')+'\n'+x.text+'\n(Written by '+x.by+')')},'Copy for a report')))) : [h('p',{class:'muted'},'No notes yet.')])); };
    filt.addEventListener('input', draw); draw();
    v.append(h('div',{class:'card'}, h('h2',null, isMgr() ? 'All notes' : 'Your notes'), filt, body,
      isMgr() && list.length ? h('div',{class:'row'}, h('button',{class:'btn quiet sm',type:'button',onclick:()=>download('notes-'+isoDay(new Date())+'.csv','text/csv',toCsv([['When','Type','About','Written by','Note','Original words'], ...list.map(x => [x.when,KINDS[x.kind],x.about,x.by,x.text,x.original])]))},'Download (.csv)')) : null));
  }

  A.register({id:'notes', name:'Notes and logs', what:'Quick notes in your own words, turned into professional notes for shift logs, customers, incidents and employee files. The original words are kept.', tiers:['lead','manager','owner'],
    views:{notes:{t:'Notes', ic:'📝', render:view}}});
})();
