# End-to-end tests

Real-stack Playwright suite: **synqed-core + the karute app + the _test_ Supabase
project**, with seeded data. Never points at production.

## Prerequisites
- Node + deps installed (`npm ci`, with the `@synqed-kk` GitHub Packages token
  in your env — see repo setup).
- `.env.e2e` present (gitignored): the **test** Supabase project
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) + `SYNQED_CORE_URL=http://localhost:3100` +
  `SYNQED_CORE_API_KEY` + `OPENAI_API_KEY`.
- **synqed-core running at `http://localhost:3100`** (its own repo: `npm run dev`).

## Run
1. Start synqed-core on :3100.
2. `npm run test:e2e`   (or `npm run test:e2e:ui` to debug headed)

`pretest:e2e` fails fast if synqed-core is down. Playwright then auto-starts the
app with `next dev` (env from `.env.e2e`), the global-setup seeds
`dev@karute.test` + a business + 6 customers/appointments, the `setup` project
logs in once (saved to `.auth/dev-user.json`), and the specs run.

## Specs (`e2e/`)
- `read-flows.spec.ts` — dashboard / customers / customer profile / karute /
  appointments / settings / coaching render with seeded data and **zero console
  errors** (the `fixtures.ts` console-error guard).
- `karute-record.spec.ts` — manual "Create new karute" write flow (the
  recorder/AI path needs a mic; out of scope for headless).
- `customer-crud.spec.ts` — create a customer via the form → appears in the list.
- `auth-lifecycle.spec.ts` — unauth `/dashboard`→`/login` redirect; login + logout.
  Uses `liam@karute.test` (a different seeded account than the authed specs use)
  because Supabase `signOut` is global-scope and would otherwise invalidate the
  shared `dev@karute.test` session.

## Notes / follow-ups
- Seeding is idempotent (`seed-booking-data` resets customers + today's
  appointments before recreating), so reruns are stable.
- The create-karute redirect lands on `/karute/<id>` (missing the `/en` locale
  prefix) — a minor app quirk surfaced by the test, worth a follow-up.
- `customer-crud` covers create (the write path); UI edit/delete (delete is a
  scheduled/soft deletion) are covered at the unit level and are a follow-up here.
