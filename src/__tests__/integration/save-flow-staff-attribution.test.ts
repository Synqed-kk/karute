/**
 * saveKaruteRecord attributes to the supplied staffId and validates it against
 * the org roster (getStaffList). A staffId outside the roster is rejected and
 * never reaches synqed-core.
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
jest.mock('@/lib/staff', () => ({
  getStaffList: jest.fn(async () => rosterIds.map((id) => ({ id, full_name: id, has_pin: false, created_at: '' }))),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

const karuteRecords = { create: jest.fn() }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords })),
}))

import { saveKaruteRecord, saveKaruteRecordInline } from '@/actions/karute'

const baseInput = {
  customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [],
}

beforeEach(() => {
  jest.clearAllMocks()
  rosterIds.length = 0
})

describe('saveKaruteRecord — roster-validated attribution', () => {
  it('forwards a roster staffId as staff_id', async () => {
    rosterIds.push('staff-a')
    karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
    await saveKaruteRecord({ ...baseInput, staffId: 'staff-a' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-1', staff_id: 'staff-a' }),
    )
  })

  it('rejects a staffId not in the roster and never calls synqed', async () => {
    rosterIds.push('staff-a')
    const result = await saveKaruteRecord({ ...baseInput, staffId: 'intruder' })
    expect(result).toEqual({ error: expect.stringMatching(/not part of your salon/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('surfaces a transient error (not a rejection) when the roster is empty', async () => {
    // getStaffList degrades to [] when synqed-core is unreachable — the save
    // must not blame the user with "not part of your salon".
    const result = await saveKaruteRecord({ ...baseInput, staffId: 'staff-a' })
    expect(result).toEqual({ error: expect.stringMatching(/could not load/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })
})

describe('saveKaruteRecordInline — roster-validated attribution', () => {
  it('returns the record id for a roster staffId', async () => {
    rosterIds.push('staff-a')
    karuteRecords.create.mockResolvedValue({ id: 'kr-9' })
    const result = await saveKaruteRecordInline({ ...baseInput, staffId: 'staff-a' })
    expect(result).toEqual({ id: 'kr-9' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'staff-a' }),
    )
  })

  it('rejects a staffId not in the roster and never calls synqed', async () => {
    rosterIds.push('staff-a')
    const result = await saveKaruteRecordInline({ ...baseInput, staffId: 'intruder' })
    expect(result).toEqual({ error: expect.stringMatching(/not part of your salon/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })
})
