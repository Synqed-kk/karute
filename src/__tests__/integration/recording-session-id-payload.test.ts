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

import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

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

// Isolates the payload shape, not permissions (covered elsewhere).
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
  // The save upserts by recording session (a repeat save UPDATES the existing
  // record instead of letting core's dedupe silently return stale content).
  // Default: nothing saved yet → the create path.
  // Rejection carries status:404 — the upsert only treats a REAL not-found as
  // "no record yet"; any other lookup failure fails the save (retry-safe).
  getByRecordingSession: jest.fn(
    async (): Promise<{
      id: string
      transcript?: string
      entries?: Array<{ id: string; content: string; author?: string }>
    }> => {
      throw Object.assign(new Error('not found'), { status: 404 })
    },
  ),
}
const appointments = { get: jest.fn() }
// Save-gate consent check (src/actions/karute.ts) — current-version consent by
// default so this suite's payload/upsert assertions reach create() untouched.
const customers = {
  getConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
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
      // store_id joined the payload when #427 (store stamping) merged after
      // this test was written on a pre-#427 base — null here because the
      // suite mocks no active-store cookie and there's no appointment.
      store_id: null,
      // service + duration_minutes joined with the 7/29 booked-menu fill —
      // null here: no appointment and no duration on the input.
      service: null,
      duration_minutes: null,
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

describe('upsert by recording session — a retry must never lose staff edits', () => {
  it('UPDATES the existing record with the newest content instead of creating', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({ id: 'kr-existing' })
    const res = await saveKaruteRecordInline({
      ...baseInput,
      transcript: 't-edited',
      summary: 's-edited',
      recordingSessionId: 'rs-1',
    })
    expect(karuteRecords.create).not.toHaveBeenCalled()
    expect(karuteRecords.update).toHaveBeenCalledWith(
      'kr-existing',
      expect.objectContaining({ transcript: 't-edited', ai_summary: 's-edited' }),
    )
    expect(res).toEqual({ id: 'kr-existing' })
  })

  it('no recordingSessionId → straight create, no lookup', async () => {
    await saveKaruteRecordInline(baseInput)
    expect(karuteRecords.getByRecordingSession).not.toHaveBeenCalled()
    expect(karuteRecords.create).toHaveBeenCalledTimes(1)
  })

  it('a NON-404 lookup failure fails the save — never falls through to a stale create', async () => {
    karuteRecords.getByRecordingSession.mockRejectedValueOnce(
      Object.assign(new Error('gateway timeout'), { status: 504 }),
    )
    const res = await saveKaruteRecordInline({ ...baseInput, recordingSessionId: 'rs-1' })
    expect(karuteRecords.create).not.toHaveBeenCalled()
    expect(karuteRecords.update).not.toHaveBeenCalled()
    expect(res).toEqual({ error: expect.any(String) })
  })

  // entriesMode matrix (edit-layer Wave 1 fix round — explicit intent, not
  // inference): saveKaruteRecordInline (autosave) always passes
  // 'fill-if-empty'; saveKaruteRecord (staff intent via ReviewScreen) always
  // passes 'replace'. See createOrUpdateKaruteRecord's own header.
  it('fill-if-empty (autosave/inline): collision with an existing record that already has entries omits `entries` from the update — never re-replaces staff edits', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({
      id: 'kr-existing',
      entries: [{ id: 'e1', content: 'kept', author: 'HUMAN_EDITED' }],
    })
    await saveKaruteRecordInline({
      ...baseInput,
      recordingSessionId: 'rs-1',
    })
    const [, updatePayload] = karuteRecords.update.mock.calls[0] as [string, Record<string, unknown>]
    expect(updatePayload).not.toHaveProperty('entries')
    expect(updatePayload).toEqual(
      expect.objectContaining({ transcript: 't', ai_summary: 's' }),
    )
  })

  it('fill-if-empty (autosave/inline): collision with an existing record that has zero entries still sends entries', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({
      id: 'kr-existing',
      entries: [],
    })
    await saveKaruteRecordInline({
      ...baseInput,
      entries: [{ category: 'symptom', content: 'fresh', confidenceScore: 1 }],
      recordingSessionId: 'rs-1',
    })
    expect(karuteRecords.update).toHaveBeenCalledWith(
      'kr-existing',
      expect.objectContaining({
        entries: [expect.objectContaining({ content: 'fresh' })],
      }),
    )
  })

  it('replace (saveKaruteRecord — staff intent): collision with an existing record that already has entries STILL sends entries, is_manual preserved — the converge-on-staff-edits contract, e.g. a landed autosave the staff then edited in review', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({
      id: 'kr-existing',
      entries: [{ id: 'e1', content: 'old ai row', author: 'AI' }],
    })
    await saveKaruteRecord({
      ...baseInput,
      entries: [{ category: 'symptom', content: 'staff edited', confidenceScore: 1, isManual: true }],
      recordingSessionId: 'rs-1',
    }).catch(() => {})
    const [, updatePayload] = karuteRecords.update.mock.calls[0] as [string, Record<string, unknown>]
    expect(updatePayload).toHaveProperty('entries')
    expect(updatePayload.entries).toEqual([
      expect.objectContaining({ content: 'staff edited', is_manual: true }),
    ])
  })

  it('replace (saveKaruteRecord — staff intent): collision with an existing record that has zero entries still sends entries', async () => {
    karuteRecords.getByRecordingSession.mockResolvedValueOnce({
      id: 'kr-existing',
      entries: [],
    })
    await saveKaruteRecord({
      ...baseInput,
      entries: [{ category: 'symptom', content: 'fresh', confidenceScore: 1 }],
      recordingSessionId: 'rs-1',
    }).catch(() => {})
    expect(karuteRecords.update).toHaveBeenCalledWith(
      'kr-existing',
      expect.objectContaining({
        entries: [expect.objectContaining({ content: 'fresh' })],
      }),
    )
  })
})
