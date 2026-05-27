/**
 * End-to-end save-flow attribution test.
 *
 * The existing migrated-* tests mock @/lib/staff wholesale, which means they
 * can't catch a regression where the action stops calling the resolver. This
 * suite leaves @/lib/staff real and drives the entire chain through mocked
 * Supabase clients + a mocked synqed-core client.
 *
 * What it proves end-to-end:
 *   - saveKaruteRecord pulls the staff id from getCurrentUserStaffId (auth.uid)
 *     and forwards it as staff_id to synqed.karuteRecords.create
 *   - When the signed-in user has no staff row, save returns an error and
 *     never hits synqed-core — the FK-on-stale-cookie failure mode is dead
 *   - The save path never touches next/headers (no cookie read)
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

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
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

type Scenario = {
  authUser: { id: string } | null
  businessProfile: { customer_id: string } | null
  staffProfiles: Array<{
    id: string
    full_name: string | null
    customer_id: string
    pin_hash: string | null
  }>
}

const scenario: Scenario = {
  authUser: null,
  businessProfile: null,
  staffProfiles: [],
}

const serviceFromMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: scenario.authUser },
        error: null,
      })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  })),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: serviceFromMock })),
}))

const karuteRecords = { create: jest.fn() }
const appointments = { get: jest.fn() }

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({
    karuteRecords,
    appointments,
  })),
}))

import { saveKaruteRecord } from '@/actions/karute'

beforeEach(() => {
  jest.clearAllMocks()
  scenario.authUser = null
  scenario.businessProfile = null
  scenario.staffProfiles = []

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

describe('saveKaruteRecord — staff attribution', () => {
  it("uses the signed-in user's id as staff_id when a matching staff row exists", async () => {
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]
    karuteRecords.create.mockResolvedValue({ id: 'kr-1' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 't',
      summary: 's',
      entries: [],
    })

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'cust-1',
        staff_id: 'user-a',
      }),
    )
  })

  it('returns an error and never calls synqed when the user has no staff row', async () => {
    // Post-wipe scenario: auth row still alive, staff profile gone.
    // The old cookie pattern would have plumbed a stale id straight into the
    // FK; now we surface a clean error instead.
    scenario.authUser = { id: 'user-orphan' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-b', full_name: 'Grace', customer_id: 'biz-1', pin_hash: null },
    ]

    const result = await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 't',
      summary: 's',
      entries: [],
    })

    expect(result).toEqual({ error: expect.stringMatching(/staff identity/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it("uses the appointment's staff_id when an appointmentId is provided (override path)", async () => {
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]
    // The appointment is owned by a different staff member — the karute
    // record should follow the appointment's attribution, not the signer's.
    appointments.get.mockResolvedValue({ staff_id: 'other-staff' })
    karuteRecords.create.mockResolvedValue({ id: 'kr-2' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 't',
      summary: 's',
      entries: [],
      appointmentId: 'appt-1',
    })

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({
        staff_id: 'other-staff',
        appointment_id: 'appt-1',
      }),
    )
  })

  it('never reads a cookie during the save path', async () => {
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]
    karuteRecords.create.mockResolvedValue({ id: 'kr-3' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 't',
      summary: 's',
      entries: [],
    })

    expect(cookieGetSpy).not.toHaveBeenCalled()
  })
})
