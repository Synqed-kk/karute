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
// And his two gates on the round, which is what most of this file is:
//   · THE FIX MUST BE CLEAR — §R-A…§R-D pin, on his own three scenes, exactly
//     what a staffer now sees and reads.
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
import type { SellCell } from '@/business/lib/canon-logic/availability'
import { heldCommittedFor } from '@/app/[locale]/(business)/business/today/held-committed'
import { fallbackCellsFor } from '@/app/[locale]/(business)/business/today/fallback-cells'
import { reservedOffersFor } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import {
  allocateBed,
  applyBedMoves,
  applyBlockMoves,
  applyMoves,
  companionLines,
  companionsFor,
  cursorWord,
  explainRails,
  gestureAllocator,
  handRowStamp,
  liveChipFace,
  gapLayerFor,
  gapPackingDials,
  guardRailsFor,
  heldDrawnFor,
  landingVerdict,
  onlineOffers,
  railChipClass,
  railExplain,
  reservedClause,
  restCueStarts,
  sellDrawnFor,
  sellLayerFor,
  type GuardRail,
  type LandingClass,
  type LandingVerdict,
  type Move,
  type RailCell,
  type RailCue,
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
import { minuteOf, place, type BoardItem, type BoardLane } from '@/business/lib/today-board'

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
/** …plus every span the board DREW on a staff row — the boxes and the 確保
 *  windows §R-F asserts no mark ever sits on top of. Not part of the baseline
 *  comparison: it is the board's own paint, which this round never touches. */
type BoardRead = { counter: string; lanes: Record<string, LaneRead>; drawn: Array<{ laneKey: string; s: number; e: number }> }

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
    // ⚖ ruling 1 — the screen's own door (TodayScreen `bedsOver`), out of
    // the same book, with the same hypothetical asker.
    bedsOver: (laneKey, start, end) => {
      const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
      if (!lane) return null
      const asker = { stores: lane.stores, requiresPrivate: false }
      const answer = views.world.bedFor(start, end, asker)
      if (!answer.compatibleRoomsExist) return null
      return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
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
        // ⚖ 44 + ruling 1 — the dot's class is the WORD's class, decided where
        // the word is: a chip refused for its pocket can wear 満室, and the
        // attribute has to be about the beds it names (TodayScreen `data-reason`).
        reason: mark ? null : (said.wordReason ?? null),
        word: mark ? null : word,
        sentence: said.sentence,
      }
    })
    const cellsHere = drawn.cells.filter((s) => s.group === 'staff' && s.laneKey === rail.laneKey)
    const gapHere = drawnClaims.filter((g) => g.group === 'staff' && g.laneKey === rail.laneKey)
    const laneHere = lanes.find((l) => l.key === rail.laneKey && l.group === 'staff')
    const cues: CueRow[] = restCueStarts(per, cellsHere, gapHere, heldByLane.get(rail.laneKey) ?? [], laneHere?.items ?? [], null)
    out[rail.laneKey] = { chips, cues }
  }
  return {
    counter,
    lanes: out,
    drawn: [
      ...drawn.cells.filter((c) => c.group === 'staff').map((c) => ({ laneKey: c.laneKey, s: c.h, e: c.h + 60 })),
      ...drawnClaims.filter((g) => g.group === 'staff').map((g) => ({ laneKey: g.laneKey, s: g.s, e: g.e })),
      ...heldDrawn.flatMap((m) => m.spans.map((h) => ({ laneKey: m.laneKey, s: h.start, e: h.end }))),
    ],
  }
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

/** ⚖ RULING 1, as ⚖ FIX ROUND 1 (F1) narrows it — the chips whose word the half
 *  hour now decides. ONE chip on the four boards: さぶろう's 15:00, the exact
 *  half hour Liam could not read.
 *
 *  The word rides EMPTY TRACK, like the mark: a 「30-min GAP with no bed」 is a
 *  gap on the row, and a half hour with a booking, a break or 勤務不可 drawn
 *  across it already shows the operator what is in the way. That is what keeps
 *  見本 はなこ's 勤務不可 afternoon at 「—」 — and it is the picture he approved.
 *  A/c-03@14:30 is absent for the other reason: it already said 満室, and its
 *  sentence — the 60-minute refusal — is untouched. */
const WORDED: Record<string, Record<string, number[]>> = { A: { 'c-03': [900] } }

/** ⚖ RULING 3 — and the one chip that LOSES the word: ごろう's 14:00, whose
 *  half hour has ベッド1 free while the 60-minute start does not. It stops
 *  saying 満室 (「a half hour WITH a free bed never says 満室」) and wears the
 *  「moves someone」 mark instead, because the board can fit the hour by putting
 *  さくら one bed over — which is what the drop already does. Its sentence grows
 *  the two clauses that say so. Nothing else on any of the four boards earns a
 *  mark: this is the one start on Liam's own scenes that fits only by moving. */
const MARKED: Record<string, Record<string, number[]>> = { C: { 'p-05': [840] } }

/** ⚖ RULING 2 — the quiet half hour on a FREE person whose one bed is being
 *  sold on somebody else's row. The chip itself does not move (it is still the
 *  ✓ or △ the board always gave it); what moves is the mark on the track and
 *  the SENTENCE, which now names the person who has the bed. ⚠ MOCK FINDING 1:
 *  today's taker lookup never fires on this board — the sell layer hands the
 *  hour's single free bed to the first free staff in lane order and drops
 *  nothing — so the press used to end in the bare 「販売可能枠が出ていません」. */
const SOLD: Record<string, Record<string, number[]>> = { B: { 'p-04': [870] }, C: { 'p-05': [870] } }

/** …and the lane tracks whose mark list changed with any of the above — THREE
 *  of the eleven lanes on the four boards, because ⚖ flag 88 keeps the mark to
 *  genuinely empty track and most of these newly-worded half hours have a card,
 *  a break or an absence drawn across them. さぶろう's is the one Liam pointed
 *  at: an empty 14:30〜15:30 with no bed behind it, now one mark reading 満室.
 *  しろう's two are the 満室 half hour he could not read and the quiet hour whose
 *  bed went to somebody else. */
const HATCHED: Record<string, string[]> = { A: ['c-03'], B: ['p-04'], C: ['p-05'] }

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
    ...keysFor(SOLD, ['sentence']),
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

// ── §R-A…§R-F — WHAT A STAFFER NOW SEES, ON LIAM'S OWN THREE SCENES ────────
//
// The observational pin above says WHERE the board moved. These say WHAT it
// moved to, in the operator's own words, on the boards his shots were taken on.

const laneOf = (lanes: BoardLane[], key: string) => lanes.find((l) => l.key === key && l.group === 'staff')!

describe('§R-A — さぶろう’s 14:30 AND 15:00 both say 満室, under ONE hatch (shot 1.55.15)', () => {
  it('the chip he could read and the chip he could not now say the same thing', () => {
    const c03 = readBoard(sceneA()).lanes['c-03']
    const at = (m: number) => c03.chips.find((x) => x.start === m)!
    // 14:30 — the start the ROOMS refuse, which already said 満室.
    expect(at(870).face).toBe('満室')
    expect(at(870).reason).toBe('bed')
    // 15:00 — the start his 15:30 break refuses, which used to say 「—」 while
    // all three beds were busy through it. ⚖ ruling 1: 「every box that is 満室
    // should say 満室 … A 30-min gap with no bed is not a gap」.
    expect(at(900).face).toBe('満室')
    expect(at(900).reason).toBe('bed')
    // ⚖ WORDS-FINAL — and its sentence is the HALF HOUR's bed refusal ALONE.
    // The break that refuses the 60 is drawn on the row above it; saying it
    // twice is the same refusal said twice (mock fix round 2, item D).
    expect(at(900).sentence).toBe(
      '15:00〜15:30はベッドに空きがありません。ベッド1（見本 きり様）、ベッド2（見本 かえる様 14:30〜15:30）、ベッド3（見本 さくら様 15:00〜16:00）が使用中です',
    )
    expect(at(900).sentence).not.toContain('60分の連続した空きがありません')
    // …while 14:30's sentence is the 60-minute refusal, byte-unchanged: that
    // chip was already answering about the beds.
    expect(at(870).sentence).toBe(
      '14:30〜15:30はベッドに空きがありません。ベッド1（テスト えいた様 14:00〜15:00・見本 きり様 15:00〜15:30）、ベッド2（見本 かえる様）、ベッド3（テスト なぎ様 14:05〜15:00・見本 さくら様 15:00〜16:00）が使用中です',
    )
  })

  it('the lane carries ONE mark 14:30〜15:30 reading 満室 — not two with a seam', () => {
    const cues = readBoard(sceneA()).lanes['c-03'].cues
    expect(cues).toContainEqual({ start: 870, end: 930, kind: 'bed', label: ['満室'] })
    // 14:00 is bed-less too and it is a SEPARATE mark, because かえる's card is
    // drawn over 13:00〜14:30 and the run does not survive a drawn box… on this
    // lane it does run on, so the honest assertion is the merge law itself:
    // every mark on this lane is a contiguous run of one label.
    for (const cue of cues) expect((cue.end - cue.start) % 30).toBe(0)
    // …and no two marks touch, or they would have been merged.
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i].start === cues[i - 1].end && cues[i].label.join('') === cues[i - 1].label.join('')).toBe(false)
    }
  })
})

describe('§R-B — しろう’s quiet 14:30 says where the sale went (shot 1.38.20)', () => {
  it('the chip is untouched, the lane says 別の枠で販売中, and the press NAMES さぶろう', () => {
    const p04 = readBoard(sceneB()).lanes['p-04']
    const chip = p04.chips.find((x) => x.start === 870)!
    // ⚖ ruling 3's other half — this half hour HAS a bed, so nothing about the
    // chip changes: it is the same △ the board always gave it.
    expect(chip.face).toBe('△14:30')
    expect(chip.word).toBeNull()
    expect(chip.state).toBe('degraded')
    // ⚖ ruling 2 + FIX ROUND 1 (F3) — the reason is visible without a press, over
    // the WHOLE quiet hour. The mark is a fact about each half hour's bed, not
    // about the chip's 60-minute verdict: 15:00 is refused by しろう's own 記録
    // block, and that says nothing about where his 15:00〜15:30 bed went. Two
    // half hours, one merged mark — the approved mock's own 60-minute node.
    expect(p04.cues).toContainEqual({ start: 870, end: 930, kind: 'sold', label: ['別の枠で', '販売中'] })
    // …and the 15:00 chip's own face and sentence are untouched by the mark.
    const at15 = p04.chips.find((x) => x.start === 900)!
    expect(at15.face).toBe('—')
    expect(at15.sentence).toBe('この開始には60分の連続した空きがありません（15:00〜16:00）')
    // …and the press names the person who has the bed. ⚠ MOCK FINDING 1: today
    // it did not — the sell layer handed the hour's one free bed to the first
    // free staff in lane order and dropped nothing, so the clause was bare.
    expect(chip.sentence).toContain('ベッドは別のスタッフ（テスト さぶろう）の枠が使うため、ここには販売可能枠を出していません')
  })

  it('both of ⚖ 75(i)’s gates still hold — the dial the operator turned off, and the law’s own hold', () => {
    const lanes = sceneB()
    const dur = REAL.guard.standardSessionMin
    const rails = railsOn(lanes)
    const views = bedViewsFor(lanes, DAY_FRAME(), null)
    const ask = (over: Partial<Parameters<typeof explainRails>[2]>) =>
      explainRails(rails, lanes, {
        dur, handId: null, stagedId: null, sellCells: [], claims: [], drops: [], inHand: false, sellDisplayed: true,
        bedsOver: (laneKey, start, end) => {
          const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
          if (!lane) return null
          const asker = { stores: lane.stores, requiresPrivate: false }
          const answer = views.world.bedFor(start, end, asker)
          if (!answer.compatibleRoomsExist) return null
          return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
        },
        ...over,
      })
    const box: SellCell = { laneKey: 'c-03', resourceKey: 'bed-02', group: 'staff', staff: 'c-03', bed: 'ベッド2', h: 870, price: 7010, tier: 2 }
    // With the box drawn and the layer on screen, the mark and the name appear.
    expect(ask({ sellCells: [box] }).get('p-04')!.get(870)!.cue).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
    // 表示設定 → 空き枠表示「非表示」 hides every box, so EVERY window is ad-less
    // and this mark would appear on a display the operator switched off
    // themselves. The clause explains an absence the board chose, never one the
    // operator did — and the mark inherits that gate whole.
    expect(ask({ sellCells: [box], sellDisplayed: false }).get('p-04')!.get(870)!.cue).toBeNull()
    // …and a 新規用に確保 window is not an unexplained hole either: the 確保
    // chip is drawn over it and E3b's clause is what answers there (⚖ flag 88 +
    // E3b), so the mark stands down inside a held span.
    const held = [{ laneKey: 'p-04', protectedCount: 1, spans: [{ start: 870, end: 960, windowStart: 870 }] }]
    expect(ask({ sellCells: [box], held }).get('p-04')!.get(870)!.cue).toBeNull()
  })
})

describe('§R-C — ごろう’s 14:00 fits by moving さくら one bed over (shot 1.43.41)', () => {
  it('the chip is ⇄14:00, with no word, no dot and no lane mark', () => {
    const chip = readBoard(sceneC()).lanes['p-05'].chips.find((x) => x.start === 840)!
    expect(chip.face).toBe('⇄14:00')
    expect(chip.state).toBe('reseat')
    // Not a refusal: no micro-word, so no 3px dot rides `data-reason`.
    expect(chip.word).toBeNull()
    expect(chip.reason).toBeNull()
    // And nothing on the track: the half hour is not full, so there is no
    // 満室 to hatch, and the box drawn over it would contradict one anyway.
    expect(readBoard(sceneC()).lanes['p-05'].cues.some((c) => c.start <= 840 && 840 < c.end)).toBe(false)
  })

  it('the press names who moves, where to, and what it costs — every clause product-composed', () => {
    const chip = readBoard(sceneC()).lanes['p-05'].chips.find((x) => x.start === 840)!
    expect(chip.sentence).toBe(
      '14:00〜15:00はベッドに空きがありません。ベッド1（見本 さくら様 14:30〜15:30）、ベッド2（見本 かえる様 13:00〜14:30）、ベッド3（テスト なぎ様 14:05〜15:05）が使用中です' +
        '。ここに置くと、ほかのお客様のベッドを入れ替えて収めます（見本 さくら様 ベッド1 → ベッド2）' +
        '。ここに置くと13:30〜15:00の新規（90分）が入らなくなります',
    )
    // ⛔ the OPERATOR's own gesture verbs stay out of a sentence about what the
    // board does by itself (WORDS §Do-not-say).
    expect(chip.sentence).not.toContain('移動')
    expect(chip.sentence).not.toContain('移せば')
  })

  it('⚖ flag 54 — the strip promises exactly what the drop stages, on the same board', () => {
    const lanes = sceneC()
    const dur = REAL.guard.standardSessionMin
    const q = {
      staffLane: 'p-05', bedLane: null, solveRoom: true, id: null, requiresPrivate: false,
      start: 840, end: 840 + dur, span: place(840, 840 + dur, REAL.hours),
      foreignRefusal: null, hasPrice: false, locked: [] as string[],
      minutesOf: (x: number) => minuteOf(x, REAL.hours),
      stagedId: null, now: REAL.sell.nowMinute, cleanupMinutesByBed: REAL.bedCleanupMinutes,
    }
    const cell = railsOn(lanes).find((r) => r.laneKey === 'p-05')!.cells.find((x) => x.start === 840)!
    const drop = landingVerdict(lanes, { ...q, pack: true }, cell)
    // The drop moves exactly one person, and the mark named that person.
    expect(drop.reseats).toEqual([{ id: 'apt-26', from: 'bed-01', to: 'bed-02' }])
    expect(companionLines(lanes, companionsFor(lanes, drop.reseats))).toEqual(['見本 さくら様 ベッド1 → ベッド2'])
    // …and the amber the chip wears is the drop's own verdict on the board the
    // shuffle leaves — never the guard read a second way.
    const after = applyBedMoves(lanes, companionsFor(lanes, drop.reseats), REAL.hours, REAL.bedCleanupMinutes)
    const afterCell = railsOn(after).find((r) => r.laneKey === 'p-05')!.cells.find((x) => x.start === 840)!
    const staged = landingVerdict(after, q, afterCell)
    expect(staged.kind).toBe('caution')
    expect(readBoard(lanes).lanes['p-05'].chips.find((x) => x.start === 840)!.sentence).toContain(staged.reason!)
  })
})

// ── §R-D — the precedence, on scenes built to hold each rung ───────────────

const HOURS = { open: 600, close: 1140 }
const HAND_GUARD = {
  services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
  newClientSessionMin: 90,
  protectedLabel: '新規',
  gapFillMinMin: 30,
  leadTimeMin: 0,
  mode: 'standard' as const,
}

function handItem(over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'caseId'>, start: number, end: number): BoardItem {
  return {
    kind: 'booking', state: 'confirmed', category: 'repeat', ...place(start, end, HOURS),
    title: '見本 はなこ', tag: '', time: '', ticketCat: '単発', ticketCore: null, held: false, micro: false,
    label: '', ...over,
  }
}
function handLane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key, sub: '', absentNote: null, mine: false, items: [],
    window: over.group === 'staff' ? { from: HOURS.open, until: HOURS.close } : null,
    untilLabel: over.group === 'staff' ? '19:00' : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

/** The screen's composition on a hand-built board: the round's door out of the
 *  book, and nothing else supplied, so each rung of the precedence is the only
 *  thing the scene varies. */
function handRails(lanes: BoardLane[]) {
  const views = bedViewsFor(lanes, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, null)
  const bedFree = bedDoor(views, lanes, null)
  return guardRailsFor(lanes, {
    open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
    nowMinute: null, locked: [], guard: HAND_GUARD, excludeId: null,
    placementFeasible: bedFree, protectedWindowFeasible: bedFree, resting: null,
  })
}

function explainHand(lanes: BoardLane[], over: Partial<Parameters<typeof explainRails>[2]> = {}) {
  const frame = { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }
  const views = bedViewsFor(lanes, frame, null)
  const rails = handRails(lanes)
  return explainRails(rails, lanes, {
    dur: 60, handId: null, stagedId: null, sellCells: [], claims: [], drops: [],
    inHand: false, sellDisplayed: true,
    bedsOver: (laneKey, start, end) => {
      const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
      if (!lane) return null
      const asker = { stores: lane.stores, requiresPrivate: false }
      const answer = views.world.bedFor(start, end, asker)
      if (!answer.compatibleRoomsExist) return null
      return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
    },
    ...over,
  })
}

describe('§R-D — the precedence Liam approved, rung by rung', () => {
  it('a half hour whose every blocker is a turnaround says 清掃, not 満室', () => {
    // ⚖ 8/26 — a window being turned over is not a busy house. The class is read
    // off the walk `allocateBed` already did for the HALF HOUR, never re-derived.
    const lanes = [
      handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ' }),
      handLane({
        key: 'bed-01', group: 'beds', label: 'ベッド1',
        items: [{ ...handItem({ key: 'cl', caseId: null }, 780, 810), kind: 'cleanup' as const, state: null, category: null, title: '清掃' }],
      }),
    ]
    const said = explainHand(lanes).get('p-01')!.get(780)!
    expect(said.word).toBe('清掃')
    expect(said.cue).toEqual({ kind: 'bed', label: ['清掃'] })
  })

  it('新規用 keeps its word and grows no mark — and the two rungs can never actually contend', () => {
    // The precedence Liam approved puts 新規用 above 満室, so this pin is about
    // the rung UNDER it: a 確保 chip keeps its word, carries no mark (the 確保
    // chip E3b paints is what explains that emptiness — ⚖ 8/30 + flag 88)…
    const rest = readBoard(REAL.lanes)
    const guarded = Object.values(rest.lanes).flatMap((l) => l.chips.filter((c) => c.word === '新規用'))
    expect(guarded.length).toBeGreaterThan(0)
    for (const c of guarded) expect(c.reason).toBe('guard')
    for (const [laneKey, lane] of Object.entries(rest.lanes)) {
      for (const c of lane.chips.filter((x) => x.word === '新規用')) {
        expect({ at: `${laneKey}@${clock(c.start)}`, marked: lane.cues.some((q) => q.start <= c.start && c.start < q.end) })
          .toEqual({ at: `${laneKey}@${clock(c.start)}`, marked: false })
      }
    }
    // …and the two rungs cannot meet at all, which is worth knowing rather than
    // guessing: a guard refusal means the ENGINE got past the rooms, and it only
    // does that when a bed is free for the whole judged window — so every half
    // hour inside one has a bed. FOUND BY THIS ROUND's red-run, on all four
    // boards; a scene built to hold the contention could not be built.
    for (const b of boards()) {
      const views = bedViewsFor(b.lanes, DAY_FRAME(), null)
      for (const rail of railsOn(b.lanes)) {
        const lane = laneOf(b.lanes, rail.laneKey)
        for (const cell of rail.cells.filter((x) => x.reason === 'guard')) {
          const asker = { stores: lane.stores, requiresPrivate: false }
          expect({ at: `${b.name}/${rail.laneKey}@${clock(cell.start)}`, free: views.world.freeBedCount(cell.start, cell.start + 30, asker) > 0 })
            .toEqual({ at: `${b.name}/${rail.laneKey}@${clock(cell.start)}`, free: true })
        }
      }
    }
  })

  it('a lane sharing no store with any room keeps the bare 「—」 and the no-rooms sentence — never 満室 (#777)', () => {
    const lanes = [
      handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-z'] }),
      handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    ]
    const said = explainHand(lanes).get('p-01')!.get(780)!
    expect(said.word).toBeNull()
    expect(said.cue).toBeNull()
    expect(said.sentence).toBe('この店舗には使えるベッドがありません')
    expect(said.sentence).not.toContain('満室')
  })
})

// ── §R-E / §R-F — the number, and the law about where a mark may sit ───────

describe('§R-E — the 「one number」 counter is untouched on every board', () => {
  it('オンライン販売中 N窓 reads exactly what it read on main', () => {
    for (const b of boards()) expect(readBoard(b.lanes).counter).toBe(BASELINE[b.name].counter)
  })
})

describe('§R-F — ⚖ flag 88: a mark never sits on top of something the board drew', () => {
  it('no cue on any lane of any board overlaps a drawn box or a 確保 span', () => {
    for (const b of boards()) {
      const read = readBoard(b.lanes)
      const boxes = read.drawn
      for (const [laneKey, lane] of Object.entries(read.lanes)) {
        for (const cue of lane.cues) {
          for (const box of boxes.filter((x) => x.laneKey === laneKey)) {
            expect({ at: `${b.name}/${laneKey}@${clock(cue.start)}`, over: box.s < cue.end && cue.start < box.e })
              .toEqual({ at: `${b.name}/${laneKey}@${clock(cue.start)}`, over: false })
          }
        }
      }
    }
  })
})

// ── §BEHAVIOURAL — WHAT THE STRIP ASKS, COUNTED, IN EACH STATE ─────────────
//
// ⚖ THE KICKOFF'S OWN INSTRUCTION: 「fence it BEHAVIOURALLY (count allocator
// calls per frame in a test that drives the surface), not by grep — the 9/8
// grep pin missed a positional `true`」. today-bed-packing R9 counts the
// literal; this counts the ASKS, which is the thing the fence is actually
// about. The allocator is handed in, so every question `explainRails` puts and
// the shape of each one is readable here.

type Ask = Parameters<typeof allocateBed>[1]

function counting() {
  const asks: Ask[] = []
  const allocate: typeof allocateBed = (lanes, opts) => {
    asks.push(opts)
    return allocateBed(lanes, opts)
  }
  return { asks, allocate, packs: () => asks.filter((a) => a.pack === true) }
}

/** The screen's rest-layer composition on any board, with the round's two doors
 *  and a caller-supplied allocator — the same arguments `railExplained` builds.
 *  `handId` also picks the rails' own world, exactly as the screen does. */
function explainWith(lanes: BoardLane[], allocate: typeof allocateBed, over: { handId?: string | null; inHand?: boolean } = {}) {
  const handId = over.handId ?? null
  const views = bedViewsFor(lanes, DAY_FRAME(), handId)
  const dur = REAL.guard.standardSessionMin
  const rails = guardRailsFor(lanes, {
    open: REAL.hours.open, close: REAL.hours.close, stepMin: 30, dur,
    protectedDur: REAL.guard.protectedDurationMin, nowMinute: REAL.sell.nowMinute,
    locked: [], guard: REAL.guard.config, excludeId: handId,
    placementFeasible: bedDoor(views, lanes, handId),
    protectedWindowFeasible: bedDoor(views, lanes, null),
    resting: null,
  })
  return explainRails(rails, lanes, {
    dur, handId, stagedId: null, sellCells: [], claims: [], drops: [],
    inHand: over.inHand ?? false, sellDisplayed: true,
    allocate,
    bedsOver: (laneKey, start, end) => {
      const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
      if (!lane) return null
      const asker = { stores: lane.stores, requiresPrivate: false }
      const answer = views.world.bedFor(start, end, asker)
      if (!answer.compatibleRoomsExist) return null
      return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
    },
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
  })
}

describe('§BEHAVIOURAL — the packing search never runs per frame', () => {
  it('(i) thirty frames of an ordinary drag: ZERO asks of any kind', () => {
    // The commonest gesture — a card carried along its own staff row. The map
    // is not composed at all while it is in flight, so nothing is asked and
    // nothing is thrown away (⚖ 44 fix round, blind lens 4).
    const spy = counting()
    for (let f = 0; f < 30; f += 1) expect(explainWith(sceneC(), spy.allocate, { inHand: true, handId: 'apt-26' }).size).toBe(0)
    expect({ frames: 30, asks: spy.asks.length }).toEqual({ frames: 30, asks: 0 })
  })

  it('(ii) thirty frames of a BED-LANE drag: the room probes run, and not ONE of them packs', () => {
    // The three gestures that get past `inHand` — a bed-row drag, a resize and a
    // drag over the shelf — reach this map with a card in hand. They pay what
    // they always paid (one room probe per bed-refused chip) and nothing more:
    // a backtracking search on a pointer frame is the exact cost design §3
    // forbids, and the mark is a fact about a placement nobody has made.
    //
    // The hand is テスト くらら's 10:30 card, deliberately NOT one of the three
    // occupants of the 14:00 hour: lifting a blocker out (⚖ R3) frees the room
    // and the refusal simply vanishes, which would prove nothing about cost.
    const spy = counting()
    for (let f = 0; f < 30; f += 1) explainWith(sceneC(), spy.allocate, { handId: 'apt-22' })
    expect(spy.asks.length).toBeGreaterThan(0)
    expect({ frames: 30, packs: spy.packs().length }).toEqual({ frames: 30, packs: 0 })
    // …and the ordinary drag above pays nothing at all, so the two states are
    // told apart by the counts rather than by the wiring being trusted.
    expect(spy.asks.every((a) => a.pack !== true)).toBe(true)
  })

  it('(iii) at REST the pack runs once per marker candidate — no more, no fewer', () => {
    const lanes = sceneC()
    const spy = counting()
    explainWith(lanes, spy.allocate)
    // The candidates, counted a second way and independently: a start the rooms
    // refused for the strip's own length whose first half hour still has a bed.
    const views = bedViewsFor(lanes, DAY_FRAME(), null)
    const candidates = railsOn(lanes).flatMap((rail) =>
      rail.cells.filter(
        (c) =>
          c.reason === 'bed' &&
          views.world.freeBedCount(c.start, c.start + 30, { stores: laneOf(lanes, rail.laneKey).stores, requiresPrivate: false }) > 0,
      ),
    )
    expect(candidates.length).toBeGreaterThan(0)
    expect({ candidates: candidates.length, packs: spy.packs().length })
      .toEqual({ candidates: candidates.length, packs: candidates.length })
    // …and every packing ask carries the two facts it cannot be honest without.
    for (const a of spy.packs()) {
      expect(a.now).toBe(REAL.sell.nowMinute)
      expect(a.cleanupMinutesByBed).toBe(REAL.bedCleanupMinutes)
      expect(a.end - a.start).toBe(REAL.guard.standardSessionMin)
    }
  })

  it('(iv) a board with nothing to re-seat pays nothing — main’s own day asks zero packs', () => {
    // REST has no bed-refused chip at all, so the marker never even reaches its
    // search: the cost of this round on the board a store looks at all day is
    // one extra half-hour question per chip, and no packing at all.
    const spy = counting()
    explainWith(REAL.lanes, spy.allocate)
    expect(spy.packs()).toHaveLength(0)
  })
})

// ── §BEHAVIOURAL (v) — WHAT A LIVE DRAG ASKS, COUNTED, NOW THAT IT PACKS ────
//
// ⚖ LIVE-WHILE-DRAGGING (2026-09-11). Clauses (i)–(iv) above answer for a board
// whose strip does NOT pack per frame. This one answers for the board that does:
// while an unstaged card is in hand the strip and the cursor ask the DROP's own
// question on every frame, and what makes that affordable is that one gesture's
// answers are one small set. So the fence here is not 「zero packs」 any more —
// it is 「one search per distinct question, and the drop pays none of them
// twice」, which is a thing only a counting allocator can say.
//
// It drives the REAL functions: `applyMoves` builds each frame's board exactly
// as the screen does (both copies at the live span), `gestureAllocator` is the
// product's, and every ask goes through `landingVerdict`'s own seam.
//
// ⚠ THE MUTANT (i) AND (ii) CANNOT SEE, named here because clause (b) is what
// catches it: moving `boardLanesRef.current = boardLanes` out of the render body
// and into an effect leaves the ref one frame stale, so every chip fails the
// memo's board-family gate and passes straight through. Every ANSWER stays
// correct and only the COST changes — a grep and a green battery are both blind
// to it, and 「a second sweep of the same lattice asks the allocator nothing」
// goes red on it immediately.
//
// ⚠ THE ORDER AT THE DROP, assumed and stated: `applyDragFrame` calls `setLive`
// before `paintProxyVerdict`, and React 18 flushes the batched state only after
// the rAF callback returns — so the aimed chip's slot is always written before
// the render that reads it. `clearDrag()` runs before the release's own verdict
// for the same reason. If a render ever did flush between the two, the hand-row
// stamp is the guard: the board it would re-derive is the board the memo keys on.

/** The screen's own live chain for ONE ordinary staff-row move (G1), rebuilt
 *  from the props. Every ask it makes is counted, and the allocator the memo
 *  falls back to is the spy, so 「how many searches did this frame pay?」 is a
 *  number rather than an argument. */
function liveRig(rest: BoardLane[], hand: { id: string; bed: string }) {
  const asks: Array<{ lanes: BoardLane[]; opts: Ask }> = []
  const base: typeof allocateBed = (lanes, opts) => {
    asks.push({ lanes, opts })
    return allocateBed(lanes, opts)
  }
  let boardLanes = rest
  let cleanup = REAL.bedCleanupMinutes
  // THE SCREEN'S OWN WORLD STAMP, modelled rather than faked: `useMemo` hands
  // back the SAME object until one of its dependencies changes identity, so the
  // three mid-gesture disturbances below reach the memo exactly the way they
  // reach it on the board — through the dep list, which is pinned by exact text
  // in today-bed-packing §B.
  let placedLanes: unknown = rest
  let pending: unknown = null
  // The four the screen also lists and this rig never moves — they are in the
  // tuple so the dep list under test is the SCREEN's, not a shortened copy.
  const parked: unknown[] = []
  const addedHere: unknown[] = []
  const moves: object = {}
  const bedMoves: object = {}
  let depsAt: unknown[] = []
  let stamp: object = {}
  const world = () => {
    const deps = [placedLanes, parked, addedHere, moves, bedMoves, pending, REAL.hours, REAL.sell.nowMinute, cleanup]
    if (deps.some((d, i) => d !== depsAt[i]) || deps.length !== depsAt.length) {
      depsAt = deps
      stamp = {}
    }
    return stamp
  }
  const memo = gestureAllocator({
    handId: hand.id,
    stamp: world,
    board: () => boardLanes,
    rowStamp: () => handRowStamp(boardLanes, hand.id, hand.bed),
    base,
  })
  const dur = REAL.guard.standardSessionMin
  /** One pointer frame: the hand's card written onto BOTH rows at the live span,
   *  exactly as `liveMoves`/`liveBedMoves` do it (TodayScreen :1279-1290). */
  const frameAt = (laneKey: string, start: number) => {
    const span = place(start, start + dur, REAL.hours)
    boardLanes = applyMoves(
      rest,
      { [hand.id]: { laneKey, ...span } },
      [],
      [],
      REAL.hours,
      { [hand.id]: { laneKey: hand.bed, ...span } },
      cleanup,
    )
    return span
  }
  /** `TodayScreen.verdictFor` — the board's own inputs to `landingVerdict`, with
   *  the gesture's memo on the question every consumer already builds. */
  const verdictFor = (laneKey: string | null, start: number, cell: RailCell | null, pack: boolean, lanes = boardLanes) =>
    landingVerdict(
      lanes,
      {
        staffLane: laneKey,
        bedLane: hand.bed,
        solveRoom: true,
        id: hand.id,
        requiresPrivate: false,
        foreignRefusal: null,
        hasPrice: true,
        start,
        end: start + dur,
        span: place(start, start + dur, REAL.hours),
        locked: [],
        minutesOf: (x: number) => minuteOf(x, REAL.hours),
        stagedId: null,
        now: REAL.sell.nowMinute,
        cleanupMinutesByBed: cleanup,
        pack,
        allocate: memo.allocate,
      },
      cell,
    )
  /** `verdictAtLanding` — the gesture END, whole: the solve, and the guard's
   *  re-read on the board the shuffle would leave. */
  const dropAt = (laneKey: string, start: number) => {
    const v = verdictFor(laneKey, start, cellAt(boardLanes, laneKey, start, hand.id), true)
    if (v.reseats.length === 0) return v
    const shuffled = applyBedMoves(boardLanes, companionsFor(boardLanes, v.reseats), REAL.hours, cleanup)
    return { ...verdictFor(laneKey, start, cellAt(shuffled, laneKey, start, hand.id), true, shuffled), reseats: v.reseats }
  }
  /** `solveBed` — the second door, which STAGES the answer. */
  const solveBed = (laneKey: string, start: number) =>
    memo.allocate(boardLanes, {
      id: hand.id,
      currentBed: hand.bed,
      stores: boardLanes.find((l) => l.key === laneKey)?.stores ?? null,
      requiresPrivate: false,
      start,
      end: start + dur,
      stagedId: null,
      pack: true,
      now: REAL.sell.nowMinute,
      cleanupMinutesByBed: cleanup,
    })
  return {
    memo,
    dur,
    frameAt,
    verdictFor,
    dropAt,
    solveBed,
    board: () => boardLanes,
    /** Packing searches this frame's board actually paid — asks that reached the
     *  allocator itself, on THIS board family. A re-judge on a shuffled board is
     *  a different family by design and is counted separately where it matters. */
    packsOn: (lanes: BoardLane[]) => asks.filter((a) => a.opts.pack === true && a.lanes === lanes).length,
    packs: () => asks.filter((a) => a.opts.pack === true).length,
    reset: () => { asks.length = 0 },
    /** The operator stages or confirms a card mid-gesture. */
    changePending: () => { pending = { id: 'somebody' } },
    /** A server refresh hands the board a new `placedLanes` identity. */
    refreshServer: () => { placedLanes = [...(placedLanes as unknown[])] },
    /** A room's turnaround changes under the card. */
    changeCleanup: (next: Record<string, number>) => { cleanup = next },
    /** ⚖ FIX ROUND 1 (F2) — the two values the SCREEN's ⇄ fill gate compares.
     *  They are the same two the memo clears on, read from the same places. */
    worldStamp: world,
    rowStamp: () => handRowStamp(boardLanes, hand.id, hand.bed),
  }
}

/** ⚖ FIX ROUND 2 (FX-B — ADDENDUM STOP 1) — THE ON-DEMAND COMPOSER'S RULE, AS
 *  SOMETHING THAT CAN BE ASKED.
 *
 *  `composeSlot()` lives in TodayScreen's render body and NO SUITE IN THIS REPO
 *  RENDERS TodayScreen, so the rule is driven here against a hand-built store
 *  and the LINES that spell it in the product are pinned as text in
 *  today-bed-packing §B. Neither half is armour on its own: a rule nobody can
 *  execute proves nothing, and a pinned line nobody exercised proves nothing
 *  either.
 *
 *  It replaces fix round 1's refill-on-clear gate, which was correct and cost
 *  33 rebuilds and p95 114.5 ms of a 68-frame gesture on the 30-lane board. The
 *  rule now, in one sentence: a candidate whose (lane · start · length · SET OF
 *  MOVES) is already in the map is REUSED; anything else is composed on the
 *  spot, on one shuffled board per distinct set of moves for the whole gesture. */
/** ⚖ FIX ROUND 3 (DELTA-CODE-D1 MAJOR 2) — ONE COMPARE, TWO CACHES. Mirrors the
 *  screen's own `gestureStore()`: the board compare that drops the gesture's
 *  shuffled boards drops the companion LINES composed from them with it, because
 *  both are views of the world as it was. It sits in its own door for the same
 *  reason it does on the screen — a chip whose slot HITS never reaches the
 *  composer, so a compare that lived only there could not protect the lines. */
/** ⚖ FIX ROUND 4 (Greptile #884 4/5) — TWO COMPARES, AND ONLY ONE OF THEM MAY
 *  TOUCH THE SLOTS. The BOARD changes on every frame of a gesture because the
 *  hand's own live claim is in it, so dropping the previews on that compare is
 *  fix round 1's refill — 33 rebuilds and p95 114.5 ms on the 30-lane board,
 *  measured and ruled out. The WORLD (the board MINUS the hand: a staged card,
 *  a server refresh, a room's turnaround, `now`) is rare and is not a preview
 *  question at all — a slot composed before it moved describes a board nobody
 *  is looking at, and the set of moves in the key cannot catch it because an
 *  UNCHANGED rescue under a CHANGED world carries the SAME key. */
function spendCaches(
  store: { slots?: Map<string, LandingClass>; shuffledFor: Map<string, number>; linesFor?: Map<string, number>; base?: unknown; world?: unknown },
  base: unknown,
  world: unknown = store.world,
): void {
  if (store.world !== world) {
    store.world = world
    store.slots?.clear()
    store.shuffledFor.clear()
    store.linesFor?.clear()
  }
  if (store.base !== base) {
    store.base = base
    store.shuffledFor.clear()
    store.linesFor?.clear()
  }
}

/** ⚖ FIX ROUND 3 (DELTA-CODE-D1 MAJOR 2) — THE ⇄ CHIP'S COMPANION LINES, AS A
 *  RULE THAT CAN BE ASKED: composed once per SET OF MOVES, reused by every chip
 *  wearing that rescue, and dropped when the board underneath moves. Before it,
 *  the renderer walked the board twice per marked chip per pointer frame. */
function linesRule(
  store: { shuffledFor: Map<string, number>; linesFor: Map<string, number>; base?: unknown; world?: unknown },
  moveSet: string,
  compose: () => number,
  base: unknown = store.base,
  world: unknown = store.world,
): { composed: boolean; entries: number } {
  spendCaches(store, base, world)
  const had = store.linesFor.get(moveSet)
  if (had !== undefined) return { composed: false, entries: store.linesFor.size }
  store.linesFor.set(moveSet, compose())
  return { composed: true, entries: store.linesFor.size }
}

function slotRule(
  store: { slots: Map<string, LandingClass>; shuffledFor: Map<string, number>; linesFor?: Map<string, number>; base?: unknown; world?: unknown },
  laneKey: string,
  start: number,
  dur: number,
  moveSet: string,
  compose: () => LandingClass,
  /** ⚖ FIX ROUND 1B (FX-D) — the BOARD the shuffles below are a view of. It
   *  defaults to the one the store already holds, so a caller that does not care
   *  about the world moving is asking exactly the question it asked before. */
  base: unknown = store.base,
  /** ⚖ FIX ROUND 4 — the WORLD the slots were composed under: the board MINUS
   *  the hand. It defaults to the one the store already holds, so every caller
   *  written before this round is asking exactly the question it asked before. */
  world: unknown = store.world,
): { kind: LandingClass; composed: boolean; shuffles: number } {
  // ⚖ FIX ROUND 1B (FX-D) — the compare that spends the caches…
  // ⚖ FIX ROUND 4 — …and it runs BEFORE the hit, not after it. It sat below the
  // hit while it could not touch the SLOTS: a found slot read a map the compare
  // would not have changed, so a hit never needed to ask. The world compare can
  // drop slots, and a lazy sweep would let the first chip of a render read a
  // stale entry and only clear the map for its neighbours — half a swept frame.
  // The screen spells the same ordering: the store's door is called once in the
  // render body, above the strips, and not only from inside the composer.
  spendCaches(store, base, world)
  const key = `${laneKey}|${start}|${dur}|${moveSet}`
  const had = store.slots.get(key)
  if (had !== undefined) return { kind: had, composed: false, shuffles: store.shuffledFor.size }
  if (!store.shuffledFor.has(moveSet)) store.shuffledFor.set(moveSet, store.shuffledFor.size + 1)
  const kind = compose()
  store.slots.set(key, kind)
  return { kind, composed: true, shuffles: store.shuffledFor.size }
}

/** ⚖ FIX ROUND 2 (FX-A) — THE ⇄ FILL'S OWN FENCE, AS A RULE THAT CAN BE ASKED.
 *
 *  Same armour as the gate above: the LINE is pinned as text in
 *  today-bed-packing §B, the RULE is exercised here, and neither proves
 *  anything alone. `landingVerdict` sets `reseats` before its stops, then
 *  refuses a pack-rescued start on the REST cell it is handed (:5802) — so the
 *  first-leg verdict of a ⇄ candidate is `blocked` WITH companions, and a fence
 *  that reads `kind` throws away exactly the cells the fill exists for. */
function toneAdmits(v: LandingVerdict): boolean {
  return v.reseats.length > 0
}

/** The fence FX-A replaced, kept here and ONLY here so the rule above can be
 *  measured against it on the repo's own day rather than argued about. */
function toneAdmittedBefore(v: LandingVerdict): boolean {
  return v.kind !== 'blocked' && v.reseats.length > 0
}

/** The guard's cell for one chip, the way `verdictAt` builds it. */
function cellAt(lanes: BoardLane[], laneKey: string, start: number, excludeId: string | null): RailCell | null {
  return railsOnFor(lanes, excludeId).find((r) => r.laneKey === laneKey)?.cells.find((c) => c.start === start) ?? null
}

/** `railsOn` with a hand lifted out — the strip's own input mid-drag. */
function railsOnFor(lanes: BoardLane[], excludeId: string | null): GuardRail[] {
  const views = bedViewsFor(lanes, DAY_FRAME(), excludeId)
  return guardRailsFor(lanes, {
    open: REAL.hours.open,
    close: REAL.hours.close,
    stepMin: 30,
    dur: REAL.guard.standardSessionMin,
    protectedDur: REAL.guard.protectedDurationMin,
    nowMinute: REAL.sell.nowMinute,
    locked: [],
    guard: REAL.guard.config,
    excludeId,
    placementFeasible: bedDoor(views, lanes, excludeId),
    protectedWindowFeasible: bedDoor(views, lanes, null),
    resting: null,
  })
}

describe('§BEHAVIOURAL (v) — a live drag pays for each question ONCE, and the drop pays for none', () => {
  const HAND = { id: 'apt-22', bed: 'bed-02' }
  const LATTICE = () => {
    const out: number[] = []
    for (let s = REAL.hours.open; s + REAL.guard.standardSessionMin <= REAL.hours.close; s += 30) out.push(s)
    return out
  }

  /** One sweep of every chip on every strip, at one pointer frame. */
  function sweep(rig: ReturnType<typeof liveRig>, laneKeys: string[], starts: number[]) {
    for (const lk of laneKeys) {
      const rails = railsOnFor(rig.board(), HAND.id)
      const rail = rails.find((r) => r.laneKey === lk)
      if (!rail) continue
      for (const s of starts) {
        rig.verdictFor(lk, s, rail.cells.find((c) => c.start === s) ?? null, true)
      }
    }
  }

  const staffKeys = () => REAL.lanes.filter((l) => l.group === 'staff').map((l) => l.key)

  it('(a)+(b) thirty frames sweeping the lattice pay one search per QUESTION; a second sweep pays none', () => {
    const rig = liveRig(sceneC(), HAND)
    const starts = LATTICE()
    const keys = staffKeys()
    // Frame 1 — the pick-up burst. Every distinct question is searched once and
    // never again, however many lanes ask it: the answer depends on the staff
    // lane only through its store.
    rig.frameAt(keys[0], 840)
    const board1 = rig.board()
    sweep(rig, keys, starts)
    const firstBurst = rig.packsOn(board1)
    expect(firstBurst).toBeGreaterThan(0)
    // ONE SEARCH PER ENTRY, and the entries are the QUESTIONS: a lattice start
    // times a store binding. `allocateBed`'s answer depends on the staff lane
    // only through `stores`, so six lanes asking the same start on one binding
    // are one question — which is the whole design in one number. On this day
    // that is 17 starts across the bindings the roster actually has.
    const bindings = new Set(REAL.lanes.filter((l) => l.group === 'staff').map((l) => JSON.stringify(l.stores))).size
    expect({ burst: firstBurst, entries: rig.memo.size() }).toEqual({ burst: rig.memo.size(), entries: rig.memo.size() })
    expect(firstBurst).toBeLessThanOrEqual(starts.length * bindings)
    // …against the chips that asked, which is the ratio the round is built on.
    expect(firstBurst).toBeLessThan(starts.length * keys.length)
    // …and the lanes that share a binding were already being served out of it
    // inside this very first sweep.
    expect(rig.memo.hits()).toBeGreaterThan(0)

    // Frames 2-30 — the card travels. Nothing about the board MINUS the hand
    // changed, so the same lattice is answered without one more search.
    rig.reset()
    for (let f = 1; f < 30; f += 1) {
      rig.frameAt(keys[f % keys.length], 840 + 5 * (f % 12))
      sweep(rig, keys, starts)
    }
    expect({ frames: 29, searches: rig.packs() }).toEqual({ frames: 29, searches: 0 })
    expect({ passes: rig.memo.passes(), rowClears: rig.memo.rowClears() }).toEqual({ passes: 0, rowClears: 0 })
    // Over the whole gesture the answers are overwhelmingly served, not searched
    // — which is the sentence the round's cost rests on.
    expect(rig.memo.hits()).toBeGreaterThan(rig.memo.misses() * 10)
  })

  it('(c) the DROP at a start the strip already answered pays nothing — same key, same board, same object', () => {
    const rig = liveRig(sceneC(), HAND)
    const keys = staffKeys()
    rig.frameAt(keys[0], 840)
    sweep(rig, keys, LATTICE())
    rig.reset()
    const board = rig.board()
    const v = rig.dropAt(keys[0], 840)
    // Zero fresh searches on the board the release is judged against. A landing
    // that carries companions also re-reads the guard on the board the shuffle
    // would leave — a DIFFERENT board family, which the gate sends to its own
    // deterministic search on purpose; it is not on this board's bill.
    expect({ onThisBoard: rig.packsOn(board), kind: typeof v.kind }).toEqual({ onThisBoard: 0, kind: 'string' })
  })

  it('(d) `solveBed`’s own ask is the SAME ENTRY the cursor read — object identity, not a re-derivation', () => {
    const rig = liveRig(sceneC(), HAND)
    const keys = staffKeys()
    rig.frameAt(keys[0], 840)
    const first = rig.solveBed(keys[0], 840)
    rig.reset()
    const again = rig.solveBed(keys[0], 840)
    expect({ searches: rig.packs(), same: again === first, frozen: Object.isFrozen(first) })
      .toEqual({ searches: 0, same: true, frozen: true })
  })

  it('(e)+(f) the BOOK and the RAILS never reach the gesture’s allocator at all', () => {
    const rig = liveRig(sceneC(), HAND)
    rig.frameAt(staffKeys()[0], 840)
    // The frame's own book and its four-door strip, built exactly as the screen
    // builds them. Neither is handed the memo and neither may find it: the book
    // imports `allocateBed` directly (R9) and the rails are handed doors.
    bedViewsFor(rig.board(), DAY_FRAME(), HAND.id)
    railsOnFor(rig.board(), HAND.id)
    expect({ hits: rig.memo.hits(), misses: rig.memo.misses(), passes: rig.memo.passes(), searches: rig.packs() })
      .toEqual({ hits: 0, misses: 0, passes: 0, searches: 0 })
  })

  it('(g) the world moving under the card MISSES the memo — three ways it can', () => {
    // ⚖ AUDIT A5. The memo's contract is that the screen owns invalidation, so
    // the three things that can genuinely change mid-gesture each have to empty
    // it: a card staged or confirmed, a server refresh, and a room's turnaround.
    for (const [name, disturb] of [
      ['the operator stages a card (`pending`)', (r: ReturnType<typeof liveRig>) => r.changePending()],
      ['a server refresh (`placedLanes` identity)', (r: ReturnType<typeof liveRig>) => r.refreshServer()],
      ['a room’s turnaround (`bedCleanupMinutes`)', (r: ReturnType<typeof liveRig>) => r.changeCleanup({ ...REAL.bedCleanupMinutes, 'bed-01': 45 })],
    ] as const) {
      const rig = liveRig(sceneC(), HAND)
      const keys = staffKeys()
      rig.frameAt(keys[0], 840)
      rig.verdictFor(keys[0], 840, null, true)
      rig.reset()
      rig.verdictFor(keys[0], 840, null, true)
      expect({ name, beforeDisturbance: rig.packs() }).toEqual({ name, beforeDisturbance: 0 })
      // ⚖ FIX ROUND 2 (FX-B) — AND THE ⇄ TONE SLOTS DO **NOT** GO WITH IT.
      // Fix round 1 rebuilt the whole view on every one of these clears, which
      // is correct and costs 33 rebuilds and p95 114.5 ms of a 68-frame gesture
      // on the 30-lane board. So the slots now outlive the memo on purpose, and
      // the staleness a clear can cause is answered in the KEY and at the CHIP:
      // the same start with the SAME rescue is reused (the design's declared
      // preview class), and the same start with a DIFFERENT rescue misses and is
      // composed fresh in that render.
      const store = { slots: new Map<string, LandingClass>(), shuffledFor: new Map<string, number>() }
      let composes = 0
      const compose = (): LandingClass => { composes += 1; return 'clean' }
      expect({ name, beforeTheDisturbance: slotRule(store, keys[0], 840, 60, 'a>r2', compose).composed })
        .toEqual({ name, beforeTheDisturbance: true })
      disturb(rig)
      rig.frameAt(keys[0], 840)
      rig.verdictFor(keys[0], 840, null, true)
      expect({ name, afterDisturbance: rig.packs() }).toEqual({ name, afterDisturbance: 1 })
      expect({ name, entries: rig.memo.size() }).toEqual({ name, entries: 1 })
      expect({ name, sameRescueStillReused: slotRule(store, keys[0], 840, 60, 'a>r2', compose).composed })
        .toEqual({ name, sameRescueStillReused: false })
      expect({ name, changedRescueComposesFresh: slotRule(store, keys[0], 840, 60, 'a>r3', compose).composed })
        .toEqual({ name, changedRescueComposesFresh: true })
      expect({ name, composes, shuffles: store.shuffledFor.size }).toEqual({ name, composes: 2, shuffles: 2 })
    }
    // …and the three cases the rule exists for, hand-built and named, plus the
    // gesture's one shuffled board per set of moves. These are mutants (2), (5)
    // and (7) of the fix round, written as the rule rather than as an edit.
    {
      const store = { slots: new Map<string, LandingClass>(), shuffledFor: new Map<string, number>() }
      let composes = 0
      const compose = (): LandingClass => { composes += 1; return 'caution' }
      // A candidate WITHOUT a slot is composed at the site…
      expect(slotRule(store, 'p-01', 840, 60, 'a>r2', compose)).toEqual({ kind: 'caution', composed: true, shuffles: 1 })
      // …a candidate WITH one is reused and composes nothing…
      expect(slotRule(store, 'p-01', 840, 60, 'a>r2', compose)).toEqual({ kind: 'caution', composed: false, shuffles: 1 })
      // …and a CHANGED set of moves is a different question, composed fresh on
      // its own board.
      expect(slotRule(store, 'p-01', 840, 60, 'a>r3', compose)).toEqual({ kind: 'caution', composed: true, shuffles: 2 })
      // …while a second chip under the SAME set of moves composes its own slot
      // but REUSES the gesture's board — the cache without which composing on
      // demand costs a whole shuffled board per missing chip.
      expect(slotRule(store, 'p-02', 840, 60, 'a>r2', compose)).toEqual({ kind: 'caution', composed: true, shuffles: 2 })
      expect({ composes, keys: store.slots.size }).toEqual({ composes: 3, keys: 3 })
    }
    // ⚖ FIX ROUND 1B (FX-D) — …and the FOURTH case: a changed BOARD rebuilds the
    // shuffle even for a set of moves this gesture has already shuffled once. The
    // cached board is a view of the world as it was; the world can move under the
    // card (a staged card, a refresh, a room's turnaround), and a candidate
    // composed on demand afterwards would otherwise be judged on the old one.
    {
      const store = {
        slots: new Map<string, LandingClass>(),
        shuffledFor: new Map<string, number>(),
        linesFor: new Map<string, number>(),
        base: undefined as unknown,
      }
      let composes = 0
      const compose = (): LandingClass => { composes += 1; return 'caution' }
      const boardA: unknown = { world: 'A' }
      const boardB: unknown = { world: 'B' }
      // Two sets of moves under ONE board: two shuffles, both kept…
      expect(slotRule(store, 'p-01', 840, 60, 'a>r2', compose, boardA)).toEqual({ kind: 'caution', composed: true, shuffles: 1 })
      expect(slotRule(store, 'p-01', 840, 60, 'a>r3', compose, boardA)).toEqual({ kind: 'caution', composed: true, shuffles: 2 })
      // …a second chip under the same board still reuses them…
      expect(slotRule(store, 'p-02', 840, 60, 'a>r2', compose, boardA)).toEqual({ kind: 'caution', composed: true, shuffles: 2 })
      // …and the board CHANGING drops every one of them, so the very same set of
      // moves is shuffled again on the board that stands now.
      expect(slotRule(store, 'p-03', 840, 60, 'a>r2', compose, boardB)).toEqual({ kind: 'caution', composed: true, shuffles: 1 })
      // …while the SLOTS composed before it all survive: dropping those is fix
      // round 1's rebuild, measured at p95 114.5 ms and ruled out.
      expect({ composes, keys: store.slots.size }).toEqual({ composes: 4, keys: 4 })
      // ⚖ FIX ROUND 3 (DELTA-CODE-D1 MAJOR 2) — …AND THE ⇄ CHIP'S COMPANION
      // LINES RIDE ON EXACTLY THE SAME TWO RULES: one composition per set of
      // moves however many chips wear it, and dropped when the board moves.
      // Spelled at the chip, this was two board walks per marked chip per
      // pointer frame; the rule below is what the cache has to keep true.
      let lineComposes = 0
      const composeLines = (): number => { lineComposes += 1; return lineComposes }
      // The board here is `boardB` — the one the block above left the store on.
      expect(linesRule(store, 'a>r2', composeLines, boardB)).toEqual({ composed: true, entries: 1 })
      // …a second chip under the SAME rescue reuses it and composes nothing…
      expect(linesRule(store, 'a>r2', composeLines, boardB)).toEqual({ composed: false, entries: 1 })
      // …a DIFFERENT rescue is a different sentence, composed on its own…
      expect(linesRule(store, 'a>r3', composeLines, boardB)).toEqual({ composed: true, entries: 2 })
      // …and the board MOVING drops them with the shuffles, so the very same
      // rescue is read off the board that stands now — a line naming a
      // companion the board no longer carries is the defect this closes.
      expect(linesRule(store, 'a>r2', composeLines, boardA)).toEqual({ composed: true, entries: 1 })
      expect({ lineComposes, shuffles: store.shuffledFor.size }).toEqual({ lineComposes: 3, shuffles: 0 })
    }
    // ⚖ FIX ROUND 4 (Greptile #884 4/5) — …and the FIFTH case, which is the
    // whole of this round: A CHANGED WORLD DROPS EVERY SLOT; AN UNCHANGED WORLD
    // WITH A CHANGED BOARD KEEPS THEM.
    //
    // The two are not the same event. The BOARD is a different object on every
    // frame of a gesture because the hand's own live claim is in it, so the
    // board compare above is the hand moving, and dropping the previews on it is
    // fix round 1's refill — 33 rebuilds and p95 114.5 ms on the 30-lane board,
    // measured and ruled out (the chip under the cursor is corrected on every
    // aim change, which is what makes the rest a declared preview). The WORLD is
    // the board MINUS the hand — a staged or confirmed card, a server refresh, a
    // room's turnaround, `now` — and a slot composed before one of those moved
    // is not a stale preview but an answer about a board nobody is looking at.
    // The set of moves in the key cannot catch it: an UNCHANGED rescue under a
    // CHANGED world carries the SAME key and was being handed straight back.
    {
      const store = {
        slots: new Map<string, LandingClass>(),
        shuffledFor: new Map<string, number>(),
        linesFor: new Map<string, number>(),
        base: undefined as unknown,
        world: undefined as unknown,
      }
      let composes = 0
      const compose = (): LandingClass => { composes += 1; return 'clean' }
      const boardA: unknown = { board: 'A' }
      const boardB: unknown = { board: 'B' }
      const w1: unknown = { world: 1 }
      const w2: unknown = { world: 2 }
      // Two chips under one world and one board…
      expect(slotRule(store, 'p-01', 840, 60, 'a>r2', compose, boardA, w1)).toEqual({ kind: 'clean', composed: true, shuffles: 1 })
      expect(slotRule(store, 'p-02', 840, 60, 'a>r2', compose, boardA, w1)).toEqual({ kind: 'clean', composed: true, shuffles: 1 })
      // …the BOARD moving under the card drops the shuffles and KEEPS the
      // previews — this is the frame-by-frame case, and it is the one round 1
      // paid 114.5 ms for.
      expect(slotRule(store, 'p-01', 840, 60, 'a>r2', compose, boardB, w1)).toEqual({ kind: 'clean', composed: false, shuffles: 0 })
      expect({ keptAcrossTheHandMoving: store.slots.size }).toEqual({ keptAcrossTheHandMoving: 2 })
      // …and the WORLD moving drops every one of them, so the very same chip
      // with the very same rescue is composed again on the board that stands
      // now — and its neighbour's preview is gone too, not just its own.
      expect(slotRule(store, 'p-01', 840, 60, 'a>r2', compose, boardB, w2)).toEqual({ kind: 'clean', composed: true, shuffles: 1 })
      expect({ composes, keys: store.slots.size }).toEqual({ composes: 3, keys: 1 })
    }
    // …and the hand's OWN room row is the third: a tail that clips or re-grows
    // under the card changes what `allocateBed`'s step-0 arm sees, which is the
    // defect M1b exists for. The stamp says so on its own counter.
    const rig = liveRig(sceneC(), HAND)
    const rows = [
      handRowStamp(rig.board(), HAND.id, HAND.bed),
      (rig.frameAt(staffKeys()[0], 840), handRowStamp(rig.board(), HAND.id, HAND.bed)),
    ]
    expect(rows.every((r) => typeof r === 'string')).toBe(true)
  })

  it('(h) ⚖ AUDIT A1 — the chip under the cursor, the badge and the release are ONE answer', () => {
    // The chips sit on the 30-minute lattice and the card does not, so the two
    // are asking about two starts. Both answers are exact; the identity the round
    // must hold is that the chip shows ITS OWN start's drop answer and the badge
    // shows the landing's, and that on an ON-LATTICE frame — where the two
    // questions coincide — they are the same answer, written once.
    const rig = liveRig(sceneC(), HAND)
    const keys = staffKeys()
    const starts = LATTICE()
    rig.frameAt(keys[0], starts[0])
    sweep(rig, keys, starts)

    let checked = 0
    // ⚖ ADJUDICATION L2 M-1 — three booking lattices, because `bookingStepMin` is
    // a live dial and the 30-minute chip lattice is not the one the card snaps to.
    for (const step of [5, 15, 30]) {
      for (const lk of keys) {
        for (const s of starts) {
          for (const off of [0, step]) {
            const live = s + off
            if (live + rig.dur > REAL.hours.close) continue
            rig.frameAt(lk, live)
            const chipStart = Math.floor(live / 30) * 30
            const badge = rig.dropAt(lk, live)
            const chipDrop = rig.dropAt(lk, chipStart)
            const chipV = rig.verdictFor(lk, chipStart, cellAt(rig.board(), lk, chipStart, HAND.id), true)
            const face = liveChipFace({ v: chipV, final: chipDrop, start: chipStart })
            // The chip's face is the drop's answer AT THE CHIP'S OWN START…
            expect({ at: `${lk}@${chipStart}`, blocked: face.state === 'blocked' })
              .toEqual({ at: `${lk}@${chipStart}`, blocked: chipDrop.kind === 'blocked' })
            expect({ at: `${lk}@${chipStart}`, mark: face.mark != null })
              .toEqual({ at: `${lk}@${chipStart}`, mark: chipDrop.kind !== 'blocked' && chipV.reseats.length > 0 })
            // …and the badge is the drop's answer at the LANDING, said in words.
            expect({ at: `${lk}@${live}`, word: cursorWord(badge).kind })
              .toEqual({ at: `${lk}@${live}`, word: cursorWord(rig.dropAt(lk, live)).kind })
            // …and where the two coincide they are literally one answer.
            if (live === chipStart) {
              expect({ at: `${lk}@${live}`, same: badge.kind }).toEqual({ at: `${lk}@${live}`, same: chipDrop.kind })
            }
            checked += 1
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('(i) ⚖ FIX ROUND 2 (FX-A) — the ⇄ fill’s fence is `reseats`, and the fence it replaced admitted NOTHING on this day', () => {
    // The class the whole blind round walked past: every pin green, every fence
    // green, every answer right — and the feature invisible, because the fill
    // threw away all of its own input. Measured here on the repo's OWN fixture
    // day through the REAL `landingVerdict`, not modelled.
    const rig = liveRig(sceneC(), HAND)
    const keys = staffKeys()
    const starts = LATTICE()
    rig.frameAt(keys[0], starts[0])
    let candidates = 0
    let admittedBefore = 0
    let blockedFirstLeg = 0
    let rescued = 0
    for (const lk of keys) {
      for (const s of starts) {
        const v = rig.verdictFor(lk, s, cellAt(rig.board(), lk, s, HAND.id), true)
        if (!toneAdmits(v)) continue
        candidates += 1
        if (toneAdmittedBefore(v)) admittedBefore += 1
        if (v.kind === 'blocked') blockedFirstLeg += 1
        // …and the composer's own rule, which is what makes a `blocked` first
        // leg admissible at all: the SHUFFLED board's re-read decides the face.
        if (rig.dropAt(lk, s).kind !== 'blocked') rescued += 1
      }
    }
    expect({ candidates: candidates > 0, admittedBefore }).toEqual({ candidates: true, admittedBefore: 0 })
    expect({ blockedFirstLeg, rescued: rescued > 0 }).toEqual({ blockedFirstLeg: candidates, rescued: true })
    console.log(`(i) FX-A — scene C admits ${candidates} ⇄ candidates (the old fence: ${admittedBefore}); ${rescued} of them come back clean or caution on the shuffled board`)
  })
})

// ── §FIX1 — Fable's rulings on the build's §Open, each with its own scene ───

describe('§F1 — the WORD rides empty track, exactly like the mark', () => {
  it('見本 はなこ’s 勤務不可 afternoon keeps 「—」, while さぶろう’s empty 15:00 says 満室', () => {
    // Liam's ruling is about a 「30-min GAP with no bed」, and a gap is empty
    // track on the row. はなこ is not working at all from 13:00: every one of
    // her afternoon half hours is bed-less on the store's rooms, and every one
    // of them already shows the operator a 勤務不可 card. The strip says nothing
    // it cannot add. さぶろう's 15:00 is the opposite — genuinely empty track,
    // and the beds behind it are what the operator could not see.
    const a = readBoard(sceneA()).lanes
    for (const start of [840, 870, 900]) {
      const chip = a['p-01'].chips.find((c) => c.start === start)!
      expect({ at: clock(start), face: chip.face, word: chip.word }).toEqual({ at: clock(start), face: '—', word: null })
    }
    expect(a['p-01'].cues).toEqual([])
    expect(a['c-03'].chips.find((c) => c.start === 900)!.face).toBe('満室')
  })

  it('on ALL FOUR boards, no chip whose own row is busy over its half hour wears a bed word', () => {
    // The law, swept rather than sampled: 満室 and 清掃 are facts about an empty
    // 30 minutes, so a card, a break, a 予定ブロック or a shift wall across them
    // stands the word down — the same predicate `restCueStarts` applies to the
    // mark, asked once and used by both.
    for (const b of boards()) {
      const read = readBoard(b.lanes)
      for (const [laneKey, lane] of Object.entries(read.lanes)) {
        const items = laneOf(b.lanes, laneKey).items
        for (const chip of lane.chips.filter((c) => c.word === '満室' || c.word === '清掃')) {
          const busy = items.some((i) => i.startMin < chip.start + 30 && chip.start < i.endMin)
          expect({ at: `${b.name}/${laneKey}@${clock(chip.start)}`, busy }).toEqual({ at: `${b.name}/${laneKey}@${clock(chip.start)}`, busy: false })
        }
      }
    }
  })

  it('a chip whose row is busy asks the book NOTHING — the narrowing is a cost cut too', () => {
    // One staff lane with a booking straight across 13:00〜14:00 and one room
    // busy all day: without the gate this chip pays a half-hour count AND the
    // allocator's occupant walk, for a word it may not wear.
    const lanes = [
      handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ', items: [handItem({ key: 's1', caseId: 'y1' }, 780, 840)] }),
      handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [handItem({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 600, 1140)] }),
    ]
    const asked: Array<{ start: number; dur: number }> = []
    const said = explainHand(lanes, {
      bedsOver: (_lane, start, end) => { asked.push({ start, dur: end - start }); return { full: true, keys: () => [] } },
    }).get('p-01')!.get(780)!
    // 13:00 is under the booking, so the HALF HOUR is never asked about — and
    // the rest of the strip, which IS empty track, is asked exactly as before.
    // (The chip's own 60-minute window is a different question, ⚖ 75(i)'s, and
    // it is asked wherever that clause can fire.)
    const halves = asked.filter((a) => a.dur === 30).map((a) => a.start)
    expect(halves).not.toContain(780)
    expect(halves.length).toBeGreaterThan(0)
    expect(said.word).toBeNull()
  })
})

describe('§F2 — the store’s own hold outranks the bed fact, and displaces nothing else', () => {
  /** All three rooms busy 13:00〜14:00, the staff lane wide open, and the guard
   *  holding 13:00〜14:30 for a 新規. The rooms refuse; the STORE is why the
   *  half hour is empty. */
  const heldScene = () => [
    handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ' }),
    handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [handItem({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)] }),
  ]
  const HELD = [{ laneKey: 'p-01', protectedCount: 1, spans: [{ start: 780, end: 870, windowStart: 780 }] }]

  it('a bed-refused half hour INSIDE a 確保 window says 新規用, not 満室 — and grows no mark', () => {
    const plain = explainHand(heldScene()).get('p-01')!.get(780)!
    expect(plain.word).toBe('満室')
    const held = explainHand(heldScene(), { held: HELD }).get('p-01')!.get(780)!
    expect(held.word).toBe('新規用')
    expect(held.wordReason).toBe('guard')
    // ⚖ FIX ROUND 2 (B, L2-M2) — and its mark says the word, not the beds: the
    // hatch under a 新規用 chip is the store's own hold, and round 1 removed it
    // altogether on the strength of a false claim (that the 確保 chip is always
    // drawn over it — a guard refusal can sit outside every 確保 span). It is
    // back, labelled, and `covered()` still stands it down under a DRAWN span.
    expect(held.cue).toEqual({ kind: 'guard', label: ['新規用'] })
    // …and the sentence is the bed refusal with the law's own clause after it —
    // the CLAUSE is unchanged by this fix, only the word moved.
    expect(held.sentence).toBe(`${plain.sentence}。${reservedClause(90)}`)
  })

  it('…and a PLACEABLE half hour inside the same window keeps its own face', () => {
    // ⚠ THE INVERSION GUARD. 新規用 means 「this start is being held and cannot be
    // sold」. On a start the operator CAN take it says the opposite of the truth
    // — the same category inversion bare 新規 was (Liam, 8/30) — so the hold
    // displaces the BED WORD and nothing else. The E3b clause is a different
    // budget and still rides every state.
    const free = [
      handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ' }),
      handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    ]
    const per = explainHand(free, { held: HELD }).get('p-01')!
    const cells = new Map(handRails(free)[0].cells.map((c) => [c.start, c]))
    for (const [start, said] of per) {
      // The guard's OWN refusals keep 新規用 — that is 8/30's ruling and it is
      // untouched. What may not happen is a word arriving on a start the board
      // said yes to, which is every other chip inside the window.
      if (cells.get(start)!.reason === 'guard') continue
      expect({ at: clock(start), word: said.word }).toEqual({ at: clock(start), word: null })
    }
    // …and the window really does contain placeable starts, or the sweep above
    // would be vacuous.
    expect([...per].filter(([start]) => cells.get(start)!.state !== 'blocked' && start >= 780 && start < 870).length).toBeGreaterThan(0)
    // The clause is still there, on the chips whose window the hold overlaps.
    expect(per.get(780)!.sentence).toContain('新規のお客様のための90分枠として確保しています')
  })
})

describe('§F3 — the sold mark is a HALF-HOUR fact, not the 60-minute verdict’s', () => {
  it('しろう’s quiet hour carries ONE mark across both half hours, refused chip included', () => {
    const p04 = readBoard(sceneB()).lanes['p-04']
    expect(p04.cues).toEqual([{ start: 870, end: 930, kind: 'sold', label: ['別の枠で', '販売中'] }])
    // The 15:00 chip is refused by しろう's own 記録 block and says exactly what
    // it said before — the mark under it is about the bed, and the chip is not.
    const at15 = p04.chips.find((x) => x.start === 900)!
    expect({ face: at15.face, word: at15.word, sentence: at15.sentence }).toEqual({
      face: '—', word: null, sentence: 'この開始には60分の連続した空きがありません（15:00〜16:00）',
    })
  })

  it('its gates are the half hour’s own: the display dial, the store’s hold, a box on THIS row', () => {
    const lanes = sceneB()
    const views = bedViewsFor(lanes, DAY_FRAME(), null)
    const dur = REAL.guard.standardSessionMin
    const rails = railsOn(lanes)
    const box: SellCell = { laneKey: 'c-03', resourceKey: 'bed-02', group: 'staff', staff: 'c-03', bed: 'ベッド2', h: 870, price: 7010, tier: 2 }
    const mine: SellCell = { ...box, laneKey: 'p-04', staff: 'p-04', h: 900 }
    const ask = (over: Partial<Parameters<typeof explainRails>[2]>) =>
      explainRails(rails, lanes, {
        dur, handId: null, stagedId: null, sellCells: [box], claims: [], drops: [], inHand: false, sellDisplayed: true,
        bedsOver: (laneKey, start, end) => {
          const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
          if (!lane) return null
          const asker = { stores: lane.stores, requiresPrivate: false }
          const answer = views.world.bedFor(start, end, asker)
          if (!answer.compatibleRoomsExist) return null
          return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
        },
        ...over,
      }).get('p-04')!
    const soldAt = (over: Partial<Parameters<typeof explainRails>[2]>, start: number) => ask(over).get(start)!.cue
    // Both half hours of the quiet hour carry it, and the refused one too.
    expect(soldAt({}, 870)).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
    expect(soldAt({}, 900)).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
    // 表示設定 → 空き枠表示「非表示」 — the mark may not explain an absence the
    // operator caused themselves.
    expect(soldAt({ sellDisplayed: false }, 870)).toBeNull()
    // Inside the store's own hold the 確保 chip answers instead.
    expect(soldAt({ held: [{ laneKey: 'p-04', protectedCount: 1, spans: [{ start: 870, end: 960, windowStart: 870 }] }] }, 870)).toBeNull()
    // A box on THIS row over the half hour: nothing to explain, the offer is
    // drawn where the operator is looking.
    expect(soldAt({ sellCells: [box, mine] }, 900)).toBeNull()
    expect(soldAt({ sellCells: [box, mine] }, 870)).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
  })
})

describe('§F4 — the ⇄ mark’s tone and caution are the CREATE path’s own verdict', () => {
  it('they are what a new 60-minute placement at 14:00 is told on the re-seated board', () => {
    const lanes = sceneC()
    const dur = REAL.guard.standardSessionMin
    const mark = explainWith(lanes, allocateBed).get('p-05')!.get(840)!
    expect(mark.mark).toEqual({ face: 'reseat', tone: 'degraded' })

    // The same board the mark judged on: the re-seat applied through the same
    // helper `verdictAtLanding` uses (DESIGN §5).
    const ask = { id: null, currentBed: null, stores: laneOf(lanes, 'p-05').stores, requiresPrivate: false, start: 840, end: 840 + dur }
    const packed = allocateBed(lanes, { ...ask, pack: true, now: REAL.sell.nowMinute, cleanupMinutesByBed: REAL.bedCleanupMinutes })
    const after = applyBedMoves(lanes, companionsFor(lanes, packed.reseats), REAL.hours, REAL.bedCleanupMinutes)

    // The CREATE path's own landing: a NEW placement, no booking, no 個室 tag —
    // exactly what an operator dropping a fresh 60 at 14:00 would be told.
    const create = landingVerdict(
      after,
      {
        staffLane: 'p-05', bedLane: null, solveRoom: true, id: null, requiresPrivate: false,
        start: 840, end: 840 + dur, span: place(840, 840 + dur, REAL.hours),
        foreignRefusal: null, hasPrice: false, locked: [],
        minutesOf: (x: number) => minuteOf(x, REAL.hours),
        stagedId: null, now: REAL.sell.nowMinute, cleanupMinutesByBed: REAL.bedCleanupMinutes,
      },
      railsOn(after).find((r) => r.laneKey === 'p-05')!.cells.find((x) => x.start === 840) ?? null,
    )
    expect(create.kind).toBe('caution')
    // Tone and clause, both of them the verdict's own — never a second reading.
    expect(mark.mark!.tone).toBe('degraded')
    expect(mark.sentence.endsWith(`。${create.reason}`)).toBe(true)
  })
})

// ── §FIX2 — the blind code round's three MAJORs, and the breaker's two ─────

/** The screen's own bed door on a hand-built board, so §A's scenes can vary the
 *  rooms rather than the wiring. */
const handDoor = (lanes: BoardLane[]) => {
  const views = bedViewsFor(lanes, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, null)
  return (laneKey: string, start: number, end: number) => {
    const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
    if (!lane) return null
    const asker = { stores: lane.stores, requiresPrivate: false }
    const answer = views.world.bedFor(start, end, asker)
    if (!answer.compatibleRoomsExist) return null
    return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
  }
}

describe('§A — 別の枠で販売中 means the ONLY free bed went elsewhere (L2-M1)', () => {
  /** Two staff, THREE rooms, nothing booked — and one box on the other person's
   *  row. Lens 2's own scene: nothing took p-05's bed, two of the three are
   *  still free, and round 1 painted the mark and named a taker anyway. */
  const spare = (rooms: number): BoardLane[] => [
    handLane({ key: 'p-05', group: 'staff', label: '見本 あずさ' }),
    handLane({ key: 'p-06', group: 'staff', label: '見本 かおる' }),
    ...Array.from({ length: rooms }, (_, i) => handLane({ key: `bed-0${i + 1}`, group: 'beds', label: `ベッド${i + 1}` })),
  ]
  const boxOn = (laneKey: string, resourceKey: string, h: number): SellCell => ({
    laneKey, resourceKey, group: 'staff', staff: laneKey, bed: resourceKey, h, price: 7000, tier: 2,
  })
  const askSpare = (lanes: BoardLane[], sellCells: SellCell[]) =>
    explainHand(lanes, { sellCells, bedsOver: handDoor(lanes) }).get('p-05')!.get(720)!

  it('with beds to spare the board names nobody — the bare clause, and no mark', () => {
    // ⚠ THE MAJOR. Ruling 2 is 「a free person whose hour's ONLY bed is being
    // sold on another lane」. One box on かおる's row over ベッド1 leaves ベッド2
    // and ベッド3 free for あずさ: nothing was taken from her, so a mark and a
    // named taker would both be inventions — and ⚖ 75(i)'s bare clause exists
    // precisely to state an absence WITHOUT inventing a cause.
    const said = askSpare(spare(3), [boxOn('p-06', 'bed-01', 720)])
    expect(said.cue).toBeNull()
    expect(said.sentence).toContain('この開始には販売可能枠が出ていません')
    expect(said.sentence).not.toContain('別のスタッフ')
  })

  it('…and when every free bed IS claimed elsewhere, it says so and names them', () => {
    // The same board with ONE room: かおる's box is standing on the only bed
    // あずさ could have used, which is Liam's own scene in miniature.
    const said = askSpare(spare(1), [boxOn('p-06', 'bed-01', 720)])
    expect(said.cue).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
    expect(said.sentence).toContain('ベッドは別のスタッフ（見本 かおる）の枠が使うため、ここには販売可能枠を出していません')
    // Three rooms, all three claimed on the other row: still every bed, still true.
    const all = askSpare(spare(3), [boxOn('p-06', 'bed-01', 720), boxOn('p-06', 'bed-02', 720), boxOn('p-06', 'bed-03', 720)])
    expect(all.cue).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
    // …and ONE of the three left unclaimed is enough to take the claim back.
    const two = askSpare(spare(3), [boxOn('p-06', 'bed-01', 720), boxOn('p-06', 'bed-02', 720)])
    expect(two.cue).toBeNull()
    expect(two.sentence).toContain('この開始には販売可能枠が出ていません')
    // A box standing on a room this lane could NOT have used proves nothing:
    // the key has to match a bed the book says was free for this person.
    const wrong = askSpare(spare(1), [boxOn('p-06', 'bed-09', 720)])
    expect(wrong.cue).toBeNull()
  })

  it('Liam’s own scene B still says it — the narrowing keeps what the ruling is about', () => {
    const p04 = readBoard(sceneB()).lanes['p-04']
    expect(p04.cues).toEqual([{ start: 870, end: 930, kind: 'sold', label: ['別の枠で', '販売中'] }])
    expect(p04.chips.find((c) => c.start === 870)!.sentence)
      .toContain('ベッドは別のスタッフ（テスト さぶろう）の枠が使うため、ここには販売可能枠を出していません')
  })
})

describe('§B — 新規用 keeps its hatch, labelled, and never carries somebody else’s sale (L2-M2 + L2-M3)', () => {
  /** The REAL fixture with the sell layer switched off, so no sold mark can
   *  stand in for the one under test — lens 2's own case, `p-05 BASE=[960]`. */
  const sellOffCues = (laneKey: string, drawHeld = true) => {
    const lanes = REAL.lanes
    const frame = DAY_FRAME()
    const held = heldCommittedFor({
      gateOn: true, lanes, frame, bookOf: bedViewsFor, closeMin: REAL.hours.close,
      nowMin: REAL.sell.nowMinute, guard: REAL.guard.config, gapGuardMode: REAL.guard.mode, released: [],
    })
    const views = bedViewsFor(lanes, frame, null)
    const explained = explainRails(railsOn(lanes), lanes, {
      dur: REAL.guard.standardSessionMin, handId: null, stagedId: null,
      sellCells: [], claims: [], drops: [], inHand: false, sellDisplayed: false, held,
      bedsOver: (key, start, end) => {
        const lane = lanes.find((l) => l.key === key && l.group === 'staff')
        if (!lane) return null
        const asker = { stores: lane.stores, requiresPrivate: false }
        const answer = views.world.bedFor(start, end, asker)
        if (!answer.compatibleRoomsExist) return null
        return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
      },
    }).get(laneKey)!
    const spans = drawHeld ? new Map(heldDrawnFor(held, lanes, []).map((m) => [m.laneKey, m.spans])) : new Map()
    const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')!
    return { explained, cues: restCueStarts(explained, [], [], spans.get(laneKey) ?? [], lane.items, null) }
  }

  it('a guard-refused start with NO 確保 span drawn over it keeps the hatch base painted — now labelled', () => {
    // ⚠ THE MAJOR. 新規用 rides `cell.reason === 'guard'` — the guard protecting
    // its last 新規 window — which is a different thing from a 新規用に確保 span
    // being DRAWN, and the two come apart the moment the publication filter
    // removes one (a locked lane, a lane with no list price, the sell layer
    // off). Round 1's jsdoc said 「the 確保 chip is drawn over that emptiness」
    // and made the hatch depend on it; lens 2 measured the loss on the real
    // fixture (`p-05 BASE=[960] TIP=[]`). No ruling removes a hatch; ruling 1
    // ADDS them. Here the same board with nothing drawn over it.
    const { explained, cues } = sellOffCues('p-05', false)
    const worded = [...explained].filter(([, e]) => e.word === '新規用').map(([start]) => start)
    expect(worded.length).toBeGreaterThan(0)
    for (const start of worded) {
      expect({ at: clock(start), cue: cues.find((c) => c.start <= start && start < c.end)?.label ?? null })
        .toEqual({ at: clock(start), cue: ['新規用'] })
    }
  })

  it('…and every worded chip on all four boards carries its own word’s mark, or none at all', () => {
    // The law swept: the mark's kind is the word's, always — and ⚖ flag 88's
    // narrowing (a drawn box, a drawn 確保 span, the row's own card) is the only
    // thing that may take one away.
    for (const b of boards()) {
      const read = readBoard(b.lanes)
      for (const [laneKey, lane] of Object.entries(read.lanes)) {
        for (const chip of lane.chips.filter((c) => c.word != null)) {
          const cue = lane.cues.find((q) => q.start <= chip.start && chip.start < q.end)
          const at = `${b.name}/${laneKey}@${clock(chip.start)}`
          expect({ at, kind: cue?.kind ?? null })
            .toEqual({ at, kind: cue == null ? null : chip.word === '新規用' ? 'guard' : 'bed' })
        }
      }
    }
  })

  it('…and that chip can never wear the sold mark instead (precedence, on the lane)', () => {
    // ⚠ THE OTHER MAJOR: `cue = bedCue ?? sold` let a 新規用 chip fall straight
    // through to somebody else's sale. The word's own mark wins, always.
    const { explained } = sellOffCues('p-05')
    for (const [, said] of explained) {
      if (said.word == null) continue
      expect({ word: said.word, kind: said.cue?.kind ?? null })
        .toEqual({ word: said.word, kind: said.word === '新規用' ? 'guard' : 'bed' })
    }
  })

  it('⚖ flag 88 still stands it down under a DRAWN 確保 span, so the mock’s boards do not move', () => {
    const lanes = REAL.lanes
    const worded: ReadonlyMap<number, { cue: RailCue | null }> = new Map([[960, { cue: { kind: 'guard' as const, label: ['新規用'] } }]])
    expect(restCueStarts(worded, [], [], [{ start: 960, end: 1050, windowStart: 960 }], [], null)).toEqual([])
    expect(restCueStarts(worded, [], [], [], [], null)).toEqual([{ start: 960, end: 990, kind: 'guard', label: ['新規用'] }])
    expect(lanes.length).toBeGreaterThan(0)
  })
})

describe('§C — one gate for the round: no door, nothing derived (L2-m1)', () => {
  it('with the door absent every board reads byte-identically to main, on all four', () => {
    // Round 1 gated the WORD and the MARK on the door but not the sold cue or
    // the taker lookup, so a caller that had not adopted the round still got a
    // sentence it never had (lens 2's F2: 「ベッドは別のスタッフ（見本 かおる）…」
    // on a gate-OFF board). One door, one gate: absent, this function derives
    // no new fact of any kind.
    for (const b of boards()) {
      const lanes = b.lanes
      const dur = REAL.guard.standardSessionMin
      const rails = railsOn(lanes)
      const box: SellCell = { laneKey: 'c-03', resourceKey: 'bed-02', group: 'staff', staff: 'c-03', bed: 'ベッド2', h: 870, price: 7010, tier: 2 }
      const common = {
        dur, handId: null, stagedId: null, sellCells: [box], claims: [], drops: [],
        inHand: false, sellDisplayed: true,
      }
      const off = explainRails(rails, lanes, common)
      const on = explainRails(rails, lanes, { ...common, bedsOver: () => null })
      for (const rail of rails) {
        for (const c of rail.cells) {
          const a = off.get(rail.laneKey)!.get(c.start)!
          const at = `${b.name}/${rail.laneKey}@${clock(c.start)}`
          // NOTHING NEW is derived: no half-hour word (the word is the engine's
          // own class, as it was on main), no 「moves someone」 mark, no sold
          // mark, and no taker found off a drawn box. The mark that DOES survive
          // is base's own — base painted a hatch under every worded chip — and
          // it carries that word, which is §B.
          expect({ at, word: a.word, kind: a.cue?.kind ?? null, mark: a.mark }).toEqual({
            at,
            word: a.word,
            kind: a.word == null ? null : a.word === '新規用' ? 'guard' : 'bed',
            mark: null,
          })
          expect(a.sentence).not.toContain('別のスタッフ')
          // …and a door that answers 「no compatible room」 is the same silence.
          expect({ at, same: on.get(rail.laneKey)!.get(c.start)!.sentence === a.sentence }).toEqual({ at, same: true })
        }
      }
    }
  })
})

describe('§G1 — the ⇄ chip’s palette is a pure function now, and it is pinned (L4-M1)', () => {
  it('the mark takes the palette of the verdict the drop will give', () => {
    // ⚠ THE BREAKER'S SURVIVOR: swapping these two lines passed all 10,687
    // tests, because the mapping lived in a template literal inside the JSX
    // where this folder's import fence puts it out of reach.
    expect(railChipClass({ mark: { face: 'reseat', tone: 'degraded' }, state: 'blocked', inert: false, aimed: false }))
      .toBe('guard-rail-cell reseat degraded')
    expect(railChipClass({ mark: { face: 'reseat', tone: 'safe' }, state: 'blocked', inert: false, aimed: false }))
      .toBe('guard-rail-cell reseat guard-slot')
  })

  it('…and every state without a mark is byte-identical to what the JSX built', () => {
    // The lift may not change one character of what the board draws.
    expect(railChipClass({ mark: null, state: 'safe', inert: false, aimed: false })).toBe('guard-rail-cell guard-slot safe')
    expect(railChipClass({ mark: null, state: 'degraded', inert: false, aimed: false })).toBe('guard-rail-cell degraded')
    expect(railChipClass({ mark: null, state: 'blocked', inert: false, aimed: false })).toBe('guard-rail-cell blocked')
    expect(railChipClass({ mark: null, state: 'blocked', inert: true, aimed: false })).toBe('guard-rail-cell blocked inert')
    expect(railChipClass({ mark: null, state: 'safe', inert: false, aimed: true })).toBe('guard-rail-cell guard-slot safe aimed')
    expect(railChipClass({ mark: null, state: 'blocked', inert: true, aimed: true })).toBe('guard-rail-cell blocked inert aimed')
    // …and the two appended flags keep their order, which is what the reskin's
    // STATE-CLASS LAW pins on the other side.
    expect(railChipClass({ mark: { face: 'reseat', tone: 'degraded' }, state: 'safe', inert: true, aimed: true }))
      .toBe('guard-rail-cell reseat degraded inert aimed')
  })
})

describe('§G2 — 新規用 beats 満室 at the composer, where the only road to it is (L4-m1)', () => {
  it('a FULL half hour inside a 確保 extent wears the hold’s word, its class and its mark', () => {
    // Unreachable on any real board — the engine checks the beds before the
    // guard, so a guard-classed chip always has a free half hour (§R-D sweeps
    // that on all four boards). The rung is real all the same, and this is the
    // one road to it: ask the composer directly.
    const cell: RailCell = {
      start: 780, state: 'blocked', label: '—', sentence: 'この開始ではベッドを60分確保できません',
      reason: 'bed', alternatives: [], alternativeKind: null, ackAllowed: true,
    }
    const room = { refusal: '13:00〜14:00はベッドに空きがありません。ベッド1（見本 かえる様）が使用中です', blockers: [{ kind: 'booking' } as unknown as BoardItem] }
    const full = { full: true, refusal: room.refusal, blockers: room.blockers }
    const plain = railExplain(cell, 60, { room, halfHour: full })
    expect(plain.word).toBe('満室')
    const held = railExplain(cell, 60, { room, halfHour: full, reservedHalf: true, reservedDur: 90 })
    expect({ word: held.word, wordReason: held.wordReason, cue: held.cue }).toEqual({
      word: '新規用', wordReason: 'guard', cue: { kind: 'guard', label: ['新規用'] },
    })
    expect(held.sentence).toBe(`${room.refusal}。${reservedClause(90)}`)
  })
})

// ── §FIX3 — the delta round's two MAJORs, the breaker's survivor, one invariant

describe('§H1 — the door answers on the board the chip is judged on (D1-M1)', () => {
  /** The lens's own scene: p-01 holds a 13:00〜14:00 card on ベッド1, ベッド2 is
   *  free and advertised on p-02's row, and p-01's card is the one in hand. */
  const draggedScene = (): BoardLane[] => [
    handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ', items: [handItem({ key: 'h', caseId: 'apt-hand' }, 780, 840)] }),
    handLane({ key: 'p-02', group: 'staff', label: '見本 かおる' }),
    handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [handItem({ key: 'hb', caseId: 'apt-hand' }, 780, 840)] }),
    handLane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
  ]
  const box: SellCell = { laneKey: 'p-02', resourceKey: 'bed-02', group: 'staff', staff: 'p-02', bed: 'ベッド2', h: 780, price: 7000, tier: 2 }

  /** The strip as the SCREEN builds it mid-gesture: the rails lift the card in
   *  hand (`excludeId`, `placementFeasible: bedDoorFor(handId)`), and the
   *  composer is told about the same hand. Without that lift the engine still
   *  sees the card on the row and refuses the pocket, and the question this
   *  scene is about — what the DOOR says — never gets asked. */
  const explainDrag = (lanes: BoardLane[], handId: string | null, over: Partial<Parameters<typeof explainRails>[2]>) => {
    const views = bedViewsFor(lanes, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, handId)
    const door = bedDoor(views, lanes, handId)
    const rails = guardRailsFor(lanes, {
      open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
      nowMinute: null, locked: [], guard: HAND_GUARD, excludeId: handId,
      placementFeasible: door, protectedWindowFeasible: bedDoor(views, lanes, null), resting: null,
    })
    return explainRails(rails, lanes, {
      dur: 60, handId, stagedId: null, sellCells: [], claims: [], drops: [],
      inHand: false, sellDisplayed: true, ...over,
    })
  }

  /** The screen's own door, both worlds, exactly as `bedsOver` picks them. */
  const doorOn = (lanes: BoardLane[], handId: string | null) => {
    const views = bedViewsFor(lanes, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, handId)
    return (laneKey: string, start: number, end: number) => {
      const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
      if (!lane) return null
      const book = handId != null && handId === views.handId && views.worldMinusHand ? views.worldMinusHand : views.world
      const asker = { stores: lane.stores }
      const answer = book.bedFor(start, end, asker)
      if (!answer.compatibleRoomsExist) return null
      return { full: answer.laneKey === null, keys: () => book.freeBedKeys(start, end, asker) }
    }
  }

  it('a bed-lane drag of the operator’s OWN card never blames a stranger for their own card', () => {
    // ⚠ THE MAJOR. `explainRails` returns early on the ordinary staff-row move,
    // but a BED-LANE drag, a RESIZE and a drag OVER THE SHELF reach it with
    // `handId` set — the three gestures this round went to the trouble of
    // handling. The chip's own room question lifts that card out (`askOn` passes
    // `id: handId` and `allocateBed` self-excludes); the door did not, so it saw
    // ベッド1 as busy, decided ベッド2 was the ONLY free room, found かおる's box
    // on it, and hatched 「別の枠で販売中」 over the operator's own 13:00 — naming
    // a stranger for an emptiness that is the card in their hand.
    const lanes = draggedScene()
    const said = explainDrag(lanes, 'apt-hand', { sellCells: [box], bedsOver: doorOn(lanes, 'apt-hand') })
      .get('p-01')!.get(780)!
    expect(said.cue).toBeNull()
    expect(said.sentence).not.toContain('別のスタッフ')
    expect(said.sentence).toContain('この開始には販売可能枠が出ていません')
  })

  it('…and at rest the same half hour says nothing at all — the card is drawn on the row', () => {
    // The mirror, stated honestly: put the card down and that half hour stops
    // being a gap (⚖ F1), so the strip adds nothing to what the operator can
    // already see. The first assertion is therefore about the WORLD the door
    // reads, not about the predicate — which the free-bed lists below make exact.
    const lanes = draggedScene()
    const said = explainDrag(lanes, null, { sellCells: [box], bedsOver: doorOn(lanes, null) }).get('p-01')!.get(780)!
    expect({ word: said.word, cue: said.cue }).toEqual({ word: null, cue: null })
    expect(said.sentence).not.toContain('別のスタッフ')
  })

  it('and the SCREEN picks that world — the door reads the book the hand lifted', () => {
    // The predicate above is provable here; WHICH BOOK the screen hands it is
    // not — `bedsOver` lives inside the component and this folder's import
    // fence keeps a renderer out. So the choice is pinned at its source, the
    // same way every other wiring on this strip is, and in the same words
    // `bedDoor` uses at TodayScreen:275.
    const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
    expect(SRC).toContain(
      "const book = handId != null && handId === ledger.handId && ledger.worldMinusHand ? ledger.worldMinusHand : ledger.world",
    )
    expect(SRC).toContain('const answer = book.bedFor(start, end, asker)')
    expect(SRC).toContain('keys: () => book.freeBedKeys(start, end, asker)')
    // ⚖ FIX ROUND 3 (H4) — and the asker carries no 個室のみ tag on either world.
    // A placement nobody has made needs no 個室 (`bedDoor` states the same law),
    // the book discards the field for a NewClient anyway, and it is the shape
    // the book CACHES — the Subject alternative measured 5,518 book calls per
    // pointer frame on a 30×10 board against 542.
    expect(SRC).toContain('const asker = { stores: lane.stores }')
    expect(SRC).not.toContain('requiresPrivate: held?.requiresPrivateRoom === true, stores: lane.stores')
  })

  it('the two worlds really do differ here — the free-bed list is the whole of it', () => {
    const lanes = draggedScene()
    const rest = doorOn(lanes, null)('p-01', 780, 810)!
    const dragging = doorOn(lanes, 'apt-hand')('p-01', 780, 810)!
    expect([...rest.keys()].sort()).toEqual(['bed-02'])
    expect([...dragging.keys()].sort()).toEqual(['bed-01', 'bed-02'])
  })
})

describe('§H2 — a ⇄ chip carries no row note (D1-M2)', () => {
  /** The lens's own dual scene, built so BOTH predicates fire on one chip:
   *  ベッド1 is the ONLY room free over 13:00〜13:30 (so the sold note qualifies)
   *  and it is busy 13:30〜14:00, so the 60-minute start is bed-refused; ベッド3
   *  is free exactly where that occupant needs to go, so the pack finds a
   *  re-seat (so the ⇄ mark qualifies). One box on p-06's row stands on ベッド1
   *  over the half hour. */
  const dualScene = (): BoardLane[] => [
    handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ' }),
    // The movers stand on a staff row too, the way the board really carries
    // them — the packing search reads each one's own lane for the store rule.
    handLane({
      key: 'p-06', group: 'staff', label: '見本 かおる',
      items: [
        handItem({ key: 'xs', caseId: 'apt-x', title: '見本 きり' }, 810, 840),
        handItem({ key: 'ys', caseId: 'apt-y', title: '見本 そら' }, 600, 1140),
        handItem({ key: 'zs', caseId: 'apt-z', title: '見本 かえる' }, 600, 810),
      ],
    }),
    handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [handItem({ key: 'x', caseId: 'apt-x', title: '見本 きり' }, 810, 840)] }),
    handLane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [handItem({ key: 'y', caseId: 'apt-y', title: '見本 そら' }, 600, 1140)] }),
    handLane({ key: 'bed-03', group: 'beds', label: 'ベッド3', items: [handItem({ key: 'z', caseId: 'apt-z', title: '見本 かえる' }, 600, 810)] }),
  ]
  const dualBox: SellCell = { laneKey: 'p-06', resourceKey: 'bed-01', group: 'staff', staff: 'p-06', bed: 'ベッド1', h: 780, price: 7000, tier: 2 }
  const dual = () => {
    const lanes = dualScene()
    return explainHand(lanes, {
      sellCells: [dualBox],
      bedsOver: handDoor(lanes),
      reseat: {
        hours: HOURS, nowMinute: null, cleanupMinutesByBed: {},
        landingOn: () => ({ kind: 'caution' as const, reason: 'ここに置くと13:00〜14:30の新規（90分）が入らなくなります' }),
      },
    }).get('p-01')!.get(780)!
  }

  it('a chip that qualifies for BOTH wears the mark and nothing on the lane', () => {
    // ⚠ THE MAJOR, on the scene where the two really do meet. Round 2 returned
    // whatever the sold predicate said from the re-seat branch, so this chip
    // promised the board would make room by moving somebody WHILE the mark
    // under it said the bed was already sold on another row.
    const said = dual()
    expect(said.mark).toEqual({ face: 'reseat', tone: 'degraded' })
    expect(said.cue).toBeNull()
    expect(said.sentence).toContain('ここに置くと、ほかのお客様のベッドを入れ替えて収めます')
  })

  it('…and the sold note really would have fired there, or the pin proves nothing', () => {
    // The same board with the re-seat door withheld: the chip loses its mark and
    // the note appears, which is what makes the assertion above about PRECEDENCE
    // rather than about a scene that never qualified.
    const lanes = dualScene()
    const without = explainHand(lanes, { sellCells: [dualBox], bedsOver: handDoor(lanes) }).get('p-01')!.get(780)!
    expect(without.mark).toBeNull()
    expect(without.cue).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
  })

  it('the ⇄ chip on Liam’s own scene C is unchanged by this', () => {
    // ⚠ THE OTHER MAJOR, and the composer's own comment already promised it.
    // The two are reachable together: ⇄ needs a bed free in the half hour, the
    // sold note needs every free bed claimed elsewhere — ONE free claimed bed
    // satisfies both. The chip promised the board would make room by moving
    // somebody while the note under it said the bed was sold on another row.
    const chip = readBoard(sceneC()).lanes['p-05'].chips.find((c) => c.start === 840)!
    expect(chip.face).toBe('⇄14:00')
    const marked = explainWith(sceneC(), allocateBed).get('p-05')!.get(840)!
    expect(marked.mark).toEqual({ face: 'reseat', tone: 'degraded' })
    expect(marked.cue).toBeNull()
  })

  it('…on every board, and by construction: no chip has both a mark and a cue', () => {
    for (const b of boards()) {
      const explained = explainWith(b.lanes, allocateBed)
      for (const [laneKey, per] of explained) {
        for (const [start, said] of per) {
          expect({ at: `${b.name}/${laneKey}@${clock(start)}`, both: said.mark != null && said.cue != null })
            .toEqual({ at: `${b.name}/${laneKey}@${clock(start)}`, both: false })
        }
      }
    }
  })
})

describe('§H7 — `restCueStarts` really does lift the card in hand (delta breaker N4)', () => {
  it('the hand’s own card does not cover the half hour it is being dragged off', () => {
    // ⚠ THE BREAKER'S SURVIVOR: dropping this exclusion passed all 10,700 tests,
    // because every shipped call site passes `null`. The parameter is real and
    // load-bearing — same inputs, only the id differs, genuinely different
    // output — and it is the fix round 2 (L2-m4) that keeps the lane's mark and
    // the chip's word from disagreeing for the length of a bed-lane drag.
    const worded: ReadonlyMap<number, { cue: RailCue | null }> = new Map([[780, { cue: { kind: 'bed' as const, label: ['満室'] } }]])
    const itemsHere = [handItem({ key: 'apt-hand', caseId: 'apt-hand' }, 780, 810)]
    expect(restCueStarts(worded, [], [], [], itemsHere, null)).toEqual([])
    expect(restCueStarts(worded, [], [], [], itemsHere, 'apt-hand'))
      .toEqual([{ start: 780, end: 810, kind: 'bed', label: ['満室'] }])
    // …and its own trailing 清掃 travels with it, exactly as `allocateBed` says.
    const withTail = [...itemsHere, { ...handItem({ key: 'apt-hand-cleanup', caseId: null }, 810, 825), kind: 'cleanup' as const }]
    expect(restCueStarts(new Map([[810, { cue: { kind: 'bed' as const, label: ['満室'] } }]]), [], [], [], withTail, 'apt-hand'))
      .toEqual([{ start: 810, end: 840, kind: 'bed', label: ['満室'] }])
    // Somebody ELSE's card is not lifted by anybody's hand.
    const other = [handItem({ key: 'x', caseId: 'apt-other' }, 780, 810)]
    expect(restCueStarts(worded, [], [], [], other, 'apt-hand')).toEqual([])
  })
})

describe('§H5 — the invariant the F1 comment rests on (D1-m6)', () => {
  it('a half hour covered on its own row is never the ENGINE’s bed refusal', () => {
    // F1's comment claims a covered half hour keeps today's word 「byte for
    // byte」. That is true, but it rests on an unstated invariant: a covered
    // half hour fails the POCKET, so the engine's class there is `fit` and
    // never `bed` — which is why nulling the half-hour answer can lose nothing.
    // The lens swept 10,980 chips and found 0 counter-examples; this pins it on
    // the four boards the round is judged on.
    for (const b of boards()) {
      for (const rail of railsOn(b.lanes)) {
        const lane = laneOf(b.lanes, rail.laneKey)
        for (const c of rail.cells) {
          const covered = lane.items.some((i) => i.startMin < c.start + 30 && c.start < i.endMin)
          if (!covered) continue
          expect({ at: `${b.name}/${rail.laneKey}@${clock(c.start)}`, reason: c.reason === 'bed' })
            .toEqual({ at: `${b.name}/${rail.laneKey}@${clock(c.start)}`, reason: false })
        }
      }
    }
  })
})

// ── §FIX4 — the mini-delta lens's MAJOR, on its own scene ──────────────────

describe('§H9 — a 個室のみ card in hand is asked about ITS OWN rooms (MD1-MAJOR-1)', () => {
  /** The lens's board: one 個室 and one standard room. The 個室 is busy right
   *  across 13:00〜14:00 with a stranger; the standard room is free. The
   *  operator is dragging a 個室のみ card by its bed row, so `inHand` is false
   *  and `handId` is set — one of the three gestures that reach the composer. */
  const privateScene = (): BoardLane[] => [
    handLane({
      key: 'p-01', group: 'staff', label: '見本 あずさ',
      items: [{ ...handItem({ key: 'h', caseId: 'apt-hand', title: 'テスト なぎ' }, 660, 720), requiresPrivateRoom: true }],
    }),
    handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    handLane({
      key: 'bed-09', group: 'beds', label: '個室', roomClass: 'private',
      items: [handItem({ key: 's', caseId: 'apt-s', title: '見本 そら' }, 600, 1140)],
    }),
  ]

  /** The screen's own door: the hand-lifted world, the hypothetical asker. */
  const doorOn = (lanes: BoardLane[], handId: string | null) => {
    const views = bedViewsFor(lanes, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, handId)
    return (laneKey: string, start: number, end: number) => {
      const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
      if (!lane) return null
      const book = handId != null && handId === views.handId && views.worldMinusHand ? views.worldMinusHand : views.world
      const asker = { stores: lane.stores }
      const answer = book.bedFor(start, end, asker)
      if (!answer.compatibleRoomsExist) return null
      return { full: answer.laneKey === null, keys: () => book.freeBedKeys(start, end, asker) }
    }
  }

  const dragging = (lanes: BoardLane[], handId: string | null, over: Partial<Parameters<typeof explainRails>[2]> = {}) => {
    const views = bedViewsFor(lanes, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, handId)
    const rails = guardRailsFor(lanes, {
      open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
      nowMinute: null, locked: [], guard: HAND_GUARD, excludeId: handId,
      placementFeasible: bedDoor(views, lanes, handId), protectedWindowFeasible: bedDoor(views, lanes, null), resting: null,
    })
    return explainRails(rails, lanes, {
      dur: 60, handId, stagedId: null, sellCells: [], claims: [], drops: [],
      inHand: false, sellDisplayed: true, bedsOver: doorOn(lanes, handId), ...over,
    }).get('p-01')!
  }

  it('the word comes back — 満室 over a half hour that is full FOR THAT CARD', () => {
    // ⚠ THE MAJOR. The sentence was already right: it is asked as the hand's own
    // Subject (`askOn` carries the 個室のみ tag). The WORD was asked of the
    // door's hypothetical, which the book answers with `requiresPrivate: false`,
    // so 「a standard bed is free」 silenced the chip under a sentence saying the
    // 個室 is full. A word the board HAD on main, lost on a reachable gesture.
    const said = dragging(privateScene(), 'apt-hand').get(780)!
    expect(said.word).toBe('満室')
    expect(said.wordReason).toBe('bed')
    expect(said.cue).toEqual({ kind: 'bed', label: ['満室'] })
    expect(said.sentence).toBe('13:00〜14:00は個室に空きがありません。個室（見本 そら様 10:00〜19:00）が使用中です')
  })

  it('…and the word and the sentence are now one question, not two', () => {
    // The point of the fix is not the word, it is that both halves are asked of
    // the same asker: `halfWalk` IS `askOn`'s Subject. So the room the sentence
    // names and the room the word is about can never come apart.
    const said = dragging(privateScene(), 'apt-hand').get(780)!
    expect(said.sentence).toContain('個室に空きがありません')
    expect(said.word).toBe('満室')
  })

  it('a PLAIN card in hand is untouched — only a 個室のみ hand pays the walk', () => {
    // With no tag the hypothetical and the Subject agree (the hand-lifted world
    // has already taken that card out), so nothing about this drag changes and
    // nothing extra is asked. Same board, same gesture, the tag removed.
    const plain = privateScene().map((l) =>
      l.key === 'p-01' ? { ...l, items: l.items.map((i) => ({ ...i, requiresPrivateRoom: false })) } : l,
    )
    const said = dragging(plain, 'apt-hand').get(780)!
    // 標準 room is free for an untagged card, so the half hour is not full…
    expect(said.word).toBeNull()
    // …and the sentence agrees, because both halves ask the same untagged thing.
    expect(said.sentence).not.toContain('個室に空きがありません')
  })

  it('and at REST the tag plays no part — the door keeps its cached hypothetical', () => {
    // The fix is gated on a hand, so with nothing in hand the board reads the
    // same whether that card is 個室のみ or not: every chip, byte for byte.
    // (⚖ #777's own law says why the tag must not ride the resting question —
    // the marks are drawn for a placement nobody has made.)
    const priv = privateScene()
    const plain = priv.map((l) =>
      l.key === 'p-01' ? { ...l, items: l.items.map((i) => ({ ...i, requiresPrivateRoom: false })) } : l,
    )
    const a = dragging(priv, null)
    const b = dragging(plain, null)
    for (const [start, said] of a) {
      expect({ at: clock(start), said }).toEqual({ at: clock(start), said: b.get(start)! })
    }
  })

  it('the extra walk is paid ONLY by a 個室のみ hand, and once per start', () => {
    // The cost the fix accepts, counted: `halfWalk` is memoised per (store set,
    // start) for the whole call, so a 個室のみ drag pays one allocator ask per
    // EMPTY start and a plain drag pays what it paid before.
    const count = (lanes: BoardLane[], handId: string | null) => {
      let n = 0
      const allocate: typeof allocateBed = (l, o) => { n += 1; return allocateBed(l, o) }
      dragging(lanes, handId, { allocate })
      return n
    }
    const priv = privateScene()
    const plain = priv.map((l) =>
      l.key === 'p-01' ? { ...l, items: l.items.map((i) => ({ ...i, requiresPrivateRoom: false })) } : l,
    )
    expect(count(priv, 'apt-hand')).toBeGreaterThan(count(plain, 'apt-hand'))
    expect(count(priv, null)).toBe(count(plain, null))
  })
})

// ── §FIX5 — Greptile's read of the open stack ─────────────────────────────

describe('§J1 — the sold note’s hold gate is the HALF HOUR’s (Greptile #871 P1)', () => {
  /** Greptile's scene: a 60-minute chip at 14:30 whose 確保 window opens at
   *  15:00. The chip's judged hour overlaps the hold; its FIRST HALF HOUR does
   *  not, and that half hour is the one the mark is drawn over. */
  const scene = (): BoardLane[] => [
    handLane({ key: 'p-01', group: 'staff', label: '見本 あずさ' }),
    handLane({ key: 'p-02', group: 'staff', label: '見本 かおる' }),
    handLane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
  ]
  const box: SellCell = { laneKey: 'p-02', resourceKey: 'bed-01', group: 'staff', staff: 'p-02', bed: 'ベッド1', h: 870, price: 7000, tier: 2 }
  /** 15:00〜16:30 held on あずさ — after the 14:30 chip's own half hour, inside
   *  the hour it judges. */
  const HELD = [{ laneKey: 'p-01', protectedCount: 1, spans: [{ start: 900, end: 990, windowStart: 900 }] }]

  const at = (over: Partial<Parameters<typeof explainRails>[2]>) => {
    const lanes = scene()
    return explainHand(lanes, { sellCells: [box], bedsOver: handDoor(lanes), ...over }).get('p-01')!.get(870)!
  }

  it('a hold that opens AFTER the half hour does not take the note away', () => {
    // ⚠ THE FINDING. `reserved` is the chip's whole 14:30〜15:30; the store is
    // holding 15:00〜16:30. Gating the mark on the window meant the note vanished
    // over 14:30〜15:00 — 30 minutes the store is not holding, where ベッド1 is
    // the only free room and it is being sold on かおる's row.
    const held = at({ held: HELD })
    expect(held.cue).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
    // …and the SENTENCE keeps the window's own answer: the E3b clause quotes the
    // held span's dial, so it is right to be about the hour that overlaps it.
    expect(held.sentence).toContain('新規のお客様のための90分枠として確保しています')
  })

  it('a hold that covers the half hour ITSELF still takes it away', () => {
    // The gate is narrowed, not removed — ⚖ E3b's 確保 chip is drawn over that
    // emptiness and a second, softer answer under it is what flag 88 forbids.
    const over = [{ laneKey: 'p-01', protectedCount: 1, spans: [{ start: 870, end: 960, windowStart: 870 }] }]
    expect(at({ held: over }).cue).toBeNull()
  })

  it('with no hold at all the note is there either way — the scene is about the hold', () => {
    expect(at({}).cue).toEqual({ kind: 'sold', label: ['別の枠で', '販売中'] })
  })
})
