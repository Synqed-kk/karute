/**
 * createPackAction total_price defaulting (fix/pack-total-price).
 *
 * Neither purchase form sends totalPrice, which saved every pack with
 * total_price null — zero recorded pack revenue. The action now derives
 * 合計金額 = unitPrice × packSize server-side when the caller omits it, and
 * passes an explicit totalPrice (e.g. a hand-negotiated discount total)
 * through untouched. The store layer is mocked so we assert exactly what the
 * action forwards to createPack. Spies are `mock`-prefixed so the hoisted
 * jest.mock factory may reference them (babel-plugin-jest-hoist rule).
 */

const mockCreatePack = jest.fn(
  async (_input: { totalPrice?: number | null }): Promise<{ ok: boolean; id?: string; error?: string }> => ({
    ok: true,
    id: 'pack-1',
  }),
)
const mockListCustomerPacks = jest.fn(async (_customerId: string): Promise<unknown[]> => [])

jest.mock('@/lib/packs/store', () => ({
  createPack: (input: unknown) => mockCreatePack(input as { totalPrice?: number | null }),
  listCustomerPacks: (id: string) => mockListCustomerPacks(id),
  addRedemption: jest.fn(),
  removeRedemption: jest.fn(),
  updatePackStatus: jest.fn(),
  setLifecycle: jest.fn(),
  findCustomerAppointmentForDate: jest.fn(),
}))

jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  updateTag: jest.fn(),
}))

import { createPackAction } from '@/actions/packs'

beforeEach(() => {
  jest.clearAllMocks()
  mockCreatePack.mockImplementation(async () => ({ ok: true, id: 'pack-1' }))
  mockListCustomerPacks.mockImplementation(async () => [])
})

describe('createPackAction — total_price defaulting', () => {
  it('derives totalPrice = unitPrice × packSize when the caller omits it (both forms do)', async () => {
    const res = await createPackAction({
      customerId: 'cust-1',
      kind: 'pack',
      packSize: 10,
      unitPrice: 9900,
    })
    expect(res.ok).toBe(true)
    expect(mockCreatePack).toHaveBeenCalledWith(
      expect.objectContaining({ totalPrice: 99000 }),
    )
  })

  it('passes an explicit totalPrice through untouched (discounted pack)', async () => {
    await createPackAction({
      customerId: 'cust-1',
      kind: 'pack',
      packSize: 10,
      unitPrice: 9900,
      totalPrice: 88000,
    })
    expect(mockCreatePack).toHaveBeenCalledWith(
      expect.objectContaining({ totalPrice: 88000 }),
    )
  })

  it('single session: totalPrice = the one session price', async () => {
    await createPackAction({
      customerId: 'cust-1',
      kind: 'single',
      packSize: 1,
      unitPrice: 8800,
    })
    expect(mockCreatePack).toHaveBeenCalledWith(
      expect.objectContaining({ totalPrice: 8800 }),
    )
  })

  it('still rejects invalid inputs before any store call', async () => {
    const res = await createPackAction({
      customerId: 'cust-1',
      kind: 'pack',
      packSize: 0,
      unitPrice: 9900,
    })
    expect(res.ok).toBe(false)
    expect(mockCreatePack).not.toHaveBeenCalled()
  })
})
