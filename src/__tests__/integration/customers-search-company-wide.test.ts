/**
 * searchCustomersCompanyWide (P3 cross-branch search, ⚖ Liam 2026-09-16) —
 * the REMOTE tier behind the booking/record pickers' onRemoteSearch. Pins:
 *  1. Capability gate collapses to {error}, never throws.
 *  2. Empty query → {options: []}, no reads.
 *  3. A clamped actor: a result NOT in their own store-lensed cached list is
 *     flagged other_store: true; one that IS in it is other_store: false.
 *  4. An unclamped (viewAll) actor: never other_store (their own list is
 *     already business-wide, so nothing remote can be "other").
 *  5. Karute number merges ahead, same as list-all.ts.
 */
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  // store-scope.ts's own staffStoreAssignmentsByBusiness wraps in
  // unstable_cache at module scope — customerLensFor below loads that real
  // module (jest.requireActual), so this needs a passthrough, not a throw.
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async () => (k: string) => k),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => undefined),
}))
// customers.ts pulls audit-web.ts -> staff.ts in at module scope for other
// actions (staffListByBusiness's own unstable_cache(...) call needs the real
// unstable_cache, which this suite doesn't mock) — same convention as
// customer-deletion-actions.test.ts.
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  getStaffList: jest.fn(async () => []),
}))
const customersList = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ customers: { list: customersList } })),
}))
const resolveStoreScope = jest.fn()
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScope(),
  // Pure derivation of the faked scope — the REAL one, since the lens IS what
  // this suite pins.
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
}))
const getCachedCustomerList = jest.fn()
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: (...a: unknown[]) => getCachedCustomerList(...a),
}))

import { searchCustomersCompanyWide } from '@/actions/customers'
import { requireCapability } from '@/lib/auth/require-permission'

function cachedRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `name-${id}`,
    phone: null,
    furigana: null,
    isExistingCustomer: true,
    created_at: '2026-01-01T00:00:00.000Z',
    visitCount: 1,
    hasTicketPack: false,
    karute_number: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('searchCustomersCompanyWide', () => {
  it('empty query → {options: []}, no reads', async () => {
    const result = await searchCustomersCompanyWide('   ')
    expect(result).toEqual({ options: [] })
    expect(customersList).not.toHaveBeenCalled()
  })

  it('a failed capability gate collapses to {error}, never throws', async () => {
    ;(requireCapability as jest.Mock).mockRejectedValueOnce(new Error('forbidden'))
    const result = await searchCustomersCompanyWide('田中')
    expect(result).toEqual({ error: 'forbidden' })
    expect(customersList).not.toHaveBeenCalled()
  })

  it('clamped actor: a result outside their own store-lensed list is other_store: true; one inside is false', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    customersList.mockResolvedValueOnce({
      customers: [cachedRow('cust-own'), cachedRow('cust-other')],
      total: 2,
    })
    getCachedCustomerList.mockImplementation(async (storeId?: string) =>
      storeId === 'store-ginza' ? [cachedRow('cust-own')] : [cachedRow('cust-own'), cachedRow('cust-other')],
    )
    const result = await searchCustomersCompanyWide('田中')
    expect(result).toEqual({
      options: [
        expect.objectContaining({ id: 'cust-own', other_store: false }),
        expect.objectContaining({ id: 'cust-other', other_store: true }),
      ],
    })
    expect(getCachedCustomerList).toHaveBeenCalledWith('store-ginza')
  })

  it('unclamped (viewAll) actor: never other_store — their own list is already business-wide', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: true,
      allowedStoreIds: null,
      degraded: false,
    })
    customersList.mockResolvedValueOnce({ customers: [cachedRow('cust-any')], total: 1 })
    getCachedCustomerList.mockResolvedValue([])
    const result = await searchCustomersCompanyWide('田中')
    expect(result).toEqual({ options: [expect.objectContaining({ id: 'cust-any', other_store: false })] })
    // customerLensFor(unclamped) === undefined → the own-list fetch never runs.
    expect(getCachedCustomerList).toHaveBeenCalledTimes(1)
  })

  it('karute number merges ahead of the (empty) name/phone matches', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: null,
      viewAll: true,
      allowedStoreIds: null,
      degraded: false,
    })
    customersList.mockResolvedValueOnce({ customers: [], total: 0 })
    getCachedCustomerList.mockResolvedValue([cachedRow('cust-42', { karute_number: 42 })])
    const result = await searchCustomersCompanyWide('0042')
    expect(result).toEqual({ options: [expect.objectContaining({ id: 'cust-42', other_store: false })] })
  })
})
