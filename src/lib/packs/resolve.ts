// Pack-alert resolution — the ONE place the "who needs attention" rules live
// (chopstick rule: every surface — customer list, dashboard, profile, alert
// page — calls these; none re-derives its own version).
//
// Rules from the 2026-06-09 Kitano meeting:
// - contact: holds unused pack sessions + has NO next booking + hasn't visited
//   in `thresholdDays`+ days (default 20; configurable in settings later).
//   → "contact this customer so they come back and use their tickets."
// - low: exactly 1 counted-pack session left → "suggest the next pack" moment.
// Lifecycle 卒業/離客 customers are excluded by the caller (they're not
// expected back).

export type PackAlertLevel = 'contact' | 'low' | null

export interface PackAlertInput {
  /** Remaining sessions across ACTIVE counted packs (kind='pack'). */
  remainingTotal: number
  hasActivePack: boolean
  daysSinceLastVisit: number | null
  hasNextBooking: boolean
  /** 卒業/離客 are never alerted. */
  lifecycleStatus?: 'active' | 'graduated' | 'lost'
  thresholdDays?: number
}

export const DEFAULT_CONTACT_THRESHOLD_DAYS = 20

export function resolvePackAlert(i: PackAlertInput): PackAlertLevel {
  if (i.lifecycleStatus === 'graduated' || i.lifecycleStatus === 'lost') return null
  const threshold = i.thresholdDays ?? DEFAULT_CONTACT_THRESHOLD_DAYS
  if (
    i.hasActivePack &&
    i.remainingTotal > 0 &&
    !i.hasNextBooking &&
    i.daysSinceLastVisit != null &&
    i.daysSinceLastVisit >= threshold
  ) {
    return 'contact'
  }
  if (i.hasActivePack && i.remainingTotal === 1) return 'low'
  return null
}

/** Whole days since an ISO timestamp (JST-day granularity is overkill here —
 *  the sheet's 空き日数 is calendar-day math; UTC-day flooring matches within
 *  ±1 day, which the threshold comparison absorbs). null for no visits. */
export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000))
}
