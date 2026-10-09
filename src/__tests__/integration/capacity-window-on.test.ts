/** PR-2 fix round 1 (X4): the window door ON, on the REAL switch. Chosen over
 *  the route because its mocks are lighter; the adapter call below is the one
 *  the web page makes with the window's output. */
process.env.TZ = 'UTC'
const GINZA = 'store-ginza'
const VIEWER_CORE = 'core-viewer'

jest.mock('next/cache', () => ({ unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn), revalidatePath: jest.fn(), updateTag: jest.fn() }))
jest.mock('@/lib/auth/store-scope', () => ({ ...jest.requireActual('@/lib/auth/store-scope'), resolveStoreScope: jest.fn(), shiftRosterForBusiness: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn(), getBusinessId: jest.fn(async () => 'biz') }))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn() }))
jest.mock('@/lib/synqed/client', () => {
  const client = {
    appointments: { list: jest.fn() }, staff: { list: jest.fn() },
    storePolicies: { get: jest.fn(), listClosedDays: jest.fn() }, stores: { get: jest.fn(async () => ({})) },
    staffShifts: { list: jest.fn() },
  }
  return { getSynqedClient: jest.fn(async () => client) }
})

import { getAppointmentWindow } from '@/actions/appointments-window'
import { resolveStoreScope, shiftRosterForBusiness } from '@/lib/auth/store-scope'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { getSynqedClient } from '@/lib/synqed/client'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import { appointmentsToWeekData } from '@/lib/adapters/reservation'
import type { Appointment } from '@synqed-kk/client'

const DAY = Date.parse('2026-09-15T00:00:00+09:00')
const FROM = new Date(DAY).toISOString()
const TO = new Date('2026-09-15T23:59:59.999+09:00').toISOString()
type Client = { appointments: { list: jest.Mock }; staff: { list: jest.Mock }; storePolicies: { get: jest.Mock; listClosedDays: jest.Mock }; staffShifts: { list: jest.Mock } }

beforeEach(async () => {
  jest.clearAllMocks()
  const c = (await getSynqedClient()) as unknown as Client
  // One assigned in-hours booking, 10:00–11:00 JST, on a zero-row day.
  c.appointments.list.mockResolvedValue({ appointments: [{ id: 'a1', kind: 'BOOKING', customer_id: 'c1', staff_id: VIEWER_CORE, store_id: GINZA, starts_at: '2026-09-15T01:00:00Z', ends_at: '2026-09-15T02:00:00Z', duration_minutes: 60, status: 'SCHEDULED' }], total: 1, page: 1, page_size: 500 })
  c.staff.list.mockResolvedValue({ staff: [{ id: VIEWER_CORE, user_id: 'profile-viewer' }], total: 1 })
  c.storePolicies.get.mockResolvedValue({ weekly_hours: { tue: { open: '10:00', close: '20:00' } }, break_minutes: 45 })
  c.storePolicies.listClosedDays.mockResolvedValue({ closed_days: [] })
  c.staffShifts.list.mockResolvedValue({ shifts: [], total: 0, page: 1, page_size: 200 })
  ;(resolveStoreScope as jest.Mock).mockResolvedValue({ storeId: GINZA, allowedStoreIds: [GINZA] })
  ;(getCurrentUserStaffId as jest.Mock).mockResolvedValue('profile-viewer')
  ;(getOrgSettings as jest.Mock).mockResolvedValue({ operating_hours: null, operating_hours_saved: [], solo_mode: false })
})

async function wireRow() {
  const w = await getAppointmentWindow(FROM, TO, 'all')
  const out = w as unknown as { counted: Appointment[]; blocks?: Appointment[]; hoursFacts: [string, never][]; shiftCapacity: Parameters<typeof appointmentsToWeekData>[10] extends infer I ? I extends { shiftCapacity?: infer S } ? S : never : never }
  expect(out.shiftCapacity).toBeDefined()
  return appointmentsToWeekData(out.counted, new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, new Map(out.hoursFacts), false, { rosterHeadcount: 1, shiftCapacity: out.shiftCapacity, blockAppointments: out.blocks })[0]
}

test('real switch ON; a zero-row day with one in-hours booking and break_minutes 45 → entered + inferred, 555', async () => {
  expect(BOOKING_SWITCHES.shiftLanes).toBe(true)
  ;(shiftRosterForBusiness as jest.Mock).mockResolvedValue([VIEWER_CORE, 'core-colleague'].map(id => ({ id, active: true, stores: [{ storeId: GINZA }] }))) // two people: not the solo rule
  const row = await wireRow()
  expect(row).toMatchObject({ shiftState: 'entered', shiftBasis: 'inferred', capacityMinutes: 555, bookedMinutes: 60 })
  expect(typeof row.occupancyPct).toBe('number')
  expect(row.occupancyPct).toBe(11)
})
test('the roster read throws (real shiftRosterForBusiness, core env absent) → unavailable, no capacity, the window still resolves', async () => {
  const actual = jest.requireActual<typeof import('@/lib/auth/store-scope')>('@/lib/auth/store-scope')
  const saved = process.env.SYNQED_CORE_URL
  delete process.env.SYNQED_CORE_URL
  try {
    ;(shiftRosterForBusiness as jest.Mock).mockImplementation(actual.shiftRosterForBusiness)
    await expect(actual.shiftRosterForBusiness('biz', GINZA)).resolves.toBeNull()
    const row = await wireRow()
    expect(row).toMatchObject({ shiftState: 'unavailable', capacityMinutes: null, occupancyPct: null, bookedMinutes: 60 })
  } finally {
    if (saved !== undefined) process.env.SYNQED_CORE_URL = saved
  }
})
