/**
 * Layer A subject 2 (PACKET-MIC-SILENCE-LAYER-A-2026-09-11.md): the worker's
 * pre-spend memory check — a re-arm of an audio object that already came back
 * silent skips the paid transcription call and fails immediately with the
 * literal EMPTY_TRANSCRIPT, so the owner's row keeps reason empty_transcript.
 * A retake (different audio_path), a different failure reason, or the memory
 * read itself failing must all fall through to the paid call exactly as today.
 *
 * Same mocking idiom as process-recording-transcribe-failed.test.ts.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'

import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcomeWithClient: jest.fn(async () => ({})),
  REVISIT_NOT_ELIGIBLE: 'revisit_not_eligible',
  REVISIT_CHECK_UNAVAILABLE: 'revisit_check_unavailable',
}))

const audit = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => audit(...(a as [])) }))

const runMeteredTranscription = jest.fn(async () => ({
  result: { transcript: 'hello', paragraphs: [], words: [], confidence: 1 },
  receipt: { duration_seconds: 60, cost_cents: 1, debit_recorded: true },
}))
jest.mock('@/lib/ai/transcribe', () => ({
  speakerIdMode: () => 'off',
  loadStaffReferenceForStaff: jest.fn(async () => null),
  runMeteredTranscription: (...a: unknown[]) =>
    (runMeteredTranscription as (...a: unknown[]) => unknown)(...a),
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
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: () => ({ createSignedUrl, remove: jest.fn() }) } }),
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
const claim = jest.fn()
const complete = jest.fn(async () => ({}))
const fail = jest.fn(async () => ({}))
const listDiscards = jest.fn(async () => ({ events: [] as Array<Record<string, unknown>> }))
const staffGet = jest.fn(async () => ({ id: 'staff-1', user_id: 'auth-user-9' }))
const auditList = jest.fn(async () => ({ events: [] as Array<Record<string, unknown>>, total: 0, page: 1, page_size: 50 }))

const fakeClient = {
  customers: { getConsent, get: customersGet },
  orgSettings: { get: orgSettingsGet },
  karuteRecords: { getByRecordingSession, create: karuteRecordsCreate, update: jest.fn() },
  recordingJobs: { claim, complete, fail },
  recordingDiscards: { list: listDiscards },
  staff: { get: staffGet },
  appointments: { get: jest.fn(async () => null) },
  audit: { list: (...a: unknown[]) => (auditList as (...a: unknown[]) => unknown)(...a) },
}
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => fakeClient) }))

import { processRecordingJobs } from '@/lib/jobs/process-recording'
import { hasRememberedEmptyTranscript } from '@/lib/jobs/empty-transcript-memory'
import { RESCUE_PREFIX } from '@/lib/recording/key-grammar'
import { conformingKey } from './helpers/recording-key-fixtures'

const AUDIO_PATH = conformingKey('biz-1')
const RETAKE_PATH = 'app_biz-1_1a2b3c4d-5e6f-4a71-9b5e-2c1d7e4a8b99.webm'

const baseJob = {
  id: 'job-1',
  business_id: 'biz-1',
  recording_session_id: 'sess-1',
  status: 'RUNNING',
  attempts: 3,
  max_attempts: 3,
  last_error: null,
  karute_record_id: null,
  claimed_at: null,
  created_at: '',
  updated_at: '',
  payload: {
    customer_id: 'cust-1',
    staff_id: 'staff-1',
    appointment_id: 'ap-1',
    audio_path: AUDIO_PATH,
  } as Record<string, unknown>,
}

const rememberedRow = (overrides: Record<string, unknown> = {}) => ({
  action: 'recording.transcribe_failed',
  detail: { audio_path: AUDIO_PATH, reason: 'empty_transcript', ...overrides },
})

beforeEach(() => {
  jest.clearAllMocks()
  getConsent.mockResolvedValue({ consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION } })
  orgSettingsGet.mockResolvedValue({ settings: {} })
  customersGet.mockResolvedValue({ name: 'customer' })
  getByRecordingSession.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
  karuteRecordsCreate.mockResolvedValue({ id: 'record-1' })
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/audio' }, error: null })
  complete.mockResolvedValue({})
  fail.mockResolvedValue({})
  listDiscards.mockResolvedValue({ events: [] })
  auditList.mockResolvedValue({ events: [], total: 0, page: 1, page_size: 50 })
  runMeteredTranscription.mockResolvedValue({
    result: { transcript: 'hello', paragraphs: [], words: [], confidence: 1 },
    receipt: { duration_seconds: 60, cost_cents: 1, debit_recorded: true },
  })
})

describe('process-recording worker — Layer A memory skip (subject 2)', () => {
  it('(a) a remembered row for the SAME object → no provider call, fails EMPTY_TRANSCRIPT, and the exhausted row keeps reason empty_transcript + the audio_path', async () => {
    auditList.mockResolvedValue({ events: [rememberedRow()], total: 1, page: 1, page_size: 50 })
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)
    fail.mockResolvedValueOnce({ ...baseJob, status: 'FAILED' })

    await processRecordingJobs(10_000)

    expect(auditList).toHaveBeenCalledWith({
      target_type: 'recording',
      target_id: 'sess-1',
      category: 'recording',
      page_size: 50,
    })
    expect(runMeteredTranscription).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith('job-1', 'EMPTY_TRANSCRIPT')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ reason: 'empty_transcript', audio_path: AUDIO_PATH }),
      }),
    )
  })

  it('(b) a remembered row for a DIFFERENT object (retake) → the provider is still called', async () => {
    auditList.mockResolvedValue({
      events: [rememberedRow({ audio_path: RETAKE_PATH })],
      total: 1,
      page: 1,
      page_size: 50,
    })
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(runMeteredTranscription).toHaveBeenCalled()
    expect(complete).toHaveBeenCalled()
  })

  it('(c) the audit.list read rejects → the provider is still called (a memory blip never costs a karute)', async () => {
    auditList.mockRejectedValue(new Error('core unreachable'))
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(runMeteredTranscription).toHaveBeenCalled()
    expect(complete).toHaveBeenCalled()
  })

  it('(d) a remembered row with reason "other" → the provider is still called', async () => {
    auditList.mockResolvedValue({
      events: [rememberedRow({ reason: 'other' })],
      total: 1,
      page: 1,
      page_size: 50,
    })
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(runMeteredTranscription).toHaveBeenCalled()
    expect(complete).toHaveBeenCalled()
  })

  it('(e) consent refused → the check never reads audit.list at all (the consent gate runs first)', async () => {
    getConsent.mockResolvedValue({ consent: { policy_version: 'stale-version' } })
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)
    fail.mockResolvedValueOnce({ ...baseJob, status: 'FAILED' })

    await processRecordingJobs(10_000)

    expect(auditList).not.toHaveBeenCalled()
    expect(runMeteredTranscription).not.toHaveBeenCalled()
  })
})

describe('hasRememberedEmptyTranscript — the pure helper table', () => {
  const match = { action: 'recording.transcribe_failed', detail: { audio_path: AUDIO_PATH, reason: 'empty_transcript' } }

  it('matches a same-object empty_transcript row', () => {
    expect(hasRememberedEmptyTranscript([match] as never, AUDIO_PATH)).toBe(true)
  })

  it('a different object → false', () => {
    expect(hasRememberedEmptyTranscript([match] as never, RETAKE_PATH)).toBe(false)
  })

  it('reason other → false', () => {
    const row = { ...match, detail: { ...match.detail, reason: 'other' } }
    expect(hasRememberedEmptyTranscript([row] as never, AUDIO_PATH)).toBe(false)
  })

  it('another action → false', () => {
    const row = { ...match, action: 'recording.transcribe_refused' }
    expect(hasRememberedEmptyTranscript([row] as never, AUDIO_PATH)).toBe(false)
  })

  it('audio_path absent (a pre-Layer-A row) → false', () => {
    const row = { action: 'recording.transcribe_failed', detail: { reason: 'empty_transcript' } }
    expect(hasRememberedEmptyTranscript([row] as never, AUDIO_PATH)).toBe(false)
  })

  it('no events → false', () => {
    expect(hasRememberedEmptyTranscript([], AUDIO_PATH)).toBe(false)
  })

  // Fix round 1, S1 (F1): the rescue key shape is RESCUE_PREFIX + the take's
  // OWN key (key-grammar.ts:330) — a lookalike-substring compare would let a
  // returning REAL take match its own rescue's remembered row and be refused.
  it('a remembered RESCUE row must NOT match its own take’s real audio_path', () => {
    const row = { ...match, detail: { ...match.detail, audio_path: `${RESCUE_PREFIX}${AUDIO_PATH}` } }
    expect(hasRememberedEmptyTranscript([row] as never, AUDIO_PATH)).toBe(false)
  })

  it('a remembered TAKE row must NOT match a query for its own rescue key', () => {
    expect(hasRememberedEmptyTranscript([match] as never, `${RESCUE_PREFIX}${AUDIO_PATH}`)).toBe(false)
  })
})
