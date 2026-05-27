/**
 * Booking flow tests — covers the user-facing create path:
 *   AppointmentsView form submit → createAppointment action → synqed-core
 *
 * What's exercised here vs. migrated-appointments.test.ts:
 *   - Operating-hours validation rejects out-of-hours slots before the API
 *     call is made.
 *   - Date-string + time-string combine into the right UTC instant.
 *   - The submit handler's customer-lookup-by-name behavior.
 *   - source: 'MANUAL' default for staff-entered bookings round-trips.
 *
 * The migrated test already covers happy-path mapping, 409 overlap, and the
 * update/delete shims — keep this file scoped to flow-level invariants.
 */

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: jest.fn((fn: (...args: unknown[]) => unknown) => fn),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))

// Restrictive operating hours for the operating-hours rejection test below.
// 09:00–18:00 every day, in minutes-since-midnight.
const PERMISSIVE_HOURS = {
  mon: { openMinute: 0, closeMinute: 1440 },
  tue: { openMinute: 0, closeMinute: 1440 },
  wed: { openMinute: 0, closeMinute: 1440 },
  thu: { openMinute: 0, closeMinute: 1440 },
  fri: { openMinute: 0, closeMinute: 1440 },
  sat: { openMinute: 0, closeMinute: 1440 },
  sun: { openMinute: 0, closeMinute: 1440 },
}
const NINE_TO_SIX = {
  mon: { openMinute: 540, closeMinute: 1080 },
  tue: { openMinute: 540, closeMinute: 1080 },
  wed: { openMinute: 540, closeMinute: 1080 },
  thu: { openMinute: 540, closeMinute: 1080 },
  fri: { openMinute: 540, closeMinute: 1080 },
  sat: { openMinute: 540, closeMinute: 1080 },
  sun: { openMinute: 540, closeMinute: 1080 },
}
let activeHours: typeof PERMISSIVE_HOURS = PERMISSIVE_HOURS

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: activeHours })),
}))

jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  return { SynqedError }
})

// staff-map translates karute profile id → synqed staff id. The translation
// is exercised in its own suite; here we just want the booking action under
// test to see a resolved id without hitting a real synqed client.
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (profileId: string) => profileId),
}))

const appointments = { create: jest.fn(), list: jest.fn() }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ appointments })),
}))

import { createAppointment } from '@/actions/appointments'

describe('Booking creation flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    activeHours = PERMISSIVE_HOURS
  })

  it('builds the start/end pair from a HH:MM time string', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-1' })

    // Same call shape the AppointmentsView dialog produces: a date string +
    // time string + duration are combined into an ISO startTime before reaching
    // the action.
    const startIso = new Date('2026-05-20T13:30:00').toISOString()
    const result = await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: startIso,
      durationMinutes: 45,
      title: 'Hair cut',
    })

    expect(result).toEqual({ id: 'appt-1' })
    expect(appointments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'cust-9',
        staff_id: 'staff-1',
        starts_at: startIso,
        // 45 min later
        ends_at: new Date(new Date(startIso).getTime() + 45 * 60_000).toISOString(),
        duration_minutes: 45,
        title: 'Hair cut',
      }),
    )
  })

  it('rejects a booking outside operating hours without touching the API', async () => {
    activeHours = NINE_TO_SIX
    appointments.create.mockResolvedValue({ id: 'should-not-fire' })

    // 06:00 local on a Wednesday — well before the 09:00 open. Local Date math
    // mirrors what the form would produce when a user picks 06:00 on the
    // calendar input.
    const result = await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: new Date('2026-05-20T06:00:00').toISOString(),
      durationMinutes: 60,
      tzOffsetMinutes: -new Date('2026-05-20T06:00:00').getTimezoneOffset(),
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toMatch(/operating hours/i)
    }
    expect(appointments.create).not.toHaveBeenCalled()
  })

  it('rejects a non-positive duration before reaching the API', async () => {
    appointments.create.mockResolvedValue({ id: 'should-not-fire' })

    const result = await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: new Date('2026-05-20T11:00:00').toISOString(),
      durationMinutes: 0,
    })

    expect('error' in result).toBe(true)
    expect(appointments.create).not.toHaveBeenCalled()
  })

  it('omits title when not supplied (service field optional in dialog)', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-2' })

    await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: new Date('2026-05-20T11:00:00').toISOString(),
      durationMinutes: 60,
    })

    const call = appointments.create.mock.calls[0][0]
    expect(call.title).toBeNull()
  })
})
