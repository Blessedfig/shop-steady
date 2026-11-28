// Ripple effects (store manager and owner): every money decision shows its hidden effects right away, with sliders:
// payroll taxes, the write-off, gross vs net cost, cash tied up, the sales it takes to cover it, the risk, and the
// proof to keep (with what skipping it could cost in an audit). The math and drawing live in lib/ripple.js (shared
// with the website demo, ripple.html). This file:
//   - gives lib/ripple.js the store's own numbers once (Ripple.use): average pay and head count from the Team pay
//     rates, average day and average sale from Shopify, margin from Shopify sales and costs (owner only)
//   - adds the Ripple effects screen (#/ripple, every kind in tabs, #/ripple/<kind> opens one)
//   - gives other screens A.ripplePanel(el, kind, values, onValues) to drop one decision's hidden effects in place
//     (Decision planner, Loans, Equipment, Tax year)
//   - records "stock that isn't selling" choices straight into the write-offs (Tax records), so the books and the
//     Tax year are right the same day, not at year end
// The owner's tax picture (brackets, self-employment, QBI, itemizing) stays on this device: 'ripple' is not a shared area.
// Estimates for learning, not tax advice.
(function(){
  const A = window.SSApp; if (!A || !window.Ripple) return;
  const {h, head, toast, uid, isoDay} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier) && (A.demo || MGR.includes(A.myRole));
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');

  function teamPay(){
    const pay = (S().pay && S().pay.people) || {}, rates = Object.values(pay).map(x => +x.rate).filter(x => x > 0);
    return rates.length ? {rate: rates.reduce((a,b) => a+b, 0)/rates.length, people: rates.length} : {};
  }
  let shop = null, shopP = null; // {avgDay, avgSale, margin}
  function loadShop(){
    if (shop) return Promise.resolve(shop);
    if (A.demo || !A.sb) return Promise.resolve(shop = {});
    return shopP || (shopP = (async () => { const o = {};
      try { const r = await A.sb.from('shopify_sales_day').select('orders,net').order('day',{ascending:false}).limit(30);
        const d = (r.data || []).filter(x => +x.net > 0);
        if (d.length){ const net = d.reduce((a,x) => a + +x.net, 0), orders = d.reduce((a,x) => a + (+x.orders||0), 0);
          o.avgDay = net / d.length; if (orders) o.avgSale = net / orders; } } catch(e){}
      if (isOwner()) try { const r = await A.sb.rpc('books_sales_year', {p_year: new Date().getFullYear()});
        const m = r.data || [], cost = m.reduce((a,x) => a + +x.cost, 0), covered = m.reduce((a,x) => a + +x.net_with_cost, 0);
        if (covered > 500 && cost > 0) o.margin = 100 * (covered - cost) / covered; } catch(e){}
      return shop = o; })());
  }

  // a choice for stock that isn't selling goes straight into the write-offs list the Tax year reads
  function record(kind, x){
    const ws = S().writeoffs = S().writeoffs || [];
    ws.push({id:uid(), site:S().site, date:isoDay(new Date()), why:x.why, item:x.label+' (from Ripple effects)', qty:x.qty, cost:x.cost, retail:x.retail || 0, face:0, to:'', c501:false,
      stock:true, photo:null, redeemed:0, by:A.me(), status:MGR.includes(S().tier) ? 'ok' : 'pending'});
    A.save(); toast('Recorded in your write-offs. Add the photo or letter there, and lower the count in Shopify.');
    if (A.VIEWS.taxlog && A.viewOn('taxlog')) setTimeout(() => A.go('taxlog'), 400);
  }
  async function setup(){
    const sh = await loadShop(), tp = teamPay();
    Ripple.use({store:Object.assign({}, tp, sh), settings:S().ripple || null, firstHire:!tp.people, onRecord:record,
      onSettings: s => { S().ripple = s; A.save(true); Ripple.use({settings:s}); }});
    return {sh, tp};
  }
  // for other screens: one decision's hidden effects, in place
  A.ripplePanel = (el, kind, values, onValues, title) => {
    el.append(h('p',{class:'small muted'},'Working out the hidden effects…'));
    setup().then(() => Ripple.panel(el, kind, {values, onValues, title})).catch(e => { el.textContent = ''; console.error(e); });
  };

  function view(v){
    v.append(head('Learn the business', 'Ripple effects', 'Move a slider and see how one change ripples out: cost each week, month and year, payroll taxes, write-offs, the real cost after tax, the risk, and the proof to keep.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can open this.')); return; }
    const box = h('div',null, h('p',{class:'muted'},'Loading your numbers…'));
    v.append(box,
      h('p',{class:'small muted'},'Estimates for learning and planning, not tax advice. Uses '+Ripple.RATES.year+' federal and Wisconsin figures. Deciding for real? ', h('a',{href:'#/decide'},'Plan it in Decisions'), ' and check the final numbers with your accountant.'));
    setup().then(({sh, tp}) => {
      box.textContent = '';
      Ripple.mount(box, {start: A.param() || 'raise',
        fromNote: tp.rate ? 'Starting from your average pay, '+A.money(tp.rate)+' an hour for '+tp.people+(tp.people === 1 ? ' person' : ' people')+' (Team).' : null});
      if (sh.avgDay || sh.margin) box.append(h('p',{class:'small muted'}, 'From Shopify: '+[sh.avgDay ? 'average day '+A.money(sh.avgDay) : '', sh.avgSale ? 'average sale '+A.money(sh.avgSale) : '', sh.margin ? 'margin '+Math.round(sh.margin)+'% this year' : ''].filter(Boolean).join(', ')+'.'));
    });
  }

  A.register({id:'ripple', name:'Ripple effects', what:'Every money decision with its hidden effects: a raise, a hire, an order, stock that isn\'t selling, a price change, hours, equipment, a loan, an event. Sliders, write-offs, risk, the sales it takes to cover it, and the proof to keep. Uses your own numbers.', tiers:['manager','owner'],
    views:{ripple:{t:'Ripple effects', ic:'🌊', render:view, min:'manager'}}});
})();
