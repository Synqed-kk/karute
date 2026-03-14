---
phase: 06-ui-ux-polish
plan: "02"
subsystem: layout-navigation
tags: [sidebar, locale-toggle, theme-toggle, top-bar, next-intl, next-themes]
dependency_graph:
  requires: [06-01]
  provides: [custom-sidebar, locale-toggle, theme-toggle, top-bar]
  affects: [dashboard-layout, all-app-pages]
tech_stack:
  added: []
  patterns:
    - Custom 90px icon sidebar (no shadcn Sidebar primitive)
    - pathname.startsWith for active route detection
    - router.replace from @/i18n/navigation for locale switching (prevents URL stacking bug)
    - useTheme from next-themes for light/dark toggle
key_files:
  created:
    - src/components/layout/sidebar.tsx
    - src/components/layout/locale-toggle.tsx
    - src/components/layout/theme-toggle.tsx
    - src/components/layout/top-bar.tsx
  modified:
    - src/app/[locale]/(app)/layout.tsx
    - messages/en.json
    - messages/ja.json
decisions:
  - Custom sidebar (not shadcn Sidebar primitive) matching reference app exactly at 90px width
  - usePathname and useRouter imported from @/i18n/navigation (not next/navigation) to prevent locale stacking
  - sidebar namespace added to both en.json and ja.json for translated labels
metrics:
  duration: "~5 min"
  completed: "2026-03-14"
  tasks_completed: 2
  files_created: 4
  files_modified: 3
---

# Phase 6 Plan 02: Sidebar Navigation and TopBar Summary

**One-liner:** Custom 90px icon sidebar with active state + EN/JP locale toggle using next-intl typed navigation, wired into the dashboard layout shell.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Custom sidebar with icon navigation and active state | 965f485 | sidebar.tsx, en.json, ja.json |
| 2 | TopBar with locale toggle and theme toggle | 184a5dd | locale-toggle.tsx, theme-toggle.tsx, top-bar.tsx, (app)/layout.tsx |

## What Was Built

### Custom Sidebar (`src/components/layout/sidebar.tsx`)
- Fixed 90px width, `bg-[#4a4a4a]`, `rounded-[28px]`, full height
- 4 navigation items: Recording (/sessions), Customers (/customers), Karute (/karute), Settings (/settings)
- Active detection via `pathname.startsWith(href)` using `usePathname` from `@/i18n/navigation`
- Active item: `text-white`, inactive: `text-white/60 hover:text-white/90`
- Inline SVG icons (Mic, Users, Clipboard, Settings) — no icon library dependency
- Touch-friendly: `min-h-[44px] min-w-[44px]` on all nav links
- Labels below icons using `t('sidebar.{key}')` with `useTranslations('sidebar')`

### Locale Toggle (`src/components/layout/locale-toggle.tsx`)
- Reads current locale via `useLocale()` from next-intl
- Switches locale via `router.replace(pathname, { locale: next })` using imports from `@/i18n/navigation`
- Displays "EN" when English, "JP" when Japanese
- Prevents locale stacking bug by using typed navigation layer (not `next/navigation`)

### Theme Toggle (`src/components/layout/theme-toggle.tsx`)
- Toggles between 'light' and 'dark' via `setTheme()` from `useTheme` (next-themes)
- Shows Sun icon in dark mode (click to go light), Moon icon in light mode (click to go dark)
- Inline SVG icons — no icon library dependency

### TopBar (`src/components/layout/top-bar.tsx`)
- Horizontal flex container with ThemeToggle and LocaleToggle
- StaffSwitcher placeholder comment (wired in 05-03)

### Dashboard Layout Update
- Replaced slot comments with actual `<Sidebar />` and `<TopBar />` components

### Translation Keys Added
Both `en.json` and `ja.json` now have `sidebar` namespace:
- `sidebar.recording`, `sidebar.customers`, `sidebar.karute`, `sidebar.settings`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSX namespace type error in sidebar**
- **Found during:** Task 1 verification (type-check)
- **Issue:** `icon: () => JSX.Element` caused `Cannot find namespace 'JSX'` in strict mode
- **Fix:** Changed to `icon: () => React.ReactElement` and added `import React from 'react'`
- **Files modified:** src/components/layout/sidebar.tsx
- **Commit:** 965f485

## Self-Check: PASSED

Files exist:
- FOUND: src/components/layout/sidebar.tsx
- FOUND: src/components/layout/locale-toggle.tsx
- FOUND: src/components/layout/theme-toggle.tsx
- FOUND: src/components/layout/top-bar.tsx

Commits exist:
- FOUND: 965f485 (feat(06-02): custom 90px icon sidebar)
- FOUND: 184a5dd (feat(06-02): TopBar with locale toggle)

Type check: PASSED (0 errors)
