# Booking Redesign — Phase 1: Day View

**Date:** 2026-05-12
**Branch:** `feat/booking-redesign-phase-1` (rename from `feat/booking-redesign-spike`)
**Source:** `karute-handoff.zip` (Claude Design handoff bundle) — extracted to `/tmp/karute-booking-handoff/`
**Brief:** `/tmp/karute-booking-handoff/karute/project/booking/CLAUDE_CODE_HANDOFF.md`

## Goal

Replace the day view of `/appointments` with the prototype's design, mobile-first. Ship visible visual progress on the real route using only data the app already has, while laying the foundation (status mapping, staff colors, i18n namespace, test auth) that later phases build on.

Phase 1 is the first of five planned phases. The remaining four are scoped in subsequent specs:
- Phase 1.5: `新規` first-visit status, recording-consent + karute-number indicators on cards
- Phase 2: Week view (utilization %, flag chips, per-booking list, today badge)
- Phase 3: Month view (density dots, Sat/Sun coloring, today ring, density legend)
- Phase 4: ViewModeSelector + BookingActionSheet

## Scope

### In
- New components in `src/components/reservation/`: `ReservationGrid`, `StaffRow`, `AppointmentCard`, `TimeAxis`, `MobileReservationAgenda`.
- New utility `src/lib/staff-colors.ts` — deterministic 6-color hash (blue / violet / teal / pink / cyan / fuchsia). Avoids red/green/yellow (those carry status meaning).
- New adapter `src/lib/adapters/reservation-view.ts` exporting `appointmentsToReservationViews(rows, staffList, now)` → `ReservationView[]`. Status is computed here as a pure function.
- Update `src/components/appointments/AppointmentsView.tsx` day branch: render `<MobileReservationAgenda>` below `md` (768px), `<ReservationGrid>` at `md+`. The existing `DashboardClient` invocation in the day branch is removed (used only here — confirmed via grep before deletion).
- Update legend props: from 4 items (`booked / in_progress / completed / block`) to 6 (`booked / in_session / completed / new / pending / block`). Reuses the existing `@synqed-kk/ui` `ReservationLegend` if its props accept this expansion; otherwise replace with a local `ReservationLegend` rendering the 6 tones from the same `--sq-status-*` tokens.
- 4-of-5 status mapping computed in the adapter:
  - `予約済` (booked) — `CONFIRMED` and `starts_at > now`
  - `施術中` (in_session) — `starts_at ≤ now ≤ ends_at`
  - `完了` (completed) — `COMPLETED` or `ends_at < now`
  - `未確定` (pending) — `PENDING`
  - `新規` (new) — deferred to phase 1.5 (requires first-visit lookup against `karute_records`)
- Current-time line: 1px amber vertical line + time badge inside `TimeAxis`, position recomputed every 60s from the client clock.
- Hatched non-booking pattern: applied to staff rows whose role is `OWNER` (the closest existing proxy for "doesn't take bookings"). CSS utility `.reservation-block-pattern` added to `globals.css` — port the exact `repeating-linear-gradient` from `synqed-karute-design-spike/src/globals.css` (referenced in the handoff brief).
- i18n: new `reservation` namespace in `messages/en.json` and `messages/ja.json` covering page header, filter row, legend, card chrome, mobile-agenda labels, status tones. Japanese is the primary copy; English is the working translation. Date + weekday formatting via `Intl.DateTimeFormat` honors the active locale (Japanese: `4月18日（土）`; English: `Apr 18 (Sat)`).
- Status chip labels: translated to English (`Booked / In session / Completed / New / Pending`). Source enum in adapter is locale-agnostic; component looks up the label.
- Test auth helper + seed script:
  - `scripts/seed-test-user.ts` — idempotent: creates `dev@karute.test` via Supabase admin API if missing, resets the password to `TestPass123!` if the user exists, runs the existing bootstrap action once to provision a profile + first staff record. Required because the canonical test account doesn't currently exist on main; existing `scripts/test-fresh-signup.ts` creates a new timestamped user each run, which is unsuitable for a stable Playwright fixture.
  - `scripts/playwright-login.ts` — walks the `/en/login` form using `dev@karute.test` / `TestPass123!`, writes the resulting Playwright `storageState` JSON to `.auth/dev-user.json`. The `.auth/` directory is added to `.gitignore`. Phase 1 verification uses this state instead of re-walking the login on every Playwright invocation.

### Out
- `新規` first-visit status detection (Phase 1.5; requires `karute_records.count_by_customer` lookup)
- Recording-consent indicators on cards (Phase 1.5; requires `customers.recording_consent_at` column)
- Karute-number badges (`#00123`) on cards (Phase 1.5; requires `karute_records.karute_number` join)
- AI flags (`リマインド未送信`, `前回キャンセル`, `初回カウンセリング要`) (Phase 1.5+; needs new producers)
- Week view redesign (Phase 2)
- Month view redesign (Phase 3)
- BookingActionSheet on card tap (Phase 4)
- ViewModeSelector URL filter (`?staff=self|all|<id>`) (Phase 4)
- Promotion of any of these components to the `@synqed-kk/ui` package (not in any current phase; revisit after Phase 4)
- Schema changes to `appointments`, `customers`, or `staff` tables (all phase-1 fields are computed from existing data)
- Restructuring `DashboardClient` (the existing dashboard route keeps using it unchanged; only the `/appointments` day branch swaps)

## Architecture

### Component layout

All new files in `src/components/reservation/`:

```
ReservationGrid.tsx           — desktop day-view grid container (md+)
  Owns: outer flex layout, staff column + timeline split, business-hours math,
        passing per-staff data into StaffRow.
StaffRow.tsx                  — one row per staff member (md+)
  Owns: staff label cell, lane layout, absolute-positioned card placement,
        hatched-pattern when role === 'OWNER'.
AppointmentCard.tsx           — single appointment chip
  Owns: visual treatment by displayStatus, customer name + service + duration
        + time-range labels, accent-bar from staff color. Same component used
        by both desktop grid (positioned absolutely) and mobile agenda (full-width).
TimeAxis.tsx                  — top hour labels + vertical hour grid lines + current-time line
  Owns: business-hours-driven hour stripe, the amber current-time vertical line
        rendered by a small CurrentTimeIndicator child (60s setInterval).
MobileReservationAgenda.tsx   — single-column time-ordered list (below md)
  Owns: ordering, day-header label, empty state, condensed AppointmentCard
        sequence; staff color shown as a left accent stripe on each card.
```

Each file has one responsibility with a well-defined interface (props in, JSX out). No file in phase 1 is expected to exceed ~250 lines. `AppointmentCard` is the only one shared between the desktop and mobile renderers; the rest are pure renderers fed by the same `ReservationView[]`.

### Data flow

```
src/app/[locale]/(app)/appointments/page.tsx (server)
  ├─ getStaffList()           → StaffMember[]      (existing, no change)
  ├─ getAppointmentsByDate()  → AppointmentRow[]   (existing; may extend SELECT projection if adapter needs more fields)
  └─ appointmentsToReservationViews(rows, staffList, now)   ← NEW pure adapter
                              → ReservationView[]
     ↓
AppointmentsView (client) ← props interface gets reservationViews + businessHours added
  ├─ at md+: <ReservationGrid views={...} staff={...} businessHours={...} />
  └─ below md: <MobileReservationAgenda views={...} staff={...} />
```

`ReservationView` shape (locale-agnostic; component looks up labels from i18n):

```ts
type DisplayStatus = 'booked' | 'in_session' | 'completed' | 'pending'
// 'new' added in Phase 1.5

interface ReservationView {
  id: string
  staffId: string
  startTimeHm: string         // "HH:MM"
  durationMin: number
  customerName: string
  customerInitials: string    // first char of customerName
  service: string             // from appointment.title, with fallback
  displayStatus: DisplayStatus
  staffColorKey: string       // resolved by getStaffColor(staffId)
}
```

No new server calls in phase 1. If `AppointmentRow` doesn't already expose the raw synqed status enum (needed to detect `PENDING`), extend `getAppointmentsByDate`'s SELECT projection to include it — boundary stays at the existing data access layer.

### i18n

New namespace `reservation` added to both message files. Locale-aware Date/weekday formatting via `useFormatter` from `next-intl` (already a transitive dep). Status labels are translation keys (`reservation.status.booked`, `reservation.status.in_session`, `reservation.status.completed`, `reservation.status.pending`); the adapter emits the enum, the component looks up the label via `useTranslations('reservation')`.

Initial key set (final keys may be reorganized during implementation; this is the surface):

```
reservation.title                    "予約" / "Appointments"
reservation.new                      "新規予約" / "New booking"
reservation.today                    "今日" / "Today"
reservation.view.day                 "日" / "Day"
reservation.view.week                "週" / "Week"
reservation.view.month               "月" / "Month"
reservation.mode.self                "自分" / "Mine"
reservation.mode.all                 "全スタッフ" / "All staff"
reservation.legend.label             "凡例" / "Legend"
reservation.legend.block             "オーナー業務" / "Owner duties"
reservation.status.booked            "予約済" / "Booked"
reservation.status.in_session        "施術中" / "In session"
reservation.status.completed         "完了" / "Completed"
reservation.status.pending           "未確定" / "Pending"
reservation.status.new               "新規" / "New"          (used by legend; status emitted in 1.5)
reservation.card.duration            "{n}分" / "{n} min"
reservation.card.appointments        "{n}件の予約" / "{n} appts"
reservation.card.customerSuffix      "様" / ""               (Japanese-only honorific)
reservation.mobile.empty             "予約はありません" / "No appointments"
reservation.mobile.dayHeader         "{date}（{weekday}）" / "{date} ({weekday})"
reservation.grid.blockOwner          "予約を受け付けていません（オーナー業務）" / "Not taking bookings (owner)"
reservation.grid.staffMeta           "{role} ・ {count}件の予約" / "{role} · {count} appts"
```

### `staff-colors.ts`

```ts
// src/lib/staff-colors.ts
export type StaffColorKey = 'blue' | 'violet' | 'teal' | 'pink' | 'cyan' | 'fuchsia'

export interface StaffColor {
  key: StaffColorKey
  bg: string       // CSS color, dark + light variants flowed via tokens
  border: string
  text: string
}

export function getStaffColor(staffId: string): StaffColor
```

Implementation uses FNV-1a hash → bucket of 6. Each tone is sourced from CSS vars defined in `globals.css` (e.g. `--reservation-staff-blue-bg`, `--reservation-staff-blue-border`, `--reservation-staff-blue-text`), so dark/light theming flips automatically. Colors picked from the prototype's `synqed-karute-design-spike/src/lib/staff-colors.ts` exactly so the visual matches the design source.

### Status mapping

Computed in the adapter; pure function:

```ts
function computeDisplayStatus(a: AppointmentRow, now: Date): DisplayStatus {
  const start = new Date(a.start_time).getTime()
  const end = start + a.duration_minutes * 60000
  if (now.getTime() > end) return 'completed'
  if (now.getTime() >= start) return 'in_session'
  if (a.synqed_status === 'PENDING') return 'pending'
  return 'booked'
}
```

The recording-link proxy described in the brief (`recording.ended_at == null`) is approximated by `now is inside [start, end]` — close enough for phase 1; a precise version requires querying recordings and lands with the recording-consent work in Phase 1.5.

### Current-time line

`CurrentTimeIndicator` is a small client component inside `TimeAxis`. It uses `useState(() => new Date())` and `useEffect(() => { const id = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(id); }, [])`. Position computed from `((now - businessHoursStart) / businessHoursSpan) * gridWidth`. Rendered only when "now" is within business hours; otherwise hidden.

### Hatched non-booking pattern

CSS utility added to `globals.css`:

```css
.reservation-block-pattern {
  background-image: repeating-linear-gradient(
    45deg,
    var(--color-bg-muted) 0,
    var(--color-bg-muted) 6px,
    transparent 6px,
    transparent 12px
  );
}
```

(Exact color tokens to match the prototype's source; the brief lists the rule. Both light and dark themes flow through `--color-bg-muted`.)

Applied to the entire `StaffRow` content area when `staff.role === 'OWNER'`. Card placement is skipped for these rows.

### Test auth helper

`scripts/playwright-login.ts`:

```ts
// One-time login helper for Playwright runs. Loads dev@karute.test / TestPass123!
// through the real /en/login flow and saves cookies + localStorage to
// .auth/dev-user.json (gitignored). Subsequent Playwright runs load that state
// via the storageState constructor option.
```

`.auth/` added to `.gitignore`. README note added under `docs/` (or as a comment block in the script) explaining:
- The canonical test account is `dev@karute.test` / `TestPass123!`
- Run `scripts/seed-test-user.ts` to provision it if it doesn't exist
- Run `scripts/playwright-login.ts` to refresh `.auth/dev-user.json` (typically once per Supabase session reset)

## Migration order (within phase 1, one branch, staged commits)

1. **Tokens + CSS utility** — add `.reservation-block-pattern` + `--reservation-staff-*` color vars to `globals.css`. No visible change.
2. **`staff-colors.ts`** — utility implementation + a small unit test for the hash determinism.
3. **i18n keys** — add the `reservation` namespace to `messages/en.json` and `messages/ja.json`. No consumers yet.
4. **Adapter** — `src/lib/adapters/reservation-view.ts` with `appointmentsToReservationViews` and `computeDisplayStatus`. Includes tests for the four status cases.
5. **`AppointmentCard`** — self-contained card component. Renders against a `ReservationView` + `StaffColor`. Visual variants for the 4 displayed statuses.
6. **`TimeAxis`** + `CurrentTimeIndicator` — hour-stripe + amber time line.
7. **`StaffRow`** — staff label cell + lane layout + absolute card placement + hatched-pattern conditional.
8. **`ReservationGrid`** — composes `TimeAxis` + `StaffRow`s.
9. **`MobileReservationAgenda`** — ordered list rendering against the same shape.
10. **Wire `AppointmentsView`** — replace the day branch's `DashboardClient` with the new `<ReservationGrid>` (md+) and `<MobileReservationAgenda>` (below md). Update legend to 6 items.
11. **Test auth seed + helper** — `scripts/seed-test-user.ts` (idempotent provisioning), `scripts/playwright-login.ts` (storage state), `.auth/` gitignore, README note.
12. **Phase 1 verification** — Playwright walks `/en/appointments?view=day` and `/ja/appointments?view=day` at desktop + mobile breakpoints with the seeded data from `scripts/seed-booking-data.ts`. Screenshots compared side-by-side with the prototype's day view.

## Risk

- **`DashboardClient` reuse** — if `DashboardClient` is imported by the `/dashboard` route too, only the `/appointments` consumer switches; dashboard keeps it. The implementer greps for imports before deleting anything. (30-second check, not a blocker.)
- **`AppointmentRow` may not expose the raw synqed status enum.** Mitigation: extend `getAppointmentsByDate`'s SELECT projection to include `status` from synqed-core. Boundary stays at the existing data access layer — no synqed-core change.
- **i18n key drift** — easy to miss a string. Mitigation: grep the new files for any literal Japanese character (`[　-龯]`) before commit; any hit is a bug.
- **Mobile breakpoint** — the handoff says `< md` (768px); Tailwind's `md:` is 768px. They match. Don't override.
- **Hatched pattern in dark mode** — the brief says "already in spike's globals.css — port it." Phase 1 verifies in both themes via the toggle.
- **Staff with no appointments today** — should still render as a row (with empty timeline), not be hidden. Adapter returns one `ReservationView[]` per staff anchored to staffList; the grid renders staff rows from `staffList` directly (not from view-derived staffIds).
- **Owner takesBookings convention** — `role === 'OWNER'` is the proxy for "doesn't take bookings". If a real shop has a non-owner non-booking role (e.g. receptionist), it'd render with cards. Acceptable for phase 1; later phases may add an explicit `takes_bookings` column.

## Verification gate

Phase 1 is done when:
- `npm run type-check` passes
- `npm run lint` passes
- `npm test` passes (includes new unit tests for adapter + staff-colors)
- `npm run build` passes
- Dev server boots; manual + Playwright walk of:
  - `/en/appointments?view=day` desktop (≥768px): new grid renders, current-time line present, hatched pattern on owner row, status chips on cards correct for past / in-window / future / pending bookings
  - `/en/appointments?view=day` mobile (<768px): single-column agenda renders
  - `/ja/appointments?view=day` desktop + mobile: Japanese labels throughout, locale-aware date formatting
  - Theme toggle dark ↔ light: cards and hatched pattern render correctly in both
  - Week + month views (`?view=week`, `?view=month`) still render their existing components untouched
- `scripts/playwright-login.ts` produces a valid `.auth/dev-user.json` that subsequent Playwright runs load successfully

## Out-of-band cleanup performed as part of this work

These edits are forced by the foundation change and are in scope:
- Rename branch `feat/booking-redesign-spike` → `feat/booking-redesign-phase-1` (preserves the cleanup commit that stripped the earlier spike attempt).
- Add `.auth/` to `.gitignore`.
- Remove the day branch's `DashboardClient` invocation from `AppointmentsView` (still imported and used by the dashboard route — don't delete the file).
- Update `ReservationLegend` consumer or replace with local component if upstream `@synqed-kk/ui` legend doesn't accept the 6-item prop shape.

Anything outside this list (rewriting `DashboardClient` itself, schema changes, week/month redesign, server-action refactors, adding tests beyond the adapter + staff-colors, restructuring server components) is deferred.

## Test account

Canonical test account for local + preview environments:

- Email: `dev@karute.test`
- Password: `TestPass123!`
- Provisioned by: `npx tsx --env-file=.env scripts/seed-test-user.ts`
- Sample data: `npx tsx --env-file=.env scripts/seed-booking-data.ts` creates 6 customers + 6 appointments spread across today.
- Playwright state: `scripts/playwright-login.ts` writes `.auth/dev-user.json` for state reuse.
