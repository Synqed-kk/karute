/**
 * 今日の運営 — THE HELD DELTA (LEAD RULING R1/R2/R3/R8l, DECISIONS.md
 * today-impact-2026-09-30). c1: the pure delta and the one sellable predicate.
 * The face / row cases (T1–T4, T8, T10–T12, T14, T15) land with the gate (c2/c3).
 */
import { heldDelta } from '@/app/[locale]/(business)/business/today/held-delta'
import { sellableLaneKeysOf, windowsOf, type DayWindows } from '@/app/[locale]/(business)/business/today/today-interactions'
import type { BoardLane } from '@/business/lib/today-board'

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
