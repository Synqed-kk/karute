---
phase: 05-staff-profiles
plan: "04"
subsystem: ui
tags: [supabase, postgrest, react, next-intl, karute, staff-attribution]

# Dependency graph
requires:
  - phase: 05-staff-profiles
    provides: "Staff profiles table, staff_profile_id FK written on karute save, getKaruteRecord query"
  - phase: 04-karute-records
    provides: "KaruteHeader component, KaruteHistoryList component, karute detail page"
provides:
  - "Profiles join on both karute queries (getKaruteRecord + customer page)"
  - "Staff name rendered in KaruteHeader detail view"
  - "Staff name rendered per row in KaruteHistoryList"
  - "Phase 5 Truth #3 fully satisfied — every karute record shows creating staff member's name"
affects: [08-integration-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PostgREST alias join: profiles:staff_profile_id ( id, full_name ) for staff name lookup"
    - "Type cast pattern for joined PostgREST relations: (karute as { profiles?: { full_name: string } | null }).profiles?.full_name"

key-files:
  created: []
  modified:
    - src/lib/supabase/karute.ts
    - src/components/karute/KaruteHeader.tsx
    - src/components/customers/KaruteHistoryList.tsx
    - src/app/[locale]/(app)/customers/[id]/page.tsx

key-decisions:
  - "Profiles join uses same PostgREST alias pattern as customers:client_id already in both queries"
  - "KaruteHeader uses type cast (same pattern as customerName) rather than modifying KaruteWithRelations explicitly — avoids ts errors from Supabase QueryData inference"
  - "KaruteHistoryList fallback uses t('profile.staff') — the label — when no profile is joined (consistent with existing empty state behavior)"

patterns-established:
  - "Gap closure plan: single-task plan targeting one verification truth with all required file changes"

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 5 Plan 04: Staff Attribution Display Summary

**PostgREST profiles join wired into both karute queries, rendering actual staff name in KaruteHeader detail view and KaruteHistoryList rows — closes Phase 5 Truth #3**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-14T00:00:00Z
- **Completed:** 2026-03-14T00:05:00Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Added `profiles:staff_profile_id ( id, full_name )` join to both `_karuteWithRelationsQuery` (type inference) and `getKaruteRecord()` runtime query in `karute.ts` — KaruteWithRelations type now includes profiles
- KaruteHeader now extracts `staffName` from joined profiles data and renders a staff section alongside customer and date
- KaruteHistoryList interface updated to include `profiles?: { full_name: string } | null`; placeholder comment removed; renders `record.profiles?.full_name` per row with fallback to `t('profile.staff')`
- Customer profile page query extended to include `profiles:staff_profile_id ( full_name )` join and type cast updated accordingly

## Task Commits

Each task was committed atomically:

1. **Task 1: Add profiles join to karute queries and render staff name in both display components** - `fd5dec0` (feat)

## Files Created/Modified

- `src/lib/supabase/karute.ts` - Added profiles:staff_profile_id join to both type-inference query and getKaruteRecord()
- `src/components/karute/KaruteHeader.tsx` - Extract staffName from profiles join, render staff section in header
- `src/components/customers/KaruteHistoryList.tsx` - Add profiles to KaruteRecord interface, replace placeholder with actual staff name
- `src/app/[locale]/(app)/customers/[id]/page.tsx` - Add profiles join to customer history query, update type cast

## Decisions Made

- Profiles join uses same PostgREST alias pattern (`profiles:staff_profile_id`) already established for `customers:client_id` — consistent approach throughout codebase
- KaruteHeader uses type cast pattern (matching existing `customerName` extraction) rather than extending the explicit type — avoids complications with Supabase QueryData inference
- Fallback in KaruteHistoryList uses `t('profile.staff')` (the label "Staff") when no profile is joined — consistent with the prior empty state, verified key exists in customers namespace

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 5 is now fully complete: all 3 truths verified (staff profiles, staff switcher, karute attribution)
- Phase 8 integration testing can now test staff attribution end-to-end

---
*Phase: 05-staff-profiles*
*Completed: 2026-03-14*
