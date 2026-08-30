// 今日の運営 — THE RESERVED MASK (SPEC-SELLING-ENGINE §2), DARK.
//
// WHAT IT IS. One pure builder for the held set: per staff lane, which spans of
// the day are 新規用に確保 — protected windows the store is holding for a new
// client. The law (spec §1) is that BOTH doors read this exact set, so the
// sales door and the staff rail can never disagree about what is held. This
// file is that one derivation home; it is the only place the question is
// answered.
//
// WHAT "HELD" IS, EXACTLY (spec §1, council-corrected). Held is NOT "every
// pocket long enough" — that union reading annihilates the gap layers and is
// not the guard's shipped rule. Held is the GUARD'S OWN CAPACITY SET:
// `protectedCapacity(pocket).beforeStarts` (gap-guard.ts:208-219), the
// earliest-finish greedy maximum set of mutually non-overlapping protected
// windows, computed WITH the bed-feasibility callback so a window no room can
// cover is never held (flag-89's 「a 60-minute pocket never held a 90」,
// generalised).
//
// IT CALLS CANON, IT NEVER COPIES IT. The windows come out of
// `createGapGuard(...).protectedCapacity`, the pockets out of canon's own
// `freePockets`, the occupancy out of the rail path's own `laneSpans` — the
// same three producers `guardRailsFor` consumes (today-interactions.ts:1329,
// :1351). A re-implementation of gap-guard.ts:192-206 here could drift from the
// rail by one lattice step and the two doors would quietly disagree, which is
// the one failure this module exists to make impossible. Zero canon edits.
//
// IT KEEPS NO SECOND CACHE. Bed feasibility is the capacity book's Phase-1
// machinery — `newClientMask` (capacity-ledger.ts:502-520), already built and
// already measured (the 19-41× naive-callback cost is cured there). This file
// holds one mask HANDLE per (lane, length) so the guard's thousands of probes
// per frame do not re-mint a closure each time; every ANSWER is still the
// book's.
//
// IT READS NO CONFIG. Every dial arrives as a parameter — never from
// `opsConfig`, never from a fixture. Same for the world: whatever lane snapshot
// it is handed IS the world it answers for, which is how ONE builder serves the
// two world instances spec §2 requires (the committed board for the sales door,
// the board world for the staff door's verdicts). Locked lanes, an excluded
// card, a hand in flight: all of that is the caller's filter on the snapshot,
// not a second opinion in here.
//
// DARK THIS ROUND (spec §12, E1). Nothing imports it. Its consumer registry
// (emission reconcile, rail/gate verdicts, the explanation layer) lands at E3a.

import { freePockets } from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig, type GuardContext } from '@/business/lib/canon-logic/gap-guard'
import type { BoardLane } from '@/business/lib/today-board'
import type { BedTruth } from './capacity-ledger'
import { laneSpans } from './today-interactions'

/** The store's スキマガード dial — core's `StoreBookingPolicy.gap_guard_mode`,
 *  which defaults OFF. 'off' is not a guard mode, it is the absence of one:
 *  the guard engine itself only knows 'standard' | 'strict'. */
export type GapGuardMode = 'off' | 'standard' | 'strict'

/** ONE held window on one lane.
 *
 *  `windowStart` is the guard's own enumerated start — the value that came back
 *  in `beforeStarts` — kept as the provenance link so a consumer can hand the
 *  guard back its own answer and the equality pin has something to compare.
 *  `start`/`end` are the span to reason and paint over. They coincide today
 *  (`start === windowStart`, `end === start + protected duration`) and the
 *  suite pins that they do; the two names exist so a later round that ever
 *  clips a span cannot silently lose the guard's identity for it. */
export interface ReservedSpan {
  readonly start: number
  readonly end: number
  readonly windowStart: number
}

export interface ReservedLaneMask {
  readonly laneKey: string
  /** In pocket order, then in the guard's own greedy order within a pocket. */
  readonly spans: readonly ReservedSpan[]
  /** The guard's protected capacity for this lane — the count both doors quote.
   *  Derived from `spans`, never counted a second way. */
  readonly protectedCount: number
}

export interface ReservedMaskInput {
  /** THE WORLD. Committed occupancy at E1; a world instance at E3a. */
  lanes: readonly BoardLane[]
  /** The day lattice bounds the pockets are cut against — the same two the rail
   *  hands `freePockets` (`close`, and the clock, `null` on a future day). */
  closeMin: number
  nowMin: number | null
  /** The guard's config, threaded. `null` = a store with no guard configured. */
  guard: GuardConfig | null
  gapGuardMode: GapGuardMode
  /** The capacity book for THIS world — the bed truth the callback answers from. */
  book: BedTruth
}

const EMPTY: readonly ReservedLaneMask[] = Object.freeze([])

/** THE PROTECTED DURATION, resolved canon's way (gap-guard.ts:104-105): the
 *  config's own `protectedDurationMin` whenever the key is present at all —
 *  a present `null` reads as "no protected duration", which is canon's
 *  behaviour and not an oversight — otherwise `newClientSessionMin`.
 *
 *  This feeds the span's END and nothing else: a span's START and its very
 *  existence come from the guard's enumeration, so this cannot invent a window.
 *  The suite pins the resolution against the guard's own greedy step. */
const protectedDurationOf = (config: GuardConfig): number | null | undefined =>
  Object.prototype.hasOwnProperty.call(config, 'protectedDurationMin')
    ? config.protectedDurationMin
    : config.newClientSessionMin

/** Bed feasibility in the shape the guard's ctx asks for (gap-guard.ts:52),
 *  answered entirely by the book's precomputed lattice.
 *
 *  ponytail: the Map caches the mask HANDLE, not answers — the book already
 *  memoises those per (length, store binding). The guard asks once per lattice
 *  step per pocket, so re-minting the closure on every probe is the one cost
 *  worth not paying here. */
function bedFeasibilityFor(book: BedTruth, lane: BoardLane): NonNullable<GuardContext['protectedWindowFeasible']> {
  const handles = new Map<number, (startMin: number) => boolean>()
  return (start, dur) => {
    let mask = handles.get(dur)
    if (!mask) {
      mask = book.newClientMask(lane, dur)
      handles.set(dur, mask)
    }
    return mask(start)
  }
}

/** The held set for every staff lane in the snapshot.
 *
 *  GUARD OFF PAYS NOTHING (spec §6): no guard, no protected duration, nothing
 *  to hold — the function returns before it builds an engine or touches the
 *  book. A store that never turned the guard on is not charged for the law. */
export function reservedMaskFor(input: ReservedMaskInput): readonly ReservedLaneMask[] {
  const { guard, book } = input
  if (input.gapGuardMode === 'off' || guard === null) return EMPTY
  const protectedDur = protectedDurationOf(guard)
  if (typeof protectedDur !== 'number' || protectedDur <= 0) return EMPTY

  // ONE mode source: the store's dial IS the engine's mode here, so the two can
  // never be set to different things by two callers.
  const engine = createGapGuard({ ...guard, mode: input.gapGuardMode })

  const out: ReservedLaneMask[] = []
  for (const lane of input.lanes) {
    if (lane.group !== 'staff' || lane.window == null) continue
    const pockets = freePockets({
      from: lane.window.from,
      until: lane.window.until,
      close: input.closeMin,
      now: input.nowMin,
      occupied: laneSpans(lane),
    })
    const ctx: GuardContext = { protectedWindowFeasible: bedFeasibilityFor(book, lane) }
    const spans: ReservedSpan[] = []
    for (const pocket of pockets) {
      for (const windowStart of engine.protectedCapacity(pocket, null, ctx).beforeStarts) {
        spans.push(Object.freeze({ start: windowStart, end: windowStart + protectedDur, windowStart }))
      }
    }
    out.push(Object.freeze({ laneKey: lane.key, spans: Object.freeze(spans), protectedCount: spans.length }))
  }
  return Object.freeze(out)
}
