---
phase: 07-export
plan: 01
subsystem: api
tags: [react-pdf, pdf-generation, japanese-fonts, noto-sans-jp, file-download]

# Dependency graph
requires:
  - phase: 04-karute-records
    provides: "getKaruteRecord query helper and KaruteWithRelations type"
  - phase: 01-foundation-recording
    provides: "createClient Supabase server client for auth checks"

provides:
  - "@react-pdf/renderer PDF document component with NotoSansJP font embedding"
  - "GET /api/karute/[id]/export/pdf — authenticated PDF download route"
  - "Noto Sans JP Regular and Bold TTF files in public/fonts/"

affects:
  - "07-02-export-text: ExportButtons component will add links to this PDF route"
  - "08-integration-testing: PDF route needs auth verification test coverage"

# Tech tracking
tech-stack:
  added:
    - "@react-pdf/renderer@4.3.2 — PDF generation with React component model"
    - "Noto Sans JP Regular TTF (5.1MB) from Google Fonts CDN"
    - "Noto Sans JP Bold TTF (5.1MB) from Google Fonts CDN"
  patterns:
    - "PDF document component: NO 'use client', Font.register at module level, pure data-in/PDF-out"
    - "Node.js stream to Web ReadableStream conversion for streaming PDF response"
    - "export const runtime = 'nodejs' required for file system access in route handlers"
    - "React.createElement instead of JSX in .tsx route files to avoid cast issues"

key-files:
  created:
    - "src/components/karute/KarutePdfDocument.tsx — react-pdf Document with NotoSansJP font"
    - "src/app/api/karute/[id]/export/pdf/route.tsx — GET handler with auth, fetch, stream"
    - "public/fonts/NotoSansJP-Regular.ttf — 5.1MB static weight TTF for PDF rendering"
    - "public/fonts/NotoSansJP-Bold.ttf — 5.1MB static weight TTF for PDF rendering"
  modified:
    - "package.json — added @react-pdf/renderer dependency"
    - "src/lib/supabase/karute.ts — updated to use actual schema columns (client_id, staff_profile_id, session_date)"

key-decisions:
  - "Download static weight TTFs from Google Fonts CDN (gstatic.com) because GitHub repo only has variable font"
  - "Use React.createElement in route.tsx to avoid JSX-in-.tsx cast complexity"
  - "Cast customers relation to any — PostgREST alias (customers:client_id) confuses QueryData type inference"
  - "Font files committed to repo at ~10MB total (acceptable for specialized feature)"

patterns-established:
  - "PDF route pattern: export const runtime = 'nodejs', auth check, fetch, renderToStream, ReadableStream wrapper"
  - "Font registration: always at module level, absolute path via process.cwd()"

# Metrics
duration: 17min
completed: 2026-03-14
---

# Phase 7 Plan 01: PDF Export Summary

**@react-pdf/renderer PDF route with Noto Sans JP font embedding — GET /api/karute/[id]/export/pdf returns authenticated, downloadable karute PDF with Japanese character support**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-14T03:17:00Z
- **Completed:** 2026-03-14T03:34:00Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments

- Installed `@react-pdf/renderer@4.3.2` and downloaded Noto Sans JP Regular and Bold static TTFs (~5.1MB each) from Google Fonts CDN
- Created `KarutePdfDocument.tsx` — A4 page layout with Font.register at module level, NotoSansJP font family, sections for AI summary, categorized entries, and transcript
- Created PDF route handler at `/api/karute/[id]/export/pdf` with auth check (401), karute fetch (404), renderToStream, Node-to-Web stream conversion, and download headers
- TypeScript passes clean — all type errors from database schema mismatches resolved

## Task Commits

1. **Task 1: Install @react-pdf/renderer and add Noto Sans JP font files** - `1fb667b` (chore)
2. **Task 2: KarutePdfDocument and PDF route** - committed across `153024c`, `184a5dd`, `d764490` (feat/fix)

## Files Created/Modified

- `public/fonts/NotoSansJP-Regular.ttf` — Static weight Noto Sans JP Regular (5.1MB) for PDF Japanese rendering
- `public/fonts/NotoSansJP-Bold.ttf` — Static weight Noto Sans JP Bold (5.1MB) for PDF Japanese rendering
- `src/components/karute/KarutePdfDocument.tsx` — react-pdf Document component with NotoSansJP, A4 layout, customer name/date/summary/entries/transcript
- `src/app/api/karute/[id]/export/pdf/route.tsx` — GET route with auth (401), fetch (404), renderToStream, Content-Disposition attachment
- `package.json` — @react-pdf/renderer@^4.3.2 added to dependencies

## Decisions Made

- **Google Fonts CDN for TTFs:** The Google Fonts GitHub repo no longer has static weight TTFs in a `static/` subfolder — only the variable font. Downloaded directly from `fonts.gstatic.com` API URLs obtained from the Google Fonts CSS API.
- **React.createElement instead of JSX:** Route file has `.tsx` extension; used `React.createElement(KarutePdfDocument, { karute })` with a `DocumentProps` cast to satisfy renderToStream's type signature without JSX.
- **Fonts committed to repo:** ~10MB is acceptable for this specialized feature; no `.gitignore` exclusion added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed KaruteWithRelations resolving to `never` due to schema column name mismatch**
- **Found during:** Task 2 (PDF component creation, TypeScript verification)
- **Issue:** `karute.ts` was querying columns `staff_id`, `customer_id` (action-layer names) but `database.ts` defines `staff_profile_id`, `client_id`, `session_date` (actual SQL schema names). `QueryData` returned `never`.
- **Fix:** Updated `karute.ts` to select actual schema columns and use `customers:client_id(id, name)` alias for the FK join. Updated `KarutePdfDocument.tsx` to use `session_date ?? created_at` for the date field.
- **Files modified:** `src/lib/supabase/karute.ts`, `src/components/karute/KarutePdfDocument.tsx`, `src/app/api/karute/[id]/export/pdf/route.tsx`
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `d764490` (fix(03-03) — schema alignment commit)

**2. [Rule 3 - Blocking] Font download workaround — GitHub repo only has variable font**
- **Found during:** Task 1 (font file download)
- **Issue:** Plan's suggested GitHub URL for static TTF returned an HTML 404 page. The Google Fonts GitHub repo restructured — variable font only at root, no `static/` subfolder.
- **Fix:** Used Google Fonts CSS API (`fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700`) to get actual CDN URLs, then downloaded directly from `fonts.gstatic.com`.
- **Files modified:** `public/fonts/NotoSansJP-Regular.ttf`, `public/fonts/NotoSansJP-Bold.ttf`
- **Verification:** `file` command confirms TrueType Font data; both files ~5.1MB (valid static weights)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

- Prior sessions had committed `KarutePdfDocument.tsx` and `route.tsx` as part of other phase commits — verified these match plan requirements and TypeScript passes clean.
- `customers` relation uses a PostgREST alias (`customers:client_id`) that confuses `QueryData` type inference — used `any` cast for customer name access (documented in code comments).

## User Setup Required

None — font files are committed to the repository. No external service configuration required.

## Next Phase Readiness

- PDF export route is complete and TypeScript-clean
- Plan 07-02 (plain text export + ExportButtons) can proceed — it needs the same `getKaruteRecord` helper which is now stable
- Both export routes will be linked from the karute detail view in Plan 07-02

## Self-Check: PASSED

- `src/components/karute/KarutePdfDocument.tsx` — FOUND
- `src/app/api/karute/[id]/export/pdf/route.tsx` — FOUND
- `public/fonts/NotoSansJP-Regular.ttf` — FOUND (5.1MB valid TrueType)
- `public/fonts/NotoSansJP-Bold.ttf` — FOUND (5.1MB valid TrueType)
- `.planning/phases/07-export/07-01-SUMMARY.md` — FOUND
- `npx tsc --noEmit` — PASSED (0 errors)
- Commit `1fb667b` (fonts + react-pdf install) — FOUND
- Commit `d764490` (schema alignment) — FOUND

---
*Phase: 07-export*
*Completed: 2026-03-14*
