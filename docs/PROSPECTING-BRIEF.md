# Prospecting (slice 3): the site finds the companies

21 September 2026. Craig: "the whole point of this site is that you find
the companies and the contacts; no one else will use it, only me." So TA
Searcher stops waiting for a company to be typed in. Every night it looks
for seed and Series A start-ups that are about to need their first Head of
Talent, qualifies them from public sources, scores them, adds the best to
Craig's patch on its own and runs the full analysis on them, and lists the
rest on a Prospects page for a one-click Add or Dismiss.

One user, one patch: every company the site adds is assigned to the single
active consultant row (Craig). The consultants machinery stays for later.

## Where prospects come from

Search engines do not answer a server (DuckDuckGo blocks it, Bing serves an
empty shell), LinkedIn is closed, Crunchbase and Dealroom are paid. What
answers a machine, free:

1. **Funding news** (built in slice 2): every raise headline from UKTN,
   Sifted and a set of Google News searches. A headline whose company is not
   tracked becomes a prospect with the raise attached. More Google News
   queries: "seed round" London, "pre-seed" UK start-up, "Series A" UK,
   "raises" fintech London, "raises" AI London, "raises" healthtech UK,
   "raises" climate UK, "raises" B2B SaaS UK. One RSS read each, daily.
2. **Companies House advanced search** (free key already set):
   `GET /advanced-search/companies?company_status=active&sic_codes=<code>&incorporated_from=<today minus N years>&size=100&start_index=<n>`
   for the technology SIC codes (62012, 62020, 62090, 63110, 63120, 58290,
   72190, 72200, 74909, 64999, 66190, 86900, 71121) and a registered office in
   London or the Home Counties (the `location` parameter, one call per
   place: London, Cambridge, Oxford, Reading, Brighton, Bristol, Manchester,
   Edinburgh; the register matches on the address). A watermark per SIC and
   place in `app_settings.prospecting.watermarks` so each night walks
   further through the results (300 companies a night). These are the base
   population: a company from here only surfaces when qualification finds a
   raise, a board with roles or a talent posting.
3. **Job search APIs with free keys**: companies advertising the role Craig
   places, today. Adzuna
   (`https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=&app_key=&what_phrase=&where=London&results_per_page=50&max_days_old=30`)
   and Reed (`https://www.reed.co.uk/api/1.0/search?keywords=&locationName=London&distanceFromLocation=30`,
   HTTP Basic with the key as the username) for the phrases "head of
   talent", "head of talent acquisition", "head of recruitment", "talent
   acquisition lead", "talent lead", "head of people" (people, not talent,
   scored lower), "talent acquisition partner" (the first talent hire is
   often titled partner), "recruiter" with "founding" or "first". Each hit
   gives the employer name, the posting title, its date and a redirect URL
   (an Adzuna redirect often lands on the employer's ATS, which reveals the
   board). Secrets `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY`; a source
   with no key is skipped and the run says so. Agency postings ("Big Fish",
   "Recruitment", "Search", "Consulting", "Talent Partners" as the employer)
   are dropped: an agency advertising a Head of Talent is a competitor's
   client, still a prospect, but the employer name is the agency's, so the
   posting is kept as a note with no company.

## The prospect

Table `prospects` (RLS: app users read; the signed-in user may update
`status`, `dismissed_at`, `dismiss_reason`; the service role writes the rest;
anon nothing):

| column | meaning |
|---|---|
| id uuid | |
| name text, name_key text unique | the company's name and its normalised form (`normaliseOrgName`) |
| website text | found or guessed, verified by fetching it |
| company_number text | from the register when matched by name |
| status text | new, qualified, promoted, dismissed, unsuitable |
| sources jsonb | [{source: 'funding_news' \| 'companies_house' \| 'adzuna' \| 'reed', url, title, at, note}] |
| raise jsonb | {amountText, amountGbp, round, date, url} from the news |
| register jsonb | {status, incorporationDate, sicCodes, sector, locality, postcodeDistrict, capitalFilings: [{date, type, description}]} |
| boards jsonb | [{provider, slug, count, talentRoles: [titles], titles: [first 20]}] |
| talent_postings jsonb | [{title, employer, source, url, date}] from the job APIs |
| prospect_score int, score_reasons jsonb | the score and its lines |
| first_seen_at, last_seen_at, qualified_at, promoted_at, dismissed_at timestamptz | |
| promoted_company_id uuid | the company_searches row once added |
| dismiss_reason text | |

## Qualification (nightly, sixty prospects, newest and best sources first)

For each prospect with status `new` (order: has a talent posting, then a
raise, then the register pool; newest first):

1. **Register**: `searchCompanies(name)`; accept the first active hit whose
   normalised name equals the prospect's (or contains it with one extra
   token); then `fetchCompanyProfile` and `fetchCapitalFilings` (SH01 within
   12 months). A dissolved company is `unsuitable`.
2. **Website**: keep a known one; else the Adzuna redirect's employer domain
   when it is not a job board; else guess `https://<name>.com`, `.io`,
   `.ai`, `.co.uk`, `.co`, `.tech`, `.app` with the name compacted and
   dashed, fetch each (6 s), and accept the first that answers 200 with the
   name in its title or first 3,000 characters. No website: the prospect
   stays `qualified` with a score penalty and the page shows "website not
   found; add it".
3. **Boards**: `detectAtsBoards` on the homepage and its careers link, else
   the slug guess (as analyze-company does), `confirmBoard`, read the feed,
   count roles, list talent roles (`isTalentRole`, `isTalentLeadRole`).
4. **Score** (`prospect_score`, each line kept in `score_reasons`):
   - +45 a talent lead role advertised (Head of Talent / Recruitment / TA
     lead) on a board or a job API; +25 any other talent or recruiting role;
     +10 a Head of People posting.
   - +30 a raise within 6 months that reads seed, pre-seed, Series A or
     £1m to £25m with no round named; +15 a raise 6 to 12 months old; +5
     Series B or later (still a prospect, lower).
   - +20 an SH01 allotment within 6 months when no raise is in the news.
   - +5, +15, +25 for 3 to 5, 6 to 11, 12 to 39 open roles; −25 for 40 or
     more (a scaled company, past its first Head of Talent; the first live
     run would otherwise have added Handshake, RELX and Shield AI).
   - +10 incorporated within 3 years; −30 more than ten years ago.
   - −30 no website found; −20 no board and no talent posting; −100 not
     active on the register. A company whose register status is missing
     (no match) keeps its score but the reason says "not matched on the
     register".
5. **Promote** when `prospect_score >= app_settings.prospecting.autoPromoteScore`
   (default 60) and a website is known, up to
   `app_settings.prospecting.weeklyPromoteCap` (default 15) a week: insert
   `company_searches` (url, company_number, company_name, analysis_result
   `{}`), `company_consultants` for the single active consultant, the
   confirmed `ats_boards` rows, then queue `analyze-company` through
   `enqueue_analyze_company_batch` with `isRefresh: true`. Status
   `promoted`, `promoted_company_id` set. The analysis costs about a penny
   on Gemini and the persona scripts a few pence on Claude per company; the
   cap bounds it and Craig raises it from the Prospects page settings.
6. Everything else is `qualified`, listed for Craig.

A prospect that is already tracked (same name key or same website host as a
`company_searches` row) is never created; a dismissed one is not recreated
for 180 days.

## Functions and schedule (UTC)

- `discover-prospects` 05:30 daily: the sources above into `prospects`;
  `pipeline_runs` phase `prospecting`.
- `qualify-prospects` 05:40 daily: the qualification and promotion;
  `pipeline_runs` phase `prospect_qualify`. Body `{limit?, promote?: boolean, prospectIds?: string[], dryRun?}`
  so the page's Add button can qualify and promote one prospect now
  (`prospectIds: [id], promote: true`).
- Both: service role, or a signed-in user (the page). The cron migration
  adds both jobs.

## The Prospects page (`/prospects`, in the nav after Companies)

- **Ready to add**: qualified prospects by score, each with the name, the
  website (or "website not found" with an input to set it), the score and
  its reasons as chips, the sources with links (the news headline, the job
  posting, the register), the boards found with the role count and the
  talent titles, and two buttons: **Add to my patch** (calls
  qualify-prospects with promote for that id and opens the company when
  done) and **Dismiss** (a reason from a short list: not a start-up, agency,
  already a client, wrong country, other).
- **Added by the radar**: promoted this month, linking to the company page.
- **Watching**: how many are new and not yet qualified, by source, and the
  last run's counts; a **Run the radar now** button (discover then qualify
  with the default limit) for Craig.
- **Settings** (a small card): the auto-promote score, the weekly cap, and
  which sources have keys (Adzuna, Reed shown as "key not set" until they
  are).
- My patch gains one line above the table: "The radar added N companies
  this week and has M more ready" linking to the page.

## Tests

Deno: the Adzuna and Reed parsers on hand-written fixtures in the documented
shapes, the Companies House advanced search parser, the website guess (name
to candidate domains), the agency-employer filter, the prospect score, the
promotion rule (cap, threshold, already tracked, dismissed within 180 days)
with the fake supabase helper. Vitest: the page's pure helpers (score chips,
source lines, grouping). The local database test gains the table's row
security and the two cron jobs.

## What the tools Craig sees advertised do, and what this slice covers

Enginy, Katie (Alta), Gojiberry and boilr sell "describe your ideal client,
get a list, get signals, get outreach written and sent". This slice is the
"get a list" and "get signals" half from public sources at zero data cost;
the scripts and the outreach already exist; sequences are the Follow-ups
port. Their contact reveal (personal emails and phones from 14 to 30 data
providers), 850 million profile search (Wiggli, Pin, Juicebox) and LinkedIn
automation are paid data or against LinkedIn's terms, and are not built
here; the people come from the company's own website and the register.
