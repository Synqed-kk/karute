// 今日の運営 — THE TIMED RELEASE OF A KEPT 新規用 枠: is this 枠 still held, or
// has the clock passed its release cut-off? Pure, no book, no clock of its own.
//
// ⚖ D-11 (Liam 2026-09-13 17:0x, 「Okay let's go with option A」) — a kept 枠 lets
// go when ONLINE BOOKING CLOSES for its start. The hold exists for online new
// customers; the moment online booking closes for that start, the hold has no
// purpose left. The cut-off is therefore LINKED to 「直前の空きは売らない」 and read
// at read time, never copied, so the two can never drift apart. 「解除しない」
// (`beforeMin === null`) is the off value, and it is a real product value rather
// than construction scaffolding — which is why this half of the round has no
// gate of its own.
//
// THE SUBTRACTION IS THE MANUAL RELEASE'S OWN. `reserved-mask.ts:240-242` filters
// the enumerated spans by `laneKey + windowStart` against the manager's released
// list; this is that same filter with a PREDICATE instead of a list. Applied to
// the mask BEFORE the netting, so every seam downstream follows for free and by
// construction: the gap layer un-masks those minutes, `tagHeldBound` stops
// tagging them, the chip and the online 確保 rows drop the 枠, the rest cue stands
// down — exactly what the manual release does today.
//
// IT WRITES NOTHING (⚖ reversible-by-default). It is a derivation, so a wrong
// call is undone by moving the dial; the manager's one-tap way back is the
// explicit KEEP-HELD fact in `keptBack`, stamped exactly as a manual release is
// (the caller pre-filters it by board — this module never asks which board it is
// answering for, and must not start, for the same reason `reservedMaskFor` does
// not).
//
// ⚠ THE BOARD HAS NO CLOCK. `nowMin` is a server prop and the fixture's own
// `boardNow` is a pinned value; there is no tick on this screen. NO TIMER this
// round — a timer on a pinned clock is untestable and would re-render the whole
// board every minute for a fixture that never moves. The release lands on the
// next render; the minute tick belongs to the real-data reconnect, where a clock
// actually moves, and the manual release already covers 「I want it back now」.
//
// NO CYCLE, BY CONSTRUCTION: every import below is a TYPE.

import type { ReleasedWindow, ReservedLaneMask, ReservedSpan } from './reserved-mask'

/** One 枠 the clock let go of, and the cut-off it was let go at — the box on
 *  screen quotes that number rather than re-reading the dial. */
export interface ReleasedRow {
  readonly laneKey: string
  readonly span: ReservedSpan
  readonly beforeMin: number
}

export interface TimedRelease {
  readonly mask: readonly ReservedLaneMask[] | undefined
  readonly released: readonly ReleasedRow[]
}

const NONE: readonly ReleasedRow[] = Object.freeze([])

/** THE RELEASE.
 *
 *  @param mask the per-lane kept 枠, as the enumeration published them.
 *  @param nowMin the board's clock; `null` on a future day, where there is no
 *    「開始まで」 to measure and nothing may release.
 *  @param beforeMin how many minutes before a 枠's start it lets go; `null` is
 *    「解除しない」, this half's own off value.
 *  @param keptBack the manager's 確保を戻す facts, ALREADY scoped to the board
 *    being drawn.
 *
 *  The SAME object back, by identity, when there is nothing to do — a future
 *  day, the dial off, an absent mask, or a clock that has reached nobody's
 *  cut-off. Every reader downstream is then byte-identical to today's board by
 *  construction rather than by a branch somebody maintains.
 */
export function releaseTimed(
  mask: readonly ReservedLaneMask[] | undefined,
  nowMin: number | null,
  beforeMin: number | null,
  keptBack: readonly ReleasedWindow[],
): TimedRelease {
  if (mask === undefined || nowMin === null || beforeMin === null) return { mask, released: NONE }

  const released: ReleasedRow[] = []
  const out = mask.map((m) => {
    const kept: ReservedSpan[] = []
    for (const span of m.spans) {
      const due = nowMin >= span.windowStart - beforeMin
      const heldBack = due && keptBack.some((k) => k.laneKey === m.laneKey && k.windowStart === span.windowStart)
      if (due && !heldBack) released.push({ laneKey: m.laneKey, span, beforeMin })
      else kept.push(span)
    }
    return kept.length === m.spans.length
      ? m
      : Object.freeze({ laneKey: m.laneKey, spans: Object.freeze(kept), protectedCount: kept.length })
  })

  return released.length === 0 ? { mask, released: NONE } : { mask: Object.freeze(out), released: Object.freeze(released) }
}
