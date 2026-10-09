import { capacityForDay } from '@/lib/capacity/capacity'
import { appointmentsToWeekData, appointmentsToMonthFacts, capacityRowFields } from '@/lib/adapters/reservation'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import { DAY, input, t1Spans, t4Spans, appointments, hoursFacts } from './__fixtures__/kadou-fixture'

// PR-2: the real switch is ON; the OFF guarantee is kept by running this file with it mocked OFF.
jest.mock('@/lib/appointments/booking-switches', () => ({ BOOKING_SWITCHES: { ...jest.requireActual('@/lib/appointments/booking-switches').BOOKING_SWITCHES, shiftLanes: false } }))

test('PR-2: the real shiftLanes switch is ON', () => {
  expect(jest.requireActual<typeof import('@/lib/appointments/booking-switches')>('@/lib/appointments/booking-switches').BOOKING_SWITCHES.shiftLanes).toBe(true)
})

test('OFF output is byte-identical to the pre-PR T1/T2/T4 snapshot', () => {
  expect(BOOKING_SWITCHES.shiftLanes).toBe(false)
  const output = [t1Spans, [t1Spans[0]], t4Spans].map(spans => ({
    fact: capacityForDay(input(spans)),
    week: appointmentsToWeekData(appointments(spans), new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, hoursFacts, false, { rosterHeadcount: 5 }),
    month: [...appointmentsToMonthFacts(appointments(spans), new Date(DAY), new Date(DAY), { hoursFacts, rosterHeadcount: 5 })].map(([day, fact]) => [day, capacityRowFields(fact)]),
  }))
  expect(output).toMatchSnapshot()
  expect(JSON.stringify(output)).toMatchSnapshot('serialized bytes')
})
