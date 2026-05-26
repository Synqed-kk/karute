# Staff Profile Switcher (PIN-gated active staff) — Design

**Date:** 2026-05-25
**Status:** Approved (design), pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-05-24-staff-as-org-roster-design.md` (this feature absorbs that plan's deferred Phase 4).

## Problem / motivation

The app uses one **org login** per salon on a shared device; staff are roster
entries (synqed-core), not auth users. We need a fast "who's at this device
right now" identity — a **Netflix-style profile switcher** — gated by the staff
**PIN**. This gives the (currently dormant) PIN plumbing a real purpose and
replaces the temporary `getCurrentUserStaffId` shim left by the staff-org-roster
work with a real "active staff" concept.

The previous `active_staff_id` cookie was deliberately removed (commit 7cff7cf)
because it was the **sole, unvalidated** source of staff identity and got plumbed
straight into the appointment FK, surviving auth/DB wipes. This design re-introduces
an active-staff cookie **safely** (see Persistence).

## The model

- **Active staff = lightweight identity only.** It sets (a) the default
  attribution for recordings in the **no-booking** case, and (b) the Appointments
  "Mine" filter. It does **not** grant permissions or scope data — the org login
  still governs access.
- **Booking attribution is unchanged.** A booked session attributes to the
  booking's `staff_id` (authoritative); active staff only pre-fills the walk-in
  picker (still overridable in the Review screen).
- **A PIN is always required to switch into a profile.**

## Components

### 1. Active-staff resolution + persistence (`src/lib/staff.ts` + a server action)

- New `getActiveStaffId(): Promise<string | null>` — reads the `active_staff_id`
  cookie, validates it against `getStaffList()` (the org roster); returns the id
  if present, else returns null. If the cookie is set but not in the roster
  (deleted staff / wrong tenant), it is treated as absent. **Replaces** the
  temporary `getCurrentUserStaffId` shim.
- New server action `setActiveStaff(staffId, pin)` (`src/actions/active-staff.ts`):
  calls `verifyStaffPin(staffId, pin)`; on `{ valid: true }` writes the
  `active_staff_id` cookie (httpOnly, sameSite=lax, path=/) and returns success;
  otherwise returns an error. The cookie is **only ever written after a successful
  PIN verification**.
- `clearActiveStaff()` server action — deletes the cookie (used by "switch out"
  and wired into the existing logout).

**Why this cookie is safe now (vs. the one we removed):** attribution no longer
*depends* on it (bookings carry their own staff; the save path re-validates
`staffId` against the roster server-side); it is roster-validated on every read;
and it is only set after PIN verification. A stale value degrades to "no active
staff," never to an FK violation.

### 2. Top bar (`src/components/layout/top-bar.tsx` — new)

A slim top bar rendered in the app layout (`(app)/layout.tsx`). Right-aligned
**active-staff chip**: avatar + name when set, or "Select staff" when not. Clicking
it opens the switcher overlay. The **sidebar** bottom chip reverts to showing the
**org** (orgName + logout) — org identity and active-staff identity are now
distinct surfaces.

### 3. Switcher overlay (`src/components/staff/StaffSwitcher.tsx` — new)

A full-width overlay (Netflix-style) showing a grid of roster staff (avatar +
name) from `getStaffList()`. Selecting a staff opens the PIN step. Includes a
"switch out" action (clears active staff).

### 4. PIN pad + first-time set (`src/components/staff/PinPad.tsx` — new; reuse `PinSetup` patterns)

- 4-digit entry → `setActiveStaff(staffId, pin)`. Wrong PIN → inline error, clear,
  retry.
- **First-time (inline):** if the selected staff has no PIN (`hasStaffPin(staffId)`
  is false), the pad switches to "set a 4-digit PIN for {name}" → `setStaffPin`,
  then immediately sets them active. (v1 accepts that anyone at the device can set
  an unset staff's first PIN; owners can pre-set PINs in Settings.)

### 5. Attribution + filter integration (absorbs staff-org-roster Phase 4)

- Replace all `getCurrentUserStaffId` consumers with `getActiveStaffId`:
  `appointments/page.tsx` (default column + "Mine" filter), `settings/page.tsx`
  (owner highlight), `dashboard/page.tsx` (the `activeStaffId` passed to
  `RecordingPanel`), the sidebar/session source in `(app)/layout.tsx`, and the
  record page (`sessions/page.tsx`).
- **Record page no-booking case:** `sessions/page.tsx` passes `getActiveStaffId()`
  so `RecordPageView`/`ReviewScreen` pre-select the active staff in the staff
  picker when there's no booking (still overridable). Booked sessions unchanged.
- Delete the temporary `getCurrentUserStaffId` shim once consumers are migrated.

## Edge cases

- **No active staff:** top-bar chip shows "Select staff"; the no-booking record
  picker starts empty (manual pick required); Appointments default column falls
  back to the first roster member; "Mine" filter shows a prompt to pick a staff.
- **Stale cookie (deleted staff / tenant mismatch):** ignored + cleared on read.
- **Logout:** `clearActiveStaff()` clears the cookie.
- **synqed-core down:** `getStaffList()` returns [] → `getActiveStaffId()` returns
  null (can't validate) → switcher shows "Select staff"; consistent with the
  empty-roster guard already in the save path.

## Testing

- Unit: `getActiveStaffId` — valid cookie in roster → id; cookie not in roster →
  null; no cookie → null; empty roster → null.
- Integration: `setActiveStaff` writes the cookie **only** when `verifyStaffPin`
  returns valid; returns an error and writes nothing on invalid PIN; first-time
  path calls `setStaffPin` then sets active.
- A guard test: the cookie is never written without a passing PIN check.

## Out of scope (v1)

- Access control / permissions / per-staff data scoping (lightweight identity only).
- Cross-device active-staff sync.
- Idle auto-logout / re-PIN after inactivity.
- Re-PIN gating for sensitive actions (delete/edit others' records).

## Success criteria

1. A top-bar chip shows the active staff (or "Select staff"); clicking opens a
   grid of roster staff.
2. Switching requires a correct PIN; a PIN-less staff is prompted to set one inline,
   then becomes active.
3. The active staff persists across page loads and is cleared on logout.
4. A stale/foreign `active_staff_id` cookie never attributes or errors — it resolves
   to "no active staff."
5. Recording a **walk-in** (no booking) pre-selects the active staff in the Review
   picker; recording against a **booking** still attributes to the booking's staff.
6. The Appointments "Mine" filter reflects the active staff.
7. The `getCurrentUserStaffId` shim is gone; all consumers use `getActiveStaffId`.
8. `npm run type-check` clean and the test suite green.
