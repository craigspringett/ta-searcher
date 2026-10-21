-- Opens and clicks that are mail security scanners, image proxies or privacy relays, not a person
-- (Craig, 21 October 2026: Warm right now was full of Microsoft and Google scans). The handler works it
-- out when the event arrives (seconds after delivery, or an address owned by Microsoft within five minutes,
-- or a data centre) and keeps the reason, so the app and the alerts only count the rest.
alter table public.email_events
  add column if not exists automatic boolean not null default false,
  add column if not exists automatic_reason text,
  add column if not exists ip_org text;
