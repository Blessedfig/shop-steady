// Vendors and customers.
// Vendors: who you buy from, account status, terms, lead time, minimums, how to order, contacts. No account numbers or passwords.
// Customers: contact, birthday, interests, special orders (priced with the owner's margin rules), notes and marketing consent.
(function(){
  const A = window.SSApp; if (!A) return;
  const {h, head, toast, money, download, toCsv, isoDay, addDays, uid} = A;
  const S = () => A.state();
  const MGR = ['lead','manager','owner'];
  const canEdit = () => MGR.includes(S().tier);
  const STATUS = ['Active','Applying','Approved, not ordering yet','Paused','Not using'];

  // Common bookstore and gift vendors (public facts, Nov 2026). Each store edits its own copy.
  const BOOK_VENDORS = [
    {name:'Penguin Random House (direct)', covers:'Most major manga and comics imprints: Kodansha, Seven Seas, Dark Horse, TOKYOPOP, Square Enix, Titan, IDW, BOOM!, DC and more, plus PRH books', how:'PRH retailer account', terms:'Bookstore: 46% returnable or 50% non-returnable, free freight (May 2026 list)', lead:5},
    {name:'Simon & Schuster (direct)', covers:'VIZ Media (incl. SuBLime), Udon', how:'New account form by email to S&S account maintenance', terms:'Needs resale certificate, trade and bank references', lead:7},
    {name:'Hachette (direct)', covers:'Yen Press, Ize Press, J-Novel Club print', how:'Hachette new account form (Formstack)', terms:'Prepay or credit terms; resale certificate', lead:7},
    {name:'Bookazine', covers:'Fill-ins, special orders, small presses', how:'Lead form, then a sales rep', terms:'', lead:5},
    {name:'IPG', covers:'One Peace Books and other independents', how:'Email IPG sales', terms:'', lead:10},
    {name:'Lunar Distribution', covers:'Comics; ask about bookstore accounts', how:'Email Lunar customer service', terms:'', lead:7},
    {name:'Libro.fm', covers:'Audiobooks (bookstore partner program)', how:'Online partner sign-up', terms:'Store earns a share of audiobook sales', lead:0}
  ];
  const GENERAL_VENDORS = [
    {name:'Faire', covers:'Gifts, cards, toys, snacks and goods from independent makers', how:'faire.com wholesale account', terms:'Opening orders often net 60 terms; brand minimums vary', lead:10},
    {name:'Amazon Business', covers:'Supplies and fill-in products', how:'Amazon Business account', terms:'Pay at order', lead:2}
  ];

  function P(){ const s = S(); s.people = s.people || {vendors:{}, customers:{}, margin:{tiers:[[50,0.45],[200,0.35],[500,0.28],[1e9,0.22]], ship:0}};
    const site = S().site;
    if (!s.people.vendors[site]){ const list = (A.site().type === 'bookstore' ? BOOK_VENDORS : []).concat(GENERAL_VENDORS);
      s.people.vendors[site] = list.map(v => Object.assign({id:uid(), status:'Applying', contact:'', email:'', phone:'', min:'', notes:''}, v)); }
    if (!s.people.customers[site]){ const d = isoDay(new Date());
      s.people.customers[site] = [
        {id:uid(), n:'Sample Customer A', email:'', phone:'', bday:addDays(d,9).slice(5), likes:'Manga (shonen), fantasy', consent:true, notes:'Prefers a text when orders arrive (sample)', orders:[], since:addDays(d,-200)},
        {id:uid(), n:'Sample Customer B', email:'', phone:'', bday:'', likes:'Local history, cookbooks', consent:false, notes:'', orders:[], since:addDays(d,-40)}];
      A.save(); }
    return s.people; }
  const vendors = () => P().vendors[S().site];
  const customers = () => P().customers[S().site];

  // ---------- margin rules for special orders ----------
  // Bigger orders take a smaller margin, as the owner sets. Price = cost / (1 - margin), rounded up to the next $0.49 or $0.99.
  function marginFor(cost){ const t = P().margin.tiers.find(([upTo]) => cost <= upTo) || P().margin.tiers[P().margin.tiers.length-1]; return t[1]; }
  function quote(cost, shipping){
    const base = cost + (shipping||0), m = marginFor(base), raw = base / (1 - m);
    const price = Math.max(raw, base + 3); // never less than $3 over cost, so small orders still pay for the time
    const nice = Math.floor(price) + (price % 1 <= 0.49 ? 0.49 : 0.99);
    return {m, price:+nice.toFixed(2), profit:+(nice - base).toFixed(2)};
  }

  function vendorsView(v){
    v.append(head('Buying · '+A.site().name, 'Vendors', 'Who you buy from, how to order, terms and lead times. Keep account numbers and passwords out of here: use your password manager.'));
    const list = vendors();
    list.forEach(x => {
      const card = h('div',{class:'card'}, h('div',{class:'row'}, h('h2',null,x.name), h('span',{class:'chip '+(x.status==='Active'?'calm':x.status==='Not using'?'grey':'amber')}, x.status)),
        h('p',{class:'small'}, x.covers), x.terms ? h('p',{class:'small muted'}, 'Terms: '+x.terms) : null,
        h('p',{class:'small muted'}, 'How to order: '+(x.how||'—')+(x.lead ? ' · usual lead time '+x.lead+' days' : '')+(x.min ? ' · minimum '+x.min : '')),
        (x.contact || x.email || x.phone) ? h('p',{class:'small'}, 'Contact: '+[x.contact,x.email,x.phone].filter(Boolean).join(' · ')) : null,
        x.notes ? h('p',{class:'small'}, x.notes) : null);
      if (canEdit()){
        const vn = h('textarea',{name:'notes',rows:'2',maxlength:'600'}, x.notes);
        const f = h('form',{class:'grid g2'},
          h('label',{class:'f'},'Status', h('select',{name:'status'}, STATUS.map(s => h('option',{selected:s===x.status},s)))),
          h('label',{class:'f'},'Lead time (days)', h('input',{type:'number',name:'lead',min:'0',value:String(x.lead||'')})),
          h('label',{class:'f'},'Rep or contact name', h('input',{type:'text',name:'contact',value:x.contact,maxlength:'60'})),
          h('label',{class:'f'},'Contact email', h('input',{type:'email',name:'email',value:x.email,maxlength:'80'})),
          h('label',{class:'f'},'Contact phone', h('input',{type:'tel',name:'phone',value:x.phone,maxlength:'30'})),
          h('label',{class:'f'},'Order minimum', h('input',{type:'text',name:'min',value:x.min,maxlength:'40'})),
          h('label',{class:'f'},'Notes', vn), A.polishButton ? A.polishButton(vn, {kind:'vendor', about:x.name}) : null,
          h('button',{class:'btn sm',type:'submit'},'Save'));
        f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f); ['status','contact','email','phone','min','notes'].forEach(k => x[k] = String(d.get(k)||'').trim()); x.lead = +d.get('lead')||0; A.save(); toast('Saved'); A.route(); });
        card.append(h('details',null, h('summary',null,'Edit'), f));
      }
      v.append(card);
    });
    if (canEdit()){
      const f = h('form',{class:'card grid'}, h('h2',null,'Add a vendor'),
        h('label',{class:'f'},'Name', h('input',{type:'text',name:'name',required:true,maxlength:'60'})),
        h('label',{class:'f'},'What you buy there', h('input',{type:'text',name:'covers',maxlength:'160'})),
        h('label',{class:'f'},'How to order', h('input',{type:'text',name:'how',maxlength:'100'})),
        h('button',{class:'btn',type:'submit'},'Add vendor'));
      f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f);
        list.push({id:uid(), name:String(d.get('name')).trim(), covers:String(d.get('covers')||''), how:String(d.get('how')||''), terms:'', lead:0, status:'Active', contact:'', email:'', phone:'', min:'', notes:''}); A.save(); toast('Added'); A.route(); });
      v.append(f);
    }
  }

  function customersView(v){
    v.append(head('Customers · '+A.site().name, 'Customers and special orders', 'Regulars, what they like, birthdays, and special orders priced with your margin rules.'));
    const list = customers();
    // special order quote
    const qf = h('form',{class:'card grid'}, h('h2',null,'Special order'),
      h('label',{class:'f'},'Customer', h('select',{name:'c'}, list.map(c => h('option',{value:c.id},c.n)))),
      h('label',{class:'f'},'Item (title, ISBN or product)', h('input',{type:'text',name:'item',required:true,maxlength:'120'})),
      h('label',{class:'f'},'Vendor', h('select',{name:'ven'}, vendors().filter(x => x.status !== 'Not using').map(x => h('option',null,x.name)))),
      h('label',{class:'f'},'Your cost ($)', h('input',{type:'number',name:'cost',step:'0.01',min:'0',required:true})),
      h('label',{class:'f'},'Shipping for this item ($)', h('input',{type:'number',name:'ship',step:'0.01',min:'0',value:'0'})),
      h('p',{class:'msg',id:'quoteOut','aria-live':'polite'},'Type the cost to see the price.'),
      h('button',{class:'btn',type:'submit'},'Save special order'));
    const out = () => qf.querySelector('#quoteOut');
    qf.addEventListener('input', () => { const d = new FormData(qf), cost = +d.get('cost'); if (!(cost > 0)) return;
      const q = quote(cost, +d.get('ship')||0); out().textContent = 'Charge '+money(q.price)+' · margin '+Math.round(q.m*100)+'% · you make '+money(q.profit); });
    qf.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(qf), c = list.find(x => x.id === d.get('c')), q = quote(+d.get('cost'), +d.get('ship')||0);
      c.orders.push({id:uid(), at:isoDay(new Date()), item:String(d.get('item')).trim(), ven:d.get('ven'), cost:+d.get('cost'), ship:+d.get('ship')||0, price:q.price, status:'To order'}); A.save(); toast('Special order saved for '+c.n); A.route(); });
    v.append(qf);
    // customer cards
    const soon = c => { if (!c.bday) return false; const d = isoDay(new Date()).slice(5), e = addDays(isoDay(new Date()),14).slice(5); return d <= e ? (c.bday >= d && c.bday <= e) : (c.bday >= d || c.bday <= e); };
    list.forEach(c => {
      const card = h('div',{class:'card'}, h('div',{class:'row'}, h('h2',null,c.n), soon(c) ? h('span',{class:'chip calm'},'Birthday soon') : null, c.consent ? h('span',{class:'chip'},'OK to send offers') : null),
        c.likes ? h('p',{class:'small'},'Likes: '+c.likes) : null, c.notes ? h('p',{class:'small muted'}, c.notes) : null,
        c.orders.length ? h('div',{class:'list'}, c.orders.map(o => h('div',{class:'item'}, h('b',null,o.item), h('span',{class:'small muted'}, o.ven+' · '+money(o.price)+' · '+A.fmtDate(o.at)),
          h('div',{class:'row'}, ['To order','Ordered','Arrived, customer told','Picked up'].map(st => h('button',{class:'btn sm '+(o.status===st?'':'quiet'),type:'button','aria-pressed':String(o.status===st),onclick:()=>{ o.status = st; A.save(); A.route(); }}, st)))))) : null);
      if (canEdit()){
        const cn = h('textarea',{name:'notes',rows:'2',maxlength:'600'}, c.notes);
        const f = h('form',{class:'grid g2'},
          h('label',{class:'f'},'Email', h('input',{type:'email',name:'email',value:c.email,maxlength:'80'})),
          h('label',{class:'f'},'Phone', h('input',{type:'tel',name:'phone',value:c.phone,maxlength:'30'})),
          h('label',{class:'f'},'Birthday (month and day)', h('input',{type:'text',name:'bday',value:c.bday,placeholder:'MM-DD',pattern:'\\d{2}-\\d{2}',maxlength:'5'})),
          h('label',{class:'f'},'Likes', h('input',{type:'text',name:'likes',value:c.likes,maxlength:'160'})),
          h('label',{class:'f'},'Notes', cn), A.polishButton ? A.polishButton(cn, {kind:'customer', about:c.n}) : null,
          h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'consent',checked:c.consent}), 'They said yes to offers and news'),
          h('button',{class:'btn sm',type:'submit'},'Save'));
        f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f); ['email','phone','bday','likes','notes'].forEach(k => c[k] = String(d.get(k)||'').trim()); c.consent = !!d.get('consent'); A.save(); toast('Saved'); A.route(); });
        card.append(h('details',null, h('summary',null,'Edit'), f));
      }
      v.append(card);
    });
    const nf = h('form',{class:'card grid'}, h('h2',null,'Add a customer'),
      h('label',{class:'f'},'Name', h('input',{type:'text',name:'n',required:true,maxlength:'60'})),
      h('label',{class:'f'},'Email or phone', h('input',{type:'text',name:'contact',maxlength:'80'})),
      h('label',{class:'checkrow'}, h('input',{type:'checkbox',name:'consent'}), 'They said yes to offers and news'),
      h('button',{class:'btn',type:'submit'},'Add customer'));
    nf.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(nf), ct = String(d.get('contact')||'').trim();
      list.push({id:uid(), n:String(d.get('n')).trim(), email:/@/.test(ct)?ct:'', phone:/@/.test(ct)?'':ct, bday:'', likes:'', consent:!!d.get('consent'), notes:'', orders:[], since:isoDay(new Date())}); A.save(); toast('Added'); A.route(); });
    v.append(nf);
    if (canEdit()) v.append(h('button',{class:'btn quiet sm',type:'button',onclick:()=>download('special-orders-'+isoDay(new Date())+'.csv','text/csv',
      toCsv([['Customer','Item','Vendor','Cost','Shipping','Price','Status','Date'], ...list.flatMap(c => c.orders.map(o => [c.n,o.item,o.ven,o.cost.toFixed(2),o.ship.toFixed(2),o.price.toFixed(2),o.status,o.at]))]))},'Download special orders (.csv)'));
  }

  function marginView(v){
    v.append(head('Owner · '+A.site().name, 'Special order pricing', 'Set your margin by order size. Bigger orders can take a smaller margin and still be worth the time.'));
    if (S().tier !== 'owner'){ v.append(h('div',{class:'card'},'Only the owner sets pricing.')); return; }
    const T = P().margin.tiers, f = h('form',{class:'card grid'});
    T.forEach(([upTo,m],i) => f.append(h('label',{class:'f'}, (i === T.length-1 ? 'Orders over '+money(T[i-1][0]) : 'Orders up to '+money(upTo))+': margin %',
      h('input',{type:'number',name:'m'+i,min:'0',max:'80',value:String(Math.round(m*100))}))));
    f.append(h('p',{class:'small muted'},'Example: a $20 cost at 45% margin is priced at $36.49. Margin is profit as a share of the price.'), h('button',{class:'btn',type:'submit'},'Save pricing'));
    f.addEventListener('submit', e => { e.preventDefault(); const d = new FormData(f); T.forEach((t,i) => t[1] = Math.min(0.8, Math.max(0, (+d.get('m'+i)||0)/100))); A.save(); toast('Saved'); A.route(); });
    v.append(f);
  }

  A.register({id:'people', name:'Vendors and customers', what:'Vendor directory with status, terms and lead times; customers with birthdays, likes, consent and special orders priced by your margin rules.', tiers:['staff','lead','manager','owner'],
    views:{vendors:{t:'Vendors', ic:'🚚', render:vendorsView}, customers:{t:'Customers', ic:'🙂', render:customersView}, pricing:{t:'Order pricing', ic:'💲', render:marginView}}});
  A.homeHooks.push(v => { const b = customers().filter(c => { if (!c.bday) return false; const d = isoDay(new Date()).slice(5), e = addDays(isoDay(new Date()),7).slice(5); return d <= e ? (c.bday >= d && c.bday <= e) : (c.bday >= d || c.bday <= e); });
    const waiting = customers().flatMap(c => c.orders.filter(o => o.status === 'To order' || o.status === 'Ordered'));
    if (b.length || waiting.length) v.append(h('div',{class:'card'}, h('h2',null,'Customers this week'),
      b.length ? h('p',null,'Birthdays: '+b.map(c => c.n).join(', ')) : null, waiting.length ? h('p',null, waiting.length+' special orders not in yet. ', h('a',{href:'#/customers'},'See them')) : null)); });
  window.SSPeople = {quote, marginFor};
})();
