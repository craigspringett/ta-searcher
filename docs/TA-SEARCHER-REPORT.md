# TA Searcher: build report, 21 September 2026

What was built in the first session, what was verified, and what is not yet
done. The design is `TA-SEARCHER-BRIEF.md`; the module interfaces are
`PORT-CONTRACTS.md`; the switch-on order is `../scripts/ta-searcher-apply.md`.

## Where it is

Its own repository, `craigspringett/ta-searcher`, on `main` (moved there
on 21 September 2026 with `git subtree split` from the `ta-searcher/`
directory of `who-finds-leads`, where the port was built; that directory
is now history only). Nothing is deployed, applied or sending: there is no
Supabase project, no Netlify site and no key yet.

About 30,800 lines of TypeScript and SQL, of which roughly two thirds is
He-Giveth's generic engine carried over unchanged in behaviour and one
third is new or rewritten for the start-up market.

## What was verified

| Check | Result |
|---|---|
| Deno unit tests, `supabase/functions/_shared` | 299 passed, 0 failed |
| Vitest, `src/lib` | 41 passed (8 files) |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 errors |
| `npx eslint src` | 0 errors (23 warnings, the shadcn kit's usual ones) |
| `npm run build` | passes |
| `scripts/local-db-test.sh` (throwaway Postgres 16) | 99 assertions passed |
| `deno check` on every edge function | passes |

The Deno suite covers the register parsers and cache rule (31 tests), the
four ATS feed parsers against real fixtures and the careers-page source
(62), the facts, derivations, signals and score (55), the contacts and copy
rules, the alerts eligibility, the brief ranking, the email plumbing and
the fetch ladder. The local database test applies the baseline and checks
row security for anon, a consultant, a manager and the service role.

Not verified, because it needs the hosted project or a key: a live
`analyze-company` run, the Companies House API against real answers (the
fixtures are hand-written in the documented shapes), the Workable feed (its
endpoint rate-limited the build session's proxy), the email templates
rendered by `send-transactional-email`, and the Playwright smoke test.

## What was built

**Identity.** `_shared/companies-house.ts`: search, profile, officers and
capital filings from the Companies House API with a free key, the
`company_records` cache (30 days, unverified rows refetched), officers into
`ch_officers` and SH01 allotments into `ch_filings`, `sectorFromSic`,
`isDefunctStatus`. `company-lookup` for the add form; `sync-companies-house`
daily at 04:40 UTC. A dissolved company is marked and never refreshed again.

**Open roles.** Sources for Ashby, Greenhouse, Lever and Workable (public
JSON feeds; Searchable's Ashby board answers 13 roles today) and the
company's careers page (start-up paths and JSON-LD JobPosting);
`ats-detect.ts` finds a board from the pages and `confirmBoard` reads it
once before it is stored in `ats_boards`; the pipeline keeps He-Giveth's
identity, re-key, first-seen and degraded-run rules and writes the
department, location, workplace type and posting date on every row (a new
row's `first_seen` is the posting date). `sync-ats-boards` reads every
confirmed feed nightly at 04:50 UTC with no model call. Every open role
counts; `role-family.ts` sorts them into seven families and names the
talent roles. Two same-titled postings on one feed with their own URLs are
two roles (Searchable's London and Utah Account Executives).

**Facts, signals, score.** Twenty-two fact kinds for a start-up (funding
round, investor, stage, headcount, hiring plan, people function, talent
team, agency mention, accelerator and the rest); `derive.ts` reads the
stage and the latest raise (amount, round, investors, date) out of the
facts; the departures pass reads the blog and news pages instead of
newsletters. Sixteen signals with the brief's points and the
`has_talent_lead` halving; the score, the fade, the outcome adjustments and
the bands are He-Giveth's. `refresh-scores` recomputes daily.

**Contacts and copy.** The role taxonomy (founder, coo, cto, people,
talent, exec, ea, investor), the start-up page paths, the same join and
guessing rules; directors from the register join the people list as name
only. Personas founder, coo, people, cto and investor with new persona
notes; the value proposition is a placeholder with `[Craig to confirm]`
markers and the Searchable placement as the one proof point; the checks
drop the supply-teaching phrases and keep every fee rule and model tell.

**Integration.** `analyze-company` (the orchestrator, 2,726 lines in
He-Giveth, now about 850) reads the register, the confirmed boards and the
website, confirms any board the careers page links to in the same run,
stores contacts even when the model fails, keeps the deferred pg_net pass,
and writes `companyRecord`, `officers`, `boards`, `stage`, `latestRaise`
and the rest of the `analysis_result` contract. The new-roles alert
(Friday 07:30 UTC, new means first seen since the last weekly refresh), the
Friday brief (stage and sector on each line, no calendar countdown), the
catch-up alert, the templates and the sign-in email are reworded; the
closing-date alert is gone (ATS postings rarely carry one).

**Database.** One baseline migration (32 tables, the RLS helpers as
SECURITY DEFINER, grants, triggers, the queue and dispatch functions), a
queues-and-net file (pgmq, pg_net, pg_cron, Vault) applied on the hosted
project only, the cron file (eleven jobs), `seed.sql`, regenerated
frontend types, and `scripts/local-db-test.sh`.

**Funding news (slice 2, built the same day).** `sync-funding-news` (05:20
UTC) reads UKTN, Sifted and Google News RSS (a general search and one per
tracked company) into `funding_news`, keeps raise headlines only, matches
them to tracked companies by name, and a matched story joins the company's
facts as a funding round for the signals, the stage, the latest raise and
the copy. "New raises this week" on My patch lists the fortnight's raises
with one-click Add into the Companies House search. Against today's feeds:
4 raise stories from UKTN, 1 from Sifted, 97 from the Google News search.

**Frontend.** Routes `/`, `/companies`, `/companies/:id`, `/alerts`,
`/consultants`, `/pipeline-monitoring`, `/login`; `Index.tsx` down from
3,240 lines to 703 with the add form (Companies House search, URL-only when
the key is not set), the register card, the open-roles card, the officers
list and the all-roles tab split out; My patch shows stage, sector, open
roles, talent roles, the latest raise and the score; the Alerts page's
test button is a dry run of the week's alert. Brand and firm name in
`src/lib/brand.ts`; navy replaces teal in `index.css`.

## Deviations from the brief, decided during the build

- Greenhouse's list endpoint does carry a posting date (`first_published`),
  so it is used.
- `deriveStage` ignores the incorporation date: a young company with no
  round on its site is `unknown`, not pre-seed.
- The evidence fingerprint also includes `staff_arrival` facts (a new Head
  of People arriving changes what the copy should say).
- A bare year in a date hint is read as June of that year, not September
  (the September rule was the school year).
- `searchCompanies` throws with the reason when the key is missing or the
  API does not answer, so the add form can say why the list is empty.
- The outreach rules' hard stops are fee, margin and retainer figures only;
  the supply-teaching stops are gone.
- `vacancy_alert_settings.la_filter` stays in the schema; nothing reads it.
- The brief's calendar line in the Friday brief is empty until there is
  something worth saying every week.

## Not done, and next

1. Craig's four setup steps (`../scripts/ta-searcher-apply.md`): the
   repository, the Supabase project, the Companies House key, the Netlify
   site. Craig answered the brief's questions on 21 September (brand Big
   Fish Recruitment, the Searchable, Lottie and Attio placements, the ask,
   the fee wording); they are in the copy layer.
2. Then the session's steps: migrations, auth hook, secrets, functions, a
   live `analyze-company` on Searchable and two others, the Workable feed
   tested from the edge runtime, `sync-funding-news` once.
3. Slice 3 became prospecting (the site finds the companies), live on 21
   September; its brief, first-run results and what is left are in
   `PROSPECTING-BRIEF.md`. Hunter enrichment of contacts went live the
   same day. Later: the investors table and page from the funding facts,
   the map from registered office postcodes, Follow-ups and the
   Shortlister ported from He-Giveth as they are, and the unused
   dependencies (`jspdf`, `leaflet`) removed from `package.json`.
