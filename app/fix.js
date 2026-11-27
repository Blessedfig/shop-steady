// Product fixer (store manager and owner): keeps Shopify product data clean on its own, Faire items first.
//   - Every hour the server (supabase/functions/product-fix) rereads every product and proposes fixes: barcodes and
//     ISBNs, cost per item where Shopify holds a case or order total, retail price, product type, stock tracking.
//     The rules are in lib/fixrules.js.
//   - Faire order exports (CSV) add the real cost per item, case size and suggested retail.
//   - The owner approves fixes (one, a group, or all sure ones) and they go to Shopify through shopify-sync.
//     The owner can also let a rule fix things on its own. Nothing reaches Shopify without one of those.
// Demo mode runs the same rules on sample products in this browser.
(function(){
  const A = window.SSApp, R = window.FixRules; if (!A || !R) return;
  const {h, head, toast, money} = A;
  const S = () => A.state();
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');
  const GROUPS = [['barcode','Barcodes and ISBNs'],['cost','Cost per item'],['price','Selling price'],['other','Type and tracking'],['check','Needs a look']];
  const groupOf = k => k === 'barcode' || k === 'cost' || k === 'price' || k === 'check' ? k : 'other';
  const CONF = {high:['calm','Sure'], medium:['amber','Likely'], low:['grey','Estimate']};
  const ui = {group:'barcode', show:{}, picks:{}};

  async function call(fn, body){
    const {data, error} = await A.sb.functions.invoke(fn, {body});
    if (error){ let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch(e){} throw new Error(m); }
    return data;
  }
  const busy = async (btn, label, work) => { const t = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { await work(); } catch(e){ toast('Did not work: '+e.message); } finally { btn.disabled = false; btn.textContent = t; } };
  const ago = at => { if (!at) return 'never'; const m = Math.round((Date.now() - new Date(at))/60000);
    return m < 1 ? 'just now' : m < 60 ? m+' min ago' : m < 1440 ? Math.round(m/60)+' h ago' : A.fmtDate(at); };

  // ---------- data: the server, or sample products in demo ----------
  const demo = {fixes:null, rules:{}, faire:[], applied:[]};
  function demoScan(){
    const vs = DEMO_PRODUCTS.map(v => Object.assign({}, v));
    const lookups = {9: [{isbn:'9781421561325', title:'Uzumaki (3-in-1 Deluxe Edition)', authors:'Junji Ito', publisher:'VIZ Media', year:'2013', source:'Google Books'}],
      10: [{isbn:'9780593230251', title:'Braiding Sweetgrass (illustrated)', authors:'Robin Wall Kimmerer', publisher:'Milkweed', year:'2022', source:'Google Books'},
           {isbn:'9781571313560', title:'Braiding Sweetgrass', authors:'Robin Wall Kimmerer', publisher:'Milkweed Editions', year:'2015', source:'Google Books'}]};
    const done = new Set(demo.applied.concat(demo.dismissed || []).map(f => f.variant_id+'|'+f.rule));
    let id = 1;
    demo.fixes = R.scan(vs, {faireLines: demo.faire, lookups}).filter(f => !done.has(f.variant_id+'|'+f.rule)).map(f => Object.assign(f, {id:id++, status:'open'}));
  }
  async function load(){
    if (A.demo || !A.sb){ if (!demo.fixes) demoScan(); return {fixes:demo.fixes, applied:demo.applied, rules:demo.rules,
      sum:{faire_lines:demo.faire.length, last:{at:new Date().toISOString(), ok:true, note:'Sample products'}}}; }
    const [f, a, r, s, st] = await Promise.all([
      A.sb.from('product_fixes').select('*').in('status',['open','failed']).order('id').limit(3000),
      A.sb.from('product_fixes').select('*').eq('status','applied').order('decided_at',{ascending:false}).limit(30),
      A.sb.from('product_fix_rules').select('*'),
      A.sb.rpc('product_fix_summary'), A.sb.rpc('shopify_status')]);
    if (f.error) throw new Error(f.error.message);
    const rules = {}; (r.data || []).forEach(x => rules[x.rule] = x.auto);
    return {fixes:f.data || [], applied:a.data || [], rules, sum:s.data || {}, shop:st.data && st.data.shop};
  }

  // ---------- actions ----------
  async function approve(list){
    list = list.filter(f => f.kind !== 'check' && (f.new_value != null || ui.picks[f.id]));
    if (!list.length) return toast('Nothing to approve (pick an edition first)');
    if (A.demo || !A.sb){
      list.forEach(f => { const v = DEMO_PRODUCTS.find(p => p.variant_id === f.variant_id); const val = f.new_value ?? ui.picks[f.id];
        if (v){ if (f.kind === 'type') v.product_type = val; else if (f.kind === 'tracked') v.tracked = val === 'true'; else v[f.kind] = f.kind === 'barcode' ? val : Number(val); }
        demo.applied.unshift(Object.assign({}, f, {new_value:val, status:'applied', decided_at:new Date().toISOString()})); });
      demoScan(); toast(list.length+' fixed (sample products only)'); return A.route();
    }
    const picks = {}; list.forEach(f => { if (f.new_value == null) picks[f.id] = ui.picks[f.id]; });
    let sent = 0, failed = 0;
    for (let i = 0; i < list.length; i += 200){
      const {data:ids, error} = await A.sb.rpc('approve_fixes', {p_ids:list.slice(i, i+200).map(f => f.id), p_picks:picks});
      if (error) throw new Error(error.message);
      if (ids && ids.length){ const r = await call('shopify-sync', {action:'apply', ids}); sent += r.applied || 0; failed += r.failed || 0; }
    }
    toast(sent+' sent to Shopify'+(failed ? ', '+failed+' failed (see the list)' : '')); A.route();
  }
  async function dismiss(list){
    if (A.demo || !A.sb){ demo.dismissed = (demo.dismissed || []).concat(list); demoScan(); return A.route(); }
    const {error} = await A.sb.rpc('dismiss_fixes', {p_ids:list.map(f => f.id)}); if (error) throw new Error(error.message);
    toast(list.length+' dismissed'); A.route();
  }
  async function undo(f){
    if (A.demo || !A.sb) return toast('Undo works in the signed-in app');
    const {data:id, error} = await A.sb.rpc('undo_fix', {p_id:f.id}); if (error) throw new Error(error.message);
    const r = await call('shopify-sync', {action:'apply', ids:[id]}); toast(r.applied ? 'Put back' : 'Did not work, see Shopify page'); A.route();
  }

  // ---------- screen ----------
  const render = v => draw(v).catch(e => v.append(h('div',{class:'card'}, h('p',null,'Could not load the product fixer: '+e.message))));
  async function draw(v){
    v.append(head('Store manager and owner', 'Product fixer',
      'Checks every Shopify product each hour and lines up fixes: missing ISBNs and barcodes, a case or order total recorded as the cost of one item, a missing or wrong retail price. Nothing changes in Shopify until the owner approves.'));
    if (A.demo || !A.sb) v.append(h('div',{class:'card'}, h('p',{class:'small'}, h('span',{class:'chip amber'},'Sample products'), ' This is the demo. In the signed-in app the fixer reads your real Shopify products, and approved fixes go to Shopify.')));
    const box = h('div',null, h('p',{class:'muted'},'Loading…')); v.append(box);
    const d = await load();
    box.textContent = '';
    box.append(summaryCard(d), reviewCard(d), faireCard(d), rulesCard(d), appliedCard(d));
  }

  function summaryCard(d){
    const fx = d.fixes.filter(f => f.status === 'open' || f.status === 'failed'), fixable = fx.filter(f => f.kind !== 'check');
    const sure = fixable.filter(f => f.confidence === 'high' && f.new_value != null), checks = fx.filter(f => f.kind === 'check');
    const c = h('div',{class:'card'}, h('h2',null,'Where things stand'));
    c.append(h('p',null, h('b',null, String(fixable.length)), (fixable.length === 1 ? ' fix' : ' fixes')+' waiting, ', h('b',null, String(sure.length)), ' of them sure. ', h('b',null, String(checks.length)), checks.length === 1 ? ' item needs a person to look.' : ' items need a person to look.'));
    const s = d.sum || {};
    c.append(h('p',{class:'small muted'}, 'Last check '+ago(s.last && s.last.at)+(s.last && s.last.note ? ': '+s.last.note : '')+'. '+(s.faire_lines ? s.faire_lines+' Faire order lines on file'+(s.faire_latest ? ' (latest '+A.fmtDate(s.faire_latest)+')' : '')+'.' : 'No Faire orders uploaded yet.')));
    const row = h('div',{class:'row'});
    if (isOwner() && sure.length){ const b = h('button',{class:'btn',type:'button'},'Approve all '+sure.length+' sure fixes'); b.onclick = () => busy(b, 'Sending to Shopify…', () => approve(sure)); row.append(b); }
    if (!A.demo && A.sb){ const b = h('button',{class:'btn quiet sm',type:'button'},'Check now'); b.onclick = () => busy(b, 'Checking every product…', async () => { const r = await call('product-fix',{action:'scan'}); toast((r.notes||[]).join(' · ')); A.route(); }); row.append(b); }
    c.append(row);
    if (!isOwner()) c.append(h('p',{class:'small muted'},'The owner approves fixes. You can dismiss ones that are wrong.'));
    return c;
  }

  function reviewCard(d){
    const c = h('div',{class:'card'}, h('h2',null,'Fixes to review'));
    const fx = d.fixes.filter(f => f.status === 'open' || f.status === 'failed');
    const count = g => fx.filter(f => groupOf(f.kind) === g).length;
    if (!count(ui.group)) { const g = GROUPS.find(x => count(x[0])); if (g) ui.group = g[0]; }
    c.append(h('div',{class:'chips',role:'group','aria-label':'Kind of fix'}, GROUPS.map(([g, label]) =>
      h('button',{class:'chip',type:'button','aria-pressed':String(ui.group === g),onclick:()=>{ ui.group = g; A.route(); }}, label+' · '+count(g)))));
    const list = fx.filter(f => groupOf(f.kind) === ui.group);
    if (!list.length) return c.append(h('p',{class:'muted'}, fx.length ? 'Nothing here.' : 'Nothing to fix right now. The fixer checks again every hour.')), c;
    const byRule = {}; list.forEach(f => (byRule[f.rule] = byRule[f.rule] || []).push(f));
    const order = Object.keys(byRule).sort((a, b) => rank(byRule[a][0]) - rank(byRule[b][0]) || byRule[b].length - byRule[a].length);
    for (const rule of order){
      const items = byRule[rule], info = R.RULES[rule] || {label:rule, what:''};
      const sec = h('section',{class:'fixgroup','aria-label':info.label});
      sec.append(h('h3',null, info.label+' · '+items.length), h('p',{class:'small muted'}, info.what));
      const ready = items.filter(f => f.kind !== 'check' && f.new_value != null);
      const row = h('div',{class:'row'});
      if (isOwner() && ready.length > 1){ const b = h('button',{class:'btn sm',type:'button'},'Approve these '+ready.length); b.onclick = () => busy(b, 'Sending…', () => approve(ready)); row.append(b); }
      if (items.length > 1){ const b = h('button',{class:'btn quiet sm',type:'button'},'Dismiss these '+items.length); b.onclick = () => busy(b, 'Dismissing…', () => dismiss(items)); row.append(b); }
      if (row.childNodes.length) sec.append(row);
      const n = ui.show[rule] || 20;
      sec.append(h('div',{class:'list'}, items.slice(0, n).map(f => fixItem(f, d))));
      if (items.length > n) sec.append(h('button',{class:'linkbtn',type:'button',onclick:()=>{ ui.show[rule] = n + 50; A.route(); }}, 'Show more ('+(items.length - n)+' left)'));
      c.append(sec);
    }
    return c;
  }
  const rank = f => ({high:0, medium:1, low:2})[f.confidence] ?? 3;

  function fixItem(f, d){
    const conf = CONF[f.confidence] || CONF.medium;
    const it = h('div',{class:'item'});
    it.append(h('div',{class:'meta'}, h('span',{class:'chip '+conf[0]}, conf[1]), f.status === 'failed' ? h('span',{class:'chip red'},'Failed') : null,
      d.shop && f.product_id ? h('a',{href:'https://'+d.shop+'/admin/products/'+f.product_id, target:'_blank', rel:'noopener'}, 'Open in Shopify') : null));
    it.append(h('b',null, f.title || ('Item '+f.variant_id)));
    it.append(h('p',{class:'small'}, f.reason || ''));
    if (f.status === 'failed' && f.error) it.append(h('p',{class:'small'}, 'Shopify said: '+f.error));
    const ev = f.evidence || {};
    if (f.kind !== 'check' && f.new_value != null)
      it.append(h('p',null, h('span',{class:'muted'}, label(f.kind)+': '), show(f.kind, f.old_value), ' → ', h('b',null, show(f.kind, f.new_value))));
    if (f.new_value == null && Array.isArray(ev.choices) && ev.choices.length){
      const fs = h('fieldset',{class:'picks'}, h('legend',{class:'small'},'Which edition is on your shelf?'));
      ev.choices.forEach((ch, i) => fs.append(h('label',{class:'checkrow'},
        h('input',{type:'radio', name:'pick'+f.id, value:ch.isbn, checked:ui.picks[f.id] === ch.isbn, onchange:()=>{ ui.picks[f.id] = ch.isbn; }}),
        h('span',null, ch.isbn+' · '+[ch.title, ch.publisher, ch.year].filter(Boolean).join(', ')+(ch.source ? ' ('+ch.source+')' : '')))));
      it.append(fs);
    } else if (Array.isArray(ev.choices) && ev.choices[0] && ev.choices[0].link)
      it.append(h('p',{class:'small'}, h('a',{href:ev.choices[0].link, target:'_blank', rel:'noopener'}, 'See it on '+(ev.choices[0].source || 'the web'))));
    if (ev.faire_order) it.append(h('p',{class:'small muted'}, 'Faire order '+ev.faire_order+(ev.faire_day ? ', '+A.fmtDate(ev.faire_day) : '')+(ev.units ? ' · '+ev.units+' units' : '')+(ev.line_total != null ? ' · line $'+Number(ev.line_total).toFixed(2) : '')+(ev.msrp ? ' · retail $'+Number(ev.msrp).toFixed(2) : '')));
    const row = h('div',{class:'row'});
    if (isOwner() && f.kind !== 'check'){ const b = h('button',{class:'btn sm',type:'button'}, f.new_value == null ? 'Use this edition' : 'Approve'); b.onclick = () => busy(b, 'Sending…', () => approve([f])); row.append(b); }
    const x = h('button',{class:'btn quiet sm',type:'button'}, f.kind === 'check' ? 'Done, hide it' : 'Dismiss'); x.onclick = () => busy(x, '…', () => dismiss([f])); row.append(x);
    it.append(row);
    return it;
  }
  const label = k => ({barcode:'Barcode', cost:'Cost per item', price:'Price', type:'Product type', tracked:'Track stock'})[k] || k;
  const show = (k, v) => v == null || v === '' ? 'empty' : (k === 'cost' || k === 'price') && !isNaN(Number(v)) ? money(Number(v)) : k === 'tracked' ? (v === 'true' ? 'on' : 'off') : String(v);

  // ---------- Faire order exports ----------
  function faireCard(d){
    const c = h('div',{class:'card'}, h('h2',null,'Faire orders'));
    c.append(h('p',{class:'small'}, 'Faire has no connection for stores, so its Shopify app often brings items in with the case total as the cost, or no barcode. Upload your Faire order history and the fixer uses the real cost per item, case size and suggested retail. In Faire, open Orders and download them as a CSV; any wholesale order CSV with product, quantity and price columns works too.'));
    const file = h('input',{type:'file', class:'fixfile', accept:'.csv,text/csv', 'aria-label':'Faire order CSV file'}), out = h('div');
    file.onchange = async () => { out.textContent = ''; const f = file.files && file.files[0]; if (!f) return;
      if (f.size > 8e6) return toast('That file is over 8 MB. Download a shorter date range.');
      preview(out, f.name, R.parseCsv(await f.text())); };
    c.append(h('div',{class:'row'}, file), out);
    return c;
  }
  const FIELD_NAMES = {product:'Product name', option:'Option', sku:'SKU', barcode:'UPC / ISBN', qty:'Quantity', case_size:'Units per case', unit_cost:'Wholesale price', msrp:'Retail price', line_total:'Line total', order_no:'Order number', day:'Order date', brand:'Brand'};
  function preview(out, name, rows){
    if (rows.length < 2) return out.append(h('p',{class:'small'},'That file has no rows.'));
    const header = rows[0], map = R.guessColumns(header);
    const res = h('div');
    const redo = () => { res.textContent = ''; const lines = R.faireRows(rows.slice(1), map);
      res.append(h('p',{class:'small'}, lines.length+' lines read. First few:'),
        h('div',{class:'tblwrap'}, h('table',{class:'tbl'}, h('thead',null,h('tr',null, ['Product','Units','Cost each','Retail','Order'].map(x => h('th',null,x)))),
          h('tbody',null, lines.slice(0, 5).map(l => h('tr',null, h('td',null, l.product+(l.option ? ' · '+l.option : '')), h('td',null,String(l.units)),
            h('td',null, l.unit_cost == null ? '—' : money(l.unit_cost)), h('td',null, l.msrp == null ? '—' : money(l.msrp)), h('td',null, l.order_no || '—')))))));
      if (!lines.length) return;
      const b = h('button',{class:'btn',type:'button'},'Add '+lines.length+' lines');
      b.onclick = () => busy(b, 'Adding…', async () => {
        if (A.demo || !A.sb){ demo.faire = demo.faire.concat(lines); demoScan(); toast(lines.length+' lines added (this browser only)'); return A.route(); }
        let added = 0; for (let i = 0; i < lines.length; i += 1000){ const {data, error} = await A.sb.rpc('import_faire_rows', {p_file:name, p_rows:lines.slice(i, i+1000)}); if (error) throw new Error(error.message); added += data.added || 0; }
        toast(added+' new lines added. Checking products…'); try { await call('product-fix',{action:'scan'}); } catch(e){} A.route(); });
      res.append(h('div',{class:'row'}, b)); };
    const grid = h('div',{class:'mapgrid'});
    for (const f of Object.keys(FIELD_NAMES)){
      const sel = h('select',{'aria-label':'Column for '+FIELD_NAMES[f], onchange:e=>{ if (e.target.value === '') delete map[f]; else map[f] = Number(e.target.value); redo(); }},
        h('option',{value:''},'(none)'), header.map((col, i) => h('option',{value:String(i), selected:map[f] === i}, col || 'Column '+(i+1))));
      grid.append(h('label',{class:'small'}, FIELD_NAMES[f], sel));
    }
    out.append(h('details',null, h('summary',{class:'small'},'Columns (picked automatically; change one if it looks wrong)'), grid), res);
    if (map.product == null) out.append(h('p',{class:'small'}, h('span',{class:'chip red'},'Check columns'), ' Could not find the product name column.'));
    redo();
  }

  // ---------- automatic rules ----------
  function rulesCard(d){
    const c = h('div',{class:'card'}, h('h2',null,'Fix on its own'));
    c.append(h('p',{class:'small muted'}, 'Turn a rule on and its fixes go to Shopify at the next hourly check without waiting for you. Estimates and edition picks always wait for you. Every change is listed below and can be undone.'));
    if (!isOwner()){ c.append(h('p',{class:'small'}, 'On now: '+(Object.keys(d.rules).filter(k => d.rules[k]).map(k => (R.RULES[k] || {}).label || k).join(', ') || 'none')+'. The owner decides.')); return c; }
    for (const [rule, info] of Object.entries(R.RULES)){
      if (info.kind === 'check' || rule === 'cost-estimate' || rule === 'price-keystone') continue;
      c.append(h('label',{class:'checkrow'}, h('input',{type:'checkbox', checked:!!d.rules[rule], onchange:async e=>{
        const on = e.target.checked;
        if (A.demo || !A.sb){ demo.rules[rule] = on; return toast(on ? 'On (demo only)' : 'Off'); }
        const {error} = await A.sb.rpc('set_fix_rule', {p_rule:rule, p_auto:on}); if (error){ e.target.checked = !on; toast(error.message); } else toast(on ? info.label+' fixes itself from now on' : info.label+' waits for you'); }}),
        h('span',null, info.label, h('span',{class:'small muted'}, ' · '+info.what))));
    }
    return c;
  }

  function appliedCard(d){
    const c = h('div',{class:'card'}, h('h2',null,'Recently fixed'));
    if (!d.applied.length) return c.append(h('p',{class:'muted'},'Nothing yet.')), c;
    c.append(h('div',{class:'list'}, d.applied.slice(0, 30).map(f => h('div',{class:'item'},
      h('span',{class:'small muted'}, ((R.RULES[f.rule] || {}).label || f.rule)+' · '+(f.decided_by || '')+' · '+A.fmtDate(f.decided_at)),
      h('p',null, h('b',null, f.title || ''), ' · '+label(f.kind)+': '+show(f.kind, f.old_value)+' → '+show(f.kind, f.new_value)),
      isOwner() && !(['cost','price'].includes(f.kind) && !f.old_value) ? h('div',{class:'row'}, h('button',{class:'linkbtn small',type:'button',onclick:e=>busy(e.target,'Putting back…',()=>undo(f))},'Undo')) : null))));
    return c;
  }

  // Sample products for the demo: the kinds of problems Faire's Shopify app and old imports leave behind.
  const DEMO_PRODUCTS = [
    {variant_id:1, product_id:1, product_title:'Fox & Fern Notebook', variant_title:'Default Title', sku:'FF-NB-01', barcode:'', vendor:'Fox & Fern Paper', product_type:'Stationery', status:'ACTIVE', price:14, cost:42, tracked:true, on_hand:6, tags:'Faire'},
    {variant_id:2, product_id:2, product_title:'Enamel Pins, Set of 4', variant_title:'Default Title', sku:'PIN4', barcode:'', vendor:'Little Pin Co', product_type:'Gifts', status:'ACTIVE', price:16, cost:32, tracked:true, on_hand:3, tags:'Faire'},
    {variant_id:3, product_id:3, product_title:'Beeswax Taper Candles', variant_title:'Natural', sku:'BW-T-NAT', barcode:'', vendor:'Hive & Wick', product_type:'Home', status:'ACTIVE', price:12, cost:null, tracked:false, on_hand:8, tags:'Faire'},
    {variant_id:4, product_id:4, product_title:'Ceramic Owl Mug', variant_title:'Default Title', sku:'', barcode:'', vendor:'Northwoods Clay', product_type:'Home', status:'ACTIVE', price:0, cost:9, tracked:true, on_hand:4, tags:'Faire'},
    {variant_id:5, product_id:5, product_title:'Wisconsin Wildflower Seed Packet', variant_title:'Default Title', sku:'WWS-01', barcode:'', vendor:'Prairie Seed Co', product_type:'Garden', status:'ACTIVE', price:4.5, cost:27, tracked:true, on_hand:24, tags:'Faire'},
    {variant_id:6, product_id:6, product_title:'The Hobbit', variant_title:'Default Title', sku:'', barcode:'0-547-92821-1', vendor:'HarperCollins', product_type:'Books', status:'ACTIVE', price:15.99, cost:8.95, tracked:true, on_hand:2, tags:''},
    {variant_id:7, product_id:7, product_title:'Where the Crawdads Sing', variant_title:'Default Title', sku:'9780735219106', barcode:'', vendor:'Penguin Random House', product_type:'', status:'ACTIVE', price:18, cost:9.9, tracked:true, on_hand:3, tags:''},
    {variant_id:8, product_id:8, product_title:'The Overstory', variant_title:'Default Title', sku:'', barcode:'9.78039E+12', vendor:'Norton', product_type:'Books', status:'ACTIVE', price:19.95, cost:11, tracked:true, on_hand:1, tags:''},
    {variant_id:9, product_id:9, product_title:'Uzumaki (3-in-1 Deluxe Edition) by Junji Ito', variant_title:'Default Title', sku:'', barcode:'', vendor:'Simon & Schuster', product_type:'Books', status:'ACTIVE', price:35, cost:null, tracked:true, on_hand:35, tags:''},
    {variant_id:10, product_id:10, product_title:'Braiding Sweetgrass by Robin Wall Kimmerer', variant_title:'Default Title', sku:'', barcode:'', vendor:'Milkweed', product_type:'Books', status:'ACTIVE', price:20, cost:11, tracked:true, on_hand:5, tags:''},
    {variant_id:11, product_id:11, product_title:'Antigo Map Print', variant_title:'8x10', sku:'MAP-810', barcode:'', vendor:'Northwoods Print Shop', product_type:'Art', status:'ACTIVE', price:25, cost:12.5, tracked:true, on_hand:5, tags:'Faire'},
  ];
  // The Faire order the demo starts with (in the real app this comes from the uploaded CSV).
  demo.faire = [
    {order_no:'BX7QK2', day:'2026-11-12', brand:'Fox & Fern Paper', product:'Fox & Fern Notebook', option:'', sku:'FF-NB-01', barcode:'860001234565', units:6, unit_cost:7, line_total:42, msrp:14},
    {order_no:'BX7QK2', day:'2026-11-12', brand:'Northwoods Clay', product:'Ceramic Owl Mug', option:'', sku:'', barcode:'', units:4, unit_cost:9, line_total:36, msrp:18},
  ];

  A.register({id:'shopify', views:{productfix:{t:'Product fixer', ic:'🧹', render, min:'manager'}}});
  A.ownerHooks.push(v => {
    if (A.demo || !A.sb) return;
    A.sb.rpc('product_fix_summary').then(({data:s}) => { if (!s || !(s.open || s.checks)) return;
      v.append(h('div',{class:'card'}, h('h2',null,'Product fixer'), h('p',null, s.open+' Shopify fixes waiting ('+s.high+' sure), '+s.checks+' to look at. ', h('a',{href:'#/productfix'},'Review')))); }).catch(() => {});
  });
})();
