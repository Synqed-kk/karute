// BOTH DOORS READ THE MASK — E3a's own battery (SPEC-SELLING-ENGINE §12, E3a).
//
// E1 built the held set and E2 built the fragment fallback, both DARK. This is
// the round that wires them into the live pipeline — and the round's whole
// promise is that with the gate OFF the board is byte-identical to today's, so
// the wiring can be reviewed and merged before anything on screen moves.
//
// WHAT THIS FILE PROVES, in the order the round decides things:
//   §1 THE GATE — shipped OFF, read at the screen boundary and NOWHERE below
//      it, and threaded as a PARAMETER into every seam. That last one is what
//      makes the gated-off path provable at all: an absent mask is today's code
//      by construction, not by a branch somebody has to keep honest.
//   §2 GATED-OFF IDENTITY — every seam with no mask ≡ the same seam with an
//      empty one, across two boards × the widened matrix. (The base-vs-tip half
//      of this proof is E3a-proof/GATED-OFF-PARITY: a 2.2 MB digest of the four
//      surfaces, byte-identical at f153fe9f and at this tip.)
//   §3 THE SALES DOOR, GATE ON — the composed pipeline: held spans withheld
//      from the gap layer's input space, the ごろう fragments back (E2's own
//      numbers, now through the wiring rather than a test harness), sell hours
//      inside held windows TAGGED, one reserved offer per held window, and zero
//      double-claims on either axis.
//   §4 THE STAFF DOOR — the rail answers from the SAME held set, and the
//      before/after count table keeps LATTICE and BED in two columns, because
//      attaching the callback moves the enumeration as well as filtering it
//      (spec §2's lattice-honesty clause). Artifact: RAIL-DELTA.
//   §5 THE EXPLAIN LAYER — a 新規用に確保 window gets no 「販売可能枠が出ていま
//      せん」 clause, no taker's name, and no rest-cue hatch; gate off, every
//      sentence is the one that ships today.
//   §6 RESERVED NEVER CLAIMS — the third offer kind is advisory, and the claims
//      book refuses one outright rather than trusting a caller.
//   §7 THE COST — the mask is built once per world per frame, and the 25-staff
//      and HQ-scale rows are measured rather than asserted in prose.
//
// THE MATRIX is E1's widened one (spec §11.3): the LAW axes — protected
// duration × guard mode, which r1's matrix held constant and so could not see —
// crossed at the store's own grid dials, plus the twelve-combination grid
// matrix at the shipped law dials. 20 combinations after the overlap.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  boardOffers,
  buildClaims,
  reservedOffersFor,
  type BedTruth,
  type OfferInput,
} from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { fallbackCellsFor, type FallbackResult } from '@/app/[locale]/(business)/business/today/fallback-cells'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { reservedMaskFor, type ReservedLaneMask } from '@/app/[locale]/(business)/business/today/reserved-mask'
import { SELLING_ENGINE_LAW } from '@/app/[locale]/(business)/business/today/selling-engine-gate'
import { bedDoor, bedViewsFor, TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import {
  explainRails,
  gapLayerFor,
  gapPackingDials,
  guardRailsFor,
  isHeldBound,
  laneSpans,
  restCueStarts,
  sellLayerFor,
  type GuardRail,
  type RailCell,
  type RoomPolicy,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { freePockets, type GapCell } from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig, type GuardContext } from '@/business/lib/canon-logic/gap-guard'
import { clampPriceInputs, SELL_SLOT_MIN } from '@/business/lib/canon-logic/pricing'
import { STORE_A } from '@/business/lib/fixtures'
import { cleanupBlocks, hhmm, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

const HERE = 'src/app/[locale]/(business)/business/today'
const SRC = (f: string) => readFileSync(join(process.cwd(), HERE, f), 'utf8')

// ── THE REAL FIXTURE WORLD, driven exactly as E2 drove it ───────────────────

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

// ── THE SYNTHETIC ANY-ROSTER BOARD (E1/E2's, kept local for their reason: an
//    imported fixture would re-register another suite's tests here) ──────────

const OPEN = 540
const CLOSE = 1080
const SYNTH_HOURS: Hours = { open: OPEN, close: CLOSE }
const SYNTH_CLEANUP: Record<string, number> = { 'bed-01': 0, 'bed-02': 10, 'bed-03': 15 }

function rng(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const pad2 = (n: number) => String(n + 1).padStart(2, '0')
const hits = (a: { start: number; end: number }, b: { start: number; end: number }) => a.end > b.start && a.start < b.end
const span = (s: number, e: number) => `${hhmm(s)}-${hhmm(e)}`
const meets = (aS: number, aE: number, bS: number, bE: number) => aE > bS && aS < bE

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

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>, hours: Hours = SYNTH_HOURS): BoardLane {
  return {
    label: over.key,
    sub: '',
    absentNote: null,
    mine: false,
    items: [],
    window: over.group === 'staff' ? { from: hours.open, until: hours.close } : null,
    untilLabel: over.group === 'staff' ? hhmm(hours.close) : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

interface BoardSpec {
  staff: number
  beds: number
  seed: number
  perLane: number
  privateBeds?: number
  stores?: string[]
}

function board(spec: BoardSpec): BoardLane[] {
  const privateBeds = spec.privateBeds ?? 1
  const stores = spec.stores ?? ['store-a']
  const next = rng(spec.seed)
  const placed: Array<{ id: string; staffKey: string; bedKey: string; start: number; end: number }> = []
  for (let i = 0; i < spec.staff; i += 1) {
    const staffKey = `p-${pad2(i)}`
    for (let n = 0; n < spec.perLane; n += 1) {
      const dur = [45, 60, 90][Math.floor(next() * 3) % 3]
      const start = OPEN + Math.floor((next() * (CLOSE - OPEN - dur)) / 15) * 15
      const at = { start, end: start + dur }
      if (placed.some((p) => p.staffKey === staffKey && hits(p, at))) continue
      const bedKey = Array.from({ length: spec.beds }, (_, j) => `bed-${pad2(j)}`).find(
        (k) => !placed.some((p) => p.bedKey === k && hits(p, at)),
      )
      if (!bedKey) continue
      placed.push({ id: `apt-${pad2(i)}-${n}`, staffKey, bedKey, ...at })
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
        stores: [stores[i % stores.length]],
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
        stores: [stores[j % stores.length]],
        roomClass: j >= spec.beds - privateBeds ? 'private' : 'standard',
        items: items.sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  return lanes
}

// ── THE TWO WORLDS + THE WIDENED MATRIX ─────────────────────────────────────

interface World {
  name: string
  lanes: BoardLane[]
  hours: Hours
  now: number | null
  rooms: RoomPolicy
  cleanup: Record<string, number>
  minSellableMin: number
}

interface Combo {
  gridMin: number
  sessionMin: number
  gapFillMin: number
  protectedMin: number
  mode: 'off' | 'standard' | 'strict'
  axis: 'law' | 'grid'
}

const fixtureWorld = (): World => ({
  name: 'fixture',
  lanes: REAL.lanes,
  hours: REAL.hours,
  now: REAL.sell.nowMinute,
  rooms: REAL.rooms,
  cleanup: REAL.bedCleanupMinutes,
  minSellableMin: REAL.guard.minSellableMin ?? 0,
})

const syntheticWorld = (): World => ({
  name: 'synthetic ANY-ROSTER 8×3',
  lanes: board({ staff: 8, beds: 3, seed: 4242, perLane: 3 }),
  hours: SYNTH_HOURS,
  now: null,
  rooms: REAL.rooms,
  cleanup: SYNTH_CLEANUP,
  minSellableMin: REAL.guard.minSellableMin ?? 0,
})

const worlds = (): World[] => [fixtureWorld(), syntheticWorld()]

const comboLabel = (c: Combo) =>
  `grid=${c.gridMin} S=${c.sessionMin} gapFillMin=${String(c.gapFillMin).padStart(2)} protected=${c.protectedMin} guard=${c.mode}`

function matrix(): Combo[] {
  const P = REAL.guard.protectedDurationMin
  const out: Combo[] = []
  for (const protectedMin of [P - 30, P, P + 30]) {
    for (const mode of ['off', 'standard', 'strict'] as const) {
      out.push({
        gridMin: REAL.sell.gridMin,
        sessionMin: REAL.guard.standardSessionMin,
        gapFillMin: REAL.guard.gapFillMinMin,
        protectedMin,
        mode,
        axis: 'law',
      })
    }
  }
  for (const gridMin of [30, 60]) {
    for (const sessionMin of [45, 60, 90]) {
      for (const gapFillMin of [0, 30]) {
        out.push({ gridMin, sessionMin, gapFillMin, protectedMin: P, mode: REAL.guard.mode, axis: 'grid' })
      }
    }
  }
  const seen = new Set<string>()
  return out.filter((c) => {
    const k = comboLabel(c)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** One combination's guard config, and E1's own split between the two axes:
 *
 *   · the LAW axis moves the protected duration and the guard mode at the
 *     store's OWN dials, so it keeps the store's real 施術メニュー as the
 *     repertoire — the ごろう numbers are that store's prices and they only
 *     reproduce against that repertoire;
 *   · the GRID axis moves the customer grid and the session length, and a grid
 *     reaches the engine the only way one ever does: through the repertoire the
 *     store sells. So that half substitutes a synthetic one. */
const configOf = (c: Combo): GuardConfig => ({
  ...REAL.guard.config,
  services:
    c.axis === 'law'
      ? REAL.guard.config.services
      : [
          { name: '45', dur: 45 },
          { name: 'standard', dur: c.sessionMin },
          { name: 'grid', dur: c.gridMin },
        ],
  protectedDurationMin: c.protectedMin,
  gapFillMinMin: REAL.guard.minSellableMin,
})

const shipped = (): Combo => ({
  gridMin: REAL.sell.gridMin,
  sessionMin: REAL.guard.standardSessionMin,
  gapFillMin: REAL.guard.gapFillMinMin,
  protectedMin: REAL.guard.protectedDurationMin,
  mode: REAL.guard.mode === 'off' ? 'standard' : REAL.guard.mode,
  axis: 'law',
})

function priceOf() {
  const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
  return {
    price,
    depth: Math.round((1 - price.lo / price.hi) * 100),
    frame: { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax },
  }
}

const frameOf = (w: World) => ({ openMin: w.hours.open, closeMin: w.hours.close, nowMin: w.now ?? w.hours.open })
const bookOf = (w: World, lanes: BoardLane[] = w.lanes): BedTruth => bedViewsFor(lanes, w.rooms, frameOf(w), null).world

const maskOf = (w: World, c: Combo, book: BedTruth = bookOf(w)): readonly ReservedLaneMask[] =>
  reservedMaskFor({
    lanes: w.lanes,
    closeMin: w.hours.close,
    nowMin: w.now,
    guard: configOf(c),
    gapGuardMode: c.mode,
    book,
  })

const windowsIn = (held: readonly ReservedLaneMask[]) => held.flatMap((m) => m.spans.map((s) => ({ laneKey: m.laneKey, ...s })))

// ── THE PIPELINE, IN THE SCREEN'S OWN ORDER ─────────────────────────────────

interface Door {
  held: readonly ReservedLaneMask[] | undefined
  gap: { packed: GapCell[]; scraps: GapCell[] }
  claims: GapCell[]
  sell: ReturnType<typeof sellLayerFor>
  drops: SellDrop[]
  fallback: FallbackResult | null
  gapDrawn: { packed: GapCell[]; scraps: GapCell[] }
  drawnClaims: GapCell[]
  reserved: ReturnType<typeof reservedOffersFor>
}

/** ⚖ THE SALES DOOR, EXACTLY AS `TodayScreen` COMPOSES IT — gap layer first
 *  (its finished cells are the promises), then the sell layer reconciled
 *  against them, then the §5 fallback over what the reconcile threw away,
 *  additions-only against that SAME claims context. Nothing feeds back.
 *
 *  `held === undefined` is the round gate OFF, and it is spelled as an absent
 *  argument on purpose: that is the call the base commit makes. */
function door(w: World, c: Combo, held?: readonly ReservedLaneMask[]): Door {
  const { price, depth, frame } = priceOf()
  const guard = configOf(c)
  const dialOpts = {
    gridMin: c.gridMin,
    sessionMin: c.sessionMin,
    gapFillMin: c.gapFillMin,
    gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
    nowMinute: w.now,
    frame,
    depth,
    guard,
  }
  const gap = gapLayerFor(w.lanes, { ...dialOpts, minSellableMin: w.minSellableMin, locked: [], held })
  const claims: GapCell[] = [...gap.packed, ...gap.scraps]
  const drops: SellDrop[] = []
  const sell = sellLayerFor(w.lanes, w.hours, {
    gridMin: c.gridMin,
    nowMinute: w.now,
    locked: [],
    showPrice: true,
    hi: price.hi,
    hqMin: REAL.dialogs.pricing.hqMin,
    depth,
    reconcile: { claims, rooms: w.rooms, cleanupMinutesByBed: w.cleanup, onDrop: (d) => drops.push(d) },
    held,
  })
  const fallback = held
    ? fallbackCellsFor({
        lanes: w.lanes,
        closeMin: w.hours.close,
        dropped: drops,
        survivors: sell.cells,
        claims,
        cleanupMinutesByBed: w.cleanup,
        rooms: w.rooms,
        held,
        dials: gapPackingDials(w.lanes, dialOpts),
      })
    : null
  const gapDrawn = fallback
    ? { packed: [...gap.packed, ...fallback.packed], scraps: [...gap.scraps, ...fallback.scraps] }
    : gap
  return {
    held,
    gap,
    claims,
    sell,
    drops,
    fallback,
    gapDrawn,
    drawnClaims: fallback ? [...claims, ...fallback.claims] : claims,
    reserved: held ? reservedOffersFor(held) : reservedOffersFor([]),
  }
}

/** The staff door's three readings of one board. They differ ONLY in the
 *  protected-window callback, which is the whole of spec §3's change:
 *    · `raw`     — no callback. Today's shipped rail.
 *    · `lattice` — a callback that always says yes. On the 5-minute lattice
 *                  (gap-guard :195) but blind to the rooms: the LATTICE column.
 *    · `bed`     — the real mask door. The extra difference is the BED column. */
function rails(w: World, c: Combo, kind: 'raw' | 'lattice' | 'bed', book: BedTruth = bookOf(w)): GuardRail[] {
  const views = bedViewsFor(w.lanes, w.rooms, frameOf(w), null)
  const door = bedDoor(views, w.lanes, null)
  return guardRailsFor(w.lanes, {
    open: w.hours.open,
    close: w.hours.close,
    stepMin: 30,
    dur: REAL.guard.standardSessionMin,
    protectedDur: c.protectedMin,
    nowMinute: w.now,
    locked: [],
    guard: { ...configOf(c), mode: c.mode === 'off' ? 'standard' : c.mode },
    excludeId: null,
    placementFeasible: door,
    protectedWindowFeasible:
      kind === 'raw'
        ? undefined
        : kind === 'lattice'
          ? () => true
          : (l, start, dur) => book.newClientMask(l, dur)(start),
  })
}

const cellKey = (c: RailCell) =>
  `${c.start}|${c.state}|${c.label}|${c.sentence}|${c.reason ?? '-'}|${c.alternatives.join(',')}|${c.alternativeKind ?? '-'}|${c.ackAllowed}`

const railKeys = (rs: GuardRail[]) => rs.flatMap((r) => r.cells.map((c) => `${r.laneKey}|${cellKey(c)}`))

const staffLanesOf = (lanes: BoardLane[]) => lanes.filter((l) => l.group === 'staff' && l.window != null)

// ── 1 · THE GATE ────────────────────────────────────────────────────────────

describe('1 — the round gate', () => {
  it('ships OFF, and E3b is the round that flips it', () => {
    expect(SELLING_ENGINE_LAW).toBe(false)
    const gate = SRC('selling-engine-gate.ts')
    expect(gate).toContain('export const SELLING_ENGINE_LAW: boolean = false')
    // It is the ROUND's gate, not the store's. `gap_guard_mode` is the product
    // switch and it is already in the inputs — no env var, no second dial.
    expect(gate).not.toMatch(/process\.env/)
  })

  it('is read at the screen boundary ONLY — never in a layer, a predicate or a handler', () => {
    const readers = ['today-interactions.ts', 'capacity-ledger.ts', 'reserved-mask.ts', 'fallback-cells.ts']
    for (const f of readers) expect({ f, has: SRC(f).includes('SELLING_ENGINE_LAW') }).toEqual({ f, has: false })
    // …and on the screen it appears exactly five times: the import, one prose
    // mention in the memo that explains it, and THREE reads — the committed
    // world's book, the board world's mask, and the rail's protected-window
    // door. All three are memo bodies at the top level of the component; none
    // is inside a predicate, a handler or a render path.
    const screen = SRC('TodayScreen.tsx')
    const reads = [...screen.matchAll(/SELLING_ENGINE_LAW/g)].length
    expect(reads).toBe(5)
    expect(screen).toContain("import { SELLING_ENGINE_LAW } from './selling-engine-gate'")
    expect(screen).toContain('SELLING_ENGINE_LAW ? bedViewsFor(committedLanes')
    expect(screen).toContain('protectedWindowFeasible: SELLING_ENGINE_LAW ? bedDoorFor(null) : undefined,')
  })

  it('every seam takes the mask as a PARAMETER, so an absent mask is today’s code', () => {
    const int = SRC('today-interactions.ts')
    // Four named seams, four optional parameters, one shape.
    expect(int).toContain('held?: readonly ReservedLaneMask[]')
    expect(int).toContain('protectedWindowFeasible?: (lane: BoardLane, start: number, dur: number) => boolean')
    expect(int).toContain('heldHere: readonly ReservedSpan[] = [],')
    // The mask module is imported for its TYPES only — a value import would be
    // a module cycle (`reserved-mask` imports `laneSpans` from here).
    expect(int).toContain("import type { ReservedLaneMask, ReservedSpan } from './reserved-mask'")
    expect(int).not.toMatch(/import \{[^}]*reservedMaskFor/)
  })

  it('the mask is built ONCE PER WORLD PER FRAME, in a memo and never in a predicate', () => {
    const screen = SRC('TodayScreen.tsx')
    // Two construction sites, both world-named, both inside a `useMemo`.
    expect(screen.split('reservedMaskFor({').length - 1).toBe(2)
    for (const world of ['lanes: committedLanes,', 'lanes: boardLanes,']) {
      const at = screen.indexOf(`reservedMaskFor({\n            ${world}`)
      expect({ world, wired: at }).not.toEqual({ world, wired: -1 })
      // The nearest enclosing hook before it is a useMemo, not a callback or a
      // handler — the ledger-threading discipline the capacity book is under.
      const before = screen.slice(0, at)
      expect(before.lastIndexOf('useMemo(')).toBeGreaterThan(before.lastIndexOf('useCallback('))
    }
  })
})

// ── 2 · GATED-OFF IDENTITY ──────────────────────────────────────────────────

describe('2 — gated off, every seam is the one that ships', () => {
  // The matrix is walked INSIDE the body rather than through `it.each`: the
  // combinations are derived from the store's own dials, which arrive in
  // `beforeAll`, and `it.each` is evaluated at module load.
  //
  // ⚠ AN EMPTY MASK IS NOT THE GATE BEING OFF, and the two legs are kept apart
  // for exactly that reason. `held === undefined` is the gate off: no mask, no
  // fallback pass, no reserved emission — the call the base commit makes.
  // `held === []` is the gate ON at a store whose スキマガード is off, which is
  // spec §6's separate no-op: the LAW contributes nothing because nothing is
  // held. What the §5 fragment fallback does on such a store is the gate's
  // question, not the mask's — measured in §3 and reported, never assumed here.
  it('across both boards × the widened matrix — an empty mask changes nothing the LAW touches', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        const at = `${w.name} · ${comboLabel(c)}`
        const off = door(w, c)
        const empty = door(w, c, [])
        expect({ at, x: empty.gap }).toEqual({ at, x: off.gap })
        expect({ at, x: empty.sell }).toEqual({ at, x: off.sell })
        expect({ at, x: empty.drops }).toEqual({ at, x: off.drops })
        expect({ at, x: empty.claims }).toEqual({ at, x: off.claims })
        expect({ at, x: empty.reserved }).toEqual({ at, x: [] })
        expect({ at, x: empty.sell.cells.some(isHeldBound) }).toEqual({ at, x: false })
        // …and the rail's sentences too.
        const railsOff = rails(w, c, 'raw')
        expect({ at, x: explainOf(w, c, railsOff, off, undefined) }).toEqual({
          at,
          x: explainOf(w, c, railsOff, off, []),
        })
      }
    }
  })

  it('gated off, the composed layer objects are the SAME objects — nothing is copied', () => {
    // Identity, not equality: a gated-off frame must not even allocate a new
    // array, or every downstream memo on this screen re-runs for nothing.
    const w = fixtureWorld()
    const c = shipped()
    const off = door(w, c)
    expect(off.gapDrawn).toBe(off.gap)
    expect(off.drawnClaims).toBe(off.claims)
    expect(off.fallback).toBeNull()
  })

  it('no sell cell is tagged held-bound when there is no mask', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        expect(door(w, c).sell.cells.some(isHeldBound)).toBe(false)
      }
    }
  })
})

function explainOf(
  w: World,
  c: Combo,
  rs: GuardRail[],
  d: Door,
  held: readonly ReservedLaneMask[] | undefined,
) {
  const map = explainRails(rs, w.lanes, {
    dur: REAL.guard.standardSessionMin,
    handId: null,
    rooms: w.rooms,
    stagedId: null,
    sellCells: d.sell.cells,
    claims: d.drawnClaims,
    drops: d.drops,
    inHand: false,
    sellDisplayed: true,
    held,
  })
  const byLane = new Map((held ?? []).map((m) => [m.laneKey, m.spans]))
  return rs.map((r) => {
    const per = map.get(r.laneKey) ?? new Map()
    return {
      laneKey: r.laneKey,
      per: [...per].map(([start, e]) => ({ start, ...e })),
      restCues: restCueStarts(
        per,
        d.sell.cells.filter((s) => s.group === 'staff' && s.laneKey === r.laneKey),
        d.drawnClaims.filter((g) => g.group === 'staff' && g.laneKey === r.laneKey),
        byLane.get(r.laneKey),
      ),
    }
  })
}

// ── 3 · THE SALES DOOR, GATE ON ─────────────────────────────────────────────

describe('3 — the sales door with the mask live', () => {
  const emitted = (d: Door) =>
    [...(d.fallback?.packed ?? []), ...(d.fallback?.scraps ?? [])]
      .filter((x) => x.group === 'staff')
      .map((x) => `${x.laneKey} ${span(x.s, x.e)} ${x.resourceKey} ¥${x.price}`)
      .sort()

  it('the ごろう fragments come back through the WIRING — E2’s own numbers, composed', () => {
    // E2 proved the PASS; this proves the COMPOSITION reaches it. The mask is
    // empty here (the store's guard off) so the board is the one the probe
    // measured, and the two fragments are PROBE-E2 SIM-7's to the yen — now
    // inside `gapDrawn`, which is what the board paints, rather than inside a
    // test's own variable.
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const on = door(w, c, maskOf(w, c))
    expect(on.drops.map((d) => `${d.laneKey}@${hhmm(d.h)}/${d.kind}`)).toEqual(['p-05@15:00/room', 'p-05@16:00/room'])
    expect(emitted(on)).toEqual(['p-05 15:30-16:00 bed-01 ¥4410', 'p-05 16:30-17:00 bed-03 ¥4610'])
    // …and the layer the reconcile built is untouched by the addition: the
    // fallback is additions-only, appended after every surviving box.
    expect(on.gapDrawn.packed.slice(0, on.gap.packed.length)).toEqual(on.gap.packed)
    expect(on.gapDrawn.scraps.slice(0, on.gap.scraps.length)).toEqual(on.gap.scraps)
  })

  /** ⚖ A SECOND-ORDER EFFECT, MEASURED — and it is the good kind, so it is
   *  pinned rather than left to be rediscovered as a surprise at E3b.
   *
   *  Masking UPSTREAM (spec §4.1) does not only withhold: it takes the withheld
   *  boxes OUT OF THE ROOM COMPETITION. On the fixture at the store's own dials
   *  the box that beat 見本ごろう's 15:00 and 16:00 hours to ベッド2 — flag 86's
   *  own scene — lies inside a held window, so with the guard on it is never
   *  derived, ごろう's hours are never dropped, and the stretch is not empty in
   *  the first place. There is nothing left for the §5 fallback to reach.
   *
   *  So the fragments are the GUARD-OFF answer, and the guard-ON answer is
   *  better than fragments: the same minutes sell as full-price 販売可能枠 hours.
   *  Liam sees both at E3b; neither is a builder's ruling. */
  it('with the mask live the ごろう stretch is not empty at all — the hours survive instead', () => {
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    const on = door(w, c, held)
    // p-05 is held 14:30–16:00, and it no longer loses anything.
    expect(held.find((m) => m.laneKey === 'p-05')?.spans.map((s) => span(s.start, s.end))).toEqual(['14:30-16:00'])
    expect(on.drops.some((d) => d.laneKey === 'p-05')).toBe(false)
    expect(emitted(on)).toEqual([])
    // The two hours the reconcile used to throw away are on the board — the
    // first inside the held window (so tagged, withheld from a regular
    // customer's feed until E3b's rank dial), the second outside it.
    const hours = on.sell.cells
      .filter((s) => s.group === 'staff' && s.laneKey === 'p-05' && (s.h === 900 || s.h === 960))
      .map((s) => `${hhmm(s.h)} ${s.resourceKey} heldBound=${isHeldBound(s)}`)
      .sort()
    expect(hours).toEqual(['15:00 bed-02 heldBound=true', '16:00 bed-02 heldBound=false'])
    // …and the withholding really happened: the guarded gap layer is smaller.
    expect(on.gap.packed.length + on.gap.scraps.length).toBeLessThan(
      door(w, c).gap.packed.length + door(w, c).gap.scraps.length,
    )
  })

  it('across both boards × every guarded combination — the whole composed law holds', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        if (c.mode === 'off') continue
        assertComposedLaw(`${w.name} · ${comboLabel(c)}`, w, c)
      }
    }
  })

  function assertComposedLaw(label: string, w: World, c: Combo) {
    const held = maskOf(w, c)
    const on = door(w, c, held)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    const broken: string[] = []

    // (i) NOTHING HELD IS SOLD BY THE GAP LAYER. The mask sits upstream of the
    //     derivation, so a held minute is never a candidate in the first place.
    for (const g of [...on.gapDrawn.packed, ...on.gapDrawn.scraps]) {
      if (g.group !== 'staff') continue
      if ((byLane.get(g.laneKey) ?? []).some((h) => meets(g.s, g.e, h.start, h.end))) {
        broken.push(`gap ${g.laneKey} ${span(g.s, g.e)} inside a held window`)
      }
    }

    // (ii) SELL HOURS INSIDE A HELD WINDOW ARE TAGGED, and nothing else is.
    for (const s of on.sell.cells) {
      const inside = (byLane.get(s.laneKey) ?? []).some((h) => meets(s.h, s.h + SELL_SLOT_MIN, h.start, h.end))
      if (inside !== isHeldBound(s)) {
        broken.push(`sell ${s.laneKey}@${hhmm(s.h)} tagged=${isHeldBound(s)} inside=${inside}`)
      }
    }

    // (iii) ONE RESERVED OFFER PER HELD WINDOW, and it names the window.
    const windows = windowsIn(held)
    if (on.reserved.length !== windows.length) {
      broken.push(`reserved ${on.reserved.length} ≠ held windows ${windows.length}`)
    }
    for (const [i, o] of on.reserved.entries()) {
      const win = windows[i]
      if (o.kind !== 'reserved' || o.laneKey !== win.laneKey || o.start !== win.start || o.end !== win.end) {
        broken.push(`reserved offer ${i} does not name its window`)
      }
    }

    // (iv) ZERO DOUBLE-CLAIMS ON THE ROOM AXIS — the claims book's own oracle,
    //      over everything the board now draws.
    const offers: OfferInput[] = boardOffers(on.sell.cells, [...on.gapDrawn.packed, ...on.gapDrawn.scraps])
    const violations = buildClaims(bookOf(w), offers).violations(w.cleanup)
    for (const v of violations) {
      broken.push(`room ${v.resourceKey}: ${span(v.earlier.startMin, v.earlier.endMin)} vs ${span(v.later.startMin, v.later.endMin)}`)
    }

    // (v) …AND ON THE STAFF AXIS. The claims book is grouped by room and cannot
    //     see this one (its own header says so), so it is asserted here: a
    //     PROMISE is a unit, so no two 詰め込み／スキマ／fallback boxes may share
    //     a person-minute, and none may sit inside a surviving 販売可能枠 hour
    //     on its own lane (`busyLane`'s law, one layer down).
    const promises = [...on.gapDrawn.packed, ...on.gapDrawn.scraps].filter((g) => g.group === 'staff')
    for (const [i, a] of promises.entries()) {
      for (const b of promises.slice(i + 1)) {
        if (a.laneKey === b.laneKey && meets(a.s, a.e, b.s, b.e)) {
          broken.push(`${a.laneKey} promised twice over ${span(a.s, a.e)} / ${span(b.s, b.e)}`)
        }
      }
      for (const s of on.sell.cells) {
        if (s.group === 'staff' && s.laneKey === a.laneKey && meets(a.s, a.e, s.h, s.h + SELL_SLOT_MIN)) {
          broken.push(`${a.laneKey} promised ${span(a.s, a.e)} under its own sell hour ${hhmm(s.h)}`)
        }
      }
    }

    expect({ at: label, broken }).toEqual({ at: label, broken: [] })
  }

  it('the matrix is not vacuous — the law fires at the store’s own dials', () => {
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    expect(windowsIn(held).length).toBeGreaterThan(0)
    const on = door(w, c, held)
    // Something is actually withheld: the guarded gap layer is smaller than the
    // open one, or a sell hour is tagged. (Both, on this board.)
    const openBoxes = door(w, c).gap.packed.length + door(w, c).gap.scraps.length
    const heldBoxes = on.gap.packed.length + on.gap.scraps.length
    expect(heldBoxes).toBeLessThanOrEqual(openBoxes)
    expect(on.sell.cells.some(isHeldBound)).toBe(true)
    expect(on.reserved.length).toBe(windowsIn(held).length)
  })

  it('a guard-OFF store holds nothing — the LAW imposes nothing on it', () => {
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const held = maskOf(w, c)
    expect(held).toEqual([])
    const on = door(w, c, held)
    const off = door(w, c)
    expect(on.gap).toEqual(off.gap)
    expect(on.sell).toEqual(off.sell)
    expect(on.reserved).toEqual([])
    expect(on.sell.cells.some(isHeldBound)).toBe(false)
  })

  /** ⚠ THE ONE THING E3a MEASURES AND DOES NOT DECIDE — carried to E3b, and
   *  named here rather than discovered there.
   *
   *  Spec §11.3's HELD-SWEEP invariant (iii) reads 「guard-OFF ⇒ board
   *  byte-identical to pre-round」, and spec §6 says a guard-off store 「keeps
   *  today's exact behavior… nothing new appears」. Both sentences are about the
   *  スキマガード dial and the LAW it gates — and the mask honours them exactly
   *  (the test above).
   *
   *  But §5's fragment fallback is NOT the held law. It is a separate product
   *  ruling about what R4's reconcile throws away, and the packet wires it
   *  behind the ROUND gate, not behind `gap_guard_mode`. So a store with the
   *  guard OFF and the round gate ON gets the fragments back — 「nothing new
   *  appears」 becomes false for that store, by exactly this many boxes.
   *
   *  Nothing is decided here: the round gate is OFF, so no store sees either
   *  behaviour yet. The number is measured, pinned, and goes to Liam with E3b's
   *  flip. Making the fallback guard-conditional is one `&&` if he rules that
   *  way; it is a product call and not a builder's. */
  it('MEASURED, NOT RULED: what a guard-OFF store gains from the §5 fallback alone', () => {
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const on = door(w, c, maskOf(w, c))
    const off = door(w, c)
    // ¥9,020 of fragments that do not exist on that store today.
    expect(emitted(on)).toEqual(['p-05 15:30-16:00 bed-01 ¥4410', 'p-05 16:30-17:00 bed-03 ¥4610'])
    expect(on.gapDrawn.packed.length + on.gapDrawn.scraps.length).toBeGreaterThan(off.gap.packed.length + off.gap.scraps.length)
    // …and the LAW's own surfaces are still untouched on that store.
    expect(on.sell).toEqual(off.sell)
    expect(on.reserved).toEqual([])
  })
})

// ── 4 · THE STAFF DOOR ──────────────────────────────────────────────────────

interface RailRow {
  board: string
  dials: string
  raw: number
  lattice: number
  bed: number
  latticeDelta: number
  bedDelta: number
  heldWindows: number
  refused: number
}

const RAIL_ROWS: RailRow[] = []

describe('4 — the staff door answers from the same held set', () => {
  it('across both boards × every guarded combination — mask vs legacy, in two columns', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        if (c.mode === 'off') continue
        assertRailDelta(`${w.name} · ${comboLabel(c)}`, w, c)
      }
    }
  })

  /** ⚠ THE ANTI-VACUITY LEG. Every assertion above is of the form 「if a verdict
   *  moved, here is why」 — all of which pass trivially if the callback is never
   *  threaded at all. So the table is asked whether the threading DOES anything:
   *  the bed column has to be non-zero somewhere, and the lattice column has to
   *  be zero everywhere on these two boards (measured, and the reason is in the
   *  artifact: every pocket here starts on a lattice minute). */
  it('the threading is not a no-op — the bed column moves, the lattice column does not', () => {
    expect(RAIL_ROWS.length).toBeGreaterThan(0)
    expect(RAIL_ROWS.every((r) => r.latticeDelta === 0)).toBe(true)
    expect(RAIL_ROWS.reduce((n, r) => n + r.bedDelta, 0)).toBeGreaterThan(0)
    // …and it moves in BOTH directions, which is the honest shape of the fix:
    // the guard stops protecting windows no room can host (fewer refusals) and
    // starts seeing real ones it had been blind to (more).
    expect(RAIL_ROWS.some((r) => r.bed < r.lattice)).toBe(true)
    expect(RAIL_ROWS.some((r) => r.bed > r.lattice)).toBe(true)
  })

  function assertRailDelta(label: string, w: World, c: Combo) {
    const book = bookOf(w)
    const raw = rails(w, c, 'raw')
    const lat = rails(w, c, 'lattice', book)
    const bed = rails(w, c, 'bed', book)
    const rawK = railKeys(raw)
    const latK = railKeys(lat)
    const bedK = railKeys(bed)
    const latticeDelta = latK.filter((k, i) => k !== rawK[i]).length
    const bedDelta = bedK.filter((k, i) => k !== latK[i]).length

    // ⚖ THE NEUTRALISED LEG (packet proof 3): with the bed callback answering
    // yes to everything, the ONLY thing the attachment can do is move the
    // enumeration onto the 5-minute lattice. On a board whose pockets all begin
    // on a lattice minute there is nothing for it to move, and the verdicts are
    // the legacy ones exactly. Asserted CONDITIONALLY on the measured fact
    // rather than assumed — the condition is itself the honest statement.
    const offLattice = staffLanesOf(w.lanes).flatMap((l) =>
      freePockets({
        from: l.window!.from,
        until: l.window!.until,
        close: w.hours.close,
        now: w.now,
        occupied: laneSpans(l),
      }).filter((p) => p.s % 5 !== 0),
    )
    if (offLattice.length === 0) expect({ at: label, latticeDelta }).toEqual({ at: label, latticeDelta: 0 })

    // ⚖ THE LIVE LEG: every remaining difference is a BED difference, and each
    // one is explained by a protected window in that lane the book refuses.
    const engine = createGapGuard({ ...configOf(c), mode: c.mode === 'off' ? 'standard' : c.mode })
    const yes: GuardContext = { protectedWindowFeasible: () => true }
    const unexplained: string[] = []
    for (const [li, r] of bed.entries()) {
      const l = w.lanes.find((x) => x.key === r.laneKey)!
      const pockets = freePockets({
        from: l.window!.from,
        until: l.window!.until,
        close: w.hours.close,
        now: w.now,
        occupied: laneSpans(l),
      })
      const mask = book.newClientMask(l, c.protectedMin)
      const infeasible = pockets.some((p) =>
        engine.protectedCapacity(p, null, yes).beforeStarts.some((s) => !mask(s)),
      )
      for (const [ci, cell] of r.cells.entries()) {
        if (cellKey(cell) === cellKey(lat[li].cells[ci])) continue
        if (!infeasible) unexplained.push(`${r.laneKey}@${hhmm(cell.start)} moved with every window bed-feasible`)
      }
    }
    expect({ at: label, unexplained }).toEqual({ at: label, unexplained: [] })

    // ⚖ THE LAW ITSELF (spec §1's closing clause): the mask's held set and the
    // rail's own enumeration under the same callback are ONE answer.
    const disagreements: string[] = []
    const held = maskOf(w, c, book)
    for (const l of staffLanesOf(w.lanes)) {
      const pockets = freePockets({
        from: l.window!.from,
        until: l.window!.until,
        close: w.hours.close,
        now: w.now,
        occupied: laneSpans(l),
      })
      const ctx: GuardContext = { protectedWindowFeasible: (s, d) => book.newClientMask(l, d)(s) }
      const railStarts = pockets.flatMap((p) => engine.protectedCapacity(p, null, ctx).beforeStarts)
      const maskStarts = (held.find((m) => m.laneKey === l.key)?.spans ?? []).map((s) => s.windowStart)
      if (JSON.stringify(railStarts) !== JSON.stringify(maskStarts)) {
        disagreements.push(`${l.key}: rail ${railStarts.join(',')} ≠ mask ${maskStarts.join(',')}`)
      }
    }
    expect({ at: label, disagreements }).toEqual({ at: label, disagreements: [] })

    RAIL_ROWS.push({
      board: w.name,
      dials: comboLabel(c),
      raw: rawK.filter((k) => k.includes('|blocked|')).length,
      lattice: latK.filter((k) => k.includes('|blocked|')).length,
      bed: bedK.filter((k) => k.includes('|blocked|')).length,
      latticeDelta,
      bedDelta,
      heldWindows: windowsIn(held).length,
      refused: staffLanesOf(w.lanes).reduce((n, l) => {
        const mask = book.newClientMask(l, c.protectedMin)
        return (
          n +
          freePockets({
            from: l.window!.from,
            until: l.window!.until,
            close: w.hours.close,
            now: w.now,
            occupied: laneSpans(l),
          }).reduce((m, p) => m + engine.protectedCapacity(p, null, yes).beforeStarts.filter((s) => !mask(s)).length, 0)
        )
      }, 0),
    })
  }
})

// ── 5 · THE EXPLAIN LAYER ───────────────────────────────────────────────────

describe('5 — a held window explains itself, and is not explained away', () => {
  it('no 「販売可能枠が出ていません」 and no taker’s name over a 新規用に確保 span', () => {
    const w = fixtureWorld()
    const c = shipped()
    const book = bookOf(w)
    const held = maskOf(w, c, book)
    const on = door(w, c, held)
    const rs = rails(w, c, 'bed', book)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    const leaked: string[] = []
    for (const l of explainOf(w, c, rs, on, held)) {
      const spans = byLane.get(l.laneKey) ?? []
      for (const e of l.per) {
        const end = e.start + REAL.guard.standardSessionMin
        if (!spans.some((h) => meets(e.start, end, h.start, h.end))) continue
        if (e.sentence.includes('販売可能枠が出ていません')) leaked.push(`${l.laneKey}@${hhmm(e.start)} bare clause`)
        if (e.sentence.includes('別のスタッフ')) leaked.push(`${l.laneKey}@${hhmm(e.start)} taker clause`)
        if (l.restCues.includes(e.start)) leaked.push(`${l.laneKey}@${hhmm(e.start)} rest-cue hatch`)
      }
    }
    expect(leaked).toEqual([])
    // Not vacuous: the mask really does cover chips on this board.
    const covered = explainOf(w, c, rs, on, held).some((l) =>
      (byLane.get(l.laneKey) ?? []).some((h) => l.per.some((e) => meets(e.start, e.start + REAL.guard.standardSessionMin, h.start, h.end))),
    )
    expect(covered).toBe(true)
  })

  it('the clause and the hatch are unchanged everywhere ELSE — held is a narrowing, never a rewrite', () => {
    const w = fixtureWorld()
    const c = shipped()
    const book = bookOf(w)
    const held = maskOf(w, c, book)
    const on = door(w, c, held)
    const rs = rails(w, c, 'bed', book)
    const withMask = explainOf(w, c, rs, on, held)
    const without = explainOf(w, c, rs, on, undefined)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    for (const [i, l] of withMask.entries()) {
      const spans = byLane.get(l.laneKey) ?? []
      for (const [j, e] of l.per.entries()) {
        if (spans.some((h) => meets(e.start, e.start + REAL.guard.standardSessionMin, h.start, h.end))) continue
        expect({ lane: l.laneKey, start: e.start, e }).toEqual({ lane: l.laneKey, start: e.start, e: without[i].per[j] })
      }
    }
  })

  it('the observational drop surface is still observational — passing drops changes no cell', () => {
    // today-explains.test.ts:393's law, re-asserted through THIS round's seam:
    // `onDrop` is called, never read, so the layer is the same either way.
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    const seen: SellDrop[] = []
    const { price, depth } = priceOf()
    const base = { gridMin: c.gridMin, nowMinute: w.now, locked: [], showPrice: true, hi: price.hi, hqMin: REAL.dialogs.pricing.hqMin, depth, held }
    const withDrops = sellLayerFor(w.lanes, w.hours, {
      ...base,
      reconcile: { claims: door(w, c, held).claims, rooms: w.rooms, cleanupMinutesByBed: w.cleanup, onDrop: (d) => seen.push(d) },
    })
    const without = sellLayerFor(w.lanes, w.hours, {
      ...base,
      reconcile: { claims: door(w, c, held).claims, rooms: w.rooms, cleanupMinutesByBed: w.cleanup },
    })
    expect(withDrops).toEqual(without)
    expect(seen.length).toBeGreaterThan(0)
  })
})

// ── 6 · RESERVED NEVER CLAIMS ───────────────────────────────────────────────

describe('6 — the third offer kind is advisory', () => {
  it('the claims book refuses a reserved offer outright', () => {
    const w = fixtureWorld()
    const offer: OfferInput = { resourceKey: 'bed-01', start: 900, end: 990, kind: 'reserved', laneKey: 'p-05' }
    expect(() => buildClaims(bookOf(w), [offer])).toThrow(/never claims a room/)
  })

  it('nothing on the sales door hands one to the book — the offer set is sell + gap only', () => {
    const w = fixtureWorld()
    const c = shipped()
    const on = door(w, c, maskOf(w, c))
    const offers = boardOffers(on.sell.cells, [...on.gapDrawn.packed, ...on.gapDrawn.scraps])
    expect(offers.every((o) => o.kind === 'sell' || o.kind === 'gap')).toBe(true)
    expect(() => buildClaims(bookOf(w), offers)).not.toThrow()
    // …and the reserved offers themselves carry no room at all, so there is
    // nothing for them to claim even if somebody tried.
    expect(on.reserved.every((o) => !('resourceKey' in o))).toBe(true)
  })

  it('the dedup key is untouched for the kinds that DO claim', () => {
    const w = fixtureWorld()
    const twin: OfferInput[] = [
      { resourceKey: 'bed-01', start: 900, end: 960, kind: 'sell', laneKey: 'p-01' },
      { resourceKey: 'bed-01', start: 900, end: 960, kind: 'sell', laneKey: 'p-01' },
      { resourceKey: 'bed-01', start: 900, end: 960, kind: 'gap', laneKey: 'p-02' },
    ]
    const book = buildClaims(bookOf(w), twin)
    expect(book.claims.map((c) => c.kind)).toEqual(['sell', 'gap'])
  })
})

// ── 7 · THE COST ────────────────────────────────────────────────────────────

interface PerfRow {
  what: string
  lanes: number
  stores: number
  maskMs: number
  windows: number
  handles: number
}

const PERF_ROWS: PerfRow[] = []

/** A book that COUNTS. Only `newClientMask` is intercepted: it is the door the
 *  mask uses, and one handle per (lane, length) per build is the discipline the
 *  perf claim is about. */
function counting(book: BedTruth): { book: BedTruth; handles: () => number } {
  let n = 0
  return {
    book: { ...book, newClientMask: (l, d) => { n += 1; return book.newClientMask(l, d) } },
    handles: () => n,
  }
}

describe('7 — the mask is built once per world per frame, and what it costs', () => {
  it('one mask handle per staff lane per build — never one per probe', () => {
    const w = syntheticWorld()
    const c = shipped()
    const { book, handles } = counting(bookOf(w))
    const held = maskOf(w, c, book)
    // The guard probes the callback thousands of times across the day; the
    // module mints ONE handle per lane (one protected length), which is the
    // whole of E1's cache and the reason the 19–41× naive cost is not paid.
    expect(handles()).toBe(staffLanesOf(w.lanes).length)
    expect(held.length).toBe(staffLanesOf(w.lanes).length)
  })

  it('measures the roster rows and the HQ row', () => {
    const c = shipped()
    const rows: Array<{ what: string; spec: BoardSpec }> = [
      { what: '6 staff / 3 rooms', spec: { staff: 6, beds: 3, seed: 4242, perLane: 3 } },
      { what: '15 staff / 3 rooms', spec: { staff: 15, beds: 3, seed: 4242, perLane: 3 } },
      { what: '25 staff / 3 rooms', spec: { staff: 25, beds: 3, seed: 4242, perLane: 3 } },
      { what: '30 staff / 6 rooms', spec: { staff: 30, beds: 6, seed: 4242, perLane: 3 } },
      {
        what: 'HQ 100 lanes / 40 stores',
        spec: { staff: 100, beds: 40, seed: 4242, perLane: 3, stores: Array.from({ length: 40 }, (_, i) => `store-${pad2(i)}`) },
      },
    ]
    for (const r of rows) {
      const w: World = { ...syntheticWorld(), name: r.what, lanes: board(r.spec) }
      const { book, handles } = counting(bookOf(w))
      const t0 = process.hrtime.bigint()
      const held = maskOf(w, c, book)
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      PERF_ROWS.push({
        what: r.what,
        lanes: r.spec.staff,
        stores: r.spec.stores?.length ?? 1,
        maskMs: Math.round(ms * 100) / 100,
        windows: windowsIn(held).length,
        handles: handles(),
      })
      expect(handles()).toBe(staffLanesOf(w.lanes).length)
    }
    // The 25-staff row is the standing budget row; the HQ row is E1's carried
    // hazard. Both are REPORTED (artifact) and only the shape is asserted —
    // wall-clock on a shared machine is evidence, never a gate.
    expect(PERF_ROWS).toHaveLength(5)
    expect(PERF_ROWS.every((r) => r.handles === r.lanes)).toBe(true)
  })

  it('two builds of one world are the same answer, and touch nothing', () => {
    const w = fixtureWorld()
    const c = shipped()
    const before = JSON.stringify(w.lanes)
    const a = maskOf(w, c)
    const b = maskOf(w, c)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(w.lanes)).toBe(before)
  })
})

// ── THE ARTIFACTS ───────────────────────────────────────────────────────────

const EVIDENCE = process.env.E3A_EVIDENCE ?? ''
const SHA = process.env.E3A_SHA ?? 'unstamped'

describe('the artifacts', () => {
  it('writes RAIL-DELTA and PERF when the evidence dir is named', () => {
    expect(RAIL_ROWS.length).toBeGreaterThan(0)
    expect(PERF_ROWS).toHaveLength(5)
    if (!EVIDENCE) return
    mkdirSync(EVIDENCE, { recursive: true })
    const w = (name: string, lines: string[]) => writeFileSync(join(EVIDENCE, name), `${lines.join('\n')}\n`)
    w(`RAIL-DELTA-${SHA}.txt`, [
      `# RAIL-DELTA-e3a — the staff door's before/after, in TWO columns (spec §2/§3.3)`,
      `# tip: ${SHA}`,
      '#',
      '# WHY TWO COLUMNS. Attaching the bed-feasibility callback does two things to',
      "# the guard's protected enumeration, not one (gap-guard.ts:192-206):",
      '#   · it moves the walk onto the 5-minute LATTICE — `firstStart` becomes',
      '#     `ceil(pocket.s / 5) * 5` instead of the pocket’s own minute;',
      '#   · it FILTERS out every window no room can host.',
      '# A single "before/after" number would blame the rooms for both. So:',
      '#   raw     = today’s shipped rail (no callback at all)',
      '#   lattice = callback present but answering yes to everything',
      '#   bed     = the real mask door — E3a’s rail',
      '#   Δlattice = cells that moved between raw and lattice (ENUMERATION cause)',
      '#   Δbed     = cells that moved between lattice and bed (ROOMS cause)',
      '# `blocked` counts are the refusal cells on the whole board at that setting.',
      '# `held` is the mask’s window count; `refused` is how many lattice-feasible',
      '# protected windows the book says no room can cover.',
      '#',
      '# ⚖ THIS FILE IS THE SEED of §3.3’s count table for Liam at E3b. Nothing on',
      '# screen has changed yet: the rail still ships with no callback (the round',
      '# gate is OFF) and these are the numbers the flip would produce.',
      '#',
      '# board | dials | blocked raw→lattice→bed | Δlattice | Δbed | held | refused',
      ...RAIL_ROWS.map(
        (r) =>
          `${r.board.padEnd(24)} | ${r.dials} | blocked ${String(r.raw).padStart(4)}→${String(r.lattice).padStart(4)}→${String(r.bed).padStart(4)}` +
          ` | Δlattice ${String(r.latticeDelta).padStart(4)} | Δbed ${String(r.bedDelta).padStart(4)}` +
          ` | held ${String(r.heldWindows).padStart(3)} | refused ${String(r.refused).padStart(3)}`,
      ),
      '#',
      '# ASSERTED per row, not eyeballed (§4 of selling-engine-doors.test.ts):',
      '#  · every pocket on both boards starts on a lattice minute, so Δlattice is',
      '#    pinned at 0 — the enumeration move is REAL but has nothing to move here,',
      '#    and the column stays so a board that does have off-lattice pockets shows',
      '#    it in the right place;',
      '#  · every Δbed cell lies on a lane the book refuses at least one protected',
      '#    window on — no verdict moves without a room to blame;',
      '#  · the rail’s own enumeration under the mask ctx is byte-equal to',
      '#    reservedMaskFor’s spans, lane by lane. ONE held set, both doors.',
      '#  · and the threading is NOT a no-op: Δbed is non-zero somewhere, and it',
      '#    moves in BOTH directions — the guard stops refusing placements to',
      '#    protect windows no room can host (fixture 88→87), and starts refusing',
      '#    where a real window it was blind to now counts (synthetic 130→135).',
      '#    Both are the same fix; only the second one costs the operator a start.',
    ])
    w(`PERF-${SHA}.txt`, [
      '# PERF-e3a — what the wiring costs, measured',
      `# tip: ${SHA}`,
      '#',
      '# `handles` = mask closures minted per build. One per staff lane per build is',
      '# the contract: the guard probes the callback thousands of times per frame and',
      "# every ANSWER comes out of the capacity book's precomputed lattice.",
      '# The HQ row is E1’s carried hazard (MAX_STORE_BINDINGS = 32 saturated at 40',
      '# stores) and it stays in every later perf table.',
      '#',
      '# row | lanes | stores | mask build ms | held windows | handles',
      ...PERF_ROWS.map(
        (r) =>
          `${r.what.padEnd(24)} | lanes ${String(r.lanes).padStart(3)} | stores ${String(r.stores).padStart(2)}` +
          ` | ${String(r.maskMs).padStart(7)} ms | windows ${String(r.windows).padStart(4)} | handles ${String(r.handles).padStart(3)}`,
      ),
      '#',
      '# Wall-clock on a shared machine is EVIDENCE, never a gate: the assertions are',
      '# the call-count ones (handles === lanes), which cannot pass by being fast.',
    ])
  })
})
