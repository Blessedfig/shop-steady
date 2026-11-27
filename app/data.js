// Sample data for Downtown Stube. Everything here is made up except the demo store's public name.
// Replace with your own, or load from Supabase.
window.APP_DATA = {
  TIMEZONE: 'America/Chicago',
  // Role tiers, lowest to highest. Owners manage managers, managers manage staff.
  // The words shown for each tier come from the business type (below), and the owner can rename them under Setup.
  TIERS: [
    {id:'staff',   name:'Staff'},
    {id:'lead',    name:'Shift lead'},
    {id:'manager', name:'Manager'},
    {id:'owner',   name:'Owner'}
  ],
  // Business types. Each location picks one under Setup. A type sets the default words and which modules start on.
  // Add a type by copying one of these. "modules" lists the module ids that start switched on for that type.
  BUSINESS_TYPES: {
    bookstore: {name:'Bookstore', tiers:{staff:'Bookseller', lead:'Shift lead', manager:'Store manager', owner:'Owner'},
      items:'titles', usesIsbn:true, modules:['shifts','voice','count','people','notes','taxlog','inventory','expenses','setup','logins']},
    retail:    {name:'Retail shop', tiers:{staff:'Sales associate', lead:'Shift lead', manager:'Store manager', owner:'Owner'},
      items:'products', usesIsbn:false, modules:['shifts','voice','count','people','notes','taxlog','inventory','expenses','setup','logins']},
    cafe:      {name:'Café or food counter', tiers:{staff:'Barista', lead:'Shift lead', manager:'Manager', owner:'Owner'},
      items:'supplies', usesIsbn:false, modules:['shifts','voice','count','people','notes','taxlog','inventory','expenses','setup','logins']},
    services:  {name:'Services or rentals', tiers:{staff:'Team member', lead:'Lead', manager:'Manager', owner:'Owner'},
      items:'supplies', usesIsbn:false, modules:['shifts','voice','count','people','notes','taxlog','inventory','expenses','setup','logins']}
  },
  // Locations (Steady Shift called these "homes" or "sites"). One is enough to start.
  // The demo shows one retail store and one service business under the same owner.
  SITES: [
    {id:'main',  name:'The Blessed Fig Tree', type:'bookstore'},
    {id:'stays', name:'Upstairs stays', type:'services'}
  ],
  // Modules the owner can switch on per location and per role (Modules screen). Feature files add their own with SSApp.register.
  MODULES: {},
  SEED: {
    inv: {
      main: [
        {isbn:'9780000000101', t:'Sample Novel', a:'A. Author', cat:'Fiction', cond:'new', have:2, min:3, sold30:9, cost:10.80, price:18.00, vendor:'Publisher A (direct)', lead:4, src:'stock'},
        {isbn:'9780000000200', t:'Sample Manga, Vol. 1', a:'B. Author', cat:'Manga', cond:'new', have:6, min:4, sold30:14, cost:6.00, price:11.99, vendor:'Publisher A (direct)', lead:4, src:'stock'},
        {isbn:'', sku:'GIFT-MUG-01', t:'Sample mug', a:'', cat:'Gifts', cond:'new', have:1, min:3, sold30:4, cost:7.00, price:16.00, vendor:'Faire: Sample Maker', lead:7, src:'stock', pack:4},
        {isbn:'9780000000309', t:'Local History Sampler', a:'C. Author', cat:'Local', cond:'new', have:1, min:2, sold30:3, cost:0, price:20.00, vendor:'Consignor 001', lead:0, src:'consign', split:0.6},
        {isbn:'9780000000408', t:'Used Classic (good)', a:'D. Author', cat:'Used', cond:'used', have:1, min:0, sold30:1, cost:2.00, price:6.50, vendor:'Buyback', lead:0, src:'used'}
      ],
      stays: [
        {isbn:'', sku:'STAY-TOWEL-SET', t:'Bath towel set', a:'', cat:'Linens', cond:'new', have:4, min:6, sold30:2, cost:18.00, price:0, vendor:'Supply B', lead:5, src:'supply'},
        {isbn:'', sku:'STAY-COFFEE-24', t:'Coffee pods (box of 24)', a:'', cat:'Guest supplies', cond:'new', have:1, min:2, sold30:3, cost:14.50, price:0, vendor:'Supply C', lead:3, src:'supply'}
      ]
    },
    exp: [
      {site:'main', date:'2026-11-03', cat:'Inventory purchases', amt:412.50, note:'Publisher order (sample)'},
      {site:'main', date:'2026-11-10', cat:'Rent or mortgage', amt:1800, note:'Sample'},
      {site:'stays', date:'2026-11-12', cat:'Supplies', amt:96.00, note:'Towels and coffee (sample)'}
    ]
  },
  EXP_CATS: ['Inventory purchases','Supplies','Shipping and postage','Rent or mortgage','Utilities','Phone and internet','Payroll','Payroll taxes','Insurance','Licenses and permits','Card processing fees','Software and subscriptions','Marketing and events','Meals (business)','Travel','Vehicle (actual costs)','Professional fees','Education and training','Repairs','Other']
};
