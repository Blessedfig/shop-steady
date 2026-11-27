// Shopify (store manager and owner): the live link with the store's Shopify.
//   - Status: connected or not, when it last synced (a timer syncs every 15 minutes; "Sync now" runs one at once).
//   - Sales by day, top sellers of the last 30 days with what is left on the shelf, and stock value insights.
//   - Changes for Shopify: a manager proposes a new cost or vendor for an item; nothing goes to Shopify until the
//     owner taps "Send to Shopify". Each change shows whether it worked.
// The Shopify access token never reaches this page: it stays in the database, readable only by the server functions.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money} = A;
  const S = () => A.state();
  const isOwner = () => S().tier === 'owner' && (A.demo || A.myRole === 'owner');
  const MSG = {connected:'Shopify is connected. The first sync starts now; products can take a few minutes.',
    'bad-signature':'Shopify\'s answer could not be verified. Try Connect again.', expired:'That approval took too long or was started twice. Tap Connect again.',
    'token-failed':'Shopify did not hand over access. Check the app\'s settings and try again.', 'not-configured':'The app\'s Shopify keys are not saved in Supabase yet.'};

  async function call(fn, body){
    const {data, error} = await A.sb.functions.invoke(fn, {body});
    if (error){ let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch(e){} throw new Error(m); }
    return data;
  }
  const busy = async (btn, label, work) => { const t = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { await work(); } catch(e){ toast('Did not work: '+e.message); } finally { btn.disabled = false; btn.textContent = t; } };
  const ago = at => { if (!at) return 'never'; const m = Math.round((Date.now() - new Date(at))/60000);
    return m < 1 ? 'just now' : m < 60 ? m+' min ago' : m < 1440 ? Math.round(m/60)+' h ago' : A.fmtDate(at); };

  const render = v => draw(v).catch(e => v.append(h('div',{class:'card'}, h('p',null,'Could not load Shopify data: '+e.message))));
  async function draw(v){
    v.append(head('Store manager and owner', 'Shopify', 'Sales and stock come in from Shopify every 15 minutes. Changes to Shopify wait for the owner.'));
    if (A.demo || !A.sb){ v.append(h('div',{class:'card'}, h('p',null,'Shopify works in the signed-in app, not the demo.'))); return; }
    const p = A.param(); if (p){ v.append(h('div',{class:'card'}, h('p',null, MSG[p] || p))); history.replaceState(null,'',location.pathname+'#/shopify'); }
    const box = h('div',null, h('p',{class:'muted'},'Loading…')); v.append(box);
    const st = (await A.sb.rpc('shopify_status')).data;
    box.textContent = '';
    box.append(statusCard(st));
    if (!st || !st.connected) return;
    const [days, sellers, sum, changes] = await Promise.all([
      A.sb.from('shopify_sales_day').select('*').order('day',{ascending:false}).limit(14),
      A.sb.from('shopify_sellers_30').select('*').order('qty30',{ascending:false}).limit(200),
      A.sb.rpc('shopify_stock_summary'),
      A.sb.from('shopify_changes').select('*').in('status',['pending','failed']).order('id',{ascending:false}).limit(100)]);
    box.append(salesCard(days.data || []), insightsCard(sum.data, sellers.data || []), reorderCard(sellers.data || []), sellersCard(sellers.data || []), changesCard(changes.data || []));
  }

  function statusCard(st){
    const c = h('div',{class:'card'}, h('h2',null,'Connection'));
    if (st && st.connected){
      c.append(h('p',null, h('span',{class:'chip calm'},'Connected'), ' '+st.shop),
        h('p',{class:'small muted'}, (st.variants||0)+' products and variants · products refreshed '+ago(st.full_at)+' · sales checked '+ago(st.orders_at)+(st.bulk_running ? ' · product export running' : '')));
      if (st.last) c.append(h('p',{class:'small'}, st.last.ok ? '' : h('span',{class:'chip red'},'Problem'), ' Last run '+ago(st.last.at)+': '+(st.last.note || '')));
      const b1 = h('button',{class:'btn sm',type:'button'},'Sync now'), b2 = h('button',{class:'btn quiet sm',type:'button'},'Refresh all products');
      b1.onclick = () => busy(b1, 'Syncing…', async () => { const r = await call('shopify-sync',{action:'sync'}); toast((r.notes||[]).join(' · ') || 'Done'); A.route(); });
      b2.onclick = () => busy(b2, 'Starting…', async () => { const r = await call('shopify-sync',{action:'full'}); toast((r.notes||[]).join(' · ') || 'Started'); A.route(); });
      c.append(h('div',{class:'row'}, b1, b2));
      if (isOwner()) c.append(h('details',null, h('summary',{class:'small'},'Reconnect'), connectForm(st.shop)));
    } else {
      c.append(h('p',null,'Not connected yet.'));
      c.append(isOwner() ? connectForm(st && st.shop) : h('p',{class:'small muted'},'The owner connects Shopify here.'));
    }
    return c;
  }
  function connectForm(shop){
    const inp = h('input',{type:'text',value:shop || '',placeholder:'yourstore.myshopify.com','aria-label':'Shopify store address',autocomplete:'off'});
    const b = h('button',{class:'btn',type:'button'},'Connect Shopify');
    b.onclick = () => busy(b, 'Opening Shopify…', async () => { const r = await call('shopify-auth',{action:'start', shop:inp.value}); if (!r.url) throw new Error(r.hint || r.error || 'no link'); location.href = r.url; });
    return h('div',null, h('p',{class:'small muted'},'Type the store\'s .myshopify.com address (Shopify admin > Settings > Domains). Shopify asks you to approve; then you come back here.'), h('div',{class:'row'}, inp, b));
  }

  function salesCard(days){
    const c = h('div',{class:'card'}, h('h2',null,'Sales by day'));
    if (!days.length) return c.append(h('p',{class:'muted'},'No sales synced yet.')), c;
    const max = Math.max(...days.map(d => Number(d.net)||0), 1);
    c.append(h('table',{class:'tbl'}, h('thead',null,h('tr',null, h('th',null,'Day'), h('th',null,'Orders'), h('th',null,'Items'), h('th',null,'Sales'), h('th',null,'Cash'), h('th',null,''))),
      h('tbody',null, days.map(d => h('tr',null, h('td',null,A.fmtDate(d.day)), h('td',null,String(d.orders)), h('td',null,String(d.units)), h('td',null,money(d.net)), h('td',null,money(d.cash_net)),
        h('td',null, h('span',{class:'bar',style:'display:inline-block;height:.6rem;border-radius:3px;background:var(--accent,#c9a227);width:'+Math.round(80*(Number(d.net)||0)/max)+'px'})))))));
    c.append(h('p',{class:'small muted'},'Sales are after discounts and before tax; cancelled orders left out.'));
    return c;
  }

  function insightsCard(s, sellers){
    const c = h('div',{class:'card'}, h('h2',null,'What the numbers say'));
    if (!s) return c.append(h('p',{class:'muted'},'Stock numbers come after the first product sync.')), c;
    const tips = [];
    tips.push(h('li',null, h('b',null, money(s.value_cost)), ' tied up in stock at cost ('+s.units+' items, '+money(s.value_retail)+' at retail).'));
    if (s.unsold_60) tips.push(h('li',null, h('b',null, s.unsold_60+' items'), ' in stock with no sale in 60 days, worth '+money(s.unsold_60_cost)+' at cost. Candidates for a sale table, returns to the publisher, or no reorder.'));
    if (s.no_cost) tips.push(h('li',null, h('b',null, s.no_cost+' items'), ' in stock have no cost in Shopify, so margins and the stock value miss them. Receiving fills costs in; you can also propose them below.'));
    if (s.negative) tips.push(h('li',null, h('b',null, s.negative+' items'), ' show negative stock: sold more than Shopify thought you had. Count those first.'));
    const low = sellers.filter(x => x.qty30 >= 2 && (x.available ?? 0) <= Math.ceil(x.qty30/4));
    if (low.length) tips.push(h('li',null, h('b',null, low.length+' good sellers'), ' have a week or less of stock left at the pace of the last 30 days (list below).'));
    c.append(h('ul',null, tips));
    return c;
  }
  function reorderCard(sellers){
    const low = sellers.filter(x => x.qty30 >= 2 && (x.available ?? 0) <= Math.ceil(x.qty30/4)).slice(0, 30);
    const c = h('div',{class:'card'}, h('h2',null,'Reorder soon'));
    if (!low.length) return c.append(h('p',{class:'muted'},'Nothing selling fast is running low.')), c;
    c.append(h('p',{class:'small muted'},'Sold 2 or more in 30 days and a week or less left. Suggested: enough for about a month.'));
    c.append(h('table',{class:'tbl'}, h('thead',null,h('tr',null, h('th',null,'Item'), h('th',null,'Vendor'), h('th',null,'Sold 30d'), h('th',null,'Left'), h('th',null,'Order'))),
      h('tbody',null, low.map(x => h('tr',null, h('td',null, x.title, x.barcode ? h('div',{class:'small muted'},x.barcode) : null), h('td',null,x.vendor || '—'),
        h('td',null,String(x.qty30)), h('td',null,String(x.available ?? '—')), h('td',null, h('b',null, String(Math.max(1, x.qty30 - Math.max(0, x.available||0))))))))));
    return c;
  }
  function sellersCard(sellers){
    const c = h('div',{class:'card'}, h('h2',null,'Top sellers, last 30 days'));
    if (!sellers.length) return c.append(h('p',{class:'muted'},'No sales synced yet.')), c;
    c.append(h('table',{class:'tbl'}, h('thead',null,h('tr',null, h('th',null,'Item'), h('th',null,'Sold'), h('th',null,'Sales'), h('th',null,'Left'))),
      h('tbody',null, sellers.slice(0, 15).map(x => h('tr',null, h('td',null,x.title), h('td',null,String(x.qty30)), h('td',null,money(x.net30)), h('td',null,String(x.available ?? '—')))))));
    return c;
  }

  // ---------- changes for Shopify ----------
  function changesCard(list){
    const c = h('div',{class:'card'}, h('h2',null,'Changes for Shopify'),
      h('p',{class:'small muted'}, 'Propose a new cost or vendor for an item. '+(isOwner() ? 'Nothing goes to Shopify until you tap Send to Shopify.' : 'The owner sends them to Shopify.')));
    const pending = list.filter(x => x.status === 'pending');
    if (list.length) c.append(h('div',{class:'list'}, list.map(x => h('div',{class:'item'},
      h('span',{class:'small muted'}, h('b',null, x.kind === 'cost' ? 'Cost' : x.kind === 'vendor' ? 'Vendor' : 'Stock'), ' · '+(x.note || '#'+x.variant_id)+' · '+(x.created_by || '')),
      h('p',null, (x.old_value ?? '—')+' → ', h('b',null, x.new_value)),
      x.status === 'failed' ? h('p',{class:'small'}, h('span',{class:'chip red'},'Failed'), ' '+(x.error || '')) : null,
      h('div',{class:'row'}, h('button',{class:'linkbtn small',type:'button',onclick:async()=>{ const r = await A.sb.from('shopify_changes').update({status:'dropped'}).eq('id',x.id); if (r.error) toast(r.error.message); A.route(); }},'Drop'))))));
    else c.append(h('p',{class:'muted'},'Nothing waiting.'));
    if (isOwner() && pending.length){
      const b = h('button',{class:'btn',type:'button'},'Send '+pending.length+' to Shopify');
      b.onclick = () => busy(b, 'Sending…', async () => { const r = await call('shopify-sync',{action:'apply', ids:pending.map(x => x.id)}); toast(r.applied+' sent'+(r.failed ? ', '+r.failed+' failed' : '')); A.route(); });
      c.append(h('div',{class:'row'}, b));
    }
    c.append(h('details',null, h('summary',null,'Propose a change'), proposeForm()));
    return c;
  }
  function proposeForm(){
    const q = h('input',{type:'search',placeholder:'Title, ISBN, barcode or SKU','aria-label':'Find an item'}), out = h('div',{class:'list'});
    let t = null;
    q.oninput = () => { clearTimeout(t); t = setTimeout(find, 300); };
    async function find(){
      const s = q.value.trim().replace(/[%,()]/g,' '); out.textContent = ''; if (s.length < 3) return;
      const r = await A.sb.from('shopify_variants').select('variant_id,inventory_item_id,product_title,variant_title,vendor,barcode,sku,price,available')
        .or('product_title.ilike.%'+s+'%,barcode.eq.'+s+',sku.eq.'+s).limit(10);
      if (r.error) return out.append(h('p',{class:'small'}, r.error.message));
      const costs = {}; const ids = (r.data||[]).map(x => x.inventory_item_id).filter(Boolean);
      if (ids.length){ const c = await A.sb.from('shopify_costs').select('*').in('inventory_item_id', ids); (c.data||[]).forEach(x => costs[x.inventory_item_id] = x.cost); }
      (r.data||[]).forEach(x => out.append(item(x, costs[x.inventory_item_id])));
      if (!(r.data||[]).length) out.append(h('p',{class:'small muted'},'No match.'));
    }
    function item(x, cost){
      const name = x.product_title+(x.variant_title && x.variant_title !== 'Default Title' ? ' · '+x.variant_title : '');
      const ci = h('input',{type:'number',step:'0.01',min:'0',placeholder:'New cost',style:'max-width:8rem'}), vi = h('input',{type:'text',placeholder:'New vendor',style:'max-width:12rem'});
      const add = async (kind, oldv, newv) => { if (newv === '' || newv == null) return toast('Type the new '+kind+' first');
        const r = await A.sb.from('shopify_changes').insert({kind, variant_id:x.variant_id, old_value:oldv == null ? null : String(oldv), new_value:String(newv), note:name});
        if (r.error) toast(r.error.message); else { toast('Waiting for the owner'); A.route(); } };
      return h('div',{class:'item'}, h('b',null,name), h('span',{class:'small muted'}, ' '+(x.vendor || 'no vendor')+' · price '+money(x.price)+' · cost '+(cost != null ? money(cost) : 'none')+' · '+(x.available ?? '—')+' left'),
        h('div',{class:'row'}, ci, h('button',{class:'btn quiet sm',type:'button',onclick:()=>add('cost', cost, ci.value)},'Propose cost')),
        h('div',{class:'row'}, vi, h('button',{class:'btn quiet sm',type:'button',onclick:()=>add('vendor', x.vendor, vi.value.trim())},'Propose vendor')));
    }
    return h('div',null, q, out);
  }

  A.register({id:'shopify', name:'Shopify live sync', what:'Sales and stock from Shopify every 15 minutes, top sellers, what to reorder, stock value, and cost and vendor changes that go to Shopify after the owner approves.', tiers:['manager','owner'],
    views:{shopify:{t:'Shopify', ic:'🛍️', render, min:'manager'}}});
  A.ownerHooks.push(v => { if (A.demo || !A.sb) return; const c = h('div',{class:'card'}, h('h2',null,'Shopify'), h('p',{class:'muted small'},'Checking…')); v.append(c);
    A.sb.rpc('shopify_status').then(({data:s}) => { c.lastChild.remove();
      c.append(!s || !s.connected ? h('p',null,'Not connected. ', h('a',{href:'#/shopify'},'Connect Shopify'))
        : h('p',null, (s.variants||0)+' products synced, last run '+ago(s.last && s.last.at)+'. ', s.last && !s.last.ok ? h('span',{class:'chip red'},'Problem') : null, ' ', h('a',{href:'#/shopify'},'Open'))); }); });
})();
