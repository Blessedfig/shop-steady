// Ask: a chat assistant for the whole team. Questions about the store ("who's working Saturday?", "what should I
// reorder from Penguin?", "how do I do a safe drop?") are answered from the store's own data by the Edge Function
// "ask" (supabase/functions/ask), which reads only what the asker's level may see. It never changes anything.
// Each person has a daily question limit the owner sets here (Setup card below). The conversation stays on this
// device until the page is closed; nothing is saved to the shared data.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast} = A;
  const S = () => A.state();
  const chat = []; // {role, content}
  let left = null;
  const EXAMPLES = ['Who is working this Saturday?', 'How do I count the drawer out?', 'What is on the closing checklist?', 'What should we reorder this week?'];

  async function send(q, box, input, btn){
    q = q.trim(); if (!q) return;
    chat.push({role:'user', content:q}); input.value = ''; draw(box);
    const wait = h('div',{class:'item askmsg bot'}, h('p',{class:'muted'},'Thinking…')); box.append(wait); wait.scrollIntoView({block:'end'});
    btn.disabled = true;
    try {
      if (A.demo || !A.sb){ chat.push({role:'assistant', content:'Ask answers from your store\'s real data once you sign in. In the demo it can\'t look anything up.'}); return; }
      const now = new Date();
      const {data, error} = await A.sb.functions.invoke('ask', {body:{messages:chat, site:S().site, today:now.toDateString()+' '+now.toTimeString().slice(0,5)}});
      if (error){ let j = {}; try { j = await error.context.json(); } catch(e){}
        chat.pop();
        const m = j.error === 'limit' ? 'You\'ve used today\'s '+j.limit+' questions. It resets tomorrow; the owner can raise the limit.'
          : j.error === 'not-configured' ? 'The assistant isn\'t switched on yet (the owner adds the AI key in Supabase).'
          : j.error === 'busy' ? 'The assistant is busy. Try again in a minute.' : 'Could not reach the assistant. Check your internet and try again.';
        toast(m); input.value = q; return; }
      chat.push({role:'assistant', content:data.answer}); left = data.limit - data.used;
    } finally { btn.disabled = false; draw(box); }
  }
  function draw(box){
    box.replaceChildren(...(chat.length ? chat.map(m => h('div',{class:'item askmsg '+(m.role === 'user' ? 'me' : 'bot')},
      h('span',{class:'small muted'}, m.role === 'user' ? 'You' : 'Ask'), h('p',{style:'white-space:pre-wrap'}, m.content)))
      : [h('p',{class:'muted'},'Ask anything about the store, the schedule, or how to do something in the app.')]));
    if (box.lastChild) box.lastChild.scrollIntoView({block:'end'});
  }
  function view(v){
    v.append(head('Assistant', 'Ask a question', 'Answers come from the store\'s own data, only what you\'re allowed to see. It can\'t change anything.'));
    const box = h('div',{class:'list asklist'}), input = h('textarea',{rows:'2',maxlength:'1000','aria-label':'Your question',placeholder:'Type your question'});
    const btn = h('button',{class:'btn',type:'submit'},'Ask');
    const f = h('form',{class:'row',style:'align-items:flex-end'}, input, btn);
    f.addEventListener('submit', e => { e.preventDefault(); send(input.value, box, input, btn); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(input.value, box, input, btn); } });
    draw(box);
    v.append(h('div',{class:'card'}, box, f,
      chat.length ? null : h('div',{class:'row'}, EXAMPLES.map(x => h('button',{class:'btn quiet sm',type:'button',onclick:()=>send(x, box, input, btn)}, x))),
      h('div',{class:'row'},
        left != null ? h('span',{class:'small muted'}, left+' questions left today') : null,
        chat.length ? h('button',{class:'linkbtn small',type:'button',onclick:()=>{ chat.length = 0; A.route(); }},'New conversation') : null)));
    if (S().tier === 'owner') v.append(limitCard());
  }
  function limitCard(){
    const cur = (S().setup && S().setup.ask && S().setup.ask.perDay) || 30;
    const inp = h('input',{type:'number',min:'0',max:'500',step:'1',value:String(cur),style:'max-width:6rem','aria-label':'Questions per person per day'});
    return h('div',{class:'card'}, h('h2',null,'Daily limit'),
      h('p',{class:'small muted'},'How many questions each person can ask per day. You always get at least 100. It runs on Claude Haiku, the low-cost model: a typical question costs well under a cent. You can also set a monthly spending cap in the Anthropic console.'),
      h('div',{class:'row'}, inp, h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ const n = Math.max(0, Math.min(500, parseInt(inp.value,10) || 0));
        S().setup.ask = {perDay:n}; A.save(); toast('Limit saved: '+n+' a day'); }},'Save')));
  }

  A.register({id:'ask', name:'Ask (AI assistant)', what:'A chat assistant that answers questions from the store\'s data and explains how to use the app. Read-only, with a daily question limit per person.', tiers:['staff','lead','manager','owner'],
    views:{ask:{t:'Ask', ic:'🙋', render:view}}});
})();
