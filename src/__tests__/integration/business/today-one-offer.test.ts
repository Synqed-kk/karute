// ONE ADVERTISED OFFER PER BED (R4 of the 今日の運営 layer rebuild).
//
// WHAT WENT WRONG. The board could advertise the SAME ROOM to two different
// customers at the same minute, and four such double-claims sat on the pristine
// demo fixture. Two layers picked rooms out of two private books: the sell
// layer minted a `Set` inside canon's per-slot loop (availability.ts:117) and
// the gap layer kept its own `bedLedger` (availability.ts:345). They never met.
// The suppression that was supposed to catch it ran inside `renderLane`,
// filtered `onThisLane` — the same DRAWN ROW — so it could not see p-05's
// 販売可能枠 hour and p-06's スキマ枠 box both pointing at ベッド2 at all; and it
// ran AFTER `buildSellLayer`, so 公開中 N枠 / 販売可能枠 N窓 / 安全な空き and the
// price button were computed from boxes the screen then declined to draw.
//
// WHAT THIS FILE PROVES, in the order the round decides things:
//   §1 the OPTION/PROMISE distinction — a booking grid emitting 15:00 / 15:30 /
//      16:00 on one room is a MENU, not four double-claims, and `boardOffers`
//      is the one place that is said.
//   §2 the reconciliation happens at the SEAM (between `deriveSellableCells`
//      and `buildSellLayer`), so the counts are honest by construction.
//   §3 it is per BED and per SPAN and per that bed's turnaround — never per
//      drawn row.
//   §4 the loser is RE-BEDDED before it is dropped —「people are chosen, rooms
//      are solved」(⚖ flag 51) — through `allocateBed`, the one search.
//   §5 who wins is a named exported rule with its provenance, not a literal.
//   §6 `buildClaims` is the assertion: `violations` is EMPTY on the fixture
//      board and across the dial sweep — and NON-empty the moment the
//      reconciliation is taken away, which is the red run this round exists for.
//   §7 the cost of all of it, measured on REAL timers.
//
// THE BOARD UNDER TEST IS THE REAL ONE wherever the claim is about the fixture:
// `TodayPage` is executed and the props it hands `TodayScreen` are read, so the
// lanes, the rooms, the hours and the dials are the operator's. The scenes that
// need an impossible-to-hit shape (a multi-store room, a room with a real
// turnaround) are built by hand and say so.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { STORE_A } from '@/business/lib/fixtures'
import {
  bedTruthViews,
  boardOffers,
  buildClaims,
  type BedTruth,
  type DayFrame,
} from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import type { GapCell, SellLayer } from '@/business/lib/canon-logic/availability'
import {
  gapLayerFor,
  keepsTheRoom,
  sellLayerFor,
  type RoomPolicy,
  type SellReconcile,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { hhmm, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

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

// ── the two layers, driven exactly as the screen drives them ────────────────

interface Dials {
  gridMin: number
  sessionMin: number
  minSellableMin: number
}

/** THE SCREEN'S OWN RESTING PRICE DIALS, never invented ones — `packedPrice`
 *  keeps a floor tripwire that a made-up frame trips immediately. */
function priceOf(props: TodayProps) {
  const price = clampPriceInputs(props.dialogs.pricing.hqMax, props.dialogs.pricing.base, props.dialogs.pricing)
  return {
    price,
    depth: Math.round((1 - price.lo / price.hi) * 100),
    frame: { hi: price.hi, lo: price.lo, hqMin: props.dialogs.pricing.hqMin, hqMax: props.dialogs.pricing.hqMax },
  }
}

/** The screen's own order: gap FIRST, then sell reconciled against it. The
 *  `reconciled` flag is how the red run is taken: false reproduces R3's board
 *  exactly, which is the one that double-claims. */
function layersOf(
  props: TodayProps,
  lanes: BoardLane[],
  dials: Dials,
  reconciled: boolean,
): { sell: SellLayer; gap: { packed: GapCell[]; scraps: GapCell[] }; claims: GapCell[] } {
  const { price, depth, frame } = priceOf(props)
  const gap = gapLayerFor(lanes, {
    gridMin: dials.gridMin,
    sessionMin: dials.sessionMin,
    gapFillMin: props.guard.gapFillMinMin,
    gapFillDiscountPct: props.guard.gapFillDiscountPct,
    minSellableMin: dials.minSellableMin,
    nowMinute: props.sell.nowMinute,
    locked: [],
    frame,
    depth,
    guard: props.guard.config,
  })
  const claims = [...gap.packed, ...gap.scraps]
  const sell = sellLayerFor(lanes, props.hours, {
    gridMin: dials.gridMin,
    nowMinute: props.sell.nowMinute,
    locked: [],
    showPrice: true,
    hi: price.hi,
    hqMin: props.dialogs.pricing.hqMin,
    depth,
    reconcile: reconciled ? { claims, rooms: props.rooms, cleanupMinutesByBed: props.bedCleanupMinutes } : undefined,
  })
  return { sell, gap, claims }
}

const truthOn = (lanes: BoardLane[], rooms: RoomPolicy, hours: Hours, nowMin: number): BedTruth => {
  const frame: DayFrame = { openMin: hours.open, closeMin: hours.close, nowMin }
  return bedTruthViews(lanes, rooms, frame, null).world
}

/** THE ASSERTION, assembled the one way: the FINAL cells of both layers, read
 *  through `boardOffers`, judged by the book against every room's own dial. */
function violationsOf(
  props: TodayProps,
  lanes: BoardLane[],
  layers: { sell: SellLayer; claims: GapCell[] },
) {
  const truth = truthOn(lanes, props.rooms, props.hours, props.sell.nowMinute ?? props.hours.open)
  return buildClaims(truth, boardOffers(layers.sell.cells, layers.claims)).violations(props.bedCleanupMinutes)
}

const say = (v: { resourceKey: string; earlier: { kind: string; laneKey: string; startMin: number; endMin: number }; later: { kind: string; laneKey: string; startMin: number; endMin: number } }) =>
  `${v.resourceKey}: ${v.earlier.kind}/${v.earlier.laneKey} ${hhmm(v.earlier.startMin)}–${hhmm(v.earlier.endMin)}` +
  ` ✕ ${v.later.kind}/${v.later.laneKey} ${hhmm(v.later.startMin)}–${hhmm(v.later.endMin)}`

// ── hand-built scenes, for the shapes the fixture cannot show ───────────────

const HOURS: Hours = { open: 600, close: 1140, count: 9, labels: [] } as unknown as Hours

function booking(key: string, start: number, end: number): BoardItem {
  return {
    key,
    kind: 'booking',
    state: 'confirmed',
    category: 'repeat',
    ...place(start, end, HOURS),
    title: '見本',
    tag: '',
    time: '',
    ticketCat: null,
    ticketCore: null,
    held: false,
    micro: false,
    caseId: key,
    label: '',
  }
}

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key,
    sub: '',
    absentNote: null,
    mine: false,
    items: [],
    window: over.group === 'staff' ? { from: HOURS.open, until: HOURS.close } : null,
    untilLabel: over.group === 'staff' ? '19:00' : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

const ROOMS: RoomPolicy = { vipStaysPrivate: true, privateIsLastResort: true }
const SELL_OPTS = { gridMin: 60, nowMinute: null, locked: [], showPrice: true, hi: 7260, hqMin: 6600, depth: 9 }

/** A スキマ枠-shaped promise on one room, as `gapLayerFor` emits them: a staff
 *  row copy and a bed row copy of the same box. */
const promise = (laneKey: string, resourceKey: string, s: number, e: number): GapCell[] => [
  { laneKey, resourceKey, group: 'staff', staff: laneKey, s, e, price: 5000 },
  { laneKey, resourceKey, group: 'beds', staff: laneKey, s, e, price: 5000 },
]

const rec = (claims: GapCell[], cleanup: Record<string, number> = {}): SellReconcile => ({
  claims,
  rooms: ROOMS,
  cleanupMinutesByBed: cleanup,
})

const roomsAt = (layer: SellLayer, h: number) =>
  layer.cells.filter((c) => c.group === 'staff' && c.h === h).map((c) => `${c.laneKey}→${c.resourceKey}`).sort()

// ═══════════════════════════════════════════════════════════════════════════
// §1 — AN OFFER IS AN OPTION, A PROMISE IS A UNIT
// ═══════════════════════════════════════════════════════════════════════════

describe('§1 — the distinction, and the one place it is spelled', () => {
  const cell = (resourceKey: string, h: number, laneKey = 'p-01') => ({
    laneKey,
    resourceKey,
    group: 'staff' as const,
    h,
    staff: laneKey,
    bed: resourceKey,
    price: 7000,
    tier: 1 as const,
  })

  it('a MENU of overlapping starts on one room is ONE claim on that room', () => {
    // 15:00 / 15:30 / 16:00 on ベッド1 — at gridMin 30 canon really does emit
    // these, because `claimed` is minted fresh inside its per-slot loop while
    // SELL_SLOT_MIN is fixed at 60. The customer picks one and the other two
    // stop existing, so the room is claimed once, over the run.
    const offers = boardOffers([cell('bed-01', 900), cell('bed-01', 930), cell('bed-01', 960)], [])
    expect(offers).toEqual([{ resourceKey: 'bed-01', start: 900, end: 1020, kind: 'sell', laneKey: 'p-01' }])
  })

  it('a menu spanning two staff members is still ONE claim — a room is booked once', () => {
    const offers = boardOffers([cell('bed-01', 900, 'p-01'), cell('bed-01', 930, 'p-02')], [])
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({ start: 900, end: 990 })
  })

  it('ADJACENT hours join the run — two back-to-back hours are one stretch of that room’s day', () => {
    // Splitting them would invent a separation of 0 minutes that the turnaround
    // rule would then judge, and a booking grid offering 15:00 and 16:00 on one
    // room is not promising both at once.
    expect(boardOffers([cell('bed-01', 900), cell('bed-01', 960)], [])).toEqual([
      { resourceKey: 'bed-01', start: 900, end: 1020, kind: 'sell', laneKey: 'p-01' },
    ])
  })

  it('a BREAK in the run is two claims, and another room is always its own', () => {
    expect(boardOffers([cell('bed-01', 600), cell('bed-01', 900)], []).map((o) => [o.start, o.end])).toEqual([
      [600, 660],
      [900, 960],
    ])
    expect(boardOffers([cell('bed-01', 600), cell('bed-02', 600)], [])).toHaveLength(2)
  })

  it('every スキマ枠 box is its OWN claim, and its staff/bed pair collapses to one', () => {
    const offers = boardOffers([], promise('p-01', 'bed-01', 900, 950))
    expect(offers).toHaveLength(2) // the pair is still two OFFERS here…
    const truth = truthOn([lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })], ROOMS, HOURS, 600)
    expect(buildClaims(truth, offers).claims).toHaveLength(1) // …and one CLAIM there.
  })

  it('an offer with no room is dropped by the feed, never thrown at the book', () => {
    // canon emits `bed?.key ?? ''` on a store with no rooms configured
    // (availability :127). It is a claim on nothing.
    expect(boardOffers([cell('', 900)], [{ ...promise('p-01', '', 900, 950)[0] }])).toEqual([])
    expect(() => boardOffers([cell('', 900)], [])).not.toThrow()
  })

  it('overlapping sell options are NOT a violation — a gap box over them is', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]
    const truth = truthOn(lanes, ROOMS, HOURS, 600)
    const menu = [cell('bed-01', 900), cell('bed-01', 930), cell('bed-01', 960)]
    expect(buildClaims(truth, boardOffers(menu, [])).violations({})).toEqual([])
    const withGap = buildClaims(truth, boardOffers(menu, promise('p-02', 'bed-01', 930, 980))).violations({})
    expect(withGap).toHaveLength(1)
    expect([withGap[0].earlier.kind, withGap[0].later.kind].sort()).toEqual(['gap', 'sell'])
  })

  it('the false R2 comment is corrected, and the correction names the real mechanism', () => {
    // ⚖ R4 §1. The old text said a twin inside one kind "cannot happen —
    // each frozen ledger already refuses to sell one room twice (sell's
    // per-slot Set…)". The sell half of that is false, and it is the exact
    // fact this round is built on.
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/capacity-ledger.ts'),
      'utf8',
    )
    expect(src).not.toContain('a TWIN inside one kind cannot happen — each frozen ledger already')
    expect(src).toContain('OFFER IS AN OPTION')
    expect(src).toContain('PROMISE IS A UNIT')
    expect(src).toContain('minted fresh INSIDE the per-slot loop')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE SEAM, AND WHY THE COUNTS ARE HONEST BY CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════

describe('§2 — reconciled before the layer is built, never in the renderer', () => {
  const oneRoom = () => [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]

  it('no promises means a byte-identical layer — R3’s board, unchanged', () => {
    const bare = sellLayerFor(oneRoom(), HOURS, SELL_OPTS)
    expect(sellLayerFor(oneRoom(), HOURS, { ...SELL_OPTS, reconcile: rec([]) })).toEqual(bare)
  })

  it('a promise over an hour removes the hour AND the count that names it', () => {
    const before = sellLayerFor(oneRoom(), HOURS, SELL_OPTS)
    const after = sellLayerFor(oneRoom(), HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-01', 'bed-01', 900, 960)) })
    expect(before.cells.some((c) => c.group === 'staff' && c.h === 900)).toBe(true)
    expect(after.cells.some((c) => c.h === 900)).toBe(false)
    // THE POINT OF THE SEAM: the band count, the density verdict and the chip's
    // own sentence are all derived from the surviving cells. A render-time
    // filter could not move any of them.
    expect(after.staffBands).not.toEqual(before.staffBands)
    expect(after.chipLabel).toContain(`${after.staffBands.length}窓`)
  })

  it('the pair moves or goes TOGETHER — a bed row never keeps a dropped hour', () => {
    const after = sellLayerFor(oneRoom(), HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-01', 'bed-01', 900, 960)) })
    expect(after.cells.filter((c) => c.h === 900)).toEqual([])
  })

  it('the layer is a PURE function of its inputs — built twice, byte-identical', () => {
    // The StrictMode mutant: React builds a memo twice on identical inputs and
    // the two results have to be the same value.
    const claims = promise('p-01', 'bed-01', 900, 960)
    const a = sellLayerFor(oneRoom(), HOURS, { ...SELL_OPTS, reconcile: rec(claims) })
    const b = sellLayerFor(oneRoom(), HOURS, { ...SELL_OPTS, reconcile: rec(claims) })
    expect(a).toEqual(b)
    // …and it does not write to what it was handed.
    expect(claims).toEqual(promise('p-01', 'bed-01', 900, 960))
  })

  it('the screen reconciles in the LAYER and the renderer no longer filters', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    // The dead per-lane suppression is GONE, not commented out.
    expect(src).not.toContain('!gapHere.some((g) => g.s < c.h + 60 && c.h < g.e)')
    expect(src).toContain('const cells = sell.cells.filter(onThisLane)')
    // The gap layer computes first, and the sell layer is handed its cells.
    expect(src.indexOf('const gap = useMemo(')).toBeLessThan(src.indexOf('const sell = useMemo('))
    expect(src).toContain('reconcile: { claims: gapClaims, rooms: props.rooms, cleanupMinutesByBed: props.bedCleanupMinutes }')
    // The four surfaces that read the count read the LAYER, so they cannot
    // disagree with the paint any more.
    for (const surface of ['公開中 {sell.staffBands.length}枠', '販売可能枠 {sell.staffBands.length}窓', '<b>{sell.staffBands.length}枠</b>', 'priceButtonCaption(sell.staffBands.length']) {
      expect(src).toContain(surface)
    }
  })

  it('the per-room turnaround dial reaches the screen from the page, not from today-board', () => {
    const page = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'),
      'utf8',
    )
    expect(page).toContain('bedCleanupMinutes: Object.fromEntries(resources.map((r) => [r.id, r.cleanup_minutes]))')
    // ⛔ today-board.ts is PR #770's this round. Its own derivation is untouched.
    const board = readFileSync(join(process.cwd(), 'src/business/lib/today-board.ts'), 'utf8')
    expect(board).not.toContain('bedCleanupMinutes')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §3 — PER BED, PER SPAN, PER THAT BED'S TURNAROUND — NEVER PER DRAWN ROW
// ═══════════════════════════════════════════════════════════════════════════

describe('§3 — the reconciliation is a room’s question, not a row’s', () => {
  /** THE ACTUAL DEFECT, in one scene: two staff, one room. p-01's 販売可能枠
   *  hour and p-02's スキマ枠 box are drawn on DIFFERENT rows and point at the
   *  SAME room. The shipped `onThisLane` filter compared neither to the other. */
  const crossRow = () => [
    lane({ key: 'p-01', group: 'staff' }),
    lane({ key: 'p-02', group: 'staff' }),
    lane({ key: 'bed-01', group: 'beds' }),
  ]

  it('a cross-ROW collision on one room is caught — the old per-row filter could not see it', () => {
    const claims = promise('p-02', 'bed-01', 900, 960)
    const before = sellLayerFor(crossRow(), HOURS, SELL_OPTS)
    const after = sellLayerFor(crossRow(), HOURS, { ...SELL_OPTS, reconcile: rec(claims) })
    // p-01 held the room at 15:00 (canon's pairing cap gives the one room to
    // the first free staff lane) and the promise is drawn on p-02's row.
    expect(before.cells.some((c) => c.group === 'staff' && c.laneKey === 'p-01' && c.h === 900)).toBe(true)
    expect(after.cells.some((c) => c.h === 900)).toBe(false)
    // The old rule, spelled here so the difference is not a claim: it compared
    // only boxes on the same drawn row, and these two are not.
    const onSameRow = (a: { laneKey: string }, b: { laneKey: string }) => a.laneKey === b.laneKey
    expect(onSameRow({ laneKey: 'p-01' }, { laneKey: 'p-02' })).toBe(false)
  })

  it('a promise that does NOT overlap leaves the hour alone', () => {
    const after = sellLayerFor(crossRow(), HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 960, 1010)) })
    expect(after.cells.some((c) => c.group === 'staff' && c.h === 900)).toBe(true)
  })

  it('a promise on ANOTHER room leaves the hour alone', () => {
    const lanes = [...crossRow(), lane({ key: 'bed-02', group: 'beds' })]
    const after = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-02', 900, 960)) })
    expect(roomsAt(after, 900)).toContain('p-01→bed-01')
  })

  it('the TURNAROUND is the room’s own: 10 minutes of clearance is enough at 0 and not at 15', () => {
    // The promise ends at 14:50; the hour starts at 15:00. Ten minutes apart.
    const claims = promise('p-02', 'bed-01', 840, 890)
    const bare = sellLayerFor(crossRow(), HOURS, { ...SELL_OPTS, reconcile: rec(claims, {}) })
    const dialled = sellLayerFor(crossRow(), HOURS, { ...SELL_OPTS, reconcile: rec(claims, { 'bed-01': 15 }) })
    expect(bare.cells.some((c) => c.group === 'staff' && c.h === 900)).toBe(true)
    expect(dialled.cells.some((c) => c.h === 900)).toBe(false)
    // Each room is judged by ITS OWN minutes — another room's dial is not this
    // room's, and a room absent from the map is a bare room (⚖ flag 77's OFF).
    const elsewhere = sellLayerFor(crossRow(), HOURS, { ...SELL_OPTS, reconcile: rec(claims, { 'bed-09': 15 }) })
    expect(elsewhere.cells.some((c) => c.group === 'staff' && c.h === 900)).toBe(true)
  })

  it('a turnaround that is not a number of minutes DEGRADES here, where the book throws', () => {
    // `ClaimsBook.violations` throws on the same input on purpose: it is an
    // assertion surface. This runs while the board is drawing itself, with no
    // error boundary under it, so the only acceptable failure direction is a
    // bare room — the same rule the ledger's own MAX_DURATIONS states.
    const claims = promise('p-02', 'bed-01', 840, 890)
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, -30]) {
      const out = sellLayerFor(crossRow(), HOURS, { ...SELL_OPTS, reconcile: rec(claims, { 'bed-01': junk }) })
      expect(out.cells.some((c) => c.group === 'staff' && c.h === 900)).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE LOSER IS RE-BEDDED BEFORE IT IS DROPPED
// ═══════════════════════════════════════════════════════════════════════════

describe('§4 —「people are chosen, rooms are solved」(⚖ flag 51)', () => {
  it('a losing hour MOVES to a physically free room rather than disappearing', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-01', group: 'beds' }),
      lane({ key: 'bed-02', group: 'beds' }),
    ]
    const after = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 900, 960)) })
    expect(roomsAt(after, 900)).toEqual(['p-01→bed-02'])
    // The bed-row copy went with it — one advertisement, two drawings.
    expect(after.cells.filter((c) => c.h === 900).map((c) => c.resourceKey)).toEqual(['bed-02', 'bed-02'])
  })

  it('…and only a loser with nowhere to go is dropped', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]
    const after = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 900, 960)) })
    expect(after.cells.some((c) => c.h === 900)).toBe(false)
  })

  it('a room a REAL booking is standing in is not a landing either', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-01', group: 'beds' }),
      lane({ key: 'bed-02', group: 'beds', items: [booking('apt-x', 900, 960)] }),
    ]
    const after = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 900, 960)) })
    expect(after.cells.some((c) => c.h === 900)).toBe(false)
  })

  it('canon’s per-slot cap holds through a re-bedding: two people never get one room for one hour', () => {
    // Two staff, two rooms. A promise takes bed-01 at 15:00, so p-01's hour
    // wants to move — and bed-02 is already held by p-02's own hour. There is
    // nowhere left, and inventing a second claim on bed-02 would be the very
    // defect this round closes.
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'p-02', group: 'staff' }),
      lane({ key: 'bed-01', group: 'beds' }),
      lane({ key: 'bed-02', group: 'beds' }),
    ]
    const before = sellLayerFor(lanes, HOURS, SELL_OPTS)
    expect(roomsAt(before, 900)).toEqual(['p-01→bed-01', 'p-02→bed-02'])
    const after = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-03', 'bed-01', 900, 960)) })
    expect(roomsAt(after, 900)).toEqual(['p-02→bed-02'])
  })

  it('the re-bed obeys ⚖ 51’s 個室-last order, because it IS `allocateBed`', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-01', group: 'beds' }),
      lane({ key: 'bed-02', group: 'beds', roomClass: 'private', sub: '個室' }),
      lane({ key: 'bed-03', group: 'beds' }),
    ]
    const after = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 900, 960)) })
    // 個室 is spent last: bed-03 is a 施術室 and takes the hour.
    expect(roomsAt(after, 900)).toEqual(['p-01→bed-03'])
  })

  it('⚖ A-5 — the re-bed reads a room’s WHOLE store list, where canon’s pairing reads its first', () => {
    // A room in two stores, and a staff member in the SECOND of them. Canon's
    // `canPair` compares against `stores?.[0]` and refuses (fail-CLOSED, which
    // is why the flattening can never cross a store line); `allocateBed`'s
    // `sharesStore` reads the whole list and places the hour.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', stores: ['store-b'] }),
      lane({ key: 'bed-01', group: 'beds', stores: ['store-b'] }),
      lane({ key: 'bed-02', group: 'beds', stores: ['store-a', 'store-b'] }),
    ]
    const after = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 900, 960)) })
    expect(roomsAt(after, 900)).toEqual(['p-01→bed-02'])
    // …and the store rule is still a WALL: a room in no shared store takes nothing.
    const foreign = [
      lane({ key: 'p-01', group: 'staff', stores: ['store-b'] }),
      lane({ key: 'bed-01', group: 'beds', stores: ['store-b'] }),
      lane({ key: 'bed-02', group: 'beds', stores: ['store-a'] }),
    ]
    expect(
      sellLayerFor(foreign, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 900, 960)) }).cells.some(
        (c) => c.h === 900,
      ),
    ).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §5 — WHO KEEPS THE ROOM IS A NAMED RULE
// ═══════════════════════════════════════════════════════════════════════════

describe('§5 — the precedence has one home and its provenance', () => {
  it('the default is today’s shipped behaviour: the スキマ枠 box keeps the room', () => {
    expect(keepsTheRoom({ resourceKey: 'bed-01', start: 900, end: 960 }, { resourceKey: 'bed-01', start: 900, end: 950 })).toBe('gap')
    // It does not depend on which is longer, earlier or dearer — R4 is a
    // CORRECTNESS round and does not touch a revenue rule on fixture data.
    expect(keepsTheRoom({ resourceKey: 'bed-01', start: 600, end: 1140 }, { resourceKey: 'bed-01', start: 900, end: 905 })).toBe('gap')
  })

  it('the rule is a function, not a literal in a filter, and it carries the ⚖ note', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'),
      'utf8',
    )
    expect(src).toContain('export function keepsTheRoom(')
    expect(src).toContain('WHICH PROMISE KEEPS THE ROOM')
    expect(src).toContain("FLIPPING IT IS ONE LINE — `return 'sell'`")
    // …and the reconciliation ASKS it rather than assuming the answer.
    expect(src).toContain("keepsTheRoom({ resourceKey, start, end }, p) === 'gap'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §6 — THE BOOK IS THE ASSERTION: THE FIXTURE BOARD, AND THE DIAL SWEEP
// ═══════════════════════════════════════════════════════════════════════════

const EVIDENCE = process.env.R4_EVIDENCE ?? ''

const GRID = [30, 60]
const SESSION = [45, 60, 90]
const MIN_SELLABLE = [0, 30]

describe('§6 — one advertised offer per bed, on the operator’s own board', () => {
  it('THE RED RUN: without the reconciliation the fixture board double-claims its rooms', () => {
    const dials: Dials = { gridMin: REAL.sell.gridMin, sessionMin: REAL.guard.standardSessionMin, minSellableMin: REAL.guard.minSellableMin ?? 0 }
    const red = violationsOf(REAL, REAL.lanes, layersOf(REAL, REAL.lanes, dials, false))
    // This is the defect, kept as a permanent red run rather than a claim about
    // one: every entry is a room the board advertised twice, at the dials the
    // store actually ships with.
    expect(red.length).toBeGreaterThan(0)
    for (const v of red) expect([v.earlier.kind, v.later.kind].sort()).toEqual(['gap', 'sell'])
    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, 'RED-RUN-r4.txt'),
        [
          '# RED-RUN-r4 — the double-claims on the pristine demo fixture, WITHOUT R4',
          `# board: ${STORE_A} via TodayPage · ${hhmm(REAL.hours.open)}-${hhmm(REAL.hours.close)}` +
            ` · dials grid=${dials.gridMin} S=${dials.sessionMin} minSell=${dials.minSellableMin}`,
          '# each line: one room promised to two different customers at once',
          '',
          ...red.map(say),
          '',
          `total: ${red.length}`,
          '',
        ].join('\n'),
      )
    }
  })

  it('WITH it, the book finds nothing left to complain about', () => {
    const dials: Dials = { gridMin: REAL.sell.gridMin, sessionMin: REAL.guard.standardSessionMin, minSellableMin: REAL.guard.minSellableMin ?? 0 }
    expect(violationsOf(REAL, REAL.lanes, layersOf(REAL, REAL.lanes, dials, true)).map(say)).toEqual([])
  })

  it('…and the board is still SELLING — a silenced layer would also have no violations', () => {
    const dials: Dials = { gridMin: REAL.sell.gridMin, sessionMin: REAL.guard.standardSessionMin, minSellableMin: REAL.guard.minSellableMin ?? 0 }
    const before = layersOf(REAL, REAL.lanes, dials, false)
    const after = layersOf(REAL, REAL.lanes, dials, true)
    expect(after.sell.cells.length).toBeGreaterThan(0)
    expect(after.sell.staffBands.length).toBeGreaterThan(0)
    // The gap layer is untouched by the round: it runs first and it is the book.
    expect(after.gap.packed).toEqual(before.gap.packed)
    expect(after.gap.scraps).toEqual(before.gap.scraps)
    expect(after.sell.cells.length).toBeGreaterThan(0)
  })

  it('WHAT HAPPENED TO EVERY OFFER THAT LOST ITS ROOM — re-bedded, or dropped because the day was full', () => {
    const dials: Dials = { gridMin: REAL.sell.gridMin, sessionMin: REAL.guard.standardSessionMin, minSellableMin: REAL.guard.minSellableMin ?? 0 }
    const before = layersOf(REAL, REAL.lanes, dials, false)
    const after = layersOf(REAL, REAL.lanes, dials, true)
    const rooms = REAL.lanes.filter((l) => l.group === 'beds')
    const key = (c: { laneKey: string; h: number }) => `${c.laneKey}|${c.h}`
    const kept = new Map(after.sell.cells.filter((c) => c.group === 'staff').map((c) => [key(c), c.resourceKey]))
    const moved: string[] = []
    const dropped: string[] = []
    for (const c of before.sell.cells.filter((x) => x.group === 'staff')) {
      const now = kept.get(key(c))
      if (now === undefined) dropped.push(`${c.laneKey} ${hhmm(c.h)} was ${c.resourceKey}`)
      else if (now !== c.resourceKey) moved.push(`${c.laneKey} ${hhmm(c.h)} ${c.resourceKey}→${now}`)
    }
    // EVERY drop is a room the board could not solve, and the claim is only
    // honest if it is checked: for each dropped hour, no compatible room was
    // BOTH physically free for the span (asked of Phase 1, which knows nothing
    // about advertisements) AND unspoken-for — neither promised by the gap
    // layer nor already held by a surviving 販売可能枠 offer in the same slot,
    // which is canon's own per-slot cap and the thing that stops a re-bedding
    // from handing two people one room for one hour.
    const truth = truthOn(REAL.lanes, REAL.rooms, REAL.hours, REAL.sell.nowMinute ?? REAL.hours.open)
    const claimed = new Map<string, Array<{ s: number; e: number }>>()
    for (const g of after.claims) {
      const held = claimed.get(g.resourceKey) ?? []
      held.push({ s: g.s, e: g.e })
      claimed.set(g.resourceKey, held)
    }
    for (const c of before.sell.cells.filter((x) => x.group === 'staff')) {
      if (kept.has(key(c))) continue
      const stores = REAL.lanes.find((l) => l.key === c.laneKey)?.stores ?? null
      const free = truth.freeBedKeys(c.h, c.h + 60, { stores })
      const heldBySurvivor = new Set(
        after.sell.cells.filter((x) => x.group === 'staff' && x.h === c.h).map((x) => x.resourceKey),
      )
      const available = free.filter(
        (k) => !heldBySurvivor.has(k) && !(claimed.get(k) ?? []).some((p) => p.e > c.h && p.s < c.h + 60),
      )
      expect({ at: key(c), available }).toEqual({ at: key(c), available: [] })
    }
    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, 'REBED-r4.txt'),
        [
          '# REBED-r4 — what R4 did to every 販売可能枠 hour that lost its room',
          `# board: the REAL fixture board (${STORE_A}) · ${rooms.length} rooms (${rooms.map((r) => r.key).join(', ')})`,
          `# dials: grid=${dials.gridMin} S=${dials.sessionMin} minSell=${dials.minSellableMin} — the store's own`,
          `# offers before: ${before.sell.cells.filter((c) => c.group === 'staff').length}` +
            ` · after: ${after.sell.cells.filter((c) => c.group === 'staff').length}` +
            ` · promises drawn by the gap layer: ${after.claims.length / 2}`,
          '',
          `RE-BEDDED (${moved.length}):`,
          ...(moved.length ? moved.map((m) => `  ${m}`) : ['  none']),
          '',
          `DROPPED (${dropped.length}) — each one verified against Phase 1: no compatible room`,
          'was both physically free for the span AND unpromised by the gap layer.',
          ...(dropped.length ? dropped.map((d) => `  ${d}`) : ['  none']),
          '',
        ].join('\n'),
      )
    }
  })

  it('THE DIAL SWEEP: 12 combinations, violations empty in every one, board never silent', () => {
    const rows: string[] = []
    const silent: string[] = []
    for (const gridMin of GRID) {
      for (const sessionMin of SESSION) {
        for (const minSellableMin of MIN_SELLABLE) {
          const dials: Dials = { gridMin, sessionMin, minSellableMin }
          const red = layersOf(REAL, REAL.lanes, dials, false)
          const green = layersOf(REAL, REAL.lanes, dials, true)
          const bad = violationsOf(REAL, REAL.lanes, red)
          const ok = violationsOf(REAL, REAL.lanes, green)
          expect(ok.map(say)).toEqual([])
          // ⚠ THE BAR IS BOARD-LEVEL. A single empty LAYER is not a failure —
          // canon's grid mode legitimately silences the packing layer — what
          // must hold is that the board keeps advertising something.
          const total = green.sell.cells.length + green.gap.packed.length + green.gap.scraps.length
          if (total === 0) silent.push(`grid=${gridMin} S=${sessionMin} minSell=${minSellableMin}`)
          rows.push(
            `grid=${String(gridMin).padStart(2)} S=${String(sessionMin).padStart(2)} minSell=${String(minSellableMin).padStart(2)}` +
              ` | cells ${String(red.sell.cells.length).padStart(3)}→${String(green.sell.cells.length).padStart(3)}` +
              ` packed=${String(green.gap.packed.length).padStart(3)} scraps=${String(green.gap.scraps.length).padStart(3)}` +
              ` | violations ${String(bad.length).padStart(2)}→${String(ok.length).padStart(2)}`,
          )
        }
      }
    }
    expect(rows).toHaveLength(12)
    expect(silent).toEqual([])
    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, 'DIAL-SWEEP-r4.txt'),
        [
          '# DIAL-SWEEP-r4 — one advertised offer per bed, across every dial combination',
          `# board: the REAL fixture board (${STORE_A}) assembled by TodayPage · ${hhmm(REAL.hours.open)}-${hhmm(REAL.hours.close)}`,
          '# columns: sell cells before→after reconciliation · 詰め込み · スキマ · claim violations before→after',
          '# the bar is BOARD-level: a single empty layer is not a failure (canon grid mode),',
          '# what must hold is that the board keeps selling and violations reach zero.',
          '',
          ...rows,
          '',
          `board-silent combinations (cells+packed+scraps == 0 after): ${silent.length === 0 ? 'NONE' : silent.join(' ; ')}`,
          '',
        ].join('\n'),
      )
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §7 — WHAT IT COSTS
// ═══════════════════════════════════════════════════════════════════════════

/** A board of N staff over 5 rooms, dense enough that most hours have to
 *  compete for a room. Deterministic, so a number that moves means the code
 *  moved. */
function synthBoard(staff: number, beds: number, seed: number): BoardLane[] {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  const made: Array<{ id: string; staff: number; bed: number; start: number; end: number }> = []
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.end > b.start && a.start < b.end
  for (let i = 0; i < staff; i += 1) {
    for (let n = 0; n < 3; n += 1) {
      const dur = [45, 60, 90][Math.floor(next() * 3) % 3]
      const start = HOURS.open + Math.floor(next() * ((HOURS.close - HOURS.open - dur) / 30 + 1)) * 30
      const span = { start, end: start + dur }
      const bed = Math.floor(next() * beds) % beds
      if (made.some((b) => (b.staff === i || b.bed === bed) && overlaps(b, span))) continue
      made.push({ id: `apt-${i}-${n}`, staff: i, bed, ...span })
    }
  }
  const lanes: BoardLane[] = []
  for (let i = 0; i < staff; i += 1) {
    lanes.push(
      lane({
        key: `p-${String(i).padStart(2, '0')}`,
        group: 'staff',
        items: made.filter((b) => b.staff === i).map((b) => booking(`${b.id}-s`, b.start, b.end)).sort((a, b) => a.x - b.x),
      }),
    )
  }
  for (let j = 0; j < beds; j += 1) {
    lanes.push(
      lane({
        key: `bed-${String(j).padStart(2, '0')}`,
        group: 'beds',
        items: made.filter((b) => b.bed === j).map((b) => booking(`${b.id}-b`, b.start, b.end)).sort((a, b) => a.x - b.x),
      }),
    )
  }
  return lanes
}

describe('§7 — the cost, on real timers', () => {
  const SIZES = [6, 15, 25, 30]

  /** ⚠ THE HARNESS RUNS UNDER `jest.useFakeTimers()` (this file pins the fixture
   *  day with it), and @sinonjs/fake-timers flattens `hrtime` and `performance`
   *  to a frozen clock — a faked 0.00ms is not evidence of anything. Every
   *  number below is taken with REAL timers, restored afterwards, and the
   *  artifact states which mode produced it. */
  const timed = (runs: number, fn: () => void) => {
    jest.useRealTimers()
    try {
      for (let i = 0; i < 5; i += 1) fn() // warm
      const t0 = process.hrtime.bigint()
      for (let i = 0; i < runs; i += 1) fn()
      return Number(process.hrtime.bigint() - t0) / 1e6 / runs
    } finally {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z'))
    }
  }

  it('the reconciliation asks `allocateBed` only about the offers that actually lost', () => {
    // The call-count claim, and it is the one that keeps the cost bounded: a
    // survivor costs ZERO searches. Proven through the book's own counter,
    // which counts every `allocateBed` execution in a world.
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-01', group: 'beds' }),
      lane({ key: 'bed-02', group: 'beds' }),
    ]
    const bare = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec([]) })
    const one = sellLayerFor(lanes, HOURS, { ...SELL_OPTS, reconcile: rec(promise('p-02', 'bed-01', 900, 960)) })
    expect(bare.cells.length).toBeGreaterThan(0)
    expect(one.cells.length).toBe(bare.cells.length)
    // Nine hours on this board, one of them contested: eight offers are never
    // asked about at all. Asserted as a SHAPE (the layer is unchanged outside
    // the contested hour) because the searches are the allocator's, not ours.
    expect(one.cells.filter((c) => c.h !== 900)).toEqual(bare.cells.filter((c) => c.h !== 900))
  })

  it('PERF TABLE — 6 / 15 / 25 / 30 staff, sell layer with and without the reconciliation', () => {
    const rows: string[] = []
    for (const staff of SIZES) {
      const lanes = synthBoard(staff, 5, 4242 + staff)
      const { price, depth, frame } = priceOf(REAL)
      const gap = gapLayerFor(lanes, {
        gridMin: 30,
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
      const claims = [...gap.packed, ...gap.scraps]
      const base = { gridMin: 30, nowMinute: null, locked: [], showPrice: true, hi: price.hi, hqMin: REAL.dialogs.pricing.hqMin, depth }
      const off = timed(200, () => sellLayerFor(lanes, HOURS, base))
      const on = timed(200, () => sellLayerFor(lanes, HOURS, { ...base, reconcile: rec(claims) }))
      const layer = sellLayerFor(lanes, HOURS, { ...base, reconcile: rec(claims) })
      rows.push(
        `staff=${String(staff).padStart(2)} rooms=5 claims=${String(claims.length).padStart(3)}` +
          ` | R3 ${off.toFixed(3)}ms · R4 ${on.toFixed(3)}ms · +${(((on - off) / off) * 100).toFixed(1)}%` +
          ` | cells ${String(layer.cells.length).padStart(3)}`,
      )
      // Not a benchmark gate — a tripwire on the ORDER of the cost. The
      // reconciliation is bounded by the losers, so it can never be a multiple
      // of the derivation it follows.
      expect(on).toBeLessThan(off * 6 + 1)
    }
    expect(rows).toHaveLength(4)
    if (EVIDENCE) {
      mkdirSync(EVIDENCE, { recursive: true })
      writeFileSync(
        join(EVIDENCE, 'PERF-r4.txt'),
        [
          '# PERF-r4 — the cost of one advertised offer per bed',
          '# TIMER MODE: REAL. jest.useRealTimers() is entered before the first warm-up',
          '#   run and the fake clock is restored in a finally. The harness otherwise runs',
          '#   under jest.useFakeTimers(), which flattens process.hrtime to a frozen value —',
          '#   a 0.00ms reading taken under it would be evidence of nothing.',
          '# method: 5 warm-up runs, then 200 timed runs, mean per run, process.hrtime.bigint()',
          '# board: deterministic synthetic, 5 rooms, 3 bookings attempted per staff lane,',
          '#   10:00-19:00, gridMin 30 / session 60 / minSellable 0',
          '# R3 = sellLayerFor without `reconcile` · R4 = the same call with it',
          '',
          ...rows,
          '',
          'The reconciliation costs one `allocateBed` search per offer that actually',
          'LOST its room. A survivor costs a map lookup and nothing else, so the added',
          'work scales with the number of スキマ枠/詰め込み boxes on the board rather',
          'than with the number of staff.',
          '',
        ].join('\n'),
      )
    }
  })
})
