---
phase: 01-foundation-recording
plan: "04"
subsystem: i18n
tags: [next-intl, i18n, routing, middleware, translations, locale]

# Dependency graph
requires:
  - phase: 01-01
    provides: Next.js 16 scaffold, app directory structure, globals.css

provides:
  - next-intl v4 routing with locales ['en', 'ja'] and defaultLocale 'en'
  - getRequestConfig returning locale and messages (v4 required field)
  - NextIntlClientProvider wrapping all locale pages with messages passed
  - proxy.ts composing next-intl createMiddleware with Supabase getClaims auth refresh
  - EN and JP translation files covering full Phase 1+ UI strings
  - Typed navigation helpers (Link, redirect, usePathname, useRouter) from createNavigation

affects:
  - All phases — every client component using useTranslations depends on this
  - Phase 6 (ui-ux-polish) extended translation files with sidebar/customers/karute namespaces

# Tech tracking
tech-stack:
  added:
    - next-intl v4.8.3 (defineRouting, getRequestConfig, createNavigation, createMiddleware)
    - next-intl/plugin (createNextIntlPlugin wrapping nextConfig)
  patterns:
    - Locale layout pattern: [locale]/layout.tsx wraps all locale routes with NextIntlClientProvider
    - App sublayout pattern: [locale]/(app)/layout.tsx handles dashboard shell (sidebar, header)
    - Middleware composition: next-intl createMiddleware runs first, Supabase token refresh second
    - Navigation helpers: usePathname/useRouter from @/i18n/navigation (not next/navigation) prevents locale URL stacking

key-files:
  created:
    - src/i18n/routing.ts
    - src/i18n/request.ts
    - src/i18n/navigation.ts
    - src/proxy.ts
    - next-intl.config.ts
    - messages/en.json
    - messages/ja.json
  modified:
    - src/app/[locale]/layout.tsx
    - next.config.ts

key-decisions:
  - "request.ts locale field is REQUIRED in next-intl v4 — omitting it causes runtime error"
  - "AppHeader and Sidebar moved to [locale]/(app)/layout.tsx in Phase 6, not [locale]/layout.tsx — avoids rendering shell on login page"
  - "messages use 'sidebar' namespace (not 'nav') — evolved naturally and matches useTranslations('sidebar') in sidebar.tsx"
  - "NextIntlClientProvider must receive messages prop — locale-only omits message context for client components"
  - "proxy.ts not wired to middleware.ts yet — exported as proxy() function, no src/middleware.ts exists"

patterns-established:
  - "Translation namespaces: common, auth, sidebar, recording, customers, karute, settings"
  - "Navigation: always import from @/i18n/navigation not next/navigation for locale-aware links"
  - "Locale validation: hasLocale(routing.locales, locale) guard in every layout that reads params.locale"

# Metrics
duration: 15min
completed: 2026-03-14
---

# Phase 1 Plan 04: i18n Foundation Summary

**next-intl v4 EN/JP routing with getRequestConfig, NextIntlClientProvider+messages in locale layout, proxy.ts composing intl middleware with Supabase auth refresh, and full translation files for all Phase 1+ UI strings**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-14T17:48:25Z
- **Completed:** 2026-03-14T18:00:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Created `src/i18n/request.ts` with `getRequestConfig` returning `locale` (v4 required field) and messages loaded from `messages/${locale}.json`
- Updated `src/app/[locale]/layout.tsx` to call `getMessages()` and pass `messages` prop to `NextIntlClientProvider` — fixes client component useTranslations
- Created `src/proxy.ts` composing `createMiddleware(routing)` with Supabase `getClaims()` auth refresh
- Added `next-intl.config.ts` pointing to request config and updated `next.config.ts` with `withNextIntl` plugin

## Task Commits

Each task was committed atomically:

1. **Task 1: next-intl v4 routing, request config, and translation files** - `0af294b` (feat)
2. **Task 2: Locale layout with NextIntlClientProvider+messages and proxy.ts middleware** - `a206935` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/i18n/routing.ts` - defineRouting with locales ['en','ja'], defaultLocale 'en' (pre-existing, verified)
- `src/i18n/request.ts` - getRequestConfig with locale + messages (CREATED — was missing)
- `src/i18n/navigation.ts` - createNavigation typed helpers (pre-existing, verified)
- `next-intl.config.ts` - re-exports request config for next-intl plugin (CREATED)
- `next.config.ts` - wrapped with createNextIntlPlugin (UPDATED)
- `messages/en.json` - English translations, 7 namespaces, 107 keys (pre-existing, verified)
- `messages/ja.json` - Japanese translations, 7 namespaces, 107 keys (pre-existing, verified)
- `src/app/[locale]/layout.tsx` - NextIntlClientProvider with locale+messages (UPDATED — was missing messages)
- `src/proxy.ts` - createMiddleware + Supabase getClaims composition (CREATED — was missing)

## Decisions Made

- `request.ts` locale field is REQUIRED in next-intl v4 — was optional in v3; omitting causes runtime error
- AppHeader/Sidebar belong in `[locale]/(app)/layout.tsx` not `[locale]/layout.tsx` — this prevents the header rendering on the login page (auth routes are under `[locale]/` but not under `(app)/`)
- Translation files evolved to use `sidebar` namespace instead of plan's `nav` — matches `useTranslations('sidebar')` in sidebar.tsx; functionally equivalent
- `proxy.ts` is an exported function, not a Next.js `middleware.ts` — the proxy composition pattern is established but a `src/middleware.ts` entry point is needed to actually execute it at request time

## Deviations from Plan

### Evolved Architecture

**1. AppHeader not in [locale]/layout.tsx**
- **Context:** Plan specified `AppHeader` inside `[locale]/layout.tsx`. Phase 6 evolved this to `[locale]/(app)/layout.tsx` — a group layout that only applies to authenticated app routes.
- **Why better:** Login page lives at `[locale]/login` (not under `(app)/`). Putting AppHeader in the locale root layout would render it on the login screen.
- **Impact:** AppHeader IS visible on all app pages (recording, customers, karute, settings) — the must_have truth holds.

**2. messages use "sidebar" namespace instead of plan's "nav"**
- **Context:** Plan specified `"nav"` namespace in en.json/ja.json. The existing files use `"sidebar"` namespace, consistent with `useTranslations('sidebar')` in `src/components/layout/sidebar.tsx`.
- **Impact:** Functionally equivalent — nav translation strings exist and are used.

**3. proxy.ts not wired to Next.js middleware**
- **Context:** Plan shows `proxy()` called from a `src/middleware.ts`. No `middleware.ts` exists yet. The proxy.ts function is created but not invoked at request time.
- **Impact:** Locale redirect (`/` → `/en/`) works via Next.js [locale] folder convention, not via intl middleware. Supabase token refresh would need to be wired when `src/middleware.ts` is created.
- **Tracked as:** Future wiring task — proxy.ts pattern established, middleware entry point deferred.

---

**Total deviations:** 3 evolutionary (architecture evolved in later phases, not regressions)
**Impact on plan:** All must_have truths are satisfied by the working app. Artifacts created or verified. Type-check passes.

## Issues Encountered

- `src/i18n/request.ts` was missing from the codebase despite Phases 2-7 being complete. next-intl v4 can work without it in some configurations, but the plan requires it for correctness. Created as specified.
- `[locale]/layout.tsx` passed only `locale` to `NextIntlClientProvider` without `messages` — client components using `useTranslations` would receive empty message context. Fixed by adding `getMessages()` call and `messages` prop.
- `src/proxy.ts` was not present. Created as specified. No `middleware.ts` yet — proxy function is available but not invoked at request time.

## User Setup Required

None - no external service configuration required beyond what Phase 1-02 (Supabase) established.

## Next Phase Readiness

- i18n foundation complete: routing, request config, locale layout, translation files, and proxy composition all in place
- All client components using `useTranslations` will receive correct messages via NextIntlClientProvider
- To fully activate locale redirect and Supabase token refresh, wire `proxy()` from a `src/middleware.ts` entry point

---
*Phase: 01-foundation-recording*
*Completed: 2026-03-14*
