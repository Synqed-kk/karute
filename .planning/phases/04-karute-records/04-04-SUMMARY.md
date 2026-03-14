---
phase: 04-karute-records
plan: 04
subsystem: ui
tags: [react, next-js, typescript, sessionStorage, server-components, next-intl]

# Dependency graph
requires:
  - phase: 04-03
    provides: saveDraft/loadDraft/clearDraft helpers, SaveKaruteFlow component
  - phase: 04-02
    provides: karute detail view at /karute/[id]
provides:
  - ReviewConfirmStep component: calls saveDraft() on mount and renders SaveKaruteFlow inline
  - Placeholder review page at /[locale]/(app)/review: server component with pre-fetched customers
  - KaruteListItem component: card-style row with customer name, date, entry count, summary preview
  - Karute list page at /[locale]/(app)/karute: server component listing all saved records
affects:
  - 02-ai-pipeline (ReviewConfirmStep integrates into Phase 2 review screen to bridge AI output to save flow)
  - sidebar navigation (already had /karute entry — confirmed working)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useRef draftSavedRef guard — prevents saveDraft() from being called multiple times on re-renders
    - PostgREST nested select (customers:client_id alias) for karute list with entry count in one query
    - (record as unknown as {...}).customers cast for PostgREST aliased FK joins where TypeScript inference doesn't reflect the alias

key-files:
  created:
    - src/components/review/ReviewConfirmStep.tsx
    - src/app/[locale]/(app)/review/page.tsx
    - src/app/[locale]/(app)/karute/page.tsx
    - src/components/karute/KaruteListItem.tsx

key-decisions:
  - "ReviewConfirmStep uses useRef draftSavedRef to guard saveDraft() — prevents sessionStorage being overwritten on re-renders without requiring useEffect deps changes"
  - "Review page placeholder renders SaveKaruteFlow directly (not ReviewConfirmStep) — draft is already in sessionStorage; ReviewConfirmStep is for Phase 2 in-memory data handoff"
  - "KaruteListItem receives locale as prop for date formatting — server component, no useLocale hook available"
  - "customers:client_id PostgREST alias returns single object in karute list query — cast as unknown first to avoid TypeScript overlap error"

patterns-established:
  - "Pattern: useRef guard for one-time side effects — use a ref flag instead of state to prevent useEffect re-runs when the side effect should only run once"

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 4 Plan 04: Integration + Karute List Page Summary

**ReviewConfirmStep wiring saveDraft() and rendering SaveKaruteFlow inline after AI review confirm + placeholder review page at /review + karute list page at /karute showing all saved records with customer name, date, and entry count**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-14T17:33:03Z
- **Completed:** 2026-03-14T17:36:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `ReviewConfirmStep` component: called `saveDraft()` on mount with field mapping (`title→content`, `source_quote→sourceQuote`, `confidence_score→confidenceScore`), renders `SaveKaruteFlow` inline — no page nav, no confirmation dialog
- Created placeholder `review` page at `/[locale]/(app)/review`: server component, pre-fetches customer list, renders `SaveKaruteFlow` directly (reads existing sessionStorage draft). Includes TODO comment for Phase 2 full UI integration.
- Created `KaruteListItem`: card-style link component showing customer name, locale-formatted date, entry count, 80-char summary preview; links to `/[locale]/karute/[id]`
- Created karute list page at `/[locale]/(app)/karute`: server component fetching all `karute_records` with nested PostgREST select (`customers:client_id`, `entries`) ordered by `created_at` desc; shows empty state when no records exist

## Task Commits

1. **Task 1: Wire AI review screen confirm step to SaveKaruteFlow** - `ac8ea09` (feat)
2. **Task 2: Create karute list page for browsing past records** - `1dbbd69` (feat)

**Plan metadata:** (see final commit)

## Files Created/Modified

- `src/components/review/ReviewConfirmStep.tsx` - Entry field mapping + saveDraft() on mount + SaveKaruteFlow inline render
- `src/app/[locale]/(app)/review/page.tsx` - Placeholder review page; pre-fetches customers; renders SaveKaruteFlow with TODO for Phase 2 integration
- `src/app/[locale]/(app)/karute/page.tsx` - Karute list server page with PostgREST nested select, descending order, empty state
- `src/components/karute/KaruteListItem.tsx` - Card row component with locale-aware date formatting, 80-char summary preview

## Decisions Made

- **useRef draftSavedRef guard:** `saveDraft()` runs inside `useEffect` with full dependencies listed (transcript, summary, entries, duration). A `useRef` flag prevents the effect from writing to sessionStorage on subsequent re-renders that fire the effect again. This is safer than using `[]` deps (which would close over stale values on mount).

- **Review placeholder renders SaveKaruteFlow directly:** `ReviewConfirmStep` is designed for the Phase 2 in-memory flow where transcript/entries are already available as React state. The placeholder `/review` page skips it and renders `SaveKaruteFlow` directly — `SaveKaruteFlow` reads the draft from sessionStorage by itself, which is correct for the standalone test-the-save-flow use case.

- **KaruteListItem receives locale as prop:** It's a server component with no `useLocale` hook. The locale comes from page `params` and is passed down.

- **`customers` PostgREST alias type cast:** The `customers:client_id` alias in the select string makes Supabase's QueryData infer the field as a single object, but TypeScript sees it as an ambiguous type. Using `(record as unknown as {...}).customers` resolves the type overlap error cleanly without an `any` cast.

## Deviations from Plan

None — plan executed exactly as written. Sidebar already had the `/karute` nav entry from Plan 06-02 so no nav config changes were needed.

## Issues Encountered

One TypeScript error on the karute list page: the `customers` PostgREST alias returned by Supabase QueryData was typed as a single object but the initial cast used an Array type, causing a TS2352 "neither type sufficiently overlaps" error. Fixed by removing the Array branch and casting directly to the single-object type.

## Next Phase Readiness

- All four Phase 4 requirements (KRT-01 through KRT-04) are now satisfied:
  - KRT-01: saveKaruteRecord Server Action (04-01)
  - KRT-02: Karute detail view at /karute/[id] (04-02)
  - KRT-03: End-to-end flow review→save→detail (04-04, this plan)
  - KRT-04: Karute list page at /karute (04-04, this plan)
- Phase 2 AI pipeline integration: when Phase 2 is built, `ReviewConfirmStep` can be dropped directly into the Phase 2 review screen's `onConfirm` handler
- Phase 6 (UI/UX polish): `KaruteListItem` and the review page are candidates for visual refinement

---
*Phase: 04-karute-records*
*Completed: 2026-03-14*
