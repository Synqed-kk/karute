/**
 * Tenant-isolation guard on the customer-memory mutations.
 *
 * The DB helpers run on the RLS-bypassing service client keyed only by a
 * client-supplied id/customerId, so the action layer MUST verify the caller's
 * business owns the target before mutating. These tests prove a cross-tenant id
 * is rejected BEFORE any mutation fires, and a same-tenant id passes through.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: jest.fn().mockResolvedValue('ja') }))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn().mockResolvedValue('biz-A') }))

jest.mock('@/lib/karute/customer-memory', () => ({
  getMemoryItemCustomerId: jest.fn(),
  addStaffMemoryItem: jest.fn().mockResolvedValue({ ok: true }),
  updateMemoryItem: jest.fn().mockResolvedValue({ ok: true }),
  setMemoryItemPinned: jest.fn().mockResolvedValue({ ok: true }),
  softDeleteMemoryItem: jest.fn().mockResolvedValue({ ok: true }),
  softDeleteAiExtractionItems: jest.fn(),
  restoreMemoryItems: jest.fn(),
  upsertPassportField: jest.fn().mockResolvedValue({ ok: true }),
}))

// getCustomerWithClient is the ownership oracle — business-scoped, so it rejects
// a cross-tenant id. The guard treats a throw or a null as "not ours". (The
// actions now thread an explicit client — the single-source WithClient cores —
// so the cookie web wrapper constructs it via getSynqedClient.)
jest.mock('@/lib/customers/queries', () => ({ getCustomerWithClient: jest.fn() }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: async () => ({ customers: {} }) }))

import {
  updateMemoryItemAction,
  toggleMemoryPinAction,
  deleteMemoryItemAction,
  addMemoryItemAction,
} from '@/actions/memory'

const mem = jest.requireMock('@/lib/karute/customer-memory') as Record<string, jest.Mock>
const { getCustomerWithClient: getCustomer } = jest.requireMock('@/lib/customers/queries') as {
  getCustomerWithClient: jest.Mock
}

beforeEach(() => jest.clearAllMocks())

describe('memory mutations reject cross-tenant ids', () => {
  it('update: item belongs to another business → no write', async () => {
    mem.getMemoryItemCustomerId.mockResolvedValue('cust-in-biz-B')
    getCustomer.mockResolvedValue(null) // core returns nothing cross-tenant

    const res = await updateMemoryItemAction({ id: 'item-B', label: 'x' })

    expect(res).toEqual({ ok: false })
    expect(mem.updateMemoryItem).not.toHaveBeenCalled()
  })

  it('pin: core throws on a cross-tenant customer → no write', async () => {
    mem.getMemoryItemCustomerId.mockResolvedValue('cust-in-biz-B')
    getCustomer.mockRejectedValue(new Error('404'))

    const res = await toggleMemoryPinAction('item-B', true)

    expect(res).toEqual({ ok: false })
    expect(mem.setMemoryItemPinned).not.toHaveBeenCalled()
  })

  it('delete: unknown/absent item → no write', async () => {
    mem.getMemoryItemCustomerId.mockResolvedValue(null) // id doesn't exist

    const res = await deleteMemoryItemAction('ghost')

    expect(res).toEqual({ ok: false })
    expect(mem.softDeleteMemoryItem).not.toHaveBeenCalled()
  })

  it('add: customer belongs to another business → no write', async () => {
    getCustomer.mockResolvedValue(null)

    const res = await addMemoryItemAction({
      customerId: 'cust-in-biz-B',
      category: 'goal',
      label: 'x',
    })

    expect(res).toEqual({ ok: false })
    expect(mem.addStaffMemoryItem).not.toHaveBeenCalled()
  })
})

describe('memory mutations pass for same-tenant ids', () => {
  it('update: item in the caller business → write fires', async () => {
    mem.getMemoryItemCustomerId.mockResolvedValue('cust-in-biz-A')
    getCustomer.mockResolvedValue({ id: 'cust-in-biz-A', name: 'A' })

    const res = await updateMemoryItemAction({ id: 'item-A', label: 'updated' })

    expect(res).toEqual({ ok: true })
    expect(mem.updateMemoryItem).toHaveBeenCalledWith('item-A', {
      label: 'updated',
      detail: null,
    })
  })
})
