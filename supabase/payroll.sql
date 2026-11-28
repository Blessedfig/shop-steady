-- Payroll for Downtown Stube (Supabase project "shop-steady").
-- Run after hr.sql (or morning-run.sql): Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
-- If private-areas.sql, staff-safety.sql or hr.sql is run again later, run this file again after them (all define save_doc).
--
--   payroll : pay runs, what each run cost, payroll setup and the new-hire paperwork checklist.
--             OWNER ONLY: store managers can't read or save it (they still see hours and rates on Timesheets).
-- The app only shares this area once this file has run (it asks the database first); until then it stays on the
-- owner's device.

create or replace function public.private_doc(k text) returns boolean language sql immutable as $$
  select k in ('pay','trips','writeoffs','costs','safe','staffnotes','hr','decisions','payroll') $$;
grant execute on function public.private_doc(text) to authenticated;

create or replace function public.owner_doc(k text) returns boolean language sql immutable as $$
  select k in ('payroll') $$;
grant execute on function public.owner_doc(text) to authenticated;

drop policy if exists "members read app data" on public.app_docs;
create policy "members read app data" on public.app_docs for select to authenticated
  using (public.is_desk_member()
         and (not public.private_doc(key) or public.role_rank(public.my_role()) >= 3)
         and (not public.owner_doc(key) or public.my_role() = 'owner'));

create or replace function public.save_doc(p_key text, p_data jsonb, p_base bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; who text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if (p_key in ('setup','mods') or public.owner_doc(p_key)) and public.my_role() is distinct from 'owner' then raise exception 'owner-only'; end if;
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

select public.owner_doc('payroll') as payroll_owner_only;
