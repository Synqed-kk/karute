/**
 * Verifies getCurrentUserStaffId — the cookie-free resolver that derives the
 * signed-in user's staff identity from auth.uid(). Replaces the prior
 * active_staff_id cookie pattern which let stale ids survive auth wipes and
 * caused FK violations.
 *
 * Drives the underlying Supabase clients directly so the resolver's contract
 * is the unit of test: auth user → matching staff row → user id; otherwise null.
 */

// React's cache() is per-request in RSC; out-of-band it's a no-op. Force the
// no-op behavior explicitly so per-test mutations of `scenario` aren't masked.
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return {
    ...actual,
    cache: (fn: (...a: unknown[]) => unknown) => fn,
  }
})

// next/cache — pass-through unstable_cache, stubbed revalidators.
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// Spy on the cookie store so we can assert it's never touched by the resolver.
const cookieGetSpy = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: cookieGetSpy,
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))

// Force the auth.getUser() path; the local-JWT fast path is configured via
// SUPABASE_JWT_SECRET and would short-circuit before reaching our mock.
delete process.env.SUPABASE_JWT_SECRET

type ProfileRow = {
  id: string
  full_name: string | null
  customer_id: string
  pin_hash: string | null
}

type Scenario = {
  authUser: { id: string } | null
  authError: { message: string } | null
  businessProfile: { customer_id: string } | null
  staffProfiles: ProfileRow[]
}

const scenario: Scenario = {
  authUser: null,
  authError: null,
  businessProfile: null,
  staffProfiles: [],
}

const serviceFromMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: scenario.authUser },
        error: scenario.authError,
      })),
      getSession: jest.fn(async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null })),
    },
  })),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: serviceFromMock })),
}))

import { getCurrentUserStaffId } from '@/lib/staff'

beforeEach(() => {
  jest.clearAllMocks()
  scenario.authUser = null
  scenario.authError = null
  scenario.businessProfile = null
  scenario.staffProfiles = []

  // Chainable query mock — handles both:
  //   .from('profiles').select(...).eq(...).single()      (getBusinessId)
  //   .from('profiles').select(...).eq(...).not().not().order()  (staff list)
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

describe('getCurrentUserStaffId', () => {
  it('returns the auth user id when a matching staff row exists', async () => {
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
      { id: 'user-b', full_name: 'Grace', customer_id: 'biz-1', pin_hash: null },
    ]

    expect(await getCurrentUserStaffId()).toBe('user-a')
  })

  it('returns null when the auth user has no matching staff row', async () => {
    // The user's auth row survived, but their staff profile was deleted —
    // exactly the post-wipe scenario the old cookie pattern mishandled.
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-b', full_name: 'Grace', customer_id: 'biz-1', pin_hash: null },
    ]

    expect(await getCurrentUserStaffId()).toBeNull()
  })

  it('returns null when the user is not authenticated', async () => {
    scenario.authUser = null
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]

    expect(await getCurrentUserStaffId()).toBeNull()
  })

  it('returns null when getBusinessId fails (orphan auth, no profile)', async () => {
    // Auth row exists but the profile row that scopes them to a business is
    // missing — getStaffList returns [] and the resolver falls through to null.
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = null
    scenario.staffProfiles = []

    expect(await getCurrentUserStaffId()).toBeNull()
  })

  it('does not read any cookie while resolving — the old active_staff_id path is dead', async () => {
    scenario.authUser = { id: 'user-a' }
    scenario.businessProfile = { customer_id: 'biz-1' }
    scenario.staffProfiles = [
      { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
    ]

    await getCurrentUserStaffId()

    // If a future change wires the cookie back in via next/headers, this
    // spy will fire and the test will fail — keeping us honest.
    expect(cookieGetSpy).not.toHaveBeenCalled()
  })
})
