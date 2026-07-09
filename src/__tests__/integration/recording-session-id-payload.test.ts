/**
 * Pins the recording_session_id wiring through both save actions
 * (src/actions/karute.ts) — the field synqed-core's idempotent-save dedupe
 * (unique FK on karute_records.recording_session_id, PR #38) keys on.
 *
 * Mirrors save-flow-staff-attribution.test.ts's mocking pattern (real
 * @/lib/staff, mocked Supabase + synqed-core clients), scoped down to just
 * the recording_session_id behavior:
 *   - present on input → forwarded verbatim to synqed.karuteRecords.create
 *   - absent on input → forwarded as null (not omitted) — the rest of the
 *     payload is byte-for-byte what it was before this field existed.
 */

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
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  })),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: serviceFromMock })),
}))

// Isolates the payload shape, not permissions (covered elsewhere).
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

const karuteRecords = { create: jest.fn() }
const appointments = { get: jest.fn() }

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({ karuteRecords, appointments })),
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
})

const baseInput = {
  customerId: 'cust-1',
  transcript: 't',
  summary: 's',
  entries: [],
}

describe('saveKaruteRecordInline — recording_session_id payload', () => {
  it('forwards recording_session_id verbatim when the input has it', async () => {
    await saveKaruteRecordInline({ ...baseInput, recordingSessionId: 'rs-1' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ recording_session_id: 'rs-1' }),
    )
  })

  it('sends recording_session_id: null (not omitted) when absent — rest of payload unchanged', async () => {
    await saveKaruteRecordInline(baseInput)
    expect(karuteRecords.create).toHaveBeenCalledWith({
      customer_id: 'cust-1',
      staff_id: 'user-a',
      appointment_id: null,
      recording_session_id: null,
      transcript: 't',
      ai_summary: 's',
      entries: [],
    })
  })

  it('sends null when recordingSessionId is explicitly null', async () => {
    await saveKaruteRecordInline({ ...baseInput, recordingSessionId: null })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ recording_session_id: null }),
    )
  })
})

describe('saveKaruteRecord — recording_session_id payload', () => {
  it('forwards recording_session_id verbatim when the input has it', async () => {
    await saveKaruteRecord({ ...baseInput, recordingSessionId: 'rs-2' }).catch(() => {})
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ recording_session_id: 'rs-2' }),
    )
  })

  it('sends recording_session_id: null when absent', async () => {
    await saveKaruteRecord(baseInput).catch(() => {})
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ recording_session_id: null }),
    )
  })
})
