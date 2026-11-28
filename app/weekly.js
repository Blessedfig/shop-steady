// Weekly money summary (store manager and owner), meant for Monday morning: how last week really went.
//   sales (Shopify, after discounts, before tax)
//   - cost of the items sold (Shopify unit costs; lines without a cost are counted and flagged)
//   = gross profit and margin
//   - labor (time clock hours x pay rates, overtime included, plus about 11% payroll taxes)
//   - other costs logged in Expenses that week (not inventory purchases or payroll, which are counted above)
//   = what the week really left over, with labor as a % of sales, next to the week before.
// Everything is read with the viewer's own rights: sales and costs are manager+ in the database, pay is a private area.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, money, isoDay, addDays} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier) && (A.demo || MGR.includes(A.myRole));
  const PAYROLL = 1.11, SKIP_EXP = ['Inventory purchases','Payroll','Payroll taxes'];
  const weekStart = iso => { const d = new Date(iso+'T12:00:00'); return addDays(iso, -d.getDay()); }; // Sunday, like the timesheets
  const pct = (a, b) => b ? Math.round(1000*a/b)/10+'%' : '—';

  async function sales(wk){
    if (A.demo || !A.sb) return null;
    const end = addDays(wk, 7);
    const r = await A.sb.from('shopify_order_lines').select('order_id,variant_id,qty,net').gte('day', wk).lt('day', end).eq('cancelled', false).limit(5000);
    if (r.error) throw r.error;
    const lines = r.data || [], ids = [...new Set(lines.map(l => l.variant_id).filter(Boolean))];
    const costOf = {};
    for (let i = 0; i < ids.length; i += 200){
      const v = await A.sb.from('shopify_variants').select('variant_id,inventory_item_id').in('variant_id', ids.slice(i, i+200));
      const inv = (v.data || []).map(x => x.inventory_item_id).filter(Boolean);
      const c = inv.length ? await A.sb.from('shopify_costs').select('inventory_item_id,cost').in('inventory_item_id', inv) : {data:[]};
      const byInv = {}; (c.data || []).forEach(x => byInv[x.inventory_item_id] = +x.cost || 0);
      (v.data || []).forEach(x => { if (byInv[x.inventory_item_id] > 0) costOf[x.variant_id] = byInv[x.inventory_item_id]; });
    }
    let net = 0, cogs = 0, covered = 0, missing = 0;
    lines.forEach(l => { const n = +l.net || 0; net += n; const c = costOf[l.variant_id];
      if (c){ cogs += c * (l.qty || 0); covered += n; } else if (n) missing++; });
    return {net, cogs, covered, missing, orders:new Set(lines.map(l => l.order_id)).size, lines:lines.length};
  }
  function labor(wk){
    const sh = window.SSShifts; if (!sh || !S().shifts) return {cost:0, hours:0, unknown:[]};
    const byWho = sh.weekHours(S().site, wk), team = (S().shifts.team && S().shifts.team[S().site]) || [], pay = (S().pay && S().pay.people) || {};
    let cost = 0, min = 0; const unknown = [];
    Object.entries(byWho).forEach(([n, m]) => { const p = team.find(x => x.n === n), rate = p && pay[p.id] ? +pay[p.id].rate || 0 : 0;
      min += m; if (!rate && p && p.tier !== 'owner') unknown.push(n); cost += sh.payFor(rate, m).pay * PAYROLL; });
    if (A.payroll) cost += A.payroll.ownerWeekly() * PAYROLL; // an owner on salary (Payroll > Owner pay), owner's device only
    return {cost, hours:min/60, unknown};
  }
  function other(wk){
    const end = addDays(wk, 7);
    return (S().exp || []).filter(x => x.site === S().site && x.date >= wk && x.date < end && !SKIP_EXP.includes(x.cat)).reduce((a, x) => a + (+x.amt || 0), 0);
  }
  async function week(wk){
    const s = await sales(wk), l = labor(wk), o = other(wk);
    const gross = s ? s.net - s.cogs : null;
    return {wk, s, l, o, gross, left: s ? gross - l.cost - o : null};
  }

  function table(a, b){
    const row = (t, x, y, strong) => h('tr',null, h('td',null, strong ? h('b',null,t) : t), h('td',null, strong ? h('b',null,x) : x), h('td',{class:'muted'}, y));
    const m = v => v == null ? '—' : money(v);
    return h('table',{class:'tbl'}, h('thead',null, h('tr',null, h('th',null,''), h('th',null,'Week of '+A.fmtDate(a.wk)), h('th',null,'Week before'))),
      h('tbody',null,
        row('Sales', m(a.s && a.s.net), m(b.s && b.s.net), true),
        row('Orders', a.s ? String(a.s.orders) : '—', b.s ? String(b.s.orders) : '—'),
        row('Cost of items sold', m(a.s && a.s.cogs), m(b.s && b.s.cogs)),
        row('Gross profit', m(a.gross), m(b.gross)),
        row('Gross margin', a.s ? pct(a.s.covered - a.s.cogs, a.s.covered) : '—', b.s ? pct(b.s.covered - b.s.cogs, b.s.covered) : '—'),
        row('Labor ('+Math.round(a.l.hours)+' h)', m(a.l.cost), m(b.l.cost)),
        row('Labor as % of sales', a.s ? pct(a.l.cost, a.s.net) : '—', b.s ? pct(b.l.cost, b.s.net) : '—', true),
        row('Other costs (Expenses)', m(a.o), m(b.o)),
        row('Left over', m(a.left), m(b.left), true)));
  }
  function notes(a){
    const out = [];
    if (a.s && a.s.missing) out.push(a.s.missing+' sales lines had no cost in Shopify, so cost and margin are only for the rest. Receiving fills costs in.');
    if (a.l.unknown.length) out.push('No pay rate for '+a.l.unknown.join(', ')+' (Team screen), so their hours count as $0.');
    if (a.s && a.s.net && a.l.cost / a.s.net > 0.25) out.push('Labor is over 25% of sales. Many small bookstores aim for 15 to 20%.');
    out.push('Rent, utilities and other monthly bills count only in the week you log them in Expenses.');
    return h('ul',{class:'small muted'}, out.map(x => h('li',null,x)));
  }

  async function view(v){
    v.append(head('Store manager and owner', 'Weekly money summary', 'Sales, what the items cost, labor and other costs, for a Sunday to Saturday week. Best read on Monday.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can see this.')); return; }
    const pick = h('input',{type:'date',value:A.param() || addDays(weekStart(isoDay(new Date())), -7),'aria-label':'Week starting',onchange:e=>{ location.hash = '#/week/'+weekStart(e.target.value); }});
    v.append(h('div',{class:'row'}, h('span',null,'Week starting '), pick));
    const box = h('div',{class:'card'}, h('p',{class:'muted'},'Adding it up…')); v.append(box);
    if (A.demo){ box.replaceChildren(h('p',null,'The weekly summary uses your real Shopify sales once you sign in.')); return; }
    try {
      const wk = weekStart(pick.value), [a, b] = await Promise.all([week(wk), week(addDays(wk, -7))]);
      box.replaceChildren(table(a, b), notes(a));
    } catch(e){ box.replaceChildren(h('p',null,'Could not load sales: '+(e.message || e)+'. Is Shopify connected?')); }
  }

  A.register({id:'weekly', name:'Weekly money summary', what:'Every Monday: last week\'s sales, item costs, gross margin, labor % and what was left over, next to the week before.', tiers:['manager','owner'],
    views:{week:{t:'Weekly summary', ic:'📈', render:v => { view(v); }, min:'manager'}}});
  A.ownerHooks.push(v => { if (A.demo || !A.sb) return;
    const wk = addDays(weekStart(isoDay(new Date())), -7), c = h('div',{class:'card'}, h('h2',null,'Last week'), h('p',{class:'muted small'},'Adding it up…')); v.append(c);
    week(wk).then(a => { c.lastChild.remove(); if (!a.s || !a.s.lines){ c.append(h('p',{class:'small muted'},'No Shopify sales synced for last week yet. ', h('a',{href:'#/shopify'},'Shopify'))); return; }
      c.append(h('p',null, 'Sales '+money(a.s.net)+' · labor '+pct(a.l.cost, a.s.net)+' of sales · left over '+money(a.left)+'. ', h('a',{href:'#/week/'+wk},'Details'))); })
      .catch(() => { c.lastChild.remove(); c.append(h('p',{class:'small muted'},'Could not load last week.')); }); });
})();
