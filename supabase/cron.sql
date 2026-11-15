-- OPTIONAL: run the overdue-report check automatically every hour (Supabase Cron / pg_cron + pg_net).
-- 1) supabase functions deploy escalate-overdue      2) supabase secrets set CRON_SECRET=choose-a-long-random-string
-- 3) replace the three placeholders below, then run this in the SQL Editor.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('ecotrack-escalation', '0 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-ID.supabase.co/functions/v1/escalate-overdue',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CHOOSE-THE-SAME-SECRET'),
    body := '{}'::jsonb);
$$);
-- To stop it later:  select cron.unschedule('ecotrack-escalation');
 
-- OPTIONAL: delete collector location history older than 7 days, every night at 03:30
select cron.schedule('ecotrack-purge-locations', '30 3 * * *', $$ delete from public.collector_locations where recorded_at < now() - interval '7 days' $$);
-- select cron.unschedule('ecotrack-purge-locations');
