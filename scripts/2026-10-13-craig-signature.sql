-- Craig's signature details for emails sent in his name (13 October 2026):
-- the Outlook signature's title and mobile. Run in the SQL editor.
insert into public.email_signatures (email, full_name, job_title, mobile)
values ('craig@bigfishrecruitment.co.uk', 'Craig Springett', 'Director', '07902 371 136')
on conflict (email) do update set full_name = excluded.full_name, job_title = excluded.job_title, mobile = excluded.mobile, updated_at = now();
