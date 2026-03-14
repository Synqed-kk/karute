---
phase: 08-integration-testing
plan: 03
subsystem: testing
tags: [jest, supabase, integration-tests, server-actions, teardown, core-flow]

# Dependency graph
requires:
  - phase: 08-01
    provides: Jest config, testSupabase client, teardownTestData helper, createTestProfile helper, server-action-mocks
  - phase: 03-customer-management
    provides: createCustomer server action, customers table
  - phase: 04-karute-records
    provides: saveKaruteRecord server action, karute_records and entries tables
provides:
  - Full end-to-end integration test: createCustomer -> saveKaruteRecord -> DB verification -> teardown
  - Explicit teardown verification as third test case (TEST-02 satisfied)
  - 15 integration tests across 4 suites all passing (08-02 + 08-03)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - jest.mock hoisting: all mocks declared before imports, mocking next/headers/cache/navigation and @/lib/supabase/server
    - Sequential test dependency: customerId captured in test 1, used in test 2 — tests ordered by data flow
    - Explicit teardown test case: teardown is test 3 (visible, reported, satisfies TEST-02 requirement directly)
    - Safety net afterAll: calls teardownTestData() again after test 3 — idempotent because arrays already cleared

key-files:
  created:
    - src/__tests__/integration/core-flow.test.ts
  modified: []

key-decisions:
  - "TEST_STAFF_PROFILE_ID must be a real auth user UUID — profiles.id is FK to auth.users.id, so random test UUID fails FK constraint"
  - "Test Supabase schema required 4 fixes vs production schema: auth user ID for profile FK, gen_random_uuid() defaults on customer_id columns, entries.title -> entries.content rename, category check constraint updated to match app categories"
  - "Teardown is test case 3 not just afterAll — makes teardown verification visible in test output and directly satisfies TEST-02"
  - "afterAll calls teardownTestData() again as safety net — idempotent since arrays are cleared by test 3"

patterns-established:
  - "Sequential test data sharing: declare variable before describe, capture in test 1, use in test 2"
  - "Snapshot IDs before teardown: copy arrays to local variables before teardownTestData() clears them, then query by those IDs"

# Metrics
duration: 30min
completed: 2026-03-14
---

# Phase 8 Plan 3: Core Flow Integration Test Summary

**Full end-to-end integration test against real Supabase: createCustomer + saveKaruteRecord with FK-verified entries + explicit teardown confirmation leaving 0 rows across all tables.**

## Performance

- **Duration:** ~30 min (including human verification and schema fixes)
- **Started:** 2026-03-14
- **Completed:** 2026-03-14
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 1

## Accomplishments

- Core flow integration test covers the full save path: customer creation, karute record insert, entries bulk insert with FK relationships, and teardown verification
- All 15 integration tests across 4 suites pass (08-02 AI route tests + 08-03 core flow tests)
- Teardown verification is an explicit test case — 0 rows remain in customers, karute_records, and entries after each run
- Tests are idempotent — second run produces identical results (verified by user)

## Task Commits

Each task was committed atomically:

1. **Task 1: Core flow integration test** - `61cf28f` (test)
2. **Schema fix: real auth user ID for test profile** - `bc9b5f5` (fix — user applied during verification)

## Files Created/Modified

- `src/__tests__/integration/core-flow.test.ts` — 164-line test: 3 test cases (create customer, save karute with entries, teardown verification), 4 jest.mock blocks, beforeAll profile setup, afterAll safety net

## Decisions Made

- `TEST_STAFF_PROFILE_ID` must match a real auth user UUID (`28318e68-6b73-46ed-a1a2-c21299deee3f`) — profiles.id has a FK to auth.users.id, so an arbitrary test UUID fails the constraint
- Teardown written as test case 3 rather than only in afterAll — makes it visible in test output and directly satisfies TEST-02's requirement for verifiable cleanup
- `afterAll` calls `teardownTestData()` a second time as a safety net — harmless because the arrays are already empty after test 3 runs

## Deviations from Plan

### Schema Fixes Applied During Human Verification

These were not code deviations but required fixes to the test Supabase schema to match the application's TypeScript types and server actions:

**1. profiles.id FK to auth.users**
- **Found during:** Task 2 (human verification)
- **Issue:** `TEST_STAFF_PROFILE_ID` was a fabricated UUID; profiles.id is a FK to auth.users.id — insert failed with FK constraint violation
- **Fix:** Updated to use the real auth user UUID (`28318e68-6b73-46ed-a1a2-c21299deee3f`) present in the test Supabase project
- **Committed in:** `bc9b5f5`

**2. customer_id columns missing DEFAULT**
- **Found during:** Task 2 (human verification)
- **Issue:** Some tables had `customer_id` columns without `DEFAULT gen_random_uuid()` — server actions don't set this field
- **Fix:** Added `DEFAULT gen_random_uuid()` to affected columns via migration on test project

**3. entries.title -> entries.content**
- **Found during:** Task 2 (human verification)
- **Issue:** Test Supabase schema had column named `title`; TypeScript types and server actions use `content`
- **Fix:** Renamed column to `content` via migration on test project

**4. entries category CHECK constraint**
- **Found during:** Task 2 (human verification)
- **Issue:** CHECK constraint listed different category values than the app's `EntryCategory` type (`symptom`, `treatment`, `body_area`, `preference`, `lifestyle`, `next_visit`, `product`, `other`)
- **Fix:** Updated CHECK constraint to match `ENTRY_CATEGORIES` values from `src/lib/karute/categories.ts`

---

**Total deviations:** 4 schema fixes (all applied to test Supabase project during human verification)
**Impact on plan:** Schema fixes were necessary for FK correctness and type alignment. Test code itself executed exactly as written.

## Issues Encountered

Test Supabase project schema diverged from production schema in 4 places. All were resolved by the user during the human-verify checkpoint by applying corrective SQL migrations to the test project. No changes were required to the test code.

## User Setup Required

**Schema fixes applied to test Supabase project (not code changes):**
- profiles.id FK to auth.users requires real auth user UUID in TEST_STAFF_PROFILE_ID
- customer_id columns need `DEFAULT gen_random_uuid()`
- entries column: `title` renamed to `content`
- entries category CHECK constraint updated to match app categories

## Next Phase Readiness

- Integration test suite is complete: TEST-01 (AI routes mocked with NTARH) and TEST-02 (teardown with 0 rows) both satisfied
- `npm run test:integration` runs all 15 tests in 4 suites sequentially with a single command
- Phase 8 is fully complete — all 3 plans executed

## Self-Check: PASSED

- FOUND: `src/__tests__/integration/core-flow.test.ts` (164 lines, above 80-line minimum)
- FOUND: commit `61cf28f` (Task 1)
- FOUND: commit `bc9b5f5` (schema fix during verification)
- Import patterns verified:
  - `import.*createCustomer.*from.*actions/customers` — present on line 28
  - `import.*saveKaruteRecord.*from.*actions/karute` — present on line 29
  - `import.*testSupabase.*teardownTestData.*from.*helpers/supabase` — present on line 1

---
*Phase: 08-integration-testing*
*Completed: 2026-03-14*
