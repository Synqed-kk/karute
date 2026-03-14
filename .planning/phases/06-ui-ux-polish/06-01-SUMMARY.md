---
phase: 06-ui-ux-polish
plan: "01"
subsystem: ui
tags: [next-themes, next-intl, tailwind-v4, dark-mode, oklch, fonts, inter, noto-sans-jp]

# Dependency graph
requires: []
provides:
  - ThemeProvider with class-based dark mode (next-themes, attribute="class", defaultTheme="dark")
  - Inter + Noto Sans JP fonts via next/font/google with CSS variable tokens
  - suppressHydrationWarning on html tag preventing theme flash
  - globals.css with Tailwind v4 @theme inline tokens and OKLCH dark mode values
  - Dashboard layout shell: outer bg-[#2a2a2a] p-3, content bg-[#3a3a3a] rounded-[28px]
  - next-intl v4 routing with defineRouting (en/ja locales)
  - Typed navigation layer via createNavigation (src/i18n/navigation.ts)
  - NextIntlClientProvider in [locale]/layout.tsx
affects:
  - 06-02-sidebar-topbar
  - 06-03-locale-toggle
  - 06-04-responsive

# Tech tracking
tech-stack:
  added: []
  patterns:
    - next-themes ThemeProvider in root layout (not locale layout) wrapping all routes
    - Tailwind v4 CSS-first: @custom-variant dark with .dark selector and OKLCH color values
    - next/font/google with CSS variable --font-inter and --font-noto-sans-jp chained in @theme inline
    - next-intl v4 defineRouting + createNavigation typed routing layer
    - Dashboard layout shell uses hardcoded hex (#2a2a2a, #3a3a3a) for layout shell, shadcn tokens for content

key-files:
  created:
    - src/components/providers/theme-provider.tsx
    - src/app/[locale]/layout.tsx
    - src/app/[locale]/(app)/layout.tsx
    - src/i18n/routing.ts
    - src/i18n/navigation.ts
  modified:
    - src/app/layout.tsx
    - src/app/globals.css

key-decisions:
  - "ThemeProvider placed in root layout (not [locale] layout) so dark mode works on login page and all routes"
  - "Noto Sans JP uses subsets=['latin'] only due to next.js type definitions not exposing 'japanese' subset — font still renders Japanese glyphs at runtime via unicode-range"
  - "Dashboard layout shell uses hardcoded hex values (#2a2a2a, #3a3a3a, #4a4a4a) matching reference app exactly"
  - "next-intl v4 routing and navigation layer created as prerequisite for [locale] layout"

patterns-established:
  - "Pattern: ThemeProvider always in root app/layout.tsx, never inside locale or app group layouts"
  - "Pattern: @custom-variant dark (&:where(.dark, .dark *)) enables class-based Tailwind v4 dark mode"
  - "Pattern: Layout shell uses bg-[#2a2a2a] outer / bg-[#3a3a3a] rounded-[28px] content area"

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 6 Plan 01: Visual Foundation Summary

**Dark theme infrastructure with class-based ThemeProvider, Inter + Noto Sans JP bilingual fonts, OKLCH tokens in globals.css, and reference-app dashboard shell (#2a2a2a outer / #3a3a3a rounded-[28px] content)**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-14T03:17:20Z
- **Completed:** 2026-03-14T03:21:39Z
- **Tasks:** 2
- **Files modified:** 7 (2 modified, 5 created)

## Accomplishments
- ThemeProvider with `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}` in root layout — dark mode loads with no flash
- Inter + Noto Sans JP fonts loaded via `next/font/google` with CSS variable tokens wired into Tailwind via `--font-sans`
- Dashboard layout shell matching reference app: padded outer wrapper (#2a2a2a dark), rounded content area (#3a3a3a dark / white light), sidebar and TopBar slots ready
- next-intl v4 routing infrastructure created (routing.ts + navigation.ts) enabling typed locale navigation

## Task Commits

Each task was committed atomically:

1. **Task 1: ThemeProvider, bilingual fonts, and root layout overhaul** - `97e1957` (feat)
2. **Task 2: Dark theme tokens and dashboard layout shell** - `fd2084a` (feat)

**Plan metadata:** (see final commit)

## Files Created/Modified
- `src/components/providers/theme-provider.tsx` - next-themes wrapper with class-based dark mode
- `src/app/layout.tsx` - Root layout with Inter/Noto Sans JP fonts, ThemeProvider, Toaster, suppressHydrationWarning
- `src/app/globals.css` - Fixed --font-sans to use Inter + Noto Sans JP font vars; already had OKLCH tokens and @custom-variant dark
- `src/app/[locale]/layout.tsx` - Locale layout wrapping children in NextIntlClientProvider
- `src/app/[locale]/(app)/layout.tsx` - Dashboard layout shell matching reference app structure
- `src/i18n/routing.ts` - next-intl defineRouting with en/ja locales
- `src/i18n/navigation.ts` - createNavigation typed navigation layer

## Decisions Made
- ThemeProvider placed in root layout, not inside `[locale]` layout, ensuring theme works on all routes including login
- Noto Sans JP `subsets: ['latin']` used because the installed next.js type definitions don't expose `'japanese'` as a valid subset value — Japanese glyphs still load at runtime via Google Fonts unicode-range subsetting
- Dashboard layout shell uses hardcoded hex values matching the reference app exactly, not shadcn token classes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created next-intl i18n routing infrastructure**
- **Found during:** Task 2 (locale layout creation)
- **Issue:** `[locale]/layout.tsx` requires `@/i18n/routing` import (`defineRouting`) and `NextIntlClientProvider` — neither file existed
- **Fix:** Created `src/i18n/routing.ts` and `src/i18n/navigation.ts` as blocking prerequisites
- **Files modified:** src/i18n/routing.ts, src/i18n/navigation.ts
- **Verification:** TypeScript type-check passes with no errors in new files
- **Committed in:** fd2084a (Task 2 commit)

**2. [Rule 1 - Bug] Fixed circular --font-sans reference in globals.css**
- **Found during:** Task 2 (globals.css update)
- **Issue:** globals.css had `--font-sans: var(--font-sans)` — a circular self-reference that would resolve to undefined
- **Fix:** Updated to `--font-sans: var(--font-inter), var(--font-noto-sans-jp), ui-sans-serif, system-ui` per research pattern
- **Files modified:** src/app/globals.css
- **Verification:** Font chain now correctly falls through from Inter to Noto Sans JP for Japanese glyphs
- **Committed in:** fd2084a (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- Noto Sans JP type definitions in Next.js 16.1.6 don't include `'japanese'` as a valid subset — used `['latin']` only, which is TypeScript-safe while still delivering Japanese glyph support at runtime

## Self-Check

Files created/modified:
- [x] `src/components/providers/theme-provider.tsx` exists
- [x] `src/app/layout.tsx` has suppressHydrationWarning, ThemeProvider, Noto_Sans_JP
- [x] `src/app/globals.css` has @custom-variant dark
- [x] `src/app/[locale]/(app)/layout.tsx` has bg-[#2a2a2a] and rounded-[28px]
- [x] `src/i18n/routing.ts` exists
- [x] `src/i18n/navigation.ts` exists

Commits:
- [x] 97e1957 — Task 1
- [x] fd2084a — Task 2

## Next Phase Readiness
- Dark theme foundation is complete — Plan 06-02 can now add Sidebar and TopBar components into the slot comments in `[locale]/(app)/layout.tsx`
- Typed navigation layer ready — Plan 06-03 locale toggle can import `useRouter`/`usePathname` from `@/i18n/navigation`
- Pre-existing TypeScript errors in backend files (actions/entries.ts, actions/staff.ts, etc.) are NOT caused by this plan — they predate Phase 06-01

---
*Phase: 06-ui-ux-polish*
*Completed: 2026-03-14*
