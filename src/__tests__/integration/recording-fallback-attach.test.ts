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
  stampTakeSession: async () => true,
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

import { runAIPipeline } from '@/lib/ai-pipeline'

const memory = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
const run = (ctx: { recordingSessionId?: string | null; durationSeconds?: number } = {}) =>
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
