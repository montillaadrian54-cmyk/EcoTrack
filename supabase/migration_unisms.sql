-- =====================================================================
-- EcoTrack: migration for an EXISTING database (UniSMS + Start Collection)
-- Run once in the Supabase SQL Editor. Safe to keep your data. (Fresh installs: use schema.sql instead.)
-- =====================================================================
 
-- schedules: new "in_progress" state + who/when started
alter table public.collection_schedules drop constraint if exists collection_schedules_status_check;
alter table public.collection_schedules add constraint collection_schedules_status_check
  check (status in ('scheduled','in_progress','completed','delayed','missed','cancelled'));
alter table public.collection_schedules add column if not exists started_at timestamptz;
alter table public.collection_schedules add column if not exists started_by uuid references public.profiles(id);
 
-- phone numbers must be 09xxxxxxxxx (NOT VALID = existing rows are not rejected, new/updated rows are checked)
alter table public.profiles drop constraint if exists profiles_phone_format;
alter table public.profiles add constraint profiles_phone_format
  check (phone_number is null or phone_number ~ '^09[0-9]{9}$') not valid;
-- To find residents whose saved number is in the wrong format:
--   select id, full_name, phone_number from public.profiles where phone_number is not null and phone_number !~ '^09[0-9]{9}$';
 
-- SMS history: provider + delivery tracking
alter table public.sms_notifications add column if not exists provider text not null default 'unisms';
update public.sms_notifications set provider = 'unisms' where provider = 'unisms';
alter table public.sms_notifications add column if not exists provider_response text;
alter table public.sms_notifications add column if not exists delivery_status text;
alter table public.sms_notifications add column if not exists delivery_checked_at timestamptz;
 
-- new notification type
insert into public.notification_settings(event_type, label)
values ('collection_started','Collection started (to residents of the purok)') on conflict (event_type) do nothing;
 
-- 4f. collector (or official): START the collection route for today's scheduled collection.
--     The SMS to residents is sent by the Edge Function send-sms (event collection_started),
--     which re-checks that this schedule really is in_progress and who started it.
create or replace function public.start_collection(p_schedule uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.collection_schedules;
begin
  select * into s from public.collection_schedules where id = p_schedule for update;
  if not found then raise exception 'Schedule not found'; end if;
  if public.app_role() is distinct from 'official'
     and not exists (select 1 from public.collection_assignments where schedule_id = p_schedule and collector_id = auth.uid()) then
    raise exception 'You are not assigned to this collection';
  end if;
  if s.status not in ('scheduled','delayed') then raise exception 'This collection cannot be started (status: %)', s.status; end if;
  if s.collection_date <> (now() at time zone 'Asia/Manila')::date then raise exception 'You can only start a collection on its scheduled date'; end if;
  update public.collection_schedules set status = 'in_progress', started_at = now(), started_by = auth.uid() where id = p_schedule;
  update public.collection_assignments set status = 'in_progress' where schedule_id = p_schedule;
end $$;
 
-- 4g. how many residents of a zone/purok can actually be reached by SMS (valid 09xxxxxxxxx number)
create or replace function public.zone_sms_coverage(p_zone uuid)
returns table(total integer, reachable integer, missing integer)
language sql stable security definer set search_path = public as $$
  select count(*)::int,
         (count(*) filter (where phone_number ~ '^09[0-9]{9}$'))::int,
         (count(*) filter (where phone_number is null or phone_number !~ '^09[0-9]{9}$'))::int
  from public.profiles
  where role = 'resident' and is_active and zone_id = p_zone
    and public.app_role() in ('official','collector')
$$;
grant execute on function public.start_collection(uuid) to authenticated;
grant execute on function public.zone_sms_coverage(uuid) to authenticated;
revoke execute on function public.start_collection(uuid) from anon;
revoke execute on function public.zone_sms_coverage(uuid) from anon;
 
-- analytics view: treat an unfinished past "in_progress" collection as unrecorded
create or replace view public.schedule_outcomes with (security_invoker = true) as
select s.id, s.zone_id, z.zone_name, s.collection_date, s.collection_time, s.waste_type,
       r.status as record_status, r.reason, r.completed_at, r.collector_id,
       case when s.status = 'cancelled' then 'cancelled'
            when s.status in ('completed','delayed','missed') then s.status
            when s.status = 'in_progress' and s.collection_date < (now() at time zone 'Asia/Manila')::date then 'unrecorded'
            when s.status = 'in_progress' then 'in_progress'
            when s.collection_date < (now() at time zone 'Asia/Manila')::date then 'unrecorded'
            else 'upcoming' end as outcome
from public.collection_schedules s
join public.collection_zones z on z.id = s.zone_id
left join public.collection_records r on r.schedule_id = s.id;
grant select on public.schedule_outcomes to authenticated;