-- Security lockdown for Downtown Stube (Supabase project "shop-steady"), from the Nov 27 2026 security check.
-- Run after private-areas.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe,
-- and it skips any table that is not set up in this project.
-- Live check on Nov 27: trials.sql and hardening.sql were never run there, so part 1 only touches desk_items there today.
--
-- Why: desk_members used to hold only owners and managers. Now every Bookseller is on it, so everything that
-- only checked "is on the list" (is_desk_member) became open to Booksellers too. This file does three things:
--   1. The Owner Desk tables (desk_items, desk_audit), trial codes and trial sign-ups: store manager or owner only.
--      Trial users can still send ideas and read their own replies (trials.sql), and choose_plan() still works.
--   2. Undo for the shared app data: every save of an app_docs area keeps the copy it replaced (last 15 per area),
--      so if someone wipes the schedule or notes by mistake, or on purpose, the owner can put it back.
--      Only the owner can read the history or restore from it.
--   3. Removes TRUNCATE, TRIGGER and REFERENCES rights that Supabase gives signed-in users on every table by default.

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.role_rank(public.my_role()) >= 3, false) $$;
revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

-- 1. Owner Desk, trial codes, trials: managers and the owner only
do $$
begin
  if to_regclass('public.desk_items') is not null then
    drop policy if exists "desk members can read"   on public.desk_items;
    drop policy if exists "desk members can add"    on public.desk_items;
    drop policy if exists "desk members can change" on public.desk_items;
    drop policy if exists "desk members can remove" on public.desk_items;
    create policy "desk members can read"   on public.desk_items for select to authenticated using (public.is_manager() and public.desk_can_see(data));
    create policy "desk members can add"    on public.desk_items for insert to authenticated with check (public.is_manager() and public.desk_can_see(data));
    create policy "desk members can change" on public.desk_items for update to authenticated using (public.is_manager() and public.desk_can_see(data)) with check (public.is_manager() and public.desk_can_see(data));
    create policy "desk members can remove" on public.desk_items for delete to authenticated using (public.is_manager() and public.desk_can_see(data));
  end if;
  if to_regclass('public.desk_audit') is not null then
    drop policy if exists "desk members can read the log" on public.desk_audit;
    create policy "desk members can read the log" on public.desk_audit for select to authenticated using (public.is_manager());
  end if;
  if to_regclass('public.trial_codes') is not null then
    drop policy if exists "desk members read codes"   on public.trial_codes;
    drop policy if exists "desk members add codes"    on public.trial_codes;
    drop policy if exists "desk members change codes" on public.trial_codes;
    create policy "desk members read codes"   on public.trial_codes for select to authenticated using (public.is_manager());
    create policy "desk members add codes"    on public.trial_codes for insert to authenticated with check (public.is_manager() and uses = 0);
    create policy "desk members change codes" on public.trial_codes for update to authenticated using (public.is_manager()) with check (public.is_manager());
  end if;
  if to_regclass('public.trials') is not null then
    drop policy if exists "desk members read trials"   on public.trials;
    drop policy if exists "desk members change trials" on public.trials;
    create policy "desk members read trials"   on public.trials for select to authenticated using (public.is_manager());
    -- paid_until is set by the Stripe webhook (service key); people in the app may not change it
    create policy "desk members change trials" on public.trials for update to authenticated
      using (public.my_role() = 'owner') with check (public.my_role() = 'owner');
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.trial_report()') is not null then
    execute $f$
    create or replace function public.trial_report()
    returns table (email text, code text, name text, home_type text, started_at timestamptz, ends_at timestamptz,
                   plan text, plan_note text, plan_chosen_at timestamptz, paid_until timestamptz,
                   confirmed boolean, last_sign_in timestamptz)
    language sql stable security definer set search_path = public as $q$
      select t.email, t.code, t.name, t.home_type, t.started_at, t.ends_at, t.plan, t.plan_note, t.plan_chosen_at, t.paid_until,
             u.email_confirmed_at is not null, u.last_sign_in_at
        from public.trials t
        left join auth.users u on lower(u.email) = t.email
       where public.is_manager()
       order by t.started_at desc;
    $q$;
    $f$;
  end if;
end $$;

-- 2. Undo history for shared app data
create table if not exists public.app_docs_history (
  id         bigint generated always as identity primary key,
  key        text not null,
  version    bigint not null,
  data       jsonb not null,
  saved_at   timestamptz not null,
  saved_by   text,
  replaced_at timestamptz not null default now(),
  replaced_by text
);
create index if not exists app_docs_history_key on public.app_docs_history (key, id desc);
alter table public.app_docs_history enable row level security;
revoke all on public.app_docs_history from anon, authenticated;
-- no policies and no grants: only the functions below (and the SQL Editor) can reach it

create or replace function public.app_docs_keep()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.data is distinct from new.data then
    insert into public.app_docs_history (key, version, data, saved_at, saved_by, replaced_by)
    values (old.key, old.version, old.data, old.updated_at, old.updated_by, lower(coalesce(auth.jwt() ->> 'email', 'system')));
    delete from public.app_docs_history
     where key = old.key
       and id not in (select id from public.app_docs_history where key = old.key order by id desc limit 15);
  end if;
  return new;
end $$;
drop trigger if exists app_docs_keep on public.app_docs;
create trigger app_docs_keep before update on public.app_docs for each row execute function public.app_docs_keep();

-- The owner lists saved copies of one area, then restores one by its id.
create or replace function public.doc_history(p_key text)
returns table (id bigint, version bigint, saved_at timestamptz, saved_by text, replaced_at timestamptz, replaced_by text, size int)
language sql stable security definer set search_path = public as $$
  select h.id, h.version, h.saved_at, h.saved_by, h.replaced_at, h.replaced_by, pg_column_size(h.data)
    from public.app_docs_history h
   where h.key = p_key and public.my_role() = 'owner'
   order by h.id desc $$;
create or replace function public.restore_doc(p_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare h public.app_docs_history; v bigint;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner-only'; end if;
  select * into h from public.app_docs_history where id = p_id;
  if not found then raise exception 'not-found'; end if;
  update public.app_docs set data = h.data, version = version + 1, updated_at = now(),
         updated_by = lower(coalesce(auth.jwt() ->> 'email', 'system'))
   where key = h.key returning version into v;
  return v;
end $$;
revoke all on function public.doc_history(text) from public, anon;
revoke all on function public.restore_doc(bigint) from public, anon;
grant execute on function public.doc_history(text) to authenticated;
grant execute on function public.restore_doc(bigint) to authenticated;

-- 3. Table rights the app never uses. Supabase grants every right on new tables to signed-in users by default.
--    RLS does not cover TRUNCATE (empty a whole table) or TRIGGER/REFERENCES, so take them away from the web roles.
--    The app's own reads and saves are unchanged.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
  end loop;
end $$;
-- and for tables made later in this schema
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
