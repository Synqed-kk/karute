import type { AppointmentStatus } from '@synqed-kk/client'

// core ships NO_SHOW since synqed-core #39 (merged, in prod); the installed
// @synqed-kk/client 1.11.0 types still only declare the pre-#39 5-state union
// (SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED — no NO_SHOW). AppStatus is the
// app-side truth until the SDK catches up.
export type AppStatus = AppointmentStatus | 'NO_SHOW'

/**
 * Terminal = the booking is done and its slot is free (CANCELLED or
 * NO_SHOW). Every "is this booking still active" check in the app must go
 * through this — comparing to 'CANCELLED' alone lets a NO_SHOW row leak into
 * flows (agenda, recording target, pack reconcile) that assume only live
 * bookings remain. Takes `string`, not AppStatus, so callers holding the
 * stale SDK's narrower AppointmentStatus type can pass it without a
 * TS "no overlap" comparison error.
 */
export function isTerminalStatus(status: string): boolean {
  return status === 'CANCELLED' || status === 'NO_SHOW'
}

// status_reason codes. Core stores whatever raw string is sent — these are
// the app's fixed vocabularies (Liam's taxonomy fix, 2026-07-10):
//
//   CANCELLED — the customer (or the salon) COMMUNICATED; the optional chips
//   record how: advance contact / same-day contact / salon-initiated.
//   NO_SHOW — by definition no contact + no arrival, so it carries the ONE
//   fixed code and the sheet asks nothing (first-time/repeat is DERIVED from
//   no_show_count, never staff-declared).
//
// The two legacy codes below the marker are kept ONLY so rows recorded before
// the fix still render a label (they were choices inside the no-show section
// until 2026-07-10 — 'same-day-contacted' no-shows from that window are
// really same-day cancels; flagged to Anthony for a one-off backfill).
export const NO_SHOW_REASON_NO_CONTACT = 'no-show-no-contact'
/** @deprecated legacy display only — never offered or accepted for new rows */
export const NO_SHOW_REASON_SAME_DAY_CONTACTED = 'same-day-contacted'
/** @deprecated legacy display only — never offered or accepted for new rows */
export const NO_SHOW_REASON_FIRST_TIME = 'first-time-no-show'

export const LEGACY_NO_SHOW_REASONS = [
  NO_SHOW_REASON_SAME_DAY_CONTACTED,
  NO_SHOW_REASON_FIRST_TIME,
] as const

export const CANCEL_REASON_ADVANCE_CONTACT = 'cancel-advance-contact'
export const CANCEL_REASON_SAME_DAY_CONTACT = 'cancel-same-day-contact'
export const CANCEL_REASON_SALON_INITIATED = 'cancel-salon-initiated'

export const CANCEL_REASONS = [
  CANCEL_REASON_ADVANCE_CONTACT,
  CANCEL_REASON_SAME_DAY_CONTACT,
  CANCEL_REASON_SALON_INITIATED,
] as const

export type CancelReason = (typeof CANCEL_REASONS)[number]

/** Every code that may appear in a stored status_reason — new vocabularies
 *  plus the legacy no-show chips — for display-label lookups. */
export const ALL_STATUS_REASONS = [
  NO_SHOW_REASON_NO_CONTACT,
  ...LEGACY_NO_SHOW_REASONS,
  ...CANCEL_REASONS,
] as const
