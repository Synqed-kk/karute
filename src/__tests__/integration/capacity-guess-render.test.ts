import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'
import { weekRowCells, dayLineCells } from '@/lib/appointments/metric-menu'
import { appointmentsToWeekData, type WeekDayRowData } from '@/lib/adapters/reservation'
import { DAY, span, appointments, hoursFacts } from './__fixtures__/kadou-fixture'

const roster = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, active: true, stores: [{ storeId: 'store' }] }))
const base = (): WeekDayRowData => appointmentsToWeekData(appointments([span('A', 600, 900), span('B', 600, 900), span('C', 600, 900)]), new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, hoursFacts, false, { rosterHeadcount: 5, shiftCapacity: { storeId: 'store', readComplete: true, breakMinutes: 60, rows: [], roster } })[0]
const tFor = (m: Record<string, string>) => (k: string, v?: Record<string, unknown>) => m[k].replace(/\{(\w+)\}/g, (_, x) => String(v?.[x]))
const util = (row: WeekDayRowData, m: Record<string, string> = ja.reservation.weekRows) =>
  weekRowCells(row, { soloMode: false, typeSlot: 'off', t: tFor(m) } as Parameters<typeof weekRowCells>[1]).find(c => c.key === 'utilization')

test('the inferred figure prints 約56% (ja) / ~56% (en); a rows figure prints 56%', () => {
  expect(util({ ...base(), shiftBasis: 'inferred' })?.value).toBe('約56%')
  expect(util({ ...base(), shiftBasis: 'inferred' }, en.reservation.weekRows)?.value).toBe('~56%')
  expect(util({ ...base(), shiftBasis: 'rows' })?.value).toBe('56%')
  expect(util({ ...base(), shiftBasis: undefined })?.value).toBe('56%')
})
test('n3/n4: the 稼働 cell needs occupancyPct, not capacityMinutes alone; a withheld day hides it whatever its shiftState', () => {
  expect(util({ ...base(), occupancyPct: null, full: false })).toBeUndefined()
  expect(util({ ...base(), occupancyPct: null, full: false, capacityMinutes: null, closed: true, capacityReason: 'closed', shiftState: 'entered' } as WeekDayRowData)).toBeUndefined()
})
test('ja.json carries no 「シフト未入力」 string (⚖ 10/3, ⚖ 10/8)', () => {
  expect(JSON.stringify(ja)).not.toMatch(/シフト未入力/)
})
const ctx = (m: Record<string, string> = ja.reservation.weekRows) => ({ soloMode: false, typeSlot: 'off', t: tFor(m) } as Parameters<typeof weekRowCells>[1])
test('S111-1: a guessed day shows 約nn% but no 空き; the next metric fills that slot. A rows day keeps 空き', () => {
  const rows = { ...base(), shiftBasis: 'rows' as const }
  const guessed = { ...base(), shiftBasis: 'inferred' as const }
  const rowKeys = weekRowCells(rows, ctx()).map(c => c.key)
  const guessKeys = weekRowCells(guessed, ctx()).map(c => c.key)
  expect(rowKeys).toContain('free')
  expect(guessKeys).not.toContain('free')
  expect(guessKeys.length).toBe(rowKeys.length)
  expect(weekRowCells(guessed, ctx()).find(c => c.key === 'utilization')?.value).toBe('約56%')
  expect(dayLineCells(guessed, ctx()).map(c => c.key)).not.toContain('free')
  expect(dayLineCells(rows, ctx()).map(c => c.key)).toContain('free')
})
test('S111-6 L1/L2: a closed or hours-not-saved row with a stray occupancyPct and capacityMinutes null prints no figure (week and day lines)', () => {
  const l1 = { ...base(), shiftBasis: 'inferred' as const, occupancyPct: 56, capacityMinutes: null, closed: true, capacityReason: 'closed' } as WeekDayRowData
  const l2 = { ...base(), shiftBasis: 'inferred' as const, occupancyPct: 40, capacityMinutes: null, capacityReason: 'hours-not-saved' } as WeekDayRowData
  for (const cells of [weekRowCells(l1, ctx()), dayLineCells(l1, ctx()), weekRowCells(l2, ctx()), dayLineCells(l2, ctx())]) {
    expect(cells.map(c => c.value).join(' ')).not.toMatch(/%/)
    expect(cells.map(c => c.key)).not.toContain('free')
  }
  expect(weekRowCells(l2, ctx()).find(c => c.key === 'unset')?.value).toBe('未設定')
})
