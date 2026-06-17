// The cancel-sweep planner for the karute QR sync: decide which existing karute
// appointments to mark CANCELLED because their QuickReserve reservation is no
// longer live (cancelled/removed upstream). QuickReserve is the source of truth.
//
// This is PURE and the ONLY place the cancel decision is made, because a sweep
// that gets it wrong DELETES a day of real bookings from every screen. Every
// guard the council demanded lives here and is unit-tested directly:
//   1. QR-OWNED ONLY  — never a manual booking.
//   2. SCHEDULED ONLY — never IN_PROGRESS (live session) / COMPLETED / already-
//      CANCELLED.
//   3. IN-WINDOW + DAY-SUCCESS — only rows in a day whose QR fetch genuinely
//      succeeded (the route only adds succeeded days to `sweepDays`).
//   4. VALIDITY GATE  — never derive cancellations from a suspiciously empty or
//      partial day (a degraded QR response must not look like "all cancelled").
//   5. PER-RUN CAP    — a hard ceiling; if a run would cancel too many, cancel
//      NOTHING and surface an error instead of cascading.

import type { Appointment } from '@synqed-kk/client'
import { parseQrId } from './qr-notes'

/** JST day bounds in epoch ms. Single-sourced so the sweep's candidate window
 *  and the QR fetch's day window are the identical instant (closes the JST/UTC
 *  edge gap where a 00:00 / 23:59 slot is listed but not fetched). */
export function jstDayBoundsMs(dateStr: string): { loMs: number; hiMs: number } {
  return {
    loMs: new Date(`${dateStr}T00:00:00+09:00`).getTime(),
    hiMs: new Date(`${dateStr}T23:59:59.999+09:00`).getTime(),
  }
}

/**
 * A row the sweep is allowed to cancel: QR-owned AND still SCHEDULED. QR-owned =
 * source QUICKRESERVE (new rows) OR a row that still carries the `QR #<id>` notes
 * prefix (back-compat for rows synced before source-tagging — they're MANUAL).
 * A bare MANUAL row with no prefix (a real walk-in) is NEVER sweepable, so a
 * hand-typed memo that happens to start `QR #123 |` is the only residual risk —
 * bounded by the validity gates + the per-run cap, and removed once source is
 * backfilled.
 */
export function isSweepable(a: Appointment): boolean {
  if (a.status !== 'SCHEDULED') return false
  if (parseQrId(a.notes) === null) return false
  return a.source === 'QUICKRESERVE' || a.source === 'MANUAL'
}

export interface SweepDay {
  dateStr: string
  /** Non-deleted QR reservation ids returned for this day (the live set). */
  liveQrIds: Set<string>
  /** Raw count of reservations QR returned (incl. deleted) — distinguishes a
   *  genuinely empty day from a suspiciously empty one. */
  reservationsCount: number
}

export interface SweepPlan {
  toCancel: string[]
  capExceeded: boolean
  cancelCount: number
  skippedDays: { dateStr: string; reason: 'empty-but-populated' | 'partial-suspect' }[]
}

export interface PlanQrCancellationsArgs {
  /** Whole-window existing snapshot (same one the keyer used). */
  allExisting: Appointment[]
  /** One entry per day whose QR fetch SUCCEEDED (errored days are excluded by
   *  the caller, so their rows are never judged). */
  sweepDays: SweepDay[]
  /** Appointment ids created/updated this run — excluded (their reservation is
   *  live by definition). */
  matchedIds: Set<string>
  /** Loser ids from a duplicate QR id (an orphan left by an earlier move). */
  staleDuplicateIds: string[]
  maxCancels?: number
  /** Skip a day whose live set covers less than this fraction of its existing
   *  QR-owned SCHEDULED rows (partial-fetch guard). */
  partialMinFraction?: number
  /** Cap the run at this fraction of the window's QR-owned SCHEDULED rows. */
  capFraction?: number
  /** Floor below which the fraction cap never trips — so a legitimate handful of
   *  cancellations on a small window (or a brand-new tenant) always applies. */
  minCapFloor?: number
}

/**
 * Compute the set of appointment ids to soft-cancel. Returns capExceeded=true
 * (and an EMPTY toCancel) when the run would cancel implausibly many rows — the
 * universal backstop. The caller cancels nothing in that case and records an
 * error.
 */
export function planQrCancellations({
  allExisting,
  sweepDays,
  matchedIds,
  staleDuplicateIds,
  maxCancels = 10,
  partialMinFraction = 0.5,
  capFraction = 0.4,
  minCapFloor = 3,
}: PlanQrCancellationsArgs): SweepPlan {
  const toCancel = new Set<string>()
  const skippedDays: SweepPlan['skippedDays'] = []

  for (const day of sweepDays) {
    const { loMs, hiMs } = jstDayBoundsMs(day.dateStr)
    const dayRows = allExisting.filter((a) => {
      const t = new Date(a.starts_at).getTime()
      return t >= loMs && t <= hiMs && isSweepable(a)
    })
    if (dayRows.length === 0) continue

    // VALIDITY GATES — never derive cancellations from a suspect day. A degraded
    // QR response (silent empty / truncated) must not be read as "all cancelled".
    const suspectEmpty = day.reservationsCount === 0
    const suspectPartial = day.liveQrIds.size < partialMinFraction * dayRows.length
    if (suspectEmpty || suspectPartial) {
      skippedDays.push({ dateStr: day.dateStr, reason: suspectEmpty ? 'empty-but-populated' : 'partial-suspect' })
      continue
    }

    for (const a of dayRows) {
      const id = parseQrId(a.notes)!
      if (!day.liveQrIds.has(id) && !matchedIds.has(a.id)) toCancel.add(a.id)
    }
  }

  // Orphan duplicates (losers of a duplicate QR id) — cancel if still sweepable.
  const byId = new Map(allExisting.map((a) => [a.id, a]))
  for (const id of staleDuplicateIds) {
    const row = byId.get(id)
    if (row && isSweepable(row) && !matchedIds.has(id)) toCancel.add(id)
  }

  // PER-RUN CAP — the single backstop bounding every false-cancel class at once.
  // Trips on an absolute count OR a high proportion of the window, but never
  // below minCapFloor (so a small/new tenant's legitimate cancellations apply).
  const totalSweepable = allExisting.filter(isSweepable).length
  const capExceeded =
    toCancel.size > maxCancels ||
    toCancel.size > Math.max(minCapFloor, capFraction * totalSweepable)

  return {
    toCancel: capExceeded ? [] : [...toCancel],
    capExceeded,
    cancelCount: capExceeded ? 0 : toCancel.size,
    skippedDays,
  }
}
