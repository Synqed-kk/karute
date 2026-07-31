/**
 * 30-day customer deletion — schedule / cancel actions (fix-plan P2-E).
 *
 * Contracts under test:
 *  - records.delete gates both actions (owner/manager/senior only).
 *  - Schedule sets deleted_at once — re-scheduling never restarts the clock.
 *  - Cancel nulls deleted_at inside the window, refuses after the deadline
 *    (the sweep may already be destroying records) and when not scheduled.
 *  - Every transition writes its privacy.* audit row; failures write none.
 */

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => undefined),
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(),
  newSynqedClient: jest.fn(),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  getStaffList: jest.fn(async () => []),
}))
// customers.ts pulls these in at module scope for other actions.
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async () => (k: string) => k),
}))

import { scheduleCustomerDeletion, cancelCustomerDeletion } from '@/actions/customers'
import { requireCapability as requireCapabilityImport } from '@/lib/auth/require-permission'
import { getSynqedClient as getSynqedClientImport } from '@/lib/synqed/client'
import { audit as auditImport } from '@/lib/audit'
import { revalidatePath as revalidatePathImport } from 'next/cache'

const requireCapability = requireCapabilityImport as jest.Mock
const getSynqedClient = getSynqedClientImport as jest.Mock
const audit = auditImport as jest.Mock
const revalidatePath = revalidatePathImport as jest.Mock

const customers = { get: jest.fn(), update: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => undefined)
  getSynqedClient.mockImplementation(async () => ({ customers }))
  customers.get.mockResolvedValue({ id: 'cus-1', deleted_at: null })
  customers.update.mockResolvedValue({})
})

describe('scheduleCustomerDeletion', () => {
  it('requires records.delete and stops before touching core', async () => {
    requireCapability.mockImplementation(async () => {
      throw new Error('forbidden')
    })
    const res = await scheduleCustomerDeletion('cus-1')
    expect(res).toEqual({ success: false, error: 'failed' })
    expect(customers.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('sets deleted_at, audits, and revalidates both customer surfaces', async () => {
    const res = await scheduleCustomerDeletion('cus-1')
    expect(res).toEqual({ success: true, id: 'cus-1' })
    expect(customers.update).toHaveBeenCalledWith(
      'cus-1',
      expect.objectContaining({ deleted_at: expect.any(String) }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'privacy.customer_delete_scheduled',
        severity: 'warning',
        targetId: 'cus-1',
        actorId: 'staff-1',
        businessId: 'biz-1',
      }),
    )
    expect(revalidatePath).toHaveBeenCalledWith('/customers')
    expect(revalidatePath).toHaveBeenCalledWith('/customers/cus-1')
  })

  it('never restarts a running clock: already-scheduled is rejected', async () => {
    customers.get.mockResolvedValue({ id: 'cus-1', deleted_at: '2026-07-10T00:00:00.000Z' })
    const res = await scheduleCustomerDeletion('cus-1')
    expect(res).toEqual({ success: false, error: 'already_scheduled' })
    expect(customers.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('cancelCustomerDeletion', () => {
  it('nulls deleted_at inside the window and audits the cancel', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()
    customers.get.mockResolvedValue({ id: 'cus-1', deleted_at: twoDaysAgo })
    const res = await cancelCustomerDeletion('cus-1')
    expect(res).toEqual({ success: true, id: 'cus-1' })
    expect(customers.update).toHaveBeenCalledWith(
      'cus-1',
      expect.objectContaining({ deleted_at: null }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'privacy.customer_delete_canceled',
        severity: 'notice',
        targetId: 'cus-1',
      }),
    )
  })

  it('refuses once the 30-day deadline has passed (deletion in progress)', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString()
    customers.get.mockResolvedValue({ id: 'cus-1', deleted_at: thirtyOneDaysAgo })
    const res = await cancelCustomerDeletion('cus-1')
    expect(res).toEqual({ success: false, error: 'window_expired' })
    expect(customers.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('refuses when nothing is scheduled', async () => {
    const res = await cancelCustomerDeletion('cus-1')
    expect(res).toEqual({ success: false, error: 'not_scheduled' })
    expect(customers.update).not.toHaveBeenCalled()
  })
})
