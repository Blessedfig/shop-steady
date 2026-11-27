-- Tax-year books for Downtown Stube (Supabase project "shop-steady"). OWNER ONLY.
-- Run after shopify.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
-- It does not change save_doc or any shared area, so it can run before or after the other SQL files.
--
--   books_years      : one row per tax year: beginning/ending inventory, sales typed in or imported for months
--                      before the Shopify sync started, how each purchase counts (owner's changes), tax rate guess.
--   books_assets     : equipment, fixtures, computers, vehicles and building work, depreciated over years.
--   books_inventory  : what the stock was worth at cost, taken automatically at the end of every month
--                      (Dec 31 is the one the tax return uses) or by the owner any time.
--   books_sales_month: Shopify sales per month, from the synced sales lines, with the cost of what sold.
-- Only the owner can read or change any of these. Store managers and staff never receive them.
-- Everything here is an estimate to hand to the accountant, not tax advice.

create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_member() and public.my_role() = 'owner' $$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create table if not exists public.books_years (
  year        int primary key check (year between 2000 and 2100),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default lower(coalesce(auth.jwt() ->> 'email',''))
);
create table if not exists public.books_assets (
  id           uuid primary key default gen_random_uuid(),
  site         text,
  name         text not null check (length(name) between 1 and 160),
  vendor       text,
  bought       date,
  in_service   date not null,
  cost         numeric(12,2) not null check (cost >= 0),
  business_pct numeric(5,2) not null default 100 check (business_pct between 0 and 100),
  class        text not null check (class in ('computer','furniture','vehicle','improvement','building','software','land','systems')),
  method       text not null check (method in ('deminimis','s179','bonus','macrs')),
  exp_id       text,                 -- the expense it came from, if it was logged in Expenses first
  sold_on      date,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   text not null default lower(coalesce(auth.jwt() ->> 'email',''))
);
create table if not exists public.books_inventory (
  id          bigint generated always as identity primary key,
  as_of       date not null,
  kind        text not null default 'auto' check (kind in ('auto','owner','count')),
  units       int not null default 0,
  value_cost  numeric(14,2) not null default 0,
  no_cost     int not null default 0,       -- items in stock with no cost in Shopify (counted as $0)
  note        text,
  taken_at    timestamptz not null default now()
);
create index if not exists books_inventory_as_of on public.books_inventory (as_of);

alter table public.books_years enable row level security;
alter table public.books_assets enable row level security;
alter table public.books_inventory enable row level security;
revoke all on public.books_years, public.books_assets, public.books_inventory from anon;
grant select, insert, update, delete on public.books_years, public.books_assets to authenticated;
grant select, insert, delete on public.books_inventory to authenticated;

drop policy if exists "owner books years" on public.books_years;
create policy "owner books years" on public.books_years for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner books assets" on public.books_assets;
create policy "owner books assets" on public.books_assets for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner books inventory" on public.books_inventory;
create policy "owner books inventory" on public.books_inventory for all to authenticated using (public.is_owner()) with check (public.is_owner() and kind in ('owner','count'));

-- Stock value at cost right now, from the Shopify copy (on hand, so items sold but not picked up still count).
create or replace function public.books_stock_value() returns table(units int, value_cost numeric, no_cost int)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(v.on_hand, 0)), 0)::int,
         round(coalesce(sum(greatest(v.on_hand, 0) * coalesce(c.cost, 0)), 0), 2),
         (count(*) filter (where v.on_hand > 0 and (c.cost is null or c.cost = 0)))::int
  from public.shopify_variants v left join public.shopify_costs c on c.inventory_item_id = v.inventory_item_id
  where coalesce(v.tracked, true) $$;
revoke all on function public.books_stock_value() from public, anon, authenticated;

-- The owner taps "Record stock value now".
create or replace function public.books_snapshot(p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_owner() then raise exception 'owner-only'; end if;
  select * into r from public.books_stock_value();
  insert into public.books_inventory (as_of, kind, units, value_cost, no_cost, note)
    values ((now() at time zone 'America/Chicago')::date, 'owner', r.units, r.value_cost, r.no_cost, left(p_note, 200));
  return jsonb_build_object('units', r.units, 'value_cost', r.value_cost, 'no_cost', r.no_cost);
end $$;
revoke all on function public.books_snapshot(text) from public, anon;
grant execute on function public.books_snapshot(text) to authenticated;

-- The timer: last day of every month, late evening store time. Nobody has to remember Dec 31.
create or replace function public.books_month_end() returns void
language plpgsql security definer set search_path = public as $$
declare r record; d date := ((now() at time zone 'America/Chicago') - interval '2 hours')::date;
begin
  if not exists (select 1 from public.shopify_variants) then return; end if;
  select * into r from public.books_stock_value();
  insert into public.books_inventory (as_of, kind, units, value_cost, no_cost, note)
    values (d, 'auto', r.units, r.value_cost, r.no_cost, 'Month-end value from Shopify (on hand x cost)');
end $$;
revoke all on function public.books_month_end() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'books-month-end';
-- 05:50 UTC on the 1st = 11:50 PM on the last day in winter (CST), 12:50 AM in summer (CDT). Dated the last day either way.
select cron.schedule('books-month-end', '50 5 1 * *', 'select public.books_month_end()');

-- Shopify sales per month for one year, with what the sold items cost (today's Shopify cost; lines with no cost
-- are counted separately). Owner only.
create or replace function public.books_sales_year(p_year int) returns table(month text, orders int, units int, gross numeric, net numeric, cost numeric, net_with_cost numeric, lines_no_cost int, first_day date, last_day date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'owner-only'; end if;
  return query
  select to_char(l.day, 'YYYY-MM'), count(distinct l.order_id)::int, coalesce(sum(l.qty), 0)::int,
         round(coalesce(sum(l.gross), 0), 2), round(coalesce(sum(l.net), 0), 2),
         round(coalesce(sum(l.qty * c.cost) filter (where c.cost > 0), 0), 2),
         round(coalesce(sum(l.net) filter (where c.cost > 0), 0), 2),
         (count(*) filter (where l.net <> 0 and coalesce(c.cost, 0) = 0))::int,
         min(l.day), max(l.day)
  from public.shopify_order_lines l
  left join public.shopify_variants v on v.variant_id = l.variant_id
  left join public.shopify_costs c on c.inventory_item_id = v.inventory_item_id
  where not l.cancelled and l.day >= make_date(p_year, 1, 1) and l.day < make_date(p_year + 1, 1, 1)
  group by 1 order by 1;
end $$;
revoke all on function public.books_sales_year(int) from public, anon;
grant execute on function public.books_sales_year(int) to authenticated;

select public.is_owner() as you_are_owner, (select count(*) from cron.job where jobname = 'books-month-end') as month_end_timer;
