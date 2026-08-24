/**
 * Post-migration core flow: exercises the server actions that now delegate
 * to @synqed-kk/client. Mocks the client so the test runs without a live
 * synqed-core; contract testing lives in synqed-core/tests/*.
 *
 * Covers: createCustomer, saveKaruteRecord (atomic create + entries),
 * deleteKaruteRecord. (Customer deletion moved to the 30-day schedule/cancel
 * flow — see customer-deletion-actions.test.ts.)
 */

import { TEST_STAFF_PROFILE_ID } from './helpers/server-action-mocks'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

// --- Next.js context mocks (must be top-level so jest.mock is hoisted) ---
// unstable_cache joined this mock in PR-2a: actions/karute now imports
// lib/customers/list-all (the 日付チャンク読み込み window action reuses the
// page's customer fan-out), and list-all builds its cached reader at MODULE
// scope — so the import alone needs the real signature present.
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
// next-intl/server ships ESM that jest can't parse when customers.ts imports
// getTranslations for real. The translator just echoes keys here.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
}))

// --- staff lib mock — derives active staff from the signed-in user via
//     getCurrentUserStaffId (cookie-free). Tests pin it to TEST_STAFF_PROFILE_ID.
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getCurrentUserStaffId: jest.fn(async () => TEST_STAFF_PROFILE_ID),
}))

// Store resolution for karute writes (no appointment → active-store cookie).
// This suite isolates the synqed-client delegation, not store scoping.
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  getDefaultStoreId: jest.fn(async () => null),
}))

// RBAC gate neutralized — this flow test isolates the synqed-client delegation,
// not permissions. Capability enforcement is covered in
// rbac-server-enforcement.test.ts.
// Karute store default now resolves via resolveStoreScope (RBAC clamp). These
// suites don't exercise store scoping, so stub it to the all-stores lens.
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: null, viewAll: true, allowedStoreIds: null })),
}))

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

// --- @synqed-kk/client mock ---
// Track every call so we can assert shape + args.
const customers = {
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
  checkDuplicate: jest.fn(),
  // Save-gate consent check (src/actions/karute.ts) — current-version consent
  // by default so this suite's saveKaruteRecord assertions reach create().
  getConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
}
const appointments = {
  list: jest.fn(),
  delete: jest.fn(),
}
const karuteRecords = {
  create: jest.fn(),
  delete: jest.fn(),
  addEntry: jest.fn(),
  deleteEntry: jest.fn(),
  list: jest.fn(),
}

jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    customers,
    appointments,
    karuteRecords,
  })),
}))

import { createCustomer } from '@/actions/customers'
import { saveKaruteRecord, deleteKaruteRecord } from '@/actions/karute'
import { redirect } from 'next/navigation'

describe('Migrated core flow — customers + karute + entries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    customers.checkDuplicate.mockResolvedValue({ exists: false })
  })

  it('createCustomer calls customers.create with the form payload', async () => {
    customers.create.mockResolvedValue({ id: 'cust-1', name: 'テスト太郎' })

    const result = await createCustomer({
      name: 'テスト太郎',
      furigana: 'テストタロウ',
      phone: '',
      email: '',
    })

    expect(result).toEqual({ success: true, id: 'cust-1' })
    expect(customers.create).toHaveBeenCalledWith({
      name: 'テスト太郎',
      furigana: 'テストタロウ',
      phone: null,
      email: null,
      assigned_staff_id: null,
      // Deep-data fields the 0.12.0 client's CreateCustomerInput carries —
      // createCustomer sends them as null when the form omits them.
      date_of_birth: null,
      gender: null,
      occupation: null,
      member_number: null,
    })
  })

  it('saveKaruteRecord does a single atomic create with entries inlined', async () => {
    karuteRecords.create.mockResolvedValue({ id: 'karute-1' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 'session transcript',
      summary: 'session summary',
      entries: [
        { category: 'symptom', content: 'itchy scalp', sourceQuote: 'quote', confidenceScore: 0.9 },
        { category: 'treatment', content: 'shampoo', confidenceScore: 0.8 },
      ],
    })

    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
    const arg = karuteRecords.create.mock.calls[0][0]
    expect(arg.customer_id).toBe('cust-1')
    expect(arg.staff_id).toBe(TEST_STAFF_PROFILE_ID)
    expect(arg.ai_summary).toBe('session summary')
    expect(arg.transcript).toBe('session transcript')
    expect(arg.entries).toHaveLength(2)
    expect(arg.entries[0]).toMatchObject({
      category: 'SYMPTOM',
      content: 'itchy scalp',
      original_quote: 'quote',
      confidence: 0.9,
      is_manual: false,
    })
    expect(arg.entries[1]).toMatchObject({
      category: 'TREATMENT',
      content: 'shampoo',
      confidence: 0.8,
      is_manual: false,
    })
    expect(redirect).toHaveBeenCalledWith('/en/karute/karute-1')
  })

  it('deleteKaruteRecord delegates to client.karuteRecords.delete (server cascades)', async () => {
    karuteRecords.delete.mockResolvedValue(undefined)

    const result = await deleteKaruteRecord('karute-1')

    expect(result).toEqual({ success: true })
    expect(karuteRecords.delete).toHaveBeenCalledWith('karute-1')
  })

  it('saveKaruteRecord attributes to the signed-in RECORDER, not the booking staff', async () => {
    // The customer is booked under another staff ('appt-staff-xyz'), but the
    // record must save under the RECORDER (TEST_STAFF_PROFILE_ID) — covering /
    // staff swaps. The staff-attribution fallback never fetches the appointment
    // when the recorder is known, but it's still fetched ONCE for store_id (the
    // booking's store is the truth of where the session happened).
    const apptClient = { get: jest.fn().mockResolvedValue({ staff_id: 'appt-staff-xyz', store_id: 'store-9' }) }
    const { getSynqedClient } = await import('@/lib/synqed/client')
    ;(getSynqedClient as jest.Mock).mockResolvedValueOnce({
      customers,
      appointments: apptClient,
      karuteRecords,
    })
    karuteRecords.create.mockResolvedValue({ id: 'karute-2' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 't',
      summary: 's',
      entries: [],
      appointmentId: 'appt-1',
    })

    const arg = karuteRecords.create.mock.calls[karuteRecords.create.mock.calls.length - 1][0]
    expect(arg.staff_id).toBe(TEST_STAFF_PROFILE_ID) // the recorder, NOT appt-staff-xyz
    expect(arg.appointment_id).toBe('appt-1') // still linked to the booking for context
    expect(arg.store_id).toBe('store-9') // the booking's store
    expect(apptClient.get).toHaveBeenCalledTimes(1) // fetched once, for store_id only
  })

  it('saveKaruteRecord falls back to the appointment staff when the recorder has no staff identity', async () => {
    const { getCurrentUserStaffId } = await import('@/lib/staff')
    ;(getCurrentUserStaffId as jest.Mock).mockResolvedValueOnce(null)
    const apptClient = { get: jest.fn().mockResolvedValue({ staff_id: 'appt-staff-xyz' }) }
    const { getSynqedClient } = await import('@/lib/synqed/client')
    ;(getSynqedClient as jest.Mock).mockResolvedValueOnce({
      customers,
      appointments: apptClient,
      karuteRecords,
    })
    karuteRecords.create.mockResolvedValue({ id: 'karute-3' })

    await saveKaruteRecord({
      customerId: 'cust-1',
      transcript: 't',
      summary: 's',
      entries: [],
      appointmentId: 'appt-1',
    })

    expect(apptClient.get).toHaveBeenCalledWith('appt-1')
    const arg = karuteRecords.create.mock.calls[karuteRecords.create.mock.calls.length - 1][0]
    expect(arg.staff_id).toBe('appt-staff-xyz')
  })
})
