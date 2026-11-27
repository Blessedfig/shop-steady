-- Vendors and title catalog for Downtown Stube (Supabase project "shop-steady").
-- Run after setup.sql and sync.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
--
--   vendors           : who the store buys from (publishers, distributors, Faire, Amazon Business...), terms,
--                       lead time, default discount and where to check stock. NEVER account numbers or passwords.
--   vendor_discounts  : discount off list price per product class (trade, manga, comics...) and returnable or not.
--   catalog_titles    : every title or product the store could order, one row per ISBN-13 (books) or "sku:..." key.
--   vendor_offers     : which vendor offers which title, at what cost, and the last known stock at that vendor.
--   catalog_imports   : a log of each file imported (ONIX feed, CSV title list, stock feed, Faire export).
--
-- Who sees what:
--   everyone signed in : search titles, see stock at each vendor and the special-order price (vendor_directory view).
--   manager and up     : also see cost, discount, margin and vendor terms (the vendors table itself), like the app's
--                        other cost areas (private-areas.sql); edit vendors and discounts, import catalogs.
--   owner              : copy the app's existing vendor list into the vendors table (once).

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- 1. Vendors
create table if not exists public.vendors (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (length(name) between 1 and 80),
  kind              text not null default 'distributor'
                    check (kind in ('publisher','distributor','wholesaler','marketplace','audiobook','general','consignor','other')),
  status            text not null default 'Applying'
                    check (status in ('Active','Applying','Approved, not ordering yet','Paused','Not using')),
  covers            text check (length(covers) <= 400),
  how_to_order      text check (length(how_to_order) <= 200),
  website           text check (length(website) <= 200),
  stock_check_url   text check (length(stock_check_url) <= 300), -- link to search the vendor's site; {isbn} or {q} is filled in
  contact           text check (length(contact) <= 80),
  email             text check (length(email) <= 120),
  phone             text check (length(phone) <= 40),
  terms             text check (length(terms) <= 400),
  default_discount  numeric(5,4) check (default_discount >= 0 and default_discount < 0.95), -- 0.46 = 46% off list
  returnable        boolean not null default true,
  free_freight_over numeric(10,2),
  min_order         text check (length(min_order) <= 60),
  lead_days         int check (lead_days between 0 and 365),
  notes             text check (length(notes) <= 1000),
  legacy_id         text, -- the id this vendor had in the app's shared data before this table existed
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text default lower(auth.jwt() ->> 'email')
);
comment on table public.vendors is 'Vendor directory. Do not store account numbers, passwords or bank details here.';

create table if not exists public.vendor_discounts (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  product_class text not null default 'any' check (length(product_class) <= 40), -- any, trade, mass market, manga, comics, audio, gift...
  returnable    boolean not null default true,
  min_qty       int not null default 1 check (min_qty >= 1),
  discount      numeric(5,4) not null check (discount >= 0 and discount < 0.95),
  note          text check (length(note) <= 200),
  unique (vendor_id, product_class, returnable, min_qty)
);

-- 2. Titles and products
create table if not exists public.catalog_titles (
  item_key      text primary key check (item_key ~ '^(97[89][0-9]{10}|sku:.{1,80})$'),
  isbn13        text generated always as (case when item_key ~ '^97[89]' then item_key end) stored,
  upc           text check (length(upc) <= 20),
  title         text not null check (length(title) between 1 and 400),
  subtitle      text check (length(subtitle) <= 400),
  contributors  text check (length(contributors) <= 400),
  publisher     text check (length(publisher) <= 160),
  imprint       text check (length(imprint) <= 160),
  series        text check (length(series) <= 200),
  format        text check (length(format) <= 60),
  product_class text check (length(product_class) <= 40),
  pub_date      date,
  list_price    numeric(10,2),
  currency      text not null default 'USD',
  pages         int,
  subjects      text check (length(subjects) <= 400),
  cover_url     text check (length(cover_url) <= 400),
  description   text check (length(description) <= 4000),
  source        text check (length(source) <= 40),
  updated_at    timestamptz not null default now(),
  search        tsvector generated always as (
                  setweight(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(series,'')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(contributors,'')), 'B') ||
                  setweight(to_tsvector('simple', coalesce(publisher,'') || ' ' || coalesce(imprint,'')), 'C')) stored
);
create index if not exists catalog_titles_search_idx on public.catalog_titles using gin (search);
create index if not exists catalog_titles_title_trgm on public.catalog_titles using gin (title extensions.gin_trgm_ops);
create index if not exists catalog_titles_upc_idx on public.catalog_titles (upc) where upc is not null;

create table if not exists public.catalog_imports (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid references public.vendors(id) on delete set null,
  kind        text not null check (kind in ('onix','csv','stock','faire','manual','openlibrary')),
  file_name   text check (length(file_name) <= 200),
  rows_in     int not null default 0,
  titles_new  int not null default 0,
  offers_set  int not null default 0,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  started_by  text default lower(auth.jwt() ->> 'email')
);

create table if not exists public.vendor_offers (
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  item_key      text not null references public.catalog_titles(item_key) on delete cascade,
  vendor_sku    text check (length(vendor_sku) <= 80),
  list_price    numeric(10,2),        -- the vendor's list price if it differs from the title's
  discount      numeric(5,4) check (discount >= 0 and discount < 0.95), -- overrides the vendor's discount for this title
  unit_cost     numeric(10,2),        -- a set wholesale cost (Faire, Amazon); wins over list price and discount
  returnable    boolean,
  case_qty      int check (case_qty >= 1),
  availability  text not null default 'unknown'
                check (availability in ('in_stock','low','backorder','forthcoming','out_of_print','not_available','unknown')),
  qty_available int,
  checked_at    timestamptz,
  source        text check (length(source) <= 40),
  import_id     uuid references public.catalog_imports(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (vendor_id, item_key)
);
create index if not exists vendor_offers_item_idx on public.vendor_offers (item_key);

-- 3. Row Level Security: reads as described at the top; every change goes through the functions below
--    or, for vendors and discounts, directly by a manager or the owner.
alter table public.vendors enable row level security;
alter table public.vendor_discounts enable row level security;
alter table public.catalog_titles enable row level security;
alter table public.vendor_offers enable row level security;
alter table public.catalog_imports enable row level security;
revoke all on public.vendors, public.vendor_discounts, public.catalog_titles, public.vendor_offers, public.catalog_imports from anon;
revoke insert, update, delete on public.catalog_titles, public.vendor_offers, public.catalog_imports from authenticated;
grant select on public.catalog_titles, public.vendor_offers, public.catalog_imports to authenticated;
grant select, insert, update, delete on public.vendors, public.vendor_discounts to authenticated;

drop policy if exists "members read vendors" on public.vendors;
drop policy if exists "leads read vendors" on public.vendors;
create policy "leads read vendors" on public.vendors for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers change vendors" on public.vendors;
create policy "managers change vendors" on public.vendors for all to authenticated
  using (public.role_rank(public.my_role()) >= 3) with check (public.role_rank(public.my_role()) >= 3);

drop policy if exists "leads read discounts" on public.vendor_discounts;
create policy "leads read discounts" on public.vendor_discounts for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers change discounts" on public.vendor_discounts;
create policy "managers change discounts" on public.vendor_discounts for all to authenticated
  using (public.role_rank(public.my_role()) >= 3) with check (public.role_rank(public.my_role()) >= 3);

drop policy if exists "members read titles" on public.catalog_titles;
create policy "members read titles" on public.catalog_titles for select to authenticated using (public.is_desk_member());
-- Offers hold cost, so staff and leads read them only through search_titles(), which hides cost below manager.
drop policy if exists "leads read offers" on public.vendor_offers;
create policy "leads read offers" on public.vendor_offers for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers read imports" on public.catalog_imports;
create policy "managers read imports" on public.catalog_imports for select to authenticated using (public.role_rank(public.my_role()) >= 3);

-- Discounts and terms are cost information, so staff and leads read vendors only through this view, which leaves them out.
drop view if exists public.vendor_directory;
create view public.vendor_directory as
  select id, name, kind, status, covers, how_to_order, website, stock_check_url, contact, email, phone,
         min_order, lead_days, notes,
         case when public.role_rank(public.my_role()) >= 3 then terms end as terms,
         case when public.role_rank(public.my_role()) >= 3 then default_discount end as default_discount,
         returnable, free_freight_over, updated_at
  from public.vendors where public.is_desk_member();
grant select on public.vendor_directory to authenticated;

-- 4. Cost and price rules
-- Cost of one copy from one vendor: a set unit cost wins; otherwise list price less the best discount that applies
-- (the title's own discount, then the vendor's discount for the product class and quantity, then the vendor default).
create or replace function public.offer_cost(o public.vendor_offers, t public.catalog_titles, v public.vendors, p_qty int default 1)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when o.unit_cost is not null then o.unit_cost
    when coalesce(o.list_price, t.list_price) is null then null
    else round(coalesce(o.list_price, t.list_price) * (1 - coalesce(
      o.discount,
      (select d.discount from public.vendor_discounts d
        where d.vendor_id = v.id and d.min_qty <= greatest(p_qty,1)
          and (d.product_class = 'any' or lower(d.product_class) = lower(coalesce(t.product_class,'')))
          and d.returnable = coalesce(o.returnable, v.returnable)
        order by (d.product_class <> 'any') desc, d.min_qty desc, d.discount desc limit 1),
      v.default_discount, 0)), 2) end $$;
revoke all on function public.offer_cost(public.vendor_offers, public.catalog_titles, public.vendors, int) from public, anon, authenticated;

-- Special-order price: the same rule as the app (people.js): the owner's margin tiers from the shared 'people'
-- data (bigger orders take a smaller margin), at least $3 over cost, rounded up to the next .49 or .99.
create or replace function public.special_order_price(p_cost numeric, p_ship numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare base numeric := coalesce(p_cost,0) + coalesce(p_ship,0); tiers jsonb; t jsonb; m numeric; raw numeric; nice numeric;
begin
  if p_cost is null then return null; end if;
  select data->'margin'->'tiers' into tiers from public.app_docs where key = 'people';
  if tiers is null or jsonb_typeof(tiers) <> 'array' or jsonb_array_length(tiers) = 0 then
    tiers := '[[50,0.45],[200,0.35],[500,0.28],[1000000000,0.22]]'::jsonb; end if;
  for t in select * from jsonb_array_elements(tiers) loop
    m := (t->>1)::numeric; exit when base <= (t->>0)::numeric;
  end loop;
  raw := greatest(base / (1 - m), base + 3);
  nice := floor(raw) + case when raw - floor(raw) <= 0.49 then 0.49 else 0.99 end;
  return jsonb_build_object('price', round(nice,2), 'margin', m, 'profit', round(nice - base, 2));
end $$;
revoke all on function public.special_order_price(numeric, numeric) from public, anon;
grant execute on function public.special_order_price(numeric, numeric) to authenticated;

-- 5. Search: by ISBN/UPC, or words from the title, author, series or publisher.
-- Each result lists every vendor that carries it, best stock first. Cost and margin only for managers and the owner.
drop function if exists public.search_titles(text, int, int);
create or replace function public.search_titles(p_q text, p_limit int default 25, p_qty int default 1)
returns table(item_key text, isbn13 text, title text, subtitle text, contributors text, publisher text, imprint text,
              format text, pub_date date, list_price numeric, cover_url text, offers jsonb, store jsonb)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare q text := trim(coalesce(p_q,'')); digits text := regexp_replace(coalesce(p_q,''), '[^0-9Xx]', '', 'g');
        see_cost boolean := public.role_rank(public.my_role()) >= 3; lim int := least(greatest(coalesce(p_limit,25),1),100);
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if length(q) < 2 then return; end if;
  -- An ISBN-10 typed or scanned? Turn it into ISBN-13.
  if length(digits) = 10 then
    digits := '978' || left(digits, 9);
    digits := digits || ((10 - (select sum(substr(digits,i,1)::int * case when i % 2 = 0 then 3 else 1 end) from generate_series(1,12) i) % 10) % 10)::text;
  end if;
  return query
  with hits as (
    select c.item_key, 2.0::real as rank from public.catalog_titles c
      where length(digits) >= 10 and (c.item_key = digits or c.upc = digits)
    union all
    select c.item_key, (ts_rank(c.search, websearch_to_tsquery('simple', q)) + similarity(c.title, q))::real
      from public.catalog_titles c
      where length(digits) < 10 and (c.search @@ websearch_to_tsquery('simple', q) or c.title % q)
  ), top as (
    select hh.item_key, max(hh.rank) as rank from hits hh group by hh.item_key order by 2 desc limit lim
  )
  select c.item_key, c.isbn13, c.title, c.subtitle, c.contributors, c.publisher, c.imprint, c.format, c.pub_date, c.list_price, c.cover_url,
    coalesce((select jsonb_agg(x.j order by x.ord, x.cost nulls last) from (
      select jsonb_build_object(
          'vendor_id', v.id, 'vendor', v.name, 'status', v.status, 'lead_days', v.lead_days,
          'availability', o.availability, 'qty', o.qty_available, 'checked_at', o.checked_at,
          'returnable', coalesce(o.returnable, v.returnable),
          'check_url', nullif(replace(replace(coalesce(v.stock_check_url,''), '{isbn}', c.item_key), '{q}', c.title), ''),
          'cost', case when see_cost then oc.cost end,
          'margin_at_list', case when see_cost and coalesce(o.list_price, c.list_price) > 0
               then round(1 - oc.cost / coalesce(o.list_price, c.list_price), 3) end,
          'quote', case when see_cost then public.special_order_price(oc.cost)
                        else public.special_order_price(oc.cost) - 'profit' - 'margin' end,
          'over_list', (public.special_order_price(oc.cost)->>'price')::numeric > coalesce(o.list_price, c.list_price)
        ) as j,
        case o.availability when 'in_stock' then 0 when 'low' then 1 when 'unknown' then 2 when 'forthcoming' then 3 when 'backorder' then 4 else 5 end
          + case v.status when 'Active' then 0 else 10 end as ord,
        oc.cost
      from public.vendor_offers o join public.vendors v on v.id = o.vendor_id
      cross join lateral (select public.offer_cost(o, c, v, p_qty) as cost) oc
      where o.item_key = c.item_key) x), '[]'::jsonb),
    case when to_regclass('public.shopify_variants') is not null then public.store_stock(c.item_key) end
  from top join public.catalog_titles c on c.item_key = top.item_key
  order by top.rank desc, c.title;
end $$;
revoke all on function public.search_titles(text, int, int) from public, anon;
grant execute on function public.search_titles(text, int, int) to authenticated;

-- 6. Imports (managers and owners). The app sends rows in batches of up to 1,000.
-- Each row: {item_key or isbn, title, subtitle, contributors, publisher, imprint, series, format, product_class,
--            pub_date, list_price, pages, subjects, cover_url, upc,
--            vendor_sku, discount, unit_cost, vendor_list_price, returnable, case_qty, availability, qty}
-- New facts fill in or replace old ones; a blank value never wipes something already known.
create or replace function public.start_catalog_import(p_vendor uuid, p_kind text, p_file text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid;
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  insert into public.catalog_imports (vendor_id, kind, file_name) values (p_vendor, p_kind, left(p_file,200)) returning id into i;
  return i;
end $$;

create or replace function public.import_catalog_rows(p_import uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare imp public.catalog_imports; r jsonb; k text; n_new int := 0; n_off int := 0; n_in int := 0; ins boolean; now_ts timestamptz := now();
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  select * into imp from public.catalog_imports where id = p_import;
  if imp.id is null then raise exception 'unknown import'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'send up to 1000 rows at a time'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n_in := n_in + 1;
    k := coalesce(nullif(r->>'item_key',''), nullif(regexp_replace(coalesce(r->>'isbn',''), '[^0-9]', '', 'g'),''));
    if k is null or not (k ~ '^97[89][0-9]{10}$' or k ~ '^sku:.{1,80}$') then continue; end if;
    if nullif(r->>'title','') is null and not exists (select 1 from public.catalog_titles where item_key = k) then
      -- stock-only rows (like PRH's daily stock feed) for titles we have never seen: skip them
      continue; end if;
    if nullif(r->>'title','') is not null then
      insert into public.catalog_titles as c (item_key, title, subtitle, contributors, publisher, imprint, series, format, product_class,
          pub_date, list_price, pages, subjects, cover_url, upc, description, source)
      values (k, left(r->>'title',400), left(nullif(r->>'subtitle',''),400), left(nullif(r->>'contributors',''),400),
          left(nullif(r->>'publisher',''),160), left(nullif(r->>'imprint',''),160), left(nullif(r->>'series',''),200),
          left(nullif(r->>'format',''),60), left(nullif(r->>'product_class',''),40),
          case when r->>'pub_date' ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'pub_date')::date end,
          case when r->>'list_price' ~ '^\d+(\.\d+)?$' then (r->>'list_price')::numeric end,
          case when r->>'pages' ~ '^\d{1,5}$' then (r->>'pages')::int end,
          left(nullif(r->>'subjects',''),400), left(nullif(r->>'cover_url',''),400), left(nullif(r->>'upc',''),20),
          left(nullif(r->>'description',''),4000), imp.kind)
      on conflict (item_key) do update set
          title = excluded.title, subtitle = coalesce(excluded.subtitle, c.subtitle), contributors = coalesce(excluded.contributors, c.contributors),
          publisher = coalesce(excluded.publisher, c.publisher), imprint = coalesce(excluded.imprint, c.imprint),
          series = coalesce(excluded.series, c.series), format = coalesce(excluded.format, c.format),
          product_class = coalesce(excluded.product_class, c.product_class), pub_date = coalesce(excluded.pub_date, c.pub_date),
          list_price = coalesce(excluded.list_price, c.list_price), pages = coalesce(excluded.pages, c.pages),
          subjects = coalesce(excluded.subjects, c.subjects), cover_url = coalesce(excluded.cover_url, c.cover_url),
          upc = coalesce(excluded.upc, c.upc), description = coalesce(excluded.description, c.description), updated_at = now_ts
      returning (xmax = 0) into ins;
      if ins then n_new := n_new + 1; end if;
    end if;
    if imp.vendor_id is not null then
      insert into public.vendor_offers as o (vendor_id, item_key, vendor_sku, list_price, discount, unit_cost, returnable, case_qty,
          availability, qty_available, checked_at, source, import_id, updated_at)
      values (imp.vendor_id, k, left(nullif(r->>'vendor_sku',''),80),
          case when r->>'vendor_list_price' ~ '^\d+(\.\d+)?$' then (r->>'vendor_list_price')::numeric end,
          case when r->>'discount' ~ '^0?\.\d+$' then (r->>'discount')::numeric end,
          case when r->>'unit_cost' ~ '^\d+(\.\d+)?$' then (r->>'unit_cost')::numeric end,
          case when r->>'returnable' in ('true','false') then (r->>'returnable')::boolean end,
          case when r->>'case_qty' ~ '^\d{1,5}$' and (r->>'case_qty')::int >= 1 then (r->>'case_qty')::int end,
          case when r->>'availability' in ('in_stock','low','backorder','forthcoming','out_of_print','not_available','unknown') then r->>'availability' else 'unknown' end,
          case when r->>'qty' ~ '^\d{1,7}$' then (r->>'qty')::int end,
          case when r->>'availability' is not null or r->>'qty' is not null then now_ts end,
          imp.kind, imp.id, now_ts)
      on conflict (vendor_id, item_key) do update set
          vendor_sku = coalesce(excluded.vendor_sku, o.vendor_sku), list_price = coalesce(excluded.list_price, o.list_price),
          discount = coalesce(excluded.discount, o.discount), unit_cost = coalesce(excluded.unit_cost, o.unit_cost),
          returnable = coalesce(excluded.returnable, o.returnable), case_qty = coalesce(excluded.case_qty, o.case_qty),
          availability = case when r->>'availability' is not null then excluded.availability else o.availability end,
          qty_available = case when r->>'qty' is not null then excluded.qty_available else o.qty_available end,
          checked_at = coalesce(excluded.checked_at, o.checked_at), source = excluded.source, import_id = excluded.import_id, updated_at = now_ts;
      n_off := n_off + 1;
    end if;
  end loop;
  update public.catalog_imports set rows_in = rows_in + n_in, titles_new = titles_new + n_new, offers_set = offers_set + n_off, finished_at = now_ts
    where id = p_import;
  return jsonb_build_object('rows', n_in, 'new_titles', n_new, 'offers', n_off);
end $$;
revoke all on function public.start_catalog_import(uuid, text, text) from public, anon;
revoke all on function public.import_catalog_rows(uuid, jsonb) from public, anon;
grant execute on function public.start_catalog_import(uuid, text, text) to authenticated;
grant execute on function public.import_catalog_rows(uuid, jsonb) to authenticated;

-- Staff and leads can record what they saw on a vendor's site or heard on the phone.
create or replace function public.set_offer_stock(p_vendor uuid, p_item text, p_availability text, p_qty int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if p_availability not in ('in_stock','low','backorder','forthcoming','out_of_print','not_available','unknown') then raise exception 'unknown availability'; end if;
  if not exists (select 1 from public.catalog_titles where item_key = p_item) then raise exception 'unknown title'; end if;
  insert into public.vendor_offers (vendor_id, item_key, availability, qty_available, checked_at, source)
  values (p_vendor, p_item, p_availability, p_qty, now(), 'manual')
  on conflict (vendor_id, item_key) do update set availability = excluded.availability, qty_available = excluded.qty_available,
    checked_at = excluded.checked_at, updated_at = now();
end $$;
revoke all on function public.set_offer_stock(uuid, text, text, int) from public, anon;
grant execute on function public.set_offer_stock(uuid, text, text, int) to authenticated;

-- Anyone signed in can add a single title they looked up (for example from Open Library) so a special order can use it.
create or replace function public.add_title(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare k text := regexp_replace(coalesce(p->>'isbn',''), '[^0-9]', '', 'g');
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if k !~ '^97[89][0-9]{10}$' or nullif(p->>'title','') is null then raise exception 'needs an ISBN-13 and a title'; end if;
  insert into public.catalog_titles (item_key, title, subtitle, contributors, publisher, pub_date, pages, cover_url, source)
  values (k, left(p->>'title',400), left(nullif(p->>'subtitle',''),400), left(nullif(p->>'contributors',''),400),
          left(nullif(p->>'publisher',''),160), case when p->>'pub_date' ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'pub_date')::date end,
          case when p->>'pages' ~ '^\d{1,5}$' then (p->>'pages')::int end, left(nullif(p->>'cover_url',''),400), 'openlibrary')
  on conflict (item_key) do nothing;
  return k;
end $$;
revoke all on function public.add_title(jsonb) from public, anon;
grant execute on function public.add_title(jsonb) to authenticated;

-- 7. One-time copy of the app's existing vendor list (shared data 'people') into the vendors table. Owner only.
-- Matches by name, so running it again adds only vendors that are not in the table yet.
create or replace function public.copy_app_vendors() returns int
language plpgsql security definer set search_path = public as $$
declare v jsonb; n int := 0;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner-only'; end if;
  for v in select x from public.app_docs d, jsonb_each(coalesce(d.data->'vendors','{}'::jsonb)) s(site, list), jsonb_array_elements(s.list) x
           where d.key = 'people' and jsonb_typeof(s.list) = 'array' loop
    insert into public.vendors (name, kind, status, covers, how_to_order, terms, lead_days, contact, email, phone, min_order, notes, legacy_id)
    values (left(v->>'name',80),
      case when v->>'name' ~* 'faire' then 'marketplace' when v->>'name' ~* 'amazon' then 'general' when v->>'name' ~* 'libro' then 'audiobook'
           when v->>'name' ~* 'direct' then 'publisher' else 'distributor' end,
      case when v->>'status' in ('Active','Applying','Approved, not ordering yet','Paused','Not using') then v->>'status' else 'Applying' end,
      left(v->>'covers',400), left(v->>'how',200), left(v->>'terms',400),
      case when v->>'lead' ~ '^\d{1,3}$' then (v->>'lead')::int end,
      left(nullif(v->>'contact',''),80), left(nullif(v->>'email',''),120), left(nullif(v->>'phone',''),40),
      left(nullif(v->>'min',''),60), left(nullif(v->>'notes',''),1000), v->>'id')
    on conflict (name) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.copy_app_vendors() from public, anon;
grant execute on function public.copy_app_vendors() to authenticated;

-- 8. Ordering: purchase orders to each vendor, built from Title search.
--   Anyone signed in can add titles to a vendor's open order (with a note, e.g. a special order for a customer).
--   Managers and the owner set quantities, see cost, and mark an order sent, confirmed or cancelled.
--   The app makes each vendor's order file (ISBN + quantity for PRH Self-Service, Bookazine, IPG, Lunar...),
--   opens the vendor's ordering page or drafts an email; sending through EDI (Pubnet) needs a Pubnet account first.
alter table public.vendors add column if not exists order_url text check (length(order_url) <= 300);
alter table public.vendors add column if not exists order_method text not null default 'file'
  check (order_method in ('file','email','site','phone','edi','marketplace'));
alter table public.vendors add column if not exists order_email text check (length(order_email) <= 120);
alter table public.vendors add column if not exists san text check (san ~ '^[0-9-]{7,12}$'); -- the vendor's SAN, public industry id (not an account number)

create sequence if not exists public.po_number_seq start 1001;
create table if not exists public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  po_number   text not null unique default ('PO-' || nextval('public.po_number_seq')),
  vendor_id   uuid not null references public.vendors(id) on delete restrict,
  status      text not null default 'draft' check (status in ('draft','sent','confirmed','received','cancelled')),
  method      text check (method in ('file','email','site','phone','edi','marketplace')),
  vendor_ref  text check (length(vendor_ref) <= 60), -- the vendor's order or confirmation number
  notes       text check (length(notes) <= 1000),
  expected_on date,
  created_at  timestamptz not null default now(),
  created_by  text default lower(auth.jwt() ->> 'email'),
  sent_at     timestamptz,
  sent_by     text,
  updated_at  timestamptz not null default now()
);
create unique index if not exists purchase_orders_one_draft on public.purchase_orders (vendor_id) where status = 'draft';

create table if not exists public.purchase_order_lines (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references public.purchase_orders(id) on delete cascade,
  item_key    text not null references public.catalog_titles(item_key) on delete restrict,
  qty         int not null default 1 check (qty between 1 and 9999),
  unit_cost   numeric(10,2), -- cost when added or when sent
  note        text check (length(note) <= 200),
  added_by    text default lower(auth.jwt() ->> 'email'),
  added_at    timestamptz not null default now(),
  unique (po_id, item_key)
);
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
revoke all on public.purchase_orders, public.purchase_order_lines from anon, authenticated;
revoke usage on sequence public.po_number_seq from anon, authenticated;

-- Add a title to the vendor's open order (creates the order if needed). Adding it again adds to the quantity.
create or replace function public.add_to_order(p_vendor uuid, p_item text, p_qty int default 1, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare po uuid; c numeric; o public.vendor_offers; t public.catalog_titles; v public.vendors;
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if coalesce(p_qty,0) not between 1 and 9999 then raise exception 'quantity 1 to 9999'; end if;
  select * into t from public.catalog_titles where item_key = p_item; if t.item_key is null then raise exception 'unknown title'; end if;
  select * into v from public.vendors where id = p_vendor; if v.id is null then raise exception 'unknown vendor'; end if;
  select id into po from public.purchase_orders where vendor_id = p_vendor and status = 'draft';
  if po is null then insert into public.purchase_orders (vendor_id) values (p_vendor) returning id into po; end if;
  select * into o from public.vendor_offers where vendor_id = p_vendor and item_key = p_item;
  c := case when o.vendor_id is null then null else public.offer_cost(o, t, v, p_qty) end;
  if c is null and t.list_price is not null and v.default_discount is not null then c := round(t.list_price * (1 - v.default_discount), 2); end if;
  insert into public.purchase_order_lines as l (po_id, item_key, qty, unit_cost, note) values (po, p_item, p_qty, c, left(nullif(trim(p_note),''),200))
  on conflict (po_id, item_key) do update set qty = least(l.qty + excluded.qty, 9999),
    note = coalesce(nullif(concat_ws('; ', l.note, excluded.note), ''), l.note), unit_cost = coalesce(excluded.unit_cost, l.unit_cost);
  update public.purchase_orders set updated_at = now() where id = po;
  return po;
end $$;

-- Orders with their lines, stock at that vendor, and (for managers and the owner) cost.
create or replace function public.list_orders(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare see_cost boolean := public.role_rank(public.my_role()) >= 3;
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', po.id, 'po_number', po.po_number, 'status', po.status, 'method', po.method, 'vendor_ref', po.vendor_ref,
      'notes', po.notes, 'expected_on', po.expected_on, 'created_at', po.created_at, 'sent_at', po.sent_at, 'sent_by', po.sent_by,
      'vendor', jsonb_build_object('id', v.id, 'name', v.name, 'order_method', v.order_method, 'order_url', v.order_url,
                 'order_email', v.order_email, 'stock_check_url', v.stock_check_url, 'lead_days', v.lead_days, 'san', v.san,
                 'free_freight_over', case when see_cost then v.free_freight_over end),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'item_key', l.item_key, 'title', t.title, 'contributors', t.contributors, 'format', t.format,
          'list_price', t.list_price, 'qty', l.qty, 'note', l.note, 'added_by', l.added_by,
          'unit_cost', case when see_cost then l.unit_cost end,
          'availability', coalesce(o.availability, 'unknown'), 'stock_qty', o.qty_available, 'checked_at', o.checked_at,
          'vendor_sku', o.vendor_sku, 'qty_received', l.qty_received, 'received_at', l.received_at,
          'better', (select jsonb_build_object('vendor', v2.name, 'availability', o2.availability)
                      from public.vendor_offers o2 join public.vendors v2 on v2.id = o2.vendor_id
                      where o2.item_key = l.item_key and o2.vendor_id <> po.vendor_id and o2.availability in ('in_stock','low')
                        and coalesce(o.availability,'unknown') not in ('in_stock','low') and v2.status = 'Active'
                      order by o2.availability = 'in_stock' desc limit 1)
        ) order by t.title) from public.purchase_order_lines l join public.catalog_titles t on t.item_key = l.item_key
          left join public.vendor_offers o on o.vendor_id = po.vendor_id and o.item_key = l.item_key where l.po_id = po.id), '[]'::jsonb)
    ) order by (po.status = 'draft') desc, po.created_at desc)
    from public.purchase_orders po join public.vendors v on v.id = po.vendor_id
    where (p_status is null and (po.status in ('draft','sent','confirmed') or po.updated_at > now() - interval '60 days')) or po.status = p_status), '[]'::jsonb);
end $$;

-- Change a line: quantity 0 removes it. Staff may remove or change only lines they added to a draft.
create or replace function public.set_order_line(p_line uuid, p_qty int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l public.purchase_order_lines; st text;
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  select * into l from public.purchase_order_lines where id = p_line; if l.id is null then raise exception 'unknown line'; end if;
  select status into st from public.purchase_orders where id = l.po_id;
  if st <> 'draft' then raise exception 'This order was already sent'; end if;
  if public.role_rank(public.my_role()) < 3 and l.added_by is distinct from lower(coalesce(auth.jwt() ->> 'email','')) then raise exception 'manager-only'; end if;
  if coalesce(p_qty,0) <= 0 then delete from public.purchase_order_lines where id = p_line;
  else update public.purchase_order_lines set qty = least(p_qty, 9999), note = coalesce(left(nullif(trim(p_note),''),200), note) where id = p_line; end if;
  update public.purchase_orders set updated_at = now() where id = l.po_id;
end $$;

-- Managers and the owner: sent (with how and the vendor's order number), confirmed, received or cancelled.
create or replace function public.set_order_status(p_po uuid, p_status text, p_method text default null, p_ref text default null,
                                                   p_expected date default null, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders;
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  select * into po from public.purchase_orders where id = p_po; if po.id is null then raise exception 'unknown order'; end if;
  if p_status not in ('draft','sent','confirmed','received','cancelled') then raise exception 'unknown status'; end if;
  if p_status = 'sent' and not exists (select 1 from public.purchase_order_lines where po_id = p_po) then raise exception 'The order is empty'; end if;
  if p_status = 'draft' and po.status <> 'draft' and exists (select 1 from public.purchase_orders where vendor_id = po.vendor_id and status = 'draft' and id <> p_po)
    then raise exception 'This vendor already has an open order'; end if;
  update public.purchase_orders set status = p_status,
    method = coalesce(p_method, method), vendor_ref = coalesce(left(nullif(trim(p_ref),''),60), vendor_ref),
    expected_on = coalesce(p_expected, expected_on), notes = coalesce(left(nullif(trim(p_notes),''),1000), notes),
    sent_at = case when p_status = 'sent' and sent_at is null then now() else sent_at end,
    sent_by = case when p_status = 'sent' and sent_by is null then lower(coalesce(auth.jwt() ->> 'email','')) else sent_by end,
    updated_at = now()
  where id = p_po;
end $$;
revoke all on function public.add_to_order(uuid, text, int, text) from public, anon;
revoke all on function public.list_orders(text) from public, anon;
revoke all on function public.set_order_line(uuid, int, text) from public, anon;
revoke all on function public.set_order_status(uuid, text, text, text, date, text) from public, anon;
grant execute on function public.add_to_order(uuid, text, int, text) to authenticated;
grant execute on function public.list_orders(text) to authenticated;
grant execute on function public.set_order_line(uuid, int, text) to authenticated;
grant execute on function public.set_order_status(uuid, text, text, text, date, text) to authenticated;

-- Staff screens list vendors through vendor_directory; it also carries how each vendor takes orders.
drop view if exists public.vendor_directory;
create view public.vendor_directory as
  select id, name, kind, status, covers, how_to_order, website, stock_check_url, contact, email, phone,
         min_order, lead_days, notes,
         case when public.role_rank(public.my_role()) >= 3 then terms end as terms,
         case when public.role_rank(public.my_role()) >= 3 then default_discount end as default_discount,
         returnable, free_freight_over, updated_at, order_method, order_url
  from public.vendors where public.is_desk_member();
grant select on public.vendor_directory to authenticated;

-- 9. Products tracked by the vendor you order them through (needs shopify.sql first).
--   vendor_aliases : Shopify's "Vendor" field (publisher or brand name, e.g. "Kodansha" or a Faire brand) -> the vendor
--                    you actually order it from (PRH, Faire...). Faire's Shopify app creates products with the brand name.
--   catalog_from_shopify() : every Shopify product with an ISBN or SKU becomes searchable and orderable here, and gets
--                    an offer from its ordering vendor at the Shopify cost (Faire items: the wholesale cost). Runs hourly.
--   product_history(key)   : one product's story: store stock and sales, each vendor's stock and cost, and every order.
--   reorder_suggestions()  : sold in the last 30 days and running low in Shopify, grouped by ordering vendor.
create table if not exists public.vendor_aliases (
  shopify_vendor text primary key check (length(shopify_vendor) between 1 and 160), -- matched case-insensitively
  vendor_id      uuid not null references public.vendors(id) on delete cascade
);
alter table public.vendor_aliases enable row level security;
revoke all on public.vendor_aliases from anon;
grant select, insert, update, delete on public.vendor_aliases to authenticated;
drop policy if exists "members read aliases" on public.vendor_aliases;
create policy "members read aliases" on public.vendor_aliases for select to authenticated using (public.is_desk_member());
drop policy if exists "managers change aliases" on public.vendor_aliases;
create policy "managers change aliases" on public.vendor_aliases for all to authenticated
  using (public.role_rank(public.my_role()) >= 3) with check (public.role_rank(public.my_role()) >= 3);

-- The key a Shopify variant gets in the catalog: its ISBN-13 barcode, else its SKU, else its barcode.
create or replace function public.shopify_item_key(p_barcode text, p_sku text) returns text language sql immutable as $$
  select case
    when regexp_replace(coalesce(p_barcode,''), '[^0-9]', '', 'g') ~ '^97[89][0-9]{10}$' then regexp_replace(p_barcode, '[^0-9]', '', 'g')
    when regexp_replace(coalesce(p_sku,''), '[^0-9]', '', 'g') ~ '^97[89][0-9]{10}$' and length(regexp_replace(p_sku, '[0-9 -]', '', 'g')) = 0 then regexp_replace(p_sku, '[^0-9]', '', 'g')
    when nullif(trim(p_sku),'') is not null then 'sku:' || left(trim(p_sku), 80)
    when nullif(trim(p_barcode),'') is not null then 'sku:' || left(trim(p_barcode), 80)
  end $$;

create or replace function public.catalog_from_shopify() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_t int; n_o int;
begin
  if coalesce(auth.jwt() ->> 'email','') <> '' and public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if; -- the hourly timer runs without a sign-in
  with v as (
    select distinct on (k) public.shopify_item_key(sv.barcode, sv.sku) as k, sv.*
    from public.shopify_variants sv where coalesce(sv.status,'ACTIVE') <> 'ARCHIVED'
    order by k, sv.updated_at desc)
  insert into public.catalog_titles as c (item_key, title, publisher, upc, list_price, product_class, source)
  select k, left(coalesce(nullif(v.product_title,''), k) || case when coalesce(v.variant_title,'') not in ('','Default Title') then ' - ' || v.variant_title else '' end, 400),
         left(nullif(v.vendor,''),160), case when k like 'sku:%' then left(nullif(regexp_replace(coalesce(v.barcode,''),'[^0-9]','','g'),''),20) end,
         v.price, left(lower(nullif(v.product_type,'')),40), 'shopify'
  from v where k is not null
  on conflict (item_key) do update set
    upc = coalesce(c.upc, excluded.upc), list_price = coalesce(c.list_price, excluded.list_price),
    product_class = coalesce(c.product_class, excluded.product_class), publisher = coalesce(c.publisher, excluded.publisher),
    title = case when c.source = 'shopify' then excluded.title else c.title end, updated_at = now();
  get diagnostics n_t = row_count;
  -- an offer from the vendor each product is ordered through, at the Shopify cost when there is one
  insert into public.vendor_offers as o (vendor_id, item_key, unit_cost, source, updated_at)
  select distinct on (a.vendor_id, public.shopify_item_key(sv.barcode, sv.sku)) a.vendor_id, public.shopify_item_key(sv.barcode, sv.sku),
         case when (select kind from public.vendors where id = a.vendor_id) in ('marketplace','general') then nullif(sc.cost, 0) end, 'shopify', now()
  from public.shopify_variants sv join public.vendor_aliases a on lower(a.shopify_vendor) = lower(trim(sv.vendor))
  left join public.shopify_costs sc on sc.inventory_item_id = sv.inventory_item_id
  where public.shopify_item_key(sv.barcode, sv.sku) is not null
  order by a.vendor_id, public.shopify_item_key(sv.barcode, sv.sku), sv.updated_at desc
  on conflict (vendor_id, item_key) do update set unit_cost = coalesce(excluded.unit_cost, o.unit_cost), updated_at = now();
  get diagnostics n_o = row_count;
  return jsonb_build_object('products', n_t, 'vendor_links', n_o);
end $$;
revoke all on function public.catalog_from_shopify() from public, anon;
grant execute on function public.catalog_from_shopify() to authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'catalog-from-shopify';
    perform cron.schedule('catalog-from-shopify', '7 * * * *', 'select public.catalog_from_shopify()');
  end if;
end $$;

-- Store stock and 30-day sales for a catalog key (all Shopify variants that share it).
create or replace function public.store_stock(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when count(*) = 0 then null else jsonb_build_object(
    'available', sum(sv.available), 'on_hand', sum(sv.on_hand), 'price', max(sv.price), 'shopify_vendor', max(sv.vendor),
    'sold30', case when public.role_rank(public.my_role()) >= 3 then (select coalesce(sum(l.qty),0) from public.shopify_order_lines l
               where l.variant_id = any(array_agg(sv.variant_id)) and l.day >= current_date - 30 and not l.cancelled) end) end
  from public.shopify_variants sv where public.shopify_item_key(sv.barcode, sv.sku) = p_key $$;
revoke all on function public.store_stock(text) from public, anon;

create or replace function public.product_history(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare see_cost boolean := public.role_rank(public.my_role()) >= 3;
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  return jsonb_build_object(
    'title', (select to_jsonb(c) - 'search' - 'description' from public.catalog_titles c where c.item_key = p_key),
    'store', public.store_stock(p_key),
    'shopify_cost', case when see_cost then (select max(sc.cost) from public.shopify_variants sv join public.shopify_costs sc on sc.inventory_item_id = sv.inventory_item_id
                      where public.shopify_item_key(sv.barcode, sv.sku) = p_key) end,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('po_number', po.po_number, 'vendor', v.name, 'status', po.status, 'qty', l.qty,
                 'unit_cost', case when see_cost then l.unit_cost end, 'note', l.note, 'at', coalesce(po.sent_at, po.created_at))
               order by coalesce(po.sent_at, po.created_at) desc)
               from public.purchase_order_lines l join public.purchase_orders po on po.id = l.po_id join public.vendors v on v.id = po.vendor_id
               where l.item_key = p_key), '[]'::jsonb));
end $$;
revoke all on function public.product_history(text) from public, anon;
grant execute on function public.product_history(text) to authenticated;

-- Low and selling: available at or below p_min and sold in the last 30 days, by ordering vendor. Managers and the owner.
create or replace function public.reorder_suggestions(p_min int default 1) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  return coalesce((select jsonb_agg(x order by x->>'vendor') from (
    select jsonb_build_object('vendor_id', min(vid::text), 'vendor', coalesce(max(vname), 'No ordering vendor set (Shopify vendor: ' || coalesce(max(sv_vendor),'blank') || ')'),
      'items', jsonb_agg(jsonb_build_object('item_key', k, 'title', title, 'available', avail, 'sold30', sold) order by sold desc)) as x
    from (
      select s.*,
             (select coalesce(sum(l.qty),0) from public.shopify_order_lines l where l.variant_id = any(s.variants) and l.day >= current_date - 30 and not l.cancelled) as sold,
             (select coalesce(sum(pl.qty),0) from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.po_id
               where pl.item_key = s.k and po.status in ('draft','sent','confirmed')) as on_order
      from (
        select public.shopify_item_key(sv.barcode, sv.sku) as k, max(sv.product_title) as title, sum(sv.available) as avail,
               a.vendor_id as vid, max(v.name) as vname, max(trim(sv.vendor)) as sv_vendor, array_agg(sv.variant_id) as variants
        from public.shopify_variants sv
        left join public.vendor_aliases a on lower(a.shopify_vendor) = lower(trim(sv.vendor))
        left join public.vendors v on v.id = a.vendor_id
        where coalesce(sv.tracked, true) and coalesce(sv.status,'ACTIVE') = 'ACTIVE'
        group by 1, a.vendor_id) s
      where s.k is not null and s.avail <= p_min) t
    where sold > 0 and on_order = 0
    group by coalesce(vid::text, 'shopify:' || lower(coalesce(sv_vendor,'')))) g), '[]'::jsonb);
end $$;
revoke all on function public.reorder_suggestions(int) from public, anon;
grant execute on function public.reorder_suggestions(int) to authenticated;

-- Shopify vendor names that are not linked to an ordering vendor yet (for the Catalog imports screen).
create or replace function public.unlinked_shopify_vendors() returns table(shopify_vendor text, products bigint)
language sql stable security definer set search_path = public as $$
  select trim(sv.vendor), count(*) from public.shopify_variants sv
  where public.role_rank(public.my_role()) >= 3 and nullif(trim(sv.vendor),'') is not null
    and not exists (select 1 from public.vendor_aliases a where lower(a.shopify_vendor) = lower(trim(sv.vendor)))
  group by 1 order by 2 desc limit 300 $$;
revoke all on function public.unlinked_shopify_vendors() from public, anon;
grant execute on function public.unlinked_shopify_vendors() to authenticated;

-- 10. Every purchase recorded by ISBN, whichever site it was ordered on.
--   Orders built here record themselves. Orders placed elsewhere (Faire, Amazon, the PRH portal) are recorded when the
--   shipment is checked in under Receiving (record_outside_order), so each ISBN keeps vendor, date, quantity, cost,
--   list price, your shelf price and margin.
alter table public.purchase_order_lines add column if not exists list_price numeric(10,2);
alter table public.purchase_order_lines add column if not exists store_price numeric(10,2);
alter table public.purchase_orders add column if not exists source text not null default 'app';
alter table public.purchase_orders drop constraint if exists purchase_orders_source_check;
alter table public.purchase_orders add constraint purchase_orders_source_check check (source in ('app','receiving','import','shopify'));

create or replace function public.find_vendor(p_name text) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.vendors where lower(name) = lower(trim(p_name))),
    (select vendor_id from public.vendor_aliases where lower(shopify_vendor) = lower(trim(p_name))),
    (select id from public.vendors where trim(p_name) <> '' and (lower(trim(p_name)) like '%' || lower(split_part(name,' (',1)) || '%'
        or lower(name) like '%' || lower(trim(p_name)) || '%') order by length(name) limit 1),
    (select id from public.vendors where kind = 'marketplace' and name ilike 'faire%' and trim(p_name) ilike 'faire%' limit 1)) $$;
revoke all on function public.find_vendor(text) from public, anon, authenticated;

-- rows: [{code, title, qty, cost, price}] as Receiving reads them from an invoice or packing slip.
create or replace function public.record_outside_order(p_vendor_name text, p_ref text, p_day date, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare vid uuid := public.find_vendor(p_vendor_name); po uuid; r jsonb; k text; n int := 0;
begin
  if public.role_rank(public.my_role()) < 2 then raise exception 'lead-only'; end if;
  if vid is null then
    insert into public.vendors (name, kind, status, notes) values (left(trim(p_vendor_name),80), 'other', 'Active', 'Added when a shipment was checked in')
    on conflict (name) do update set updated_at = now() returning id into vid;
  end if;
  if nullif(trim(p_ref),'') is not null then
    select id into po from public.purchase_orders where vendor_id = vid and vendor_ref = left(trim(p_ref),60) and status <> 'cancelled' limit 1;
    if po is not null then return jsonb_build_object('po', po, 'lines', 0, 'already', true); end if;
  end if;
  insert into public.purchase_orders (vendor_id, status, method, vendor_ref, sent_at, sent_by, source)
  values (vid, 'received', 'site', left(nullif(trim(p_ref),''),60), coalesce(p_day, current_date)::timestamptz, lower(coalesce(auth.jwt() ->> 'email','')), 'receiving')
  returning id into po;
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    k := regexp_replace(coalesce(r->>'code',''), '[^0-9Xx]', '', 'g');
    k := case when k ~ '^97[89][0-9]{10}$' then k when nullif(trim(r->>'code'),'') is not null then 'sku:' || left(trim(r->>'code'),80) end;
    if k is null or coalesce(nullif(r->>'qty','')::numeric, 0) <= 0 then continue; end if;
    insert into public.catalog_titles (item_key, title, list_price, source) values (k, left(coalesce(nullif(r->>'title',''), k), 400),
      case when r->>'price' ~ '^\d+(\.\d+)?$' then (r->>'price')::numeric end, 'receiving') on conflict (item_key) do nothing;
    insert into public.purchase_order_lines as l (po_id, item_key, qty, unit_cost, list_price, store_price)
    values (po, k, least(greatest((r->>'qty')::numeric::int,1),9999), case when r->>'cost' ~ '^\d+(\.\d+)?$' then (r->>'cost')::numeric end,
            case when r->>'price' ~ '^\d+(\.\d+)?$' then (r->>'price')::numeric end,
            (select max(sv.price) from public.shopify_variants sv where public.shopify_item_key(sv.barcode, sv.sku) = k))
    on conflict (po_id, item_key) do update set qty = least(l.qty + excluded.qty, 9999);
    -- if Shopify already showed this arrival (section 11), drop that automatic entry so it is not counted twice
    delete from public.purchase_order_lines pl using public.purchase_orders spo
    where spo.id = pl.po_id and spo.source = 'shopify' and spo.vendor_id = vid and pl.item_key = k
      and spo.sent_at > now() - interval '14 days' and pl.qty <= (r->>'qty')::numeric::int;
    update public.purchase_order_lines pl set qty = pl.qty - (r->>'qty')::numeric::int, qty_received = greatest(pl.qty_received - (r->>'qty')::numeric::int, 0)
    from public.purchase_orders spo
    where spo.id = pl.po_id and spo.source = 'shopify' and spo.vendor_id = vid and pl.item_key = k
      and spo.sent_at > now() - interval '14 days' and pl.qty > (r->>'qty')::numeric::int;
    -- the vendor carries it, at this cost
    insert into public.vendor_offers as o (vendor_id, item_key, unit_cost, source, updated_at)
    values (vid, k, case when r->>'cost' ~ '^\d+(\.\d+)?$' then (r->>'cost')::numeric end, 'receiving', now())
    on conflict (vendor_id, item_key) do update set unit_cost = coalesce(excluded.unit_cost, o.unit_cost), updated_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('po', po, 'lines', n);
end $$;
revoke all on function public.record_outside_order(text, text, date, jsonb) from public, anon;
grant execute on function public.record_outside_order(text, text, date, jsonb) to authenticated;

-- Fill list and shelf price on lines when an order is sent, so the record keeps what they were that day.
create or replace function public.po_lines_snapshot() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and old.status = 'draft' then
    update public.purchase_order_lines l set
      list_price = coalesce(l.list_price, (select list_price from public.catalog_titles where item_key = l.item_key)),
      store_price = coalesce(l.store_price, (select max(sv.price) from public.shopify_variants sv where public.shopify_item_key(sv.barcode, sv.sku) = l.item_key))
    where l.po_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists po_lines_snapshot on public.purchase_orders;
create trigger po_lines_snapshot after update of status on public.purchase_orders for each row execute function public.po_lines_snapshot();

-- Purchase history by ISBN (managers and the owner): one row per line ordered, with margin at your shelf price.
create or replace function public.purchase_history(p_q text default null, p_days int default 365) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  return coalesce((select jsonb_agg(x order by x->>'at' desc) from (
    select jsonb_build_object('item_key', l.item_key, 'title', t.title, 'contributors', t.contributors, 'publisher', coalesce(t.imprint, t.publisher),
      'vendor', v.name, 'po_number', po.po_number, 'vendor_ref', po.vendor_ref, 'status', po.status, 'source', po.source,
      'at', coalesce(po.sent_at, po.created_at), 'qty', l.qty, 'unit_cost', l.unit_cost,
      'list_price', coalesce(l.list_price, t.list_price), 'store_price', l.store_price, 'note', l.note,
      'margin', case when coalesce(l.store_price, l.list_price, t.list_price) > 0 and l.unit_cost is not null
                then round(1 - l.unit_cost / coalesce(l.store_price, l.list_price, t.list_price), 3) end,
      'line_cost', case when l.unit_cost is not null then round(l.unit_cost * l.qty, 2) end) as x
    from public.purchase_order_lines l join public.purchase_orders po on po.id = l.po_id
    join public.vendors v on v.id = po.vendor_id join public.catalog_titles t on t.item_key = l.item_key
    where po.status <> 'cancelled' and po.status <> 'draft' and coalesce(po.sent_at, po.created_at) > now() - make_interval(days => greatest(coalesce(p_days,365),1))
      and (nullif(trim(p_q),'') is null or l.item_key = regexp_replace(p_q,'[^0-9]','','g') or t.title ilike '%' || trim(p_q) || '%' or v.name ilike '%' || trim(p_q) || '%')
    limit 2000) s), '[]'::jsonb);
end $$;
revoke all on function public.purchase_history(text, int) from public, anon;
grant execute on function public.purchase_history(text, int) to authenticated;

-- 11. Automatic check-in from Shopify.
--   When Shopify's on-hand count for an item goes up (scanned in at the register, Faire's app, a Shopify import),
--   the increase is matched to that item on open orders (sent or confirmed, oldest first) and counted as received.
--   An order with every line received becomes "received" by itself. Staff only flag what came short or damaged.
--   Runs every 15 minutes, right after the Shopify sync. The first run only takes a starting count.
alter table public.purchase_order_lines add column if not exists qty_received int not null default 0;
alter table public.purchase_order_lines add column if not exists received_at timestamptz;
create table if not exists public.shopify_stock_seen (
  item_key text primary key,
  on_hand  int not null,
  seen_at  timestamptz not null default now()
);
create table if not exists public.auto_receipts (
  id       bigserial primary key,
  po_id    uuid references public.purchase_orders(id) on delete cascade,
  line_id  uuid references public.purchase_order_lines(id) on delete cascade,
  item_key text not null,
  qty      int not null,
  at       timestamptz not null default now()
);
alter table public.shopify_stock_seen enable row level security;
alter table public.auto_receipts enable row level security;
revoke all on public.shopify_stock_seen, public.auto_receipts from anon, authenticated;

create or replace function public.auto_receive_from_shopify() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; l record; left_qty int; take int; n_items int := 0; n_units int := 0; first_run boolean;
begin
  if coalesce(auth.jwt() ->> 'email','') <> '' and public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  first_run := not exists (select 1 from public.shopify_stock_seen);
  for r in
    select k, now_on_hand, coalesce(s.on_hand, now_on_hand) as before from (
      select public.shopify_item_key(sv.barcode, sv.sku) as k, sum(greatest(coalesce(sv.on_hand,0),0))::int as now_on_hand
      from public.shopify_variants sv group by 1) cur
    left join public.shopify_stock_seen s on s.item_key = cur.k
    where cur.k is not null
  loop
    if not first_run and r.now_on_hand > r.before then
      left_qty := r.now_on_hand - r.before;
      for l in
        select pl.id, pl.po_id, pl.qty - pl.qty_received as open_qty
        from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.po_id
        where pl.item_key = r.k and po.status in ('sent','confirmed') and pl.qty_received < pl.qty
        order by po.sent_at nulls last, po.created_at
      loop
        exit when left_qty <= 0;
        take := least(left_qty, l.open_qty);
        update public.purchase_order_lines set qty_received = qty_received + take, received_at = now() where id = l.id;
        insert into public.auto_receipts (po_id, line_id, item_key, qty) values (l.po_id, l.id, r.k, take);
        left_qty := left_qty - take; n_units := n_units + take;
      end loop;
      if left_qty < r.now_on_hand - r.before then n_items := n_items + 1; end if;
      -- Stock that arrived with no order here (bought on Faire, Amazon or a portal, then received into Shopify):
      -- recorded as a purchase from the vendor the item is linked to, at the Shopify cost, one record per vendor per day.
      if left_qty > 0 then
        select a.vendor_id, (select max(sc.cost) from public.shopify_variants sv2 join public.shopify_costs sc on sc.inventory_item_id = sv2.inventory_item_id
                              where public.shopify_item_key(sv2.barcode, sv2.sku) = r.k) as cost,
               (select max(sv3.price) from public.shopify_variants sv3 where public.shopify_item_key(sv3.barcode, sv3.sku) = r.k) as price
          into l
        from public.shopify_variants sv join public.vendor_aliases a on lower(a.shopify_vendor) = lower(trim(sv.vendor))
        where public.shopify_item_key(sv.barcode, sv.sku) = r.k limit 1;
        if l.vendor_id is not null then
          declare apo uuid;
          begin
            select id into apo from public.purchase_orders where vendor_id = l.vendor_id and source = 'shopify' and sent_at::date = current_date limit 1;
            if apo is null then
              insert into public.purchase_orders (vendor_id, status, method, sent_at, source, notes)
              values (l.vendor_id, 'received', 'marketplace', now(), 'shopify', 'Arrivals seen in Shopify with no order in the app')
              returning id into apo;
            end if;
            insert into public.purchase_order_lines as pl (po_id, item_key, qty, qty_received, received_at, unit_cost, store_price, note)
            values (apo, r.k, left_qty, left_qty, now(), nullif(l.cost,0), l.price, 'Arrived in Shopify')
            on conflict (po_id, item_key) do update set qty = pl.qty + excluded.qty, qty_received = pl.qty_received + excluded.qty_received;
            insert into public.auto_receipts (po_id, item_key, qty) values (apo, r.k, left_qty);
            n_units := n_units + left_qty;
          end;
        end if;
      end if;
    end if;
    insert into public.shopify_stock_seen (item_key, on_hand, seen_at) values (r.k, r.now_on_hand, now())
    on conflict (item_key) do update set on_hand = excluded.on_hand, seen_at = excluded.seen_at;
  end loop;
  -- orders whose every line has arrived are received
  update public.purchase_orders po set status = 'received', updated_at = now()
  where po.status in ('sent','confirmed')
    and exists (select 1 from public.purchase_order_lines pl where pl.po_id = po.id)
    and not exists (select 1 from public.purchase_order_lines pl where pl.po_id = po.id and pl.qty_received < pl.qty);
  return jsonb_build_object('first_run', first_run, 'items', n_items, 'units', n_units);
end $$;
revoke all on function public.auto_receive_from_shopify() from public, anon;
grant execute on function public.auto_receive_from_shopify() to authenticated;

-- Managers can correct a line by hand (short, damaged, or counted elsewhere).
create or replace function public.set_line_received(p_line uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare po uuid;
begin
  if public.role_rank(public.my_role()) < 2 then raise exception 'lead-only'; end if;
  update public.purchase_order_lines set qty_received = greatest(0, least(coalesce(p_qty,0), 9999)), received_at = now() where id = p_line returning po_id into po;
  if po is null then raise exception 'unknown line'; end if;
  update public.purchase_orders p set status = case when not exists (select 1 from public.purchase_order_lines x where x.po_id = p.id and x.qty_received < x.qty) then 'received' else p.status end, updated_at = now()
  where p.id = po and p.status in ('sent','confirmed','received');
end $$;
revoke all on function public.set_line_received(uuid, int) from public, anon;
grant execute on function public.set_line_received(uuid, int) to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'auto-receive';
    perform cron.schedule('auto-receive', '3-59/15 * * * *', 'select public.auto_receive_from_shopify()');
  end if;
end $$;

-- 12. Setting up new vendors: account applications and the documents behind them.
--   A manager or the owner uploads notes, terms or an application (Vendor setup screen). The doc-import function
--   reads it and proposes vendor records with a setup checklist; nothing is saved until a person approves.
--   Never store account numbers, passwords, tax ids, bank details or signatures here.
alter table public.vendors drop constraint if exists vendors_status_check;
alter table public.vendors add constraint vendors_status_check
  check (status in ('To apply','Applying','Approved, not ordering yet','Active','Paused','Not using'));
alter table public.vendors add column if not exists apply_url text check (length(apply_url) <= 300);
alter table public.vendors add column if not exists apply_email text check (length(apply_email) <= 120);
alter table public.vendors add column if not exists needs text check (length(needs) <= 600);      -- what the application asks for
alter table public.vendors add column if not exists applied_on date;
alter table public.vendors add column if not exists setup_steps jsonb not null default '[]'::jsonb; -- [{step, who, done}]

create table if not exists public.vendor_docs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 200),
  body        text not null check (length(body) <= 200000),
  vendor_ids  uuid[] not null default '{}',
  uploaded_by text not null default lower(coalesce(auth.jwt() ->> 'email','')),
  uploaded_at timestamptz not null default now()
);
create index if not exists vendor_docs_vendors on public.vendor_docs using gin (vendor_ids);
alter table public.vendor_docs enable row level security;
revoke all on public.vendor_docs from anon;
grant select, delete on public.vendor_docs to authenticated;
drop policy if exists "managers read vendor docs" on public.vendor_docs;
create policy "managers read vendor docs" on public.vendor_docs for select to authenticated using (public.role_rank(public.my_role()) >= 3);
drop policy if exists "managers delete vendor docs" on public.vendor_docs;
create policy "managers delete vendor docs" on public.vendor_docs for delete to authenticated using (public.role_rank(public.my_role()) >= 3);

-- Save approved vendors from a document. New names are added; for existing vendors only empty fields are filled,
-- new checklist steps are added, and an Active vendor's status is never changed. Returns the ids touched.
create or replace function public.apply_vendor_setup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; vid uuid; made int := 0; changed int := 0; ids uuid[] := '{}'; st text; disc numeric;
  clip constant text[] := array['covers','how_to_order','website','stock_check_url','contact','email','phone','terms','min_order','notes','order_url','order_email','apply_url','apply_email','needs'];
begin
  if public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'vendors','[]')) limit 60 loop
    continue when coalesce(trim(x->>'name'),'') = '';
    st := case when x->>'status' in ('To apply','Applying','Approved, not ordering yet','Active','Paused','Not using') then x->>'status' else 'To apply' end;
    disc := case when (x->>'default_discount') ~ '^[0-9.]+$' then (x->>'default_discount')::numeric end;
    if disc >= 1 then disc := disc / 100; end if;
    if disc >= 0.95 then disc := null; end if;
    select id into vid from public.vendors where lower(name) = lower(trim(x->>'name'));
    if vid is null then
      insert into public.vendors (name, kind, status, covers, how_to_order, website, stock_check_url, contact, email, phone, terms,
        default_discount, returnable, min_order, notes, order_method, order_url, order_email, apply_url, apply_email, needs, setup_steps)
      values (left(trim(x->>'name'),80),
        case when x->>'kind' in ('publisher','distributor','wholesaler','marketplace','audiobook','general','consignor','other') then x->>'kind' else 'distributor' end,
        st, left(nullif(x->>'covers',''),400), left(nullif(x->>'how_to_order',''),200), left(nullif(x->>'website',''),200),
        left(nullif(x->>'stock_check_url',''),300), left(nullif(x->>'contact',''),80), left(nullif(x->>'email',''),120), left(nullif(x->>'phone',''),40),
        left(nullif(x->>'terms',''),400), disc, coalesce((x->>'returnable')::boolean, true), left(nullif(x->>'min_order',''),60),
        left(nullif(x->>'notes',''),1000),
        case when x->>'order_method' in ('file','email','site','phone','edi','marketplace') then x->>'order_method' else 'file' end,
        left(nullif(x->>'order_url',''),300), left(nullif(x->>'order_email',''),120), left(nullif(x->>'apply_url',''),300),
        left(nullif(x->>'apply_email',''),120), left(nullif(x->>'needs',''),600), coalesce(x->'steps','[]'))
      returning id into vid;
      made := made + 1;
    else
      update public.vendors v set
        covers = coalesce(v.covers, left(nullif(x->>'covers',''),400)), how_to_order = coalesce(v.how_to_order, left(nullif(x->>'how_to_order',''),200)),
        website = coalesce(v.website, left(nullif(x->>'website',''),200)), stock_check_url = coalesce(v.stock_check_url, left(nullif(x->>'stock_check_url',''),300)),
        contact = coalesce(v.contact, left(nullif(x->>'contact',''),80)), email = coalesce(v.email, left(nullif(x->>'email',''),120)),
        phone = coalesce(v.phone, left(nullif(x->>'phone',''),40)), terms = coalesce(v.terms, left(nullif(x->>'terms',''),400)),
        default_discount = coalesce(v.default_discount, disc), min_order = coalesce(v.min_order, left(nullif(x->>'min_order',''),60)),
        notes = coalesce(v.notes, left(nullif(x->>'notes',''),1000)), order_url = coalesce(v.order_url, left(nullif(x->>'order_url',''),300)),
        order_email = coalesce(v.order_email, left(nullif(x->>'order_email',''),120)), apply_url = coalesce(v.apply_url, left(nullif(x->>'apply_url',''),300)),
        apply_email = coalesce(v.apply_email, left(nullif(x->>'apply_email',''),120)), needs = coalesce(v.needs, left(nullif(x->>'needs',''),600)),
        status = case when v.status = 'Active' or x->>'status' is null then v.status else st end,
        setup_steps = v.setup_steps || coalesce((select jsonb_agg(s) from jsonb_array_elements(coalesce(x->'steps','[]')) s
                        where not exists (select 1 from jsonb_array_elements(v.setup_steps) o where lower(o->>'step') = lower(s->>'step'))), '[]'),
        updated_at = now(), updated_by = lower(auth.jwt() ->> 'email')
      where v.id = vid;
      changed := changed + 1;
    end if;
    ids := ids || vid;
  end loop;
  if coalesce(p->>'doc_name','') <> '' and coalesce(p->>'doc_text','') <> '' then
    insert into public.vendor_docs (name, body, vendor_ids) values (left(p->>'doc_name',200), left(p->>'doc_text',200000), ids);
  end if;
  return jsonb_build_object('created', made, 'updated', changed, 'ids', to_jsonb(ids));
end $$;
revoke all on function public.apply_vendor_setup(jsonb) from public, anon;
grant execute on function public.apply_vendor_setup(jsonb) to authenticated;
