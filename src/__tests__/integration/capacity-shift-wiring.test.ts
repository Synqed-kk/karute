import type { Appointment } from '@synqed-kk/client'
import { z } from 'zod'
import { DATE, DAY, minute, span, appointments, hoursFacts } from './__fixtures__/kadou-fixture'
import type * as Reservation from '@/lib/adapters/reservation'
import { AppointmentsScreenDTO, WeekDayCardDataDTO, MonthCellDTO } from '@/lib/app-api/appointments-screen-dto'

function adapter(on: boolean): typeof Reservation {
  jest.resetModules()
  jest.doMock('@/lib/appointments/booking-switches', () => ({ BOOKING_SWITCHES: { ...jest.requireActual('@/lib/appointments/booking-switches').BOOKING_SWITCHES, shiftLanes: on } }))
  return jest.requireActual('@/lib/adapters/reservation')
}
const shiftCapacity = {
  storeId: 'store', readComplete: true,
  roster: ['s1', 's2', 's3', 's4', 's5'].map(id => ({ id, active: true, stores: [{ storeId: 'store' }] })),
  rows: ['s1', 's2', 's3'].map(staffId => ({ staffId, storeId: 'store', date: DATE, startMs: minute(600), endMs: minute(1140), breaks: [span(staffId, 900, 960)], blocks: [] })),
}
function week(on: boolean, rows = appointments(), shifts = shiftCapacity) {
  return adapter(on).appointmentsToWeekData(rows, new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, hoursFacts, false, { rosterHeadcount: 5, shiftCapacity: shifts })
}
afterEach(() => { jest.dontMock('@/lib/appointments/booking-switches') })

test('ON produces the new 63% figure regardless of legacy layer switches', () => {
  expect(week(true)[0]).toMatchObject({ occupancyPct: 63, bookedMinutes: 900, shiftState: 'entered' })
  expect(week(false)[0]).toMatchObject({ occupancyPct: 30, bookedMinutes: 900 })
  expect(week(false)[0]).not.toHaveProperty('shiftState')
  for (const multiStaffCapacity of [false, true]) {
    jest.resetModules()
    jest.doMock('@/lib/appointments/booking-switches', () => ({ BOOKING_SWITCHES: { multiStaffCapacity, shiftLanes: true, bedLanes: true, percentBands: true } }))
    const loaded = jest.requireActual<typeof Reservation>('@/lib/adapters/reservation')
    expect(loaded.appointmentsToMonthFacts(appointments(), new Date(DAY), new Date(DAY), { hoursFacts, shiftCapacity }).get(DATE)?.occupancyPct).toBe(63)
  }
})
test('R-G: displayed booked time uses unions even on none/unavailable days', () => {
  const rows = appointments([span('s1', 600, 720), span('s1', 660, 780)])
  expect(week(true, rows, { ...shiftCapacity, rows: [] })[0]).toMatchObject({ bookedMinutes: 180, shiftState: 'none' })
  expect(week(true, rows, { ...shiftCapacity, readComplete: false })[0]).toMatchObject({ bookedMinutes: 180, shiftState: 'unavailable' })
  expect(week(false, rows)[0].bookedMinutes).toBe(240)
})
test('cleanup extends ends_at on both numerator and divisor', () => {
  const rows = appointments([span('s1', 1170, 1230)])
  rows[0].occupied_until = new Date(minute(1260)).toISOString()
  expect(week(true, rows)[0]).toMatchObject({ bookedMinutes: 90, capacityMinutes: 1530 })
})
test('T19: every ON month cell has band null; OFF still has bands', () => {
  for (const on of [false, true]) {
    const a = adapter(on)
    const facts = a.appointmentsToMonthFacts(appointments(), new Date(DAY), new Date(DAY + 86_400_000), { hoursFacts, shiftCapacity, rosterHeadcount: 5 })
    if (on) expect([...facts.values()].every(f => f.band === null)).toBe(true)
    else expect(facts.get(DATE)?.band).toBe('light')
    const cells = a.appointmentsToMonthCells(appointments(), new Date(DAY), new Date(DAY), new Date(DAY), hoursFacts, 0)
    const dto = a.monthCellsToDTO(cells, { facts })
    expect(dto.find(c => c.id === DATE)?.band).toBe(on ? null : 'light')
  }
})
test('OFF full-screen wire bytes equal the old schema; ON keeps new state', () => {
  const row = week(false)[0]
  const base = { view: 'week', selectedDateIso: DATE, staffFilter: 'all', staff: [], activeStaffId: null, authProfileId: null, customers: [], reservationViews: [], reservationStaff: [], businessHours: { start: 10, end: 20 }, weekData: [row], weekStartIso: DATE, monthData: null, dayTotals: row }
  const oldRow = WeekDayCardDataDTO.omit({ shiftState: true, onShiftNoBooking: true, unassignedOverflow: true })
  const oldMonth = MonthCellDTO.omit({ shiftState: true, onShiftNoBooking: true, unassignedOverflow: true })
  const oldSchema = AppointmentsScreenDTO.extend({ weekData: z.array(oldRow).nullable(), dayTotals: oldRow.nullable().default(null), monthData: z.array(oldMonth).nullable() })
  expect(JSON.stringify(AppointmentsScreenDTO.parse(base))).toBe(JSON.stringify(oldSchema.parse(base)))
  const onRows = week(true)
  const onDTO = jest.requireActual<typeof import('@/lib/app-api/appointments-screen-dto')>('@/lib/app-api/appointments-screen-dto')
  expect(onDTO.AppointmentsScreenDTO.parse({ ...base, weekData: onRows }).weekData?.[0].shiftState).toBe('entered')
})
test('window keeps active staff BLOCKs only with shiftLanes ON', async () => {
  for (const on of [false, true]) {
    adapter(on)
    const { fetchAppointmentWindow } = jest.requireActual<typeof import('@/lib/appointments/by-date')>('@/lib/appointments/by-date')
    const block = { ...appointments()[0], kind: 'BLOCK', customer_id: null } as Appointment
    const list = jest.fn().mockResolvedValue({ appointments: [block, { ...block, status: 'CANCELLED' }], total: 2 })
    const result = await fetchAppointmentWindow({ appointments: { list } } as unknown as Parameters<typeof fetchAppointmentWindow>[0], new Date(DAY).toISOString(), new Date(DAY + 86_400_000).toISOString(), { storeId: 'store' })
    expect(result.counted).toEqual([])
    if (on) expect(result.blocks).toEqual([block])
    else expect(result).not.toHaveProperty('blocks')
  }
})

test('a failed store read still prints unioned booked time and withholds shift capacity', () => {
  const a = adapter(true)
  const rows = appointments([span('s1', 600, 720), span('s1', 660, 780)])
  const output = a.appointmentsToWeekData(rows, new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, hoursFacts, false, { shiftCapacity, storeRowDegraded: true })
  expect(output[0]).toMatchObject({ bookedMinutes: 180, shiftState: 'unavailable', occupancyPct: null })
})

test('T-S8: ON, explicit solo, booking on the second roster person reads 50%, never 33%', () => {
  const pair = { storeId: 'store', readComplete: true, rows: [], roster: ['A', 'B'].map(id => ({ id, active: true, stores: [{ storeId: 'store' }] })) }
  const output = adapter(true).appointmentsToWeekData(appointments([span('B', 780, 1080)]), new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, hoursFacts, true, { rosterHeadcount: 2, shiftCapacity: pair })
  expect(output[0]).toMatchObject({ occupancyPct: 50, capacityMinutes: 600, bookedMinutes: 300, shiftState: 'solo' })
})
