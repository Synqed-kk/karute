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
  // The real literal, not a stub: the worker compares against this to decide
  // throw vs skip, so mocking it away would silently make that branch dead.
  // (The guard suite asserts the exported constant's own value.)
  REVISIT_NOT_ELIGIBLE: 'revisit_not_eligible',
}))

const audit = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => audit(...(a as [])) }))

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
const getByRecordingSession = jest.fn(
  async (): Promise<{
    id: string
    entries?: Array<{
      id: string
      category: string
      content: string
      original_quote: string | null
      confidence: number
      author?: string
      is_manual?: boolean
    }>
  }> => {
    throw Object.assign(new Error('nf'), { status: 404 })
  },
)
const karuteRecordsCreate = jest.fn(async () => ({ id: 'record-1' }))
const karuteRecordsUpdate = jest.fn(async () => ({ id: 'record-1' }))
const claim = jest.fn()
const complete = jest.fn(async () => ({}))
const fail = jest.fn(async () => ({}))

const staffGet = jest.fn(async () => ({ id: 'staff-1', user_id: 'auth-user-9' }))
const appointmentsGet = jest.fn(async () => ({
  id: 'ap-1',
  staff_id: 'staff-1',
  store_id: null,
  title: 'VIP施術',
}))

const fakeClient = {
  customers: { getConsent, get: customersGet },
  orgSettings: { get: orgSettingsGet },
  karuteRecords: {
    getByRecordingSession,
    create: karuteRecordsCreate,
    update: karuteRecordsUpdate,
  },
  recordingJobs: { claim, complete, fail },
  staff: { get: staffGet },
  appointments: { get: appointmentsGet },
}
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => fakeClient),
}))

import { processRecordingJobs } from '@/lib/jobs/process-recording'
// Reprocess-merge tests (below) override this per-test to return a non-empty
// AI set, so the mocked fn needs to be reachable — the outcome tests above
// never care about extraction content, hence the shared static default.
import { runKaruteExtraction } from '@/lib/ai/karute-extract'

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

  it('appointment-linked job → record created with the booked menu (7/29 field report)', async () => {
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, appointment_id: 'ap-1', duration_seconds: 3070 },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(appointmentsGet).toHaveBeenCalledWith('ap-1')
    expect(karuteRecordsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'VIP施術', duration_minutes: 51 }),
    )
  })

  it('no appointment on the job → service null, appointment never fetched', async () => {
    claim.mockResolvedValueOnce({ ...baseJob }).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(appointmentsGet).not.toHaveBeenCalled()
    expect(karuteRecordsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ service: null }),
    )
  })

  it.each([
    ['cross-tenant app_ path', 'app_biz-2_stolen.webm'],
    ['untenanted rec_* path', 'rec_1700000000000.webm'],
  ])(
    '%s → job FAILS before any service-role read (universal tenant-prefix gate)',
    async (_label, audio_path) => {
      claim
        .mockResolvedValueOnce({ ...baseJob, payload: { ...baseJob.payload, audio_path } })
        .mockResolvedValueOnce(null)

      await processRecordingJobs(10_000)

      expect(createSignedUrl).not.toHaveBeenCalled()
      expect(removeObj).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
      expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('does not belong'))
    },
  )

  it('payload.outcome absent → outcome upsert never called', async () => {
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(setKaruteOutcomeWithClient).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('job-1', 'record-1')
  })

  it('a job run emits its own karute.save exactly ONCE, with customer_id in detail (packet 30 §4) — this PR adds no second emit', async () => {
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.save',
        source: 'system',
        // actorId = the recorder's AUTH uid, translated from the payload's
        // synqed staff id via the roster (the payload id-space violates the
        // audit contract; the synqed id rides in detail instead).
        actorId: 'auth-user-9',
        detail: expect.objectContaining({
          via: 'job_pipeline',
          customer_id: 'cust-1',
          staff_id: 'staff-1',
        }),
      }),
    )
    expect(staffGet).toHaveBeenCalledWith('staff-1')
  })

  it('an UNWIRED recorder (card has no login) → actorId null, emit and job still complete', async () => {
    staffGet.mockResolvedValueOnce({ id: 'staff-1', user_id: null as unknown as string })
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'karute.save', actorId: null }),
    )
    expect(complete).toHaveBeenCalled()
  })

  it('a roster-lookup failure degrades to actorId null — never fails the job, never emits the synqed id', async () => {
    staffGet.mockRejectedValueOnce(new Error('core down'))
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'karute.save', actorId: null }),
    )
    expect(complete).toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
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

  it("a REJECTED 'revisit' does NOT fail the job — a retry would re-spend Deepgram + OpenAI", async () => {
    // The rejection is deterministic: no number of retries makes the customer
    // returning. This throw sits AFTER both AI calls, so failing here would
    // re-run them on every requeue until max_attempts. Keep the record, drop
    // the label — enqueue already 400s this case up front.
    setKaruteOutcomeWithClient.mockResolvedValueOnce({ error: 'revisit_not_eligible' })
    claim
      .mockResolvedValueOnce({
        ...baseJob,
        payload: { ...baseJob.payload, outcome: { status: 'revisit' } },
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(fail).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

/**
 * Reprocess carry-forward merge (edit-layer Wave 1, packet PR-2c). A
 * reprocessed job's fresh AI extraction must never drop entries a staff
 * member already edited/hand-added: existing human-authored rows
 * (author !== 'AI'; is_manual fallback for legacy rows — same
 * belt-and-braces rule as the regen-guard filter, regenerate-karute.ts) are
 * re-sent alongside the new AI set as is_manual: true. AI-authored rows are
 * NOT carried — the fresh extraction replaces them, same as before this PR.
 */
describe('process-recording worker — reprocess carry-forward merge (I1)', () => {
  it('carries human-authored rows forward as is_manual: true; the stale AI row is replaced, not carried', async () => {
    ;(runKaruteExtraction as jest.Mock).mockResolvedValueOnce({
      result: { entries: [{ category: 'symptom', title: 'fresh AI finding', source_quote: 'q', confidence_score: 0.9 }] },
    })
    getByRecordingSession.mockResolvedValueOnce({
      id: 'record-existing',
      entries: [
        { id: 'old-ai', category: 'PRODUCT', content: 'stale AI row', original_quote: 'x', confidence: 0.5, author: 'AI', is_manual: false },
        { id: 'edited', category: 'SYMPTOM', content: 'staff-edited row', original_quote: 'y', confidence: 0.6, author: 'HUMAN_EDITED', is_manual: true },
      ],
    })
    karuteRecordsUpdate.mockResolvedValueOnce({ id: 'record-existing' })
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(karuteRecordsUpdate).toHaveBeenCalledWith(
      'record-existing',
      expect.objectContaining({
        entries: [
          expect.objectContaining({ content: 'fresh AI finding', is_manual: false }),
          expect.objectContaining({ content: 'staff-edited row', category: 'SYMPTOM', is_manual: true }),
        ],
      }),
    )
    const payload = (karuteRecordsUpdate.mock.calls[0] as unknown as [
      string,
      { entries: Array<{ content: string }> },
    ])[1]
    expect(payload.entries.map((e) => e.content)).not.toContain('stale AI row')
  })

  it('legacy rows with no author fall back to is_manual for the carry-forward filter', async () => {
    ;(runKaruteExtraction as jest.Mock).mockResolvedValueOnce({
      result: { entries: [{ category: 'symptom', title: 'fresh', source_quote: '', confidence_score: 0.9 }] },
    })
    getByRecordingSession.mockResolvedValueOnce({
      id: 'record-existing',
      entries: [
        { id: 'legacy-ai', category: 'PRODUCT', content: 'legacy AI row', original_quote: null, confidence: 0.4, is_manual: false },
        { id: 'legacy-human', category: 'SYMPTOM', content: 'legacy human row', original_quote: null, confidence: 0, is_manual: true },
      ],
    })
    karuteRecordsUpdate.mockResolvedValueOnce({ id: 'record-existing' })
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    const payload = (karuteRecordsUpdate.mock.calls[0] as unknown as [
      string,
      { entries: Array<{ content: string }> },
    ])[1]
    const contents = payload.entries.map((e) => e.content)
    expect(contents).toContain('legacy human row')
    expect(contents).not.toContain('legacy AI row')
  })
})
