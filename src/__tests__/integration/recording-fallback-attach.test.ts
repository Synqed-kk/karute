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
const adoptTakeSession = jest.fn(async (_takeId: string, session: string, path: string) => {
  if (!store.meta || store.meta.recordingSessionId || store.meta.finalizedAt) return false
  store.meta = { ...store.meta, recordingSessionId: session, finalizedAt: 1, finalizedPath: path }
  return true
})
// S49 harness: secureTake stamps the row the attach minted through this door.
// First write wins and a missing take is a no-op — the shape of take-store's
// stampTakeSession (the real one is pinned in take-durability.test.ts).
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
  // S53 A4: the fallback's key pin (take-store's own is pinned in take-durability).
  pinTakeFallback: async () => {},
  isStoppedTake: () => false,
  markTakeFinalized: (id: string, path: string) => markTakeFinalized(id, path),
  markTakeSecureError: (id: string, code: string) => markTakeSecureError(id, code),
  markTakeStartBoundAttempted: async () => {},
  // First stamp wins, and the take is secured at the minted key in the same
  // write — the shape of take-store's adoptTakeSession (the real one is pinned
  // in take-durability.test.ts, S34 T3/T7).
  adoptTakeSession: (id: string, session: string, path: string) => adoptTakeSession(id, session, path),
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
// S49 harness: the session door answers the row a test names (null = it
// failed, today's default). Reset before every case, so no answer leaks.
let startSessionAnswer: { id: string } | null = null
const startSession = jest.fn(async (_input?: Record<string, unknown>): Promise<{ id: string } | null> => startSessionAnswer)
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
    startSession: (i?: Record<string, unknown>) => startSession(i),
  }),
}))

const put = jest.fn(async (_url: string, _init: { body: Blob }) => ({ ok: true, status: 200 }) as Response)
global.fetch = put as unknown as typeof fetch

import { runAIPipeline, takeLengthSeconds, type PipelineContext } from '@/lib/ai-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

const memory = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
const run = (ctx: PipelineContext = {}) =>
  runAIPipeline(memory, TAKE, 'ja', () => {}, { durationSeconds: 42, ...ctx })

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  store.meta = null
  store.blob = null
  startSessionAnswer = null
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
    expect(prepareTranscription).toHaveBeenCalledWith(memory, TAKE_KEY, { takeRow: SESSION })
  })

  it('store lost the take: the in-memory recording goes under the take key on the context session', async () => {
    await run({ recordingSessionId: SESSION })
    expect(mintTakeUrl).toHaveBeenCalledWith(TAKE, 'audio/webm', SESSION)
    expect(put.mock.calls[0][1].body).toBe(memory)
    expect(finalizeTake).toHaveBeenCalledWith(expect.objectContaining({ recordingSessionId: SESSION, durationSeconds: 42 }))
    // S46: the store holds no meta for this take, so no row is known to send —
    // the door keeps today's answer (a no-row case), never a guessed row.
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
    expect(prepareTranscription).toHaveBeenCalledWith(memory, TAKE_KEY, { takeRow: SESSION })
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
    // S35 C1: the take's 42 s stop stamp rides along — the row is born with it.
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'no_session', durationSeconds: 42 })
    expect(store.meta?.recordingSessionId).toBe(MINTED_ROW)
    // …and SECURED at the key just PUT on that row, in the same write (Greptile #1039).
    expect(adoptTakeSession).toHaveBeenCalledWith(TAKE, MINTED_ROW, 'app_biz-1_server-named.webm')
    expect(store.meta?.finalizedPath).toBe('app_biz-1_server-named.webm')
    expect(store.meta?.finalizedAt).toEqual(expect.any(Number))
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
    expect(prepareTranscription.mock.calls).toEqual([[memory, null, { attachOutcome: 'no_session', durationSeconds: 42 }]])
    expect(adoptTakeSession).not.toHaveBeenCalled()
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
    // The store's own guard is what refuses (first stamp wins) — and nothing is marked.
    expect(adoptTakeSession).toHaveBeenCalledWith(TAKE, MINTED_ROW, 'app_biz-1_server-named.webm')
    expect(store.meta?.recordingSessionId).toBe(SESSION)
    expect(store.meta?.finalizedPath).toBeUndefined()
    expect(onSessionAdopted).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(...adoptLog(false))
  })

  it('T3 the run context names A (the store lost the take) → refused before the store is asked', async () => {
    finalizeTake.mockResolvedValueOnce({ error: 'size_mismatch' })
    serverNames(MINTED_ROW)
    const onSessionAdopted = jest.fn()
    await run({ recordingSessionId: SESSION, onSessionAdopted })
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'attach_failed' })
    expect(adoptTakeSession).not.toHaveBeenCalled()
    expect(onSessionAdopted).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(...adoptLog(false))
  })

  it('T8 adoption refused (the run context is keyed) → the store take gets NO finalized mark', async () => {
    // The store holds a session-less take whose attach failed (no row could be
    // minted for it), while the run's context names A; the server returns X anyway.
    store.meta = { ...NO_SESSION_TAKE }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    serverNames(MINTED_ROW)
    const onSessionAdopted = jest.fn()
    await run({ recordingSessionId: SESSION, onSessionAdopted })
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'attach_failed' })
    expect(adoptTakeSession).not.toHaveBeenCalled()
    expect(store.meta?.recordingSessionId).toBeUndefined()
    expect(store.meta?.finalizedAt).toBeUndefined()
    expect(store.meta?.finalizedPath).toBeUndefined()
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
    expect(adoptTakeSession).not.toHaveBeenCalled()
    expect(onSessionAdopted).toHaveBeenCalledWith(MINTED_ROW)
    expect(info).toHaveBeenCalledWith('[ai-pipeline] adopted minted session', { takeId: null, adopted: true })
  })
})

// ── ⚖ S35 C1 — THE ROW THE SERVER MAKES IS BORN WITH ITS LENGTH ──────────────
// That row is never finalized, so the 'no_session' body carries what finalize
// writes on a row that had one from the start: the take's stop stamp in whole
// seconds (finalize-take.ts floors it). The server half is pinned in
// mint-take-unbound-bind.test.ts; the two ports in recording-port-web-upload
// and thin-discard-transcript-port.
describe('S35 C1 — the no_session fallback sends the take length', () => {
  const lastOpts = () => prepareTranscription.mock.calls.at(-1)?.[2] as Record<string, unknown>

  it('T1 a 63,400 ms stop stamp → durationSeconds 63, beside the visit', async () => {
    store.meta = { mimeType: 'audio/webm', durationMs: 63_400, startedAt: 0, updatedAt: 1 }
    await run({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(lastOpts()).toEqual({ attachOutcome: 'no_session', customerId: 'cust-1', appointmentId: 'appt-1', durationSeconds: 63 })
  })

  it.each([
    ['0', 0],
    ['NaN', NaN],
    ['absent (the stop never stamped)', undefined],
  ])('T2 durationMs %s → no length is sent, never a made-up 0', async (_label, durationMs) => {
    store.meta = { mimeType: 'audio/webm', durationMs, startedAt: 0, updatedAt: 1 }
    await run()
    expect(lastOpts().attachOutcome).toBe('no_session')
    expect(lastOpts().durationSeconds).toBeUndefined()
  })

  it('T2 no take at all → no length', async () => {
    await runAIPipeline(memory, null, 'ja', () => {}, { durationSeconds: 42 })
    expect(lastOpts()).toEqual({ attachOutcome: 'no_session' })
    expect(lastOpts().durationSeconds).toBeUndefined()
  })

  it('T4 a recording that HAS a row never sends it: attach_failed, and the finalized path', async () => {
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 63_400, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    mintTakeUrl.mockResolvedValueOnce({ error: 'reserved_elsewhere' })
    await run()
    expect(lastOpts()).toStrictEqual({ attachOutcome: 'attach_failed' })
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 63_400, startedAt: 0, updatedAt: 1 }
    await run()
    expect(prepareTranscription).toHaveBeenLastCalledWith(memory, TAKE_KEY, { takeRow: SESSION })
  })

  it('takeLengthSeconds — whole seconds, floored as finalize floors them; nothing honest → undefined', () => {
    expect(takeLengthSeconds(63_400)).toBe(63)
    expect(takeLengthSeconds(63_900)).toBe(63)
    expect(takeLengthSeconds(1_000)).toBe(1)
    for (const v of [undefined, 0, 999, -5_000, NaN, Infinity]) expect(takeLengthSeconds(v)).toBeUndefined()
  })
})

// ── ⚖ S49 — A ROW THE ATTACH MINTED IS THE RUN'S ROW ─────────────────────────
// The recording started with no row (both start-time mints failed), so the
// attach (secureTake) minted the take's own row X, stamped it on the take and
// PUT the audio there. Until S49 the run's context never heard of X: the karute
// saved unlinked, the 「この端末にのみ残ります」 notice kept showing while the
// audio already sat on X, and X later surfaced as 復元可能 — a second karute
// for the same visit. This file has no save seam of its own (the save reads
// globalPipeline.context.recordingSessionId in ProcessingIndicator.tsx and
// RecordPageView.tsx), so the context is what is asserted. Every id is invented.
describe('S49 — a row minted during the attach is adopted into the run', () => {
  const ROW_X = 'rs_minted_x'
  const ROW_Y = 'rs_known_y'
  const NO_ROW_TAKE = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
  /** The recording started with no row, the take's bytes are on the device,
   *  and the session door answers X when the attach knocks. */
  const noLinkTake = () => {
    store.meta = { ...NO_ROW_TAKE }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    startSessionAnswer = { id: ROW_X }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const settle = async () => {
    for (let i = 0; i < 200 && globalPipeline.state === 'processing'; i++) await tick()
  }
  const outcome = (onSessionAdopted: jest.Mock) => ({
    told: onSessionAdopted.mock.calls,
    sessionDoorAsked: startSession.mock.calls.length,
    mints: mintTakeUrl.mock.calls,
    finalizedOn: finalizeTake.mock.calls.map(([input]) => input.recordingSessionId),
    transcribeAsked: prepareTranscription.mock.calls.map(([, path, opts]) => [path, opts]),
    take: { row: store.meta?.recordingSessionId, key: store.meta?.finalizedPath },
  })
  /** Case 1's outcome — one row (X), told once, the take's own key sent with it. */
  const ADOPTED_X = {
    told: [[ROW_X]],
    sessionDoorAsked: 1,
    mints: [[TAKE, 'audio/webm', ROW_X]],
    finalizedOn: [ROW_X],
    transcribeAsked: [[TAKE_KEY, { takeRow: ROW_X }]],
    take: { row: ROW_X, key: TAKE_KEY },
  }
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => globalPipeline.reset())

  it('1 — the attach mints X for the take → the run is told X once; one row, no second', async () => {
    noLinkTake()
    const onSessionAdopted = jest.fn()
    await run({ onSessionAdopted })
    expect(outcome(onSessionAdopted)).toEqual(ADOPTED_X)
    expect(stampTakeSession).toHaveBeenCalledWith(TAKE, ROW_X)
    expect(finalizeTake).toHaveBeenCalledWith(expect.objectContaining({ takeId: TAKE, recordingSessionId: ROW_X }))
    // The unbound door was never asked to make a row, so there is nothing else to adopt.
    expect(adoptTakeSession).not.toHaveBeenCalled()
    // Told AFTER the attach (X exists only then), before the transcribe door is asked.
    const [finalized] = finalizeTake.mock.invocationCallOrder
    const [told] = onSessionAdopted.mock.invocationCallOrder
    const [asked] = prepareTranscription.mock.invocationCallOrder
    expect(finalized).toBeLessThan(told)
    expect(told).toBeLessThan(asked)
  })

  it('2 — through the real pipeline: the context the save and the 破棄 read names X, and the notice stands down', async () => {
    noLinkTake()
    globalPipeline.start(memory, {
      locale: 'ja',
      customers: [],
      takeId: TAKE,
      duration: 42,
      recordingSessionId: null,
      serverRowMissing: true,
    })
    await settle()
    expect(globalPipeline.state).toBe('review')
    // What the save hands saveKaruteRecordInline as recordingSessionId
    // (→ recording_session_id) — no save seam in this file, so the context itself.
    expect(globalPipeline.context?.recordingSessionId).toBe(ROW_X)
    // The 「この端末にのみ残ります」 notice reads this: the row holds the audio now.
    expect(globalPipeline.context?.serverRowMissing).toBe(false)
    expect(mintTakeUrl.mock.calls).toEqual([[TAKE, 'audio/webm', ROW_X]])
    expect(store.meta?.recordingSessionId).toBe(ROW_X)
  })

  it('3 — the run already names Y → never overwritten: nobody is told', async () => {
    noLinkTake()
    const onSessionAdopted = jest.fn()
    await run({ recordingSessionId: ROW_Y, onSessionAdopted })
    // The take itself carries X (secureTake follows the take's own stamp —
    // unchanged by S49), so only the guard stands between X and the run.
    expect(store.meta?.recordingSessionId).toBe(ROW_X)
    expect(prepareTranscription).toHaveBeenCalledWith(memory, TAKE_KEY, { takeRow: ROW_X })
    expect(onSessionAdopted).not.toHaveBeenCalled()
  })

  it('3 — through the real pipeline the context still reads Y', async () => {
    noLinkTake()
    globalPipeline.start(memory, { locale: 'ja', customers: [], takeId: TAKE, duration: 42, recordingSessionId: ROW_Y })
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(globalPipeline.context?.recordingSessionId).toBe(ROW_Y)
  })

  it('4 — a superseded run’s late adoption is dropped: the newer run’s context is untouched', async () => {
    noLinkTake()
    // Run A's attach waits at the session door until run B has taken over.
    let answerA: (v: { id: string } | null) => void = () => {}
    startSession.mockImplementationOnce(() => new Promise((r) => (answerA = r)))
    const adopt = jest.spyOn(globalPipeline, 'adoptRecordingSession')
    globalPipeline.start(memory, {
      locale: 'ja',
      customers: [],
      takeId: TAKE,
      duration: 42,
      recordingSessionId: null,
      serverRowMissing: true,
    })
    const runA = globalPipeline.runId
    for (let i = 0; i < 200 && startSession.mock.calls.length === 0; i++) await tick()
    expect(startSession).toHaveBeenCalledTimes(1)
    // Run B supersedes A — another recording with no row either, so ONLY the
    // run guard can keep A's row out of B's context.
    globalPipeline.start(new Blob(['b'], { type: 'audio/webm' }), {
      locale: 'ja',
      customers: [],
      recordingSessionId: null,
      serverRowMissing: true,
    })
    const runB = globalPipeline.runId
    await settle()
    expect(globalPipeline.state).toBe('review')
    // A's attach resolves late: X is minted and stamped on A's take, and A's run hands it over…
    answerA({ id: ROW_X })
    for (let i = 0; i < 200 && prepareTranscription.mock.calls.length < 2; i++) await tick()
    for (let i = 0; i < 20; i++) await tick()
    expect(adopt).toHaveBeenCalledWith(runA, ROW_X)
    expect(store.meta?.recordingSessionId).toBe(ROW_X)
    // …and it is dropped: B is still the live run and its context is exactly as it started.
    expect(globalPipeline.runId).toBe(runB)
    expect(globalPipeline.state).toBe('review')
    expect(globalPipeline.context?.recordingSessionId).toBeNull()
    expect(globalPipeline.context?.serverRowMissing).toBe(true)
    adopt.mockRestore()
  })

  // The lane's forced-switch convention (mint-take-unbound-bind.test.ts):
  // forced for one describe, restored after every case. Neither secure-take.ts
  // nor ai-pipeline.ts reads the switch, so both states must give case 1's outcome.
  describe.each([true, false])('5 — switch parity: bindUnboundUploads forced %s', (value) => {
    let replaced: { restore(): void } | undefined
    beforeEach(() => {
      replaced = jest.replaceProperty(RECORDING_SWITCHES as { bindUnboundUploads: boolean }, 'bindUnboundUploads', value)
    })
    afterEach(() => replaced?.restore())

    it('the row the attach minted is adopted exactly as in case 1', async () => {
      expect(RECORDING_SWITCHES.bindUnboundUploads).toBe(value)
      noLinkTake()
      const onSessionAdopted = jest.fn()
      await run({ onSessionAdopted })
      expect(outcome(onSessionAdopted)).toEqual(ADOPTED_X)
    })
  })

  it('6 — no bytes, no row: no_session, and the new line never fires (the door names no row → nobody told)', async () => {
    store.meta = { ...NO_ROW_TAKE }
    // The session door WOULD answer — but a take with no bytes never knocks on it.
    startSessionAnswer = { id: ROW_X }
    const onSessionAdopted = jest.fn()
    await run({ onSessionAdopted })
    expect(startSession).not.toHaveBeenCalled()
    expect(mintTakeUrl).not.toHaveBeenCalled()
    expect(prepareTranscription.mock.calls).toEqual([[memory, null, { attachOutcome: 'no_session', durationSeconds: 42 }]])
    expect(adoptTakeSession).not.toHaveBeenCalled()
    expect(onSessionAdopted).not.toHaveBeenCalled()
  })

  it('6 — no_session where the unbound door names a row: the existing adoption tells the run exactly once', async () => {
    store.meta = { ...NO_ROW_TAKE }
    prepareTranscription.mockImplementationOnce(async () => ({
      body: { path: 'app_biz-1_server-named.webm' },
      path: 'app_biz-1_server-named.webm',
      recordingSessionId: ROW_X,
    }))
    const onSessionAdopted = jest.fn()
    await run({ onSessionAdopted })
    expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'no_session', durationSeconds: 42 })
    expect(adoptTakeSession).toHaveBeenCalledWith(TAKE, ROW_X, 'app_biz-1_server-named.webm')
    expect(onSessionAdopted.mock.calls).toEqual([[ROW_X]])
  })

  it('no-op (i) — the ordinary take: secured at stop, the run already names its row', async () => {
    store.meta = { ...NO_ROW_TAKE, recordingSessionId: SESSION, finalizedAt: 1, finalizedPath: TAKE_KEY }
    const onSessionAdopted = jest.fn()
    await run({ recordingSessionId: SESSION, onSessionAdopted })
    expect(mintTakeUrl).not.toHaveBeenCalled()
    expect(prepareTranscription.mock.calls).toEqual([[memory, TAKE_KEY, { takeRow: SESSION }]])
    expect(onSessionAdopted).not.toHaveBeenCalled()
  })

  it('no-op (iii) — attach_failed: no finalized key, so no takeRow, so the new line never fires', async () => {
    noLinkTake()
    mintTakeUrl.mockResolvedValueOnce({ error: 'reserved_elsewhere' })
    const onSessionAdopted = jest.fn()
    await run({ onSessionAdopted })
    expect(prepareTranscription.mock.calls).toEqual([[memory, null, { attachOutcome: 'attach_failed' }]])
    expect(onSessionAdopted).not.toHaveBeenCalled()
  })
})
