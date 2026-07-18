// 30-day customer-deletion window (APPI erasure flow). Pure — shared by the
// server actions, the nightly sweep, and the countdown banner, so all three
// agree on ONE deadline. deleted_at (core column, #51) is both the soft-delete
// flag and the clock: timestamp = scheduled, null = active.
export const SCHEDULED_DELETION_WINDOW_DAYS = 30

/** Epoch ms of the hard-delete deadline for a scheduled customer. */
export function hardDeleteDeadlineMs(deletedAt: string): number {
  return new Date(deletedAt).getTime() + SCHEDULED_DELETION_WINDOW_DAYS * 86_400_000
}

/** Whole days until the deadline, clamped to [0, window] — 0 = "deletes
 *  today"; the upper clamp keeps a client clock seconds behind the server
 *  (or a corrupt future timestamp) from rendering "31 days" against copy
 *  promising a 30-day window. */
export function daysRemaining(deletedAt: string, now = Date.now()): number {
  return Math.min(
    SCHEDULED_DELETION_WINDOW_DAYS,
    Math.max(0, Math.ceil((hardDeleteDeadlineMs(deletedAt) - now) / 86_400_000)),
  )
}
