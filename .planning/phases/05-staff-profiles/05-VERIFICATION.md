---
phase: 05-staff-profiles
verified: 2026-03-14T18:15:00Z
status: passed
score: 3/3 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 2/3
  gaps_closed:
    - "Every saved karute record displays the name of the staff member who created it"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Create a karute record, then view the detail page and the customer's history list"
    expected: "Staff member's name is visible on both the karute detail view and the history list row"
    why_human: "Requires a running app with a staff member selected and a karute record saved"
---

# Phase 5: Staff Profiles Verification Report

**Phase Goal:** Multiple staff members can be represented in the system, a staff member can be selected in the header without re-authenticating, and every karute record shows which staff member created it.
**Verified:** 2026-03-14T18:15:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plan 05-04)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin can create and edit staff profiles (name, display info) in the Settings page | VERIFIED | Settings page fetches `getStaffList` + `getActiveStaffId` server-side, passes to `StaffList`. `StaffList` and `StaffForm` are fully implemented with create/edit/delete, Active badge, "Added [date]" metadata, toast feedback, and loading spinner |
| 2 | User can switch the active staff member from the header switcher without logging out | VERIFIED | `StaffSwitcher` renders a dropdown with all staff, calls `setActiveStaff()` Server Action on click. Layout auto-selects first alphabetical staff when no cookie exists. Cookie has 30-day maxAge |
| 3 | Every saved karute record displays the name of the staff member who created it | VERIFIED | `getKaruteRecord()` now joins `profiles:staff_profile_id ( id, full_name )`. `KaruteHeader.tsx` reads `karute.profiles?.full_name` and renders it in a labelled `<div>`. `KaruteHistoryList.tsx` renders `record.profiles?.full_name` with fallback. Customer profile page query also joins profiles |

**Score:** 3/3 truths verified

---

## Required Artifacts

### Plan 01 — Data Layer

| Artifact | Status | Details |
|----------|--------|---------|
| `src/actions/staff.ts` | VERIFIED | All four exports present: `createStaff`, `updateStaff`, `deleteStaff`, `setActiveStaff`. Cookie written with httpOnly: false, sameSite: lax, 30-day maxAge |
| `src/lib/staff.ts` | VERIFIED | `getStaffList`, `getStaffById`, `getActiveStaffId` all present and wired to Supabase |
| `src/lib/validations/staff.ts` | VERIFIED | `staffProfileSchema` with name (min 1, max 100). `StaffProfileInput` exported |
| `supabase/migrations/20260313202738_staff_rls_policies.sql` | VERIFIED | All four CRUD policies present using `to authenticated using (true)` pattern |

### Plan 02 — Settings UI

| Artifact | Status | Details |
|----------|--------|---------|
| `src/app/[locale]/(app)/settings/page.tsx` | VERIFIED | Server Component, fetches `getStaffList` + `getActiveStaffId`, passes to `StaffList` |
| `src/components/staff/StaffList.tsx` | VERIFIED | Shows staff name, "Added [date]", Active badge, Edit/Delete actions, empty state |
| `src/components/staff/StaffForm.tsx` | VERIFIED | Dual-mode create/edit, react-hook-form + zodResolver, loading spinner, toast-only feedback, shadcn Dialog |

### Plan 03 — Switcher + Attribution

| Artifact | Status | Details |
|----------|--------|---------|
| `src/components/staff/StaffSwitcher.tsx` | VERIFIED | DropdownMenu, name-only display, checkmark on active, calls `setActiveStaff` on click, "No Staff" disabled state |
| `src/app/[locale]/(app)/layout.tsx` | VERIFIED | Fetches staff list and active staff ID, auto-selects first alphabetical, passes to StaffSwitcher |
| `src/actions/karute.ts` | VERIFIED | Imports and calls `getActiveStaffId()`, throws if null, uses staffId for `staff_profile_id` insert |

### Plan 04 — Staff Name Display (gap closure)

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/supabase/karute.ts` | VERIFIED | Both the type-reference query and the runtime `getKaruteRecord()` query include `profiles:staff_profile_id ( id, full_name )` on lines 33 and 79 |
| `src/components/karute/KaruteHeader.tsx` | VERIFIED | Reads `karute.profiles?.full_name` via cast (line 21-22), renders in a labelled `<div>` inside the header flex row (lines 45-50). No placeholder comments remain |
| `src/components/customers/KaruteHistoryList.tsx` | VERIFIED | Interface includes `profiles?: { full_name: string } \| null` (line 14). Renders `record.profiles?.full_name` with translation-key fallback (line 82). Placeholder comment from Phase 4 is gone |
| `src/app/[locale]/(app)/customers/[id]/page.tsx` | VERIFIED | History query selects `profiles:staff_profile_id ( full_name )` (line 36), types result as `profiles: { full_name: string } \| null` (line 53), passes records to `KaruteHistoryList` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/actions/staff.ts` | `@/lib/supabase/server` | `createClient` import | WIRED | Line 5 |
| `src/actions/staff.ts` | `next/headers cookies` | `setActiveStaff` writes cookie | WIRED | Line 123: `cookieStore.set('active_staff_id', ...)` |
| `src/lib/staff.ts` | `next/headers cookies` | `getActiveStaffId` reads cookie | WIRED | Line 57: `cookieStore.get('active_staff_id')?.value` |
| `src/app/[locale]/(app)/settings/page.tsx` | `src/lib/staff.ts` | `getStaffList` + `getActiveStaffId` | WIRED | Both imported and called via `Promise.all` |
| `src/components/staff/StaffSwitcher.tsx` | `src/actions/staff.ts` | calls `setActiveStaff` on click | WIRED | Line 59 |
| `src/app/[locale]/(app)/layout.tsx` | `src/lib/staff.ts` | `getStaffList` + `getActiveStaffId` | WIRED | Line 4 |
| `src/actions/karute.ts` | `src/lib/staff.ts` | reads active staff ID from cookie | WIRED | Line 6 import, line 35 call |
| `src/lib/supabase/karute.ts` | `profiles` table | join for staff name display | WIRED | `profiles:staff_profile_id ( id, full_name )` on lines 33 and 79 |
| `src/components/karute/KaruteHeader.tsx` | staff name | renders staff name from karute data | WIRED | Lines 21-22 read `profiles?.full_name`, lines 45-50 render it |
| `src/components/customers/KaruteHistoryList.tsx` | staff name | renders staff name per history row | WIRED | Line 14 interface, line 82 render |
| `src/app/[locale]/(app)/customers/[id]/page.tsx` | `profiles` join | history query joins profiles | WIRED | Line 36 select, line 53 type cast, passed to KaruteHistoryList |

---

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| STAFF-01: Staff profiles manageable from Settings | SATISFIED | Settings page, StaffList, StaffForm all present and wired |
| STAFF-02: Staff switcher in header, no re-auth | SATISFIED | StaffSwitcher in layout, cookie-backed, 30-day persistence |
| STAFF-03: Karute records show creating staff member | SATISFIED | getKaruteRecord joins profiles; KaruteHeader and KaruteHistoryList both render staff name |

---

## Anti-Patterns Found

None. All three blockers from the initial verification have been resolved:

- `KaruteHistoryList.tsx`: Placeholder comment and static label removed. Renders actual staff name.
- `KaruteHeader.tsx`: Staff name section now present and reads from joined profiles data.
- `src/lib/supabase/karute.ts`: Profiles join present in both the type-reference query and the runtime query.

---

## Human Verification Required

### 1. Staff name visible on karute detail and history list

**Test:** With a staff member active, save a karute record for a customer. Open the karute detail page and the customer's profile page.
**Expected:** Staff member's full name appears in the header of the detail page and in the history list row on the customer profile.
**Why human:** Requires a running app with a seeded staff member, active cookie, and a saved karute record. The join and render are both in place — this confirms the data actually flows end-to-end at runtime.

---

_Verified: 2026-03-14T18:15:00Z_
_Verifier: Claude (gsd-verifier)_
