# TA Searcher

An internal portal for a recruitment team that places Heads of Talent and
Heads of Recruitment. It watches seed and Series A start-ups and says which
ones are likely to need one, who to ask for, and the words to open with:

- **My patch**: each consultant's companies with stage, sector, open roles,
  the talent roles among them, the latest raise, the next call and the
  "Likely to buy" score.
- **Companies**: add a company by searching Companies House and confirming
  its website; the company page shows the register line, the buyer-intent
  signals with their evidence, the open roles from the company's own
  applicant-tracking feeds (Ashby, Greenhouse, Lever, Workable) and careers
  page, the officers and decision makers, the per-persona scripts and the
  call log.
- **Alerts**, **Consultants** and **Monitoring** for managers; sign-in by
  email code for `bigfishrecruitment.co.uk` and `whofoundwho.co.uk`
  addresses.

The product design is `docs/TA-SEARCHER-BRIEF.md`; the interfaces the parts
are built against are `docs/PORT-CONTRACTS.md`. The app is He-Giveth, the
education portal, ported to a new market.

## Stack

- Frontend: React 18, Vite, TypeScript, Tailwind, shadcn/ui, React Router,
  TanStack Query. Deployed by Netlify from `main` (`netlify.toml`).
- Backend: Supabase (Postgres, Auth, edge functions in `supabase/functions`,
  pg_cron), Gemini for the evidence pass, Claude for the scripts, Resend for
  email. The frontend talks to it through `@supabase/supabase-js` with the
  anon key and the signed-in user's token.

## Run it

```sh
cp .env.example .env      # then fill in the three values
npm install && npm run build
npm run dev               # http://localhost:8080
```

## Checks

```sh
npx eslint src                          # 0 errors expected
npm test                                # Vitest for src/lib (patch derivations, sector, contacts, propensity, format)
npx tsc --noEmit -p tsconfig.app.json   # frontend types (needs src/integrations/supabase/types.ts regenerated from the schema)
E2E_BASE_URL=https://<site> E2E_SESSION_JSON=... npm run test:e2e   # Playwright smoke test; see e2e/smoke.spec.ts
```

## Environment variables

Three `VITE_` variables, in `.env` locally and on the Netlify site:

| Variable | What it is |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the project's anon key (no table privileges) |
| `VITE_SUPABASE_PROJECT_ID` | the project ref; the smoke test uses it to name the session key |

The brand (`APP_NAME`, `FIRM_NAME`) is in `src/lib/brand.ts` and the
sign-in domains in `src/lib/auth.tsx`.
