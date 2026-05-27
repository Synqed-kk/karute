# Whole-system E2E test harness — design

**Date:** 2026-05-27
**Branch context:** `incremental-merge` (karute)
**Status:** Approved design — pending implementation plan

## Problem

The app's customer/karute/appointment data lives in **synqed-core**, a separate
backend service the app reaches via `@synqed-kk/client` at
`SYNQED_CORE_URL` (locally `http://localhost:3100`). Staff + auth live in
Supabase. During manual Playwright verification of the consolidated branch, the
`/customers` and `/karute` pages threw Server-Component errors because the test
user had no real synqed-core backing data and synqed-core wasn't running.

We want **real end-to-end tests of the whole system** (synqed-core + karute app +
Supabase, with real seeded data) — not mocks/stubs. Primary use: **local
dev / demo** confidence (run the stack, drive the real flows).

## What already exists (reuse, don't reinvent)

- `src/actions/bootstrap.ts` → `bootstrapBusinessForNewUser(salonName, userId)`:
  provisions a *real* business for a user (the proper profile↔business wiring).
- `scripts/seed-test-user.ts`: idempotently creates known accounts
  (`dev@karute.test` … password `TestPass123!`), each bootstrapped with its own
  business.
- `scripts/seed-booking-data.ts`: seeds real customers + today's appointments in
  synqed-core for `dev@karute.test`.
- `scripts/playwright-login.ts`: logs in via the `/en/login` form and saves
  browser `storageState` to `.auth/dev-user.json`.
- `playwright` is already a dev dependency (`^1.60.0`).

**Gap:** there is no `playwright.config.ts` and no spec files — the seed kit
isn't wired into a runnable suite.

## Approach (chosen)

Playwright-native harness layered on the existing seed kit:

- Playwright `webServer` starts the karute app with **`next dev`** (reads env at
  *runtime*, avoiding the build-time `NEXT_PUBLIC_*` inlining problem).
- A Playwright **`setup` project** seeds data + logs in once and saves
  `storageState`; authenticated specs reuse it.
- **synqed-core stays a documented manual prerequisite** the developer starts at
  :3100. A `pretest:e2e` guard pings :3100 and fails fast with a clear message.

Rejected: a bespoke script-orchestrator (reinvents Playwright projects/config,
brittle) and docker-compose (synqed-core may not be containerized; overkill for
local-dev E2E).

## Components

### Environment — `.env.e2e`
A dedicated env file used by both the dev server and the seed scripts:
- Supabase = the **test project** (from `.env.test.local`):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- synqed = local: `SYNQED_CORE_URL=http://localhost:3100`, `SYNQED_CORE_API_KEY`.
- `OPENAI_API_KEY` (the AI routes instantiate the client at import time).

Loaded via `next dev` + `dotenv`/`--env-file` so there is no `NEXT_PUBLIC`
build-time inlining step. `.env.e2e` is gitignored.

### `playwright.config.ts`
- `testDir: 'e2e'`, `baseURL: 'http://localhost:3000'`.
- Projects:
  - `setup` — runs `e2e/auth.setup.ts`.
  - `authed` — `dependencies: ['setup']`, `storageState: '.auth/dev-user.json'`.
  - `unauth` — fresh context (no storageState), for the auth-lifecycle spec.
- `webServer`: command starts `next dev` with `.env.e2e`, `url:
  http://localhost:3000`, `reuseExistingServer: true` locally,
  generous `timeout`.
- `globalSetup` runs the seed scripts (data); the `setup` project handles login
  (auth state). These are distinct: seeding is data provisioning, the setup
  project produces `.auth/dev-user.json`.
- Reporters: `list` + `html`. Routes use the `/en` locale for stable English
  label assertions.

### Global setup / seeding
Runs in order before specs:
1. `seed-test-user.ts` — ensure `dev@karute.test` + business exist.
2. `seed-booking-data.ts` — ensure synqed-core has customers + appointments.
Idempotent; safe to re-run. Read-flow specs assert against these known names.

### Shared fixture — console-error guard
A test fixture attaches a `page.on('console')` / `page.on('pageerror')` listener
and **fails the test if any console error or page error occurs**. This is the
assertion that the previously-erroring `/customers` and `/karute` pages now
render cleanly against real data.

### Specs (`e2e/`)
- `auth.setup.ts` — seed + login via the form, save `.auth/dev-user.json`.
- `read-flows.spec.ts` (authed) — dashboard, customers list, customer profile,
  karute list, appointments, settings, coaching all render with seeded data and
  zero console errors.
- `karute-record.spec.ts` (authed) — core write flow: start a session/recording,
  save a karute record, verify it appears in the karute list / customer profile.
- `customer-crud.spec.ts` (authed) — create a customer → see it in the list →
  edit → delete; created entities cleaned up via `SynqedClient` in teardown.
- `auth-lifecycle.spec.ts` (unauth) — signup → bootstrap business → login →
  logout, plus the unauthenticated `/dashboard` → `/login` redirect gate. Uses a
  fresh, timestamped account created via the admin API; deleted in teardown.

### npm scripts
- `pretest:e2e` — reachability guard: fail fast if `http://localhost:3100` (or
  `$SYNQED_CORE_URL`) is not responding, with a message telling the dev to start
  synqed-core.
- `test:e2e` — runs Playwright (webServer starts the app; setup seeds + logs in).
- `test:e2e:ui` — headed/`--ui` for local debugging.

### Docs
A short README/`docs` section: prerequisites (Node, synqed-core repo) and the
two-step run: **1) start synqed-core at :3100  2) `npm run test:e2e`**.

## Data flow

```
synqed-core (:3100, manual)  ──┐
Supabase test project          ├─►  next dev (:3000, Playwright webServer)
.env.e2e ──────────────────────┘
        │
  global setup: seed-test-user → seed-booking-data
        │
  setup project: login → .auth/dev-user.json
        │
  authed specs (storageState) + unauth specs ──► assertions + console-error guard
```

## Error handling & determinism

- `pretest:e2e` guards the synqed-core dependency (clear failure, not a confusing
  Server-Component error mid-suite).
- Write/CRUD specs create uniquely-named entities and delete them in teardown so
  reruns are idempotent and the test business doesn't accumulate noise.
- Read-flow specs depend only on the stable seed data (known customer names).
- All E2E runs target the **test** Supabase project and a **local** synqed-core —
  never production.

## Out of scope (YAGNI for v1)

- CI wiring (GitHub Actions) — local-dev first; CI is a later increment once the
  suite is stable and synqed-core has a CI-runnable form.
- Containerizing synqed-core.
- Visual-regression / screenshot diffing.
- Cross-browser matrix (Chromium only for v1).

## Success criteria

- `npm run test:e2e` (with synqed-core up) runs green: all four flow groups pass.
- `/customers` and `/karute` render real seeded data with **zero console errors**
  (the regression that motivated this).
- Re-running the suite is idempotent (no data accumulation that breaks asserts).
