// Checks the catalog file readers in app/catalog.js (no browser needed): node tests/catalog-test.js
const assert = require('assert');
const C = require('../app/catalog.js');

// ISBN handling
assert.strictEqual(C.isbn13('0-14-303943-3'), '9780143039433');
assert.strictEqual(C.isbn13('978-0-14-303943-3'), '9780143039433');
assert.strictEqual(C.isbn13('9780143039434'), '', 'bad check digit is rejected');

// CSV title list with a banner row, quoted commas, percent discount and a status word
const csv = 'Fall 2026 catalog export\n' +
  'ISBN-13,Title,Author,Publisher,Format,On Sale Date,US Price,Discount,Availability\n' +
  '9780143039433,"Road, Less Sampled",B. Writer,Penguin,Paperback,3/4/2026,$18.00,46%,IP\n' +
  '0143039433,Duplicate as ISBN-10,,,,,,,\n' +
  ',No key here,,,,,,,\n';
let r = C.parse('edelweiss.csv', csv);
assert.strictEqual(r.kind, 'csv');
assert.strictEqual(r.rows.length, 2); assert.strictEqual(r.skipped, 1);
assert.deepStrictEqual(r.rows[0], {item_key:'9780143039433', title:'Road, Less Sampled', contributors:'B. Writer', publisher:'Penguin', format:'Paperback',
  pub_date:'2026-03-04', list_price:'18.00', discount:'0.46', availability:'in_stock'});

// Faire product export: SKU only, wholesale cost, quantity sets stock
r = C.parse('faire-products.csv', 'Product Name,SKU,Brand,Wholesale Price,Retail Price,Available Quantity\nFig mug,MUG-1,Clay Co,8.00,16.00,3\n');
assert.strictEqual(r.kind, 'faire');
assert.deepStrictEqual(r.rows[0], {item_key:'sku:MUG-1', title:'Fig mug', publisher:'Clay Co', list_price:'16.00', unit_cost:'8.00', qty:'3', availability:'low'});

// Tab-separated
r = C.parse('list.tsv', 'EAN\tTitle\tList Price\tQty On Hand\n9781646513161\tSample Manga\t12.99\t40\n');
assert.strictEqual(r.rows[0].availability, 'in_stock'); assert.strictEqual(r.rows[0].qty, '40');

// ONIX 3.0, reference tags
const onix3 = `<?xml version="1.0"?><ONIXMessage release="3.0"><Header/><Product><RecordReference>x</RecordReference>
<ProductIdentifier><ProductIDType>01</ProductIDType><IDValue>abc</IDValue></ProductIdentifier>
<ProductIdentifier><ProductIDType>15</ProductIDType><IDValue>9781646513161</IDValue></ProductIdentifier>
<DescriptiveDetail><ProductForm>BC</ProductForm><Collection><TitleDetail><TitleType>01</TitleType><TitleElement><TitleText>Sample Series</TitleText></TitleElement></TitleDetail></Collection>
<TitleDetail><TitleType>01</TitleType><TitleElement><TitleElementLevel>01</TitleElementLevel><TitlePrefix>The</TitlePrefix><TitleWithoutPrefix>Manga &amp; More</TitleWithoutPrefix><Subtitle>Vol. 1</Subtitle></TitleElement></TitleDetail>
<Contributor><ContributorRole>A01</ContributorRole><PersonName>A. Mangaka</PersonName></Contributor>
<Extent><ExtentType>00</ExtentType><ExtentValue>192</ExtentValue></Extent></DescriptiveDetail>
<PublishingDetail><Imprint><ImprintName>Kodansha Comics</ImprintName></Imprint><Publisher><PublisherName>Kodansha USA</PublisherName></Publisher>
<PublishingDate><PublishingDateRole>01</PublishingDateRole><Date>20260115</Date></PublishingDate></PublishingDetail>
<ProductSupply><SupplyDetail><Supplier><SupplierName>PRH</SupplierName></Supplier><ProductAvailability>21</ProductAvailability><Stock><OnHand>2</OnHand></Stock><PackQuantity>48</PackQuantity>
<Price><PriceType>02</PriceType><DiscountCoded><DiscountCodeType>02</DiscountCodeType><DiscountCode>A</DiscountCode></DiscountCoded><PriceAmount>12.99</PriceAmount><CurrencyCode>USD</CurrencyCode></Price>
<Price><PriceType>01</PriceType><PriceAmount>16.99</PriceAmount><CurrencyCode>CAD</CurrencyCode></Price></SupplyDetail></ProductSupply></Product>
<Product><ProductIdentifier><ProductIDType>15</ProductIDType><IDValue>9780000000000</IDValue></ProductIdentifier></Product></ONIXMessage>`;
r = C.parse('feed.xml', onix3);
assert.strictEqual(r.kind, 'onix'); assert.strictEqual(r.rows.length, 1); assert.strictEqual(r.skipped, 1);
assert.deepStrictEqual(r.rows[0], {item_key:'9781646513161', title:'The Manga & More', subtitle:'Vol. 1', contributors:'A. Mangaka', publisher:'Kodansha USA',
  imprint:'Kodansha Comics', series:'Sample Series', format:'Paperback', pub_date:'2026-01-15', list_price:'12.99', pages:'192', case_qty:'48', qty:'2', availability:'low'});

// ONIX 2.1, short tags, discount percent, out of print
const onix2 = `<ONIXmessage><product><productidentifier><b221>15</b221><b244>9780143039433</b244></productidentifier><b012>BB</b012>
<title><b202>01</b202><b203>Road Less Sampled</b203></title><contributor><b036>B. Writer</b036></contributor><imprint><b079>Viking</b079></imprint>
<publisher><b081>Penguin</b081></publisher><b003>2001</b003><supplydetail><j141>OP</j141><price><j148>01</j148><j267>46</j267><j151>27.00</j151><j152>USD</j152></price></supplydetail></product></ONIXmessage>`;
r = C.parse('feed.onix', onix2);
assert.deepStrictEqual(r.rows[0], {item_key:'9780143039433', title:'Road Less Sampled', contributors:'B. Writer', publisher:'Penguin', imprint:'Viking', format:'Hardcover',
  list_price:'27.00', discount:'0.46', availability:'out_of_print'});

// Stock feed
r = C.parse('stock_20261127.txt', '9780143039433|1\n9781646513161|0\nheader line\n');
assert.strictEqual(r.kind, 'stock');
assert.deepStrictEqual(r.rows, [{item_key:'9780143039433', availability:'in_stock'}, {item_key:'9781646513161', availability:'backorder'}]);
assert.strictEqual(r.skipped, 1);

console.log('catalog readers: all checks passed');
