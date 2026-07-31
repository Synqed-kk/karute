// 30-day customer-deletion UNDO window. Pure — shared by the server actions
// and the countdown banner so both agree on ONE deadline. deleted_at (core
// column, #51) is both the soft-delete flag and the clock: timestamp =
// deleted-from-app, null = active. NOTHING is ever hard-deleted (Liam ruling
// 2026-07-19: core retains all customer data permanently) — the deadline only
// closes the in-app undo.
export const SCHEDULED_DELETION_WINDOW_DAYS = 30

/** Epoch ms when the in-app undo window closes for a deleted customer. */
export function undoDeadlineMs(deletedAt: string): number {
  return new Date(deletedAt).getTime() + SCHEDULED_DELETION_WINDOW_DAYS * 86_400_000
}

/** Whole days until the deadline, clamped to [0, window] — 0 = "undo ends today"; the upper clamp keeps a client clock seconds behind the server
 *  (or a corrupt future timestamp) from rendering "31 days" against copy
 *  promising a 30-day window. */
export function daysRemaining(deletedAt: string, now = Date.now()): number {
  return Math.min(
    SCHEDULED_DELETION_WINDOW_DAYS,
    Math.max(0, Math.ceil((undoDeadlineMs(deletedAt) - now) / 86_400_000)),
  )
}
