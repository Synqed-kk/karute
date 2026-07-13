/**
 * Coverage for saveKaruteRecord's staff attribution. The server NEVER trusts a
 * client-supplied staff id: it attributes the record to whoever RECORDED it —
 * the signed-in user, via getCurrentUserStaffId(). When you record a customer
 * booked under ANOTHER staff (covering, swaps, days off) the karte still saves
 * under YOU. The linked appointment's staff is only a FALLBACK for a signer with
 * no staff row; with neither, the save is rejected before reaching synqed-core.
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
// karute.ts now imports getLocale to prefix the post-create redirect.
jest.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))

let currentStaffId: string | null = null
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => currentStaffId),
}))

// Store resolution for karute writes (no appointment → active-store cookie).
// This suite isolates staff attribution, so the cookie lookup is stubbed out.
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  getDefaultStoreId: jest.fn(async () => null),
}))

// RBAC gate is neutralized here — these tests isolate staff attribution, not
// permissions. Dedicated capability tests live in rbac-server-enforcement.test.ts.
// Karute store default now resolves via resolveStoreScope (RBAC clamp). These
// suites don't exercise store scoping, so stub it to the all-stores lens.
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: null, viewAll: true, allowedStoreIds: null })),
}))

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

const karuteRecords = { create: jest.fn() }
const appointments = { get: jest.fn() }
// Save-gate consent check (src/actions/karute.ts) — current-version consent by
// default so this suite's staff-attribution assertions reach create() untouched.
const customers = {
  getConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords, appointments, customers })),
}))

import { saveKaruteRecord } from '@/actions/karute'

const baseInput = { customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [] }

beforeEach(() => {
  jest.clearAllMocks()
  currentStaffId = null
})

describe('saveKaruteRecord — staff attribution', () => {
  it('derives staff_id from the signed-in user', async () => {
    currentStaffId = 'me-staff'
    karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
    await saveKaruteRecord({ ...baseInput })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'me-staff' }),
    )
  })

  it('errors (and never calls synqed) when the user has no staff identity', async () => {
    currentStaffId = null
    const result = await saveKaruteRecord({ ...baseInput })
    expect(result).toEqual({ error: expect.stringMatching(/no staff identity/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('attributes to the RECORDER even when the booking belongs to another staff', async () => {
    currentStaffId = 'me-staff'
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'appt-staff', store_id: 'store-1' })
    karuteRecords.create.mockResolvedValue({ id: 'kr-2' })
    await saveKaruteRecord({ ...baseInput, appointmentId: 'ap-1' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'me-staff', appointment_id: 'ap-1', store_id: 'store-1' }),
    )
    // Recorder known → no need to look the appointment's staff up for THAT, but
    // it's still fetched once for store_id (the booking's store is the truth of
    // where the session happened).
    expect(appointments.get).toHaveBeenCalledTimes(1)
  })

  it("falls back to the appointment's staff only when the signer has no staff identity", async () => {
    currentStaffId = null
    appointments.get.mockResolvedValue({ id: 'ap-1', staff_id: 'appt-staff' })
    karuteRecords.create.mockResolvedValue({ id: 'kr-3' })
    await saveKaruteRecord({ ...baseInput, appointmentId: 'ap-1' })
    expect(appointments.get).toHaveBeenCalledWith('ap-1')
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'appt-staff', appointment_id: 'ap-1' }),
    )
  })

  it('rejects the save when neither the signer nor the appointment yields a staff id', async () => {
    currentStaffId = null
    appointments.get.mockRejectedValue(new Error('not found'))
    const result = await saveKaruteRecord({ ...baseInput, appointmentId: 'missing' })
    expect(result).toEqual({ error: expect.stringMatching(/no staff identity/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })
})
