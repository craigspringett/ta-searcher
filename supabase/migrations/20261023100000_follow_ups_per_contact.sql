-- More than one person at a company can have follow-ups at the same time (Craig, 23 October 2026).
-- The old rule allowed one active run per company; it is now one active run per person.
drop index if exists public.follow_up_sequences_one_active_per_company;
create unique index if not exists follow_up_sequences_one_active_per_contact
  on public.follow_up_sequences (company_search_id, lower(contact_email))
  where status = 'active';
