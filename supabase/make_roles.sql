-- 1) Register 3 accounts on the website first (resident / collector / official).
-- 2) Then promote two of them here (change the e-mails). Public sign-up can never create these roles.
update public.profiles set role = 'official'  where id = (select id from auth.users where email = 'official@example.com');
update public.profiles set role = 'collector' where id = (select id from auth.users where email = 'collector@example.com');