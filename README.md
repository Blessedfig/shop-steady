# Shop Steady

A staff and owner app for small brick-and-mortar businesses: retail shops, bookstores, cafés and service businesses.
Built first for The Blessed Fig Tree (an independent bookstore with rooms upstairs), and set up so any small business can use it.

**Goals:** easier management for owners, happier staff through clear communication with almost no training, and better data for decisions.

Live test version: https://blessedfig.github.io/shop-steady/app/ (made-up sample data, kept in your browser only).

## What's here now
- **Sign-in and roles:** invite-only sign-in (password or emailed code), stays signed in. Four role tiers (staff, shift lead, manager, owner); the owner switches each module on or off per role.
- **Business types:** each location picks a type (bookstore, retail shop, café, services or rentals) under **Setup**. The type sets the role names and which modules start on. The owner can rename any role.
- **Inventory and reorders:** stock by ISBN or SKU, low-stock flags, suggested orders grouped by supplier (CSV download), consignment and used copies.
- **Expenses:** receipt log by category and an owner spending card on Home.
- Installable on phones (PWA), Android test build, accessibility and security checks on every change.

## Coming next
1. Shifts and staff: store-mode tablet with personal PINs, time clock, scheduling, pay rates and overtime, daily checklists.
2. Inventory and ordering: Shopify sync, Faire, one search across suppliers, special orders priced with a set margin.
3. Decision planners: "Should I hire?" and other big first-time owner decisions.
4. Owner tools, staff playbook and community impact report.

## Run it locally
`python3 -m http.server 8000` in this folder, then open http://localhost:8000/app/ . It runs in demo mode until `app/config.js` has real Supabase values (see `supabase/setup.sql`).

## Rules
- The repo is public. Never commit keys, passwords, customer data or staff data. Secret keys live only in Supabase secrets.
- Take card payments in a real POS (Shopify POS) or Stripe, never in this code.
- Business and legal notes are best readings, not legal, tax or financial advice. Each links to the agency to confirm with.

Built from the reusable parts of Steady Shift (github.com/Blessedfig/steady-shift).
