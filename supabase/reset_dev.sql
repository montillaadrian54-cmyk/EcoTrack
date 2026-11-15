-- DEV ONLY: wipes the EcoTrack tables so you can re-run schema.sql (use if you already ran the first version). Deletes all data!
drop view if exists public.schedule_outcomes;
drop table if exists public.collector_locations cascade;
drop function if exists public.report_location(uuid,double precision,double precision,double precision,double precision,double precision), public.purge_old_locations(integer);
drop table if exists public.sms_notifications, public.report_updates, public.collection_records, public.collection_assignments,
  public.missed_pickup_reports, public.collection_schedules, public.notification_settings, public.app_settings cascade;
drop function if exists public.update_assignment(uuid,text,text,text,text), public.update_assignment(uuid,text,text,text);
drop function if exists public.start_collection(uuid), public.zone_sms_coverage(uuid);
drop function if exists public.create_recurring_schedule(uuid,int[],time,text,uuid,date,int), public.record_collection(uuid,text,text,text,text,timestamptz);
drop sequence if exists public.report_seq;
-- profiles and zones are dropped last because other tables point to them:
drop table if exists public.profiles, public.collection_zones cascade;
drop trigger if exists on_auth_user_created on auth.users;
drop policy if exists "photos upload own folder" on storage.objects;
drop policy if exists "photos read" on storage.objects;
drop policy if exists "photos delete own" on storage.objects;