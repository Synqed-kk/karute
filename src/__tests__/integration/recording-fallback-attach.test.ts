/**
 * ⚖ THE IN-TAB FALLBACK ATTACHES TO THE TAKE'S OWN ROW (S33 option D).
 *
 * When runAIPipeline finds no finalized key, it first secures the take on the
 * row it was born on (ensureAudioOnServer → secureTake, or the in-memory blob
 * when the store has no bytes). Only if that fails does it use today's unbound
 * door, and then it says why: 'attach_failed' when the recording has a row (the
 * mint never creates a second one — mint-take-unbound-bind.test.ts pins that
 * half), 'no_session' when no row is known.
 *
 * Real ai-pipeline + real secure-take; the take store, the port, the recorder
 * and the network are faked.
 */
const awaitTakeSecured = jest.fn(async (_takeId: string) => {})
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: (takeId: string) => awaitTakeSecured(takeId) },
}))

type Meta = {
  recordingSessionId?: string
  mimeType?: string
  durationMs?: number
  finalizedAt?: number
  finalizedPath?: string
  discardPending?: unknown
  secureError?: string
  startedAt: number
  updatedAt: number
}
const store = { meta: null as Meta | null, blob: null as Blob | null }
const markTakeFinalized = jest.fn(async (_takeId: string, path: string) => {
  if (store.meta) store.meta = { ...store.meta, finalizedAt: 1, finalizedPath: path }
})
const markTakeSecureError = jest.fn(async (_takeId: string, _code: string) => {})
const stampTakeSession = jest.fn(async (_takeId: string, session: string) => {
  if (!store.meta || store.meta.recordingSessionId) return false
  store.meta = { ...store.meta, recordingSessionId: session }
  return true
})
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: async () => (store.meta ? { ...store.meta } : null),
  loadTakeBlob: async () => store.blob,
  ensureFinalizedPath: async (_id: string, meta: Meta) => meta.finalizedPath ?? null,
  readTakeTranscript: async () => null,
  stampTakeTranscript: async () => {},
  isStoppedTake: () => false,
  markTakeFinalized: (id: string, path: string) => markTakeFinalized(id, path),
  markTakeSecureError: (id: string, code: string) => markTakeSecureError(id, code),
  markTakeStartBoundAttempted: async () => {},
  // First stamp wins — the shape of take-store's own guard (ts:616-621; the
  // real guard is pinned in take-durability.test.ts, S34 T3).
  stampTakeSession: (id: string, session: string) => stampTakeSession(id, session),
  TERMINAL_SECURE_ERRORS: new Set(['reserved_elsewhere', 'exists', 'size_mismatch']),
}))

jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string) =>
      ({
        ok: true,
        json: async () =>
          url.endsWith('/transcribe') ? { transcript: 'こんにちは' } : url.endsWith('/extract') ? { entries: [] } : { summary: 'まとめ' },
      }) as unknown as Response,
  }),
}))

const TAKE = '0b8d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const TAKE_KEY = `app_biz-1_${TAKE}.webm`
type MintAnswer = { path: string; url: string; contentType: string } | { error: string }
const mintTakeUrl = jest.fn(
  async (_takeId: string, _mime: string, _session: string): Promise<MintAnswer> => ({
    path: TAKE_KEY,
    url: 'https://proj.supabase.co/upload/x',
    contentType: 'audio/webm',
  }),
)
const finalizeTake = jest.fn(async (_input: Record<string, unknown>): Promise<{ ok: true } | { error: string }> => ({ ok: true }))
const startSession = jest.fn(async () => null)
const prepareTranscription = jest.fn(async (_blob: Blob, finalizedPath: string | null, _opts?: unknown) => ({
  body: { path: finalizedPath ?? 'app_biz-1_server-named.webm' },
  path: finalizedPath ?? 'app_biz-1_server-named.webm',
  // Switch OFF: the server names no row.
  recordingSessionId: null as string | null,
}))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    prepareTranscription: (b: Blob, p: string | null, o?: unknown) => prepareTranscription(b, p, o),
    mintTakeUrl: (t: string, m: string, s: string) => mintTakeUrl(t, m, s),
    finalizeTake: (i: Record<string, unknown>) => finalizeTake(i),
    startSession: () => startSession(),
  }),
}))

const put = jest.fn(async (_url: string, _init: { body: Blob }) => ({ ok: true, status: 200 }) as Response)
global.fetch = put as unknown as typeof fetch

import { runAIPipeline, type PipelineContext } from '@/lib/ai-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'

const memory = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
const run = (ctx: PipelineContext = {}) =>
  runAIPipeline(memory, TAKE, 'ja', () => {}, { durationSeconds: 42, ...ctx })

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  store.meta = null
  store.blob = null
})

describe('t1 — a fallback with a known session lands on the ORIGINAL row, no new row', () => {
  it('store holds the take: secured under its own key on its own session, then transcribed from it', async () => {
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    await run()
    expect(mintTakeUrl).toHaveBeenCalledWith(TAKE, 'audio/webm', SESSION)
    expect(finalizeTake).toHaveBeenCalledWith(expect.objectContaining({ takeId: TAKE, recordingSessionId: SESSION }))
    expect(startSession).not.toHaveBeenCalled()
    // The unbound (row-creating) door is never reached: the port gets the take's own key.
    expect(prepareTranscription).toHaveBeenCalledWith(memory, TAKE_KEY, undefined)
  })

  it('store lost the take: the in-memory recording goes under the take key on the context session', async () => {
    await run({ recordingSessionId: SESSION })
    expect(mintTakeUrl).toHaveBeenCalledWith(TAKE, 'audio/webm', SESSION)
    expect(put.mock.calls[0][1].body).toBe(memory)
    expect(finalizeTake).toHaveBeenCalledWith(expect.objectContaining({ recordingSessionId: SESSION, durationSeconds: 42 }))
    expect(prepareTranscription).toHaveBeenCalledWith(memory, TAKE_KEY, undefined)
  })
})

describe('⚖ stored bytes win whenever the store holds any (S33 R2)', () => {
  it('the PUT carries the STORED take, never the longer in-memory blob', async () => {
    const stored = new Blob(['stored-prefix'], { type: 'audio/webm' })
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = stored
    await run({ recordingSessionId: SESSION })
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][1].body).toBe(stored)
  })
})

describe('t2 — the attach fails and a session is known → unbound, marked attach_failed', () => {
  it('reserved_elsewhere', async () => {
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    mintTakeUrl.mockResolvedValueOnce({ error: 'reserved_elsewhere' })
    await run()
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'attach_failed' })
  })

  it('store lost + context session + a finalize refusal', async () => {
    finalizeTake.mockResolvedValueOnce({ error: 'size_mismatch' })
    await run({ recordingSessionId: SESSION })
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'attach_failed' })
  })
})

describe('t3 — no session known → unbound as today, marked no_session', () => {
  it('store lost, no context session: nothing is minted under the take key', async () => {
    await run()
    expect(mintTakeUrl).not.toHaveBeenCalled()
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'no_session' })
  })

  it('no take at all: the port is asked exactly as before, plus the outcome', async () => {
    await runAIPipeline(memory, null, 'ja', () => {})
    expect(mintTakeUrl).not.toHaveBeenCalled()
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'no_session' })
  })
})

describe('t4 — a discardPending take is still secured (bytes are never gated)', () => {
  it('lands on its own (discarded) row, where the discard mark already is', async () => {
    store.meta = {
      recordingSessionId: SESSION,
      mimeType: 'audio/webm',
      durationMs: 42_000,
      discardPending: { recordingSessionId: SESSION, durationSeconds: 42, locale: 'ja', stampedAt: 1 },
      startedAt: 0,
      updatedAt: 1,
    }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    await run()
    expect(mintTakeUrl).toHaveBeenCalledWith(TAKE, 'audio/webm', SESSION)
    expect(markTakeFinalized).toHaveBeenCalledWith(TAKE, TAKE_KEY)
    expect(prepareTranscription).toHaveBeenCalledWith(memory, TAKE_KEY, undefined)
  })
})

// ── ⚖ S34, piece 3 — THE FALLBACK ADOPTS THE ROW THE SERVER MADE ─────────────
// With the switch ON, the unbound door creates a row for a take that had none
// and answers its id; the pipeline stamps it on the take and tells the run's
// context — which is what the save (ProcessingIndicator.tsx:147, ReviewScreen
// via RecordPageView.tsx:3213) and the 破棄 (RecordPageView.tsx:1317-1318) read.
describe('S34 — the fallback adopts the row the server made', () => {
  const MINTED_ROW = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b'
  const NO_SESSION_TAKE = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
  const serverNames = (id: string | null) =>
    prepareTranscription.mockImplementationOnce(async () => ({
      body: { path: 'app_biz-1_server-named.webm' },
      path: 'app_biz-1_server-named.webm',
      recordingSessionId: id,
    }))
  const adoptLog = (adopted: boolean) =>
    ['[ai-pipeline] adopted minted session', { takeId: TAKE, adopted }] as const
  let info: jest.SpyInstance
  beforeEach(() => {
    info = jest.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => globalPipeline.reset())

  it('T1 no_session + a minted row → the take carries it and the run is told', async () => {
    store.meta = { ...NO_SESSION_TAKE }
    serverNames(MINTED_ROW)
    const onSessionAdopted = jest.fn()
    await run({ onSessionAdopted })
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'no_session' })
    expect(store.meta?.recordingSessionId).toBe(MINTED_ROW)
    expect(onSessionAdopted).toHaveBeenCalledWith(MINTED_ROW)
    expect(info).toHaveBeenCalledWith(...adoptLog(true))
  })

  it('T1 through the real pipeline: the context the save and the 破棄 read names the adopted row', async () => {
    store.meta = { ...NO_SESSION_TAKE }
    serverNames(MINTED_ROW)
    globalPipeline.start(memory, {
      locale: 'ja',
      customers: [],
      takeId: TAKE,
      duration: 42,
      recordingSessionId: null,
      serverRowMissing: true,
    })
    for (let i = 0; i < 50 && globalPipeline.state === 'processing'; i++)
      await new Promise((r) => setTimeout(r, 0))
    expect(globalPipeline.state).toBe('review')
    // RecordPageView.tsx:1318 (破棄) and :3213 / ProcessingIndicator.tsx:147 (save) read exactly this.
    expect(globalPipeline.context?.recordingSessionId).toBe(MINTED_ROW)
    // …and the "audio stays on this device" notice stands down: the row holds it now.
    expect(globalPipeline.context?.serverRowMissing).toBe(false)
    expect(store.meta?.recordingSessionId).toBe(MINTED_ROW)
  })

  it('the run context is never overwritten, and a superseded run’s adoption is dropped', () => {
    globalPipeline.start(memory, { locale: 'ja', customers: [], recordingSessionId: SESSION })
    globalPipeline.adoptRecordingSession(globalPipeline.runId, MINTED_ROW)
    expect(globalPipeline.context?.recordingSessionId).toBe(SESSION)
    const stale = globalPipeline.runId
    globalPipeline.start(memory, { locale: 'ja', customers: [] })
    globalPipeline.adoptRecordingSession(stale, MINTED_ROW)
    expect(globalPipeline.context?.recordingSessionId).toBeUndefined()
  })

  it('T2 switch OFF: the server names no row → nothing stamped, nobody told, no log', async () => {
    store.meta = { ...NO_SESSION_TAKE }
    const onSessionAdopted = jest.fn()
    await run({ onSessionAdopted })
    expect(prepareTranscription.mock.calls).toEqual([[memory, null, { attachOutcome: 'no_session' }]])
    expect(stampTakeSession).not.toHaveBeenCalled()
    expect(store.meta?.recordingSessionId).toBeUndefined()
    expect(onSessionAdopted).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalledWith('[ai-pipeline] adopted minted session', expect.anything())
  })

  it('T3 attach_failed: the take names A, the server returns X anyway → A stays, adopted:false', async () => {
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    mintTakeUrl.mockResolvedValueOnce({ error: 'reserved_elsewhere' })
    serverNames(MINTED_ROW)
    const onSessionAdopted = jest.fn()
    await run({ onSessionAdopted })
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'attach_failed' })
    // The store's own guard is what refuses (first stamp wins).
    expect(stampTakeSession).toHaveBeenCalledWith(TAKE, MINTED_ROW)
    expect(store.meta?.recordingSessionId).toBe(SESSION)
    expect(onSessionAdopted).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(...adoptLog(false))
  })

  it('T3 the run context names A (the store lost the take) → refused before the store is asked', async () => {
    finalizeTake.mockResolvedValueOnce({ error: 'size_mismatch' })
    serverNames(MINTED_ROW)
    const onSessionAdopted = jest.fn()
    await run({ recordingSessionId: SESSION, onSessionAdopted })
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'attach_failed' })
    expect(stampTakeSession).not.toHaveBeenCalled()
    expect(onSessionAdopted).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(...adoptLog(false))
  })

  it('T5 no_session hands the port the visit; attach_failed hands none', async () => {
    await run({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(prepareTranscription).toHaveBeenLastCalledWith(memory, null, {
      attachOutcome: 'no_session',
      customerId: 'cust-1',
      appointmentId: 'appt-1',
    })
    finalizeTake.mockResolvedValueOnce({ error: 'size_mismatch' })
    await run({ recordingSessionId: SESSION, customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(prepareTranscription.mock.calls.at(-1)?.[2]).toStrictEqual({ attachOutcome: 'attach_failed' })
  })

  it('no take at all (the store never held it): the run is told, nothing is stamped', async () => {
    serverNames(MINTED_ROW)
    const onSessionAdopted = jest.fn()
    await runAIPipeline(memory, null, 'ja', () => {}, { onSessionAdopted })
    expect(stampTakeSession).not.toHaveBeenCalled()
    expect(onSessionAdopted).toHaveBeenCalledWith(MINTED_ROW)
    expect(info).toHaveBeenCalledWith('[ai-pipeline] adopted minted session', { takeId: null, adopted: true })
  })
})
