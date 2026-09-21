# TA Searcher: the brief

21 September 2026. Craig's ask: a replica of He-Giveth for a different
market. He-Giveth watches schools and tells the team which ones are likely to
buy a teacher placement and why. TA Searcher watches seed and Series A
start-ups and tells the team which ones are likely to need a Head of
Recruitment or Head of Talent Acquisition, who to ask for, the words to open
with, and emails when something moves. The first proof point is the Head of
Recruitment Craig placed into Searchable (Series A, AI, London, 13 open roles
on its Ashby board the day this was written).

This document is the mapping from He-Giveth to TA Searcher, the decisions
taken so the build could start, and the questions only Craig can answer.
`TA-SEARCHER-REPORT.md` beside it says what was built and verified.

## What stays the same

Everything that is not about schools. The engine is untouched in shape:

- Sign-in by email code, `profiles` with roles, row security for signed-in
  users only, the anon key with no table privileges, `identifyCaller` in
  every app-facing function.
- Consultants and their companies as data (`consultants`,
  `company_consultants`), My patch, the company page with the same sections
  (summary, signals with evidence and quotes, live roles with history,
  people, scripts, calls), call logging with callbacks, the Alerts page, the
  Consultants page, the monitoring page.
- The evidence pass: one structured Gemini call over the company's pages,
  every fact kept only when its quote is on the cited page, facts reconciled
  across refreshes, the fingerprint that decides when copy is rewritten.
- Signals computed in code from stored data, never asked of the model; the
  0 to 100 "Likely to buy" score with its breakdown, the same noisy-OR
  combination, the same fade and call-outcome adjustments, the same bands
  (60 call this week, 30 worth a call).
- Persona scripts and emails written by Claude from the facts and the value
  proposition, checked for word limits, banned phrases, invented names and
  the signature, regenerated only when the evidence changes.
- Contacts: found on the site or a public register, joined to a person by
  the same rules, never guessed unless two found addresses share a pattern,
  `role_only` when there is a name and no address, consultant corrections
  kept across every refresh.
- The nightly and weekly cadence: cheap syncs daily, the model-driven
  refresh weekly, scores every morning, the Friday brief, the new-roles
  alert, all through the same queues and the same email plumbing (Resend,
  pgmq, suppression, unsubscribe).

## The mapping

| He-Giveth | TA Searcher | Notes |
|---|---|---|
| School | Company (a start-up) | `company_searches` and every `company_*` table |
| URN, the DfE register (GIAS) | Companies House number and the Companies House API | Free API key, one request per company per refresh, officers and filings too |
| Teaching Vacancies mirror, TES, MyNewTerm, eTeach, Guardian, JGP | The company's own applicant tracking system: Ashby, Greenhouse, Lever, Workable public feeds, plus the careers page itself | Verified from this session: Ashby, Greenhouse and Lever answer JSON without a key. Workable is rate-limited from the session proxy and needs testing from Supabase |
| Vacancy | Open role | Every open role is evidence of hiring load; a Talent, Recruiter or People role is the direct lead |
| Role rule (education-facing only) | Role families: engineering, product and design, go-to-market, operations, people and talent, leadership, other | Nothing is rejected by family. "General application" and "Don't see a role?" placeholders are rejected as non-roles |
| Headteacher, SBM, SENCO, Trust HR (personas) | Founder or CEO, COO or Chief of Staff, Head of People or CPO, CTO or VP Engineering, the lead investor's talent partner | The investor persona replaces Trust HR: a VC platform team introduces recruiters to its portfolio |
| Head from the DfE record (`gias_heads`) | Officers from Companies House (`ch_officers`) | Directors are usually the founders; an appointment or resignation is a signal |
| New headteacher | New senior officer or a leadership change on the site | |
| Ofsted | Nothing | No public inspection of a start-up. Dropped |
| Agency spend (DfE benchmarking) | Nothing in slice 1 | Small-company accounts hold no staffing spend. See "Later" for what replaces the money view |
| Staff leaving (newsletters) | Staff leaving (blog, news and team pages) | Same second small model call; a Head of Talent leaving is the strongest form |
| Trusts | Investors | Slice 2: an `investors` table from the funding facts, the trust page becomes the investor page with its portfolio in the patch |
| Tenders | Funding news | Slice 2: UKTN, Sifted and Google News RSS read daily, matched to tracked companies by name, and a "New raises this week" card of companies not yet tracked |
| Pupil premium statements | Nothing | Dropped |
| New schools in your patch | New raises this week | Slice 2 |
| Resignation deadlines and term dates | Nothing | Start-ups have no calendar. Dropped |
| Framework window (RM6376) | Nothing | Dropped |
| Closing-date alerts | Nothing | ATS postings rarely carry a closing date. The new-roles alert and the brief carry the week |
| Map by local authority | Later | Registered office postcodes give the points; no borough outlines needed |
| CRM Shortlister (Bullhorn) | Later | The plumbing ports unchanged when wanted |
| Follow-ups (sequences) | Later | The plumbing ports unchanged when wanted |

## Identity: Companies House

A company is added by name. `company-lookup` searches the Companies House
API and returns number, name, status, incorporation date, registered office
and SIC codes; the consultant picks the right one and types or confirms the
website. The row stores the number and the URL, and `company_records` caches
the register entry (name, previous names, status, incorporation date, SIC
codes, registered office postcode and district, accounts type, last
confirmation statement) for 30 days like `school_records` did.

The API needs a free key (`COMPANIES_HOUSE_API_KEY`, registered in five
minutes at developer.company-information.service.gov.uk). Without it the
function answers "Companies House key not set" and the company can still be
added by URL alone with no register data.

The register is read for three more things on every refresh:

- **Officers** (`/company/{n}/officers`): current directors and secretaries
  with appointment dates into `ch_officers`; a new appointment within six
  months is the "New senior officer" signal; the founders are added to the
  people list as `role_only` (a name and a role, never an address).
- **Filings** (`/company/{n}/filing-history?category=capital`): a statement
  of capital following an allotment of shares (SH01) is money coming in; one
  within six months is the "Shares allotted" signal, the register's own
  evidence of a round.
- **Status**: a dissolved or liquidating company is marked and never
  refreshed, alerted or scored again.

There is no website in the register. The URL the consultant gives is the
identity for the website read, the careers page and the ATS.

## Open roles: the ATS feeds and the careers page

`_shared/vacancies/` keeps its pipeline (parallel sources with a budget,
merge by identity key, persist with first and last seen, re-key rather than
re-report, close what is gone, never close on a degraded run) and swaps the
sources:

- `source-ashby.ts`: `https://api.ashbyhq.com/posting-api/job-board/{slug}`.
- `source-greenhouse.ts`: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs`.
- `source-lever.ts`: `https://api.lever.co/v0/postings/{slug}?mode=json`.
- `source-workable.ts`: `https://apply.workable.com/api/v1/widget/accounts/{sub}`.
- `source-careers-page.ts`: the company's own careers page, the He-Giveth
  website source with start-up paths (`/careers`, `/jobs`, `/join`,
  `/join-us`, `/work-with-us`, `/open-roles`, `/company/careers`) and JSON-LD
  JobPosting blocks.

`ats-detect.ts` finds the ATS from the homepage and careers page (a link to
`jobs.ashbyhq.com/{slug}`, `boards.greenhouse.io/{token}` or
`job-boards.greenhouse.io/{token}`, `jobs.lever.co/{slug}`,
`apply.workable.com/{sub}`, or an embedded board script) and the confirmed
board is stored in `ats_boards` (the `board_employer_pages` shape: one row
per company per provider with the slug and when it was confirmed). The feed
is only read for a confirmed slug, the same rule that stopped Teaching
Vacancies filing another school's adverts. A nightly `sync-ats-boards`
reads every confirmed feed with no model call, so open roles and the roles
signals move every day while the website read stays weekly.

Each role keeps its department, team, location and workplace type from the
feed (`raw`), which the role family and the location rule use. A role
located outside the UK is kept and counted but shown as such; the
consultant decides whether a Salt Lake City sales team matters to a London
Head of Talent conversation (it does: it is more hiring for one person to
run).

## Facts: what the evidence pass looks for

`FACT_KINDS` becomes:

`funding_round`, `investor`, `stage`, `headcount`, `hiring_plan`,
`leadership_change`, `people_function`, `talent_team`, `expansion`,
`new_market`, `office`, `product_launch`, `award`, `accelerator`,
`staffing_pressure`, `agency_mention`, `remote_policy`, `values`,
`recent_news`, `staff_departure`, `staff_arrival`, `other`;
plus `consultant_intel` typed in by the team, never retired.

The prompt asks for the round and the lead investor in the company's own
words, the stage it calls itself, any headcount or growth statement ("we
are 40 people, doubling this year"), any hiring plan, who runs people or
talent today (a named Head of People, a Talent Partner, an office manager
doing it, or nobody), whether roles are advertised through agencies, and
departures and arrivals. The contact review's role list becomes Founder /
CEO, Co-founder, COO / Chief of Staff, CTO / VP Engineering, Head of People
/ CPO, Head of Talent / Recruiter, Head of Operations, EA to the founders,
Investor / board.

## Signals and the score

Every signal is computed from the facts, the roles rows, the Companies House
record and the contacts. Points at strength 1, 2 and 3:

| Code | Label | Points | Rule |
|---|---|---|---|
| `talent_role_open` | Hiring for talent or recruitment | 36, 40, 44 | An open role in the people-and-talent family whose title is recruiter, talent or head of people; 3 when it is a Head of Talent or Head of Recruitment |
| `hiring_surge` | Many open roles | 14, 24, 34 | 4 to 7 open roles is 1, 8 to 14 is 2, 15 or more is 3 |
| `engineering_hiring` | Engineering hiring | 8, 12, 16 | 2 to 3 engineering roles is 1, 4 to 6 is 2, 7 or more is 3 |
| `no_people_function` | No one runs hiring | 22, 22, 22 | 4 or more open roles and no people or talent person among the contacts, facts or officers |
| `funding_round` | Raised recently | 22, 30, 38 | A funding_round fact within 9 months; 2 for a seed round or an unnamed round, 3 for a Series A or a raise of £5 million or more |
| `shares_allotted` | Shares allotted (Companies House) | 12, 18, 24 | An SH01 filing within 6 months; 2 within 3 months; 3 when the funding_round fact is absent (the register saw money the website did not mention) |
| `new_senior_officer` | New senior officer | 12, 16, 20 | A Companies House appointment within 6 months, or a leadership_change fact within 6 months naming a CEO, COO, CTO, CPO or a VP |
| `long_open_role` | Role open more than five weeks | 22, 22, 24 | As He-Giveth |
| `readvertised_role` | Re-advertised role | 30, 30, 32 | As He-Giveth |
| `staffing_pressure_stated` | Hiring pressure stated | 20, 22, 25 | "Scaling the team", "hiring aggressively", "doubling headcount", "growing the team from x to y"; strength 3 with a number or a timescale |
| `agency_advertising` | Uses agencies | 16, 20, 26 | An agency_mention fact (a recruitment agency named in an advert or on the careers page) |
| `staff_departure` | Staff leaving | 20, 26, 36 | As He-Giveth; strength 3 when the leaver ran people or talent |
| `expansion` | Expanding | 8, 12, 14 | A new office, a new market, a new country, a new team |
| `accelerator` | Accelerator alumni | 6, 6, 6 | YC, Techstars, Entrepreneur First, Antler, Seedcamp and the like |
| `new_company` | Young company hiring | 8, 12, 12 | Incorporated within 24 months and 3 or more open roles |
| `consultant_intel` | From the team | 10, 10, 10 | As He-Giveth |

Adjustments, as He-Giveth: stale analysis fades the score, "not interested"
in the last 90 days cuts it, a conversation in the last fortnight cools it,
a callback due this week lifts it. One new multiplier replaces "says it uses
no supply staff": `has_talent_lead` (a Head of Talent, Head of Recruitment
or Talent Acquisition lead is in post, from the contacts or the facts, and
has not left) multiplies by 0.5. They have the function; the conversation is
different and the score says so.

Bands are unchanged: 60 and up "call this week", 30 to 59 "worth a call".

## Contacts

The role taxonomy in `_shared/contacts/resolve.ts` becomes, highest first:
`founder` (Founder, CEO, Co-founder), `coo` (COO, Chief of Staff, Head of
Operations), `cto` (CTO, VP Engineering, Head of Engineering), `people`
(Chief People Officer, Head of People, VP People, People Partner), `talent`
(Head of Talent, Head of Recruitment, Talent Partner, Recruiter), `exec`
(any other C-level or VP), `ea` (EA, Office Manager), `investor` (board
member, investor). Generic mailboxes: `careers@`, `jobs@`, `talent@`,
`people@`, `hello@`, `hi@`, `team@`, `founders@` rank; `press@`, `support@`,
`sales@`, `privacy@`, `legal@`, `security@`, `billing@` and the rest of the
deny list never show. Pages read: `/team`, `/about`, `/about-us`,
`/company`, `/people`, `/leadership`, `/careers`, `/contact`, `/blog`,
`/news`, and LinkedIn is never fetched. Companies House officers join the
list as `role_only`.

## Copy

Personas: `founder`, `coo`, `people`, `cto`, `investor`, with persona notes
written for the Head of Talent conversation (the founder is drowning in
hiring and wants their time back; the COO wants process and cost per hire;
the Head of People wants a partner who has built a talent function before;
the CTO wants engineers hired without their calendar disappearing; the
investor wants their portfolio staffed). The schema, the checks and the
retry loop are unchanged. The banned list loses the supply-teaching entries
and keeps every model tell. Fee figures stay banned.

The value proposition file is a placeholder with the Searchable placement as
the one proof point and clear `[Craig to confirm]` markers: it needs the
brand, the positioning, the proof points and the ask in Craig's words (see
the questions).

## The pages

- **My patch**: Company, Stage, Sector, Consultants, Open roles, People and
  talent roles, Latest raise, Last analysed, Next call, Likely to buy.
- **Company page**: Summary with the register line (number, status,
  incorporated, registered office, SIC), Signals, Open roles with history,
  People, Scripts, Calls.
- **Companies**: the list and the add form (search Companies House, confirm
  the website).
- **Alerts**, **Consultants**, **Monitoring**, **Login**: as He-Giveth,
  reworded.
- Not in slice 1: Spend, Trusts, Map, Tenders, Follow-ups, Shortlists.

## What runs when (UTC)

| When | What |
|---|---|
| every 5 s | email queue |
| every minute | dispatch ten queued analyses, three queued copy sets |
| every 10 min | close stale refresh runs |
| 04:40 daily | `sync-companies-house` (status, officers, capital filings for every tracked company) |
| 04:50 daily | `sync-ats-boards` (every confirmed feed) |
| 05:20 daily | `sync-funding-news` (UKTN, Sifted, Google News and a Google News search per tracked company, matched by name; slice 2) |
| 05:00 / 05:05 Friday | snapshot, then queue every company for `analyze-company` |
| 06:40 daily | `refresh-scores` |
| 06:55 Friday | `send-friday-brief` |
| 07:30 Friday | `auto-refresh-vacancies` compare-and-alert (new roles this week) |

The Friday-only model cadence follows Craig's 14 September decision for
He-Giveth; a daily cadence is one `cron.alter_job` away.

## Decisions taken to start the build

1. **Geography: United Kingdom, London first.** Companies House is the
   register, so a company is UK-registered. Roles anywhere count.
2. **Stage: seed and Series A**, inferred from the facts (the company's own
   words), the funding news and the register's incorporation date, stored on
   the company with the evidence. A company that says Series B or later is
   kept but marked; the consultant decides.
3. **Every open role counts.** The score reads the load, not the discipline.
4. **A talent role advertised is the strongest signal.** The company is
   hiring the person Craig places.
5. **Money view deferred.** No public per-company spend figure exists for a
   start-up the way the DfE benchmarking gives one for a school. The raise
   and the headcount carry that part of the story.
6. **Brand and login domains**: `bigfishrecruitment.co.uk` and
   `whofoundwho.co.uk` sign in until Craig says otherwise; email from a
   `notify.` sub-domain of whichever brand sends.
7. **The name is TA Searcher.**

## Craig's answers (21 September 2026)

1. **Brand:** Big Fish Recruitment sends and signs.
2. **Proof points:** the Searchable Head of Recruitment (Series A, AI,
   London, first talent leader hire, five hand-picked candidates through
   the shortlist portal at big-fish-portal.onrender.com); the first Head of
   Talent at Lottie, Chris Donnelly's scale-up, before Searchable (a review
   from Chris is expected); the first Head of Talent at Attio, the CRM
   scale-up. All three are in the value proposition and in
   `_shared/copy/reviews.ts`.
3. **The ask:** a call with Craig to advise on the best first Head of
   Recruitment or Head of Talent hire, and then to run that search.
4. **Fee wording:** figures stay banned; the writer may say the work can be
   contingent or retained and that the shape is agreed on the call.
5. **Companies House key:** Craig registers it (instructions in the report).
6. **Team:** not answered; Craig alone to start.
7. **First list:** slice 2's funding-news feed proposes companies.
8. **Outside the UK:** a company with a London office can be added by
   website alone, with no register record.
9. **Setup:** Craig creates the repository, the Supabase project and the
   Netlify site with the instructions in the report; the session's tokens
   cannot (the GitHub app cannot create repositories, project creation is a
   billed action the session is not allowed to take, and the Netlify token
   answers 401).

## Questions for Craig (as first asked)

1. **Which brand sends and signs?** Big Fish Recruitment, WhoFoundWho, or a
   new name. The value proposition, the email footer, the login page and
   the sending domain follow from it.
2. **The proof points in your words.** The Searchable placement (what was
   the brief, how long did it take, what did the founders say), any other
   placements in tech, your own background. Two or three lines each is
   enough; the writer paraphrases and never pastes.
3. **The ask.** He-Giveth's is "fifteen minutes to see the margin and the
   compliance file". What is the start-up equivalent: a fifteen-minute call
   about their hiring plan, an introduction to the Searchable hire, a
   retained search conversation?
4. **Fee model words.** Fee figures are banned in copy as before. Is a
   retained versus contingent conversation something the writer may open,
   or is that for the call?
5. **Companies House key.** Register one at
   developer.company-information.service.gov.uk and add it as the
   `COMPANIES_HOUSE_API_KEY` secret. Free.
6. **Who is on the team?** Consultant names and email addresses for the
   `consultants` rows, and who is a manager.
7. **The first list.** Twenty to fifty companies to seed the patch, or say
   the word and slice 2's funding-news feed proposes them.
8. **Outside the UK?** Whether a US or European start-up with a London
   office should be addable by URL alone (no Companies House record).
9. **A new GitHub repository.** The session's GitHub app cannot create one.
   Create `craigspringett/ta-searcher` (private) and the code moves from
   `who-finds-leads/ta-searcher/` in one push; then a Supabase project (an
   extra project on the Pro organisation is billed) and a Netlify site.

## Slice 2, built

Funding news (21 September 2026, migration
`20260921130000_funding_news.sql`, not yet applied). A raise is the moment
a start-up starts hiring, so the feeds are read every morning at 05:20 UTC
by `sync-funding-news`: UKTN's RSS, Sifted's RSS, a Google News search for
raise headlines in London, and a Google News search per tracked company
(the first 200, newest first) so a tracked company's own round is read
even when the general feed has moved on. A headline is kept when it says a
company raised, secured, landed, closed, bagged, picked up or netted money
with an amount or a round word, and is not a fund closing; the company
name is what stands before the verb once "London's", "UK", "British",
"London-based", "Exclusive:" and the descriptor words (startup, firm,
"legaltech start-up") are taken off, and the amount and the round are read
with the same parsers as the facts (`_shared/funding-news/`: rss, detect,
match, sources, run, with the three fixtures and 15 tests). One row per
canonical article URL in `funding_news` (read by app users, written by
the service role); a story is matched to a tracked company by name with
the ATS employer rule (register name, previous names and website host as
aliases), and unmatched rows of the last 90 days are matched again every
run, so a company added from the card picks up its story the next
morning. A matched story joins the company's facts as a `funding_round`
(`loadFundingNewsFacts`, headline as statement and quote, article as
source, published date as the hint) in `analyze-company`, in
`refresh-scores` with `recomputeSignals` and in the copy context, so the
"Raised recently" signal, the stage and the latest raise see it without a
page ever mentioning the round; it is never written to `company_facts`.
My patch shows "New raises this week" (`NewRaisesCard`, rules in
`src/lib/newRaises.ts`): the last fourteen days, untracked companies
first with the publisher link and an "Add" link that opens the Companies
page with the register search filled in (`/companies?add=<name>`), then
the ones already in the patch, linked to their page. On the fixtures of
21 September the general feeds yielded 4 raise stories from UKTN's 10
items, 1 from Sifted's 24 and 97 from Google News's 100 (a search feed
is raise stories by construction; a few name no company, and those
show with no name to add).

## Later (slice 3 and after)

- Investors: the `investors` table and page, portfolio in the patch, the
  investor persona's contact from the fund's platform team.
- Map: registered office postcodes as points.
- Follow-ups and the Shortlister, both ported from He-Giveth as they are.
- Headcount from LinkedIn is not available to a server; the open-roles
  count and the company's own statements stand in for it.
