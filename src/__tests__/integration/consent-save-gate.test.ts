/**
 * Server-side recording-consent gate on both karute save actions
 * (src/actions/karute.ts). A record must never persist for a customer whose
 * recording consent isn't CURRENT (@/lib/consent's isConsentCurrent) — no
 * consent row, or a consent granted under a stale policy_version, both reject
 * the save before synqed.karuteRecords.create() is ever reached.
 *
 * Mirrors recording-session-id-payload.test.ts's harness (real @/lib/staff,
 * mocked Supabase + synqed-core clients), scoped to just the consent gate.
 */

import { RECORDING_CONSENT_POLICY_VERSION, CONSENT_REQUIRED_ERROR } from '@/lib/consent'

jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return {
    ...actual,
    cache: (fn: (...a: unknown[]) => unknown) => fn,
  }
})

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: jest.fn(),
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))

delete process.env.SUPABASE_JWT_SECRET
process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const scenario = {
  authUser: { id: 'user-a' } as { id: string } | null,
  businessProfile: { customer_id: 'biz-1' } as { customer_id: string } | null,
  staffProfiles: [
    { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null as string | null },
  ],
}

const serviceFromMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: scenario.authUser }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null })),
    },
  })),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: serviceFromMock })),
}))

// Isolates the consent gate, not permissions (covered elsewhere).
// Karute store default now resolves via resolveStoreScope (RBAC clamp). These
// suites don't exercise store scoping, so stub it to the all-stores lens.
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: null, viewAll: true, allowedStoreIds: null })),
}))

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

const karuteRecords = {
  create: jest.fn(),
  update: jest.fn(),
  // No recordingSessionId in any case below, so this is never reached — kept
  // for harness fidelity with recording-session-id-payload.test.ts.
  getByRecordingSession: jest.fn(async (): Promise<{ id: string; transcript?: string }> => {
    throw Object.assign(new Error('not found'), { status: 404 })
  }),
}
const appointments = { get: jest.fn() }
// The gate under test. Return type widened past the default value's inferred
// shape so individual cases can resolve `consent: null` or a bare
// { policy_version } — the only fields isConsentCurrent actually reads.
const customers = {
  getConsent: jest.fn(
    async (): Promise<{ consent: { policy_version?: string | null; granted_at?: string } | null }> => ({
      consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
    }),
  ),
}

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({ karuteRecords, appointments, customers })),
}))

import { saveKaruteRecord, saveKaruteRecordInline } from '@/actions/karute'

beforeEach(() => {
  jest.clearAllMocks()
  scenario.authUser = { id: 'user-a' }
  scenario.businessProfile = { customer_id: 'biz-1' }
  scenario.staffProfiles = [
    { id: 'user-a', full_name: 'Ada', customer_id: 'biz-1', pin_hash: null },
  ]

  serviceFromMock.mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: scenario.staffProfiles, error: null }),
    single: jest.fn().mockResolvedValue({ data: scenario.businessProfile, error: null }),
  }))

  karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
  karuteRecords.update.mockResolvedValue({ id: 'kr-1' })
  karuteRecords.getByRecordingSession.mockRejectedValue(
    Object.assign(new Error('not found'), { status: 404 }),
  )
  // Current-version consent by default — case (c) relies on this untouched;
  // cases (a)/(b)/(d) override it with mockResolvedValueOnce.
  customers.getConsent.mockResolvedValue({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })
})

const baseInput = {
  customerId: 'cust-1',
  transcript: 't',
  summary: 's',
  entries: [],
}

describe('saveKaruteRecord — recording-consent gate', () => {
  it('(a) rejects when the customer has no consent row', async () => {
    customers.getConsent.mockResolvedValueOnce({ consent: null })

    const result = await saveKaruteRecord({ ...baseInput })

    expect(result).toEqual({ error: CONSENT_REQUIRED_ERROR })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('(b) rejects when the consent is under a stale policy version', async () => {
    customers.getConsent.mockResolvedValueOnce({ consent: { policy_version: 'v0-old' } })

    const result = await saveKaruteRecord({ ...baseInput })

    expect(result).toEqual({ error: CONSENT_REQUIRED_ERROR })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })

  it('(c) proceeds when the consent is current', async () => {
    await saveKaruteRecord({ ...baseInput }).catch(() => {})

    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
  })
})

describe('saveKaruteRecordInline — recording-consent gate', () => {
  it('(d) rejects when the customer has no consent row', async () => {
    customers.getConsent.mockResolvedValueOnce({ consent: null })

    const result = await saveKaruteRecordInline({ ...baseInput })

    expect(result).toEqual({ error: CONSENT_REQUIRED_ERROR })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })
})
