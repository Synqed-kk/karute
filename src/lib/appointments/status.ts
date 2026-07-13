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

// Reason codes for a no-show — core stores whatever raw string is sent in
// status_reason; these are the app's fixed choices (reason chips in the
// no-show sheet). 'no-show-no-contact' is the default selection.
export const NO_SHOW_REASON_NO_CONTACT = 'no-show-no-contact'
export const NO_SHOW_REASON_SAME_DAY_CONTACTED = 'same-day-contacted'
export const NO_SHOW_REASON_FIRST_TIME = 'first-time-no-show'

export const NO_SHOW_REASONS = [
  NO_SHOW_REASON_NO_CONTACT,
  NO_SHOW_REASON_SAME_DAY_CONTACTED,
  NO_SHOW_REASON_FIRST_TIME,
] as const

export type NoShowReason = (typeof NO_SHOW_REASONS)[number]
