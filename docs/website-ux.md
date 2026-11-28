# Website UX standard

The public site (index, features, why-downtown, get-app, accessibility, 404) follows *Laws of UX* (Jon Yablonski, 2nd ed.)
and the Supper Club brand. This file is the audit from November 2026, the rules to keep, and the plan for the pictures.

## Rules to keep

1. **Same header everywhere** (Jakob's law): logo home, Features, Pricing, Our story, Sign in, and one "Try the demo" button.
2. **One main action, always the same look** (Von Restorff): mustard button with pine text = "Try the demo" or "Ask for early access".
   Everything else is an outline button or a link. Don't add a second mustard button to a section.
3. **Big, close targets** (Fitts): 48px minimum everywhere; on phones the main button is full width and 56px tall.
   The phone header is two short rows and doesn't stick, so the page keeps the screen.
4. **Few choices, in chunks** (Hick, Miller): 3 to 5 items per group, one idea per section. Long reading goes on its own page
   (that's why the research moved to `why-downtown.html`).
5. **Do the hard part for the reader** (Tesler): explain unfamiliar words ("Stube", "point of management") with a picture or one plain line.
6. **End well** (peak-end): every page ends on a clear next step; the 404 page is friendly and offers the demo.
7. **Fast** (Doherty, 400 ms): pictures have width and height, only the top picture loads right away, the rest load lazily, WebP for photos-style art.
8. **Pretty, but tested** (aesthetic-usability): good looks hide problems, so `tests/a11y.js` still runs on every page at phone and desktop width.
9. **No tricks** (chapter 12): no fake reviews, countdowns, pre-ticked boxes, or prices we haven't set. Example screens are labeled as examples.

## Audit, November 2026

| Finding | Law | Fix |
|---|---|---|
| Home page was about 20 phone screens long, with a 4-card research essay and 13 citations in the middle | Miller, Hick | Research moved to `why-downtown.html`; home keeps a 3-number teaser and a link. Home is about 15% shorter on phones. |
| Two near-duplicate 3-card sections ("Why it exists" and "Who we are") plus a separate Stube story and bookstore story | Miller | Merged into one benefits row and one "Our story" section |
| Phone header took 3 rows (168px, sticky), about a fifth of the screen on every scroll | Fitts | Two rows (108px), not sticky on phones |
| Header menu said "Owner dashboard" and was different on every page ("Sections", "Open the app", "Staff sign-in") | Jakob | One menu on every page; "Sign in" like every other site |
| No pricing on the page, though visitors expect it in the menu | Jakob | Pricing section: free during testing, then one flat price per store (per location), unlimited staff, optional paid add-ons. Approved by Christian 2026-11-28; no dollar amount yet |
| Header button was mustard but the hero and closing buttons were pine, so the main action looked different in each place | Von Restorff | One look for the main action site-wide |
| No pictures at all; the page was text and app mockups | Aesthetic-usability | 8 illustration spots (below) |
| "Stube" explained only in text | Tesler, Jakob | Picture of the back room next to the explanation |
| Business-type list used emoji, which look different on each phone | Aesthetic-usability | One plain sentence under the steps |
| 404 page listed the same app link twice and repeated "in private testing" | Peak-end | Fixed, picture added, demo link offered |
| Jump links (#pricing, #story) landed under the sticky desktop header | Fitts | `scroll-margin-top` on sections |
| Brandy orange (a brand color) wasn't used anywhere | Aesthetic-usability | Section labels are brandy |

Not changed on purpose: the privacy page (being rewritten in the legal-check pull request) and page footers (other open pull requests edit them).

## Making the pictures

The site ships with simple brand-colored SVG placeholders in `assets/art/`, so it looks finished today.
The final art is made by OpenAI's image model from the prompts in `assets/art/prompts.json`
(shared style line + one prompt per spot). Each prompt says where it goes and why it helps.

| id | Where | Size |
|---|---|---|
| hero | Home, top, behind the app mockup | 1536×1024 |
| stube | Home, Our story | 1536×1024 |
| downtown | Home teaser and top of Why downtown | 1536×1024 |
| step-type, step-team, step-routines, step-open | Home, How it works | 1024×1024 |
| notfound | 404 page | 1536×1024 |

Three ways to make them, easiest first:

1. **GitHub, no computer setup:** add a repository secret named `OPENAI_API_KEY`
   (Settings > Secrets and variables > Actions), then Actions > **Make website art** > Run workflow on this branch.
   It makes every missing picture, swaps the pages over and commits.
2. **Your computer:** `OPENAI_API_KEY=sk-... node tools/make-art.mjs` (Node 22). Add ids to make only some, `--force` to redo.
3. **By hand in ChatGPT:** paste the style line plus one prompt, download, save as `assets/art/<id>.webp` (or .png),
   then run `node tools/make-art.mjs --link-only`.

Rules for any picture: no words or numbers in the image, no logos or brands, no real or recognizable people or places.
The OpenAI key costs money per image (8 high-quality images is a few dollars) and OpenAI may ask the account to verify the organization before its image model works.
Never commit the key.

## Polish pass, November 28

- Brand mark is the Open Sign app icon (`assets/brand/open-sign.png`) in the header and footer of every page.
- A proof strip under the hero: used in a working bookstore, card payments stay in your POS, accessibility checked, invite-only sign-in. Only true, checkable claims. No made-up reviews or customer logos (book, chapter 12).
- Footer in three groups (Product, Company, Help and legal), same on every site.css page.
- Share card `assets/brand/og.png` (1200×630) with Open Graph and Twitter tags and a canonical link on the home, Features and Why downtown pages.
- The home page dropped the "point of sale vs point of management" block and the "Your data stays yours" cards. The hero, Why Stube and the proof strip now say the same things in fewer words.
- App screens on the site stay as drawn HTML examples, not screenshots. They stay sharp at any size, follow light and dark mode, and don't show a real store's data.
