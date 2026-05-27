/**
 * Coverage for the auth-derived staff path added in PR #89/#105 (replay/15):
 * saveKaruteRecord may omit staffId, in which case the server resolves it from
 * the signed-in user via getCurrentUserStaffId() rather than trusting client
 * input. Provided ids still validate against the roster (legacy path).
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
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))

process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const rosterIds: string[] = []
let currentStaffId: string | null = null
jest.mock('@/lib/staff', () => ({
  getStaffList: jest.fn(async () =>
    rosterIds.map((id) => ({ id, full_name: id, has_pin: false, created_at: '' })),
  ),
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => currentStaffId),
}))

const karuteRecords = { create: jest.fn() }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords })),
}))

import { saveKaruteRecord } from '@/actions/karute'

const baseInput = { customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [] }

beforeEach(() => {
  jest.clearAllMocks()
  rosterIds.length = 0
  currentStaffId = null
})

describe('saveKaruteRecord — auth-derived staff resolution', () => {
  it('derives staff_id from the signed-in user when staffId is omitted', async () => {
    currentStaffId = 'me-staff'
    karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
    await saveKaruteRecord({ ...baseInput })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'me-staff' }),
    )
  })

  it('errors (and never calls synqed) when no staffId and no staff identity', async () => {
    currentStaffId = null
    const result = await saveKaruteRecord({ ...baseInput })
    expect(result).toEqual({ error: expect.stringMatching(/no staff identity/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('still honours an explicit roster staffId (legacy path) over auth', async () => {
    rosterIds.push('legacy-staff')
    currentStaffId = 'me-staff'
    karuteRecords.create.mockResolvedValue({ id: 'kr-2' })
    await saveKaruteRecord({ ...baseInput, staffId: 'legacy-staff' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'legacy-staff' }),
    )
  })
})
