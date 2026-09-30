/**
 * 今日の運営 — THE HELD DELTA (LEAD RULING R1/R2/R3/R8l, DECISIONS.md
 * today-impact-2026-09-30). c1: the pure delta and the one sellable predicate.
 * c2a: the gate, the faces and the rows by KIND (T1, T2, T5–T7, T9, T12, T14).
 * c2b: T3, T4, T8, T10, T11 on the fixture board. T15 (law-off) is task 4.
 */
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))

import { heldDelta } from '@/app/[locale]/(business)/business/today/held-delta'
import {
  applyMoves, dayLossOf, dayOnlyCell, guardVerdictAt, heldPriceOf, lossOf, pairsOf, pocketLossOf, restingSpanFor, sellableLaneKeysOf, storeHasBeds,
  warnFaceFor, windowsOf, EMPTY_WINDOWS, type DayWindows, type Moves, type RailCell,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { STORE_A } from '@/business/lib/fixtures'
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import { TodayScreen, bedDoor, bedViewsFor, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { honestHeld } from '@/app/[locale]/(business)/business/today/honest-held'
import { heldCommittedFor } from '@/app/[locale]/(business)/business/today/held-committed'
import { releaseTimed } from '@/app/[locale]/(business)/business/today/timed-release'
import type { ReleasedWindow } from '@/app/[locale]/(business)/business/today/reserved-mask'
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

/** A settled board's day answer, the screen's own chain: heldCommittedFor (manual
 *  keep-backs in `released`) → releaseTimed (D-11) → honestHeld → windowsOf. */
type DayOpts = { released?: ReleasedWindow[]; now?: number | null; beforeMin?: number | null; on?: boolean }
function dayOf(lanes: BoardLane[], o: DayOpts = {}): DayWindows {
  const frame = { openMin: REAL.hours.open, closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute ?? REAL.hours.open }
  const raw = heldCommittedFor({
    gateOn: true, lanes, frame, bookOf: (l, f, h) => bedViewsFor(l, f, h, ASK_A),
    closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute, guard: REAL.guard.config, gapGuardMode: REAL.guard.mode, released: o.released ?? [],
  })
  const mask = o.now === undefined ? raw : releaseTimed(raw, o.now, o.beforeMin ?? null, o.released ?? []).mask
  // `on: false` is HONEST_HELD's identity arm (TodayScreen's law-off day memos), no book asked.
  const honest = honestHeld(mask!, lanes, bedViewsFor(lanes, frame, null, ASK_A).world, o.on ?? true, (l) => storeHasBeds(lanes, l.stores))
  return windowsOf(honest, lanes, [])
}
/** Stage one fixture booking (by caseId) at [s, e) on `toLane` (its own lane by
 *  default) and compose the popup exactly as the screen does: one delta, one face. */
function landingOf(caseId: string, toLane: string | null, s: number, e: number, beforeOpts: DayOpts = {}, afterOpts: DayOpts = {}) {
  const lanes = REAL.lanes
  const lane = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === caseId))!
  const item = lane.items.find((i) => i.caseId === caseId)!
  const target = toLane ?? lane.key
  const id = item.caseId!
  const pl = place(s, e, REAL.hours)
  const moves: Moves = { [id]: { laneKey: target, x: pl.x, w: pl.w } }
  const staged = applyMoves(lanes, moves, [], [], REAL.hours, LANE_WORDS, {})
  const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
  const depth = Math.round((1 - price.lo / price.hi) * 100)
  const frame = { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax }
  const nowFrame = { openMin: REAL.hours.open, closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute ?? REAL.hours.open }
  const cell = guardVerdictAt(staged, target, s, {
    open: REAL.hours.open, close: REAL.hours.close, stepMin: 30, dur: e - s, protectedDur: REAL.guard.protectedDurationMin,
    nowMinute: REAL.sell.nowMinute, locked: [], guard: REAL.guard.config, excludeId: id,
    placementFeasible: bedDoor(bedViewsFor(staged, nowFrame, id, ASK_A), staged, id),
    protectedWindowFeasible: bedDoor(bedViewsFor(staged, nowFrame, null, ASK_A), staged, null),
    resting: restingSpanFor({ id, origin: { laneKey: lane.key, x: item.x, w: item.w } } as never, lanes, id, REAL.hours, REAL.dayOffset, REAL.store),
    restingWindowFeasible: undefined,
  }, LANE_WORDS)
  const before = dayOf(lanes, beforeOpts)
  const after = dayOf(staged, afterOpts)
  const day = heldDelta(before, after, heldPriceOf(frame, depth, REAL.guard.protectedDurationMin))
  const dayHeld = after.byLane.find((l) => l.laneKey === target)?.starts ?? []
  const withDay = cell == null ? dayOnlyCell(day, dayHeld) : { ...cell, day, dayHeld }
  const targetLane = staged.find((l) => l.group === 'staff' && l.key === target)!
  const model = warnFaceFor({
    rows: [], cell: withDay, override: null, level: REAL.overrideLevel, holdToConfirm: REAL.holdToConfirm,
    targetLaneMine: targetLane.mine, operatorName: REAL.operatorName, listPrice: targetLane.listPrice, frame, depth,
    protectedDur: REAL.guard.protectedDurationMin, confirmEnabled: true, resourceNoun: WORDS.resourceNoun,
  })
  return { cell, withDay, day, model, before, after, start: item.startMin, lanes, staged }
}
/** The さくら card (apt-26, しろう 14:30–15:30), the repro's own landing. */
const landing = (s: number, e: number) => landingOf('apt-26', null, s, e)
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
    // Fix round 1 X-D: a WindowRef carries its lane's `sellable`.
    expect(d.lost).toEqual([{ laneKey: 'L', label: '見本 L', windowStart: 900, listPrice: 8000, sellable: true }])
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

describe('c2b — the derived landings on the fixture board', () => {
  const refs = (ws: ReadonlyArray<{ laneKey: string; windowStart: number }>) => ws.map((w) => `${w.laneKey}|${w.windowStart}`)
  const beforeMin = () => {
    const dial = REAL.guard.config.autoReleaseBeforeMin ?? null
    return dial === 'linked' ? (REAL.guard.config.leadTimeMin ?? null) : dial
  }

  it('T3 lengthen (さくら → 14:30–16:00): しろう’s window SHIFTS on her own row — CLEAN, key D', () => {
    const r = landing(14 * 60 + 30, 16 * 60)
    log('T3', { counted: [r.day.countedBefore, r.day.countedAfter], value: [r.day.valueBefore, r.day.valueAfter], lost: refs(r.day.lost), gained: refs(r.day.gained), shifted: r.day.shifted, rows: labels(r.model.dayRows), face: r.model.face })
    // Derived: 945 → 960 on p-04, counted 3→3; the later window is worth MORE (36,870 → 37,060), so no F.
    expect([r.day.countedBefore, r.day.countedAfter]).toEqual([3, 3])
    expect(r.day.shifted.map((x) => `${x.laneKey}:${x.from}→${x.to}`)).toEqual(['p-04:945→960'])
    expect([r.day.lost, r.day.gained]).toEqual([[], []])
    expect(r.model.face).toBe('clean')
    expect(labels(r.model.dayRows)).toEqual(['確保枠 見本 しろうの15:45 → 16:00（店全体は3枠のまま）'])
  })

  it('T4 cheaper-lane swap (なぎ apt-29 → p-05 14:35–15:35): same count, ¥ named — CLEAN, key C + F', () => {
    const r = landingOf('apt-29', 'p-05', 14 * 60 + 35, 15 * 60 + 35)
    log('T4', { counted: [r.day.countedBefore, r.day.countedAfter], value: [r.day.valueBefore, r.day.valueAfter], lost: r.day.lost, gained: r.day.gained, shifted: r.day.shifted, rows: labels(r.model.dayRows), face: r.model.face })
    // Derived: ごろう (8,800) loses 14:30, あずさ (7,700) gains 14:30; 36,870 → 35,220 = ¥1,650.
    expect([r.day.countedBefore, r.day.countedAfter]).toEqual([3, 3])
    expect([refs(r.day.lost), refs(r.day.gained)]).toEqual([['p-05|870'], ['p-06|870']])
    expect(dayLossOf(r.withDay)).toBe(0)
    expect(r.model.face).toBe('clean')
    expect(labels(r.model.dayRows)).toEqual(['確保枠 見本 ごろうの14:30 → 見本 あずさの14:30（店全体は3枠のまま・空きの金額は約¥1,650減）'])
  })

  it('T8 net-up with a lost lane (かえる apt-14 → 12:00): never silent — CLEAN, key E', () => {
    const r = landingOf('apt-14', null, 12 * 60, 13 * 60 + 30)
    log('T8', { counted: [r.day.countedBefore, r.day.countedAfter], lost: refs(r.day.lost), gained: refs(r.day.gained), shifted: r.day.shifted, rows: labels(r.model.dayRows), face: r.model.face })
    // Derived (ATTACK §5 holds on the fixture): 3→4; ごろう loses 14:30, c-03 13:30 and あずさ 15:05 are gained.
    expect([r.day.countedBefore, r.day.countedAfter]).toEqual([3, 4])
    expect([refs(r.day.lost), refs(r.day.gained)]).toEqual([['p-05|870'], ['c-03|810', 'p-06|905']])
    expect(r.model.face).toBe('clean')
    expect(labels(r.model.dayRows)).toEqual(['確保枠 見本 ごろうの14:30がなくなります（店全体は3枠→4枠）'])
  })

  it('T10 D-11 + manual release: released on BOTH sides is never lost; released on the AFTER side only is lost', () => {
    const b = beforeMin()
    const s2 = landing(14 * 60 + 30, 15 * 60)
    const first = Math.min(...s2.before.byLane.flatMap((l) => l.starts))
    const now = first - (b ?? 0)
    const timed = landingOf('apt-26', null, 14 * 60 + 30, 15 * 60, { now, beforeMin: b }, { now, beforeMin: b })
    const quiet = s2.before.byLane.find((l) => l.laneKey !== 'p-04' && l.laneKey !== 'p-06' && l.starts.length > 0)!
    const kept = { laneKey: quiet.laneKey, windowStart: quiet.starts[0], dayOffset: REAL.dayOffset, store: REAL.store } as unknown as ReleasedWindow
    const manual = landingOf('apt-26', null, 14 * 60 + 30, 15 * 60, {}, { released: [kept] })
    log('T10', { beforeMin: b, first, now, timedBefore: timed.before.byLane.map((l) => [l.laneKey, l.starts]), timedLost: refs(timed.day.lost), timedGained: refs(timed.day.gained), kept: `${quiet.laneKey}|${quiet.starts[0]}`, manualLost: refs(manual.day.lost), manualCounted: [manual.day.countedBefore, manual.day.countedAfter], manualFace: manual.model.face })
    // Derived: beforeMin 60 (linked to leadTimeMin), the first held start is ごろう 14:30 (870),
    // so now = 13:30 releases p-05|870 on BOTH boards: it is absent before and never counted lost.
    expect([b, first, now]).toEqual([60, 870, 810])
    expect(timed.before.byLane.flatMap((l) => l.starts.map((x) => `${l.laneKey}|${x}`))).not.toContain('p-05|870')
    expect(refs(timed.day.lost)).not.toContain('p-05|870')
    expect([refs(timed.day.lost), refs(timed.day.gained)]).toEqual([[], []])
    // A manual keep-back of c-03|1050 on the AFTER side only IS a loss (3→2, amber, named).
    expect(`${quiet.laneKey}|${quiet.starts[0]}`).toBe('c-03|1050')
    expect(refs(manual.day.lost)).toEqual(['c-03|1050', 'p-04|945'])
    expect([manual.day.countedBefore, manual.day.countedAfter]).toEqual([3, 2])
    expect(manual.model.face).toBe('warn')
    log('T10-H', { gained: refs(manual.day.gained), tail: manual.model.impact.tail, rows: labels(manual.model.rows) })
    // H line 2: the one gained window (あずさ 15:05) pairs with the NEAREST lost start (しろう 15:45, not c-03 17:30).
    expect(refs(manual.day.gained)).toEqual(['p-06|905'])
    expect(labels(manual.model.rows)).toEqual(['確保枠 見本 しろうの15:45 → 見本 あずさの15:05'])
  })

  it('T11 cross-surface: the chip total, the delta and the printed number are one number', () => {
    const r = landing(14 * 60 + 30, 15 * 60)
    expect(r.day.countedAfter).toBe(r.after.total)
    expect(r.day.countedBefore).toBe(r.before.total)
    expect(labels(r.model.dayRows)[0]).toContain(`店全体は${r.after.total}枠のまま`)
  })
})

describe('c3 — the law-off arms read the same delta', () => {
  it('T15 HONEST_HELD off (identity arm): exact, the same heldDelta, CLEAN, no day row', () => {
    const r = landingOf('apt-26', null, 14 * 60 + 30, 15 * 60, { on: false }, { on: false })
    log('T15', { exact: [r.before.exact, r.after.exact], counted: [r.day.countedBefore, r.day.countedAfter], lost: r.day.lost, gained: r.day.gained, shifted: r.day.shifted, face: r.model.face, rows: labels(r.model.dayRows) })
    expect([r.before.exact, r.after.exact, r.day.exact]).toEqual([true, true, true])
    // Derived: the identity set holds all 4 published windows on both boards (the netting's 3 is
    // what the rooms can honour); the S2 hop is invisible there, so the delta is empty.
    expect([r.day.countedBefore, r.day.countedAfter]).toEqual([4, 4])
    expect([r.day.lost, r.day.gained, r.day.shifted]).toEqual([[], [], []])
    expect(r.model.face).toBe('clean')
    expect(r.model.dayRows).toEqual([])
  })

  it('guard off: both sides EMPTY_WINDOWS, an empty delta, and the null cell composes today’s clean card', () => {
    const d = heldDelta(EMPTY_WINDOWS, EMPTY_WINDOWS, zero)
    expect([d.countedBefore, d.countedAfter, d.exact, d.lost, d.gained, d.shifted]).toEqual([0, 0, true, [], [], []])
    const rows = [{ label: '担当', tone: '' as const }]
    const m = warnFaceFor({
      rows, cell: null, override: null, level: 'allow-warned', holdToConfirm: true, targetLaneMine: false, operatorName: '見本 たろう',
      listPrice: 8000, frame: null, depth: 0, protectedDur: REAL.guard.protectedDurationMin, confirmEnabled: true, resourceNoun: WORDS.resourceNoun,
    })
    expect(m.face).toBe('clean')
    expect(m.rows).toBe(rows)
    expect([m.dayRows, m.guardRow]).toEqual([[], null])
  })
})

describe('fix round 1 — X-A..X-D', () => {
  const dur = () => REAL.guard.protectedDurationMin
  const refs = (ws: ReadonlyArray<{ laneKey: string; windowStart: number }>) => ws.map((w) => `${w.laneKey}|${w.windowStart}`)

  it('X-A a landing on a lane the rail cannot judge (p-09) still speaks: amber key A, しろう named', () => {
    const r = landingOf('apt-26', 'p-09', 15 * 60 + 30, 16 * 60 + 30)
    log('XA-drop', { cellNull: r.cell == null, counted: [r.day.countedBefore, r.day.countedAfter], lost: refs(r.day.lost), gained: refs(r.day.gained), face: r.model.face, impact: r.model.impact, rows: labels(r.model.rows), commit: r.model.commit?.kind })
    expect(r.cell).toBeNull()
    expect([r.day.countedBefore, r.day.countedAfter]).toEqual([3, 2])
    expect(r.model.face).toBe('warn')
    expect(r.model.impact.head).toBe(`ここに置くと、店全体で新規のお客様の${dur()}分の空き`)
    expect(r.model.impact.tail).toContain('が3枠から2枠に減ります。なくなるのは見本 しろうの15:45の枠です。')
    expect(r.model.commit?.kind).toBe(REAL.holdToConfirm ? 'hold' : 'press')
  })

  it('X-A a same-count hop onto that lane: clean, the quiet row', () => {
    const r = landingOf('apt-26', 'p-09', 14 * 60, 15 * 60)
    log('XA-hop', { cellNull: r.cell == null, counted: [r.day.countedBefore, r.day.countedAfter], lost: refs(r.day.lost), gained: refs(r.day.gained), shifted: r.day.shifted, face: r.model.face, rows: labels(r.model.dayRows) })
    expect(r.cell).toBeNull()
    expect(r.model.face).toBe('clean')
    // Derived: しろう 15:45 → あずさ 15:05, 3→3, ¥340 (the S2 hop, reached through a windowless lane).
    expect([refs(r.day.lost), refs(r.day.gained)]).toEqual([['p-04|945'], ['p-06|905']])
    expect(labels(r.model.dayRows)).toEqual(['確保枠 見本 しろうの15:45 → 見本 あずさの15:05（店全体は3枠のまま・空きの金額は約¥340減）'])
  })

  it('X-B a lane losing 2 and gaining 1 is one shift and one loss', () => {
    const d = heldDelta(day([row('A', [900, 1000])]), day([row('A', [960])]), zero)
    expect(d.shifted.map((x) => `${x.from}→${x.to}`)).toEqual(['900→960'])
    expect(refs(d.lost)).toEqual(['A|1000'])
    expect(d.gained).toEqual([])
  })

  it('X-C count rises, a window lost, another shifts: the shift gets its own row', () => {
    const d = heldDelta(day([row('A', [900]), row('B', [960])]), day([row('A', [915]), row('B', []), row('C', [1000, 1100])]), zero)
    const m = faceOf(hand({ day: d }))
    expect(m.face).toBe('clean')
    expect(labels(m.dayRows)).toEqual(['確保枠 見本 Bの16:00がなくなります（店全体は2枠→3枠）', '確保枠 見本 Aの15:00 → 15:15'])
  })

  it('X-D key B names only windows that landed on rows not sold online', () => {
    const d = heldDelta(
      day([row('A', [900]), row('C', [1000]), row('Z', [], { sellable: false, listPrice: 0 })]),
      day([row('A', []), row('C', [960]), row('Z', [900], { sellable: false, listPrice: 0 })]), zero)
    const m = faceOf(hand({ day: d }))
    expect(m.face).toBe('warn')
    expect(m.impact.tail).toBe('が2枠から1枠に減ります。見本 Aの15:00の枠が、オンライン販売をしていない見本 Zの15:00に移ります（確保している枠は2枠のまま）。')
  })

  it('X-D counted −1 with online −2: A adds the online pair in B\u2019s words', () => {
    const d = heldDelta(
      day([row('A', [900]), row('B', [1000]), row('N', [], { sellable: false, listPrice: 0 })]),
      day([row('A', []), row('B', []), row('N', [1000], { sellable: false, listPrice: 0 })]), zero)
    expect(dayLossOf(hand({ day: d }))).toBe(2)
    const m = faceOf(hand({ day: d }))
    expect(m.impact.tail).toBe(`が2枠から1枠に減ります。なくなるのは見本 Aの15:00・見本 Bの16:40の枠です。オンライン販売中の新規のお客様の${dur()}分の空きは2枠から0枠に減ります。`)
  })
})

describe('fix round 2 — movement rows print PAIRS, each with its own arrow (Greptile G1; N2/N3)', () => {
  const refs = (ws: ReadonlyArray<{ laneKey: string; windowStart: number }>) => ws.map((w) => `${w.laneKey}|${w.windowStart}`)

  it('a two cross-lane pairs: each pair its own arrow, joined with 、', () => {
    const d = heldDelta(
      day([row('しろう', [945]), row('たろう', [960]), row('あずさ', []), row('はな', [])]),
      day([row('しろう', []), row('たろう', []), row('あずさ', [905]), row('はな', [990])]), zero)
    expect(labels(faceOf(hand({ day: d })).dayRows)).toEqual(['確保枠 見本 しろうの15:45 → 見本 あずさの15:05、見本 たろうの16:00 → 見本 はなの16:30（店全体は2枠のまま）'])
  })

  it('b one same-lane shift + one cross-lane pair: the shift first', () => {
    const d = heldDelta(
      day([row('しろう', [945]), row('たろう', [960]), row('あずさ', [])]),
      day([row('しろう', []), row('たろう', [990]), row('あずさ', [905])]), zero)
    expect(labels(faceOf(hand({ day: d })).dayRows)).toEqual(['確保枠 見本 たろうの16:00 → 16:30、見本 しろうの15:45 → 見本 あずさの15:05（店全体は2枠のまま）'])
  })

  it('c four pairs: three printed, then ほか1枠', () => {
    const d = heldDelta(
      day([row('A', [900]), row('B', [960]), row('C', [1000]), row('D', [1050])]),
      day([row('A', [915]), row('B', [975]), row('C', [1015]), row('D', [1065])]), zero)
    expect(labels(faceOf(hand({ day: d })).dayRows)).toEqual(['確保枠 見本 Aの15:00 → 15:15、見本 Bの16:00 → 16:15、見本 Cの16:40 → 16:55、ほか1枠（店全体は4枠のまま）'])
  })

  it('d the しろう case (one cross-lane pair) is unchanged, bracket and F included', () => {
    const r = landing(14 * 60 + 30, 15 * 60)
    expect(labels(r.model.dayRows)).toEqual(['確保枠 見本 しろうの15:45 → 見本 あずさの15:05（店全体は3枠のまま・空きの金額は約¥340減）'])
  })

  it('e N2 (0 lost / 1 gained / 2 shifts): the pairing lists the two shifts first, the gained left unpaired, never dropped', () => {
    const d = heldDelta(day([row('A', [900]), row('B', [960]), row('C', [])]), day([row('A', [915]), row('B', [975]), row('C', [1000])]), zero)
    const p = pairsOf(d)
    expect(p.pairs).toEqual([
      { from: '見本 Aの15:00', to: '15:15', sameLane: true },
      { from: '見本 Bの16:00', to: '16:15', sameLane: true },
    ])
    expect([refs(p.unpairedLost), refs(p.unpairedGained)]).toEqual([[], ['C|1000']])
    // Count-changing (2→3), so not a same-count quiet row: the row keeps its list → list text (packet rule 3).
    log('FR2-e', labels(faceOf(hand({ day: d })).dayRows))
    expect(labels(faceOf(hand({ day: d })).dayRows)).toEqual(['確保枠 見本 Aの15:00・見本 Bの16:00 → 見本 Cの16:40・見本 Aの15:15・見本 Bの16:15（店全体は2枠→3枠）'])
  })

  it('f nearest-start pairing: lost {A 15:45, B 16:30}, gained {C 16:20, D 15:50} → A→D, B→C', () => {
    const d = heldDelta(
      day([row('A', [945]), row('B', [990]), row('C', []), row('D', [])]),
      day([row('A', []), row('B', []), row('C', [980]), row('D', [950])]), zero)
    const p = pairsOf(d)
    expect(p.pairs.map((x) => `${x.from}>${x.to}`).sort()).toEqual(['見本 Aの15:45>見本 Dの15:50', '見本 Bの16:30>見本 Cの16:20'])
    expect([p.unpairedLost, p.unpairedGained]).toEqual([[], []])
    expect(labels(faceOf(hand({ day: d })).dayRows)).toEqual(['確保枠 見本 Bの16:30 → 見本 Cの16:20、見本 Aの15:45 → 見本 Dの15:50（店全体は2枠のまま）'])
  })

  it('vii sweep: every same-count fixture landing pairs completely (no unpaired lost or gained in the quiet row)', () => {
    const staff = REAL.lanes.filter((l) => l.group === 'staff')
    const bad: string[] = []
    let sameCount = 0
    let moved = 0
    let total = 0
    for (const src of staff) {
      for (const item of src.items.filter((i) => i.caseId != null)) {
        const dur = item.endMin - item.startMin
        for (const to of staff) {
          for (let s = REAL.hours.open; s + dur <= REAL.hours.close; s += 60) {
            const r = landingOf(item.caseId!, to.key, s, s + dur)
            total++
            if (r.day.countedBefore !== r.day.countedAfter) continue
            sameCount++
            const p = pairsOf(r.day)
            if (p.pairs.length > 0) moved++
            if (p.unpairedLost.length > 0 || p.unpairedGained.length > 0) bad.push(`${item.caseId}→${to.key}@${s}`)
          }
        }
      }
    }
    log('FR2-vii', { total, sameCount, moved, bad })
    expect(total).toBeGreaterThan(0)
    expect(moved).toBeGreaterThan(0)
    expect(bad).toEqual([])
  })
})
