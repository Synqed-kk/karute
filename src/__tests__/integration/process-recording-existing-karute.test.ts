/**
 * process-recording worker — the pre-spend existing-karute check (packet B,
 * 2026-09-19). The census found no intended caller that re-runs this worker
 * over a session that already has a karute (再生成 is a separate path that
 * reuses the stored transcript) — production had a real double-pay: a
 * session saved from the phone's own in-tab path was transcribed again by a
 * zero-tap recovery job. So: an existing record for the session means this
 * job's work is already done — no transcription, no extraction, no summary,
 * no karuteRecords.update/.create, no karute.save audit. The ONE thing a
 * late job can still owe is the outcome label, when none is recorded yet.
 *
 * Same mocking idiom as process-recording-outcome.test.ts.
 */

process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'

import { RECORDING_CONSENT_POLICY_VERSION, CONSENT_REQUIRED_ERROR } from '@/lib/consent'

const setKaruteOutcomeWithClient = jest.fn(async () => ({}) as { error?: string })
const getKaruteOutcomeWithClient = jest.fn(async () => null as { outcome: string } | null)
jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcomeWithClient: (...a: unknown[]) =>
    (setKaruteOutcomeWithClient as (...a: unknown[]) => unknown)(...a),
  getKaruteOutcomeWithClient: (...a: unknown[]) =>
    (getKaruteOutcomeWithClient as (...a: unknown[]) => unknown)(...a),
  // The real literal, not a stub — see process-recording-outcome.test.ts.
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
const getByRecordingSession = jest.fn(
  async (): Promise<{ id: string; store_id?: string | null } | never> => {
    throw Object.assign(new Error('nf'), { status: 404 })
  },
)
const karuteRecordsCreate = jest.fn(async () => ({ id: 'record-1' }))
const karuteRecordsUpdate = jest.fn(async () => ({ id: 'record-1' }))
const claim = jest.fn()
const complete = jest.fn(async () => ({}))
const fail = jest.fn(async () => ({}))
const listDiscards = jest.fn(async () => ({ events: [] as Array<Record<string, unknown>> }))
const staffGet = jest.fn(async () => ({ id: 'staff-1', user_id: 'auth-user-9' }))
const appointmentsGet = jest.fn(async () => null)

const fakeClient = {
  customers: { getConsent, get: customersGet },
  orgSettings: { get: orgSettingsGet },
  karuteRecords: {
    getByRecordingSession,
    create: karuteRecordsCreate,
    update: karuteRecordsUpdate,
  },
  recordingJobs: { claim, complete, fail },
  recordingDiscards: { list: listDiscards },
  staff: { get: staffGet },
  appointments: { get: appointmentsGet },
}
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => fakeClient) }))

import { processRecordingJobs } from '@/lib/jobs/process-recording'
import { runKaruteExtraction } from '@/lib/ai/karute-extract'
import { runKaruteSummary } from '@/lib/ai/karute-summarize'
import { conformingKey } from './helpers/recording-key-fixtures'

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
  karuteRecordsUpdate.mockResolvedValue({ id: 'record-1' })
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/audio' }, error: null })
  setKaruteOutcomeWithClient.mockResolvedValue({})
  getKaruteOutcomeWithClient.mockResolvedValue(null)
  complete.mockResolvedValue({})
  fail.mockResolvedValue({})
  listDiscards.mockResolvedValue({ events: [] })
  runMeteredTranscription.mockResolvedValue({
    result: { transcript: 'hello', paragraphs: [], words: [], confidence: 1 },
    receipt: { duration_seconds: 60, cost_cents: 1, debit_recorded: true },
  })
})

describe('process-recording worker — pre-spend existing-karute check (packet B)', () => {
  it('T1 existing record, no payload.outcome → no paid/write calls, no karute.save, complete(job.id, existing.id), one info line', async () => {
    getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
    const info = jest.spyOn(console, 'info').mockImplementation(() => {})
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(runMeteredTranscription).not.toHaveBeenCalled()
    expect(runKaruteExtraction).not.toHaveBeenCalled()
    expect(runKaruteSummary).not.toHaveBeenCalled()
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
    expect(karuteRecordsCreate).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('job-1', 'record-existing')
    expect(fail).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      JSON.stringify({
        evt: 'recording_job_skipped_existing',
        jobId: 'job-1',
        recordingSessionId: 'sess-1',
        karuteRecordId: 'record-existing',
        attempt: baseJob.attempts,
      }),
    )
    info.mockRestore()
  })

  it('T2 existing record + payload.outcome + no outcome recorded yet → the outcome upsert IS written once with the payload values; still no transcription; job completes', async () => {
    getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
    getKaruteOutcomeWithClient.mockResolvedValueOnce(null)
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, outcome: { status: 'success', isFirstVisit: true } },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(getKaruteOutcomeWithClient).toHaveBeenCalledWith(fakeClient, 'record-existing')
    expect(setKaruteOutcomeWithClient).toHaveBeenCalledTimes(1)
    expect(setKaruteOutcomeWithClient).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        karuteRecordId: 'record-existing',
        customerId: 'cust-1',
        status: 'success',
        isFirstVisit: true,
        decidedBy: 'staff-1',
      }),
    )
    expect(runMeteredTranscription).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('job-1', 'record-existing')
    expect(fail).not.toHaveBeenCalled()
  })

  it('T3 existing record + payload.outcome + an outcome already recorded → the outcome upsert is NOT called; job completes', async () => {
    getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
    getKaruteOutcomeWithClient.mockResolvedValueOnce({ outcome: 'success' })
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, outcome: { status: 'success' } },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(getKaruteOutcomeWithClient).toHaveBeenCalledWith(fakeClient, 'record-existing')
    expect(setKaruteOutcomeWithClient).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('job-1', 'record-existing')
    expect(fail).not.toHaveBeenCalled()
  })

  it('T4 existing record + payload.outcome + the outcome write fails (non-revisit error) → the job FAILS and still no transcription', async () => {
    getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
    getKaruteOutcomeWithClient.mockResolvedValueOnce(null)
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
    expect(runMeteredTranscription).not.toHaveBeenCalled()
  })

  it('T5 the lookup rejects with a non-404 → the job FAILS and runMeteredTranscription is NOT called (never pay blind)', async () => {
    getByRecordingSession.mockRejectedValueOnce(Object.assign(new Error('core down'), { status: 503 }))
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(runMeteredTranscription).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('core down'))
  })

  it('T6 the lookup 404s → today\'s path unchanged: transcription called once, create called, audit emitted, job completes', async () => {
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(runMeteredTranscription).toHaveBeenCalledTimes(1)
    expect(karuteRecordsCreate).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'karute.save' }))
    expect(complete).toHaveBeenCalledWith('job-1', 'record-1')
    expect(fail).not.toHaveBeenCalled()
  })

  describe('T7 ORDER — the skip path never outranks the discard check or the consent gate', () => {
    it('a discarded session with an existing record → still refused exactly as today', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      listDiscards.mockResolvedValueOnce({ events: [{ recording_session_id: 'sess-1', source: 'STAFF' }] })
      claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(fail).toHaveBeenCalledWith('job-1', 'DISCARDED_BY_STAFF')
      expect(getConsent).not.toHaveBeenCalled()
      expect(getByRecordingSession).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
    })

    it('lapsed consent with an existing record → CONSENT_REQUIRED exactly as today', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      getConsent.mockResolvedValueOnce({ consent: { policy_version: 'stale-version' } })
      claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(fail).toHaveBeenCalledWith('job-1', CONSENT_REQUIRED_ERROR)
      expect(getByRecordingSession).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
    })
  })
})
