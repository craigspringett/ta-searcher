-- Follow-up campaigns (18 November 2026, Craig; ported from He-Giveth): a batch of
-- up to 15 contacts started together, each with its own follow-up sequence. Behind
-- the per-user flag profiles.features.follow_up_campaigns (has_feature()), off for
-- everyone until Craig says. A campaign only groups sequences: the emails, calls,
-- stop rules and auto-send are the ordinary follow-up engine's.
--
-- This one file holds all three He-Giveth migrations: the campaigns table, the
-- per-email approval on a step, and the "write them all alike" choice (the column
-- is write_alike because SIMILAR is a reserved word in Postgres).

create table if not exists public.follow_up_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- The angle every email in the batch is written around (kept as the notes on each email step).
  angle text,
  -- The shared stages: [{kind, day, note?, example?}], the first an email on day 0.
  plan jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  consultant_id uuid references public.consultants (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped')),
  -- Approved emails go out by themselves on their days.
  auto_after_first boolean not null default true,
  -- Write every contact's emails alike (the first contact's are the model) instead of one for each company.
  write_alike boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.follow_up_sequences add column if not exists campaign_id uuid references public.follow_up_campaigns (id) on delete set null;
create index if not exists follow_up_sequences_campaign on public.follow_up_sequences (campaign_id) where campaign_id is not null;

-- Each later email of a campaign contact is read and approved up front and goes out by itself on its day;
-- an email nobody approved never goes by itself. Changing the text clears the approval.
alter table public.follow_up_steps add column if not exists campaign_approved_at timestamptz;

drop trigger if exists follow_up_campaigns_touch_updated_at on public.follow_up_campaigns;
create trigger follow_up_campaigns_touch_updated_at before update on public.follow_up_campaigns for each row execute function public.touch_updated_at();

alter table public.follow_up_campaigns enable row level security;
revoke all on table public.follow_up_campaigns from anon, authenticated;
grant all on table public.follow_up_campaigns to service_role;
grant select on table public.follow_up_campaigns to authenticated;
drop policy if exists "Read own campaigns" on public.follow_up_campaigns;
create policy "Read own campaigns" on public.follow_up_campaigns for select to authenticated
  using (public.is_app_user() and public.has_feature('follow_up_campaigns') and (created_by = auth.uid() or public.is_manager()));
drop policy if exists "Service role manages campaigns" on public.follow_up_campaigns;
create policy "Service role manages campaigns" on public.follow_up_campaigns for all to service_role using (true) with check (true);
