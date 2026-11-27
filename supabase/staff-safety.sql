-- Staff safety fixes for Downtown Stube (Supabase project "shop-steady"), from the security check.
-- Run after sync.sql and private-areas.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
-- If private-areas.sql is ever run again, run this file again after it (both define save_doc).
--
--   1. Store-mode PINs are checked by the database. Until now each person's PIN fingerprint sat in the shared
--      schedule, which every phone downloads, and a 4-digit PIN can be guessed from its fingerprint in a moment.
--      Now PINs live in desk_pins (bcrypt, nobody can read the table from the web), check_pin() answers with the
--      person's id only, and wrong guesses lock that sign-in out for longer each time (5, 10, 20... minutes, up to a
--      day). A store manager or the owner can unlock it. Existing PINs keep working: the old fingerprints are moved
--      in here once, and each is upgraded to bcrypt the first time it is used.
--   2. Employee file notes move from the shared 'notes' area to 'staffnotes', which only a store manager or the
--      owner can read or save (like pay). save_doc keeps them out of 'notes' from now on.
--   3. Team voice: "who saved last" is no longer stamped on that area, so an anonymous post can't be traced
--      to the phone that sent it.

create extension if not exists pgcrypto with schema extensions;

-- ---------- 1. PINs ----------
create table if not exists public.desk_pins (
  site       text not null,
  person_id  text not null,
  pin_hash   text not null,
  legacy     boolean not null default false,  -- true: old SHA-256 fingerprint, upgraded on first use
  updated_at timestamptz not null default now(),
  primary key (site, person_id)
);
alter table public.desk_pins enable row level security;
revoke all on public.desk_pins from anon, authenticated;

create table if not exists public.desk_pin_fails (
  who          text primary key,      -- the signed-in account that typed the PINs
  fails        int not null default 0,
  since        timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.desk_pin_fails enable row level security;
revoke all on public.desk_pin_fails from anon, authenticated;

create or replace function public.pin_matches(p_hash text, p_legacy boolean, p_site text, p_pin text) returns boolean
language sql immutable set search_path = public, extensions as $$
  select case when p_legacy then p_hash = encode(digest('shop-steady:' || p_site || ':' || p_pin, 'sha256'), 'hex')
              else p_hash = crypt(p_pin, p_hash) end $$;
revoke all on function public.pin_matches(text, boolean, text, text) from public, anon, authenticated;

-- set or change a person's PIN (store manager and owner). Returns ok, bad (not 4 to 6 digits) or taken.
create or replace function public.set_pin(p_site text, p_person text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' or coalesce(p_site, '') = '' or coalesce(p_person, '') = '' then return 'bad'; end if;
  if exists (select 1 from public.desk_pins d where d.site = p_site and d.person_id <> p_person
             and public.pin_matches(d.pin_hash, d.legacy, d.site, p_pin)) then return 'taken'; end if;
  insert into public.desk_pins (site, person_id, pin_hash, legacy, updated_at)
  values (p_site, p_person, crypt(p_pin, gen_salt('bf', 8)), false, now())
  on conflict (site, person_id) do update set pin_hash = excluded.pin_hash, legacy = false, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.set_pin(text, text, text) from public, anon;
grant execute on function public.set_pin(text, text, text) to authenticated;

-- the store tablet: which person has this PIN? {id} on a match, {id:null} on a miss, {locked:seconds} when locked.
create or replace function public.check_pin(p_site text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', '')); f public.desk_pin_fails; hit public.desk_pins;
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  select * into f from public.desk_pin_fails where who = me;
  if f.locked_until is not null and f.locked_until > now() then
    return jsonb_build_object('locked', ceil(extract(epoch from f.locked_until - now())));
  end if;
  if coalesce(p_pin, '') ~ '^\d{4,6}$' then
    select * into hit from public.desk_pins d where d.site = p_site and public.pin_matches(d.pin_hash, d.legacy, d.site, p_pin) limit 1;
  end if;
  if hit.person_id is not null then
    -- a right PIN does not wipe earlier misses: otherwise someone could mix in their own PIN and keep guessing
    if hit.legacy then
      update public.desk_pins set pin_hash = crypt(p_pin, gen_salt('bf', 8)), legacy = false, updated_at = now()
      where site = hit.site and person_id = hit.person_id;
    end if;
    return jsonb_build_object('id', hit.person_id);
  end if;
  insert into public.desk_pin_fails as x (who, fails, since) values (me, 1, now())
  on conflict (who) do update set
    fails = case when x.since < now() - interval '24 hours' then 1 else x.fails + 1 end,
    since = case when x.since < now() - interval '24 hours' then now() else x.since end
  returning * into f;
  if f.fails % 5 = 0 then
    update public.desk_pin_fails set locked_until = now() + least(interval '24 hours', interval '5 minutes' * power(2, f.fails / 5 - 1))
    where who = me returning * into f;
    return jsonb_build_object('id', null, 'locked', ceil(extract(epoch from f.locked_until - now())));
  end if;
  return jsonb_build_object('id', null, 'left', 5 - f.fails % 5);
end $$;
revoke all on function public.check_pin(text, text) from public, anon;
grant execute on function public.check_pin(text, text) to authenticated;

-- who has a PIN at a location (store manager and owner), and unlocking after too many wrong PINs
create or replace function public.pins_set(p_site text) returns text[]
language sql stable security definer set search_path = public as $$
  select case when public.role_rank(public.my_role()) >= 3 then coalesce(array_agg(person_id), '{}') else '{}' end
  from public.desk_pins where site = p_site $$;
revoke all on function public.pins_set(text) from public, anon;
grant execute on function public.pins_set(text) to authenticated;

create or replace function public.clear_pin_locks() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  delete from public.desk_pin_fails; get diagnostics n = row_count; return n;
end $$;
revoke all on function public.clear_pin_locks() from public, anon;
grant execute on function public.clear_pin_locks() to authenticated;

-- takes PIN fingerprints out of the shared schedule: shifts.team.<site>[].pinHash
create or replace function public.strip_pins(d jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(d -> 'team') = 'object' then jsonb_set(d, '{team}', coalesce((
    select jsonb_object_agg(s.key, case when jsonb_typeof(s.value) = 'array' then (
      select coalesce(jsonb_agg(case when jsonb_typeof(p) = 'object' then p - 'pinHash' else p end order by o), '[]'::jsonb)
      from jsonb_array_elements(s.value) with ordinality as e(p, o)) else s.value end)
    from jsonb_each(d -> 'team') s), '{}'::jsonb)) else d end $$;

-- move the existing fingerprints in once (kept as legacy until each is used)
insert into public.desk_pins (site, person_id, pin_hash, legacy)
select s.key, p ->> 'id', p ->> 'pinHash', true
from public.app_docs d, jsonb_each(case when jsonb_typeof(d.data -> 'team') = 'object' then d.data -> 'team' else '{}'::jsonb end) s,
     jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) p
where d.key = 'shifts' and jsonb_typeof(p) = 'object' and p ->> 'pinHash' ~ '^[0-9a-f]{64}$' and coalesce(p ->> 'id', '') <> ''
on conflict (site, person_id) do nothing;
update public.app_docs set data = public.strip_pins(data), version = version + 1, updated_at = now()
where key = 'shifts' and data::text like '%"pinHash"%';

-- ---------- 2. employee file notes ----------
create or replace function public.private_doc(k text) returns boolean language sql immutable as $$
  select k in ('pay','trips','writeoffs','costs','safe','staffnotes') $$;

create or replace function public.notes_split(d jsonb, staff boolean) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(d) = 'array' then coalesce((
    select jsonb_agg(x order by o) from jsonb_array_elements(d) with ordinality as e(x, o)
    where (jsonb_typeof(x) = 'object' and x ->> 'kind' = 'staff') = staff), '[]'::jsonb)
  else case when staff then '[]'::jsonb else d end end $$;

do $$
declare moved jsonb;
begin
  select public.notes_split(data, true) into moved from public.app_docs where key = 'notes';
  if moved is not null and jsonb_array_length(moved) > 0 then
    insert into public.app_docs (key, data, version, updated_by) values ('staffnotes', moved, 1, 'system')
    on conflict (key) do update set data = (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select x from jsonb_array_elements(case when jsonb_typeof(public.app_docs.data) = 'array' then public.app_docs.data else '[]'::jsonb end) x
        union all
        select m from jsonb_array_elements(moved) m
        where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(public.app_docs.data) = 'array' then public.app_docs.data else '[]'::jsonb end) y where y ->> 'id' = m ->> 'id')) z),
      version = public.app_docs.version + 1, updated_at = now();
    update public.app_docs set data = public.notes_split(data, false), version = version + 1, updated_at = now() where key = 'notes';
  end if;
end $$;

-- ---------- 3. Team voice: no "who saved" stamp ----------
update public.app_docs set updated_by = 'team' where key = 'voice' and updated_by is distinct from 'team';

-- ---------- save_doc with all of the above ----------
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

select (select count(*) from public.desk_pins) as pins_moved,
       (select count(*) from public.app_docs where key = 'shifts' and data::text like '%"pinHash"%') as fingerprints_left,
       (select coalesce(jsonb_array_length(data), 0) from public.app_docs where key = 'staffnotes') as employee_notes_private;
