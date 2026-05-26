// ─────────────────────────────────────────────────────────────
// Scheduled deletions — types
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/lib/scheduled-deletions.ts
// APPI-aligned 30-day soft-delete window for customer records.

export const SCHEDULED_DELETION_WINDOW_DAYS = 30

export interface ScheduledDeletion {
  /** Customer id — matches Customer.id. */
  customerId: string
  /** ISO timestamp when the deletion was scheduled. */
  scheduledAt: string
  /** Staff who triggered. In prod this is auth.uid(). */
  scheduledBy: string
}

/** Computed helper — null fields when the customer isn't scheduled. */
export interface ScheduledDeletionStatus {
  isScheduled: boolean
  scheduledAt: string | null
  daysRemaining: number | null
  hardDeleteAt: string | null
}
