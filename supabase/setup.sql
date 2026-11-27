-- Owner Desk database setup for Supabase (generic version of the Steady Shift desk).
-- Paste this whole file into Supabase > SQL Editor > New query, change the emails at the bottom, and press Run.
-- Running it again is safe.
--
--   desk_members : the email addresses allowed into the desk and app. Nobody can read it from the web.
--   desk_items   : one flexible table for leads, next steps, notes, requests, feedback and more (kind + jsonb data).
--                  Only signed-in people on desk_members can read or change rows.
-- Visitors who are not signed in, or signed in with an email not on the list, see nothing (Row Level Security).

create table if not exists public.desk_members (
  email text primary key check (email = lower(email))
);
alter table public.desk_members enable row level security;
revoke all on public.desk_members from anon, authenticated;

create or replace function public.is_desk_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.desk_members where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_desk_member() from public, anon;
grant execute on function public.is_desk_member() to authenticated;

create table if not exists public.desk_items (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text default lower(auth.jwt() ->> 'email')
);
-- Add kinds as the store grows. Bookstore ideas: event, special_order, buyback, consignor, supplier.
alter table public.desk_items drop constraint if exists desk_items_kind_check;
alter table public.desk_items add constraint desk_items_kind_check
  check (kind in ('lead', 'milestone', 'note', 'request', 'feedback', 'summary', 'answer', 'event', 'special_order', 'supplier'));
alter table public.desk_items enable row level security;
revoke all on public.desk_items from anon;
grant select, insert, update, delete on public.desk_items to authenticated;

-- Private rows: data.only = '<email>' is visible to that one member and nobody else.
create or replace function public.desk_can_see(d jsonb)
returns boolean language sql stable as $$
  select public.is_desk_member()
     and (d ->> 'only' is null or d ->> 'only' = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.desk_can_see(jsonb) from public, anon;
grant execute on function public.desk_can_see(jsonb) to authenticated;

drop policy if exists "desk members can read"   on public.desk_items;
drop policy if exists "desk members can add"    on public.desk_items;
drop policy if exists "desk members can change" on public.desk_items;
drop policy if exists "desk members can remove" on public.desk_items;
create policy "desk members can read"   on public.desk_items for select to authenticated using (public.desk_can_see(data));
create policy "desk members can add"    on public.desk_items for insert to authenticated with check (public.desk_can_see(data));
create policy "desk members can change" on public.desk_items for update to authenticated using (public.desk_can_see(data)) with check (public.desk_can_see(data));
create policy "desk members can remove" on public.desk_items for delete to authenticated using (public.desk_can_see(data));

-- Who may sign in. Replace with real lowercase addresses, then Run. Add people later with one more line.
-- If you turn on trial codes (trials.sql), add people here FIRST, then invite them, or the sign-up hook blocks them.
insert into public.desk_members (email) values
  ('owner@example.com'),
  ('manager@example.com')
on conflict do nothing;
