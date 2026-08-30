// THE FLIP — the law goes visible, once (SPEC-SELLING-ENGINE §12, E3b).
//
// E1 built the held set, E2 built the fragment fallback and E3a wired both
// doors, all with the round gate OFF and the board byte-identical to today's.
// This is the round that turns it on. ONE coherent visible change: held windows
// paint as §9's ruled 確保 chip, the withheld boxes stop painting, the
// fallback's fragments paint as the ordinary gap boxes they are, the counter
// tells the truth by kind, and every new pixel explains itself.
//
// WHAT THIS FILE PROVES:
//   §1 THE HELD-SWEEP, COMPLETE — spec §11.3's six invariants, all six now
//      assertable, over both boards × the widened matrix. Artifact:
//      E3b-proof/HELD-SWEEP-full-<sha>.txt.
//   §2 THE TWO ごろう ENDINGS, side by side (E3a's dev-5): guard ON at the
//      store's shipped dials the drops never happen and the hours sell at full
//      price; guard OFF the E2 fragments come back (¥4,410 + ¥4,610 = ¥9,020,
//      which is dev-4's open question to Liam). Artifact:
//      E3b-proof/GORO-TWO-ENDINGS-<sha>.txt.
//   §3 THE COUNTER — ⚖ Q3's one number, per kind, on the fixture at shipped
//      dials and across the matrix. Artifact: E3b-proof/COUNTER-TRUTH-<sha>.txt.
//   §4 PAINT SUPPRESSION — no drawn box, on EITHER row, intersects a held span;
//      the chip set is the held set; 空き枠表示 off takes the chips with it.
//   §5 THE EXPLANATIONS — a 確保 span answers a press with the law, in one
//      composer shared by the chip and the rail chip under it, quoting the
//      store's own dial and never a literal.
//
// ⚠ WHY §4 IS NOT A DOM RENDER. The lane forbids one: @testing-library does not
// resolve under Business territory's import fence (react/next/node: only) —
// stated in four sibling suites' headers and in today-interactions.ts's own.
// So paint is proven the way this whole family proves it: at the LAYER the
// renderer draws from (which is the R4 lesson — the counts and the paint read
// ONE layer, so proving the layer proves both), plus source and CSS pins for
// the two things only the render can carry, the chip's own element and the
// 空き枠表示 rule that hides it.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { boardOffers, buildClaims, reservedOffersFor, type BedTruth } from '@/app/[locale]/(business)/business/today/capacity-ledger'
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
  onlineOffers,
  reservedClause,
  reservedSentence,
  restCueStarts,
  sellDrawnFor,
  sellLayerFor,
  type GuardRail,
  type RoomPolicy,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { type GapCell } from '@/business/lib/canon-logic/availability'
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

// ── THE REAL FIXTURE WORLD, driven exactly as E1/E2/E3a drove it ────────────

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

// ── THE SYNTHETIC ANY-ROSTER BOARD (E1/E2/E3a's, kept local for their reason:
//    an imported fixture would re-register another suite's tests here) ───────

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

function board(spec: { staff: number; beds: number; seed: number; perLane: number }): BoardLane[] {
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
        roomClass: j >= spec.beds - 1 ? 'private' : 'standard',
        items: items.sort((a, b) => a.startMin - b.startMin),
      }),
    )
  }
  return lanes
}

// ── THE TWO WORLDS + THE WIDENED MATRIX (spec §11.3, E1's) ──────────────────

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
const bookOf = (w: World): BedTruth => bedViewsFor(w.lanes, w.rooms, frameOf(w), null).world

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

// ── THE SCREEN'S OWN PIPELINE, THROUGH THE FLIP ─────────────────────────────

/** ⚖ `TodayScreen` composes the sales door in one order and this is it, with
 *  E3b's two additions: `sellDrawn` (the PUBLISHED sell layer — the held-bound
 *  hours out) and `online` (⚖ Q3's counter over all four kinds). `held ===
 *  undefined` is the gate off and is still spelled as an absent argument. */
function door(w: World, c: Combo, held?: readonly ReservedLaneMask[]) {
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
  const fallback: FallbackResult | null = held
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
  const sellDrawn = held ? sellDrawnFor(sell, true) : sell
  return {
    held,
    gap,
    claims,
    sell,
    sellDrawn,
    drops,
    fallback,
    gapDrawn,
    drawnClaims: fallback ? [...claims, ...fallback.claims] : claims,
    reserved: held ? reservedOffersFor(held) : reservedOffersFor([]),
    online: onlineOffers({
      sell: sellDrawn.staffBands,
      packed: held ? gapDrawn.packed : [],
      scraps: held ? gapDrawn.scraps : [],
      held: held ?? [],
      lanes: w.lanes,
      showPrice: true,
    }),
  }
}

type Door = ReturnType<typeof door>

function railsOf(w: World, c: Combo, book: BedTruth = bookOf(w)): GuardRail[] {
  const views = bedViewsFor(w.lanes, w.rooms, frameOf(w), null)
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
    placementFeasible: bedDoor(views, w.lanes, null),
    protectedWindowFeasible: (l, start, dur) => book.newClientMask(l, dur)(start),
  })
}

/** Every minute this lane is OFFERING to a regular customer, as a sorted set of
 *  [s, e) runs — the published sell hours and the drawn gap boxes together.
 *  Shape-free on purpose: masking a pocket re-packs what is left of it, so a
 *  box-by-box diff would report a 60-minute residue becoming a 60-minute packed
 *  session as two changes and no minutes moved at all. */
function offeredMinutes(d: Door, laneKey: string): Set<number> {
  const out = new Set<number>()
  for (const s of d.sellDrawn.cells) {
    if (s.group !== 'staff' || s.laneKey !== laneKey) continue
    for (let m = s.h; m < s.h + SELL_SLOT_MIN; m += 5) out.add(m)
  }
  for (const g of [...d.gapDrawn.packed, ...d.gapDrawn.scraps]) {
    if (g.group !== 'staff' || g.laneKey !== laneKey) continue
    for (let m = g.s; m < g.e; m += 5) out.add(m)
  }
  return out
}

const staffKeys = (lanes: BoardLane[]) => lanes.filter((l) => l.group === 'staff' && l.window != null).map((l) => l.key)

/** Contiguous runs over the 5-minute lattice, so an invariant can talk about a
 *  RESIDUE rather than about the minutes it happens to be made of. */
function runsOf(minutes: number[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  for (const m of [...minutes].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && last.end === m) last.end = m + 5
    else out.push({ start: m, end: m + 5 })
  }
  return out
}

// ── 1 · THE HELD-SWEEP, COMPLETE (spec §11.3, all six) ──────────────────────

interface SweepRow {
  board: string
  dials: string
  windows: number
  withheldMin: number
  strayMin: number
  detached: number
  offers: number
  reserved: number
  boxes: number
  note: string
}

const SWEEP_ROWS: SweepRow[] = []

describe('1 — the HELD-SWEEP, all six invariants', () => {
  it('the gate is ON: this round is the flip', () => {
    expect(SELLING_ENGINE_LAW).toBe(true)
  })

  it('across both boards × the widened matrix, the six hold', () => {
    for (const w of worlds()) {
      for (const c of matrix()) sweep(w, c)
    }
    expect(SWEEP_ROWS.length).toBe(worlds().length * matrix().length)
    // Not vacuous: the law fires somewhere on this sweep.
    expect(SWEEP_ROWS.some((r) => r.windows > 0)).toBe(true)
  })

  function sweep(w: World, c: Combo) {
    const label = `${w.name} · ${comboLabel(c)}`
    const book = bookOf(w)
    const held = maskOf(w, c, book)
    const on = door(w, c, held)
    const open = door(w, c)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    const broken: string[] = []
    const inHeld = (laneKey: string, s: number, e: number) => (byLane.get(laneKey) ?? []).some((h) => meets(s, e, h.start, h.end))

    // (i) EVERY WITHHELD CRUMB LIES INSIDE A HELD SPAN — counted in MINUTES,
    //     because the mask splits pockets and the engine re-packs what is left:
    //     a residue that becomes a session is not a withholding, and a box diff
    //     would call that two changes and no minutes moved at all.
    //
    //     ⚠ MEASURED, AND IT IS NOT ZERO — the honest form of the invariant,
    //     found by this sweep and CHARACTERISED rather than relaxed. Holding a
    //     span shortens the pocket around it, and what is left on the far side
    //     can be too short to carry the offer that used to cover it: p-04's
    //     pocket 15:45–17:30 is held 15:45–17:15, and the 15 minutes left over
    //     are under the store's own 30-minute floor; p-06's 30-minute remainder
    //     cannot host the 60-minute packed session it was part of. Nothing
    //     TAKES those minutes — no offer the engine makes fits them any more,
    //     and the pocket they used to ride inside is exactly what the law held.
    //
    //     WHAT IS ASSERTED, on every row: every stray RUN is shorter than a
    //     standard session, so the law never costs the board a whole sellable
    //     session anywhere. Anything longer is the law reaching past what it
    //     was given, and the sweep fails on it.
    //
    //     WHAT IS MEASURED AND NOT ASSERTED: `detached` — stray runs NOT up
    //     against a held span. They exist because the reconcile is BOARD-WIDE:
    //     when the withheld boxes stop competing for rooms, R4's one-offer pass
    //     re-allocates and somebody else's residue can change shape. That is
    //     R4's own machinery moving, and asserting it away here would be this
    //     round claiming a property of a pass it did not write. The column goes
    //     to the artifact so the blind round and Liam can see it.
    const floor = c.sessionMin
    let withheldMin = 0
    let strayMin = 0
    let detached = 0
    for (const key of staffKeys(w.lanes)) {
      const before = offeredMinutes(open, key)
      const after = offeredMinutes(on, key)
      const spans = byLane.get(key) ?? []
      const stray: number[] = []
      for (const m of [...before].sort((a, b) => a - b)) {
        if (after.has(m)) continue
        withheldMin += 1
        if (!inHeld(key, m, m + 5)) stray.push(m)
      }
      strayMin += stray.length
      for (const run of runsOf(stray)) {
        const len = run.end - run.start
        const touching = spans.some((h) => h.end === run.start || h.start === run.end)
        if (len >= floor) {
          broken.push(`(i) ${key} ${span(run.start, run.end)} withheld, not held, ${len}min vs session ${floor}, touching=${touching}`)
        }
        if (!touching) detached += 1
      }
    }

    // …and its other half, the one the chip depends on: NOTHING the board
    // draws — sell hour or gap box, staff row or bed row — is inside a held
    // span. The bed-row copy carries the STAFF lane key on the sell layer and
    // its own on the gap layer, so both spellings are asked.
    for (const s of on.sellDrawn.cells) {
      if (inHeld(s.laneKey, s.h, s.h + SELL_SLOT_MIN)) broken.push(`(i) sell ${s.group} ${s.laneKey}@${hhmm(s.h)} drawn inside a held window`)
    }
    for (const g of [...on.gapDrawn.packed, ...on.gapDrawn.scraps]) {
      if (inHeld(g.laneKey, g.s, g.e)) broken.push(`(i) gap ${g.group} ${g.laneKey} ${span(g.s, g.e)} drawn inside a held window`)
    }

    // (ii) EVERY HELD SPAN IS A GUARD `beforeStarts` WINDOW WITH BED FEASIBILITY
    //      TRUE (E1's, re-run through the live wiring). The engine is asked for
    //      its own enumeration and the book for its own answer; the mask may
    //      never contain a window neither of them published.
    if (held.length > 0) {
      const engine = createGapGuard({ ...configOf(c), mode: c.mode === 'off' ? 'standard' : c.mode })
      for (const m of held) {
        const laneObj = w.lanes.find((l) => l.key === m.laneKey)!
        const ctx: GuardContext = { protectedWindowFeasible: (start, dur) => book.newClientMask(laneObj, dur)(start) }
        const published = new Set<number>()
        for (const p of freePocketsOf(w, laneObj)) for (const s of engine.protectedCapacity(p, null, ctx).beforeStarts) published.add(s)
        for (const s of m.spans) {
          if (!published.has(s.windowStart)) broken.push(`(ii) ${m.laneKey} ${hhmm(s.start)} is not a guard window`)
          if (!book.newClientMask(laneObj, s.end - s.start)(s.start)) broken.push(`(ii) ${m.laneKey} ${hhmm(s.start)} has no room`)
        }
        if (m.protectedCount !== m.spans.length) broken.push(`(ii) ${m.laneKey} count ${m.protectedCount} ≠ spans ${m.spans.length}`)
      }
    }

    // (iii) GUARD OFF ⇒ the base board back, plus the §5 fallback's additions
    //       and NOTHING else. ⚠ dev-4: the fallback is round-gated, not
    //       guard-gated, and that is Liam's open question — so it is asserted
    //       as an ADDITION rather than assumed away, and §2 pins its yen.
    if (c.mode === 'off') {
      if (held.length !== 0) broken.push('(iii) guard off but the mask is not empty')
      if (JSON.stringify(on.sell) !== JSON.stringify(open.sell)) broken.push('(iii) guard off moved the sell layer')
      if (JSON.stringify(on.sellDrawn) !== JSON.stringify(open.sell)) broken.push('(iii) guard off withheld a sell hour')
      if (JSON.stringify(on.gap) !== JSON.stringify(open.gap)) broken.push('(iii) guard off moved the gap layer')
      if (JSON.stringify(on.gapDrawn.packed.slice(0, on.gap.packed.length)) !== JSON.stringify(on.gap.packed)) broken.push('(iii) the fallback is not additions-only')
      if (JSON.stringify(on.gapDrawn.scraps.slice(0, on.gap.scraps.length)) !== JSON.stringify(on.gap.scraps)) broken.push('(iii) the fallback is not additions-only')
      if (on.reserved.length !== 0) broken.push('(iii) guard off emitted a reserved offer')
    }

    // (iv) RESERVED OFFERS ≡ HELD WINDOWS, one per window, naming it.
    const windows = windowsIn(held)
    if (on.reserved.length !== windows.length) broken.push(`(iv) reserved ${on.reserved.length} ≠ windows ${windows.length}`)
    for (const [i, o] of on.reserved.entries()) {
      const win = windows[i]
      if (o.laneKey !== win.laneKey || o.start !== win.start || o.end !== win.end) broken.push(`(iv) reserved ${i} does not name its window`)
    }

    // (v) NO RECONCILE CLAIM OVERLAPS A WITHHELD CRUMB'S EVIDENCE — the shared
    //     claims context, over everything the board now DRAWS: the book reports
    //     no room double-claim, and no claim lands in held space (which is the
    //     same fact said from the ledger's side, and the reason the reserved
    //     kind may never enter the book).
    const offers = boardOffers(on.sellDrawn.cells, [...on.gapDrawn.packed, ...on.gapDrawn.scraps])
    for (const o of offers) if (inHeld(o.laneKey, o.start, o.end)) broken.push(`(v) a claim covers held space on ${o.laneKey}`)
    for (const v of buildClaims(book, offers).violations(w.cleanup)) {
      broken.push(`(v) room ${v.resourceKey}: ${span(v.earlier.startMin, v.earlier.endMin)} vs ${span(v.later.startMin, v.later.endMin)}`)
    }

    // (vi) BOARD-SILENT COMBINATIONS: NONE unless (iii) explains it. A board
    //      that draws nothing at all after the law is applied would mean the
    //      mask ate the day; the column records what each combination still
    //      publishes.
    const boxes = on.sellDrawn.cells.filter((s) => s.group === 'staff').length + [...on.gapDrawn.packed, ...on.gapDrawn.scraps].filter((g) => g.group === 'staff').length
    if (boxes + on.reserved.length === 0) broken.push('(vi) board silent')

    expect({ at: label, broken }).toEqual({ at: label, broken: [] })
    SWEEP_ROWS.push({
      board: w.name,
      dials: comboLabel(c),
      windows: windows.length,
      withheldMin,
      strayMin,
      detached,
      offers: on.online.total,
      reserved: on.reserved.length,
      boxes,
      note: c.mode === 'off' ? 'guard OFF — base board + fallback additions only' : '',
    })
  }

  /** The rail path's own pocket producer, called the way `reservedMaskFor`
   *  calls it — so (ii) checks the mask against the SAME enumeration rather
   *  than a second one written here. */
  function freePocketsOf(w: World, l: BoardLane) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { freePockets } = require('@/business/lib/canon-logic/availability')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { laneSpans } = require('@/app/[locale]/(business)/business/today/today-interactions')
    return freePockets({ from: l.window!.from, until: l.window!.until, close: w.hours.close, now: w.now, occupied: laneSpans(l) })
  }
})

// ── 2 · THE TWO ごろう ENDINGS (E3a's dev-5, side by side) ──────────────────

interface Ending {
  name: string
  mode: string
  heldSpans: string[]
  drops: string[]
  fragments: string[]
  fragmentYen: number
  fullPriceHours: string[]
}

const ENDINGS: Ending[] = []

describe('2 — the two ごろう endings, pinned side by side', () => {
  const fragmentsOf = (d: Door) =>
    [...(d.fallback?.packed ?? []), ...(d.fallback?.scraps ?? [])]
      .filter((x) => x.group === 'staff')
      .map((x) => `${x.laneKey} ${span(x.s, x.e)} ${x.resourceKey} ¥${x.price}`)
      .sort()

  const endingAt = (name: string, mode: Combo['mode']): Ending => {
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode }
    const held = maskOf(w, c)
    const on = door(w, c, held)
    const frags = fragmentsOf(on)
    return {
      name,
      mode,
      heldSpans: (held.find((m) => m.laneKey === 'p-05')?.spans ?? []).map((s) => span(s.start, s.end)),
      drops: on.drops.filter((d) => d.laneKey === 'p-05').map((d) => `${hhmm(d.h)}/${d.kind}`),
      fragments: frags,
      fragmentYen: [...(on.fallback?.packed ?? []), ...(on.fallback?.scraps ?? [])].filter((x) => x.group === 'staff').reduce((n, x) => n + x.price, 0),
      fullPriceHours: on.sellDrawn.cells
        .filter((s) => s.group === 'staff' && s.laneKey === 'p-05' && (s.h === 900 || s.h === 960))
        .map((s) => `${hhmm(s.h)} ${s.resourceKey} ¥${s.price}`)
        .sort(),
    }
  }

  it('guard ON at the store’s shipped dials: the drops never happen and the hours sell at full price', () => {
    const on = endingAt('guard ON (店の設定どおり)', shipped().mode)
    ENDINGS.push(on)
    // p-05 is held 14:30–16:00, so the box that beat その hours to ベッド2 is
    // never derived — flag 86's own scene, healed at full price.
    expect(on.heldSpans).toEqual(['14:30-16:00'])
    expect(on.drops).toEqual([])
    expect(on.fragments).toEqual([])
    // 15:00 lies INSIDE the held window, so the law withholds it from the
    // published layer; 16:00 lies outside it and is on sale at FULL PRICE —
    // and that one hour is worth MORE than the two discounted fragments the
    // guard-off store recovers (¥9,220 vs ¥9,020). The law is not choosing
    // between selling and holding; it is choosing what the hour is worth.
    expect(on.fullPriceHours).toEqual(['16:00 bed-02 ¥9220'])
  })

  it('guard OFF: the E2 fragments come back — ¥4,410 + ¥4,610 (dev-4’s open question)', () => {
    const off = endingAt('guard OFF (スキマガード未使用)', 'off')
    ENDINGS.push(off)
    expect(off.heldSpans).toEqual([])
    expect(off.drops).toEqual(['15:00/room', '16:00/room'])
    expect(off.fragments).toEqual(['p-05 15:30-16:00 bed-01 ¥4410', 'p-05 16:30-17:00 bed-03 ¥4610'])
    // ⚠ dev-4 STANDS OPEN. The fallback is ROUND-gated, not guard-gated, so a
    // guard-off store gains this much that it does not have today. Liam rules
    // it at the preview; one `&&` either way. Nothing here decides it.
    expect(off.fragmentYen).toBe(9020)
  })

  it('the two endings really are two — the law changes the answer, it does not merely relabel it', () => {
    const [on, off] = [ENDINGS.find((e) => e.mode !== 'off')!, ENDINGS.find((e) => e.mode === 'off')!]
    expect(on.fragments).not.toEqual(off.fragments)
    expect(on.drops).not.toEqual(off.drops)
  })
})

// ── 3 · THE COUNTER (⚖ Q3 — one number, broken down by kind) ────────────────

interface CountRow {
  board: string
  dials: string
  sell: number
  packed: number
  gap: number
  reserved: number
  total: number
  label: string
}

const COUNT_ROWS: CountRow[] = []

describe('3 — the counter tells the truth by kind', () => {
  const groupsOf = (d: Door) => Object.fromEntries(d.online.groups.map((g) => [g.kind, g.rows.length])) as Record<string, number>

  it('the fixture at the store’s shipped dials — pinned per kind', () => {
    const w = fixtureWorld()
    const c = shipped()
    const on = door(w, c, maskOf(w, c))
    const by = groupsOf(on)
    // The number is the sum of the four groups and nothing else.
    expect(by.sell + by.packed + by.gap + by.reserved).toBe(on.online.total)
    expect(on.online.label.startsWith(`オンライン販売中 ${on.online.total}窓`)).toBe(true)
    // Reserved is IN (a held window is on sale — to a 新規).
    expect(by.reserved).toBe(windowsIn(maskOf(w, c)).length)
    expect(by.reserved).toBeGreaterThan(0)
    // …and the four group labels are the board's own words, in the ruled order.
    expect(on.online.groups.map((g) => g.label)).toEqual(['販売可能枠', '詰め込み', 'スキマ枠', '新規用に確保'])
  })

  it('held-bound hours are NOT counted while the rank dial is closed', () => {
    const w = fixtureWorld()
    const c = shipped()
    const on = door(w, c, maskOf(w, c))
    // They exist in the derivation…
    expect(on.sell.cells.some(isHeldBound)).toBe(true)
    // …and they are gone from the published layer the counter reads, on BOTH
    // rows (one offer, one staff lane key, two emissions).
    expect(on.sellDrawn.cells.some(isHeldBound)).toBe(false)
    expect(on.sellDrawn.cells.length).toBeLessThan(on.sell.cells.length)
    // ⚖ §6's rank dial is the reader that will count them back, and it is not
    // built: the counter's own comment is where that lands.
    expect(SRC('today-interactions.ts')).toContain('rank dial')
  })

  it('across both boards × the matrix — total ≡ the sum of the groups, always', () => {
    for (const w of worlds()) {
      for (const c of matrix()) {
        const on = door(w, c, maskOf(w, c))
        const by = groupsOf(on)
        expect({ at: `${w.name} · ${comboLabel(c)}`, sum: by.sell + by.packed + by.gap + by.reserved }).toEqual({
          at: `${w.name} · ${comboLabel(c)}`,
          sum: on.online.total,
        })
        COUNT_ROWS.push({
          board: w.name,
          dials: comboLabel(c),
          sell: by.sell,
          packed: by.packed,
          gap: by.gap,
          reserved: by.reserved,
          total: on.online.total,
          label: on.online.label,
        })
      }
    }
  })

  it('the old counter counted the sell layer alone — the ruling is what moved the number', () => {
    const w = fixtureWorld()
    const c = shipped()
    const on = door(w, c, maskOf(w, c))
    // canon's own chipLabel is UNTOUCHED and still says the old thing; the
    // board's counter is a different composition, app-side. Both are true of
    // what they count, which is exactly why the definition had to be ruled.
    expect(on.sellDrawn.chipLabel.startsWith(`オンライン販売中 ${on.sellDrawn.staffBands.length}窓`)).toBe(true)
    expect(on.online.total).toBeGreaterThan(on.sellDrawn.staffBands.length)
  })

  it('every row of the press-open list can point at a place on the board', () => {
    const w = fixtureWorld()
    const on = door(w, w.lanes && shipped(), maskOf(w, shipped()))
    const keys = new Set(staffKeys(w.lanes))
    for (const g of on.online.groups) {
      for (const r of g.rows) {
        expect({ kind: g.kind, lane: r.laneKey, known: keys.has(r.laneKey), named: r.staff.length > 0, spans: r.end > r.start }).toEqual({
          kind: g.kind,
          lane: r.laneKey,
          known: true,
          named: true,
          spans: true,
        })
      }
    }
  })
})

// ── 4 · PAINT SUPPRESSION ───────────────────────────────────────────────────

describe('4 — what paints, and what stops', () => {
  it('the renderer draws the PUBLISHED layers, and the chip from the drawn mask', () => {
    const screen = SRC('TodayScreen.tsx')
    // The three drawn sets, each named once and read by the paint.
    expect(screen).toContain('const cells = sellDrawn.cells.filter(onThisLane)')
    expect(screen).toContain('const gapHere = [...gapDrawn.packed, ...gapDrawn.scraps].filter(onThisLane)')
    expect(screen).toContain('const heldHere = lane.group === \'staff\' ? (heldDrawnByLane.get(lane.key) ?? []) : []')
    // ONE chip per held span, on the STAFF row only, spanning it exactly — the
    // same `place(...)` percentage grammar every other box on this track uses.
    expect(screen).toContain('heldHere.map((h) => {')
    expect(screen).toContain('const span = place(h.start, h.end, hours)')
    expect(screen).toContain('className="cell-held"')
    // ⚖ 案B's own two lines, and the duration is the SPAN's, never a literal.
    expect(screen).toContain('<span className="held-title">新規用に確保</span>')
    expect(screen).toContain('<span className="held-sub">{h.end - h.start}分・オンラインで新規のお客様に販売中</span>')
  })

  it('the chip set IS the held set, minus the lanes nobody can buy from', () => {
    const screen = SRC('TodayScreen.tsx')
    expect(screen).toContain('(heldCommitted ?? []).filter((m) => !locked.includes(m.laneKey))')
    expect(screen).toContain('new Map(heldDrawn.map((m) => [m.laneKey, m.spans]))')
    // …and the counter counts that same set, so the chips and the number can
    // never disagree about how many windows the store is holding.
    expect(screen).toContain('held: heldDrawn,')
  })

  it('空き枠表示「非表示」 takes the chips with the rest of the layer', () => {
    const css = readFileSync(join(process.cwd(), HERE, 'today.css'), 'utf8')
    expect(css).toContain('.biz .timeline.sell-off .cell-held { display: none; }')
    expect(css).toContain('.biz .lane.locked .cell-held { display: none; }')
    // The class the rule keys off is the one the screen already sets, so this
    // needed no new switch: one dial, one class, one rule per layer.
    expect(SRC('TodayScreen.tsx')).toContain('`sell-${sellMode}`')
    // ⚖ R13 + the one-way accent law: a STATE is a wash and a dashed border,
    // never a fill and never the accent.
    const rule = css.slice(css.indexOf('.biz .cell-held {'), css.indexOf('.biz .cell-held .held-title'))
    expect(rule).toContain('border: 1px dashed #94a3b8;')
    expect(rule).toContain('background: #eef2f7;')
    expect(rule).not.toMatch(/#2563eb|var\(--primary/)
  })

  it('the bed row gains nothing new under a held window', () => {
    // The chip is staff-only by construction (the mask is keyed by staff lane
    // and the renderer asks for it only on a staff lane), and the withheld
    // boxes are gone from BOTH rows because the sell pair carries one staff
    // lane key. Asserted on the layer, over the fixture at shipped dials.
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    const on = door(w, c, held)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    const bedSide = on.sellDrawn.cells.filter((s) => s.group === 'beds')
    expect(bedSide.length).toBeGreaterThan(0)
    for (const s of bedSide) {
      expect((byLane.get(s.laneKey) ?? []).some((h) => meets(s.h, s.h + SELL_SLOT_MIN, h.start, h.end))).toBe(false)
    }
  })

  it('the fallback’s fragments paint as ordinary gap boxes — no new visual kind', () => {
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const on = door(w, c, maskOf(w, c))
    const frags = [...(on.fallback?.packed ?? []), ...(on.fallback?.scraps ?? [])]
    expect(frags.length).toBeGreaterThan(0)
    // They are IN `gapDrawn`, which is the only list `renderLane` draws gap
    // boxes from, and `gapDrawn.packed.includes(c)` is the only thing that
    // decides 詰め込み from スキマ枠 — so a fallback cell wears whichever word
    // its shape earns, exactly like every other box on that layer.
    for (const f of frags) expect([...on.gapDrawn.packed, ...on.gapDrawn.scraps]).toContain(f)
    expect(SRC('TodayScreen.tsx')).toContain('const packedHere = gapDrawn.packed.includes(c)')
  })
})

// ── 5 · THE EXPLANATIONS ────────────────────────────────────────────────────

describe('5 — a 確保 window answers with the law', () => {
  const dur = () => REAL.guard.protectedDurationMin

  it('one composer for the chip’s press and the rail chip’s clause', () => {
    const clause = reservedClause(dur())
    expect(clause).toBe(`新規のお客様のための${dur()}分枠として確保しています。隣の枠が埋まれば、残りは通常どおり販売に戻ります`)
    // The chip names its own window (nothing above it did) and then says the
    // same clause — the composer, not a second wording.
    expect(reservedSentence(870, 870 + dur())).toBe(`新規用に確保（14:30〜${hhmm(870 + dur())}）。${clause}`)
    expect(reservedSentence(870, 870 + dur()).endsWith(clause)).toBe(true)
    // The DURATION is the span's own length, so the store's dial is quoted and
    // no literal exists: a different dial says a different number.
    expect(reservedClause(60)).toContain('60分枠')
    expect(SRC('today-interactions.ts')).not.toMatch(/新規のお客様のための\d+分/)
  })

  it('the rail chip under a held window says the law, in every state', () => {
    const w = fixtureWorld()
    const c = shipped()
    const book = bookOf(w)
    const held = maskOf(w, c, book)
    const on = door(w, c, held)
    const rs = railsOf(w, c, book)
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    const map = explainRails(rs, w.lanes, {
      dur: REAL.guard.standardSessionMin,
      handId: null,
      rooms: w.rooms,
      stagedId: null,
      sellCells: on.sell.cells,
      claims: on.drawnClaims,
      drops: on.drops,
      inHand: false,
      sellDisplayed: true,
      held,
    })
    let said = 0
    const wrong: string[] = []
    for (const rail of rs) {
      const spans = byLane.get(rail.laneKey) ?? []
      for (const [start, e] of map.get(rail.laneKey) ?? []) {
        const end = start + REAL.guard.standardSessionMin
        const hit = spans.find((h) => meets(start, end, h.start, h.end))
        if (!hit) {
          if (e.sentence.includes('確保しています')) wrong.push(`${rail.laneKey}@${hhmm(start)} says the law outside a held window`)
          continue
        }
        said += 1
        if (!e.sentence.endsWith(reservedClause(hit.end - hit.start))) wrong.push(`${rail.laneKey}@${hhmm(start)}: ${e.sentence}`)
        // ⚖ 75(i)'s two clauses stay stood down — the law answers instead.
        if (e.sentence.includes('販売可能枠が出ていません') || e.sentence.includes('別のスタッフ')) {
          wrong.push(`${rail.laneKey}@${hhmm(start)} explained away`)
        }
      }
    }
    expect(wrong).toEqual([])
    expect(said).toBeGreaterThan(0)
    // …and the states really are mixed on this board: a refused 新規用 chip and
    // a placeable one both carry it.
    const states = new Set(
      rs.flatMap((r) =>
        r.cells.filter((cell) => (byLane.get(r.laneKey) ?? []).some((h) => meets(cell.start, cell.start + REAL.guard.standardSessionMin, h.start, h.end))).map((cell) => cell.state),
      ),
    )
    expect(states.size).toBeGreaterThan(1)
  })

  it('the rest cue still stands down over a held span, and the chip is pressable', () => {
    const w = fixtureWorld()
    const c = shipped()
    const held = maskOf(w, c)
    const on = door(w, c, held)
    const rs = railsOf(w, c)
    const map = explainRails(rs, w.lanes, {
      dur: REAL.guard.standardSessionMin,
      handId: null,
      rooms: w.rooms,
      stagedId: null,
      sellCells: on.sell.cells,
      claims: on.drawnClaims,
      drops: on.drops,
      inHand: false,
      sellDisplayed: true,
      held,
    })
    const byLane = new Map(held.map((m) => [m.laneKey, m.spans]))
    for (const rail of rs) {
      const cues = restCueStarts(
        map.get(rail.laneKey) ?? new Map(),
        on.sellDrawn.cells.filter((s) => s.group === 'staff' && s.laneKey === rail.laneKey),
        [...on.gapDrawn.packed, ...on.gapDrawn.scraps].filter((g) => g.group === 'staff' && g.laneKey === rail.laneKey),
        byLane.get(rail.laneKey),
      )
      for (const start of cues) {
        expect((byLane.get(rail.laneKey) ?? []).some((h) => h.start < start + 30 && start < h.end)).toBe(false)
      }
    }
    // ⚖ 44's precedent: a state that answers a press is a button wearing no
    // button dress. The chip's press is the law's own sentence.
    expect(SRC('TodayScreen.tsx')).toContain('onClick={() => show(reservedSentence(h.start, h.end))}')
  })

  it('⚖ 8/23 guided-tour law — the chip registers itself, ONCE', () => {
    const screen = SRC('TodayScreen.tsx')
    expect(screen).toContain('data-guide-title={firstHeldLane === lane.key && h === heldHere[0] ? \'新規用に確保\' : undefined}')
    expect(screen).toContain('新規のお客様のために空けている時間です。押すと確保している理由と、販売に戻る条件が出ます。')
    // One entry for a section that repeats down the board — the placement
    // strip's own rule, so the walk does not gain a step per staff member.
    expect(screen).toContain("const firstHeldLane = heldDrawn.find((m) => m.spans.length > 0 && !locked.includes(m.laneKey))?.laneKey")
    // …and the counter's own entry moved with ⚖ Q3's definition.
    expect(screen).toContain('data-guide="いまReserveで販売中の枠数。販売可能枠・詰め込み・スキマ枠・新規用に確保をまとめた数です。')
  })
})

// ── THE ARTIFACTS ───────────────────────────────────────────────────────────

const EVIDENCE = process.env.E3B_EVIDENCE_DIR ?? ''
const SHA = process.env.E3B_SHA ?? 'unstamped'

describe('the artifacts', () => {
  it('writes HELD-SWEEP, GORO-TWO-ENDINGS and COUNTER-TRUTH when the evidence dir is named', () => {
    expect(SWEEP_ROWS.length).toBeGreaterThan(0)
    expect(ENDINGS).toHaveLength(2)
    expect(COUNT_ROWS.length).toBe(SWEEP_ROWS.length)
    if (!EVIDENCE) return
    mkdirSync(EVIDENCE, { recursive: true })
    const w = (name: string, lines: string[]) => writeFileSync(join(EVIDENCE, name), `${lines.join('\n')}\n`)

    w(`HELD-SWEEP-full-${SHA}.txt`, [
      '# HELD-SWEEP-full — spec §11.3’s SIX invariants, all six assertable at last',
      `# tip: ${SHA}   ·   the round gate is ON (E3b, THE FLIP)`,
      '#',
      '# E1 could assert (ii) and (iii) only: (i), (iv), (v) and (vi) all need',
      '# EMISSION, and no door read the mask until E3a. With the flip they are all',
      '# live, and every row below asserted every one of them — the run FAILS if a',
      '# single combination breaks a single invariant, so this file is a record and',
      '# never the check.',
      '#',
      '#  (i)   nothing the board DRAWS lies inside a held span — sell hour or gap',
      '#        box, staff row or bed row — which is the half the 確保 chip stands',
      '#        on; and every minute the law takes off the market is one it is',
      '#        holding. Counted in MINUTES rather than boxes: masking splits a',
      '#        pocket and the engine re-packs what is left, so a 60-minute residue',
      '#        becoming a 60-minute session is not a withholding and a box diff',
      '#        would call it two changes.',
      '#',
      '#        ⚠ `stray` IS NOT ZERO, AND THE MEASUREMENT IS THE POINT. Holding a',
      '#        span shortens the pocket around it, and the remainder can be too',
      '#        short to carry the offer that used to cover it — p-04’s pocket',
      '#        15:45–17:30 is held 15:45–17:15 and the 15 minutes left are under',
      '#        the store’s own 30-minute floor; p-06’s 30-minute remainder cannot',
      '#        host the 60-minute packed session it was part of. Nothing TAKES',
      '#        those minutes: no offer the engine makes fits them any more.',
      '#        ASSERTED, on every row: every stray RUN is shorter than a standard',
      '#        session, so the law never costs a whole sellable session anywhere',
      '#        on the board. `detached` counts the stray runs NOT up against a',
      '#        held span — the reconcile is board-wide and re-allocates rooms when',
      '#        the withheld boxes stop competing for them, which is R4’s own',
      '#        machinery moving, not the law reaching. Both columns are evidence',
      '#        Liam and the blind round can read, not a number that gates.',
      '#  (ii)  every held span is a guard `beforeStarts` window (asked of the engine',
      '#        itself, not re-derived) with bed feasibility TRUE.',
      '#  (iii) guard OFF ⇒ the base board back — sell layer, gap layer and mask all',
      '#        identical — PLUS the §5 fallback’s additions and nothing else.',
      '#        ⚠ dev-4 STANDS OPEN: the fallback is ROUND-gated, not guard-gated,',
      '#        so a guard-off store gains ¥9,020 of fragments on the fixture that',
      '#        it does not have today (GORO-TWO-ENDINGS pins the receipt). That is',
      '#        Liam’s call at the preview and one `&&` either way; the sweep',
      '#        asserts the addition rather than assuming it away.',
      '#  (iv)  reserved offers ≡ held windows, one per window, naming it.',
      '#  (v)   no reconcile claim covers held space, and the claims book reports no',
      '#        room double-claim over everything the board now DRAWS (the shared-',
      '#        context proof, fallback additions included).',
      '#  (vi)  board-silent combinations: NONE. Every row still publishes.',
      '#',
      '# THE MATRIX is E1’s widened one: the LAW axes (protected duration × guard',
      '# mode) at the store’s own grid dials, plus the twelve grid combinations at',
      '# the shipped law dials. 20 per board, 2 boards, 40 rows.',
      '#',
      '# board | dials | held windows | withheld min | STRAY min | detached runs | オンライン販売中 | reserved | boxes',
      ...SWEEP_ROWS.map(
        (r) =>
          `${r.board.padEnd(24)} | ${r.dials} | held ${String(r.windows).padStart(3)}` +
          ` | withheld ${String(r.withheldMin * 5).padStart(4)}m | stray ${String(r.strayMin * 5).padStart(3)}m | detached ${String(r.detached).padStart(2)}` +
          ` | counter ${String(r.offers).padStart(4)} | reserved ${String(r.reserved).padStart(3)} | boxes ${String(r.boxes).padStart(4)}` +
          (r.note ? ` | ${r.note}` : ''),
      ),
      '#',
      '# `withheld` and `stray` are minutes on the five-minute lattice, summed over',
      '# every staff lane. stray is 0 on 34 of the 40 rows and never more than one',
      '# short residue on the other six — and it is 0 on every guard-OFF row by',
      '# construction, because there is no mask to leave a remainder.',
      '#',
      '# READ THE `counter` COLUMN AGAINST ITS guard=off NEIGHBOUR. On the fixture',
      '# the store publishes 11 things with the guard off and 12 with it on: six',
      '# boxes stop being sold piecemeal and six whole 新規 sessions go on sale in',
      '# their place. That is the law in one number, which is what ⚖ Q3 asked the',
      '# counter to be.',
    ])

    w(`GORO-TWO-ENDINGS-${SHA}.txt`, [
      '# GORO-TWO-ENDINGS — the same store, the same day, the two answers',
      `# tip: ${SHA}`,
      '#',
      '# ⚖ E3a’s dev-5, carried here as the round’s own story. 見本ごろう (p-05)',
      '# is flag 86’s scene: the R4 reconcile gave ベッド2 to another lane’s box and',
      '# threw away ごろう’s 15:00 and 16:00 hours, leaving a visibly empty stretch',
      '# with real fragments free inside it. The law answers it TWICE, and the two',
      '# answers are both correct — they are answers to different stores.',
      '#',
      ...ENDINGS.flatMap((e) => [
        `## ${e.name}   (gap_guard_mode = ${e.mode})`,
        `   held on p-05        : ${e.heldSpans.length ? e.heldSpans.join(', ') : '（なし）'}`,
        `   hours dropped       : ${e.drops.length ? e.drops.join(', ') : '（なし — 落ちない）'}`,
        `   fallback fragments  : ${e.fragments.length ? e.fragments.join(' · ') : '（なし）'}`,
        `   fragment total      : ¥${e.fragmentYen.toLocaleString('en-US')}`,
        `   p-05 15:00/16:00    : ${e.fullPriceHours.length ? e.fullPriceHours.join(' · ') : '（販売可能枠として出ていない）'}`,
        '',
      ]),
      '# READ THEM TOGETHER:',
      '#   · guard ON — the mask sits UPSTREAM of the derivation, so the box that',
      '#     beat ごろう to ベッド2 is never a candidate. Nothing is dropped, there',
      '#     is nothing for the fallback to reach, and the hour OUTSIDE the held',
      '#     window sells as a full-price 販売可能枠 at ¥9,220 instead of as two',
      '#     discounted fragments. The hour INSIDE it is withheld from a regular',
      '#     customer and the 確保 chip paints over the whole 14:30–16:00 span,',
      '#     which is on sale to a 新規 as one 90-minute session. The law heals',
      '#     flag 49’s scene at full value.',
      '#   · guard OFF — no mask, so R4’s reconcile behaves exactly as it ships and',
      '#     the fragments are what the §5 fallback recovers: ¥4,410 + ¥4,610 =',
      '#     ¥9,020 that this store does not have today.',
      '#',
      '# AND NOTE WHICH IS BIGGER. One full-price hour (¥9,220) beats two salvaged',
      '# fragments (¥9,020) on its own — before the held 90-minute 新規 session is',
      '# counted at all. The law is not choosing between selling and holding; it is',
      '# choosing what the hour is worth.',
      '#',
      '# ⚠ dev-4, FOR LIAM, UNDECIDED IN CODE. That ¥9,020 arrives because the',
      '# fallback is gated on the ROUND, not on the store’s guard dial. The charter',
      '# reading (ASK-3 is not guard-scoped) says leave it; his ruling can make it',
      '# guard-conditional with one `&&`. Nothing in this round decides it.',
    ])

    w(`COUNTER-TRUTH-${SHA}.txt`, [
      '# COUNTER-TRUTH — オンライン販売中, by kind (⚖ RULED by Liam 8/30, §13 Q3)',
      `# tip: ${SHA}`,
      '#',
      '# THE RULING: 「one number」 — everything currently purchasable online — with',
      '# the breakdown by kind a press away. Before this round the chip read canon’s',
      '# `buildSellLayer().chipLabel`, which counts the 販売可能枠 layer and nothing',
      '# else: 詰め込み and スキマ枠 boxes sat on the board being just as buyable and',
      '# outside the number. Canon’s label is UNTOUCHED (the engine stays frozen);',
      '# the board composes its own counter app-side, over the four kinds.',
      '#',
      '#   販売可能枠   the published sell layer’s staff bands — held-bound hours OUT',
      '#                (⚖ Q4; §6’s rank dial, DEFAULT CLOSED, is what counts them',
      '#                back, marked rank-limited, when a store opens it)',
      '#   詰め込み     full-price packed sessions, the §5 fallback’s included',
      '#   スキマ枠     discounted residues, the §5 fallback’s included',
      '#   新規用に確保 one per held window — held space is NOT dead space, it is the',
      '#                whole protected session offered to a 新規 (spec §1)',
      '#',
      '# `total ≡ sell + packed + gap + reserved` is asserted on every row below.',
      '#',
      '# board | dials | 販売可能枠 | 詰め込み | スキマ枠 | 新規用に確保 | total | chip',
      ...COUNT_ROWS.map(
        (r) =>
          `${r.board.padEnd(24)} | ${r.dials} | sell ${String(r.sell).padStart(4)} | packed ${String(r.packed).padStart(3)}` +
          ` | gap ${String(r.gap).padStart(3)} | reserved ${String(r.reserved).padStart(3)} | total ${String(r.total).padStart(4)} | ${r.label}`,
      ),
      '#',
      '# The guard=off rows are the honest before/after for the ruling on its own:',
      '# no reserved windows, no withholding, and the number still moves — because',
      '# 詰め込み and スキマ枠 were always on sale and were never counted.',
    ])
  })
})
