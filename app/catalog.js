// Title search and catalog imports.
// Title search: one search across every vendor's title list (Supabase tables in supabase/catalog.sql). Each result shows
//   which vendors carry it, their last known stock, and the special-order price. Managers and the owner also see cost and margin.
// Catalog imports (managers and owners): load a vendor's title list or stock file, and set each vendor's discounts.
//   ONIX 2.1 or 3.0 (.xml, the publishers' standard feed: titles, prices, discounts, availability, stock on hand)
//   CSV / TSV title lists (Edelweiss exports, PRH MetaExcel or Bookazine/IPG lists saved as CSV, Faire product exports)
//   Stock feeds (.txt: one ISBN per line with a 1/0 or Y/N "in stock" flag, like PRH's daily stock feed)
// Never put account numbers or passwords in vendor records.
(function(){
  'use strict';

  // ---------- parsers (pure functions, also run by tests/catalog-test.js) ----------
  const digitsOnly = s => String(s == null ? '' : s).replace(/[^0-9Xx]/g, '').toUpperCase();
  function isbn13(raw){
    let d = digitsOnly(raw);
    if (d.length === 10){ d = '978' + d.slice(0, 9); let t = 0; for (let i = 0; i < 12; i++) t += (+d[i]) * (i % 2 ? 3 : 1); return d + ((10 - t % 10) % 10); }
    if (/^97[89]\d{10}$/.test(d)){ let t = 0; for (let i = 0; i < 12; i++) t += (+d[i]) * (i % 2 ? 3 : 1); return ((10 - t % 10) % 10) === +d[12] ? d : ''; }
    return '';
  }
  function parseCsv(text){
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const sep = (first.match(/\t/g)||[]).length > (first.match(/,/g)||[]).length ? '\t' : ((first.match(/;/g)||[]).length > (first.match(/,/g)||[]).length ? ';' : ',');
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++){
      const c = text[i];
      if (q){ if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && cell === '') q = true;
      else if (c === sep){ row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r'){ if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x !== '')) rows.push(row);
    return rows;
  }
  // Column names seen in publisher, distributor and Faire exports. First match wins.
  const ALIASES = {
    isbn:['isbn-13','isbn13','isbn 13','ean','ean13','gtin','isbn','item isbn','product isbn','upc/ean'],
    sku:['sku','variant sku','product sku','item number','item #','item no','style number','product code','vendor sku','catalog number'],
    upc:['upc','barcode','variant barcode'],
    title:['title','full title','product name','product title','item name','name','description short'],
    subtitle:['subtitle','sub-title'],
    contributors:['contributor','contributors','author','authors','author/contributor','by','creator','primary author'],
    publisher:['publisher','publisher name','brand','brand name','vendor','maker'],
    imprint:['imprint','imprint name','label'],
    series:['series','series name','series title'],
    format:['format','binding','product form','product type','type'],
    product_class:['class','product class','category','section'],
    pub_date:['pub date','publication date','on sale date','on-sale date','release date','pubdate','on sale'],
    list_price:['us price','list price','price usd','retail price','msrp','suggested retail price','us retail','srp','price','retail'],
    discount:['discount','discount %','discount percent','disc','disc %','trade discount'],
    unit_cost:['wholesale price','wholesale','cost','net price','your price','unit cost','net'],
    availability:['availability','status','availability status','stock status','pub status','sales status'],
    qty:['qty available','quantity available','available quantity','available qty','inventory quantity','stock quantity','on hand quantity','available','on hand','qty on hand','stock','inventory','quantity','qty'],
    case_qty:['case pack','case qty','carton qty','minimum order quantity','min qty','pack'],
    pages:['pages','page count','number of pages'],
    subjects:['bisac','bisac subject','subject','subjects','bisac code']
  };
  const norm = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/[()]/g,'');
  function mapHeader(hdr){
    const H = hdr.map(norm), out = {};
    for (const k in ALIASES){ for (const a of ALIASES[k]){ const i = H.indexOf(a); if (i >= 0 && !Object.values(out).includes(i)){ out[k] = i; break; } } }
    return out;
  }
  const money = v => { const m = String(v||'').replace(/[$,\s]|USD/gi,'').match(/^\d+(\.\d+)?$/); return m ? (+m[0]).toFixed(2) : ''; };
  function pct(v){ const s = String(v||'').replace(/[%\s]/g,''); if (!/^\d*\.?\d+$/.test(s)) return ''; let n = +s; if (n >= 1) n = n / 100; return n > 0 && n < 0.95 ? String(+n.toFixed(4)) : ''; }
  function isoDate(v){
    const s = String(v||'').trim(); let m;
    if ((m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/))) return m[1]+'-'+m[2]+'-'+m[3];
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) { const y = m[3].length === 2 ? '20'+m[3] : m[3]; return y+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0'); }
    if ((m = s.match(/^(\d{4})(\d{2})$/))) return m[1]+'-'+m[2]+'-01';
    return '';
  }
  // Words vendors use for stock, mapped to the app's few states.
  function availWord(v){
    const s = norm(v); if (!s) return '';
    if (/^(ip|in print|in stock|available|active|yes|y|1|true|instock|ready to ship)$/.test(s) || /in stock|available now/.test(s)) return 'in_stock';
    if (/low/.test(s)) return 'low';
    if (/^(nyp|np|forthcoming|not yet published|pre-?order|coming soon)$/.test(s) || /not yet|forthcoming|preorder|pre-order/.test(s)) return 'forthcoming';
    if (/^(op|oop|out of print|op\/na)$/.test(s) || /out of print/.test(s)) return 'out_of_print';
    if (/^(tu|tos|os|bo|backorder|back order|reprinting|temporarily)$/.test(s) || /backorder|back order|reprint|temporar|out of stock/.test(s)) return 'backorder';
    if (/^(no|n|0|false|na|not available|discontinued|cancelled|canceled)$/.test(s) || /not available|discontinued|cancel/.test(s)) return 'not_available';
    return '';
  }
  function fromCsv(text){
    const rows = parseCsv(text); if (!rows.length) return {rows:[], skipped:0, columns:{}};
    // the header is the first row that names an ISBN/SKU column and a title or stock column (some exports have a banner above it)
    let hi = rows.slice(0, 15).findIndex(r => { const m = mapHeader(r); return (m.isbn != null || m.sku != null) && (m.title != null || m.availability != null || m.qty != null); });
    if (hi < 0) hi = 0;
    const M = mapHeader(rows[hi]), out = []; let skipped = 0;
    const g = (r, k) => M[k] == null ? '' : String(r[M[k]] == null ? '' : r[M[k]]).trim();
    for (const r of rows.slice(hi + 1)){
      const isbn = isbn13(g(r,'isbn')) || isbn13(g(r,'upc')), sku = g(r,'sku');
      const key = isbn || (sku ? 'sku:' + sku.slice(0, 80) : '');
      if (!key){ skipped++; continue; }
      const o = {item_key:key, title:g(r,'title'), subtitle:g(r,'subtitle'), contributors:g(r,'contributors'), publisher:g(r,'publisher'),
        imprint:g(r,'imprint'), series:g(r,'series'), format:g(r,'format'), product_class:g(r,'product_class'), pub_date:isoDate(g(r,'pub_date')),
        list_price:money(g(r,'list_price')), discount:pct(g(r,'discount')), unit_cost:money(g(r,'unit_cost')), pages:digitsOnly(g(r,'pages')),
        subjects:g(r,'subjects'), case_qty:digitsOnly(g(r,'case_qty')), vendor_sku:isbn ? sku : '', upc:isbn ? '' : digitsOnly(g(r,'upc'))};
      const a = availWord(g(r,'availability')), q = g(r,'qty');
      if (a) o.availability = a;
      if (/^\d+$/.test(q)){ o.qty = q; if (!a) o.availability = +q > 5 ? 'in_stock' : +q > 0 ? 'low' : 'backorder'; }
      for (const k in o) if (o[k] === '') delete o[k];
      out.push(o);
    }
    return {rows:out, skipped, columns:M};
  }

  // ONIX 2.1 and 3.0, reference or short tags. Read with plain text matching so a large feed doesn't need a full XML tree.
  const SHORT = {product:'product', productidentifier:'productidentifier', productidtype:'b221', idvalue:'b244', titledetail:'titledetail', titletype:'b202',
    titleelement:'titleelement', title:'title', titletext:'b203', titleprefix:'b030', titlewithoutprefix:'b031', subtitle:'b029', contributor:'contributor',
    personname:'b036', corporatename:'b047', productform:'b012', imprint:'imprint', imprintname:'b079', publisher:'publisher', publishername:'b081',
    publishingdate:'publishingdate', publishingdaterole:'x448', date:'b306', publicationdate:'b003', supplydetail:'supplydetail',
    productavailability:'j396', availabilitycode:'j141', stock:'stock', onhand:'j350', price:'price', pricetype:'x462', pricetypecode:'j148',
    priceamount:'j151', currencycode:'j152', discountcoded:'discountcoded', discount:'discount', discountpercent:'j267', collection:'collection',
    series:'series', titleofseries:'b018', numberofpages:'b061', extent:'extent', extenttype:'b218', extentvalue:'b219', packquantity:'j145'};
  const ent = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(+x)).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();
  function blocks(xml, name){
    const names = [name, SHORT[name.toLowerCase()]].filter(Boolean).map(n => n.replace(/[^a-z0-9]/gi,''));
    const re = new RegExp('<(?:\\w+:)?(' + names.join('|') + ')(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?\\1\\s*>', 'gi'), out = []; let m;
    while ((m = re.exec(xml))) out.push(m[2]);
    return out;
  }
  const one = (xml, name) => { const b = blocks(xml, name); return b.length ? ent(b[0]) : ''; };
  const ONIX_AVAIL = c => { c = String(c||'').trim().toUpperCase(); if (!c) return '';
    if (/^\d\d$/.test(c)){ const n = +c; return n >= 10 && n <= 12 ? 'forthcoming' : n >= 20 && n <= 23 ? 'in_stock' : n >= 30 && n <= 34 ? 'backorder' : n === 51 ? 'out_of_print' : n >= 40 && n <= 52 ? 'not_available' : ''; }
    return ({IP:'in_stock', NP:'forthcoming', TU:'backorder', OP:'out_of_print', OI:'out_of_print', RP:'backorder', MD:'not_available', WS:'not_available', CS:'unknown', RF:'unknown', AB:'not_available', AD:'not_available', NA:'not_available', PP:'forthcoming', EX:'not_available', RM:'not_available', WR:'not_available'})[c] || ''; };
  const FORMS = {BA:'Book', BB:'Hardcover', BC:'Paperback', BD:'Loose-leaf', BE:'Spiral bound', BF:'Pamphlet', BH:'Board book', BI:'Rag book', BJ:'Bath book',
    BK:'Novelty book', BP:'Foam book', AA:'Audio', AC:'Audio CD', AJ:'Audio download', EA:'Ebook', ED:'Ebook', DG:'Ebook', CA:'Map', PC:'Calendar', ZZ:'Other', ZA:'Merchandise'};
  function fromOnix(xml){
    const out = []; let skipped = 0;
    for (const p of blocks(xml, 'Product')){
      let isbn = '';
      for (const id of blocks(p, 'ProductIdentifier')){ const t = one(id, 'ProductIDType'); if (t === '15' || t === '03'){ isbn = isbn13(one(id, 'IDValue')); if (isbn) break; } }
      if (!isbn){ skipped++; continue; }
      // title: ONIX 3 TitleDetail type 01, else ONIX 2.1 Title
      let title = '', subtitle = '';
      const own = p.replace(/<(?:\w+:)?(Collection|collection|Series|series)(?:\s[^>]*)?>[\s\S]*?<\/(?:\w+:)?\1\s*>/g, ''); // series titles are not the book's title
      const td = blocks(own, 'TitleDetail').find(b => one(b, 'TitleType') === '01') || blocks(own, 'TitleDetail')[0];
      const tsrc = td ? (blocks(td, 'TitleElement')[0] || td) : (blocks(own, 'Title')[0] || own);
      title = one(tsrc, 'TitleText') || (one(tsrc, 'TitlePrefix') + ' ' + one(tsrc, 'TitleWithoutPrefix')).trim(); subtitle = one(tsrc, 'Subtitle');
      const contributors = blocks(p, 'Contributor').slice(0, 4).map(c => one(c, 'PersonName') || one(c, 'CorporateName')).filter(Boolean).join('; ');
      let pub = ''; const pd = blocks(p, 'PublishingDate').find(b => ['01','1',''].includes(one(b, 'PublishingDateRole')));
      pub = isoDate(pd ? one(pd, 'Date') : one(p, 'PublicationDate'));
      const series = (blocks(p, 'Collection')[0] ? one(blocks(p, 'Collection')[0], 'TitleText') : '') || (blocks(p, 'Series')[0] ? one(blocks(p, 'Series')[0], 'TitleOfSeries') : '');
      let pages = one(p, 'NumberOfPages');
      if (!pages){ const ex = blocks(p, 'Extent').find(b => ['00','11'].includes(one(b, 'ExtentType'))); if (ex) pages = one(ex, 'ExtentValue'); }
      // supply: the first US-dollar retail price, its discount, availability and stock on hand
      let price = '', discount = '', avail = '', qty = '', caseQty = '';
      for (const sd of blocks(p, 'SupplyDetail')){
        const prices = blocks(sd, 'Price'); const pr = prices.find(x => /^(USD)?$/.test(one(x, 'CurrencyCode')) && ['01','02',''].includes(one(x, 'PriceType') || one(x, 'PriceTypeCode'))) || null;
        if (pr && !price){ price = money(one(pr, 'PriceAmount')); const dp = one(pr, 'DiscountPercent'); if (dp) discount = pct(dp); }
        if (!avail) avail = ONIX_AVAIL(one(sd, 'ProductAvailability') || one(sd, 'AvailabilityCode'));
        const st = blocks(sd, 'Stock')[0]; if (st && !qty) qty = digitsOnly(one(st, 'OnHand'));
        if (!caseQty) caseQty = digitsOnly(one(sd, 'PackQuantity'));
      }
      const o = {item_key:isbn, title:title.slice(0, 400), subtitle, contributors, publisher:one(blocks(p, 'Publisher')[0] || '', 'PublisherName'),
        imprint:one(blocks(p, 'Imprint')[0] || '', 'ImprintName'), series, format:FORMS[one(p, 'ProductForm')] || one(p, 'ProductForm'), pub_date:pub,
        list_price:price, discount, pages:digitsOnly(pages), case_qty:caseQty};
      if (avail) o.availability = avail;
      if (qty){ o.qty = qty; if (!avail || avail === 'in_stock') o.availability = +qty > 5 ? 'in_stock' : +qty > 0 ? 'low' : 'backorder'; }
      for (const k in o) if (o[k] === '') delete o[k];
      if (!o.title){ skipped++; continue; }
      out.push(o);
    }
    return {rows:out, skipped};
  }
  // Stock feeds: lines like "9780143039433|1", "9780143039433,Y", "9780143039433 0".
  function fromStock(text){
    const out = []; let skipped = 0;
    for (const line of String(text).split(/\r?\n/)){
      const m = line.match(/(97[89][\d-]{10,16}|\d{10})\D+([01YN]|yes|no|true|false)\s*$/i);
      if (!m){ if (line.trim()) skipped++; continue; }
      const k = isbn13(m[1]); if (!k){ skipped++; continue; }
      out.push({item_key:k, availability:/^(1|y|yes|true)$/i.test(m[2]) ? 'in_stock' : 'backorder'});
    }
    return {rows:out, skipped};
  }
  function detect(name, text){
    const head = String(text).slice(0, 2000);
    if (/<\s*(ONIXMessage|ONIXmessage)\b|<\s*Product\b[^>]*>|<\s*product\b/i.test(head) && /^\s*</.test(head.replace(/^﻿/, ''))) return 'onix';
    if (/\.txt$/i.test(name) && /^\s*(97[89][\d-]{10,16}|\d{10})\D+([01YN]|yes|no)\s*$/im.test(head)) return 'stock';
    return /faire/i.test(name) ? 'faire' : 'csv';
  }
  function parse(name, text){ const kind = detect(name, text); const r = kind === 'onix' ? fromOnix(text) : kind === 'stock' ? fromStock(text) : fromCsv(text); r.kind = kind; return r; }

  const api = {isbn13, parseCsv, fromCsv, fromOnix, fromStock, detect, parse, availWord};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;
  window.SSCatalog = api;

  // ---------- screens ----------
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money:fmt} = A;
  const RANK = {staff:1, lead:2, manager:3, owner:4};
  const rank = () => RANK[A.state().tier] || 0;
  const live = () => !A.demo && !!A.sb;
  const BIG = 40e6; // files larger than this are read in parts (ONIX only)
  const AV = {in_stock:['In stock','calm'], low:['Low stock','amber'], backorder:['Backorder','amber'], forthcoming:['Not out yet','grey'],
    out_of_print:['Out of print','red'], not_available:['Not available','red'], unknown:['Stock unknown','grey']};
  const ago = t => { if (!t) return ''; const d = Math.floor((Date.now() - new Date(t)) / 864e5); return d <= 0 ? 'checked today' : d === 1 ? 'checked yesterday' : 'checked ' + d + ' days ago'; };
  const notLive = v => v.append(h('div',{class:'card'}, h('p',null,'Title search uses the shared database. Sign in to the live app (not the sample version) after the owner runs supabase/catalog.sql.')));

  function offerRow(t, o){
    const [label, tone] = AV[o.availability] || AV.unknown;
    const bits = [h('b',null,o.vendor), h('span',{class:'chip '+tone}, label + (o.qty != null ? ' · ' + o.qty : '')),
      o.checked_at ? h('span',{class:'small muted'}, ago(o.checked_at)) : null,
      o.status !== 'Active' ? h('span',{class:'small muted'}, '(' + o.status + ')') : null];
    const money = [];
    if (o.cost != null) money.push('Cost ' + fmt(+o.cost) + (o.margin_at_list != null ? ' · ' + Math.round(o.margin_at_list * 100) + '% off list' : ''));
    if (o.quote) money.push('Special order ' + fmt(+o.quote.price) + (o.quote.profit != null ? ' (you make ' + fmt(+o.quote.profit) + ')' : ''));
    if (o.lead_days) money.push('about ' + o.lead_days + ' days');
    const row = h('div',{class:'item'}, h('div',{class:'row'}, ...bits.filter(Boolean)),
      money.length ? h('p',{class:'small'}, money.join(' · ')) : null,
      o.over_list ? h('p',{class:'small muted'}, 'This is above the list price of ' + fmt(+t.list_price) + '. Most stores charge list price for books with a printed price.') : null);
    const tools = h('div',{class:'row'});
    if (o.check_url) tools.append(h('a',{class:'btn quiet sm', href:o.check_url, target:'_blank', rel:'noopener', 'aria-label':'Check stock at ' + o.vendor + ' (opens their site)'}, 'Check stock'));
    const sel = h('select',{'aria-label':'Stock you saw at '+o.vendor}, h('option',{value:''},'Record stock you saw…'), Object.entries(AV).map(([k,[l]]) => h('option',{value:k}, l)));
    sel.addEventListener('change', async () => { if (!sel.value) return;
      const {error} = await A.sb.rpc('set_offer_stock', {p_vendor:o.vendor_id, p_item:t.item_key, p_availability:sel.value, p_qty:null});
      toast(error ? 'Could not save: ' + error.message : 'Saved'); if (!error){ o.availability = sel.value; o.checked_at = new Date().toISOString(); A.route(); } });
    if (window.SSOrders){
      const q = h('input',{type:'number', min:'1', max:'999', value:'1', 'aria-label':'Copies to order from ' + o.vendor, style:'max-width:5rem'});
      tools.append(q, h('button',{class:'btn sm', type:'button', onclick:async e => { const who = prompt('Special order? Type the customer’s name (or leave blank for shelf stock)'); if (who === null) return; if (await SSOrders.addToOrder(o.vendor_id, t.item_key, +q.value || 1, who.trim() ? 'special order' : '', who.trim())) e.target.textContent = 'Added ✓'; }}, 'Add to order'));
    }
    tools.append(sel);
    if (o.quote) tools.append(h('button',{class:'btn quiet sm', type:'button', onclick:e => A.copy(t.title + ' (' + t.item_key + ') from ' + o.vendor + ': ' + fmt(+o.quote.price) + (o.cost != null ? ', cost ' + fmt(+o.cost) : ''), e.target)}, 'Copy quote'));
    row.append(tools);
    return row;
  }
  // Not in the store yet: make it a Shopify product (ISBN, price, cost, cover) without leaving the app.
  function shopifyBox(t){
    const wrap = h('div',{class:'row'});
    const open = h('button',{class:'btn quiet sm', type:'button'}, 'Create in Shopify');
    wrap.append(h('span',{class:'small muted'}, 'Not in your Shopify store yet.'), open);
    open.addEventListener('click', () => {
      const offers = t.offers.filter(o => o.status === 'Active' || !o.status);
      const best = offers.filter(o => o.cost != null).sort((a,b) => (['in_stock','low'].includes(b.availability) - ['in_stock','low'].includes(a.availability)) || a.cost - b.cost)[0];
      const price = h('input',{type:'number', step:'0.01', min:'0.01', required:true, value:t.list_price != null ? (+t.list_price).toFixed(2) : (best && best.quote ? (+best.quote.price).toFixed(2) : ''), 'aria-label':'Shelf price', style:'max-width:7rem'});
      const cost = h('input',{type:'number', step:'0.01', min:'0', value:best ? (+best.cost).toFixed(2) : '', 'aria-label':'Your cost', style:'max-width:7rem'});
      const ven = h('select',{'aria-label':'Vendor you order it from'}, h('option',{value:''}, 'Order from: not set'), offers.map(o => h('option',{value:o.vendor_id, selected:best && o.vendor_id === best.vendor_id}, o.vendor)));
      const shopVendor = h('input',{type:'text', maxlength:'255', value:t.publisher || t.imprint || '', 'aria-label':'Vendor name in Shopify (usually the publisher)'});
      const web = h('input',{type:'checkbox', checked:true}), draft = h('input',{type:'checkbox'}), so = h('input',{type:'checkbox'});
      ven.addEventListener('change', () => { const o = offers.find(x => x.vendor_id === ven.value); if (o && o.cost != null) cost.value = (+o.cost).toFixed(2); });
      const go = h('button',{class:'btn sm', type:'submit'}, 'Create product');
      const f = h('form',{class:'grid small'},
        h('label',null,'Shelf price ', price, t.list_price != null ? h('span',{class:'muted'}, ' (list ' + fmt(+t.list_price) + ')') : null),
        h('label',null,'Your cost ', cost),
        h('label',null,'Ordered through ', ven),
        h('label',null,'Shopify vendor ', shopVendor),
        h('label',null, web, ' Also show on the website (leave off for 18+ titles)'),
        h('label',null, so, ' Tag as a special order'),
        h('label',null, draft, ' Save as a draft in Shopify'),
        h('div',{class:'row'}, go, h('button',{class:'btn quiet sm', type:'button', onclick:() => wrap.replaceChildren(h('span',{class:'small muted'}, 'Not in your Shopify store yet.'), open)}, 'Cancel')));
      f.addEventListener('submit', async e => {
        e.preventDefault(); go.disabled = true; go.textContent = 'Creating…';
        const {data, error} = await A.sb.functions.invoke('shopify-sync', {body:{action:'create', item_key:t.item_key, price:+price.value, cost:cost.value === '' ? null : +cost.value,
          vendor:shopVendor.value.trim(), vendor_id:ven.value || null, pos_only:!web.checked, status:draft.checked ? 'DRAFT' : 'ACTIVE', special_order:so.checked}});
        let msg = data && data.error;
        if (error && !msg){ try { msg = (await error.context.json()).error; } catch(_){ msg = error.message; } }
        if (msg){ go.disabled = false; go.textContent = 'Create product'; toast(msg === 'not-connected' ? 'Connect Shopify first (Shopify screen).' : msg); return; }
        t.store = {available:0, on_hand:0, price:+price.value};
        wrap.replaceChildren(h('p',{class:'small'}, 'In Shopify now' + (data.channels ? ' (' + data.channels + ')' : '') + '. ',
          h('a',{href:data.admin_url, target:'_blank', rel:'noopener'}, 'Open in Shopify')));
      });
      wrap.replaceChildren(f);
      price.focus();
    });
    return wrap;
  }
  let lastQ = '', lastRes = null;
  function titlesView(v){
    v.append(head('Buying · ' + A.site().name, 'Title search', 'One search across every vendor’s title list: who has it, their stock, and what to charge for a special order.'));
    if (!live()) return notLive(v);
    const inp = h('input',{type:'search', name:'q', value:lastQ, placeholder:'ISBN, title, author or series', autocomplete:'off', 'aria-label':'Search titles'});
    const out = h('div',{class:'grid'});
    const f = h('form',{class:'card row', role:'search'}, inp, h('button',{class:'btn', type:'submit'}, 'Search'));
    f.addEventListener('submit', e => { e.preventDefault(); run(inp.value); });
    v.append(f, out);
    async function run(q){
      lastQ = q.trim(); if (lastQ.length < 2) return;
      out.replaceChildren(h('p',{class:'muted'},'Searching…'));
      const {data, error} = await A.sb.rpc('search_titles', {p_q:lastQ, p_limit:25, p_qty:1});
      if (error){ out.replaceChildren(h('p',{class:'msg err'}, /search_titles|schema cache/.test(error.message) ? 'The catalog is not set up yet. The owner needs to run supabase/catalog.sql in Supabase.' : 'Search failed: ' + error.message)); return; }
      lastRes = data; show(data);
    }
    function show(data){
      out.replaceChildren();
      const isb = isbn13(lastQ);
      if (!data.length){
        out.append(h('div',{class:'card'}, h('p',null,'No vendor list has this yet.'), isb ? h('button',{class:'btn ghost', type:'button', onclick:() => openLib(isb)}, 'Look it up on Open Library') : h('p',{class:'small muted'},'Try the ISBN, or fewer words.')));
        return; }
      data.forEach(t => {
        const meta = [t.contributors, [t.imprint || t.publisher, t.format].filter(Boolean).join(', '), t.pub_date ? t.pub_date.slice(0,4) : '', t.list_price != null ? 'List ' + fmt(+t.list_price) : ''].filter(Boolean).join(' · ');
        const card = h('div',{class:'card'}, h('h2',null, t.title + (t.subtitle ? ': ' + t.subtitle : '')), h('p',{class:'small muted'}, meta + ' · ' + t.item_key.replace(/^sku:/, 'SKU ')));
        if (t.store) card.append(h('p',{class:'small'}, 'In your store: ' + (t.store.available ?? 0) + ' available' + (t.store.price != null ? ' · shelf ' + fmt(+t.store.price) : '') + (t.store.sold30 != null ? ' · sold ' + t.store.sold30 + ' in 30 days' : '')));
        else if (rank() >= 3) card.append(shopifyBox(t));
        if (!t.offers.length) card.append(h('p',{class:'small'}, 'No vendor list carries this yet. Check a vendor and record what you find.'));
        t.offers.forEach(o => card.append(offerRow(t, o)));
        out.append(card);
      });
    }
    async function openLib(isb){
      out.replaceChildren(h('p',{class:'muted'},'Looking up…'));
      try {
        const r = await fetch('https://openlibrary.org/isbn/' + isb + '.json'); if (!r.ok) throw new Error('not found');
        const b = await r.json(); let authors = '';
        if (Array.isArray(b.authors)) authors = (await Promise.all(b.authors.slice(0,3).map(a => fetch('https://openlibrary.org' + a.key + '.json').then(x => x.json()).then(x => x.name).catch(() => '')))).filter(Boolean).join('; ');
        const p = {isbn:isb, title:b.title, subtitle:b.subtitle || '', contributors:authors, publisher:(b.publishers||[])[0] || '', pages:String(b.number_of_pages||'')};
        const {error} = await A.sb.rpc('add_title', {p}); if (error) throw error;
        toast('Added from Open Library'); run(isb);
      } catch(e){ out.replaceChildren(h('div',{class:'card'}, h('p',null,'Open Library does not have this ISBN either. Check with a vendor directly.'))); }
    }
    if (lastRes) show(lastRes);
    setTimeout(() => inp.focus(), 0);
  }

  // ---------- imports and vendor discounts (managers and owners) ----------
  async function importView(v){
    v.append(head('Buying · ' + A.site().name, 'Catalog imports', 'Load each vendor’s title list or stock file, and set the discounts that decide your cost. No account numbers or passwords here.'));
    if (!live()) return notLive(v);
    if (rank() < 3){ v.append(h('div',{class:'card'}, h('p',null,'Managers and the owner load catalogs.'))); return; }
    const box = h('div'); v.append(box);
    let {data:vendors, error} = await A.sb.from('vendors').select('*').order('name');
    if (error){ box.append(h('p',{class:'msg err'}, /vendors|schema cache/.test(error.message) ? 'The catalog is not set up yet. Run supabase/catalog.sql in Supabase first.' : error.message)); return; }
    if (A.state().tier === 'owner'){
      box.append(h('div',{class:'card'}, h('h2',null,'Vendor list'), h('p',{class:'small muted'}, vendors.length + ' vendors in the database. Copy any new ones from the Vendors screen (matched by name; nothing is overwritten).'),
        h('button',{class:'btn quiet sm', type:'button', onclick:async () => { const r = await A.sb.rpc('copy_app_vendors'); toast(r.error ? r.error.message : r.data + ' vendors copied'); A.route(); }}, 'Copy vendors from the Vendors screen')));
    }
    if (!vendors.length) return;
    // 1. import a file
    const vs = h('select',{name:'vendor', required:true}, vendors.map(x => h('option',{value:x.id}, x.name)));
    const fi = h('input',{type:'file', name:'file', accept:'.xml,.onix,.csv,.tsv,.txt', required:true});
    const prev = h('div',{class:'small'}), go = h('button',{class:'btn', type:'submit', disabled:true}, 'Import');
    let parsed = null;
    fi.addEventListener('change', async () => {
      parsed = null; go.disabled = true; prev.replaceChildren();
      const f = fi.files[0]; if (!f) return;
      if (/\.xlsx?$/i.test(f.name)){ prev.append(h('p',{class:'msg err'},'Excel files: open it and use File > Save As > CSV, then pick the CSV.')); return; }
      prev.append(h('p',{class:'muted'},'Reading ' + f.name + '…'));
      const big = f.size > BIG, txt = await (big ? f.slice(0, 4e6) : f).text(), r = parse(f.name, txt); parsed = r;
      if (big && r.kind !== 'onix'){ prev.replaceChildren(h('p',{class:'msg err'}, 'This file is ' + Math.round(f.size/1e6) + ' MB. Files over ' + BIG/1e6 + ' MB need to be ONIX, or split into smaller CSV files.')); parsed = null; return; }
      r.big = big;
      const kindName = {onix:'ONIX feed', csv:'title list (CSV)', faire:'Faire export (CSV)', stock:'stock feed'}[r.kind];
      prev.replaceChildren(h('p',null, kindName + ': ' + (big ? 'large file (' + Math.round(f.size/1e6) + ' MB), read in parts as it imports. First part: ' : '') + r.rows.length.toLocaleString() + ' rows ready' + (r.skipped ? ', ' + r.skipped + ' without an ISBN or SKU skipped' : '') + '.'),
        r.columns ? h('p',{class:'small muted'}, 'Columns found: ' + (Object.keys(r.columns).join(', ') || 'none') + '. A list price plus a discount, or a wholesale cost, sets your cost.') : null,
        r.kind === 'stock' ? h('p',{class:'small muted'}, 'Stock feeds update titles already loaded from this vendor’s title list.') : null,
        h('ul',null, r.rows.slice(0, 4).map(x => h('li',null, (x.title || x.item_key) + (x.list_price ? ' · ' + fmt(+x.list_price) : '') + (x.unit_cost ? ' · cost ' + fmt(+x.unit_cost) : '') + (x.availability ? ' · ' + (AV[x.availability]||AV.unknown)[0] : '')))));
      go.disabled = !r.rows.length;
    });
    const f = h('form',{class:'card grid'}, h('h2',null,'Load a title list or stock file'),
      h('p',{class:'small muted'}, 'ONIX (.xml) from a publisher feed, a CSV title list (Edelweiss, PRH MetaExcel or a distributor list saved as CSV, a Faire product export), or a stock feed (.txt).'),
      h('label',{class:'f'},'Vendor', vs), h('label',{class:'f'},'File', fi), prev, go);
    f.addEventListener('submit', async e => {
      e.preventDefault(); if (!parsed) return; go.disabled = true;
      const st = await A.sb.rpc('start_catalog_import', {p_vendor:vs.value, p_kind:parsed.kind, p_file:fi.files[0].name});
      if (st.error){ toast(st.error.message); go.disabled = false; return; }
      const file = fi.files[0]; let done = 0, nt = 0, no = 0;
      const bar = h('progress',{max:String(parsed.big ? file.size : parsed.rows.length), value:'0'}), msg = h('p',{class:'small muted'},'Importing… keep this screen open.');
      prev.replaceChildren(bar, msg);
      async function send(rows){
        for (let i = 0; i < rows.length; i += 500){
          let r = await A.sb.rpc('import_catalog_rows', {p_import:st.data, p_rows:rows.slice(i, i + 500)});
          if (r.error) r = await A.sb.rpc('import_catalog_rows', {p_import:st.data, p_rows:rows.slice(i, i + 500)}); // one retry for a dropped connection
          if (r.error) throw new Error('Stopped after ' + done.toLocaleString() + ' rows: ' + r.error.message + '. Importing the same file again is safe.');
          done += r.data.rows; nt += r.data.new_titles; no += r.data.offers; if (!parsed.big) bar.value = done; msg.textContent = done.toLocaleString() + ' rows so far…';
        }
      }
      try {
        if (!parsed.big) await send(parsed.rows);
        else { // large ONIX feed: read 8 MB at a time and send each complete <Product> as it goes
          let pos = 0, carry = '';
          while (pos < file.size){
            const chunk = carry + await file.slice(pos, pos + 8e6).text(); pos += 8e6;
            const cut = pos >= file.size ? chunk.length : Math.max(chunk.lastIndexOf('</Product>'), chunk.lastIndexOf('</product>'));
            if (cut < 0){ carry = chunk; continue; }
            const end = pos >= file.size ? cut : cut + 10;
            await send(fromOnix(chunk.slice(0, end)).rows); carry = chunk.slice(end); bar.value = Math.min(pos, file.size);
          }
        }
      } catch(err){ prev.append(h('p',{class:'msg err'}, err.message)); return; }
      prev.replaceChildren(h('p',{class:'msg'}, 'Done: ' + done.toLocaleString() + ' rows, ' + nt.toLocaleString() + ' new titles, ' + no.toLocaleString() + ' vendor listings updated.'));
      parsed = null; fi.value = '';
    });
    box.append(f);
    // 2. Shopify: every product becomes searchable and orderable, linked to the vendor you order it through
    const sh = h('div',{class:'card grid'}, h('h2',null,'Products from Shopify'),
      h('p',{class:'small muted'},'Every Shopify product with an ISBN or SKU is added to Title search every hour. Link each Shopify vendor name (publisher or Faire brand) to the vendor you order it through, and its products get that vendor’s stock, cost and reorder suggestions. Faire items keep the wholesale cost Faire’s Shopify app recorded.'),
      h('button',{class:'btn quiet sm', type:'button', onclick:async e => { e.target.disabled = true; const r = await A.sb.rpc('catalog_from_shopify'); e.target.disabled = false; toast(r.error ? r.error.message : r.data.products + ' products, ' + r.data.vendor_links + ' vendor links updated'); }}, 'Update from Shopify now'));
    const un = await A.sb.rpc('unlinked_shopify_vendors');
    if (!un.error && un.data.length){
      sh.append(h('h3',null, un.data.length + ' Shopify vendor names not linked yet'));
      un.data.slice(0, 60).forEach(u => { const sel = h('select',{'aria-label':'Order ' + u.shopify_vendor + ' through'}, h('option',{value:''},'Order through…'), vendors.map(x => h('option',{value:x.id}, x.name)));
        sel.addEventListener('change', async () => { if (!sel.value) return; const r = await A.sb.from('vendor_aliases').upsert({shopify_vendor:u.shopify_vendor, vendor_id:sel.value}); toast(r.error ? r.error.message : 'Linked'); });
        sh.append(h('div',{class:'row small'}, h('span',null, u.shopify_vendor + ' (' + u.products + ')'), sel)); });
    } else if (un.error) sh.append(h('p',{class:'small muted'},'Connect Shopify first (Shopify screen).'));
    box.append(sh);
    // 3. vendor cost settings
    const {data:disc} = await A.sb.from('vendor_discounts').select('*');
    box.append(h('h2',null,'Discounts, stock and ordering links'), h('p',{class:'small muted'},'Cost = list price less the discount. A vendor list with its own discount or a wholesale cost overrides these. Margin at list price equals the discount.'));
    vendors.forEach(x => {
      const mine = (disc||[]).filter(d => d.vendor_id === x.id);
      const form = h('form',{class:'grid g2'},
        h('label',{class:'f'},'Kind', h('select',{name:'kind'}, ['publisher','distributor','wholesaler','marketplace','audiobook','general','consignor','other'].map(k => h('option',{selected:k===x.kind},k)))),
        h('label',{class:'f'},'Usual discount off list (%)', h('input',{type:'number', name:'disc', min:'0', max:'90', step:'0.5', value:x.default_discount != null ? String(+(x.default_discount*100).toFixed(2)) : ''})),
        h('label',{class:'f'},'Returnable', h('select',{name:'ret'}, h('option',{value:'true', selected:x.returnable},'Yes'), h('option',{value:'false', selected:!x.returnable},'No'))),
        h('label',{class:'f'},'Free freight over ($)', h('input',{type:'number', name:'ff', min:'0', step:'1', value:x.free_freight_over != null ? String(x.free_freight_over) : ''})),
        h('label',{class:'f'},'Stock check link ({isbn} or {q} is filled in)', h('input',{type:'url', name:'url', maxlength:'300', value:x.stock_check_url || '', placeholder:'https://…search?q={isbn}'})),
        h('label',{class:'f'},'How they take orders', h('select',{name:'om'}, [['file','Upload or paste ISBNs on their site'],['email','Email'],['site','Order on their website'],['marketplace','Marketplace (Faire, Amazon)'],['phone','Phone'],['edi','EDI (Pubnet)']].map(([k,t]) => h('option',{value:k, selected:k === (x.order_method||'file')}, t)))),
        h('label',{class:'f'},'Ordering page link', h('input',{type:'url', name:'ou', maxlength:'300', value:x.order_url || '', placeholder:'https://…'})),
        h('label',{class:'f'},'Order email (if they take orders by email)', h('input',{type:'email', name:'oe', maxlength:'120', value:x.order_email || ''})),
        h('button',{class:'btn sm', type:'submit'},'Save'));
      form.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(form);
        const r = await A.sb.from('vendors').update({kind:d.get('kind'), default_discount:d.get('disc') === '' ? null : +d.get('disc') / 100, returnable:d.get('ret') === 'true',
          free_freight_over:d.get('ff') === '' ? null : +d.get('ff'), stock_check_url:String(d.get('url')||'').trim() || null, order_method:d.get('om') || 'file', order_url:String(d.get('ou')||'').trim() || null, order_email:String(d.get('oe')||'').trim() || null, updated_at:new Date().toISOString()}).eq('id', x.id);
        toast(r.error ? r.error.message : 'Saved'); });
      const dl = h('ul',{class:'small'}, mine.map(d => h('li',null, d.product_class + ', ' + (d.returnable ? 'returnable' : 'non-returnable') + (d.min_qty > 1 ? ', ' + d.min_qty + '+ copies' : '') + ': ' + +(d.discount*100).toFixed(2) + '% ',
        h('button',{class:'btn quiet sm', type:'button', onclick:async () => { const r = await A.sb.from('vendor_discounts').delete().eq('id', d.id); toast(r.error ? r.error.message : 'Removed'); A.route(); }}, 'Remove'))));
      const add = h('form',{class:'row'},
        h('input',{type:'text', name:'cls', placeholder:'Class (any, manga, comics…)', 'aria-label':'Product class', maxlength:'40', required:true}),
        h('input',{type:'number', name:'pct', placeholder:'% off', 'aria-label':'Discount percent', min:'0', max:'90', step:'0.5', required:true}),
        h('input',{type:'number', name:'min', placeholder:'Min copies', 'aria-label':'Minimum copies', min:'1', step:'1', value:'1'}),
        h('select',{name:'ret', 'aria-label':'Returnable'}, h('option',{value:'true'},'Returnable'), h('option',{value:'false'},'Non-returnable')),
        h('button',{class:'btn quiet sm', type:'submit'},'Add discount'));
      add.addEventListener('submit', async e => { e.preventDefault(); const d = new FormData(add);
        const r = await A.sb.from('vendor_discounts').upsert({vendor_id:x.id, product_class:String(d.get('cls')).trim().toLowerCase(), discount:+d.get('pct')/100, min_qty:+d.get('min')||1, returnable:d.get('ret') === 'true'}, {onConflict:'vendor_id,product_class,returnable,min_qty'});
        toast(r.error ? r.error.message : 'Added'); if (!r.error) A.route(); });
      box.append(h('details',{class:'card'}, h('summary',null, x.name + (x.default_discount != null ? ' · ' + +(x.default_discount*100).toFixed(2) + '% off list' : ' · discount not set')), form,
        h('h3',null,'Discounts by product class'), mine.length ? dl : h('p',{class:'small muted'},'None yet. The usual discount above applies to everything.'), add));
    });
  }

  // ---------- setting up new vendors (managers and owners) ----------
  // Upload notes, research, terms or an application; the AI proposes vendor records and a checklist; a person approves.
  const SETUP = ['To apply','Applying','Approved, not ordering yet','Active','Paused','Not using'];
  const WHO = {owner:'You', app:'App', vendor:'Vendor'};
  const loadScript = src => new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => no(new Error('Could not load '+src)); document.head.append(sc); });
  let pdfReady = null;
  async function fileText(f){
    const buf = await f.arrayBuffer();
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf'){
      pdfReady = pdfReady || loadScript('vendor/pdf.min.js').then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; });
      await pdfReady; const doc = await window.pdfjsLib.getDocument({data:buf}).promise; let out = '';
      for (let i = 1; i <= doc.numPages; i++){ const pg = await doc.getPage(i), tc = await pg.getTextContent(); out += tc.items.map(t => t.str).join(' ') + '\n'; }
      return out; }
    if (/\.docx$/i.test(f.name)){ if (!window.mammoth) await loadScript('vendor/mammoth.browser.min.js'); return (await window.mammoth.extractRawText({arrayBuffer:buf})).value; }
    return new TextDecoder().decode(buf);
  }
  // tax ids, SSNs and long card or bank numbers never leave the browser
  const unprivate = t => t.replace(/\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b|\b(?:\d[ -]?){12,19}\b/g, m => /^97[89]\d{10}$/.test(m.replace(/\D/g,'')) ? m : '[removed]');

  async function setupView(v){
    v.append(head('Buying · ' + A.site().name, 'Vendor setup', 'Open accounts with new suppliers. Upload your notes or an application and the app fills in the vendor and the steps left. No passwords, account numbers, tax ids or signatures here.'));
    if (!live()) return notLive(v);
    if (rank() < 3){ v.append(h('div',{class:'card'}, h('p',null,'Managers and the owner set up vendors.'))); return; }
    // 1. upload
    const fi = h('input',{type:'file', accept:'.pdf,.docx,.md,.txt,.csv,.html', required:true, 'aria-label':'Document about suppliers'});
    const go = h('button',{class:'btn', type:'submit'}, 'Read it');
    const out = h('div');
    const f = h('form',{class:'card'}, h('h2',null,'Add vendors from a document'),
      h('p',{class:'small muted'},'Supplier research, a terms sheet, a rep’s email, an account application (PDF, Word, text or Markdown). Works for any kind of supplier. The app puts each supplier’s online application first and email only as a fallback. Nothing is saved until you approve it.'),
      h('div',{class:'row'}, fi, go), out);
    f.addEventListener('submit', async e => {
      e.preventDefault(); const file = fi.files[0]; if (!file) return;
      go.disabled = true; out.replaceChildren(h('p',{class:'muted'},'Reading ' + file.name + '… (about a minute for long notes)'));
      try {
        const text = unprivate(await fileText(file));
        if (!text.trim()) throw new Error('No text found in that file. If it is a scan, type the key details into a note instead.');
        const {data, error} = await A.sb.functions.invoke('doc-import', {body:{mode:'vendors', text:text.slice(0, 200000), source:file.name}});
        let msg = data && data.error;
        if (error && !msg){ try { msg = (await error.context.json()).error; } catch(_){ msg = error.message; } }
        if (msg) throw new Error({'not-configured':'The reading assistant is not set up yet (Supabase secret ANTHROPIC_API_KEY).', 'too-long':'That document is too long. Split it in parts.', 'manager-only':'Managers and the owner set up vendors.'}[msg] || 'Could not read it: ' + msg);
        review(data.vendors || [], file.name, text);
      } catch(err){ out.replaceChildren(h('p',{class:'msg err'}, err.message)); }
      go.disabled = false;
    });
    v.append(f);
    function review(list, name, text){
      out.replaceChildren();
      if (!list.length){ out.append(h('p',null,'No suppliers found in that document.')); return; }
      const known = new Set((vendors || []).map(x => x.name.toLowerCase()));
      const picks = list.map(x => {
        const cb = h('input',{type:'checkbox', checked:true, 'aria-label':'Save ' + x.name});
        const isNew = !known.has(x.name.toLowerCase());
        out.append(h('div',{class:'item'},
          h('label',{class:'row'}, cb, h('b',null, x.name), h('span',{class:'chip ' + (isNew ? 'calm' : 'grey')}, isNew ? 'New' : 'Fills blanks only'), h('span',{class:'chip amber'}, x.status)),
          x.covers ? h('p',{class:'small'}, 'Covers: ' + x.covers) : null,
          x.apply_url ? h('p',{class:'small'}, 'Apply online: ' + x.apply_url) : x.apply_email ? h('p',{class:'small'}, 'No online form found yet. Email: ' + x.apply_email) : null,
          x.needs ? h('p',{class:'small'}, 'Needs: ' + x.needs) : null,
          x.steps.length ? h('ul',{class:'small'}, x.steps.map(st => h('li',null, (st.done ? '✓ ' : '') + WHO[st.who] + ': ' + st.step))) : null,
          x.quote ? h('p',{class:'small muted'}, '“' + x.quote + '”') : null));
        return [cb, x]; });
      const keep = h('input',{type:'checkbox', checked:true});
      const save = h('button',{class:'btn', type:'button'}, 'Save checked vendors');
      out.append(h('label',{class:'small'}, keep, ' Keep this document with these vendors (managers and the owner can read it)'), h('div',{class:'row'}, save));
      save.addEventListener('click', async () => {
        const chosen = picks.filter(([cb]) => cb.checked).map(([, x]) => x); if (!chosen.length) return;
        save.disabled = true;
        const {data, error} = await A.sb.rpc('apply_vendor_setup', {p:{vendors:chosen, doc_name:keep.checked ? name : '', doc_text:keep.checked ? text : ''}});
        if (error){ save.disabled = false; toast('Could not save: ' + error.message); return; }
        toast(data.created + ' added, ' + data.updated + ' updated'); A.route();
      });
    }
    // 2. tracker
    const {data:vendors, error} = await A.sb.from('vendors').select('*').order('name');
    if (error){ v.append(h('p',{class:'msg err'}, /schema cache|column/.test(error.message) ? 'Run the latest supabase/catalog.sql in Supabase first.' : error.message)); return; }
    const {data:docs} = await A.sb.from('vendor_docs').select('id,name,vendor_ids,uploaded_at').order('uploaded_at', {ascending:false}).limit(200);
    const {data:mail} = await A.sb.from('vendor_mail').select('*').order('received_at', {ascending:false}).limit(300);
    const byVendor = id => (mail || []).filter(m => m.vendor_id === id);
    const waiting = (mail || []).filter(m => !m.done && m.kind !== 'auto');
    if (waiting.length){
      const names = Object.fromEntries((vendors || []).map(x => [x.id, x.name]));
      v.append(h('div',{class:'card'}, h('h2',null,'Supplier mail waiting on you (' + waiting.length + ')'),
        ...waiting.map(m => mailRow(m, names[m.vendor_id]))));
    }
    const open = vendors.filter(x => x.status !== 'Active' && x.status !== 'Not using');
    const card = h('div',{class:'card'}, h('h2',null,'Accounts in progress (' + open.length + ')'));
    if (!open.length) card.append(h('p',{class:'small muted'},'Every vendor is active. Upload notes above to start a new one.'));
    open.sort((a,b) => SETUP.indexOf(a.status) - SETUP.indexOf(b.status) || a.name.localeCompare(b.name)).forEach(x => card.append(setupRow(x, docs || [], byVendor(x.id))));
    v.append(card);
    const done = vendors.filter(x => x.status === 'Not using');
    if (done.length) v.append(h('div',{class:'card'}, h('h2',null,'Not using'), h('ul',{class:'small'}, done.map(x => h('li',null, x.name + (x.notes ? ': ' + x.notes : ''))))));
  }
  const KIND = {reply:['Reply','amber'], auto:['Automatic reply','grey'], bounce:['Bounced','red']};
  function mailRow(m, vendorName){
    const [label, tone] = KIND[m.kind] || KIND.reply;
    const row = h('div',{class:'item'},
      h('div',{class:'row'}, vendorName ? h('b',null, vendorName) : null, h('span',{class:'chip ' + tone}, label), h('span',{class:'small muted'}, A.fmtDate(m.received_at))),
      h('p',{class:'small'}, m.subject || ''), m.summary ? h('p',{class:'small muted'}, m.summary.slice(0, 240)) : null);
    if (!m.done && m.kind !== 'auto') row.append(h('button',{class:'btn quiet sm', type:'button', onclick:async e => {
      const {error} = await A.sb.from('vendor_mail').update({done:true}).eq('id', m.id);
      if (error) return toast('Could not save: ' + error.message); m.done = true; e.target.replaceWith(h('span',{class:'small muted'},'Done ✓')); }}, m.kind === 'bounce' ? 'Fixed the address' : 'I answered it'));
    return row;
  }
  function setupRow(x, docs, mails){
    mails = mails || [];
    const sel = h('select',{'aria-label':'Account status for ' + x.name}, SETUP.map(s => h('option',{value:s, selected:s === x.status}, s)));
    const save = async patch => { const {error} = await A.sb.from('vendors').update(Object.assign(patch, {updated_at:new Date().toISOString()})).eq('id', x.id); toast(error ? 'Could not save: ' + error.message : 'Saved'); return !error; };
    sel.addEventListener('change', async () => { const patch = {status:sel.value}; if (sel.value === 'Applying' && !x.applied_on) patch.applied_on = new Date().toISOString().slice(0,10); if (await save(patch)) Object.assign(x, patch); });
    const steps = Array.isArray(x.setup_steps) ? x.setup_steps : [];
    const list = h('ul',{class:'small', style:'list-style:none;padding-left:0'}, steps.map((st, i) => {
      const cb = h('input',{type:'checkbox', checked:!!st.done, 'aria-label':st.step});
      cb.addEventListener('change', () => { steps[i] = Object.assign({}, st, {done:cb.checked}); save({setup_steps:steps}); });
      return h('li',null, h('label',null, cb, ' ', h('span',{class:'chip grey'}, WHO[st.who] || 'You'), ' ', st.step)); }));
    const add = h('input',{type:'text', maxlength:'200', placeholder:'Add a step', 'aria-label':'Add a step for ' + x.name});
    add.addEventListener('keydown', e => { if (e.key !== 'Enter' || !add.value.trim()) return; e.preventDefault(); steps.push({step:add.value.trim(), who:'owner', done:false}); save({setup_steps:steps}).then(() => A.route()); });
    const mine = docs.filter(d => (d.vendor_ids || []).includes(x.id));
    const links = h('div',{class:'row'});
    // online application first; email only when there's no form
    if (x.apply_url) links.append(h('a',{class:'btn sm', href:x.apply_url, target:'_blank', rel:'noopener'}, 'Fill in the online application'));
    else if (x.website) links.append(h('a',{class:'btn quiet sm', href:x.website, target:'_blank', rel:'noopener'}, 'Look for an application on their site'));
    if (x.apply_email) links.append(h('a',{class:'btn quiet sm', href:'mailto:' + encodeURIComponent(x.apply_email) + '?subject=' + encodeURIComponent('New account: ' + A.site().name)}, x.apply_url ? 'Email instead' : 'Email ' + x.apply_email));
    mine.forEach(d => links.append(h('button',{class:'btn quiet sm', type:'button', onclick:async () => { const {data} = await A.sb.from('vendor_docs').select('body').eq('id', d.id).single();
      if (data) window.open(URL.createObjectURL(new Blob([data.body], {type:'text/plain;charset=utf-8'})), '_blank', 'noopener'); }}, '📄 ' + d.name)));
    return h('div',{class:'item'},
      h('div',{class:'row'}, h('b',null, x.name), sel, x.applied_on ? h('span',{class:'small muted'}, 'applied ' + A.fmtDate(x.applied_on)) : null),
      x.covers ? h('p',{class:'small'}, 'Covers: ' + x.covers) : null,
      x.needs ? h('p',{class:'small'}, 'The application asks for: ' + x.needs) : null,
      list, add, links,
      mails.length ? h('details',null, h('summary',{class:'small'}, 'Mail from ' + x.name + ' (' + mails.length + ')'), ...mails.map(m => mailRow(m))) : null);
  }

  A.register({id:'catalog', name:'Title search and catalogs', what:'One search across every vendor’s title list with stock, cost, margin and special-order price; managers load ONIX feeds, CSV title lists, Faire exports and stock files.', tiers:['staff','lead','manager','owner'],
    views:{titles:{t:'Title search', ic:'🔎', render:titlesView}, catalogs:{t:'Catalog imports', ic:'📥', render:importView, min:'manager'}, setup:{t:'Vendor setup', ic:'🤝', render:setupView, min:'manager'}}});
})();
