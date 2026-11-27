# doc-import (AI document import)

Reads the text of a supplier document (invoice, packing slip, catalog, consignment list) and returns line items
for a person to review before they touch inventory.

Set up (about 15 minutes, once):
1. Create an Anthropic API key in the Claude Console. Keep it out of the repo and the page.
2. Supabase > Edge Functions > Deploy new function > name `doc-import` > paste `index.ts` > Deploy.
3. Supabase > Edge Functions > Secrets: add `ANTHROPIC_API_KEY`, and `ALLOWED_ORIGIN` = your site origin
   (for example `https://blessedfig.github.io`). Optional `IMPORT_MODEL` (default `claude-opus-5-5`).
4. From the page: `sb.functions.invoke('doc-import', {body:{ping:true}})` should return `{ok:true}`.

Notes:
- Server-side fallbacks are on (`fallbacks: "default"`): if the model declines, the API retries on a fallback model in the same call.
- Uses structured outputs (`output_config.format`), not forced tool choice (forced `tool_choice` returns a 400 on Claude Opus 5.5).
- The browser side extracts text with the vendored `pdf.min.js` and `mammoth.browser.min.js` in `app/vendor/`.
- ISBN check digits are verified in code (`isbn_valid`). Show invalid ones in amber for a person to fix.
