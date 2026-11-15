-- OPTIONAL, DEMO ONLY: fills the past 4 weeks with sample outcomes so the analytics have something to show.
-- Run after you have at least one collector and one resident account. Do NOT use for real records.
do $$
declare col uuid; res uuid; z record; d date; sid uuid; r numeric; st text; rid uuid;
begin
  select id into col from public.profiles where role = 'collector' limit 1;
  select id into res from public.profiles where role = 'resident'  limit 1;
  if col is null or res is null then raise notice 'Need one collector and one resident account first.'; return; end if;
  for z in select id from public.collection_zones loop
    for d in select g::date from generate_series(current_date - 28, current_date - 1, interval '1 day') g loop
      if extract(dow from d)::int in (1,4) then
        r := random();
        st := case when r < 0.70 then 'completed' when r < 0.82 then 'delayed' else 'missed' end;
        sid := null;
        insert into public.collection_schedules(zone_id, collection_date, collection_time, waste_type, status)
        values (z.id, d, '07:00', 'General waste', st) on conflict do nothing returning id into sid;
        if sid is not null then
          insert into public.collection_records(schedule_id, collector_id, status, reason, completed_at)
          values (sid, col, st, case when st = 'completed' then null else 'Truck breakdown (demo)' end,
                  case when st = 'completed' then d + time '08:30' else null end);
          insert into public.collection_assignments(collector_id, schedule_id, status) values (col, sid, 'completed') on conflict do nothing;
          if st = 'missed' then
            insert into public.missed_pickup_reports(resident_id, zone_id, schedule_id, title, description, status, verified_at, resolved_at, created_at, latitude, longitude)
            values (res, z.id, sid, 'Garbage not collected (demo)', 'Demo report for a missed collection.', 'resolved',
                    d + time '10:00', d + time '10:00' + (random() * 40 + 4) * interval '1 hour', d + time '09:00',
                    14.5995 + (random() - .5) / 200, 120.9842 + (random() - .5) / 200);
          end if;
        end if;
      end if;
    end loop;
  end loop;
end $$;