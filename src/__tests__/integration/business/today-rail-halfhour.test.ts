// ⚖ LIAM 2026-09-09 — THE 60分配置 STRIP, READ BY THE HALF HOUR.
//
// His three rulings, after reading the strip on the preview:
//   1. every half hour with NO free bed says 満室 (and the lane says it too),
//      whether or not a session of the strip's length could START there;
//   2. a quiet half hour on a free person whose bed is being sold on another
//      lane says so, in words, on the lane;
//   3. a half hour WITH a free bed never says 満室 — a start that fits only by
//      moving somebody wears a 「moves someone」 mark instead of a plain ✓.
//
// This slice carries ruling 1 alone. Ruling 3's mark and ruling 2's own mark
// arrive above it, each with the machinery that makes it honest, and each with
// its own red-runs (§R-A…§R-F) in this same file.
//
// And his two gates on the round, which is what most of this file is:
//   · THE FIX MUST BE CLEAR — the red-runs pin, on his own three scenes,
//     exactly what a staffer now sees and reads.
//   · NOTHING ELSE MAY CHANGE — §OBSERVATIONAL reads EVERY chip and EVERY lane
//     cue of the whole board on all four scenes and compares them against a
//     baseline taken at `origin/main` 5108b554d, BEFORE a line of this round
//     was written. The list of keys allowed to differ is spelled out below; a
//     board that moves anything else fails here.
//
// THE COMPOSITION UNDER TEST is the screen's own derivation chain, rebuilt from
// the props `TodayPage` hands `TodayScreen` — the book, the two doors, the gap
// layer, the sell layer with its drops, the reserved mask — because the round's
// answers are composed out of all of them and a hand-built scene would prove
// nothing about the board the operator actually looks at. It is faithful to the
// screen's REST state and says so honestly where it stops: `withheld`
// (`sell.cells.filter(isHeldBound)`, TodayScreen :2063) is not threaded, so the
// E3b clause's held EXTENT is the held span itself here. That input widens a
// clause's reach and never composes a word, a cue or a mark, and the pin is a
// before/after comparison of one composition against itself.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { STORE_A } from '@/business/lib/fixtures'
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import { heldCommittedFor } from '@/app/[locale]/(business)/business/today/held-committed'
import { fallbackCellsFor } from '@/app/[locale]/(business)/business/today/fallback-cells'
import { reservedOffersFor } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import {
  applyBlockMoves,
  applyMoves,
  explainRails,
  gapLayerFor,
  gapPackingDials,
  guardRailsFor,
  heldDrawnFor,
  landingVerdict,
  onlineOffers,
  restCueStarts,
  sellDrawnFor,
  sellLayerFor,
  type GuardRail,
  type Move,
  type Moves,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import {
  TodayScreen,
  bedDoor,
  bedViewsFor,
  type TodayProps,
} from '@/app/[locale]/(business)/business/today/TodayScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { minuteOf, place, type BoardLane } from '@/business/lib/today-board'

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

// ── LIAM'S FOUR BOARDS ─────────────────────────────────────────────────────
//
// REST is main's own fixture day. A, B and C are that day plus the moves his
// three shots show, made through the SCREEN'S OWN movers (`applyBlockMoves`,
// then `applyMoves` with the bed side) — never hand-typed lanes, so every card
// carries the spans, tails and residue rules the product gives it. The spans
// are the ones measured off the shots in MOCK-REPORT-RAIL-HATCH-v1 §Per-scene.

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

const mv = (laneKey: string, start: number, end: number): Move => ({ laneKey, ...place(start, end, REAL.hours) })

/** さぶろう's break at 15:30〜16:00 and しろう's 記録 at 15:45〜16:00 — the two
 *  予定ブロック Liam had already dragged in all three shots (mock report §A). */
const HIS_BLOCKS = (): Moves => ({
  'c-03-break-900': mv('c-03', 930, 960),
  'blk-02': mv('p-04', 945, 960),
})

function sceneOf(moves: Moves, bedMoves: Moves, blockMoves: Moves = HIS_BLOCKS()): BoardLane[] {
  return applyMoves(
    applyBlockMoves(REAL.lanes, blockMoves, REAL.hours, []),
    moves,
    [],
    [],
    REAL.hours,
    bedMoves,
    REAL.bedCleanupMinutes,
  )
}

/** Scene A — さぶろう's 14:30 AND 15:00, both bed-less (shot 1.55.15). */
const sceneA = (): BoardLane[] =>
  sceneOf(
    {
      'apt-25': mv('p-05', 840, 900),
      'apt-09': mv('p-05', 900, 930),
      'apt-26': mv('p-06', 900, 960),
      'apt-33': mv('p-04', 870, 930),
      'apt-29': mv('p-06', 845, 900),
    },
    {
      'apt-25': mv('bed-01', 840, 900),
      'apt-09': mv('bed-01', 900, 930),
      'apt-26': mv('bed-03', 900, 960),
      'apt-33': mv('bed-02', 870, 930),
      'apt-29': mv('bed-03', 845, 900),
    },
  )

/** Scene B — しろう's quiet 14:30〜15:30, its one free bed sold on さぶろう's
 *  row (shot 1.38.20). */
const sceneB = (): BoardLane[] =>
  sceneOf({ 'apt-26': mv('p-05', 870, 930) }, { 'apt-26': mv('bed-01', 870, 930), 'apt-09': mv('bed-01', 845, 865) })

/** Scene C — ごろう's 14:00, refused 満室 today and packable by moving さくら
 *  one bed over (shot 1.43.41; REPRO-0143-REPORT §B2). */
const sceneC = (): BoardLane[] =>
  sceneOf(
    { 'apt-09': mv('p-05', 930, 950), 'apt-33': mv('p-05', 960, 1020) },
    { 'apt-09': mv('bed-02', 930, 950), 'apt-33': mv('bed-02', 960, 1020) },
  )

const boards = (): Array<{ name: string; lanes: BoardLane[] }> => [
  { name: 'REST', lanes: REAL.lanes },
  { name: 'A', lanes: sceneA() },
  { name: 'B', lanes: sceneB() },
  { name: 'C', lanes: sceneC() },
]

// ── THE SCREEN'S OWN COMPOSITION, AT REST ──────────────────────────────────

type ChipRow = { start: number; face: string; state: string; reason: string | null; word: string | null; sentence: string }
type CueRow = { start: number; end: number; kind: string | null; label: readonly string[] }
type LaneRead = { chips: ChipRow[]; cues: CueRow[] }
type BoardRead = { counter: string; lanes: Record<string, LaneRead> }

/** The strip as the screen builds it at rest, on any board — both guard doors
 *  out of the ONE book, the hand lifted out of nothing. */
function railsOn(lanes: BoardLane[]): GuardRail[] {
  const views = bedViewsFor(lanes, DAY_FRAME(), null)
  const bedFree = bedDoor(views, lanes, null)
  return guardRailsFor(lanes, {
    open: REAL.hours.open,
    close: REAL.hours.close,
    stepMin: 30,
    dur: REAL.guard.standardSessionMin,
    protectedDur: REAL.guard.protectedDurationMin,
    nowMinute: REAL.sell.nowMinute,
    locked: [],
    guard: REAL.guard.config,
    excludeId: null,
    placementFeasible: bedFree,
    protectedWindowFeasible: bedFree,
    resting: null,
  })
}

const DAY_FRAME = () => ({
  openMin: REAL.hours.open,
  closeMin: REAL.hours.close,
  nowMin: REAL.sell.nowMinute ?? REAL.hours.open,
})

function readBoard(lanes: BoardLane[]): BoardRead {
  const frame = DAY_FRAME()
  const views = bedViewsFor(lanes, frame, null)
  const dur = REAL.guard.standardSessionMin
  const rails: GuardRail[] = railsOn(lanes)
  const held = heldCommittedFor({
    gateOn: true,
    lanes,
    frame,
    bookOf: bedViewsFor,
    closeMin: REAL.hours.close,
    nowMin: REAL.sell.nowMinute,
    guard: REAL.guard.config,
    gapGuardMode: REAL.guard.mode,
    released: [],
  })
  const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
  const depth = Math.round((1 - price.lo / price.hi) * 100)
  const priceFrame = { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax }
  const gap = gapLayerFor(lanes, {
    gridMin: REAL.sell.gridMin,
    sessionMin: dur,
    gapFillMin: REAL.guard.gapFillMinMin,
    gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
    minSellableMin: REAL.guard.minSellableMin,
    nowMinute: REAL.sell.nowMinute,
    locked: [],
    frame: priceFrame,
    depth,
    guard: REAL.guard.config,
    held,
  })
  const claims = [...gap.packed, ...gap.scraps]
  const drops: SellDrop[] = []
  const sell = sellLayerFor(lanes, REAL.hours, {
    gridMin: REAL.sell.gridMin,
    nowMinute: REAL.sell.nowMinute,
    locked: [],
    showPrice: true,
    hi: price.hi,
    hqMin: REAL.dialogs.pricing.hqMin,
    depth,
    reconcile: { claims, cleanupMinutesByBed: REAL.bedCleanupMinutes, onDrop: (d) => drops.push(d) },
    held,
  })
  const drawn = held ? sellDrawnFor(sell, true) : sell
  // ⚖ §5's fragment fallback, exactly as the screen composes `gapDrawn` /
  // `drawnClaims` (TodayScreen :1716-1753): the boxes it adds are drawn boxes,
  // so they advertise a window and they stand a lane cue down.
  const door = held
    ? fallbackCellsFor({
        lanes,
        closeMin: REAL.hours.close,
        dropped: drops,
        survivors: sell.cells,
        claims,
        cleanupMinutesByBed: REAL.bedCleanupMinutes,
        held,
        locked: [],
        minSellableMin: REAL.guard.minSellableMin,
        dials: gapPackingDials(lanes, {
          gridMin: REAL.sell.gridMin,
          sessionMin: dur,
          gapFillMin: REAL.guard.gapFillMinMin,
          gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
          nowMinute: REAL.sell.nowMinute,
          frame: priceFrame,
          depth,
          guard: REAL.guard.config,
        }),
      })
    : null
  const drawnPacked = door ? [...gap.packed, ...door.packed] : gap.packed
  const drawnScraps = door ? [...gap.scraps, ...door.scraps] : gap.scraps
  const drawnClaims = door ? [...claims, ...door.claims] : claims
  const heldDrawn = heldDrawnFor(held, lanes, [])
  const heldByLane = new Map(heldDrawn.map((m) => [m.laneKey, m.spans]))
  const explained = explainRails(rails, lanes, {
    dur,
    handId: null,
    stagedId: null,
    sellCells: drawn.cells,
    claims: drawnClaims,
    drops,
    inHand: false,
    sellDisplayed: true,
    held,
    // ⚖ ruling 3 — the screen's own re-seat door, on the same two props
    // `verdictAtLanding` passes and through the same one verdict.
    reseat: {
      hours: REAL.hours,
      nowMinute: REAL.sell.nowMinute,
      cleanupMinutesByBed: REAL.bedCleanupMinutes,
      landingOn: (after, laneKey, start) =>
        landingVerdict(
          after,
          {
            staffLane: laneKey, bedLane: null, solveRoom: true, id: null, requiresPrivate: false,
            start, end: start + dur, span: place(start, start + dur, REAL.hours),
            foreignRefusal: null, hasPrice: false, locked: [],
            minutesOf: (x: number) => minuteOf(x, REAL.hours),
            stagedId: null, now: REAL.sell.nowMinute, cleanupMinutesByBed: REAL.bedCleanupMinutes,
          },
          railsOn(after).find((r) => r.laneKey === laneKey)?.cells.find((x) => x.start === start) ?? null,
        ),
    },
    // ⚖ ruling 1 — the screen's own door (TodayScreen `halfHourFree`), out of
    // the same book, with the same hypothetical asker.
    halfHourFree: (laneKey, start) => {
      const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
      if (!lane) return null
      const asker = { stores: lane.stores, requiresPrivate: false }
      return views.world.bedFor(start, start + 30, asker).compatibleRoomsExist
        ? views.world.freeBedCount(start, start + 30, asker)
        : null
    },
  })
  // ⚖ 8/30 「one number」 — R-E lives here rather than in a pin of its own: the
  // counter is part of every board's reading, so a round that moved it moves
  // this string and the observational pin says so.
  const counter = onlineOffers({
    sell: drawn.staffBands,
    packed: held ? drawnPacked : [],
    scraps: held ? drawnScraps : [],
    reserved: reservedOffersFor(heldDrawn),
    lanes,
    showPrice: true,
  }).label

  const out: Record<string, LaneRead> = {}
  for (const rail of rails) {
    const per = explained.get(rail.laneKey)
    if (!per) continue
    const chips: ChipRow[] = rail.cells.map((c) => {
      const said = per.get(c.start)!
      const word = said.word ?? null
      // The renderer's own face, at rest: the micro-word replaces the bare
      // label, and `data-reason` rides that same word (TodayScreen :6113-6140).
      const mark = said.mark ?? null
      return {
        start: c.start,
        face: mark ? `⇄${clock(c.start)}` : (word ?? c.label),
        state: mark ? 'reseat' : c.state,
        reason: word && !mark ? (c.reason ?? null) : null,
        word: mark ? null : word,
        sentence: said.sentence,
      }
    })
    const cellsHere = drawn.cells.filter((s) => s.group === 'staff' && s.laneKey === rail.laneKey)
    const gapHere = drawnClaims.filter((g) => g.group === 'staff' && g.laneKey === rail.laneKey)
    const cues: CueRow[] = restCueStarts(per, cellsHere, gapHere, heldByLane.get(rail.laneKey) ?? [])
    out[rail.laneKey] = { chips, cues }
  }
  return { counter, lanes: out }
}

// ── §OBSERVATIONAL — NOTHING ELSE MAY CHANGE ───────────────────────────────

/** The board as it read at `origin/main` 5108b554d, before this round. Written
 *  once, by this suite, and never regenerated: a baseline a build may rewrite
 *  is a baseline that proves nothing. */
const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), 'src/__tests__/integration/business/today-rail-halfhour.baseline.json'), 'utf8'),
) as Record<string, BoardRead>

/** Every fact on every chip and every lane cue of every board, as one flat map
 *  of `SCENE/lane@start#field` → value. Cues are one entry per lane, whole,
 *  because this round MERGES neighbouring cues and an index-keyed list would
 *  report a merge as four unrelated changes. */
function flatten(read: Record<string, BoardRead>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [scene, board] of Object.entries(read)) {
    out.set(`${scene}#counter`, board.counter)
    for (const [laneKey, lane] of Object.entries(board.lanes)) {
      for (const chip of lane.chips) {
        const at = `${scene}/${laneKey}@${clock(chip.start)}`
        out.set(`${at}#face`, chip.face)
        out.set(`${at}#state`, chip.state)
        out.set(`${at}#reason`, String(chip.reason))
        out.set(`${at}#word`, String(chip.word))
        out.set(`${at}#sentence`, chip.sentence)
      }
      out.set(`${scene}/${laneKey}#cues`, JSON.stringify(lane.cues))
    }
  }
  return out
}

/** ⚖ LIAM 9/9 gate 2 — THE ENUMERATION. Every key this round is allowed to
 *  move, and nothing else. Each one is pinned to its exact new value by the
 *  red-run that owns it (§R-A…§R-D).
 *
 *  REST — main's own fixture day — is not in any list below, and that is the
 *  first thing to read here: on the board a store looks at all day, not one
 *  half hour is bed-less and not one start needs a re-seat, so the round adds
 *  nothing to it at all. Everything below is on a board Liam FILLED. */

/** ⚖ RULING 1 — the chips whose word the half hour now decides. Every room on
 *  these boards is busy right across the listed half hours, and the ruling is
 *  about the HALF HOUR rather than about one person, so it is every lane's
 *  chip. A/c-03@14:30 is absent on purpose: it already said 満室, and its
 *  sentence — the 60-minute refusal — is untouched. */
const WORDED: Record<string, Record<string, number[]>> = {
  A: { 'c-03': [840, 900], 'p-01': [840, 870, 900], 'p-04': [840, 870, 900], 'p-05': [840, 870, 900], 'p-06': [840, 870, 900] },
  B: { 'c-03': [840], 'p-01': [840], 'p-04': [840], 'p-05': [840], 'p-06': [840] },
}

/** ⚖ RULING 3 — and the one chip that LOSES the word: ごろう's 14:00, whose
 *  half hour has ベッド1 free while the 60-minute start does not. It stops
 *  saying 満室 (「a half hour WITH a free bed never says 満室」) and wears the
 *  「moves someone」 mark instead, because the board can fit the hour by putting
 *  さくら one bed over — which is what the drop already does. Its sentence grows
 *  the two clauses that say so. Nothing else on any of the four boards earns a
 *  mark: this is the one start on Liam's own scenes that fits only by moving. */
const MARKED: Record<string, Record<string, number[]>> = { C: { 'p-05': [840] } }

/** …and the lane tracks whose mark list changed with any of the above. A lane
 *  whose bed-less half hour sits under a drawn box keeps no mark — ⚖ flag 88 —
 *  which is why B/p-05 carries the word and no cue. Scene C is absent: its one
 *  moving track belongs to ruling 2, which is not in this slice. */
const HATCHED: Record<string, string[]> = {
  A: ['c-03', 'p-01', 'p-04', 'p-05', 'p-06'],
  B: ['c-03', 'p-01', 'p-04', 'p-06'],
}

const keysFor = (by: Record<string, Record<string, number[]>>, fields: string[]) =>
  Object.entries(by).flatMap(([scene, lanes]) =>
    Object.entries(lanes).flatMap(([lane, starts]) =>
      starts.flatMap((s) => fields.map((f) => `${scene}/${lane}@${clock(s)}#${f}`)),
    ),
  )

const MAY_MOVE: readonly string[] = [
  ...new Set([
    ...keysFor(WORDED, ['face', 'reason', 'word', 'sentence']),
    ...keysFor(MARKED, ['face', 'state', 'reason', 'word', 'sentence']),
    ...Object.entries(HATCHED).flatMap(([scene, lanes]) => lanes.map((lane) => `${scene}/${lane}#cues`)),
  ]),
]

describe('§OBSERVATIONAL — the round moves exactly what it says it moves', () => {
  it('every other chip, cue and sentence on all four boards is byte-identical to main', () => {
    const now = flatten(Object.fromEntries(boards().map((b) => [b.name, readBoard(b.lanes)])))
    const then = flatten(BASELINE)
    // A key that VANISHED is as much a change as one that moved, so the two
    // key sets are compared before the values.
    expect([...now.keys()].sort()).toEqual([...then.keys()].sort())
    const moved = [...now.entries()].filter(([k, v]) => then.get(k) !== v).map(([k]) => k).sort()
    // The KEYS are the claim; each one's exact new value is pinned by the
    // red-run that owns it below. A key that moved and is not listed prints
    // here with both readings, so a surprise is legible rather than a count.
    expect(moved.map((k) => (MAY_MOVE.includes(k) ? k : `${k}\n   was: ${then.get(k)}\n   now: ${now.get(k)}`)))
      .toEqual([...MAY_MOVE].sort())
  })
})
