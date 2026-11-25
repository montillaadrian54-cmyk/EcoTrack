-- =====================================================================
-- EcoTrack: migration for an EXISTING database -> LIVE COLLECTOR TRACKING (run once, keeps your data)
-- Requires migration_unisms.sql (start_collection / started_by) to have been run first.
-- =====================================================================
 
-- The collector's phone reports its position ONLY while a route is in_progress and only for the route
-- that collector started. Nobody except officials can read the points (RLS). Old points are purged (see cron.sql).
create table public.collector_locations (
  id bigint generated always as identity primary key,
  schedule_id uuid not null references public.collection_schedules(id) on delete cascade,
  collector_id uuid not null references public.profiles(id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  recorded_at timestamptz not null default now()
);
create index idx_locations_schedule_time on public.collector_locations(schedule_id, recorded_at desc);
create index idx_locations_time on public.collector_locations(recorded_at);
alter table public.collector_locations enable row level security;
create policy "official reads locations" on public.collector_locations for select to authenticated
  using (public.app_role() = 'official');
-- (no insert/update/delete policies: the only way to write is report_location() below)
 
create or replace function public.report_location(
  p_schedule uuid, p_lat double precision, p_lng double precision,
  p_accuracy double precision default null, p_heading double precision default null, p_speed double precision default null
) returns void language plpgsql security definer set search_path = public as $$
declare s public.collection_schedules; last_at timestamptz;
begin
  select * into s from public.collection_schedules where id = p_schedule;
  if not found then raise exception 'Schedule not found'; end if;
  if s.status <> 'in_progress' then raise exception 'This collection is not in progress'; end if;
  if s.started_by is distinct from auth.uid() then raise exception 'Only the person who started this route can share its location'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
  select max(recorded_at) into last_at from public.collector_locations where schedule_id = p_schedule;
  if last_at is not null and now() - last_at < interval '3 seconds' then return; end if;      -- throttle
  insert into public.collector_locations(schedule_id, collector_id, latitude, longitude, accuracy_m, heading, speed_mps)
  values (p_schedule, auth.uid(), p_lat, p_lng, p_accuracy, p_heading, p_speed);
end $$;
grant execute on function public.report_location(uuid,double precision,double precision,double precision,double precision,double precision) to authenticated;
revoke execute on function public.report_location(uuid,double precision,double precision,double precision,double precision,double precision) from anon;
 
-- delete location history older than N days (official button or scheduled job)
create or replace function public.purge_old_locations(p_days integer default 7) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is not null and public.app_role() is distinct from 'official' then raise exception 'Only officials can purge'; end if;
  delete from public.collector_locations where recorded_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.purge_old_locations(integer) to authenticated;
revoke execute on function public.purge_old_locations(integer) from anon;
 
 
alter publication supabase_realtime add table public.collector_locations;
