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
create or replace function public.search_titles(p_q text, p_limit int default 25, p_qty int default 1)
returns table(item_key text, isbn13 text, title text, subtitle text, contributors text, publisher text, imprint text,
              format text, pub_date date, list_price numeric, cover_url text, offers jsonb)
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
      where o.item_key = c.item_key) x), '[]'::jsonb)
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
          'vendor_sku', o.vendor_sku,
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
