-- TA Searcher: queues, network and cron readers (21 September 2026).
--
-- Everything that needs pgmq, pg_net, pg_cron or Vault, kept apart from the
-- baseline because the local test cluster (scripts/local-db-test.sh, plain
-- Postgres 16) has none of them and skips this file. On the hosted project
-- it is applied straight after the baseline.
--
-- Vault secrets (create once per project, never commit them; the names are
-- He-Giveth's so the functions below are unchanged):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role key>', 'email_queue_service_role_key');

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron;
  end if;
end $$;
create extension if not exists pgmq;

-- ---------------------------------------------------------------------------
-- Email queues (auth = high priority, transactional = normal) and their DLQs
-- ---------------------------------------------------------------------------

do $$ begin perform pgmq.create('auth_emails'); exception when others then null; end $$;
do $$ begin perform pgmq.create('transactional_emails'); exception when others then null; end $$;
do $$ begin perform pgmq.create('auth_emails_dlq'); exception when others then null; end $$;
do $$ begin perform pgmq.create('transactional_emails_dlq'); exception when others then null; end $$;

-- RPC wrappers so the edge functions reach pgmq through supabase.rpc()
-- (PostgREST exposes public only). Each one recreates a missing queue so an
-- email is never lost to a dropped queue.
create or replace function public.enqueue_email(queue_name text, payload jsonb)
returns bigint
language plpgsql security definer
set search_path = 'public', 'pgmq'
as $$
begin
  return pgmq.send(queue_name, payload);
exception when undefined_table then
  perform pgmq.create(queue_name);
  return pgmq.send(queue_name, payload);
end;
$$;

create or replace function public.read_email_batch(queue_name text, batch_size integer, vt integer)
returns table(msg_id bigint, read_ct integer, message jsonb)
language plpgsql security definer
set search_path = 'public', 'pgmq'
as $$
begin
  return query select r.msg_id, r.read_ct, r.message from pgmq.read(queue_name, vt, batch_size) r;
exception when undefined_table then
  perform pgmq.create(queue_name);
  return;
end;
$$;

create or replace function public.delete_email(queue_name text, message_id bigint)
returns boolean
language plpgsql security definer
set search_path = 'public', 'pgmq'
as $$
begin
  return pgmq.delete(queue_name, message_id);
exception when undefined_table then
  return false;
end;
$$;

create or replace function public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
returns bigint
language plpgsql security definer
set search_path = 'public', 'pgmq'
as $$
declare new_id bigint;
begin
  select pgmq.send(dlq_name, payload) into new_id;
  perform pgmq.delete(source_queue, message_id);
  return new_id;
exception when undefined_table then
  begin
    perform pgmq.create(dlq_name);
  exception when others then
    null;
  end;
  select pgmq.send(dlq_name, payload) into new_id;
  begin
    perform pgmq.delete(source_queue, message_id);
  exception when undefined_table then
    null;
  end;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calling an edge function from the database
-- ---------------------------------------------------------------------------

create or replace function public.invoke_edge_function(function_name text, payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer
set search_path = 'public', 'extensions', 'net', 'vault'
as $$
declare
  base_url text;
  service_key text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'email_queue_service_role_key' limit 1;
  if base_url is null or service_key is null then
    raise exception 'Vault secrets project_url / email_queue_service_role_key are not set';
  end if;
  return net.http_post(
    url := base_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key
    ),
    body := payload,
    timeout_milliseconds := 300000
  );
end;
$$;

-- Only call process-email-queue when there is work and no rate-limit cooldown.
create or replace function public.process_email_queue_tick()
returns void
language plpgsql security definer
set search_path = 'public', 'extensions', 'pgmq'
as $$
declare
  cooldown timestamptz;
  pending bigint := 0;
begin
  select retry_after_until into cooldown from public.email_send_state where id = 1;
  if cooldown is not null and cooldown > now() then
    return;
  end if;
  select coalesce(sum(queue_length), 0) into pending
  from pgmq.metrics_all()
  where queue_name in ('auth_emails', 'transactional_emails');
  if pending = 0 then
    return;
  end if;
  perform public.invoke_edge_function('process-email-queue', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The analysis and copy queues (filled by the baseline's enqueue functions)
-- ---------------------------------------------------------------------------

-- Sends up to batch_size queued analyses to analyze-company, spacing_seconds
-- apart. A follow-up pass (payload.prefetchUrls) first fetches its pages
-- through pg_net and is sent once every response is in or four minutes have
-- passed (Phase 6 slice 0 in He-Giveth).
create or replace function public.dispatch_analyze_company_queue(batch_size integer default 10, spacing_seconds numeric default 2)
returns integer
language plpgsql security definer
set search_path = 'public', 'extensions', 'net', 'vault'
as $$
declare
  service_key text;
  row record;
  sent integer := 0;
  rid bigint;
  u text;
  ids jsonb;
  n integer;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'email_queue_service_role_key' limit 1;
  if service_key is null then
    raise exception 'Vault secret email_queue_service_role_key is not set';
  end if;

  -- Rows older than two days are stale whatever happened to them.
  delete from public.analyze_company_queue where enqueued_at < now() - interval '2 days';

  -- Follow-up passes: fetch the pages they want through pg_net first.
  for row in
    select id, payload from public.analyze_company_queue
    where dispatched_at is null and prefetched_at is null
      and jsonb_typeof(payload->'prefetchUrls') = 'array' and jsonb_array_length(payload->'prefetchUrls') > 0
    order by id
    limit batch_size
    for update skip locked
  loop
    ids := '{}'::jsonb;
    n := 0;
    for u in select value from jsonb_array_elements_text(row.payload->'prefetchUrls') loop
      exit when n >= 70;
      begin
        rid := net.http_get(
          url := u,
          headers := '{"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-GB,en;q=0.9"}'::jsonb,
          timeout_milliseconds := 20000
        );
        ids := ids || jsonb_build_object(u, rid);
        n := n + 1;
      exception when others then
        null;
      end;
    end loop;
    update public.analyze_company_queue
    set payload = (payload - 'prefetchUrls') || jsonb_build_object('prefetch', ids), prefetched_at = now()
    where id = row.id;
  end loop;

  for row in
    select id, payload, target_url from public.analyze_company_queue q
    where dispatched_at is null
      and (
        prefetched_at is null and jsonb_typeof(payload->'prefetchUrls') is distinct from 'array'
        or prefetched_at is not null and (
          prefetched_at < now() - interval '4 minutes'
          or not exists (
            select 1 from jsonb_each_text(coalesce(q.payload->'prefetch', '{}'::jsonb)) p
            where not exists (select 1 from net._http_response r where r.id = p.value::bigint)
          )
        )
      )
    order by id
    limit batch_size
    for update skip locked
  loop
    begin
      rid := net.http_post(
        url := row.target_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key,
          'apikey', service_key
        ),
        body := row.payload,
        timeout_milliseconds := 600000
      );
      update public.analyze_company_queue set dispatched_at = now(), request_id = rid where id = row.id;
      sent := sent + 1;
    exception when others then
      update public.analyze_company_queue set dispatched_at = now(), error = sqlerrm where id = row.id;
    end;
    if spacing_seconds > 0 then
      perform pg_sleep(spacing_seconds);
    end if;
  end loop;
  return sent;
end;
$$;

-- Sends up to batch_size queued copy sets to generate-copy ({companyId, personas, trigger, force}).
create or replace function public.dispatch_copy_queue(batch_size integer default 3)
returns integer
language plpgsql security definer
set search_path = 'public', 'extensions', 'net', 'vault'
as $$
declare
  service_key text;
  project_url text;
  row record;
  sent integer := 0;
  rid bigint;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'email_queue_service_role_key' limit 1;
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if service_key is null or project_url is null then
    raise exception 'Vault secrets project_url / email_queue_service_role_key are not set';
  end if;

  delete from public.copy_queue where enqueued_at < now() - interval '2 days';

  for row in
    select id, company_search_id, personas, trigger, force from public.copy_queue
    where dispatched_at is null
    order by id
    limit batch_size
    for update skip locked
  loop
    begin
      rid := net.http_post(
        url := project_url || '/functions/v1/generate-copy',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key,
          'apikey', service_key
        ),
        body := jsonb_build_object('companyId', row.company_search_id, 'personas', to_jsonb(row.personas), 'trigger', row.trigger, 'force', row.force),
        timeout_milliseconds := 300000
      );
      update public.copy_queue set dispatched_at = now(), request_id = rid where id = row.id;
      sent := sent + 1;
    exception when others then
      update public.copy_queue set dispatched_at = now(), error = sqlerrm where id = row.id;
    end;
  end loop;
  return sent;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading a page through pg_net (_shared/fetch.ts, the third path)
-- ---------------------------------------------------------------------------

create or replace function public.http_page_enqueue(p_url text, p_timeout_ms integer default 20000)
returns bigint
language plpgsql security definer
set search_path = 'public', 'extensions', 'net'
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role only';
  end if;
  return net.http_get(
    url := p_url,
    headers := '{"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-GB,en;q=0.9"}'::jsonb,
    timeout_milliseconds := least(greatest(p_timeout_ms, 1000), 20000)
  );
end;
$$;

create or replace function public.http_page_result(p_id bigint)
returns jsonb
language plpgsql security definer
set search_path = 'public', 'extensions', 'net'
as $$
declare r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role only';
  end if;
  select status_code, left(content, 1048576) as content, length(content) as full_length, error_msg, headers into r from net._http_response where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object('status', r.status_code, 'content', r.content, 'truncated', coalesce(r.full_length, 0) > 1048576, 'error', r.error_msg, 'headers', r.headers);
end;
$$;

-- ---------------------------------------------------------------------------
-- Monitoring readers (pipeline health, cron history)
-- ---------------------------------------------------------------------------

-- Today's refresh counts, the last snapshot, the compare runs, the DLQ depth
-- and the last register and boards syncs (pipeline_runs phases
-- 'companies_house' and 'ats_boards', written by sync-companies-house and
-- sync-ats-boards).
create or replace function public.get_pipeline_health()
returns jsonb
language plpgsql security definer
set search_path = 'public', 'pgmq'
as $$
declare
  result jsonb;
  refreshed_today integer;
  degraded_today integer;
  failed_today integer;
  snapshot_at timestamptz;
  compare_runs jsonb;
  dlq_depth bigint;
  register_sync jsonb;
  boards_sync jsonb;
  open_vacancies integer;
  new_today integer;
begin
  select count(distinct company_search_id) filter (where finished_at is not null and not degraded),
         count(distinct company_search_id) filter (where degraded),
         count(*) filter (where error is not null)
    into refreshed_today, degraded_today, failed_today
    from public.company_refresh_runs
   where started_at >= date_trunc('day', now());

  select max(finished_at) into snapshot_at from public.pipeline_runs where phase = 'snapshot' and status = 'ok';

  select coalesce(jsonb_agg(jsonb_build_object(
           'configId', config_id, 'consultant', details->>'consultant', 'email', details->>'email',
           'newCount', new_count, 'companiesTotal', companies_total, 'companiesRefreshedToday', companies_refreshed_today,
           'status', status, 'dryRun', coalesce((details->>'dryRun')::boolean, false), 'finishedAt', finished_at
         ) order by finished_at desc), '[]'::jsonb)
    into compare_runs
    from public.pipeline_runs
   where phase = 'compare' and config_id is not null and started_at >= date_trunc('day', now());

  select coalesce(sum(queue_length), 0) into dlq_depth from pgmq.metrics_all() where queue_name like '%_dlq';

  select jsonb_build_object('finishedAt', finished_at, 'status', status, 'count', new_count, 'error', error)
    into register_sync
    from public.pipeline_runs where phase = 'companies_house' order by started_at desc limit 1;

  select jsonb_build_object('finishedAt', finished_at, 'status', status, 'count', new_count, 'error', error)
    into boards_sync
    from public.pipeline_runs where phase = 'ats_boards' order by started_at desc limit 1;

  select count(*) filter (where status = 'open'), count(*) filter (where status = 'open' and first_seen = current_date)
    into open_vacancies, new_today from public.vacancies;

  result := jsonb_build_object(
    'companiesRefreshedToday', coalesce(refreshed_today, 0),
    'degradedToday', coalesce(degraded_today, 0),
    'failedRunsToday', coalesce(failed_today, 0),
    'snapshotAt', snapshot_at,
    'compareRuns', compare_runs,
    'dlqDepth', dlq_depth,
    'registerSync', coalesce(register_sync, '{}'::jsonb),
    'boardsSync', coalesce(boards_sync, '{}'::jsonb),
    'openVacancies', coalesce(open_vacancies, 0),
    'newVacanciesToday', coalesce(new_today, 0)
  );
  return result;
end;
$$;

create or replace function public.get_cron_last_run(p_jobid bigint)
returns jsonb
language plpgsql security definer
set search_path = 'public', 'cron'
as $$
declare
  r record;
begin
  set local statement_timeout = '4s';
  select start_time, end_time, status, return_message
  into r
  from cron.job_run_details
  where jobid = p_jobid
  order by start_time desc
  limit 1;

  if not found then return null; end if;

  return jsonb_build_object(
    'startTime', r.start_time,
    'endTime', r.end_time,
    'status', r.status,
    'returnMessage', r.return_message,
    'durationMs', case when r.end_time is not null and r.start_time is not null
      then extract(epoch from (r.end_time - r.start_time)) * 1000 else null end
  );
exception when others then
  return null;
end;
$$;

create or replace function public.get_cron_recent_runs(p_jobid bigint, p_limit integer default 5)
returns jsonb
language plpgsql security definer
set search_path = 'public', 'cron'
as $$
declare
  result jsonb;
begin
  set local statement_timeout = '4s';
  select jsonb_agg(
    jsonb_build_object(
      'startTime', r.start_time,
      'endTime', r.end_time,
      'status', r.status,
      'returnMessage', r.return_message,
      'durationMs', case when r.end_time is not null and r.start_time is not null
        then extract(epoch from (r.end_time - r.start_time)) * 1000 else null end
    ) order by r.start_time desc
  )
  into result
  from (
    select start_time, end_time, status, return_message
    from cron.job_run_details
    where jobid = p_jobid
    order by start_time desc
    limit p_limit
  ) r;
  return coalesce(result, '[]'::jsonb);
exception when others then
  return '[]'::jsonb;
end;
$$;

-- The jobs the monitoring page tracks, by the names in 20260921120100_cron_jobs.sql.
create or replace function public.get_cron_monitoring_jobs_only()
returns jsonb
language plpgsql security definer
set search_path = 'public', 'cron'
as $$
declare
  result jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'key', t.key, 'label', t.label, 'jobname', t.jobname,
      'jobid', j.jobid,
      'schedule', j.schedule, 'active', coalesce(j.active, false),
      'configured', j.jobid is not null,
      'lastRun', null, 'recentRuns', '[]'::jsonb
    ) order by t.ord
  ) into result
  from (values
    ('companies_house', 'sync-companies-house', 'Companies House sync', 0),
    ('ats_boards', 'sync-ats-boards', 'ATS boards sync', 1),
    ('snapshot', 'auto-refresh-vacancies-trigger', 'Snapshot', 2),
    ('refresh', 'refresh-all-companies', 'Refresh', 3),
    ('scores', 'refresh-scores', 'Scores', 4),
    ('brief', 'send-friday-brief', 'Friday brief', 5),
    ('compare', 'auto-refresh-vacancies-compare', 'Compare and alert', 6)
  ) t(key, jobname, label, ord)
  left join cron.job j on j.jobname = t.jobname;
  return coalesce(result, '[]'::jsonb);
end;
$$;

create or replace function public.get_cron_monitoring_status()
returns jsonb
language plpgsql security definer
set search_path = 'public', 'cron'
as $$
declare
  result jsonb;
begin
  -- Short statement timeout so a slow history scan never blocks the dashboard.
  set local statement_timeout = '8s';

  with tracked as (
    select * from (values
      ('companies_house', 'sync-companies-house', 'Companies House sync', 0),
      ('ats_boards', 'sync-ats-boards', 'ATS boards sync', 1),
      ('snapshot', 'auto-refresh-vacancies-trigger', 'Snapshot', 2),
      ('refresh', 'refresh-all-companies', 'Refresh', 3),
      ('scores', 'refresh-scores', 'Scores', 4),
      ('brief', 'send-friday-brief', 'Friday brief', 5),
      ('compare', 'auto-refresh-vacancies-compare', 'Compare and alert', 6)
    ) as t(key, jobname, label, ord)
  ),
  job_info as (
    select t.key, t.jobname, t.label, t.ord, j.jobid, j.schedule, j.active
    from tracked t
    left join cron.job j on j.jobname = t.jobname
  ),
  per_job_runs as (
    select ji.jobid,
      (
        select jsonb_agg(
          jsonb_build_object(
            'startTime', r.start_time,
            'endTime', r.end_time,
            'status', r.status,
            'returnMessage', r.return_message,
            'durationMs', case when r.end_time is not null and r.start_time is not null
              then extract(epoch from (r.end_time - r.start_time)) * 1000 else null end
          ) order by r.start_time desc
        )
        from (
          select start_time, end_time, status, return_message
          from cron.job_run_details
          where jobid = ji.jobid
          order by start_time desc
          limit 5
        ) r
      ) as runs
    from job_info ji
    where ji.jobid is not null
  )
  select jsonb_agg(
    jsonb_build_object(
      'key', ji.key,
      'label', ji.label,
      'jobname', ji.jobname,
      'schedule', ji.schedule,
      'active', coalesce(ji.active, false),
      'configured', ji.jobid is not null,
      'lastRun', case
        when pjr.runs is not null and jsonb_array_length(pjr.runs) > 0
          then pjr.runs -> 0
        else null
      end,
      'recentRuns', coalesce(pjr.runs, '[]'::jsonb)
    ) order by ji.ord
  )
  into result
  from job_info ji
  left join per_job_runs pjr on pjr.jobid = ji.jobid;

  return coalesce(result, '[]'::jsonb);
exception when others then
  -- Fallback: the job definitions only, no run history.
  reset statement_timeout;
  select jsonb_agg(
    jsonb_build_object(
      'key', t.key, 'label', t.label, 'jobname', t.jobname,
      'schedule', j.schedule, 'active', coalesce(j.active, false),
      'configured', j.jobid is not null,
      'lastRun', null, 'recentRuns', '[]'::jsonb,
      'historyError', sqlerrm
    ) order by t.ord
  ) into result
  from (values
    ('companies_house', 'sync-companies-house', 'Companies House sync', 0),
    ('ats_boards', 'sync-ats-boards', 'ATS boards sync', 1),
    ('snapshot', 'auto-refresh-vacancies-trigger', 'Snapshot', 2),
    ('refresh', 'refresh-all-companies', 'Refresh', 3),
    ('scores', 'refresh-scores', 'Scores', 4),
    ('brief', 'send-friday-brief', 'Friday brief', 5),
    ('compare', 'auto-refresh-vacancies-compare', 'Compare and alert', 6)
  ) t(key, jobname, label, ord)
  left join cron.job j on j.jobname = t.jobname;
  return coalesce(result, '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: internal, service role (and the cron runner, postgres) only.
-- ---------------------------------------------------------------------------

revoke all on function
  public.enqueue_email(text, jsonb),
  public.read_email_batch(text, integer, integer),
  public.delete_email(text, bigint),
  public.move_to_dlq(text, text, bigint, jsonb),
  public.invoke_edge_function(text, jsonb),
  public.process_email_queue_tick(),
  public.dispatch_analyze_company_queue(integer, numeric),
  public.dispatch_copy_queue(integer),
  public.http_page_enqueue(text, integer),
  public.http_page_result(bigint),
  public.get_pipeline_health(),
  public.get_cron_last_run(bigint),
  public.get_cron_recent_runs(bigint, integer),
  public.get_cron_monitoring_jobs_only(),
  public.get_cron_monitoring_status()
from public, anon, authenticated;

grant execute on function
  public.enqueue_email(text, jsonb),
  public.read_email_batch(text, integer, integer),
  public.delete_email(text, bigint),
  public.move_to_dlq(text, text, bigint, jsonb),
  public.invoke_edge_function(text, jsonb),
  public.process_email_queue_tick(),
  public.dispatch_analyze_company_queue(integer, numeric),
  public.dispatch_copy_queue(integer),
  public.http_page_enqueue(text, integer),
  public.http_page_result(bigint),
  public.get_pipeline_health(),
  public.get_cron_last_run(bigint),
  public.get_cron_recent_runs(bigint, integer),
  public.get_cron_monitoring_jobs_only(),
  public.get_cron_monitoring_status()
to postgres, service_role;

-- The one read-only summary a logged-in app may call directly.
grant execute on function public.get_pipeline_health() to authenticated;
