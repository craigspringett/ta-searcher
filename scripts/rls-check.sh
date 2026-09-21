#!/usr/bin/env bash
# Run a query as a simulated caller, the way PostgREST would, to test row
# security before a policy goes live. Wraps scripts/sb-sql.sh (which needs
# SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF).
#
#   scripts/rls-check.sh anon "select count(*) from company_searches"
#   scripts/rls-check.sh <auth user uuid> "select count(*) from profiles"      # a signed-in user
#   scripts/rls-check.sh 00000000-0000-0000-0000-000000000000 "select ..."     # a user with no profile
#
# The role and the JWT claims are set for the statement only (set local), so
# nothing persists; the query itself must be a single SELECT.
set -euo pipefail
who="${1:?caller: anon or an auth.users id}"
sql="${2:?sql}"
dir="$(cd "$(dirname "$0")" && pwd)"
if [[ "$who" == "anon" ]]; then
  role=anon; claims='{"role":"anon"}'
else
  role=authenticated; claims="{\"sub\":\"$who\",\"role\":\"authenticated\",\"aud\":\"authenticated\"}"
fi
"$dir/sb-sql.sh" "set local role ${role}; select set_config('request.jwt.claims', '${claims}', true); ${sql}"
