-- Parked prospects (23 September 2026; Craig: "for some of the younger
-- seed companies I don't want to add or dismiss, I'd like to essentially
-- park so if they then go through a Series A you bring them back up again
-- to consider"). A signed-in user may set status 'parked' (parked_at is
-- stamped); the nightly discovery brings a parked row back to 'new' with
-- wake_note when it sees a newer raise or a new Head of Talent posting
-- (_shared/prospecting/discover.ts, mergeIntoExisting), and the page
-- shows the note on the ready list. Bring back by hand sets 'new'.

alter table public.prospects drop constraint if exists prospects_status_check;
alter table public.prospects add constraint prospects_status_check
  check (status in ('new', 'qualified', 'promoted', 'dismissed', 'unsuitable', 'parked'));

alter table public.prospects add column if not exists parked_at timestamptz;
alter table public.prospects add column if not exists wake_note text;

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
    and new.parked_at is not distinct from old.parked_at
    and new.wake_note is not distinct from old.wake_note
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
  if new.status not in ('dismissed', 'new', 'parked') then
    raise exception 'a signed-in user may only dismiss, park or reopen a prospect';
  end if;
  if new.status = 'dismissed' then
    if new.dismissed_at is null then
      new.dismissed_at := now();
    end if;
    new.parked_at := null;
    new.wake_note := null;
  end if;
  if new.status = 'parked' then
    if new.parked_at is null then
      new.parked_at := now();
    end if;
    new.dismissed_at := null;
    new.dismiss_reason := null;
    new.wake_note := null;
  end if;
  if new.status = 'new' then
    new.dismissed_at := null;
    new.dismiss_reason := null;
    new.parked_at := null;
    new.wake_note := null;
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
    raise exception 'a signed-in user may only change status, dismissed_at, dismiss_reason and parked_at on a prospect';
  end if;
  return new;
end;
$$;

grant update (parked_at) on table public.prospects to authenticated;
