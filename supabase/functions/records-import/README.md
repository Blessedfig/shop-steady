# records-import (AI onboarding for a folder of business records)

The owner drops a folder on **Import records** (owner menu). Each file gets a suggested place:
Expenses, Vendors, HR files, Business records, Keep out (medical) or Skip. The owner checks every file before saving.

Two ways to sort:
- **Free:** suggestions from file and folder names, plus words read inside PDFs, Word and text files **on the owner's computer**
  (dates, totals, payee, kind of paper). Nothing is sent anywhere.
- **AI onboarding (paid):** this function reads one file per call and returns where it belongs and the details. Each file read
  takes one from the store's allowance in `public.records_ai`, so the cost is capped. Proposed price in `app/records.js` (`AI_OFFER`).

Set up (once):
1. Run `supabase/records.sql` in the SQL Editor (owner-only tables `owner_records` and `records_ai`).
2. Supabase > Edge Functions > Deploy new function > name `records-import` > paste `index.ts` > Deploy.
   It uses the same `ANTHROPIC_API_KEY` and `ALLOWED_ORIGIN` secrets as `doc-import` and `ask`.
   Optional `RECORDS_MODEL` (default `claude-opus-5-5`; `claude-haiku-5-5` costs far less per file if its sorting is good enough).
3. Give a store its AI files: `update public.records_ai set files_left = files_left + 1000 where id = 1;`
4. From the page: `sb.functions.invoke('records-import', {body:{ping:true}})` returns `{ok:true, files_left:...}`.

Privacy:
- Files are not uploaded or stored. The app keeps the facts each screen needs and the file's name and folder.
- Social Security, tax id, card and bank-style numbers are removed in the browser and again here.
- Files that look medical by name or text are never sent. If one slips through, the answer is just "medical" with no details,
  and the app never saves it.
- Owner only (checked here with `is_owner()` and by row security on the tables).

Cost guide: one file is usually a few thousand input tokens at effort `low`. Long files send only the first part
(20,000 characters, enough to sort it); scanned PDFs send a picture of page 1.
