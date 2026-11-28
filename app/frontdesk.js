// Front desk: the everyday counter jobs, each done in a few taps, for the first level (Front desk) and anyone else.
//   Customer pickup   find the customer, see what's waiting, tap "Told them" or "Picked up".
//   Check in a delivery   pick the box's shipment, scan each item, tap "+ damaged" if needed, then "Done".
//                     Short and extra items stand out. Costs never show here; a manager finishes the shipment.
//                     A scanned item that someone special-ordered says so, so it goes on the hold shelf.
//   We're out of...   scan or type it, tap Out or Low. Managers see the list on Home and when ordering.
// Data: customers and special orders ('people'), shipments ('receiving') and requests ('requests'), all shared.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, uid, isoDay} = A;
  const S = () => A.state();
  const LEAD = ['lead','manager','owner'];
  const norm = c => A.normCode ? A.normCode(c) : String(c||'').replace(/[\s-]/g,'').toUpperCase();
  const custs = () => { const p = S().people; return (p && p.customers && p.customers[S().site]) || []; };
  const ships = () => (S().receiving || []).filter(x => x.site === S().site);
  const REQ = () => { const s = S(); if (!Array.isArray(s.requests)) s.requests = []; return s.requests; };
  const OPEN = ['To order','Ordered','Arrived, customer told'];
  const big = (t, onclick, cls) => h('button',{class:'btn '+(cls||''),type:'button',style:'min-height:3rem;font-size:1.05rem',onclick}, t);
  const tip = t => h('p',{class:'small muted'}, t);
  const titleOf = code => { const c = norm(code); const inv = (S().inv && S().inv.items) || S().inv || []; const it = Array.isArray(inv) ? inv.find(x => norm(x.isbn || x.sku || x.code) === c) : null; return it ? (it.title || it.t || '') : ''; };

  // ---------- customer pickup ----------
  function pickup(v){
    v.append(head('Front desk', 'Customer pickup', 'Type part of their name or phone number.'));
    const q = h('input',{type:'search',placeholder:'Name or phone',autocomplete:'off','aria-label':'Customer name or phone',style:'font-size:1.2rem'});
    const out = h('div',{class:'list'});
    const draw = () => {
      const t = q.value.trim().toLowerCase(), digits = t.replace(/\D/g,'');
      let list = custs().filter(c => (c.orders||[]).some(o => OPEN.includes(o.status)));
      if (t) list = custs().filter(c => c.n.toLowerCase().includes(t) || (digits.length >= 3 && String(c.phone||'').replace(/\D/g,'').includes(digits)));
      out.replaceChildren(...(list.length ? list.slice(0, 20).map(c => {
        const orders = (c.orders||[]).filter(o => o.status !== 'Picked up');
        return h('div',{class:'item'}, h('b',null,c.n), c.phone ? h('span',{class:'small'},' · ', h('a',{href:'tel:'+String(c.phone).replace(/[^\d+]/g,'')}, c.phone)) : null,
          orders.length ? h('div',{class:'list'}, orders.map(o => h('div',{class:'item'}, h('b',null,o.item), ' ', h('span',{class:'chip '+(o.status === 'Arrived, customer told' ? 'calm' : 'grey')}, o.status === 'Arrived, customer told' ? 'Here, on hold' : o.status === 'Ordered' ? 'On its way' : 'Not ordered yet'),
            o.price ? h('span',{class:'small muted'},' · '+A.money(o.price)) : null,
            h('div',{class:'row'},
              o.status !== 'Arrived, customer told' ? big('It\'s here, told them', () => { o.status = 'Arrived, customer told'; o.toldAt = new Date().toISOString(); o.toldBy = A.me(); A.save(); toast('Marked as here'); draw(); }, 'quiet') : null,
              big('Picked up', () => { o.status = 'Picked up'; o.pickedAt = new Date().toISOString(); o.pickedBy = A.me(); A.save(); toast('Picked up. Ring it up on the register.'); draw(); }))))) : h('p',{class:'small muted'},'Nothing waiting for them.'));
      }) : [h('p',{class:'muted'}, t ? 'No customer found. Ask a shift lead to add them.' : 'No special orders waiting.')]));
    };
    q.addEventListener('input', draw); draw();
    v.append(h('div',{class:'card'}, q, out), tip('Picked up only marks it here. Ring up the sale on the register as usual.'));
    setTimeout(() => q.focus(), 50);
  }

  // ---------- check in a delivery ----------
  function checkin(v){
    const id = A.param();
    if (!id){
      v.append(head('Front desk', 'Check in a delivery', 'Pick the shipment that matches the box (look at the packing slip).'));
      const open = ships().filter(x => x.status !== 'done');
      v.append(h('div',{class:'card'}, open.length ? h('div',{class:'list'}, open.map(x => { const exp = x.lines.reduce((a,l) => a + (l.qty||0), 0), got = x.lines.reduce((a,l) => a + (l.got||0), 0);
        return h('a',{class:'item',href:'#/checkin/'+x.id,style:'display:block;text-decoration:none;color:inherit;padding:.8rem'}, h('b',{style:'font-size:1.1rem'}, x.ven+(x.ref ? ' · '+x.ref : '')),
          h('div',{class:'small muted'}, got+' of '+exp+' checked in'+(x.desk ? ' · done by '+x.desk.by : ''))); }))
        : h('p',{class:'muted'},'No deliveries expected. If a box came anyway, tell a shift lead.')));
      return;
    }
    const x = ships().find(s => s.id === id);
    v.append(h('a',{class:'small',href:'#/checkin'},'← Other deliveries'));
    if (!x){ v.append(h('div',{class:'card'},'That delivery was not found.')); return; }
    v.append(head('Front desk', x.ven+(x.ref ? ' · '+x.ref : ''), 'Scan each item. If it is damaged, tap + damaged on its line.'));
    const last = h('div',{class:'msg big','aria-live':'assertive'},'Ready to scan');
    const scan = h('input',{type:'text',inputmode:'numeric',autocomplete:'off',placeholder:'Scan or type the barcode, then Enter','aria-label':'Barcode',style:'font-size:1.3rem'});
    const box = h('div',{class:'list'});
    const so = (code, title) => { const c = norm(code), t = (title || titleOf(c) || '').toLowerCase(); const hits = [];
      custs().forEach(cu => (cu.orders||[]).forEach(o => { if (!OPEN.slice(0,2).includes(o.status)) return; const it = String(o.item||'').toLowerCase();
        if ((c && it.replace(/[\s-]/g,'').toUpperCase().includes(c)) || (t && t.length > 3 && (it.includes(t) || t.includes(it)))) hits.push({cu, o}); })); return hits; };
    const draw = () => box.replaceChildren(...x.lines.map(l => { const short = (l.qty||0) - (l.got||0);
      return h('div',{class:'item'}, h('b',null, l.t || l.code || 'Item'), h('div',{class:'small muted'}, (l.got||0)+(l.qty ? ' of '+l.qty : '')+' in'+(l.bad ? ' · '+l.bad+' damaged' : '')),
        short > 0 && x.desk ? h('span',{class:'chip amber'}, short+' short') : short < 0 ? h('span',{class:'chip amber'}, (-short)+' extra') : l.qty && !short ? h('span',{class:'chip calm'},'All here') : null,
        h('div',{class:'row'},
          h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ l.got = (l.got||0) + 1; A.save(); draw(); }},'+1'),
          h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ l.bad = (l.bad||0) + 1; A.save(); toast('Marked damaged. Set it aside for the manager.'); draw(); }},'+ damaged'),
          (l.got||0) > 0 ? h('button',{class:'linkbtn small',type:'button',onclick:()=>{ l.got = Math.max(0, (l.got||0) - 1); A.save(); draw(); }},'undo') : null)); }));
    scan.addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); const code = norm(scan.value); scan.value = ''; if (!code) return;
      let l = x.lines.find(y => norm(y.code) === code);
      if (!l){ l = {id:uid(), code, t:titleOf(code) || '', a:'', qty:0, cost:null, price:null, got:0, bad:0, quote:'', check:'Not on the order'}; x.lines.push(l); }
      l.got = (l.got||0) + 1; if (x.status === 'ordered') x.status = 'arrived'; A.save();
      const hits = so(code, l.t);
      last.replaceChildren(document.createTextNode((!l.qty ? '⚠ Not on the slip: ' : l.got > l.qty ? '⚠ Extra: ' : '✓ ')+(l.t || code)+' · '+l.got+(l.qty ? ' of '+l.qty : '')));
      last.className = 'msg big'+(!l.qty || l.got > l.qty ? ' err' : '');
      if (hits.length){ const {cu, o} = hits[0];
        last.append(h('div',{style:'margin-top:.5rem'}, h('b',null,'Special order for '+cu.n+'. '), 'Put it on the hold shelf. ',
          h('button',{class:'btn sm',type:'button',onclick:()=>{ o.status = 'Arrived, customer told'; o.arrivedAt = new Date().toISOString(); A.save(); toast('On hold for '+cu.n+(cu.phone ? '. Call or text '+cu.phone : '')); }},'On the hold shelf'))); }
      draw(); });
    draw();
    v.append(h('div',{class:'card'}, last, scan,
      h('div',{class:'row'}, big('Everything on the slip is here', () => { x.lines.forEach(l => l.got = Math.max(l.got||0, l.qty||0)); if (x.status === 'ordered') x.status = 'arrived'; A.save(); draw(); }, 'ghost'))),
      h('div',{class:'card'}, box),
      h('div',{class:'row'}, big(x.desk ? 'Checked in ✓ (tap to redo)' : 'Done checking in', () => {
        if (x.status === 'ordered') x.status = 'arrived'; x.desk = {at:new Date().toISOString(), by:A.me()}; A.save();
        const short = x.lines.reduce((a,l) => a + Math.max(0, (l.qty||0) - (l.got||0)), 0), bad = x.lines.reduce((a,l) => a + (l.bad||0), 0);
        toast('Thanks! '+(short ? short+' short. ' : '')+(bad ? bad+' damaged, set aside. ' : '')+'A manager will finish it.'); location.hash = '#/checkin'; })),
      tip('Shelve what came in. Damaged items go in the back for the manager to send back.'));
    setTimeout(() => scan.focus(), 50);
  }

  // ---------- we're out of ----------
  function out(v){
    v.append(head('Front desk', 'We\'re out of…', 'Scan it or type the title. Tap Out or Running low.'));
    const code = h('input',{type:'text',autocomplete:'off',placeholder:'Scan, or type a title','aria-label':'Item',style:'font-size:1.2rem'});
    const asked = h('input',{type:'checkbox'});
    const add = kind => { const val = code.value.trim(); if (!val) return toast('Scan or type the item first');
      const c = /^[\dXx -]{8,}$/.test(val) ? norm(val) : '', t = c ? (titleOf(c) || '') : val;
      REQ().unshift({id:uid(), site:S().site, at:new Date().toISOString(), by:A.me(), code:c, t, kind, asked:asked.checked, status:'open'});
      if (REQ().length > 300) REQ().length = 300; A.save(); code.value = ''; asked.checked = false; toast('Added. Thanks!'); A.route(); };
    code.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); add('out'); } });
    v.append(h('div',{class:'card'}, code, h('label',{class:'checkrow'}, asked, 'A customer asked for it'),
      h('div',{class:'row'}, big('Out', () => add('out')), big('Running low', () => add('low'), 'quiet'))));
    const mine = REQ().filter(r => r.site === S().site && r.status === 'open').slice(0, 15);
    if (mine.length) v.append(h('div',{class:'card'}, h('h2',null,'Already on the list'), h('ul',null, mine.map(r => h('li',null, (r.t || r.code)+' · '+(r.kind === 'out' ? 'out' : 'low')+(r.asked ? ' · customer asked' : ''))))));
    setTimeout(() => code.focus(), 50);
  }

  // managers: the list on Home, with a tap to clear each one
  A.homeHooks.push(v => {
    if (!LEAD.includes(S().tier)) return;
    const open = REQ().filter(r => r.site === S().site && r.status === 'open'); if (!open.length) return;
    v.append(h('div',{class:'card'}, h('h2',null,'Out or running low ('+open.length+')'),
      h('div',{class:'list'}, open.slice(0, 25).map(r => h('div',{class:'item'}, h('b',null, r.t || r.code), h('span',{class:'small muted'}, ' · '+(r.kind === 'out' ? 'Out' : 'Low')+(r.asked ? ' · customer asked' : '')+' · '+r.by+' · '+A.fmtTime(r.at)),
        h('div',{class:'row'}, ['Ordered','Not reordering'].map(t => h('button',{class:'btn quiet sm',type:'button',onclick:()=>{ r.status = t === 'Ordered' ? 'ordered' : 'skip'; r.doneBy = A.me(); r.doneAt = isoDay(new Date()); A.save(); A.route(); }}, t))))))));
  });

  A.register({id:'frontdesk', name:'Front desk', what:'The everyday counter jobs in a few taps: customer pickups, checking in deliveries, and telling managers what ran out.', tiers:['staff','lead','manager','owner'],
    views:{pickup:{t:'Customer pickup', ic:'🛍️', render:pickup}, checkin:{t:'Check in a delivery', ic:'📦', render:checkin}, out:{t:'We\'re out of…', ic:'📝', render:out}}});
})();
