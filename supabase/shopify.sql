-- Live Shopify sync for Downtown Stube (Supabase project "shop-steady").
-- Run after sync.sql and private-areas.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
--
-- How it fits together:
--   shopify_conn        : the store's connection (shop domain, the access token Shopify gives at install, a random
--                         key for the timer). Nobody can read this table from the web, not even the owner; only the
--                         Edge Functions (service key) can. The token never reaches a browser.
--   shopify_variants    : every product variant with its stock (available / on hand), price, vendor. All members read.
--   shopify_costs       : what each item costs the store. Store manager and owner only.
--   shopify_order_lines : sales lines from the last 60 days (Shopify's limit without extra approval). Manager+ only.
--   shopify_sales_day   : view, sales per day (orders, units, net, cash). Manager+ only.
--   shopify_changes     : changes waiting to go to Shopify (cost, vendor, stock). Nothing is sent until the owner
--                         applies it in the app.
--   shopify_sync_log    : what each sync did.
-- A timer (pg_cron) asks the shopify-sync function to run every 15 minutes.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.shopify_conn (
  id           int primary key default 1 check (id = 1),
  shop         text,
  access_token text,
  scope        text,
  installed_at timestamptz,
  installed_by text,
  oauth_state  text,
  state_at     timestamptz,
  cron_key     text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  bulk_id      text,
  bulk_started timestamptz,
  full_at      timestamptz,
  orders_at    timestamptz
);
insert into public.shopify_conn (id) values (1) on conflict do nothing;
alter table public.shopify_conn enable row level security;
revoke all on public.shopify_conn from anon, authenticated;

create table if not exists public.shopify_variants (
  variant_id        bigint primary key,
  product_id        bigint,
  inventory_item_id bigint,
  product_title     text,
  variant_title     text,
  sku               text,
  barcode           text,
  vendor            text,
  product_type      text,
  status            text,
  price             numeric,
  tracked           boolean,
  available         int,
  on_hand           int,
  updated_at        timestamptz not null default now()
);
create index if not exists shopify_variants_sku on public.shopify_variants (sku);
create index if not exists shopify_variants_barcode on public.shopify_variants (barcode);
create table if not exists public.shopify_costs (
  inventory_item_id bigint primary key,
  cost              numeric,
  updated_at        timestamptz not null default now()
);
create table if not exists public.shopify_order_lines (
  line_id    bigint primary key,
  order_id   bigint not null,
  order_name text,
  day        date not null,             -- the store's local day
  at         timestamptz not null,
  variant_id bigint,
  title      text,
  qty        int not null default 0,
  gross      numeric not null default 0, -- before discounts
  net        numeric not null default 0, -- after discounts, before tax
  source     text,                       -- pos, web, ...
  cash       boolean not null default false,
  cancelled  boolean not null default false
);
create index if not exists shopify_order_lines_day on public.shopify_order_lines (day);
create index if not exists shopify_order_lines_variant on public.shopify_order_lines (variant_id);
create table if not exists public.shopify_changes (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('cost','vendor','stock','barcode','price','type','tracked')),
  variant_id  bigint not null,
  old_value   text,
  new_value   text not null,
  note        text,
  status      text not null default 'pending' check (status in ('pending','applied','failed','dropped')),
  error       text,
  created_by  text not null default lower(coalesce(auth.jwt() ->> 'email','')),
  created_at  timestamptz not null default now(),
  applied_by  text,
  applied_at  timestamptz
);
-- added for the product fixer (product-fix.sql): more kinds, and which fix or automatic rule a change came from
alter table public.shopify_changes drop constraint if exists shopify_changes_kind_check;
alter table public.shopify_changes add constraint shopify_changes_kind_check check (kind in ('cost','vendor','stock','barcode','price','type','tracked'));
alter table public.shopify_changes add column if not exists auto_rule text;
alter table public.shopify_changes add column if not exists fix_id bigint;
alter table public.shopify_variants add column if not exists tags text;
create table if not exists public.shopify_sync_log (
  id    bigint generated always as identity primary key,
  at    timestamptz not null default now(),
  kind  text not null,
  ok    boolean not null,
  note  text
);

alter table public.shopify_variants enable row level security;
alter table public.shopify_costs enable row level security;
alter table public.shopify_order_lines enable row level security;
alter table public.shopify_changes enable row level security;
alter table public.shopify_sync_log enable row level security;
revoke all on public.shopify_variants, public.shopify_costs, public.shopify_order_lines, public.shopify_changes, public.shopify_sync_log from anon;
revoke insert, update, delete on public.shopify_variants, public.shopify_costs, public.shopify_order_lines, public.shopify_sync_log from authenticated;
grant select on public.shopify_variants, public.shopify_costs, public.shopify_order_lines, public.shopify_changes, public.shopify_sync_log to authenticated;
-- people in the app may only write these columns: they propose (kind, item, values, note) and drop (status).
-- auto_rule and fix_id are set only by the server, so nobody can make their own change look approved.
revoke insert, update on public.shopify_changes from authenticated;
grant insert (kind, variant_id, old_value, new_value, note) on public.shopify_changes to authenticated;
grant update (status) on public.shopify_changes to authenticated;

drop policy if exists "members read variants" on public.shopify_variants;
create policy "members read variants" on public.shopify_variants for select to authenticated using (public.is_desk_member());
drop policy if exists "managers read costs" on public.shopify_costs;
create policy "managers read costs" on public.shopify_costs for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers read sales" on public.shopify_order_lines;
create policy "managers read sales" on public.shopify_order_lines for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers read sync log" on public.shopify_sync_log;
create policy "managers read sync log" on public.shopify_sync_log for select to authenticated using (public.role_rank(public.my_role()) >= 3);
-- changes: managers propose (pending only) and can drop their own pending ones; only the owner's apply (in the
-- shopify-sync function) marks them applied.
drop policy if exists "managers read changes" on public.shopify_changes;
create policy "managers read changes" on public.shopify_changes for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers propose changes" on public.shopify_changes;
create policy "managers propose changes" on public.shopify_changes for insert to authenticated
  with check (public.role_rank(public.my_role()) >= 3 and status = 'pending' and applied_at is null and auto_rule is null and fix_id is null
              and kind in ('cost','vendor','price','barcode'));
drop policy if exists "managers drop pending changes" on public.shopify_changes;
create policy "managers drop pending changes" on public.shopify_changes for update to authenticated
  using (public.role_rank(public.my_role()) >= 3 and status = 'pending') with check (status in ('pending','dropped') and applied_at is null);

create or replace view public.shopify_sales_day with (security_invoker = true) as
  select day, count(distinct order_id) as orders, sum(qty) as units, round(sum(net), 2) as net,
         round(sum(case when cash then net else 0 end), 2) as cash_net
  from public.shopify_order_lines where not cancelled group by day;
grant select on public.shopify_sales_day to authenticated;

-- Connection status for the app (managers and owner): never returns the token or keys.
create or replace function public.shopify_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.role_rank(public.my_role()) >= 3 then jsonb_build_object(
    'shop', shop, 'connected', access_token is not null, 'scope', scope, 'installed_at', installed_at,
    'full_at', full_at, 'orders_at', orders_at, 'bulk_running', bulk_id is not null,
    'variants', (select count(*) from public.shopify_variants),
    'last', (select jsonb_build_object('at', at, 'ok', ok, 'note', note) from public.shopify_sync_log order by id desc limit 1))
  else null end from public.shopify_conn where id = 1 $$;
revoke all on function public.shopify_status() from public, anon;
grant execute on function public.shopify_status() to authenticated;

-- The 15-minute timer. It sends the random cron_key (kept in shopify_conn, which no one can read from the web).
create or replace function public.shopify_tick() returns void
language plpgsql security definer set search_path = public as $$
declare k text; s text;
begin
  select cron_key, access_token into k, s from public.shopify_conn where id = 1;
  if s is null then return; end if;
  perform net.http_post(
    url := 'https://rtgpxuiwcdfdpnepfnoy.supabase.co/functions/v1/shopify-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-key', k),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke all on function public.shopify_tick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'shopify-sync';
select cron.schedule('shopify-sync', '*/15 * * * *', 'select public.shopify_tick()');

-- Insights (read with the person's own rights, so sales stay manager+ only)
create or replace view public.shopify_sellers_30 with (security_invoker = true) as
  select l.variant_id, max(l.title) as title, sum(l.qty) as qty30, round(sum(l.net), 2) as net30,
         max(v.available) as available, max(v.vendor) as vendor, max(v.barcode) as barcode, max(v.sku) as sku
  from public.shopify_order_lines l left join public.shopify_variants v on v.variant_id = l.variant_id
  where l.day >= current_date - 30 and not l.cancelled and l.variant_id is not null
  group by l.variant_id;
grant select on public.shopify_sellers_30 to authenticated;

create or replace function public.shopify_stock_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.role_rank(public.my_role()) >= 3 then (
    select jsonb_build_object(
      'variants', count(*),
      'in_stock', count(*) filter (where v.available > 0),
      'units', coalesce(sum(greatest(v.available, 0)), 0),
      'value_cost', round(coalesce(sum(greatest(v.available, 0) * c.cost), 0), 2),
      'value_retail', round(coalesce(sum(greatest(v.available, 0) * v.price), 0), 2),
      'no_cost', count(*) filter (where v.available > 0 and (c.cost is null or c.cost = 0)),
      'negative', count(*) filter (where v.available < 0),
      'unsold_60', count(*) filter (where v.available > 0 and not exists (select 1 from public.shopify_order_lines l where l.variant_id = v.variant_id and l.day >= current_date - 60)),
      'unsold_60_cost', round(coalesce(sum(greatest(v.available, 0) * c.cost) filter (where not exists (select 1 from public.shopify_order_lines l where l.variant_id = v.variant_id and l.day >= current_date - 60)), 0), 2))
    from public.shopify_variants v left join public.shopify_costs c on c.inventory_item_id = v.inventory_item_id)
  else null end $$;
revoke all on function public.shopify_stock_summary() from public, anon;
grant execute on function public.shopify_stock_summary() to authenticated;
