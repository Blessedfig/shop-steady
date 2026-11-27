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
  async function addToOrder(vendorId, itemKey, qty, note, customer){
    try { await rpc('add_to_order', {p_vendor:vendorId, p_item:itemKey, p_qty:qty || 1, p_note:note || null, p_customer:customer || null}); toast('Added to the order'); return true; }
    catch(e){ toast(/add_to_order|schema cache/.test(e.message) ? 'Ordering is not set up yet: run the latest supabase/catalog.sql' : 'Could not add: ' + e.message); return false; }
  }
  window.SSOrders = {addToOrder};

  // Package tracking links by carrier (number shape), opened on the carrier's own site.
  function trackUrl(n, carrier){
    const c = (carrier || '').toLowerCase();
    if (/^1Z[0-9A-Z]{16}$/i.test(n) || /ups/.test(c)) return 'https://www.ups.com/track?tracknum=' + encodeURIComponent(n);
    if (/^TBA\d+/i.test(n) || /amazon/.test(c)) return 'https://track.amazon.com/tracking/' + encodeURIComponent(n);
    if (/^(94|93|92|95)\d{18,20}$/.test(n) || /usps|postal/.test(c)) return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + encodeURIComponent(n);
    if (/^\d{12}$|^\d{15}$/.test(n) || /fedex/.test(c)) return 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(n);
    return 'https://www.google.com/search?q=' + encodeURIComponent('track package ' + n);
  }
  const WHERE = {draft:'Not sent yet', sent:'Sent to vendor', confirmed:'Vendor confirmed or shipped', received:'Arrived', cancelled:'Cancelled'};

  // Anyone at the counter: "where is my book?" Search by customer, title, ISBN or order number.
  function lookupCard(){
    const inp = h('input',{type:'search', placeholder:'Customer name, title, ISBN or order number', 'aria-label':'Find a customer order', autocomplete:'off'});
    const out = h('div');
    const f = h('form',{class:'card'}, h('h2',null,'Find a customer’s order'), h('div',{class:'row'}, inp, h('button',{class:'btn', type:'submit'}, 'Find')), out);
    f.addEventListener('submit', async e => {
      e.preventDefault(); if (inp.value.trim().length < 2) return;
      out.replaceChildren(h('p',{class:'muted'},'Looking…'));
      let rows; try { rows = await rpc('lookup_orders', {p_q:inp.value.trim()}); } catch(err){ out.replaceChildren(h('p',{class:'msg err'}, /lookup_orders|schema cache/.test(err.message) ? 'Run the latest supabase/catalog.sql in Supabase first.' : err.message)); return; }
      out.replaceChildren();
      if (!rows.length){ out.append(h('p',{class:'small'},'No order found. Check the spelling, or search by the book’s title.')); return; }
      rows.forEach(r => {
        const got = r.qty_received >= r.qty;
        const pk = (r.packages || []).flatMap(p => (p.tracking || []).map(n => h('a',{class:'btn quiet sm', href:trackUrl(n, p.carrier), target:'_blank', rel:'noopener'}, 'Track ' + (p.carrier ? p.carrier.split(' ')[0] : 'package') + ' …' + n.slice(-6))));
        out.append(h('div',{class:'item'},
          h('div',{class:'row'}, h('b',null, r.title), h('span',{class:'chip ' + (got ? 'calm' : r.status === 'draft' ? 'grey' : 'amber')}, got ? 'Here, ready for pickup' : WHERE[r.status] || r.status)),
          h('p',{class:'small'}, [r.customer ? 'For ' + r.customer : '', r.qty + ' from ' + r.vendor, r.po_number, r.sent_at ? 'ordered ' + A.fmtDate(r.sent_at) : '', r.expected_on && !got ? 'expected ' + A.fmtDate(r.expected_on) : '', got && r.received_at ? 'arrived ' + A.fmtDate(r.received_at) : ''].filter(Boolean).join(' · ')),
          r.note ? h('p',{class:'small muted'}, r.note) : null,
          pk.length ? h('div',{class:'row'}, ...pk) : (r.status === 'sent' || r.status === 'confirmed') && !got ? h('p',{class:'small muted'},'No tracking number yet.') : null));
      });
    });
    return f;
  }

  // Managers: paste a vendor's shipping email (PRH ship notice, Amazon or Faire "shipped") to attach its tracking.
  function pasteCard(){
    const ta = h('textarea',{rows:'4', placeholder:'Paste the shipping email here', 'aria-label':'Shipping email text'});
    const go = h('button',{class:'btn sm', type:'submit'}, 'Add tracking'), msg = h('p',{class:'small'});
    const f = h('details',{class:'card'}, h('summary',null, h('b',null,'Add tracking from a shipping email')),
      h('p',{class:'small muted'},'Once the store mailbox is connected this happens by itself every 30 minutes. Until then, paste a vendor’s shipping email here.'),
      h('form',null, ta, h('div',{class:'row'}, go), msg));
    f.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); if (!ta.value.trim()) return; go.disabled = true; msg.textContent = 'Reading…';
      const {data, error} = await A.sb.functions.invoke('shipments', {body:{action:'paste', text:ta.value}});
      let err = data && data.error; if (error && !err){ try { err = (await error.context.json()).error; } catch(_){ err = error.message; } }
      go.disabled = false;
      if (err){ msg.textContent = err === 'no-tracking' ? 'No tracking number found in that text.' : 'Could not read it: ' + err; return; }
      const n = data.notice, r = data.result || {};
      msg.textContent = r.duplicate ? 'Already recorded.' : (n.vendor_name || 'Vendor') + ': ' + n.tracking.join(', ') + (r.matched ? ' added to ' + r.matched + ' order' + (r.matched > 1 ? 's' : '') + '.' : ' saved, but no matching sent order was found.');
      ta.value = '';
    });
    return f;
  }

  // Sent orders become Receiving shipments, so the shipment is waiting when the boxes come.
  function toReceiving(o, ref, eta){
    const s = A.state(); s.receiving = s.receiving || [];
    if (s.receiving.some(x => x.po === o.po_number)) return;
    s.receiving.unshift({id:uid(), site:s.site, ven:o.vendor.name, ref:ref || o.po_number, po:o.po_number, eta:eta || '', at:isoDay(new Date()), status:'ordered',
      lines:o.lines.map(l => ({id:uid(), code:code(l), t:l.title, a:l.contributors || '', qty:l.qty, cost:l.unit_cost == null ? null : +l.unit_cost, price:l.list_price == null ? null : +l.list_price, got:0, bad:0, quote:'', check:''})),
      charges:[], by:A.me ? A.me() : ''});
    A.save();
  }

  // Email the order to the signed-in manager or owner (their own address only), with the CSV attached.
  // Uses the send-order function; until its email service is set up, opens your own email app addressed to you instead.
  async function emailMe(o, btn){
    btn.disabled = true;
    try {
      const {data, error} = await A.sb.functions.invoke('send-order', {body:{po:o.id, store:A.site().name}});
      if (!error && data && data.ok){ toast('Sent to ' + data.to); btn.textContent = 'Emailed ✓'; return; }
      const me = (await A.sb.auth.getUser()).data.user?.email || '';
      if (me) location.href = 'mailto:' + encodeURIComponent(me) + '?subject=' + encodeURIComponent('Order ' + o.po_number + ' for ' + o.vendor.name + ' (not sent yet)') + '&body=' + encodeURIComponent(emailBody(o) + '\n\nPaste list:\n' + pasteText(o));
      toast('Opening your email app (automatic email is not set up yet)');
    } finally { btn.disabled = false; }
  }

  // Arrivals counted automatically (Shopify stock went up for an item on an open order) fill in the matching
  // Receiving shipment, so nobody has to tick them off by hand. Staff only fix shorts and damage.
  function syncReceiving(orders){
    const rec = A.state().receiving; if (!Array.isArray(rec)) return;
    let changed = false;
    orders.forEach(o => { const x = rec.find(r => r.po === o.po_number && r.status !== 'done'); if (!x) return;
      o.lines.forEach(l => { const ln = x.lines.find(y => String(y.code).replace(/[^0-9A-Za-z]/g,'') === code(l).replace(/[^0-9A-Za-z]/g,''));
        if (ln && (l.qty_received || 0) > (ln.got || 0)){ ln.got = l.qty_received; changed = true; } });
      if (changed && x.status === 'ordered') x.status = 'arrived'; });
    if (changed) A.save();
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
    } else {
      const got = l.qty_received || 0, done = got >= l.qty;
      row.append(h('div',{class:'row small'}, h('span',{class:'chip ' + (done ? 'calm' : got ? 'amber' : 'grey')}, got + ' of ' + l.qty + ' received'),
        l.received_at ? h('span',{class:'muted'}, 'checked in ' + A.fmtDate(String(l.received_at).slice(0,10))) : null));
      if ((RANK[A.state().tier] || 0) >= 2 && ['sent','confirmed','received'].includes(o.status)){
        const q = h('input',{type:'number', min:'0', max:'9999', value:String(got), 'aria-label':'Copies of ' + l.title + ' that arrived', style:'max-width:6rem'});
        row.append(h('details',null, h('summary',{class:'small'},'Short, damaged or counted wrong?'), h('div',{class:'row'}, h('label',{class:'small'},'Arrived in good shape '), q,
          h('button',{class:'btn quiet sm', type:'button', onclick:async () => { try { await rpc('set_line_received', {p_line:l.id, p_qty:+q.value || 0}); toast('Saved'); A.route(); } catch(e){ toast(e.message); } }}, 'Save'))));
      }
    }
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
        h('button',{class:'btn sm', type:'button', onclick:e => emailMe(o, e.target)}, 'Email this order to me'),
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
    box.replaceChildren(lookupCard());
    if (isMgr()) box.append(pasteCard(), restockCard());
    syncReceiving(orders);
    if (!orders.length) box.append(h('div',{class:'card'}, h('p',null,'No orders yet. Find a title in '), h('a',{href:'#/titles'},'Title search'), h('p',{class:'small muted'},' and press Add to order next to the vendor you want.')));
    if (isMgr()) box.append(await reorderCard());
    const drafts = orders.filter(o => o.status === 'draft'), rest = orders.filter(o => o.status !== 'draft' && o.lines.length);
    if (drafts.length) box.append(h('h2',null,'Open orders'), ...drafts.map(orderCard));
    if (rest.length) box.append(h('h2',null,'Sent and recent'), ...rest.map(orderCard));
    if (!isMgr() && drafts.length) box.append(h('p',{class:'small muted'},'A manager or the owner sends orders.'));
  }

  // Restock what sold: pick dates and a word (manga, a publisher, a series), see every title that sold with what is
  // on the shelf and on order, and build draft orders per vendor in one tap. Drafts are reviewed and sent below.
  function restockCard(){
    const today = new Date(), ago = d => isoDay(new Date(today.getTime() - d * 864e5));
    const from = h('input',{type:'date', value:ago(28), 'aria-label':'Sold from'}), to = h('input',{type:'date', value:isoDay(today), 'aria-label':'Sold to'});
    const q = h('input',{type:'search', placeholder:'manga, a publisher, a series… (blank = everything)', value:'manga', 'aria-label':'Which items'});
    const cover = h('select',{'aria-label':'How much to restock'}, [['1','Bring back to what sold'],['1.5','What sold plus half'],['2','Double what sold'],['0.5','Half of what sold']].map(([v,t]) => h('option',{value:v}, t)));
    const out = h('div',{class:'grid'});
    const f = h('form',{class:'row'}, from, to, q, cover, h('button',{class:'btn', type:'submit'}, 'Show what sold'));
    const card = h('details',{class:'card', open:true}, h('summary',null, h('b',null,'Restock what sold')),
      h('p',{class:'small muted'},'Everything that sold in these dates: how many sold, how many are on the shelf now, how many are already on order, and how many to order. Each title goes to the best vendor (an active account first, then stock, then cost). You can move a title to another vendor. Building the drafts sends nothing: you review and send each order below.'), f, out);
    async function run(){
      out.replaceChildren(h('p',{class:'muted'},'Loading…'));
      let groups;
      try { groups = await rpc('restock_sold', {p_from:from.value, p_to:to.value, p_q:q.value.trim() || null, p_cover:+cover.value}); }
      catch(e){ out.replaceChildren(h('p',{class:'msg err'}, /restock_sold|schema cache/.test(e.message) ? 'Needs the latest supabase/catalog.sql (section 16) and the Shopify link.' : e.message)); return; }
      if (!groups.length){ out.replaceChildren(h('p',{class:'small muted'},'Nothing matching sold in those dates.')); return; }
      // one row per title; the vendor can be changed, so rows are regrouped when building
      const rows = [];
      const lines = groups.flatMap(g => g.items);
      const need = lines.filter(i => i.suggest > 0), units = need.reduce((a,i) => a + i.suggest, 0);
      const est = need.reduce((a,i) => a + (i.cost != null ? i.cost * i.suggest : 0), 0);
      const sum = h('p',null, lines.length + ' titles sold · ' + lines.reduce((a,i) => a + i.sold, 0) + ' copies · ' + need.length + ' titles to restock (' + units + ' copies' + (est ? ', about ' + fmt(est) + ' at cost' : '') + ')');
      out.replaceChildren(sum);
      groups.forEach(g => {
        const sec = h('div',{class:'card'}, h('h3',null, g.vendor, ' ', h('span',{class:'chip ' + (g.orderable ? 'calm' : g.vendor_id ? 'amber' : 'grey')}, g.orderable ? 'Can order now' : g.vendor_id ? (g.status || 'Account pending') : 'No vendor')));
        g.items.forEach(it => {
          const qty = h('input',{type:'number', min:'0', max:'9999', value:String(it.suggest), style:'width:5em', 'aria-label':'Quantity for ' + it.title});
          const opts = (it.alts || []).map(a => h('option',{value:a.vendor_id, selected:a.vendor_id === g.vendor_id}, a.vendor + (a.status !== 'Active' ? ' (' + a.status + ')' : '') + (a.cost != null ? ' · ' + fmt(+a.cost) : '') + (a.availability && a.availability !== 'unknown' ? ' · ' + (AV[a.availability] || [a.availability])[0] : '')));
          const sel = opts.length ? h('select',{'aria-label':'Vendor for ' + it.title}, opts) : h('span',{class:'small muted'},'Link its Shopify vendor (' + (it.shopify_vendor || 'blank') + ') under Catalog imports');
          rows.push({it, qty, sel});
          sec.append(h('div',{class:'item'}, h('b',null, it.title),
            h('span',{class:'small muted'}, [it.item_key.replace(/^sku:/,'SKU '), 'sold ' + it.sold, it.available + ' on shelf', it.on_order ? it.on_order + ' on order' : '', it.cost != null ? fmt(+it.cost) + ' cost' : '', it.price != null ? fmt(+it.price) + ' shelf' : ''].filter(Boolean).join(' · ')),
            h('div',{class:'row'}, h('label',{class:'small'}, 'Order ', qty), sel)));
        });
        out.append(sec);
      });
      const build = h('button',{class:'btn', type:'button', onclick:async () => {
        const send = rows.filter(r => r.sel.tagName === 'SELECT' && +r.qty.value > 0).map(r => ({vendor_id:r.sel.value, item_key:r.it.item_key, qty:Math.min(9999, Math.round(+r.qty.value))}));
        if (!send.length) return toast('Nothing to order: set a quantity above 0');
        build.disabled = true;
        try { const res = await rpc('restock_to_orders', {p:send}); toast(res.lines + ' titles added to ' + res.orders + ' draft order' + (res.orders === 1 ? '' : 's')); A.route(); }
        catch(e){ build.disabled = false; toast('Could not build the drafts: ' + e.message); }
      }}, 'Build draft orders');
      out.append(h('div',{class:'row'}, build, h('button',{class:'btn quiet', type:'button', onclick:() => download('restock-' + isoDay(today) + '.csv', 'text/csv', toCsv([['Vendor','ISBN/SKU','Title','Sold','On shelf','On order','Order','Cost each','Shelf price'],
        ...rows.map(r => [r.sel.tagName === 'SELECT' ? r.sel.selectedOptions[0].textContent.split(' · ')[0] : 'No vendor', r.it.item_key.replace(/^sku:/,''), r.it.title, r.it.sold, r.it.available, r.it.on_order, r.qty.value, r.it.cost ?? '', r.it.price ?? ''])]))}, 'Download (.csv)')),
        h('p',{class:'small muted'},'Titles at a vendor whose account is still pending are added to that vendor’s draft too, so the order is ready the day the account opens. Move them to an active vendor if you need them now.'));
    }
    f.addEventListener('submit', e => { e.preventDefault(); run(); });
    return card;
  }

  // Running low in Shopify and sold in the last 30 days, grouped by the vendor you order each one through.
  async function reorderCard(){
    const card = h('details',{class:'card'}, h('summary',null, h('b',null,'Reorder suggestions')));
    let data;
    try { data = await rpc('reorder_suggestions', {p_min:1}); } catch(e){ card.append(h('p',{class:'small muted'}, /reorder_suggestions|schema cache|shopify/.test(e.message) ? 'Needs the Shopify link and the latest catalog.sql.' : e.message)); return card; }
    if (!data.length){ card.append(h('p',{class:'small muted'},'Nothing selling is down to 1 or fewer right now (items already on an order are left out).')); return card; }
    card.querySelector('summary').append(' · ' + data.reduce((a,g) => a + g.items.length, 0) + ' items');
    data.forEach(g => {
      card.append(h('h3',null, g.vendor));
      g.items.slice(0, 40).forEach(it => {
        const add = g.vendor_id ? h('button',{class:'btn quiet sm', type:'button', onclick:async e => { if (await addToOrder(g.vendor_id, it.item_key, Math.max(1, Math.min(it.sold30, 5)), 'Reorder')) { e.target.textContent = 'Added ✓'; e.target.disabled = true; } }}, 'Add ' + Math.max(1, Math.min(it.sold30, 5))) : null;
        card.append(h('div',{class:'row small'}, h('span',null, it.title + ' · ' + it.available + ' left · sold ' + it.sold30 + ' in 30 days'), add));
      });
      if (!g.vendor_id) card.append(h('p',{class:'small muted'},'Link this Shopify vendor to the vendor you order from under Catalog imports, and these can be added to an order.'));
    });
    card.append(h('p',{class:'small muted'},'Suggested quantity is what sold in 30 days, up to 5. Change it on the order.'));
    return card;
  }

  // Every purchase by ISBN, from orders made here and shipments checked in from any site.
  async function historyView(v){
    v.append(head('Buying · ' + A.site().name, 'Purchase history', 'Every title you bought: vendor, date, quantity, cost, list and shelf price, and margin. Orders from Faire, Amazon or the PRH portal are added when the shipment is checked in under Receiving.'));
    if (!live()) return v.append(h('div',{class:'card'}, h('p',null,'Purchase history uses the shared database.')));
    if (!isMgr()) return v.append(h('div',{class:'card'}, h('p',null,'Managers and the owner see purchase history.')));
    const inp = h('input',{type:'search', placeholder:'ISBN, title or vendor', 'aria-label':'Search purchase history'}), days = h('select',{'aria-label':'Period'}, [[90,'Last 90 days'],[365,'Last year'],[1095,'Last 3 years']].map(([d,t]) => h('option',{value:String(d), selected:d === 365}, t)));
    const out = h('div',{class:'grid'}), f = h('form',{class:'card row', role:'search'}, inp, days, h('button',{class:'btn', type:'submit'}, 'Show'));
    v.append(f, out);
    async function run(){
      out.replaceChildren(h('p',{class:'muted'},'Loading…'));
      let rows; try { rows = await rpc('purchase_history', {p_q:inp.value || null, p_days:+days.value}); } catch(e){ out.replaceChildren(h('p',{class:'msg err'}, e.message)); return; }
      const spent = rows.reduce((a,r) => a + (r.line_cost || 0), 0), units = rows.reduce((a,r) => a + r.qty, 0);
      const withM = rows.filter(r => r.margin != null), avgM = withM.length ? withM.reduce((a,r) => a + r.margin * r.qty, 0) / withM.reduce((a,r) => a + r.qty, 0) : null;
      out.replaceChildren(h('div',{class:'card'}, h('p',null, rows.length + ' lines · ' + units + ' copies · ' + fmt(spent) + (avgM != null ? ' · average margin ' + Math.round(avgM*100) + '%' : '')),
        h('button',{class:'btn quiet sm', type:'button', onclick:() => download('purchase-history-' + isoDay(new Date()) + '.csv', 'text/csv', toCsv([['Date','ISBN/SKU','Title','Author','Publisher','Vendor','Our PO','Their #','Qty','Cost each','List price','Shelf price','Margin','Line cost','Note'],
          ...rows.map(r => [String(r.at).slice(0,10), r.item_key.replace(/^sku:/,''), r.title, r.contributors||'', r.publisher||'', r.vendor, r.po_number, r.vendor_ref||'', r.qty, r.unit_cost ?? '', r.list_price ?? '', r.store_price ?? '', r.margin == null ? '' : Math.round(r.margin*1000)/10 + '%', r.line_cost ?? '', r.note||''])]))}, 'Download (.csv)')));
      rows.slice(0, 300).forEach(r => out.append(h('div',{class:'item'}, h('b',null, r.title), h('span',{class:'small muted'}, [String(r.at).slice(0,10), r.vendor, r.item_key.replace(/^sku:/,'SKU '), r.qty + ' × ' + (r.unit_cost != null ? fmt(+r.unit_cost) : 'cost unknown'),
        r.store_price != null ? 'shelf ' + fmt(+r.store_price) : r.list_price != null ? 'list ' + fmt(+r.list_price) : '', r.margin != null ? Math.round(r.margin*100) + '% margin' : ''].filter(Boolean).join(' · ')))));
    }
    f.addEventListener('submit', e => { e.preventDefault(); run(); });
    run();
  }

  A.register({id:'orders', name:'Orders to vendors', what:'One order per publisher or distributor, built from Title search, with stock per line; send by upload file, email or the vendor’s site, then it waits in Receiving.', tiers:['staff','lead','manager','owner'],
    views:{orders:{t:'Orders', ic:'🛒', render:ordersView}, purchases:{t:'Purchase history', ic:'🧾', render:historyView, min:'manager'}}});
  A.homeHooks.push(v => { if (!live() || !isMgr()) return;
    A.sb.rpc('list_orders', {p_status:'draft'}).then(r => { const n = (r.data||[]).filter(o => o.lines.length).length;
      if (n) v.append(h('div',{class:'card'}, h('h2',null,'Orders to send'), h('p',null, n + (n === 1 ? ' vendor has' : ' vendors have') + ' an open order. '), h('a',{href:'#/orders'},'See orders'))); }); });
})();
