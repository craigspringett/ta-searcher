# Copy style: how the scripts and emails are written

This is the plain-language version of the rules the copy writer follows.
The rules themselves live in `supabase/functions/_shared/copy/prompt.ts`
(the prompt) and `checks.ts` (the checks that run on every draft). The
value proposition the writer draws on is in
`supabase/functions/_shared/copy/value-proposition.md`; edit that file to
change what the scripts say about the firm. After editing either file, run
`node scripts/embed-value-proposition.mjs` and redeploy `generate-copy` and
`analyze-company`.

The brand is not yet confirmed (docs/TA-SEARCHER-BRIEF.md, question 1).
The emails are signed "Big Fish Recruitment" until Craig says otherwise;
the name is the one constant `FIRM_NAME` in `checks.ts`. The value
proposition is a placeholder: every claim Craig has not confirmed carries
`[Craig to confirm]`, the writer is told to skip a marked line, and the
marker itself is a banned phrase so it can never reach a draft.

## What a consultant gets

For every company, one set per persona: **Founder / CEO**, **COO / Chief
of Staff**, **Head of People**, **CTO / VP Engineering**, and **Investor
talent partner** (only when the input names an investor: an `investor`
fact from the site, or a contact whose role is a fund partner or a board
member). Each set has:

- **Call opener**, 90 to 120 words, spoken. Who you are, the one specific
  reason for calling, one proof point, one question.
- **Three discovery questions**, open and tied to the signals.
- **Three objections** this persona actually raises, each with a calm reply.
- **Voicemail**, 40 to 60 words, with the `[phone number]` placeholder.
- **Close**: the fifteen-minute ask.
- **Email**: subject under 60 characters; body under 150 words with one hook,
  one proof point, one ask, signed with the consultant's first name, the
  firm's name and `[phone number]`; and a follow-up under 80 words for five
  days later.

## The rules the writer follows

1. British English, plain, warm, direct. Short sentences. No jargon, no
   exclamation marks, no marketing words.
2. The reason for contact is always a specific signal with its evidence,
   named in the first two sentences. Never a compliment about the website.
3. Nothing is invented. Names, roles, open roles, numbers, dates, funding
   figures and investors come only from the input: the Companies House
   record, the stage guess and the latest raise, the computed signals, the
   validated facts (each with a quote from the company's own page), the open
   roles grouped by family, and the contacts found on the site. If the
   input has no strong signal the opener says so ("no open role that I can
   see, so this is a short introduction").
4. One or two proof points, chosen for the persona. **A fee, a percentage,
   a retainer figure or a day rate is never quoted.** The commercial shape
   (retained or contingent) is for the call. The ask is a fifteen-minute
   call about the hiring plan for the next twelve months (placeholder,
   Craig to confirm).
5. Never promise a candidate, a shortlist or availability that is not in
   the input.
6. Never imply the company is failing at hiring. Say what they are doing
   (the roles open, the plan they stated, the raise) and ask how it is
   going.
7. The named contact is addressed by title and surname when the site gives
   a title, by first name otherwise ("Sarah Green" is "Sarah"), and never
   invented when none was found.

## What the writer is given

The user message carries, in this order: the persona, today's date, the
consultant, the company name, the **register line** (Companies House
number, status, incorporation date, registered office town, sector from
the SIC codes), the **stage** guess with its evidence, the **latest raise**
(round, amount, date, investors, the company's own sentence), the named
contact and the other contacts with how each address was established,
the signals strongest first with their evidence and quotes, the validated
facts (the ones behind a signal always, up to eight more), the **open
roles grouped by family with counts** (people and talent first, then by
count: engineering, product and design, go to market, operations,
leadership, other), and the proof points. No spend, no pupil premium, no
term dates: none of them exist for a start-up.

## Persona notes

- **Founder / CEO**: running the company and the hiring at the same time;
  every open role is screening and interviews they do themselves. They
  want their time back and a partner who has built a talent function
  before. Lead with the hiring load in the input (roles, raise, stated
  plan) and the idea that one good Head of Talent is the hire that makes
  the other hires happen. Never say their hiring is broken.
- **COO / Chief of Staff**: owns process and the numbers: time to hire,
  cost per hire, offer acceptance, the plan against the runway. Lead with
  process, speed and predictability: a Head of Talent who sets up the
  pipeline, the tooling and the reporting. Never a fee figure.
- **Head of People**: has inherited recruiting on top of everything else,
  or is about to. Wants a peer who has done the build-out: what the first
  talent hire owns, where it sits beside them. Speak as one professional
  to another; the function is being built and the sequencing matters.
- **CTO / VP Engineering**: wants engineers hired without losing their
  calendar to sourcing, screens and closing. Lead with the engineering
  roles in the input (count them, name the disciplines) and a Head of
  Talent who runs technical hiring so the leads only see the final loop.
- **Investor talent partner**: sits on a fund's platform team and wants
  the portfolio staffed and to be the one who made the useful
  introduction. Lead with the specific portfolio company and offer an
  introduction that makes them look good, with a short note they can
  forward to the founder. Never claim to know the fund's other companies.

## Banned phrases

"hope this finds you well", "hope this email finds you well", "hope you are
well", "hope you're well", "reach out", "reaching out", "synergy",
"circle back", "touch base", "game-changer", "leverage", "best-in-class",
"world-class", "world-class talent", "unlock", "seamless", "cutting-edge",
"as a valued", "I wanted to", "I'd love to"; the start-up recruiting
cliches "rockstar", "ninja", "10x", "war for talent", "unicorn"; and the
placeholder marker "Craig to confirm". Exclamation marks count as a failure
too. The list is `BANNED_PHRASES` in `checks.ts`. The He-Giveth
supply-teaching entries are gone: there is no such service here.

## The checks on every draft

Every draft is checked for: the word limits above; a pound sign or a
percentage next to "margin", "fee", "retainer", "placement fee", "per
hire" or "our rate" in the same sentence (the fee-figure check); the banned
phrases; exclamation marks; any titled person ("Mrs Patel") who is not
among the contacts found for the company, and any other capitalised name
pair not present in the input; and the email signature (the consultant's
first name or the firm's name in the last lines). A draft that fails is
sent back once with the list of failures. If the second draft still fails,
the better of the two is kept and the remaining problems are shown in the
app under the persona tab as "Check before use", and stored as
`quality_flags` in `company_copy`.

## When copy is written

- On a manual analysis in the app: the founder set at once (it comes back
  with the analysis), the other personas in the background within a minute
  or two.
- On the weekly refresh: only when the evidence fingerprint has changed
  (a fact, an open role or one of the top three contacts is different) or
  the stored copy is more than 30 days old, and for at most 60 companies a
  night (`NIGHTLY_COPY_CAP`). Companies over the cap wait for the next
  run.
- On "Regenerate" in the app: that persona, now, whatever the fingerprint.

## Signals: what triggers what

The codes, labels, points and rules are the brief's table
(docs/TA-SEARCHER-BRIEF.md, "Signals and the score"); this is the one-line
reason the writer sees and the app shows.

| Code | Label | The reason line |
|---|---|---|
| `talent_role_open` | Hiring for talent or recruitment | "A recruiter or talent role is open" (3 when it is a Head of Talent or Head of Recruitment: the company is hiring the person Craig places) |
| `hiring_surge` | Many open roles | "N roles are open" (4 to 7 is 1, 8 to 14 is 2, 15 or more is 3) |
| `engineering_hiring` | Engineering hiring | "N engineering roles are open" (2 to 3, 4 to 6, 7 or more) |
| `no_people_function` | No one runs hiring | "Four or more roles open and no people or talent person among the contacts, facts or officers" |
| `funding_round` | Raised recently | "Raised within nine months" (2 for a seed or unnamed round, 3 for a Series A or £5 million or more) |
| `shares_allotted` | Shares allotted (Companies House) | "An SH01 statement of capital within six months" (2 within three months; 3 when the website said nothing about a round) |
| `new_senior_officer` | New senior officer | "A director appointed within six months on the register, or a leadership change on the site naming a CEO, COO, CTO, CPO or a VP" |
| `long_open_role` | Role open more than five weeks | "A role first seen more than 35 days ago and still open" |
| `readvertised_role` | Re-advertised role | "The same title seen, closed, then seen again within 180 days" |
| `staffing_pressure_stated` | Hiring pressure stated | "Scaling the team, hiring aggressively, doubling headcount, growing from x to y" (3 with a number or a timescale) |
| `agency_advertising` | Uses agencies | "A recruitment agency is named in an advert or on the careers page" |
| `staff_departure` | Staff leaving | "A departure on the blog, news or team pages within six months" (3 when the leaver ran people or talent) |
| `expansion` | Expanding | "A new office, market, country or team" |
| `accelerator` | Accelerator alumni | "YC, Techstars, Entrepreneur First, Antler, Seedcamp and the like" |
| `new_company` | Young company hiring | "Incorporated within 24 months and three or more roles open" |
| `consultant_intel` | From the team | "A note a consultant typed in" (never retired by a refresh) |

`has_talent_lead` is listed with the signals but scores nothing: a Head of
Talent, Head of Recruitment or Talent Acquisition lead is in post, so the
score is halved and the conversation is a different one. Every signal
shows its evidence in the app: the fact's quote with a link to the page,
the role, the register entry.

## Never say

- Never quote a fee, a percentage of salary, a retainer figure or a day
  rate.
- Never promise a candidate, a shortlist or availability that is not in
  the input.
- Never imply the company is failing at hiring.
- Never name a stage, a round, an investor or a figure the input does not
  give.
- Never write "[Craig to confirm]" or use a claim that carries it.
- Nothing from LinkedIn: the writer only ever sees what the company's own
  pages, the register and the ATS feeds gave.
