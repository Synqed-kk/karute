/**
 * GlobalPipeline server path (packet 22 B3, Stage-1 autosave cohort). Pins:
 * eligibility (recordingSessionId + appointmentCustomerId + outcome/Skipped),
 * the pre-enqueue fallback to the in-tab path, DONE/FAILED poll settlement,
 * and runId supersession — the same guard class run() already uses (see
 * global-pipeline-supersession.test.ts).
 */
import type { PipelineResult } from '@/lib/ai-pipeline'
import { CONSENT_REQUIRED_ERROR } from '@/lib/consent'

// `mock`-prefixed so jest's hoisted factory may reference it.
const mockDeferreds: { resolve: (r: PipelineResult) => void; reject: (e: unknown) => void }[] = []
jest.mock('@/lib/ai-pipeline', () => ({
  ...jest.requireActual('@/lib/ai-pipeline'),
  runAIPipeline: jest.fn(
    () =>
      new Promise<PipelineResult>((resolve, reject) => {
        mockDeferreds.push({ resolve, reject })
      }),
  ),
}))

const deleteTake = jest.fn()
jest.mock('@/lib/karute/take-store', () => ({
  deleteTake: (...a: unknown[]) => (deleteTake as (...a: unknown[]) => unknown)(...a),
}))

type EnqueueResult = { ok: true; jobId: string; status: string } | { error: string }
type JobStatusResult =
  | {
      status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
      karuteRecordId: string | null
      attempts: number
      maxAttempts: number
      lastError: string | null
    }
  | { error: string; notFound?: boolean }

const stageForJob = jest.fn(async (_blob: Blob): Promise<{ path: string }> => ({ path: 'staged.webm' }))
const enqueueJob = jest.fn(
  async (_input: unknown): Promise<EnqueueResult> => ({ ok: true, jobId: 'job-1', status: 'QUEUED' }),
)
const jobStatus = jest.fn(
  async (_sessionId: string): Promise<JobStatusResult> => ({
    status: 'QUEUED',
    karuteRecordId: null,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
  }),
)
const portSupportsServerJob = { current: true }
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    get supportsServerJob() {
      return portSupportsServerJob.current
    },
    stageForJob: (...a: unknown[]) => (stageForJob as (...a: unknown[]) => unknown)(...a),
    enqueueJob: (...a: unknown[]) => (enqueueJob as (...a: unknown[]) => unknown)(...a),
    jobStatus: (...a: unknown[]) => (jobStatus as (...a: unknown[]) => unknown)(...a),
  }),
}))

import { globalPipeline } from '@/lib/global-pipeline'

// Eligible per the locked Stage-1 rule: recordingSessionId + appointmentCustomerId
// + (outcome || outcomeSkipped).
const eligibleCtx = {
  locale: 'ja',
  customers: [],
  appointmentCustomerId: 'cust-1',
  outcome: { status: 'success' as const },
  recordingSessionId: 'sess-1',
  takeId: 'take-1',
}

async function tick(ms: number) {
  await jest.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  jest.useFakeTimers()
  globalPipeline.reset()
  mockDeferreds.length = 0
  jest.clearAllMocks()
  portSupportsServerJob.current = true
  stageForJob.mockResolvedValue({ path: 'staged.webm' })
  enqueueJob.mockResolvedValue({ ok: true, jobId: 'job-1', status: 'QUEUED' })
  jobStatus.mockResolvedValue({
    status: 'QUEUED',
    karuteRecordId: null,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
  })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('globalPipeline server-path eligibility (packet 22)', () => {
  it('eligible context → stages + enqueues, never calls runAIPipeline', async () => {
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(stageForJob).toHaveBeenCalledTimes(1)
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(mockDeferreds).toHaveLength(0)
  })

  it('walk-in (no appointmentCustomerId) → in-tab path, no staging', async () => {
    globalPipeline.start(new Blob(['a']), { ...eligibleCtx, appointmentCustomerId: undefined })
    await tick(0)
    expect(stageForJob).not.toHaveBeenCalled()
    expect(mockDeferreds).toHaveLength(1)
  })

  it('no outcome/outcomeSkipped → in-tab path, no staging', async () => {
    globalPipeline.start(new Blob(['a']), { ...eligibleCtx, outcome: undefined })
    await tick(0)
    expect(stageForJob).not.toHaveBeenCalled()
    expect(mockDeferreds).toHaveLength(1)
  })

  // PR-B2 — the ONE genuinely new seam: a RECOVERED take auto-finishing with no
  // answer at all must still take the durable server route (it is the route
  // that survives the app being closed mid-flight, which is this whole lane's
  // premise). The flag is CLIENT-SIDE: the enqueue body must stay exactly the
  // shape the facade's `.strict()` schema accepts, i.e. no outcome key and no
  // stray recoveryUnanswered key. The worker already writes no outcome row for
  // an absent outcome (process-recording-outcome.test.ts).
  it('recoveryUnanswered (no outcome, no skip) → server path, and the payload carries NO outcome', async () => {
    globalPipeline.start(new Blob(['a']), {
      ...eligibleCtx,
      outcome: undefined,
      recoveryUnanswered: true,
    })
    await tick(0)
    expect(stageForJob).toHaveBeenCalledTimes(1)
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(mockDeferreds).toHaveLength(0)
    const body = enqueueJob.mock.calls[0][0] as Record<string, unknown>
    expect(body.outcome).toBeUndefined()
    expect('recoveryUnanswered' in body).toBe(false)
    expect(body).toEqual({
      recordingSessionId: 'sess-1',
      customerId: 'cust-1',
      audioPath: 'staged.webm',
      appointmentId: undefined,
      locale: 'ja',
      durationSeconds: undefined,
      outcome: undefined,
    })
  })

  it('no recordingSessionId (e.g. take-recovery accept) → in-tab path, no staging', async () => {
    globalPipeline.start(new Blob(['a']), { ...eligibleCtx, recordingSessionId: undefined })
    await tick(0)
    expect(stageForJob).not.toHaveBeenCalled()
    expect(mockDeferreds).toHaveLength(1)
  })

  it('port without supportsServerJob (web arm) → in-tab path even when eligible', async () => {
    portSupportsServerJob.current = false
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(stageForJob).not.toHaveBeenCalled()
    expect(enqueueJob).not.toHaveBeenCalled()
    expect(mockDeferreds).toHaveLength(1)
  })
})

describe('globalPipeline server-path pre-enqueue fallback (packet 22)', () => {
  it('stageForJob throws → falls back to the in-tab path with the SAME blob/context', async () => {
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus.mockResolvedValueOnce({ error: 'recording job not found', notFound: true }) // ghost probe: no job
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(enqueueJob).not.toHaveBeenCalled()
    expect(mockDeferreds).toHaveLength(1) // in-tab fallback fired
    expect(globalPipeline.context).toEqual(eligibleCtx)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stageForJob throws while OFFLINE (probe dark) → immediate error with the take KEPT — never a blind fallback, never a 90s hold', async () => {
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus.mockRejectedValueOnce(new Error('network down')) // dark — NOT a definitive answer
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0) // NO timer advance — the error must surface in one round-trip
    expect(mockDeferreds).toHaveLength(0) // in-tab never runs on a guess
    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('unknown')
    expect(deleteTake).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stageForJob throws + probe answers with server TROUBLE (5xx, not notFound) → error, never a fallback on trouble', async () => {
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus.mockResolvedValueOnce({ error: 'Job status failed (500)' }) // resolved but NOT definitive absence
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(0)
    expect(globalPipeline.state).toBe('error')
    warn.mockRestore()
  })

  it('stageForJob throws but a PRIOR attempt left a live ghost job → polls it, never in-tab', async () => {
    stageForJob.mockRejectedValueOnce(new Error('storage 500'))
    jobStatus
      .mockResolvedValueOnce({ status: 'RUNNING', karuteRecordId: null, attempts: 1, maxAttempts: 3, lastError: null })
      .mockResolvedValueOnce({ status: 'DONE', karuteRecordId: 'record-g', attempts: 1, maxAttempts: 3, lastError: null })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(0)
    await tick(5000)
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.serverSavedRecordId).toBe('record-g')
    warn.mockRestore()
  })

  it('enqueueJob returns {error} → falls back to the in-tab path', async () => {
    enqueueJob.mockResolvedValueOnce({ error: 'no staff identity' })
    jobStatus.mockResolvedValueOnce({ error: 'recording job not found', notFound: true }) // definitive: no job
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(1)
    warn.mockRestore()
  })

  it("server trouble (5xx {error} WITHOUT notFound) during resolution is NOT 'no job' — keeps probing, then finds the job → polls", async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus
      .mockResolvedValueOnce({ error: 'Job status failed (500)' }) // transient — must NOT resolve fallback
      .mockResolvedValueOnce({ status: 'RUNNING', karuteRecordId: null, attempts: 1, maxAttempts: 3, lastError: null })
      .mockResolvedValueOnce({ status: 'DONE', karuteRecordId: 'record-5', attempts: 1, maxAttempts: 3, lastError: null })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(0) // a 500 blip must never start the in-tab pipeline
    await tick(5000) // re-probe → RUNNING → poll path
    await tick(5000) // poll tick → DONE
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.serverSavedRecordId).toBe('record-5')
    expect(mockDeferreds).toHaveLength(0)
    warn.mockRestore()
  })

  it('ambiguous enqueue (fetch rejects) but the job landed → polls it, NEVER runs the in-tab pipeline (Greptile #587 P1)', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus
      // the ambiguity probe finds the committed job alive…
      .mockResolvedValueOnce({ status: 'QUEUED', karuteRecordId: null, attempts: 0, maxAttempts: 3, lastError: null })
      // …and the first poll tick finds it DONE
      .mockResolvedValueOnce({ status: 'DONE', karuteRecordId: 'record-9', attempts: 1, maxAttempts: 3, lastError: null })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(0) // no dual pipeline
    await tick(5000)
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.serverSavedRecordId).toBe('record-9')
    expect(mockDeferreds).toHaveLength(0)
    warn.mockRestore()
  })

  it('ambiguous enqueue with only a dead (FAILED) prior job → falls back in-tab (a dead job cannot race)', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus.mockResolvedValueOnce({
      status: 'FAILED',
      karuteRecordId: null,
      attempts: 3,
      maxAttempts: 3,
      lastError: 'boom',
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(1)
    warn.mockRestore()
  })

  it('ambiguous enqueue + probe dark then recovering → finds the job and polls it, never in-tab', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus
      .mockRejectedValueOnce(new Error('network down')) // probe 1: dark → re-probe
      .mockResolvedValueOnce({ status: 'RUNNING', karuteRecordId: null, attempts: 1, maxAttempts: 3, lastError: null })
      .mockResolvedValueOnce({ status: 'DONE', karuteRecordId: 'record-7', attempts: 1, maxAttempts: 3, lastError: null })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000) // probe retry finds RUNNING → poll path
    expect(mockDeferreds).toHaveLength(0)
    await tick(5000) // poll tick → DONE
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.serverSavedRecordId).toBe('record-7')
    expect(mockDeferreds).toHaveLength(0)
    warn.mockRestore()
  })

  it('ambiguous enqueue + server dark for the whole budget → error with the take KEPT, NOTHING runs (no offline dual-run)', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus.mockRejectedValue(new Error('network down')) // persistent — never answers
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(90_000 + 5000) // burn the whole resolution budget
    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('unknown')
    expect(mockDeferreds).toHaveLength(0) // in-tab never ran
    expect(deleteTake).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('retry after an unresolved error + stage-failure while still offline → immediate error again, NOTHING ever runs beside the possible ghost', async () => {
    // Attempt 1: enqueue ambiguous, server dark for the whole budget → error
    // (a ghost job may exist server-side).
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus.mockRejectedValue(new Error('network down'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(90_000 + 5000)
    expect(globalPipeline.state).toBe('error')

    // Retry while STILL offline: stage fails, probe dark = no answer → error
    // in one round-trip. In-tab must never start on a guess.
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    globalPipeline.retry()
    await tick(0)
    expect(mockDeferreds).toHaveLength(0) // no blind fallback
    expect(globalPipeline.state).toBe('error')
    expect(deleteTake).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('retry after an unresolved error + stage-failure, ghost then found alive → polls it to settlement', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus.mockRejectedValue(new Error('network down'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(90_000 + 5000)
    expect(globalPipeline.state).toBe('error')

    // Network back: the retry's stage still fails, but the probe now finds
    // the ghost committed by attempt 1 — poll it, never in-tab.
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus
      .mockResolvedValueOnce({ status: 'RUNNING', karuteRecordId: null, attempts: 1, maxAttempts: 3, lastError: null })
      .mockResolvedValueOnce({ status: 'DONE', karuteRecordId: 'record-gh', attempts: 1, maxAttempts: 3, lastError: null })
    globalPipeline.retry()
    await tick(0)
    expect(mockDeferreds).toHaveLength(0)
    await tick(5000)
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.serverSavedRecordId).toBe('record-gh')
    warn.mockRestore()
  })

  it('stage-failure with a DEFINITIVELY dead ghost (FAILED) → in-tab fallback; a later dark stage-failure still errors', async () => {
    // The dead ghost permits the fallback (definitive answer).
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus.mockResolvedValueOnce({ status: 'FAILED', karuteRecordId: null, attempts: 3, maxAttempts: 3, lastError: 'boom' })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(1) // definitive dead ghost → in-tab fallback

    // In-tab run fails → retry re-dispatches the server path; stage fails
    // again while dark → error, never a second guess.
    mockDeferreds[0].reject(new Error('transcribe failed'))
    await tick(0)
    expect(globalPipeline.state).toBe('error')
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus.mockRejectedValueOnce(new Error('network down'))
    globalPipeline.retry()
    await tick(0)
    expect(mockDeferreds).toHaveLength(1) // still 1 — no new in-tab run on a dark probe
    expect(globalPipeline.state).toBe('error')
    warn.mockRestore()
  })

  it('stage-failure ghost probe finds a FAILED (dead) job → immediate in-tab fallback', async () => {
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus.mockResolvedValueOnce({ status: 'FAILED', karuteRecordId: null, attempts: 3, maxAttempts: 3, lastError: 'boom' })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(1)
    warn.mockRestore()
  })

  it('retry() after an ambiguity error re-dispatches the SERVER path — core idempotent enqueue reconciles any ghost job', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus.mockRejectedValue(new Error('network down'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(90_000 + 5000)
    expect(globalPipeline.state).toBe('error')

    // Network back: retry must go through the server path, not in-tab.
    jobStatus.mockResolvedValue({ status: 'QUEUED', karuteRecordId: null, attempts: 0, maxAttempts: 3, lastError: null })
    globalPipeline.retry()
    await tick(0)
    expect(stageForJob).toHaveBeenCalledTimes(2)
    expect(enqueueJob).toHaveBeenCalledTimes(2) // idempotent server-side: a ghost job is returned unchanged
    expect(mockDeferreds).toHaveLength(0) // never in-tab
    expect(globalPipeline.state).toBe('processing')
    warn.mockRestore()
  })

  it('a new start() during ambiguity resolution supersedes — the stale resolution settles nothing', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus.mockRejectedValue(new Error('network down'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000) // mid-resolution

    // Supersede with a walk-in (in-tab path).
    globalPipeline.start(new Blob(['b']), { locale: 'ja', customers: [] })
    await tick(0)
    expect(mockDeferreds).toHaveLength(1)

    // Burn past the stale run's budget — it must NOT flip the new run to error.
    await tick(90_000 + 5000)
    expect(globalPipeline.state).toBe('processing')
    expect(globalPipeline.error).toBeNull()
    warn.mockRestore()
  })

  it('a successful enqueue never falls back, even if the poll later fails', async () => {
    jobStatus.mockResolvedValueOnce({
      status: 'FAILED',
      karuteRecordId: null,
      attempts: 3,
      maxAttempts: 3,
      lastError: 'boom',
    })
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000)
    expect(mockDeferreds).toHaveLength(0) // never ran the in-tab pipeline
    expect(globalPipeline.state).toBe('error')
  })
})

describe('globalPipeline server-path poll settlement (packet 22)', () => {
  it('DONE → deletes the take and settles via autosaving + serverSavedRecordId (the mirrored-toast trigger)', async () => {
    jobStatus
      .mockResolvedValueOnce({ status: 'QUEUED', karuteRecordId: null, attempts: 0, maxAttempts: 3, lastError: null })
      .mockResolvedValueOnce({ status: 'DONE', karuteRecordId: 'record-1', attempts: 1, maxAttempts: 3, lastError: null })
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000) // tick 1 → still QUEUED
    expect(globalPipeline.state).toBe('processing')
    expect(deleteTake).not.toHaveBeenCalled()
    await tick(5000) // tick 2 → DONE
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.serverSavedRecordId).toBe('record-1')
    expect(deleteTake).toHaveBeenCalledWith('take-1')
  })

  it('DONE but karuteRecordId null (core anomaly) → unknown error, take KEPT (never deleted on a falsy id)', async () => {
    jobStatus.mockResolvedValueOnce({
      status: 'DONE',
      karuteRecordId: null,
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
    })
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000)
    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('unknown')
    expect(globalPipeline.serverSavedRecordId).toBeNull()
    expect(deleteTake).not.toHaveBeenCalled()
  })

  it('FAILED with CONSENT_REQUIRED_ERROR → consent-required, take kept', async () => {
    jobStatus.mockResolvedValueOnce({
      status: 'FAILED',
      karuteRecordId: null,
      attempts: 3,
      maxAttempts: 3,
      lastError: CONSENT_REQUIRED_ERROR,
    })
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000)
    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('consent-required')
    expect(deleteTake).not.toHaveBeenCalled()
  })

  it("FAILED with 'EMPTY_TRANSCRIPT' → empty-transcript, take kept", async () => {
    jobStatus.mockResolvedValueOnce({
      status: 'FAILED',
      karuteRecordId: null,
      attempts: 3,
      maxAttempts: 3,
      lastError: 'EMPTY_TRANSCRIPT',
    })
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000)
    expect(globalPipeline.error).toBe('empty-transcript')
    expect(deleteTake).not.toHaveBeenCalled()
  })

  it('FAILED with an unmapped lastError → unknown, take kept', async () => {
    jobStatus.mockResolvedValueOnce({
      status: 'FAILED',
      karuteRecordId: null,
      attempts: 3,
      maxAttempts: 3,
      lastError: 'some upstream 500',
    })
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000)
    expect(globalPipeline.error).toBe('unknown')
    expect(deleteTake).not.toHaveBeenCalled()
  })
})

describe('globalPipeline server-path poll cadence + cap (packet 22, Greptile #587 P2)', () => {
  it('a job alive past the 10-min fast window keeps polling on the slow cadence — no false failure', async () => {
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(10 * 60 * 1000) // burn the whole fast window; default mock stays QUEUED
    expect(globalPipeline.state).toBe('processing')
    expect(globalPipeline.error).toBeNull()
    // Now on the 30s cadence: the next tick finds it DONE and settles normally.
    jobStatus.mockResolvedValueOnce({
      status: 'DONE',
      karuteRecordId: 'record-2',
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
    })
    await tick(30_000)
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.serverSavedRecordId).toBe('record-2')
  })

  it('the 60-min absolute cap → unknown error, take KEPT', async () => {
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(60 * 60 * 1000 + 30_000) // past the backstop; job never settles
    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('unknown')
    expect(deleteTake).not.toHaveBeenCalled()
  })
})

describe('globalPipeline serverOwned = "a live server job DEFINITIVELY exists" (D-1, Greptile P1 r4)', () => {
  // The flag is the C-1 branch: true → the record page shows a passive notice
  // and hands the take over, false → it ASKS before superseding. So a true
  // that only means "the server path was attempted" silently drops the run it
  // claimed was safe. These pin the flag to the definitive answer, never the
  // attempt.
  it('t1: the staging window is NOT ownership — nothing has reached core yet', async () => {
    stageForJob.mockImplementationOnce(() => new Promise<{ path: string }>(() => {})) // never settles
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(enqueueJob).not.toHaveBeenCalled()
    expect(globalPipeline.state).toBe('processing')
    expect(globalPipeline.serverOwned).toBe(false)
  })

  it('t1b: staging FAILED with the probe dark → error, and still not owned (the take exists only here)', async () => {
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    jobStatus.mockRejectedValueOnce(new Error('network down')) // no definitive answer
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.serverOwned).toBe(false)
    warn.mockRestore()
  })

  it('t2: a COMMITTED enqueue IS ownership — core accepted the job', async () => {
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(globalPipeline.state).toBe('processing')
    expect(globalPipeline.serverOwned).toBe(true)
  })

  it('t3: the ambiguous window is NOT ownership — the confirm stays armed while we do not know', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus.mockRejectedValue(new Error('network down')) // never answers
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(globalPipeline.serverOwned).toBe(false)
    await tick(30_000) // deep into the 90s resolution budget, still no answer
    expect(globalPipeline.state).toBe('processing')
    expect(globalPipeline.serverOwned).toBe(false)
    warn.mockRestore()
  })

  it('t4: ambiguity that RESOLVES to a live job flips ownership on — notice from then, not confirm', async () => {
    enqueueJob.mockRejectedValueOnce(new Error('response lost'))
    jobStatus
      .mockRejectedValueOnce(new Error('network down')) // probe 1: dark → not owned
      .mockResolvedValue({ status: 'RUNNING', karuteRecordId: null, attempts: 1, maxAttempts: 3, lastError: null })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(globalPipeline.serverOwned).toBe(false)
    await tick(5000) // re-probe finds the committed job → poll it
    expect(globalPipeline.state).toBe('processing')
    expect(globalPipeline.serverOwned).toBe(true)
    warn.mockRestore()
  })

  it('an in-tab run superseding an owned one clears ownership (the walk-in is on its own)', async () => {
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(globalPipeline.serverOwned).toBe(true)
    globalPipeline.start(new Blob(['b']), { locale: 'ja', customers: [] }) // walk-in → in-tab
    await tick(0)
    expect(mockDeferreds).toHaveLength(1)
    expect(globalPipeline.serverOwned).toBe(false)
  })
})

describe('globalPipeline server-path supersession (packet 22)', () => {
  it('a new start() mid-poll supersedes — the stale poll settles nothing', async () => {
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    await tick(5000) // one tick, still QUEUED (persistent default mock)
    const staleRunId = globalPipeline.runId

    // Supersede with a walk-in (in-tab path).
    globalPipeline.start(new Blob(['b']), { locale: 'ja', customers: [] })
    await tick(0)
    expect(globalPipeline.runId).not.toBe(staleRunId)

    // If the stale poll's guard were broken, this DONE would wrongly settle it.
    jobStatus.mockResolvedValueOnce({
      status: 'DONE',
      karuteRecordId: 'record-x',
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
    })
    await tick(5000)

    expect(globalPipeline.state).toBe('processing') // the NEW in-tab run, untouched
    expect(globalPipeline.serverSavedRecordId).toBeNull()
  })
})
