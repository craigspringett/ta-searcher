-- TA Searcher database baseline (21 September 2026).
--
-- One migration for a new Supabase project, written from a dump of
-- He-Giveth's live schema (Postgres 17) with every school term renamed to
-- company and the education-only objects left out (CFR spend, Ofsted, GIAS,
-- tenders, pupil premium, the CRM shortlister, follow-up sequences, agency
-- boards, trust boards). The identity register is Companies House
-- (company_records, ch_officers, ch_filings) and the open-roles feeds are the
-- ATS boards (ats_boards). See docs/PORT-CONTRACTS.md.
--
-- What is NOT here:
--   * 20260921120050_queues_and_net.sql: pgmq, pg_net, pg_cron, the email
--     queues and their RPC wrappers, the analyze / copy queue dispatchers, the
--     pg_net page fetch, invoke_edge_function, process_email_queue_tick and
--     the cron-history readers. They need extensions the local test cluster
--     does not have, so they live apart and the local test skips that file.
--   * 20260921120100_cron_jobs.sql: the cron.schedule calls.
--
-- Vault secrets the hosted project needs (create once, never commit them;
-- the names are the ones He-Giveth uses so invoke_edge_function and the
-- dispatchers are unchanged):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role key>', 'email_queue_service_role_key');
--
-- Row security, in one paragraph: every table has RLS on; the anon key has
-- no table privileges at all; a signed-in user is an "app user" only when
-- a profiles row exists for them (work addresses at bigfishrecruitment.co.uk
-- or whofoundwho.co.uk); authenticated gets SELECT on the tables the app
-- reads, and INSERT / UPDATE / DELETE only on the tables the app writes
-- (profiles, consultants, company_consultants, company_searches, outcomes,
-- app_settings, email_signatures, vacancy_alert_settings and
-- company_contact_edits, without DELETE); everything else is written by the
-- service role from the edge functions. Test a policy change with
-- scripts/rls-check.sh before applying it, and run scripts/local-db-test.sh
-- after editing this file.

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Vault is a Supabase extension; the local test cluster has no such thing,
-- so a failure here is only noted. The functions that read Vault are in the
-- queues_and_net migration.
do $$
begin
  create extension if not exists supabase_vault;
exception when others then
  raise notice 'supabase_vault is not available here (%); the queue functions read it on the hosted project only', sqlerrm;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Types
-- ---------------------------------------------------------------------------

-- Where a vacancy was seen. The four ATS feeds, the company's own careers
-- page, a page read by the model, a role a consultant typed in, and other.
do $$ begin
  create type public.vacancy_source as enum ('ashby', 'greenhouse', 'lever', 'workable', 'careers_page', 'llm', 'consultant', 'other');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Helper functions that tables and policies depend on
-- ---------------------------------------------------------------------------

-- Only work addresses sign in. Both brands until Craig says otherwise
-- (docs/TA-SEARCHER-BRIEF.md, decision 6).
create or replace function public.is_allowed_login_email(p_email text)
returns boolean
language sql immutable strict
set search_path = ''
as $$
  select lower(split_part(p_email, '@', 2)) in ('bigfishrecruitment.co.uk', 'whofoundwho.co.uk');
$$;

create or replace function public.display_name_from_email(p_email text)
returns text
language sql immutable strict
set search_path = ''
as $$
  select initcap(replace(replace(split_part(p_email, '@', 1), '.', ' '), '_', ' '));
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.update_company_searches_updated_at()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Who is signed in: profiles and consultants
-- ---------------------------------------------------------------------------

-- One row per auth user, created by trigger on auth.users. role is
-- consultant, manager or admin. features is a per-user switch map
-- ({"follow_ups": true}) read by has_feature().
create table public.profiles (
  id uuid not null,
  email text not null,
  display_name text,
  role text default 'consultant'::text not null,
  consultant_id uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  features jsonb default '{}'::jsonb not null,
  constraint profiles_email_key unique (email),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade,
  constraint profiles_role_check check ((role = any (array['consultant'::text, 'manager'::text, 'admin'::text]))),
  constraint profiles_work_email check (public.is_allowed_login_email(email))
);

-- Consultants and their companies are data, not code (edited on the
-- Consultants page). brief_copies is the row's own Friday brief copy list.
create table public.consultants (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text,
  active boolean default true not null,
  profile_id uuid,
  external_refs jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  brief_copies text[] default '{}'::text[] not null,
  constraint consultants_name_key unique (name),
  constraint consultants_pkey primary key (id),
  constraint consultants_profile_id_fkey foreign key (profile_id) references public.profiles(id) on delete set null
);

-- Policy helpers. SECURITY DEFINER is essential: a policy on profiles calls
-- is_app_user(), which reads profiles; as SECURITY INVOKER that read runs
-- under the same policy and recurses until "stack depth limit exceeded",
-- which locked every He-Giveth user out for twelve minutes on 9 September
-- 2026 (hotfix 20260909092000 there). Never recreate these as invoker.
create or replace function public.is_app_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.role() = 'service_role'
      or exists (select 1 from public.profiles p where p.id = auth.uid());
$$;

create or replace function public.app_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select case when auth.role() = 'service_role' then 'admin'
              else (select p.role from public.profiles p where p.id = auth.uid()) end;
$$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.app_role() in ('manager', 'admin');
$$;

create or replace function public.has_feature(p_feature text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.role() = 'service_role'
      or coalesce((select (p.features -> p_feature) = 'true'::jsonb from public.profiles p where p.id = auth.uid()), false);
$$;

-- The consultant rows that are "me": linked by profile.consultant_id, by
-- consultants.profile_id, or by the same email address.
create or replace function public.my_consultant_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select c.id
  from public.consultants c
  join public.profiles p on p.id = auth.uid()
  where c.id = p.consultant_id
     or c.profile_id = p.id
     or (c.email is not null and lower(c.email) = lower(p.email));
$$;

create or replace function public.owns_alert_setting(p_email text, p_consultant_id uuid)
returns boolean
language sql stable security definer
set search_path = 'public'
as $$
  select
    public.is_manager()
    or (p_email is not null and lower(p_email) = (select lower(email) from public.profiles where id = auth.uid()))
    or (p_consultant_id is not null and p_consultant_id in (
      select c.id from public.consultants c
      where lower(c.email) = (select lower(email) from public.profiles where id = auth.uid())
    ));
$$;

comment on function public.is_app_user() is 'SECURITY DEFINER on purpose: a policy on profiles calls it and it reads profiles; as invoker it recurses and locks everyone out.';
comment on function public.app_role() is 'SECURITY DEFINER on purpose: reads profiles from inside profiles policies.';
comment on function public.is_manager() is 'SECURITY DEFINER on purpose: reads profiles from inside profiles policies.';
comment on function public.has_feature(text) is 'SECURITY DEFINER on purpose: reads profiles from inside policies.';
comment on function public.my_consultant_ids() is 'SECURITY DEFINER on purpose: reads profiles and consultants from inside policies.';

-- A new auth user gets a profile when the address is a work address. Craig
-- is the admin; everyone else starts as a consultant and a manager promotes
-- them on the Consultants page.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.email is null or not public.is_allowed_login_email(new.email) then
    return new; -- no profile; the app treats a user without a profile as not allowed
  end if;
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    lower(new.email),
    public.display_name_from_email(new.email),
    case
      when lower(new.email) in ('craig@bigfishrecruitment.co.uk', 'craig@whofoundwho.co.uk') then 'admin'
      else 'consultant'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Auth "before user created" hook: refuse any sign-in that would create a
-- user outside the two work domains, so the rule is enforced by Auth itself.
-- Register it through the Management API:
--   hook_before_user_created_enabled = true
--   hook_before_user_created_uri = pg-functions://postgres/public/auth_before_user_created
create or replace function public.auth_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if v_email = '' or not public.is_allowed_login_email(v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'TA Searcher is for Big Fish Recruitment and WhoFoundWho staff. Sign in with your bigfishrecruitment.co.uk or whofoundwho.co.uk address.'
    ));
  end if;
  return '{}'::jsonb;
end;
$$;

-- A profile links itself to the consultant row with the same email address.
create or replace function public.link_profile_to_consultant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.consultant_id is null then
    select c.id into new.consultant_id from public.consultants c where c.email is not null and lower(c.email) = lower(new.email) order by c.name limit 1;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Tables
-- ---------------------------------------------------------------------------

-- The companies. company_number is the Companies House number as stored
-- (nullable: a company added by URL alone has none yet). analysis_result is
-- the JSON the frontend reads (docs/PORT-CONTRACTS.md); the consultant tag
-- inside it is kept in step by sync_company_consultant_tag.
create table public.company_searches (
  id uuid default gen_random_uuid() not null,
  url text not null,
  company_name text not null,
  analysis_result jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  company_number text,
  evidence_fingerprint text,
  evidence_computed_at timestamptz,
  external_refs jsonb default '{}'::jsonb not null,
  constraint company_searches_url_unique unique (url),
  constraint company_searches_pkey primary key (id)
);

create table public.company_consultants (
  company_search_id uuid not null,
  consultant_id uuid not null,
  created_at timestamptz default now() not null,
  constraint company_consultants_pkey primary key (company_search_id, consultant_id),
  constraint company_consultants_consultant_id_fkey foreign key (consultant_id) references public.consultants(id) on delete cascade,
  constraint company_consultants_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade
);

-- The Calls history: what a consultant did about a company.
create table public.outcomes (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid not null,
  consultant_id uuid,
  created_by uuid,
  contact_name text,
  contact_role text,
  kind text not null,
  note text,
  callback_at timestamptz,
  external_refs jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint outcomes_pkey primary key (id),
  constraint outcomes_consultant_id_fkey foreign key (consultant_id) references public.consultants(id) on delete set null,
  constraint outcomes_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null,
  constraint outcomes_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint outcomes_kind_check check ((kind = any (array['spoke_to'::text, 'voicemail'::text, 'callback'::text, 'not_interested'::text, 'meeting_booked'::text, 'emailed'::text, 'replied'::text, 'note'::text])))
);

-- Every model call.
create table public.ai_usage (
  id uuid default gen_random_uuid() not null,
  created_at timestamptz default now() not null,
  provider text not null,
  model text not null,
  purpose text not null,
  company_search_id uuid,
  input_tokens integer default 0 not null,
  cached_input_tokens integer default 0 not null,
  cache_write_tokens integer default 0 not null,
  output_tokens integer default 0 not null,
  estimated_cost_usd numeric(10,6) default 0 not null,
  duration_ms integer,
  ok boolean default true not null,
  error text,
  details jsonb,
  constraint ai_usage_pkey primary key (id),
  constraint ai_usage_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete set null
);

-- Settings edited in the app: brief_copy_recipients (array of addresses),
-- engagement_alerts ({enabled, opens, clicks, off_for}), sending_domains
-- (array of domains). Defaults in supabase/seed.sql.
create table public.app_settings (
  key text not null,
  value jsonb default '{}'::jsonb not null,
  updated_at timestamptz default now() not null,
  updated_by uuid,
  constraint app_settings_pkey primary key (key),
  constraint app_settings_updated_by_fkey foreign key (updated_by) references auth.users(id) on delete set null
);

-- Email infrastructure (Resend through pgmq queues).
create table public.email_send_log (
  id uuid default gen_random_uuid() not null,
  message_id text,
  template_name text not null,
  recipient_email text not null,
  status text not null,
  error_message text,
  metadata jsonb,
  created_at timestamptz default now() not null,
  constraint email_send_log_pkey primary key (id),
  constraint email_send_log_status_check check ((status = any (array['pending'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'bounced'::text, 'complained'::text, 'dlq'::text])))
);

-- One row: the Retry-After cooldown and the queue's throughput settings.
create table public.email_send_state (
  id integer default 1 not null,
  retry_after_until timestamptz,
  batch_size integer default 10 not null,
  send_delay_ms integer default 200 not null,
  auth_email_ttl_minutes integer default 15 not null,
  transactional_email_ttl_minutes integer default 60 not null,
  updated_at timestamptz default now() not null,
  constraint email_send_state_pkey primary key (id),
  constraint email_send_state_id_check check ((id = 1))
);
insert into public.email_send_state (id) values (1) on conflict do nothing;

create table public.email_unsubscribe_tokens (
  id uuid default gen_random_uuid() not null,
  token text not null,
  email text not null,
  created_at timestamptz default now() not null,
  used_at timestamptz,
  constraint email_unsubscribe_tokens_email_key unique (email),
  constraint email_unsubscribe_tokens_token_key unique (token),
  constraint email_unsubscribe_tokens_pkey primary key (id)
);

-- Append-only: no delete or update policy, so a suppression cannot be undone
-- from the app.
create table public.suppressed_emails (
  id uuid default gen_random_uuid() not null,
  email text not null,
  reason text not null,
  metadata jsonb,
  created_at timestamptz default now() not null,
  constraint suppressed_emails_email_key unique (email),
  constraint suppressed_emails_pkey primary key (id),
  constraint suppressed_emails_reason_check check ((reason = any (array['unsubscribe'::text, 'bounce'::text, 'complaint'::text])))
);

-- Resend webhook events, linked to a company through email_send_log.metadata.
create table public.email_events (
  id uuid default gen_random_uuid() not null,
  message_id text,
  email_id text,
  event_type text not null,
  recipient_email text not null,
  url text,
  occurred_at timestamptz not null,
  company_search_id uuid,
  consultant_id uuid,
  contact_name text,
  dedupe_key text not null,
  raw jsonb,
  created_at timestamptz default now() not null,
  constraint email_events_dedupe_key_key unique (dedupe_key),
  constraint email_events_pkey primary key (id),
  constraint email_events_consultant_id_fkey foreign key (consultant_id) references public.consultants(id) on delete set null,
  constraint email_events_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint email_events_event_type_check check ((event_type = any (array['sent'::text, 'delivered'::text, 'delivery_delayed'::text, 'opened'::text, 'clicked'::text, 'bounced'::text, 'complained'::text])))
);

create table public.email_signatures (
  email text not null,
  full_name text not null,
  job_title text default ''::text not null,
  mobile text default ''::text not null,
  updated_at timestamptz default now() not null,
  updated_by uuid,
  office_phone text default ''::text not null,
  linkedin_url text default ''::text not null,
  constraint email_signatures_pkey primary key (email),
  constraint email_signatures_updated_by_fkey foreign key (updated_by) references public.profiles(id) on delete set null,
  constraint email_signatures_email_lower check ((email = lower(email)))
);

-- Queued analyses (refresh-all-companies fills it, dispatch_analyze_company_queue
-- drains it). payload.companyId is the company_searches id; prefetchUrls /
-- prefetch / prefetched_at are the pg_net follow-up pass (Phase 6 slice 0).
create table public.analyze_company_queue (
  id bigint generated by default as identity not null,
  payload jsonb not null,
  target_url text not null,
  enqueued_at timestamptz default now() not null,
  dispatched_at timestamptz,
  request_id bigint,
  error text,
  prefetched_at timestamptz,
  constraint analyze_company_queue_pkey primary key (id)
);

-- Queued copy sets (enqueue_copy_generation fills it, dispatch_copy_queue drains it).
create table public.copy_queue (
  id bigint generated by default as identity not null,
  company_search_id uuid not null,
  personas text[] not null,
  trigger text default 'nightly'::text not null,
  force boolean default false not null,
  enqueued_at timestamptz default now() not null,
  dispatched_at timestamptz,
  request_id bigint,
  error text,
  constraint copy_queue_pkey primary key (id),
  constraint copy_queue_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade
);

-- Per-user rate limit for analyze-company (counted in the function).
create table public.analyze_company_requests (
  id bigint generated always as identity not null,
  user_id uuid not null,
  company_url text,
  created_at timestamptz default now() not null,
  constraint analyze_company_requests_pkey primary key (id)
);

-- One row per pipeline pass: snapshot, primary, secondary, compare, scores,
-- friday_brief, and the syncs (companies_house, ats_boards).
create table public.pipeline_runs (
  id uuid default gen_random_uuid() not null,
  phase text not null,
  config_id uuid,
  started_at timestamptz default now() not null,
  finished_at timestamptz,
  companies_total integer,
  companies_refreshed_today integer,
  new_count integer,
  status text default 'running'::text not null,
  error text,
  details jsonb,
  constraint pipeline_runs_pkey primary key (id)
);

-- One row per company per analysis run.
create table public.company_refresh_runs (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid,
  started_at timestamptz default now() not null,
  finished_at timestamptz,
  sources_tried text[] default '{}'::text[] not null,
  sources_ok text[] default '{}'::text[] not null,
  vacancies_found integer default 0 not null,
  degraded boolean default false not null,
  error text,
  notes jsonb,
  constraint company_refresh_runs_pkey primary key (id),
  constraint company_refresh_runs_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade
);

-- Evidence: one statement per key, with the quote and the page it came from.
create table public.company_facts (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid not null,
  statement_key text not null,
  kind text not null,
  statement text not null,
  quote text not null,
  source_url text not null,
  date_hint text,
  first_seen date default current_date not null,
  last_seen date default current_date not null,
  active boolean default true not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint company_facts_company_search_id_statement_key_key unique (company_search_id, statement_key),
  constraint company_facts_pkey primary key (id),
  constraint company_facts_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade
);

create table public.company_signals (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid not null,
  code text not null,
  label text not null,
  strength smallint not null,
  evidence jsonb default '[]'::jsonb not null,
  explanation text not null,
  computed_at timestamptz default now() not null,
  constraint company_signals_company_search_id_code_key unique (company_search_id, code),
  constraint company_signals_pkey primary key (id),
  constraint company_signals_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint company_signals_strength_check check (((strength >= 1) and (strength <= 3)))
);

-- The propensity score.
create table public.company_scores (
  company_search_id uuid not null,
  score smallint not null,
  breakdown jsonb default '[]'::jsonb not null,
  top_reason text,
  top_code text,
  signals_computed_at timestamptz,
  computed_at timestamptz default now() not null,
  constraint company_scores_pkey primary key (company_search_id),
  constraint company_scores_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint company_scores_score_check check (((score >= 0) and (score <= 100)))
);

-- The per-persona scripts and emails (docs/PORT-CONTRACTS.md, Copy).
create table public.company_copy (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid not null,
  persona text not null,
  copy jsonb not null,
  contact jsonb,
  evidence_fingerprint text,
  quality_flags text[] default '{}'::text[] not null,
  model text not null,
  trigger text default 'manual'::text not null,
  generated_at timestamptz default now() not null,
  created_at timestamptz default now() not null,
  constraint company_copy_company_search_id_persona_key unique (company_search_id, persona),
  constraint company_copy_pkey primary key (id),
  constraint company_copy_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint company_copy_persona_check check ((persona = any (array['founder'::text, 'coo'::text, 'people'::text, 'cto'::text, 'investor'::text])))
);

-- A consultant's corrections to a company's contacts (newest per contact_key
-- wins, never deleted; merged over analysis_result.decisionMakers at read).
create table public.company_contact_edits (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid not null,
  contact_key text not null,
  name text,
  role text,
  email text,
  phone text,
  note text,
  action text not null,
  edited_by uuid,
  edited_by_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint company_contact_edits_pkey primary key (id),
  constraint company_contact_edits_edited_by_fkey foreign key (edited_by) references public.profiles(id) on delete set null,
  constraint company_contact_edits_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint company_contact_edits_action_check check ((action = any (array['edit'::text, 'add'::text, 'remove'::text]))),
  constraint company_contact_edits_contact_key_check check ((contact_key <> ''::text))
);

create table public.contact_feedback (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid not null,
  email text,
  contact_name text,
  contact_role text,
  kind text not null,
  reporter_email text,
  created_at timestamptz default now() not null,
  constraint contact_feedback_pkey primary key (id),
  constraint contact_feedback_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint contact_feedback_kind_check check ((kind = any (array['bounced'::text, 'wrong_person'::text, 'left'::text])))
);

-- One row per observed vacancy per company. company_search_id is nullable
-- for a role a consultant typed in (source consultant) with no company yet.
create table public.vacancies (
  id uuid default gen_random_uuid() not null,
  company_search_id uuid,
  vacancy_key text not null,
  title text not null,
  url text,
  source public.vacancy_source default 'other'::public.vacancy_source not null,
  employer_name text,
  closing_date date,
  start_text text,
  first_seen date default current_date not null,
  last_seen date default current_date not null,
  status text default 'open'::text not null,
  rejected_reason text,
  raw jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  external_refs jsonb default '{}'::jsonb not null,
  constraint vacancies_company_search_id_vacancy_key_key unique (company_search_id, vacancy_key),
  constraint vacancies_pkey primary key (id),
  constraint vacancies_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint vacancies_status_check check ((status = any (array['open'::text, 'closed'::text, 'rejected'::text])))
);

-- Who gets which alert. Real consultants live here: never send while testing.
create table public.vacancy_alert_settings (
  id uuid default gen_random_uuid() not null,
  email text not null,
  daily_alerts boolean default true not null,
  weekly_alerts boolean default true not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  la_filter text,
  consultant_filter text,
  auto_refresh_enabled boolean default false not null,
  name text,
  alert_type text default 'deadline'::text not null,
  enabled boolean default true not null,
  consultant_id uuid,
  extra_recipients text[] default '{}'::text[] not null,
  constraint vacancy_alert_settings_pkey primary key (id),
  constraint vacancy_alert_settings_consultant_id_fkey foreign key (consultant_id) references public.consultants(id) on delete set null
);

create table public.alert_deliveries (
  config_id uuid not null,
  vacancy_id uuid not null,
  pipeline_run_id uuid,
  sent_at timestamptz default now() not null,
  note text,
  constraint alert_deliveries_pkey primary key (config_id, vacancy_id),
  constraint alert_deliveries_config_id_fkey foreign key (config_id) references public.vacancy_alert_settings(id) on delete cascade,
  constraint alert_deliveries_vacancy_id_fkey foreign key (vacancy_id) references public.vacancies(id) on delete cascade
);

create table public.vacancy_feedback (
  id uuid default gen_random_uuid() not null,
  vacancy_id uuid not null,
  kind text not null,
  reporter_email text,
  token text,
  created_at timestamptz default now() not null,
  constraint vacancy_feedback_pkey primary key (id),
  constraint vacancy_feedback_vacancy_id_fkey foreign key (vacancy_id) references public.vacancies(id) on delete cascade,
  constraint vacancy_feedback_kind_check check ((kind = any (array['wrong_company'::text, 'closed'::text, 'not_a_vacancy'::text])))
);

-- The ATS feeds a company's roles are read from (docs/PORT-CONTRACTS.md,
-- Open roles). A feed is read only for a confirmed slug.
create table public.ats_boards (
  company_search_id uuid not null,
  provider text not null,
  slug text not null,
  board_url text,
  confirmed_at timestamptz,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_count integer,
  note text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint ats_boards_pkey primary key (company_search_id, provider),
  constraint ats_boards_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint ats_boards_provider_check check ((provider = any (array['ashby'::text, 'greenhouse'::text, 'lever'::text, 'workable'::text]))),
  constraint ats_boards_slug_check check ((slug <> ''::text))
);

-- The Companies House register, one row per company number as stored on
-- company_searches (normalised: 8 characters, numeric ones zero-padded,
-- prefixes upper case). Columns follow the CompanyRecord contract; raw
-- keeps the profile the register answered with.
create table public.company_records (
  company_number text not null,
  name text not null,
  previous_names text[] default '{}'::text[] not null,
  status text,
  incorporation_date date,
  sic_codes text[] default '{}'::text[] not null,
  registered_office jsonb,
  postcode_district text,
  accounts_type text,
  last_accounts_made_up_to date,
  last_confirmation_statement date,
  fetched_at timestamptz default now() not null,
  verified boolean default false not null,
  note text,
  raw jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint company_records_pkey primary key (company_number),
  constraint company_records_company_number_check check ((company_number <> ''::text))
);

-- Officers, current and resigned. officer_key is what an upsert conflicts
-- on: the register's officer id when it gives one, else name, role and
-- appointment date; a trigger fills it when the row does not carry it.
create table public.ch_officers (
  id uuid default gen_random_uuid() not null,
  company_number text not null,
  officer_key text not null,
  officer_id text,
  name text not null,
  role text not null,
  appointed_on date,
  resigned_on date,
  first_seen_at timestamptz default now() not null,
  last_seen_at timestamptz default now() not null,
  raw jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint ch_officers_pkey primary key (id),
  constraint ch_officers_company_number_officer_key_key unique (company_number, officer_key),
  constraint ch_officers_company_number_fkey foreign key (company_number) references public.company_records(company_number) on delete cascade
);

-- Capital filings (SH01 and friends). filing_key is the register's
-- transaction id when given, else date, type and description.
create table public.ch_filings (
  id uuid default gen_random_uuid() not null,
  company_number text not null,
  filing_key text not null,
  transaction_id text,
  date date not null,
  type text not null,
  category text default 'capital'::text not null,
  description text not null,
  first_seen_at timestamptz default now() not null,
  raw jsonb,
  created_at timestamptz default now() not null,
  constraint ch_filings_pkey primary key (id),
  constraint ch_filings_company_number_filing_key_key unique (company_number, filing_key),
  constraint ch_filings_company_number_fkey foreign key (company_number) references public.company_records(company_number) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------

create index company_consultants_consultant on public.company_consultants using btree (consultant_id);
create index outcomes_callback on public.outcomes using btree (callback_at) where (callback_at is not null);
create index outcomes_company_time on public.outcomes using btree (company_search_id, created_at desc);
create index idx_ai_usage_created on public.ai_usage using btree (created_at desc);
create index idx_ai_usage_company on public.ai_usage using btree (company_search_id);
create index idx_email_send_log_created on public.email_send_log using btree (created_at desc);
create index idx_email_send_log_message on public.email_send_log using btree (message_id);
-- Only one 'sent' row per message: the database-level guard against a double send.
create unique index idx_email_send_log_message_sent_unique on public.email_send_log using btree (message_id) where (status = 'sent'::text);
create index idx_email_send_log_recipient on public.email_send_log using btree (recipient_email);
create index idx_email_send_log_template_created on public.email_send_log using btree (template_name, created_at desc);
create index idx_unsubscribe_tokens_token on public.email_unsubscribe_tokens using btree (token);
create index idx_suppressed_emails_email on public.suppressed_emails using btree (email);
create index email_events_message on public.email_events using btree (message_id);
create index email_events_recipient on public.email_events using btree (recipient_email);
create index email_events_company_time on public.email_events using btree (company_search_id, occurred_at desc) where (company_search_id is not null);
create index email_events_time on public.email_events using btree (occurred_at desc);
create index idx_analyze_company_queue_pending on public.analyze_company_queue using btree (id) where (dispatched_at is null);
-- One pending analysis per company; enqueue_analyze_company_batch conflicts on it.
create unique index uq_analyze_company_queue_pending_company on public.analyze_company_queue using btree (((payload ->> 'companyId'::text))) where (dispatched_at is null);
create index idx_copy_queue_pending on public.copy_queue using btree (id) where (dispatched_at is null);
create unique index uq_copy_queue_pending_company on public.copy_queue using btree (company_search_id) where (dispatched_at is null);
create index analyze_company_requests_user_time on public.analyze_company_requests using btree (user_id, created_at desc);
create index idx_pipeline_runs_phase_started on public.pipeline_runs using btree (phase, started_at desc);
create index idx_company_refresh_runs_company_started on public.company_refresh_runs using btree (company_search_id, started_at desc);
create index idx_company_refresh_runs_started on public.company_refresh_runs using btree (started_at desc);
create index idx_company_searches_created_at on public.company_searches using btree (created_at desc);
create index idx_company_searches_company_name on public.company_searches using btree (company_name);
create index idx_company_searches_company_number on public.company_searches using btree (company_number) where (company_number is not null);
create index idx_company_facts_company_active on public.company_facts using btree (company_search_id) where active;
create index idx_company_signals_company on public.company_signals using btree (company_search_id);
create index idx_company_scores_score on public.company_scores using btree (score desc);
create index idx_company_copy_company on public.company_copy using btree (company_search_id);
create index company_contact_edits_company on public.company_contact_edits using btree (company_search_id, contact_key, created_at desc);
create index idx_contact_feedback_company on public.contact_feedback using btree (company_search_id);
create index idx_vacancies_first_seen on public.vacancies using btree (first_seen);
create index idx_vacancies_company on public.vacancies using btree (company_search_id);
create index idx_vacancies_status_closing on public.vacancies using btree (status, closing_date);
create index idx_vacancy_feedback_vacancy on public.vacancy_feedback using btree (vacancy_id);
create index idx_ats_boards_confirmed on public.ats_boards using btree (provider, slug) where (confirmed_at is not null);
create index idx_company_records_name on public.company_records using btree (name);
create index idx_ch_officers_company on public.ch_officers using btree (company_number, appointed_on desc);
create index idx_ch_filings_company_date on public.ch_filings using btree (company_number, date desc);

-- ---------------------------------------------------------------------------
-- 7. Row security and policies
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.consultants enable row level security;
alter table public.company_searches enable row level security;
alter table public.company_consultants enable row level security;
alter table public.outcomes enable row level security;
alter table public.ai_usage enable row level security;
alter table public.app_settings enable row level security;
alter table public.email_send_log enable row level security;
alter table public.email_send_state enable row level security;
alter table public.email_unsubscribe_tokens enable row level security;
alter table public.suppressed_emails enable row level security;
alter table public.email_events enable row level security;
alter table public.email_signatures enable row level security;
alter table public.analyze_company_queue enable row level security;
alter table public.copy_queue enable row level security;
alter table public.analyze_company_requests enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.company_refresh_runs enable row level security;
alter table public.company_facts enable row level security;
alter table public.company_signals enable row level security;
alter table public.company_scores enable row level security;
alter table public.company_copy enable row level security;
alter table public.company_contact_edits enable row level security;
alter table public.contact_feedback enable row level security;
alter table public.vacancies enable row level security;
alter table public.vacancy_alert_settings enable row level security;
alter table public.alert_deliveries enable row level security;
alter table public.vacancy_feedback enable row level security;
alter table public.ats_boards enable row level security;
alter table public.company_records enable row level security;
alter table public.ch_officers enable row level security;
alter table public.ch_filings enable row level security;

-- profiles
create policy "App users can read profiles" on public.profiles for select to authenticated
  using (public.is_app_user());
create policy "Managers can update profiles" on public.profiles for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());
create policy "Users can update their own display name" on public.profiles for update to authenticated
  using ((id = auth.uid()))
  with check (((id = auth.uid()) and (role = (select p.role from public.profiles p where (p.id = auth.uid()))) and (email = (select p.email from public.profiles p where (p.id = auth.uid()))) and (not (consultant_id is distinct from (select p.consultant_id from public.profiles p where (p.id = auth.uid()))))));

-- consultants
create policy "App users can read consultants" on public.consultants for select to authenticated
  using (public.is_app_user());
create policy "Managers can add consultants" on public.consultants for insert to authenticated
  with check (public.is_manager());
create policy "Managers can delete consultants" on public.consultants for delete to authenticated
  using (public.is_manager());
create policy "Managers can update consultants" on public.consultants for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());
create policy "Service role manages consultants" on public.consultants for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_searches
create policy "App users can add companies" on public.company_searches for insert to authenticated
  with check (public.is_app_user());
create policy "App users can read companies" on public.company_searches for select to authenticated
  using (public.is_app_user());
create policy "App users can update companies" on public.company_searches for update to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());
create policy "Managers can delete companies" on public.company_searches for delete to authenticated
  using (public.is_manager());
create policy "Service role manages companies" on public.company_searches for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_consultants
create policy "App users can assign companies" on public.company_consultants for insert to authenticated
  with check (public.is_app_user());
create policy "App users can read assignments" on public.company_consultants for select to authenticated
  using (public.is_app_user());
create policy "Own or manager can unassign companies" on public.company_consultants for delete to authenticated
  using ((public.is_app_user() and public.owns_alert_setting(null::text, consultant_id)));
create policy "Service role manages assignments" on public.company_consultants for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- outcomes
create policy "App users can log outcomes" on public.outcomes for insert to authenticated
  with check ((public.is_app_user() and (created_by = auth.uid())));
create policy "App users can read outcomes" on public.outcomes for select to authenticated
  using (public.is_app_user());
create policy "Own outcomes or managers can delete" on public.outcomes for delete to authenticated
  using ((public.is_app_user() and ((created_by = auth.uid()) or public.is_manager())));
create policy "Own outcomes or managers can update" on public.outcomes for update to authenticated
  using ((public.is_app_user() and ((created_by = auth.uid()) or public.is_manager())))
  with check ((public.is_app_user() and ((created_by = auth.uid()) or public.is_manager())));
create policy "Service role manages outcomes" on public.outcomes for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- ai_usage
create policy "Managers can read ai_usage" on public.ai_usage for select to authenticated
  using (public.is_manager());
create policy "Service role can manage ai_usage" on public.ai_usage for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- app_settings
create policy "App users read settings" on public.app_settings for select to authenticated
  using (public.is_app_user());
create policy "Managers write settings" on public.app_settings for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());
create policy "Service role manages settings" on public.app_settings for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- email_send_log
create policy "Service role can insert send log" on public.email_send_log for insert to public
  with check ((auth.role() = 'service_role'::text));
create policy "Service role can read send log" on public.email_send_log for select to public
  using ((auth.role() = 'service_role'::text));
create policy "Service role can update send log" on public.email_send_log for update to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- email_send_state
create policy "Service role can manage send state" on public.email_send_state for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- email_unsubscribe_tokens
create policy "Service role can insert tokens" on public.email_unsubscribe_tokens for insert to public
  with check ((auth.role() = 'service_role'::text));
create policy "Service role can mark tokens as used" on public.email_unsubscribe_tokens for update to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));
create policy "Service role can read tokens" on public.email_unsubscribe_tokens for select to public
  using ((auth.role() = 'service_role'::text));

-- suppressed_emails (append-only)
create policy "Service role can insert suppressed emails" on public.suppressed_emails for insert to public
  with check ((auth.role() = 'service_role'::text));
create policy "Service role can read suppressed emails" on public.suppressed_emails for select to public
  using ((auth.role() = 'service_role'::text));

-- email_events
create policy "Consultants read email events for their companies" on public.email_events for select to authenticated
  using ((public.is_app_user() and (company_search_id is not null) and (exists ( select 1
   from public.company_consultants sc
  where ((sc.company_search_id = email_events.company_search_id) and (sc.consultant_id in ( select public.my_consultant_ids() as my_consultant_ids)))))));
create policy "Managers read email events" on public.email_events for select to authenticated
  using (public.is_manager());
create policy "Service role manages email events" on public.email_events for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- email_signatures
create policy "App users read email signatures" on public.email_signatures for select to authenticated
  using (public.is_app_user());
create policy "Own signature or manager updates" on public.email_signatures for update to authenticated
  using ((public.is_manager() or (email = lower(coalesce((auth.jwt() ->> 'email'::text), ''::text)))))
  with check ((public.is_manager() or (email = lower(coalesce((auth.jwt() ->> 'email'::text), ''::text)))));
create policy "Service role manages email signatures" on public.email_signatures for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- analyze_company_queue, copy_queue, analyze_company_requests: service role only
create policy "Service role can manage analyze_company_queue" on public.analyze_company_queue for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));
create policy "Service role can manage copy_queue" on public.copy_queue for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));
create policy "Service role manages analyze_company_requests" on public.analyze_company_requests for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- pipeline_runs
create policy "App users can read pipeline_runs" on public.pipeline_runs for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage pipeline_runs" on public.pipeline_runs for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_refresh_runs
create policy "App users can read company_refresh_runs" on public.company_refresh_runs for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage company_refresh_runs" on public.company_refresh_runs for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_facts
create policy "App users can read company_facts" on public.company_facts for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage company_facts" on public.company_facts for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_signals
create policy "App users can read company_signals" on public.company_signals for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage company_signals" on public.company_signals for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_scores
create policy "App users can read company_scores" on public.company_scores for select to authenticated
  using (public.is_app_user());
create policy "Service role manages company_scores" on public.company_scores for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_copy
create policy "App users can read company_copy" on public.company_copy for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage company_copy" on public.company_copy for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_contact_edits
create policy "Consultants add contact edits for their companies" on public.company_contact_edits for insert to authenticated
  with check ((public.is_app_user() and (edited_by = auth.uid()) and (exists ( select 1
   from public.company_consultants sc
  where ((sc.company_search_id = company_contact_edits.company_search_id) and (sc.consultant_id in ( select public.my_consultant_ids() as my_consultant_ids)))))));
create policy "Consultants change their own contact edits" on public.company_contact_edits for update to authenticated
  using ((public.is_app_user() and (edited_by = auth.uid()) and (exists ( select 1
   from public.company_consultants sc
  where ((sc.company_search_id = company_contact_edits.company_search_id) and (sc.consultant_id in ( select public.my_consultant_ids() as my_consultant_ids)))))))
  with check ((public.is_app_user() and (edited_by = auth.uid()) and (exists ( select 1
   from public.company_consultants sc
  where ((sc.company_search_id = company_contact_edits.company_search_id) and (sc.consultant_id in ( select public.my_consultant_ids() as my_consultant_ids)))))));
create policy "Consultants read contact edits for their companies" on public.company_contact_edits for select to authenticated
  using ((public.is_app_user() and (exists ( select 1
   from public.company_consultants sc
  where ((sc.company_search_id = company_contact_edits.company_search_id) and (sc.consultant_id in ( select public.my_consultant_ids() as my_consultant_ids)))))));
create policy "Managers change contact edits" on public.company_contact_edits for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());
create policy "Managers read contact edits" on public.company_contact_edits for select to authenticated
  using (public.is_manager());
create policy "Managers write contact edits" on public.company_contact_edits for insert to authenticated
  with check ((public.is_manager() and (edited_by = auth.uid())));
create policy "Service role manages contact edits" on public.company_contact_edits for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- contact_feedback
create policy "App users can read contact_feedback" on public.contact_feedback for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage contact_feedback" on public.contact_feedback for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- vacancies
create policy "App users can read vacancies" on public.vacancies for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage vacancies" on public.vacancies for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- vacancy_alert_settings
create policy "App users can add alert settings" on public.vacancy_alert_settings for insert to authenticated
  with check (public.is_app_user());
create policy "App users can read alert settings" on public.vacancy_alert_settings for select to authenticated
  using (public.is_app_user());
create policy "Owners and managers can delete alert settings" on public.vacancy_alert_settings for delete to authenticated
  using ((public.is_app_user() and public.owns_alert_setting(email, consultant_id)));
create policy "Owners and managers can update alert settings" on public.vacancy_alert_settings for update to authenticated
  using ((public.is_app_user() and public.owns_alert_setting(email, consultant_id)))
  with check ((public.is_app_user() and public.owns_alert_setting(email, consultant_id)));
create policy "Service role manages alert settings" on public.vacancy_alert_settings for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- alert_deliveries
create policy "App users can read alert_deliveries" on public.alert_deliveries for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage alert_deliveries" on public.alert_deliveries for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- vacancy_feedback
create policy "App users can read vacancy_feedback" on public.vacancy_feedback for select to authenticated
  using (public.is_app_user());
create policy "Service role can manage vacancy_feedback" on public.vacancy_feedback for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- ats_boards
create policy "App users can read ats_boards" on public.ats_boards for select to authenticated
  using (public.is_app_user());
create policy "Service role manages ats_boards" on public.ats_boards for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- company_records, ch_officers, ch_filings: read by app users, written by
-- the service role only (no authenticated write policy, no write grant).
create policy "App users can read company_records" on public.company_records for select to authenticated
  using (public.is_app_user());
create policy "Service role manages company_records" on public.company_records for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));
create policy "App users can read ch_officers" on public.ch_officers for select to authenticated
  using (public.is_app_user());
create policy "Service role manages ch_officers" on public.ch_officers for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));
create policy "App users can read ch_filings" on public.ch_filings for select to authenticated
  using (public.is_app_user());
create policy "Service role manages ch_filings" on public.ch_filings for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
-- Supabase grants every new table to anon and authenticated by default; the
-- anon key gets nothing here, and authenticated gets only what the policies
-- above can ever allow. The service role keeps everything.

do $$
declare
  t text;
  app_writes text[] := array['profiles', 'consultants', 'company_consultants', 'company_searches', 'outcomes', 'app_settings', 'email_signatures', 'vacancy_alert_settings'];
  service_only text[] := array['email_send_log', 'email_send_state', 'email_unsubscribe_tokens', 'suppressed_emails', 'analyze_company_queue', 'copy_queue', 'analyze_company_requests'];
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    if t = any (service_only) then
      continue;
    elsif t = any (app_writes) then
      execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    elsif t = 'company_contact_edits' then
      execute format('grant select, insert, update on table public.%I to authenticated', t);
    else
      execute format('grant select on table public.%I to authenticated', t);
    end if;
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S' loop
    execute format('revoke all on sequence public.%I from anon, authenticated', t);
    execute format('grant all on sequence public.%I to service_role', t);
  end loop;
end $$;

-- Functions: the anon key may call nothing; a signed-in user may call the
-- policy helpers (PostgREST evaluates them inside policies as the caller)
-- and nothing internal.
revoke all on function public.is_allowed_login_email(text), public.display_name_from_email(text), public.is_app_user(), public.app_role(), public.is_manager(), public.has_feature(text), public.my_consultant_ids(), public.owns_alert_setting(text, uuid) from public, anon;
grant execute on function public.is_allowed_login_email(text), public.display_name_from_email(text), public.is_app_user(), public.app_role(), public.is_manager(), public.has_feature(text), public.my_consultant_ids(), public.owns_alert_setting(text, uuid) to authenticated, service_role;

revoke all on function public.auth_before_user_created(jsonb) from public, anon, authenticated;
revoke all on function public.handle_new_auth_user(), public.link_profile_to_consultant(), public.touch_updated_at(), public.update_updated_at_column(), public.update_company_searches_updated_at() from public, anon, authenticated;

-- Auth calls the hook as supabase_auth_admin (a Supabase role; the local
-- test cluster creates it too).
grant execute on function public.auth_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 9. Triggers
-- ---------------------------------------------------------------------------

-- Keeps analysis_result.consultant (the tag the list filters on) equal to the
-- assigned consultants' names.
create or replace function public.sync_company_consultant_tag()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := coalesce(new.company_search_id, old.company_search_id);
  v_tag text;
begin
  select string_agg(c.name, ', ' order by c.name) into v_tag
  from public.company_consultants sc join public.consultants c on c.id = sc.consultant_id
  where sc.company_search_id = v_company;
  update public.company_searches
  set analysis_result = case when v_tag is null then analysis_result - 'consultant' else jsonb_set(coalesce(analysis_result, '{}'::jsonb), '{consultant}', to_jsonb(v_tag)) end
  where id = v_company;
  return null;
end;
$$;
revoke all on function public.sync_company_consultant_tag() from public, anon, authenticated;

-- ch_officers.officer_key and ch_filings.filing_key when the row does not carry them.
create or replace function public.fill_ch_officer_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.officer_key is null or new.officer_key = '' then
    new.officer_key := coalesce(nullif(new.officer_id, ''), lower(new.name) || '|' || lower(new.role) || '|' || coalesce(new.appointed_on::text, ''));
  end if;
  new.last_seen_at := coalesce(new.last_seen_at, now());
  return new;
end;
$$;

create or replace function public.fill_ch_filing_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.filing_key is null or new.filing_key = '' then
    new.filing_key := coalesce(nullif(new.transaction_id, ''), new.date::text || '|' || new.type || '|' || md5(new.description));
  end if;
  return new;
end;
$$;
revoke all on function public.fill_ch_officer_key(), public.fill_ch_filing_key() from public, anon, authenticated;

create trigger profiles_link_consultant before insert on public.profiles for each row execute function public.link_profile_to_consultant();
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger consultants_touch_updated_at before update on public.consultants for each row execute function public.touch_updated_at();
create trigger company_consultants_sync_tag after insert or delete on public.company_consultants for each row execute function public.sync_company_consultant_tag();
create trigger outcomes_touch_updated_at before update on public.outcomes for each row execute function public.touch_updated_at();
create trigger app_settings_touch before update on public.app_settings for each row execute function public.touch_updated_at();
create trigger email_signatures_touch_updated_at before update on public.email_signatures for each row execute function public.touch_updated_at();
create trigger update_company_searches_updated_at before update on public.company_searches for each row execute function public.update_company_searches_updated_at();
create trigger trg_company_facts_updated_at before update on public.company_facts for each row execute function public.update_updated_at_column();
create trigger company_contact_edits_touch_updated_at before update on public.company_contact_edits for each row execute function public.touch_updated_at();
create trigger trg_vacancies_updated_at before update on public.vacancies for each row execute function public.update_updated_at_column();
create trigger ats_boards_touch_updated_at before update on public.ats_boards for each row execute function public.touch_updated_at();
create trigger trg_company_records_updated_at before update on public.company_records for each row execute function public.update_updated_at_column();
create trigger ch_officers_fill_key before insert or update on public.ch_officers for each row execute function public.fill_ch_officer_key();
create trigger ch_officers_touch_updated_at before update on public.ch_officers for each row execute function public.touch_updated_at();
create trigger ch_filings_fill_key before insert or update on public.ch_filings for each row execute function public.fill_ch_filing_key();

-- ---------------------------------------------------------------------------
-- 10. Application functions (no queue extension needed)
-- ---------------------------------------------------------------------------

-- A run with no finish inside p_minutes was killed; close it as degraded.
create or replace function public.close_stale_refresh_runs(p_minutes integer default 10)
returns integer
language plpgsql security definer
set search_path = 'public'
as $$
declare
  n integer;
begin
  update public.company_refresh_runs
     set finished_at = now(),
         degraded = true,
         error = coalesce(error, 'timed out: no finish within ' || p_minutes || ' minutes (worker killed?)'),
         notes = coalesce(notes, '{}'::jsonb) || jsonb_build_object('stage', 'timed_out', 'closedBy', 'close_stale_refresh_runs')
   where finished_at is null
     and started_at < now() - make_interval(mins => p_minutes);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- refresh-all-companies queues one payload per company; a company already
-- waiting is not queued twice (payload.companyId).
create or replace function public.enqueue_analyze_company_batch(payloads jsonb, target_url text, auth_token text)
returns integer
language plpgsql security definer
set search_path = 'public'
as $$
declare
  enqueued integer := 0;
begin
  insert into public.analyze_company_queue (payload, target_url)
  select p, target_url from jsonb_array_elements(payloads) as p
  on conflict ((payload->>'companyId')) where dispatched_at is null do nothing;
  get diagnostics enqueued = row_count;
  return enqueued;
end;
$$;

-- Queue a copy set. The nightly path is capped per night (04:00 UTC to
-- 04:00 UTC); returns 'queued', 'duplicate' or 'capped'.
create or replace function public.enqueue_copy_generation(p_company_id uuid, p_personas text[], p_trigger text default 'nightly'::text, p_force boolean default false, p_nightly_cap integer default 60)
returns text
language plpgsql security definer
set search_path = 'public'
as $$
declare
  night_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '4 hours';
  used integer;
  inserted integer;
begin
  if now() < night_start then night_start := night_start - interval '1 day'; end if;
  if p_trigger = 'nightly' then
    select count(*) into used from public.copy_queue where trigger = 'nightly' and enqueued_at >= night_start;
    if used >= p_nightly_cap then
      return 'capped';
    end if;
  end if;
  insert into public.copy_queue (company_search_id, personas, trigger, force)
  values (p_company_id, p_personas, p_trigger, p_force)
  on conflict (company_search_id) where dispatched_at is null do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 'duplicate'; end if;
  return 'queued';
end;
$$;

-- Store one persona's copy inside analysis_result.copy (the frontend reads it
-- there); the legacy coldCallScript / warmEmailScript keys are kept for the
-- headline persona.
create or replace function public.set_company_copy(p_company_id uuid, p_persona text, p_copy jsonb, p_cold_call text default null::text, p_warm_email text default null::text)
returns void
language plpgsql security definer
set search_path = 'public'
as $$
begin
  update public.company_searches
  set analysis_result = coalesce(analysis_result, '{}'::jsonb)
        || jsonb_build_object('copy', coalesce(analysis_result->'copy', '{}'::jsonb) || jsonb_build_object(p_persona, p_copy))
        || case when p_cold_call is not null then jsonb_build_object('coldCallScript', p_cold_call) else '{}'::jsonb end
        || case when p_warm_email is not null then jsonb_build_object('warmEmailScript', p_warm_email) else '{}'::jsonb end,
      updated_at = now()
  where id = p_company_id;
end;
$$;

create or replace function public.set_analysis_signals(p_company_id uuid, p_signals jsonb, p_facts jsonb)
returns void
language sql security definer
set search_path = 'public'
as $$
  update public.company_searches
  set analysis_result = coalesce(analysis_result, '{}'::jsonb) || jsonb_build_object('signals', coalesce(p_signals, '[]'::jsonb), 'facts', coalesce(p_facts, '[]'::jsonb)),
      updated_at = now()
  where id = p_company_id;
$$;

-- AI spend by day and model for the monitoring page.
create or replace function public.get_ai_usage_summary()
returns jsonb
language sql stable security definer
set search_path = 'public'
as $$
  with days as (
    select (created_at at time zone 'UTC')::date as day, model, provider,
           count(*) as calls,
           sum(input_tokens) as input_tokens,
           sum(cached_input_tokens) as cached_input_tokens,
           sum(cache_write_tokens) as cache_write_tokens,
           sum(output_tokens) as output_tokens,
           sum(estimated_cost_usd) as cost_usd,
           count(*) filter (where not ok) as failed
    from public.ai_usage
    where created_at >= (now() at time zone 'UTC')::date - interval '13 days'
    group by 1, 2, 3
  )
  select jsonb_build_object(
    'byDay', coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc, d.model) from days d), '[]'::jsonb),
    'today', (select jsonb_build_object('calls', count(*), 'costUsd', coalesce(sum(estimated_cost_usd), 0), 'companies', count(distinct company_search_id))
              from public.ai_usage where created_at >= (now() at time zone 'UTC')::date),
    'month', (select jsonb_build_object('calls', count(*), 'costUsd', coalesce(sum(estimated_cost_usd), 0), 'companies', count(distinct company_search_id))
              from public.ai_usage where created_at >= date_trunc('month', now() at time zone 'UTC')),
    'copyQueuePending', (select count(*) from public.copy_queue where dispatched_at is null),
    'copyGeneratedToday', (select count(*) from public.company_copy where generated_at >= (now() at time zone 'UTC')::date)
  );
$$;

-- Alert email counters for the monitoring page (the last 30 days, the
-- newest log row per message).
create or replace function public.get_vacancy_email_counters()
returns jsonb
language plpgsql security definer
set search_path = 'public'
as $$
declare
  counters jsonb;
  by_day jsonb;
begin
  with latest as (
    select distinct on (message_id) message_id, template_name, status, created_at
    from public.email_send_log
    where template_name in ('new-vacancies-alert', 'friday-brief')
      and created_at >= now() - interval '30 days'
      and message_id is not null
    order by message_id, created_at desc
  )
  select jsonb_object_agg(template_name, stats)
  into counters
  from (
    select
      template_name,
      jsonb_build_object(
        'total', count(*),
        'sent', count(*) filter (where status = 'sent'),
        'failed', count(*) filter (where status in ('failed', 'dlq', 'bounced')),
        'suppressed', count(*) filter (where status = 'suppressed'),
        'lastSentAt', max(created_at) filter (where status = 'sent')
      ) as stats
    from latest
    group by template_name
  ) s;

  with latest as (
    select distinct on (message_id) template_name, created_at
    from public.email_send_log
    where template_name in ('new-vacancies-alert', 'friday-brief')
      and created_at >= now() - interval '30 days'
      and message_id is not null
    order by message_id, created_at desc
  )
  select jsonb_object_agg(day, by_template)
  into by_day
  from (
    select
      to_char(created_at, 'YYYY-MM-DD') as day,
      jsonb_object_agg(template_name, cnt) as by_template
    from (
      select to_char(created_at, 'YYYY-MM-DD') as d_str, created_at, template_name, count(*) as cnt
      from latest
      group by to_char(created_at, 'YYYY-MM-DD'), created_at, template_name
    ) g
    group by to_char(created_at, 'YYYY-MM-DD')
  ) d;

  counters := coalesce(counters, '{}'::jsonb);
  if not counters ? 'new-vacancies-alert' then
    counters := counters || jsonb_build_object('new-vacancies-alert',
      jsonb_build_object('total',0,'sent',0,'failed',0,'suppressed',0,'lastSentAt',null));
  end if;
  if not counters ? 'friday-brief' then
    counters := counters || jsonb_build_object('friday-brief',
      jsonb_build_object('total',0,'sent',0,'failed',0,'suppressed',0,'lastSentAt',null));
  end if;

  return jsonb_build_object('counters', counters, 'byDay', coalesce(by_day, '{}'::jsonb));
end;
$$;

-- Internal: not for the anon key or a logged-in browser. The two read-only
-- summaries the app may call directly are granted to authenticated.
revoke all on function
  public.close_stale_refresh_runs(integer),
  public.enqueue_analyze_company_batch(jsonb, text, text),
  public.enqueue_copy_generation(uuid, text[], text, boolean, integer),
  public.set_company_copy(uuid, text, jsonb, text, text),
  public.set_analysis_signals(uuid, jsonb, jsonb),
  public.get_ai_usage_summary(),
  public.get_vacancy_email_counters()
from public, anon, authenticated;
grant execute on function
  public.close_stale_refresh_runs(integer),
  public.enqueue_analyze_company_batch(jsonb, text, text),
  public.enqueue_copy_generation(uuid, text[], text, boolean, integer),
  public.set_company_copy(uuid, text, jsonb, text, text),
  public.set_analysis_signals(uuid, jsonb, jsonb),
  public.get_ai_usage_summary(),
  public.get_vacancy_email_counters()
to service_role;
grant execute on function public.get_ai_usage_summary() to authenticated;
