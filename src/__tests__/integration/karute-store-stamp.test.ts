/**
 * Coverage for store_id resolution on karute-record writes.
 *
 * synqed-core PR #18 added store_id to karute_records and store-filtered list
 * reads (src/lib/karute/synqed-records.ts — "Core honors store_id"), but every
 * karuteRecords.create() call site sent none — every new record was
 * store-less in a multi-store business. Resolution order:
 *   1. appointmentId present → the BOOKING's store (the truth of where the
 *      session happened) — fetched via synqed.appointments.get(), .catch(null)
 *   2. no appointmentId → getDefaultStoreId (active-store cookie, else the
 *      primary store — never mint a NULL-store record for a viewer who just
 *      hasn't touched the switcher)
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
jest.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))

jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'me-staff'),
}))

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

const getDefaultStoreIdMock = jest.fn()
jest.mock('@/actions/stores', () => ({
  getDefaultStoreId: (...args: unknown[]) => getDefaultStoreIdMock(...args),
}))

const karuteRecords = { create: jest.fn() }
const appointments = { get: jest.fn() }
// Save-gate consent check (src/actions/karute.ts) — current-version consent by
// default so this suite's store_id assertions reach create() untouched.
const customers = {
  getConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords, appointments, customers })),
}))

import { saveKaruteRecordInline, saveKaruteRecord, createManualKaruteRecord } from '@/actions/karute'

const baseInput = { customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [] }

beforeEach(() => {
  jest.clearAllMocks()
  karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
})

describe('saveKaruteRecordInline — store_id resolution', () => {
  it("(a) with appointmentId: stamps the BOOKING's store_id", async () => {
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'other-staff', store_id: 'store-A' })

    await saveKaruteRecordInline({ ...baseInput, appointmentId: 'ap-1' })

    expect(appointments.get).toHaveBeenCalledWith('ap-1')
    expect(getDefaultStoreIdMock).not.toHaveBeenCalled()
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: 'ap-1', store_id: 'store-A' }),
    )
  })

  it('(b) without appointmentId: stamps the default store (cookie, else primary)', async () => {
    getDefaultStoreIdMock.mockResolvedValue('store-B')

    await saveKaruteRecordInline({ ...baseInput })

    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: null, store_id: 'store-B' }),
    )
  })

  it('(c) without appointmentId and no default store (business has no stores): null', async () => {
    getDefaultStoreIdMock.mockResolvedValue(null)

    await saveKaruteRecordInline({ ...baseInput })

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: null }),
    )
  })

  it('(d) appointment fetch failure: store_id is null (no secondary default-store fallback)', async () => {
    appointments.get.mockRejectedValue(new Error('not found'))
    getDefaultStoreIdMock.mockResolvedValue('store-B')

    await saveKaruteRecordInline({ ...baseInput, appointmentId: 'missing' })

    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: 'missing', store_id: null }),
    )
    // The booking's store is the only source of truth for an appointment-linked
    // save — a failed lookup means "unknown", not "assume the viewer's store".
    expect(getDefaultStoreIdMock).not.toHaveBeenCalled()
  })
})

describe('saveKaruteRecord — store_id resolution reuses the staff-fallback appointment fetch', () => {
  it('fetches the appointment only ONCE when the recorder has no staff identity', async () => {
    const { getCurrentUserStaffId } = await import('@/lib/staff')
    ;(getCurrentUserStaffId as jest.Mock).mockResolvedValueOnce(null)
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'appt-staff', store_id: 'store-C' })

    await saveKaruteRecord({ ...baseInput, appointmentId: 'ap-1' }).catch(() => {})

    expect(appointments.get).toHaveBeenCalledTimes(1)
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'appt-staff', store_id: 'store-C' }),
    )
  })
})

describe('createManualKaruteRecord — store_id resolution', () => {
  it('has no appointment concept: always falls back to the default store', async () => {
    getDefaultStoreIdMock.mockResolvedValue('store-D')

    await createManualKaruteRecord({
      customerId: 'cust-1',
      staffId: 'me-staff',
      sessionDate: '2026-07-01',
      durationMinutes: 60,
      service: 'cut',
    }).catch(() => {})

    expect(appointments.get).not.toHaveBeenCalled()
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-D' }),
    )
  })
})
