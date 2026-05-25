/**
 * createAppointment forwards the supplied staffId straight to synqed-core.
 * No profile->synqed translation, no cookie reads.
 */
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
const cookieGetSpy = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: cookieGetSpy, getAll: jest.fn(() => []), set: jest.fn() })),
}))

delete process.env.SUPABASE_JWT_SECRET
process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({
    operating_hours: {
      mon: { openMinute: 0, closeMinute: 1440 }, tue: { openMinute: 0, closeMinute: 1440 },
      wed: { openMinute: 0, closeMinute: 1440 }, thu: { openMinute: 0, closeMinute: 1440 },
      fri: { openMinute: 0, closeMinute: 1440 }, sat: { openMinute: 0, closeMinute: 1440 },
      sun: { openMinute: 0, closeMinute: 1440 },
    },
  })),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { customer_id: 'biz-1' }, error: null }),
    })),
  })),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'org-user' } }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  })),
}))

const appointments = { create: jest.fn() }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({ appointments })),
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) { super(message); this.name = 'SynqedError'; this.status = status }
  },
}))

import { createAppointment } from '@/actions/appointments'

beforeEach(() => { jest.clearAllMocks() })

describe('createAppointment — staff id passthrough', () => {
  it('forwards staffId straight to synqed.appointments.create', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-1' })
    const result = await createAppointment({
      staffId: 'synqed-staff-a',
      clientId: 'cust-1',
      startTime: '2026-06-01T03:00:00.000Z',
      durationMinutes: 60,
      title: 'Cut + color',
    })
    expect(result).toEqual({ id: 'appt-1' })
    expect(appointments.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-1', staff_id: 'synqed-staff-a', duration_minutes: 60 }),
    )
  })

  it('never reads a cookie during the booking path', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-2' })
    await createAppointment({
      staffId: 'synqed-staff-a', clientId: 'cust-1',
      startTime: '2026-06-01T03:00:00.000Z', durationMinutes: 60,
    })
    expect(cookieGetSpy).not.toHaveBeenCalled()
  })
})
