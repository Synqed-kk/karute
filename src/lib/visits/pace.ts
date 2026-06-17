// ─── 来店ペース — the customer-page visit cadence, computed HONESTLY ──────────
//
// One rule the council fixed: advice and evidence must rise/fall TOGETHER. So
// everything the card shows — the average interval, the まだ/そろそろ/空きすぎ
// verdict, the segment chip, and whether the tactic may appear — is derived from
// ONE computation over the reconciled dated visit series. When the dates aren't
// there (the 矢崎 case: a visit_count but no first/last date), this returns a
// `pending` state: the card shows the count + 同期待ち and NO advice. It never
// asserts a cadence it can't show.
//
// The interval uses the LIFETIME visit count (totalVisits − 1) as its
// denominator, not just the synced dated subset (datedVisitCount). Dividing the
// dated span (first→last dated visit) by the full lifetime count recovers the
// true cadence for customers whose undated visits aren't synced yet — e.g. 17
// lifetime visits over an 11-month dated span → ~3 weeks, not ~15 weeks (the
// latter is what datedVisitCount ÷ 4 would give). datedVisitCount is used only
// as an evidence threshold (≥ 2 dated visits required), not the denominator.

import { jstDaysBetween } from '@/lib/date/jst'
import { OVERDUE_FACTOR, JOUREN_MIN_VISITS, type VisitSegment } from './segment'

export interface VisitPaceInput {
  /** Reconciled earliest dated visit (effectiveFirstVisitIso). */
  firstVisitIso: string | null
  /** Reconciled most-recent dated visit (effectiveLastVisitIso). */
  lastVisitIso: string | null
  /** Visits we have DATES for (karute + past appointments) — used as an evidence
   *  threshold (≥ 2 required to establish a span), NOT the interval denominator.
   *  The denominator is totalVisits − 1 (the lifetime count). */
  datedVisitCount: number
  /** Lifetime visit count (customerVisitCount) — display + the 常連 threshold. */
  totalVisits: number
  /** Returning at all (any prior visit / ticket). */
  isReturning: boolean
  /** A terminal staff lifecycle decision (卒業/離客) owns the customer. */
  isTerminal: boolean
}

export type RhythmState = 'on-rhythm' | 'slightly-over' | 'over'

export interface VisitPace {
  /** True when a real interval could be computed from dated visits. Everything
   *  advisory is gated on this. */
  hasDates: boolean
  totalVisits: number
  /** Days since the last dated visit; computable whenever ANY last date exists,
   *  independent of the interval (recency must never be suppressed by a missing
   *  cadence). null only when there's no last-visit date at all. */
  lastVisitAgoDays: number | null
  /** Smoothed 目安 interval: dated span ÷ (totalVisits − 1). null without dates. */
  avgIntervalDays: number | null
  /** Months of visiting history (first dated visit → now). null without dates. */
  spanMonths: number | null
  /** まだ / そろそろ / 空きすぎ reading; null without dates. */
  state: RhythmState | null
  /** Bar fill ratio (lastVisitAgo ÷ interval), clamped; null without dates. */
  ratio: number | null
  /** Evidence-backed segment: 新規 for a first-timer, 常連/安定/離脱気味 ONLY when
   *  dates back it. null = the caller shows 同期待ち (returning, no dates) or the
   *  status chip (terminal). Never asserts 安定 on a date-less customer. */
  segment: VisitSegment | null
  /** Returning customer with no datable cadence → caller renders 同期待ち. */
  pending: boolean
}

export function computeVisitPace(input: VisitPaceInput, now: Date = new Date()): VisitPace {
  const { firstVisitIso, lastVisitIso, datedVisitCount, totalVisits, isReturning, isTerminal } = input

  const lastVisitAgoDays = lastVisitIso ? jstDaysBetween(lastVisitIso, now) : null

  let avgIntervalDays: number | null = null
  let spanMonths: number | null = null
  let state: RhythmState | null = null
  let ratio: number | null = null

  const spanDays =
    firstVisitIso && lastVisitIso ? jstDaysBetween(firstVisitIso, new Date(lastVisitIso)) : 0
  // Need real dated evidence (≥2 dated visits + a real span) AND a lifetime count
  // to average over.
  const hasEvidence =
    !!firstVisitIso && !!lastVisitIso && datedVisitCount >= 2 && totalVisits >= 2 && spanDays > 0

  let hasDates = false
  if (hasEvidence) {
    // Average over the LIFETIME visit count, not just the synced subset — so the
    // interval matches the "{totalVisits}回 / 過去Nヶ月" the card shows and isn't
    // skewed long by how FEW visits happen to carry dates (the 約14週-vs-17回/11ヶ月
    // mismatch: 4 synced dates over 11mo read as 14週, but 17 visits over 11mo is
    // really ~3週). dividing the dated span by the lifetime count recovers the
    // true cadence whenever first/last bound the visiting period.
    const interval = Math.round(spanDays / (totalVisits - 1))
    // A sub-weekly result means the dates are incomplete (e.g. only recent visits
    // synced under a high lifetime count) — implausible for a salon, so rather
    // than assert a wrong cadence, fall through to the 同期待ち / count-only state.
    if (interval >= 7) {
      hasDates = true
      avgIntervalDays = interval
      spanMonths = Math.max(1, Math.round(jstDaysBetween(firstVisitIso!, now) / 30))
      if (lastVisitAgoDays != null) {
        ratio = lastVisitAgoDays / avgIntervalDays
        state = ratio <= 1 ? 'on-rhythm' : ratio <= OVERDUE_FACTOR ? 'slightly-over' : 'over'
        ratio = Math.min(ratio, 2.5)
      }
    }
  }

  let segment: VisitSegment | null = null
  if (isTerminal) segment = null
  else if (!isReturning) segment = 'shinki'
  else if (hasDates) {
    segment = state === 'over' ? 'ridatsugimi' : totalVisits >= JOUREN_MIN_VISITS ? 'jouren' : 'antei'
  } else segment = null

  return {
    hasDates,
    totalVisits,
    lastVisitAgoDays,
    avgIntervalDays,
    spanMonths,
    state,
    ratio,
    segment,
    pending: isReturning && !isTerminal && segment === null,
  }
}
