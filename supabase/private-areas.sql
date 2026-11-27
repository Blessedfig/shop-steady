-- Private areas for Downtown Stube (Supabase project "shop-steady").
-- Run after sync.sql: Supabase > SQL Editor > New query > paste > Run. Running it again is safe.
--
-- Some shared areas are only for a store manager or the owner. Staff and shift leads can neither read nor save them,
-- so those phones never receive the data at all (not just hidden on screen):
--   pay       : everyone's hourly pay, and the sign-in email that links a team member to their own pay
--   trips     : the mileage log
--   writeoffs : write-offs and giveaways
--   costs     : what each item cost the store (from receiving)
-- my_pay()    : lets any signed-in person read their own pay rate only (matched by their sign-in email).

create or replace function public.private_doc(k text) returns boolean language sql immutable as $$
  select k in ('pay','trips','writeoffs','costs') $$;

drop policy if exists "members read app data" on public.app_docs;
create policy "members read app data" on public.app_docs for select to authenticated
  using (public.is_desk_member() and (not public.private_doc(key) or public.role_rank(public.my_role()) >= 3));

create or replace function public.save_doc(p_key text, p_data jsonb, p_base bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; who text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if not public.is_desk_member() then raise exception 'not-member'; end if;
  if p_key in ('setup','mods') and public.my_role() is distinct from 'owner' then raise exception 'owner-only'; end if;
  if public.private_doc(p_key) and public.role_rank(public.my_role()) < 3 then raise exception 'manager-only'; end if;
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

create or replace function public.my_pay() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.key, 'rate', p.value -> 'rate')
  from public.app_docs d, jsonb_each(coalesce(d.data -> 'people', '{}'::jsonb)) p
  where d.key = 'pay' and public.is_desk_member()
    and lower(p.value ->> 'email') = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1 $$;
revoke all on function public.my_pay() from public, anon;
grant execute on function public.my_pay() to authenticated;
