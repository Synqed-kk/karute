/**
 * karute.manual_create — the WEB "+ 新規カルテ" door's own emit (PR B2 §2).
 * Until this PR the web wrapper createManualKaruteRecord was genuinely
 * untracked (only the facade twin auto-emitted via
 * FACADE_AUDIT_MAP['karute.manualCreate'] — pinned separately in
 * app-api-karute-manual-create.test.ts). Pins: web = exactly ONE emit,
 * never inside the shared body (createManualKaruteRecordWithClient stays
 * audit-free — a shared-body emit would double-write on the phone, which
 * calls that same body through the facade route).
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

const karuteRecordsCreate = jest.fn(async () => ({ id: 'kar-1' }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords: { create: karuteRecordsCreate } })),
}))

import { createManualKaruteRecord } from '@/actions/karute'

const baseInput = {
  customerId: 'cust-1',
  staffId: 'staff-1',
  sessionDate: '2026-09-01',
  durationMinutes: 60,
  service: 'カット',
}

beforeEach(() => {
  jest.clearAllMocks()
  karuteRecordsCreate.mockResolvedValue({ id: 'kar-1' })
})

describe('karute.manual_create — web createManualKaruteRecord emits exactly once', () => {
  it('emits karute.manual_create with actor/business/detail after the write settles', async () => {
    await createManualKaruteRecord({ ...baseInput }).catch(() => {}) // redirect() throws NEXT_REDIRECT on success
    expect(karuteRecordsCreate).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.manual_create',
        actorId: 'auth-user-1',
        actorType: 'staff',
        businessId: 'biz-1',
        targetType: 'karute',
        targetId: 'kar-1',
        source: 'web',
        detail: {
          customer_id: 'cust-1',
          staff_id: 'staff-1',
          appointment_id: null,
        },
      }),
    )
  })

  // Manual creation has no linked appointment (resolveKaruteStoreId(synqed,
  // null)) — appointment_id is always null, never undefined/omitted.
  it('appointment_id is always null, never omitted — manual creation has no linked appointment', async () => {
    await createManualKaruteRecord({ ...baseInput }).catch(() => {})
    const [call] = audit.mock.calls[0] as [{ detail: Record<string, unknown> }]
    expect(call.detail).toHaveProperty('appointment_id', null)
  })

  it('a FAILED write (records.write denied) emits nothing', async () => {
    const { requireCapability } = await import('@/lib/auth/require-permission')
    ;(requireCapability as jest.Mock).mockRejectedValueOnce(new Error('You do not have permission to perform this action.'))
    const result = await createManualKaruteRecord({ ...baseInput })
    expect(result).toEqual({ error: 'You do not have permission to perform this action.' })
    expect(audit).not.toHaveBeenCalled()
  })

  it('a FAILED core create emits nothing', async () => {
    karuteRecordsCreate.mockRejectedValueOnce(new Error('core down'))
    const result = await createManualKaruteRecord({ ...baseInput })
    expect(result).toEqual({ error: 'core down' })
    expect(audit).not.toHaveBeenCalled()
  })
})
