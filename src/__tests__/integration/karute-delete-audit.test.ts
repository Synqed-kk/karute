/**
 * karute.delete (PR B2 §1) — deleteKaruteRecord is the ONE writer: no facade
 * route exists for a karute delete (verified at source), so this is a
 * web-only door. Pins: ONE emit, success-only (no emit on a failed read or a
 * failed delete), detail carries the deleted record's own ids (read BEFORE
 * the delete — a deleted karute leaves no row of its own to read back from).
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

interface DeletedRecordShape {
  customer_id: string | null
  recording_session_id: string | null
  appointment_id: string | null
  staff_id: string
}
const karuteRecordsGet = jest.fn(
  async (): Promise<DeletedRecordShape> => ({
    customer_id: 'cust-1',
    recording_session_id: 'rec-1',
    appointment_id: 'appt-1',
    staff_id: 'staff-7',
  }),
)
const karuteRecordsDelete = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    karuteRecords: { get: karuteRecordsGet, delete: karuteRecordsDelete },
  })),
}))

import { deleteKaruteRecord } from '@/actions/karute'

beforeEach(() => {
  jest.clearAllMocks()
  karuteRecordsGet.mockResolvedValue({
    customer_id: 'cust-1',
    recording_session_id: 'rec-1',
    appointment_id: 'appt-1',
    staff_id: 'staff-7',
  })
  karuteRecordsDelete.mockResolvedValue({})
})

describe('karute.delete — deleteKaruteRecord emits exactly once, success-only', () => {
  it('reads the record BEFORE the delete and emits karute.delete with its ids', async () => {
    const result = await deleteKaruteRecord('kar-1')
    expect(result).toEqual({ success: true })
    expect(karuteRecordsGet).toHaveBeenCalledWith('kar-1')
    expect(karuteRecordsDelete).toHaveBeenCalledWith('kar-1')
    // Read must precede the delete — the delete could remove the only source
    // of the ids the audit row needs.
    expect(karuteRecordsGet.mock.invocationCallOrder[0]).toBeLessThan(
      karuteRecordsDelete.mock.invocationCallOrder[0],
    )
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.delete',
        actorId: 'auth-user-1',
        actorType: 'staff',
        businessId: 'biz-1',
        targetType: 'karute',
        targetId: 'kar-1',
        source: 'web',
        detail: {
          customer_id: 'cust-1',
          recording_session_id: 'rec-1',
          appointment_id: 'appt-1',
          staff_id: 'staff-7',
        },
      }),
    )
  })

  it('a record with no recording/appointment carries null, not undefined', async () => {
    karuteRecordsGet.mockResolvedValueOnce({
      customer_id: 'cust-2',
      recording_session_id: null,
      appointment_id: null,
      staff_id: 'staff-3',
    })
    await deleteKaruteRecord('kar-2')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          customer_id: 'cust-2',
          recording_session_id: null,
          appointment_id: null,
          staff_id: 'staff-3',
        },
      }),
    )
  })

  it('a FAILED read (record gone/unreadable) emits nothing, never deletes', async () => {
    karuteRecordsGet.mockRejectedValueOnce(new Error('not found'))
    const result = await deleteKaruteRecord('kar-3')
    expect(result).toEqual({ error: 'not found' })
    expect(karuteRecordsDelete).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('a FAILED delete emits nothing (success-only, no rows on failure paths)', async () => {
    karuteRecordsDelete.mockRejectedValueOnce(new Error('core down'))
    const result = await deleteKaruteRecord('kar-4')
    expect(result).toEqual({ error: 'core down' })
    expect(audit).not.toHaveBeenCalled()
  })
})
