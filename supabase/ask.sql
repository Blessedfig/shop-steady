-- "Ask" chat assistant for Downtown Stube (Supabase project "shop-steady"): a daily question limit per person.
-- Run after sync.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
-- The limit is set by the owner in the app (on the Ask screen), kept in the shared 'setup' area as
-- setup.ask.perDay (default 30). The owner gets at least 100 a day. Questions and answers are not stored,
-- only how many each person asked per day.

create table if not exists public.ask_usage (
  email text not null,
  day   date not null,
  n     int  not null default 0,
  primary key (email, day)
);
alter table public.ask_usage enable row level security;
revoke all on public.ask_usage from anon, authenticated;

-- counts one question for the signed-in person (store's local day) and says whether it is allowed
create or replace function public.ask_take() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', '')); d date := (now() at time zone 'America/Chicago')::date;
        lim int; used int;
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  select coalesce((data -> 'ask' ->> 'perDay')::int, 30) into lim from public.app_docs where key = 'setup';
  lim := greatest(0, least(coalesce(lim, 30), 500));
  if public.my_role() = 'owner' then lim := greatest(lim, 100); end if;
  select n into used from public.ask_usage where email = me and day = d;
  if coalesce(used, 0) >= lim then return jsonb_build_object('ok', false, 'limit', lim, 'used', coalesce(used, 0)); end if;
  insert into public.ask_usage as u (email, day, n) values (me, d, 1)
  on conflict (email, day) do update set n = u.n + 1 returning n into used;
  return jsonb_build_object('ok', true, 'limit', lim, 'used', used);
end $$;
revoke all on function public.ask_take() from public, anon;
grant execute on function public.ask_take() to authenticated;
