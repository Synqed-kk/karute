/**
 * Store lens threading in listCustomers (the bulk-export read path).
 *
 * /api/export streamed the WHOLE business's customer book (up to 5,000 rows of
 * PII) regardless of the caller's store clamp — listCustomers had no store
 * concept at all. These tests pin the fix:
 *   - storeId threads through to the core read as store_id,
 *   - a store-lensed read NEVER goes through the business-wide landing cache
 *     (default params + storeId must still hit the SDK with the filter),
 *   - the default business-wide call stays byte-identical (no store_id).
 */

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  // Pass-through: the landing cache becomes a plain call so both paths are
  // observable at the SDK boundary.
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(),
}))

const listSpy = jest.fn(async () => ({
  customers: [],
  total: 0,
  total_pages: 1,
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({
    customers: { list: listSpy },
  })),
}))

import { listCustomers } from '@/lib/customers/queries'

beforeEach(() => {
  listSpy.mockClear()
  process.env.SYNQED_CORE_URL = 'http://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})

describe('listCustomers — store lens (#465 family)', () => {
  it('threads storeId to the core read as store_id', async () => {
    await listCustomers({ storeId: 'store-ginza', page: 2 })
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })

  it('applies the store lens even on default landing params (cache bypass)', async () => {
    // Old code routed default params through the business-wide landing cache,
    // which has no store argument — this call would reach the SDK without
    // store_id and the assertion fails on old code.
    await listCustomers({ storeId: 'store-ginza' })
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })

  it('stays business-wide when no storeId is given', async () => {
    await listCustomers()
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: undefined }),
    )
  })
})
