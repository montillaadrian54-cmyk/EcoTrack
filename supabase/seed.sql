-- Sample zones + recurring schedules (run AFTER schema.sql). Zone centers are PLACEHOLDERS: edit them in Official > Zones.
insert into public.collection_zones(zone_name, description, center_lat, center_lng, radius_m) values
 ('Zone 1','Poblacion / main road', 14.5995, 120.9842, 350),
 ('Zone 2','Riverside',             14.6035, 120.9890, 300),
 ('Zone 3','Hillside',              14.5950, 120.9790, 300)
on conflict (zone_name) do nothing;
 
-- Every Monday and Thursday for 8 weeks, starting today (weekdays: 1=Mon, 4=Thu)
select public.create_recurring_schedule(id, array[1,4], '07:00', 'General waste', null, current_date, 8) from public.collection_zones;