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
// FIX ROUND 3 (packet B, 2026-09-19): the skip path no longer reads through
// getKaruteOutcomeWithClient (best-effort, null-on-any-failure) — it reads
// synqed.karuteOutcomes.get directly (see karuteOutcomesGet below), so this
// module mock no longer needs to stub that reader.
jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcomeWithClient: (...a: unknown[]) =>
    (setKaruteOutcomeWithClient as (...a: unknown[]) => unknown)(...a),
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
  async (): Promise<{ id: string; store_id?: string | null; customer_id?: string | null } | never> => {
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
// FIX ROUND 3 (packet B, 2026-09-19): the skip path's strict reader — null on
// a 404, throws on anything else (real SDK behavior, karute-outcomes.js).
const karuteOutcomesGet = jest.fn(async () => null as { outcome: string } | null)

const fakeClient = {
  customers: { getConsent, get: customersGet },
  orgSettings: { get: orgSettingsGet },
  karuteRecords: {
    getByRecordingSession,
    create: karuteRecordsCreate,
    update: karuteRecordsUpdate,
  },
  karuteOutcomes: { get: karuteOutcomesGet },
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
  karuteOutcomesGet.mockResolvedValue(null)
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
    karuteOutcomesGet.mockResolvedValueOnce(null)
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, outcome: { status: 'success', isFirstVisit: true } },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(karuteOutcomesGet).toHaveBeenCalledWith('record-existing')
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
    karuteOutcomesGet.mockResolvedValueOnce({ outcome: 'success' })
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, outcome: { status: 'success' } },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(karuteOutcomesGet).toHaveBeenCalledWith('record-existing')
    expect(setKaruteOutcomeWithClient).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('job-1', 'record-existing')
    expect(fail).not.toHaveBeenCalled()
  })

  it('T4 existing record + payload.outcome + the outcome write fails (non-revisit error) → the job FAILS and still no transcription', async () => {
    getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
    karuteOutcomesGet.mockResolvedValueOnce(null)
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

  // Placed BEFORE T7 on purpose: T7's two sub-tests each queue one
  // getByRecordingSession.mockResolvedValueOnce(...) that their own assertion
  // (`not.toHaveBeenCalled()`) proves is never consumed — jest.clearAllMocks()
  // in beforeEach clears call history but not that leftover once-queue entry,
  // so it would otherwise leak into whichever test runs next and silently
  // divert it onto the skip path. T1-T6 all consume theirs; T7 does not.
  describe('T8 FIX ROUND 1 — the karute.save audit row is not lost when the outcome label fails and the job requeues', () => {
    it('T8a attempt 1: lookup 404 → transcription → create OK → outcome write fails → audit WAS called once with action:karute.save, job FAILS', async () => {
      setKaruteOutcomeWithClient.mockResolvedValueOnce({ error: 'upstream down' })
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(karuteRecordsCreate).toHaveBeenCalledTimes(1)
      expect(audit).toHaveBeenCalledTimes(1)
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'karute.save' }))
      expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('outcome write failed'))
      expect(complete).not.toHaveBeenCalled()
    })

    it('T8b the requeue (same job, attempts: 2): lookup now resolves the record, no outcome recorded yet → the outcome upsert IS written, no transcription, no karute.save this run, job completes', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-1', store_id: null })
      karuteOutcomesGet.mockResolvedValueOnce(null)
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          attempts: 2,
          payload: { ...baseJob.payload, outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(setKaruteOutcomeWithClient).toHaveBeenCalledTimes(1)
      expect(runMeteredTranscription).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'karute.save' }))
      expect(complete).toHaveBeenCalledWith('job-1', 'record-1')
      expect(fail).not.toHaveBeenCalled()
    })
  })

  // Placed here (before T7), same reason as T8 above: T7's two sub-tests
  // each leave one getByRecordingSession.mockResolvedValueOnce(...) unconsumed
  // in the mock's once-queue (jest.clearAllMocks() in beforeEach does not
  // drain it), so anything placed AFTER T7 risks that leftover value landing
  // on its own early lookup instead of the 404 default. T9-T11 each fully
  // consume their own once-queue entries (no new leak introduced).
  describe('T9-T11 FIX ROUND 2 — the outcome label survives a stale 保留 row and always files under the record\'s own customer', () => {
    it('T9 existing record + a recorded PENDING (保留) row + payload.outcome decided → the outcome upsert IS called once with the payload status', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      karuteOutcomesGet.mockResolvedValueOnce({ outcome: 'pending' })
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(setKaruteOutcomeWithClient).toHaveBeenCalledTimes(1)
      expect(setKaruteOutcomeWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ status: 'success' }),
      )
      expect(runMeteredTranscription).not.toHaveBeenCalled()
      expect(complete).toHaveBeenCalledWith('job-1', 'record-existing')
    })

    it('T10 existing record\'s customer_id differs from the payload\'s → setKaruteOutcomeWithClient is called with the RECORD\'s customer', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A', customer_id: 'cust-B' })
      karuteOutcomesGet.mockResolvedValueOnce(null)
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, customer_id: 'cust-A', outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(setKaruteOutcomeWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ customerId: 'cust-B' }),
      )
    })

    it('T11 existing record with no customer_id field → falls back to the payload\'s customer (the ?? arm)', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      karuteOutcomesGet.mockResolvedValueOnce(null)
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(setKaruteOutcomeWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ customerId: 'cust-1' }),
      )
    })
  })

  // Placed here (before T7), same reason as T8/T9-T11 above: T7's two
  // sub-tests each leave one getByRecordingSession.mockResolvedValueOnce(...)
  // unconsumed in the mock's once-queue (jest.clearAllMocks() in beforeEach
  // does not drain it), so anything placed AFTER T7 risks that leftover
  // value landing on its own early lookup instead of the 404 default. T12-T16
  // each fully consume their own once-queue entries (no new leak introduced).
  describe("T12-T16 FIX ROUND 3 — the strict outcome read, the pre-write discard fence, and the label's own audit row", () => {
    it('T12 existing record + payload.outcome + karuteOutcomes.get REJECTS with a non-404 → the outcome upsert is NOT called, the job FAILS, no transcription (never write a label blind)', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      karuteOutcomesGet.mockRejectedValueOnce(Object.assign(new Error('core down'), { status: 503 }))
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(setKaruteOutcomeWithClient).not.toHaveBeenCalled()
      expect(runMeteredTranscription).not.toHaveBeenCalled()
      expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('core down'))
      expect(complete).not.toHaveBeenCalled()
    })

    it('T13 existing record + payload.outcome + none recorded + the discard ledger flips to discarded on its SECOND read (first read clean) → fail(DISCARDED_BY_STAFF), the outcome upsert NOT called', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      karuteOutcomesGet.mockResolvedValueOnce(null)
      listDiscards
        .mockResolvedValueOnce({ events: [] })
        .mockResolvedValueOnce({ events: [{ recording_session_id: 'sess-1', source: 'STAFF' }] })
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(setKaruteOutcomeWithClient).not.toHaveBeenCalled()
      expect(fail).toHaveBeenCalledWith('job-1', 'DISCARDED_BY_STAFF')
      expect(complete).not.toHaveBeenCalled()
    })

    it('T14 existing record, NO payload.outcome → the discard ledger is read exactly ONCE (no extra read when no label is owed)', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(listDiscards).toHaveBeenCalledTimes(1)
      expect(karuteOutcomesGet).not.toHaveBeenCalled()
      expect(complete).toHaveBeenCalledWith('job-1', 'record-existing')
    })

    it("T15 existing record + label written → audit called exactly once with action:'karute.outcome_set' (never karute.save)", async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      karuteOutcomesGet.mockResolvedValueOnce(null)
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, outcome: { status: 'success' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(audit).toHaveBeenCalledTimes(1)
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'karute.outcome_set',
          targetType: 'karute',
          targetId: 'record-existing',
          detail: expect.objectContaining({ via: 'job_pipeline', customer_id: 'cust-1' }),
        }),
      )
      expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'karute.save' }))
    })

    it('T16 existing record + the label dropped as REVISIT_NOT_ELIGIBLE → NO karute.outcome_set row; job completes', async () => {
      getByRecordingSession.mockResolvedValueOnce({ id: 'record-existing', store_id: 'store-A' })
      karuteOutcomesGet.mockResolvedValueOnce(null)
      setKaruteOutcomeWithClient.mockResolvedValueOnce({ error: 'revisit_not_eligible' })
      claim
        .mockResolvedValueOnce({
          ...baseJob,
          payload: { ...baseJob.payload, outcome: { status: 'revisit' } },
        })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(audit).not.toHaveBeenCalled()
      expect(complete).toHaveBeenCalledWith('job-1', 'record-existing')
      expect(fail).not.toHaveBeenCalled()
    })
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

// S4 (PR-O commit 1, O1/V4): the worker's mid-run converge (pre-spend lookup
// 404, the record appears while transcription runs) never clears the link an
// earlier save wrote. T7 above leaves an unconsumed once-queue entry on the
// lookup mock, so this block resets that one mock to the file's default first.
describe('S4 — the worker converge never clears a booking link', () => {
  beforeEach(() => {
    getByRecordingSession.mockReset()
    getByRecordingSession.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
  })
  const runMidRunConverge = async (existing: Record<string, unknown>, payload: Record<string, unknown> = {}) => {
    getByRecordingSession
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ id: 'record-existing', store_id: null, ...existing } as never)
    claim.mockResolvedValueOnce({ ...baseJob, payload: { ...baseJob.payload, ...payload } }).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
    expect(karuteRecordsUpdate).toHaveBeenCalledTimes(1)
    expect(karuteRecordsCreate).not.toHaveBeenCalled()
    return (karuteRecordsUpdate.mock.calls[0] as unknown[])[1] as Record<string, unknown>
  }

  it('S4-job: a job re-run with no booking keeps the first save\'s link', async () => {
    const sent = await runMidRunConverge({ customer_id: 'cust-1', appointment_id: 'appt-first' })
    expect(sent).toMatchObject({ appointment_id: 'appt-first' })
  })

  it('S4-job: a stale job for a record since re-pointed to another customer never clears that record\'s link (the worker never moves the customer)', async () => {
    const sent = await runMidRunConverge({ customer_id: 'cust-REPOINTED', appointment_id: 'appt-of-new-customer' })
    expect(sent).toMatchObject({ appointment_id: 'appt-of-new-customer' })
    expect(sent).not.toHaveProperty('customer_id')
  })

  it('S4-job: a re-run that names a booking re-stamps it', async () => {
    const sent = await runMidRunConverge({ customer_id: 'cust-1', appointment_id: 'appt-first' }, { appointment_id: 'appt-new' })
    expect(sent).toMatchObject({ appointment_id: 'appt-new' })
  })
  // S67 fix round 2, commit 15 (SF-5; the attack's F-6 / W10 row): the worker's
  // row tells the record's EFFECTIVE link — `kept` + the id, never null.
  const saveRow = () => {
    const rows = audit.mock.calls.filter((c) => (c[0] as { action: string }).action === 'karute.save')
    expect(rows).toHaveLength(1)
    return (rows[0][0] as { detail: Record<string, unknown> }).detail
  }
  it('SF-5 F-6: a kept-link converge → the row says kept + the record\'s link', async () => {
    await runMidRunConverge({ customer_id: 'cust-1', appointment_id: 'appt-first' })
    expect(saveRow()).toMatchObject({ appointment_link: 'kept', appointment_id: 'appt-first' })
  })
  it('SF-5: a job that names its booking → the row says null + the named id', async () => {
    await runMidRunConverge({ customer_id: 'cust-1', appointment_id: 'appt-first' }, { appointment_id: 'appt-new' })
    expect(saveRow()).toMatchObject({ appointment_link: null, appointment_id: 'appt-new' })
  })
})

// S2 + S5 (PR-O commit 2, RULING-S67-PRO-STOP1 R-O2): the worker writes the
// answer FIRST (the fate function it shares with the facade save), then emits
// its ONE karute.save row carrying outcome_link; a failed write still gets its
// row, and only then fails the job so core requeues it (fix round 1 kept).
describe('S2/S5 — the worker\'s karute.save row carries the answer\'s fate', () => {
  let warn: jest.SpyInstance
  let error: jest.SpyInstance
  beforeEach(() => {
    getByRecordingSession.mockReset()
    getByRecordingSession.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    error = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    error.mockRestore()
  })
  const run = async (payload: Record<string, unknown>) => {
    claim.mockResolvedValueOnce({ ...baseJob, payload: { ...baseJob.payload, ...payload } }).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
    const rows = audit.mock.calls.filter((c) => (c[0] as { action: string }).action === 'karute.save')
    expect(rows).toHaveLength(1)
    return (rows[0][0] as { detail: Record<string, unknown> }).detail
  }

  it('S2/S5-job written: the label lands before the row, the row says written', async () => {
    const detail = await run({ outcome: { status: 'success' } })
    expect(detail.outcome_link).toBe('written')
    expect(setKaruteOutcomeWithClient.mock.invocationCallOrder[0]).toBeLessThan(audit.mock.invocationCallOrder[0])
    expect(complete).toHaveBeenCalledWith('job-1', 'record-1')
  })

  it('S2/S5-job kept: a mid-run converge with no label keeps the label already on record', async () => {
    getByRecordingSession
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
      .mockResolvedValueOnce({ id: 'record-existing', store_id: null, customer_id: 'cust-1' } as never)
    karuteOutcomesGet.mockResolvedValueOnce({ outcome: 'success' } as never)
    const detail = await run({})
    expect(detail.outcome_link).toBe('kept')
    expect(setKaruteOutcomeWithClient).not.toHaveBeenCalled()
  })

  it('S2/S5-job skipped:not_sent: an old client queued no label and no reason', async () => {
    const detail = await run({})
    expect(detail.outcome_link).toBe('skipped:not_sent')
  })

  it('S2/S5-job skipped:<client reason>: the job payload says why no label rides it', async () => {
    const detail = await run({ outcome_missing: 'unanswered_recovery' })
    expect(detail.outcome_link).toBe('skipped:unanswered_recovery')
  })

  it('S2/S5-job skipped:not_returning: the guard refuses the revisit label — record kept, job completes', async () => {
    setKaruteOutcomeWithClient.mockResolvedValueOnce({ error: 'revisit_not_eligible' })
    const detail = await run({ outcome: { status: 'revisit' } })
    expect(detail.outcome_link).toBe('skipped:not_returning')
    expect(complete).toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })

  it('S2/S5-job failed (the write errors): one row with failed:<ref> (no cause), THEN the job fails as before', async () => {
    setKaruteOutcomeWithClient.mockResolvedValueOnce({ error: 'upstream down' })
    const detail = await run({ outcome: { status: 'success' } })
    expect(detail.outcome_link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('outcome write failed: upstream down'))
    expect(fail.mock.invocationCallOrder[0]).toBeGreaterThan(audit.mock.invocationCallOrder[0])
    expect(complete).not.toHaveBeenCalled()
  })

  it('S2/S5-job failed (the write THROWS): the row is still emitted exactly once, the job fails with the original error', async () => {
    setKaruteOutcomeWithClient.mockRejectedValueOnce(new Error('boom'))
    const detail = await run({ outcome: { status: 'success' } })
    expect(detail.outcome_link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('boom'))
    expect(complete).not.toHaveBeenCalled()
  })

  // R-O9 (ii): ONE reference joins the server log line and the audit row —
  // the ref is generated once per failed write (outcome-fate.ts failed()).
  const loggedRefs = () =>
    error.mock.calls
      .map((c) => { try { return JSON.parse(String(c[0])) as { evt?: string; ref?: string } } catch { return null } })
      .filter((line) => line?.evt === 'outcome_write_failed')
      .map((line) => line?.ref)

  it('one reference joins the log line and the audit row (the write errors)', async () => {
    setKaruteOutcomeWithClient.mockResolvedValueOnce({ error: 'upstream down' })
    const link = String((await run({ outcome: { status: 'success' } })).outcome_link)
    expect(link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(loggedRefs()).toEqual([link.slice('failed:'.length)])
  })

  it('one reference joins the log line and the audit row (the write THROWS)', async () => {
    setKaruteOutcomeWithClient.mockRejectedValueOnce(new Error('boom'))
    const link = String((await run({ outcome: { status: 'success' } })).outcome_link)
    expect(link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(loggedRefs()).toEqual([link.slice('failed:'.length)])
  })
})

// S7 (PR-O commit 4): the worker links the ONE unambiguous booking through the
// same resolveAutoAppointmentLink — with the session start the enqueue door
// stamped on the payload (the worker never reads the session row).
describe('S7 — the worker links the unambiguous booking at save', () => {
  const client = fakeClient as unknown as Record<string, Record<string, unknown>>
  const appt = (id: string, startsAt: string, endsAt: string) => ({
    id, customer_id: 'cust-1', store_id: 'store-A', starts_at: startsAt, ends_at: endsAt,
    duration_minutes: 60, status: 'SCHEDULED', cancelled_at: null,
  })
  beforeEach(() => {
    getByRecordingSession.mockReset()
    getByRecordingSession.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
  })
  afterEach(() => {
    delete client.appointments.list
    delete client.karuteRecords.list
  })
  const run = async (appts: object[], payload: Record<string, unknown>) => {
    client.appointments.list = jest.fn(async () => ({ appointments: appts }))
    client.karuteRecords.list = jest.fn(async () => ({ karute_records: [] }))
    claim.mockResolvedValueOnce({ ...baseJob, payload: { ...baseJob.payload, store_id: 'store-A', ...payload } }).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
    const rows = audit.mock.calls.filter((c) => (c[0] as { action: string }).action === 'karute.save')
    expect(rows).toHaveLength(1)
    return (rows[0][0] as { detail: Record<string, unknown> }).detail
  }

  it('S7-job: one booking in its window → created on it; the row says auto_linked', async () => {
    const detail = await run([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')], { session_started_at: '2026-09-29T07:44:39Z' })
    expect(karuteRecordsCreate).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: 'appt-1' }))
    expect(detail).toMatchObject({ appointment_link: 'auto_linked', appointment_id: 'appt-1' })
  })
  // S67 fix round 2, commit 12 (SF-2; the attack's W-F2 twin of F-2).
  it('SF-2 W-F2: a create auto-linked to a booking titled カット stamps that menu (the same as the facade)', async () => {
    appointmentsGet.mockResolvedValueOnce({ title: 'カット' } as never)
    await run([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')], { session_started_at: '2026-09-29T07:44:39Z' })
    expect(appointmentsGet).toHaveBeenCalledWith('appt-1')
    expect(karuteRecordsCreate).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: 'appt-1', service: 'カット' }))
  })
  it('S7-job: two bookings → ambiguous, no link', async () => {
    const detail = await run(
      [appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z'), appt('appt-2', '2026-09-29T10:00:00Z', '2026-09-29T11:00:00Z')],
      { session_started_at: '2026-09-29T07:44:39Z' },
    )
    expect(karuteRecordsCreate).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: null }))
    expect(detail.appointment_link).toBe('ambiguous')
  })
  // SF-6 (S67 fix round 2, commit 16; the attack's W1): its own word, never
  // 'none' (was 'none' in commit 4), logged once.
  it('SF-6 W1: an older job with no session start → skipped:no_session_start, no link, no list read, logged once', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const detail = await run([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')], {})
    expect(detail.appointment_link).toBe('skipped:no_session_start')
    expect(karuteRecordsCreate).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: null }))
    expect(client.appointments.list).not.toHaveBeenCalled()
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('"auto_link_skipped"'))).toHaveLength(1)
    warn.mockRestore()
  })
  it('S7-job: a job that names its booking never runs the auto-link', async () => {
    const detail = await run([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')], { appointment_id: 'appt-given', session_started_at: '2026-09-29T07:44:39Z' })
    expect(client.appointments.list).not.toHaveBeenCalled()
    expect(detail.appointment_link).toBeNull()
  })
})
