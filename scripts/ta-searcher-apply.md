# TA Searcher: switch-on steps

Nothing in `ta-searcher/` is deployed, applied or sending. Four steps are
Craig's (the session cannot create a repository, a billed project, a site
or an API key); everything after them is a session's work once Craig sends
the four identifiers.

## Craig's four steps

1. **GitHub repository.** https://github.com/new: owner `craigspringett`,
   name `ta-searcher`, private, no README (the code brings its own). Then
   install the Claude GitHub app on it at
   https://github.com/apps/claude/installations/select_target so a session
   can push. Send the name.
2. **Supabase project.** https://supabase.com/dashboard/new/lhemdlzhwoalsdynjfww
   (the same organisation as He-Giveth): name `TA Searcher`, region West EU
   (Ireland), generate a database password and keep it in a password
   manager (the app never needs it). Send the project reference (the
   twenty-letter id in the dashboard URL).
3. **Companies House API key.** Register at
   https://developer.company-information.service.gov.uk/ (a GOV.UK
   account), then "Manage applications", "Create an application", name
   `TA Searcher`, environment Live, then "Create new key", type REST. Copy
   the key. Add it to the new project at Project settings, Edge Functions,
   Secrets as `COMPANIES_HOUSE_API_KEY` (or send it to the session over a
   channel you trust and it will set it). Free, 600 requests per five
   minutes.
4. **Netlify site.** https://app.netlify.com/start: import from GitHub,
   choose `craigspringett/ta-searcher`, branch `main`, build command
   `npm run build`, publish directory `dist`. Add the three environment
   variables from step 2's API settings page: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY` (the anon key), `VITE_SUPABASE_PROJECT_ID`
   (the reference). Send the site name. (The Netlify token in the sessions
   answers 401 today; a fresh personal access token at
   https://app.netlify.com/user/applications lets a session do this step
   instead.)

Which keys to reuse: the He-Giveth project holds `GEMINI_API_KEY`,
`ANTHROPIC_API_KEY`, `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. Say
whether TA Searcher may use the same accounts (the session can copy the
values across without printing them) or whether Big Fish gets its own.

## The session's steps, once the identifiers arrive

5. Move the code: `git subtree split -P ta-searcher -b ta-searcher-main` in
   the `who-finds-leads` checkout, push that branch to the new repository's
   `main`. Put the project reference in `supabase/config.toml`.
6. Apply `supabase/migrations/20260921120000_ta_searcher_baseline.sql`,
   then `20260921120050_queues_and_net.sql`, then `20260921120100_cron_jobs.sql`
   and `20260921130000_funding_news.sql`, through the Management API
   (`SUPABASE_PROJECT_REF=<ref> scripts/sb-sql.sh -f ...`), record them in
   `supabase_migrations.schema_migrations`, run `supabase/seed.sql`, and
   create the two Vault secrets the cron jobs read (`project_url`,
   `email_queue_service_role_key`). Regenerate
   `src/integrations/supabase/types.ts` from the live project.
7. Auth: email provider with OTP on, the "before user created" hook at
   `pg-functions://postgres/public/auth_before_user_created`, the send-email
   hook at the `auth-send-email` function.
8. Secrets: the four AI and email keys, `COMPANIES_HOUSE_API_KEY`,
   `REPLY_TO_EMAIL` (craig@bigfishrecruitment.co.uk), `APP_BASE_URL` (the
   site's address), `VACANCY_FEEDBACK_SECRET` (any long random string).
9. Email: verify `notify.bigfishrecruitment.co.uk` in Resend (the DNS
   records come from Resend), point the Resend webhook at
   `handle-email-events`.
10. Deploy every function under `supabase/functions` (`npx supabase functions deploy`).
11. Sign in as craig@bigfishrecruitment.co.uk (the hook makes that address
    an admin), add Craig on the Consultants page, add Searchable and two
    other companies, run "Analyse" on each and read the result before
    queueing anything else. Then `sync-funding-news` once to fill "New
    raises this week".
12. Dry runs before the schedules fire: `send-friday-brief` with
    `{"dryRun":true,"render":true}` and `auto-refresh-vacancies` with
    `{"phase":"compare-and-alert","dryRun":true}`; pause any cron job with
    `cron.alter_job(jobid, active => false)` until approved.
