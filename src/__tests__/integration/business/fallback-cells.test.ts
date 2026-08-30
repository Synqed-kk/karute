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
// ⚠ THE FLOOR IS NOT HERE, AND SHOULD NOT BE. `gapLayerFor` applies
// `combineCrumbs` and the store's `minSellableMin` floor AFTER
// `deriveGapPackingCells`; the fallback pass stops at canon's raw emission,
// exactly where the packet puts it, so those two are the seam's business at E3
// and this file pins the engine's own answer.

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
  type FallbackCell,
  type FallbackResult,
} from '@/app/[locale]/(business)/business/today/fallback-cells'
import { reservedMaskFor, type ReservedLaneMask } from '@/app/[locale]/(business)/business/today/reserved-mask'
import {
  allocateBed,
  gapLayerFor,
  sellLayerFor,
  type RoomPolicy,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import {
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
  rooms: RoomPolicy
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
function run(w: World, d: Dials, held: readonly ReservedLaneMask[] = []): Run {
  const { price, depth, frame } = priceOf()
  const engine = createGapGuard(w.guard)
  const gap = gapLayerFor(w.lanes, {
    gridMin: d.gridMin,
    sessionMin: d.sessionMin,
    gapFillMin: d.gapFillMin,
    gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
    minSellableMin: w.minSellableMin,
    nowMinute: w.now,
    locked: [],
    frame,
    depth,
    guard: w.guard,
  })
  const claims: GapCell[] = [...gap.packed, ...gap.scraps]
  const dropped: SellDrop[] = []
  const sell = sellLayerFor(w.lanes, w.hours, {
    gridMin: d.gridMin,
    nowMinute: w.now,
    locked: [],
    showPrice: true,
    hi: price.hi,
    hqMin: REAL.dialogs.pricing.hqMin,
    depth,
    reconcile: {
      claims,
      rooms: w.rooms,
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
      rooms: w.rooms,
      held,
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
  rooms: REAL.rooms,
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
  rooms: REAL.rooms,
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
      rooms: w.rooms,
      held: [],
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
    // (e) additions-only: a fallback cell never lands on a lane that kept its
    //     offer without losing one.
    if (!r.dropped.some((x) => x.laneKey === c.laneKey)) {
      violations.push(`${c.laneKey} gained a fallback cell without losing an offer`)
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
    rooms: { vipStaysPrivate: true, privateIsLastResort: true },
    held: [],
    dials: dialsOf({ ...w, now: null }, shipped()),
  })
}

describe('3 — class-aware rooms: the 個室 is spent last, both directions', () => {
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
    // the first place; asked the same question over the same rooms with the
    // reconcile's own `vip: false`, it names the room the pass reached for.
    const scene = privateScene(true)
    for (const policy of [
      { vipStaysPrivate: true, privateIsLastResort: true },
      { vipStaysPrivate: true, privateIsLastResort: false },
    ] as RoomPolicy[]) {
      const chosen = allocateBed(scene.lanes, {
        id: null,
        currentBed: null,
        stores: ['store-a'],
        vip: false,
        start: 930,
        end: 960,
        policy,
      })
      expect({ policy, room: chosen.laneKey }).toEqual({ policy, room: 'bed-01' })
    }
  })

  it('privateIsLastResort OFF is the store’s call, and the order follows it', () => {
    const w = fixtureWorld()
    const scene = privateScene(true)
    const r = fallbackCellsFor({
      lanes: scene.lanes,
      closeMin: 1080,
      dropped: scene.dropped,
      survivors: [],
      claims: [],
      cleanupMinutesByBed: {},
      rooms: { vipStaysPrivate: true, privateIsLastResort: false },
      held: [],
      dials: dialsOf({ ...w, now: null }, shipped()),
    })
    // Board order now, so the 個室's longer run wins — the store said 個室 is
    // an ordinary room, and the pass does not overrule a setting.
    expect(boxes(r).map((c) => `${span(c.s, c.e)}@${c.resourceKey}`)).toEqual(['15:30-16:00@bed-01'])
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
    book: bedTruthViews(w.lanes, w.rooms, { openMin: w.hours.open, closeMin: w.hours.close, nowMin: w.now ?? w.hours.open }, null)
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
      rooms: w.rooms,
      held: maskFor(w, w.guard, 'standard'),
    }
    const before = JSON.stringify(input)
    fallbackCellsFor({ ...input, dials: dialsOf(w, shipped()) })
    fallbackCellsFor({ ...input, dials: dialsOf(w, shipped()) })
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
    expect(screen).toContain('fallback: fallbackCellsFor({')
    expect(screen.indexOf('if (!heldCommitted) return null')).toBeLessThan(screen.indexOf('fallback: fallbackCellsFor({'))
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
