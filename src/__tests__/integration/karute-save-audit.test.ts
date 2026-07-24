/**
 * karute.save choke point (packet 30 §3): createOrUpdateKaruteRecord is the
 * ONE function every WEB save pathway funnels through — saveKaruteRecord and
 * saveKaruteRecordInline both land here. Pins exactly ONE audit emit per
 * save, with actor/business resolved via resolveWebAuditContext() and
 * detail.customer_id present (the viewer-labeling join, packet 30 §4). The
 * facade route's own emit is pinned in app-api-karute-save.test.ts; the
 * process-recording job pipeline's pre-existing, separate emit is pinned in
 * process-recording-outcome.test.ts — neither is touched by this file.
 */
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

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
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  getDefaultStoreId: jest.fn(async () => null),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: null, viewAll: true, allowedStoreIds: null })),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))
jest.mock('@/lib/karute/memory-ingest', () => ({ ingestSessionMemory: jest.fn(async () => {}) }))
jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcome: jest.fn(async () => {}),
  setKaruteOutcomeWithClient: jest.fn(async () => ({})),
}))

const audit = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => audit(...(a as [])) }))

const karuteRecords = {
  create: jest.fn(async () => ({ id: 'kar-1' })),
  getByRecordingSession: jest.fn(async () => {
    throw Object.assign(new Error('nf'), { status: 404 })
  }),
  update: jest.fn(async () => ({ id: 'kar-existing', transcript: 'old' })),
}
const appointments = { get: jest.fn() }
const customers = {
  getConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords, appointments, customers })),
}))

import { saveKaruteRecord, saveKaruteRecordInline } from '@/actions/karute'

const baseInput = { customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [] }

beforeEach(() => {
  jest.clearAllMocks()
  karuteRecords.create.mockResolvedValue({ id: 'kar-1' })
  karuteRecords.getByRecordingSession.mockRejectedValue(
    Object.assign(new Error('nf'), { status: 404 }),
  )
  customers.getConsent.mockResolvedValue({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })
})

describe('karute.save — web saveKaruteRecord emits exactly once', () => {
  it('emits karute.save with actor/business/detail after the write settles', async () => {
    await saveKaruteRecord({ ...baseInput })
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.save',
        actorId: 'auth-user-1',
        actorType: 'staff',
        businessId: 'biz-1',
        targetType: 'karute',
        targetId: 'kar-1',
        source: 'web',
        detail: expect.objectContaining({
          fresh: true,
          transcript_changed: true,
          customer_id: 'cust-1',
        }),
      }),
    )
  })
})

describe('karute.save — web saveKaruteRecordInline emits exactly once', () => {
  it('emits karute.save the same shape as saveKaruteRecord', async () => {
    const res = await saveKaruteRecordInline({ ...baseInput })
    expect(res).toEqual({ id: 'kar-1' })
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'karute.save',
        targetId: 'kar-1',
        source: 'web',
        detail: expect.objectContaining({ customer_id: 'cust-1' }),
      }),
    )
  })
})
