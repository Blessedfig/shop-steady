-- One-time cleanup (Nov 2026): the shared team still had the demo's sample people (Alex, Sam, Jordan, Riley, whose
-- PINs are printed on the public demo page) and several duplicate "Owner" entries using the demo PIN 9999.
-- This keeps one Owner per location, removes the sample people and their sample shifts, drops their pay entries,
-- and clears every store-tablet PIN. Afterwards the owner sets a new PIN on the Team screen ("Set a PIN").
-- Safe to run again.

update public.app_docs d set
  data = jsonb_set(jsonb_set(d.data, '{team}', coalesce((
      select jsonb_object_agg(s.key, (
        select coalesce(jsonb_agg(p order by o), '[]'::jsonb)
        from jsonb_array_elements(s.value) with ordinality as e(p, o)
        where p ->> 'n' not like '%(sample)%'
          and (p ->> 'n' <> 'Owner' or o = (select min(o2) from jsonb_array_elements(s.value) with ordinality as e2(p2, o2) where p2 ->> 'n' = 'Owner'))))
      from jsonb_each(d.data -> 'team') s where jsonb_typeof(s.value) = 'array'), '{}'::jsonb)),
    '{sched}', coalesce((
      select jsonb_object_agg(s.key, (
        select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
        from jsonb_array_elements(s.value) with ordinality as e(x, o) where coalesce(x ->> 'who', '') not like '%(sample)%'))
      from jsonb_each(d.data -> 'sched') s where jsonb_typeof(s.value) = 'array'), '{}'::jsonb)),
  version = d.version + 1, updated_at = now()
where d.key = 'shifts' and jsonb_typeof(d.data -> 'team') = 'object' and jsonb_typeof(d.data -> 'sched') = 'object';

update public.app_docs pay set
  data = jsonb_set(pay.data, '{people}', coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(pay.data -> 'people') e(k, v)
    where k in (select p ->> 'id' from public.app_docs sh, jsonb_each(sh.data -> 'team') s, jsonb_array_elements(s.value) p
                where sh.key = 'shifts' and jsonb_typeof(s.value) = 'array')), '{}'::jsonb)),
  version = pay.version + 1, updated_at = now()
where pay.key = 'pay' and jsonb_typeof(pay.data -> 'people') = 'object';

delete from public.desk_pins;
delete from public.desk_pin_fails;

select (select jsonb_agg(p ->> 'n') from public.app_docs sh, jsonb_each(sh.data -> 'team') s, jsonb_array_elements(s.value) p where sh.key = 'shifts') as team_now,
       (select count(*) from public.desk_pins) as pins_left;
