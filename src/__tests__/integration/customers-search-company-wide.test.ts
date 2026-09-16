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
 *
 * ⚖ Liam 2026-09-16 (Greptile fold, PR #945, round 2) added:
 *  6. A FAILED lens read is UNKNOWN, not "own store": other_store is
 *     TRI-STATE (true/false/null) — a .catch(() => null) that let a failed
 *     read collapse to the same "false" a genuine own-store row gets was the
 *     bug (a foreign customer would ship with no 他店舗 chip). MUTATION
 *     TARGET: reverting other_store's null branch back to `false` turns the
 *     "lens read fails → null, never false" test red.
 *  7. A FAILED business-wide read (karute-number-eligible term) surfaces as
 *     karute_number_unavailable: true — the direct search result still
 *     returns, just without the karute-number merge, never silently.
 *
 * ⚖ Liam 2026-09-16 (F-2 fold, PR #945, Greptile finding at
 * RecordCustomerPickerDialog.tsx:314) added:
 *  8. remote_more is true once more than CUSTOMER_SEARCH_LIMIT rows are
 *     available after the karute-number merge (a +1 probe row from core is
 *     the source of truth, never the SDK's own total), false at exactly the
 *     limit — options always still slice to CUSTOMER_SEARCH_LIMIT either way.
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
    expect(result).toEqual({ options: [], karute_number_unavailable: false, remote_more: false })
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
      karute_number_unavailable: false,
      remote_more: false,
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
    expect(result).toEqual({
      options: [expect.objectContaining({ id: 'cust-any', other_store: false })],
      karute_number_unavailable: false,
      remote_more: false,
    })
    // Greptile fold: '田中' isn't karute-number-eligible AND the viewer is
    // unclamped — neither cache read is needed, so getCachedCustomerList
    // never runs at all.
    expect(getCachedCustomerList).not.toHaveBeenCalled()
  })

  it('Greptile fold: a non-digit term never loads the business-wide cache (eligibility checked first)', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    customersList.mockResolvedValueOnce({ customers: [cachedRow('cust-own')], total: 1 })
    getCachedCustomerList.mockImplementation(async (storeId?: string) =>
      storeId === 'store-ginza' ? [cachedRow('cust-own')] : [cachedRow('cust-own'), cachedRow('cust-other')],
    )
    await searchCustomersCompanyWide('田中')
    // Only the own-store lens call (for other_store) — never the unscoped
    // business-wide call, which is only needed for a karute-number term.
    expect(getCachedCustomerList).toHaveBeenCalledTimes(1)
    expect(getCachedCustomerList).toHaveBeenCalledWith('store-ginza')
  })

  // MUTATION TARGET (Greptile fold round 2): reverting otherStoreFor's
  // `if (!ownIds) return null` back to a bare `!ownIds.has(id)` — which
  // computes `false` when ownIds is null — turns this test red.
  it('Greptile fold: a FAILED lens read is UNKNOWN (other_store: null), never silently "own store"', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    // '田中' isn't karute-eligible, so only the lens (own-store) cache read
    // fires — isolates the lens-failure path from the business-wide one.
    customersList.mockResolvedValueOnce({ customers: [cachedRow('cust-1')], total: 1 })
    getCachedCustomerList.mockRejectedValue(new Error('cache down'))
    const result = await searchCustomersCompanyWide('田中')
    expect(result).toEqual({
      options: [expect.objectContaining({ id: 'cust-1', other_store: null })],
      karute_number_unavailable: false,
      remote_more: false,
    })
  })

  it('Greptile fold: a FAILED business-wide read on a karute-number-eligible term returns the direct results plus karute_number_unavailable: true', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: null,
      viewAll: true,
      allowedStoreIds: null,
      degraded: false,
    })
    // viewAll -> no lens read attempted; '0042' IS karute-eligible, so the
    // business-wide read fires and fails.
    customersList.mockResolvedValueOnce({ customers: [cachedRow('cust-1')], total: 1 })
    getCachedCustomerList.mockRejectedValue(new Error('cache down'))
    const result = await searchCustomersCompanyWide('0042')
    expect(result).toEqual({
      options: [expect.objectContaining({ id: 'cust-1', other_store: false })],
      karute_number_unavailable: true,
      remote_more: false,
    })
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
    expect(result).toEqual({
      options: [expect.objectContaining({ id: 'cust-42', other_store: false })],
      karute_number_unavailable: false,
      remote_more: false,
    })
  })

  // ── F-2 fold (⚖ Liam 2026-09-16, PR #945 Greptile finding) ────────────────
  // remote_more off the +1 probe, computed AFTER the karute-number merge.
  it('F-2: 9 rows from core → remote_more: true, options still slice to 8', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: null,
      viewAll: true,
      allowedStoreIds: null,
      degraded: false,
    })
    customersList.mockResolvedValueOnce({
      customers: Array.from({ length: 9 }, (_, i) => cachedRow(`cust-${i}`)),
      total: 9,
    })
    const result = await searchCustomersCompanyWide('田中')
    expect(result).toEqual({
      options: Array.from({ length: 8 }, (_, i) => expect.objectContaining({ id: `cust-${i}` })),
      karute_number_unavailable: false,
      remote_more: true,
    })
  })

  it('F-2: exactly 8 rows from core → remote_more: false', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: null,
      viewAll: true,
      allowedStoreIds: null,
      degraded: false,
    })
    customersList.mockResolvedValueOnce({
      customers: Array.from({ length: 8 }, (_, i) => cachedRow(`cust-${i}`)),
      total: 8,
    })
    const result = (await searchCustomersCompanyWide('田中')) as {
      options: unknown[]
      remote_more: boolean
    }
    expect(result.options).toHaveLength(8)
    expect(result.remote_more).toBe(false)
  })

  it('F-2: a karute-number hit plus 8 direct-search rows → remote_more: true (merge pushes past the cap)', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: null,
      viewAll: true,
      allowedStoreIds: null,
      degraded: false,
    })
    // viewAll -> no lens read; '0042' IS karute-eligible, so the business-wide
    // read fires and supplies the karute-number hit.
    customersList.mockResolvedValueOnce({
      customers: Array.from({ length: 8 }, (_, i) => cachedRow(`cust-${i}`)),
      total: 8,
    })
    getCachedCustomerList.mockResolvedValue([cachedRow('cust-hit', { karute_number: 42 })])
    const result = (await searchCustomersCompanyWide('0042')) as {
      options: { id: string }[]
      remote_more: boolean
    }
    expect(result.options).toHaveLength(8)
    expect(result.options[0]).toEqual(expect.objectContaining({ id: 'cust-hit' }))
    expect(result.remote_more).toBe(true)
  })
})
