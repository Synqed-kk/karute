// ─── Visit-frequency SIGNALS, SEGMENT, and closing-TACTIC — single source ─────
//
// A SEPARATE axis from the lifecycle status (新規/継続中/休眠/卒業/離客 in
// list-enrich.ts). That axis answers "where is this customer in their journey";
// THIS one answers "given how often they come + whether they hold a 回数券, how
// should the staff close THIS session". Both are derived once and shared so no
// surface re-computes (and disagrees with) the other.
//
// DATA REALITY (2026-06): there is no per-visit history table populated yet —
// only the QR scalars visit_count / first_visit_at / last_visit_at /
// has_ticket_pack. So avgIntervalDays here is a SMOOTHED 目安 (today−firstVisit
// ÷ visits), NOT a measured cadence; it is null whenever we can't honestly
// estimate it (<2 visits or no first-visit date). Never fabricate a number.
// When the historical crawler + a GET visits endpoint land, the real per-visit
// timeline replaces the 目安 — the segment/tactic logic here is unaffected.

import { jstDaysBetween } from '@/lib/date/jst'
import {
  customerVisitCount,
  isReturningCustomer,
  type CustomerStatusSignals,
} from '@/lib/customers/list-enrich'

/** A customer running clearly LONGER than their own usual interval counts as
 *  drifting (離脱気味). 1.5× their 目安 interval — a flat 90-day rule (休眠) can't
 *  see that a weekly regular at 3 weeks is already slipping. */
export const OVERDUE_FACTOR = 1.5
/** 来店回数 at/above which a returning, on-rhythm customer reads as 常連. */
export const JOUREN_MIN_VISITS = 10

export type VisitSegment = 'jouren' | 'antei' | 'ridatsugimi' | 'shinki'

/** Semantic tone per segment — the ONE place the color role is decided, so the
 *  chip / tactic strip / dot all agree. UI maps these to its theme tokens. */
export const SEGMENT_TONE: Record<VisitSegment, 'success' | 'neutral' | 'warning' | 'info'> = {
  jouren: 'success',
  antei: 'neutral',
  ridatsugimi: 'warning',
  shinki: 'info',
}

export interface VisitSignalsInput extends CustomerStatusSignals {
  /** First visit date — needed for the avg-interval 目安. Threaded through the
   *  enrich + brief inputs in PR0; absent → avgIntervalDays stays null. */
  firstVisitIso?: string | null
}

export interface VisitSignals {
  /** Strongest visit-count evidence we have — same rule as every other surface. */
  totalVisits: number
  /** JST calendar days since last visit; null when never visited. */
  lastVisitAgoDays: number | null
  /** SMOOTHED average interval in days (目安, NOT measured): (today−firstVisit)
   *  ÷ visits. null when <2 visits or no first-visit date — never fabricated. */
  avgIntervalDays: number | null
  /** True first-timer (no prior history of any kind). */
  isFirstVisit: boolean
}

export interface VisitRhythm {
  daysSince: number
  avgIntervalDays: number
  /** elapsed ÷ usual interval. 1 = bang on rhythm, >1 = overdue. Clamped so a
   *  long-absent customer can't blow the bar geometry off the end. */
  ratio: number
  state: 'on-rhythm' | 'slightly-over' | 'over'
}

/** Compute the raw visit signals from the QR scalars we have today. Pure;
 *  `now` is injectable for deterministic tests. */
export function computeVisitSignals(
  s: VisitSignalsInput,
  now: Date = new Date(),
): VisitSignals {
  const totalVisits = customerVisitCount(s)
  const lastVisitAgoDays = s.lastVisitIso ? jstDaysBetween(s.lastVisitIso, now) : null

  // The average interval uses the QR visit_count ALONE — the scalar that
  // first_visit_at / last_visit_at are derived from — so the numerator and
  // denominator share ONE source. totalVisits is a MAX over karute + appointments
  // too; dividing a QR-bounded span by it would compress the interval and
  // mis-fire 離脱気味 for a customer with more karute records than QR visits.
  // It's the gap between consecutive QR visits across the visiting PERIOD
  // (first→last), over (visits − 1) intervals — not first→now, which would
  // fold today's open gap back into the baseline it's being compared against.
  let avgIntervalDays: number | null = null
  const qrVisits = s.visitCount ?? 0
  if (qrVisits >= 2 && s.firstVisitIso && s.lastVisitIso) {
    const span = jstDaysBetween(s.firstVisitIso, new Date(s.lastVisitIso))
    if (span > 0) avgIntervalDays = Math.max(1, Math.round(span / (qrVisits - 1)))
  }

  return {
    totalVisits,
    lastVisitAgoDays,
    avgIntervalDays,
    isFirstVisit: !isReturningCustomer(s),
  }
}

/** The closing-tactic SEGMENT. Returns null when a terminal lifecycle decision
 *  (卒業/離客) owns the customer — those are staff calls that outrank cadence, so
 *  the caller keeps showing the lifecycle status chip instead of a frequency
 *  segment (a 離客 customer must never read as 常連). */
export function classifyVisitSegment(
  s: VisitSignalsInput,
  now: Date = new Date(),
): VisitSegment | null {
  if (s.lifecycleStatus === 'graduated' || s.lifecycleStatus === 'lost') return null
  if (!isReturningCustomer(s)) return 'shinki'

  const sig = computeVisitSignals(s, now)
  // Drifting relative to THEIR OWN rhythm beats the raw count: a 12-visit
  // regular 1.5× past their usual interval is 離脱気味, not 常連.
  if (
    sig.avgIntervalDays != null &&
    sig.lastVisitAgoDays != null &&
    sig.lastVisitAgoDays > sig.avgIntervalDays * OVERDUE_FACTOR
  ) {
    return 'ridatsugimi'
  }
  if (sig.totalVisits >= JOUREN_MIN_VISITS) return 'jouren'
  return 'antei'
}

/** Bar geometry for the 来店リズム panel. null when there's no honest rhythm to
 *  plot (no 目安 interval or never visited) — the UI then shows nothing, not a
 *  fabricated bar. */
export function computeVisitRhythm(
  s: VisitSignalsInput,
  now: Date = new Date(),
): VisitRhythm | null {
  const sig = computeVisitSignals(s, now)
  // avgIntervalDays is already Math.max(1, …) when present, so a non-null value
  // is always ≥ 1 — only the null checks are needed.
  if (sig.avgIntervalDays == null || sig.lastVisitAgoDays == null) {
    return null
  }
  const ratio = sig.lastVisitAgoDays / sig.avgIntervalDays
  const state: VisitRhythm['state'] =
    ratio <= 1 ? 'on-rhythm' : ratio <= OVERDUE_FACTOR ? 'slightly-over' : 'over'
  return {
    daysSince: sig.lastVisitAgoDays,
    avgIntervalDays: sig.avgIntervalDays,
    ratio: Math.min(ratio, 2.5),
    state,
  }
}

/** segment × 回数券有無 → a stable tactic key. The Japanese copy for each key is
 *  owned by next-intl (PR2), keyed by THIS enum, so the compliance-locked tactic
 *  set lives in exactly one place and a callsite can only pick a key, never
 *  invent a string. 新規 doesn't vary by ticket → one key. */
export type TacticKey =
  | 'jouren_pack'
  | 'jouren_nopack'
  | 'antei_pack'
  | 'antei_nopack'
  | 'ridatsugimi_pack'
  | 'ridatsugimi_nopack'
  | 'shinki'

export function visitTacticKey(segment: VisitSegment, hasTicketPack: boolean): TacticKey {
  if (segment === 'shinki') return 'shinki'
  return `${segment}_${hasTicketPack ? 'pack' : 'nopack'}` as TacticKey
}
