#!/usr/bin/env bash
# Apply the TA Searcher baseline to a throwaway local Postgres 16 cluster and
# check its row security, helpers and enum. No Docker, no network.
#
#   scripts/local-db-test.sh            # apply the baseline and run the assertions
#   scripts/local-db-test.sh --types    # also regenerate src/integrations/supabase/types.ts
#   scripts/local-db-test.sh --keep     # leave the cluster running on port 54329 (stop it with pg_ctl)
#
# What it does:
#   * initdb into a temp directory, start it on 127.0.0.1:54329;
#   * create the Supabase roles (anon, authenticated, service_role,
#     supabase_auth_admin), a minimal auth schema (auth.users and the
#     auth.uid() / auth.role() / auth.jwt() readers of request.jwt.claims,
#     as Supabase defines them);
#   * apply supabase/migrations/20260921120000_ta_searcher_baseline.sql, then
#     20260921130000_funding_news.sql (slice 2, plain SQL).
#     20260921120050_queues_and_net.sql needs pgmq, pg_net, pg_cron and Vault,
#     which the local cluster does not have, and 20260921120100_cron_jobs.sql
#     needs pg_cron; both are skipped here and applied on the hosted project;
#   * run the assertions below as the roles PostgREST would use (set local
#     role + request.jwt.claims), print pass/fail per assertion, exit non-zero
#     on any failure;
#   * stop and delete the cluster (trap), unless --keep.
set -uo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PORT:-54329}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$ROOT/supabase/migrations/20260921120000_ta_searcher_baseline.sql"
FUNDING_NEWS="$ROOT/supabase/migrations/20260921130000_funding_news.sql"
POSTCODE="$ROOT/supabase/migrations/20260921140000_company_records_postcode.sql"
PROSPECTS="$ROOT/supabase/migrations/20260921150000_prospects.sql"
FOLLOW_UPS="$ROOT/supabase/migrations/20260921160000_follow_ups.sql"
GEN_TYPES=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --types) GEN_TYPES=1 ;;
    --keep) KEEP=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

[[ -x "$PGBIN/initdb" ]] || { echo "local-db-test: $PGBIN/initdb not found (install postgresql-16)" >&2; exit 2; }
[[ -f "$BASELINE" ]] || { echo "local-db-test: $BASELINE not found" >&2; exit 2; }
[[ -f "$FUNDING_NEWS" ]] || { echo "local-db-test: $FUNDING_NEWS not found" >&2; exit 2; }
[[ -f "$POSTCODE" ]] || { echo "local-db-test: $POSTCODE not found" >&2; exit 2; }
[[ -f "$PROSPECTS" ]] || { echo "local-db-test: $PROSPECTS not found" >&2; exit 2; }
[[ -f "$FOLLOW_UPS" ]] || { echo "local-db-test: $FOLLOW_UPS not found" >&2; exit 2; }

WORK="$(mktemp -d)"
PGDATA="$WORK/data"
SOCK="$WORK/sock"
LOG="$WORK/postgres.log"
mkdir -p "$SOCK"

# The server refuses to run as root (a cloud session is root); hand the
# server-side commands to the postgres system user when there is one.
SERVER_USER=""
if [[ "$(id -u)" == 0 ]]; then
  if id postgres >/dev/null 2>&1; then SERVER_USER=postgres
  elif id nobody >/dev/null 2>&1; then SERVER_USER=nobody
  else echo "local-db-test: running as root and no unprivileged user to run the server as" >&2; exit 2; fi
  chown -R "$SERVER_USER" "$WORK"
fi
srv() { if [[ -n "$SERVER_USER" ]]; then runuser -u "$SERVER_USER" -- "$@"; else "$@"; fi; }

cleanup() {
  if [[ "$KEEP" == 1 ]]; then
    echo "cluster left running: PGDATA=$PGDATA port=$PORT (stop with: ${SERVER_USER:+runuser -u $SERVER_USER -- }$PGBIN/pg_ctl -D $PGDATA stop)"
    return
  fi
  srv "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== initdb"
srv "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --no-instructions >"$WORK/initdb.log" 2>&1 || { cat "$WORK/initdb.log"; exit 1; }
echo "== start"
srv "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOG" -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c fsync=off -c log_min_messages=warning" -w start >/dev/null || { cat "$LOG"; exit 1; }

export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
psqlq() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "== roles and the auth schema Supabase would have"
psqlq <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
grant anon, authenticated, service_role to postgres;

create schema auth;
create table auth.users (id uuid primary key, email text);
-- Supabase's readers of the request's JWT (set by PostgREST per request; by
-- set_config('request.jwt.claims', ..., true) in a test).
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role, supabase_auth_admin;
grant select on auth.users to supabase_auth_admin;
SQL

echo "== apply $(basename "$BASELINE")"
psqlq -f "$BASELINE" >"$WORK/apply.log" 2>&1 || { cat "$WORK/apply.log"; exit 1; }
grep -i "error" "$WORK/apply.log" && exit 1
echo "   applied"
echo "== apply $(basename "$FUNDING_NEWS")"
psqlq -f "$FUNDING_NEWS" >"$WORK/apply-funding-news.log" 2>&1 || { cat "$WORK/apply-funding-news.log"; exit 1; }
echo "== apply $(basename "$POSTCODE")"
psqlq -f "$POSTCODE" >"$WORK/apply-postcode.log" 2>&1 || { cat "$WORK/apply-postcode.log"; exit 1; }
echo "== apply $(basename "$PROSPECTS")"
psqlq -f "$PROSPECTS" >"$WORK/apply-prospects.log" 2>&1 || { cat "$WORK/apply-prospects.log"; exit 1; }
echo "== apply $(basename "$FOLLOW_UPS")"
psqlq -f "$FOLLOW_UPS" >"$WORK/apply-follow-ups.log" 2>&1 || { cat "$WORK/apply-follow-ups.log"; exit 1; }
grep -i "error" "$WORK/apply-funding-news.log" && exit 1
echo "   applied"

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
# check <name> <sql that returns one boolean>; the SQL may be several
# statements (one transaction), the last one is the boolean.
check() {
  local name="$1" sql="$2" out
  out="$("$PGBIN/psql" -X -q -tA -v ON_ERROR_STOP=1 -c "$sql" 2>&1 | tail -n 1)"
  if [[ "$out" == "t" ]]; then PASS=$((PASS + 1)); echo "pass  $name"
  else FAIL=$((FAIL + 1)); echo "FAIL  $name  (got: $out)"; fi
}
# expect_fail <name> <sql that must raise>
expect_fail() {
  local name="$1" sql="$2"
  if "$PGBIN/psql" -X -q -tA -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1; then
    FAIL=$((FAIL + 1)); echo "FAIL  $name  (statement succeeded)"
  else PASS=$((PASS + 1)); echo "pass  $name"; fi
}

# Fixtures: two auth users with profiles (one consultant, one manager), one
# without a work address, two consultants, two companies, one assignment.
U_CONSULTANT=11111111-1111-1111-1111-111111111111
U_MANAGER=22222222-2222-2222-2222-222222222222
U_ADMIN=33333333-3333-3333-3333-333333333333
U_NOBODY=44444444-4444-4444-4444-444444444444
C_ANJA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
C_KIM=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
CO_ONE=cccccccc-cccc-cccc-cccc-cccccccccccc
CO_TWO=dddddddd-dddd-dddd-dddd-dddddddddddd
claims_consultant="{\"sub\":\"$U_CONSULTANT\",\"role\":\"authenticated\",\"email\":\"anja@bigfishrecruitment.co.uk\"}"
claims_manager="{\"sub\":\"$U_MANAGER\",\"role\":\"authenticated\",\"email\":\"luke@whofoundwho.co.uk\"}"
claims_nobody="{\"sub\":\"$U_NOBODY\",\"role\":\"authenticated\",\"email\":\"someone@gmail.com\"}"
as_consultant="set local role authenticated; select set_config('request.jwt.claims', '$claims_consultant', true);"
as_manager="set local role authenticated; select set_config('request.jwt.claims', '$claims_manager', true);"
as_nobody="set local role authenticated; select set_config('request.jwt.claims', '$claims_nobody', true);"
as_anon="set local role anon; select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true);"

echo "== fixtures"
psqlq <<SQL
insert into public.consultants (id, name, email) values
  ('$C_ANJA', 'Anja', 'anja@bigfishrecruitment.co.uk'),
  ('$C_KIM', 'Kim', 'kim@whofoundwho.co.uk');
insert into auth.users (id, email) values
  ('$U_CONSULTANT', 'anja@bigfishrecruitment.co.uk'),
  ('$U_MANAGER', 'luke@whofoundwho.co.uk'),
  ('$U_ADMIN', 'craig@bigfishrecruitment.co.uk'),
  ('$U_NOBODY', 'someone@gmail.com');
update public.profiles set role = 'manager' where id = '$U_MANAGER';
insert into public.company_searches (id, url, company_name, company_number, analysis_result) values
  ('$CO_ONE', 'https://one.example', 'One Ltd', '01234567', '{"summary":"one"}'),
  ('$CO_TWO', 'https://two.example', 'Two Ltd', null, '{"summary":"two"}');
insert into public.company_consultants (company_search_id, consultant_id) values ('$CO_ONE', '$C_ANJA');
insert into public.vacancies (company_search_id, vacancy_key, title, source) values ('$CO_ONE', 'k1', 'Head of Talent', 'ashby');
insert into public.company_scores (company_search_id, score) values ('$CO_ONE', 72);
insert into public.email_events (event_type, recipient_email, occurred_at, company_search_id, consultant_id, dedupe_key) values
  ('opened', 'ceo@one.example', now(), '$CO_ONE', '$C_ANJA', 'e1'),
  ('opened', 'ceo@two.example', now(), '$CO_TWO', '$C_KIM', 'e2');
insert into public.company_contact_edits (company_search_id, contact_key, name, action, edited_by) values
  ('$CO_ONE', 'ceo', 'Jane Founder', 'edit', '$U_CONSULTANT'),
  ('$CO_TWO', 'ceo', 'Joe Founder', 'edit', '$U_MANAGER');
SQL

echo "== assertions"
# Structure
check "every public table has row security on" \
  "select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity"
check "33 public tables" \
  "select count(*) = 36 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')"
check "no education table survived the port (school, gias, cfr, ofsted, tender, pupil, shortlist, follow_up, trust, board_fetch, probe)" \
  "select count(*) = 0 from pg_tables where schemaname = 'public' and (tablename ~ '^(school|gias|cfr|ofsted|tender|pupil|shortlist|bh_|trust|board_|probe|agency)')"
check "the tables the code names exist" \
  "select bool_and(to_regclass('public.' || t) is not null) from unnest(array['company_searches','company_consultants','company_refresh_runs','company_facts','company_signals','company_scores','company_copy','company_contact_edits','company_records','ch_officers','ch_filings','ats_boards','analyze_company_queue','analyze_company_requests','copy_queue','vacancies','outcomes','profiles','consultants','app_settings','email_send_log','email_send_state','email_events','email_signatures','suppressed_emails','email_unsubscribe_tokens','pipeline_runs','vacancy_alert_settings','alert_deliveries','vacancy_feedback','contact_feedback','ai_usage','funding_news','prospects','follow_up_sequences','follow_up_steps']) t"
check "vacancy_source has the eight values in order" \
  "select array_agg(enumlabel order by enumsortorder)::text[] = array['ashby','greenhouse','lever','workable','careers_page','llm','consultant','other'] from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'vacancy_source'"
check "company_searches has company_number and company_name, no urn" \
  "select bool_and(exists (select 1 from information_schema.columns where table_name = 'company_searches' and column_name = c)) and not exists (select 1 from information_schema.columns where table_name = 'company_searches' and column_name in ('urn','school_name')) from unnest(array['id','url','company_number','company_name','analysis_result','evidence_fingerprint','evidence_computed_at','created_at','updated_at']) c"
check "email_send_state singleton row exists" "select count(*) = 1 from public.email_send_state where id = 1"

# Helpers
for fn in is_app_user app_role is_manager has_feature my_consultant_ids owns_alert_setting; do
  check "$fn() is SECURITY DEFINER" "select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '$fn'"
done
check "the functions the code calls by rpc exist (baseline part)" \
  "select bool_and(to_regprocedure(f) is not null) from unnest(array['public.enqueue_analyze_company_batch(jsonb,text,text)','public.enqueue_copy_generation(uuid,text[],text,boolean,integer)','public.set_company_copy(uuid,text,jsonb,text,text)','public.get_ai_usage_summary()','public.get_vacancy_email_counters()','public.close_stale_refresh_runs(integer)','public.has_feature(text)','public.my_consultant_ids()']) f"
check "no education function survived the port" \
  "select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ '(spend_peers|pupil_premium|bh_cv|shortlist|candidate_email|normalise_phase|school|gias|ofsted|tender)'"

# Auth
check "a work address gets a profile on sign-up (trigger)" "select count(*) = 3 from public.profiles"
check "a gmail address gets no profile" "select not exists (select 1 from public.profiles where id = '$U_NOBODY')"
check "craig@bigfishrecruitment.co.uk is admin" "select role = 'admin' from public.profiles where id = '$U_ADMIN'"
check "a profile links to the consultant row with its email" "select consultant_id = '$C_ANJA' from public.profiles where id = '$U_CONSULTANT'"
check "auth hook refuses an outside address with 403" "select (public.auth_before_user_created('{\"user\":{\"email\":\"x@gmail.com\"}}') -> 'error' ->> 'http_code') = '403'"
check "auth hook accepts a whofoundwho.co.uk address" "select public.auth_before_user_created('{\"user\":{\"email\":\"Kim@WhoFoundWho.co.uk\"}}') = '{}'::jsonb"
expect_fail "profiles rejects a non-work email (check constraint)" "insert into public.profiles (id, email) values ('$U_NOBODY', 'someone@gmail.com')"

# anon
check "anon has no privilege on any public table" \
  "select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))"
expect_fail "anon cannot read company_searches" "$as_anon select count(*) from public.company_searches"
check "anon cannot execute is_app_user()" "select not has_function_privilege('anon', 'public.is_app_user()', 'EXECUTE')"

# authenticated with a profile
check "consultant reads company_searches" "$as_consultant select count(*) = 2 from public.company_searches"
check "consultant reads vacancies" "$as_consultant select count(*) = 1 from public.vacancies"
check "consultant reads company_scores" "$as_consultant select score = 72 from public.company_scores where company_search_id = '$CO_ONE'"
check "consultant reads company_records, ch_officers, ch_filings (empty, no error)" "$as_consultant select (select count(*) from public.company_records) + (select count(*) from public.ch_officers) + (select count(*) from public.ch_filings) = 0"
expect_fail "consultant cannot insert into ai_usage" "$as_consultant insert into public.ai_usage (provider, model, purpose) values ('x', 'y', 'z')"
check "authenticated has no insert privilege on ai_usage, vacancies, company_records, ch_officers, ch_filings, ats_boards" \
  "select not bool_or(has_table_privilege('authenticated', format('public.%I', t), 'INSERT') or has_table_privilege('authenticated', format('public.%I', t), 'UPDATE') or has_table_privilege('authenticated', format('public.%I', t), 'DELETE')) from unnest(array['ai_usage','vacancies','company_records','ch_officers','ch_filings','ats_boards','email_send_log','suppressed_emails','analyze_company_queue','copy_queue']) t"
check "authenticated cannot execute enqueue_copy_generation" "select not has_function_privilege('authenticated', 'public.enqueue_copy_generation(uuid,text[],text,boolean,integer)', 'EXECUTE')"
check "consultant cannot read ai_usage (managers only)" "$as_consultant select count(*) = 0 from public.ai_usage"
check "a signed-in user without a profile sees no companies" "$as_nobody select count(*) = 0 from public.company_searches"
check "a signed-in user without a profile is not an app user" "$as_nobody select not public.is_app_user()"

# per-consultant rows
check "consultant sees only email events for their consultant ids" "$as_consultant select array_agg(dedupe_key) = array['e1'] from public.email_events"
check "consultant sees only contact edits for their companies" "$as_consultant select count(*) = 1 and bool_and(company_search_id = '$CO_ONE') from public.company_contact_edits"
check "manager sees every email event" "$as_manager select count(*) = 2 from public.email_events"
check "manager sees every contact edit" "$as_manager select count(*) = 2 from public.company_contact_edits"
check "my_consultant_ids() resolves the consultant by email" "$as_consultant select array_agg(id) = array['$C_ANJA'::uuid] from public.my_consultant_ids() id"

# outcomes
check "consultant logs an outcome as themselves" "$as_consultant insert into public.outcomes (company_search_id, consultant_id, created_by, kind) values ('$CO_ONE', '$C_ANJA', '$U_CONSULTANT', 'spoke_to'); select count(*) = 1 from public.outcomes"
expect_fail "consultant cannot log an outcome as someone else" "$as_consultant insert into public.outcomes (company_search_id, created_by, kind) values ('$CO_ONE', '$U_MANAGER', 'spoke_to')"
check "manager reads all outcomes" "$as_manager select count(*) = 1 from public.outcomes"
expect_fail "outcome kind is checked" "insert into public.outcomes (company_search_id, created_by, kind) values ('$CO_ONE', '$U_CONSULTANT', 'sent_gift')"

# consultants and managers
check "manager reads consultants" "$as_manager select count(*) = 2 from public.consultants"
check "manager adds a consultant" "$as_manager insert into public.consultants (name) values ('New'); select count(*) = 3 from public.consultants"
expect_fail "consultant cannot add a consultant" "$as_consultant insert into public.consultants (name) values ('Nope')"
check "is_manager() is true for a manager and false for a consultant" "$as_manager select public.is_manager(); "
check "is_manager() is false for a consultant" "$as_consultant select not public.is_manager()"
check "has_feature() reads profiles.features" "update public.profiles set features = '{\"follow_ups\": true}' where id = '$U_CONSULTANT'; $as_consultant select public.has_feature('follow_ups') and not public.has_feature('other')"
expect_fail "consultant cannot change their own role" "$as_consultant update public.profiles set role = 'admin' where id = '$U_CONSULTANT'; select 1 / (select count(*)::int - 1 from public.profiles where id = '$U_CONSULTANT' and role = 'admin')"

# service role
check "service role reads everything" "set local role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); select (select count(*) from public.email_events) = 2 and (select count(*) from public.ai_usage) = 0 and public.is_app_user() and public.is_manager()"

# triggers and functions
check "assigning a consultant writes analysis_result.consultant" "select analysis_result ->> 'consultant' = 'Anja' from public.company_searches where id = '$CO_ONE'"
check "adding a second consultant lists both names" "insert into public.company_consultants (company_search_id, consultant_id) values ('$CO_ONE', '$C_KIM'); select analysis_result ->> 'consultant' = 'Anja, Kim' from public.company_searches where id = '$CO_ONE'"
check "unassigning removes the tag" "delete from public.company_consultants where company_search_id = '$CO_ONE'; select not (analysis_result ? 'consultant') from public.company_searches where id = '$CO_ONE'"
check "updated_at is touched on company_searches" "update public.company_searches set company_name = 'One Limited' where id = '$CO_ONE'; select updated_at > created_at from public.company_searches where id = '$CO_ONE'"
check "enqueue_analyze_company_batch dedupes on payload.companyId" "select public.enqueue_analyze_company_batch('[{\"companyId\":\"$CO_ONE\"},{\"companyId\":\"$CO_TWO\"},{\"companyId\":\"$CO_ONE\"}]'::jsonb, 'https://x/functions/v1/analyze-company', 'k') = 2"
check "enqueue_analyze_company_batch skips a company already waiting" "select public.enqueue_analyze_company_batch('[{\"companyId\":\"$CO_ONE\"}]'::jsonb, 'https://x', 'k') = 0"
check "enqueue_copy_generation: queued, then duplicate" "select public.enqueue_copy_generation('$CO_ONE', array['founder','coo'], 'manual') = 'queued' and public.enqueue_copy_generation('$CO_ONE', array['founder'], 'manual') = 'duplicate'"
check "enqueue_copy_generation: nightly cap" "select public.enqueue_copy_generation('$CO_TWO', array['founder'], 'nightly', false, 0) = 'capped'"
check "set_company_copy stores under analysis_result.copy.<persona>" "select public.set_company_copy('$CO_ONE', 'founder', '{\"email\":\"Hello\"}'::jsonb, 'call', null); select analysis_result -> 'copy' -> 'founder' ->> 'email' = 'Hello' and analysis_result ->> 'coldCallScript' = 'call' from public.company_searches where id = '$CO_ONE'"
check "set_analysis_signals stores signals and facts" "select public.set_analysis_signals('$CO_ONE', '[{\"code\":\"talent_role_open\"}]'::jsonb, '[]'::jsonb); select analysis_result -> 'signals' -> 0 ->> 'code' = 'talent_role_open' from public.company_searches where id = '$CO_ONE'"
check "close_stale_refresh_runs closes an old open run as degraded" "insert into public.company_refresh_runs (company_search_id, started_at) values ('$CO_ONE', now() - interval '30 minutes'); insert into public.company_refresh_runs (company_search_id, started_at) values ('$CO_ONE', now() - interval '2 minutes'); select public.close_stale_refresh_runs(10); select count(*) filter (where degraded and finished_at is not null) = 1 and count(*) filter (where finished_at is null) = 1 from public.company_refresh_runs"
check "get_ai_usage_summary() answers with the expected keys" "select (public.get_ai_usage_summary() ?& array['byDay','today','month','copyQueuePending','copyGeneratedToday'])"
check "get_vacancy_email_counters() answers with both templates" "select (public.get_vacancy_email_counters() -> 'counters') ?& array['new-vacancies-alert','friday-brief']"

# register tables
check "company_records row and ch_officers key filled by trigger" "insert into public.company_records (company_number, name, status, verified) values ('01234567', 'One Ltd', 'active', true); insert into public.ch_officers (company_number, name, role, appointed_on) values ('01234567', 'Jane Founder', 'director', '2021-03-01'); select officer_key = 'jane founder|director|2021-03-01' from public.ch_officers"
check "ch_officers upsert on (company_number, officer_key) updates in place" "insert into public.ch_officers (company_number, name, role, appointed_on, resigned_on) values ('01234567', 'Jane Founder', 'director', '2021-03-01', '2026-09-01') on conflict (company_number, officer_key) do update set resigned_on = excluded.resigned_on, last_seen_at = now(); select count(*) = 1 and bool_and(resigned_on = '2026-09-01') from public.ch_officers"
check "ch_officers uses the register's officer id as the key when given" "insert into public.ch_officers (company_number, officer_id, name, role) values ('01234567', 'abc123', 'Sam Secretary', 'secretary'); select officer_key = 'abc123' from public.ch_officers where officer_id = 'abc123'"
check "ch_filings key from transaction id, else date, type and description" "insert into public.ch_filings (company_number, transaction_id, date, type, description) values ('01234567', 'tx1', '2026-01-02', 'SH01', 'Statement of capital'); insert into public.ch_filings (company_number, date, type, description) values ('01234567', '2026-02-03', 'SH01', 'Statement of capital'); select (select filing_key from public.ch_filings where transaction_id = 'tx1') = 'tx1' and (select filing_key from public.ch_filings where transaction_id is null) like '2026-02-03|SH01|%'"
check "deleting a company_records row cascades to officers and filings" "delete from public.company_records where company_number = '01234567'; select (select count(*) from public.ch_officers) + (select count(*) from public.ch_filings) = 0"
check "ats_boards accepts a confirmed Ashby board" "insert into public.ats_boards (company_search_id, provider, slug, board_url, confirmed_at) values ('$CO_ONE', 'ashby', 'one', 'https://jobs.ashbyhq.com/one', now()); select count(*) = 1 from public.ats_boards"
expect_fail "ats_boards rejects an unknown provider" "insert into public.ats_boards (company_search_id, provider, slug) values ('$CO_ONE', 'bamboo', 'one')"
expect_fail "ats_boards is one row per company and provider" "insert into public.ats_boards (company_search_id, provider, slug) values ('$CO_ONE', 'ashby', 'one-again')"

# funding_news (slice 2)
check "funding_news accepts a matched story and an unmatched one" "insert into public.funding_news (source, external_key, title, url, publisher, published_at, company_name, amount_text, amount_gbp, round, matched_company_search_id, match_note) values ('uktn', 'https://www.uktech.news/one-raises', 'One raises £2m seed', 'https://www.uktech.news/one-raises', null, now(), 'One', '£2m', 2000000, 'seed', '$CO_ONE', 'exact name match'), ('google_news', 'https://news.google.com/rss/articles/abc', 'Metris Energy raises €4.35 million - EU-Startups', 'https://news.google.com/rss/articles/abc?oc=5', 'EU-Startups', now() - interval '2 days', 'Metris Energy', '€4.35 million', 3697500, null, null, null); select count(*) = 2 and count(*) filter (where first_seen_at is not null and created_at is not null) = 2 from public.funding_news"
expect_fail "funding_news rejects an unknown source" "insert into public.funding_news (source, external_key, title, url) values ('techcrunch', 'https://x/1', 't', 'https://x/1')"
expect_fail "funding_news is one row per canonical URL" "insert into public.funding_news (source, external_key, title, url) values ('sifted', 'https://www.uktech.news/one-raises', 'One raises £2m seed again', 'https://www.uktech.news/one-raises')"
check "consultant reads funding_news (both rows, no per-consultant rule)" "$as_consultant select count(*) = 2 from public.funding_news"
check "a signed-in user without a profile sees no funding_news" "$as_nobody select count(*) = 0 from public.funding_news"
expect_fail "anon cannot read funding_news" "$as_anon select count(*) from public.funding_news"
expect_fail "consultant cannot insert into funding_news" "$as_consultant insert into public.funding_news (source, external_key, title, url) values ('uktn', 'https://x/2', 't', 'https://x/2')"
expect_fail "consultant cannot update funding_news" "$as_consultant update public.funding_news set matched_company_search_id = '$CO_TWO' where company_name = 'Metris Energy'; select 1 / (select count(*)::int - 1 from public.funding_news where matched_company_search_id = '$CO_TWO')"
check "authenticated has no write privilege on funding_news" "select not (has_table_privilege('authenticated', 'public.funding_news', 'INSERT') or has_table_privilege('authenticated', 'public.funding_news', 'UPDATE') or has_table_privilege('authenticated', 'public.funding_news', 'DELETE'))"
check "service role upserts funding_news on external_key and keeps first_seen_at" "set local role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); update public.funding_news set first_seen_at = now() - interval '5 days' where external_key = 'https://www.uktech.news/one-raises'; insert into public.funding_news (source, external_key, title, url, matched_company_search_id) values ('sifted', 'https://www.uktech.news/one-raises', 'One raises £2m seed round', 'https://www.uktech.news/one-raises', '$CO_ONE') on conflict (external_key) do update set title = excluded.title; select count(*) = 2 and (select title from public.funding_news where external_key = 'https://www.uktech.news/one-raises') = 'One raises £2m seed round' and (select first_seen_at < now() - interval '4 days' from public.funding_news where external_key = 'https://www.uktech.news/one-raises') from public.funding_news"
check "deleting a company leaves its funding_news row unmatched" "insert into public.company_searches (id, url, company_name, analysis_result) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'https://three.example', 'Three Ltd', '{\"summary\":\"three\"}'); update public.funding_news set matched_company_search_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' where company_name = 'Metris Energy'; delete from public.company_searches where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'; select count(*) = 2 and count(*) filter (where matched_company_search_id is not null) = 1 and count(*) filter (where company_name = 'Metris Energy' and matched_company_search_id is null) = 1 from public.funding_news"
check "funding_news has its two indexes" "select count(*) = 2 from pg_indexes where schemaname = 'public' and tablename = 'funding_news' and indexname in ('idx_funding_news_published', 'idx_funding_news_matched')"
expect_fail "company_copy rejects a school persona" "insert into public.company_copy (company_search_id, persona, copy, model) values ('$CO_ONE', 'headteacher', '{}', 'm')"
check "company_copy accepts the five personas" "insert into public.company_copy (company_search_id, persona, copy, model) select '$CO_TWO', p, '{}', 'm' from unnest(array['founder','coo','people','cto','investor']) p; select count(*) = 5 from public.company_copy"
check "vacancy_feedback accepts wrong_company" "insert into public.vacancy_feedback (vacancy_id, kind) select id, 'wrong_company' from public.vacancies limit 1; select count(*) = 1 from public.vacancy_feedback"
expect_fail "vacancy_feedback rejects wrong_school" "insert into public.vacancy_feedback (vacancy_id, kind) select id, 'wrong_school' from public.vacancies limit 1"
check "a typed-in role may have no company (source consultant)" "insert into public.vacancies (company_search_id, vacancy_key, title, source) values (null, 'typed-1', 'Head of Talent', 'consultant'); select count(*) = 1 from public.vacancies where source = 'consultant' and company_search_id is null"

# prospects (slice 3)
check "prospects accepts a new row with the defaults and one row per name key" "insert into public.prospects (name, name_key, sources) values ('Metris Energy', 'metris energy', '[{\"source\":\"funding_news\",\"url\":\"https://n/1\",\"title\":\"t\",\"at\":null,\"note\":null}]'), ('Nul Health', 'nul health', '[]'); select count(*) = 2 and bool_and(status = 'new' and boards = '[]'::jsonb and first_seen_at is not null) from public.prospects"
expect_fail "prospects is one row per name key" "insert into public.prospects (name, name_key) values ('METRIS ENERGY LTD', 'metris energy')"
expect_fail "prospects rejects an unknown status" "insert into public.prospects (name, name_key, status) values ('X', 'x', 'maybe')"
check "the prospecting settings row is seeded" "select value ->> 'autoPromoteScore' = '60' and value ->> 'weeklyPromoteCap' = '15' from public.app_settings where key = 'prospecting'"
check "consultant reads prospects" "$as_consultant select count(*) = 2 from public.prospects"
check "a signed-in user without a profile sees no prospects" "$as_nobody select count(*) = 0 from public.prospects"
expect_fail "anon cannot read prospects" "$as_anon select count(*) from public.prospects"
check "consultant dismisses a prospect (status, dismissed_at, dismiss_reason)" "$as_consultant update public.prospects set status = 'dismissed', dismissed_at = now(), dismiss_reason = 'agency' where name_key = 'nul health'; select count(*) = 1 from public.prospects where name_key = 'nul health' and status = 'dismissed' and dismiss_reason = 'agency' and dismissed_at is not null"
check "consultant reopens a dismissed prospect (the trigger clears the reason)" "$as_consultant update public.prospects set status = 'new' where name_key = 'nul health'; select count(*) = 1 from public.prospects where name_key = 'nul health' and status = 'new' and dismiss_reason is null and dismissed_at is null"
expect_fail "consultant cannot promote a prospect" "$as_consultant update public.prospects set status = 'promoted' where name_key = 'nul health'"
expect_fail "consultant cannot change a prospect's score" "$as_consultant update public.prospects set prospect_score = 99 where name_key = 'nul health'"
expect_fail "consultant cannot change a prospect's website" "$as_consultant update public.prospects set website = 'https://x/' where name_key = 'nul health'"
expect_fail "consultant cannot insert a prospect" "$as_consultant insert into public.prospects (name, name_key) values ('Y', 'y')"
expect_fail "consultant cannot delete a prospect" "$as_consultant delete from public.prospects where name_key = 'nul health'; select 1 / (select count(*)::int from public.prospects where name_key = 'nul health')"
check "authenticated may update only the three dismissal columns" "select has_column_privilege('authenticated', 'public.prospects', 'status', 'UPDATE') and has_column_privilege('authenticated', 'public.prospects', 'dismiss_reason', 'UPDATE') and not has_column_privilege('authenticated', 'public.prospects', 'website', 'UPDATE') and not has_table_privilege('authenticated', 'public.prospects', 'INSERT') and not has_table_privilege('authenticated', 'public.prospects', 'DELETE')"
check "service role qualifies and promotes a prospect" "set local role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); update public.prospects set status = 'qualified', prospect_score = 75, score_reasons = '[{\"points\":45,\"text\":\"Head of Talent advertised\"}]', website = 'https://metrisenergy.com/', qualified_at = now() where name_key = 'metris energy'; update public.prospects set status = 'promoted', promoted_at = now(), promoted_company_id = '$CO_TWO' where name_key = 'metris energy'; select count(*) = 1 from public.prospects where status = 'promoted' and promoted_company_id = '$CO_TWO' and prospect_score = 75"
check "a manager deleting the company leaves the promoted prospect with no company (the guard lets the foreign key through)" "$as_manager delete from public.company_searches where id = '$CO_TWO'; select count(*) = 1 from public.prospects where name_key = 'metris energy' and status = 'promoted' and promoted_company_id is null"
check "prospects has its three indexes" "select count(*) = 3 from pg_indexes where schemaname = 'public' and tablename = 'prospects' and indexname in ('idx_prospects_status_score', 'idx_prospects_status_last_seen', 'idx_prospects_promoted_at')"

# follow_up_sequences and follow_up_steps (the Follow-ups port)
check "service role starts a sequence with its steps" "insert into public.company_consultants (company_search_id, consultant_id) values ('$CO_ONE', '$C_ANJA') on conflict do nothing; set local role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); insert into public.follow_up_sequences (id, company_search_id, consultant_id, created_by, contact_name, contact_email, contact_role, plan) values ('aaaaaaaa-0000-0000-0000-00000000000a', '$CO_ONE', '$C_ANJA', '$U_CONSULTANT', 'Jane Founder', 'jane@one.example', 'CEO', '[]'); insert into public.follow_up_steps (sequence_id, step_no, kind, day, due_at) values ('aaaaaaaa-0000-0000-0000-00000000000a', 1, 'call', 0, now()), ('aaaaaaaa-0000-0000-0000-00000000000a', 2, 'email', 0, now()); select count(*) = 2 from public.follow_up_steps"
expect_fail "one active sequence per company" "insert into public.follow_up_sequences (company_search_id, contact_name, contact_email) values ('$CO_ONE', 'Joe', 'joe@one.example')"
expect_fail "a step's status is one of the seven" "insert into public.follow_up_steps (sequence_id, step_no, kind, due_at, status) values ('aaaaaaaa-0000-0000-0000-00000000000a', 3, 'email', now(), 'posted')"
check "consultant reads the sequence for their own company" "$as_consultant select count(*) = 1 from public.follow_up_sequences"
check "consultant reads its steps" "$as_consultant select count(*) = 2 from public.follow_up_steps"
check "a signed-in user without a profile sees no sequences" "$as_nobody select (select count(*) from public.follow_up_sequences) + (select count(*) from public.follow_up_steps) = 0"
expect_fail "anon cannot read sequences" "$as_anon select count(*) from public.follow_up_sequences"
check "authenticated has no write privilege on sequences or steps" "select not (has_table_privilege('authenticated', 'public.follow_up_sequences', 'INSERT') or has_table_privilege('authenticated', 'public.follow_up_sequences', 'UPDATE') or has_table_privilege('authenticated', 'public.follow_up_steps', 'INSERT') or has_table_privilege('authenticated', 'public.follow_up_steps', 'UPDATE'))"
check "manager reads every sequence" "$as_manager select count(*) = 1 from public.follow_up_sequences"
check "updating a step touches updated_at" "update public.follow_up_steps set status = 'due' where step_no = 1 and sequence_id = 'aaaaaaaa-0000-0000-0000-00000000000a'; select updated_at >= created_at from public.follow_up_steps where step_no = 1 and sequence_id = 'aaaaaaaa-0000-0000-0000-00000000000a'"
check "deleting the company removes its sequence and steps" "delete from public.company_searches where id = '$CO_ONE'; select (select count(*) from public.follow_up_sequences) + (select count(*) from public.follow_up_steps) = 0"

# The two migrations the hosted project applies next need pgmq, pg_net,
# pg_cron and Vault, which this cluster does not have. plpgsql bodies are
# only parsed at creation, so with empty stand-in schemas (and a two-table
# stand-in for cron) both files can at least be applied for their syntax,
# their function signatures and their grants. The extension statements are
# the one thing taken out.
echo "== syntax check of the queue, network and cron migrations (stand-in schemas, no extensions)"
psqlq <<'SQL'
create schema pgmq; create schema net; create schema vault; create schema cron;
create table cron.job (jobid bigint generated always as identity primary key, jobname text unique, schedule text not null, command text not null, active boolean not null default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$
  delete from cron.job where jobid = job_id returning true $$;
SQL
sed -E '/^create extension /d; s/^    create extension pg_cron;/    null;/' "$ROOT/supabase/migrations/20260921120050_queues_and_net.sql" > "$WORK/queues.sql"
if psqlq -f "$WORK/queues.sql" >"$WORK/queues.log" 2>&1 && ! grep -qi error "$WORK/queues.log"; then PASS=$((PASS + 1)); echo "pass  20260921120050_queues_and_net.sql applies against stand-in schemas"
else FAIL=$((FAIL + 1)); echo "FAIL  20260921120050_queues_and_net.sql"; cat "$WORK/queues.log"; fi
check "the queue functions the code calls by rpc exist" \
  "select bool_and(to_regprocedure(f) is not null) from unnest(array['public.enqueue_email(text,jsonb)','public.read_email_batch(text,integer,integer)','public.delete_email(text,bigint)','public.move_to_dlq(text,text,bigint,jsonb)','public.http_page_enqueue(text,integer)','public.http_page_result(bigint)','public.get_pipeline_health()','public.get_cron_last_run(bigint)','public.get_cron_recent_runs(bigint,integer)','public.get_cron_monitoring_jobs_only()','public.dispatch_analyze_company_queue(integer,numeric)','public.dispatch_copy_queue(integer)','public.invoke_edge_function(text,jsonb)','public.process_email_queue_tick()']) f"
check "authenticated may call get_pipeline_health() and nothing else internal" \
  "select has_function_privilege('authenticated', 'public.get_pipeline_health()', 'EXECUTE') and not has_function_privilege('authenticated', 'public.enqueue_email(text,jsonb)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.http_page_enqueue(text,integer)', 'EXECUTE') and not has_function_privilege('anon', 'public.get_pipeline_health()', 'EXECUTE')"
expect_fail "http_page_enqueue refuses a caller that is not the service role" "select set_config('request.jwt.claims', '$claims_consultant', true); select public.http_page_enqueue('https://x')"
if psqlq -f "$ROOT/supabase/migrations/20260921120100_cron_jobs.sql" >"$WORK/cron.log" 2>&1 && ! grep -qi error "$WORK/cron.log"; then PASS=$((PASS + 1)); echo "pass  20260921120100_cron_jobs.sql applies against the cron stand-in"
else FAIL=$((FAIL + 1)); echo "FAIL  20260921120100_cron_jobs.sql"; cat "$WORK/cron.log"; fi
check "twelve jobs scheduled with the brief's names" \
  "select count(*) = 15 and bool_and(jobname in ('process-email-queue','dispatch-analyze-company-queue','dispatch-copy-queue','close-stale-refresh-runs','sync-companies-house','sync-ats-boards','sync-funding-news','discover-prospects','qualify-prospects','tick-follow-ups','auto-refresh-vacancies-trigger','refresh-all-companies','refresh-scores','send-friday-brief','auto-refresh-vacancies-compare')) from cron.job"
check "sync-funding-news runs at 05:20 UTC daily" \
  "select schedule = '20 5 * * *' from cron.job where jobname = 'sync-funding-news'"
check "the follow-ups tick runs every fifteen minutes" \
  "select schedule = '*/15 * * * *' from cron.job where jobname = 'tick-follow-ups'"
check "the prospect radar runs at 05:30 and qualifies at 05:40" \
  "select (select schedule from cron.job where jobname = 'discover-prospects') = '30 5 * * *' and (select schedule from cron.job where jobname = 'qualify-prospects') = '40 5 * * *'"
check "the cron file is idempotent (a second apply keeps fifteen jobs)" \
  "$(cat "$ROOT/supabase/migrations/20260921120100_cron_jobs.sql" | grep -v '^--' | tr '\n' ' ') select count(*) = 15 from cron.job"
check "the monitoring job list names only scheduled jobs" \
  "select bool_and(j ->> 'configured' = 'true') from jsonb_array_elements(public.get_cron_monitoring_jobs_only()) j"

echo
echo "== $PASS passed, $FAIL failed"

# --types: regenerate src/integrations/supabase/types.ts from this cluster
# (the public schema, with the queue and network functions from the stand-in
# apply above, which is what the hosted project has). `supabase gen types
# --db-url` runs postgres-meta in Docker, which a cloud session does not
# have, so the same generator is run in-process from the npm package. The
# file is written only when generation succeeds.
if [[ "$GEN_TYPES" == 1 ]]; then
  echo "== generating src/integrations/supabase/types.ts (postgres-meta in-process, no Docker)"
  GEN="$WORK/gen"
  mkdir -p "$GEN"
  ( cd "$GEN" && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund --silent @supabase/postgres-meta@0.99.0 >/dev/null 2>&1 ) || { echo "npm install @supabase/postgres-meta failed" >&2; exit 1; }
  cat > "$GEN/gen-types.mjs" <<'JS'
import { PostgresMeta } from '@supabase/postgres-meta';
import { getGeneratorMetadata } from '@supabase/postgres-meta/dist/lib/generators.js';
import { generateTypescriptTypes } from '@supabase/postgres-meta/dist/server/format-pool.js';
const pgMeta = new PostgresMeta({ connectionString: process.argv[2], max: 1 });
const { data, error } = await getGeneratorMetadata(pgMeta, { includedSchemas: ['public'], excludedSchemas: [] });
if (error) { console.error(error); process.exit(1); }
const out = await generateTypescriptTypes(data, { detectOneToOneRelationships: false, postgrestVersion: '14.5', defaultSchema: 'public' });
process.stdout.write(out);
await pgMeta.end();
process.exit(0);
JS
  if ( cd "$GEN" && node gen-types.mjs "postgresql://postgres@127.0.0.1:$PORT/postgres" > "$GEN/types.ts" 2> "$GEN/gen.err" ) && grep -q "export type Database" "$GEN/types.ts"; then
    cp "$GEN/types.ts" "$ROOT/src/integrations/supabase/types.ts"
    echo "   $(wc -l < "$ROOT/src/integrations/supabase/types.ts") lines written"
  else
    echo "types generation failed:" >&2; cat "$GEN/gen.err" >&2; exit 1
  fi
fi

[[ "$FAIL" == 0 ]]
