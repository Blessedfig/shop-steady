// Cash drawer (till) and safe.
//   - Per shift: whoever runs the register counts the drawer in (the set starting float), logs paid-outs and safe
//     drops during the shift, and counts it out at the end. The app works out what should be there:
//       counted in + cash sales from the register - cash refunds - paid-outs - drops
//     and shows over or short for that person's shift. Beyond the allowed amount, managers and the owner are told.
//   - Counting in and out is required for employees: store mode won't clock someone out while they still hold the
//     drawer. For the owner it is optional.
//   - Only someone who passed Cash training can count a drawer in.
//   - Safe log (store manager and owner): drops waiting to be checked, deposits to the bank, other money out and
//     safe counts. It is a private area in the database (supabase/private-areas.sql), so staff phones never get it.
// Shopify POS does its own cash tracking too; this keeps the per-person record and the paper trail around it.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, uid, isoDay} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'], RANK = {staff:1, lead:2, manager:3, owner:4};
  const DENOMS = [['b100',100,'$100 bills'],['b50',50,'$50 bills'],['b20',20,'$20 bills'],['b10',10,'$10 bills'],['b5',5,'$5 bills'],['b1',1,'$1 bills'],
                  ['c25',0.25,'Quarters'],['c10',0.10,'Dimes'],['c5',0.05,'Nickels'],['c1',0.01,'Pennies'],['roll',1,'Rolled coins ($ total)']];
  const r2 = n => Math.round(n*100)/100;

  function T(){ const s = S(); s.till = s.till || {}; const t = s.till; t.sites = t.sites || {};
    const st = t.sites[s.site] = t.sites[s.site] || {}; st.float = st.float == null ? 150 : st.float; st.cap = st.cap == null ? 300 : st.cap; st.allow = st.allow == null ? 5 : st.allow;
    st.sessions = st.sessions || []; t.trained = t.trained || {}; return st; }
  const SAFE = () => { const s = S(); s.safe = s.safe || {}; const sf = s.safe[s.site] = s.safe[s.site] || {}; sf.log = sf.log || []; sf.checked = sf.checked || {}; return sf; };

  // who is acting: the person tapped in on the store tablet, or the signed-in person's level
  const tapped = () => { const k = S().kioskWho; return k && Date.now() - k.at < 120000 ? k : null; };
  const teamHere = () => ((S().shifts && S().shifts.team && S().shifts.team[S().site]) || []);
  const actor = () => { const k = tapped(); if (k){ const p = teamHere().find(x => x.n === k.n); return {n:k.n, tier:p ? p.tier : 'staff'}; }
    return {n:A.me(), tier:S().tier}; };
  const touch = () => { const k = S().kioskWho; if (k){ k.at = Date.now(); A.save(true); } }; // counting takes a while: keep them tapped in
  const isMgr = () => MGR.includes(actor().tier);
  const trained = n => !!T() && !!S().till.trained[n];
  const openSession = () => T().sessions.find(x => !x.closeAt);
  const sum = (x, k) => x.events.filter(e => e.k === k).reduce((a,e) => a + e.amt, 0);
  const expected = x => r2(x.inTotal + (x.sales||0) - (x.refunds||0) - sum(x,'payout') - sum(x,'drop'));
  // Store mode asks this before clocking someone out.
  A.tillHolds = n => { const o = openSession(); return !!(o && o.who === n); };

  function countForm(label, onDone, hint){
    const total = h('b',null,'$0.00'), f = h('form',{class:'grid'});
    const calc = () => { const d = new FormData(f); let t = 0; DENOMS.forEach(([k,v]) => t += (+d.get(k) || 0) * v); total.textContent = money(r2(t)); return r2(t); };
    f.append(hint ? h('p',{class:'small muted'}, hint) : '', h('div',{class:'grid g3'}, DENOMS.map(([k,,l]) => h('label',{class:'f'}, l, h('input',{type:'number',name:k,min:'0',step:k === 'roll' ? '0.01' : '1',inputmode:k === 'roll' ? 'decimal' : 'numeric',oninput:()=>{ calc(); touch(); }})))),
      h('p',{class:'big'}, 'Total: ', total), h('button',{class:'btn',type:'submit'}, label));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), c = {}; DENOMS.forEach(([k]) => { const n = +d.get(k) || 0; if (n) c[k] = n; }); onDone(calc(), c); });
    return f;
  }

  // ---------- the drawer ----------
  function drawer(v){
    const st = T(), me = actor(), o = openSession();
    v.append(head('Cash · '+A.site().name, 'Cash drawer', 'Count in at the start of your shift, count out at the end. One person per drawer per shift.'));
    if (!trained(me.n) && !(o && o.who === me.n)){
      v.append(h('div',{class:'card'}, h('h2',null,'Cash training first'), h('p',null,'Before you run the register, take the short cash training (about 5 minutes).'), h('a',{class:'btn',href:'#/cashtrain'},'Start cash training')));
      if (!isMgr()) return;
    }
    if (!o){
      const prev = st.sessions.filter(x => x.closeAt).slice(-1)[0];
      const card = h('div',{class:'card grid'}, h('h2',null,'Count the drawer in'),
        h('p',null,'The drawer should start with '+money(st.float)+(prev && prev.left != null ? ' (the last shift left '+money(prev.left)+')' : '')+'. Count every bill and coin.'));
      if (trained(me.n) || isMgr()) card.append(countForm('Start my drawer', (tot, c) => {
        const want = prev && prev.left != null ? prev.left : st.float;
        st.sessions.push({id:uid(), site:S().site, who:me.n, inAt:new Date().toISOString(), inTotal:tot, inCount:c, inWant:want, events:[], sales:null, refunds:null});
        A.save(); toast(Math.abs(tot - want) > 0.004 ? 'Started. It is '+money(Math.abs(tot - want))+(tot > want ? ' over' : ' short')+' what should be there, so a manager will see a note.' : 'Drawer started. It matches.'); A.route();
      }));
      v.append(card);
    } else {
      const mine = o.who === me.n;
      v.append(h('div',{class:'card'}, h('h2',null, (mine ? 'Your drawer' : o.who+' has the drawer')+' since '+A.fmtTime(o.inAt)),
        h('p',null,'Counted in: '+money(o.inTotal)+(Math.abs(o.inTotal - o.inWant) > 0.004 ? ' ('+money(Math.abs(o.inTotal - o.inWant))+(o.inTotal > o.inWant ? ' over' : ' short')+' at the start)' : '')),
        o.events.length ? h('ul',null, o.events.map(e => h('li',null, A.fmtTime(e.at)+' · '+(e.k === 'payout' ? 'Paid out ' : 'Safe drop ')+money(e.amt)+(e.note ? ' · '+e.note : '')))) : h('p',{class:'small muted'},'No paid-outs or drops yet.')));
      if (!mine && !isMgr()){ v.append(h('p',{class:'muted'},'Only the person who counted it in uses this drawer. If you are taking over, '+o.who+' counts it out first.')); return; }
      // paid-out and drop
      const ev = k => { const f = h('form',{class:'grid'},
          h('label',{class:'f'}, k === 'payout' ? 'Amount paid out ($)' : 'Amount in the envelope ($)', h('input',{type:'number',name:'amt',min:'0.01',step:'0.01',required:true,oninput:touch})),
          h('label',{class:'f'}, k === 'payout' ? 'What for (put the receipt or slip in the drawer)' : 'Envelope note (write date, time, amount and your initials on it)', h('input',{type:'text',name:'note',maxlength:'100',required:k === 'payout',oninput:touch})),
          h('button',{class:'btn sm',type:'submit'}, k === 'payout' ? 'Log paid-out' : 'Log safe drop'));
        f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f); o.events.push({id:uid(), k, amt:r2(+d.get('amt')), note:String(d.get('note')||'').trim(), at:new Date().toISOString(), by:me.n}); A.save(); toast(k === 'payout' ? 'Paid-out logged' : 'Drop logged. Put the envelope in the drop safe now.'); A.route(); });
        return f; };
      v.append(h('div',{class:'grid g2'},
        h('details',{class:'card'}, h('summary',null, h('b',null,'Paid out of the drawer')), ev('payout')),
        h('details',{class:'card'}, h('summary',null, h('b',null,'Drop to the safe')), h('p',{class:'small muted'},'When the drawer holds more than '+money(st.cap)+' in bills, drop the extra large bills.'), ev('drop'))));
      // count out
      const sales = h('input',{type:'number',name:'sales',min:'0',step:'0.01',required:true,oninput:touch}), refunds = h('input',{type:'number',name:'refunds',min:'0',step:'0.01',value:'0',oninput:touch});
      const outCard = h('div',{class:'card grid'}, h('h2',null,'Count the drawer out'),
        h('p',{class:'small muted'},'From the register (Shopify POS): the cash taken in and cash refunds given during your shift. Then count everything in the drawer.'),
        h('label',{class:'f'},'Cash sales on the register this shift ($)', sales), h('label',{class:'f'},'Cash refunds given ($)', refunds));
      outCard.append(countForm('Finish my drawer', (tot, c) => {
        if (sales.value === ''){ sales.focus(); return toast('Add the cash sales from the register first'); }
        o.sales = r2(+sales.value); o.refunds = r2(+refunds.value || 0);
        o.outTotal = tot; o.outCount = c; o.expected = expected(o); o.diff = r2(tot - o.expected); o.closeAt = new Date().toISOString(); o.closedBy = me.n;
        // leave the float for the next shift; the rest goes to the safe in a deposit envelope
        o.left = Math.min(tot, st.float); o.toSafe = r2(tot - o.left);
        A.save();
        const msg = Math.abs(o.diff) < 0.005 ? 'Balanced. ' : (o.diff > 0 ? money(o.diff)+' over. ' : money(-o.diff)+' short. ');
        toast(msg + (o.toSafe > 0 ? 'Leave '+money(o.left)+' in the drawer and put '+money(o.toSafe)+' in a deposit envelope in the safe.' : 'Leave it all in the drawer.')); A.route();
      }, 'Count after you take the reading from the register.'));
      v.append(outCard);
    }
    // history: your own shifts, or everyone's for managers
    const hist = st.sessions.filter(x => x.closeAt && (isMgr() || x.who === me.n)).slice(-30).reverse();
    v.append(h('div',{class:'card'}, h('h2',null, isMgr() ? 'Recent shifts' : 'Your recent shifts'), hist.length ? h('div',{class:'list'}, hist.map(x => h('div',{class:'item'},
      h('b',null, x.who+' · '+A.fmtTime(x.inAt)+' to '+A.fmtTime(x.closeAt)),
      h('span',{class:'small'}, 'In '+money(x.inTotal)+' · sales '+money(x.sales)+(x.refunds ? ' · refunds '+money(x.refunds) : '')+(sum(x,'payout') ? ' · paid out '+money(sum(x,'payout')) : '')+(sum(x,'drop') ? ' · drops '+money(sum(x,'drop')) : '')+' · expected '+money(x.expected)+' · counted '+money(x.outTotal)),
      h('span',null, h('span',{class:'chip '+(Math.abs(x.diff) < 0.005 ? 'calm' : Math.abs(x.diff) > st.allow ? 'red' : 'amber')}, Math.abs(x.diff) < 0.005 ? 'Balanced' : money(Math.abs(x.diff))+(x.diff > 0 ? ' over' : ' short')),
        x.note ? h('span',{class:'small muted'},' '+x.note) : null),
      isMgr() && Math.abs(x.diff) > st.allow && !x.note ? h('form',{class:'row',onsubmit:e=>{ e.preventDefault(); x.note = 'Reviewed by '+actor().n+': '+String(new FormData(e.target).get('n')).trim(); A.save(); A.route(); }},
        h('input',{type:'text',name:'n',maxlength:'140',required:true,'aria-label':'What happened',placeholder:'What happened (talked it through, recount...)'}), h('button',{class:'btn sm',type:'submit'},'Mark reviewed')) : null))) : h('p',{class:'muted'},'No finished shifts yet.')));
    if (isMgr()){
      v.append(h('details',{class:'card'}, h('summary',null, h('b',null,'Drawer settings')),
        h('form',{class:'grid',onsubmit:e=>{ e.preventDefault(); const d = new FormData(e.target); st.float = +d.get('float') || 0; st.cap = +d.get('cap') || 0; st.allow = +d.get('allow') || 0; A.save(); toast('Saved'); A.route(); }},
          h('label',{class:'f'},'Starting float ($)', h('input',{type:'number',name:'float',min:'0',step:'1',value:String(st.float)})),
          h('label',{class:'f'},'Drop to the safe above ($ in bills)', h('input',{type:'number',name:'cap',min:'0',step:'10',value:String(st.cap)})),
          h('label',{class:'f'},'Tell me when over or short by more than ($)', h('input',{type:'number',name:'allow',min:'0',step:'1',value:String(st.allow)})),
          h('button',{class:'btn sm',type:'submit'},'Save'))));
    }
  }

  // ---------- safe (manager and owner) ----------
  function safe(v){
    v.append(head('Cash · '+A.site().name, 'Safe log', 'Every dollar into and out of the safe, with who and when. Only the store manager and owner see this.'));
    if (!MGR.includes(S().tier)){ v.append(h('div',{class:'card'},'Only the store manager and owner see the safe.')); return; }
    const st = T(), sf = SAFE(), me = actor().n;
    // drops come from the drawer: mid-shift drops and the deposit envelope at count-out
    const drops = [];
    st.sessions.forEach(x => { x.events.filter(e => e.k === 'drop').forEach(e => drops.push({id:e.id, at:e.at, amt:e.amt, who:e.by, what:'Drop'+(e.note ? ' · '+e.note : '')}));
      if (x.closeAt && x.toSafe > 0) drops.push({id:x.id+'-close', at:x.closeAt, amt:x.toSafe, who:x.closedBy || x.who, what:'End of shift deposit envelope'}); });
    const lastCount = sf.log.filter(e => e.k === 'count').sort((a,b) => a.at.localeCompare(b.at)).slice(-1)[0];
    const since = lastCount ? lastCount.at : '';
    const inSince = drops.filter(d => d.at > since).reduce((a,d) => a + d.amt, 0), outSince = sf.log.filter(e => e.at > since && (e.k === 'deposit' || e.k === 'out')).reduce((a,e) => a + e.amt, 0);
    const bal = r2((lastCount ? lastCount.amt : 0) + inSince - outSince);
    v.append(h('div',{class:'card'}, h('h2',null,'Should be in the safe: '+money(bal)), h('p',{class:'small muted'}, lastCount ? 'From the count on '+A.fmtDate(lastCount.at.slice(0,10))+' ('+money(lastCount.amt)+' by '+lastCount.by+'), plus drops, minus deposits and money taken out since.' : 'Count the safe once to set the starting balance.')));
    const pending = drops.filter(d => !sf.checked[d.id]).sort((a,b) => b.at.localeCompare(a.at));
    v.append(h('div',{class:'card'}, h('h2',null,'Envelopes to check'), h('p',{class:'small muted'},'Open each envelope with a second person if you can, count it, and confirm.'),
      pending.length ? h('div',{class:'list'}, pending.map(d => h('div',{class:'item'}, h('b',null, money(d.amt)+' · '+d.what), h('span',{class:'small muted'}, A.fmtTime(d.at)+' · '+d.who),
        h('form',{class:'row',onsubmit:e=>{ e.preventDefault(); const c = r2(+new FormData(e.target).get('c')); sf.checked[d.id] = {amt:c, by:me, at:new Date().toISOString()};
          if (Math.abs(c - d.amt) > 0.004) sf.log.push({id:uid(), k:'adjust', amt:r2(c - d.amt), note:'Envelope '+money(d.amt)+' counted '+money(c)+' ('+d.who+')', at:new Date().toISOString(), by:me});
          A.save(); A.route(); }},
          h('input',{type:'number',name:'c',min:'0',step:'0.01',value:String(d.amt),'aria-label':'Counted amount',style:'width:8em'}), h('button',{class:'btn sm',type:'submit'},'Counted'))))) : h('p',{class:'muted'},'Nothing waiting.')));
    const f = h('form',{class:'card grid'}, h('h2',null,'Log safe money'),
      h('label',{class:'f'},'What', h('select',{name:'k'}, h('option',{value:'deposit'},'Bank deposit taken out'), h('option',{value:'out'},'Other money taken out (change order, petty cash...)'), h('option',{value:'count'},'Full safe count'))),
      h('label',{class:'f'},'Amount ($)', h('input',{type:'number',name:'amt',min:'0',step:'0.01',required:true})),
      h('label',{class:'f'},'Note (deposit slip number, reason)', h('input',{type:'text',name:'note',maxlength:'120'})),
      h('button',{class:'btn',type:'submit'},'Log it'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f); const k = String(d.get('k')), amt = r2(+d.get('amt'));
      if (k === 'count' && Math.abs(amt - bal) > 0.004) sf.log.push({id:uid(), k:'adjust', amt:r2(amt - bal), note:'Safe count was '+money(amt)+', expected '+money(bal), at:new Date(Date.now()-1).toISOString(), by:me});
      sf.log.push({id:uid(), k, amt, note:String(d.get('note')||'').trim(), at:new Date().toISOString(), by:me}); A.save(); toast('Logged'); A.route(); });
    v.append(f);
    const NAMES = {deposit:'Bank deposit', out:'Taken out', count:'Safe count', adjust:'Difference'};
    const all = [...drops.map(d => ({at:d.at, t:'In · '+d.what, amt:d.amt, by:d.who})), ...sf.log.map(e => ({at:e.at, t:NAMES[e.k]+(e.note ? ' · '+e.note : ''), amt:e.k === 'count' || e.k === 'adjust' ? e.amt : -e.amt, by:e.by}))].sort((a,b) => b.at.localeCompare(a.at)).slice(0, 60);
    v.append(h('div',{class:'card'}, h('h2',null,'History'), all.length ? h('div',{class:'list'}, all.map(x => h('div',{class:'item'}, h('b',null, x.t), h('span',{class:'small muted'}, A.fmtTime(x.at)+' · '+money(x.amt)+' · '+x.by)))) : h('p',{class:'muted'},'Nothing yet.')));
  }

  // ---------- cash training ----------
  const LESSONS = [
    ['One drawer, one person', 'You count the drawer in at the start of your shift and count it out at the end. Nobody else uses your drawer. If someone takes over, you count out and they count in.'],
    ['The starting float', 'Every shift starts with the same set amount. Count every bill and coin before your first sale. If it does not match, say so in the app before you start, not later.'],
    ['Keep bills in order', 'Bills face up, all facing the same way, each kind in its own slot. Large bills ($50 and $100) go under the tray, not in a slot. Put a customer\'s bill on top of the drawer until you have given change, then put it away.'],
    ['Count change back', 'Count the change into the customer\'s hand, out loud, up from the price. Close the drawer after every sale. Never leave it open or the register unattended.'],
    ['Paid-outs need paper', 'Cash only leaves the drawer for a reason, with a receipt or a signed slip that goes in the drawer. Log it in the app right away. Never use your own money to make change, and never take money from the drawer for yourself, even to swap.'],
    ['Drop the extra', 'When the drawer has more bills than the drop limit, put the extra large bills in an envelope. Write the date, time, amount and your initials on it, log the drop, and put it in the drop safe straight away.'],
    ['Count out', 'At the end of your shift, take the cash sales and refunds from the register, then count the drawer. The app shows if you are over or short. Leave the float in the drawer and put the rest in a deposit envelope in the safe.'],
    ['Over or short', 'Small differences happen. Never fix them with your own money or by changing the count. Write down what you know. A manager will talk it through with you; honest mistakes are how we learn.'],
    ['Safety first', 'If anyone demands money, give it to them. Your safety matters more than cash. Do not count cash where customers can see it, and never say how much is in the drawer or safe.']];
  const QUIZ = [
    ['The drawer does not match the float when you count in. What do you do?', ['Start anyway and fix it at the end','Note it in the app before your first sale','Add money from the tips jar'], 1],
    ['A coworker needs to make change from your drawer during your shift. What happens?', ['They use it quickly','You count out and they count in, or you make the change yourself','They write it on a sticky note'], 1],
    ['You pay $12 for supplies from the drawer. What do you need?', ['Nothing, just remember it','A receipt or signed slip in the drawer, and log the paid-out','Take it from your own pocket'], 1],
    ['The drawer is over the drop limit. What do you do?', ['Drop the extra large bills in a marked envelope, log it, put it in the safe','Leave it until closing','Put the extra in your apron'], 0],
    ['You are $3 short at count-out. What do you do?', ['Put in $3 of your own','Count again, record it honestly and tell a manager','Change the count to match'], 1],
    ['Someone demands the money in the drawer.', ['Refuse','Give it to them and stay safe, then call 911 and the manager','Chase them'], 1]];
  function train(v){
    const me = actor();
    v.append(h('a',{class:'small',href:'#/training'},'← All training'));
    v.append(head('Training', 'Cash handling', 'How we handle the drawer and the safe. Read it through, then answer six questions. You need all six right to run the register.'));
    if (trained(me.n)) v.append(h('div',{class:'msg'}, '✓ '+me.n+' passed on '+A.fmtDate(S().till.trained[me.n].slice(0,10))+'. You can read it again any time.'));
    v.append(h('div',{class:'card'}, h('ol',{class:'grid'}, LESSONS.map(([t,b]) => h('li',null, h('b',null,t), h('p',{class:'small'},b))))));
    const f = h('form',{class:'card grid'}, h('h2',null,'Quick check'), QUIZ.map(([q,opts], i) => h('fieldset',{class:'grid'}, h('legend',null, (i+1)+'. '+q),
      opts.map((o, j) => h('label',{class:'checkrow'}, h('input',{type:'radio',name:'q'+i,value:String(j),required:true,onchange:touch}), o)))),
      h('button',{class:'btn',type:'submit'},'Check my answers'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f), wrong = QUIZ.map(([,,a], i) => +d.get('q'+i) === a ? null : i+1).filter(Boolean);
      if (wrong.length) return toast('Not yet: look again at question'+(wrong.length > 1 ? 's ' : ' ')+wrong.join(', ')+'.');
      T(); S().till.trained[me.n] = new Date().toISOString(); A.save(); toast('Passed. You can run the register now.'); A.go('till'); });
    v.append(f);
    if (MGR.includes(S().tier)){ const tr = S().till && S().till.trained || {}; const names = teamHere().filter(p => p.tier !== 'owner').map(p => p.n);
      v.append(h('div',{class:'card'}, h('h2',null,'Who has passed'), h('ul',null, names.map(n => h('li',null, n+': '+(tr[n] ? 'passed '+A.fmtDate(tr[n].slice(0,10)) : 'not yet')))))); }
  }

  // store mode: drawer status under the clock card
  A.tillCard = who => { const o = openSession(), st = T();
    if (o && o.who === who) return h('div',{class:'card'}, h('b',null,'You have the cash drawer'), h('p',{class:'small muted'},'Counted in at '+A.fmtTime(o.inAt)+' with '+money(o.inTotal)+'. Count it out before you clock out.'), h('a',{class:'btn ghost sm',href:'#/till'},'Drawer: paid-out, drop or count out'));
    if (o) return h('p',{class:'small muted'}, o.who+' has the cash drawer.');
    return h('div',{class:'card'}, h('b',null,'Running the register?'), h('p',{class:'small muted'}, trained(who) ? 'Count the drawer in first: it should hold '+money(st.float)+'.' : 'Take the cash training first (about 5 minutes).'),
      h('a',{class:'btn ghost sm',href:trained(who) ? '#/till' : '#/cashtrain'}, trained(who) ? 'Count the drawer in' : 'Cash training')); };

  A.register({id:'till', name:'Cash drawer and safe', what:'Count the drawer in and out each shift, paid-outs and safe drops, over or short per person, a safe log for managers, and cash training.', tiers:['staff','lead','manager','owner'],
    views:{till:{t:'Cash drawer', ic:'💵', render:drawer}, safe:{t:'Safe log', ic:'🔐', render:safe, min:'manager'}, cashtrain:{t:'Cash training', ic:'🎓', render:train, hidden:true}}});
  A.ownerHooks.push(v => { const st = T(), o = openSession(), bad = st.sessions.filter(x => x.closeAt && Math.abs(x.diff) > st.allow && !x.note);
    v.append(h('div',{class:'card'}, h('h2',null,'Cash drawer'), h('p',null, o ? o.who+' has the drawer since '+A.fmtTime(o.inAt)+'.' : 'No drawer open.'),
      bad.length ? h('p',null, h('span',{class:'chip red'}, bad.length+' shift'+(bad.length > 1 ? 's' : '')+' over or short by more than '+money(st.allow)), ' ', h('a',{href:'#/till'},'Review')) : null)); });
})();
