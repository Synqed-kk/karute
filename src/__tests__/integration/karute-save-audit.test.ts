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
  // PR B2 §3's appointmentId test is the first in this file to exercise the
  // appointment fetch (resolveKaruteStoreId) — a resolved default so it
  // doesn't need every OTHER test in this file to know about it too.
  appointments.get.mockResolvedValue({ staff_id: 'staff-1', store_id: null, title: null })
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

  // PR B2 §3: recording_session_id + appointment_id let the per-recording
  // thread page (PR D) join a karute back to its recording/appointment.
  it('detail carries recording_session_id + appointment_id when the save has them', async () => {
    await saveKaruteRecord({ ...baseInput, recordingSessionId: 'rs-fresh', appointmentId: 'appt-1' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          recording_session_id: 'rs-fresh',
          appointment_id: 'appt-1',
        }),
      }),
    )
  })

  it('detail carries null (never undefined) when the save has neither', async () => {
    await saveKaruteRecord({ ...baseInput })
    const [call] = audit.mock.calls[0] as [{ detail: Record<string, unknown> }]
    expect(call.detail).toHaveProperty('recording_session_id', null)
    expect(call.detail).toHaveProperty('appointment_id', null)
  })
})

describe('karute.save — update/retry path (recording session already saved)', () => {
  it('emits once with fresh:false and transcript_changed:true when the retry edited the transcript', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({ id: 'kar-x', transcript: 'old' } as never)
    await saveKaruteRecord({ ...baseInput, recordingSessionId: 'rs-1', transcript: 'edited' })
    expect(karuteRecords.update).toHaveBeenCalledTimes(1)
    expect(karuteRecords.create).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'karute.save',
        targetId: 'kar-x',
        detail: expect.objectContaining({
          fresh: false,
          transcript_changed: true,
          customer_id: 'cust-1',
        }),
      }),
    )
  })

  it('emits once with transcript_changed:false on an identical resend', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({ id: 'kar-x', transcript: 'old' } as never)
    await saveKaruteRecord({ ...baseInput, recordingSessionId: 'rs-1', transcript: 'old' })
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'kar-x',
        detail: expect.objectContaining({ fresh: false, transcript_changed: false }),
      }),
    )
  })

  // Fix round 2 (Greptile P1): the update keeps the EXISTING record's
  // store_id (CEILING F-7 in createOrUpdateKaruteRecord) — a payload store
  // that differs (staff switched active store between the partial save and
  // this retry) must not appear in the audit row for the persisted record.
  it('emits the EXISTING record store_id, not payload.store_id, when they differ', async () => {
    appointments.get.mockResolvedValue({ staff_id: 'staff-1', store_id: 'store-B', title: null })
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({
      id: 'kar-x',
      transcript: 'old',
      store_id: 'store-A',
    } as never)
    await saveKaruteRecord({
      ...baseInput,
      recordingSessionId: 'rs-1',
      appointmentId: 'appt-1',
    })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-A' }))
  })
})

describe('karute.save — a FAILED write emits nothing (pins emit-after-write)', () => {
  it('create rejection → zero emits, error shape returned', async () => {
    karuteRecords.create.mockRejectedValueOnce(new Error('core down'))
    const res = await saveKaruteRecord({ ...baseInput })
    expect(res).toHaveProperty('error')
    expect(audit).not.toHaveBeenCalled()
  })

  it('update rejection on the retry path → zero emits', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({ id: 'kar-x', transcript: 'old' } as never)
    karuteRecords.update.mockRejectedValueOnce(new Error('core down'))
    const res = await saveKaruteRecord({ ...baseInput, recordingSessionId: 'rs-1' })
    expect(res).toHaveProperty('error')
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('karute.save — fresh create emits the payload store', () => {
  it('emits payload.store_id when there is no existing record to converge on', async () => {
    appointments.get.mockResolvedValue({ staff_id: 'staff-1', store_id: 'store-B', title: null })
    await saveKaruteRecord({ ...baseInput, appointmentId: 'appt-1' })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-B' }))
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
