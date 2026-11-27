-- Shared app data and roles for Downtown Stube (Supabase project "shop-steady").
-- Run after setup.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
--
--   desk_members.role : staff, lead, manager or owner. The app shows each person only their level and below.
--   app_docs          : the app's shared data, one row per area (shifts, voice, notes, tax...), as JSON.
--                       Everyone on the list can read and change the shared areas; only the owner changes
--                       setup (store names, business type) and which modules are on.
--   save_doc()        : saves an area only if nobody else saved it since you loaded it, so the app can merge
--                       two people's changes instead of one overwriting the other.
-- Write-offs and giveaways (key 'writeoffs') can be changed only by a manager or the owner.
-- Then run private-areas.sql: pay, mileage, write-offs and item costs are readable only by a store manager or the owner.

-- 1. Roles
alter table public.desk_members add column if not exists role text not null default 'staff';
alter table public.desk_members add column if not exists name text;
alter table public.desk_members drop constraint if exists desk_members_role_check;
alter table public.desk_members add constraint desk_members_role_check check (role in ('staff','lead','manager','owner'));

create or replace function public.role_rank(r text) returns int language sql immutable as $$
  select case r when 'owner' then 4 when 'manager' then 3 when 'lead' then 2 when 'staff' then 1 else 0 end $$;

create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.desk_members where email = lower(coalesce(auth.jwt() ->> 'email', '')) $$;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- The owner manages the list from the app. At least one owner always remains.
create or replace function public.list_members() returns table(email text, role text, name text)
language sql stable security definer set search_path = public as $$
  select email, role, name from public.desk_members where public.role_rank(public.my_role()) >= 3 order by role_rank(role) desc, email $$;
create or replace function public.set_member(p_email text, p_role text, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner can change who has access'; end if;
  if p_role not in ('staff','lead','manager','owner') then raise exception 'Unknown role'; end if;
  if p_role <> 'owner' and exists (select 1 from public.desk_members where email = lower(p_email) and role = 'owner')
     and (select count(*) from public.desk_members where role = 'owner') = 1 then raise exception 'Keep at least one owner'; end if;
  insert into public.desk_members (email, role, name) values (lower(trim(p_email)), p_role, nullif(trim(coalesce(p_name,'')),''))
  on conflict (email) do update set role = excluded.role, name = coalesce(excluded.name, public.desk_members.name);
end $$;
create or replace function public.remove_member(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner can change who has access'; end if;
  if lower(p_email) = lower(coalesce(auth.jwt() ->> 'email','')) then raise exception 'You cannot remove yourself'; end if;
  delete from public.desk_members where email = lower(p_email);
end $$;
revoke all on function public.list_members() from public, anon;
revoke all on function public.set_member(text,text,text) from public, anon;
revoke all on function public.remove_member(text) from public, anon;
grant execute on function public.list_members() to authenticated;
grant execute on function public.set_member(text,text,text) to authenticated;
grant execute on function public.remove_member(text) to authenticated;

-- 2. Shared app data
create table if not exists public.app_docs (
  key        text primary key check (key ~ '^[a-z]{2,20}$'),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 8000000),
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.app_docs enable row level security;
revoke all on public.app_docs from anon;
grant select on public.app_docs to authenticated;
revoke insert, update, delete on public.app_docs from authenticated; -- changes go through save_doc() only
drop policy if exists "members read app data" on public.app_docs;
create policy "members read app data" on public.app_docs for select to authenticated using (public.is_desk_member());

create or replace function public.save_doc(p_key text, p_data jsonb, p_base bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; who text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if p_key in ('setup','mods') and public.my_role() is distinct from 'owner' then raise exception 'owner-only'; end if;
  if p_key = 'writeoffs' and public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
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

-- 3. The first owner: put your own sign-in email here before you Run.
update public.desk_members set role = 'owner' where email = 'you@example.com';
