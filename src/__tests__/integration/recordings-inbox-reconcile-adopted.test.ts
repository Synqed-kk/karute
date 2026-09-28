/**
 * S52-A — 録音履歴's reconcile-on-error for an ADOPTED take, driven through the
 * REAL door.
 *
 * Since S49 (#1074) ai-pipeline hands a run the row its own attach minted
 * (`if (takeRow && !ctx.recordingSessionId) ctx.onSessionAdopted?.(takeRow)`),
 * so a run that fails AFTER that adoption now carries a session id into
 * inbox-store's `reconcilePipelineWithRows` — which, when the row "speaks for"
 * the failure, calls `globalPipeline.reset()`: the card, its context and its
 * in-memory blob go. The piece-b tests in recordings-inbox-store.test.ts set
 * that context by hand against a mocked pipeline; nothing drove the real one.
 *
 * Here: real ai-pipeline + real secure-take + real globalPipeline + real
 * inbox-store + the real fold. The take store, the ports, the recorder, the
 * network and the server's inbox read are faked — the take-store / port shim is
 * the shape recording-fallback-attach.test.ts's S49 block uses (jest.mock is
 * per file, so it is restated, not forked: same fields, same first-stamp-wins
 * doors), plus the three reads the inbox makes. Every id is invented.
 */
const awaitTakeSecured = jest.fn<Promise<void>, [takeId: string]>(async () => {})
jest.mock('@/lib/global-recorder', () => ({
  // takeId: what readLocalTakes excludes as the recorder's live take (none here).
  globalRecorder: { takeId: null, awaitTakeSecured: (takeId: string) => awaitTakeSecured(takeId) },
}))

type Meta = {
  recordingSessionId?: string
  mimeType?: string
  durationMs?: number
  finalizedAt?: number
  finalizedPath?: string
  secureError?: string
  startedAt: number
  updatedAt: number
}
/** `listed` = the real listOwnTakes would return this take right now. It is
 *  false inside the 20 s ACTIVE_GRACE_MS after the last flush
 *  (take-store.ts:1559) — the window a fast failure's first fold lands in. */
const store = { meta: null as Meta | null, blob: null as Blob | null, listed: true }
const markTakeFinalized = jest.fn(async (_takeId: string, path: string) => {
  if (store.meta) store.meta = { ...store.meta, finalizedAt: 1, finalizedPath: path }
})
// First write wins, a missing take is a no-op — take-store's stampTakeSession.
const stampTakeSession = jest.fn(async (_takeId: string, session: string) => {
  if (!store.meta || store.meta.recordingSessionId) return false
  store.meta = { ...store.meta, recordingSessionId: session }
  return true
})
/** Nothing in this flow may destroy the take — both doors are spied on. */
const deleteTake = jest.fn<Promise<void>, [takeId: string]>(async () => {})
const settleTakeAfterSave = jest.fn<Promise<void>, [takeId: string]>(async () => {})
/** The real gates this models: owner + exclude (take-store.ts:1547), bytes on
 *  disk (:1557 lastSeq), the flush grace (:1559) as `listed`. */
const listOwnTakes = jest.fn(async (exclude: ReadonlyArray<string | null | undefined> = []) =>
  store.meta && store.blob && store.listed && !exclude.includes(TAKE)
    ? [
        {
          takeId: TAKE,
          recordingSessionId: store.meta.recordingSessionId,
          startedAt: store.meta.startedAt,
          updatedAt: store.meta.updatedAt,
          durationMs: store.meta.durationMs,
          secureError: store.meta.secureError,
        },
      ]
    : [],
)
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: async () => (store.meta ? { ...store.meta } : null),
  loadTakeBlob: async () => store.blob,
  ensureFinalizedPath: async (_id: string, meta: Meta) => meta.finalizedPath ?? null,
  readTakeTranscript: async () => null,
  stampTakeTranscript: async () => {},
  isStoppedTake: () => false,
  markTakeFinalized: (id: string, path: string) => markTakeFinalized(id, path),
  markTakeSecureError: async () => {},
  markTakeStartBoundAttempted: async () => {},
  adoptTakeSession: async () => false,
  stampTakeSession: (id: string, session: string) => stampTakeSession(id, session),
  settleTakeAfterSave: (id: string) => settleTakeAfterSave(id),
  deleteTake: (id: string) => deleteTake(id),
  listOwnTakes: (exclude?: ReadonlyArray<string | null | undefined>) => listOwnTakes(exclude),
  TERMINAL_SECURE_ERRORS: new Set(['reserved_elsewhere', 'exists', 'size_mismatch']),
  BINDING_SECURE_REFUSALS: new Set(['exists', 'reserved_elsewhere', 'not_reserved', 'superseded']),
}))

/** The transcribe door's answer: a 403 plan-gate refusal (one answer, no retry
 *  wait — ai-pipeline.ts fetchWithRetry) → the run fails 'unknown'; or an
 *  empty transcript → 'empty-transcript'. Adoption has already happened by then. */
let transcribeAnswer: 'refused' | 'empty' = 'refused'
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async () =>
      (transcribeAnswer === 'refused'
        ? { ok: false, status: 403, text: async () => JSON.stringify({ error: 'plan_gate' }) }
        : { ok: true, status: 200, json: async () => ({ transcript: '' }) }) as unknown as Response,
  }),
}))

const TAKE = '5e2a9c10-7b3d-4f8e-a1c2-3d4e5f6a7b8c'
const ROW_X = 'rs_s52a_minted_x'
const TAKE_KEY = `app_biz-1_${TAKE}.webm`
const mintTakeUrl = jest.fn<Promise<{ path: string; url: string; contentType: string }>, [takeId: string, mime: string, session: string]>(async () => ({
  path: TAKE_KEY,
  url: 'https://proj.supabase.co/upload/x',
  contentType: 'audio/webm',
}))
const finalizeTake = jest.fn<Promise<{ ok: true }>, [input: Record<string, unknown>]>(async () => ({ ok: true }))
/** The session door answers X when the attach knocks (both start mints failed). */
const startSession = jest.fn<Promise<{ id: string }>, [input?: Record<string, unknown>]>(async () => ({ id: ROW_X }))
const prepareTranscription = jest.fn(async (_blob: Blob, finalizedPath: string | null) => ({
  body: { path: finalizedPath },
  path: finalizedPath,
  recordingSessionId: null as string | null,
}))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    // The web arm: every run here is the in-tab run(), where S49's adoption lives.
    supportsServerJob: false,
    prepareTranscription: (b: Blob, p: string | null) => prepareTranscription(b, p),
    mintTakeUrl: (t: string, m: string, s: string) => mintTakeUrl(t, m, s),
    finalizeTake: (i: Record<string, unknown>) => finalizeTake(i),
    startSession: (i?: Record<string, unknown>) => startSession(i),
  }),
}))
const put = jest.fn<Promise<Response>, [url: string, init: { body: Blob }]>(async () => ({ ok: true, status: 200 }) as Response)
global.fetch = put as unknown as typeof fetch

const listRecordingsInbox = jest.fn(async (): Promise<unknown[]> => [])
jest.mock('@/actions/recordings-inbox', () => ({
  listRecordingsInbox: () => listRecordingsInbox(),
}))

import { globalPipeline } from '@/lib/global-pipeline'
import { getInboxState, loadInbox, resetInbox } from '@/lib/recordings/inbox-store'

const memory = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
const blobOf = () => (globalPipeline as unknown as { blob: Blob | null }).blob
const tick = () => new Promise((r) => setTimeout(r, 0))
const session = (over: Record<string, unknown>) => ({
  recordingSessionId: ROW_X,
  customerId: 'cust-1',
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  durationSeconds: 42,
  karuteRecordId: null,
  jobStatus: null,
  jobProbeFailed: false,
  jobLastError: null,
  ...over,
})
/** Everything the take-store holds for this recording, and whether anything
 *  tried to destroy it. */
const takeFacts = () => ({
  kept: !!store.meta && !!store.blob,
  row: store.meta?.recordingSessionId,
  key: store.meta?.finalizedPath,
  destroyCalls: deleteTake.mock.calls.length + settleTakeAfterSave.mock.calls.length,
})
const TAKE_UNTOUCHED = { kept: true, row: ROW_X, key: TAKE_KEY, destroyCalls: 0 }

/** THE REAL PATH: a take with bytes and no row; the recording's run starts with
 *  no session (both mints failed); the attach mints X and stamps it on the take
 *  (secureTake → stampTakeSession), ai-pipeline.ts:263 hands X to the run
 *  (onSessionAdopted → adoptRecordingSession), and the transcribe door fails. */
async function adoptedRunThatFails() {
  store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: Date.now() - 60_000, updatedAt: Date.now() - 1_000 }
  store.blob = new Blob(['stored'], { type: 'audio/webm' })
  const adopt = jest.spyOn(globalPipeline, 'adoptRecordingSession')
  globalPipeline.start(memory, {
    locale: 'ja',
    customers: [],
    takeId: TAKE,
    duration: 42,
    recordingSessionId: null,
    serverRowMissing: true,
  })
  const runId = globalPipeline.runId
  for (let i = 0; i < 200 && globalPipeline.state === 'processing'; i++) await tick()
  // The adoption came through the real door, from the take's own stamp.
  expect(stampTakeSession).toHaveBeenCalledWith(TAKE, ROW_X)
  expect(adopt.mock.calls).toEqual([[runId, ROW_X]])
  expect(prepareTranscription).toHaveBeenCalledWith(memory, TAKE_KEY)
  adopt.mockRestore()
  expect(globalPipeline.state).toBe('error')
  expect(globalPipeline.context?.recordingSessionId).toBe(ROW_X)
  expect(globalPipeline.context?.serverRowMissing).toBe(false)
  expect(globalPipeline.context?.takeId).toBe(TAKE)
  expect(blobOf()).toBe(memory)
  expect(takeFacts()).toEqual(TAKE_UNTOUCHED)
}

/** One fold against `rows`, awaited through its trailing re-run (the reset's
 *  own notify re-fires the pipeline watch inside the fold — inbox-store.ts:229). */
async function foldWith(rows: unknown[]) {
  listRecordingsInbox.mockImplementation(async () => rows)
  await loadInbox()
  for (let i = 0; i < 20; i++) await tick()
  await loadInbox()
}
const rowsFor = () =>
  getInboxState().rows.filter((r) => r.recordingSessionId === ROW_X || r.takeId === TAKE)
const cardFacts = () => ({
  state: globalPipeline.state,
  error: globalPipeline.error,
  session: globalPipeline.context?.recordingSessionId ?? null,
  // What the recovery banner's mount read excludes (RecordPageView.tsx:862).
  bannerExcludes: globalPipeline.context?.takeId ?? null,
  blob: blobOf(),
})
const STOOD_DOWN = { state: 'idle', error: null, session: null, bannerExcludes: null, blob: null }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  store.meta = null
  store.blob = null
  store.listed = true
  transcribeAnswer = 'refused'
  // The error transition itself triggers a fold (armPipelineWatch); until a
  // test names its rows, that fold sees nothing and reconciles nothing.
  listRecordingsInbox.mockImplementation(async () => [])
  resetInbox()
})

afterEach(() => {
  globalPipeline.reset()
  resetInbox()
})

describe('S52-A — the reconcile on a take adopted mid-run (real adoption door)', () => {
  it('(a) failed + canRetry (the take is on this device) → the card stands down; the take, its row stamp and ONE 再試行 door remain', async () => {
    await adoptedRunThatFails()
    await foldWith([session({ jobStatus: 'FAILED', jobLastError: 'boom' })])

    expect(cardFacts()).toEqual(STOOD_DOWN)
    expect(takeFacts()).toEqual(TAKE_UNTOUCHED)
    // One row for this recording — the take is folded INTO X's row, never a
    // second 復元可能 row beside it — and its 再試行 routes through the take.
    expect(rowsFor()).toEqual([
      expect.objectContaining({ state: 'failed', recordingSessionId: ROW_X, takeId: TAKE, canRetry: true }),
    ])
    expect(rowsFor()[0].serverAudio).toBeUndefined()
  })

  it('(b) failed + serverAudio (the take is inside its flush grace) → stands down; once listed, the SAME row carries the take — still one row', async () => {
    await adoptedRunThatFails()
    store.listed = false
    await foldWith([session({ jobStatus: 'FAILED', jobLastError: 'boom', serverAudio: 'object' })])

    expect(cardFacts()).toEqual(STOOD_DOWN)
    expect(takeFacts()).toEqual(TAKE_UNTOUCHED)
    expect(rowsFor()).toEqual([
      expect.objectContaining({ state: 'failed', takeId: null, canRetry: true, serverAudio: true }),
    ])

    // The grace passes: the device's take now pairs with X (inbox.ts:437-451),
    // the take path wins the 再試行 (inbox.ts:561-565), and no twin appears.
    store.listed = true
    await foldWith([session({ jobStatus: 'FAILED', jobLastError: 'boom', serverAudio: 'object' })])
    expect(rowsFor()).toEqual([
      expect.objectContaining({ state: 'failed', takeId: TAKE, canRetry: true }),
    ])
    expect(rowsFor()[0].serverAudio).toBeUndefined()
    expect(takeFacts()).toEqual(TAKE_UNTOUCHED)
  })

  it('(c) discarded by a colleague → stands down; the row is inert and the take is still kept, unchanged', async () => {
    await adoptedRunThatFails()
    await foldWith([session({ discardedByStaff: true })])

    expect(cardFacts()).toEqual(STOOD_DOWN)
    expect(takeFacts()).toEqual(TAKE_UNTOUCHED)
    expect(rowsFor()).toEqual([
      expect.objectContaining({ state: 'discarded', takeId: TAKE, canRetry: false }),
    ])
  })

  it('control — failed with NO way forward (no listed take, no server object) → the card, its session and its blob all stay', async () => {
    await adoptedRunThatFails()
    store.listed = false
    await foldWith([session({ jobStatus: 'FAILED', jobLastError: 'boom' })])

    expect(rowsFor()).toEqual([
      expect.objectContaining({ state: 'failed', takeId: null, canRetry: false }),
    ])
    expect(cardFacts()).toEqual({
      state: 'error',
      error: 'unknown',
      session: ROW_X,
      bannerExcludes: TAKE,
      blob: memory,
    })
    expect(takeFacts()).toEqual(TAKE_UNTOUCHED)
  })

  it('control (F3) — an adopted run that fails EMPTY-TRANSCRIPT keeps the card (its 破棄 door) even against a failed + canRetry row', async () => {
    transcribeAnswer = 'empty'
    await adoptedRunThatFails()
    expect(globalPipeline.error).toBe('empty-transcript')
    await foldWith([session({ jobStatus: 'FAILED', jobLastError: 'EMPTY_TRANSCRIPT' })])

    expect(rowsFor()).toEqual([
      expect.objectContaining({ state: 'failed', takeId: TAKE, canRetry: true }),
    ])
    expect(cardFacts()).toEqual({
      state: 'error',
      error: 'empty-transcript',
      session: ROW_X,
      bannerExcludes: TAKE,
      blob: memory,
    })
    expect(takeFacts()).toEqual(TAKE_UNTOUCHED)
  })
})
