# Vendors and title catalog

One search across every vendor's title list, with each vendor's stock, your cost, margin and the special-order price.
Tables and rules: `catalog.sql`. Screens: **Title search** (everyone) and **Catalog imports** (managers and owner), in `app/catalog.js`.

## Set it up (once)
1. Supabase > SQL Editor > New query > paste all of `catalog.sql` > Run (after `shopify.sql`). Running it again is safe.
2. In the app, as owner, open **Catalog imports** and press **Copy vendors from the Vendors screen**.
3. For each vendor, open it under **Discounts and stock links** and fill in the usual discount off list (for example 46 for PRH returnable),
   any discounts by product class (manga, comics, non-returnable...), and a stock check link if the vendor has a search page.
4. Load each vendor's title list (below). Re-load whenever a new list or stock file comes in.

Never put account numbers, logins or passwords in the vendor records. They stay in your password manager.

## Who sees what
Costs stay with managers and the owner, the same as the app's other cost records.

| | Search, stock, special-order price | Cost, discount, margin, terms | Edit vendors, load catalogs |
|---|---|---|---|
| Staff | yes | no | no |
| Shift lead | yes | no | no |
| Manager, owner | yes | yes | yes |

## How cost, margin and price are worked out
- **Cost** = a set wholesale cost from the vendor's list (Faire, Amazon), otherwise list price × (1 − discount).
  The discount is the title's own discount from the vendor's file, else the vendor's discount for that product class and quantity, else the vendor's usual discount.
- **Margin at list price** = 1 − cost ÷ list price (so it equals the discount for books bought off list).
- **Special-order price** uses the same margin tiers as the app's Order pricing screen (bigger orders, smaller margin; at least $3 over cost; ends in .49 or .99).
  When that comes out above the book's printed list price, the search says so.

## What each source offers (checked Nov 2026)
| Source | Title list | Stock | How to get it |
|---|---|---|---|
| Penguin Random House | ONIX 3.0/3.1 feed or MetaExcel (.xlsx); comics as Comet/MetaCSV | Daily stock feed: in stock yes/no per ISBN, no quantities | Feeds by SFTP after the PRH data-feed questionnaire (penguinrandomhouse.biz > Vendors > data feeds). Covers PRH's distributed publishers (Kodansha, Seven Seas, Dark Horse...) through the same account. PRH also has a public metadata API that needs a registered key. |
| Simon & Schuster (VIZ) | ONIX by request; seasonal catalogs on Edelweiss+ | Check on the S&S retailer site | Ask your S&S rep for an ONIX feed, or export catalog lists from Edelweiss+ |
| Hachette (Yen Press) | ONIX by request (HBG ONIX support); Edelweiss+ catalogs | HBG Retailer Portal shows real-time availability | Ask HBG ONIX support; stock check link to the portal |
| Bookazine | Search and lists on the bookseller portal | Portal shows stock levels | Export or copy lists to CSV; stock check link to the portal |
| IPG | Title search on its site; ONIX by request | Check on the site or with a rep | Ask IPG for a title list or ONIX |
| Lunar Distribution | Product solicitation CSV forms | Weekly shipping; check the portal | Load the CSV forms |
| Faire | Product pages per brand; brand order exports | Brand inventory shows on Faire | Export products or orders to CSV; Faire's API is for brands, not retailers |
| Amazon Business | No catalog download for retailers | Shown on Amazon | Record titles as you order them |
| Libro.fm | Audiobooks sold through the store's page | Digital | Not needed in the catalog |
| Open Library | Free metadata for any ISBN (monthly bulk dumps too) | No | Title search fills in a missing ISBN from Open Library with one tap |

## File types the import reads
- **ONIX 2.1 or 3.0** (.xml): titles, contributors, imprint, format, pub date, US price, discount, availability and stock on hand. Large feeds are read in parts.
- **CSV or TSV**: column names are matched for ISBN/EAN, SKU, title, author, publisher, format, pub date, list price, discount, wholesale cost, availability and quantity.
  Excel files: Save As CSV first.
- **Stock feeds** (.txt): one ISBN per line followed by 1/0 or Y/N. Updates titles already loaded for that vendor.

## Ordering (Orders screen, `app/orders.js`)
- **Build:** in Title search, press **Add to order** next to the vendor you want (with an optional note, e.g. a customer's special order).
  Each vendor has one open order. Anyone signed in can add titles; managers and the owner change quantities, see cost and send.
- **Check stock:** every line shows that vendor's last known stock, a **Check stock** link to their site, and another active vendor that shows it in stock when this one doesn't.
- **Send** the way the vendor takes orders (set under Catalog imports > each vendor):
  - *Upload or paste:* **Copy ISBNs and quantities** and paste into the vendor's quick order (PRH Self-Service: Cart > Add ISBNs/UPCs), or **Download order file (.csv)** to upload (Lunar, Bookazine, IPG).
  - *Email:* **Write the order email** opens your own email app with the order filled in. You press Send.
  - *Website or marketplace* (Faire, Amazon Business): opens their ordering page.
- **Mark as sent** with their order number and expected date. The order then waits in **Receiving** as a shipment with the same lines and costs, ready to check in.
- The app never places an order or contacts a vendor by itself.

### Sending orders straight from the app later (EDI through Pubnet)
Pubnet (run by MVB) is the book trade's EDI network: free for booksellers after a one-time $75 setup (often waived), plus a SAN.
It carries purchase orders and the publisher's acknowledgements, which come back with stock status and pricing. Pubnet expects EDI files over FTP,
usually from bookstore POS systems. Supporting it would mean a Supabase function that writes the order file and reads the acknowledgements.
It is worth doing once there are direct terms accounts with the publishers (Pubnet needs those, and prepay accounts mostly don't work).
Sign-up: info.pubnet.org/services/join-pubnet.

## Email an order to yourself
**Email this order to me** sends the order to the signed-in manager's or owner's own address (never anyone else), with the CSV attached, through the `send-order` function.
It needs a free Resend account: add Supabase secrets `RESEND_API_KEY` and `ORDER_FROM`, then deploy `supabase/functions/send-order`.
Until then the button opens your own email app addressed to you.

## Every product tracked by the vendor you order it through
- **Shopify → catalog (hourly):** each Shopify product with an ISBN or SKU becomes searchable and orderable. Link each Shopify *Vendor* name (publisher, or the brand name Faire's Shopify app uses) to the vendor you order through, under Catalog imports > Products from Shopify.
- **Title search** shows store stock, shelf price and 30-day sales next to every vendor's stock and cost.
- **Reorder suggestions** (Orders screen): sold in 30 days and down to 1 or fewer, grouped by ordering vendor, with one-tap Add.
- **Purchase history** (managers, owner): every line bought by ISBN, with vendor, date, quantity, cost, list price, shelf price and margin, plus a CSV download.
  Orders made here record themselves. Orders placed on Faire, Amazon or the PRH portal are recorded when the shipment is checked in under Receiving.

## What each ordering site can sync (Nov 2026)
| Site | What can flow in automatically |
|---|---|
| Faire | Faire's own Shopify app ("Faire: Buy Wholesale") creates the product in Shopify when you buy. The app picks it up through the Shopify sync. Faire has no API for buyers. |
| Amazon Business | Official API: Reconciliation (orders and invoices), Product Search and Ordering. Needs Amazon's onboarding questionnaire and approval, then a one-time Allow by the account admin. No password is stored. |
| Penguin Random House | ONIX title feed and daily in-stock feed by SFTP after their data-feed form. Orders: paste or upload in Self-Service, or EDI through Pubnet. |
| Hachette, Simon & Schuster, IPG | ONIX feeds on request; EDI through Pubnet once you have terms accounts. |
| Bookazine, Lunar | Their portals and CSV forms; import the files. |

## Automatic check-in
Every 15 minutes, right after the Shopify sync, the app compares each item's on-hand count in Shopify with the last count it saw.
- **Stock went up for an item on an open order** (sent or confirmed): that many copies count as received on the oldest open order. When every line is in, the order becomes *received*, and the matching Receiving shipment fills itself in. Staff only fix what came short or damaged (Orders > the line > "Short, damaged or counted wrong?").
- **Stock went up with no order in the app** (bought on Faire, Amazon or a portal and received into Shopify): it is recorded in Purchase history as an arrival from the vendor that item is linked to, at the Shopify cost. One record per vendor per day.
  If the same shipment is later checked in under Receiving, the automatic entry is replaced, so nothing is counted twice.
- Limits: the app sees the *net* change every 15 minutes, so a sale in the same window hides that many arrivals. A stock-count correction or customer return that raises stock is recorded as an arrival too; fix it from Purchase history if that happens.
