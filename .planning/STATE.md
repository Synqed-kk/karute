# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Service providers can record a client session conversation and instantly get a structured, categorized digital karute without writing anything down.
**Current focus:** Phase 8 — Integration Testing

## Current Position

Phase: 8 of 8 (Integration Testing)
Plan: 0 of 3 in current phase
Status: Ready for planning
Last activity: 2026-03-14 — Completed Phase 7 (Export: PDF + plain text export with ExportButtons)

Progress: [████████░░] ~88%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 5 min
- Total execution time: 0.2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 06-ui-ux-polish | 1 | 5 min | 5 min |
| 03-customer-management | 1 | 5 min | 5 min |

**Recent Trend:**
- Last 5 plans: 06-01 (5 min), 03-01 (5 min)
- Trend: -

*Updated after each plan completion*
| Phase 01-foundation-recording P04 | 15 min | 2 tasks | 9 files |
| Phase 03-customer-management P03 | 8 min | 2 tasks | 8 files |
| Phase 03-customer-management P02 | 2 min | 2 tasks | 9 files |
| Phase 05-staff-profiles P01 | 14 | 2 tasks | 4 files |
| Phase 04-karute-records P03 | 3 | 2 tasks | 5 files |
| Phase 02 P01 | 17 | 3 tasks | 8 files |
| Phase 02-ai-pipeline P02 | 1 | 2 tasks | 2 files |
| Phase 05-staff-profiles P02 | 10 | 2 tasks | 3 files |
| Phase 05-staff-profiles P03 | 2 | 2 tasks | 6 files |
| Phase 07-export P01 | 17 min | 2 tasks | 4 files |
| Phase 07-export P02 | 3 min | 2 tasks | 4 files |
| Phase 07-export P02 | 7 | 2 tasks | 4 files |
| Phase 04-karute-records P04 | 3 | 2 tasks | 4 files |
| Phase 05-staff-profiles P04 | 5 | 1 tasks | 4 files |
| Phase 01-foundation-recording P06 | 8 | 2 tasks | 3 files |
| Phase 03-customer-management P04 | 5 min | 2 tasks | 3 files |
| Phase 01-foundation-recording P05 | 15 | 2 tasks | 8 files |
| Phase 01-foundation-recording P07 | 12 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- 01-01: Next.js 16 scaffold with Tailwind v4 CSS-first (@import "tailwindcss" in globals.css, no tailwind.config.js), shadcn sidebar + header — verified as pre-existing
- 01-02: Database type uses Supabase CLI format (explicit Insert/Update, not Omit<Row>) — GenericTable constraint in Supabase 2.99+; RLS uses (select auth.uid()) subquery form for perf; profiles first in migration for FK resolution
- Phase 1 scope: User preference — recording feature belongs in Phase 1 alongside foundation and DB, not deferred to a later phase
- Recording format: iOS Safari uses mp4, Chrome uses webm — REC-02 requires both are handled at the API route level
- Audio privacy: Audio is never written to Supabase Storage — only transcript text is persisted (AI-05)
- 06-01: ThemeProvider in root layout (not [locale] layout) — ensures dark mode works on login and all routes
- 06-01: Noto Sans JP subsets=['latin'] only — next.js 16.1.6 types don't expose 'japanese' subset; Japanese glyphs load at runtime via unicode-range
- 06-01: Dashboard layout shell uses hardcoded hex (#2a2a2a, #3a3a3a) matching reference app exactly, not shadcn tokens
- 06-02: Custom sidebar (not shadcn Sidebar primitive) matching reference app exactly at 90px width
- 06-02: usePathname and useRouter imported from @/i18n/navigation to prevent locale URL stacking bug
- 06-02: sidebar namespace added to en.json and ja.json for translated nav labels
- 03-01: Duplicate name detection warns but does not block creation — duplicateWarning on ActionResult success case
- 03-01: listCustomers default sort: updated_at desc (proxy for last visit until karute_records linked)
- 03-01: checkDuplicateName non-fatal — Supabase errors return { exists: false } so creation never blocked
- 03-01: No redirect() in Server Actions — caller (sheet UI) handles navigation after success
- 04-01: Database type uses Supabase CLI format (explicit Insert/Update fields, not Omit<Row>) — Omit<> pattern caused GenericTable constraint to resolve Insert as never in Supabase 2.99+
- 04-01: staffId falls back to first profiles row with TODO for Phase 5 staff switcher wiring
- 04-01: getKaruteRecord returns null (not throws) on PGRST116 so page can call notFound() cleanly
- [Phase 03-customer-management]: No cursor-pointer on table rows — hover highlight only (hover:bg-muted/50) per user decision
- [Phase 03-customer-management]: Visits column shows 0 placeholder — real count deferred to Phase 4 when karute_records are linked
- [Phase 05-staff-profiles]: Active staff stored in httpOnly:false cookie for both server-side attribution and client-side UI reads
- [Phase 05-staff-profiles]: RLS policies use 'using (true)' — single business auth means any authenticated user IS the business; Phase 1 restrictive policies dropped
- [Phase 04-03]: Simple input+dropdown for CustomerCombobox (no cmdk/radix) — neither library installed
- [Phase 04-03]: onMouseDown+e.preventDefault() in dropdown items prevents blur-before-select race condition
- [Phase 04-03]: hasMounted guard in SaveKaruteFlow: render skeleton server-side, load sessionStorage after mount
- [Phase 04-03]: NEXT_REDIRECT re-throw: catch block re-throws redirect() exceptions so Next.js navigation works from client components
- [Phase 02-01]: ENTRY_CATEGORIES for AI extraction: Preference, Treatment, Lifestyle, Health, Allergy, Style (6 categories per CONTEXT.md decision)
- [Phase 02-01]: Audio never persisted: Buffer held in memory only, discarded after transcription (AI-05 compliance)
- 03-03: Route path is [locale]/(app)/customers/[id] not (app)/customers/[id] — matches existing locale routing structure
- 03-03: client_id (not customer_id) is FK from karute_records to customers.id — used for profile page history query
- 03-03: database.ts types corrected to match SQL schema (client_id/staff_profile_id/session_date on karute_records; customer_id on profiles)
- 06-03: Translation namespaces: common, auth, sidebar, recording, customers, karute, settings (107 keys total, fully mirrored EN/JP)
- 06-03: Category translation keys use snake_case matching categories.ts values (symptom, body_area, next_visit) not UPPERCASE
- 06-03: CategoryBadge converted to 'use client' to support useTranslations for runtime locale switching
- 06-03: AI-generated content (transcript, summary, entry content) intentionally NOT wrapped in t() — database values displayed as-is
- 07-01: Noto Sans JP TTFs from Google Fonts gstatic.com CDN (not GitHub) — GitHub repo no longer has static/ folder with weight TTFs
- 07-01: Font.register at module level in KarutePdfDocument.tsx — never inside component body (avoids re-registration per request)
- 07-01: customers:client_id PostgREST alias needed — karute_records.client_id is FK to customers; bare "customers" causes ambiguity
- 07-01: export const runtime = 'nodejs' in PDF route — Edge Runtime lacks file system access for font loading
- [Phase 02-02]: zodResponseFormat used (not JSON mode) — schema-guaranteed structured output for both extraction and summary routes
- [Phase 02-04]: fetchWithRetry retries any API call exactly once with 1.5s delay — second failure throws to caller for error UI
- [Phase 02-04]: Blocking modal enforced with full-screen fixed overlay and no dismiss — user cannot leave during AI processing
- [Phase 02-04]: extract+summarize run in parallel via Promise.all; onProgress uses 'extracting' label for both overlapping steps
- [Phase 02-04]: PipelineContainer does not persist to Supabase — onConfirm delegates to Phase 4 parent
- [Phase 05-staff-profiles]: StaffList manages StaffForm open state via local useState — parent mounts/unmounts form for clean state reset
- [Phase 05-staff-profiles]: window.confirm() for delete confirmation in StaffList — v1 acceptable; server-side guards enforce safety via deleteStaff throwing errors shown as toasts
- [Phase 07-02]: ExportButtons uses buttonVariants applied directly to <a> tags — Button component uses @base-ui/react/button which has no asChild prop
- [Phase 07-02]: ExportButtons placed between KaruteHeader and two-column layout in KaruteDetailView
- [Phase 04-karute-records]: ReviewConfirmStep uses useRef draftSavedRef guard — prevents saveDraft() from being called multiple times on re-renders
- [Phase 05-staff-profiles]: 05-04: PostgREST profiles:staff_profile_id join wired into getKaruteRecord and customer history queries — staff name displayed in KaruteHeader and KaruteHistoryList
- [Phase 01-06]: Format negotiation via isTypeSupported(): webm;codecs=opus → webm → mp4 (iOS Safari) → ogg → wav
- [Phase 01-06]: AudioContext created inside useEffect (not module load) — browser requires user gesture; stream arrival IS the gesture
- [Phase 01-06]: useRecordingTimer FREEZES (not resets) on pause — paused state preserves elapsed display
- [Phase 01-04]: request.ts locale field REQUIRED in next-intl v4 — omitting causes runtime error (was optional in v3)
- [Phase 01-04]: NextIntlClientProvider must receive messages prop — locale-only leaves client components without message context
- [Phase 01-04]: AppHeader/Sidebar in [locale]/(app)/layout.tsx not [locale]/layout.tsx — prevents shell rendering on login page
- [Phase 01-04]: proxy.ts createMiddleware+getClaims pattern established; middleware.ts entry point still needed to activate
- [Phase 03-04]: useSearchParams stays from next/navigation — createNavigation (next-intl) does not export useSearchParams; useRouter/usePathname from @/i18n/navigation
- [Phase 03-04]: Link from @/i18n/navigation is a named export — import syntax is { Link } not the default import from next/link
- [Phase 01-05]: react-hooks/set-state-in-effect disabled globally in eslint.config.mjs — fires false positives on async useCallback mount, timer reset on transition, waveform bar flatten
- [Phase 01-07]: Sessions page superseded by RecordingFlow (Phase 2 evolution) — RecordingPanel exists as Phase 1 standalone artifact; Sheet side=left pattern established for panel overlays

### Pending Todos

None.

### Blockers/Concerns

None. (Pre-existing TypeScript errors from Supabase 2.99 type format resolved in 04-01.)

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 01-05-PLAN.md (CI workflow + CONTRIBUTING.md; lint fixed by disabling react-hooks/set-state-in-effect globally)
Resume file: None
