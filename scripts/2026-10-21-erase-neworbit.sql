-- UK GDPR erasure: NewOrbit (Craig, 21 October 2026). Everything held about the company and its people goes,
-- and the company goes on the never-add list. Run once, in one transaction.
-- Not backed up on purpose: a backup would keep the data the company asked us to erase.

insert into public.do_not_add (company_name, name_key, domain, company_number, reason)
values ('NewOrbit', 'neworbit', 'neworbit.co.uk', '04990082', 'UK GDPR right to be forgotten, requested by the company by email on 21 October 2026');

-- Rows that do not cascade from the company.
delete from public.ai_usage where company_search_id = 'bde3f4c9-289a-462a-a2b5-8241beef7230';
delete from public.email_send_log where recipient_email ilike '%@neworbit.co.uk' or metadata->>'company_search_id' = 'bde3f4c9-289a-462a-a2b5-8241beef7230';
delete from public.email_events where recipient_email ilike '%@neworbit.co.uk' or company_search_id = 'bde3f4c9-289a-462a-a2b5-8241beef7230';
delete from public.inbox_replies where from_email ilike '%@neworbit.co.uk' or company_search_id = 'bde3f4c9-289a-462a-a2b5-8241beef7230';
delete from public.email_unsubscribe_tokens where email ilike '%@neworbit.co.uk';
delete from public.suppressed_emails where email ilike '%@neworbit.co.uk';
delete from public.prospects where lower(name) like '%neworbit%' or website ilike '%neworbit.co.uk%' or promoted_company_id = 'bde3f4c9-289a-462a-a2b5-8241beef7230';

-- The company: its sequences, steps, outcomes, contacts, facts, scripts, vacancies, scores and signals go with it.
delete from public.company_searches where id = 'bde3f4c9-289a-462a-a2b5-8241beef7230';
