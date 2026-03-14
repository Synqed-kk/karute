# Phase 8: Integration Testing - Research

**Researched:** 2026-03-14
**Domain:** Integration testing for Next.js 16 App Router + Supabase + OpenAI
**Confidence:** HIGH (stack, patterns) / MEDIUM (server action testing specifics)

---

## Summary

The project already has Jest 29.7.0 and `@types/jest` installed, but has no `jest.config.ts`, no test files, and no `.env.test.local`. The test phase is building on a blank canvas inside an established stack. The primary challenge is the three-layer dependency in every test: Next.js App Router internals (cookies, headers), Supabase (real database or mock), and OpenAI (must always be mocked — no real API calls in tests).

The recommended approach for this codebase is: **real Supabase test project + mocked OpenAI + `next-test-api-route-handler` for route handlers + manual `jest.mock` for server actions**. NTARH handles the `next/headers`/`NextRequest` emulation for the three API routes. Server actions (`saveKaruteRecord`, `createCustomer`, etc.) call `cookies()` from `next/headers` and `createClient()` from `@/lib/supabase/server` — both must be mocked in Jest. The Supabase test project receives real inserts; `afterAll` hooks delete all rows created during the test run using tracked IDs.

The full flow to test is: mock audio blob → POST `/api/ai/transcribe` (mocked OpenAI Whisper) → POST `/api/ai/extract` (mocked OpenAI GPT) → POST `/api/ai/summarize` (mocked OpenAI GPT) → call `createCustomer` server action against real Supabase → call `saveKaruteRecord` server action against real Supabase → query Supabase directly to assert data → `afterAll` deletes entries, karute_records, and customers by tracked IDs.

**Primary recommendation:** Use Jest 29 + `next-test-api-route-handler` (NTARH) for route handlers, `jest.mock` for server actions, a separate `.env.test.local` pointing at a Supabase test project, and explicit ID-tracking teardown in `afterAll`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jest | 29.7.0 (already installed) | Test runner | Already in project; Next.js officially recommends it |
| next-test-api-route-handler | ^4.0.x | Tests App Router route handlers in isolation | Only library that properly emulates `NextRequest`, `next/headers`, params — automatically tested against each Next.js release |
| @types/jest | 30.0.0 (already installed) | TypeScript types for Jest | Already in project |
| ts-node | ^10.x | Executes `jest.config.ts` | Required by `next/jest` when config is TypeScript |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @supabase/supabase-js | ^2.99.1 (already installed) | Direct Supabase client for test helpers | Creating test Supabase client outside Next.js server context for teardown queries |
| dotenv | built into next/jest | Load `.env.test.local` | Automatic via `next/jest`'s `dir: './'` — loads env files including `.env.test.local` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| next-test-api-route-handler | Supertest + jest-fetch-mock | NTARH is the only option that correctly handles `NextRequest`, `params`, and `next/headers`; Supertest requires spinning up a full server |
| Real Supabase test project | Supabase local instance | Local instance is ideal for CI but requires Docker + Supabase CLI; a dedicated cloud test project is simpler for a small team |
| Real Supabase test project | Fully mock Supabase | Mocking Supabase means tests don't catch real DB behavior (RLS, constraints, FK cascades); the requirement is "pass in CI with real teardown", not isolation via mocks |
| jest.mock for OpenAI | Real OpenAI API | Real API calls are expensive, slow, non-deterministic, and violate the "no network in tests" principle |

**Installation** (packages not yet installed):

```bash
npm install -D next-test-api-route-handler ts-node
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── __tests__/
│   └── integration/
│       ├── helpers/
│       │   ├── supabase.ts       # test Supabase client + teardown tracker
│       │   ├── openai-mocks.ts   # reusable jest.mock factories for OpenAI
│       │   └── server-action-mocks.ts  # mock next/headers, next/cache
│       ├── setup/
│       │   └── jest.setup.ts     # global beforeAll/afterAll, env validation
│       ├── api-transcribe.test.ts
│       ├── api-extract.test.ts
│       ├── api-summarize.test.ts
│       └── core-flow.test.ts     # full record → save → verify flow
jest.config.ts                    # root config
.env.test.local                   # TEST Supabase project credentials
```

### Pattern 1: Jest Configuration with next/jest

**What:** `next/jest` wraps Jest to handle Next.js internals — SWC transforms, path alias resolution (`@/*`), `.env` loading, and mocking of Next.js's internal CSS/image imports.

**When to use:** Always. This is the only supported way to run Jest in a Next.js project.

**Example:**
```typescript
// jest.config.ts
// Source: https://nextjs.org/docs/app/guides/testing/jest
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  dir: './',  // loads next.config.js + .env files (including .env.test.local)
})

const config: Config = {
  testEnvironment: 'node',  // NOT jsdom — integration tests are server-side
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  setupFilesAfterEach: ['<rootDir>/src/__tests__/integration/setup/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

export default createJestConfig(config)
```

**IMPORTANT:** Use `testEnvironment: 'node'` for integration tests — these test server-side code, not DOM. `jsdom` is for React component tests only.

### Pattern 2: Testing API Route Handlers with NTARH

**What:** `testApiHandler` wraps the route module so that Next.js internals (`NextRequest`, `cookies()`, `headers()`, route params) work correctly inside Jest — without starting a real server.

**When to use:** For all three API routes: `/api/ai/transcribe`, `/api/ai/extract`, `/api/ai/summarize`.

**Example:**
```typescript
// Source: https://github.com/Xunnamius/next-test-api-route-handler
import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/ai/extract/route'

// Mock OpenAI BEFORE imports (jest.mock is hoisted)
jest.mock('@/lib/openai', () => ({
  openai: {
    chat: {
      completions: {
        parse: jest.fn(),
      },
    },
  },
}))

import { openai } from '@/lib/openai'

it('extract route returns parsed entries for a valid transcript', async () => {
  const mockParsed = {
    entries: [{ category: 'hair_color', content: 'Dark brown base', confidence_score: 0.9 }],
  }
  ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
    choices: [{ message: { parsed: mockParsed } }],
  })

  await testApiHandler({
    appHandler,
    async test({ fetch }) {
      const res = await fetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: 'Client wanted dark brown hair.', locale: 'en' }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.entries).toHaveLength(1)
      expect(data.entries[0].category).toBe('hair_color')
    },
  })
})
```

### Pattern 3: Mocking next/headers for Server Actions

**What:** Server actions call `cookies()` from `next/headers` and `revalidatePath`/`redirect` from `next/cache`/`next/navigation`. Outside the Next.js runtime these throw. Mock them globally or per-test.

**When to use:** Whenever testing server action files (`actions/karute.ts`, `actions/customers.ts`, `lib/staff.ts`).

**Example:**
```typescript
// Source: adapted from https://micheleong.com/blog/testing-nextjs-14-and-supabase
// and https://github.com/vercel/next.js/discussions/44270

// At top of test file or in jest.setup.ts:
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn((name: string) => {
      if (name === 'active_staff_id') return { value: TEST_STAFF_ID }
      return undefined
    }),
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}))
```

**CRITICAL:** `redirect()` from `next/navigation` throws a Next.js control-flow error in production. In tests, mock it with `jest.fn()` so it doesn't throw. `saveKaruteRecord` calls `redirect()` outside try/catch — if not mocked, the test will fail with an unhandled exception.

### Pattern 4: Real Supabase Test Client for Teardown

**What:** A plain `@supabase/supabase-js` client created directly from test env vars (not the Next.js server client that requires cookies). Used to insert prerequisite data and delete test data in teardown.

**When to use:** In test helpers — both setup (create a test customer/profile) and teardown (delete all tracked IDs).

**Example:**
```typescript
// src/__tests__/integration/helpers/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// This client uses the SERVICE_ROLE key for unrestricted deletes in teardown
// RLS policies use 'using (true)' so anon key also works — but service role
// is safer for teardown to avoid RLS edge cases
export const testSupabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // add to .env.test.local
)

// Track IDs created during test run for teardown
export const created = {
  customerIds: [] as string[],
  karuteRecordIds: [] as string[],
  entryIds: [] as string[],
  profileIds: [] as string[],
}

export async function teardownTestData() {
  // Delete in FK-safe order: entries → karute_records → customers/profiles
  if (created.entryIds.length > 0) {
    await testSupabase.from('entries').delete().in('id', created.entryIds)
  }
  if (created.karuteRecordIds.length > 0) {
    await testSupabase.from('karute_records').delete().in('id', created.karuteRecordIds)
  }
  if (created.customerIds.length > 0) {
    await testSupabase.from('customers').delete().in('id', created.customerIds)
  }
  if (created.profileIds.length > 0) {
    await testSupabase.from('profiles').delete().in('id', created.profileIds)
  }
  // Reset arrays
  created.customerIds.length = 0
  created.karuteRecordIds.length = 0
  created.entryIds.length = 0
  created.profileIds.length = 0
}
```

### Pattern 5: Mocking the Transcribe Route (FormData + Whisper)

**What:** The transcribe route accepts `FormData` with a `File` (audio blob). In tests, construct a `Blob` + `FormData` and mock `openai.audio.transcriptions.create` to return a string.

**When to use:** The `/api/ai/transcribe` route test and the core flow test.

**Example:**
```typescript
jest.mock('@/lib/openai', () => ({
  openai: {
    audio: {
      transcriptions: {
        create: jest.fn(),
      },
    },
  },
}))

// In test:
;(openai.audio.transcriptions.create as jest.Mock).mockResolvedValue(
  'Client wanted dark brown base color with highlights.'
)

await testApiHandler({
  appHandler,
  async test({ fetch }) {
    const formData = new FormData()
    formData.append(
      'audio',
      new Blob(['fake-audio-bytes'], { type: 'audio/webm' }),
      'audio.webm'
    )
    formData.append('locale', 'en')

    const res = await fetch({ method: 'POST', body: formData })
    expect(res.status).toBe(200)
    const { transcript } = await res.json()
    expect(typeof transcript).toBe('string')
  },
})
```

### Pattern 6: Full Flow Test (saveKaruteRecord)

**What:** The `saveKaruteRecord` action must be called with a real customer ID and a real staff profile ID — both must exist in the test Supabase project. Pre-create them in `beforeAll`, track IDs, call the server action, assert against Supabase directly, teardown in `afterAll`.

**When to use:** The core-flow integration test.

**Example:**
```typescript
// core-flow.test.ts
import { createCustomer } from '@/actions/customers'
import { saveKaruteRecord } from '@/actions/karute'
import { testSupabase, created, teardownTestData } from './helpers/supabase'

// Mock next/headers so cookies() returns a real-looking staff ID
const TEST_STAFF_PROFILE_ID = '00000000-0000-0000-0000-000000000001'  // pre-seeded in test DB

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn((name: string) =>
      name === 'active_staff_id' ? { value: TEST_STAFF_PROFILE_ID } : undefined
    ),
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
// Mock the Supabase server client to use the test client instead
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => Promise.resolve(testSupabase)),
}))

afterAll(teardownTestData)

it('saves a karute record with entries and can be queried back', async () => {
  // 1. Create customer
  const customerResult = await createCustomer({ name: 'Test Patient Integration' })
  expect(customerResult.success).toBe(true)
  if (!customerResult.success) return
  created.customerIds.push(customerResult.id)

  // 2. Save karute record (redirect() is mocked so won't throw)
  const result = await saveKaruteRecord({
    customerId: customerResult.id,
    transcript: 'Test transcript text',
    summary: 'Test summary',
    entries: [
      { category: 'hair_color', content: 'Dark brown', sourceQuote: null, confidenceScore: 0.9 },
    ],
  })
  // saveKaruteRecord returns void on success (redirect is mocked)
  expect(result).toBeUndefined()

  // 3. Verify in Supabase directly
  const { data: records } = await testSupabase
    .from('karute_records')
    .select('id, transcript')
    .eq('client_id', customerResult.id)
  expect(records).toHaveLength(1)
  created.karuteRecordIds.push(records![0].id)

  const { data: entries } = await testSupabase
    .from('entries')
    .select('id, category')
    .eq('karute_record_id', records![0].id)
  expect(entries).toHaveLength(1)
  entries!.forEach(e => created.entryIds.push(e.id))
})
```

### Anti-Patterns to Avoid

- **Using `testEnvironment: 'jsdom'` for integration tests:** These tests run server-side code; jsdom causes spurious failures and is irrelevant.
- **Mocking Supabase itself for the core flow test:** Mocking the Supabase client means tests pass even when RLS or FK constraints would cause real failures. Use the real test DB.
- **Calling real OpenAI API in tests:** Costs money, is non-deterministic, and will fail in CI environments without API key. Always mock OpenAI.
- **Relying on `DELETE WHERE neq(id, '00...')` for cleanup:** This deletes ALL rows including any pre-seeded data. Track exact IDs and delete only those.
- **Forgetting FK order in teardown:** `entries` must be deleted before `karute_records` (FK: `entries.karute_record_id`), and `karute_records` before `customers` (FK: `karute_records.client_id`).
- **Not mocking `redirect()`:** `saveKaruteRecord` calls `redirect()` outside try/catch. If not mocked, it throws a Next.js internal error that crashes the test.
- **Not mocking `revalidatePath()`:** Server actions call this; it requires the Next.js runtime to work. Jest will throw without a mock.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Testing NextRequest/route params in API handlers | Custom request object | `next-test-api-route-handler` | NTARH handles all Next.js internal edge cases; hand-rolled `Request` objects miss things like `params` and `next/headers` context |
| Loading `.env.test.local` | Custom dotenv setup | `next/jest` with `dir: './'` | `next/jest` automatically loads all `.env` variants including `.env.test.local` |
| TypeScript path alias resolution in tests | Manual `moduleNameMapper` | `next/jest` (handles `@/*` from tsconfig automatically) | `next/jest` reads the `paths` from `tsconfig.json` and generates the correct `moduleNameMapper` |

**Key insight:** The two biggest sources of test setup pain in this stack (Next.js internals + TypeScript paths) are both solved by `next/jest` + NTARH. Don't fight them manually.

---

## Common Pitfalls

### Pitfall 1: `redirect()` throws in server action tests

**What goes wrong:** `saveKaruteRecord` calls `redirect('/karute/${recordId}')` outside the try/catch block. In Jest, this throws `Error: NEXT_REDIRECT` and the test fails even though the action succeeded.

**Why it happens:** Next.js implements `redirect()` as a thrown exception (`NEXT_REDIRECT`) that the framework catches. Outside the runtime (in Jest), nothing catches it.

**How to avoid:** Always mock `next/navigation` before importing server action files:
```typescript
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
```

**Warning signs:** Test fails with `Error: NEXT_REDIRECT` or `Error: Invariant: attempted to hard navigate to the same URL`.

### Pitfall 2: `cookies()` throws outside the request context

**What goes wrong:** `getActiveStaffId()` calls `cookies()` from `next/headers`. In Jest, this throws `Error: cookies was called outside a request scope`.

**Why it happens:** `next/headers` cookies are only available in the context of a real Next.js request.

**How to avoid:** Mock `next/headers` at the top of every test file that exercises server actions or functions that call `cookies()`. This includes `saveKaruteRecord` (via `getActiveStaffId`), `createClient` (via the Supabase server helper).

**Warning signs:** Test error `Error: cookies() was called outside a request scope`.

### Pitfall 3: `createClient()` in tests uses wrong env vars

**What goes wrong:** The Next.js Supabase server client reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. If `.env.test.local` isn't configured or isn't loaded, the test client connects to the production database.

**Why it happens:** Jest doesn't automatically load `.env.local` unless `next/jest` is set up with `dir: './'`. The test-specific overrides must be in `.env.test.local` (Jest loads it over `.env.local` when `NODE_ENV=test`).

**How to avoid:**
1. Create `.env.test.local` with test project credentials (never production).
2. Use `next/jest` with `dir: './'`.
3. Add a guard in `jest.setup.ts` that asserts env vars are set and not pointing at production URL.

**Warning signs:** Tests accidentally modify production data; teardown deletes real customer records.

### Pitfall 4: NTARH must be the first import

**What goes wrong:** `next-test-api-route-handler` must be imported before any Next.js internals in the test file, otherwise the mock environment isn't set up.

**Why it happens:** NTARH patches Node's module resolution to intercept Next.js internal calls.

**How to avoid:** Import `testApiHandler` as the first `import` statement in any test file using it.

**Warning signs:** Tests using NTARH pass individually but fail when run together, or fail with cryptic Next.js internal errors.

### Pitfall 5: `jest.mock` not hoisted for OpenAI

**What goes wrong:** If OpenAI mock is defined after importing `@/lib/openai`, the real OpenAI client is imported first and mock doesn't take effect.

**Why it happens:** `jest.mock()` calls are hoisted to the top of the module by Babel/SWC, but only if declared at the module level — not inside `beforeEach`.

**How to avoid:** Always declare `jest.mock('@/lib/openai', ...)` at the top level of the test file, before any `import` that uses it. The `jest.mock` factory runs before imports due to hoisting.

**Warning signs:** Tests make real HTTP requests to OpenAI; tests fail with `AuthenticationError` (no API key in CI).

### Pitfall 6: Test isolation — `--runInBand` for Supabase tests

**What goes wrong:** Jest runs test files in parallel by default. If two test files both insert and then delete the same table rows simultaneously, teardown can fail or leave orphaned data.

**Why it happens:** Parallel Jest workers share the same remote Supabase instance (unlike in-memory DBs).

**How to avoid:** Run integration tests with `--runInBand` to serialize execution:
```json
"test:integration": "jest --testPathPattern='__tests__/integration' --runInBand"
```

**Warning signs:** Teardown errors like `foreign key constraint violation` or rows not found during cleanup.

### Pitfall 7: Supabase service role key needed for teardown

**What goes wrong:** Using the anon key for teardown — RLS policy `using (true)` should allow deletes, but if sessions/tokens expire or aren't set up correctly, deletes fail silently.

**Why it happens:** The test teardown client is not going through a Next.js session flow — it's a raw SDK client.

**How to avoid:** Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.test.local` and use it specifically for the test teardown helper client. The service role key bypasses RLS entirely.

---

## Code Examples

Verified patterns from official sources:

### jest.config.ts (Next.js official pattern)
```typescript
// Source: https://nextjs.org/docs/app/guides/testing/jest
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  setupFilesAfterEach: ['<rootDir>/src/__tests__/integration/setup/jest.setup.ts'],
}

export default createJestConfig(config)
```

### NTARH App Router handler test
```typescript
// Source: https://github.com/Xunnamius/next-test-api-route-handler
import { testApiHandler } from 'next-test-api-route-handler'  // MUST be first
import * as appHandler from '@/app/api/ai/extract/route'

jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { parse: jest.fn() } } },
}))

it('returns 400 for missing transcript', async () => {
  await testApiHandler({
    appHandler,
    async test({ fetch }) {
      const res = await fetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    },
  })
})
```

### Teardown tracker pattern
```typescript
// Source: pattern synthesized from https://www.iloveblogs.blog/guides/nextjs-supabase-testing-strategies
// and Supabase JS client docs
const createdIds = { customers: [] as string[], records: [] as string[], entries: [] as string[] }

afterAll(async () => {
  if (createdIds.entries.length) {
    await testSupabase.from('entries').delete().in('id', createdIds.entries)
  }
  if (createdIds.records.length) {
    await testSupabase.from('karute_records').delete().in('id', createdIds.records)
  }
  if (createdIds.customers.length) {
    await testSupabase.from('customers').delete().in('id', createdIds.customers)
  }
})
```

### .env.test.local structure
```bash
# .env.test.local — Supabase TEST project (never production)
NEXT_PUBLIC_SUPABASE_URL=https://[TEST-PROJECT-ID].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[test-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[test-service-role-key]
# OpenAI key not needed — always mocked in tests
# OPENAI_API_KEY is intentionally absent from .env.test.local
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Supertest + Express-style mocking | `next-test-api-route-handler` | Next.js App Router (v13+) | NTARH is the only reliable way to test App Router route handlers in Jest |
| `jest-environment-jsdom` for all tests | `jest-environment-node` for server-side tests | Next.js App Router era | Server actions and route handlers are Node.js code, not browser code |
| `@testing-library/react` for everything | Separate environments per test type | 2023–2024 | Component tests need jsdom; server tests need node; mixing causes issues |
| Mock Supabase client | Real test Supabase project | Ongoing | Mocking Supabase misses RLS, FK, and constraint behavior |

**Deprecated/outdated:**
- `jest-environment-jsdom` for API route/server action tests — use `node` environment
- Testing server actions with Playwright/E2E only — Jest integration tests against real test DB are now the standard

---

## Open Questions

1. **Pre-seeded staff profile in the test Supabase project**
   - What we know: `saveKaruteRecord` reads `staff_profile_id` from the `active_staff_id` cookie (mocked in tests). The staff profile must exist in the `profiles` table as a FK.
   - What's unclear: Whether the test Supabase project has a profile row, or whether one must be created in `beforeAll` (requires a matching `auth.users` row, which is difficult without the Admin API).
   - Recommendation: Create a test profile row directly via the service role client in `beforeAll`, using a hardcoded UUID. Delete it in `afterAll`. Skip the `auth.users` dependency since `profiles.id` is likely not constrained to `auth.users` in the current schema — verify this in the actual migration.

2. **`next/jest` and `ts-node` for jest.config.ts**
   - What we know: `next/jest` requires `ts-node` to parse `jest.config.ts`. `ts-node` is not currently installed.
   - What's unclear: Whether the project uses `jest.config.js` (plain JS) or `jest.config.ts` (TypeScript) — no config file exists yet.
   - Recommendation: Use `jest.config.ts` with `ts-node` as a dev dependency for consistency with the TypeScript-first codebase.

3. **CI environment for integration tests**
   - What we know: Tests require `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` pointing at a test project.
   - What's unclear: Whether a GitHub Actions (or equivalent) CI workflow exists and how secrets will be injected.
   - Recommendation: The plan phase should include a task for creating/documenting the CI secret configuration. The test themselves just need the env vars present.

---

## Sources

### Primary (HIGH confidence)
- https://nextjs.org/docs/app/guides/testing/jest — Official Next.js Jest setup guide (verified current, version 16.1.6 listed)
- https://github.com/Xunnamius/next-test-api-route-handler — NTARH official GitHub README (app router support confirmed, tested against each Next.js release)
- `/Users/anthonylee/karuteround2/package.json` — Confirmed: jest 29.7.0, @types/jest 30.0.0 already installed; no ts-node or NTARH yet

### Secondary (MEDIUM confidence)
- https://blog.arcjet.com/testing-next-js-app-router-api-routes/ — NTARH usage for App Router route handlers; confirmed patterns match official NTARH docs
- https://micheleong.com/blog/testing-nextjs-14-and-supabase — `next/headers` mocking pattern for Supabase server client; verified approach aligns with vercel/next.js discussions
- https://www.iloveblogs.blog/guides/nextjs-supabase-testing-strategies — Teardown pattern; cleanup by tracked ID; FK ordering for deletes
- https://github.com/vercel/next.js/discussions/44270 — Official Next.js discussion confirming `next/headers` must be mocked in Jest

### Tertiary (LOW confidence)
- https://community.openai.com/t/testing-application-around-api-calls-with-jest-in-typescript/567809 — OpenAI mock pattern; single source, not officially documented but consistent with jest.mock behavior
- WebSearch findings on `--runInBand` for parallel Supabase test isolation — multiple community sources agree but no official Supabase doc on this

---

## Metadata

**Confidence breakdown:**
- Standard stack (Jest + NTARH): HIGH — Next.js official docs confirm Jest setup; NTARH GitHub confirmed for app router; installed packages verified
- Architecture patterns (mocking next/headers, next/navigation): HIGH — vercel/next.js official discussions confirm; multiple sources agree
- OpenAI mocking: MEDIUM — community patterns align with standard `jest.mock` behavior; no official OpenAI test guide
- Teardown ID tracking: MEDIUM — recommended by Supabase community and testing guides; pattern is straightforward Supabase JS SDK usage
- CI integration: LOW — not researched; environment-specific

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable ecosystem; NTARH tracks Next.js releases automatically)
