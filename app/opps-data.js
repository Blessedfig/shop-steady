// Opportunities catalog for Downtown Stube: grants, loans, tax credits, rebates and free help a small shop can use.
// Checked Nov 28, 2026 from each program's own page (links below). Amounts and dates change: re-check each January.
//
// Add a place by adding entries with its own `where`. A store sees an entry when every part of `where` matches its
// location (set at the top of the Opportunities screen); entries with no `where` are nationwide.
//
// Fields
//   id, name, kind: grant | loan | credit | rebate | help
//   where: {state, county, city}        (2-letter state, county without "County")
//   who:   plain words on who applies
//   amount: plain words;  max: largest amount in dollars (0 = no money, e.g. advising)
//   reimburse: true when the grant pays you back after you pay the bill
//   share: for grants, the part of the project cost the grant pays (0.5 = $1 for each $1 you spend; 1/3 = $1 per $3)
//   rate, months, fee: for loans: yearly rate %, usual term in months, fees % taken at closing
//   per: for rebates: amount per unit, with unit words
//   due:  'YYYY-MM-DD' one-time deadline;  windows: [['MM-DD','MM-DD'], ...] repeating each year;  rolling: true
//   needs: what the application asks for;   hidden: effects people miss
//   req:  fit rules: downtown, forProfitDirect (false = needs a nonprofit or the city to apply), ownsBuilding,
//         historic, hiring, jobs (creates or keeps a job)
//   fitNote: a caution shown with the fit
//   check: true when a fact needs confirming before you rely on it
window.OPPS_CATALOG = [
  // ---------- Antigo / Langlade County, Wisconsin ----------
  {id:'antigo-search', name:'Downtown SEARCH grant', kind:'grant', where:{state:'WI', county:'Langlade', city:'Antigo'},
    who:'Downtown building owner or tenant (tenant needs the landlord\'s written OK)', amount:'Up to $5,000, $1 for each $1 you spend', max:5000, share:0.5, reimburse:true,
    rolling:true, check:true, req:{downtown:true},
    uses:'POS and e-commerce systems, outdoor lighting, doors, awnings, windows, upstairs painting, some interior work. Not signs, inventory, rent or operating costs.',
    needs:['Application form','Photos of the building','Lease or tax bill','Landlord\'s written OK if you rent','Contractor bids or drawings','Paid invoices before reimbursement','Property taxes and city bills current'],
    hidden:['It pays you back after the work is paid for, so you need the full project cost up front for a few weeks.','Business grants usually count as taxable income.','First come, first served: ask if money is left before you start.'],
    contact:'Angie Close, Langlade County EDC, (715) 623-5123, aclose@co.langlade.wi.us',
    link:'https://langladecountyedc.org/wp-content/uploads/2022/06/Downtown-Business-District-SEARCH-Grant-Program-App-with-Map.pdf'},
  {id:'antigo-facade', name:'Downtown façade grant', kind:'grant', where:{state:'WI', county:'Langlade', city:'Antigo'},
    who:'Owner or tenant in the downtown Central Business District', amount:'Up to $3,000, $1 back for each $3 spent', max:3000, share:1/3, reimburse:true,
    rolling:true, check:true, req:{downtown:true},
    uses:'Front and rear façade: masonry, windows, doors, paint, awnings, lighting. Not signs, roofs or routine upkeep.',
    needs:['Application form','Photos','Bids or drawings','Landlord\'s OK if you rent','Approval before any work starts'],
    hidden:['Work started before approval does not count.','You pay the whole bill first; the grant is a third of it.','Business grants usually count as taxable income.'],
    contact:'Angie Close, Langlade County EDC, (715) 623-5123',
    link:'https://langladecountyedc.org/wp-content/uploads/2012/06/Official-Guidelines-and-application-Rev6.pdf'},
  {id:'langlade-rlf', name:'Langlade County revolving loan funds', kind:'loan', where:{state:'WI', county:'Langlade'},
    who:'Business in Langlade County that creates or keeps a full-time job', amount:'From $5,000, 7–12 years, about prime ± 2%', max:100000, rate:7, months:84, fee:0,
    rolling:true, check:true, req:{jobs:true},
    uses:'Equipment, working capital, buying or fixing a building. Gap money beside a bank loan. Not refinancing old debt.',
    needs:['Loan application and checklist','Balance sheet','Cash flow projection','Personal financial statement','Bank loan or your own money to match dollar for dollar'],
    hidden:['Needs a dollar-for-dollar match from a bank or you.','Cannot pay off existing debt such as Shopify Capital.','Takes 45–60 days.','Rate and terms here are from a 2014 sheet: ask for today\'s.'],
    contact:'Langlade County EDC, 312 Forrest Ave, (715) 623-2085',
    link:'https://langladecountyedc.org/business-resources/langlade-county-funds/'},

  // ---------- Wisconsin ----------
  {id:'wi-focus-energy', name:'Focus on Energy rebates', kind:'rebate', where:{state:'WI'},
    who:'Any business customer of a participating Wisconsin utility', amount:'LED fixtures $10–$30 each, smart thermostat $50, small A/C $75–$200', max:2500,
    per:[['LED troffer fixtures',20],['LED downlights',13],['Smart thermostats',50],['Lighting controls (per fixture)',10]],
    windows:[['01-01','01-31']], note:'Submit within 60 days of install; 2026 work by Jan 31, 2027.',
    uses:'Lighting, controls, thermostats, heating and cooling, building tune-ups.',
    needs:['Itemized invoice','Product model numbers','Utility account number','Pre-approval for projects over $10,000'],
    hidden:['The 60-day clock starts at install, not at year end.','Lower power bills keep paying after the rebate.'],
    contact:'Focus on Energy, 800-762-7077',
    link:'https://assets.focusonenergy.com/production/docs/business/BI-Summary-of-Services-and-Incentives-2026.pdf'},
  {id:'wi-wwbic', name:'WWBIC small business loan', kind:'loan', where:{state:'WI'},
    who:'Wisconsin for-profit business, owner 18+', amount:'$1,000–$100,000 (to $350,000 SBA-backed), 10–12.5%', max:100000, rate:11, months:60, fee:6,
    rolling:true,
    uses:'Inventory, fixtures, equipment, leasehold improvements, working capital. Not refinancing.',
    needs:['3 months of business bank statements','3 years of tax returns','Balance sheet and year-to-date P&L','Debt list','Lease','One-page business summary','$100 application fee'],
    hidden:['Closing costs run about 5–7% of the loan.','Documents are due within 14 days of starting the application.','6–8 weeks to approval.'],
    contact:'WWBIC, 414-263-5450, info@wwbic.com',
    link:'https://www.wwbic.com/wp-content/uploads/2026/04/2026-WWBIC-Lending-Info.pdf'},
  {id:'wi-humanities', name:'Wisconsin Humanities grant', kind:'grant', where:{state:'WI'},
    who:'A nonprofit, library or town applies; your shop can co-host', amount:'Up to $5,000, matched 1:1 in cash or volunteer time', max:5000, share:0.5,
    windows:[['01-01','03-01'],['05-01','07-01'],['09-06','11-05']], req:{forProfitDirect:false},
    uses:'Public programs: author talks, book discussions, local-history nights. Not buildings or publishing books.',
    needs:['Nonprofit partner and fiscal sponsor','Program plan','Budget form','W-9','Signed personnel forms'],
    hidden:['A for-profit cannot apply alone.','The match can be donated space and volunteer hours.','Events bring customers in, which is the real payoff for the shop.'],
    contact:'Wisconsin Humanities grants staff',
    link:'https://wisconsinhumanities.org/grants/'},
  {id:'wi-connect', name:'WEDC Connect Communities and Main Street', kind:'help', where:{state:'WI'},
    who:'A downtown organization (Antigo is a Connect Community, listed 2025)', amount:'Training and a path to state downtown grants; $200 a year for the group', max:0,
    windows:[['03-15','04-15']], note:'Connect Communities takes applications twice a year; Main Street is due mid-April.',
    needs:['A downtown group with a defined district','Annual report to WEDC'],
    hidden:['State downtown grants reach shops through this group or the city, so be part of it.'],
    contact:'WEDC regional economic development director',
    link:'https://wedc.org/wp-content/uploads/2026/07/FY27-Main-Street-and-Connect-Communities.pdf'},
  {id:'wi-sbdg', name:'WEDC Small Business Development Grant (via your town)', kind:'grant', where:{state:'WI'},
    who:'City, county or economic development group applies, then runs a local fund for shops', amount:'$50,000–$250,000 to the local fund', max:0,
    windows:[['08-01','10-02']], req:{forProfitDirect:false},
    uses:'Local startup, façade or expansion grants and loans for firms under 25 employees.',
    needs:['Ask your county EDC to apply and to put your project in their plan'],
    hidden:['You cannot apply yourself; tell your EDC early so your project is in their application.'],
    contact:'Your county EDC',
    link:'https://wedc.org/programs/small-business-development-grant/'},
  {id:'wi-cdi', name:'WEDC Community Development Investment grant', kind:'grant', where:{state:'WI'},
    who:'Building project with the city as partner', amount:'Up to about $250,000; 3:1 match (1:1 in rural towns)', max:250000, share:0.5,
    rolling:true, req:{ownsBuilding:true, forProfitDirect:false},
    uses:'Renovating or reusing a downtown building, historic preservation, mixed use.',
    needs:['Shovel-ready building plan','City support','Bids and full budget'],
    hidden:['Only fits a big building project.','Needs the city on board before WEDC will look at it.'],
    contact:'WEDC regional economic development director',
    link:'https://wedc.org/wp-content/uploads/2025/08/FY26-Community-Development-Investment-Grant.pdf'},
  {id:'wi-sbdc', name:'Small Business Development Center advising', kind:'help', where:{state:'WI'},
    who:'Any Wisconsin business (UW-Stevens Point serves Langlade County)', amount:'Free, confidential advising', max:0, rolling:true,
    needs:['Your last P&L and questions'],
    hidden:['They help you get ready for a loan, which raises your odds and can lower the rate.'],
    contact:'SBDC at UW-Stevens Point, (715) 346-3838',
    link:'https://wisconsinsbdc.org/centers/stevenspoint'},

  // ---------- Nationwide ----------
  {id:'us-htc', name:'Historic rehabilitation tax credits', kind:'credit',
    who:'Owner of a building on the National Register or in a historic district', amount:'20% federal (+20% Wisconsin) of rehab cost', max:0, pct:20,
    rolling:true, req:{ownsBuilding:true, historic:true},
    uses:'Rehab work on the building itself. Not buying it, furniture or new additions.',
    needs:['Three-part application to the state historic office','Approval before work starts (state credit)','At least $50,000 of work for the state credit'],
    hidden:['Months of paperwork; plan it with an accountant.','A credit cuts your tax bill dollar for dollar, worth more than a write-off.'],
    contact:'State historic preservation office',
    link:'https://wedc.org/wp-content/uploads/2026/05/HTC-Fact-Sheet-2026.pdf'},
  {id:'us-wotc', name:'Work Opportunity Tax Credit', kind:'credit',
    who:'Any employer hiring someone from a target group (veterans, SNAP households, long-term unemployed)', amount:'Up to $2,400 per hire', max:2400,
    rolling:true, check:true, req:{hiring:true},
    needs:['Form 8850 signed by the job offer day','Filed with the state within 28 days of the start date','Form 3800 with your taxes'],
    hidden:['The IRS page says it covers hires who started by Dec 31, 2025: check for a renewal before counting on it.','Miss the 28 days and the credit is gone.'],
    contact:'IRS / Wisconsin DWD',
    link:'https://www.irs.gov/businesses/small-businesses-self-employed/work-opportunity-tax-credit'},
  {id:'us-sba-micro', name:'SBA microloan (through a local lender)', kind:'loan',
    who:'Small for-profit business', amount:'Up to $50,000', max:50000, rate:10, months:60, fee:2, rolling:true,
    needs:['Business plan','Tax returns','Financial statements'],
    hidden:['Comes with free coaching from the lender.'],
    contact:'SBA microlender list',
    link:'https://www.sba.gov/loans/microloans/list-of-microlenders/'},
  {id:'us-binc', name:'Binc Foundation', kind:'help', types:['bookstore'],
    who:'Bookstore and comic shop employees in hardship (not the store)', amount:'Emergency aid for staff', max:0, rolling:true, fitNote:'Helps your staff in hardship, not the store itself.',
    needs:['Employee applies directly'],
    hidden:['Its store grant round (Survive to Thrive) is closed; email info@bincfoundation.org about the next one.'],
    contact:'1-866-733-9064',
    link:'https://bincfoundation.org/who-we-are'}
];

// The paperwork most applications ask for. Gather it once.
window.OPPS_KIT = ['EIN letter and LLC papers','Last 3 years of tax returns','Year-to-date profit and loss, and a balance sheet',
  'Last 3 months of business bank statements','List of what you owe (loans, cards, Shopify Capital)','Lease, and the landlord\'s OK for building work',
  'Proof property taxes and city bills are current','Storefront photos and two contractor bids','One-page business summary: what you do, jobs, community events'];
