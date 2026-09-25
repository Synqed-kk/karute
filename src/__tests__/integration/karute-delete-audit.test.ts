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
// getTranslations reads the REAL ja dictionary (Round 3 leg 7: a typed core
// failure answers common.somethingWentWrong through coreFailureLine).
jest.mock('next-intl/server', () => {
  const ja = jest.requireActual<Record<string, Record<string, unknown>>>('../../../messages/ja.json')
  return {
    getLocale: async () => 'ja',
    getTranslations: async (ns: string) => (key: string) => ja[ns]?.[key],
  }
})
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  getDefaultStoreId: jest.fn(async () => null),
}))
// Only the RESOLVER is mocked; the lock's predicate lives in the pure
// src/lib/auth/store-lock.ts and runs for real here (⚖ 9/16).
// ⚖ FRESH-EYES-P1B F2 — the scope is now DRIVEN, not fixed. It used to be a
// hardcoded viewAll, so this door's whole store-lock branch was never exercised
// and its refusal row could be deleted in silence (mutant M8 survived the full
// suite). The default stays viewAll, so every case below is unchanged.
const storeScope = {
  current: { storeId: null as string | null, viewAll: true, allowedStoreIds: null as string[] | null, degraded: false },
}
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => storeScope.current),
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
  store_id: string | null
}
const karuteRecordsGet = jest.fn(
  async (): Promise<DeletedRecordShape> => ({
    customer_id: 'cust-1',
    recording_session_id: 'rec-1',
    appointment_id: 'appt-1',
    staff_id: 'staff-7',
    store_id: 'store-1',
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
    store_id: 'store-1',
  })
  karuteRecordsDelete.mockResolvedValue({})
  storeScope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
})

describe('karute.delete — deleteKaruteRecord emits exactly once, success-only', () => {
  it('reads the record BEFORE the delete and emits karute.delete with its ids', async () => {
    const result = await deleteKaruteRecord('kar-1')
    expect(result).toEqual({ success: true })
    // F5 — include_entries: false: a metadata-only read, per the repo's
    // convention (src/actions/audit-log.ts:437).
    expect(karuteRecordsGet).toHaveBeenCalledWith('kar-1', { include_entries: false })
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
        // F2 — a deleted clinical record is a 警告 row.
        severity: 'warning',
        // F3 — the store the deleted record was in.
        storeId: 'store-1',
        detail: {
          customer_id: 'cust-1',
          recording_session_id: 'rec-1',
          appointment_id: 'appt-1',
          staff_id: 'staff-7',
        },
      }),
    )
  })

  it('a record with no recording/appointment/store carries null/undefined, not undefined ids', async () => {
    karuteRecordsGet.mockResolvedValueOnce({
      customer_id: 'cust-2',
      recording_session_id: null,
      appointment_id: null,
      staff_id: 'staff-3',
      store_id: null,
    })
    await deleteKaruteRecord('kar-2')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: undefined,
        detail: {
          customer_id: 'cust-2',
          recording_session_id: null,
          appointment_id: null,
          staff_id: 'staff-3',
        },
      }),
    )
  })

  it('F1 — a record whose ids come back missing (not explicit null) still carries null, never undefined', async () => {
    karuteRecordsGet.mockResolvedValueOnce({} as DeletedRecordShape)
    await deleteKaruteRecord('kar-5')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          customer_id: null,
          recording_session_id: null,
          appointment_id: null,
          staff_id: null,
        },
      }),
    )
  })

  it('a FAILED read (record gone/unreadable) emits nothing, never deletes', async () => {
    karuteRecordsGet.mockRejectedValueOnce(new Error('not found'))
    const result = await deleteKaruteRecord('kar-3')
    // The proof-read moved onto readKaruteMetaRaw (store-locks P1) so a
    // missing id and an out-of-store refusal read IDENTICALLY here. A
    // status-less throw is classified as an upstream failure, not a 404 —
    // deliberately, and core's raw message no longer reaches the client.
    // Round 3 leg 7 (D-S27-8): a TYPED core failure anywhere in the action's
    // catch answers the failure line, never the internal English sentence.
    expect(result).toEqual({ error: 'エラーが発生しました。' })
    expect(karuteRecordsDelete).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  // ⚖ FRESH-EYES-P1B F2 — THE STORE-LOCK BRANCH OF THIS DOOR, pinned at last.
  // The refusal row is what PR B ships; on this door nothing enforced it.
  it('a clamped actor + another store karute → refused, nothing deleted, ONE refusal row', async () => {
    storeScope.current = {
      storeId: 'store-daikanyama',
      viewAll: false,
      allowedStoreIds: ['store-daikanyama'],
      degraded: false,
    }
    karuteRecordsGet.mockResolvedValueOnce({
      customer_id: 'cus-1',
      recording_session_id: null,
      appointment_id: null,
      staff_id: 'staff-7',
      store_id: 'store-ginza',
    })

    // Byte-identical to a missing id — no existence oracle (the case below
    // proves the other side of that equality).
    expect(await deleteKaruteRecord('kar-1')).toEqual({ error: 'karute not found in this business' })
    expect(karuteRecordsDelete).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit.mock.calls[0][0]).toMatchObject({
      category: 'karute',
      action: 'karute.store_write_refused',
      severity: 'warning',
      targetType: 'karute',
      targetId: 'kar-1',
      detail: expect.objectContaining({
        door: 'karute.delete',
        record_store_id: 'store-ginza',
        code: 'not_found',
      }),
    })
  })

  it('a clamped actor deleting their OWN store karute still emits karute.delete, not a refusal', async () => {
    storeScope.current = {
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
      degraded: false,
    }
    karuteRecordsGet.mockResolvedValueOnce({
      customer_id: 'cus-1',
      recording_session_id: null,
      appointment_id: null,
      staff_id: 'staff-7',
      store_id: 'store-ginza',
    })

    expect(await deleteKaruteRecord('kar-1')).toEqual({ success: true })
    expect(karuteRecordsDelete).toHaveBeenCalledWith('kar-1')
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'karute.delete' })
  })

  it('a 404 read is the SAME answer the store lock gives — no existence oracle', async () => {
    karuteRecordsGet.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }))
    expect(await deleteKaruteRecord('kar-missing')).toEqual({
      error: 'karute not found in this business',
    })
    expect(karuteRecordsDelete).not.toHaveBeenCalled()
  })

  it('a FAILED delete emits nothing (success-only, no rows on failure paths)', async () => {
    karuteRecordsDelete.mockRejectedValueOnce(new Error('core down'))
    const result = await deleteKaruteRecord('kar-4')
    expect(result).toEqual({ error: 'core down' })
    expect(audit).not.toHaveBeenCalled()
  })
})
