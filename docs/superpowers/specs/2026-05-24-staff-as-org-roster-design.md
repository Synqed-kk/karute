# Staff as Org Roster (no auth) + Booking-Time Attribution — Design

**Date:** 2026-05-24
**Status:** Approved (design), pending implementation plan

## Problem

Adding a staff member from Settings reports success but the staff appears
**nowhere** in the UI.

Root cause: there are two staff stores and add/display use different ones.

- **Add** (`createStaff`, `src/actions/staff.ts:34`) writes to the **synqed-core
  `staff`** roster, with `user_id = null` for a brand-new teammate.
- **Display** everywhere — Settings (`src/app/[locale]/(app)/settings/page.tsx:14`)
  and the booking view (`src/app/[locale]/(app)/appointments/page.tsx:69`) —
  reads `getStaffList()` (`src/lib/staff.ts:81`), which reads the **Supabase
  `profiles`** table.

`profiles` only holds the org's **login accounts** (one per business). Nothing
in the UI renders the synqed-core roster directly, so an added staff member is
invisible.

The deeper cause is a modeling mistake: the app treats a "staff member" as an
auth user (a `profiles` row whose `id == auth.uid()`), bridged to synqed-core
via `staff.user_id`. The most recent commit (`refactor(staff): derive active
staff from auth.uid()`) doubled down on this by attributing karute to the
signed-in user's staff identity.

## The Model (decision)

- **`profiles` (auth) = the org / salon login.** One per business. Continues to
  handle authentication and to resolve `businessId` (`getBusinessId()`). It is
  **not** a staff record.
- **synqed-core `staff` = the roster.** Children of the org (`businessId`), each
  with its own `staff.id`, **no auth, no login**. This is the **single source of
  truth** for staff across the app.
- The `staff.user_id` bolt-on is no longer the linchpin for identity. Staff are
  identified app-wide by **`synqed staff.id`**.

This matches how synqed-core already stores staff (children of a business). The
profile-as-staff layer was the karute app's addition and the source of the bug.

## Change 1 — Roster is the source of truth (fixes "added staff invisible")

- `getStaffList()` (`src/lib/staff.ts`) reads the **synqed-core roster**
  (`synqed.staff.list`) instead of `profiles`. Field mapping (synqed `Staff` →
  `StaffMember`) is a planning detail; `has_pin` drops to `false`/removed since
  PINs lived on `profiles` and the PIN/staff-switch UI was already removed in the
  last commit.
- Because the app now keys staff off `synqed staff.id`, and synqed-core bookings
  already store `staff_id` as that id, the **profile↔synqed translation layer is
  removed**:
  - `resolveSynqedStaffId` (`src/lib/synqed/staff-map.ts`) becomes identity and
    is deleted; its two call sites in `src/actions/appointments.ts` (:51, :178)
    pass the staff id straight through.
  - The `profileByStaffId` remap when reading appointments
    (`src/actions/appointments.ts:~107-118`) is removed.
- Net effect: **less** code, and "Add staff" (which already writes to the roster)
  now shows up everywhere immediately.

## Change 2 — Booking-time attribution (fixes the original complaint)

When recording, attribute the karute to the staff (and customer) of the booking
happening **right now** (JST):

- **Exactly one** booking active at `now` → auto-attribute its `staff_id` and
  `client_id`; no prompt.
- **Two or more** overlapping bookings → show a small picker to choose which
  booking (each option carries its staff + customer).
- **No** active booking → manual **customer picker + staff picker** (roster), so
  walk-ins / ad-hoc notes can still be recorded and attributed.

This replaces the current "next appointment" logic on the record screen
(`src/components/karute/redesign/record/RecordPageView.tsx`) and the
`auth.uid()`-based attribution in `saveKaruteRecord`.

**Data-source correction (found during planning):** the record/sessions page
(`src/app/[locale]/(app)/sessions/page.tsx:63-81`) currently builds
`nextAppointment` and `recentRecordings` by querying the **legacy Supabase
`appointments` / `karute_records` tables directly**, which are not populated —
real bookings and karute live in synqed-core. As part of this work, the record
page must source its bookings (for the "current booking at now" match) and recent
recordings from **synqed-core** (`getAppointmentsByDate` / `synqed.karuteRecords.list`),
consistent with the rest of the app. This is why the record page never surfaces
the right session even when bookings exist.

- `saveKaruteRecord` / `saveKaruteRecordInline` (`src/actions/karute.ts`) take
  the chosen `staffId` explicitly (no longer derive it from `getCurrentUserStaffId`).
- **Security:** the server validates the supplied `staffId` is a member of the
  logged-in org's roster (scoped by `businessId`) before saving. Cross-tenant /
  forged ids are rejected. This preserves the safety the last commit was
  protecting, without tying staff to auth.

## What this reverses (be explicit)

- `getCurrentUserStaffId()` (`src/lib/staff.ts`) and the "me = a staff member"
  concept go away. The current user is the **org**, not a stylist.
- UI that used "active staff" for a personal highlight/default — the appointments
  default column and the Settings owner highlight — default to the **first roster
  member** (or none) instead of "me".
- The three integration suites added by the last commit are rewritten (not
  deleted) for the new contract:
  - `current-user-staff.test.ts` → roster list sourced from synqed-core.
  - `save-flow-staff-attribution.test.ts` → save uses the booking/picked staff id
    and validates it belongs to the org's roster.
  - `booking-auth-flow.test.ts` → booking create/update pass staff id straight
    through (no profile translation).

## Out of scope

- Inviting staff as real login users (the "login accounts" model we rejected).
- Per-staff roles/permissions beyond what synqed-core already returns.
- Voice enrollment (already a disabled placeholder in `StaffSection`).
- Reworking PINs (vestigial after the last commit; just drop `has_pin`).

## Success criteria

1. Adding a staff member from Settings makes it appear in the Settings staff list
   and as a bookable staff column in the appointments view.
2. Recording while a single booking is active auto-fills that booking's customer
   and attributes the karute to that booking's staff, with no extra prompts.
3. Recording with 2+ overlapping bookings prompts a booking/staff picker.
4. Recording with no active booking lets the user pick a customer and a staff and
   saves successfully.
5. A save with a `staffId` not in the org's roster is rejected server-side.
6. Booking create/read no longer perform any profile↔synqed id translation.
7. The rewritten integration suites pass; the existing booking and karute-save
   flows still work end-to-end.
