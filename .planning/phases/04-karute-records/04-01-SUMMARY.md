---
phase: 04-karute-records
plan: 01
subsystem: database
tags: [supabase, typescript, server-actions, next-js, postgrest]

# Dependency graph
requires: []
provides:
  - ENTRY_CATEGORIES const (8 categories: Symptom/Treatment/Body Area/Preference/Lifestyle/Next Visit/Product/Other) with label, labelJa, color fields
  - getCategoryConfig() helper with Other fallback for unknown category strings
  - EntryCategory, KaruteRecord, Entry, SaveKaruteInput, AddEntryInput TypeScript types
  - saveKaruteRecord Server Action with sequential insert + orphan cleanup + redirect outside try/catch
  - addManualEntry Server Action with is_manual=true insert
  - deleteEntry Server Action
  - getKaruteRecord query helper with nested PostgREST select (customers + entries) ordered by created_at asc
  - KaruteWithRelations inferred type via QueryData
  - Database type in Supabase CLI format (explicit Insert/Update fields, Relationships arrays)
affects:
  - 04-02 (karute detail view — consumes KaruteWithRelations, ENTRY_CATEGORIES, getCategoryConfig)
  - 04-03 (save flow — consumes saveKaruteRecord)
  - 02-ai-pipeline (can import ENTRY_CATEGORIES to constrain GPT extraction category enum)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Supabase nested select with PostgREST (karute_records + customers + entries in one query)
    - Sequential Server Action inserts with cleanup on failure (orphan prevention)
    - redirect() called outside try/catch block (Next.js 16 pattern)
    - await createClient() in all Server Actions and query helpers
    - QueryData<typeof query> for type-safe nested Supabase returns

key-files:
  created:
    - src/lib/karute/categories.ts
    - src/types/karute.ts
    - src/actions/karute.ts
    - src/actions/entries.ts
    - src/lib/supabase/karute.ts
  modified:
    - src/types/database.ts

key-decisions:
  - "Database type uses Supabase CLI format (explicit Insert/Update, not Omit<Row>) because Omit<> caused GenericTable constraint to resolve Insert as never in Supabase 2.99+"
  - "staffId falls back to first profiles row with TODO comment pending Phase 5 staff switcher"
  - "getKaruteRecord returns null (not throws) on PGRST116 so page can call notFound()"

patterns-established:
  - "Pattern: await createClient() — createClient() is async in this project; all server-side Supabase calls must await it"
  - "Pattern: redirect() outside try/catch — redirect() throws internally and is caught by try/catch; always call it after the catch block"
  - "Pattern: Supabase Database type in CLI format — use [_ in never]: never for empty Views/Functions/Enums/CompositeTypes"

# Metrics
duration: 9min
completed: 2026-03-14
---

# Phase 4 Plan 01: Karute Records Data Layer Summary

**ENTRY_CATEGORIES constant (8 categories, labeled, bilingual, color-coded) + SaveKaruteRecord/addManualEntry Server Actions with sequential-insert cleanup pattern + getKaruteRecord PostgREST nested query**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-14T03:16:44Z
- **Completed:** 2026-03-14T03:26:23Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created `ENTRY_CATEGORIES` constant with all 8 user-specified categories (Symptom red, Treatment blue, Body Area purple, Preference amber, Lifestyle green, Next Visit cyan, Product pink, Other gray), each with value/label/labelJa/color fields and a `getCategoryConfig()` helper
- Implemented `saveKaruteRecord` Server Action with sequential insert pattern: karute_record first → entries bulk-insert → orphan cleanup on failure → redirect outside try/catch
- Implemented `getKaruteRecord` with PostgREST nested select fetching customers and entries in one query, entries ordered by created_at ascending, PGRST116 null handling for notFound()
- Fixed Database type to Supabase CLI format resolving a project-wide TypeScript error where all `.insert()` calls resolved to `never`

## Task Commits

1. **Task 1: Create entry category constants and karute types** - `90abe33` (feat)
2. **Task 2: Create Server Actions and query helpers** - `153024c` (feat)

**Plan metadata:** (see final commit)

## Files Created/Modified

- `src/lib/karute/categories.ts` - ENTRY_CATEGORIES const (8 categories) + getCategoryConfig() + EntryCategory type
- `src/types/karute.ts` - KaruteRecord, Entry, SaveKaruteInput, AddEntryInput types
- `src/actions/karute.ts` - saveKaruteRecord Server Action
- `src/actions/entries.ts` - addManualEntry and deleteEntry Server Actions
- `src/lib/supabase/karute.ts` - getKaruteRecord query helper with KaruteWithRelations type
- `src/types/database.ts` - Rewritten to Supabase CLI format with explicit Insert/Update fields

## Decisions Made

- Database type reformatted to Supabase CLI format — the previous `Omit<Row, 'id'|'created_at'>` pattern for Insert types caused Supabase 2.99's `GenericTable` constraint to resolve all Insert types as `never`, breaking every `.insert()` call project-wide. Explicit Insert field objects fix this.
- `staffId` falls back to first `profiles` row query when not provided, with a TODO comment for Phase 5 staff switcher wiring.
- `getKaruteRecord` returns `null` (not throws) on PGRST116 (no rows found) so the caller page can call `notFound()` cleanly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Database type Omit<> pattern caused all .insert() calls to resolve as never**
- **Found during:** Task 2 (TypeScript verification)
- **Issue:** `Omit<Row, 'id' | 'created_at'>` for Insert type does not satisfy Supabase 2.99's `GenericTable` constraint (requires `Views: { [_ in never]: never }` format, explicit Insert/Update objects). All inserts across `karute.ts`, `entries.ts`, `customers.ts`, and `staff.ts` reported TS2769 with `values: never`.
- **Fix:** Rewrote `database.ts` to match Supabase CLI generated format — explicit Insert/Update type objects, `[_ in never]: never` for Views/Functions/Enums/CompositeTypes.
- **Files modified:** `src/types/database.ts`
- **Verification:** `npm run type-check` passes with zero errors
- **Committed in:** `153024c` (Task 2 commit)

**2. [Rule 1 - Bug] PDF export route had JSX in a .ts file**
- **Found during:** Task 2 (TypeScript verification)
- **Issue:** `src/app/api/karute/[id]/export/pdf/route.ts` contained `<KarutePdfDocument />` JSX but had a `.ts` extension. TypeScript reported syntax errors on the JSX angle brackets.
- **Fix:** Renamed file to `route.tsx`.
- **Files modified:** `src/app/api/karute/[id]/export/pdf/route.tsx`
- **Verification:** TypeScript compilation passes
- **Committed in:** `153024c` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes necessary for TypeScript compilation. No scope creep — database type fix restored what Supabase 2.99 requires; JSX extension fix is trivial. No architectural changes.

## Issues Encountered

The project had an "initial commit" (`97277c4`) that contained scaffold versions of the Task 2 files (`src/actions/karute.ts`, `src/actions/entries.ts`, `src/lib/supabase/karute.ts`) already in the correct state. The Task 1 commit created the missing categories and types files. Task 2 execution focused on fixing the Database type and TypeScript compilation issues found during verification.

## Next Phase Readiness

- Data layer is complete: ENTRY_CATEGORIES, types, Server Actions, and query helpers all exist and compile
- Phase 4 Plan 02 (karute detail view) can consume `getKaruteRecord`, `KaruteWithRelations`, `ENTRY_CATEGORIES`, and `getCategoryConfig`
- Phase 4 Plan 03 (save flow) can consume `saveKaruteRecord`
- Phase 2 AI pipeline can import `ENTRY_CATEGORIES` to constrain GPT extraction output to valid category values

---
*Phase: 04-karute-records*
*Completed: 2026-03-14*
