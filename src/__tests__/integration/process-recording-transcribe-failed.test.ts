/**
 * 監査ログ round 2 PR C, subject 6 (PACKET-AUDITLOG-PR-C-SERVER-WATCH-
 * 2026-09-11.md item 6) — the worker's recording.transcribe_failed emit.
 * Pins: fires ONLY on the round that exhausts the job's retries
 * (job.attempts >= job.max_attempts, attempts incremented AT CLAIM — see the
 * long comment on emitTranscribeFailedIfExhausted in process-recording.ts for
 * the source evidence); reason mapping (EMPTY_TRANSCRIPT → 'empty_transcript',
 * anything else → 'other'); never on an earlier attempt; never on a discard
 * refusal or a spend-limit refusal (both already have their own row
 * elsewhere).
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'

import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'
import { AppApiError } from '@/lib/app-api/errors'

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

const fakeClient = {
  customers: { getConsent, get: customersGet },
  orgSettings: { get: orgSettingsGet },
  karuteRecords: { getByRecordingSession, create: karuteRecordsCreate, update: jest.fn() },
  recordingJobs: { claim, complete, fail },
  recordingDiscards: { list: listDiscards },
  staff: { get: staffGet },
  appointments: { get: jest.fn(async () => null) },
}
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => fakeClient) }))

import { processRecordingJobs } from '@/lib/jobs/process-recording'
import { conformingKey } from './helpers/recording-key-fixtures'

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
    audio_path: conformingKey('biz-1'),
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
  complete.mockResolvedValue({})
  fail.mockResolvedValue({})
  listDiscards.mockResolvedValue({ events: [] })
  runMeteredTranscription.mockResolvedValue({
    result: { transcript: 'hello', paragraphs: [], words: [], confidence: 1 },
    receipt: { duration_seconds: 60, cost_cents: 1, debit_recorded: true },
  })
})

describe('process-recording worker — recording.transcribe_failed (subject 6)', () => {
  it('exhausted round (attempts === max_attempts) + a generic failure → emits reason "other"', async () => {
    runMeteredTranscription.mockRejectedValueOnce(new Error('provider timeout'))
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(fail).toHaveBeenCalledWith('job-1', 'provider timeout')
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'recording',
        action: 'recording.transcribe_failed',
        actorId: null,
        actorType: 'system',
        businessId: 'biz-1',
        targetType: 'recording',
        targetId: 'sess-1',
        severity: 'notice',
        source: 'system',
        requestId: 'job:job-1:failed',
        detail: expect.objectContaining({
          recording_session_id: 'sess-1',
          customer_id: 'cust-1',
          staff_id: 'staff-1',
          appointment_id: 'ap-1',
          attempt: 3,
          max_attempts: 3,
          reason: 'other',
        }),
      }),
    )
  })

  it('exhausted round + an EMPTY_TRANSCRIPT failure → reason "empty_transcript"', async () => {
    runMeteredTranscription.mockResolvedValueOnce({
      result: { transcript: '   ', paragraphs: [], words: [], confidence: 1 },
      receipt: { duration_seconds: 60, cost_cents: 1, debit_recorded: true },
    })
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ reason: 'empty_transcript' }) }),
    )
  })

  it('NOT the exhausted round (attempts < max_attempts) → no emit, even though the job still fails', async () => {
    runMeteredTranscription.mockRejectedValueOnce(new Error('provider timeout'))
    claim.mockResolvedValueOnce({ ...baseJob, attempts: 1 }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(fail).toHaveBeenCalledWith('job-1', 'provider timeout')
    expect(audit).not.toHaveBeenCalled()
  })

  it('exhausted round + a STAFF discard → no emit (the discard row IS the record)', async () => {
    listDiscards.mockResolvedValue({
      events: [{ recording_session_id: 'sess-1', source: 'STAFF' }],
    })
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(fail).toHaveBeenCalledWith('job-1', 'DISCARDED_BY_STAFF')
    expect(audit).not.toHaveBeenCalled()
  })

  it('exhausted round + a spend-limit refusal → no emit (recording.transcribe_refused already filed the row)', async () => {
    runMeteredTranscription.mockRejectedValueOnce(new AppApiError('rate_limited', 'over cap'))
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(fail).toHaveBeenCalledWith('job-1', 'AI_SPEND_LIMIT')
    expect(audit).not.toHaveBeenCalled()
  })

  it('a successful job never emits recording.transcribe_failed (karute.save is the only row)', async () => {
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(complete).toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.transcribe_failed' }),
    )
  })
})
