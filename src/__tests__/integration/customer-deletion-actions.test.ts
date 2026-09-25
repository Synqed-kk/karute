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
import { getCurrentUserStaffId as getCurrentUserStaffIdImport } from '@/lib/staff'
import { revalidatePath as revalidatePathImport } from 'next/cache'

const requireCapability = requireCapabilityImport as jest.Mock
const getSynqedClient = getSynqedClientImport as jest.Mock
const audit = auditImport as jest.Mock
const getCurrentUserStaffId = getCurrentUserStaffIdImport as jest.Mock
const revalidatePath = revalidatePathImport as jest.Mock

const customers = { get: jest.fn(), update: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => undefined)
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  getSynqedClient.mockImplementation(async () => ({ customers }))
  customers.get.mockResolvedValue({ id: 'cus-1', deleted_at: null })
  customers.update.mockResolvedValue({})
})

// PHONEWIRE-2B blind round, finding 1 — a deliberate WEB behavior change,
// ruled by the lane lead. Before it, a stale-session records.delete holder
// could schedule or cancel an erasure and emitDeletionAudit filed the row with
// actorId:null: an unattributable record of the one act a customer can legally
// demand, while the new facade door 403s the very same caller. Both wrappers
// now carry grantCustomerConsent's #452 posture. The refusal is the union's own
// 'failed', so the existing deleteFailed/undoFailed toasts keep working.
describe.each([
  ['scheduleCustomerDeletion', scheduleCustomerDeletion],
  ['cancelCustomerDeletion', cancelCustomerDeletion],
])('%s — no staff identity fails closed', (_name, action) => {
  it('refuses before any write, and files NO audit row', async () => {
    // A cancel would otherwise reach its write: give it a live window.
    customers.get.mockResolvedValue({
      id: 'cus-1',
      deleted_at: new Date(Date.now() - 86_400_000).toISOString(),
    })
    getCurrentUserStaffId.mockResolvedValue(null)

    const res = await action('cus-1')

    expect(res).toEqual({ success: false, error: 'failed' })
    expect(customers.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('the capability gate still runs FIRST — both doors refuse in the same order', async () => {
    requireCapability.mockImplementation(async () => {
      throw new Error('forbidden')
    })
    getCurrentUserStaffId.mockResolvedValue(null)

    await action('cus-1')

    expect(getCurrentUserStaffId).not.toHaveBeenCalled()
  })
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

// ── Both doors file the same act at the same tier (severity rider) ─────────
// The web door sets severity inside emitDeletionAudit; the phone door reads
// it off FACADE_AUDIT_MAP, which logFacadeAudit forwards verbatim (pinned per
// live row, and hardcoded for this pair, in facade-audit.test.ts). This is
// the link between the two: the RUN web value against the map the facade
// emits from — so a flip on either side, or a dropped row severity, is red.
describe('web ↔ facade severity parity — the 30-day deletion pair', () => {
  // '@/lib/audit' is mocked to a bare { audit } above; the real map lives here.
  const { FACADE_AUDIT_MAP } = jest.requireActual<typeof import('@/lib/audit')>('@/lib/audit')

  it.each([
    ['customer.deletion.schedule', scheduleCustomerDeletion, null],
    ['customer.deletion.cancel', cancelCustomerDeletion, new Date(Date.now() - 2 * 86_400_000).toISOString()],
  ] as const)('%s files at the same severity as the web action', async (facadeKey, action, deletedAt) => {
    customers.get.mockResolvedValue({ id: 'cus-1', deleted_at: deletedAt })

    await action('cus-1')

    expect(audit).toHaveBeenCalledTimes(1)
    const webSeverity = audit.mock.calls[0][0].severity
    expect(webSeverity).toBeDefined()
    expect(FACADE_AUDIT_MAP[facadeKey].severity).toBe(webSeverity)
  })
})
