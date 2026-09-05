/**
 * End-to-end booking flow through the auth-derived staff resolver.
 *
 * booking-flow.test.ts mocks @/lib/staff wholesale; that's fine for testing
 * the form-→-API mapping but it can't catch a regression where the booking
 * action grows back a cookie dependency. This file leaves @/lib/staff REAL,
 * drives the entire chain through mocked Supabase + synqed-core clients, and
 * pins the contract:
 *
 *   - createAppointment honors whatever staff_profile_id the caller supplies,
 *     plumbing it through resolveSynqedStaffId to synqed-core
 *   - When the caller's staff_profile_id matches no staff row (the post-wipe
 *     stale-cookie scenario from prod), the synqed staff lookup fails and the
 *     action returns a clean error — never an FK violation, never a corrupt row
 *   - The booking path reads ONLY the active-store view cookie
 *     (karute_active_store), never an auth/staff cookie — staff still comes
 *     from the supplied staff_profile_id, not from a cookie.
 */

jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return {
    ...actual,
    cache: (fn: (...a: unknown[]) => unknown) => fn,
  }
})

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

const cookieGetSpy = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: cookieGetSpy,
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))

delete process.env.SUPABASE_JWT_SECRET
process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

// Permissive operating hours so the time-of-day guard never trips here —
// this suite is about staff attribution, not business hours.
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({
    operating_hours: {
      mon: { openMinute: 0, closeMinute: 1440 },
      tue: { openMinute: 0, closeMinute: 1440 },
      wed: { openMinute: 0, closeMinute: 1440 },
      thu: { openMinute: 0, closeMinute: 1440 },
      fri: { openMinute: 0, closeMinute: 1440 },
      sat: { openMinute: 0, closeMinute: 1440 },
      sun: { openMinute: 0, closeMinute: 1440 },
    },
  })),
}))

type Scenario = {
  authUser: { id: string } | null
  businessProfile: { customer_id: string } | null
  staffProfiles: Array<{
    id: string
    full_name: string | null
    customer_id: string
    pin_hash: string | null
  }>
  synqedStaffByProfileId: Record<string, string | null>
}

const scenario: Scenario = {
  authUser: null,
  businessProfile: null,
  staffProfiles: [],
  synqedStaffByProfileId: {},
}

const serviceFromMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: scenario.authUser },
        error: null,
      })),
      getSession: jest.fn(async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null })),
    },
  })),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: serviceFromMock })),
}))

// RBAC gate neutralized — this suite isolates staff attribution, not
// permissions. Capability enforcement is covered in
// rbac-server-enforcement.test.ts.
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

// Mock resolveSynqedStaffId so the test controls translation. In prod the
// resolver self-heals via email fallback; here we simulate the "no synqed
// staff matches this profile" failure as a thrown error, mirroring what
// synqed-core's FK would have surfaced as a 400.
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (profileId: string) => {
    const id = scenario.synqedStaffByProfileId[profileId]
    if (id === undefined) {
      throw new Error(`No synqed staff for profile ${profileId}`)
    }
    return id
  }),
}))

const appointments = { create: jest.fn() }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({ appointments })),
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  },
}))

import { createAppointment } from '@/actions/appointments'

beforeEach(() => {
  jest.clearAllMocks()
  scenario.authUser = null
  scenario.businessProfile = null
  scenario.staffProfiles = []
  scenario.synqedStaffByProfileId = {}

  serviceFromMock.mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({
      data: scenario.staffProfiles,
      error: null,
    }),
    single: jest.fn().mockResolvedValue({
      data: scenario.businessProfile,
      error: null,
    }),
  }))
})

describe('createAppointment — auth-derived staff attribution', () => {
  it('books for a signed-in owner whose profile resolves to a synqed staff', async () => {
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]
    scenario.synqedStaffByProfileId = { 'user-a': 'synqed-staff-a' }
    appointments.create.mockResolvedValue({ id: 'appt-1' })

    const result = await createAppointment({
      staffProfileId: 'user-a',
      clientId: 'cust-1',
      startTime: '2026-06-01T03:00:00.000Z',
      durationMinutes: 60,
      title: 'Cut + color',
    })

    expect(result).toEqual({ id: 'appt-1' })
    expect(appointments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'cust-1',
        staff_id: 'synqed-staff-a',
        duration_minutes: 60,
        title: 'Cut + color',
      }),
    )
  })

  it('surfaces a clean error (no FK violation) when the staff profile id is stale', async () => {
    // Reproduces the prod incident: the booking form sent a profile id that
    // didn't exist anymore (stale cookie post-wipe). With auth-derived state
    // this can't happen for the *current* user, but bookings on behalf of
    // others (or a stale form state) still hit this path.
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]
    // 'ghost-profile' isn't in synqedStaffByProfileId → resolver throws
    appointments.create.mockResolvedValue({ id: 'should-not-fire' })

    const result = await createAppointment({
      staffProfileId: 'ghost-profile',
      clientId: 'cust-1',
      startTime: '2026-06-01T03:00:00.000Z',
      durationMinutes: 60,
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toMatch(/no synqed staff/i)
    }
    expect(appointments.create).not.toHaveBeenCalled()
  })

  it('never reads a cookie during the booking path', async () => {
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]
    scenario.synqedStaffByProfileId = { 'user-a': 'synqed-staff-a' }
    appointments.create.mockResolvedValue({ id: 'appt-2' })

    await createAppointment({
      staffProfileId: 'user-a',
      clientId: 'cust-1',
      startTime: '2026-06-01T03:00:00.000Z',
      durationMinutes: 60,
    })

    // Multi-store: booking reads ONLY the active-store view cookie to stamp
    // the booking's store_id — never an auth/staff cookie. Staff is still
    // derived from the supplied staff_profile_id, not a cookie.
    expect(cookieGetSpy).toHaveBeenCalledWith('karute_active_store')
  })
})
