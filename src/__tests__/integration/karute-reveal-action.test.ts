// カルテ tab search-reveal web action (PR-1b 検索リビール, karute-tab
// restructure packet). Pins:
//   1. Store scoping: a clamped viewer's SEARCH is store-scoped (never
//      another store's customer); a cross-store viewer's search is
//      business-wide (list-all.ts's own enforceStore gate, copied verbatim).
//   2. The zero-karute CHECK is ALWAYS store-scoped, even when the search
//      itself was business-wide — a customer with karute elsewhere still
//      has none HERE.
//   3. Exactly one row: the FIRST zero-karute candidate wins; later
//      qualifying candidates are never even checked (mutation-red-run
//      target — a `.slice`/loop-continue mistake would call every
//      candidate rather than stopping).
//   4. Capability gate collapses to {error}, never throws.
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  staffListByBusinessOrThrow: jest.fn(async () => []),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(),
}))

const customersList = jest.fn()
const karuteRecordsList = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    customers: { list: customersList },
    karuteRecords: { list: karuteRecordsList },
  })),
}))

import { revealNoKaruteCustomer } from '@/actions/karute'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { requireCapability } from '@/lib/auth/require-permission'

const scopeMock = resolveStoreScope as jest.Mock

function clampedTo(storeId: string) {
  scopeMock.mockResolvedValue({
    storeId,
    viewAll: false,
    allowedStoreIds: [storeId],
    degraded: false,
  })
}
function crossStore(pinned: string | null) {
  scopeMock.mockResolvedValue({
    storeId: pinned,
    viewAll: true,
    allowedStoreIds: null,
    degraded: false,
  })
}

function customer(
  overrides: Partial<{
    id: string
    name: string
    karute_number: number | null
    created_at: string
  }> = {},
) {
  return {
    id: 'cust-1',
    name: '田中太郎',
    karute_number: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('revealNoKaruteCustomer — store scoping', () => {
  it('clamped viewer: the SEARCH is store-scoped (enforceStore gate)', async () => {
    clampedTo('store-ginza')
    customersList.mockResolvedValueOnce({ customers: [customer()], total: 1 })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [], total: 0 })
    await revealNoKaruteCustomer('田中')
    expect(customersList).toHaveBeenCalledWith(
      expect.objectContaining({ search: '田中', store_id: 'store-ginza', page_size: 5 }),
    )
  })

  it('cross-store viewer: the search is business-wide (no store filter)', async () => {
    crossStore('store-ginza')
    customersList.mockResolvedValueOnce({ customers: [customer()], total: 1 })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [], total: 0 })
    await revealNoKaruteCustomer('田中')
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })

  it('the zero-karute check is ALWAYS store-scoped, even under a business-wide search', async () => {
    crossStore('store-ginza')
    customersList.mockResolvedValueOnce({ customers: [customer({ id: 'cust-1' })], total: 1 })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [], total: 0 })
    await revealNoKaruteCustomer('田中')
    expect(karuteRecordsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-1', store_id: 'store-ginza', page_size: 1 }),
    )
  })

  it('clamped with no resolvable store (defensive) never falls through to an unscoped search', async () => {
    scopeMock.mockResolvedValue({
      storeId: null,
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    })
    const result = await revealNoKaruteCustomer('田中')
    expect(result).toEqual({ candidate: null })
    expect(customersList).not.toHaveBeenCalled()
  })
})

describe('revealNoKaruteCustomer — exactly one row', () => {
  it('returns only the FIRST zero-karute candidate; later candidates are never even checked', async () => {
    crossStore('store-ginza')
    customersList.mockResolvedValueOnce({
      customers: [customer({ id: 'cust-1' }), customer({ id: 'cust-2' }), customer({ id: 'cust-3' })],
      total: 3,
    })
    karuteRecordsList
      .mockResolvedValueOnce({ karute_records: [{}], total: 1 }) // cust-1 HAS karute
      .mockResolvedValueOnce({ karute_records: [], total: 0 }) // cust-2 is the reveal
    const result = await revealNoKaruteCustomer('田中')
    expect(result).toEqual({ candidate: expect.objectContaining({ id: 'cust-2' }) })
    expect(karuteRecordsList).toHaveBeenCalledTimes(2)
  })

  it('no candidate has zero karute → candidate: null', async () => {
    crossStore('store-ginza')
    customersList.mockResolvedValueOnce({ customers: [customer()], total: 1 })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [{}], total: 1 })
    await expect(revealNoKaruteCustomer('田中')).resolves.toEqual({ candidate: null })
  })

  it('empty/whitespace query short-circuits to no candidate without calling synqed at all', async () => {
    const result = await revealNoKaruteCustomer('   ')
    expect(result).toEqual({ candidate: null })
    expect(customersList).not.toHaveBeenCalled()
  })
})

describe('revealNoKaruteCustomer — candidate shape', () => {
  it('formats a real karute_number as #NNNNN; falls back to #00000 when absent', async () => {
    crossStore('store-ginza')
    customersList.mockResolvedValueOnce({
      customers: [customer({ id: 'cust-1', karute_number: 42, created_at: '2026-03-04T00:00:00.000Z' })],
      total: 1,
    })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [], total: 0 })
    await expect(revealNoKaruteCustomer('田中')).resolves.toEqual({
      candidate: { id: 'cust-1', name: '田中太郎', code: '#00042', registeredDate: '2026-03-04T00:00:00.000Z' },
    })
  })

  it('a null/absent karute_number falls back to #00000', async () => {
    crossStore('store-ginza')
    customersList.mockResolvedValueOnce({ customers: [customer({ karute_number: null })], total: 1 })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [], total: 0 })
    const result = await revealNoKaruteCustomer('田中')
    expect(result).toEqual({ candidate: expect.objectContaining({ code: '#00000' }) })
  })
})

describe('revealNoKaruteCustomer — capability gate', () => {
  it('a failed gate collapses to {error}, never throws across the action boundary', async () => {
    ;(requireCapability as jest.Mock).mockRejectedValueOnce(new Error('forbidden'))
    const result = await revealNoKaruteCustomer('田中')
    expect(result).toEqual({ error: 'forbidden' })
    expect(customersList).not.toHaveBeenCalled()
  })
})
