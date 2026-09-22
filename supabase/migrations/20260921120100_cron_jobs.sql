-- TA Searcher scheduled jobs (21 September 2026), per "What runs when" in
-- docs/TA-SEARCHER-BRIEF.md. Times are UTC. Every job reads the project URL
-- and the service role key from Vault through invoke_edge_function
-- (20260921120050_queues_and_net.sql), so no secret is in the repo.
--
-- Not applied by scripts/local-db-test.sh (pg_cron is not available there).
--
-- Change a schedule later without a migration, and note it in the product
-- context doc:
--   select cron.alter_job(jobid, schedule := '0 7 * * *') from cron.job where jobname = '...';

-- Idempotent (re)scheduling: unschedule any existing job with the same name first.
do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname in (
    'process-email-queue',
    'dispatch-analyze-company-queue',
    'dispatch-copy-queue',
    'close-stale-refresh-runs',
    'sync-companies-house',
    'sync-ats-boards',
    'sync-funding-news',
    'discover-prospects',
    'qualify-prospects',
    'tick-follow-ups',
    'send-raises-digest',
    'read-inbox',
    'auto-refresh-vacancies-trigger',
    'refresh-all-companies',
    'refresh-scores',
    'send-friday-brief',
    'auto-refresh-vacancies-compare'
  ) loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- Email queue drain: every 5 seconds (pg_cron >= 1.5 supports second-level schedules).
select cron.schedule('process-email-queue', '5 seconds', $$select public.process_email_queue_tick()$$);

-- Ten queued analyses a minute, three queued copy sets a minute.
select cron.schedule('dispatch-analyze-company-queue', '* * * * *', $$select public.dispatch_analyze_company_queue(10)$$);
select cron.schedule('dispatch-copy-queue', '* * * * *', $$select public.dispatch_copy_queue(3)$$);

-- A run with no finish in ten minutes was killed; close it as degraded.
select cron.schedule('close-stale-refresh-runs', '*/10 * * * *', $$select public.close_stale_refresh_runs(10)$$);

-- 04:40 daily: status, officers and capital filings for every tracked company.
select cron.schedule('sync-companies-house', '40 4 * * *',
  $$select public.invoke_edge_function('sync-companies-house', '{}'::jsonb)$$);

-- 04:50 daily: every confirmed ATS feed.
select cron.schedule('sync-ats-boards', '50 4 * * *',
  $$select public.invoke_edge_function('sync-ats-boards', '{}'::jsonb)$$);

-- 05:20 daily: the funding news feeds (UKTN, Sifted, Google News), matched
-- to tracked companies. Slice 2.
select cron.schedule('sync-funding-news', '20 5 * * *',
  $$select public.invoke_edge_function('sync-funding-news', '{}'::jsonb)$$);

-- 05:30 daily: the prospect radar reads its sources into prospects; 05:40
-- qualifies the newest sixty and promotes what reaches the auto-promote
-- score. Slice 3 (docs/PROSPECTING-BRIEF.md).
select cron.schedule('discover-prospects', '30 5 * * *',
  $$select public.invoke_edge_function('discover-prospects', '{}'::jsonb)$$);
select cron.schedule('qualify-prospects', '40 5 * * *',
  $$select public.invoke_edge_function('qualify-prospects', '{}'::jsonb)$$);

-- Every fifteen minutes: tick-follow-ups marks the steps that fall due,
-- stops sequences that should stop (a reply, a bounce, a meeting) and
-- writes a due draft again when the company changed. It never sends.
select cron.schedule('tick-follow-ups', '*/15 * * * *',
  $$select public.invoke_edge_function('tick-follow-ups', '{}'::jsonb)$$);

-- Every fifteen minutes, offset from the follow-ups tick: read every
-- connected Outlook inbox for replies (mail_connections).
select cron.schedule('read-inbox', '7,22,37,52 * * * *',
  $$select public.invoke_edge_function('read-inbox', '{}'::jsonb)$$);

-- Monday 07:00: the weekly raises digest (every raise the radar saw last
-- week in the chosen sectors and stages; app_settings.raises_digest).
select cron.schedule('send-raises-digest', '0 7 * * 1',
  $$select public.invoke_edge_function('send-raises-digest', '{}'::jsonb)$$);

-- Friday 05:00: snapshot the open roles per consultant, then queue every
-- company for analyze-company (the Friday-only cadence follows Craig's 14
-- September decision for He-Giveth; a daily one is one cron.alter_job away).
select cron.schedule('auto-refresh-vacancies-trigger', '0 5 * * 5',
  $$select public.invoke_edge_function('auto-refresh-vacancies', '{"phase":"snapshot"}'::jsonb)$$);
select cron.schedule('refresh-all-companies', '5 5 * * 5',
  $$select public.invoke_edge_function('refresh-all-companies', '{}'::jsonb)$$);

-- 06:40 daily: the propensity score from stored data.
select cron.schedule('refresh-scores', '40 6 * * *',
  $$select public.invoke_edge_function('refresh-scores', '{}'::jsonb)$$);

-- Friday 06:55: one brief per consultant address and a manager edition.
select cron.schedule('send-friday-brief', '55 6 * * 5',
  $$select public.invoke_edge_function('send-friday-brief', '{}'::jsonb)$$);

-- Friday 07:30: compare against the snapshot and email the new roles.
select cron.schedule('auto-refresh-vacancies-compare', '30 7 * * 5',
  $$select public.invoke_edge_function('auto-refresh-vacancies', '{"phase":"compare-and-alert"}'::jsonb)$$);
