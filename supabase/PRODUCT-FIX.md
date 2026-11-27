# Product fixer: setup

The product fixer keeps Shopify product data clean on its own. It was built for Faire items, which Faire's Shopify
app often brings in with the whole case or order total as the cost, no barcode, or the case retail as the price.

## What it does every hour
1. Looks up ISBNs for up to 25 books with no barcode (Google Books, then Open Library), by title and author.
2. Rereads every product with its cost, your uploaded Faire order lines, and the lookups, and proposes fixes:

| Rule | Fixes | How sure |
|---|---|---|
| Clean up barcode formatting | dashes, spaces, a leading apostrophe | Sure |
| ISBN-10 to ISBN-13 | 10-digit ISBN to the 13-digit one on the barcode | Sure |
| Barcode from the SKU / title / Faire order | empty or broken barcode, when a valid code is right there | Sure |
| ISBN found by title and author | empty barcode on a book; you pick the edition when several match | Likely |
| Cost from the Faire order | empty cost | Sure |
| Case total to cost per item | cost equals the Faire line total or a multiple of the price per item | Sure |
| Cost differs from the last Faire order | price went up or down | Likely |
| Pack size in the name / cost is a multiple of the case | cost at or above the price, no Faire order on file | Likely |
| Estimated Faire cost | half of retail, when nothing better is known | Estimate |
| Retail price from Faire / case retail to one item | empty price, or the price of the whole case | Sure |
| Price at twice cost | empty price | Estimate |
| Product type for books | ISBN but no type (uses your most common book type) | Likely |
| Track stock for Faire items | stock tracking off | Likely |

It also flags what needs a person: barcodes that fail their check digit, two products with one barcode, cost at
or above price with no explanation, selling below cost.

3. Rules the owner switched to "Fix on its own" send their Sure and Likely fixes straight to Shopify. Estimates and
   edition picks always wait for the owner. Everything else waits in **Product fixer** for the owner to approve.

Nothing changes in Shopify without the owner: either approving the fix, or having turned its rule on.
Every applied fix is listed under "Recently fixed" with Undo.

## Setup (once)
1. Supabase > SQL Editor: run `shopify.sql` again (it adds product tags and new change kinds), then `product-fix.sql`.
   Run them in that order whenever either changes.
2. Deploy the Edge Function `product-fix` (this folder's `functions/product-fix/index.ts`) with
   "Verify JWT with legacy secret" OFF, like `shopify-sync`. Deploy the updated `shopify-sync` too.
3. Optional: add a `GOOGLE_BOOKS_KEY` secret for a higher Google Books daily limit. It works without one.
4. In the app: Shopify > Sync now, then **Product fixer** > Check now. After that it runs on its own at 20 past each hour.

## Faire orders
Faire has no API for stores. In Faire, open Orders and download your orders as a CSV, then upload it in
Product fixer > Faire orders. The columns are matched automatically (product, quantity, case size, wholesale price,
retail price, total, SKU, UPC, order number, date); change any that look wrong. Uploading the same file twice adds
nothing new. The fixer matches Faire lines to Shopify products by SKU, then by product and option name.

## Files
- `app/lib/fixrules.js`: the rules (pure JavaScript). A copy sits between the RULES markers in
  `supabase/functions/product-fix/index.ts`; after changing the rules run `node tests/fixrules-test.js --sync`.
- `app/fix.js`: the Product fixer screen.
- `supabase/product-fix.sql`: tables, owner-only approve / undo / automatic rules, the hourly timer.
- Tests: `tests/fixrules-test.js`, `tests/product-fix-fn-test.mjs`.
