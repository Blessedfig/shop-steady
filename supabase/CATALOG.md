# Vendors and title catalog

One search across every vendor's title list, with each vendor's stock, your cost, margin and the special-order price.
Tables and rules: `catalog.sql`. Screens: **Title search** (everyone) and **Catalog imports** (managers and owner), in `app/catalog.js`.

## Set it up (once)
1. Supabase > SQL Editor > New query > paste all of `catalog.sql` > Run. Running it again is safe.
2. In the app, as owner, open **Catalog imports** and press **Copy vendors from the Vendors screen**.
3. For each vendor, open it under **Discounts and stock links** and fill in the usual discount off list (for example 46 for PRH returnable),
   any discounts by product class (manga, comics, non-returnable...), and a stock check link if the vendor has a search page.
4. Load each vendor's title list (below). Re-load whenever a new list or stock file comes in.

Never put account numbers, logins or passwords in the vendor records. They stay in your password manager.

## Who sees what
| | Search, stock, special-order price | Cost, discount, margin, terms | Edit vendors, load catalogs |
|---|---|---|---|
| Staff | yes | no | no |
| Shift lead | yes | yes | no |
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
