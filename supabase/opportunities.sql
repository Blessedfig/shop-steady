-- Opportunities (grants, loans, tax credits, rebates) for Downtown Stube (Supabase project "shop-steady").
-- Run after hr.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
-- If private-areas.sql or hr.sql is run again later, run this file again after them (they define private_doc).
--
--   opps : the store's answers (location, downtown, owns building...), which programs it is tracking, reminders,
--          notes and its own added programs. Store manager and owner only, because it shows loans and plans.
-- The app keeps 'opps' on the device until this has run (it asks private_doc('opps') first).

create or replace function public.private_doc(k text) returns boolean language sql immutable as $$
  select k in ('pay','trips','writeoffs','costs','safe','staffnotes','hr','decisions','opps') $$;
grant execute on function public.private_doc(text) to authenticated;

select public.private_doc('opps') as opps_private, public.private_doc('decisions') as decisions_private;
