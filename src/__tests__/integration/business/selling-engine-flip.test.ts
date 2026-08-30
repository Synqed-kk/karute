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
import { reservedMaskFor, type ReleasedWindow, type ReservedLaneMask } from '@/app/[locale]/(business)/business/today/reserved-mask'
import { SELLING_ENGINE_LAW } from '@/app/[locale]/(business)/business/today/selling-engine-gate'
import { bedDoor, bedViewsFor, TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import {
  canReleaseHeld,
  explainRails,
  gapLayerFor,
  gapPackingDials,
  guardRailsFor,
  heldDrawnFor,
  isHeldBound,
  onlineOffers,
  onShownBoard,
  reservedClause,
  reservedSentence,
  restCueStarts,
  sellDrawnFor,
  sellLayerFor,
  sellStaffLanes,
  type GuardRail,
  type RoomPolicy,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { type GapCell } from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig, type GuardContext } from '@/business/lib/canon-logic/gap-guard'
import { clampPriceInputs, SELL_SLOT_MIN } from '@/business/lib/canon-logic/pricing'
import { STORE_A } from '@/business/lib/fixtures'
import { opsConfig } from '@/business/lib/fixtures-today'
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

const maskOf = (
  w: World,
  c: Combo,
  book: BedTruth = bookOf(w),
  /** ⚖ E5 (ruling Q5) — the windows a manager has released. Absent everywhere
   *  above: E3b's answer is unchanged by construction. */
  released?: readonly ReleasedWindow[],
): readonly ReservedLaneMask[] =>
  reservedMaskFor({
    lanes: w.lanes,
    closeMin: w.hours.close,
    nowMin: w.now,
    guard: configOf(c),
    gapGuardMode: c.mode,
    book,
    released,
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
  // ⚖ FIX ROUND F3 + F4 — the screen's own two lines, in the screen's own order:
  // the mask the SALES door may publish (`heldDrawnFor`, one spelling with the
  // sell door's lanes), and §4.5's named adapter over it. ONE emission home —
  // the object below hands the SAME array to the counter that (iv) is asserted
  // against, so the invariant is now a statement about the rows the operator
  // reads rather than about a field with no consumer.
  const heldDrawn = heldDrawnFor(held, w.lanes, [])
  const reserved = reservedOffersFor(heldDrawn)
  return {
    held,
    heldDrawn,
    gap,
    claims,
    sell,
    sellDrawn,
    drops,
    fallback,
    gapDrawn,
    drawnClaims: fallback ? [...claims, ...fallback.claims] : claims,
    reserved,
    online: onlineOffers({
      sell: sellDrawn.staffBands,
      packed: held ? gapDrawn.packed : [],
      scraps: held ? gapDrawn.scraps : [],
      reserved,
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
    //
    // ⚖ FIX ROUND F4 — RE-POINTED AT THE PATH THE SCREEN READS. It used to be
    // asserted over `reservedOffersFor(held)` while the board emitted its
    // reserved rows from a second, inline builder fed the PUBLISHED mask — so
    // the invariant was true of a field nothing consumed and said nothing about
    // the number the operator sees. There is one emission now, and the windows
    // it is compared against are the PUBLISHED ones (§9's own reasoning: a
    // window on a row nobody can buy from is not an offer). The rows the
    // counter shows are asserted to BE that emission, so the chain runs
    // mask → publication → emission → counter with nothing forked off it.
    const windows = windowsIn(on.heldDrawn)
    if (on.reserved.length !== windows.length) broken.push(`(iv) reserved ${on.reserved.length} ≠ windows ${windows.length}`)
    for (const [i, o] of on.reserved.entries()) {
      const win = windows[i]
      if (o.laneKey !== win.laneKey || o.start !== win.start || o.end !== win.end) broken.push(`(iv) reserved ${i} does not name its window`)
    }
    const counterRows = on.online.groups.find((g) => g.kind === 'reserved')!.rows
    if (counterRows.length !== on.reserved.length) broken.push(`(iv) counter rows ${counterRows.length} ≠ emitted ${on.reserved.length}`)
    for (const [i, r] of counterRows.entries()) {
      const o = on.reserved[i]
      if (!o || r.laneKey !== o.laneKey || r.start !== o.start || r.end !== o.end) broken.push(`(iv) counter row ${i} is not the emitted offer`)
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

  it('⚖ FIX ROUND F10 — the four-kind definition applies with the guard OFF too, ASSERTED', () => {
    // ⚖ Q3's ruling is a TRUTH-FIX about what 「online sale」 means, and it is
    // unconditional: 詰め込み and スキマ枠 boxes were always purchasable and were
    // never counted. A guard-OFF store has no held windows and no withholding,
    // and its counter still moves — which the blind round found stated NOWHERE
    // (L1#6's counter half: the sweep records 11 vs 12 across the dial, never
    // against the pre-round board). Implied by the rows in COUNTER-TRUTH; said
    // out loud here, so a future round cannot quietly make it guard-conditional.
    const w = fixtureWorld()
    const c: Combo = { ...shipped(), mode: 'off' }
    const on = door(w, c, maskOf(w, c))
    const by = groupsOf(on)
    // Nothing is held and nothing is withheld…
    expect(by.reserved).toBe(0)
    expect(on.reserved).toHaveLength(0)
    expect(on.sell.cells.some(isHeldBound)).toBe(false)
    // …the other three kinds are all still counted…
    expect(by.packed + by.gap).toBeGreaterThan(0)
    expect(on.online.total).toBe(by.sell + by.packed + by.gap)
    // …and the number is therefore NOT canon's sell-only one, which is the
    // ruling arriving at a store that never turned the guard on.
    expect(on.online.total).toBeGreaterThan(on.sellDrawn.staffBands.length)
    expect(on.sellDrawn.chipLabel.startsWith(`オンライン販売中 ${on.sellDrawn.staffBands.length}窓`)).toBe(true)
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
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F3, blind-final L1#2):
    // the filter was half of its own rule. A locked lane was dropped; a lane
    // with no LIST PRICE was not, and `sellStaffLanes` refuses that lane just as
    // flatly — so the board drew a 確保 chip, and counted a window, on a row
    // whose sub-line said 「オンラインで新規のお客様に販売中」 about nothing that
    // was for sale. `heldDrawnFor` is the one spelling: it asks the sell door
    // which lanes it would sell from at all.
    expect(screen).toContain('heldDrawnFor(heldCommitted, committedLanes, locked)')
    expect(screen).toContain('new Map(heldDrawn.map((m) => [m.laneKey, m.spans]))')
    // …and the counter counts that same set, so the chips and the number can
    // never disagree about how many windows the store is holding.
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F4, L1#4 ≡ L2#8): the
    // counter takes §4.5's EMISSION over that set rather than the set itself —
    // one home for the reserved kind, and it is the home the screen reads.
    expect(screen).toContain('reserved: reservedOffersFor(heldDrawn),')
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
    // button dress. The chip's press is the law's own sentence — composed in
    // `releaseAsk`, which is where E5 hung ruling Q5's manager action beside it
    // (§6 below pins both halves).
    expect(SRC('TodayScreen.tsx')).toContain('onClick={() => releaseAsk(lane.key, h)}')
    expect(SRC('TodayScreen.tsx')).toContain('const law = reservedSentence(span.start, span.end)')
  })

  it('⚖ 8/23 guided-tour law — the chip registers itself, ONCE', () => {
    const screen = SRC('TodayScreen.tsx')
    expect(screen).toContain('data-guide-title={firstHeldLane === lane.key && h === heldHere[0] ? \'新規用に確保\' : undefined}')
    // ⚖ PKT-E4 §3 rider — the native pass's rewrite, adopted verbatim (8/31).
    expect(screen).toContain('新規のお客様のために空けている時間です。押すと、確保している理由と販売に戻る条件が表示されます。')
    // One entry for a section that repeats down the board — the placement
    // strip's own rule, so the walk does not gain a step per staff member.
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F9, blind-final
    // L2#10): the lane is chosen out of the lanes the board is WALKING, in the
    // board's own order, rather than out of the mask — a mask-order pick can
    // name a lane `view`/`collapsed` filtered out, and then the 8/23 law's entry
    // exists on no DOM node while other chips are on screen. Same rule, same one
    // entry; the `locked` half is gone because `heldDrawn` has already dropped
    // those lanes (`heldDrawnFor`, one spelling).
    expect(screen).toContain("const firstHeldLane = drawnLanes.find(")
    expect(screen).toContain("(l) => l.group === 'staff' && laneRendered(l) && (heldDrawnByLane.get(l.key)?.length ?? 0) > 0,")
    // …and the renderer asks the very same question, once, by name.
    expect(screen).toContain('if (!laneRendered(lane)) return null')
    // …and the counter's own entry moved with ⚖ Q3's definition.
    expect(screen).toContain('data-guide="いまReserveで販売中の枠数。販売可能枠・詰め込み・スキマ枠・新規用に確保をまとめた数です。')
  })
})

// ── 6 · THE MANAGER'S RELEASE (E5, ⚖ ruling Q5) ─────────────────────────────

/** ⚖ SPEC-SELLING-ENGINE §1's Release clause, MANUAL half — the last ruled
 *  piece of the law, end to end on the fixture at the store's shipped dials.
 *  §2 above pinned the two ごろう endings the LAW produces; this is the third,
 *  the one a manager produces on purpose. */
describe('6 — a manager releases ごろう’s held window, and the board re-derives', () => {
  const GORO = 'p-05'

  const scene = () => {
    const w = fixtureWorld()
    const c = shipped()
    const book = bookOf(w)
    const before = maskOf(w, c, book)
    const window = before.find((m) => m.laneKey === GORO)!.spans[0]
    // ⚖ FIX ROUND F2 — a release names the BOARD it was pressed on as well as
    // the window; this scene is one board, so the stamp is a constant here and
    // the day/store scoping is proven on its own in §7.
    const released: ReleasedWindow[] = [{ laneKey: GORO, windowStart: window.windowStart, dayOffset: 0, store: STORE_A }]
    return { w, c, book, before, window, released, after: maskOf(w, c, book, released) }
  }

  const bandsOf = (d: Door, laneKey: string) => d.sellDrawn.staffBands.filter((b) => b.laneKey === laneKey)
  const rowsOf = (d: Door, kind: string) => d.online.groups.find((g) => g.kind === kind)?.rows ?? []

  /** The scene, written out — the same discipline the three artifacts below
   *  follow: a claim a reader can check without running the suite. */
  afterAll(() => {
    const dir = process.env.E5_EVIDENCE_DIR ?? ''
    if (!dir) return
    const { w, c, before, after, window } = scene()
    const held = door(w, c, before)
    const freed = door(w, c, after)
    const kinds = (d: Door) => d.online.groups.map((g) => `${g.label}=${g.rows.length}`).join(' · ')
    const cells = (d: Door) =>
      d.sellDrawn.cells.filter((x) => x.group === 'staff' && x.laneKey === GORO).map((x) => `${hhmm(x.h)} ${x.resourceKey} ¥${x.price}`).sort().join(', ')
    const spansOf = (masks: readonly ReservedLaneMask[]) =>
      masks.filter((m) => m.spans.length > 0).map((m) => `${m.laneKey} ${m.spans.map((s) => span(s.start, s.end)).join(',')}`).join(' | ')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `RELEASE-SCENE-${process.env.E5_SHA ?? 'unstamped'}.txt`),
      [
        '# RELEASE-SCENE — ⚖ ruling Q5’s manual release, on the fixture at the store’s shipped dials',
        `# tip: ${process.env.E5_SHA ?? 'unstamped'}`,
        `# released: ${GORO} (見本 ごろう) windowStart=${window.windowStart} (${span(window.start, window.end)})`,
        '#',
        `held  spans   ${spansOf(before)}`,
        `freed spans   ${spansOf(after)}`,
        '#',
        `held  ${GORO} sell   ${cells(held)}`,
        `freed ${GORO} sell   ${cells(freed)}`,
        `held  ${GORO} band   ${bandsOf(held, GORO).map((b) => `${hhmm(b.hStart)}-${hhmm(b.hEnd)} ¥${b.lo}-¥${b.hi}`).join(', ')}`,
        `freed ${GORO} band   ${bandsOf(freed, GORO).map((b) => `${hhmm(b.hStart)}-${hhmm(b.hEnd)} ¥${b.lo}-¥${b.hi}`).join(', ')}`,
        '#',
        `held  counter   ${held.online.total}窓 — ${kinds(held)}`,
        `freed counter   ${freed.online.total}窓 — ${kinds(freed)}`,
        '#',
        '# THE ORDERING CLAIM, written out: every lane the release did not name has',
        '# byte-identical spans above, because the guard enumerated the whole board',
        '# BEFORE the subtraction ran. A release changes what is HELD, never what is',
        '# FORMABLE.',
      ].join('\n'),
    )
  })

  it('the chip is gone, and its hours publish at full price', () => {
    const { w, c, before, window, after } = scene()
    // §2's own scene: ごろう is held 14:30–16:00, the one window on that lane.
    expect(span(window.start, window.end)).toBe('14:30-16:00')
    expect(after.find((m) => m.laneKey === GORO)!.spans).toEqual([])
    expect(after.find((m) => m.laneKey === GORO)!.protectedCount).toBe(0)

    const held = door(w, c, before)
    const freed = door(w, c, after)
    // THE 15:00 HOUR COMES BACK. It was derived all along (the law withheld it
    // from the published layer, §4.2 Q4); the release publishes it — at FULL
    // price, on the same bed, because a released window is ordinary stock and
    // not a discount.
    const cellsOn = (d: Door) =>
      d.sellDrawn.cells.filter((x) => x.group === 'staff' && x.laneKey === GORO).map((x) => `${hhmm(x.h)} ${x.resourceKey} ¥${x.price}`).sort()
    expect(cellsOn(held)).toEqual(['16:00 bed-02 ¥9220'])
    expect(cellsOn(freed)).toEqual(['15:00 bed-02 ¥8810', '16:00 bed-02 ¥9220'])
    // …and the BAND the sales door publishes grows to cover it rather than a
    // second band appearing beside it: one offer per span, still.
    expect(bandsOf(held, GORO).map((b) => [b.hStart, b.hEnd, b.lo, b.hi])).toEqual([[960, 1020, 9220, 9220]])
    expect(bandsOf(freed, GORO).map((b) => [b.hStart, b.hEnd, b.lo, b.hi])).toEqual([[900, 1020, 8810, 9220]])
    // The release buys the store an hour it could not sell a minute earlier —
    // TWO cells for the one offer, because a staff hour paints on its own row
    // and on its bed's (one offer, one staff lane key, two emissions: the same
    // pair §3's rank-dial pin counts on).
    expect(freed.sellDrawn.cells.length).toBe(held.sellDrawn.cells.length + 2)
    expect(freed.sellDrawn.cells.filter((x) => x.laneKey === GORO && x.h === 900)).toHaveLength(2)
  })

  it('the OTHER held windows are byte-identical — the release changes what is HELD, not what is FORMABLE', () => {
    const { before, after } = scene()
    // ⚠ THE ORDERING PIN. The greedy enumerated the whole board first and the
    // subtraction ran after it, so releasing ごろう's window left every other
    // lane's spans exactly where the guard put them. (The mutant that feeds a
    // release back into the pockets is caught by reserved-mask.test.ts §8 —
    // see its header for what E5's mutation run actually measured.)
    for (const m of after.filter((x) => x.laneKey !== GORO)) {
      expect(JSON.stringify(m)).toBe(JSON.stringify(before.find((b) => b.laneKey === m.laneKey)))
    }
    // Three neighbours, really there — an empty loop would prove nothing.
    expect(after.filter((m) => m.laneKey !== GORO && m.spans.length > 0)).toHaveLength(3)
  })

  it('the counter tells the truth about it: 確保 −1, and no other kind moves a row', () => {
    const { w, c, before, after } = scene()
    const held = door(w, c, before)
    const freed = door(w, c, after)
    expect(rowsOf(held, 'reserved')).toHaveLength(4)
    expect(rowsOf(freed, 'reserved')).toHaveLength(3)
    expect(rowsOf(freed, 'reserved').some((r) => r.laneKey === GORO)).toBe(false)
    // ⚖ Q3's one number counts what is purchasable online, so it falls by the
    // one window that stopped being a 新規-only offer — and the hour it freed
    // joined a band that was already counted, which is why the total moves by
    // exactly one and not by two.
    expect([held.online.total, freed.online.total]).toEqual([9, 8])
    // The other three kinds are the same rows, to the byte: nothing re-bedded,
    // nothing re-priced, no fragment appeared or vanished on the rebound.
    for (const kind of ['packed', 'gap']) {
      expect(JSON.stringify(rowsOf(freed, kind))).toBe(JSON.stringify(rowsOf(held, kind)))
    }
    expect(freed.drops.filter((d) => d.laneKey === GORO)).toEqual([])
    // The sell group keeps its ONE row and that row grew, which is the honest
    // shape of the change (a wider band, not a second offer).
    expect(rowsOf(freed, 'sell')).toHaveLength(1)
    expect([rowsOf(held, 'sell')[0].start, rowsOf(freed, 'sell')[0].start]).toEqual([960, 900])
  })

  it('the ROLE GATE — a manager sees the action, a staff member sees the law alone', () => {
    // Both directions, on the predicate itself, at the store's own list.
    expect(canReleaseHeld(opsConfig.releaseHeldRoles, { role: '店舗管理者' })).toBe(true)
    expect(canReleaseHeld(opsConfig.releaseHeldRoles, { role: 'オーナー' })).toBe(true)
    expect(canReleaseHeld(opsConfig.releaseHeldRoles, { role: 'スタッフ' })).toBe(false)
    // ⚠SETTINGS-BATCH — the authority is DATA. The board and its interactions
    // never spell a role; the store's list does, and the settings round gives it
    // a control. (The same law the override dial is pinned to.)
    expect(SRC('TodayScreen.tsx')).not.toContain('店舗管理者')
    expect(SRC('today-interactions.ts')).not.toContain('店舗管理者')
    // …and it is NOT the override dial: the shipped override default lets
    // スタッフ place over a 置けない, and that must not buy them a release.
    expect(opsConfig.overridePolicy.roles).toContain('スタッフ')
    expect(opsConfig.releaseHeldRoles).not.toContain('スタッフ')
  })

  it('the board asks the gate ONCE, on the server’s answer, and the staff branch is E3b unchanged', () => {
    const screen = SRC('TodayScreen.tsx')
    // One consumption, like `canOverride` — a second gate elsewhere would split
    // the authority across two lines.
    expect(screen.match(/props\.canReleaseHeld/g)).toHaveLength(1)
    expect(screen).toContain('if (!props.canReleaseHeld) {\n      show(law)\n      return\n    }')
    // The manager's action is the board's EXISTING confirm-with-one-action
    // surface (the toast that already carries the block delete's undo) — no new
    // dialog system, ⚖ PKT-E5.
    expect(screen).toContain("label: 'この確保を解除して販売に出す',")
    expect(screen).toContain("show('確保を解除しました。再読み込みすると戻ります')")
    // The write is SESSION-LOCAL, like every write on this fixture-sealed board,
    // and the toast says so in the standing words.
    expect(screen).toContain('const [released, setReleased] = useState<readonly ReleasedWindow[]>([])')
    // ⚖ THE LOG, priced honestly — §7(a)'s own wording, at the write site.
    expect(screen).toContain('⚠ RECONNECT')
    // ONE FACT, TWO SNAPSHOTS: both world instances take the same list.
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F2, L1#3 ≡ L2#2): the
    // list both doors receive is the BOARD-SCOPED one. Still one fact and two
    // snapshots — what changed is that the fact now names the board it is true
    // of, so a release cannot travel to tomorrow or to the other store.
    expect(screen.match(/^ {12}released: releasedHere,$/gm)).toHaveLength(2)
    expect(screen).toContain('const releasedHere = useMemo(\n    () => released.filter((r) => onShownBoard(r, board)),')
  })
})

// ── 7 · THE FIX ROUND (F1–F11, blind-final ADJUDICATION 2026-08-31) ─────────

/** The final blind round read this branch with five lenses and found the law
 *  sound and its PUBLICATION BOUNDARY leaky: one surface still reading the
 *  pre-withholding layer, the mask published on lanes that can never sell, a
 *  manager's release escaping its own board, two emission homes for one kind,
 *  two worlds mixed inside one call, and the override door shut over exactly the
 *  spans the dial exists for. Every fix below carries the lens's own repro as
 *  its red case — asserted BOTH ways where the old wiring can still be spelled,
 *  so nothing here is a test that would have passed before. */
describe('7 — the fix round: the publication boundary', () => {
  const PROTECTED = 90
  const LANE = 'p-01'
  const BED = 'bed-01'

  /** ⚖ F1's SCENE, the blind round's own: a 150-minute pocket at 10:00 on a
   *  60-minute grid, holding ONE 90-minute 新規 window at its head.
   *
   *  The arithmetic is the whole finding. The window is 10:00–11:30. The sale
   *  withheld is every 60-minute SLOT that OVERLAPS it — 10:00 AND 11:00 — so
   *  the board stops drawing 10:00–12:00 while the chip covers 10:00–11:30. The
   *  hour from 11:30 is blank track: no box, no chip, no name tag. The rail chip
   *  over it said ✓ and nothing else, because the invisible 11:00 cell still
   *  satisfied `advertised`. Flag 44's own defect, re-created by the fix for its
   *  sibling.
   *
   *  WHY THE STORE'S 最小販売枠 FLOOR IS 90 HERE, and it is not a thumb on the
   *  scale: at the fixture's own 30-minute floor the gap layer fills the
   *  remainder with a スキマ枠 and the stretch is not blank at all — which is the
   *  board working, and it is why this defect is invisible on the fixture. The
   *  floor is a per-store dial; a store whose floor is longer than the remainder
   *  gets no box, and then the only thing that can explain the emptiness is the
   *  law. Measured, not assumed: the assertions below read the layers.
   *
   *  Not on the fixture at all: its six lanes make no pocket of this shape,
   *  which is exactly why the lens had to build one. */
  const boundaryWorld = (): World => ({
    name: 'F1 boundary pocket',
    lanes: [
      lane({
        key: LANE,
        group: 'staff',
        label: '見本 01',
        items: [
          item({ key: 'a', kind: 'booking', startMin: 540, endMin: 600 }),
          item({ key: 'b', kind: 'booking', startMin: 750, endMin: 1080 }),
        ],
      }),
      lane({ key: BED, group: 'beds', label: 'ベッド1', roomClass: 'standard', items: [] }),
    ],
    hours: SYNTH_HOURS,
    now: null,
    rooms: REAL.rooms,
    cleanup: { [BED]: 0 },
    minSellableMin: 90,
  })

  const lawCombo = (): Combo => ({
    gridMin: 60,
    sessionMin: REAL.guard.standardSessionMin,
    gapFillMin: REAL.guard.gapFillMinMin,
    protectedMin: PROTECTED,
    mode: 'standard',
    axis: 'law',
  })

  it('F1 — the boundary stub: the law explains exactly what it took, and the ✓ over nothing is gone', () => {
    const w = boundaryWorld()
    const c = lawCombo()
    const book = bookOf(w)
    const held = maskOf(w, c, book)
    const on = door(w, c, held)

    // The scene is the one the finding describes, measured rather than assumed:
    // ONE held window at 10:00–11:30…
    const spans = held.find((m) => m.laneKey === LANE)!.spans
    expect(spans.map((s) => span(s.start, s.end))).toEqual(['10:00-11:30'])
    // …and TWO withheld hours, 10:00 and 11:00: 120 minutes of sale taken for a
    // 90-minute hold. That difference is the gap the chip cannot cover.
    const withheld = on.sell.cells.filter(isHeldBound)
    expect(withheld.filter((s) => s.group === 'staff').map((s) => hhmm(s.h))).toEqual(['10:00', '11:00'])
    // …and the board really does draw NOTHING there: no published sell hour and
    // no gap box either, so 11:30–12:30 is empty track under a ✓.
    expect(on.sellDrawn.cells.filter((s) => s.laneKey === LANE && s.group === 'staff')).toEqual([])
    expect(on.drawnClaims.filter((g) => g.laneKey === LANE)).toEqual([])

    const rs = railsOf(w, c, book)
    // The 11:30 chip is CLEAN — this is a ✓ over nothing, not a refusal that was
    // going to say something anyway.
    expect(rs.find((r) => r.laneKey === LANE)!.cells.find((cell) => cell.start === 690)!.state).toBe('safe')
    const sentenceAt = (sellCells: typeof on.sell.cells, withheldCells?: typeof withheld) =>
      explainRails(rs, w.lanes, {
        dur: REAL.guard.standardSessionMin,
        handId: null,
        rooms: w.rooms,
        stagedId: null,
        sellCells,
        claims: on.drawnClaims,
        drops: on.drops,
        inHand: false,
        sellDisplayed: true,
        held,
        withheld: withheldCells,
      })
        .get(LANE)!
        .get(690)!.sentence

    // RED — the wiring the blind round found. 11:30 is blank track under a ✓
    // that explains nothing: no 確保 clause (the SPAN ended at 11:30) and no
    // 「販売可能枠が出ていません」 either, because the withheld 11:00 cell is in
    // the derivation this call was handed and made the start 「advertised」.
    const before = sentenceAt(on.sell.cells, undefined)
    expect(before).not.toContain('確保しています')
    expect(before).not.toContain('販売可能枠が出ていません')

    // HALF A alone — reading the PUBLISHED layer makes the emptiness sayable,
    // and 75(i) says it. True, and the wrong cause: the store's own rule emptied
    // this stretch, not an absent derivation. This is why F1 has two halves.
    expect(sentenceAt(on.sellDrawn.cells, undefined)).toContain('この開始には販売可能枠が出ていません')

    // GREEN — both halves. The clause covers the extent the predicate took, and
    // it still quotes the SPAN's own duration, because the dial is the span's.
    const after = sentenceAt(on.sellDrawn.cells, withheld)
    expect(after).toContain(reservedClause(PROTECTED))
    expect(after).not.toContain('販売可能枠が出ていません')

    // …and the widening is BOUNDED by the withholding: a start whose window
    // clears the last withheld slot hears nothing about the law.
    const whole = explainRails(rs, w.lanes, {
      dur: REAL.guard.standardSessionMin,
      handId: null,
      rooms: w.rooms,
      stagedId: null,
      sellCells: on.sellDrawn.cells,
      claims: on.drawnClaims,
      drops: on.drops,
      inHand: false,
      sellDisplayed: true,
      held,
      withheld,
    }).get(LANE)!
    for (const [start, e] of whole) {
      if (start >= 720 || start + REAL.guard.standardSessionMin <= 600) {
        expect({ at: hhmm(start), law: e.sentence.includes('確保しています') }).toEqual({ at: hhmm(start), law: false })
      }
    }
  })

  it('F1 — and the screen is wired that way: the published layer, and what it withheld', () => {
    const screen = SRC('TodayScreen.tsx')
    expect(screen).toContain('sellCells: sellDrawn.cells,')
    expect(screen).toContain('withheld: sell.cells.filter(isHeldBound),')
    // The DERIVATION still exists and is still what the fallback's survivor set
    // reads — the two inputs above are two halves of one fact, not two worlds.
    expect(screen).toContain('survivors: sell.cells,')
  })

  /** ⚖ F2 — the release that escaped its own board. */
  it('F2 — a release names the board it was pressed on, and reaches no other', () => {
    const w = fixtureWorld()
    const c = shipped()
    const book = bookOf(w)
    const before = maskOf(w, c, book)
    const pick = before.find((m) => m.spans.length > 0)!
    const today = { dayOffset: 0, store: STORE_A }
    const release: ReleasedWindow = { laneKey: pick.laneKey, windowStart: pick.spans[0].windowStart, ...today }

    // The stamp is the ⚖ 22 / ⚖ 46 pair, compared by the board's own predicate.
    expect(onShownBoard(release, today)).toBe(true)
    expect(onShownBoard(release, { dayOffset: 1, store: STORE_A })).toBe(false)
    expect(onShownBoard(release, { dayOffset: 0, store: 'store-b' })).toBe(false)

    // A staff lane's key is the staff member's id and `windowStart` a minute of
    // the day, so the UNSCOPED list — the one that shipped — releases this
    // window on every board the person appears on. That is the finding.
    const startsOn = (masks: readonly ReservedLaneMask[]) =>
      masks.find((m) => m.laneKey === pick.laneKey)!.spans.map((s) => s.windowStart)
    expect(startsOn(maskOf(w, c, book, [release]))).not.toContain(release.windowStart)

    // SCOPED — the screen's own filter, applied to the same fact. On the board
    // it was pressed on the window is released; on tomorrow's, and on the other
    // store's, the mask is byte-identical to the untouched one.
    const scoped = (shown: { dayOffset: number; store: string | null }) =>
      maskOf(w, c, book, [release].filter((r) => onShownBoard(r, shown)))
    expect(startsOn(scoped(today))).not.toContain(release.windowStart)
    for (const elsewhere of [{ dayOffset: 1, store: STORE_A }, { dayOffset: 0, store: 'store-b' }]) {
      expect(JSON.stringify(scoped(elsewhere))).toBe(JSON.stringify(before))
    }
  })

  /** ⚖ F3 — a lane that sells nothing online, wearing a 確保 chip. */
  const pricelessWorld = (): World => {
    const w = boundaryWorld()
    return { ...w, name: 'F3 price-less lane', lanes: [lane({ ...w.lanes[0], listPrice: 0 }), w.lanes[1]] }
  }

  it('F3 — the mask is published only on lanes the SELL door would sell from', () => {
    const w = pricelessWorld()
    const c = lawCombo()
    const held = maskOf(w, c)

    // `listPrice` is `staffListPrice[member.id] ?? 0` on the real board, so this
    // is a member a manager added without setting a price — not an exotic case.
    expect(w.lanes[0].listPrice).toBe(0)
    // The MASK is unchanged: the guard protects placements whatever a lane
    // charges, and the staff door reads this set whole (that asymmetry is the
    // law — `heldBoard` is deliberately not filtered).
    expect(held.find((m) => m.laneKey === LANE)!.spans.length).toBeGreaterThan(0)
    // …and the SELL door refuses the lane outright, so it has no sell layer and
    // no gap layer at all.
    expect(sellStaffLanes(w.lanes, []).map((l) => l.key)).not.toContain(LANE)
    expect(door(w, c, held).sellDrawn.cells).toEqual([])

    // RED — the filter that shipped tested only `locked`, so the chip stood, and
    // the counter counted, on a row that is not for sale to anybody.
    expect(held.filter((m) => !([] as string[]).includes(m.laneKey)).map((m) => m.laneKey)).toContain(LANE)
    // GREEN — one spelling, asked of the sell door itself.
    expect(heldDrawnFor(held, w.lanes, []).map((m) => m.laneKey)).not.toContain(LANE)
    // …and the locked half is the same answer through the same door.
    expect(heldDrawnFor(maskOf(boundaryWorld(), c), boundaryWorld().lanes, [LANE]).map((m) => m.laneKey)).not.toContain(LANE)
    expect(heldDrawnFor(maskOf(boundaryWorld(), c), boundaryWorld().lanes, []).map((m) => m.laneKey)).toContain(LANE)
  })

  it('F4 — ONE emission home for the reserved kind, and it is the one the counter reads', () => {
    const w = pricelessWorld()
    const c = lawCombo()
    const held = maskOf(w, c)
    const on = door(w, c, held)

    // The two homes disagreed by exactly this set: the dead `salesDoor.reserved`
    // was built from the mask BEFORE publication, the counter's own rows from
    // after it. On this board that is one window against none.
    expect(reservedOffersFor(held)).toHaveLength(1)
    expect(on.reserved).toHaveLength(0)
    // The counter's rows ARE the emission, object for object — no second builder.
    const rows = on.online.groups.find((g) => g.kind === 'reserved')!.rows
    expect(rows.map((r) => `${r.laneKey}@${r.start}`)).toEqual(on.reserved.map((o) => `${o.laneKey}@${o.start}`))
    // …and on a board where the lane CAN sell, the same chain carries the window
    // all the way to the row (so the assertion above is not vacuously empty).
    const sellable = door(boundaryWorld(), c, maskOf(boundaryWorld(), c))
    expect(sellable.reserved).toHaveLength(1)
    expect(sellable.online.groups.find((g) => g.kind === 'reserved')!.rows).toHaveLength(1)

    // …and the dead field is gone from the screen rather than left computing:
    // exactly one CALL, and it is the counter's.
    const screen = SRC('TodayScreen.tsx')
    expect(screen).not.toContain('reserved: reservedOffersFor(heldCommitted),')
    expect(screen.match(/^ +reserved: reservedOffersFor\(heldDrawn\),$/gm)).toHaveLength(1)
    expect(screen.match(/^ +[a-zA-Z]*:? ?reservedOffersFor\(/gm)).toHaveLength(1)
  })

  it('F5 — the rest cue is told the world the chip is drawn from', () => {
    // The exact artifact, at the helper: a start whose chip wears a word, no box
    // over it, and a 確保 chip covering it in the COMMITTED world. Fed the
    // committed spans the cue stands down; fed the BOARD world's — which
    // diverges mid-gesture whenever a drag writes `live` with nothing in hand —
    // it paints a quarter-strength 清掃 hatch under the chip, which is flag 88's
    // artifact one layer along.
    const worded = new Map([[600, { word: '新規用' }]])
    const committed = [{ start: 600, end: 690, windowStart: 600 }]
    expect(restCueStarts(worded, [], [], committed)).toEqual([])
    expect(restCueStarts(worded, [], [], [])).toEqual([600])
    // The screen hands it `heldHere`, which is the committed list the chip on
    // the line above is drawn from…
    const screen = SRC('TodayScreen.tsx')
    expect(screen).toContain('restCueStarts(explainedHere, cells, gapHere, heldHere)')
    // …and the board world's per-lane index is GONE, not merely unused: a second
    // held index on this screen is how the two worlds get mixed again.
    expect(screen).not.toContain('heldByLane')
  })

  it('F6 — 配置モード reaches through the chip, and the chip keeps its press at rest', () => {
    const css = readFileSync(join(process.cwd(), HERE, 'today.css'), 'utf8')
    const screen = SRC('TodayScreen.tsx')
    // The refusal the dial exists for is REACHABLE over a held span now. Every
    // other layer on this track is `pointer-events: none`, so 配置モード's
    // landing and 新規予約を作成 both run on the TRACK's own click — and the
    // click returns unless the track is the target.
    expect(screen).toContain('if (e.target !== e.currentTarget || dragRef.current || blockDragRef.current) return')
    expect(css).toContain('.biz .timeline.placing .cell-held,\n.biz .timeline.dragging-live .cell-held { pointer-events: none; }')
    // Both classes are ones the screen already sets — no new switch.
    expect(screen).toContain("placing ? 'placing' : ''")
    expect(screen).toContain("dragLen != null || live || blockLive ? 'dragging-live' : ''")
    // AT REST the press is untouched: §9's ruled behaviour, and the only thing
    // that says the law out loud on this row.
    const rule = css.slice(css.indexOf('.biz .cell-held {'), css.indexOf('.biz .cell-held .held-title'))
    expect(rule).not.toContain('pointer-events')
    expect(screen).toContain('onClick={() => releaseAsk(lane.key, h)}')
  })

  it('F7 — the header chip names its kind, so the board carries ONE total', () => {
    const screen = SRC('TodayScreen.tsx')
    // ⚖ Q3's one number is the board head's. This chip counts one of its four
    // kinds and now says which, in the board's own 案C word — the same word its
    // group wears in the press-open breakdown.
    expect(screen).toContain('公開中の販売可能枠 {sellDrawn.staffBands.length}枠')
    expect(screen).not.toContain('>公開中 {')
    const w = fixtureWorld()
    const on = door(w, shipped(), maskOf(w, shipped()))
    expect(on.online.groups.find((g) => g.kind === 'sell')!.label).toBe('販売可能枠')
    // The number and its layer are untouched — this fix is the WORD.
    expect(on.online.groups.find((g) => g.kind === 'sell')!.rows).toHaveLength(on.sellDrawn.staffBands.length)
  })

  it('F8 — a 新規用に確保 row says why it has no price', () => {
    const w = fixtureWorld()
    const on = door(w, shipped(), maskOf(w, shipped()))
    const rows = on.online.groups.find((g) => g.kind === 'reserved')!.rows
    expect(rows.length).toBeGreaterThan(0)
    // Priced at take, out of the store's own session price — `ReservedOffer`
    // carries no price on purpose, so the ROW has to say so rather than end bare
    // in a list where every other row ends in a price or in 価格未設定.
    for (const r of rows) expect({ lo: r.lo, hi: r.hi }).toEqual({ lo: null, hi: null })
    expect(SRC('TodayScreen.tsx')).toContain("g.kind === 'reserved' ? ' · 価格は予約時に決定' : ' · 価格未設定'")
  })

  it('F9 — the tour step registers on a lane that is on screen, and the action is reachable', () => {
    const screen = SRC('TodayScreen.tsx')
    // The registration and the renderer ask ONE question about whether a lane is
    // on the board, so a ベッド view or a collapsed スタッフ group can no longer
    // leave the 8/23 entry on no DOM node at all.
    expect(screen).toContain("(view === 'both' || view === lane.group) && !collapsed.includes(lane.group)")
    expect(screen).toContain('if (!laneRendered(lane)) return null')
    expect(screen).toContain('laneRendered(l) && (heldDrawnByLane.get(l.key)?.length ?? 0) > 0')
    // …and the toast's one action slot is navigated rather than announced: since
    // E5 it can carry a COMMIT, and a button inside a live region is one a
    // screen-reader user hears about rather than reaches.
    expect(screen).toContain('<button className="toast-undo" type="button" aria-live="off"')
    // The dwell is the standing one for both callers — ⚖ 47, unchanged.
    expect(screen.match(/show\([^)]*REFUSAL_MS, \{/g)).toHaveLength(2)
  })

  it('F11 — §7(a)’s override log hook exists at the verdict site, beside the release’s', () => {
    const screen = SRC('TodayScreen.tsx')
    // §7(a): 「The build ships the log hook at the verdict site; the REAL audit
    // write lands with the board's real-data reconnection and is named on the
    // RECONNECT registry now.」 E5 built it for ⚖ Q5's release and nobody built
    // it for the ordinary staff placement override — level (a), the default
    // every store ships with — and no step audit caught the miss.
    expect(screen.match(/⚠ RECONNECT/g)).toHaveLength(2)
    // It sits on the CHOKEPOINT: all four override paths (the drop's `land`, the
    // nudge's `land`, 配置モード and the shelf chip through `askGuard`) hand
    // their commit in as `run.override`, and this is where the press reaches it.
    const hook = screen.indexOf('§7(a)')
    expect(hook).toBeGreaterThan(-1)
    expect(screen.indexOf("override: props.canOverride && escalate && v.floor === 'policy'")).toBeGreaterThan(hook)
    expect(screen.slice(hook, hook + 1400)).toContain('⚠ RECONNECT')
    // …and it is representational, exactly as the release's is: no audit write
    // is reachable from this fixture-sealed board, and nothing pretends one is.
    expect(screen).not.toMatch(/\baudit(Write|Log)\(|\btrack\(|\btelemetry\b/)
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
      '#  (iv)  reserved offers ≡ held windows, one per window, naming it — and',
      '#        ⚖ FIX ROUND F4: the windows are the PUBLISHED ones and the offers',
      '#        are the ones the COUNTER shows. It used to be asserted over a',
      '#        `salesDoor.reserved` field with no reader on the screen at all,',
      '#        while the counter built reserved rows from a second inline builder',
      '#        fed the published mask — so the invariant was true of a dead path',
      '#        and silent about the number the operator reads. One emission home',
      '#        now: mask → publication → `reservedOffersFor` → counter, asserted',
      '#        end to end on every row.',
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
      '#',
      '# ⚖ FIX ROUND F10 — AND THAT LAST SENTENCE IS NOW AN ASSERTION, not a note.',
      '# The blind round (L1#6, counter half) found the guard-OFF consequence of ⚖',
      '# Q3 stated nowhere: the rows above record 11 against 12 across the dial and',
      '# never against the PRE-ROUND board, so a reader could take the four-kind',
      '# definition for something the guard switches on. It is not. Q3 is a',
      '# truth-fix about what 「on sale online」 MEANS, and it is unconditional — a',
      '# store that never turned the guard on has no held windows, no withholding,',
      '# and a counter that still counts 詰め込み and スキマ枠 because a customer',
      '# can buy them. Asserted in §3 (「the four-kind definition applies with the',
      '# guard OFF too」): reserved = 0, withheld = none, total = sell + packed +',
      '# gap, and total > canon\u2019s own sell-only chipLabel. A future round cannot',
      '# make the definition guard-conditional without turning that test red.',
      '#',
      '# ⚠ NOT THE SAME QUESTION AS dev-4, which stays OPEN for Liam: dev-4 is',
      '# whether the §5 FALLBACK should fire on a guard-off store (¥9,020 of',
      '# fragments it does not have today). This is about the COUNTER\u2019S',
      '# DEFINITION, which ⚖ Q3 already ruled. Two dials, two questions; the',
      '# artifact says both so neither rides under the other.',
    ])
  })
})
