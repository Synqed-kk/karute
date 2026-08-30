// THE RESERVED MASK'S OWN BATTERY — HELD-SWEEP, E1 scope (spec §11.3).
//
// The mask is DARK this round (spec §12, E1: zero consumers), so this file is
// the only thing that can prove it. Every pin is written to be
// MUTATION-PROVABLE: break one line of reserved-mask.ts and exactly one of
// these turns red.
//
// WHAT IT PROVES, in the order the law decides things:
//   §1 EQUALITY — the mask's windows ARE the guard's own enumeration, on
//      identical pocket + config + callback inputs. This is the pin the module
//      exists for: a re-implementation of gap-guard.ts:192-206 could drift by
//      one lattice step and the two doors would quietly disagree about what is
//      held, which is the whole law (spec §1, §2).
//   §2 BED TRUTH — every held span is bed-feasible over its whole span
//      (§11.3-ii), and a window staff time alone would allow but no room can
//      cover is DROPPED (the LAYER-MAP phantom-window class, flag-89
//      generalised).
//   §3 GUARD OFF — empty mask, on every lane, in every combination, at zero
//      cost (§11.3-iii, spec §6: a store that never turned the guard on is not
//      charged for the law).
//   §4 SHAPE — spans never overlap on a lane, spans lie inside the lane's own
//      pockets, and a pocket shorter than the protected duration contributes
//      nothing (flag-89's rule, spec §1).
//   §5 PURITY — two builds on identical inputs are byte-identical, and the
//      inputs are never touched (the StrictMode mutant).
//   §6 THE SWEEP — the widened matrix, written out as HELD-SWEEP-e1.
//   §7 COST — the mask's build measured at 6/15/25/30 staff plus one 100-lane
//      本部 row, with the book's `newClientMask` lookups asserted bounded.
//   §8 THE MANUAL RELEASE (E5, ruling Q5) — a released window is an INPUT FACT
//      SUBTRACTED AFTER THE ENUMERATION: the window goes, every neighbour stays
//      byte-identical, the identity is (lane, windowStart) whole, and absent is
//      E1's answer to the byte.
//
// ⚠ THE OTHER THREE INVARIANTS ARE NOT HERE, AND CANNOT BE. Spec §11.3 asks
// for six; (i) "every withheld crumb lies inside a held span", (iv) "reserved
// offers emitted ≡ held windows" and (v) "no reconcile claim overlaps a
// withheld crumb's evidence" all need EMISSION — a door that reads the mask —
// and no door reads it until E3a (spec §12). They land there, against the same
// matrix. What this file can prove about a builder with no consumers, it
// proves; it does not pretend to the rest.
//
// THE BOARD. A deterministic synthetic roster built out of the real board
// shapes (`BoardLane`, `BoardItem`, `place` from today-board.ts) — the same
// ANY-ROSTER discipline the capacity book's own battery uses, kept local
// because importing another suite's fixture would re-register that suite's
// several hundred tests inside this file.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  bedTruthViews,
  LATTICE_STEP_MIN,
  type BedTruth,
} from '@/app/[locale]/(business)/business/today/capacity-ledger'
import {
  reservedMaskFor,
  type GapGuardMode,
  type ReleasedWindow,
  type ReservedLaneMask,
} from '@/app/[locale]/(business)/business/today/reserved-mask'
import { laneSpans, type RoomPolicy } from '@/app/[locale]/(business)/business/today/today-interactions'
import { freePockets, type GuardPocketSpan } from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig, type GuardContext } from '@/business/lib/canon-logic/gap-guard'
import { opsConfig } from '@/business/lib/fixtures-today'
import { hhmm, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'

// ── the store the fixture runs in ───────────────────────────────────────────

const OPEN = 540 // 09:00
const CLOSE = 1080 // 18:00
const HOURS: Hours = { open: OPEN, close: CLOSE }
const FRAME = { openMin: OPEN, closeMin: CLOSE, nowMin: OPEN }
const POLICY: RoomPolicy = { vipStaysPrivate: true, privateIsLastResort: true }

/** THE STORE'S OWN DIALS, read from the fixture — by the TEST, never by the
 *  module (the module takes every dial as a parameter; spec §2). */
const SHIPPED_PROTECTED = opsConfig.newClientSessionMin
const SHIPPED_MODE = opsConfig.gapGuardMode
const SHIPPED_GRID = opsConfig.reserveStartGridMin
const SHIPPED_SESSION = opsConfig.standardSessionMin
const SHIPPED_MIN_SELLABLE = opsConfig.minSellableMin

/** The guard config for one dial combination. `services` is the store's
 *  repertoire and `gapFillMinMin` its スキマ枠 floor — both real dials, both
 *  threaded, none of them read inside the module. */
const guardConfig = (over: Partial<GuardConfig> = {}): GuardConfig => ({
  services: [
    { name: '45', dur: 45 },
    { name: 'standard', dur: SHIPPED_SESSION },
    { name: '90', dur: 90 },
  ],
  protectedDurationMin: SHIPPED_PROTECTED,
  gapFillMinMin: SHIPPED_MIN_SELLABLE,
  leadTimeMin: opsConfig.leadTimeMin,
  ...over,
})

// ── THE SYNTHETIC BOARD ─────────────────────────────────────────────────────

/** Deterministic pseudo-randomness — a plain LCG. No Date.now, no Math.random:
 *  a fixture that changes between runs cannot pin anything. */
function rng(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface BoardSpec {
  staff: number
  beds: number
  seed: number
  /** Bookings dealt onto each staff lane. More = tighter pockets. */
  perLane: number
  stores?: string[]
  /** The LAST rooms are 個室, exactly as the real board reads `room_class`. */
  privateBeds?: number
}

const pad = (n: number) => String(n + 1).padStart(2, '0')
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.end > b.start && a.start < b.end

function item(over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'kind' | 'startMin' | 'endMin'>): BoardItem {
  return {
    state: 'confirmed',
    category: null,
    ...place(over.startMin, over.endMin, HOURS),
    title: '',
    tag: '',
    time: `${hhmm(over.startMin)}〜${hhmm(over.endMin)}`,
    ticketCat: null,
    ticketCore: null,
    held: false,
    micro: false,
    caseId: over.key,
    label: '',
    ...over,
  }
}

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key,
    sub: '',
    absentNote: null,
    mine: false,
    items: [],
    window: over.group === 'staff' ? { from: OPEN, until: CLOSE } : null,
    untilLabel: over.group === 'staff' ? hhmm(CLOSE) : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

/** THE ANY-ROSTER BOARD. N staff, M rooms, one deterministic day.
 *
 *  Each staff lane is dealt `perLane` bookings on the 15-minute grid; each is
 *  given the first room in its own store that is free for the span, and dropped
 *  when there is none — so the board is always a day a store could really have
 *  run, and the rooms are genuinely contended (which is what makes bed
 *  feasibility bite rather than being a formality). */
function board(spec: BoardSpec): BoardLane[] {
  const stores = spec.stores ?? ['store-a']
  const privateBeds = spec.privateBeds ?? 1
  const next = rng(spec.seed)
  const placed: Array<{ id: string; staffKey: string; bedKey: string; start: number; end: number }> = []

  for (let i = 0; i < spec.staff; i += 1) {
    const staffKey = `p-${pad(i)}`
    const store = stores[i % stores.length]
    for (let n = 0; n < spec.perLane; n += 1) {
      const dur = [45, 60, 90][Math.floor(next() * 3) % 3]
      const start = OPEN + Math.floor((next() * (CLOSE - OPEN - dur)) / 15) * 15
      const span = { start, end: start + dur }
      if (placed.some((p) => p.staffKey === staffKey && overlaps(p, span))) continue
      const bedKey = Array.from({ length: spec.beds }, (_, j) => `bed-${pad(j)}`).find(
        (k, j) => stores[j % stores.length] === store && !placed.some((p) => p.bedKey === k && overlaps(p, span)),
      )
      if (!bedKey) continue
      placed.push({ id: `apt-${pad(i)}-${n}`, staffKey, bedKey, ...span })
    }
  }

  const lanes: BoardLane[] = []
  for (let i = 0; i < spec.staff; i += 1) {
    const key = `p-${pad(i)}`
    lanes.push(
      lane({
        key,
        group: 'staff',
        label: `見本 ${pad(i)}`,
        stores: [stores[i % stores.length]],
        items: placed
          .filter((p) => p.staffKey === key)
          .map((p) => item({ key: p.id, kind: 'booking', startMin: p.start, endMin: p.end }))
          .sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  for (let j = 0; j < spec.beds; j += 1) {
    const key = `bed-${pad(j)}`
    lanes.push(
      lane({
        key,
        group: 'beds',
        label: `ベッド${j + 1}`,
        stores: [stores[j % stores.length]],
        roomClass: j >= spec.beds - privateBeds ? 'private' : 'standard',
        items: placed
          .filter((p) => p.bedKey === key)
          .map((p) => item({ key: `${p.id}-bed`, kind: 'booking', startMin: p.start, endMin: p.end, caseId: p.id }))
          .sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  return lanes
}

/** The sweep board: eight people competing for three rooms, so the rooms are
 *  the binding constraint rather than the roster. */
const SWEEP: BoardSpec = { staff: 8, beds: 3, seed: 4242, perLane: 3 }

const bookOf = (lanes: BoardLane[]): BedTruth => bedTruthViews(lanes, POLICY, FRAME, null).world
const staffLanesOf = (lanes: BoardLane[]) => lanes.filter((l) => l.group === 'staff' && l.window != null)

/** The mask, for one board at one dial combination. A FRESH book every time —
 *  a world is a book (capacity-ledger's own law), so a combination never
 *  inherits another one's cache. */
function maskOf(
  lanes: BoardLane[],
  guard: GuardConfig | null,
  gapGuardMode: GapGuardMode,
  book: BedTruth = bookOf(lanes),
  /** ⚖ E5 — absent is E1's call, unchanged: every existing caller passes
   *  nothing and gets the array the enumeration built. */
  released?: readonly ReleasedWindow[],
): readonly ReservedLaneMask[] {
  return reservedMaskFor({ lanes, closeMin: CLOSE, nowMin: null, guard, gapGuardMode, book, released })
}

/** THE ORACLE — the pockets and the guard ctx the RAIL builds, rebuilt here
 *  from the same three producers (`freePockets`, `laneSpans`, `newClientMask`).
 *  Every equality pin below compares the module against this, never against a
 *  hand-copied enumeration. */
const pocketsOf = (lane: BoardLane): GuardPocketSpan[] =>
  freePockets({
    from: lane.window!.from,
    until: lane.window!.until,
    close: CLOSE,
    now: null,
    occupied: laneSpans(lane),
  })

const bedCtx = (book: BedTruth, lane: BoardLane): GuardContext => {
  const handles = new Map<number, (startMin: number) => boolean>()
  return {
    protectedWindowFeasible: (start, dur) => {
      let mask = handles.get(dur)
      if (!mask) {
        mask = book.newClientMask(lane, dur)
        handles.set(dur, mask)
      }
      return mask(start)
    },
  }
}

/** The guard's OWN answer for one lane — `protectedCapacity(...).beforeStarts`
 *  over that lane's pockets, in pocket order, under whichever ctx it is asked
 *  under. Three ctxs matter and they answer three different questions:
 *    · `{}`              — canon raw. No callback, so the walk starts at the
 *                          pocket's own minute (gap-guard.ts:195).
 *    · `ALWAYS_FEASIBLE`  — on the lattice, but blind to the rooms. The
 *                          difference from raw is the LATTICE delta.
 *    · `bedCtx(book, l)` — the mask's own. The difference from the lattice
 *                          column is the BED delta.
 *  Spec §2 requires those two causes to stay separated, "or the table lies
 *  about why counts moved". */
const ALWAYS_FEASIBLE: GuardContext = { protectedWindowFeasible: () => true }

function startsFor(lane: BoardLane, guard: GuardConfig, mode: 'standard' | 'strict', ctx: GuardContext): number[] {
  const engine = createGapGuard({ ...guard, mode })
  return pocketsOf(lane).flatMap((p) => engine.protectedCapacity(p, null, ctx).beforeStarts)
}

const guardStartsFor = (lanes: BoardLane[], lane: BoardLane, guard: GuardConfig, mode: 'standard' | 'strict') =>
  startsFor(lane, guard, mode, bedCtx(bookOf(lanes), lane))

/** The guard's window LENGTH, asked of the guard rather than assumed: on an
 *  unconstrained pocket with no feasibility callback the earliest-finish greedy
 *  packs windows end to end, so the gap between two consecutive starts IS the
 *  protected duration. Nothing here hardcodes a number (spec §1). */
function guardWindowLength(guard: GuardConfig, mode: 'standard' | 'strict'): number {
  const engine = createGapGuard({ ...guard, mode })
  const starts = engine.protectedCapacity({ s: 0, e: 24 * 60 }, null, {}).beforeStarts
  return starts[1] - starts[0]
}

// ── THE WIDENED MATRIX (spec §11.3) ─────────────────────────────────────────

const GRID_AXIS = [30, 60] as const
const SESSION_AXIS = [45, 60, 90] as const
const MIN_SELLABLE_AXIS = [0, 30] as const
const GUARD_AXIS = ['off', 'standard', 'strict'] as const
/** The store's own protected duration, one smaller, one larger. */
const PROTECTED_AXIS = [SHIPPED_PROTECTED - 30, SHIPPED_PROTECTED, SHIPPED_PROTECTED + 30] as const

interface Combo {
  gridMin: number
  sessionMin: number
  minSellableMin: number
  protectedMin: number
  mode: GapGuardMode
  axis: 'grid' | 'law'
}

const label = (c: Combo) =>
  `grid=${c.gridMin} S=${c.sessionMin} minSell=${c.minSellableMin} protected=${c.protectedMin} guard=${c.mode}`

/** THE TRIM, stated rather than silently applied. The full cross is
 *  2 × 3 × 2 × 3 × 3 = 108 combinations, and the three grid dials cannot move a
 *  held span on their own — the guard's protected enumeration reads the
 *  protected duration, the services repertoire and the bed callback, not the
 *  customer grid. So:
 *   · the LAW axes (protected × guard, 9) run at the fixture's own grid dials —
 *     this is the axis r1's matrix held constant, so it could not see the law;
 *   · the GRID matrix (12) runs at the shipped protected duration and guard
 *     mode.
 *  Union = 20 combinations (one overlap). Both halves ride into HELD-SWEEP-e1
 *  with their counts, so the "grid cannot move it" claim is DATA in the
 *  artifact, not a promise in a comment. */
const COMBOS: Combo[] = [
  ...PROTECTED_AXIS.flatMap((protectedMin) =>
    GUARD_AXIS.map((mode) => ({
      gridMin: SHIPPED_GRID,
      sessionMin: SHIPPED_SESSION,
      minSellableMin: SHIPPED_MIN_SELLABLE,
      protectedMin,
      mode: mode as GapGuardMode,
      axis: 'law' as const,
    })),
  ),
  ...GRID_AXIS.flatMap((gridMin) =>
    SESSION_AXIS.flatMap((sessionMin) =>
      MIN_SELLABLE_AXIS.map((minSellableMin) => ({
        gridMin,
        sessionMin,
        minSellableMin,
        protectedMin: SHIPPED_PROTECTED,
        mode: SHIPPED_MODE as GapGuardMode,
        axis: 'grid' as const,
      })),
    ),
  ),
].filter(
  (c, i, all) => all.findIndex((o) => label(o) === label(c)) === i,
)

/** One combination's guard config. `gridMin` reaches the engine the only way a
 *  customer grid ever does — through the repertoire the store actually sells. */
const configOf = (c: Combo): GuardConfig =>
  guardConfig({
    services: [
      { name: '45', dur: 45 },
      { name: 'standard', dur: c.sessionMin },
      { name: 'grid', dur: c.gridMin },
    ],
    protectedDurationMin: c.protectedMin,
    gapFillMinMin: c.minSellableMin,
  })

// ── 1 · THE EQUALITY PIN ────────────────────────────────────────────────────

describe('1 — the mask windows ARE the guard enumeration, never a copy of it', () => {
  it.each(COMBOS.filter((c) => c.mode !== 'off').map((c) => [label(c), c] as const))(
    '%s — every lane equals protectedCapacity(...).beforeStarts',
    (_name, c) => {
      const lanes = board(SWEEP)
      const guard = configOf(c)
      const masks = maskOf(lanes, guard, c.mode)
      expect(masks).toHaveLength(staffLanesOf(lanes).length)
      for (const m of masks) {
        const lane = lanes.find((l) => l.key === m.laneKey)!
        expect({ lane: m.laneKey, starts: m.spans.map((s) => s.windowStart) }).toEqual({
          lane: m.laneKey,
          starts: guardStartsFor(lanes, lane, guard, c.mode as 'standard' | 'strict'),
        })
        // The span the mask paints is the window the guard enumerated: same
        // start, and the guard's own greedy step for its length.
        const length = guardWindowLength(guard, c.mode as 'standard' | 'strict')
        for (const s of m.spans) expect({ start: s.start, len: s.end - s.start }).toEqual({ start: s.windowStart, len: length })
        expect(m.protectedCount).toBe(m.spans.length)
      }
    },
  )
})

// ── 2 · BED TRUTH ───────────────────────────────────────────────────────────

describe('2 — a held span is a span a room can actually cover', () => {
  it.each(COMBOS.filter((c) => c.mode !== 'off').map((c) => [label(c), c] as const))(
    '%s — every held span is bed-feasible over its whole span (§11.3-ii)',
    (_name, c) => {
      const lanes = board(SWEEP)
      const masks = maskOf(lanes, configOf(c), c.mode)
      // A FRESH book — the direct walk must not be able to inherit an answer
      // the mask's own book put in a cache.
      const direct = bookOf(lanes)
      for (const m of masks) {
        const lane = lanes.find((l) => l.key === m.laneKey)!
        const walk = direct.newClientMask(lane, c.protectedMin)
        for (const s of m.spans) {
          expect({ at: `${m.laneKey}@${hhmm(s.start)}`, mask: walk(s.start) }).toEqual({
            at: `${m.laneKey}@${hhmm(s.start)}`,
            mask: true,
          })
          // …and the whole span, not just its first minute: the book's own
          // answer for [start, end) is the one a 新規 session would consume.
          expect(direct.bedFor(s.start, s.end, { stores: lane.stores }).laneKey).not.toBeNull()
        }
      }
    },
  )

  it('the phantom window — staff time allows it, no room can cover it, the mask drops it', () => {
    // ⚖ flag-89 generalised (spec §1): 「a 60-minute pocket never held a 90」.
    // One person free 10:00–14:00 and ONE room, busy 10:00–12:00. Staff time
    // alone publishes two 90-minute windows; the rooms publish one.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 840 } }),
      lane({
        key: 'bed-01',
        group: 'beds',
        items: [item({ key: 'blk-1', kind: 'block', startMin: 600, endMin: 720, caseId: null })],
      }),
    ]
    const guard = guardConfig({ protectedDurationMin: 90 })

    const blind = createGapGuard({ ...guard, mode: 'standard' })
      .protectedCapacity({ s: 600, e: 840, walls: { left: null, right: null } }, null, {}).beforeStarts
    const held = maskOf(lanes, guard, 'standard')[0]

    // The callback-less enumeration keeps the window the room cannot cover…
    expect(blind).toEqual([600, 690])
    // …and the mask drops both, keeping only the one that starts after the room
    // frees up.
    expect(held.spans.map((s) => s.windowStart)).toEqual([720])
    expect(held.protectedCount).toBe(1)
    expect(blind).toContain(600)
    expect(held.spans.map((s) => s.windowStart)).not.toContain(600)
  })
})

// ── 3 · GUARD OFF ───────────────────────────────────────────────────────────

describe('3 — guard OFF holds nothing and pays nothing (§11.3-iii, spec §6)', () => {
  it.each(
    [...GRID_AXIS.flatMap((g) => SESSION_AXIS.flatMap((s) => MIN_SELLABLE_AXIS.map((m) => [g, s, m] as const)))],
  )('grid=%i S=%i minSell=%i — empty on every lane', (gridMin, sessionMin, minSellableMin) => {
    const lanes = board(SWEEP)
    for (const protectedMin of PROTECTED_AXIS) {
      const guard = configOf({ gridMin, sessionMin, minSellableMin, protectedMin, mode: 'off', axis: 'grid' })
      expect(maskOf(lanes, guard, 'off')).toEqual([])
    }
  })

  it('OFF costs the book nothing at all — the mask returns before it asks', () => {
    const lanes = board(SWEEP)
    const book = bookOf(lanes)
    const before = book.stats.allocateBedCalls
    expect(maskOf(lanes, guardConfig(), 'off', book)).toEqual([])
    expect(book.stats.allocateBedCalls).toBe(before)
  })

  it('a store with no guard configured at all is the same empty answer', () => {
    const lanes = board(SWEEP)
    const book = bookOf(lanes)
    expect(maskOf(lanes, null, 'standard', book)).toEqual([])
    // …and so is a guard whose protected duration is absent, null or nonsense:
    // canon reads a PRESENT null as "no protected duration" (gap-guard.ts:104).
    expect(maskOf(lanes, guardConfig({ protectedDurationMin: null }), 'standard', book)).toEqual([])
    expect(maskOf(lanes, guardConfig({ protectedDurationMin: 0 }), 'standard', book)).toEqual([])
    expect(book.stats.allocateBedCalls).toBe(0)
  })
})

// ── 4 · SHAPE ───────────────────────────────────────────────────────────────

describe('4 — the shape of a lane’s held set', () => {
  it.each(COMBOS.filter((c) => c.mode !== 'off').map((c) => [label(c), c] as const))(
    '%s — disjoint, inside the pockets, and never in a pocket too short to hold one',
    (_name, c) => {
      const lanes = board(SWEEP)
      const masks = maskOf(lanes, configOf(c), c.mode)
      for (const m of masks) {
        const lane = lanes.find((l) => l.key === m.laneKey)!
        const pockets = pocketsOf(lane)
        let lastEnd = -Infinity
        for (const s of m.spans) {
          expect({ at: `${m.laneKey}@${hhmm(s.start)}`, disjoint: s.start >= lastEnd }).toEqual({
            at: `${m.laneKey}@${hhmm(s.start)}`,
            disjoint: true,
          })
          lastEnd = s.end
          const home = pockets.find((p) => s.start >= p.s && s.end <= p.e)
          expect({ at: `${m.laneKey}@${hhmm(s.start)}`, inAPocket: home !== undefined }).toEqual({
            at: `${m.laneKey}@${hhmm(s.start)}`,
            inAPocket: true,
          })
          // A pocket that could not hold one protected window contributed
          // nothing, by construction: the span it hosts is at least as long.
          expect(home!.e - home!.s).toBeGreaterThanOrEqual(c.protectedMin)
        }
        for (const p of pockets.filter((p) => p.e - p.s < c.protectedMin)) {
          expect(m.spans.filter((s) => s.start >= p.s && s.start < p.e)).toEqual([])
        }
      }
    },
  )

  it('a lane whose only pocket is shorter than the protected duration holds nothing', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 660 } }),
      lane({ key: 'bed-01', group: 'beds' }),
    ]
    expect(maskOf(lanes, guardConfig({ protectedDurationMin: 90 }), 'standard')[0]).toEqual({
      laneKey: 'p-01',
      spans: [],
      protectedCount: 0,
    })
  })

  it('lanes with no shift and resource rows are not staff lanes and get no entry', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'p-02', group: 'staff', window: null }),
      lane({ key: 'bed-01', group: 'beds' }),
    ]
    expect(maskOf(lanes, guardConfig(), 'standard').map((m) => m.laneKey)).toEqual(['p-01'])
  })
})

// ── 5 · PURITY ──────────────────────────────────────────────────────────────

describe('5 — the StrictMode mutant: two builds, one answer, nothing touched', () => {
  it('building twice on identical inputs is byte-identical', () => {
    const lanes = board(SWEEP)
    const guard = guardConfig()
    // Two calls on ONE book, and two calls on two books: neither the memoised
    // path nor a cold one may change the answer.
    const shared = bookOf(lanes)
    const a = maskOf(lanes, guard, 'standard', shared)
    const b = maskOf(lanes, guard, 'standard', shared)
    const c = maskOf(lanes, guard, 'standard')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).toBe(JSON.stringify(c))
  })

  it('the input lanes and the guard config are never touched, and the output is frozen', () => {
    const lanes = board(SWEEP)
    const guard = guardConfig()
    const lanesBefore = JSON.stringify(lanes)
    const guardBefore = JSON.stringify(guard)
    const masks = maskOf(lanes, guard, 'standard')
    // The BOOK is a memoising instance by its own design (its stats are
    // "deliberately mutable"), so the no-mutation claim is about the plain data
    // inputs — which is where a builder could do damage.
    expect(JSON.stringify(lanes)).toBe(lanesBefore)
    expect(JSON.stringify(guard)).toBe(guardBefore)
    expect(Object.isFrozen(masks)).toBe(true)
    expect(Object.isFrozen(masks[0])).toBe(true)
    expect(Object.isFrozen(masks[0].spans)).toBe(true)
    const withSpans = masks.find((m) => m.spans.length > 0)!
    expect(Object.isFrozen(withSpans.spans[0])).toBe(true)
  })

  it('the world it is handed IS the world it answers for — no hidden second reading', () => {
    // Same dials, two snapshots: an emptier board holds strictly more.
    const busy = board(SWEEP)
    const quiet = board({ ...SWEEP, perLane: 1, seed: 99 })
    const heldOn = (lanes: BoardLane[]) =>
      maskOf(lanes, guardConfig(), 'standard').reduce((n, m) => n + m.protectedCount, 0)
    expect(heldOn(quiet)).toBeGreaterThan(heldOn(busy))
  })
})

// ── 6 · THE SWEEP ARTIFACT ──────────────────────────────────────────────────

const EVIDENCE = process.env.E1_EVIDENCE ?? ''
const SHA = process.env.E1_SHA ?? 'unstamped'

describe('6 — HELD-SWEEP across the widened matrix', () => {
  it('every combination answers, and the artifact records what it answered', () => {
    const lanes = board(SWEEP)
    const staff = staffLanesOf(lanes)
    const rows: string[] = []
    const bedSilenced: string[] = []
    let firedAtShippedDials = 0
    for (const c of COMBOS) {
      const guard = configOf(c)
      const masks = maskOf(lanes, guard, c.mode)
      const spans = masks.reduce((n, m) => n + m.spans.length, 0)
      const counts = masks.reduce((n, m) => n + m.protectedCount, 0)
      // The derived count is the spans, always — never a second tally.
      expect({ at: label(c), spans, counts }).toEqual({ at: label(c), spans, counts: spans })
      if (c.mode === 'off') {
        expect(masks).toEqual([])
        rows.push(
          `${c.axis.padEnd(4)} | grid=${String(c.gridMin).padStart(2)} S=${String(c.sessionMin).padStart(2)}` +
            ` minSell=${String(c.minSellableMin).padStart(2)} protected=${String(c.protectedMin).padStart(3)}` +
            ` guard=${'off'.padEnd(8)} | lanes  0 |  raw   — | lattice   — | HELD   0 | (guard OFF: empty, §11.3-iii)`,
        )
        continue
      }
      const mode = c.mode as 'standard' | 'strict'
      const raw = staff.reduce((n, l) => n + startsFor(l, guard, mode, {}).length, 0)
      const lattice = staff.reduce((n, l) => n + startsFor(l, guard, mode, ALWAYS_FEASIBLE).length, 0)
      // THE BED CALLBACK CAN ONLY TAKE WINDOWS AWAY. Its feasible set is a
      // subset of the blind one, and `protectedWindows` is the optimal
      // earliest-finish greedy for equal-length windows — so a subset can never
      // schedule more of them.
      expect({ at: label(c), bedNeverAdds: spans <= lattice }).toEqual({ at: label(c), bedNeverAdds: true })
      if (spans === 0 && lattice > 0) bedSilenced.push(label(c))
      if (c.protectedMin === SHIPPED_PROTECTED && c.mode === SHIPPED_MODE) firedAtShippedDials += spans
      rows.push(
        `${c.axis.padEnd(4)} | grid=${String(c.gridMin).padStart(2)} S=${String(c.sessionMin).padStart(2)}` +
          ` minSell=${String(c.minSellableMin).padStart(2)} protected=${String(c.protectedMin).padStart(3)}` +
          ` guard=${c.mode.padEnd(8)} | lanes ${String(masks.length).padStart(2)}` +
          ` | raw ${String(raw).padStart(3)} | lattice ${String(lattice).padStart(3)}` +
          ` | HELD ${String(spans).padStart(3)}` +
          ` | lattice Δ ${String(lattice - raw).padStart(3)} · bed Δ ${String(spans - lattice).padStart(4)}`,
      )
    }
    expect(rows).toHaveLength(COMBOS.length)
    // THE LAW FIRES. At the store's own protected duration and guard mode the
    // mask holds something on this board — a builder that quietly held nothing
    // everywhere would pass every other pin in this file.
    expect(firedAtShippedDials).toBeGreaterThan(0)

    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, `HELD-SWEEP-e1-${SHA}.txt`),
        [
          '# HELD-SWEEP-e1 — the reserved mask across the WIDENED matrix (spec §11.3)',
          `# tip: ${SHA}`,
          `# board: synthetic ANY-ROSTER — ${SWEEP.staff} staff / ${SWEEP.beds} rooms / ${hhmm(OPEN)}-${hhmm(CLOSE)},`,
          `#        ${SWEEP.perLane} bookings dealt per lane, seed ${SWEEP.seed} (deterministic).`,
          '#',
          '# THE TRIM (stated, per the packet). The full cross is',
          '#   {gridMin 30/60 × standardSession 45/60/90 × minSellable 0/30}',
          '#   × {protected: store−30 / store / store+30} × {guard off/standard/strict} = 108.',
          '# The three grid dials cannot move a held span on their own: the guard’s protected',
          '# enumeration reads the protected duration, the services repertoire and the bed',
          '# callback — not the customer grid. So this sweep runs',
          `#   · axis "law"  — protected × guard (9) at the store’s own grid dials`,
          `#     (grid=${SHIPPED_GRID} S=${SHIPPED_SESSION} minSell=${SHIPPED_MIN_SELLABLE}); this is the axis r1 held CONSTANT,`,
          '#     so r1 could not see the law at all.',
          `#   · axis "grid" — the twelve grid combinations at the shipped protected`,
          `#     duration (${SHIPPED_PROTECTED}) and guard mode (${SHIPPED_MODE}).`,
          `# Union = ${COMBOS.length} combinations (one overlap). The equal counts down the "grid"`,
          '# rows are the EVIDENCE for the trim, not an assumption behind it.',
          '#',
          '# TWO CAUSES, TWO COLUMNS (spec §2 — "or the table lies about why counts moved").',
          '#   raw     = canon’s enumeration with NO feasibility callback: the walk starts at',
          '#             the pocket’s own minute (gap-guard.ts:195).',
          '#   lattice = the same walk with a callback that always says yes — on the lattice,',
          '#             blind to the rooms. lattice Δ = what attaching a callback AT ALL cost.',
          '#   HELD    = the mask. bed Δ = what the rooms cost, and nothing else.',
          '#',
          '# columns: axis | dials | lanes answered | raw | lattice | HELD | the two deltas',
          '#',
          ...rows,
          '#',
          `# guard-OFF rows: empty mask on every lane, asserted (§11.3-iii).`,
          '# BED-SILENCED combinations — staff time alone publishes windows, no room can cover',
          '# one of them, so the store holds nothing at that dial. Measured, not a defect:',
          `#   ${bedSilenced.length === 0 ? 'NONE' : bedSilenced.join('\n#   ')}`,
          `# (this board is ${SWEEP.staff} people sharing ${SWEEP.beds} rooms, so a long protected duration`,
          '#  runs out of ROOM before it runs out of roster — which is exactly the phantom-window',
          '#  class §2 asks the mask to remove, seen at board scale.)',
          '#',
          '# §11.3 invariants (i) withheld crumbs, (iv) reserved offers ≡ held windows and',
          '# (v) reconcile-claim separation are NOT in this artifact: all three need EMISSION,',
          '# and no door reads the mask until E3a (spec §12). They land there, same matrix.',
        ].join('\n'),
      )
    }
  })
})

// ── 7 · COST ────────────────────────────────────────────────────────────────

/** A book that counts how often the mask asked it for a lattice. The packet's
 *  bound is lanes × durations: one handle per (lane, length), never one per
 *  probe. */
function countingBook(book: BedTruth): { book: BedTruth; maskCalls: () => number } {
  let calls = 0
  const wrapped: BedTruth = {
    ...book,
    newClientMask(lane, dur) {
      calls += 1
      return book.newClientMask(lane, dur)
    },
  }
  return { book: wrapped, maskCalls: () => calls }
}

const PERF: Array<{ staff: number; beds: number; stores: number; buildMs: number; spans: number; searches: number; maskCalls: number }> = []

describe('7 — the cost of the mask, measured rather than asserted in prose', () => {
  it.each([6, 15, 25, 30])('%i staff: one mask build over the whole board', (staff) => {
    const spec: BoardSpec = { staff, beds: Math.max(3, Math.round(staff / 3)), seed: 100 + staff, perLane: 3 }
    const lanes = board(spec)
    const { book, maskCalls } = countingBook(bookOf(lanes))
    const t0 = performance.now()
    const masks = maskOf(lanes, guardConfig(), 'standard', book)
    const t1 = performance.now()
    PERF.push({
      staff,
      beds: spec.beds,
      stores: 1,
      buildMs: t1 - t0,
      spans: masks.reduce((n, m) => n + m.spans.length, 0),
      searches: book.stats.allocateBedCalls,
      maskCalls: maskCalls(),
    })
    // THE BUDGET IS THE CALL COUNT, not a wall clock (the book's own battery
    // rule): one lattice handle per staff lane per length, and the mask asks
    // for exactly one length.
    expect(maskCalls()).toBe(staffLanesOf(lanes).length)
  })

  it('a 100-lane 本部 board answers, and MAX_STORE_BINDINGS saturation is measured, not fixed', () => {
    // 100 staff dealt round-robin across 40 stores — past the book's 32-row
    // store-binding ceiling on purpose. Saturation DEGRADES (the rows already
    // minted keep serving, the rest are answered uncached); it never refuses,
    // which is the any-business-size law's requirement.
    const stores = Array.from({ length: 40 }, (_, i) => `store-${pad(i)}`)
    const spec: BoardSpec = { staff: 100, beds: 40, seed: 777, perLane: 2, stores }
    const lanes = board(spec)
    const { book, maskCalls } = countingBook(bookOf(lanes))
    const t0 = performance.now()
    const masks = maskOf(lanes, guardConfig(), 'standard', book)
    const t1 = performance.now()
    expect(masks).toHaveLength(100)
    expect(maskCalls()).toBe(100)
    // The ceiling is real and it is a MEMORY ceiling, not a validity one.
    expect(book.stats.storeBindings).toBe(32)
    PERF.push({
      staff: spec.staff,
      beds: spec.beds,
      stores: stores.length,
      buildMs: t1 - t0,
      spans: masks.reduce((n, m) => n + m.spans.length, 0),
      searches: book.stats.allocateBedCalls,
      maskCalls: maskCalls(),
    })
  })

  it('a second build on the same book costs the beds nothing', () => {
    const lanes = board(SWEEP)
    const book = bookOf(lanes)
    maskOf(lanes, guardConfig(), 'standard', book)
    const settled = book.stats.allocateBedCalls
    maskOf(lanes, guardConfig(), 'standard', book)
    maskOf(lanes, guardConfig(), 'standard', book)
    expect(book.stats.allocateBedCalls).toBe(settled)
  })

  afterAll(() => {
    if (PERF.length === 0 || !EVIDENCE) return
    mkdirSync(EVIDENCE, { recursive: true })
    writeFileSync(
      join(EVIDENCE, `PERF-e1-${SHA}.txt`),
      [
        '# PERF-e1 — the reserved mask build, measured (spec §11.3)',
        `# tip: ${SHA}`,
        `# board: synthetic ANY-ROSTER, ${hhmm(OPEN)}-${hhmm(CLOSE)} (${(CLOSE - OPEN) / LATTICE_STEP_MIN} lattice slots),`,
        `#        3 bookings per lane (2 on the 本部 row), guard=standard, protected=${SHIPPED_PROTECTED}.`,
        '# TIMINGS ARE RECORDED, NEVER ASSERTED (the capacity book’s own rule — a wall',
        '# clock on a shared runner is not a budget). The asserted budget is the CALL',
        '# COUNT: newClientMask lookups = staff lanes × lengths, one handle per lane.',
        '#',
        '# staff | rooms | stores | build ms | held spans | allocateBed searches | newClientMask lookups',
        ...PERF.map(
          (r) =>
            `${String(r.staff).padStart(5)} | ${String(r.beds).padStart(5)} | ${String(r.stores).padStart(6)} |` +
            ` ${r.buildMs.toFixed(2).padStart(8)} | ${String(r.spans).padStart(10)} |` +
            ` ${String(r.searches).padStart(20)} | ${String(r.maskCalls).padStart(21)}`,
        ),
        '#',
        '# THE 本部 ROW (100 lanes / 40 stores) — MAX_STORE_BINDINGS saturation, MEASURED,',
        '# NOT FIXED (the packet says measure). The book mints 32 store-binding cache rows',
        '# and answers the 33rd store and beyond uncached, so the search count on that row',
        '# is the honest cost of an HQ board: the mask still answers every lane, and the',
        '# lookup count still holds at one per lane. Raising the ceiling is a capacity-book',
        '# decision with a memory price, and it belongs to whichever round measures an HQ',
        '# board hot on a real screen — not to a dark builder.',
      ].join('\n'),
    )
  })
})

// ── 8 · THE MANUAL RELEASE (E5, ⚖ ruling Q5) ────────────────────────────────

/** ⚖ SPEC-SELLING-ENGINE §1's Release clause, MANUAL half. A manager releasing
 *  a held window early does NOT mutate the mask — held-ness stays derived per
 *  frame, and the release is a FACT the derivation consumes. These pins are the
 *  ones that hold the design in place: the subtraction happens AFTER the guard
 *  has enumerated, so a release changes what is HELD and never what is FORMABLE.
 *
 *  Written to be mutation-provable, like every pin above: drop either half of
 *  the (lane, windowStart) identity and one of the identity pins turns red, and
 *  count the spans a second way and the derived-count pin does.
 *
 *  ⚠ ON THE ORDERING MUTANT, honestly (measured in E5's mutation run): carving
 *  an ENUMERATED window out of the pocket before the greedy runs leaves this
 *  greedy's other windows exactly where they were — earliest-finish scanned
 *  left to right on the lattice re-selects the same starts either side of the
 *  hole. What that mutant DOES break is the pin below that a release matching
 *  nothing changes nothing: a carve happens whether or not the guard ever
 *  enumerated the window, so a phantom release moves real windows. The
 *  neighbour byte-identity is asserted anyway — it is the property the ordering
 *  guarantees on every board, not only on the ones this greedy forgives. */
describe('8 — a released window is SUBTRACTED, and nothing else moves', () => {
  /** A lane the SWEEP board holds MORE THAN ONE window on — the only board
   *  shape that can prove the ordering claim, since the claim is about what
   *  happens to the OTHER windows. */
  function twoWindowLane(): { lanes: BoardLane[]; guard: GuardConfig; book: BedTruth; laneKey: string; spans: readonly { start: number; end: number; windowStart: number }[] } {
    const lanes = board(SWEEP)
    const guard = guardConfig()
    const book = bookOf(lanes)
    const hit = maskOf(lanes, guard, 'standard', book).find((m) => m.spans.length > 1)
    expect(hit).toBeDefined()
    return { lanes, guard, book, laneKey: hit!.laneKey, spans: hit!.spans }
  }

  it('absent, empty, and a release that matches nothing are all E1’s answer — byte for byte', () => {
    const { lanes, guard, book, laneKey, spans } = twoWindowLane()
    const none = JSON.stringify(maskOf(lanes, guard, 'standard', book))
    expect(JSON.stringify(maskOf(lanes, guard, 'standard', book, []))).toBe(none)
    // The identity is (lane, windowStart) WHOLE. A real lane with a start the
    // guard never enumerated releases nothing…
    expect(JSON.stringify(maskOf(lanes, guard, 'standard', book, [{ laneKey, windowStart: spans[0].windowStart + 7 }]))).toBe(none)
    // …and a real start on a lane that is not this one releases nothing either.
    expect(JSON.stringify(maskOf(lanes, guard, 'standard', book, [{ laneKey: 'no-such-lane', windowStart: spans[0].windowStart }]))).toBe(none)
  })

  it('the release is LANE-SCOPED — the same start on another lane is untouched', () => {
    // Two staff lanes holding a window at the SAME start is the ordinary case on
    // a roster where everybody works the same shift; a release that dropped the
    // lane half of the key would empty the whole board's 14:30.
    const lanes = board(SWEEP)
    const guard = guardConfig()
    const book = bookOf(lanes)
    const before = maskOf(lanes, guard, 'standard', book)
    const shared = before
      .flatMap((m) => m.spans.map((s) => ({ laneKey: m.laneKey, windowStart: s.windowStart })))
      .filter((a, _i, all) => all.filter((b) => b.windowStart === a.windowStart).length > 1)
    expect(shared.length).toBeGreaterThan(1)
    const [mine, theirs] = [shared[0], shared.find((s) => s.windowStart === shared[0].windowStart && s.laneKey !== shared[0].laneKey)!]
    const after = maskOf(lanes, guard, 'standard', book, [mine])
    const startsOn = (masks: readonly ReservedLaneMask[], key: string) => masks.find((m) => m.laneKey === key)!.spans.map((s) => s.windowStart)
    expect(startsOn(after, mine.laneKey)).not.toContain(mine.windowStart)
    expect(startsOn(after, theirs.laneKey)).toContain(theirs.windowStart)
  })

  it('releasing ONE window takes that window, and the neighbours stay BYTE-IDENTICAL', () => {
    const { lanes, guard, book, laneKey, spans } = twoWindowLane()
    const released: ReleasedWindow = { laneKey, windowStart: spans[0].windowStart }
    const after = maskOf(lanes, guard, 'standard', book, [released])
    const lane = after.find((m) => m.laneKey === laneKey)!
    // The window is gone…
    expect(lane.spans.map((s) => s.windowStart)).not.toContain(released.windowStart)
    expect(lane.spans).toHaveLength(spans.length - 1)
    // …the count is DERIVED from what is left, never counted a second way…
    expect(lane.protectedCount).toBe(lane.spans.length)
    // …and every OTHER window on that lane is the same object's worth of bytes.
    // THIS is the ordering claim: the greedy ran over the whole pocket first, so
    // it never re-packed itself around the hole the release made.
    expect(JSON.stringify(lane.spans)).toBe(JSON.stringify(spans.slice(1)))
    // Every lane the release did not name is untouched, whole.
    const before = maskOf(lanes, guard, 'standard', book)
    for (const m of after.filter((x) => x.laneKey !== laneKey)) {
      expect(JSON.stringify(m)).toBe(JSON.stringify(before.find((b) => b.laneKey === m.laneKey)))
    }
  })

  it('ONE fact, TWO snapshots — the same released list answers for two worlds', () => {
    // ⚖ spec §2's two instances: the sales door reads the committed world and
    // the staff door the board world. A release is handed to BOTH, so a window
    // is released at both doors or at neither — the disagreement the mask exists
    // to make impossible.
    const busy = board(SWEEP)
    const quiet = board({ ...SWEEP, perLane: 1, seed: 99 })
    const guard = guardConfig()
    const pick = maskOf(busy, guard, 'standard').find((m) => m.spans.length > 0)!
    const released: ReleasedWindow[] = [{ laneKey: pick.laneKey, windowStart: pick.spans[0].windowStart }]
    for (const world of [busy, quiet]) {
      const held = maskOf(world, guard, 'standard', bookOf(world), released)
      const lane = held.find((m) => m.laneKey === pick.laneKey)
      expect(lane?.spans.map((s) => s.windowStart) ?? []).not.toContain(released[0].windowStart)
    }
  })
})
