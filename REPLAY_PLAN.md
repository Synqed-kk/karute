# Replay plan — redo-from-pr11

**Goal:** rebuild from PR #11 (`Record-page redesign (sessions)`, merged 2026-05-14) to current main HEAD as a clean dependency-aware PR stack, recovering work that was lost in bad merges.

**Base branch:** `redo-from-pr11` (currently at commit `51c9af1` = PR #11 merge).

**Strategy:**
- Each replay PR targets `redo-from-pr11` (not main) so we can re-merge to main as one clean fast-forward when the full stack is ready.
- Original feature branches reused where preserved (56 still on remote). Lost branches (mostly mine, #58–#71) recreated from merge commits.
- Order is dependency-aware: foundation → layout primitives → cross-cutting components → feature systems → polish/audit. Within a tier, sub-order by file overlap to minimise rebase pain.
- Combined PRs where downstream work superseded upstream (e.g. NewKaruteDialog #61→#62→#67→#70 collapses to one PR shipping the final state; #65 dead-UI + #70 spec-scaffolding-restore collapses likewise).

**Total replay PRs after consolidation:** ~32 (down from ~60 original).

---

## Tier 0 — Foundation & infra (must land first)

Low-conflict surface, blocks everything below. Land in this exact order.

| # | Source branch / commit | Scope | Target |
|---|---|---|---|
| R1 | `chore/bump-next-react-next-intl` (PR #1) | next 16.2.4, react 19.2.4, next-intl 4.9.1 + lockfile sync | redo-from-pr11 |
| R2 | `feat/synqed-core-migration` (PR #8, pre-#11 if not in) | confirm @synqed-kk/client migration | redo-from-pr11 |
| R3 | Pull migration `20260514000000_perf_tenant_scoped_indexes.sql` from main | DB migration | redo-from-pr11 |
| R4 | Pull `vercel.json` from main | Deploy config | redo-from-pr11 |
| R5 | `staff-org-roster` (PR #52) | Staff org-roster + PIN switcher + karute read-path fixes via synqed-core | redo-from-pr11 |
| R6 | `fix/karute-page-size-cap` (PR #72) | Cap karute list page_size at 200 | redo-from-pr11 |
| R7 | `rename-settings-to-configuration` (PR #12) | Settings → Configuration heading | redo-from-pr11 |

---

## Tier 1 — Tokens & global styles

| # | Source | Scope |
|---|---|---|
| R8 | `chore/sage-brand-color-sweep` + (combine with #60 fix) | Port sage color scale into globals.css **as a non-inline `@theme {}` block** (the #55+#60 final state — skips the bug iteration) |

---

## Tier 2 — Layout primitives (chrome)

Cross-cutting. Most pages import these.

| # | Source | Scope |
|---|---|---|
| R9 | `feat/bottom-nav-next-customer` (PR #18) | BottomNav with primary tabs + menu + recording center button + next-customer label |
| R10 | Recreate sidebar work | Sidebar nav + active-state indicator + sidebar-style hook + dark variant wired |
| R11 | `feat/mobile-header-with-bell` (PR #57) + #71 (recording-aware bell hide merged in) | MobileHeader sticky bar — back/title/bell, route-aware back, recording-aware bell hide centralised |
| R12 | `fix/bell-recording-overlap` (combined into R11 above if needed) | Bell-vs-DiscreetRecordingIndicator coordination |
| R13 | Recreate from #59 merge commit | Per-page mobile chrome dedup (CustomersListHeader / AppointmentsView / CoachingHeader / data-import / RecordPageHeader) |

---

## Tier 3 — Cross-cutting components

| # | Source | Scope |
|---|---|---|
| R14 | `chore/extract-scaffold-hint` (PR #35) | ScaffoldHint + AiCapabilityHint + ComingSoonChip |
| R15 | `feat/notifications-panel` | NotificationsPanel + useUnreadCount hook |
| R16 | `feat/select-booking-sheet` (PR #19) | BookingActionSheet wrapper |
| R17 | `feat/message-compose-dialog` | MessageComposeDialog |

---

## Tier 4 — Feature: Reservation / Appointments

| # | Source | Scope |
|---|---|---|
| R18 | `feat/perf-appointments-fan-out` | Reservation perf fan-out |

(`AppointmentsView` mobile chrome dedup already covered in R13.)

---

## Tier 5 — Feature: Karute domain

Land in this order — `KaruteListRow` is shared by both list views.

| # | Source | Scope |
|---|---|---|
| R19 | `feat/karute-coaching-panel` | KaruteCoachingPanel mounted in karute detail |
| R20 | `feat/photos-complete-system` (PR #47) | Photos system (capture dialog + gallery sheet + compare view + record card + storage hooks) |
| R21 | Recreate karute Phase A from older merge commits | Record-centric karute list (KaruteRecordListView + KaruteListRow + filter chips + date groups) |
| R22 | Recreate karute Phase B | Placeholder rows for customers without records yet |
| R23 | `fix/karute-page-header-and-filter` (PR #54) | Karute page title/filter polish |
| R24 | Recreate NewKaruteDialog (collapsed: PR #61 + #62 + #67 + #70 final state) | Manual karute creation — customer + staff + disabled date/duration/service with ComingSoonChip |

---

## Tier 6 — Feature: Customer domain

| # | Source | Scope |
|---|---|---|
| R25 | Recreate customer list redesign from merge commits | CustomersListView + CustomerRowDesktop + CustomerCardMobile + status derive + filter |
| R26 | Recreate customer profile redesign | CustomerProfileView with 4 tabs (memory/sessions/photos/privacy) — photos tab wired to PhotosTabContent (PR #66 final state) |
| R27 | `feat/customer-detail-dialogs` (PR #51) | NewCustomerDialog + EditCustomerDialog + customer messaging integration |
| R28 | Customer deletion + scheduled-deletions hook (existing branch?) | CustomerDeletionBanner + soft-delete flow |

---

## Tier 7 — Feature: Coaching domain (the big one)

10 PRs. Order matters because each builds on the previous.

| # | Source | Scope |
|---|---|---|
| R29 | `feat/coaching-system-port` | Coaching hub scaffold + role context |
| R30 | `feat/coaching-hero-cards` | Hero cards on /coaching root |
| R31 | `feat/coaching-staff-cards` | Staff-role coaching cards |
| R32 | `feat/coaching-owner-cards` (PR #32) | Owner-role coaching cards |
| R33 | `feat/coaching-staff-drilldown` (PR #33) | Per-staff drilldown |
| R34 | `feat/coaching-modules-library` (PR #34) | Learning modules library |
| R35 | `feat/coaching-dev-preview` (PR #36) | Dev preview hook (localStorage gate) |
| R36 | `feat/coaching-patterns-library` (PR #37) | Pattern library |
| R37 | `feat/coaching-growth-detail` (PR #38) | Personal growth detail |
| R38 | `feat/coaching-data-transparency` (PR #39) | Data transparency page |
| R39 | `chore/profile-coaching-quicklinks` (PR #40) | Profile page coaching quicklinks |
| R40 | `feat/staff-consent-status-badge` (PR #41) | Staff consent status badge in staff list |
| R41 | `feat/wire-coaching-consent-into-staff-list` (PR #42) | Wire coaching-consent into staff list |
| R42 | `feat/coaching-consent-dialog` | Coaching consent dialog |

(/coaching nav gating behind feature flag deferred to Tier 11 audit.)

---

## Tier 8 — Feature: AI assistant / Dashboard

| # | Source | Scope |
|---|---|---|
| R43 | Recreate Dashboard redesign | AIActionsHero + StatStrip + TodaysAppointmentsCard + RecentKaruteCard with full AppointmentStatusKey union + StatStrip trend props (per #70 final state) |
| R44 | Recreate AskAI page | /ask-ai page + AIChatFAB removal note (FAB intentionally not mounted) |

---

## Tier 9 — Feature: Settings sections

Land in this order — settings shell first, then each section.

| # | Source | Scope |
|---|---|---|
| R45 | Recreate SettingsShell + Organization section | Tabs + section routing + isOwner gating |
| R46 | `feat/theme-section-sidebar-and-swatches` (PR #56) | Theme section — language, mode, sidebar style picker (wired to Sidebar per #68), brand swatches |
| R47 | Recreate AI / Recording / Sync sections | Owner-facing settings (AI prompts, recording prefs, sync prefs) |
| R48 | Coaching section (Phase-3 scaffold) | Master toggle + cross-staff privacy + weights + min sessions + auto-decline days + policy template — all local state with Phase-3 banner |
| R49 | `feat/intake-form-editor` (PR #49) | Intake form editor |
| R50 | `feat/multi-store-settings` (PR #45) | Multi-store stores section (multi-store add button feature-flagged per #68) |
| R51 | `feat/subscription-page-and-plans` (PR #46) | Subscription tab + SubscriptionSummaryCard (feature-flagged per #68) |
| R52 | AuditLog section | Pre-sale surface, feature-flagged via `NEXT_PUBLIC_FEATURE_AUDIT_LOG` |
| R53 | `fix/settings-subscription-label-dup` (PR #53) | i18n key dedup |
| R54 | `fix/settings-i18n-and-scroll-defense` | Settings i18n cleanup + scroll defense |
| R55 | `fix/settings-hours-of-operation` | Hours of operation fix |

---

## Tier 10 — Feature: Recording / Sessions

| # | Source | Scope |
|---|---|---|
| R56 | `feat/recording-flow-spike-parity` | Sessions page (RecordPageView + RecordingTargetCard + PreSessionBriefCard + RecentRecordingsCard with Play/Convert behind flags per #70) |

---

## Tier 11 — Feature: Profile / Welcome / Data flow

| # | Source | Scope |
|---|---|---|
| R57 | `feat/profile-page` | /profile page (account, edit identity) |
| R58 | Recreate welcome wizard | /welcome onboarding |
| R59 | `feat/data-import-stepper` (PR #48) | Data import page (nav hidden per #69) |
| R60 | Recreate /data-export | Data export — real CSV/JSON exports work; RecentExportsTable feature-flagged per #69 |

---

## Tier 12 — Synqed phase messaging

| # | Source | Scope |
|---|---|---|
| R61 | `feat/synqed-access-disclosure` (PR #43) | Synqed-access disclosure surface |
| R62 | `chore/anthony-handoff-polish` (PR #44) | Anthony handoff polish |

---

## Tier 13 — Polish / data integrity / dead-UI cleanup (the audit)

Last tier — depends on every feature being in place.

| # | Source | Scope |
|---|---|---|
| R63 | Recreate from PR #58 merge | Karute page header dedup + new-karute CTA pin |
| R64 | Recreate from PR #63 merge | Drop dead レビュー要 chip + `'施術'` fallback → `'—'` (preserves union member + i18n + style branch for restoration when `review_needed` column lands) |
| R65 | Recreate from PR #64 merge | Data integrity sweep — i18n statusLabel, isOwner from display_role, hex-slice deriveKaruteNumber dropped (3 places), `service: 'Session'` → `'—'`, staff lookup wired, duration gating |
| R66 | Recreate from PR #65 + #70 merge (combined: final state) | Dead UI affordances behind feature flags + restored spec scaffolding (Share/Play/Convert/Eye behind flags, AppointmentStatusKey full union restored, isNew field optional, StatStrip trend props optional, BRAND_SWATCHES restored, AIActionsHero counter as `number \| null`) |
| R67 | Recreate from PR #66 merge | Photos tab wired to real DB photos via PhotosTabContent (drops PhotoRecordCard in-memory stub from customer profile mount) |
| R68 | Recreate from PR #68 merge | Settings honesty — sidebar style picker wired into Sidebar, subscription tab + multi-store add behind feature flags |
| R69 | Recreate from PR #69 merge | /coaching + /data-import nav entries gated behind feature flags; RecentExportsTable gated |

---

## Conflict-risk zones (file ownership matrix)

| File | PRs touching it | Risk |
|---|---|---|
| `src/app/globals.css` | R8 (sage tokens), R11 (sidebar dark variant) | Low — different sections |
| `src/components/layout/sidebar.tsx` | R10, R46, R68 | **HIGH** — land sidebar work in one PR if possible (combine R10 + R46 sidebar-style consumer) |
| `src/components/layout/bottom-nav.tsx` | R9, R69 | Medium — R69's flag gate adds wrapping conditions |
| `src/components/layout/MobileHeader.tsx` | R11 | Low — single owner |
| `src/components/karute/spike-lifted/list/KaruteRecordListView.tsx` | R21, R23, R24, R63, R64, R65 | **HIGH** — KaruteRecordListView is hot. Land in chronological scope order; rebase late ones onto early ones. |
| `src/app/[locale]/(app)/dashboard/page.tsx` | R43, R65, R66 | Medium |
| `src/app/[locale]/(app)/sessions/page.tsx` | R56, R65 | Medium |
| `src/app/[locale]/(app)/karute/page.tsx` | R21, R22, R24, R63 | Medium |
| `messages/{ja,en}.json` | almost everything | **HIGH but additive** — additions stay non-conflicting if each PR adds its keys at the bottom of its namespace |
| `src/actions/karute.ts` | R24 (createManualKaruteRecord) | Low |
| `src/components/customers/redesign/profile/CustomerProfileView.tsx` | R26, R67 | Medium — R67 is photos rewire only |
| `src/components/karute/redesign/record/RecordPageView.tsx` | R56, R65 | Medium |
| `src/components/dashboard/redesign/StatStrip.tsx` | R43, R66 | Low (single owner per tier) |
| `src/components/dashboard/redesign/TodaysAppointmentsCard.tsx` | R43, R66 | Low |
| `src/components/karute/redesign/record/RecentRecordingsCard.tsx` | R56, R66 | Low |

---

## Lost-work suspicion check (TODO before executing)

Before replaying, verify whether any actual work is missing from main:
1. `git diff origin/ui..origin/main` — if non-empty, work landed on main that isn't on ui (Anthony's direct-to-main changes, expected ones are listed).
2. `git diff feat/<branch>...origin/main` for each preserved feature branch — verifies the branch's final commit content is present in main.
3. Manually walk the spike (`/Users/liam/Documents/synqed-karute-design-spike/`) → diff against karute current state to find lifted features that didn't survive.

The `redo-from-pr11` branch state is the safe starting point regardless — even if main has all the work, the clean replay produces the audit trail.

---

## Execution rules

- One PR per replay tier item. Open against `redo-from-pr11`.
- Each PR rebased onto the latest `redo-from-pr11` HEAD before opening (so the diff is clean).
- For Anthony's preserved branches: `git checkout -b replay/<original> <original>`, rebase onto `redo-from-pr11`, push, PR.
- For my deleted branches: cherry-pick the merge commit's diff onto a fresh `replay/<name>` branch off `redo-from-pr11`.
- tsc + eslint clean on every PR before merging.
- Merge to `redo-from-pr11` (not main) until the full stack is up. Final step: fast-forward main from redo-from-pr11.

---

**Ready to execute?** Confirm the order above (or revise it) and I'll start with Tier 0 (R1–R7).
