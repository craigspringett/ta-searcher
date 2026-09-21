# TA Searcher

Internal buyer-intent and hiring-alert portal for placing Heads of Talent
Acquisition (Heads of Recruitment) into seed and Series A start-ups. Built
for Craig Springett (Big Fish Recruitment; the brand is not yet confirmed,
see the brief) as a replica of He-Giveth, the WhoFoundWho schools portal at
`../` in this repository. Consultants add a company by name (Companies
House) and website; the app reads the site, the register and the company's
applicant tracking system, tracks its open roles, scores how likely it is
to need a Head of Talent, writes the scripts, and emails a weekly brief and
a new-roles alert.

Read `docs/TA-SEARCHER-BRIEF.md` first: the mapping from He-Giveth, the
decisions taken, and the questions for Craig. `docs/PORT-CONTRACTS.md` fixes
the interfaces between modules. `docs/TA-SEARCHER-REPORT.md` says what was
built and verified on 21 September 2026 and what is not yet applied.
`docs/COPY-STYLE.md` holds the copy rules.

## Stack and where things run

- Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui, the same
  kit as He-Giveth. Pages: `MyPatch` (`/`), `Index.tsx` (the company list
  and detail, `/companies` and `/companies/:id`), `Alerts`, `Consultants`
  (managers), `PipelineMonitoring`, `Login`. To be deployed by Netlify from
  this directory (base directory `ta-searcher`, publish `dist`).
- Backend: a new Supabase project (not yet created). Edge functions in
  `supabase/functions/*`, the baseline migration in `supabase/migrations/`,
  cron jobs in `supabase/migrations/20260921120100_cron_jobs.sql` (pg_cron +
  pg_net, project URL and service role key from Vault, as He-Giveth).
- Identity: Companies House (`_shared/companies-house.ts`; free API key as
  the `COMPANIES_HOUSE_API_KEY` secret). `company-lookup` searches the
  register for the add form; `sync-companies-house` (04:40 UTC) refreshes
  every tracked company's record, officers (`ch_officers`) and capital
  filings (`ch_filings`, SH01 allotments). A company without a number is
  analysed from its website alone.
- Open roles: `_shared/vacancies/` (pipeline, identity, persist as
  He-Giveth) with sources `source-ashby.ts`, `source-greenhouse.ts`,
  `source-lever.ts`, `source-workable.ts` (public JSON feeds) and
  `source-careers-page.ts`; `ats-detect.ts` finds a company's board from
  its pages and `ats_boards` holds the confirmed slug per provider.
  `sync-ats-boards` (04:50 UTC) reads every confirmed feed nightly with no
  model call. Every open role counts; `role-family.ts` sorts them into
  engineering, product and design, go to market, operations, people and
  talent, leadership, other, and `isTalentLeadRole` names the role Craig
  places.
- AI: Gemini (`_shared/ai.ts`) runs the evidence pass (`_shared/facts/`,
  kinds in `types.ts`, the stage and latest-raise derivations in
  `derive.ts`) and the departures pass over the blog and news pages.
  Claude (`claude-opus-5`, `_shared/copy/generate.ts`) writes the persona
  scripts: founder, coo, people, cto, investor. `ANTHROPIC_API_KEY` and
  `GEMINI_API_KEY` are project secrets. Every model call is logged to
  `ai_usage`.
- Signals: `_shared/signals/compute.ts` (the taxonomy is the brief's table),
  the score in `_shared/score/propensity.ts`, stored in `company_signals`
  and `company_scores` by `analyze-company` and by `refresh-scores` daily
  at 06:40 UTC (`{"recomputeSignals":true}` recomputes from stored data
  after a rule change).
- Contacts: `_shared/contacts/` (extract, resolve, pages, review, edits) as
  He-Giveth with the start-up role taxonomy (founder, coo, cto, people,
  talent, exec, ea, investor). Directors from the register join the list as
  name-only people. `contact-edits` and `handle-contact-feedback` as before.
- Email: Resend, through pgmq queues drained by `process-email-queue`;
  `send-transactional-email` renders the templates in
  `_shared/transactional-email-templates/` (`new-vacancies-alert`,
  `friday-brief`, `outreach-email`, `engagement-alert`). The sending domain
  and reply-to are constants in `send-transactional-email` and
  `auth-send-email` until the brand is confirmed.
- Weekly cadence (UTC): Friday 05:00 snapshot, 05:05 `refresh-all-companies`
  queues every company into `analyze_company_queue` (ten a minute), 06:55
  `send-friday-brief`, 07:30 `auto-refresh-vacancies` compare-and-alert.
  Daily: 04:40 register, 04:50 ATS feeds, 06:40 scores.

## Working in a cloud session

- Until the Supabase project exists, the database is tested locally:
  `scripts/local-db-test.sh` applies the baseline to a throwaway Postgres 16
  and checks the row security. Once it exists, `scripts/sb-sql.sh` runs SQL
  through the Management API with `SUPABASE_PROJECT_REF` and
  `SUPABASE_ACCESS_TOKEN` set.
- Never print secret values. Never commit secrets.
- Deploying an edge function makes it live immediately. Deploy only after
  the change is verified locally as far as it can be.

## Safety rules

- **Never send a real email while testing.** Use `dryRun`, a test address
  you control, or pause the `process-email-queue` job and purge the queues.
- Never wipe or bulk-rewrite `company_searches` without a backup of
  `analysis_result`.
- Any backup table made in `public` must be locked at creation (RLS on,
  revoke from anon and authenticated).
- `analyze-company` costs money per run (Gemini, then Claude for the founder
  script) and takes 30 to 90 seconds. Test on two or three companies.
- Do not change cron schedules without noting it in the brief.

## Conventions

As He-Giveth: a `claude/<topic>` branch; imperative one-line commit
messages; UK spelling; ISO dates stored, UK-first parsed; consultants and
their companies are data (`consultants`, `company_consultants`); semantic
colour classes only; pure logic in `src/lib` with a Vitest test beside it;
no em dashes, no exclamation marks, sentences not labels, in every
user-facing string.

## Useful checks

```sh
npm install && npm run build          # frontend build
npx tsc --noEmit -p tsconfig.app.json # frontend types
npx eslint src                        # 0 errors expected
npm test                              # Vitest for src/lib
cd supabase/functions && DENO_NO_PACKAGE_JSON=1 deno test --allow-all --no-check --node-modules-dir=none _shared   # unit tests (Deno: curl -fsSL https://deno.land/install.sh | sh -s v2.4.5, then ~/.deno/bin)
scripts/local-db-test.sh              # the baseline migration and its row security on a throwaway local Postgres 16
node scripts/embed-value-proposition.mjs   # after editing _shared/copy/value-proposition.md
```
