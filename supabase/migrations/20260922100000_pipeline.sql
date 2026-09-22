-- Pipeline board (22 September 2026, Craig's list): where each tracked
-- company stands with Big Fish. One stage per company on company_searches:
--   prospect       tracked, nothing said to them yet
--   contacted      an email went or a call was made
--   call_booked    a meeting or a call is in the diary
--   search_agreed  the search is on
--   lost           not now (kept off the board's main columns)
-- A stage only moves forward on its own: logging an outcome advances it
-- (emailed, spoke_to, voicemail, callback or replied to at least contacted;
-- meeting_booked to at least call_booked). Moving back, to search_agreed
-- or to lost is the consultant's call on the board or the company page.
-- App users may update company_searches already (the baseline policy).
--
-- Applied by scripts/local-db-test.sh after the follow-ups migration.

alter table public.company_searches
  add column pipeline_stage text default 'prospect'::text not null,
  add column pipeline_moved_at timestamptz default now() not null;

alter table public.company_searches
  add constraint company_searches_pipeline_stage_check
  check (pipeline_stage in ('prospect', 'contacted', 'call_booked', 'search_agreed', 'lost'));

create index idx_company_searches_pipeline on public.company_searches using btree (pipeline_stage, pipeline_moved_at desc);

-- The rank of each stage, for "never backwards".
create or replace function public.pipeline_stage_rank(p_stage text)
returns integer
language sql immutable
as $$
  select case p_stage when 'prospect' then 0 when 'contacted' then 1 when 'call_booked' then 2 when 'search_agreed' then 3 when 'lost' then 4 else 0 end;
$$;

-- An outcome advances the company's stage when it says more than the stage does.
create or replace function public.advance_pipeline_on_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text;
begin
  wanted := case
    when new.kind = 'meeting_booked' then 'call_booked'
    when new.kind in ('emailed', 'spoke_to', 'voicemail', 'callback', 'replied') then 'contacted'
    else null
  end;
  if wanted is null then
    return new;
  end if;
  update public.company_searches
    set pipeline_stage = wanted, pipeline_moved_at = now()
    where id = new.company_search_id
      and pipeline_stage <> 'lost'
      and public.pipeline_stage_rank(pipeline_stage) < public.pipeline_stage_rank(wanted);
  return new;
end;
$$;

create trigger outcomes_advance_pipeline
  after insert on public.outcomes
  for each row execute function public.advance_pipeline_on_outcome();

-- Stamp the move when the stage changes by hand.
create or replace function public.stamp_pipeline_move()
returns trigger
language plpgsql
as $$
begin
  if new.pipeline_stage is distinct from old.pipeline_stage then
    new.pipeline_moved_at := now();
  end if;
  return new;
end;
$$;

create trigger company_searches_stamp_pipeline_move
  before update on public.company_searches
  for each row execute function public.stamp_pipeline_move();

-- Companies with a call or an email already logged start in the right column.
update public.company_searches c
  set pipeline_stage = s.stage, pipeline_moved_at = s.at
  from (
    select company_search_id,
      case when bool_or(kind = 'meeting_booked') then 'call_booked' else 'contacted' end as stage,
      max(created_at) as at
    from public.outcomes
    where kind in ('emailed', 'spoke_to', 'voicemail', 'callback', 'replied', 'meeting_booked')
    group by company_search_id
  ) s
  where s.company_search_id = c.id and c.pipeline_stage = 'prospect';
