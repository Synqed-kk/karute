import { z } from 'zod'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import { WeekDayCardDataDTO } from '@/lib/app-api/appointments-screen-dto'
import { appointmentsToWeekData } from '@/lib/adapters/reservation'
import { DATE, DAY, span, appointments, hoursFacts } from './__fixtures__/kadou-fixture'

// FROZEN copy of the PRE-PR-2 capacity fields (appointments-screen-dto.ts at
// 37aa7a203, copied before commit E touched the schema). A phone one build
// behind parses the wire with exactly this. Never edit it.
const legacyCapacityFields = {
  // The default supports bundle skew ON; OFF decoding/JSON keeps today's shape.
  shiftState: z.enum(['entered', 'partial', 'none', 'nobody', 'solo', 'off', 'unavailable'])
    .default('unavailable').transform(value => BOOKING_SWITCHES.shiftLanes ? value : undefined),
  onShiftNoBooking: z.number().optional(),
  unassignedOverflow: z.number().optional(),
  /** lanes × the day's declared minutes; null = no honest capacity (see
   *  capacityReason). */
  capacityMinutes: z.number().nullable().default(null),
  /** The lane count used — the store's roster, floored by whoever worked. */
  lanes: z.number().default(0),
  /** 'none' = class-bound (one row is many people): the count table, never a
   *  percentage — a positive CLAIM, which is why the default is not it (R1-8):
   *  a payload that carries no capacity keys never looked at the store. */
  laneKind: z.enum(['staff', 'none']).default('staff'),
  /** Where the day's hours came from — 空き may ride only 'store' (E21). */
  hoursSource: z.enum(['store', 'org', 'default']).nullable().default(null),
  /** Integer 0–100; 100 prints only alongside `full` (E23). */
  occupancyPct: z.number().nullable().default(null),
  /** 満 — sold out. */
  full: z.boolean().default(false),
  band: z.enum(['light', 'medium', 'busy']).nullable().default(null),
  /** 空き in minutes. Named apart from `availableMinutes`, which is the
   *  DENOMINATOR the shipped metric menu divides by, not the free time. */
  freeMinutes: z.number().nullable().default(null),
  /** Why there is no capacity. The 未設定 cell reads this rather than
   *  re-deriving it: the module checks kind → roster → hours in that order, so
   *  an hours reason PROVES the roster was known and the store is not
   *  class-bound. */
  capacityReason: z
    .enum([
      'kind-none',
      'roster-unknown',
      'no-lanes',
      'hours-unresolved',
      'closed',
      'hours-not-saved',
      'outside-hours',
      'over-concurrency',
      // ⚖ R1-8 — the adapter's own value: nobody resolved a store for this
      // row. The DEFAULT, because a payload with no capacity keys at all is
      // exactly that: a server that never looked. An explicit null still
      // parses as null (zod defaults fire on `undefined` only), so a real
      // capacity keeps saying so.
      'unknown',
    ])
    .nullable()
    .default('unknown'),
}
const legacyRow = z.object(legacyCapacityFields)
const roster = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, active: true, stores: [{ storeId: 'store' }] }))
const inferredDay = () => appointmentsToWeekData(appointments([span('A', 600, 900), span('B', 600, 900), span('C', 600, 900)]), new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, hoursFacts, false, { rosterHeadcount: 5, shiftCapacity: { storeId: 'store', readComplete: true, breakMinutes: 60, rows: [], roster } })[0]

test('the switch is ON for this file (real)', () => { expect(BOOKING_SWITCHES.shiftLanes).toBe(true) })
test('(i) the PR-2 ON payload for an inferred day parses with the frozen PRE-PR-2 schema: entered', () => {
  const wire = JSON.parse(JSON.stringify(inferredDay()))
  expect(wire.date ?? DATE).toBeTruthy()
  expect(wire).toMatchObject({ shiftState: 'entered', shiftBasis: 'inferred', occupancyPct: 56, capacityMinutes: 1620 })
  const parsed = legacyRow.safeParse(wire)
  expect(parsed.success).toBe(true)
  expect(parsed.success && parsed.data.shiftState).toBe('entered')
  expect(parsed.success && parsed.data.occupancyPct).toBe(56)
  expect(parsed.success && 'shiftBasis' in parsed.data).toBe(false)
})
test('(ii) the new schema reads shiftBasis inferred', () => {
  const wire = JSON.parse(JSON.stringify(inferredDay()))
  expect(WeekDayCardDataDTO.parse(wire)).toMatchObject({ shiftState: 'entered', shiftBasis: 'inferred', occupancyPct: 56 })
})
test('(iii) a server that omits shiftBasis is treated as rows (no 約 marker)', () => {
  const { shiftBasis: _drop, ...wire } = JSON.parse(JSON.stringify(inferredDay()))
  expect(WeekDayCardDataDTO.parse(wire).shiftBasis).toBeUndefined()
})
