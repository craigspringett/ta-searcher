#!/usr/bin/env bash
# Run SQL against the TA Searcher Supabase project through the Management API.
# Direct Postgres connections do not work through the session proxy, so every
# query goes to POST /v1/projects/<ref>/database/query as {"query": <sql>}.
#
# Usage:
#   scripts/sb-sql.sh "select count(*) from company_searches"
#   scripts/sb-sql.sh -f scripts/some-file.sql
#   echo "select 1" | scripts/sb-sql.sh
#
# Prints the JSON result. On an HTTP error prints the response body to stderr
# and exits non-zero. Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (the
# new project's ref; there is no default, so nothing can reach He-Giveth by
# accident) in the environment; jq is used to build the JSON body when
# available, otherwise python3.
set -euo pipefail

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "sb-sql: SUPABASE_PROJECT_REF is not set (the TA Searcher project ref; no default)" >&2
  exit 2
fi
PROJECT_REF="${SUPABASE_PROJECT_REF}"
URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "sb-sql: SUPABASE_ACCESS_TOKEN is not set" >&2
  exit 2
fi

sql=""
if [[ "${1:-}" == "-f" ]]; then
  [[ -n "${2:-}" ]] || { echo "sb-sql: -f needs a file" >&2; exit 2; }
  sql="$(cat "$2")"
elif [[ $# -ge 1 ]]; then
  sql="$1"
else
  sql="$(cat)"
fi

if [[ -z "${sql//[[:space:]]/}" ]]; then
  echo "sb-sql: no SQL given" >&2
  exit 2
fi

# The SQL can be large (a data-fix script), so it goes through files rather
# than command-line arguments.
tmp="$(mktemp)"
sqlfile="$(mktemp)"
bodyfile="$(mktemp)"
trap 'rm -f "$tmp" "$sqlfile" "$bodyfile"' EXIT
printf '%s' "$sql" > "$sqlfile"
if command -v jq >/dev/null 2>&1; then
  jq -cn --rawfile q "$sqlfile" '{query: $q}' > "$bodyfile"
else
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$sqlfile" > "$bodyfile"
fi

status="$(curl -sS -o "$tmp" -w '%{http_code}' -X POST "$URL" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@$bodyfile")"

if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
  echo "sb-sql: HTTP ${status}" >&2
  cat "$tmp" >&2
  echo >&2
  exit 1
fi
cat "$tmp"
echo
