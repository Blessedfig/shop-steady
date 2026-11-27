-- Curated online store for Downtown Stube (Supabase project "shop-steady").
-- Run after shopify.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
--
-- What it does: every product in Shopify stays available to the register (POS), but the Online Store channel only
-- shows a product when it passes the owner's rules: active, stock tracked, enough on hand that the last copy stays
-- on the shelf, a price, a photo, an ISBN or barcode for books, and not a no-ship kind (food, candy, plants,
-- classes, gift cards, 18+). The shopify-sync function compares every product to the rules after each product
-- export and switches it on or off for the Online Store. Nothing changes until the owner turns the rules on; the
-- owner chooses between "Apply when I tap" and "Run on its own".
--
-- Two Shopify tags override the rules for a single product (they show in Shopify too):
--   online      : show it whenever at least 1 is available, even without a photo or ISBN.
--   not-online  : never show it online.
-- Undo on a change adds the matching tag, so the next run does not switch it back.
--
-- The Shopify connection needs the read_publications and write_publications permissions. Connect again once
-- (Shopify page > Reconnect) after deploying the new shopify-auth function.

alter table public.shopify_variants add column if not exists tags text not null default '';
alter table public.shopify_variants add column if not exists category text not null default '';
alter table public.shopify_variants add column if not exists has_photo boolean;
alter table public.shopify_variants add column if not exists online boolean;   -- null: not known yet
alter table public.shopify_conn add column if not exists online_pub_id text;

create table if not exists public.online_rules (
  id              int primary key default 1 check (id = 1),
  enabled         boolean not null default false,  -- false: the app only shows what it would do
  auto            boolean not null default false,  -- true: each run applies the changes by itself
  min_available   int not null default 2 check (min_available >= 1),
  need_photo      boolean not null default true,
  need_isbn       boolean not null default true,
  skip_types      text[] not null default '{Food & Beverage,Plant,Class,Herbal Ice Cream,Gift Card}',
  skip_categories text[] not null default '{Food,Services,Mature,Gift Cards}',
  skip_tags       text[] not null default '{Menu,Side Dish,Main Dish,Snack,Herbs,Herbal,Catering,Ice Cream,Forage,Classes,Classes - Hands On,18+}',
  skip_vendors    text[] not null default '{Cow Crack Wholesale,Global Bite Co,Grandpa Joe''s Candy Shop,Top Land Trading,Pacific Trading}',
  per_run         int not null default 300 check (per_run between 1 and 2000),
  updated_by      text,
  updated_at      timestamptz not null default now()
);
insert into public.online_rules (id) values (1) on conflict do nothing;

create table if not exists public.online_changes (
  id          bigint generated always as identity primary key,
  product_id  bigint not null,
  title       text,
  action      text not null check (action in ('show','hide')),
  reason      text,
  status      text not null check (status in ('applied','failed','undone')),
  error       text,
  by_whom     text,
  at          timestamptz not null default now()
);
create index if not exists online_changes_at on public.online_changes (at desc);

alter table public.online_rules enable row level security;
alter table public.online_changes enable row level security;
revoke all on public.online_rules, public.online_changes from anon;
revoke insert, update, delete on public.online_rules, public.online_changes from authenticated;
grant select on public.online_rules, public.online_changes to authenticated;
drop policy if exists "managers read online rules" on public.online_rules;
create policy "managers read online rules" on public.online_rules for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers read online changes" on public.online_changes;
create policy "managers read online changes" on public.online_changes for select to authenticated using (public.role_rank(public.my_role()) >= 3);

-- Is this text one of the comma-separated tags? (case-insensitive)
create or replace function public.has_tag(tags text, t text) returns boolean
language sql immutable as $$
  select exists (select 1 from unnest(string_to_array(coalesce(tags, ''), ',')) x where lower(trim(x)) = lower(trim(t))) $$;

-- One row per product: what the rules want, why, and what Shopify shows now.
-- Called by the shopify-sync function (service key) and, through online_review, by managers.
create or replace function public.online_plan_rows()
returns table (product_id bigint, title text, vendor text, available int, online boolean, want boolean, reason text)
language sql stable security definer set search_path = public as $$
  with r as (select * from public.online_rules where id = 1),
  p as (
    select v.product_id, max(v.product_title) as title, max(v.vendor) as vendor, max(v.product_type) as ptype,
           max(v.category) as category, max(v.tags) as tags, max(v.status) as status,
           bool_and(coalesce(v.tracked, false)) as tracked, sum(greatest(coalesce(v.available, 0), 0))::int as available,
           min(v.price) as price, bool_or(coalesce(v.has_photo, false)) as has_photo,
           bool_or(coalesce(nullif(trim(v.barcode), ''), '') <> '') as has_code, bool_or(v.online) as online
    from public.shopify_variants v where v.product_id is not null group by v.product_id),
  j as (
    select p.*, case
      when public.has_tag(p.tags, 'not-online') then 'Tagged not-online'
      when upper(p.status) <> 'ACTIVE' then 'Not active'
      when public.has_tag(p.tags, 'online') then case when p.available >= 1 then null else 'None available' end
      when p.ptype = any(r.skip_types) or p.vendor = any(r.skip_vendors)
        or exists (select 1 from unnest(r.skip_categories) c where p.category ilike c || '%')
        or exists (select 1 from unnest(r.skip_tags) t where public.has_tag(p.tags, t)) then 'Does not ship (food, plants, classes, 18+)'
      when not p.tracked then 'Stock not tracked'
      when p.available < r.min_available then 'Fewer than ' || r.min_available || ' available'
      when coalesce(p.price, 0) <= 0 then 'No price'
      when r.need_photo and not p.has_photo then 'No photo'
      when r.need_isbn and not p.has_code and (p.ptype ilike 'book%' or p.category ilike 'Media%') then 'Book with no ISBN'
      else null end as why
    from p cross join r)
  select j.product_id, j.title, j.vendor, j.available, j.online, j.why is null, coalesce(j.why, 'Passes every rule') from j $$;
revoke all on function public.online_plan_rows() from public, anon, authenticated;
grant execute on function public.online_plan_rows() to service_role;

-- Summary for the app (manager+): counts, the reasons, and samples of what would change.
create or replace function public.online_review() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if public.role_rank(public.my_role()) < 3 then return null; end if;
  with x as (select * from public.online_plan_rows())
  select jsonb_build_object(
    'rules', (select to_jsonb(r) from public.online_rules r where id = 1),
    'connected_channel', (select online_pub_id is not null from public.shopify_conn where id = 1),
    'known', (select count(*) from x where online is not null),
    'products', (select count(*) from x),
    'want', (select count(*) from x where want),
    'online', (select count(*) from x where online),
    'to_show', (select count(*) from x where want and online is false),
    'to_hide', (select count(*) from x where not want and online is true),
    'reasons', (select coalesce(jsonb_object_agg(reason, n), '{}') from (select reason, count(*) n from x where not want and online is true group by reason) q),
    'show_sample', (select coalesce(jsonb_agg(s), '[]') from (select product_id, title, vendor, available from x where want and online is false order by title limit 40) s),
    'hide_sample', (select coalesce(jsonb_agg(s), '[]') from (select product_id, title, vendor, available, reason from x where not want and online is true order by reason, title limit 40) s)
  ) into out;
  return out;
end $$;
revoke all on function public.online_review() from public, anon;
grant execute on function public.online_review() to authenticated;

-- Owner saves the rules.
create or replace function public.online_save_rules(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'owner-only'; end if;
  update public.online_rules set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    auto = coalesce((p->>'auto')::boolean, auto),
    min_available = greatest(1, coalesce((p->>'min_available')::int, min_available)),
    need_photo = coalesce((p->>'need_photo')::boolean, need_photo),
    need_isbn = coalesce((p->>'need_isbn')::boolean, need_isbn),
    skip_types = coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p->'skip_types') x where trim(x) <> ''), case when p ? 'skip_types' then '{}' else skip_types end),
    skip_categories = coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p->'skip_categories') x where trim(x) <> ''), case when p ? 'skip_categories' then '{}' else skip_categories end),
    skip_tags = coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p->'skip_tags') x where trim(x) <> ''), case when p ? 'skip_tags' then '{}' else skip_tags end),
    skip_vendors = coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p->'skip_vendors') x where trim(x) <> ''), case when p ? 'skip_vendors' then '{}' else skip_vendors end),
    updated_by = lower(coalesce(auth.jwt() ->> 'email', '')), updated_at = now()
  where id = 1;
end $$;
revoke all on function public.online_save_rules(jsonb) from public, anon;
grant execute on function public.online_save_rules(jsonb) to authenticated;
