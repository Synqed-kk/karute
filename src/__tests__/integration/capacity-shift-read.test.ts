import type { SynqedClient, StaffShift } from '@synqed-kk/client'
import { readStaffShifts, staffShiftsTag } from '@/lib/appointments/staff-shifts'
import { capacityForDay } from '@/lib/capacity/capacity'
import { input, DATE, minute } from './__fixtures__/kadou-fixture'
import { WeekDayCardDataDTO } from '@/lib/app-api/appointments-screen-dto'

jest.mock('next/cache', () => ({ unstable_cache: jest.fn((fn: () => unknown) => fn) }))
const row = (i: number): StaffShift => ({ id: `r${i}`, business_id: 'business', staff_id: `s${i}`, store_id: 'store', date: DATE, start: 600, end: 1140, breaks: [{ start: 900, end: 960 }], blocks: [], created_by: 'actor', updated_by: 'actor', created_at: '', updated_at: '' })
function client(list: jest.Mock) { return { staffShifts: { list } } as unknown as Pick<SynqedClient, 'staffShifts'> }
const page = (n: number, total = 201) => ({ shifts: Array.from({ length: Math.min(200, total - (n - 1) * 200) }, (_, i) => row((n - 1) * 200 + i)), total, page: n, page_size: 200 })

test('T16: page two failure withholds the entire range', async () => {
  const list = jest.fn().mockResolvedValueOnce(page(1)).mockRejectedValueOnce(new Error('outage'))
  const result = await readStaffShifts(client(list), 'business', 'store', DATE, '2026-10-10')
  expect(result).toEqual({ rows: [], readComplete: false })
  for (const date of [DATE, '2026-10-09']) {
    expect(capacityForDay({ ...input(), shift: { ...result, storeId: 'store', date, roster: [] } })).toMatchObject({ shiftState: 'unavailable', occupancyPct: null, band: null })
  }
})
test('page 1 first, remaining pages parallel, scoped cache and JST conversion', async () => {
  const list = jest.fn().mockImplementation(({ page: n }) => Promise.resolve(page(n, 401)))
  const result = await readStaffShifts(client(list), 'business', 'store', DATE, '2026-10-10')
  expect(result.readComplete).toBe(true)
  expect(list.mock.calls.map(c => c[0])).toEqual([1, 2, 3].map(n => ({ page: n, page_size: 200, store_id: 'store', from: '2026-10-07', to: '2026-10-10' })))
  expect(result.rows[0]).toMatchObject({ startMs: minute(600), endMs: minute(1140), breaks: [{ startMs: minute(900), endMs: minute(960) }] })
  expect(jest.requireMock('next/cache').unstable_cache).toHaveBeenLastCalledWith(expect.any(Function), ['staff-shifts-v1', 'business', 'store', DATE, '2026-10-10'], { revalidate: 60, tags: [staffShiftsTag('business', 'store')] })
})
test.each(['short', '404', '500', 'scope', 'duplicate'])('%s read is unavailable', async kind => {
  const first = page(1)
  if (kind === 'short') first.shifts.pop()
  if (kind === 'scope') first.shifts[0].store_id = 'other'
  if (kind === 'duplicate') first.shifts[1].id = first.shifts[0].id
  const list = jest.fn().mockImplementation(({ page: n }) => kind === '404' || kind === '500' ? Promise.reject(new Error(kind)) : Promise.resolve(n === 1 ? first : page(n)))
  expect(await readStaffShifts(client(list), 'business', 'store', DATE, '2026-10-10')).toEqual({ rows: [], readComplete: false })
})
test('timeout withholds the figure', async () => {
  jest.useFakeTimers()
  try {
    const pending = readStaffShifts(client(jest.fn(() => new Promise(() => {}))), 'business', 'store', DATE, '2026-10-10')
    await jest.advanceTimersByTimeAsync(10_000)
    expect(await pending).toEqual({ rows: [], readComplete: false })
  } finally { jest.useRealTimers() }
})
test('new text state defaults on an old payload without extending capacityReason', () => {
  expect(WeekDayCardDataDTO.shape.shiftState.parse(undefined)).toBe('unavailable')
  expect(WeekDayCardDataDTO.shape.capacityReason.safeParse('none').success).toBe(false)
})
