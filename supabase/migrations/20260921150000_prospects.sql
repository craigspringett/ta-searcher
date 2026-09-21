-- Prospects (slice 3, 21 September 2026, docs/PROSPECTING-BRIEF.md): the
-- companies the site finds on its own. discover-prospects (05:30 UTC)
-- writes one row per company name from the funding news, the Companies
-- House advanced search and the Adzuna and Reed job APIs;
-- qualify-prospects (05:40 UTC) fills the register, the website, the
-- boards and the score, and promotes the best into company_searches
-- (promoted_company_id). Read by app users; the signed-in user may only
-- dismiss (status, dismissed_at, dismiss_reason; the trigger below refuses
-- any other change); the service role writes the rest; anon nothing.
--
-- Applied by scripts/local-db-test.sh after the funding_news migration.

create table public.prospects (
  id uuid default gen_random_uuid() not null,
  name text not null,
  -- normaliseOrgName(name): one row per company however it was spelt.
  name_key text not null,
  website text,
  company_number text,
  status text default 'new'::text not null,
  -- [{source, url, title, at, note}] with source funding_news, companies_house, adzuna or reed.
  sources jsonb default '[]'::jsonb not null,
  -- {amountText, amountGbp, round, date, url} from the news.
  raise jsonb,
  -- {status, incorporationDate, sicCodes, sector, locality, postcodeDistrict, capitalFilings, matched, note}.
  register jsonb,
  -- [{provider, slug, boardUrl, count, talentRoles, titles, note}].
  boards jsonb default '[]'::jsonb not null,
  -- [{title, employer, source, url, date}] from the job APIs.
  talent_postings jsonb default '[]'::jsonb not null,
  prospect_score integer,
  -- [{points, text}].
  score_reasons jsonb default '[]'::jsonb not null,
  first_seen_at timestamptz default now() not null,
  last_seen_at timestamptz default now() not null,
  qualified_at timestamptz,
  promoted_at timestamptz,
  dismissed_at timestamptz,
  promoted_company_id uuid,
  dismiss_reason text,
  constraint prospects_pkey primary key (id),
  constraint prospects_name_key_key unique (name_key),
  constraint prospects_status_check check (status in ('new', 'qualified', 'promoted', 'dismissed', 'unsuitable')),
  constraint prospects_promoted_company_fkey foreign key (promoted_company_id) references public.company_searches(id) on delete set null
);

create index idx_prospects_status_score on public.prospects using btree (status, prospect_score desc nulls last);
create index idx_prospects_status_last_seen on public.prospects using btree (status, last_seen_at desc);
create index idx_prospects_promoted_at on public.prospects using btree (promoted_at desc);

alter table public.prospects enable row level security;

create policy "App users can read prospects" on public.prospects for select to authenticated
  using (public.is_app_user());
create policy "App users can dismiss prospects" on public.prospects for update to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());
create policy "Service role manages prospects" on public.prospects for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

-- The signed-in user's one write is a dismissal: status to dismissed (or
-- back to new to undo it), dismissed_at and dismiss_reason. Every other
-- column must stay as it was; the trigger refuses the row otherwise. Only
-- the authenticated role is guarded (PostgREST runs a signed-in user's
-- statements as it); the service role and a maintenance session are not.
-- The one change the role makes without meaning to is the foreign key's
-- own "on delete set null" when a company is deleted from the app, so a
-- row whose only change is promoted_company_id becoming null passes.
create or replace function public.prospects_user_update_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' or auth.role() = 'service_role' then
    return new;
  end if;
  -- The foreign key clearing promoted_company_id after a company delete.
  if new.promoted_company_id is null and old.promoted_company_id is not null
    and new.status is not distinct from old.status
    and new.dismissed_at is not distinct from old.dismissed_at
    and new.dismiss_reason is not distinct from old.dismiss_reason
    and new.name is not distinct from old.name
    and new.name_key is not distinct from old.name_key
    and new.website is not distinct from old.website
    and new.company_number is not distinct from old.company_number
    and new.sources is not distinct from old.sources
    and new.raise is not distinct from old.raise
    and new.register is not distinct from old.register
    and new.boards is not distinct from old.boards
    and new.talent_postings is not distinct from old.talent_postings
    and new.prospect_score is not distinct from old.prospect_score
    and new.score_reasons is not distinct from old.score_reasons
    and new.first_seen_at is not distinct from old.first_seen_at
    and new.last_seen_at is not distinct from old.last_seen_at
    and new.qualified_at is not distinct from old.qualified_at
    and new.promoted_at is not distinct from old.promoted_at
  then
    return new;
  end if;
  if new.status not in ('dismissed', 'new') then
    raise exception 'a signed-in user may only dismiss a prospect or reopen it';
  end if;
  if new.status = 'dismissed' and new.dismissed_at is null then
    new.dismissed_at := now();
  end if;
  if new.status = 'new' then
    new.dismissed_at := null;
    new.dismiss_reason := null;
  end if;
  if new.name is distinct from old.name
    or new.name_key is distinct from old.name_key
    or new.website is distinct from old.website
    or new.company_number is distinct from old.company_number
    or new.sources is distinct from old.sources
    or new.raise is distinct from old.raise
    or new.register is distinct from old.register
    or new.boards is distinct from old.boards
    or new.talent_postings is distinct from old.talent_postings
    or new.prospect_score is distinct from old.prospect_score
    or new.score_reasons is distinct from old.score_reasons
    or new.first_seen_at is distinct from old.first_seen_at
    or new.last_seen_at is distinct from old.last_seen_at
    or new.qualified_at is distinct from old.qualified_at
    or new.promoted_at is distinct from old.promoted_at
    or new.promoted_company_id is distinct from old.promoted_company_id
  then
    raise exception 'a signed-in user may only change status, dismissed_at and dismiss_reason on a prospect';
  end if;
  return new;
end;
$$;

create trigger prospects_user_update_guard
  before update on public.prospects
  for each row execute function public.prospects_user_update_guard();

revoke all on table public.prospects from anon;
revoke all on table public.prospects from authenticated;
grant select on table public.prospects to authenticated;
grant update (status, dismissed_at, dismiss_reason) on table public.prospects to authenticated;
grant all on table public.prospects to service_role;

-- The settings row the pass reads (the page edits the two numbers; the
-- register walk keeps its watermarks and cursor here).
insert into public.app_settings (key, value) values
  ('prospecting', '{"autoPromoteScore": 60, "weeklyPromoteCap": 15, "watermarks": {}, "registerCursor": 0}'::jsonb)
on conflict (key) do nothing;
