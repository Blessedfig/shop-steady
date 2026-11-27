// Orders to publishers and distributors (tables and rules in supabase/catalog.sql, section 8).
// Build an order per vendor from Title search ("Add to order"), see each line's stock at that vendor (and a vendor
// that has it when this one doesn't), then send it the way that vendor takes orders:
//   file  : ISBN + quantity to paste or upload on the vendor's site (PRH Self-Service "Add ISBNs/UPCs", Bookazine, IPG, Lunar)
//   email : opens your own email app with the order filled in (you press Send)
//   site / marketplace : opens the vendor's ordering page (Faire, Amazon Business)
//   phone : a list to read out
// Nothing is sent from here by itself. When you mark an order sent, it also shows up in Receiving as a shipment to check in.
(function(){
  'use strict';
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money:fmt, download, toCsv, isoDay, uid} = A;
  const RANK = {staff:1, lead:2, manager:3, owner:4};
  const isMgr = () => (RANK[A.state().tier] || 0) >= 3;
  const live = () => !A.demo && !!A.sb;
  const AV = {in_stock:['In stock','calm'], low:['Low stock','amber'], backorder:['Backorder','amber'], forthcoming:['Not out yet','grey'],
    out_of_print:['Out of print','red'], not_available:['Not available','red'], unknown:['Stock unknown','grey']};
  const STATUS = {draft:['Open, not sent','amber'], sent:['Sent','calm'], confirmed:['Confirmed','calm'], received:['Received','grey'], cancelled:['Cancelled','grey']};
  const METHODS = {file:'Uploaded or pasted on their site', email:'Emailed', site:'Ordered on their site', phone:'Phoned in', edi:'EDI (Pubnet)', marketplace:'Ordered on the marketplace'};
  const code = l => l.item_key.replace(/^sku:/, '');
  const pasteText = o => o.lines.map(l => code(l) + '\t' + l.qty).join('\n');
  const orderCsv = o => toCsv([['ISBN/UPC/SKU','Quantity','Title','Our PO'], ...o.lines.map(l => [code(l), l.qty, l.title, o.po_number])]);
  function emailBody(o){
    return 'Hello,\n\nPlease process this order from ' + A.site().name + ' (our PO ' + o.po_number + ').\n\n' +
      o.lines.map(l => code(l) + '  x' + l.qty + '  ' + l.title).join('\n') +
      '\n\nPlease confirm availability and the ship date, and reply with your order number.\n\nThank you,\n' + (A.me ? A.me() : '');
  }
  async function rpc(name, args){ const r = await A.sb.rpc(name, args); if (r.error) throw new Error(r.error.message); return r.data; }

  // Used by Title search: add one title to the vendor's open order.
  async function addToOrder(vendorId, itemKey, qty, note){
    try { await rpc('add_to_order', {p_vendor:vendorId, p_item:itemKey, p_qty:qty || 1, p_note:note || null}); toast('Added to the order'); return true; }
    catch(e){ toast(/add_to_order|schema cache/.test(e.message) ? 'Ordering is not set up yet: run the latest supabase/catalog.sql' : 'Could not add: ' + e.message); return false; }
  }
  window.SSOrders = {addToOrder};

  // Sent orders become Receiving shipments, so the shipment is waiting when the boxes come.
  function toReceiving(o, ref, eta){
    const s = A.state(); s.receiving = s.receiving || [];
    if (s.receiving.some(x => x.po === o.po_number)) return;
    s.receiving.unshift({id:uid(), site:s.site, ven:o.vendor.name, ref:ref || o.po_number, po:o.po_number, eta:eta || '', at:isoDay(new Date()), status:'ordered',
      lines:o.lines.map(l => ({id:uid(), code:code(l), t:l.title, a:l.contributors || '', qty:l.qty, cost:l.unit_cost == null ? null : +l.unit_cost, price:l.list_price == null ? null : +l.list_price, got:0, bad:0, quote:'', check:''})),
      charges:[], by:A.me ? A.me() : ''});
    A.save();
  }

  function lineRow(o, l, draft){
    const [label, tone] = AV[l.availability] || AV.unknown;
    const row = h('div',{class:'item'},
      h('div',{class:'row'}, h('b',null, l.title), h('span',{class:'chip ' + tone}, label + (l.stock_qty != null ? ' · ' + l.stock_qty : ''))),
      h('p',{class:'small muted'}, [code(l), l.format, l.list_price != null ? 'list ' + fmt(+l.list_price) : '', l.unit_cost != null ? 'cost ' + fmt(+l.unit_cost) + ' each' : ''].filter(Boolean).join(' · ')),
      l.note ? h('p',{class:'small'}, l.note) : null,
      l.better ? h('p',{class:'small'}, (AV[l.better.availability]||AV.unknown)[0] + ' at ' + l.better.vendor + '. Consider ordering it there instead.') : null);
    if (draft){
      const q = h('input',{type:'number', min:'0', max:'9999', value:String(l.qty), 'aria-label':'Quantity of ' + l.title, style:'max-width:6rem'});
      const save = h('button',{class:'btn quiet sm', type:'button', onclick:async () => { try { await rpc('set_order_line', {p_line:l.id, p_qty:+q.value || 0, p_note:null}); toast(+q.value ? 'Saved' : 'Removed'); A.route(); } catch(e){ toast(e.message === 'manager-only' ? 'A manager can change lines others added' : e.message); } }}, 'Save quantity');
      const del = h('button',{class:'btn quiet sm', type:'button', onclick:async () => { try { await rpc('set_order_line', {p_line:l.id, p_qty:0, p_note:null}); toast('Removed'); A.route(); } catch(e){ toast(e.message === 'manager-only' ? 'A manager can remove lines others added' : e.message); } }}, 'Remove');
      row.append(h('div',{class:'row'}, h('label',{class:'small'}, 'Qty '), q, save, del, o.vendor.stock_check_url ? h('a',{class:'btn quiet sm', target:'_blank', rel:'noopener', href:o.vendor.stock_check_url.replace('{isbn}', code(l)).replace('{q}', encodeURIComponent(l.title)), 'aria-label':'Check stock of ' + l.title + ' at ' + o.vendor.name + ' (opens their site)'}, 'Check stock') : null));
    } else row.append(h('p',{class:'small'}, 'Qty ' + l.qty));
    return row;
  }

  function orderCard(o){
    const draft = o.status === 'draft', [label, tone] = STATUS[o.status] || STATUS.draft;
    const units = o.lines.reduce((a,l) => a + l.qty, 0), cost = o.lines.reduce((a,l) => a + (l.unit_cost == null ? 0 : l.qty * l.unit_cost), 0);
    const missingCost = o.lines.some(l => l.unit_cost == null);
    const card = h('div',{class:'card'},
      h('div',{class:'row'}, h('h2',null, o.vendor.name), h('span',{class:'chip ' + tone}, label)),
      h('p',{class:'small muted'}, o.po_number + ' · ' + o.lines.length + ' titles, ' + units + ' copies' +
        (isMgr() && cost ? ' · about ' + fmt(cost) + (missingCost ? ' (some costs unknown)' : '') : '') +
        (o.vendor.free_freight_over && isMgr() ? ' · free freight over ' + fmt(+o.vendor.free_freight_over) + (cost < o.vendor.free_freight_over ? ' (' + fmt(o.vendor.free_freight_over - cost) + ' to go)' : '') : '') +
        (o.vendor_ref ? ' · their #' + o.vendor_ref : '') + (o.sent_at ? ' · sent ' + A.fmtDate(o.sent_at.slice(0,10)) : '') + (o.expected_on ? ' · expected ' + A.fmtDate(o.expected_on) : '')));
    const notIn = o.lines.filter(l => !['in_stock','low'].includes(l.availability)).length;
    if (draft && notIn) card.append(h('p',{class:'small'}, notIn + ' of ' + o.lines.length + ' titles are not shown in stock here. Check stock before sending, or move them to a vendor that has them.'));
    const list = h('div',{class:'grid'}, o.lines.map(l => lineRow(o, l, draft)));
    card.append(draft ? list : h('details',null, h('summary',null,'Titles'), list));
    if (draft && isMgr() && o.lines.length){
      const send = h('div',{class:'grid'}, h('h3',null,'Send it'));
      const tools = h('div',{class:'row'},
        h('button',{class:'btn ghost sm', type:'button', onclick:e => A.copy(pasteText(o), e.target)}, 'Copy ISBNs and quantities'),
        h('button',{class:'btn ghost sm', type:'button', onclick:() => download(o.po_number + '-' + o.vendor.name.replace(/\W+/g,'-').toLowerCase() + '.csv', 'text/csv', orderCsv(o))}, 'Download order file (.csv)'),
        o.vendor.order_url ? h('a',{class:'btn ghost sm', href:o.vendor.order_url, target:'_blank', rel:'noopener'}, 'Open ' + o.vendor.name + ' ordering') : null,
        o.vendor.order_email ? h('a',{class:'btn ghost sm', href:'mailto:' + encodeURIComponent(o.vendor.order_email) + '?subject=' + encodeURIComponent('Order ' + o.po_number + ' from ' + A.site().name) + '&body=' + encodeURIComponent(emailBody(o))}, 'Write the order email') : null);
      const hint = {file:'Paste the copied lines into the vendor’s quick order (PRH Self-Service: Cart > Add ISBNs/UPCs), or upload the file, then check out there.',
        email:'Write the order email opens your own email app with the order filled in. Check it and press Send there.',
        site:'Open their ordering page and add the titles there.', marketplace:'Open the marketplace and add these items to your cart there.',
        phone:'Call the vendor and read the list. Ask for their order number.', edi:'EDI ordering needs a Pubnet account. Until then, use the file.'}[o.vendor.order_method] || '';
      const f = h('form',{class:'grid g2'},
        h('label',{class:'f'},'How you sent it', h('select',{name:'method'}, Object.entries(METHODS).map(([k,t]) => h('option',{value:k, selected:k === (o.vendor.order_method || 'file')}, t)))),
        h('label',{class:'f'},'Their order or confirmation number', h('input',{type:'text', name:'ref', maxlength:'60'})),
        h('label',{class:'f'},'Expected by', h('input',{type:'date', name:'eta', value:o.vendor.lead_days ? A.addDays(isoDay(new Date()), o.vendor.lead_days) : ''})),
        h('button',{class:'btn', type:'submit'}, 'Mark as sent'));
      f.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(f);
        try { await rpc('set_order_status', {p_po:o.id, p_status:'sent', p_method:d.get('method'), p_ref:d.get('ref') || null, p_expected:d.get('eta') || null, p_notes:null});
          toReceiving(o, String(d.get('ref')||'').trim(), String(d.get('eta')||'')); toast('Marked sent. It is waiting in Receiving.'); A.route(); }
        catch(err){ toast(err.message); } });
      send.append(tools, hint ? h('p',{class:'small muted'}, hint) : null, f);
      card.append(send);
    } else if (!draft && isMgr() && ['sent','confirmed'].includes(o.status)){
      const row = h('div',{class:'row'});
      if (o.status === 'sent') row.append(h('button',{class:'btn quiet sm', type:'button', onclick:async () => { const ref = prompt('Their confirmation number (optional)') || null; try { await rpc('set_order_status', {p_po:o.id, p_status:'confirmed', p_method:null, p_ref:ref, p_expected:null, p_notes:null}); A.route(); } catch(e){ toast(e.message); } }}, 'Mark confirmed'));
      row.append(h('button',{class:'btn quiet sm', type:'button', onclick:async () => { try { await rpc('set_order_status', {p_po:o.id, p_status:'received', p_method:null, p_ref:null, p_expected:null, p_notes:null}); A.route(); } catch(e){ toast(e.message); } }}, 'Mark received'),
        h('a',{class:'btn quiet sm', href:'#/receiving'}, 'Check it in'),
        h('button',{class:'btn quiet sm', type:'button', onclick:async () => { if (!confirm('Cancel ' + o.po_number + '? Cancel it with the vendor too.')) return; try { await rpc('set_order_status', {p_po:o.id, p_status:'cancelled', p_method:null, p_ref:null, p_expected:null, p_notes:null}); A.route(); } catch(e){ toast(e.message); } }}, 'Cancel order'));
      card.append(row);
    }
    return card;
  }

  async function ordersView(v){
    v.append(head('Buying · ' + A.site().name, 'Orders', 'One order per vendor. Add titles from Title search, check stock, then send it the way that vendor takes orders.'));
    if (!live()){ v.append(h('div',{class:'card'}, h('p',null,'Orders use the shared database. Sign in to the live app after the owner runs supabase/catalog.sql.'))); return; }
    const box = h('div',{class:'grid'}, h('p',{class:'muted'},'Loading…')); v.append(box);
    let orders;
    try { orders = await rpc('list_orders', {p_status:null}); }
    catch(e){ box.replaceChildren(h('p',{class:'msg err'}, /list_orders|schema cache/.test(e.message) ? 'Ordering is not set up yet. The owner needs to run the latest supabase/catalog.sql in Supabase.' : e.message)); return; }
    box.replaceChildren();
    if (!orders.length) box.append(h('div',{class:'card'}, h('p',null,'No orders yet. Find a title in '), h('a',{href:'#/titles'},'Title search'), h('p',{class:'small muted'},' and press Add to order next to the vendor you want.')));
    const drafts = orders.filter(o => o.status === 'draft'), rest = orders.filter(o => o.status !== 'draft');
    if (drafts.length) box.append(h('h2',null,'Open orders'), ...drafts.map(orderCard));
    if (rest.length) box.append(h('h2',null,'Sent and recent'), ...rest.map(orderCard));
    if (!isMgr() && drafts.length) box.append(h('p',{class:'small muted'},'A manager or the owner sends orders.'));
  }

  A.register({id:'orders', name:'Orders to vendors', what:'One order per publisher or distributor, built from Title search, with stock per line; send by upload file, email or the vendor’s site, then it waits in Receiving.', tiers:['staff','lead','manager','owner'],
    views:{orders:{t:'Orders', ic:'🛒', render:ordersView}}});
  A.homeHooks.push(v => { if (!live() || !isMgr()) return;
    A.sb.rpc('list_orders', {p_status:'draft'}).then(r => { const n = (r.data||[]).filter(o => o.lines.length).length;
      if (n) v.append(h('div',{class:'card'}, h('h2',null,'Orders to send'), h('p',null, n + (n === 1 ? ' vendor has' : ' vendors have') + ' an open order. '), h('a',{href:'#/orders'},'See orders'))); }); });
})();
