---
phase: 03-customer-management
plan: 04
subsystem: ui
tags: [next-intl, i18n, routing, navigation, locale]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "@/i18n/navigation locale-aware routing (createNavigation exports)"
  - phase: 03-customer-management
    provides: "CustomerTable, KaruteHistoryList, customer profile page components"
provides:
  - Locale-aware navigation in all three customer management components
  - CustomerTable row clicks navigate to locale-prefixed customer profiles
  - KaruteHistoryList row clicks navigate to locale-prefixed karute detail pages
  - Customer profile Back link navigates to locale-prefixed customer list
affects: [08-integration-testing]

# Tech tracking
tech-stack:
  added: []
  patterns: [useRouter and usePathname imported from @/i18n/navigation (not next/navigation) in all client components that navigate, Link imported as named export from @/i18n/navigation (not default from next/link)]

key-files:
  created: []
  modified:
    - src/components/customers/CustomerTable.tsx
    - src/components/customers/KaruteHistoryList.tsx
    - src/app/[locale]/(app)/customers/[id]/page.tsx

key-decisions:
  - "useSearchParams remains imported from next/navigation — createNavigation (next-intl) does not export useSearchParams"
  - "useRouter and usePathname from @/i18n/navigation used in all client components that navigate"
  - "Link from @/i18n/navigation is a named export, not a default export — import syntax is { Link } not Link"

patterns-established:
  - "Pattern: Client components that navigate must import useRouter/usePathname from @/i18n/navigation, not next/navigation"
  - "Pattern: Server components using Link import { Link } from @/i18n/navigation as named export"
  - "Pattern: useSearchParams is the only hook that stays from next/navigation — it is not part of createNavigation"

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 3 Plan 4: Customer Navigation Locale-Awareness Summary

**Locale-aware navigation gap closure: three customer components switched from next/navigation and next/link to @/i18n/navigation, ensuring all customer URLs include the active locale prefix (e.g., /en/customers/id).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-14
- **Completed:** 2026-03-14
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- CustomerTable.tsx now uses locale-aware useRouter and usePathname from @/i18n/navigation
- KaruteHistoryList.tsx now uses locale-aware useRouter and usePathname from @/i18n/navigation
- Customer profile page.tsx now uses locale-aware Link (named export) from @/i18n/navigation
- TypeScript passes cleanly with no type errors after all changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace next/navigation imports in CustomerTable and KaruteHistoryList** - `33a5909` (fix)
2. **Task 2: Replace next/link with @/i18n/navigation Link in customer profile page** - `318cc47` (fix)

## Files Created/Modified
- `src/components/customers/CustomerTable.tsx` - useRouter and usePathname now from @/i18n/navigation; useSearchParams stays from next/navigation
- `src/components/customers/KaruteHistoryList.tsx` - useRouter and usePathname now from @/i18n/navigation; useSearchParams stays from next/navigation
- `src/app/[locale]/(app)/customers/[id]/page.tsx` - Link now imported as named export from @/i18n/navigation (was default import from next/link)

## Decisions Made
- useSearchParams intentionally kept from next/navigation — createNavigation (next-intl) does not export it
- Link from @/i18n/navigation is a named export, import syntax changed from `import Link` to `import { Link }`
- href values ("/customers", "/customers/${id}", "/karute/${id}") left unchanged — locale-aware router/Link auto-prefixes with active locale

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three customer components now use locale-aware navigation
- Gap identified in 03-VERIFICATION.md is fully closed
- Phase 8 (Integration Testing) can test locale routing through customer management flows correctly

---
*Phase: 03-customer-management*
*Completed: 2026-03-14*
