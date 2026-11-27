-- Morning run (Nov 27): 1) private areas for HR files and decisions, 2) remove the demo's sample team and old PINs.
-- Same as running supabase/hr.sql and then supabase/remove-sample-team.sql. Safe to run again.

-- HR files and decision planners for Downtown Stube (Supabase project "shop-steady").
-- Run after staff-safety.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
-- If private-areas.sql or staff-safety.sql is run again later, run this file again after them (all define save_doc).
--
--   hr        : each person's file: start date, paperwork checklist, reviews, coaching and write-ups.
--               Store manager and owner only.
--   decisions : decision planners (hire someone, add a category, change hours...). Store manager and owner only.
--   Medical papers are kept out of the app on purpose (a separate locked folder).
-- The app only shares these areas once this file has run (it asks the database first), so nothing private is
-- ever saved where staff could read it.

create or replace function public.private_doc(k text) returns boolean language sql immutable as $$
  select k in ('pay','trips','writeoffs','costs','safe','staffnotes','hr','decisions') $$;
grant execute on function public.private_doc(text) to authenticated;

drop policy if exists "members read app data" on public.app_docs;
create policy "members read app data" on public.app_docs for select to authenticated
  using (public.is_desk_member()
         and (not public.private_doc(key) or public.role_rank(public.my_role()) >= 3));

create or replace function public.save_doc(p_key text, p_data jsonb, p_base bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; who text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if p_key in ('setup','mods') and public.my_role() is distinct from 'owner' then raise exception 'owner-only'; end if;
  if public.private_doc(p_key) and public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  if p_key = 'shifts' then p_data := public.strip_pins(p_data); end if;          -- PINs live in desk_pins only
  if p_key = 'notes' then p_data := public.notes_split(p_data, false); end if;    -- employee notes live in staffnotes
  if p_key = 'voice' then who := 'team'; end if;                                  -- anonymous posts stay anonymous
  select version into v from public.app_docs where key = p_key for update;
  if v is null then
    insert into public.app_docs (key, data, version, updated_by) values (p_key, p_data, 1, who); return 1;
  end if;
  if v <> coalesce(p_base, 0) then return -v; end if; -- someone saved first: the app merges and tries again
  update public.app_docs set data = p_data, version = v + 1, updated_at = now(), updated_by = who where key = p_key;
  return v + 1;
end $$;
revoke all on function public.save_doc(text,jsonb,bigint) from public, anon;
grant execute on function public.save_doc(text,jsonb,bigint) to authenticated;

select public.private_doc('hr') as hr_private, public.private_doc('decisions') as decisions_private;

-- One-time cleanup (Nov 2026): the shared team still had the demo's sample people (Alex, Sam, Jordan, Riley, whose
-- PINs are printed on the public demo page) and several duplicate "Owner" entries using the demo PIN 9999.
-- This keeps one Owner per location, removes the sample people and their sample shifts, drops their pay entries,
-- and clears every store-tablet PIN. Afterwards the owner sets a new PIN on the Team screen ("Set a PIN").
-- Safe to run again.

update public.app_docs d set
  data = jsonb_set(jsonb_set(d.data, '{team}', coalesce((
      select jsonb_object_agg(s.key, (
        select coalesce(jsonb_agg(p order by o), '[]'::jsonb)
        from jsonb_array_elements(s.value) with ordinality as e(p, o)
        where p ->> 'n' not like '%(sample)%'
          and (p ->> 'n' <> 'Owner' or o = (select min(o2) from jsonb_array_elements(s.value) with ordinality as e2(p2, o2) where p2 ->> 'n' = 'Owner'))))
      from jsonb_each(d.data -> 'team') s where jsonb_typeof(s.value) = 'array'), '{}'::jsonb)),
    '{sched}', coalesce((
      select jsonb_object_agg(s.key, (
        select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
        from jsonb_array_elements(s.value) with ordinality as e(x, o) where coalesce(x ->> 'who', '') not like '%(sample)%'))
      from jsonb_each(d.data -> 'sched') s where jsonb_typeof(s.value) = 'array'), '{}'::jsonb)),
  version = d.version + 1, updated_at = now()
where d.key = 'shifts' and jsonb_typeof(d.data -> 'team') = 'object' and jsonb_typeof(d.data -> 'sched') = 'object';

update public.app_docs pay set
  data = jsonb_set(pay.data, '{people}', coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(pay.data -> 'people') e(k, v)
    where k in (select p ->> 'id' from public.app_docs sh, jsonb_each(sh.data -> 'team') s, jsonb_array_elements(s.value) p
                where sh.key = 'shifts' and jsonb_typeof(s.value) = 'array')), '{}'::jsonb)),
  version = pay.version + 1, updated_at = now()
where pay.key = 'pay' and jsonb_typeof(pay.data -> 'people') = 'object';

delete from public.desk_pins;
delete from public.desk_pin_fails;

select (select jsonb_agg(p ->> 'n') from public.app_docs sh, jsonb_each(sh.data -> 'team') s, jsonb_array_elements(s.value) p where sh.key = 'shifts') as team_now,
       (select count(*) from public.desk_pins) as pins_left;
