# Whole-system E2E Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Playwright suite that drives the real karute app against a real local synqed-core + the test Supabase project, with seeded data, covering read/nav, the record→save-karute write flow, customer CRUD, and the auth lifecycle.

**Architecture:** Playwright's `webServer` runs `next dev` (runtime env, no build-time `NEXT_PUBLIC` inlining). A `globalSetup` runs the existing seed scripts; a `setup` project logs in once and saves `storageState`. Authenticated specs reuse that state; the auth-lifecycle spec runs unauthenticated. synqed-core is a manual prerequisite at `:3100`, guarded by a fail-fast preflight.

**Tech Stack:** Playwright `^1.60.0`, Next 16 (`next dev`), `@supabase/supabase-js`, `@synqed-kk/client`, `tsx`, existing `scripts/seed-*.ts`.

**Prerequisite for running any spec in this plan:** synqed-core running at `http://localhost:3100`. Tasks that run the suite assume it is up.

---

### Task 1: E2E env file + synqed-core preflight guard

**Files:**
- Create: `.env.e2e` (gitignored — values copied from `.env.test.local` + synqed/openai from `.env.local`)
- Create: `scripts/e2e-preflight.ts`
- Modify: `.gitignore` (add `.env.e2e`, `.auth/`, `test-results/`, `playwright-report/`)
- Modify: `package.json` (scripts)

- [ ] **Step 1: Create `.env.e2e`** with the test Supabase project + local synqed + openai. Run:

```bash
{ grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.test.local;
  grep -E '^(OPENAI_API_KEY|SYNQED_CORE_URL)=' .env.local;
  echo "SYNQED_CORE_API_KEY=$(grep '^SYNQED_API_KEY=' .env.local | cut -d= -f2-)"; } > .env.e2e
```

Verify it contains 6 keys: `grep -c '=' .env.e2e` → expect `6`.

- [ ] **Step 2: Add ignores** to `.gitignore`:

```
.env.e2e
.auth/
test-results/
playwright-report/
```

- [ ] **Step 3: Write the preflight guard** `scripts/e2e-preflight.ts`:

```ts
// Fails fast if synqed-core isn't reachable, so E2E doesn't surface a confusing
// Server-Component error mid-suite. Run as pretest:e2e.
const url = process.env.SYNQED_CORE_URL ?? 'http://localhost:3100'
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) }).catch(() => null)
  if (!res) {
    console.error(`\n✖ synqed-core not reachable at ${url}\n  Start synqed-core (it must listen on :3100) before running E2E.\n`)
    process.exit(1)
  }
  console.log(`✓ synqed-core reachable at ${url}`)
} catch {
  console.error(`✖ synqed-core not reachable at ${url} — start it first.`)
  process.exit(1)
}
```

- [ ] **Step 4: Add npm scripts** to `package.json` `"scripts"`:

```json
"pretest:e2e": "tsx --env-file=.env.e2e scripts/e2e-preflight.ts",
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

(`tsx` is already a dependency. `pretest:e2e` runs automatically before `test:e2e` via npm's pre-hook. `--env-file=.env.e2e` ensures the preflight sees `SYNQED_CORE_URL`. Playwright itself loads `.env.e2e` in `playwright.config.ts`, so `test:e2e` needs no `--env-file`.)

- [ ] **Step 5: Verify the guard fails when synqed-core is down.** With nothing on :3100:

Run: `npm run pretest:e2e`
Expected: prints `✖ synqed-core not reachable` and exits non-zero.

- [ ] **Step 6: Commit**

```bash
git add .gitignore scripts/e2e-preflight.ts package.json
git commit -m "test(e2e): env file + synqed-core preflight guard"
```

---

### Task 2: Playwright config + env loading + webServer

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Write `playwright.config.ts`:**

```ts
import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Load the E2E env into process.env so globalSetup (seed scripts) and the
// webServer (next dev) both see the test Supabase project + local synqed.
const e2eEnv = loadEnv({ path: '.env.e2e' }).parsed ?? {}

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    locale: 'en-US',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'authed',
      testIgnore: /auth-lifecycle\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/dev-user.json' },
    },
    {
      name: 'unauth',
      testMatch: /auth-lifecycle\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'next dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...process.env, ...e2eEnv } as Record<string, string>,
  },
})
```

- [ ] **Step 2: Verify config loads** (synqed-core can be down for this check; it only validates config parsing). Run:

`npx playwright test --list`
Expected: lists the (not-yet-created) projects without a config error. If specs don't exist yet it prints "no tests found" — that's fine; a *config* error would be a TypeScript/parse failure.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "test(e2e): playwright config — projects, webServer (next dev), env loading"
```

---

### Task 3: Global setup — seed real data

**Files:**
- Create: `e2e/global-setup.ts`

- [ ] **Step 1: Write `e2e/global-setup.ts`** — invokes the existing idempotent seed scripts with the loaded E2E env:

```ts
import { execFileSync } from 'node:child_process'
import type { FullConfig } from '@playwright/test'

// Seeds the known dev account + a business (seed-test-user) and real synqed-core
// customers/appointments (seed-booking-data). Both scripts are idempotent. The
// E2E env is already in process.env (loaded in playwright.config.ts), so the
// child processes inherit the test Supabase + local synqed config.
export default async function globalSetup(_config: FullConfig) {
  const run = (script: string) => {
    console.log(`[global-setup] running ${script}…`)
    execFileSync('npx', ['tsx', script], { stdio: 'inherit', env: process.env })
  }
  run('scripts/seed-test-user.ts')
  run('scripts/seed-booking-data.ts')
  console.log('[global-setup] seed complete')
}
```

- [ ] **Step 2: Verify seeding runs** (synqed-core MUST be up). Run:

`npx tsx --env-file=.env.e2e -e "import('./e2e/global-setup.ts').then(m => m.default({} as any))"`
Expected: logs from both seed scripts, ending with `[global-setup] seed complete`. Confirms `dev@karute.test` exists and synqed-core has customers/appointments.

- [ ] **Step 3: Commit**

```bash
git add e2e/global-setup.ts
git commit -m "test(e2e): global setup seeds test user + booking data"
```

---

### Task 4: Auth setup project — login + storageState

**Files:**
- Create: `e2e/auth.setup.ts`

- [ ] **Step 1: Write `e2e/auth.setup.ts`:**

```ts
import { test as setup, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const EMAIL = 'dev@karute.test'
const PASSWORD = 'TestPass123!'
const STATE = '.auth/dev-user.json'

setup('authenticate dev user', async ({ page }) => {
  mkdirSync('.auth', { recursive: true })
  await page.goto('/en/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL)
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/en\/(dashboard|appointments|customers|karute)/, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/en\//)
  await page.context().storageState({ path: STATE })
})
```

- [ ] **Step 2: Run the setup project** (synqed-core up). Run:

`npx playwright test --project=setup`
Expected: PASS; `.auth/dev-user.json` is created.

- [ ] **Step 3: Commit**

```bash
git add e2e/auth.setup.ts
git commit -m "test(e2e): auth setup project saves dev-user storageState"
```

---

### Task 5: Console-error guard fixture

**Files:**
- Create: `e2e/fixtures.ts`

- [ ] **Step 1: Write `e2e/fixtures.ts`** — a `test` that fails if the page logs console errors or page errors (the assertion that previously-erroring pages now render cleanly):

```ts
import { test as base, expect } from '@playwright/test'

// Extends the base test so any console error or uncaught page error fails the
// test. This is the guard that catches Server-Component render errors like the
// ones /customers and /karute threw without real synqed data.
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))
    await use(errors)
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([])
  },
})

export { expect }
```

- [ ] **Step 2: Verify it compiles** (no runtime run needed):

Run: `npx tsc --noEmit -p tsconfig.json` — Expected: 0 errors. (If `e2e/` is excluded from the app tsconfig, this still type-checks via Playwright's own transpile at run time; a clean `playwright test --list` in later tasks confirms it.)

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures.ts
git commit -m "test(e2e): console-error guard fixture"
```

---

### Task 6: Read/nav flows spec

**Files:**
- Create: `e2e/read-flows.spec.ts`

- [ ] **Step 1: Write `e2e/read-flows.spec.ts`** — asserts each key page renders with seeded data and no console errors. Uses a seeded customer name from `scripts/seed-booking-data.ts` (`高橋 由美`):

```ts
import { test, expect } from './fixtures'

test.describe('read/nav flows render with real seeded data', () => {
  test('dashboard renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/dashboard')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors // asserted in fixture teardown
  })

  test('customers list shows a seeded customer', async ({ page }) => {
    await page.goto('/en/customers')
    await expect(page.getByText('高橋 由美')).toBeVisible()
  })

  test('customer profile opens from the list', async ({ page }) => {
    await page.goto('/en/customers')
    await page.getByText('高橋 由美').click()
    await expect(page).toHaveURL(/\/en\/customers\/[^/]+$/)
  })

  test('karute list renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/karute')
    await expect(page.getByRole('heading', { name: /karute/i })).toBeVisible()
    void consoleErrors
  })

  test('appointments view renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/appointments')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors
  })

  test('settings renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/settings')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors
  })

  test('coaching renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/coaching')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors
  })
})
```

- [ ] **Step 2: Run it** (synqed-core up). Run:

`npx playwright test --project=authed read-flows`
Expected: all PASS. If `customers`/`karute` fail on a console error, that's a real finding to investigate (defensive synqed handling) — do not weaken the guard; fix the page or report.

- [ ] **Step 3: Adjust selectors if needed.** If a heading/label differs from the assertion, open the trace (`npx playwright show-report`) and update the locator to match the rendered English label. Re-run until green.

- [ ] **Step 4: Commit**

```bash
git add e2e/read-flows.spec.ts
git commit -m "test(e2e): read/nav flows render with seeded data + no console errors"
```

---

### Task 7: Core write flow — record → save karute

**Files:**
- Create: `e2e/karute-record.spec.ts`

> The recording UI uses the mic and an AI save path. This spec drives the
> non-audio save path: it opens the session/record screen for a seeded customer,
> saves a karute record (manual/draft create where audio isn't available in
> headless Chromium), and verifies it appears. Confirm the exact entry points by
> reading `src/app/[locale]/(app)/sessions/page.tsx` and the karute save action
> (`saveKaruteRecord` / `saveKaruteRecordInline`) during implementation.

- [ ] **Step 1: Inspect the record entry point.** Run:

`grep -rn "getByRole\|data-testid\|New Karute\|新規\|record" src/app/"[locale]"/\(app\)/sessions/page.tsx src/components/karute 2>/dev/null | head -30`
Note the button/link labels for "start session / new karute / save".

- [ ] **Step 2: Write `e2e/karute-record.spec.ts`** using the labels found. Template (replace bracketed locators with the real ones from Step 1):

```ts
import { test, expect } from './fixtures'

test('creates a karute record for a seeded customer and it appears in the list', async ({ page }) => {
  // Enter the record/session flow for a seeded customer.
  await page.goto('/en/karute')
  await page.getByRole('link', { name: /new karute|新規/i }).click()
  // Pick the seeded customer.
  await page.getByText('高橋 由美').click()
  // Save a (manual/draft) karute record. Adjust label to the real Save control.
  await page.getByRole('button', { name: /save|保存/i }).click()
  // Verify it lands and the record shows for the customer.
  await expect(page).toHaveURL(/\/en\/(karute|customers)/)
  await page.goto('/en/karute')
  await expect(page.getByText('高橋 由美').first()).toBeVisible()
})
```

- [ ] **Step 3: Run it** (synqed-core up). Run:

`npx playwright test --project=authed karute-record`
Expected: PASS. Use `--ui`/trace to fix locators if the flow differs.

- [ ] **Step 4: Add teardown cleanup** if the spec created a karute record — delete it via `SynqedClient` in `test.afterAll` (mirror the delete usage in `src/__tests__/integration/migrated-core-flow.test.ts`), so reruns stay idempotent. Show the cleanup code inline once locators are known.

- [ ] **Step 5: Commit**

```bash
git add e2e/karute-record.spec.ts
git commit -m "test(e2e): record -> save karute write flow"
```

---

### Task 8: Customer CRUD spec

**Files:**
- Create: `e2e/customer-crud.spec.ts`

- [ ] **Step 1: Inspect the customer create/edit/delete UI.** Run:

`grep -rn "getByRole\|data-testid\|New customer\|新規顧客\|Save\|Delete" src/components/customers 2>/dev/null | head -30`
Note the labels for add/edit/delete.

- [ ] **Step 2: Write `e2e/customer-crud.spec.ts`** with a uniquely-named customer so it's identifiable and cleanable:

```ts
import { test, expect } from './fixtures'

const NAME = `E2E Customer ${Date.now()}`

test('create, see, edit, delete a customer', async ({ page }) => {
  await page.goto('/en/customers')
  await page.getByRole('button', { name: /new customer|add customer|新規/i }).click()
  await page.getByRole('textbox', { name: /name|名前/i }).first().fill(NAME)
  await page.getByRole('button', { name: /save|create|保存/i }).click()
  await expect(page.getByText(NAME)).toBeVisible()

  // Edit
  await page.getByText(NAME).click()
  await page.getByRole('button', { name: /edit|編集/i }).click()
  await page.getByRole('textbox', { name: /name|名前/i }).first().fill(`${NAME} edited`)
  await page.getByRole('button', { name: /save|保存/i }).click()
  await expect(page.getByText(`${NAME} edited`)).toBeVisible()

  // Delete
  await page.getByRole('button', { name: /delete|削除/i }).click()
  await page.getByRole('button', { name: /confirm|delete|削除/i }).last().click()
  await page.goto('/en/customers')
  await expect(page.getByText(`${NAME} edited`)).toHaveCount(0)
})
```

- [ ] **Step 3: Run it** (synqed-core up). Run:

`npx playwright test --project=authed customer-crud`
Expected: PASS. Fix locators via trace as needed.

- [ ] **Step 4: Safety-net cleanup.** Add `test.afterAll` that lists synqed customers and deletes any whose name starts with `E2E Customer ` (in case a mid-test failure left one), using `SynqedClient`. Show inline once the create path is confirmed.

- [ ] **Step 5: Commit**

```bash
git add e2e/customer-crud.spec.ts
git commit -m "test(e2e): customer CRUD write path"
```

---

### Task 9: Auth lifecycle spec (unauthenticated project)

**Files:**
- Create: `e2e/auth-lifecycle.spec.ts`

- [ ] **Step 1: Write `e2e/auth-lifecycle.spec.ts`** — fresh context (the `unauth` project has no storageState). Creates a throwaway account via the admin API + bootstrap, exercises login/logout + the redirect gate, deletes the account in teardown:

```ts
import { test, expect } from './fixtures'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const email = `e2e-auth-${Date.now()}@karute-e2e.invalid`
const password = 'TestPass123!'
let userId = ''

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  userId = data.user.id
  const { bootstrapBusinessForNewUser } = await import('../src/actions/bootstrap')
  const r = await bootstrapBusinessForNewUser('E2E Auth Salon', userId)
  if (!('ok' in r) || !r.ok) throw new Error('bootstrap failed')
})

test.afterAll(async () => {
  if (userId) {
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
})

test('unauthenticated dashboard redirects to login', async ({ page }) => {
  await page.goto('/en/dashboard')
  await expect(page).toHaveURL(/\/en\/login/)
})

test('login then logout', async ({ page }) => {
  await page.goto('/en/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/en\/(dashboard|appointments|customers|karute)/, { timeout: 15_000 })

  // Logout via the profile chip menu. Adjust labels to the real controls.
  await page.getByRole('button', { name: /E2E Auth|owner|stylist/i }).click()
  await page.getByRole('menuitem', { name: /log ?out|sign ?out|ログアウト/i }).click()
  await expect(page).toHaveURL(/\/en\/login/)
})
```

- [ ] **Step 2: Confirm `bootstrapBusinessForNewUser`'s return shape** by reading `src/actions/bootstrap.ts`; adjust the `r.ok` check to match. Confirm the logout control labels from `src/components/layout/sidebar.tsx` (`SidebarProfileChip` `handleLogout`).

- [ ] **Step 3: Run it.** Run:

`npx playwright test --project=unauth auth-lifecycle`
Expected: PASS; the throwaway user is deleted afterward.

- [ ] **Step 4: Commit**

```bash
git add e2e/auth-lifecycle.spec.ts
git commit -m "test(e2e): auth lifecycle — signup/bootstrap/login/logout + redirect gate"
```

---

### Task 10: Full-suite run + docs

**Files:**
- Create: `docs/e2e.md`
- Modify: `README.md` (link to it, if a README exists)

- [ ] **Step 1: Run the whole suite** (synqed-core up). Run:

`npm run test:e2e`
Expected: preflight passes, webServer boots `next dev`, global-setup seeds, setup logs in, all four flow specs pass. Fix any locator drift via `npx playwright show-report`.

- [ ] **Step 2: Write `docs/e2e.md`:**

```markdown
# End-to-end tests

Real-stack Playwright suite: synqed-core + the karute app + the **test** Supabase
project, with seeded data. Never points at production.

## Prerequisites
- Node + deps installed (`npm ci`).
- `.env.e2e` present (test Supabase project + `SYNQED_CORE_URL=http://localhost:3100` + `SYNQED_CORE_API_KEY` + `OPENAI_API_KEY`).
- **synqed-core running at `http://localhost:3100`.**

## Run
1. Start synqed-core (its own repo) on :3100.
2. `npm run test:e2e`  (or `npm run test:e2e:ui` to debug headed)

Playwright auto-starts the app with `next dev`, seeds `dev@karute.test` + booking
data, logs in once (saved to `.auth/dev-user.json`), then runs:
read-flows, karute-record, customer-crud, auth-lifecycle.

If synqed-core is down, `pretest:e2e` fails fast with a clear message.
```

- [ ] **Step 3: Commit**

```bash
git add docs/e2e.md README.md
git commit -m "docs(e2e): how to run the whole-system E2E suite"
```

- [ ] **Step 4: Push**

```bash
git push origin incremental-merge
```

---

## Notes for the implementer
- **Locator drift is expected.** The spec code uses best-guess English labels; confirm against the real rendered UI (use `npx playwright show-report` traces) and adjust. Do not weaken the console-error guard to make a page pass — a console error there is a real finding.
- **Idempotency:** seed scripts are idempotent; write/CRUD specs must clean up created entities so repeated runs stay green.
- **synqed-core dependency:** every spec-running step assumes synqed-core is up at :3100.
