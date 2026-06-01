/**
 * Coverage for getNextCustomer (PR #85/#102, replay/10). Verifies the
 * recording-target selection: in-session bookings win over upcoming ones,
 * karute-attached bookings are skipped, and absence yields null.
 *
 * Mocks the staff-identity helper and getAppointmentsByDate (the synqed-core
 * appointments source) so the pure selection logic is exercised against
 * controlled rows.
 */
const MIN = 60_000

let mockStaffId: string | null = 'staff-1'
let mockRows: unknown[] = []

jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => mockStaffId),
}))

jest.mock('@/actions/appointments', () => ({
  getAppointmentsByDate: jest.fn(async () => mockRows),
}))

import { getNextCustomer } from '@/lib/appointments/next-customer'

function appt(over: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    id: 'a1',
    start_time: new Date(now + 60 * MIN).toISOString(),
    duration_minutes: 60,
    client_id: 'cust-1',
    staff_profile_id: 'staff-1',
    karute_record_id: null,
    customers: { name: 'Hanako' },
    ...over,
  }
}

beforeEach(() => {
  mockStaffId = 'staff-1'
  mockRows = []
})

describe('getNextCustomer', () => {
  it('returns null when the user has no staff identity', async () => {
    mockStaffId = null
    mockRows = [appt()]
    expect(await getNextCustomer()).toBeNull()
  })

  it('returns null when there are no appointments', async () => {
    mockRows = []
    expect(await getNextCustomer()).toBeNull()
  })

  it('flags an in-progress booking as in-session', async () => {
    const now = Date.now()
    mockRows = [
      appt({ start_time: new Date(now - 30 * MIN).toISOString(), duration_minutes: 60 }),
    ]
    const r = await getNextCustomer()
    expect(r?.reason).toBe('in-session')
    expect(r?.customerName).toBe('Hanako')
    expect(r?.minutesFromNow).toBeLessThan(0)
  })

  it('returns an endTime of start + duration (feeds the live countdown)', async () => {
    const now = Date.now()
    const start = new Date(now - 30 * MIN).toISOString()
    mockRows = [appt({ start_time: start, duration_minutes: 60 })]
    const r = await getNextCustomer()
    // 60-min booking that started 30 min ago → ends ~30 min from now.
    const expectedEnd = new Date(new Date(start).getTime() + 60 * MIN).toISOString()
    expect(r?.endTime).toBe(expectedEnd)
  })

  it('returns the nearest upcoming booking when none in session', async () => {
    const now = Date.now()
    mockRows = [
      appt({ id: 'a2', start_time: new Date(now + 90 * MIN).toISOString() }),
    ]
    const r = await getNextCustomer()
    expect(r?.reason).toBe('upcoming')
    expect(r?.minutesFromNow).toBeGreaterThan(0)
  })

  it('prioritises the in-session booking over an upcoming one', async () => {
    const now = Date.now()
    mockRows = [
      appt({ id: 'soon', start_time: new Date(now + 10 * MIN).toISOString() }),
      appt({
        id: 'live',
        client_id: 'cust-live',
        customers: { name: 'Live' },
        start_time: new Date(now - 5 * MIN).toISOString(),
        duration_minutes: 60,
      }),
    ]
    const r = await getNextCustomer()
    expect(r?.reason).toBe('in-session')
    expect(r?.customerId).toBe('cust-live')
  })

  it('skips bookings that already have a karute attached', async () => {
    const now = Date.now()
    mockRows = [
      appt({
        start_time: new Date(now - 5 * MIN).toISOString(),
        duration_minutes: 60,
        karute_record_id: 'k1',
      }),
    ]
    expect(await getNextCustomer()).toBeNull()
  })

  it('falls back to "Unknown" when the customer relation is missing', async () => {
    const now = Date.now()
    mockRows = [
      appt({ start_time: new Date(now + 30 * MIN).toISOString(), customers: null }),
    ]
    const r = await getNextCustomer()
    expect(r?.customerName).toBe('Unknown')
  })
})
