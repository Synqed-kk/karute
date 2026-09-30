/**
 * 今日の運営 — THE HELD DELTA (LEAD RULING R1/R2/R3/R8l, DECISIONS.md
 * today-impact-2026-09-30). c1: the pure delta and the one sellable predicate.
 * c2a: the gate, the faces and the rows by KIND (T1, T2, T5–T7, T9, T12, T14).
 * T3, T4, T8, T10, T11 (task 3) and T15 (task 4) are not here yet.
 */
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))

import { heldDelta } from '@/app/[locale]/(business)/business/today/held-delta'
import {
  applyMoves, dayLossOf, guardVerdictAt, heldPriceOf, lossOf, pocketLossOf, restingSpanFor, sellableLaneKeysOf, storeHasBeds,
  warnFaceFor, windowsOf, type DayWindows, type Moves, type RailCell,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { STORE_A } from '@/business/lib/fixtures'
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import { TodayScreen, bedDoor, bedViewsFor, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { honestHeld } from '@/app/[locale]/(business)/business/today/honest-held'
import { heldCommittedFor } from '@/app/[locale]/(business)/business/today/held-committed'
import { place } from '@/business/lib/today-board'
import { RESOURCE_WORDS } from '@/business/lib/resource-words'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import type { BoardLane } from '@/business/lib/today-board'

// ── the board pipeline (scratch/tmp-today-impact-repro.test.ts, rebuilt) ──
const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock
const LANE_WORDS = { byLaneKey: {}, generic: RESOURCE_WORDS.chiropractic }
const WORDS = RESOURCE_WORDS.chiropractic
const ASK_A = { resourceNoun: WORDS.resourceNoun, privateWord: WORDS.privateWord! }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function screenProps(node: any): TodayProps | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === TodayScreen) return node.props
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) { const h = screenProps(kid); if (h) return h }
  return null
}
let REAL: TodayProps
beforeAll(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z'))
  supabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({ select: () => chain(r), eq: () => chain(r), maybeSingle: async () => r })
  service.mockReturnValue({ from: (t: string) => chain(t === 'business_workspace_grants' ? { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null } : t === 'profiles' ? { data: { customer_id: 'biz-1', is_management: false }, error: null } : { data: null, error: null }) })
  REAL = screenProps(await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE_A }) }))!
})
afterAll(() => jest.useRealTimers())
const log = (tag: string, v: unknown) => process.stdout.write(`DERIVED ${tag} ${JSON.stringify(v)}\n`)

function dayOf(lanes: BoardLane[]): DayWindows {
  const frame = { openMin: REAL.hours.open, closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute ?? REAL.hours.open }
  const raw = heldCommittedFor({
    gateOn: true, lanes, frame, bookOf: (l, f, h) => bedViewsFor(l, f, h, ASK_A),
    closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute, guard: REAL.guard.config, gapGuardMode: REAL.guard.mode, released: [],
  })
  const honest = honestHeld(raw!, lanes, bedViewsFor(lanes, frame, null, ASK_A).world, true, (l) => storeHasBeds(lanes, l.stores))
  return windowsOf(honest, lanes, [])
}
/** Stage the さくら card (apt-26, しろう 14:30–15:30) at [s, e) on its own lane and
 *  compose the popup exactly as the screen does: one delta, one face. */
function landing(s: number, e: number) {
  const lanes = REAL.lanes
  const lane = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.kind === 'booking' && i.title.includes('さくら')))!
  const item = lane.items.find((i) => i.kind === 'booking' && i.title.includes('さくら'))!
  const id = item.caseId!
  const pl = place(s, e, REAL.hours)
  const moves: Moves = { [id]: { laneKey: lane.key, x: pl.x, w: pl.w } }
  const staged = applyMoves(lanes, moves, [], [], REAL.hours, LANE_WORDS, {})
  const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
  const depth = Math.round((1 - price.lo / price.hi) * 100)
  const frame = { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax }
  const nowFrame = { openMin: REAL.hours.open, closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute ?? REAL.hours.open }
  const cell = guardVerdictAt(staged, lane.key, s, {
    open: REAL.hours.open, close: REAL.hours.close, stepMin: 30, dur: e - s, protectedDur: REAL.guard.protectedDurationMin,
    nowMinute: REAL.sell.nowMinute, locked: [], guard: REAL.guard.config, excludeId: id,
    placementFeasible: bedDoor(bedViewsFor(staged, nowFrame, id, ASK_A), staged, id),
    protectedWindowFeasible: bedDoor(bedViewsFor(staged, nowFrame, null, ASK_A), staged, null),
    resting: restingSpanFor({ id, origin: { laneKey: lane.key, x: item.x, w: item.w } } as never, lanes, id, REAL.hours, REAL.dayOffset, REAL.store),
    restingWindowFeasible: undefined,
  }, LANE_WORDS)
  const before = dayOf(lanes)
  const after = dayOf(staged)
  const day = heldDelta(before, after, heldPriceOf(frame, depth, REAL.guard.protectedDurationMin))
  const dayHeld = after.byLane.find((l) => l.laneKey === lane.key)?.starts ?? []
  const withDay = cell == null ? null : { ...cell, day, dayHeld }
  const model = warnFaceFor({
    rows: [], cell: withDay, override: null, level: REAL.overrideLevel, holdToConfirm: REAL.holdToConfirm,
    targetLaneMine: lane.mine, operatorName: REAL.operatorName, listPrice: lane.listPrice, frame, depth,
    protectedDur: REAL.guard.protectedDurationMin, confirmEnabled: true, resourceNoun: WORDS.resourceNoun,
  })
  return { cell, withDay, day, model, before, after, start: item.startMin }
}
const labels = (rows: ReadonlyArray<{ label: string }>) => rows.map((r) => r.label)
const hand = (over: Partial<RailCell>): RailCell => ({
  start: 900, state: 'safe', label: '', sentence: '', reason: null, alternatives: [], alternativeKind: null, ackAllowed: true, ...over,
} as RailCell)
const faceOf = (cell: RailCell) => warnFaceFor({
  rows: [], cell, override: null, level: 'allow-warned', holdToConfirm: true, targetLaneMine: false, operatorName: '見本 たろう',
  listPrice: 8000, frame: null, depth: 0, protectedDur: REAL.guard.protectedDurationMin, confirmEnabled: true, resourceNoun: WORDS.resourceNoun,
})
const zero = () => 0

type LaneRow = DayWindows['byLane'][number]
const row = (laneKey: string, starts: number[], over: Partial<LaneRow> = {}): LaneRow => ({
  laneKey, label: `見本 ${laneKey}`, starts, listPrice: 8000, sellable: true, ...over,
})
const day = (byLane: LaneRow[], exact = true): DayWindows => ({
  total: byLane.reduce((n, l) => n + l.starts.length, 0), exact, byLane,
})
/** A stand-in price: one yen per start per list-price yen, so Σ is checkable by eye. */
const price = (starts: readonly number[], listPrice: number) => starts.length * listPrice

describe('heldDelta — the pure store-level delta', () => {
  it('T5 a hop onto a lane not sold online: counted holds, sellable drops', () => {
    const before = day([row('A', [900]), row('B', [], { sellable: false, listPrice: 0 })])
    const after = day([row('A', []), row('B', [900], { sellable: false, listPrice: 0 })])
    const d = heldDelta(before, after, price)
    expect([d.countedBefore, d.countedAfter, d.sellableBefore, d.sellableAfter]).toEqual([1, 1, 1, 0])
    expect(d.lost.map((w) => `${w.laneKey}|${w.windowStart}`)).toEqual(['A|900'])
    expect(d.gained.map((w) => `${w.laneKey}|${w.windowStart}`)).toEqual(['B|900'])
    expect(d.shifted).toEqual([])
    expect([d.valueBefore, d.valueAfter]).toEqual([8000, 0])
    expect(d.channel).toBe('free')
  })

  it('T6 a true loss: counted 3→2, the lost lane named', () => {
    const before = day([row('L', [900, 1000]), row('M', [960])])
    const after = day([row('L', [1000]), row('M', [960])])
    const d = heldDelta(before, after, price)
    expect([d.countedBefore, d.countedAfter, d.sellableBefore, d.sellableAfter]).toEqual([3, 2, 3, 2])
    expect(d.lost).toEqual([{ laneKey: 'L', label: '見本 L', windowStart: 900, listPrice: 8000 }])
    expect(d.gained).toEqual([])
    expect(d.shifted).toEqual([])
    expect(d.valueBefore - d.valueAfter).toBe(8000)
  })

  it('T7 mixed: the landing lane AND another lane lose, a third gains — both losers named', () => {
    const before = day([row('L', [900]), row('M', [1000]), row('N', [])])
    const after = day([row('L', []), row('M', []), row('N', [900])])
    const d = heldDelta(before, after, price)
    expect([d.countedBefore, d.countedAfter]).toEqual([2, 1])
    expect(d.lost.map((w) => w.laneKey)).toEqual(['L', 'M'])
    expect(d.gained.map((w) => w.laneKey)).toEqual(['N'])
  })

  it('a same-lane move is a SHIFT, paired in start order, never loss + gain', () => {
    const before = day([row('A', [945]), row('B', [600, 700])])
    const after = day([row('A', [960]), row('B', [640, 720])])
    const d = heldDelta(before, after, price)
    expect(d.lost).toEqual([])
    expect(d.gained).toEqual([])
    expect(d.shifted.map((s) => `${s.laneKey}:${s.from}→${s.to}`)).toEqual(['A:945→960', 'B:600→640', 'B:700→720'])
  })

  it('a lane only one side carries is a loss or a gain on that lane', () => {
    const d = heldDelta(day([row('A', [900])]), day([row('B', [900])]), price)
    expect(d.lost.map((w) => `${w.laneKey}|${w.windowStart}`)).toEqual(['A|900'])
    expect(d.gained.map((w) => `${w.laneKey}|${w.windowStart}`)).toEqual(['B|900'])
  })

  it('T9 exact is the AND of both sides', () => {
    const d = heldDelta(day([row('A', [900, 1000]), row('B', [960])], false), day([row('A', [900]), row('B', [960])]), price)
    expect(d.exact).toBe(false)
    expect([d.countedBefore, d.countedAfter]).toEqual([3, 2])
    expect(heldDelta(day([]), day([]), price).exact).toBe(true)
  })

  it('T13 R3 seam: the nominated channel is not built', () => {
    expect(() => heldDelta(day([]), day([]), price, 'nominated')).toThrow(
      'R3: 指名 (nominated) channel is not built; DECISIONS.md today-impact-2026-09-30 R3',
    )
  })
})

describe('the one sellable predicate feeds the day layer', () => {
  const lane = (key: string, listPrice: number): BoardLane => ({
    key, group: 'staff', label: key, sub: '', absentNote: null, mine: false, items: [],
    window: { from: 600, until: 1140 }, untilLabel: '19:00', listPrice, stores: null, roomClass: null,
  } as BoardLane)

  it('priced, unlocked staff rows are sellable; a 0-price or locked row is not', () => {
    const lanes = [lane('p-01', 8000), lane('p-02', 0), lane('p-03', 7000)]
    expect([...sellableLaneKeysOf(lanes, ['p-03'])]).toEqual(['p-01'])
    const honest = {
      exact: false,
      byLane: ['p-01', 'p-02', 'p-03'].map((laneKey) => ({ laneKey, held: [{ start: 900, end: 990, windowStart: 900 }] })),
    }
    const w = windowsOf(honest, lanes, ['p-03'])
    expect(w.exact).toBe(false)
    expect(w.byLane.map((l) => [l.laneKey, l.sellable])).toEqual([['p-01', true], ['p-02', false], ['p-03', false]])
  })
})

describe('c2a — the gate, the faces and the rows, all out of the one delta', () => {
  const dur = () => REAL.guard.protectedDurationMin

  it('T5 a hop onto a row not sold online is a sellable loss: AMBER, key B', () => {
    const d = heldDelta(
      day([row('A', [900]), row('B', [], { sellable: false, listPrice: 0 })]),
      day([row('A', []), row('B', [900], { sellable: false, listPrice: 0 })]), zero)
    const cell = hand({ day: d })
    expect(dayLossOf(cell)).toBe(1)
    const m = faceOf(cell)
    expect(m.face).toBe('warn')
    expect(`${m.impact.head}|${m.impact.yen}|${m.impact.tail}`).toBe(
      `ここに置くと、店全体でオンライン販売中の新規のお客様の${dur()}分の空き|null|が1枠から0枠に減ります。見本 Aの15:00の枠が、オンライン販売をしていない見本 Bの15:00に移ります（確保している枠は1枠のまま）。`)
    expect(m.dayRows).toEqual([])
  })

  it('T6 a true loss: AMBER, key A, the lost lane named', () => {
    const d = heldDelta(day([row('L', [900, 1000]), row('M', [960])]), day([row('L', [1000]), row('M', [960])]), zero)
    const m = faceOf(hand({ day: d }))
    expect(m.face).toBe('warn')
    expect(`${m.impact.head}|${m.impact.yen}|${m.impact.tail}`).toBe(
      `ここに置くと、店全体で新規のお客様の${dur()}分の空き|null|が3枠から2枠に減ります。なくなるのは見本 Lの15:00の枠です。`)
  })

  it('T7 mixed: the landing lane is named with the other loser; H line 2 carries the movement', () => {
    const d = heldDelta(day([row('L', [900]), row('M', [1000]), row('N', [])]), day([row('L', []), row('M', []), row('N', [900])]), zero)
    const m = faceOf(hand({ day: d }))
    expect(m.face).toBe('warn')
    expect(m.impact.tail).toBe('が2枠から1枠に減ります。なくなるのは見本 Lの15:00・見本 Mの16:40の枠です。')
    // Lead ruling: line 2 pairs only — N's 15:00 takes the nearest lost start (L's 15:00); M stays in line 1.
    expect(labels(m.rows)).toEqual(['確保枠 見本 Lの15:00 → 見本 Nの15:00'])
  })

  it('T9 an approximate pair never gates: CLEAN, the G2 row', () => {
    const d = heldDelta(day([row('L', [900, 1000]), row('M', [960])], false), day([row('L', [1000]), row('M', [960])]), zero)
    const cell = hand({ day: d })
    expect(dayLossOf(cell)).toBe(0)
    const m = faceOf(cell)
    expect(m.face).toBe('clean')
    expect(labels(m.dayRows)).toEqual([
      `店全体の確保枠は概算で3枠→2枠（${WORDS.resourceNoun}の組み合わせをすべては調べきれませんでした。実際はもっと多いこともあります）`,
      '確保枠 見本 Lの15:00がなくなります',
    ])
  })

  it('T12 a pocket FACT survives beside a non-empty delta; a window CLAIM does not', () => {
    const d = heldDelta(day([row('A', [945]), row('B', [])]), day([row('A', []), row('B', [905])]), zero)
    const salv = 'ここに置くと割引でしか売れない空きが95分残ります'
    const fact = faceOf(hand({ state: 'warn', sentence: salv, day: d, dayHeld: [],
      impact: { code: 'R-SALV', capacityBefore: 1, capacityAfter: 1, windowsBefore: [945], windowsAfter: [945] } } as unknown as Partial<RailCell>))
    expect(fact.face).toBe('clean')
    expect(fact.guardRow?.label).toBe(salv)
    expect(labels(fact.dayRows)).toEqual(['確保枠 見本 Aの15:45 → 見本 Bの15:05（店全体は1枠のまま）'])
    const claim = faceOf(hand({ state: 'degraded', sentence: '15:45〜17:15の新規90分の空きを守れます', day: d, dayHeld: [],
      impact: { code: 'DEGRADED', capacityBefore: 1, capacityAfter: 1, windowsBefore: [945], windowsAfter: [945] } } as unknown as Partial<RailCell>))
    expect(claim.guardRow).toBeNull()
  })

  it('T14 a pocket-only cell: lossOf is pocketLossOf, byte for byte', () => {
    const cell = hand({ state: 'degraded', impact: { code: 'DEGRADED', capacityBefore: 3, capacityAfter: 1, windowsBefore: [], windowsAfter: [] } } as Partial<RailCell>)
    expect(lossOf(cell)).toBe(pocketLossOf(cell))
    expect(lossOf(cell)).toBe(2)
    expect(lossOf(null)).toBe(pocketLossOf(null))
  })

  it('T1 S2 (さくら 14:30–15:30 → 14:30–15:00): a same-count hop is a quiet row, never amber, and 守れます goes', () => {
    const r = landing(14 * 60 + 30, 15 * 60)
    log('T1', { counted: [r.day.countedBefore, r.day.countedAfter], sellable: [r.day.sellableBefore, r.day.sellableAfter], value: [r.day.valueBefore, r.day.valueAfter], lost: r.day.lost, gained: r.day.gained, shifted: r.day.shifted, rows: r.model.dayRows, guardRow: r.model.guardRow, cellSentence: r.cell?.sentence })
    expect([r.day.countedBefore, r.day.countedAfter]).toEqual([3, 3])
    expect(r.day.lost.map((w) => `${w.label}|${w.windowStart}`)).toEqual(['見本 しろう|945'])
    expect(r.day.gained.map((w) => `${w.label}|${w.windowStart}`)).toEqual(['見本 あずさ|905'])
    expect(r.day.shifted).toEqual([])
    expect(dayLossOf(r.withDay)).toBe(0)
    expect(r.model.face).toBe('clean')
    expect([r.day.sellableBefore, r.day.sellableAfter]).toEqual([3, 3]) // derived: every S2 lane is sold online
    // Derived: あずさ's 15:05 prices below しろう's 15:45 at the same 定価 (36,870 → 36,534.17), so key F rides (¥340).
    expect(labels(r.model.dayRows)).toEqual(['確保枠 見本 しろうの15:45 → 見本 あずさの15:05（店全体は3枠のまま・空きの金額は約¥340減）'])
    expect(labels([...r.model.rows, ...(r.model.guardRow ? [r.model.guardRow] : [])]).join('\n')).not.toContain('15:45〜17:15の新規90分の空きを守れます')
  })

  it('T2 S3 (→ 15:00–15:30): the delta is empty, no △ row, the 守れます row still prints', () => {
    const r = landing(15 * 60, 15 * 60 + 30)
    log('T2', { counted: [r.day.countedBefore, r.day.countedAfter], lost: r.day.lost, gained: r.day.gained, shifted: r.day.shifted, guardRow: r.model.guardRow, cellImpact: r.cell?.impact, dayHeld: r.withDay?.dayHeld })
    expect([r.day.lost, r.day.gained, r.day.shifted]).toEqual([[], [], []])
    expect(r.model.face).toBe('clean')
    expect(r.model.dayRows).toEqual([])
    expect(r.model.guardRow?.label).toContain('守れます')
  })
})
