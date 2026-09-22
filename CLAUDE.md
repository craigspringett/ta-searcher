# TA Searcher

Internal buyer-intent and hiring-alert portal for placing Heads of Talent
Acquisition (Heads of Recruitment) into seed and Series A start-ups. Built
for Craig Springett's Big Fish Recruitment as a replica of He-Giveth, the WhoFoundWho schools portal in the
`craigspringett/who-finds-leads` repository. Consultants add a company by name (Companies
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
  (managers), `PipelineMonitoring`, `Login`. Deployed by Netlify from `main`
  (site `ta-searcher`, https://ta-searcher.netlify.app); every push to
  `main` deploys.
- Backend: Supabase project **TA Searcher**, ref `onlnizycknfuuprsmypl`
  (eu-central-1, Postgres 17). Edge functions in
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
  (`notify.bigfishrecruitment.co.uk`) and reply-to are constants in
  `send-transactional-email` and `auth-send-email`.
- Funding news (slice 2): `sync-funding-news` (05:20 UTC) reads UKTN,
  Sifted and Google News RSS (a general search and one per tracked
  company) into `funding_news`, one row per canonical article URL,
  keeping raise headlines only (`_shared/funding-news/`: `rss.ts` the
  parser, `detect.ts` the raise rule and the company name from the
  headline, `match.ts` the name match through the ATS employer rule,
  `sources.ts` the feeds, `run.ts` the pass; fixtures and tests beside
  them). A matched story joins the company's facts as a `funding_round`
  through `loadFundingNewsFacts` (`_shared/signals/load.ts`) in
  `analyze-company`, `recompute.ts` and the copy context, never in
  `company_facts`. `NewRaisesCard` on My patch (`src/lib/newRaises.ts`
  the rule, `newRaisesData.ts` the read) lists the fortnight's raises
  with "Add", which prefills the add form from `/companies?add=<name>`.
  Migration `20260921130000_funding_news.sql`, applied by the local test.
- Prospecting (slice 3, `docs/PROSPECTING-BRIEF.md`): the site finds the
  companies. `discover-prospects` (05:30 UTC) reads the unmatched funding
  news plus eight Google News searches, a page of the Companies House
  advanced search per SIC code and place (watermarks in
  `app_settings.prospecting`), and the Adzuna and Reed job APIs
  (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY`; a missing key skips
  the source) into `prospects`, one row per name key.
  `qualify-prospects` (05:40 UTC, or from the page for one id) matches the
  register, finds the website (known, the Adzuna landing, or guessed over
  seven TLDs and verified), the boards, scores the prospect
  (`_shared/prospecting/score.ts`, every line in `score_reasons`) and
  promotes what reaches `autoPromoteScore` (60) up to `weeklyPromoteCap`
  (15) a week into `company_searches` with the single active consultant,
  the confirmed boards and a queued `analyze-company`. Modules in
  `_shared/prospecting/` (sources, website, score, qualify, promote,
  discover, run) with fakes in `prospecting_test.ts`. A signed-in user
  may only dismiss or reopen a prospect (a trigger guards the other
  columns). Page `Prospects` (`/prospects`, `src/lib/prospects.ts` the
  rules, `prospectsData.ts` the reads), `RadarLine` on My patch.
  Migration `20260921150000_prospects.sql`.
- Follow-ups (ported from He-Giveth's main on 21 September 2026, behind
  `profiles.features.follow_ups`, `has_feature()`, `src/lib/features.ts`):
  `send-outreach-email` sends one consultant-written email to one company
  contact through the queue with the `outreach-email` template, from the
  consultant's own name when the domain is in `app_settings.sending_domains`
  (`_shared/sending-domains.ts`), reply-to the consultant, logging an
  `emailed` outcome; rules in `_shared/outreach/rules.ts`. Sequences:
  tables `follow_up_sequences` (one active per company) and
  `follow_up_steps`, migration `20260921160000_follow_ups.sql`; rules in
  `_shared/follow-ups/` (`schedule.ts` London time, `plan.ts` days 0, 4,
  8, 14, `stop.ts`, `prompt.ts` the start-up prompt with the five persona
  notes, `draft.ts` one Claude call per draft, `store.ts`); functions
  `follow-ups` (plan, start, skip, done, mark_sent for an email sent from
  Outlook, stop, redraft), `draft-follow-up`,
  `tick-follow-ups` (every 15 minutes, never sends), `resend-domains`
  (managers: list, add, verify a Resend domain). `handle-email-events`
  writes `email_events`. App: `EmailContactDialog`, `ContactEngagement`
  and the two buttons under a contact (`ContactsCard`'s `extra` prop),
  `StartFollowUpsDialog`, `FollowUpsCard` (company page), `FollowUpsDueCard`
  and `WarmNowCard` (My patch), page `FollowUps` (`/follow-ups`); rules in
  `src/lib/followUps.ts` and `emailEvents.ts`.
- Pipeline board (22 September 2026): `company_searches.pipeline_stage`
  (prospect, contacted, call_booked, search_agreed, lost) and
  `pipeline_moved_at`; an outcome advances the stage on its own (trigger
  `advance_pipeline_on_outcome`, never backwards, never off lost); page
  `Pipeline` (`/pipeline`, rules in `src/lib/pipeline.ts`, reads in
  `pipelineData.ts`), `PipelineStageControl` on the company page.
  LinkedIn links (`_shared/contacts/linkedin.ts`, `src/lib/linkedin.ts`):
  `analysis_result.linkedin` is the company page from its site or Hunter,
  a contact's `linkedin` is Hunter's profile, else a people search.
  Migration `20260922100000_pipeline.sql`.
- Weekly cadence (UTC): Friday 05:00 snapshot, 05:05 `refresh-all-companies`
  queues every company into `analyze_company_queue` (ten a minute), 06:55
  `send-friday-brief`, 07:30 `auto-refresh-vacancies` compare-and-alert.
  Daily: 04:40 register, 04:50 ATS feeds, 05:20 funding news, 05:30 prospect
  discovery, 05:40 prospect qualification, 06:40 scores. Every 15 minutes:
  the follow-ups tick.

## Working in a cloud session

- `scripts/local-db-test.sh` applies the migrations to a throwaway
  Postgres 16 and checks the row security before anything goes live.
  `scripts/sb-sql.sh` runs SQL on the hosted project through the
  Management API with `SUPABASE_PROJECT_REF=onlnizycknfuuprsmypl` and
  `SUPABASE_ACCESS_TOKEN` set; record an applied migration in
  `supabase_migrations.schema_migrations`.
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
scripts/local-db-test.sh              # every plain-SQL migration and its row security on a throwaway local Postgres 16 (136 assertions)
node scripts/embed-value-proposition.mjs   # after editing _shared/copy/value-proposition.md
```
