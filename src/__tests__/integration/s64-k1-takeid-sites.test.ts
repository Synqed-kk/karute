/**
 * PR-K commit 1, S66 K2 — the THREE `'takeId' in parsed` sites, each fed a
 * MARK key (`mrk/…`). RULING A2 nests a mark's target, so a mark result no
 * longer carries a top-level `takeId`; this file pins what that does at each
 * site. NO production edit at any of them in PR-K (K2) — only these tests.
 *
 * The sites, grepped at the base 808d49b6d (`'takeId' in parsed`):
 *   1. src/lib/recording/finalize-take.ts:354       — REACHABLE by a mark key
 *   2. src/lib/recording/discard-transcript.core.ts:411 — unreachable: guard at :273-280
 *   3. src/lib/jobs/process-recording.ts:426        — unreachable: guard at :249-251
 *
 * BASE BEHAVIOUR (the same file run at origin/main 808d49b6d in a detached
 * scratch worktree, /tmp/s66-k2-base — record: build-s64/BUILD-S64-PRK.md):
 *   1. finalize: a superseded row whose pointer is a mark key filed its
 *      recording.capture_unlinked row with `row_take_id` = the take id the
 *      MARK names (the flat parse's top-level takeId) — a mark read as a take.
 *      On the tip it is `null`: the N1 closure at this site.
 *   2. discard: a mark audioPath is `forbidden` before any read — at base and
 *      tip alike (the fence, not the site, is what a mark key meets).
 *   3. worker: a mark audio_path throws at the tenancy re-check before any
 *      signing or transcription — at base and tip alike.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'

const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

const info = jest.fn()
const createSignedUrl = jest.fn()
const createSignedUploadUrl = jest.fn()
const upload = jest.fn()
const download = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ info, createSignedUrl, createSignedUploadUrl, upload, download }) },
  }),
}))

const runMeteredTranscription = jest.fn()
jest.mock('@/lib/ai/transcribe', () => ({
  speakerIdMode: () => 'off',
  loadStaffReferenceForStaff: jest.fn(async () => null),
  runMeteredTranscription: (...a: unknown[]) => (runMeteredTranscription as (...a: unknown[]) => unknown)(...a),
}))
jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcomeWithClient: jest.fn(async () => ({})),
  REVISIT_NOT_ELIGIBLE: 'revisit_not_eligible',
  REVISIT_CHECK_UNAVAILABLE: 'revisit_check_unavailable',
}))
jest.mock('@/lib/ai/karute-extract', () => ({ runKaruteExtraction: jest.fn() }))
jest.mock('@/lib/ai/karute-summarize', () => ({ runKaruteSummary: jest.fn() }))
jest.mock('@/lib/diarized', () => ({ buildDiarizedTranscript: jest.fn(() => null), toSpeakerText: jest.fn(() => '') }))

const claim = jest.fn()
const complete = jest.fn(async () => ({}))
const fail = jest.fn(async () => ({}))
const workerCore = {
  recordingJobs: { claim, complete, fail },
  customers: { getConsent: jest.fn(), get: jest.fn() },
  orgSettings: { get: jest.fn() },
  karuteRecords: { getByRecordingSession: jest.fn(), create: jest.fn(), update: jest.fn() },
  recordingDiscards: { list: jest.fn(async () => ({ events: [] })) },
  staff: { get: jest.fn() },
  appointments: { get: jest.fn() },
}
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => workerCore) }))

import { finalizeTakeWithClient, type FinalizeTakeActor } from '@/lib/recording/finalize-take'
import { transcribeAndPersistDiscardWithClient } from '@/lib/recording/discard-transcript.core'
import { processRecordingJobs } from '@/lib/jobs/process-recording'
import { composeMarkKey, composeStagedKey, composeTakeKey } from '@/lib/recording/key-grammar'

const BIZ = 'biz-1'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const MARKED_TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const FINALIZING_TAKE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const TAKE_MARK = composeMarkKey(BIZ, composeTakeKey(BIZ, MARKED_TAKE, 'audio/webm')!.key, 'refused')!.key
// Spelled out, not composed: the base's composeMarkKey refuses a staged key,
// and the base run must feed the SAME string.
const STAGED_MARK = `mrk/${composeStagedKey(BIZ, SESSION, 'audio/webm', MARKED_TAKE)!.key}.partial.json`

/** Any read of the core client throws — proof a refusal happened before it. */
const untouchable = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`core read before the fence: ${String(prop)}`)
    },
  },
) as never

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe("site 1 — finalize-take.ts:354 (emitCaptureUnlinked's row_take_id)", () => {
  const actor: FinalizeTakeActor = {
    staffId: 'staff-1',
    businessId: BIZ,
    holdsOwnerKeys: false,
    allowedStoreIds: null,
    source: 'facade',
  }

  it.each([
    ['a take mark', TAKE_MARK],
    ['a staged mark', STAGED_MARK],
  ])('a job-owned row whose pointer is %s: superseded, and row_take_id is null (base: see the header)', async (_l, pointer) => {
    const get = jest.fn(async () => ({
      id: SESSION,
      business_id: BIZ,
      staff_id: 'staff-1',
      customer_id: 'cust-1',
      status: 'PROCESSING',
      audio_storage_path: pointer,
      duration_seconds: null,
      store_id: null,
    }))
    const synqed = { recordings: { get, update: jest.fn() } } as never
    const res = await finalizeTakeWithClient(synqed, actor, {
      takeId: FINALIZING_TAKE,
      mimeType: 'audio/webm',
      durationSeconds: 42,
      byteLength: 1024,
      recordingSessionId: SESSION,
    } as never)
    expect(res).toEqual({ error: 'superseded' })
    const events = auditFn.mock.calls.map(([e]) => e as { action: string; detail: Record<string, unknown> })
    expect(events.map((e) => e.action)).toEqual(['recording.capture_unlinked'])
    expect(events[0].detail).toEqual(expect.objectContaining({ take_id: FINALIZING_TAKE, row_take_id: null }))
    // A caller-named key is never probed on a superseded row.
    expect(info).not.toHaveBeenCalled()
  })
})

describe("site 2 — discard-transcript.core.ts:411 (the meter's takeId)", () => {
  it.each([
    ['a take mark', TAKE_MARK],
    ['a staged mark', STAGED_MARK],
  ])('%s as audioPath is refused `forbidden` by the fence before any read — the site is unreachable', async (_l, audioPath) => {
    const res = await transcribeAndPersistDiscardWithClient(
      untouchable,
      { staffId: 'staff-1', businessId: BIZ },
      { recordingSessionId: SESSION, audioPath, durationSeconds: 60, locale: 'ja' },
    )
    expect(res).toEqual({ error: 'forbidden' })
    expect(runMeteredTranscription).not.toHaveBeenCalled()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})

describe("site 3 — process-recording.ts:426 (the meter's takeId)", () => {
  it.each([
    ['a take mark', TAKE_MARK],
    ['a staged mark', STAGED_MARK],
  ])('%s as audio_path fails the job at the tenancy re-check — no sign, no transcription; the site is unreachable', async (_l, audio_path) => {
    claim
      .mockResolvedValueOnce({
        id: 'job-1',
        business_id: BIZ,
        recording_session_id: SESSION,
        status: 'RUNNING',
        attempts: 1,
        max_attempts: 3,
        payload: { customer_id: 'cust-1', staff_id: 'staff-1', appointment_id: null, audio_path },
      })
      .mockResolvedValueOnce(null)
    await expect(processRecordingJobs(10_000)).resolves.toEqual({ processed: 0, failed: 1 })
    expect(fail).toHaveBeenCalledWith('job-1', expect.stringContaining('audio_path does not belong'))
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(runMeteredTranscription).not.toHaveBeenCalled()
  })
})
