// THE FRAGMENT FALLBACK'S OWN BATTERY — spec §5, E2 scope.
//
// The pass is DARK this round (spec §12, E2: zero consumers), so this file is
// the only thing that can prove it. Every pin is written to be
// MUTATION-PROVABLE: break one line of fallback-cells.ts and exactly one of
// these turns red.
//
// WHAT IT PROVES, in the order the law decides things:
//   §1 THE ごろう PIN — the real fixture world, driven exactly as PROBE-E2
//      drove it, at the store's shipped dials: the stretch R4's reconcile
//      empties (見本ごろう 15:00–17:00) comes back as the two fragments the
//      probe measured free — 15:30–16:00 on ベッド1 ¥4,410 and 16:30–17:00 on
//      ベッド3 ¥4,610 — out of the UNCHANGED shipped engine (SIM-7). Spans,
//      rooms, prices, count and provenance all pinned.
//   §2 NO DOUBLE-CLAIM — across the widened dial matrix, on two boards: no
//      fallback cell's room×span meets the shared claims context (with the
//      room's turnaround), no two fallback cells meet on a room, and no two
//      meet on a PERSON (blind-round B1: one person advertised on two rooms at
//      one minute).
//   §3 CLASS-AWARE ROOMS — ⚖ 51 through a hand-built 個室 scene, both
//      directions: a standard-room fragment exists ⇒ the 個室 is not spent;
//      take the standard room away ⇒ the 個室 clip appears.
//   §4 HELD-SPAN EXCLUSION — no fallback cell overlaps a 新規用に確保 span, and
//      the suppressed count comes back for E3, pinned on the scene where the
//      store's own guard holds exactly one of ごろう's two fragments.
//   §5 PURITY — two builds byte-identical, inputs never touched.
//   §6 DARK-NESS — nothing in src/ imports the module.
//   §7 THE SWEEP + THE RESIDUAL CLASS — FALLBACK-SWEEP-e2 and
//      RESIDUAL-CLASS-e2, the measurement spec §5c makes the canon flag
//      conditional on.
//
//   §8 THE GRID HOLE (⚖ R6 B1) — `gridHoleWindows`' own arithmetic, the
//      probe's 50-minute pocket closed at gridMin=30, and the property that a
//      finer customer grid never takes a pocket from sold to nothing.
//
// ⚠ THE FLOOR MOVED AT R6, AND THE E2 NOTE THAT STOOD HERE IS WHY. It read
// 「THE FLOOR IS NOT HERE, AND SHOULD NOT BE … those two are the seam's business
// at E3」 — and at E3 the seam took `combineCrumbs`' half and left the other
// half nowhere, so a fragment shorter than the store's `minSellableMin` was
// drawn out of the fallback while the native layer deleted the very same shape.
// `minSellableMin` is now an input to the pass and is applied where
// `gapLayerFor` applies its own (over the finished cells), so this file drives
// it exactly as the screen does. `combineCrumbs` is still NOT this pass's — see
// §8's own note.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { bedTruthViews } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import {
  fallbackCellsFor,
  gridHoleWindows,
  type FallbackCell,
  type FallbackResult,
} from '@/app/[locale]/(business)/business/today/fallback-cells'
import { reservedMaskFor, type ReservedLaneMask } from '@/app/[locale]/(business)/business/today/reserved-mask'
import {
  allocateBed,
  gapKindOf,
  gapLayerFor,
  laneSpans,
  sellLayerFor,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import {
  freePockets,
  gapFillPieces,
  kGridCount,
  kPackCount,
  type GapCell,
  type SellCell,
} from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig } from '@/business/lib/canon-logic/gap-guard'
import { clampPriceInputs, gapFillPrice, packedPrice, SELL_SLOT_MIN } from '@/business/lib/canon-logic/pricing'
import { STORE_A } from '@/business/lib/fixtures'
import { cleanupBlocks, hhmm, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

// ── THE REAL FIXTURE WORLD, driven exactly as PROBE-E2 drove it ─────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function screenProps(node: any): TodayProps | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === TodayScreen) return node.props
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = screenProps(kid)
    if (hit) return hit
  }
  return null
}

let REAL: TodayProps

beforeAll(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z'))
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({ select: () => chain(r), eq: () => chain(r), maybeSingle: async () => r })
  service.mockReturnValue({
    from: (table: string) =>
      chain(
        table === 'business_workspace_grants'
          ? { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null }
          : table === 'profiles'
            ? { data: { customer_id: 'biz-1', is_management: false }, error: null }
            : { data: null, error: null },
      ),
  })
  REAL = screenProps(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ store: STORE_A }),
    }),
  )!
})

afterAll(() => jest.useRealTimers())

// ── THE PIPELINE, ONE READING ───────────────────────────────────────────────

/** The three dials the packing layer — and therefore this pass — actually
 *  takes. `minSellableMin` is NOT one of them: it is a display floor
 *  `gapLayerFor` applies above canon, and the module never sees it. */
interface Dials {
  gridMin: number
  sessionMin: number
  gapFillMin: number
}

interface World {
  name: string
  lanes: BoardLane[]
  hours: Hours
  now: number | null
  cleanup: Record<string, number>
  guard: GuardConfig
  /** The store's own display floor, for the gap layer above this pass. */
  minSellableMin: number
}

function priceOf() {
  const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
  return {
    price,
    depth: Math.round((1 - price.lo / price.hi) * 100),
    frame: { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax },
  }
}

interface Run {
  claims: GapCell[]
  dropped: SellDrop[]
  survivors: SellCell[]
  fallback: FallbackResult
}

/** THE WHOLE SEAM, in the order spec §4 puts it: gap layer → sell layer with
 *  R4's reconcile over the SAME claims → the fallback pass over what the
 *  reconcile threw away. Nothing here re-derives anything: every input the pass
 *  takes is what the pipeline above it produced. */
function run(w: World, d: Dials, held: readonly ReservedLaneMask[] = [], locked: string[] = []): Run {
  const { price, depth, frame } = priceOf()
  const engine = createGapGuard(w.guard)
  const gap = gapLayerFor(w.lanes, {
    gridMin: d.gridMin,
    sessionMin: d.sessionMin,
    gapFillMin: d.gapFillMin,
    gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
    minSellableMin: w.minSellableMin,
    nowMinute: w.now,
    locked,
    frame,
    depth,
    guard: w.guard,
  })
  const claims: GapCell[] = [...gap.packed, ...gap.scraps]
  const dropped: SellDrop[] = []
  const sell = sellLayerFor(w.lanes, w.hours, {
    gridMin: d.gridMin,
    nowMinute: w.now,
    locked,
    showPrice: true,
    hi: price.hi,
    hqMin: REAL.dialogs.pricing.hqMin,
    depth,
    reconcile: {
      claims,
      cleanupMinutesByBed: w.cleanup,
      onDrop: (x) => dropped.push(x),
    },
  })
  const survivors = sell.cells.filter((c) => c.group === 'staff')
  return {
    claims,
    dropped,
    survivors,
    fallback: fallbackCellsFor({
      lanes: w.lanes,
      closeMin: w.hours.close,
      dropped,
      survivors,
      claims,
      cleanupMinutesByBed: w.cleanup,
      held,
      // ⚖ Greptile #815 — the same list handed to `gap`/`sell` above, so this
      // composer's fallback shields the same lanes the screen's does.
      locked,
      // ⚖ R6 B1 — the screen hands the pass the store's own floor now
      // (TodayScreen `salesDoor`), so this composer does too: a battery that
      // drives the seam differently from the screen proves the wrong thing.
      minSellableMin: w.minSellableMin,
      dials: {
        gridMin: d.gridMin,
        sessionMin: d.sessionMin,
        gapFillMin: d.gapFillMin,
        now: w.now,
        fillableExactly: engine.fillableExactly,
        fillDecomposition: engine.fillDecomposition,
        packedPrice: (l, a, b) => packedPrice(l.listPrice, a, b, frame, depth),
        gapFillPrice: (l, a, b) => gapFillPrice(l.listPrice, a, b, frame, depth, REAL.guard.gapFillDiscountPct),
      },
    }),
  }
}

const boxes = (r: FallbackResult): FallbackCell[] =>
  [...r.packed, ...r.scraps].filter((c) => c.group === 'staff')
const bedRows = (r: FallbackResult): FallbackCell[] =>
  [...r.packed, ...r.scraps].filter((c) => c.group === 'beds')
const shipped = (): Dials => ({
  gridMin: REAL.sell.gridMin,
  sessionMin: REAL.guard.standardSessionMin,
  gapFillMin: REAL.guard.gapFillMinMin,
})
const fixtureWorld = (): World => ({
  name: 'fixture',
  lanes: REAL.lanes,
  hours: REAL.hours,
  now: REAL.sell.nowMinute,
  cleanup: REAL.bedCleanupMinutes,
  guard: REAL.guard.config,
  minSellableMin: REAL.guard.minSellableMin ?? 0,
})

// ── THE SYNTHETIC ANY-ROSTER BOARD (E1's, kept local for the same reason) ───

const OPEN = 540 // 09:00
const CLOSE = 1080 // 18:00
const SYNTH_HOURS: Hours = { open: OPEN, close: CLOSE }
/** Turnaround that is NOT zero, so §2's separation assertion is not vacuous —
 *  the fixture store runs 0 on all three rooms. */
const SYNTH_CLEANUP: Record<string, number> = { 'bed-01': 0, 'bed-02': 10, 'bed-03': 15 }

function rng(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const pad2 = (n: number) => String(n + 1).padStart(2, '0')
const hits = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.end > b.start && a.start < b.end

function item(over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'kind' | 'startMin' | 'endMin'>): BoardItem {
  return {
    state: 'confirmed',
    category: null,
    ...place(over.startMin, over.endMin, SYNTH_HOURS),
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

/** THE ANY-ROSTER BOARD. Deterministic: an LCG, never Math.random. Each staff
 *  lane is dealt bookings on the 15-minute grid and given the first room in its
 *  own store that is free — so the day is one a store could really have run and
 *  the rooms are genuinely contended, which is what makes the reconcile drop
 *  anything at all. Bed lanes carry the shipped 清掃 blocks for their own
 *  bookings (`cleanupBlocks`), so the synthetic rooms are as busy as real ones. */
function board(spec: { staff: number; beds: number; seed: number; perLane: number; privateBeds?: number }): BoardLane[] {
  const privateBeds = spec.privateBeds ?? 1
  const next = rng(spec.seed)
  const placed: Array<{ id: string; staffKey: string; bedKey: string; start: number; end: number }> = []

  for (let i = 0; i < spec.staff; i += 1) {
    const staffKey = `p-${pad2(i)}`
    for (let n = 0; n < spec.perLane; n += 1) {
      const dur = [45, 60, 90][Math.floor(next() * 3) % 3]
      const start = OPEN + Math.floor((next() * (CLOSE - OPEN - dur)) / 15) * 15
      const span = { start, end: start + dur }
      if (placed.some((p) => p.staffKey === staffKey && hits(p, span))) continue
      const bedKey = Array.from({ length: spec.beds }, (_, j) => `bed-${pad2(j)}`).find(
        (k) => !placed.some((p) => p.bedKey === k && hits(p, span)),
      )
      if (!bedKey) continue
      placed.push({ id: `apt-${pad2(i)}-${n}`, staffKey, bedKey, ...span })
    }
  }

  const lanes: BoardLane[] = []
  for (let i = 0; i < spec.staff; i += 1) {
    const key = `p-${pad2(i)}`
    lanes.push(
      lane({
        key,
        group: 'staff',
        label: `見本 ${pad2(i)}`,
        items: placed
          .filter((p) => p.staffKey === key)
          .map((p) => item({ key: p.id, kind: 'booking', startMin: p.start, endMin: p.end }))
          .sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  for (let j = 0; j < spec.beds; j += 1) {
    const key = `bed-${pad2(j)}`
    const on = placed.filter((p) => p.bedKey === key)
    const items: BoardItem[] = on.map((p) =>
      item({ key: `${p.id}-bed`, kind: 'booking', startMin: p.start, endMin: p.end, caseId: p.id }),
    )
    for (const c of cleanupBlocks(on.map((p) => ({ id: p.id, start: p.start, end: p.end })), SYNTH_CLEANUP[key] ?? 0, SYNTH_HOURS)) {
      items.push(item({ key: c.id, kind: 'cleanup', startMin: c.start, endMin: c.end, title: '清掃', caseId: null }))
    }
    lanes.push(
      lane({
        key,
        group: 'beds',
        label: `ベッド${j + 1}`,
        roomClass: j >= spec.beds - privateBeds ? 'private' : 'standard',
        items: items.sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  return lanes
}

const SYNTH_SPEC = { staff: 8, beds: 3, seed: 4242, perLane: 3 }
const syntheticWorld = (): World => ({
  name: 'synthetic ANY-ROSTER 8×3',
  lanes: board(SYNTH_SPEC),
  hours: SYNTH_HOURS,
  now: null,
  cleanup: SYNTH_CLEANUP,
  guard: REAL.guard.config,
  minSellableMin: REAL.guard.minSellableMin ?? 0,
})

// ── THE WIDENED MATRIX ──────────────────────────────────────────────────────

const GRID_AXIS = [30, 60] as const
const SESSION_AXIS = [45, 60, 90] as const
const GAP_FILL_AXIS = [0, 30] as const

const MATRIX: Dials[] = GRID_AXIS.flatMap((gridMin) =>
  SESSION_AXIS.flatMap((sessionMin) => GAP_FILL_AXIS.map((gapFillMin) => ({ gridMin, sessionMin, gapFillMin }))),
)
const dialLabel = (d: Dials) => `grid=${d.gridMin} S=${d.sessionMin} gapFillMin=${d.gapFillMin}`
const span = (s: number, e: number) => `${hhmm(s)}-${hhmm(e)}`

// ── 1 · THE ごろう PIN ───────────────────────────────────────────────────────

describe('1 — the ごろう pin: the shipped engine emits the real fragments', () => {
  it('reproduces PROBE-E2 SIM-7 at the store’s own dials, from the whole pipeline', () => {
    const w = fixtureWorld()
    // No mask here on purpose: the probe measured the board with no reserved
    // set at all, and this pin IS that measurement. §4 supplies the mask.
    const r = run(w, shipped())

    // THE PREMISE, re-measured rather than assumed — if the reconcile ever
    // stops dropping these two, the pin below is testing nothing.
    expect(r.dropped.map((d) => `${d.laneKey}@${hhmm(d.h)}/${d.kind}`)).toEqual([
      'p-05@15:00/room',
      'p-05@16:00/room',
    ])

    const got = boxes(r.fallback).map((c) => ({
      lane: c.laneKey,
      span: span(c.s, c.e),
      room: c.resourceKey,
      price: c.price,
      sourceLane: c.sourceLane,
      provenanceRoom: c.room,
      clippedFrom: span(c.clippedFrom.start, c.clippedFrom.end),
    }))
    // SIM-7, to the yen. The cells carry price at this layer, so it is pinned.
    expect(got).toEqual([
      {
        lane: 'p-05',
        span: '15:30-16:00',
        room: 'bed-01',
        price: 4410,
        sourceLane: 'p-05',
        provenanceRoom: 'bed-01',
        clippedFrom: '15:30-16:00',
      },
      {
        lane: 'p-05',
        span: '16:30-17:00',
        room: 'bed-03',
        price: 4610,
        sourceLane: 'p-05',
        provenanceRoom: 'bed-03',
        clippedFrom: '16:30-17:00',
      },
    ])
    expect(boxes(r.fallback)).toHaveLength(2)
    // ONE BOX, TWO ROWS — canon's own emission grammar, carried through.
    expect(bedRows(r.fallback).map((c) => `${c.resourceKey} ${span(c.s, c.e)}`)).toEqual([
      'bed-01 15:30-16:00',
      'bed-03 16:30-17:00',
    ])
    expect(r.fallback.claims).toHaveLength(4)
    expect(r.fallback.heldDropped).toBe(0)

    // Both come back at FULL price out of `packed`, never discounted: canon's
    // own 「first-class residue is never discounted」 rule (guardTier) fits a
    // 30-minute run to the store's own 30-minute menu item.
    expect(r.fallback.scraps).toHaveLength(0)
    expect(r.fallback.packed).toHaveLength(4)

    // ¥9,020 of value that is on the board's own rooms and was drawn nowhere.
    expect(boxes(r.fallback).reduce((n, c) => n + c.price, 0)).toBe(9020)
  })

  it('the fragments land inside the emptied POCKET and on nobody else’s row', () => {
    const r = run(fixtureWorld(), shipped())
    // 見本ごろう's own free pocket, 14:25–17:00 — the stretch the board draws
    // nothing on. Every fallback cell is inside it and on his row alone.
    for (const c of boxes(r.fallback)) {
      expect(c.laneKey).toBe('p-05')
      expect(c.s).toBeGreaterThanOrEqual(865)
      expect(c.e).toBeLessThanOrEqual(1020)
    }
    // And both sit INSIDE the hours the reconcile emptied — which is the whole
    // point: it dropped two 60-minute offers over room-time that was only free
    // for 30, and the pass sells the 30.
    const lost = r.dropped.map((d) => ({ s: d.h, e: d.h + SELL_SLOT_MIN }))
    expect(boxes(r.fallback).filter((c) => lost.some((l) => c.e > l.s && c.s < l.e))).toHaveLength(2)
  })

  it('a board the reconcile drops nothing on gets nothing added', () => {
    const w = fixtureWorld()
    const r = fallbackCellsFor({
      lanes: w.lanes,
      closeMin: w.hours.close,
      dropped: [],
      survivors: [],
      claims: [],
      cleanupMinutesByBed: w.cleanup,
      held: [],
      locked: [],
      dials: dialsOf(w, shipped()),
    })
    expect([...r.packed, ...r.scraps, ...r.claims, ...r.clips]).toEqual([])
    expect(r.heldDropped).toBe(0)
  })
})

/** The dial bundle alone, for the two pins that call the module directly. */
function dialsOf(w: World, d: Dials) {
  const { depth, frame } = priceOf()
  const engine = createGapGuard(w.guard)
  return {
    gridMin: d.gridMin,
    sessionMin: d.sessionMin,
    gapFillMin: d.gapFillMin,
    now: w.now,
    fillableExactly: engine.fillableExactly,
    fillDecomposition: engine.fillDecomposition,
    packedPrice: (l: { listPrice: number }, a: number, b: number) => packedPrice(l.listPrice, a, b, frame, depth),
    gapFillPrice: (l: { listPrice: number }, a: number, b: number) =>
      gapFillPrice(l.listPrice, a, b, frame, depth, REAL.guard.gapFillDiscountPct),
  }
}

// ── 2 · NO DOUBLE-CLAIM ─────────────────────────────────────────────────────

/** The claims context as ROOM OCCUPANCY, rebuilt here from the pipeline's own
 *  outputs — never from the module's internals. Padded by the room's turnaround,
 *  which is the same test `promisedBy` applies when it decides who keeps a room. */
function contextOn(w: World, r: Run, roomKey: string) {
  const p = w.cleanup[roomKey] ?? 0
  return [
    ...r.claims.filter((c) => c.resourceKey === roomKey).map((c) => ({ s: c.s - p, e: c.e + p, why: `promise/${c.laneKey}` })),
    ...r.survivors
      .filter((c) => c.group === 'staff' && c.resourceKey === roomKey)
      .map((c) => ({ s: c.h - p, e: c.h + SELL_SLOT_MIN + p, why: `sell/${c.laneKey}` })),
    ...(w.lanes.find((l) => l.key === roomKey)?.items ?? []).map((i) => ({
      s: i.startMin,
      e: i.endMin,
      why: `board/${i.kind}`,
    })),
  ]
}

describe('2 — no double-claim, across the widened matrix on two boards', () => {
  it.each(MATRIX.map((d) => [dialLabel(d), d] as const))(
    'fixture · %s',
    (_label, d) => {
      assertNoDoubleClaim(fixtureWorld(), d)
    },
  )

  it.each(MATRIX.map((d) => [dialLabel(d), d] as const))(
    'ANY-ROSTER · %s',
    (_label, d) => {
      assertNoDoubleClaim(syntheticWorld(), d)
    },
  )

  it('the synthetic board really does exercise the pass (the matrix is not empty)', () => {
    const total = MATRIX.reduce((n, d) => n + boxes(run(syntheticWorld(), d).fallback).length, 0)
    expect(total).toBeGreaterThan(0)
    const drops = MATRIX.reduce((n, d) => n + run(syntheticWorld(), d).dropped.length, 0)
    expect(drops).toBeGreaterThan(0)
  })
})

/** ⚖ R6 B1 — the GRID-hole windows on one lane, asked of the module's own
 *  exported arithmetic over the lane's own free pockets. Re-deriving the rule
 *  here would be a second reading of it; this asks the same function the pass
 *  asks and only supplies the pockets. */
function holeWindowsOn(w: World, d: Dials, laneKey: string): Array<{ s: number; e: number }> {
  const l = w.lanes.find((x) => x.key === laneKey)
  if (!l || l.window == null) return []
  return freePockets({
    from: l.window.from,
    until: l.window.until,
    close: w.hours.close,
    now: w.now,
    occupied: laneSpans(l),
  }).flatMap((p) => gridHoleWindows(p.s, p.e, d))
}

function assertNoDoubleClaim(w: World, d: Dials) {
  const r = run(w, d)
  const emitted = boxes(r.fallback)
  const violations: string[] = []
  for (const c of emitted) {
    // (a) against the SHARED claims context, turnaround included.
    for (const b of contextOn(w, r, c.resourceKey)) {
      if (c.e > b.s && c.s < b.e) {
        violations.push(`${c.laneKey} ${span(c.s, c.e)}@${c.resourceKey} meets ${b.why} ${span(b.s, b.e)}`)
      }
    }
    for (const o of emitted) {
      if (o === c) continue
      // (b) two fallback cells never share a room-minute…
      if (o.resourceKey === c.resourceKey && c.e > o.s && c.s < o.e) {
        violations.push(`${span(c.s, c.e)} and ${span(o.s, o.e)} both on ${c.resourceKey}`)
      }
      // (c) …and never share a PERSON-minute (blind round B1).
      if (o.laneKey === c.laneKey && c.e > o.s && c.s < o.e) {
        violations.push(`${c.laneKey} advertised twice over ${span(c.s, c.e)} / ${span(o.s, o.e)}`)
      }
    }
    // (d) every cell sits inside the clip it says it came from.
    if (!(c.s >= c.clippedFrom.start && c.e <= c.clippedFrom.end)) {
      violations.push(`${span(c.s, c.e)} outside its clip ${span(c.clippedFrom.start, c.clippedFrom.end)}`)
    }
    // (e) ⚖ PIN MIGRATED at R6, WITH the decision (B1). At E2 the pass had ONE
    //     trigger — the reconcile's drops — so "never lands on a lane that kept
    //     its offer" WAS the additions-only statement. R6 gives it a second,
    //     `gridHoleWindows`: minutes canon's GRID branch handed to nobody, which
    //     need no drop at all. So the pin says what the E2 sentence stood for —
    //     a fallback cell exists only where a TRIGGER fired, and never anywhere
    //     else. Relaxing it to "some lanes are fine" would have thrown the
    //     invariant away instead of moving it.
    if (
      !r.dropped.some((x) => x.laneKey === c.laneKey) &&
      !holeWindowsOn(w, d, c.laneKey).some((h) => c.s >= h.s && c.e <= h.e)
    ) {
      violations.push(`${c.laneKey} gained a fallback cell with no drop and no grid hole`)
    }
  }
  expect({ at: `${w.name} ${dialLabel(d)}`, violations }).toEqual({ at: `${w.name} ${dialLabel(d)}`, violations: [] })
}

// ── 3 · CLASS-AWARE ROOMS (⚖ 51) ────────────────────────────────────────────

/** THE 個室 SCENE, hand-built so the ordering is the only thing under test.
 *
 *  One person, one hour of free time (15:00–16:00) that the reconcile has just
 *  emptied. ベッド1 (standard) is busy until 15:30; ベッド2 (個室) is busy only
 *  until 15:20. Board order alone would hand the 個室 the longer, dearer run —
 *  which is exactly what canon's class-blind `bedLedger` does, and exactly what
 *  `allocateBed` would refuse to do. */
function privateScene(withStandardRoom: boolean): { lanes: BoardLane[]; dropped: SellDrop[] } {
  const staff = lane({
    key: 'p-01',
    group: 'staff',
    label: '見本 いち',
    window: { from: 900, until: 960 },
    items: [],
  })
  const standard = lane({
    key: 'bed-01',
    group: 'beds',
    label: 'ベッド1',
    roomClass: 'standard',
    items: [item({ key: 'busy-01', kind: 'booking', startMin: 900, endMin: 930 })],
  })
  const priv = lane({
    key: 'bed-02',
    group: 'beds',
    label: '個室',
    roomClass: 'private',
    items: [item({ key: 'busy-02', kind: 'booking', startMin: 900, endMin: 920 })],
  })
  return {
    lanes: withStandardRoom ? [staff, standard, priv] : [staff, priv],
    dropped: [{ laneKey: 'p-01', h: 900, kind: 'room' }],
  }
}

function sceneRun(withStandardRoom: boolean): FallbackResult {
  const w = fixtureWorld()
  const scene = privateScene(withStandardRoom)
  return fallbackCellsFor({
    lanes: scene.lanes,
    closeMin: 1080,
    dropped: scene.dropped,
    survivors: [],
    claims: [],
    cleanupMinutesByBed: {},
    held: [],
    locked: [],
    dials: dialsOf({ ...w, now: null }, shipped()),
  })
}

describe('3 — class-aware rooms: the 個室 is spent last, always', () => {
  it('a standard room yields a fragment ⇒ the 個室 is NOT spent', () => {
    const r = sceneRun(true)
    const got = boxes(r).map((c) => `${span(c.s, c.e)}@${c.resourceKey}`)
    expect(got).toEqual(['15:30-16:00@bed-01'])
    expect(boxes(r).some((c) => c.resourceKey === 'bed-02')).toBe(false)
    // The 個室 was LOOKED AT — it is a candidate, it is just walked last and
    // what the standard room took is subtracted before it is asked.
    expect(r.clips.some((c) => c.room === 'bed-02')).toBe(true)
  })

  it('take the standard room away ⇒ the 個室 clip appears', () => {
    const r = sceneRun(false)
    const got = boxes(r).map((c) => `${span(c.s, c.e)}@${c.resourceKey}`)
    expect(got).toEqual(['15:20-16:00@bed-02'])
  })

  it('the order the pass walks IS the allocator’s own answer, not a second one', () => {
    // The anti-drift pin. `allocateBed` is the search that dropped the offer in
    // the first place; asked the same question over the same rooms for a
    // hypothetical (which carries no 個室のみ tag), it names the room the pass
    // reached for.
    //
    // ⚖ ROOM RULE — ONE ANSWER, NOT A LOOP OVER A DIAL. This used to run twice,
    // once per `privateIsLastResort` setting, and a sibling test pinned the OFF
    // setting's own order. Both go with the dial: 個室-last is law for every
    // store now, so there is exactly one order and exactly one answer.
    const scene = privateScene(true)
    const chosen = allocateBed(scene.lanes, {
      id: null,
      currentBed: null,
      stores: ['store-a'],
      requiresPrivate: false,
      start: 930,
      end: 960,
    })
    expect(chosen.laneKey).toBe('bed-01')
  })
})

// ── 4 · HELD-SPAN EXCLUSION ─────────────────────────────────────────────────

const maskFor = (w: World, guard: GuardConfig, mode: 'off' | 'standard' | 'strict') =>
  reservedMaskFor({
    lanes: w.lanes,
    closeMin: w.hours.close,
    nowMin: w.now,
    guard,
    gapGuardMode: mode,
    book: bedTruthViews(w.lanes, { openMin: w.hours.open, closeMin: w.hours.close, nowMin: w.now ?? w.hours.open }, null)
      .world,
  })

describe('4 — held spans are never sold, and the suppression is counted', () => {
  it('the store’s own guard holds exactly one of ごろう’s two fragments', () => {
    const w = fixtureWorld()
    const mask = maskFor(w, w.guard, 'standard')
    const p05 = mask.find((m) => m.laneKey === 'p-05')!
    // The scene, stated: 新規用に確保 14:30–16:00 (the store's own 90-minute
    // 新規 session), which covers 15:30–16:00 and leaves 16:30–17:00 alone.
    expect(p05.spans.map((s) => span(s.start, s.end))).toEqual(['14:30-16:00'])

    const open = run(w, shipped())
    const guarded = run(w, shipped(), mask)
    expect(boxes(open.fallback).map((c) => span(c.s, c.e))).toEqual(['15:30-16:00', '16:30-17:00'])
    expect(boxes(guarded.fallback).map((c) => span(c.s, c.e))).toEqual(['16:30-17:00'])
    expect(guarded.fallback.heldDropped).toBe(1)
    // Counted per BOX, not per row: canon emits two cells and one is dropped.
    expect(guarded.fallback.claims).toHaveLength(2)
  })

  it('a longer protected duration holds BOTH fragments and the row goes silent', () => {
    const w = fixtureWorld()
    const mask = maskFor(w, { ...w.guard, protectedDurationMin: 75 }, 'standard')
    const r = run(w, shipped(), mask)
    expect(boxes(r.fallback)).toEqual([])
    expect(r.fallback.heldDropped).toBe(2)
  })

  it('guard OFF holds nothing, so the fallback is untouched', () => {
    const w = fixtureWorld()
    expect(maskFor(w, w.guard, 'off')).toEqual([])
    const r = run(w, shipped(), maskFor(w, w.guard, 'off'))
    expect(boxes(r.fallback).map((c) => span(c.s, c.e))).toEqual(['15:30-16:00', '16:30-17:00'])
  })

  it('no emitted cell ever overlaps a held span, across the matrix on both boards', () => {
    for (const make of [fixtureWorld, syntheticWorld]) {
      const w = make()
      const mask = maskFor(w, w.guard, 'standard')
      const heldByLane = new Map(mask.map((m) => [m.laneKey, m.spans]))
      for (const d of MATRIX) {
        const r = run(w, d, mask)
        const bad = boxes(r.fallback).filter((c) =>
          (heldByLane.get(c.laneKey) ?? []).some((h) => c.e > h.start && c.s < h.end),
        )
        expect({ at: `${w.name} ${dialLabel(d)}`, bad: bad.map((c) => span(c.s, c.e)) }).toEqual({
          at: `${w.name} ${dialLabel(d)}`,
          bad: [],
        })
      }
    }
  })
})

// ── 5 · PURITY / STRICTMODE ─────────────────────────────────────────────────

describe('5 — the pass is pure', () => {
  it('two builds on identical inputs are byte-identical', () => {
    for (const make of [fixtureWorld, syntheticWorld]) {
      for (const d of MATRIX) {
        const a = JSON.stringify(run(make(), d).fallback)
        const b = JSON.stringify(run(make(), d).fallback)
        expect({ at: `${make().name} ${dialLabel(d)}`, same: a === b }).toEqual({
          at: `${make().name} ${dialLabel(d)}`,
          same: true,
        })
      }
    }
  })

  it('nothing handed in is mutated', () => {
    const w = syntheticWorld()
    const r = run(w, shipped())
    const input = {
      lanes: w.lanes,
      closeMin: w.hours.close,
      dropped: r.dropped,
      survivors: r.survivors,
      claims: r.claims,
      cleanupMinutesByBed: w.cleanup,
      held: maskFor(w, w.guard, 'standard'),
      locked: [],
      minSellableMin: w.minSellableMin,
    }
    const before = JSON.stringify(input)
    // ⚖ R6 B1 — AND AT THE DIALS THE NEW TRIGGER FIRES AT. `shipped()` is
    // gridMin 60, where the grid-hole class is structurally empty, so the
    // StrictMode mutant used to walk only the drop class's code. The second
    // pair drives the same inputs through the trigger that walks a pocket
    // NOTHING was dropped from — the walk that could most easily have started
    // writing on the lanes it was handed.
    const hole: Dials = { ...shipped(), gridMin: 30, sessionMin: 60 }
    for (const d of [shipped(), shipped(), hole, hole]) {
      fallbackCellsFor({ ...input, dials: dialsOf(w, d) })
    }
    expect(JSON.stringify(input)).toBe(before)
  })
})

// ── 6 · DARK-NESS ───────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

describe('6 — the pass has exactly one consumer, and it is gated', () => {
  /** ⚖ PIN MIGRATED at E3a, WITH the decision (SPEC-SELLING-ENGINE §12).
   *
   *  At E2 this read 「nothing in src/ imports fallback-cells」 and that was the
   *  whole point: the module shipped DARK, zero consumers, so nothing on the
   *  board could move. E3a is the round that wires it, so the pin becomes what
   *  the darkness was always standing in for — ONE consumer, at the screen
   *  boundary, behind the round gate. Relaxing it to "some importers are fine"
   *  would have thrown the invariant away instead of moving it. */
  it('exactly one consumer — the screen — and its call is behind the round gate', () => {
    const importers = walk(join(process.cwd(), 'src'))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => !f.endsWith('fallback-cells.ts') && !f.endsWith('fallback-cells.test.ts'))
      // ⚠ `from ["']` rather than `from '`: the phone-safety import scanner
      // (business-isolation.test.ts) reads THIS file with its own naive
      // `from\s*'([^'\n]+)'`, so a literal `from '…` inside a regex here is
      // parsed as an import of the bare package `[^`. E2 shipped that shape and
      // it went red the moment the suite was run outside the `business/` folder
      // — found here at E3a, fixed at the character that caused it.
      .filter((f) => /from ["'][^"']*fallback-cells["']|require\([^)]*fallback-cells/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(process.cwd().length + 1))
      // Batteries are not consumers: a suite that drives the pass is what
      // proves it, and E3a's own reads it beside this one. The invariant is
      // about the PRODUCT — how many places on the board can reach the pass.
      .filter((f) => !f.includes('__tests__'))
    expect(importers).toEqual(['src/app/[locale]/(business)/business/today/TodayScreen.tsx'])
    // …and the pass runs ONLY when the sales door has a mask, which it only has
    // when `SELLING_ENGINE_LAW` is on. Gate off ⇒ `heldCommitted` is undefined
    // ⇒ this memo returns null ⇒ `fallbackCellsFor` is never called at all.
    const screen = readFileSync(importers[0], 'utf8')
    expect(screen).toContain('if (!heldCommitted) return null')
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F4): `salesDoor` used
    // to be a two-field object whose second field (`reserved`) had no reader at
    // all, so the memo IS the fallback now and the call lost its property name.
    // Same one consumer, same gate, same order — only the wrapper went.
    expect(screen).toContain('return fallbackCellsFor({')
    expect(screen.indexOf('if (!heldCommitted) return null')).toBeLessThan(screen.indexOf('return fallbackCellsFor({'))
  })
})

// ── 7 · THE SWEEP + THE RESIDUAL CLASS ──────────────────────────────────────

const EVIDENCE = process.env.E2_EVIDENCE ?? ''
const SHA = process.env.E2_SHA ?? 'unstamped'

/** THE RESIDUAL CLASS (spec §5c) — the one thing the clip cannot emit and
 *  canon's `packCleanGrid` flag could.
 *
 *  A clip is in the class when it takes availability.ts:427's clean-grid branch
 *  (`S === 60 && kGrid === kPack`) with at least one WHOLE session inside it:
 *  the branch then leaves the interior to the normal 販売可能枠 layer and hands
 *  back only `gapFillPieces`' ends — and for a fallback there IS no normal sell
 *  layer coming, so a full session's worth of one room goes unsold. `kPack === 0`
 *  is the case that WORKS: `gapFillPieces` falls through :312 and returns the
 *  whole run, which is where ごろう's two fragments come from. */
const inResidualClass = (c: { s: number; e: number }, d: Dials) =>
  d.sessionMin === 60 &&
  kGridCount(c.s, c.e, d.gridMin, d.sessionMin) === kPackCount(c.s, c.e, d.sessionMin) &&
  kPackCount(c.s, c.e, d.sessionMin) >= 1

describe('7 — the sweep and the residual-class measurement', () => {
  it('FALLBACK-SWEEP: every combination answers, on both boards', () => {
    const rows: string[] = []
    let cells = 0
    for (const make of [fixtureWorld, syntheticWorld]) {
      const w = make()
      const mask = maskFor(w, w.guard, 'standard')
      const heldByLane = new Map(mask.map((m) => [m.laneKey, m.spans]))
      for (const d of MATRIX) {
        const open = run(w, d)
        const guarded = run(w, d, mask)
        cells += boxes(open.fallback).length
        // THE LAW THIS SWEEP ENFORCES, on every row: under the store's own
        // guard nothing held is ever sold. (Note it is NOT
        // kept + held-dropped === open — see the artifact header.)
        const soldHeld = boxes(guarded.fallback).filter((c) =>
          (heldByLane.get(c.laneKey) ?? []).some((h) => c.e > h.start && c.s < h.end),
        )
        expect({ at: `${w.name} ${dialLabel(d)}`, soldHeld: soldHeld.length }).toEqual({
          at: `${w.name} ${dialLabel(d)}`,
          soldHeld: 0,
        })
        rows.push(
          `${w.name.padEnd(24)} | grid=${String(d.gridMin).padStart(2)} S=${String(d.sessionMin).padStart(2)}` +
            ` gapFillMin=${String(d.gapFillMin).padStart(2)}` +
            ` | drops ${String(open.dropped.length).padStart(3)}` +
            ` | lanes ${String(new Set(boxes(open.fallback).map((c) => c.laneKey)).size).padStart(2)}` +
            ` | clips ${String(open.fallback.clips.length).padStart(3)}` +
            ` | FALLBACK ${String(boxes(open.fallback).length).padStart(3)}` +
            ` ¥${String(boxes(open.fallback).reduce((n, c) => n + c.price, 0)).padStart(7)}` +
            ` | held-dropped ${String(guarded.fallback.heldDropped).padStart(3)}` +
            ` → ${String(boxes(guarded.fallback).length).padStart(3)} kept`,
        )
      }
    }
    // THE PASS FIRES. A build that quietly emitted nothing everywhere would
    // pass every other pin in this file.
    expect(cells).toBeGreaterThan(0)

    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, `FALLBACK-SWEEP-e2-${SHA}.txt`),
        [
          '# FALLBACK-SWEEP-e2 — the fragment fallback across the widened matrix (spec §5)',
          `# tip: ${SHA}`,
          '#',
          '# BOARDS',
          `#   fixture              — TodayPage's real ${STORE_A} world, driven exactly as PROBE-E2`,
          `#                          drove it (clock 2026-08-19T00:00:00Z, TZ=UTC, now ${hhmm(REAL.sell.nowMinute ?? 0)}),`,
          '#                          cleanup 0 on all three rooms.',
          `#   synthetic ANY-ROSTER — ${SYNTH_SPEC.staff} staff / ${SYNTH_SPEC.beds} rooms (last one 個室), ${hhmm(OPEN)}-${hhmm(CLOSE)},`,
          `#                          ${SYNTH_SPEC.perLane} bookings dealt per lane, seed ${SYNTH_SPEC.seed} (deterministic LCG),`,
          `#                          turnaround ${JSON.stringify(SYNTH_CLEANUP)} with the shipped 清掃 blocks drawn,`,
          '#                          whole day sellable (now = null).',
          '#',
          '# THE AXES, and the trim. The pass takes exactly the packing layer’s own dials, so',
          '# the matrix is those three:',
          `#   gridMin ${GRID_AXIS.join('/')} × sessionMin ${SESSION_AXIS.join('/')} × gapFillMin ${GAP_FILL_AXIS.join('/')} = ${MATRIX.length} per board.`,
          `# minSellableMin stays at the store’s own ${REAL.guard.minSellableMin} because it is a DISPLAY floor`,
          '# `gapLayerFor` applies ABOVE canon — the module never sees it (it would be a dial',
          '# on a layer this pass does not run).',
          '#',
          '# columns: board | dials | reconcile drops | lanes that gained a cell | clips built',
          '#          | fallback boxes + their ¥ | held-dropped under the store’s own guard → kept',
          '#',
          ...rows,
          '#',
          '# held-dropped = boxes suppressed because they overlapped a 新規用に確保 span',
          `# (mask built by reservedMaskFor at guard mode 'standard', E1's builder, this world).`,
          '# ASSERTED per row, not eyeballed: under the mask, NOTHING held is ever sold.',
          '#',
          '# ⚠ WHY "kept + held-dropped" NEED NOT EQUAL "FALLBACK". A hold sits on the PERSON,',
          '# not on the room: 新規用に確保 reserves that staff member’s time, and the room under',
          '# it stays free. So a suppressed box releases its room, and another lane that also',
          '# lost an offer can then be advertised in it — the guarded run can end up with MORE',
          '# boxes on other rows than the open one. Measured behaviour, and the right one; the',
          '# suppressed lane itself never gains (its own walk is unchanged, the held minute is',
          '# spent either way).',
          '',
        ].join('\n'),
      )
    }
  })

  it('RESIDUAL-CLASS: the class `packCleanGrid` would cover is empty everywhere', () => {
    const rows: string[] = []
    const offenders: string[] = []
    let clipsSeen = 0
    for (const make of [fixtureWorld, syntheticWorld]) {
      const w = make()
      for (const d of MATRIX) {
        const r = run(w, d)
        const residual = r.fallback.clips.filter((c) => inResidualClass(c, d))
        clipsSeen += r.fallback.clips.length
        for (const c of residual) {
          offenders.push(`${w.name} ${dialLabel(d)} — ${c.laneKey} ${c.room} ${span(c.s, c.e)}`)
        }
        rows.push(
          `${w.name.padEnd(24)} | grid=${String(d.gridMin).padStart(2)} S=${String(d.sessionMin).padStart(2)}` +
            ` gapFillMin=${String(d.gapFillMin).padStart(2)}` +
            ` | clips ${String(r.fallback.clips.length).padStart(3)}` +
            ` | clean-grid clips ${String(r.fallback.clips.filter((c) => d.sessionMin === 60 && kGridCount(c.s, c.e, d.gridMin, d.sessionMin) === kPackCount(c.s, c.e, d.sessionMin)).length).padStart(3)}` +
            ` | RESIDUAL ${String(residual.length).padStart(3)}`,
        )
      }
    }
    // The measurement has to have looked at something for a zero to mean
    // anything.
    expect(clipsSeen).toBeGreaterThan(0)

    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, `RESIDUAL-CLASS-e2-${SHA}.txt`),
        [
          '# RESIDUAL-CLASS-e2 — does canon’s `packCleanGrid` flag ever have anything to do?',
          `# tip: ${SHA}`,
          '#',
          '# THE QUESTION (spec §5c). The E2 probe demoted the canon flag to CONDITIONAL: the',
          '# room-clipped input makes the UNCHANGED shipped engine emit the real fragments, and',
          '# the flag would only ever cover a RESIDUAL class — a clip that is grid-aligned, at',
          '# least one whole session long, on a single room. This file measures whether that',
          '# class occurs. If it is zero everywhere the round ships with ZERO canon edits and',
          '# §11’s unfreeze never arms.',
          '#',
          '# THE TEST, stated exactly. A clip is in the class when it takes availability.ts:427’s',
          '# clean-grid branch — sessionMin === 60 AND kGrid === kPack — with kPack >= 1. That',
          '# branch then hands back only `gapFillPieces`’ ends and leaves the whole-session',
          '# interior to the normal 販売可能枠 layer, which for a FALLBACK never comes. kPack === 0',
          '# is the case that WORKS: `gapFillPieces` falls through :312 and returns the run whole,',
          '# which is where ごろう’s ¥4,410 and ¥4,610 come from.',
          '#',
          '# BOARDS + AXES: identical to FALLBACK-SWEEP-e2 beside this file.',
          '#',
          '# columns: board | dials | clips built | of those, clean-grid | RESIDUAL (kPack >= 1)',
          '#',
          ...rows,
          '#',
          `# VERDICT: ${offenders.length === 0 ? 'ZERO EVERYWHERE.' : 'NON-ZERO — see the scenes below.'}`,
          offenders.length === 0
            ? [
                '#   No clip anywhere on either board, at any of the swept dials, is grid-aligned',
                '#   with a whole session inside it. `packCleanGrid` has nothing to do, so E2 needs',
                '#   no canon edit and the round’s one candidate unfreeze can be dropped.',
                '#   STRUCTURAL REASON (probe §B.4): a single room free for a whole grid-aligned',
                '#   hour inside a lost span is precisely what the reconcile’s own `allocateBed`',
                '#   re-bed would already have saved (today-interactions.ts:1020) — so the class is',
                '#   not merely absent here, it is the class the layer above already covers.',
              ].join('\n')
            : offenders.map((o) => `#   ${o}`).join('\n'),
          '',
        ].join('\n'),
      )
    }

    // ⚠ THE STOP CONDITION. A non-zero row is a canon-edit question and the
    // packet forbids answering it here: name the scene and stop.
    expect(offenders).toEqual([])
  })
})

// ── 8 · THE GRID HOLE (⚖ R6 B1) ─────────────────────────────────────────────
//
// THE DEFECT, measured at tip 4d10d4d5 (PROBE-R5R6 §3). `deriveGapPackingCells`
// takes its GRID branch when `S === 60 && kGrid === kPack` (availability.ts:427)
// and then offers only what `gapFillPieces` hands back. The rest it leaves "to
// the sell layer", which sells `SELL_SLOT_MIN` slots and nothing else — so a
// leftover shorter than one slot reaches NOBODY. At gridMin=30 a 50-minute
// pocket with two beds standing empty advertised ZERO of its 50 minutes at the
// store's own floor. At the shipped gridMin=60 the same pocket sold whole.
//
// ⚠ WHAT §8 DELIBERATELY DOES NOT PIN. `combineCrumbs` is still not this pass's:
// a recovered run that canon's `guardTier` decomposes into two menu-exact pieces
// comes back as two boxes where the native layer would have merged them into
// one. Pre-existing (it is true of the drop class too), out of R6's scope, and
// named here rather than left for someone to rediscover.

/** The probe's own construction (PROBE-R5R6 §3), rebuilt on the FIXTURE's real
 *  lanes — real labels, real `listPrice`, real shift windows, real room classes
 *  and the store's real menu — so the pin measures the world the defect was
 *  measured in. Every staff and bed lane is emptied except the target, which is
 *  walled into a pocket of exactly `len` minutes at 15:00: after `now`, strictly
 *  inside its own shift. bed-02 and bed-03 are provably free across the whole
 *  pocket, so "no bed available" can never be the explanation for a zero. */
const POCKET_START = 900

function pocketWorld(len: number): { w: World; targetKey: string; pEnd: number } {
  const base = fixtureWorld()
  const src = base.lanes.find(
    (l) =>
      l.group === 'staff' &&
      l.listPrice > 0 &&
      (l.window?.from ?? Number.POSITIVE_INFINITY) <= POCKET_START &&
      (l.window?.until ?? -1) >= POCKET_START + 60,
  )
  if (!src?.window) throw new Error('no fixture staff lane covers the pocket — the scene is not buildable')
  const from = Math.max(base.hours.open, src.window.from)
  const until = Math.min(base.hours.close, src.window.until)
  const pEnd = POCKET_START + len
  if (!(POCKET_START > from && pEnd < until)) throw new Error(`pocket ${POCKET_START}-${pEnd} outside shift ${from}-${until}`)
  const bedKeys = base.lanes.filter((l) => l.group === 'beds').map((l) => l.key)
  const wall = (key: string, s: number, e: number, tag: string): BoardItem =>
    item({ key, kind: 'booking', startMin: s, endMin: e, tag, caseId: key, title: 'PIN' })
  const lanes = base.lanes.map((l) => {
    if (l.group === 'staff' && l.key === src.key) {
      return {
        ...l,
        items: [wall('pin-A', from, POCKET_START, `【${bedKeys[0]}】`), wall('pin-B', pEnd, until, `【${bedKeys[0]}】`)],
      }
    }
    if (l.group === 'staff') return { ...l, items: [] }
    if (l.key === bedKeys[0]) {
      return {
        ...l,
        items: [wall('pin-A', from, POCKET_START, `【${src.key}】`), wall('pin-B', pEnd, until, `【${src.key}】`)],
      }
    }
    return { ...l, items: [] }
  })
  return { w: { ...base, name: `pocket-${len}`, lanes }, targetKey: src.key, pEnd }
}

/** Minutes of the pocket the board advertises on the TARGET lane, over both
 *  producers — the native layer's boxes plus the fallback's additions, which is
 *  exactly what `gapDrawn` hands the renderer (TodayScreen). Staff rows only:
 *  the bed row is the same offer drawn a second time. */
function soldInPocket(w: World, d: Dials, targetKey: string, pEnd: number): Array<{ s: number; e: number; from: string }> {
  const r = run(w, d)
  const inside = (s: number, e: number) => s >= POCKET_START && e <= pEnd
  return [
    ...r.claims
      .filter((c) => c.group === 'staff' && c.laneKey === targetKey && inside(c.s, c.e))
      .map((c) => ({ s: c.s, e: c.e, from: 'native' })),
    ...boxes(r.fallback)
      .filter((c) => c.laneKey === targetKey && inside(c.s, c.e))
      .map((c) => ({ s: c.s, e: c.e, from: 'fallback' })),
  ].sort((a, b) => a.s - b.s)
}

const minutesOf = (runs: Array<{ s: number; e: number }>) => runs.reduce((n, x) => n + (x.e - x.s), 0)

/** ONE PERSON, ONE POCKET, ONE FREE ROOM — the smallest board that can hold a
 *  single free run of an exact length. The day is walled off on both sides so
 *  `freePockets` hands back exactly `[s, e)` and nothing else can explain a box.
 *  Used by §8's branch-premise case and by §9's whole scene. */
const pocketPairLanes = (s: number, e: number): BoardLane[] => [
  lane({
    key: 'p-01',
    group: 'staff',
    label: '見本ごろう',
    items: [
      item({ key: 'wall-before', kind: 'booking', startMin: OPEN, endMin: s }),
      item({ key: 'wall-after', kind: 'booking', startMin: e, endMin: CLOSE }),
    ],
  }),
  lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
]

describe('8 — the GRID hole is closed at sub-60 grids (⚖ R6 B1)', () => {
  it('gridHoleWindows: canon’s own leftovers, and only the ones no sell slot can reach', () => {
    const S = 60
    // (a) THE CORE. 900-950 at gridMin=30: `gapFillPieces` returns only the tail
    //     930-950, so 900-930 is the leftover — 30 minutes, under one slot.
    expect(gridHoleWindows(900, 950, { gridMin: 30, sessionMin: S })).toEqual([{ s: 900, e: 930 }])
    // (b) THE :312 TAIL, which the packet's `[ceil(s/g)*g, floor(e/g)*g)` core
    //     formula computes as EMPTY and would have recovered nothing from.
    //     905-955 at gridMin=30 has gridEnd === gridStart === 930, so
    //     `gapFillPieces` falls to its `[{s, min(s+gridMin, e)}]` tail and offers
    //     905-935 alone; 935-955 is nobody's.
    expect(gapFillPieces(905, 955, 30)).toEqual([{ s: 905, e: 935 }])
    expect(gridHoleWindows(905, 955, { gridMin: 30, sessionMin: S })).toEqual([{ s: 935, e: 955 }])
    // (c) A LEFTOVER A SELL SLOT CAN REACH IS NOT THE CLASS — the GRID branch's
    //     premise holds there and the sell layer is the one that answers.
    expect(gridHoleWindows(900, 1050, { gridMin: 30, sessionMin: S })).toEqual([])
    // (d) NOT THE GRID BRANCH AT ALL: `S !== 60` takes canon's else branch,
    //     which packs from the head and scraps the residue itself.
    expect(gridHoleWindows(900, 950, { gridMin: 30, sessionMin: 90 })).toEqual([])
  })

  /** ⚖ R6 fix round A1 (L4-1) — AN ORACLE THE FUNCTION CANNOT ANSWER FOR ITSELF.
   *
   *  §8's other pins ask `gridHoleWindows` for a window list and then ask the
   *  battery whether the board sold it — which is the function blessing its own
   *  output: turn the `< SELL_SLOT_MIN` filter at fallback-cells :268 into
   *  `<=` and 1699 tests stay green while sell-reachable inventory is invented.
   *  Every column below is HAND-SPELLED arithmetic — what canon offers, what is
   *  therefore left, how long that is, and whether one 60-minute sell slot can
   *  reach it. Nothing here is computed by the function under test. */
  const ORACLE: Array<{
    why: string
    s: number
    e: number
    gridMin: number
    /** `gapFillPieces`' answer, written out by hand from availability.ts:303-314. */
    canonOffers: Array<{ s: number; e: number }>
    /** pocket − offers, by hand. */
    leftover: Array<{ s: number; e: number }>
    /** …and what `gridHoleWindows` must therefore answer. */
    holes: Array<{ s: number; e: number }>
  }> = [
    {
      why: 'shape 1 · the grid-aligned core, 30 minutes — under one slot, nobody’s',
      s: 900, e: 950, gridMin: 30,
      // gridStart = ceil(900/30)*30 = 900, gridEnd = floor(950/30)*30 = 930:
      // gridEnd > gridStart, so canon offers the head [900,900) (empty) and the
      // tail [930,950).
      canonOffers: [{ s: 930, e: 950 }],
      leftover: [{ s: 900, e: 930 }],
      holes: [{ s: 900, e: 930 }],
    },
    {
      why: 'shape 2 · the :312 tail the packet’s core formula computes as empty',
      s: 905, e: 955, gridMin: 30,
      // gridStart = 930, gridEnd = 930: gridEnd <= gridStart, so canon offers
      // the single piece [905, min(905+30, 955)) = [905,935).
      canonOffers: [{ s: 905, e: 935 }],
      leftover: [{ s: 935, e: 955 }],
      holes: [{ s: 935, e: 955 }],
    },
    {
      why: 'shape 1 · a pocket exactly one grid step long — canon offers nothing at all',
      s: 900, e: 930, gridMin: 30,
      // gridStart = 900, gridEnd = 930: both slivers are empty.
      canonOffers: [],
      leftover: [{ s: 900, e: 930 }],
      holes: [{ s: 900, e: 930 }],
    },
    {
      why: 'THE `<=` KILLER · a 60-minute leftover is NOT recovered — one sell slot reaches it exactly',
      s: 900, e: 960, gridMin: 30,
      // gridStart = 900, gridEnd = 960: the whole pocket is the aligned core and
      // canon offers neither sliver. 60 minutes is one `SELL_SLOT_MIN` on the
      // grid, so the sell layer advertises it and recovering it here would put
      // two producers on one minute. `< SELL_SLOT_MIN` refuses; `<=` would not.
      canonOffers: [],
      leftover: [{ s: 900, e: 960 }],
      holes: [],
    },
    {
      why: 'a long aligned core is the sell layer’s, not this trigger’s',
      s: 900, e: 1050, gridMin: 30,
      canonOffers: [],
      leftover: [{ s: 900, e: 1050 }],
      holes: [],
    },
    {
      why: 'THE THEOREM AT 60 · shape 2 — canon offers the run entire, nothing is left',
      s: 900, e: 950, gridMin: 60,
      // gridStart = 900, gridEnd = 900: the single piece is
      // [900, min(900+60, 950)) = the whole pocket.
      canonOffers: [{ s: 900, e: 950 }],
      leftover: [],
      holes: [],
    },
    {
      why: 'THE THEOREM AT 60 · shape 1 — the core is a whole number of 60s, never under a slot',
      s: 900, e: 1020, gridMin: 60,
      canonOffers: [],
      leftover: [{ s: 900, e: 1020 }],
      holes: [],
    },
    {
      why: '⚖ D3 · THE DECLARED REFUSAL at gridMin=90 — the leftover is REAL and is left alone',
      s: 45, e: 155, gridMin: 90,
      // gridStart = ceil(45/90)*90 = 90, gridEnd = floor(155/90)*90 = 90:
      // gridEnd <= gridStart, so canon offers [45, min(45+90, 155)) = [45,135)
      // and 135-155 reaches nobody — a genuine 20-minute hole. `gridHoleWindows`
      // answers [] anyway: above one slot the recovery is an unmeasured
      // generalization, so the trigger's domain stops at `< SELL_SLOT_MIN`.
      canonOffers: [{ s: 45, e: 135 }],
      leftover: [{ s: 135, e: 155 }],
      holes: [],
    },
  ]

  it('A1 — an independent oracle: canon’s offers, the leftover, and what may be recovered', () => {
    for (const row of ORACLE) {
      const at = `${row.why} · ${span(row.s, row.e)} g=${row.gridMin}`
      // (i) canon really does offer what the row says by hand.
      expect({ at, offers: gapFillPieces(row.s, row.e, row.gridMin) }).toEqual({ at, offers: row.canonOffers })
      // (ii) the row's own leftover is that pocket minus those offers — checked
      //      against the hand column by an independent walk, so a typo in either
      //      one shows up here rather than agreeing with itself.
      const cut = row.canonOffers
      const byHand = [{ s: row.s, e: row.e }].flatMap((p) => {
        let runs = [p]
        for (const c of cut) {
          runs = runs.flatMap((b) =>
            c.e <= b.s || c.s >= b.e
              ? [b]
              : [...(c.s > b.s ? [{ s: b.s, e: c.s }] : []), ...(c.e < b.e ? [{ s: c.e, e: b.e }] : [])],
          )
        }
        return runs
      })
      expect({ at, leftover: byHand }).toEqual({ at, leftover: row.leftover })
      // (iii) the branch check is not what is answering — every row is genuinely
      //       ON the GRID branch, so the holes column is the FILTER's answer.
      expect({ at, same: kGridCount(row.s, row.e, row.gridMin, 60) === kPackCount(row.s, row.e, 60) }).toEqual({
        at,
        same: true,
      })
      // (iv) and the function agrees with the hand-spelled expectation.
      expect({ at, holes: gridHoleWindows(row.s, row.e, { gridMin: row.gridMin, sessionMin: 60 }) }).toEqual({
        at,
        holes: row.holes,
      })
    }
  })

  it('⚖ D3 — the trigger is EMPTY at gridMin=60 by theorem, and REFUSES above it by declaration', () => {
    // AT 60 — a theorem, brute-forced over every pocket the day can hold. The
    // two shapes are argued in `gridHoleWindows`' comment; this is the sweep.
    const offenders: string[] = []
    for (let s = 540; s <= 1140; s += 5) {
      for (const len of [5, 15, 20, 30, 45, 50, 55, 60, 75, 90, 115, 120, 185]) {
        const found = gridHoleWindows(s, s + len, { gridMin: 60, sessionMin: 60 })
        if (found.length > 0) offenders.push(`${span(s, s + len)} → ${found.map((h) => span(h.s, h.e)).join(',')}`)
      }
    }
    expect(offenders).toEqual([])

    // ABOVE 60 — NOT a theorem. The same sweep at 90 and 120 finds pockets whose
    // raw arithmetic leaves a real sub-slot leftover, and the trigger declines
    // every one of them. This is the pin that goes red the day someone widens
    // the guard without measuring the class first (⚖ D3's rider).
    const real: string[] = []
    for (const gridMin of [90, 120]) {
      for (let s = 540; s <= 1140; s += 5) {
        for (const len of [75, 90, 115, 120, 185]) {
          const e = s + len
          if (kGridCount(s, e, gridMin, 60) !== kPackCount(s, e, 60)) continue
          const offers = gapFillPieces(s, e, gridMin)
          const covered = offers.reduce((n, p) => n + (p.e - p.s), 0)
          const leftover = len - covered
          if (leftover > 0 && leftover < SELL_SLOT_MIN) real.push(`g=${gridMin} ${span(s, e)} leftover=${leftover}m`)
          // …and refused, every time, whatever the arithmetic says.
          expect(gridHoleWindows(s, e, { gridMin, sessionMin: 60 })).toEqual([])
        }
      }
    }
    // The measurement looked at something — and at real hours of a real day.
    expect(real.length).toBeGreaterThan(0)
    expect(real).toContain('g=90 09:35-11:30 leftover=25m')
    // …plus L1's own construction, which is where the ceiling was found: canon
    // offers 45–135 of the pocket 45–155 and the last 20 minutes reach nobody.
    expect(gapFillPieces(45, 155, 90)).toEqual([{ s: 45, e: 135 }])
    expect(gridHoleWindows(45, 155, { gridMin: 90, sessionMin: 60 })).toEqual([])
  })

  it('A6 — kGrid ≠ kPack is the PACKER’s class, and the trigger is right to refuse it', () => {
    // 15:05-16:05 at gridMin=15: exactly one session fits by length (kPack=1)
    // but not on the grid (from 15:15 there are only 50 minutes left, kGrid=0),
    // so canon never takes the GRID branch here at all — it packs from the head.
    const [s, e] = [905, 965]
    expect(kGridCount(s, e, 15, 60)).toBe(0)
    expect(kPackCount(s, e, 60)).toBe(1)
    // The raw arithmetic DOES leave a sub-60 run — this case would be recovered
    // if the branch check at fallback-cells :267 were deleted…
    expect(gapFillPieces(s, e, 15)).toEqual([{ s: 905, e: 915 }, { s: 960, e: 965 }])
    // …45 minutes of it, which is under one slot.
    expect(960 - 915).toBeLessThan(SELL_SLOT_MIN)
    // …and the trigger refuses anyway, because the premise it recovers against
    // (「the GRID branch left this to the sell layer」) is simply not true here.
    expect(gridHoleWindows(s, e, { gridMin: 15, sessionMin: 60 })).toEqual([])
    // THE REFUSAL IS CORRECT, proven rather than asserted: canon's packing
    // branch covers the whole pocket with a full-price session of its own.
    const { depth, frame } = priceOf()
    const covered = gapLayerFor(pocketPairLanes(s, e), {
      gridMin: 15,
      sessionMin: 60,
      gapFillMin: REAL.guard.gapFillMinMin,
      gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
      minSellableMin: 0,
      nowMinute: null,
      locked: [],
      frame,
      depth,
      guard: REAL.guard.config,
    })
    expect(covered.packed.filter((c) => c.group === 'staff').map((c) => span(c.s, c.e))).toEqual(['15:05-16:05'])
  })

  it('THE MEASURED DEFECT: the 50-minute pocket’s core is advertised at gridMin=30', () => {
    const { w, targetKey, pEnd } = pocketWorld(50)
    const floor = w.minSellableMin
    expect(floor).toBeGreaterThan(0) // the shipped floor, or the pin proves nothing about it

    // BEFORE, still true: canon alone offers nothing here. `gapFillPieces` hands
    // back only the 20-minute tail and the store's own floor deletes even that,
    // which is the probe's 「0 of 50 with two beds standing empty」.
    const d: Dials = { gridMin: 30, sessionMin: 60, gapFillMin: REAL.guard.gapFillMinMin }
    const native = soldInPocket(w, d, targetKey, pEnd).filter((x) => x.from === 'native')
    expect(native).toEqual([])

    // AFTER: the core comes back, whole, from the fallback.
    const sold = soldInPocket(w, d, targetKey, pEnd)
    expect(sold.map((x) => `${span(x.s, x.e)} ${x.from}`)).toEqual(['15:00-15:30 fallback'])

    // …bed-feasible: it names a room that is genuinely free for its whole span,
    // and the room is not the one the walls sit on.
    const r = run(w, d)
    const cell = boxes(r.fallback)[0]
    const room = w.lanes.find((l) => l.key === cell.resourceKey)!
    expect(room.group).toBe('beds')
    expect(room.items.some((i) => i.endMin > cell.s && i.startMin < cell.e)).toBe(false)
    // …floor-respecting: nothing this pass emits is shorter than the store's dial.
    for (const b of boxes(r.fallback)) expect(b.e - b.s).toBeGreaterThanOrEqual(floor)
    // …and priced by the packing layer's own closures, not by a second home.
    expect(cell.price).toBe(packedPrice(w.lanes.find((l) => l.key === targetKey)!.listPrice, cell.s, cell.e, priceOf().frame, priceOf().depth))
  })

  it('the shipped gridMin=60 answer is untouched — the 50-minute pocket still sells whole', () => {
    const { w, targetKey, pEnd } = pocketWorld(50)
    const d: Dials = { gridMin: 60, sessionMin: 60, gapFillMin: REAL.guard.gapFillMinMin }
    // Canon sells it as one 50-minute packed session and the fallback adds
    // nothing — the class is structurally empty at this grid.
    expect(soldInPocket(w, d, targetKey, pEnd).map((x) => `${span(x.s, x.e)} ${x.from}`)).toEqual(['15:00-15:50 native'])
    expect(boxes(run(w, d).fallback)).toEqual([])
  })

  it('nothing this pass emits is shorter than the store’s own display floor', () => {
    // ⚖ R6 B1 — ONE FLOOR RULE, ONE ANSWER, asserted where it can actually bite:
    // over the whole dial matrix on both boards, not on the one scene above
    // (whose single box happens to be exactly the floor, so it is silent about
    // this). `gapLayerFor` deletes a box shorter than the store's dial; until R6
    // the very same shape was drawn when it came out of this pass instead.
    const short: string[] = []
    for (const make of [fixtureWorld, syntheticWorld]) {
      const w = make()
      expect(w.minSellableMin).toBeGreaterThan(0) // or the sweep proves nothing
      for (const d of MATRIX) {
        for (const c of [...run(w, d).fallback.packed, ...run(w, d).fallback.scraps]) {
          if (c.e - c.s < w.minSellableMin) short.push(`${w.name} ${dialLabel(d)} ${c.laneKey} ${c.group} ${span(c.s, c.e)}`)
        }
      }
    }
    expect(short).toEqual([])
  })

  it('IDENTITY: at the shipped dials no pocket on either board has an uncoverable core, so the pass is E2’s', () => {
    // The trigger's ONLY reach into the pass is the window list it contributes
    // (`fallbackCellsFor`'s `windows`), so "no window anywhere" IS "byte-identical
    // to the pass without the trigger" — asserted over every free pocket of every
    // staff lane of both boards rather than argued.
    const d = shipped()
    const holes: string[] = []
    for (const make of [fixtureWorld, syntheticWorld]) {
      const w = make()
      for (const l of w.lanes) {
        if (l.group !== 'staff' || l.window == null) continue
        for (const h of holeWindowsOn(w, d, l.key)) holes.push(`${w.name} ${l.key} ${span(h.s, h.e)}`)
      }
    }
    expect(holes).toEqual([])
    // …and the measurement looked at something: the same walk at gridMin=30 finds
    // the class, so the zero above is the DIAL's answer and not an empty loop.
    const fine: Dials = { ...d, gridMin: 30, sessionMin: 60 }
    const atFine = [fixtureWorld, syntheticWorld].flatMap((make) => {
      const w = make()
      return w.lanes.filter((l) => l.group === 'staff' && l.window != null).flatMap((l) => holeWindowsOn(w, fine, l.key))
    })
    expect(atFine.length).toBeGreaterThan(0)
  })

  it('halving gridMin never takes a pocket from sold to ZERO while a feasible bed exists', () => {
    const violations: string[] = []
    for (const len of [45, 50, 55]) {
      const { w, targetKey, pEnd } = pocketWorld(len)
      for (const sessionMin of [45, 60, 90]) {
        for (const minSellableMin of [0, 30]) {
          const world = { ...w, minSellableMin }
          const at = (gridMin: number) =>
            minutesOf(soldInPocket(world, { gridMin, sessionMin, gapFillMin: REAL.guard.gapFillMinMin }, targetKey, pEnd))
          const coarse = at(60)
          const fine = at(30)
          const label = `${len}min pocket · S=${sessionMin} minSell=${minSellableMin}: 60→${coarse} 30→${fine}`
          if (coarse > 0 && fine === 0) violations.push(label)
        }
      }
    }
    expect(violations).toEqual([])
  })
})

// ── 9 · THE TWO PRODUCERS FINISH THE SAME WAY (⚖ R6 fix round D1) ───────────
//
// THE DEFECT, found by the round's own blind review (L1-B1 ≡ L2-R1) at tip
// 5609213d. `gapLayerFor` finishes a layer in three steps and their ORDER is
// load-bearing: `combineCrumbs` → the store's `minSellableMin` floor → the
// kind. R6 gave this pass the floor and the kind but not the merge, so it
// floored canon's UN-combined emission.
//
// That matters because canon decomposes. `guardTier` hands a menu-exact
// residue back in menu-sized pieces — 50 minutes come out of the fixture
// store's menu as [30, 20] — and those two pieces are ONE bookable span. Floor
// first and the store's 30-minute dial deletes the 20-minute tail of a run the
// native layer draws whole at 50: minutes that were advertised before R6 added
// the floor simply vanish, and the pair that survives charges the ¥10 rounding
// remainder twice (BATCH-5 R2, which is why `combineCrumbs` re-prices the
// union with one call).
//
// §9 drives L1's own construction — one person, one 50-minute pocket, one free
// room, the store's SHIPPED dials — and pins the fallback's answer against the
// native layer's on the same board.

describe('9 — merge, then floor, then kind: the fallback finishes as the native layer does', () => {
  const worldOf = (s: number, e: number, minSellableMin: number): World => ({
    name: `pocket ${span(s, e)}`,
    lanes: pocketPairLanes(s, e),
    hours: SYNTH_HOURS,
    now: null,
    cleanup: {},
    guard: REAL.guard.config,
    minSellableMin,
  })
  /** The reconcile's own payload for 「this lane lost its 15:00 offer to a room
   *  clash」 — the trigger the drop class exists for, handed in rather than
   *  provoked, so the scene is exactly the length under test and nothing else. */
  const dropAt = (h: number): SellDrop[] => [{ laneKey: 'p-01', h, kind: 'room' } as SellDrop]
  const pass = (w: World, d: Dials, dropped: SellDrop[]) =>
    fallbackCellsFor({
      lanes: w.lanes,
      closeMin: w.hours.close,
      dropped,
      survivors: [],
      claims: [],
      cleanupMinutesByBed: w.cleanup,
      held: [],
      locked: [],
      minSellableMin: w.minSellableMin,
      dials: dialsOf(w, d),
    })
  const staffRows = (r: FallbackResult) => [...r.packed, ...r.scraps].filter((c) => c.group === 'staff')
  const nativeOn = (lanes: BoardLane[], d: Dials, minSellableMin: number) => {
    const { depth, frame } = priceOf()
    return gapLayerFor(lanes, {
      gridMin: d.gridMin,
      sessionMin: d.sessionMin,
      gapFillMin: d.gapFillMin,
      gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
      minSellableMin,
      nowMinute: null,
      locked: [],
      frame,
      depth,
      guard: REAL.guard.config,
    })
  }
  const LIST = 7000 // the synthetic lane's 定価 (`lane()`'s own default)

  it('THE MEASURED DEFECT: the 50-minute run comes back WHOLE, at the native layer’s exact ¥', () => {
    const { depth, frame } = priceOf()
    // THE PREMISE, measured rather than assumed: this store's menu really does
    // decompose 50 minutes into two pieces, and 50 really is menu-exact (so
    // canon calls it a full-price residue, not a discounted scrap).
    const engine = createGapGuard(REAL.guard.config)
    expect(engine.fillableExactly(50)).toBe(true)
    expect(engine.fillDecomposition(50)).toEqual([30, 20])
    // …and the store's own floor is 30, which is what deletes a 20-minute tail.
    expect(REAL.guard.minSellableMin).toBe(30)

    // ONE BOX, at the store's SHIPPED dials, whatever the floor says.
    for (const floor of [0, 30]) {
      const r = pass(worldOf(900, 950, floor), shipped(), dropAt(900))
      expect({ floor, boxes: staffRows(r).map((c) => `${span(c.s, c.e)} ¥${c.price} ${c.gapKind}`) }).toEqual({
        floor,
        boxes: ['15:00-15:50 ¥5840 packed'],
      })
    }

    // …and it is the NATIVE layer's own answer on the same board, to the yen.
    const native = nativeOn(pocketPairLanes(900, 950), shipped(), 30)
    expect(native.packed.filter((c) => c.group === 'staff').map((c) => `${span(c.s, c.e)} ¥${c.price}`)).toEqual([
      '15:00-15:50 ¥5840',
    ])

    // THE PRICE IS ONE CALL OVER THE UNION, not two rounded pieces added up —
    // the ¥10 difference is the whole of BATCH-5 R2, computed here from the
    // pricing home directly rather than by asking the pass twice.
    const union = packedPrice(LIST, 900, 950, frame, depth)
    const summed = packedPrice(LIST, 900, 930, frame, depth) + packedPrice(LIST, 930, 950, frame, depth)
    expect(union).toBe(5840)
    expect(summed).toBe(5850)
    expect(union).not.toBe(summed)
  })

  it('and the floor is the LAST word, on the merged run — a 35-minute scrap survives, a 20-minute one does not', () => {
    // A scrap is NOT merged (canon's own answer: `raw.scraps.filter(sellable)`),
    // so the floor meets it exactly as it comes — 35 minutes clears the store's
    // 30 and is drawn, with its kind said on the box.
    const scrapRun = pass(worldOf(900, 935, 30), shipped(), dropAt(900))
    expect(scrapRun.packed).toHaveLength(0)
    expect(scrapRun.scraps.length).toBeGreaterThan(0)
    // ⚖ A3 (L4-3) — asserted on a FALLBACK scrap that actually exists. The
    // flip suite's loop over `fallback.scraps` was iterating an empty array on
    // its board, so `gapKind` could have been anything at all on this half.
    for (const c of scrapRun.scraps) expect(gapKindOf(c)).toBe('scrap')
    for (const c of scrapRun.scraps) expect(c.gapKind).toBe('scrap')
    expect(staffRows(scrapRun).map((c) => span(c.s, c.e))).toEqual(['15:00-15:35'])

    // …and the same board with a floor above it draws nothing, which is the
    // dial doing its job rather than the pass having nothing to say.
    expect(pass(worldOf(900, 935, 40), shipped(), dropAt(900)).claims).toHaveLength(0)
  })

  it('A9 — the floor bites at the length it names, not nine minutes below it', () => {
    // A 25-MINUTE CELL, which the battery had no way to build before: at
    // `gapFillMin` 20 the store offers スキマ枠 down to 20 minutes, so a
    // 25-minute pocket comes back as a 25-minute scrap. Without it the floor's
    // pins live at 20 and 30 and every mutation inside that band survives.
    const d: Dials = { gridMin: 60, sessionMin: 60, gapFillMin: 20 }
    const at = (floor: number) => staffRows(pass(worldOf(900, 925, floor), d, dropAt(900))).map((c) => `${span(c.s, c.e)} ¥${c.price}`)
    expect(at(0)).toEqual(['15:00-15:25 ¥2630'])
    // EQUAL TO THE FLOOR IS SELLABLE — `>=`, not `>`.
    expect(at(25)).toEqual(['15:00-15:25 ¥2630'])
    // …and one minute more deletes it, so the comparison is the length's own.
    expect(at(26)).toEqual([])
    // …as does the store's real 30, which is what kills a floor quietly
    // slackened by nine or ten minutes.
    expect(at(30)).toEqual([])
  })

  it('A4 — `claims` is the DRAWN list, on a board where the floor really deletes something', () => {
    // The fixture board at gridMin=30: the floor takes 見本しろう's 20-minute
    // box off the board entirely. A claim the board never draws is not a claim,
    // so `claims` must be the filtered pair — not the emission.
    const open = run({ ...fixtureWorld(), minSellableMin: 0 }, { gridMin: 30, sessionMin: 60, gapFillMin: REAL.guard.gapFillMinMin })
    const floored = run({ ...fixtureWorld(), minSellableMin: 30 }, { gridMin: 30, sessionMin: 60, gapFillMin: REAL.guard.gapFillMinMin })
    // THE PREMISE: the floor is not a no-op here — one box (two rows) is gone.
    expect(boxes(open.fallback).map((c) => span(c.s, c.e))).toContain('15:45-16:05')
    expect(boxes(floored.fallback).map((c) => span(c.s, c.e))).not.toContain('15:45-16:05')
    expect(floored.fallback.claims.length).toBe(open.fallback.claims.length - 2)
    // …and the claims list is exactly what was drawn, both rows, in order.
    expect(floored.fallback.claims).toEqual([...floored.fallback.packed, ...floored.fallback.scraps])
    expect(open.fallback.claims).toEqual([...open.fallback.packed, ...open.fallback.scraps])
  })

  it('A5 — the floor is applied at the END: the walk itself is byte-identical at floor 0 and 30', () => {
    // `clips` is the walk's own record (spec §5c). Move the floor up into the
    // emission and the walk changes shape — a floored box stops spending its
    // room, the next room in the class order gets handed the same minute, and
    // the clip list shifts. Pinned on both boards, and on the constructed scene
    // where the deleted box is the whole of the answer.
    const dial: Dials = { gridMin: 30, sessionMin: 60, gapFillMin: REAL.guard.gapFillMinMin }
    for (const make of [fixtureWorld, syntheticWorld]) {
      const clipsAt = (floor: number) => run({ ...make(), minSellableMin: floor }, dial).fallback.clips
      expect(clipsAt(0).length).toBeGreaterThan(0)
      expect(clipsAt(30)).toEqual(clipsAt(0))
    }
    const sceneClips = (floor: number) => pass(worldOf(900, 950, floor), dial, dropAt(900)).clips
    expect(sceneClips(0).length).toBeGreaterThan(0)
    expect(sceneClips(30)).toEqual(sceneClips(0))
  })
})

// ── 10 · GREPTILE #815 — THE WALK SHIELDS LOCKED AND UNPRICED LANES ─────────
//
// The walk filtered only `group !== 'staff' || window == null` — no drop
// needed for §8's grid-hole trigger to fire, so a LOCKED lane or a
// `listPrice: 0` lane reached it too. Neither has a sell layer or a gap layer
// at all (`sellStaffLanes` drops both), so a fallback box on either one is a
// box nobody else on the board would draw: a locked lane regaining online
// inventory breaks シフトロック's own promise (「オンライン空き枠からも除外され
// ます」), and `packedPrice(0, …) = 0` prices the unpriced lane's box at ¥0.
// ONE shield closes both — the same `sellStaffLanes` read `heldDrawnFor`
// already uses (today-interactions.ts ~:1202) — asked once, kept beside the
// walk's own group/window filter.

describe('10 — Greptile #815: the walk shields locked and unpriced lanes', () => {
  it('a locked lane owning a genuine grid hole emits nothing; the same board unlocked recovers it', () => {
    const { w, targetKey } = pocketWorld(50)
    const d: Dials = { gridMin: 30, sessionMin: 60, gapFillMin: REAL.guard.gapFillMinMin }
    const onTarget = (fb: FallbackResult) =>
      boxes(fb)
        .filter((c) => c.laneKey === targetKey)
        .map((c) => span(c.s, c.e))

    // UNLOCKED — §8's own recovery, on this exact scene.
    expect(onTarget(run(w, d).fallback)).toEqual(['15:00-15:30'])

    // LOCKED — nothing. シフトロック's promise, held.
    expect(onTarget(run(w, d, [], [targetKey]).fallback)).toEqual([])
  })

  it('a listPrice:0 lane owning the same grid hole emits nothing', () => {
    const { w, targetKey } = pocketWorld(50)
    const zeroed: World = { ...w, lanes: w.lanes.map((l) => (l.key === targetKey ? { ...l, listPrice: 0 } : l)) }
    const d: Dials = { gridMin: 30, sessionMin: 60, gapFillMin: REAL.guard.gapFillMinMin }
    expect(boxes(run(zeroed, d).fallback).filter((c) => c.laneKey === targetKey)).toEqual([])
  })
})
