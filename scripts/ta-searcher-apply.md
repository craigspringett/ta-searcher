# TA Searcher: switch-on steps

Nothing in `ta-searcher/` is deployed, applied or sending. This is the order
to bring it up, once Craig has answered the brief's questions.

1. **Repository.** Create `craigspringett/ta-searcher` (private) on GitHub.
   Move the directory: from the `who-finds-leads` checkout,
   `git subtree split -P ta-searcher -b ta-searcher-main` then push that
   branch to the new repository's `main`. The history of the port comes
   with it.
2. **Supabase project.** Create a project in the same organisation (eu-west-1,
   Postgres 17). Note the ref and put it in `supabase/config.toml`
   (`project_id`) and in `.env` / Netlify (`VITE_SUPABASE_PROJECT_ID`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Enable the
   `pg_cron`, `pg_net` and `pgmq` extensions in the dashboard (the
   migration creates them when it can). Store the project URL and the
   service role key in Vault under the names the cron migration reads.
3. **Migration.** `scripts/local-db-test.sh` first (green). Then apply
   `supabase/migrations/20260921120000_ta_searcher_baseline.sql` through
   the Management API (`SUPABASE_PROJECT_REF=<ref> scripts/sb-sql.sh -f ...`),
   then the cron migration, and record both in
   `supabase_migrations.schema_migrations`. Apply `supabase/seed.sql` if
   present. Regenerate `src/integrations/supabase/types.ts` from the live
   project (`npx supabase gen types typescript --project-id <ref>`).
4. **Auth.** In Authentication settings: email provider with OTP, the
   "before user created" hook pointing at `auth_before_user_created`, the
   send-email hook at the `auth-send-email` function once it is deployed.
   Confirm the two sign-in domains in `is_allowed_login_email` and
   `src/lib/auth.tsx`.
5. **Secrets.** `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
   `RESEND_WEBHOOK_SECRET`, `COMPANIES_HOUSE_API_KEY` (free, register at
   developer.company-information.service.gov.uk), `REPLY_TO_EMAIL`,
   `APP_BASE_URL` (the site's address), `VACANCY_FEEDBACK_SECRET`.
6. **Email.** Verify the sending sub-domain in Resend (the constants in
   `send-transactional-email` and `auth-send-email` say
   `notify.bigfishrecruitment.co.uk`; change them if the brand differs).
   Point the Resend webhook at `handle-email-events`.
7. **Functions.** `npx supabase functions deploy` for every directory under
   `supabase/functions`. `analyze-company` and `generate-copy` bundle
   `_shared/copy/value-proposition.md` (see `config.toml`).
8. **Netlify.** A site from the repository with base directory `.` (once the
   code is in its own repository), build `npm run build`, publish `dist`,
   the three `VITE_` variables, and a custom domain if wanted.
9. **People and companies.** Add the consultants on the Consultants page;
   add the first companies on the Companies page (search Companies House,
   confirm the website). Run "Analyse" on two or three and read the result
   before queueing the rest.
10. **First sends.** `send-friday-brief` with `{"dryRun":true,"render":true}`
    and `auto-refresh-vacancies` with `{"phase":"compare-and-alert","dryRun":true}`
    before the schedules fire. The cron jobs are created by the cron
    migration; pause any with `cron.alter_job(jobid, active => false)`
    until the dry runs are approved.
