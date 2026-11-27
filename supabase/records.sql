-- Business records for Downtown Stube (Supabase project "shop-steady"). OWNER ONLY.
-- Run after setup.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
-- It does not change save_doc or any shared area, so it can run before or after the other SQL files.
--
--   owner_records : the store's papers sorted by the "Import records" screen: leases, loans, insurance, licenses,
--                   tax forms, bank statements, contracts, building papers and anything else for the owner.
--                   Key facts and dates only (payment, rate, renews on, ends on). The files themselves stay where
--                   they are (the owner's computer or drive); the app keeps the file name and folder so they can be found.
--   records_ai    : the paid "AI onboarding" allowance: how many files the AI may still read and sort.
--                   The owner cannot raise it from the app; it is set here (or later by the payment webhook).
-- Only the owner can read or change either. Store managers and staff never receive them.
-- Receipts, vendors and HR paperwork go to the screens that already hold those (Expenses, Vendors, HR files).
-- Medical papers are never stored or sent anywhere: the import screen keeps them out.

create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_member() and public.my_role() = 'owner' $$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create table if not exists public.owner_records (
  id          uuid primary key default gen_random_uuid(),
  site        text,
  kind        text not null check (kind in ('lease','loan','insurance','license','tax','bank','contract','property','hr','other')),
  title       text not null check (length(title) between 1 and 200),
  party       text,                 -- landlord, lender, insurer, agency, bank, other side of the contract
  doc_date    date,
  amount      numeric(14,2),        -- the main money figure: monthly rent or payment, premium, balance, tax due
  renews_on   date,                 -- renewal or due date to be reminded of
  ends_on     date,                 -- lease end, loan payoff, policy end, license expiry
  facts       jsonb not null default '{}'::jsonb, -- rate, term, policy type, account last 4 only, notes
  file_name   text,
  file_path   text,                 -- where the original is, e.g. "Business/2025/Insurance/policy.pdf"
  file_key    text,                 -- name + size + date, so the same file is not imported twice
  sorted_by   text not null default 'owner' check (sorted_by in ('owner','rules','ai')),
  created_at  timestamptz not null default now(),
  created_by  text not null default lower(coalesce(auth.jwt() ->> 'email',''))
);
create index if not exists owner_records_kind on public.owner_records (kind);
create unique index if not exists owner_records_file_key on public.owner_records (file_key) where file_key is not null;

create table if not exists public.records_ai (
  id          int primary key default 1 check (id = 1),  -- one row per store database
  files_left  int not null default 0 check (files_left >= 0),
  files_used  int not null default 0,
  note        text,
  updated_at  timestamptz not null default now()
);
insert into public.records_ai (id) values (1) on conflict (id) do nothing;

alter table public.owner_records enable row level security;
alter table public.records_ai enable row level security;
revoke all on public.owner_records, public.records_ai from anon;
revoke insert, update, delete on public.records_ai from authenticated;
grant select, insert, update, delete on public.owner_records to authenticated;
grant select on public.records_ai to authenticated;

drop policy if exists "owner records" on public.owner_records;
create policy "owner records" on public.owner_records for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner reads ai allowance" on public.records_ai;
create policy "owner reads ai allowance" on public.records_ai for select to authenticated using (public.is_owner());

-- Called by the records-import function after the AI has read one file. Takes one file from the allowance.
create or replace function public.records_ai_take() returns int
language plpgsql security definer set search_path = public as $$
declare left_now int;
begin
  if not public.is_owner() then raise exception 'owner-only'; end if;
  update public.records_ai set files_left = files_left - 1, files_used = files_used + 1, updated_at = now()
    where id = 1 and files_left > 0 returning files_left into left_now;
  return coalesce(left_now, -1); -- -1: nothing left
end $$;
revoke all on function public.records_ai_take() from public, anon;
grant execute on function public.records_ai_take() to authenticated;

-- To switch on AI onboarding for this store (for example after it is paid for), run one line, changing 1000:
--   update public.records_ai set files_left = files_left + 1000, note = 'AI onboarding' where id = 1;

select public.is_owner() as you_are_owner, (select files_left from public.records_ai where id = 1) as ai_files_left;
