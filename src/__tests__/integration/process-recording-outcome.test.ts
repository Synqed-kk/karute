/**
 * process-recording worker — the outcome-write leg (packet 22 B4). Pins:
 * payload.outcome present → the SAME best-effort outcome upsert the
 * interactive save uses (setKaruteOutcomeWithClient) is called with the new
 * record id + staff_id, but UNLIKE that call site a write failure THROWS —
 * failing the job so core requeues (the audio is deleted right after this
 * function returns, so there is no later chance to retry just the outcome).
 * Absent → never called.
 */

process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'

import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

const setKaruteOutcomeWithClient = jest.fn(async () => ({}) as { error?: string })
jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcomeWithClient: (...a: unknown[]) =>
    (setKaruteOutcomeWithClient as (...a: unknown[]) => unknown)(...a),
}))

jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

jest.mock('@/lib/ai/transcribe', () => ({
  speakerIdMode: () => 'off',
  loadStaffReferenceForStaff: jest.fn(async () => null),
  runTranscription: jest.fn(async () => ({
    transcript: 'hello',
    paragraphs: [],
    words: [],
    confidence: 1,
  })),
}))
jest.mock('@/lib/ai/karute-extract', () => ({
  runKaruteExtraction: jest.fn(async () => ({ result: { entries: [] } })),
}))
jest.mock('@/lib/ai/karute-summarize', () => ({
  runKaruteSummary: jest.fn(async () => ({ result: { summary: 'S' } })),
}))
jest.mock('@/lib/diarized', () => ({
  buildDiarizedTranscript: jest.fn(() => null),
  toSpeakerText: jest.fn(() => ''),
}))

const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: 'https://x/audio' }, error: null }))
const removeObj = jest.fn(async () => ({}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ createSignedUrl, remove: removeObj }) },
  }),
}))

const getConsent = jest.fn(async () => ({
  consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION },
}))
const orgSettingsGet = jest.fn(async () => ({ settings: {} }))
const customersGet = jest.fn(async () => ({ name: 'customer' }))
const getByRecordingSession = jest.fn(async () => {
  throw Object.assign(new Error('nf'), { status: 404 })
})
const karuteRecordsCreate = jest.fn(async () => ({ id: 'record-1' }))
const karuteRecordsUpdate = jest.fn(async () => ({ id: 'record-1' }))
const claim = jest.fn()
const complete = jest.fn(async () => ({}))
const fail = jest.fn(async () => ({}))

const fakeClient = {
  customers: { getConsent, get: customersGet },
  orgSettings: { get: orgSettingsGet },
  karuteRecords: {
    getByRecordingSession,
    create: karuteRecordsCreate,
    update: karuteRecordsUpdate,
  },
  recordingJobs: { claim, complete, fail },
}
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => fakeClient),
}))

import { processRecordingJobs } from '@/lib/jobs/process-recording'

const baseJob = {
  id: 'job-1',
  business_id: 'biz-1',
  recording_session_id: 'sess-1',
  status: 'RUNNING',
  attempts: 1,
  max_attempts: 3,
  last_error: null,
  karute_record_id: null,
  claimed_at: null,
  created_at: '',
  updated_at: '',
  payload: {
    customer_id: 'cust-1',
    staff_id: 'staff-1',
    audio_path: 'app_biz-1_x.webm',
  } as Record<string, unknown>,
}

beforeEach(() => {
  jest.clearAllMocks()
  getConsent.mockResolvedValue({ consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION } })
  orgSettingsGet.mockResolvedValue({ settings: {} })
  customersGet.mockResolvedValue({ name: 'customer' })
  getByRecordingSession.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
  karuteRecordsCreate.mockResolvedValue({ id: 'record-1' })
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/audio' }, error: null })
  removeObj.mockResolvedValue({})
  setKaruteOutcomeWithClient.mockResolvedValue({})
  complete.mockResolvedValue({})
  fail.mockResolvedValue({})
})

describe('process-recording worker — outcome write (packet 22 B4)', () => {
  it('payload.outcome present → outcome upsert called with the new record id + staff_id', async () => {
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, outcome: { status: 'success', isFirstVisit: true } },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(setKaruteOutcomeWithClient).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        karuteRecordId: 'record-1',
        customerId: 'cust-1',
        status: 'success',
        isFirstVisit: true,
        decidedBy: 'staff-1',
      }),
    )
    expect(complete).toHaveBeenCalledWith('job-1', 'record-1')
    expect(fail).not.toHaveBeenCalled()
  })

  it('payload.outcome absent → outcome upsert never called', async () => {
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(setKaruteOutcomeWithClient).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('job-1', 'record-1')
  })

  it('an outcome-write failure FAILS the job (throw, not swallowed) — retry converges', async () => {
    setKaruteOutcomeWithClient.mockResolvedValueOnce({ error: 'upstream down' })
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, outcome: { status: 'success' } },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(complete).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('outcome write failed'))
  })
})
