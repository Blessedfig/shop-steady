// Example module: inventory, reorders and expenses.
// The reorder math is the Steady Shift "menu -> grocery list" logic turned around:
//   grocery: need = planned servings x recipe amount - pantry on hand, rounded up to the package size
//   reorder: need = expected sales until the order arrives + safety stock (min) - on hand, rounded up to the case/carton
// Used books and consignment items are never auto-reordered (you can't reorder a one-off copy).
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, money, toast, download, toCsv, isoDay} = A;
  const S = () => A.state();
  const items = () => (S().inv[S().site] = S().inv[S().site] || []);

  // ISBN check digits (same rule the doc-import function uses on the server)
  function isbnOk(s){
    s = String(s||'').replace(/[-\s]/g,'');
    if (/^\d{13}$/.test(s)){ let t = 0; for (let i = 0; i < 13; i++) t += +s[i] * (i % 2 ? 3 : 1); return t % 10 === 0; }
    if (/^\d{9}[\dX]$/.test(s)){ let t = 0; for (let i = 0; i < 10; i++) t += (s[i] === 'X' ? 10 : +s[i]) * (10 - i); return t % 11 === 0; }
    return false;
  }
  // Reorder suggestion for one item. daysCover = how many days of sales the order should cover after it arrives.
  function reorder(it, daysCover){
    if (it.src === 'used' || it.src === 'consign') return 0;
    const perDay = (it.sold30 || 0) / 30;
    const need = perDay * ((it.lead || 0) + daysCover) + (it.min || 0) - (it.have || 0);
    const pack = it.pack || 1;
    return need > 0 ? Math.ceil(need / pack) * pack : 0;
  }
  // Consignment: what the store owes the consignor for a sale (split = consignor share).
  const owed = (it, salePrice) => +(salePrice * (it.split || 0)).toFixed(2);

  function inventory(v){
    v.append(head('Stock · '+A.site().name, 'Inventory and reorders', 'What you have, what is running low, and a suggested order per vendor. Sample data.'));
    const days = S().cover || 14;
    const list = items();
    const low = list.filter(it => it.have <= it.min && it.src !== 'used');
    const value = list.reduce((t,it) => t + it.have * (it.cost || 0), 0);
    v.append(h('div',{class:'grid g3'},
      h('div',{class:'card stat'}, h('b',null,String(list.length)), h('span',null,'titles and items')),
      h('div',{class:'card stat warnc'}, h('b',null,String(low.length)), h('span',null,'at or below minimum')),
      h('div',{class:'card stat good'}, h('b',null,money(value)), h('span',null,'stock at cost'))));

    const tb = h('tbody');
    list.forEach(it => tb.append(h('tr',null,
      h('td',null, h('b',null,it.t), h('div',{class:'small muted'}, it.a || '', it.isbn ? ' · ISBN '+it.isbn : (it.sku ? ' · '+it.sku : ''), it.isbn && !isbnOk(it.isbn) ? h('span',{class:'chip amber'},'check ISBN') : null)),
      h('td',null, h('span',{class:'chip '+(it.src==='consign'?'amber':it.src==='used'?'grey':'')}, {stock:'New',used:'Used',consign:'Consignment',supply:'Supply'}[it.src]||it.src)),
      h('td',null, String(it.have), it.have <= it.min && it.src !== 'used' ? h('span',{class:'chip amber'},'low') : null),
      h('td',null, String(reorder(it, days))),
      h('td',null, it.price ? money(it.price) : '—'))));
    v.append(h('div',{class:'card'}, h('h2',null,'Stock'),
      h('div',{class:'tablewrap',tabindex:'0',role:'region','aria-label':'Stock table'},
        h('table',{class:'t'}, h('thead',null,h('tr',null,h('th',null,'Item'),h('th',null,'Type'),h('th',null,'On hand'),h('th',null,'Suggested order'),h('th',null,'Price'))), tb))));

    // suggested orders grouped by vendor, downloadable as CSV for the distributor's order form
    const byVendor = {};
    list.forEach(it => { const q = reorder(it, days); if (q) (byVendor[it.vendor] = byVendor[it.vendor] || []).push([it.isbn || it.sku || '', it.t, q, it.cost]); });
    const card = h('div',{class:'card'}, h('h2',null,'Suggested orders'),
      h('label',{class:'f'},'Cover this many days of sales after the order arrives',
        h('input',{type:'number',min:'1',max:'90',value:String(days),onchange:e=>{ S().cover = Math.max(1, +e.target.value || 14); A.save(); A.route(); }})));
    if (!Object.keys(byVendor).length) card.append(h('p',{class:'muted'},'Nothing to order right now.'));
    for (const ven in byVendor){
      const rows = byVendor[ven], est = rows.reduce((t,r) => t + r[2]*r[3], 0);
      card.append(h('div',{class:'item'}, h('b',null,ven), h('div',{class:'small muted'}, rows.length+' lines · about '+money(est)+' at cost'),
        h('div',{class:'row'}, h('button',{class:'btn ghost sm',type:'button',onclick:()=>download('order-'+ven.replace(/\W+/g,'-').toLowerCase()+'-'+isoDay(new Date())+'.csv','text/csv',toCsv([['ISBN or SKU','Title','Quantity','Unit cost'], ...rows]))},'Download order (.csv)'))));
    }
    v.append(card);
    v.append(h('p',{class:'small muted'},'Consignment example: selling "Local History Sampler" at '+money(20)+' means the consignor is owed '+money(owed(list.find(i=>i.src==='consign')||{split:0.6},20))+' at the next payout.'));
  }

  function expenses(v){
    v.append(head('Money · '+A.site().name, 'Expenses', 'Log receipts the week you spend. Owners see totals by category on Home.'));
    const D = A.D, ex = S().exp;
    const form = h('form',{class:'card grid'},
      h('label',{class:'f'},'Date', h('input',{type:'date',name:'date',value:isoDay(new Date()),required:true})),
      h('label',{class:'f'},'Category', h('select',{name:'cat'}, D.EXP_CATS.map(c => h('option',null,c)))),
      h('label',{class:'f'},'Amount ($)', h('input',{type:'number',name:'amt',step:'0.01',min:'0',required:true})),
      h('label',{class:'f'},'Paid to (optional)', h('input',{type:'text',name:'payee',maxlength:'80',placeholder:'Store, company or person'})),
      h('label',{class:'f'},'Note', h('input',{type:'text',name:'note',maxlength:'120'})),
      h('button',{class:'btn',type:'submit'},'Add expense'));
    form.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(form);
      ex.push({id:A.uid(), site:S().site, date:f.get('date'), cat:f.get('cat'), amt:+f.get('amt'), payee:String(f.get('payee')||'').trim(), note:String(f.get('note')||'')}); A.save(); toast('Saved'); A.route(); });
    v.append(form);
    const mine = ex.filter(x => x.site === S().site).sort((a,b) => b.date.localeCompare(a.date));
    v.append(h('div',{class:'card'}, h('h2',null,'Recent'), h('div',{class:'list'}, mine.map(x => h('div',{class:'item'}, h('b',null,money(x.amt)+' · '+x.cat), h('span',{class:'small muted'}, A.fmtDate(x.date)+(x.note?' · '+x.note:'')))))),
      h('button',{class:'btn quiet sm',type:'button',onclick:()=>download('expenses-'+isoDay(new Date())+'.csv','text/csv',toCsv([['Date','Store','Category','Amount','Note'], ...ex.map(x=>[x.date,x.site,x.cat,x.amt.toFixed(2),x.note])]))},'Download all expenses (.csv)'));
  }

  A.register({id:'inventory', name:'Inventory and reorders', what:'Stock by ISBN or SKU, low-stock flags, suggested orders per vendor, consignment and used copies.', tiers:['lead','manager','owner'],
    views:{inventory:{t:'Inventory', ic:'📚', render:inventory}}});
  A.register({id:'expenses', name:'Expenses', what:'Receipt log by category with CSV export for your bookkeeper.', tiers:['manager','owner'],
    views:{expenses:{t:'Expenses', ic:'🧾', render:expenses}}});
  // Owner money card on Home (Steady Shift's "owner money view" pattern, much smaller)
  A.ownerHooks.push(v => {
    const ym = isoDay(new Date()).slice(0,7), ex = S().exp.filter(x => x.date.startsWith(ym));
    const byCat = {}; ex.forEach(x => byCat[x.cat] = (byCat[x.cat]||0) + x.amt);
    v.append(h('div',{class:'card'}, h('h2',null,'This month’s spending, all stores'),
      Object.keys(byCat).length ? h('ul',null, Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([c,a]) => h('li',null,c+': '+money(a)))) : h('p',{class:'muted'},'No expenses logged this month yet.')));
  });
  window.SSInventory = {isbnOk, reorder, owed};
})();
