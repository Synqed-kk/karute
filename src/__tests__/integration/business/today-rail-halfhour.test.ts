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
  explainRails,
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
    const full = { free: 0, refusal: room.refusal, blockers: room.blockers }
    const plain = railExplain(cell, 60, { room, halfHour: full })
    expect(plain.word).toBe('満室')
    const held = railExplain(cell, 60, { room, halfHour: full, reservedHalf: true, reservedDur: 90 })
    expect({ word: held.word, wordReason: held.wordReason, cue: held.cue }).toEqual({
      word: '新規用', wordReason: 'guard', cue: { kind: 'guard', label: ['新規用'] },
    })
    expect(held.sentence).toBe(`${room.refusal}。${reservedClause(90)}`)
  })
})
