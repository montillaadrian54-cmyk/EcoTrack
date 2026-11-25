-- =====================================================================
-- EcoTrack schema for Supabase  (run in: Dashboard > SQL Editor > New query)
-- Safe to read top-to-bottom: tables -> helpers -> triggers -> RPCs -> RLS -> storage
-- =====================================================================
 
-- ---------- 1. TABLES ------------------------------------------------
create table public.collection_zones (
  id uuid primary key default gen_random_uuid(),
  zone_name text not null unique,
  description text,
  center_lat numeric(10,7) check (center_lat between -90 and 90),
  center_lng numeric(10,7) check (center_lng between -180 and 180),
  radius_m integer not null default 300 check (radius_m between 50 and 5000),
  created_at timestamptz default now()
);
 
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone_number text check (phone_number is null or phone_number ~ '^09[0-9]{9}$'),   -- 09xxxxxxxxx
  zone_id uuid references public.collection_zones(id),
  role text not null default 'resident' check (role in ('resident','collector','official')),
  is_active boolean not null default true,
  created_at timestamptz default now()
);
 
create table public.collection_schedules (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.collection_zones(id),
  collection_date date not null,
  collection_time time not null,
  waste_type text not null,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','delayed','missed','cancelled')),
  started_at timestamptz,                                   -- when the collector pressed Start collection
  started_by uuid references public.profiles(id),
  created_at timestamptz default now()
);
 
create sequence public.report_seq start 1;
grant usage, select on sequence public.report_seq to authenticated;
 
create table public.missed_pickup_reports (
  id uuid primary key default gen_random_uuid(),
  report_no text unique not null default ('ECO-' || lpad(nextval('public.report_seq')::text, 4, '0')),
  resident_id uuid not null references public.profiles(id),
  zone_id uuid not null references public.collection_zones(id),
  schedule_id uuid references public.collection_schedules(id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 5 and 1000),
  photo_path text,
  latitude numeric(10,7) check (latitude between -90 and 90),
  longitude numeric(10,7) check (longitude between -180 and 180),
  status text not null default 'pending_verification'
    check (status in ('pending_verification','verified','assigned','in_progress','resolved','rejected')),
  rejection_reason text,
  verified_at timestamptz,
  resolved_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
 
create table public.collection_assignments (
  id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.profiles(id),
  schedule_id uuid references public.collection_schedules(id),
  report_id uuid references public.missed_pickup_reports(id),
  status text not null default 'assigned' check (status in ('assigned','in_progress','completed')),
  assigned_at timestamptz default now(),
  check (schedule_id is not null or report_id is not null)
);
-- prevent assigning the same collector twice to the same schedule / report
create unique index uq_schedule_slot on public.collection_schedules(zone_id, collection_date, collection_time, waste_type);
create unique index uq_assign_schedule on public.collection_assignments(collector_id, schedule_id) where schedule_id is not null;
create unique index uq_assign_report   on public.collection_assignments(report_id) where report_id is not null and status <> 'completed';
 
create table public.collection_records (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null unique references public.collection_schedules(id),  -- one outcome per scheduled collection
  collector_id uuid not null references public.profiles(id),
  status text not null check (status in ('completed','delayed','missed')),
  reason text,
  notes text,
  photo_path text,
  completed_at timestamptz,                    -- actual completion time (only when completed)
  recorded_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (status = 'completed' or coalesce(trim(reason),'') <> '')
);
 
create table public.report_updates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.missed_pickup_reports(id) on delete cascade,
  updated_by uuid not null references public.profiles(id),
  old_status text,
  new_status text not null,
  notes text,
  photo_path text,
  created_at timestamptz default now()
);
 
create table public.sms_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id),
  phone_number text not null,
  event_type text not null,
  ref_id uuid not null,                       -- report id or schedule id
  message text not null,
  provider_message_id text,
  provider text not null default 'unisms',
  provider_response text,                       -- raw (truncated) reply from UniSMS, for debugging
  delivery_status text,                         -- status reported by UniSMS when checked
  delivery_checked_at timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','failed','delivered')),
  error_message text,
  created_at timestamptz default now(),
  unique (event_type, ref_id, recipient_id)   -- duplicate-SMS protection (idempotency)
);
 
create table public.notification_settings (
  event_type text primary key,
  label text not null,
  enabled boolean not null default true
);
insert into public.notification_settings(event_type, label) values
 ('new_schedule','New collection schedule'),
 ('collection_started','Collection started (to residents of the purok)'),
 ('report_submitted','Report received (to resident)'),
 ('report_verified','Report verified (to resident)'),
 ('report_resolved','Report resolved (to resident)'),
 ('collector_assigned','Collector assignment (to collector)'),
 ('escalation_overdue','Overdue report alert (to officials)');
 
create table public.app_settings (key text primary key, value text not null);
insert into public.app_settings(key, value) values
 ('escalation_hours','24'),      -- verified reports unresolved longer than this trigger an SMS to officials
 ('recurring_threshold','3');    -- missed/delayed collections in 30 days before a zone is flagged
 
create index idx_reports_status   on public.missed_pickup_reports(status);
create index idx_reports_zone     on public.missed_pickup_reports(zone_id);
create index idx_reports_resident on public.missed_pickup_reports(resident_id);
create index idx_schedules_date   on public.collection_schedules(collection_date);
create index idx_assign_collector on public.collection_assignments(collector_id);
create index idx_updates_report   on public.report_updates(report_id);
 
-- ---------- 2. HELPER: current user's role ---------------------------
-- security definer avoids infinite recursion when used inside RLS policies
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;
 
-- ---------- 3. TRIGGERS ----------------------------------------------
-- 3a. auto-create profile after sign-up. Role is ALWAYS 'resident' here.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare z uuid;
begin
  begin z := nullif(new.raw_user_meta_data->>'zone_id','')::uuid; exception when others then z := null; end;
  insert into public.profiles(id, full_name, phone_number, zone_id, role)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
          nullif(new.raw_user_meta_data->>'phone_number',''), z, 'resident');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
 
-- 3b. only officials may change role / active flag / other people's profiles
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.app_role() is distinct from 'official' then
    if new.role <> old.role or new.is_active <> old.is_active or new.id <> old.id then
      raise exception 'Only officials can change role or account status';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_profile before update on public.profiles
  for each row execute function public.guard_profile_update();
 
-- 3c. updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger trg_reports_touch before update on public.missed_pickup_reports
  for each row execute function public.touch_updated_at();
 
-- 3d. first history row when a report is created
create or replace function public.log_new_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.report_updates(report_id, updated_by, old_status, new_status, notes)
  values (new.id, new.resident_id, null, new.status, 'Report submitted');
  return new;
end $$;
create trigger trg_log_new_report after insert on public.missed_pickup_reports
  for each row execute function public.log_new_report();
 
-- ---------- 4. RPC FUNCTIONS (all status changes go through these) ---
-- 4a. official: verify / reject / assign / in_progress / resolve
create or replace function public.update_report_status(
  p_report uuid, p_status text, p_notes text default null, p_collector uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare r public.missed_pickup_reports; ok boolean;
begin
  if public.app_role() is distinct from 'official' then raise exception 'Only officials can update report status'; end if;
  select * into r from public.missed_pickup_reports where id = p_report for update;
  if not found then raise exception 'Report not found'; end if;
 
  ok := case r.status
    when 'pending_verification' then p_status in ('verified','rejected')
    when 'verified'             then p_status in ('assigned','rejected')
    when 'assigned'             then p_status in ('assigned','in_progress','resolved')
    when 'in_progress'          then p_status = 'resolved'
    else false end;
  if not ok then raise exception 'Cannot change status from % to %', r.status, p_status; end if;
  if p_status = 'rejected' and coalesce(trim(p_notes),'') = '' then raise exception 'A reason is required to reject a report'; end if;
 
  if p_status = 'assigned' then
    if p_collector is null or not exists (select 1 from public.profiles where id = p_collector and role = 'collector' and is_active) then
      raise exception 'Choose an active collector';
    end if;
    if exists (select 1 from public.collection_assignments where report_id = p_report and status <> 'completed') then
      update public.collection_assignments set collector_id = p_collector, assigned_at = now(), status = 'assigned'
       where report_id = p_report and status <> 'completed';
    else
      insert into public.collection_assignments(collector_id, report_id) values (p_collector, p_report);
    end if;
  end if;
 
  update public.missed_pickup_reports
     set status = p_status,
         rejection_reason = case when p_status = 'rejected' then p_notes else null end,
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         resolved_at = case when p_status = 'resolved' then now() else resolved_at end
   where id = p_report;
  insert into public.report_updates(report_id, updated_by, old_status, new_status, notes)
  values (p_report, auth.uid(), r.status, p_status, p_notes);
end $$;
 
-- 4b. collector (or official): start / complete a follow-up task for a missed-pickup REPORT
create or replace function public.update_assignment(
  p_assignment uuid, p_status text, p_notes text default null, p_photo text default null
) returns void language plpgsql security definer set search_path = public as $$
declare a public.collection_assignments; rep public.missed_pickup_reports;
begin
  select * into a from public.collection_assignments where id = p_assignment for update;
  if not found then raise exception 'Assignment not found'; end if;
  if a.collector_id <> auth.uid() and public.app_role() is distinct from 'official' then raise exception 'Not your assignment'; end if;
  if a.report_id is null then raise exception 'Scheduled collections are recorded with record_collection()'; end if;
  if p_status not in ('in_progress','completed') then raise exception 'Invalid status'; end if;
  if a.status = 'completed' then raise exception 'Task is already completed'; end if;
 
  update public.collection_assignments set status = p_status where id = p_assignment;
  select * into rep from public.missed_pickup_reports where id = a.report_id for update;
  if p_status = 'in_progress' and rep.status = 'assigned' then
    update public.missed_pickup_reports set status = 'in_progress' where id = rep.id;
    insert into public.report_updates(report_id, updated_by, old_status, new_status, notes)
    values (rep.id, auth.uid(), rep.status, 'in_progress', coalesce(p_notes,'Collector started the follow-up collection'));
  elsif p_status = 'completed' and rep.status in ('assigned','in_progress') then
    update public.missed_pickup_reports set status = 'resolved', resolved_at = now() where id = rep.id;
    insert into public.report_updates(report_id, updated_by, old_status, new_status, notes, photo_path)
    values (rep.id, auth.uid(), rep.status, 'resolved', coalesce(p_notes,'Follow-up collection completed'), p_photo);
  end if;
end $$;
 
-- 4c. collector (or official): record the ACTUAL outcome of a scheduled collection
create or replace function public.record_collection(
  p_schedule uuid, p_status text, p_reason text default null, p_notes text default null,
  p_photo text default null, p_completed_at timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare s public.collection_schedules; done_at timestamptz;
begin
  select * into s from public.collection_schedules where id = p_schedule for update;
  if not found then raise exception 'Schedule not found'; end if;
  if s.status = 'cancelled' then raise exception 'This schedule was cancelled'; end if;
  if p_status not in ('completed','delayed','missed') then raise exception 'Status must be completed, delayed or missed'; end if;
  if public.app_role() is distinct from 'official'
     and not exists (select 1 from public.collection_assignments where schedule_id = p_schedule and collector_id = auth.uid()) then
    raise exception 'You are not assigned to this collection';
  end if;
  if p_status in ('delayed','missed') and coalesce(trim(p_reason),'') = '' then raise exception 'Please give a reason for a delayed or missed collection'; end if;
  if s.collection_date > (now() at time zone 'Asia/Manila')::date then raise exception 'You cannot record a collection scheduled for a future date'; end if;
 
  done_at := case when p_status = 'completed' then least(coalesce(p_completed_at, now()), now() + interval '5 minutes') else null end;
  insert into public.collection_records(schedule_id, collector_id, status, reason, notes, photo_path, completed_at)
  values (p_schedule, auth.uid(), p_status, nullif(trim(p_reason),''), p_notes, p_photo, done_at)
  on conflict (schedule_id) do update
    set status = excluded.status, reason = excluded.reason, notes = excluded.notes,
        photo_path = coalesce(excluded.photo_path, public.collection_records.photo_path),
        completed_at = excluded.completed_at, collector_id = excluded.collector_id, updated_at = now();
 
  update public.collection_schedules set status = p_status where id = p_schedule;
  update public.collection_assignments
     set status = case when p_status = 'delayed' then 'in_progress' else 'completed' end
   where schedule_id = p_schedule;
end $$;
 
-- 4d. official: create one schedule or a recurring one (e.g. every Monday and Thursday)
--     p_weekdays uses 0=Sunday ... 6=Saturday. A one-time schedule = one weekday, 1 week.
create or replace function public.create_recurring_schedule(
  p_zone uuid, p_weekdays int[], p_time time, p_waste text, p_collector uuid, p_start date, p_weeks int
) returns uuid[] language plpgsql security definer set search_path = public as $$
declare d date; sid uuid; ids uuid[] := '{}';
begin
  if auth.uid() is not null and public.app_role() is distinct from 'official' then raise exception 'Only officials can create schedules'; end if;
  if p_weeks < 1 or p_weeks > 26 then raise exception 'Weeks must be between 1 and 26'; end if;
  if p_weekdays is null or cardinality(p_weekdays) = 0 then raise exception 'Choose at least one weekday'; end if;
  if p_collector is not null and not exists (select 1 from public.profiles where id = p_collector and role = 'collector' and is_active) then
    raise exception 'Choose an active collector';
  end if;
  for d in select g::date from generate_series(p_start::timestamp, (p_start + (p_weeks * 7 - 1))::timestamp, interval '1 day') g loop
    if extract(dow from d)::int = any (p_weekdays) then
      sid := null;
      insert into public.collection_schedules(zone_id, collection_date, collection_time, waste_type)
      values (p_zone, d, p_time, p_waste)
      on conflict (zone_id, collection_date, collection_time, waste_type) do nothing
      returning id into sid;
      if sid is not null then
        ids := ids || sid;
        if p_collector is not null then
          insert into public.collection_assignments(collector_id, schedule_id) values (p_collector, sid) on conflict do nothing;
        end if;
      end if;
    end if;
  end loop;
  return ids;
end $$;
 
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
 
-- 4e. analytics view: one row per scheduled collection with its outcome (RLS of the caller applies)
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
 
grant execute on function public.update_report_status(uuid,text,text,uuid) to authenticated;
grant execute on function public.update_assignment(uuid,text,text,text) to authenticated;
grant execute on function public.record_collection(uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.create_recurring_schedule(uuid,int[],time,text,uuid,date,int) to authenticated;
revoke execute on function public.update_report_status(uuid,text,text,uuid) from anon;
revoke execute on function public.update_assignment(uuid,text,text,text) from anon;
revoke execute on function public.record_collection(uuid,text,text,text,text,timestamptz) from anon;
revoke execute on function public.create_recurring_schedule(uuid,int[],time,text,uuid,date,int) from anon;
 
-- ---------- 5. ROW LEVEL SECURITY ------------------------------------
alter table public.profiles               enable row level security;
alter table public.collection_zones       enable row level security;
alter table public.collection_schedules   enable row level security;
alter table public.missed_pickup_reports  enable row level security;
alter table public.collection_assignments enable row level security;
alter table public.collection_records     enable row level security;
alter table public.report_updates         enable row level security;
alter table public.sms_notifications      enable row level security;
alter table public.notification_settings  enable row level security;
alter table public.app_settings           enable row level security;
 
-- profiles
create policy "own profile read"      on public.profiles for select to authenticated using (id = auth.uid());
create policy "official reads all"    on public.profiles for select to authenticated using (public.app_role() = 'official');
create policy "own profile update"    on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "official updates all"  on public.profiles for update to authenticated using (public.app_role() = 'official');
 
-- zones: readable before login (registration form), official-managed
create policy "zones public read" on public.collection_zones for select to anon, authenticated using (true);
create policy "zones official write" on public.collection_zones for all to authenticated
  using (public.app_role() = 'official') with check (public.app_role() = 'official');
 
-- schedules
create policy "schedules read" on public.collection_schedules for select to authenticated using (true);
create policy "schedules official write" on public.collection_schedules for all to authenticated
  using (public.app_role() = 'official') with check (public.app_role() = 'official');
 
-- reports (updates happen only through update_report_status / update_assignment)
create policy "resident reads own reports" on public.missed_pickup_reports for select to authenticated using (resident_id = auth.uid());
create policy "resident creates own report" on public.missed_pickup_reports for insert to authenticated
  with check (resident_id = auth.uid() and public.app_role() = 'resident' and status = 'pending_verification');
create policy "official reads reports" on public.missed_pickup_reports for select to authenticated using (public.app_role() = 'official');
create policy "collector reads assigned reports" on public.missed_pickup_reports for select to authenticated
  using (exists (select 1 from public.collection_assignments a where a.report_id = missed_pickup_reports.id and a.collector_id = auth.uid()));
 
-- assignments
create policy "official manages assignments" on public.collection_assignments for all to authenticated
  using (public.app_role() = 'official') with check (public.app_role() = 'official');
create policy "collector reads own assignments" on public.collection_assignments for select to authenticated using (collector_id = auth.uid());
 
-- collection records (written only by record_collection)
create policy "official reads records"  on public.collection_records for select to authenticated using (public.app_role() = 'official');
create policy "collector reads own records" on public.collection_records for select to authenticated using (collector_id = auth.uid());
 
-- report history
create policy "history read" on public.report_updates for select to authenticated using (
  public.app_role() = 'official'
  or exists (select 1 from public.missed_pickup_reports r where r.id = report_updates.report_id and r.resident_id = auth.uid())
  or exists (select 1 from public.collection_assignments a where a.report_id = report_updates.report_id and a.collector_id = auth.uid())
);
 
-- sms + settings: officials only (Edge Function uses the service role)
create policy "official reads sms" on public.sms_notifications for select to authenticated using (public.app_role() = 'official');
create policy "official manages notification settings" on public.notification_settings for all to authenticated
  using (public.app_role() = 'official') with check (public.app_role() = 'official');
 
create policy "official manages app settings" on public.app_settings for all to authenticated
  using (public.app_role() = 'official') with check (public.app_role() = 'official');
 
-- ---------- 6. STORAGE (private photo bucket) ------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos','report-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
 
create policy "photos upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos read" on storage.objects for select to authenticated
  using (bucket_id = 'report-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text or public.app_role() in ('official','collector')));
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);
 
-- ---------- 6b. LIVE COLLECTOR TRACKING (officials only) -------------
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
 
-- ---------- 7. REALTIME ----------------------------------------------
alter publication supabase_realtime add table public.missed_pickup_reports, public.collection_assignments, public.collection_schedules, public.collector_locations;