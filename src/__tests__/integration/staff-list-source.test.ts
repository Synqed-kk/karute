/**
 * getStaffList sources the roster from synqed-core (not Supabase profiles).
 * Verifies the Staff → StaffMember mapping, the is_active filter, and that
 * the synqed client is scoped to the org's businessId.
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

delete process.env.SUPABASE_JWT_SECRET
process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const scenario: { businessId: string; synqedStaff: unknown[] } = {
  businessId: 'biz-1',
  synqedStaff: [],
}

const serviceFromMock = jest.fn(() => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  // Lazy so scenario.businessId is read at call time, not captured at definition.
  single: jest.fn().mockImplementation(async () => ({
    data: { customer_id: scenario.businessId },
    error: null,
  })),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: serviceFromMock })),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'org-user' } }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  })),
}))

// Use a factory that avoids closing over hoisted variables.
// The list fn is kept in module scope so beforeEach can re-mock it.
jest.mock('@synqed-kk/client', () => {
  const listFn = jest.fn()
  const MockClient = jest.fn().mockImplementation(() => ({ staff: { list: listFn } }))
  // Expose listFn via the mock module so tests can configure it.
  ;(MockClient as unknown as { _listFn: jest.Mock })._listFn = listFn
  return { SynqedClient: MockClient }
})

import { getStaffList } from '@/lib/staff'
import { SynqedClient } from '@synqed-kk/client'

// Grab the shared listFn that was attached in the factory above.
const listFn = (SynqedClient as unknown as { _listFn: jest.Mock })._listFn

beforeEach(() => {
  jest.clearAllMocks()
  // Re-attach listFn after clearAllMocks resets the constructor mock.
  ;(SynqedClient as jest.Mock).mockImplementation(() => ({ staff: { list: listFn } }))
  // Use mockImplementation (not mockResolvedValue) so scenario.synqedStaff is
  // read lazily at call time — not captured when beforeEach runs.
  listFn.mockImplementation(async () => ({ staff: scenario.synqedStaff, total: 0, page: 1, page_size: 200 }))
})

describe('getStaffList — synqed-core roster', () => {
  it('maps synqed Staff to StaffMember and scopes the client to businessId', async () => {
    scenario.synqedStaff = [
      { id: 's-1', business_id: 'biz-1', user_id: null, name: '四宮朱美', name_kana: null,
        email: 'a@x.test', role: 'STYLIST', is_active: true, avatar_url: 'http://img/1',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ]
    const list = await getStaffList()
    expect(list).toEqual([
      { id: 's-1', full_name: '四宮朱美', display_role: 'stylist', position: null,
        email: 'a@x.test', phone: null, avatar_url: 'http://img/1', has_pin: false,
        created_at: '2026-01-01T00:00:00Z' },
    ])
    expect(SynqedClient).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-1' }),
    )
  })

  it('excludes inactive staff', async () => {
    scenario.synqedStaff = [
      { id: 's-1', business_id: 'biz-1', user_id: null, name: 'Active', name_kana: null,
        email: null, role: 'STYLIST', is_active: true, avatar_url: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 's-2', business_id: 'biz-1', user_id: null, name: 'Gone', name_kana: null,
        email: null, role: 'STYLIST', is_active: false, avatar_url: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ]
    const list = await getStaffList()
    expect(list.map((s) => s.id)).toEqual(['s-1'])
  })

  it('returns [] when synqed env is missing', async () => {
    const url = process.env.SYNQED_CORE_URL
    delete process.env.SYNQED_CORE_URL
    expect(await getStaffList()).toEqual([])
    process.env.SYNQED_CORE_URL = url
  })
})
