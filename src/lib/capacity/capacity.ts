// ---------------------------------------------------------------------------
// ONE capacity per store-day — the pure leaf module.
//
// Karute's reservation adapter and Business's board both read capacity through
// this file and nothing else computes it (C4 §(3): the 1a adapter is
// screen-shaped — it imports @synqed-kk types — so a shared FACT cannot live
// there without coupling it to one screen). Everything here is arithmetic over
// primitives: no Date parsing, no timezone code, no React, no SDK, no DOM, no
// switches. The CALLER reads the switches and hands instants down; the module
// knows nothing of business types, rosters or stores.
//
// The model is ADJUDICATION-CAPACITY-2026-09-15 (v2), built from council C1
// (data), C2 (personas), C3 (blind spots) and C4 (layers). Each rule below
// cites the edge that forced it.
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000

/** Beds are OUT of this round (C1 §4: zero Resource rows exist and Karute never
 *  writes resource_id; C3 E8: entering beds would have punished correct setup).
 *  'none' = this store-day gets the count table, never a percentage. */
export type LaneKind = 'staff' | 'none'

/** Provenance, not a boolean (C3 E6/E21): an org-blob day is a business-wide
 *  DEFAULT, never a declaration about this store, and the 10:00–24:00 fallback
 *  is not a fact about the day at all. */
export type HoursSource = 'store' | 'org' | 'default'

/** The app's own MonthDensityBucket words minus 'empty'. */
export type Band = 'light' | 'medium' | 'busy'

/** One counted row's interval as CORE enforces it — ends_at − starts_at (E30),
 *  or occupied_until where the adapter has it (C1 §7, E35). Never
 *  duration_minutes, which core stores as an independent nullable column and
 *  never validates against the interval. Absolute ms (UTC instants). */
export interface BookedSpan {
  startMs: number
  endMs: number
  staffId: string | null
}

export interface DayHours {
  /** Absolute instant of this JST day's open. */
  openMs: number
  /** Absolute instant of close (≤ dayEndMs; '24:00' = dayEndMs). */
  closeMs: number
  source: HoursSource
  /** 定休日 / 臨時休業 → capacity null; the bookings still count elsewhere. */
  closed: boolean
}

export interface CapacityInput {
  laneKind: LaneKind
  /** The store's booking roster headcount for the day, or null when the roster
   *  could not be read / there is no store (FAIL CLOSED — C1 §5, C3 E28; the
   *  picker helper's fail-open would hand a 40-person business roster to a
   *  one-store divisor). */
  rosterLanes: number | null
  /** null = unresolved. */
  hours: DayHours | null
  dayStartMs: number
  /** dayStartMs + 86_400_000. */
  dayEndMs: number
  /** Every counted row that INTERSECTS [dayStartMs, dayEndMs) — the caller
   *  fetches from one day EARLY (C1 window-edge leak) and filters by
   *  intersection, not by start day. */
  spans: readonly BookedSpan[]
}

export type NoCapacityReason =
  | 'kind-none'
  | 'roster-unknown'
  | 'no-lanes'
  | 'hours-unresolved'
  | 'closed'
  | 'hours-not-saved'
  | 'outside-hours'
  | 'over-concurrency'

export interface CapacityFact {
  /** lanes × laneMinutes, or null. NEVER 0-as-unknown, NEVER NaN (E10: a brand
   *  new store printed 「NaN% 稼働」 under the design's un-guarded formula). */
  capacityMinutes: number | null
  /** The floor-applied lane count actually used (0 when none). */
  lanes: number
  laneKind: LaneKind
  hoursSource: HoursSource | null
  /** Σ the span's minutes clipped to the JST DAY [dayStartMs, dayEndMs) — the
   *  number 予約時間 prints (R2), NOT the inside-hours-window minutes used
   *  below for occupancy/full/available (those stay clipped to [open, close)
   *  per C3 rule b). A withdrawn day (e.g. 'outside-hours') still reports its
   *  real day minutes here. */
  bookedMinutes: number
  /** Math.round(window ÷ capacity × 100), UNCLAMPED — ≥100 renders 満
   *  (E23/E24). Null whenever capacity is null. Rounded HERE (R4) — the
   *  renderer prints this integer as-is, and `band` reads the SAME integer,
   *  so a percentage can never sit beside a mismatched band label. */
  occupancyPct: number | null
  /** capacityMinutes − windowMinutes < 0.5 (R4: a tolerance, not an exact
   *  `>=` — IEEE drift from summing many spans' minutes can land a fully
   *  tiled window a fraction of a minute under capacity and still means
   *  満). False when there is no capacity. */
  full: boolean
  /** ONE table for every business: <35 light · 35–65 medium · >65 busy (C2 Q2 —
   *  every miscolour in the council's set was an input error, never a
   *  threshold error). Null whenever capacity is null. */
  band: Band | null
  /** Math.round(max(0, capacity − window)) ONLY when hoursSource === 'store'
   *  (E21: an org-blob day is a business default, never this store's
   *  declaration — 稼働 and the band may ride it, 空き may not). Else null. */
  availableMinutes: number | null
  /** Why capacity is null; null when capacity is a number. */
  reason: NoCapacityReason | null
}

/** Minutes of [startMs, endMs) that fall in [fromMs, toMs). */
function overlapMinutes(startMs: number, endMs: number, fromMs: number, toMs: number): number {
  const from = startMs > fromMs ? startMs : fromMs
  const to = endMs < toMs ? endMs : toMs
  return to > from ? (to - from) / MS_PER_MINUTE : 0
}

/** Finite AND forward-running (R1): `closeMs > openMs` alone is false under
 *  NaN just like `closeMs <= openMs` is — both sides of the old either/or
 *  guard missed it, so malformed hours passed through and `laneMinutes`
 *  divided by NaN (「NaN% 稼働」). ONE predicate for both the usability check
 *  and the rule-3 guard. */
function hoursRunForward(openMs: number, closeMs: number): boolean {
  return Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs > openMs
}

/** Finite and forward-running (R9): a NaN/±Infinity instant fails every
 *  `endMs <= startMs` check (NaN and Infinity comparisons are never true),
 *  so it used to pass straight through — hanging `peakConcurrency`'s sweep
 *  (an unbounded pointer chasing an `undefined` array slot) and laundering
 *  into a phantom booking in `capacityForDay`. ONE predicate, used by both. */
function isValidSpan(s: { startMs: number; endMs: number }): boolean {
  return Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs
}

/** inside = the span ∩ [open, close); outside = (the span ∩ [dayStart, dayEnd))
 *  minus inside — the day's own minutes the declared hours do not cover. A span
 *  that does not touch the day yields 0 and 0, so it is never "outside". */
export function clipToWindow(
  span: BookedSpan,
  openMs: number,
  closeMs: number,
  dayStartMs: number,
  dayEndMs: number,
): { insideMinutes: number; outsideMinutes: number } {
  const insideMinutes = overlapMinutes(span.startMs, span.endMs, openMs, closeMs)
  const dayMinutes = overlapMinutes(span.startMs, span.endMs, dayStartMs, dayEndMs)
  const outsideMinutes = dayMinutes - insideMinutes
  return { insideMinutes, outsideMinutes: outsideMinutes > 0 ? outsideMinutes : 0 }
}

/** The most rows running at the same instant. Touching intervals do not overlap
 *  (10:00–11:00 and 11:00–12:00 peak at 1) — the comparison is strict on both
 *  sides, so a closed bound cannot invent a collision. */
export function peakConcurrency(spans: readonly { startMs: number; endMs: number }[]): number {
  // ponytail: two sorts, O(n log n), over ONE day's counted rows — a few
  // hundred at most. The ceiling is the sort; if a day ever carried tens of
  // thousands of rows, bucket by minute instead.
  const starts: number[] = []
  const ends: number[] = []
  for (const s of spans) {
    // A zero- or negative-length row occupies no instant, and a NaN/±Infinity
    // instant is not a real one (R9) — neither can raise the peak, and
    // letting either through used to deadlock the sweep below.
    if (!isValidSpan(s)) continue
    starts.push(s.startMs)
    ends.push(s.endMs)
  }
  starts.sort((a, b) => a - b)
  ends.sort((a, b) => a - b)

  let peak = 0
  let current = 0
  let i = 0
  let j = 0
  // Bounded on BOTH pointers (R9): with only finite, forward-running spans
  // admitted above the classic invariant (j <= i) holds and this never
  // matters — but a future caller of the internals can no longer spin it.
  while (i < starts.length && j < ends.length) {
    if (starts[i] < ends[j]) {
      current++
      if (current > peak) peak = current
      i++
    } else {
      current--
      j++
    }
  }
  return peak
}

/** The one 35/65 table: 35 → medium, 65 → medium, 65.01 → busy. */
export function bandFor(occupancyPct: number): Band {
  if (occupancyPct < 35) return 'light'
  if (occupancyPct <= 65) return 'medium'
  return 'busy'
}

export function capacityForDay(input: CapacityInput): CapacityFact {
  const hours = input.hours
  // The hours DESCRIBE this day only when a human declared them for a trading
  // day: a missing fact, a 定休日 and the 10:00–24:00 fallback all fail it
  // (E25), and so does a window that does not run forwards. When they fail, the
  // minutes we still report are clipped to the JST day itself rather than to a
  // window nobody meant.
  const usableHours =
    hours != null &&
    !hours.closed &&
    hours.source !== 'default' &&
    hoursRunForward(hours.openMs, hours.closeMs)
  const windowOpenMs = usableHours ? hours.openMs : input.dayStartMs
  const windowCloseMs = usableHours ? hours.closeMs : input.dayEndMs

  // R2: windowMinutes (clipped to [open, close)) drives occupancy/full/free;
  // dayMinutes (clipped to [dayStart, dayEnd)) is what 予約時間 prints on the
  // wire as `bookedMinutes` — a withdrawn day still owes the caller its real
  // minutes, not the hours-window slice of them.
  let windowMinutes = 0
  let dayMinutes = 0
  const counted: {
    startMs: number
    clipStartMs: number
    clipEndMs: number
    endMs: number
    staffId: string | null
    insideMinutes: number
  }[] = []
  for (const span of input.spans) {
    if (!isValidSpan(span)) continue
    const { insideMinutes, outsideMinutes } = clipToWindow(
      span,
      windowOpenMs,
      windowCloseMs,
      input.dayStartMs,
      input.dayEndMs,
    )
    windowMinutes += insideMinutes
    dayMinutes += insideMinutes + outsideMinutes
    counted.push({
      startMs: span.startMs,
      endMs: span.endMs,
      clipStartMs: span.startMs > windowOpenMs ? span.startMs : windowOpenMs,
      clipEndMs: span.endMs < windowCloseMs ? span.endMs : windowCloseMs,
      staffId: span.staffId,
      insideMinutes,
    })
  }

  const hoursSource = hours?.source ?? null
  const withoutCapacity = (reason: NoCapacityReason, lanes = 0): CapacityFact => ({
    capacityMinutes: null,
    lanes,
    laneKind: input.laneKind,
    hoursSource,
    bookedMinutes: dayMinutes,
    occupancyPct: null,
    full: false,
    band: null,
    availableMinutes: null,
    reason,
  })

  // 1. Class-bound types are mapped to 'none' by the CALLER (C1 §6) — the
  //    module never sees a business type. The count-table surfaces still get
  //    the day's 予約時間.
  if (input.laneKind === 'none') return withoutCapacity('kind-none')

  // 2. Fail CLOSED on an unreadable roster (C1 §5 / C3 E28).
  if (input.rosterLanes === null) return withoutCapacity('roster-unknown')

  // 3. The hours, in precedence order.
  if (hours == null) return withoutCapacity('hours-unresolved')
  if (hours.closed) return withoutCapacity('closed')
  if (hours.source === 'default') return withoutCapacity('hours-not-saved')
  // A window that does not run forwards — including NaN/Infinity, which the
  // old `closeMs <= openMs` phrasing let through (R1) — is not hours;
  // dividing by it is the NaN E10 forbids.
  if (!hoursRunForward(hours.openMs, hours.closeMs)) return withoutCapacity('hours-unresolved')

  // 4. A booking that STARTS today must fit inside today's declared hours. A
  //    row that ran in from last night NEVER withdraws today (R3 — the lead
  //    re-rules over the 12:5x D-1 amendment's second sentence: one late-night
  //    booking blanks one day, not two; it already withdraws the day it
  //    starts on, and the door fix prevents the app creating the class).
  for (const s of counted) {
    const startsToday = s.startMs >= input.dayStartMs && s.startMs < input.dayEndMs
    if (startsToday && (s.startMs < windowOpenMs || s.endMs > windowCloseMs)) {
      return withoutCapacity('outside-hours')
    }
  }

  // 5. A FLOOR, never a ceiling (C3 rule c): the owner who cuts (E11) and the
  //    helper off the roster (E2) each add a lane, and a day nobody booked
  //    keeps its full capacity.
  const worked = new Set<string>()
  for (const s of counted) {
    if (s.insideMinutes > 0 && s.staffId != null) worked.add(s.staffId)
  }
  const lanes = input.rosterLanes > worked.size ? input.rosterLanes : worked.size
  if (lanes <= 0) return withoutCapacity('no-lanes')

  // 6. Overlap means the LANE COUNT is wrong for that day, at 1 lane or at 6
  //    (C3 rule a; subsumes the shipped solo !hasOverlap guard — E3/E31).
  //    Unassigned rows count like any other (E14).
  const insideSpans = counted
    .filter((s) => s.insideMinutes > 0)
    .map((s) => ({ startMs: s.clipStartMs, endMs: s.clipEndMs }))
  if (peakConcurrency(insideSpans) > lanes) return withoutCapacity('over-concurrency', lanes)

  // 7. The numbers. Never clamped, never withdrawn above 100% (C3 §3.4 / E24):
  //    the fact stays a number and `full` says 満. Rounded ONCE, here (R4):
  //    the renderer prints occupancyPct as-is and the band reads the SAME
  //    integer, so a percentage can never sit beside a mismatched band.
  const laneMinutes = (hours.closeMs - hours.openMs) / MS_PER_MINUTE
  const capacityMinutes = lanes * laneMinutes
  const occupancyPct = Math.round((windowMinutes / capacityMinutes) * 100)
  const free = Math.round(Math.max(0, capacityMinutes - windowMinutes))
  return {
    capacityMinutes,
    lanes,
    laneKind: input.laneKind,
    hoursSource,
    bookedMinutes: dayMinutes,
    occupancyPct,
    // A tolerance, not an exact >= (R4): summing many spans' minutes can
    // drift a fully tiled window a fraction of a minute under capacity in
    // floating point, and that is still 満.
    full: capacityMinutes - windowMinutes < 0.5,
    band: bandFor(occupancyPct),
    availableMinutes: hours.source === 'store' ? free : null,
    reason: null,
  }
}
