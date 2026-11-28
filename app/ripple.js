// Ripple effects (owner learning, store manager and owner): sliders that show how one change ripples through the
// business: a raise, a new hire, a product order, a price change. The math and drawing live in lib/ripple.js (shared
// with the website demo, ripple.html). Here it gets the store's own numbers when the app has them:
//   - average hourly pay and head count from the Team screen's pay rates (private 'pay' area)
//   - average sales per day and average sale from Shopify (last 30 days, shopify_sales_day)
//   - gross margin from Shopify sales and costs this year (owner only, books_sales_year)
// The owner's tax picture (brackets, self-employment, QBI) stays on this device only: 'ripple' is not a shared area.
// Estimates for learning, not tax advice.
(function(){
  const A = window.SSApp; if (!A || !window.Ripple) return;
  const {h, head} = A;
  const S = () => A.state();
  const MGR = ['manager','owner'];
  const isMgr = () => MGR.includes(S().tier) && (A.demo || MGR.includes(A.myRole));
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');

  function teamPay(){
    const pay = (S().pay && S().pay.people) || {}, rates = Object.values(pay).map(x => +x.rate).filter(x => x > 0);
    return rates.length ? {rate: rates.reduce((a,b) => a+b, 0)/rates.length, people: rates.length} : {};
  }
  let shop = null; // {avgDay, avgSale, margin}
  async function loadShop(){
    if (shop || A.demo || !A.sb) return shop || {};
    shop = {};
    try { const r = await A.sb.from('shopify_sales_day').select('orders,net').order('day',{ascending:false}).limit(30);
      const d = (r.data || []).filter(x => +x.net > 0);
      if (d.length){ const net = d.reduce((a,x) => a + +x.net, 0), orders = d.reduce((a,x) => a + (+x.orders||0), 0);
        shop.avgDay = net / d.length; if (orders) shop.avgSale = net / orders; } } catch(e){}
    if (isOwner()) try { const r = await A.sb.rpc('books_sales_year', {p_year: new Date().getFullYear()});
      const m = r.data || [], cost = m.reduce((a,x) => a + +x.cost, 0), covered = m.reduce((a,x) => a + +x.net_with_cost, 0);
      if (covered > 500 && cost > 0) shop.margin = 100 * (covered - cost) / covered; } catch(e){}
    return shop;
  }

  function view(v){
    v.append(head('Learn the business', 'Ripple effects', 'Move a slider and see how one change ripples out: cost each week, month and year, payroll taxes, write-offs, the real cost after tax, and the sales it takes to cover it.'));
    if (!isMgr()){ v.append(h('div',{class:'card'},'Only a store manager or the owner can open this.')); return; }
    const box = h('div',null, h('p',{class:'muted'},'Loading your numbers…'));
    v.append(box,
      h('p',{class:'small muted'},'Estimates for learning and planning, not tax advice. Uses '+Ripple.RATES.year+' federal and Wisconsin figures. Thinking about a real hire or purchase? ', h('a',{href:'#/decide'},'Plan it in Decisions'), ' and check the final numbers with your accountant.'));
    const tp = teamPay();
    loadShop().then(sh => {
      const st = Object.assign({}, tp, sh), from = [];
      if (tp.rate) from.push('average pay '+A.money(tp.rate)+' an hour for '+tp.people+(tp.people === 1 ? ' person' : ' people')+' (Team)');
      box.textContent = '';
      Ripple.mount(box, {start: A.param() || 'raise', store: st, settings: S().ripple || null, firstHire: !tp.people,
        fromNote: from.length ? 'Starting from your '+from.join(', ')+'.' : null,
        onSettings: s => { S().ripple = s; A.save(true); }});
      if (sh.avgDay || sh.margin) box.append(h('p',{class:'small muted'}, 'From Shopify: '+[sh.avgDay ? 'average day '+A.money(sh.avgDay) : '', sh.avgSale ? 'average sale '+A.money(sh.avgSale) : '', sh.margin ? 'margin '+Math.round(sh.margin)+'% this year' : ''].filter(Boolean).join(', ')+'.'));
    });
  }

  A.register({id:'ripple', name:'Ripple effects', what:'Learn how one change ripples through the business: a raise, a new hire, a product order or a price change, with sliders, write-offs and the sales it takes to cover it. Uses your own numbers when the app has them.', tiers:['manager','owner'],
    views:{ripple:{t:'Ripple effects', ic:'🌊', render:view, min:'manager'}}});
})();
