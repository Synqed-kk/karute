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
  | { error: string }

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
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
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

  it('no recordingSessionId (e.g. take-recovery accept) → in-tab path, no staging', async () => {
    globalPipeline.start(new Blob(['a']), { ...eligibleCtx, recordingSessionId: undefined })
    await tick(0)
    expect(stageForJob).not.toHaveBeenCalled()
    expect(mockDeferreds).toHaveLength(1)
  })
})

describe('globalPipeline server-path pre-enqueue fallback (packet 22)', () => {
  it('stageForJob throws → falls back to the in-tab path with the SAME blob/context', async () => {
    stageForJob.mockRejectedValueOnce(new Error('upload failed'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(enqueueJob).not.toHaveBeenCalled()
    expect(mockDeferreds).toHaveLength(1) // in-tab fallback fired
    expect(globalPipeline.context).toEqual(eligibleCtx)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('enqueueJob returns {error} → falls back to the in-tab path', async () => {
    enqueueJob.mockResolvedValueOnce({ error: 'no staff identity' })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), eligibleCtx)
    await tick(0)
    expect(mockDeferreds).toHaveLength(1)
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
