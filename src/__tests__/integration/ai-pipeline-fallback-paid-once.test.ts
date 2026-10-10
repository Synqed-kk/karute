/**
 * ⚖ C3 — A PAID FALLBACK TRANSCRIPTION IS PAID FOR ONCE PER RUN CHAIN.
 *
 * A take with no finalized key is transcribed through the unbound door, which
 * draws a NEW key on every mint (recording-upload-actions.test.ts pins that),
 * so neither the client memo nor the server memo could recognise a repeat: a
 * 再試行 after a later step failed (extract/summarize, an empty transcript)
 * minted, PUT and PAID again. The device now remembers the answer — the take
 * carries it (TakeMeta.transcript, marked `fallback`), and a take-less run keeps
 * it on globalPipeline's slot for its run chain. The replay rule:
 *   · no finalized key → the fallback answer, same locale;
 *   · a finalized key → only an answer paid for THAT key (the fallback PUT the
 *     in-memory blob, the attach PUTs the stored bytes — they can differ).
 * The key is the take's CURRENT one, re-read at the replay (C3 fold, Greptile
 * 1+2): a take finalized underneath the run is never handed the fallback's
 * answer, and a late fallback stamp never overwrites the finalized key's.
 * And with no finalized key, a fallback answer replays only onto the SAME audio
 * (C3 fold, Greptile P1): the stamp and the slot carry the fingerprint of what
 * the fallback sent (size + type, + length when both sides know one); a
 * recovery run's shorter blob is asked for, and a stamp with no fingerprint
 * never replays.
 *
 * Real ai-pipeline + secure-take + global-pipeline; the take store, the port,
 * the recorder and the network are faked. The fake port's unbound mint models
 * the server's switch arm (mint-take-url.ts:952-955: a row only when
 * bindUnboundUploads is ON and the outcome is 'no_session'), so the layer
 * matrix forces the switch the lane's way (jest.replaceProperty, as in
 * mint-take-unbound-bind.test.ts). Every id is invented; nothing leaves jest.
 */
import { createHash } from 'node:crypto'

jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: async () => {} },
}))

type Audio = { size: number; type: string; durationSeconds?: number; sha256?: string }
type Stamp = { finalizedPath: string; locale: string; response: unknown; at: number; fallback?: true; audio?: Audio }
type Meta = {
  recordingSessionId?: string
  mimeType?: string
  durationMs?: number
  finalizedAt?: number
  finalizedPath?: string
  startedAt: number
  updatedAt: number
  transcript?: Stamp
  fallbackPin?: Pin
}
type Pin = { finalizedPath: string; recordingSessionId: string | null; locale: string; audio: Audio; at: number; retiredAt?: number; retiredReason?: string }
const store = { meta: null as Meta | null, blob: null as Blob | null }
let onTranscriptRead: (() => void) | null = null
// The shape of take-store's stampTakeTranscript: whole body + path + locale,
// `fallback` only when the unbound door answered, `audio` when it was given
// (every fallback stamp — take-durability.test.ts pins the real one). A missing take is a no-op,
// and a fallback answer never lands on a take finalized at ANOTHER key (the
// store's own guard — take-durability.test.ts pins the real one).
const stampTakeTranscript = jest.fn(
  async (_id: string, path: string, locale: string, response: unknown, fallback?: boolean, audio?: Audio) => {
    if (!store.meta) return
    if (fallback && store.meta.finalizedPath && store.meta.finalizedPath !== path) return
    store.meta = {
      ...store.meta,
      transcript: {
        finalizedPath: path,
        locale,
        response,
        at: 1,
        ...(fallback ? { fallback: true as const } : {}),
        ...(audio ? { audio } : {}),
      },
    }
  },
)
// S53 A4: the key pin — same C3 guard as the stamp (take-durability pins the real one).
const pinTakeFallback = jest.fn(async (_id: string, pin: Omit<Pin, 'at'>) => {
  if (!store.meta) return
  if (store.meta.finalizedPath && store.meta.finalizedPath !== pin.finalizedPath) return
  store.meta = { ...store.meta, fallbackPin: { ...pin, at: 1 } }
})
// S54 F10: exactly this key's pin is MARKED retired, once — never deleted (take-durability pins the real one).
const retireTakeFallback = jest.fn(async (_id: string, path: string, retiredAt: number, retiredReason: string) => {
  const pin = store.meta?.fallbackPin
  if (!store.meta || !pin || pin.finalizedPath !== path || pin.retiredAt) return
  store.meta = { ...store.meta, fallbackPin: { ...pin, retiredAt, retiredReason } }
})
// First stamp wins; the take is secured at the minted key in the same write
// (take-durability.test.ts pins the real one). S54 F9: `adoptLost` counts down
// writes that are LOST (patchTakeMeta's tries exhausted → false, nothing written).
let adoptLost = 0
const adoptTakeSession = jest.fn(async (_id: string, session: string, path: string) => {
  if (adoptLost-- > 0) return false
  if (!store.meta || store.meta.recordingSessionId || store.meta.finalizedAt) return false
  store.meta = { ...store.meta, recordingSessionId: session, finalizedAt: 1, finalizedPath: path }
  return true
})
jest.mock('@/lib/karute/take-store', () => ({
  pinTakeFallback: (id: string, pin: Omit<Pin, 'at'>) => pinTakeFallback(id, pin),
  retireTakeFallback: (id: string, path: string, at: number, reason: string) => retireTakeFallback(id, path, at, reason),
  readTakeSecureMeta: async () => (store.meta ? { ...store.meta } : null),
  loadTakeBlob: async () => store.blob,
  ensureFinalizedPath: async (_id: string, meta: Meta) => meta.finalizedPath ?? null,
  readTakeTranscript: async () => {
    // One shot: what another tab / the drain does between this run's start and its replay.
    const underneath = onTranscriptRead
    onTranscriptRead = null
    underneath?.()
    return store.meta?.transcript ?? null
  },
  stampTakeTranscript: (id: string, path: string, locale: string, response: unknown, fallback?: boolean, audio?: Audio) =>
    stampTakeTranscript(id, path, locale, response, fallback, audio),
  isStoppedTake: () => false,
  markTakeFinalized: async (_id: string, path: string) => {
    if (store.meta) store.meta = { ...store.meta, finalizedAt: 1, finalizedPath: path }
  },
  markTakeSecureError: async () => {},
  markTakeStartBoundAttempted: async () => {},
  adoptTakeSession: (id: string, session: string, path: string) => adoptTakeSession(id, session, path),
  stampTakeSession: async (_id: string, session: string) => {
    if (!store.meta || store.meta.recordingSessionId) return false
    store.meta = { ...store.meta, recordingSessionId: session }
    return true
  },
  settleTakeAfterSave: async () => {},
  TERMINAL_SECURE_ERRORS: new Set(['reserved_elsewhere', 'exists', 'size_mismatch']),
}))

const TAKE = '3f9a1c2e-5b4d-4e6f-8a7b-1c2d3e4f5a6b'
const SESSION = '6d2e1f0a-3b4c-4d5e-9f8a-7b6c5d4e3f2a'
const TAKE_KEY = `app_biz-1_${TAKE}.webm`
const unbound = (n: number) => `app_biz-1_server-named-${n}.webm`

// The take-key mint (the attach). `refuseTakeMints` counts down: while > 0 the
// mint answers 'upstream' (a transient refusal — the attach can succeed later).
let refuseTakeMints = 0
const mintTakeUrl = jest.fn(async (_takeId: string, _mime: string, _session: string) =>
  refuseTakeMints-- > 0
    ? { error: 'upstream' }
    : { path: TAKE_KEY, url: 'https://proj.supabase.co/upload/take', contentType: 'audio/webm' },
)
const finalizeTake = jest.fn(async (_input: Record<string, unknown>) => ({ ok: true as const }))
let startSessionAnswer: { id: string } | null = null
const startSession = jest.fn(async (_input?: Record<string, unknown>) => startSessionAnswer)
// The transcribe leg's own mint. Finalized key → no mint, no PUT. Otherwise the
// unbound door: a NEW key every mint (mint-take-url.ts:910), a row only when
// the switch is ON and no row is known (mint-take-url.ts:952-955).
let unboundSeq = 0
/** S54: the hand-over the pipeline passed to the LAST port call — kept aside so
 *  every recorded call stays exactly what it was (the web arm fakes call it). */
type OnUploaded = (row: string, path: string) => Promise<void>
let lastOnUploaded: OnUploaded | undefined
const prepareTranscription = jest.fn(
  async (_blob: Blob, finalizedPath: string | null, opts?: { attachOutcome?: string; takeRow?: string }) => {
    if (finalizedPath) {
      const row = opts?.takeRow ?? null
      return { body: row ? { path: finalizedPath, recordingSessionId: row } : { path: finalizedPath }, path: finalizedPath, recordingSessionId: null }
    }
    const n = ++unboundSeq
    const row =
      RECORDING_SWITCHES.bindUnboundUploads && opts?.attachOutcome === 'no_session' ? `rs_minted_${n}` : null
    return { body: row ? { path: unbound(n), recordingSessionId: row } : { path: unbound(n) }, path: unbound(n), recordingSessionId: row }
  },
)
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    get refusesMissingKeyWith404() {
      return portRefuses404
    },
    prepareTranscription: (b: Blob, p: string | null, o?: { attachOutcome?: string; takeRow?: string }, u?: OnUploaded) => {
      lastOnUploaded = u
      return prepareTranscription(b, p, o)
    },
    mintTakeUrl: (t: string, m: string, s: string) => mintTakeUrl(t, m, s),
    finalizeTake: (i: Record<string, unknown>) => finalizeTake(i),
    startSession: (i?: Record<string, unknown>) => startSession(i),
  }),
}))

// The doors. Every /transcribe POST is a paid call; its answer names its own
// ordinal so a replay is told apart from a fresh one. extract answers 429 while
// `extractRefuses` (a refusal leaves on the FIRST answer — no 1.5 s wait).
const posts: string[] = []
let transcribeSeq = 0
let transcriptText = (n: number) => `answer-${n}`
let extractRefuses = false
/** Gates for the next /transcribe POSTs, in order (undefined = answer now). */
const transcribeGates: Array<Promise<void> | undefined> = []
/** S53 A4 — the network for the next /transcribe POSTs, in order (undefined =
 *  delivered): 'lose' = the server ran (and paid, and remembered) but the
 *  response never came back; 'unreached' = the request never left the device. */
const transcribeNet: Array<'lose' | 'unreached' | undefined> = []
/** S53 A4 — the server's memo (trc/<key>), modelled by key: null = off (every
 *  POST pays — what every pre-S53 case here asserts). On, a key already paid
 *  for replays its answer and pays nothing (the phone door's rule: own/no_row). */
let serverMemo: Map<string, unknown> | null = null
/** Called the moment a /transcribe POST reaches the server (S53 A4). */
let onTranscribeReached: (() => void) | null = null
/** S54 F10 — a refusal status for the next REACHED /transcribe POSTs, in order
 *  (undefined = answered): the door refuses before anything is paid. */
const transcribeStatus: Array<number | undefined> = []
/** S54 delta read — the port's `refusesMissingKeyWith404` (false = the web door, which never answers 404;
 *  true = the phone door) and the body a refused POST's 404 carries (default: not the phone door's code). */
let portRefuses404 = false
let refusalBody404 = '{"error":"refused"}'
/** S55 — the body a refused POST's NON-404 answer carries (default: no door code). */
let refusalBodyOther = '{"error":"refused"}'
let paidCalls = 0
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string, init?: { body?: string }) => {
      posts.push(url)
      if (url.endsWith('/transcribe')) {
        const net = transcribeNet.shift()
        if (net === 'unreached') throw new TypeError('Failed to fetch')
        onTranscribeReached?.()
        const refusedWith = transcribeStatus.shift()
        if (refusedWith) {
          const body = refusedWith === 404 ? refusalBody404 : refusalBodyOther
          // S55 — a REAL Fetch Response (Node's own undici), never a stand-in: its body reads ONCE. fetchWithRetry
          // reads this answer's text for its error message BEFORE the pipeline's catch runs, so the 404 rule can
          // only see the body through the clone() it took first — a second read of the same object throws
          // 'Body is unusable: Body has already been read', as on the phone. No body / a page → .json() throws.
          return new Response(body, { status: refusedWith })
        }
        const key = String((JSON.parse(init?.body ?? '{}') as { path?: unknown }).path)
        const remembered = serverMemo?.get(key)
        let body: unknown
        if (remembered !== undefined) body = remembered
        else {
          paidCalls++
          body = { transcript: transcriptText(++transcribeSeq) }
          serverMemo?.set(key, body)
        }
        const gate = transcribeGates.shift()
        if (gate) await gate
        if (net === 'lose') throw new TypeError('Failed to fetch')
        return { ok: true, json: async () => body } as unknown as Response
      }
      if (url.endsWith('/extract') && extractRefuses)
        return { ok: false, status: 429, text: async () => '{"error":"limit"}' } as unknown as Response
      const body = url.endsWith('/extract') ? { entries: [] } : { summary: 'まとめ' }
      return { ok: true, json: async () => body } as unknown as Response
    },
  }),
}))

// fetchWithRetry's 1.5 s pause before its one re-POST — run immediately here.
const realSetTimeout = global.setTimeout
jest
  .spyOn(global, 'setTimeout')
  .mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, ms === 1500 ? 0 : ms)) as typeof setTimeout)

const put = jest.fn(async (_url: string, _init: { body: Blob }) => ({ ok: true, status: 200 }) as Response)
global.fetch = put as unknown as typeof fetch

import { EmptyTranscriptError, runAIPipeline, type PipelineContext } from '@/lib/ai-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { AppApiError, errorBody } from '@/lib/app-api/errors'

const memory = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
/** A recovery's audio, assembled from the take's saved segments: the tail was never saved. */
const recovered = new Blob(['in-memory: every chunk'], { type: 'audio/webm' })
/** What the pipeline fingerprints: the blob's size + type, + the run's length when it knows one. */
const fp = (blob: Blob, durationSeconds?: number): Audio => ({
  size: blob.size,
  type: blob.type,
  ...(durationSeconds === undefined ? {} : { durationSeconds }),
})
/** S56: what a PIN fingerprints — the coarse fields plus the SHA-256 of the exact bytes, computed here with
 *  node:crypto (an implementation independent of the pipeline's Web Crypto, so a wrong-bytes hash cannot agree). */
const sha256Of = async (blob: Blob) => createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')
const pinFp = async (blob: Blob, durationSeconds?: number): Promise<Audio> => ({
  ...fp(blob, durationSeconds),
  sha256: await sha256Of(blob),
})
const transcribePosts = () => posts.filter((u) => u.endsWith('/transcribe')).length
const direct = (locale = 'ja', ctx: PipelineContext = {}, takeId: string | null = TAKE) =>
  runAIPipeline(memory, takeId, locale, () => {}, { durationSeconds: 42, ...ctx })
const outcome = (p: Promise<unknown>) => p.then(() => 'ok' as const, (e: unknown) => e)
const tick = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 400 && globalPipeline.state === 'processing'; i++) await tick()
}
/** The take-key mint refuses `times` attaches in a row; the take has a row and stored bytes. */
const takeWhoseAttachFails = (times: number) => {
  store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
  store.blob = new Blob(['stored'], { type: 'audio/webm' })
  refuseTakeMints = times
}
/** Forces the switch for one describe; restored after every case (mint-take-unbound-bind's helper). */
const forceSwitch = (value: boolean) => {
  let replaced: { restore(): void } | undefined
  beforeEach(() => {
    replaced = jest.replaceProperty(RECORDING_SWITCHES as { bindUnboundUploads: boolean }, 'bindUnboundUploads', value)
  })
  afterEach(() => replaced?.restore())
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  store.meta = null
  store.blob = null
  refuseTakeMints = 0
  startSessionAnswer = null
  unboundSeq = 0
  transcribeSeq = 0
  transcriptText = (n) => `answer-${n}`
  extractRefuses = false
  transcribeGates.length = 0
  transcribeNet.length = 0
  transcribeStatus.length = 0
  portRefuses404 = false
  refusalBody404 = '{"error":"refused"}'
  refusalBodyOther = '{"error":"refused"}'
  adoptLost = 0
  serverMemo = null
  onTranscribeReached = null
  paidCalls = 0
  posts.length = 0
  onTranscriptRead = null
})
afterEach(() => globalPipeline.reset())

describe('⚖ C3 — the take remembers the fallback answer it paid for', () => {
  it('(m1/m2) attach fails twice → ONE /transcribe POST: the 再試行 replays the paid answer (no mint, no PUT, no POST)', async () => {
    takeWhoseAttachFails(2)
    extractRefuses = true
    expect(await outcome(direct())).toBeInstanceOf(Error)
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: unbound(1), locale: 'ja', response: { transcript: 'answer-1' }, fallback: true })

    extractRefuses = false
    const result = await direct()
    expect(transcribePosts()).toBe(1)
    expect(prepareTranscription.mock.calls.map(([, path, opts]) => [path, opts])).toEqual([[null, { attachOutcome: 'attach_failed' }]])
    expect(result.transcript).toBe('answer-1')
    // The attach itself is still tried on the retry — it is not the paid leg.
    expect(mintTakeUrl).toHaveBeenCalledTimes(2)
  })

  it('(m3) fallback paid, attach succeeds on retry → door asked again for F (a fallback answer never rides onto a different key)', async () => {
    takeWhoseAttachFails(2)
    extractRefuses = true
    expect(await outcome(direct())).toBeInstanceOf(Error) // paid: the fallback
    expect(await outcome(direct())).toBeInstanceOf(Error) // attach fails again → replayed, free
    extractRefuses = false
    const result = await direct() // attach succeeds → F is a different object → asked
    expect(prepareTranscription.mock.calls.map(([, path]) => path)).toEqual([null, TAKE_KEY])
    expect(transcribePosts()).toBe(2)
    expect(result.transcript).toBe('answer-2')
    // …and F's own answer replaces the fallback's on the take.
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: TAKE_KEY, locale: 'ja', response: { transcript: 'answer-2' } })
    expect(store.meta?.transcript?.fallback).toBeUndefined()
  })

  it('(m4) ja then en → two POSTs (a retry in ja replays; en is a different answer)', async () => {
    takeWhoseAttachFails(3)
    extractRefuses = true
    await outcome(direct('ja'))
    await outcome(direct('ja'))
    await outcome(direct('en'))
    expect(transcribePosts()).toBe(2)
    expect(store.meta?.transcript).toMatchObject({ locale: 'en', response: { transcript: 'answer-2' }, fallback: true })
  })

  it('(m6) empty fallback replays with ZERO POSTs — the same EmptyTranscriptError, nothing asked', async () => {
    takeWhoseAttachFails(2)
    transcriptText = () => ''
    await expect(direct()).rejects.toBeInstanceOf(EmptyTranscriptError)
    expect(transcribePosts()).toBe(1)
    posts.length = 0
    await expect(direct()).rejects.toBeInstanceOf(EmptyTranscriptError)
    expect(posts).toHaveLength(0)
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
  })

  it('(n2) a non-fallback stamp never replays on the unbound arm', async () => {
    // The take holds an answer paid for key F (no `fallback` mark), but this run
    // has no finalized key (ensureFinalizedPath → null) and its attach fails: the
    // unbound door sends the in-memory blob, a different object than F — asked.
    takeWhoseAttachFails(1)
    store.meta = {
      ...store.meta!,
      transcript: { finalizedPath: TAKE_KEY, locale: 'ja', response: { transcript: 'paid-for-F' }, at: 1 },
    }
    const result = await direct()
    expect(transcribePosts()).toBe(1)
    expect(result.transcript).toBe('answer-1')
    expect(prepareTranscription.mock.calls.map(([, path, opts]) => [path, opts])).toEqual([[null, { attachOutcome: 'attach_failed' }]])
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: unbound(1), response: { transcript: 'answer-1' }, fallback: true })
  })

  describe('switch ON', () => {
    forceSwitch(true)
    it('(m7) no_session + minted X → retry = ZERO POSTs (the adopted key IS the key that was paid for)', async () => {
      // The recording has no row and the store no bytes: nothing to attach.
      store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
      extractRefuses = true
      expect(await outcome(direct())).toBeInstanceOf(Error)
      // S34's adoption ran untouched on the first run: the take is secured at the minted key.
      expect(store.meta?.recordingSessionId).toBe('rs_minted_1')
      expect(store.meta?.finalizedPath).toBe(unbound(1))
      posts.length = 0
      extractRefuses = false
      const result = await direct()
      expect(posts.filter((u) => u.endsWith('/transcribe'))).toHaveLength(0)
      expect(prepareTranscription).toHaveBeenCalledTimes(1)
      expect(result.transcript).toBe('answer-1')
    })
  })
})

describe('⚖ C3 fold — Greptile 1+2: a take finalized underneath the run', () => {
  /** What the drain / another tab does: the take is secured at `path` from its stored bytes. */
  const finalizeUnderneath = (path: string) => () => {
    store.meta = { ...store.meta!, finalizedAt: 1, finalizedPath: path }
  }

  it('(g1) finalized between the run’s read and the replay → NO replay of the fallback answer; the door is asked once (parity with main)', async () => {
    takeWhoseAttachFails(2)
    extractRefuses = true
    expect(await outcome(direct())).toBeInstanceOf(Error) // paid: the fallback, stamped at unbound(1)
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: unbound(1), fallback: true })
    // Run 2 reads NO finalized key at its start (its attach fails again); the
    // drain finalizes the take at F right before the replay.
    onTranscriptRead = finalizeUnderneath(TAKE_KEY)
    extractRefuses = false
    const result = await direct()
    expect(store.meta?.finalizedPath).toBe(TAKE_KEY)
    expect(transcribePosts()).toBe(2)
    expect(result.transcript).toBe('answer-2')
    expect(prepareTranscription.mock.calls.map(([, path, opts]) => [path, opts])).toEqual([
      [null, { attachOutcome: 'attach_failed' }],
      [null, { attachOutcome: 'attach_failed' }],
    ])
    // …and that second fallback answer never lands on the finalized take.
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: unbound(1), response: { transcript: 'answer-1' }, fallback: true })
  })

  it('(g1) …the chain’s slot is not replayed onto a take finalized underneath either', async () => {
    takeWhoseAttachFails(1)
    const paidFallback = { takeId: TAKE, locale: 'ja', response: { transcript: 'slot-answer' }, audio: fp(memory, 42) }
    onTranscriptRead = finalizeUnderneath(TAKE_KEY)
    const result = await direct('ja', { paidFallback })
    expect(transcribePosts()).toBe(1)
    expect(result.transcript).toBe('answer-1')
  })

  it('(g2) a slow fallback run’s stamp lands after a newer run paid for F → the take still names F; a third run replays F: TWO paid calls, not three', async () => {
    takeWhoseAttachFails(1)
    let openA!: () => void
    transcribeGates.push(new Promise<void>((r) => (openA = r)))
    const runA = direct() // no finalized key, attach fails → the fallback, its answer on the wire
    for (let i = 0; i < 200 && transcribePosts() === 0; i++) await tick()
    expect(transcribePosts()).toBe(1)
    // Meanwhile the take is finalized at F, and run B (newer, another lock) transcribes F.
    finalizeUnderneath(TAKE_KEY)()
    const runB = await direct()
    expect(runB.transcript).toBe('answer-2')
    expect(prepareTranscription.mock.calls.map(([, path]) => path)).toEqual([null, TAKE_KEY])
    openA() // A's paid answer lands LAST
    expect((await runA).transcript).toBe('answer-1')
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: TAKE_KEY, locale: 'ja', response: { transcript: 'answer-2' } })
    expect(store.meta?.transcript?.fallback).toBeUndefined()
    const third = await direct()
    expect(third.transcript).toBe('answer-2')
    expect(transcribePosts()).toBe(2)
  })

  it('(g3) a take-less run has no take to re-read: its slot still replays with ZERO POSTs, whatever the store holds', async () => {
    // The fake store answers every id; a guard that read a take for a take-less run would see F here.
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', finalizedAt: 1, finalizedPath: TAKE_KEY, startedAt: 0, updatedAt: 1 }
    const paidFallback = { takeId: null, locale: 'ja', response: { transcript: 'remembered' }, audio: fp(memory, 42) }
    const result = await direct('ja', { paidFallback }, null)
    expect(result.transcript).toBe('remembered')
    expect(transcribePosts()).toBe(0)
    expect(prepareTranscription).not.toHaveBeenCalled()
  })

  it('(g4′) finalized underneath at the fallback’s OWN minted key (another tab’s S34 adoption) → the answer paid for that key still replays, free', async () => {
    takeWhoseAttachFails(2)
    extractRefuses = true
    expect(await outcome(direct())).toBeInstanceOf(Error) // paid: the fallback at unbound(1)
    onTranscriptRead = finalizeUnderneath(unbound(1))
    extractRefuses = false
    const result = await direct()
    expect(result.transcript).toBe('answer-1')
    expect(transcribePosts()).toBe(1)
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
  })
})

describe('⚖ C3 fold — Greptile P1: a fallback answer replays only onto the audio it was paid for', () => {
  const recovery = (blob: Blob, ctx: PipelineContext = {}, takeId: string | null = TAKE) =>
    runAIPipeline(blob, takeId, 'ja', () => {}, { durationSeconds: 42, ...ctx })

  it('(f1) the take’s tail was never saved: a RECOVERY run’s shorter blob is asked for once, and its answer is stamped with its own fingerprint', async () => {
    expect(recovered.size).toBeLessThan(memory.size)
    expect(recovered.type).toBe(memory.type)
    takeWhoseAttachFails(2)
    extractRefuses = true
    expect(await outcome(direct())).toBeInstanceOf(Error) // paid: the fallback sent the in-memory recording
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: unbound(1), fallback: true, audio: fp(memory, 42) })
    extractRefuses = false
    const result = await recovery(recovered) // same take, same locale, same length — shorter audio
    expect(transcribePosts()).toBe(2)
    expect(result.transcript).toBe('answer-2')
    expect(prepareTranscription.mock.calls.map(([blob, path, opts]) => [blob, path, opts])).toEqual([
      [memory, null, { attachOutcome: 'attach_failed' }],
      [recovered, null, { attachOutcome: 'attach_failed' }],
    ])
    expect(store.meta?.transcript).toMatchObject({
      finalizedPath: unbound(2),
      locale: 'ja',
      response: { transcript: 'answer-2' },
      fallback: true,
      audio: fp(recovered, 42),
    })
  })

  it('(f2) the same audio in a NEW blob (a reload) → replayed, ZERO POSTs', async () => {
    takeWhoseAttachFails(2)
    extractRefuses = true
    expect(await outcome(direct())).toBeInstanceOf(Error)
    extractRefuses = false
    posts.length = 0
    const same = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
    const result = await recovery(same)
    expect(result.transcript).toBe('answer-1')
    expect(posts.filter((u) => u.endsWith('/transcribe'))).toHaveLength(0)
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
  })

  it('(f2′) the length counts only when both sides know one: 43 s ≠ 42 s is asked; an unknown length on the retry replays', async () => {
    takeWhoseAttachFails(3)
    extractRefuses = true
    expect(await outcome(direct())).toBeInstanceOf(Error) // paid at 42 s
    expect(await outcome(recovery(memory, { durationSeconds: undefined }))).toBeInstanceOf(Error) // unknown → replayed
    expect(transcribePosts()).toBe(1)
    extractRefuses = false
    const result = await recovery(memory, { durationSeconds: 43 }) // both known, different → asked
    expect(transcribePosts()).toBe(2)
    expect(result.transcript).toBe('answer-2')
  })

  it('(f3) the chain’s slot never replays onto a different-size blob (take-less); the new answer goes to the chain with its own fingerprint', async () => {
    const paidFallback = { takeId: null, locale: 'ja', response: { transcript: 'paid-for-memory' }, audio: fp(memory, 42) }
    const onFallbackPaid = jest.fn()
    const result = await recovery(recovered, { paidFallback, onFallbackPaid }, null)
    expect(result.transcript).toBe('answer-1')
    expect(transcribePosts()).toBe(1)
    expect(onFallbackPaid).toHaveBeenCalledWith({
      takeId: null,
      locale: 'ja',
      response: { transcript: 'answer-1' },
      audio: fp(recovered, 42),
    })
  })

  it('(f4) a fallback stamp with NO fingerprint (legacy) never replays: the door is asked once and the new stamp carries one', async () => {
    takeWhoseAttachFails(1)
    store.meta = {
      ...store.meta!,
      transcript: { finalizedPath: unbound(7), locale: 'ja', response: { transcript: 'legacy' }, at: 1, fallback: true },
    }
    const result = await direct()
    expect(result.transcript).toBe('answer-1')
    expect(transcribePosts()).toBe(1)
    expect(store.meta?.transcript).toMatchObject({ finalizedPath: unbound(1), response: { transcript: 'answer-1' }, audio: fp(memory, 42) })
  })

  it('(f5) S51 — the same size and length in a DIFFERENT type is different audio: the door is asked again (slot and stamp)', async () => {
    const webm = new Blob(['x'.repeat(1000)], { type: 'audio/webm' })
    const mp4 = new Blob(['x'.repeat(1000)], { type: 'audio/mp4' })
    const paidAudio = { size: 1000, type: 'audio/webm', durationSeconds: 12.5 }
    expect([fp(webm, 12.5), fp(mp4, 12.5)]).toEqual([paidAudio, { ...paidAudio, type: 'audio/mp4' }])
    const len = { durationSeconds: 12.5 }
    // The chain's slot (take-less): the same audio replays; only the type differs → asked.
    const paidFallback = { takeId: null, locale: 'ja', response: { transcript: 'paid-for-webm' }, audio: paidAudio }
    expect((await recovery(webm, { paidFallback, ...len }, null)).transcript).toBe('paid-for-webm')
    expect(transcribePosts()).toBe(0)
    expect((await recovery(mp4, { paidFallback, ...len }, null)).transcript).toBe('answer-1')
    expect(transcribePosts()).toBe(1)
    // The take's own fallback stamp: the same rule.
    takeWhoseAttachFails(2)
    const stamp = { finalizedPath: unbound(7), locale: 'ja', response: { transcript: 'paid-for-webm' }, at: 1, fallback: true as const, audio: paidAudio }
    store.meta = { ...store.meta!, transcript: stamp }
    expect((await recovery(webm, len)).transcript).toBe('paid-for-webm')
    expect(transcribePosts()).toBe(1)
    expect((await recovery(mp4, len)).transcript).toBe('answer-2')
    expect(transcribePosts()).toBe(2)
    expect(prepareTranscription.mock.calls.at(-1)).toEqual([mp4, null, { attachOutcome: 'attach_failed' }])
  })
})

describe('⚖ C3 — a take-less run chain keeps its paid answer on globalPipeline', () => {
  const takeless = { locale: 'ja', customers: [], takeId: null, recordingSessionId: null, serverRowMissing: true }

  it('(m5) a new recording after a failed one pays for its own audio (the slot is cleared by start())', async () => {
    const blobA = new Blob(['a'], { type: 'audio/webm' })
    const blobB = new Blob(['b'], { type: 'audio/webm' })
    extractRefuses = true
    globalPipeline.start(blobA, takeless)
    await settle()
    expect(globalPipeline.state).toBe('error')
    globalPipeline.retry() // same chain → replayed, free
    await settle()
    expect(globalPipeline.state).toBe('error')
    extractRefuses = false
    globalPipeline.start(blobB, takeless) // a NEW recording → its own audio, its own answer
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(transcribePosts()).toBe(2)
    expect(prepareTranscription.mock.calls.map(([blob]) => blob)).toEqual([blobA, blobB])
    expect(globalPipeline.result?.transcript).toBe('answer-2')
  })

  it('the slot replays in ja and asks again in en (a bare runAIPipeline call carries no chain and asks)', async () => {
    const paidFallback = { takeId: null, locale: 'ja', response: { transcript: 'remembered' }, audio: fp(memory, 42) }
    const ja = await direct('ja', { paidFallback }, null)
    expect(ja.transcript).toBe('remembered')
    expect(transcribePosts()).toBe(0)
    await direct('en', { paidFallback }, null)
    expect(transcribePosts()).toBe(1)
    await direct('ja', {}, null)
    expect(transcribePosts()).toBe(2)
  })

  it('(own m11) a slot paid for a different take never replays onto this one', async () => {
    takeWhoseAttachFails(1)
    const paidFallback = { takeId: 'another-take', locale: 'ja', response: { transcript: 'not-mine' }, audio: fp(memory, 42) }
    const result = await direct('ja', { paidFallback })
    expect(result.transcript).toBe('answer-1')
    expect(transcribePosts()).toBe(1)
  })

  it('(own m9) a superseded run’s late answer never lands in the new chain’s slot', async () => {
    let openA!: () => void
    transcribeGates.push(new Promise<void>((r) => (openA = r)))
    globalPipeline.start(new Blob(['a'], { type: 'audio/webm' }), takeless)
    for (let i = 0; i < 200 && transcribePosts() === 0; i++) await tick()
    expect(transcribePosts()).toBe(1) // A is paid for, its answer still on the wire
    extractRefuses = true
    globalPipeline.start(new Blob(['b'], { type: 'audio/webm' }), takeless)
    await settle()
    expect(globalPipeline.state).toBe('error') // B paid (answer-2), then extract refused
    openA() // A's answer (answer-1) lands late, for a run that is no longer live
    for (let i = 0; i < 50; i++) await tick()
    extractRefuses = false
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(transcribePosts()).toBe(2)
    expect(globalPipeline.result?.transcript).toBe('answer-2')
  })

  it('(own m10) through the real pipeline: a take whose attach succeeds on the 2nd 再試行 is asked for F', async () => {
    takeWhoseAttachFails(2)
    extractRefuses = true
    globalPipeline.start(memory, { locale: 'ja', customers: [], takeId: TAKE, duration: 42, recordingSessionId: SESSION })
    await settle()
    globalPipeline.retry() // attach fails again → replayed
    await settle()
    extractRefuses = false
    globalPipeline.retry() // attach succeeds → F → asked
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(prepareTranscription.mock.calls.map(([, path]) => path)).toEqual([null, TAKE_KEY])
    expect(transcribePosts()).toBe(2)
    expect(globalPipeline.result?.transcript).toBe('answer-2')
  })

  it('(own m13) reset() drops the slot (the reconcile-on-error path): nothing of the answer outlives the run', async () => {
    extractRefuses = true
    globalPipeline.start(memory, takeless)
    await settle()
    expect(globalPipeline['paidFallback']).toMatchObject({ takeId: null, locale: 'ja' })
    globalPipeline.reset()
    expect(globalPipeline['paidFallback']).toBeNull()
  })
})

// ── THE LAYER MATRIX ─────────────────────────────────────────────────────────
// Every case goes through the real globalPipeline: start → 再試行 → (takes) a
// recovery start() — what the inbox's 再試行/保存する does, with the slot cleared,
// so the take's own stamp is what replays. The first two attempts fail after
// the transcript (extract refused), the last one lands. #1074's line fires when
// the ATTACH mints the take's row (startSession answers) — the third layer.
const LAYERS: Array<[string, boolean, string | null]> = [
  ['switch OFF (today)', false, null],
  ['switch ON alone', true, null],
  ['switch ON + #1074 (the attach mints the take’s row)', true, 'rs_attach_x'],
]
type RunContext = Parameters<typeof globalPipeline.start>[1]
describe.each(LAYERS)('layer matrix — %s', (_label, switchOn, attachRow) => {
  forceSwitch(switchOn)
  beforeEach(() => {
    startSessionAnswer = attachRow ? { id: attachRow } : null
  })
  const takeCtx = (extra: Partial<RunContext> = {}): RunContext => ({
    locale: 'ja',
    customers: [],
    takeId: TAKE,
    duration: 42,
    recordingSessionId: null,
    serverRowMissing: true,
    ...extra,
  })
  /** start → 再試行 → recovery start(); the transcript lands every time, extract refuses twice. */
  const threeAttempts = async (ctx: RunContext) => {
    extractRefuses = true
    globalPipeline.start(memory, ctx)
    await settle()
    const first = globalPipeline.state
    globalPipeline.retry()
    await settle()
    const second = globalPipeline.state
    extractRefuses = false
    globalPipeline.start(memory, ctx)
    await settle()
    return [first, second, globalPipeline.state]
  }

  it('(a) a normal finalized take → ONE paid call across three attempts', async () => {
    expect(RECORDING_SWITCHES.bindUnboundUploads).toBe(switchOn)
    store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, finalizedAt: 1, finalizedPath: TAKE_KEY, startedAt: 0, updatedAt: 1 }
    expect(await threeAttempts(takeCtx({ recordingSessionId: SESSION, serverRowMissing: false }))).toEqual(['error', 'error', 'review'])
    expect(transcribePosts()).toBe(1)
    expect(prepareTranscription.mock.calls.map(([, path, opts]) => [path, opts])).toEqual([[TAKE_KEY, { takeRow: SESSION }]])
    expect(globalPipeline.result?.transcript).toBe('answer-1')
  })

  it('(b) a take whose start-time mints failed → ONE paid call across three attempts', async () => {
    store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    expect(await threeAttempts(takeCtx())).toEqual(['error', 'error', 'review'])
    expect(transcribePosts()).toBe(1)
    expect(globalPipeline.result?.transcript).toBe('answer-1')
    const paid = prepareTranscription.mock.calls.map(([, path, opts]) => [path, opts])
    if (attachRow) {
      // #1074: the attach minted X, secured the take on it, and the run adopted it.
      expect(paid).toEqual([[TAKE_KEY, { takeRow: attachRow }]])
      expect(store.meta?.finalizedPath).toBe(TAKE_KEY)
      expect(globalPipeline.context?.recordingSessionId).toBe(attachRow)
    } else {
      expect(paid).toEqual([[null, { attachOutcome: 'no_session', durationSeconds: 42 }]])
      if (switchOn) {
        // S34: the unbound door bound a row; the take is secured at the paid key.
        expect(store.meta?.finalizedPath).toBe(unbound(1))
        expect(store.meta?.recordingSessionId).toBe('rs_minted_1')
      } else {
        expect(store.meta?.finalizedPath).toBeUndefined()
        expect(store.meta?.transcript).toMatchObject({ finalizedPath: unbound(1), fallback: true })
      }
    }
  })

  it('(c) a take-less run → ONE paid call across start → 再試行 → 再試行', async () => {
    extractRefuses = true
    globalPipeline.start(memory, { locale: 'ja', customers: [], takeId: null, recordingSessionId: null, serverRowMissing: true })
    await settle()
    expect(globalPipeline.state).toBe('error')
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('error')
    extractRefuses = false
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(transcribePosts()).toBe(1)
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
    expect(globalPipeline.result?.transcript).toBe('answer-1')
    // ON: the unbound door's row was adopted into the context on the first run, untouched.
    expect(globalPipeline.context?.recordingSessionId).toBe(switchOn ? 'rs_minted_1' : null)
  })

  it('(e) S53 — a LOST response, then 再試行 → ONE paid call in every layer (the key is re-presented or finalized)', async () => {
    serverMemo = new Map()
    store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    transcribeNet.push('lose', 'unreached')
    globalPipeline.start(memory, takeCtx())
    await settle()
    expect(globalPipeline.state).toBe('error')
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(paidCalls).toBe(1)
    const asked = prepareTranscription.mock.calls.map(([, path]) => path)
    // #1074: the attach finalized the take · ON: S34 adopted it at the paid key ·
    // OFF: S53 A4 re-presents the pinned key. Either way the 再試行 names U1, never a new mint.
    expect(asked).toEqual(attachRow ? [TAKE_KEY, TAKE_KEY] : [null, unbound(1)])
  })

  it('(d) an empty transcript on the fallback arm → EmptyTranscriptError each time, ZERO POSTs after the first', async () => {
    // No row at start, bytes stored, the take-key mint refuses: the fallback arm in every layer
    // (with #1074's layer the attach mints X first → attach_failed, which never binds).
    store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    refuseTakeMints = 99
    transcriptText = () => ''
    globalPipeline.start(memory, takeCtx())
    await settle()
    expect([globalPipeline.state, globalPipeline.error]).toEqual(['error', 'empty-transcript'])
    expect(transcribePosts()).toBe(1)
    posts.length = 0
    globalPipeline.retry()
    await settle()
    expect([globalPipeline.state, globalPipeline.error]).toEqual(['error', 'empty-transcript'])
    globalPipeline.start(memory, takeCtx())
    await settle()
    expect([globalPipeline.state, globalPipeline.error]).toEqual(['error', 'empty-transcript'])
    expect(posts).toHaveLength(0)
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
    expect(prepareTranscription.mock.calls[0][2]).toEqual(
      attachRow ? { attachOutcome: 'attach_failed' } : { attachOutcome: 'no_session', durationSeconds: 42 },
    )
  })
})

// ── ⚖ S53 A4 — THE FALLBACK'S KEY IS PINNED BEFORE IT PAYS ─────────────────
// The C3 stamp/slot remember an answer the device RECEIVED. An answer lost on
// the way back (the response dropped, the app killed mid-POST) left nothing,
// and the next run minted a NEW key — which the server's memo could never
// link to the first payment. The key is now pinned after the PUT and before
// the POST; a run with still no finalized key, the same locale and the same
// audio re-presents it, and the server's memo for it replays (modelled here
// by key — the real doors' replay rules are the matrix's, in
// transcribe-paid-once-matrix.test.ts).
describe('⚖ S53 A4 — a key the fallback PUT is re-presented, never re-minted', () => {
  beforeEach(() => {
    serverMemo = new Map()
  })
  /** A take with no row and no finalized key; the attach cannot land. */
  const bareTake = () => {
    store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    refuseTakeMints = 99
  }
  const ctx = (extra: Partial<RunContext> = {}): RunContext => ({
    locale: 'ja',
    customers: [],
    takeId: TAKE,
    duration: 42,
    recordingSessionId: null,
    serverRowMissing: true,
    ...extra,
  })
  type RunContext = Parameters<typeof globalPipeline.start>[1]
  const mints = () => prepareTranscription.mock.calls.filter(([, path]) => path === null).length

  it('manual 再試行 after a LOST response → ONE paid call: the 再試行 re-presents the pinned key, the server replays', async () => {
    bareTake()
    transcribeNet.push('lose', 'unreached') // paid, lost; the inner re-POST never leaves
    globalPipeline.start(memory, ctx())
    await settle()
    expect(globalPipeline.state).toBe('error')
    expect(store.meta?.fallbackPin).toMatchObject({ finalizedPath: unbound(1), recordingSessionId: null, locale: 'ja', audio: fp(memory, 42) })
    expect(store.meta?.transcript).toBeUndefined() // nothing was received

    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(paidCalls).toBe(1)
    expect(mints()).toBe(1)
    expect(prepareTranscription.mock.calls[1].slice(1)).toEqual([unbound(1), undefined])
    expect(globalPipeline.result?.transcript).toBe('answer-1')
  })

  it('the pin is written BEFORE the POST (the kill window): the PUT has landed, the answer has not', async () => {
    bareTake()
    // prepareTranscription (the port's mint + PUT) has resolved; the POST has not answered.
    let atPost: unknown = 'unread'
    onTranscribeReached = () => {
      atPost = store.meta?.fallbackPin
    }
    await direct()
    expect(atPost).toMatchObject({ finalizedPath: unbound(1), locale: 'ja' })
  })

  it('app killed mid-POST, then the recovery save → ONE paid call: the take’s pin survives the kill', async () => {
    bareTake()
    // The POST reaches the server (it pays and remembers) and the app dies before the answer lands.
    let kill!: () => void
    transcribeGates.push(new Promise<void>((resolve) => (kill = resolve)))
    transcribeNet.push('lose', 'unreached')
    globalPipeline.start(memory, ctx())
    for (let i = 0; i < 50 && paidCalls === 0; i++) await tick()
    expect(paidCalls).toBe(1)
    globalPipeline.reset() // the relaunch: nothing of the run survives in memory
    // The dead run's connection drops (its late failure is dropped by runId) and
    // its tab lock goes with it, as the browser releases a dead tab's lock.
    kill()
    for (let i = 0; i < 20; i++) await tick()

    globalPipeline.start(memory, ctx()) // the recovery save of the same take
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(paidCalls).toBe(1)
    expect(mints()).toBe(1)
    expect(globalPipeline.result?.transcript).toBe('answer-1')
  })

  it('fingerprint mismatch (a recovery assembled a shorter blob) → mints and pays as today', async () => {
    bareTake()
    transcribeNet.push('lose', 'unreached')
    await outcome(direct())
    expect(paidCalls).toBe(1)
    await runAIPipeline(recovered, TAKE, 'ja', () => {}, { durationSeconds: 42 })
    expect(mints()).toBe(2)
    expect(paidCalls).toBe(2)
  })

  it('another locale → mints and pays as today (a different answer)', async () => {
    bareTake()
    transcribeNet.push('lose', 'unreached')
    await outcome(direct('ja'))
    await direct('en')
    expect(mints()).toBe(2)
    expect(paidCalls).toBe(2)
  })

  it('finalized at F meanwhile (another tab / the drain) → the pin is NEVER used: F is asked as its own object', async () => {
    bareTake()
    transcribeNet.push('lose', 'unreached')
    await outcome(direct())
    store.meta = { ...store.meta!, finalizedAt: 2, finalizedPath: TAKE_KEY }
    await direct()
    expect(prepareTranscription.mock.calls.map(([, path]) => path)).toEqual([null, TAKE_KEY])
    expect(paidCalls).toBe(2)
  })

  it('a take already finalized at another key is never PINNED (the store’s C3 guard)', async () => {
    bareTake()
    // The drain finalizes the take at F between the mint and the pin write.
    prepareTranscription.mockImplementationOnce(async () => {
      store.meta = { ...store.meta!, finalizedAt: 2, finalizedPath: TAKE_KEY }
      return { body: { path: unbound(9) }, path: unbound(9), recordingSessionId: null }
    })
    await direct()
    expect(pinTakeFallback).toHaveBeenCalledTimes(1)
    expect(store.meta?.fallbackPin).toBeUndefined()
  })

  it('take-less: 再試行 after a LOST response → ONE paid call through the chain’s slot; start() clears it', async () => {
    transcribeNet.push('lose', 'unreached')
    const takeless = { locale: 'ja', customers: [], takeId: null, recordingSessionId: null, serverRowMissing: true } as RunContext
    globalPipeline.start(memory, takeless)
    await settle()
    expect(globalPipeline['fallbackPin']).toMatchObject({ takeId: null, path: unbound(1), locale: 'ja' })
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(paidCalls).toBe(1)
    expect(mints()).toBe(1)
    globalPipeline.start(memory, takeless)
    expect(globalPipeline['fallbackPin']).toBeNull()
    // S56 hygiene: this run is finished HERE — the pin's digest is a real async step, and an unsettled run's
    // POST would otherwise land in the next test's network queue.
    await settle()
  })

  it('a6 switch transcribePaidOnce OFF → the pre-S53 run: no pin written or read, the 再試行 mints and PAYS again', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    try {
      bareTake()
      transcribeNet.push('lose', 'unreached')
      globalPipeline.start(memory, ctx())
      await settle()
      expect(store.meta?.fallbackPin).toBeUndefined()
      expect(pinTakeFallback).not.toHaveBeenCalled()
      globalPipeline.retry()
      await settle()
      expect(globalPipeline.state).toBe('review')
      expect(mints()).toBe(2)
      expect(paidCalls).toBe(2)
    } finally {
      off.restore()
    }
  })

  it('switch ON: the pin carries the row the mint named, and the re-presented key rides with it', async () => {
    const replaced = jest.replaceProperty(RECORDING_SWITCHES as { bindUnboundUploads: boolean }, 'bindUnboundUploads', true)
    try {
      // take-less, so nothing is adopted onto a take and the fallback arm repeats
      transcribeNet.push('lose', 'unreached')
      const takeless = { locale: 'ja', customers: [], takeId: null, recordingSessionId: null, serverRowMissing: true } as RunContext
      globalPipeline.start(memory, takeless)
      await settle()
      globalPipeline.retry()
      await settle()
      expect(prepareTranscription.mock.calls[1].slice(1)).toEqual([unbound(1), { takeRow: 'rs_minted_1' }])
      expect(paidCalls).toBe(1)
    } finally {
      replaced.restore()
    }
  })
})

// ── ⚖ S54 fix round (fresh-eyes F9/F10) ────────────────────────────────────
// F9: a re-presented key names its row, and the port names none on that arm —
// so a first attempt whose adoption was LOST left the take unlinked for good.
// The pin's row is asked for again on every pinned run (first stamp wins, so a
// linked take is a no-op). F10: a key the server refuses OUTRIGHT (the web
// read-URL door's 'forbidden', the phone door's 404) is MARKED retired on the
// take and on the chain's slot — kept, never deleted — and never re-presented;
// the next 再試行 mints fresh, today's run. Every other failure keeps the pin.
describe('⚖ S54 F9/F10 — a pinned 再試行 re-links its row; a key the server refuses is retired, never deleted', () => {
  forceSwitch(true) // bindUnboundUploads ON: the mint names a row (R)
  beforeEach(() => {
    serverMemo = new Map()
  })
  type RunContext = Parameters<typeof globalPipeline.start>[1]
  const K = unbound(1)
  const R = 'rs_minted_1'
  /** A take with no row and no finalized key; the attach cannot land. */
  const bareTake = () => {
    store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    refuseTakeMints = 99
  }
  /** Check 10's state: the take's adoption NEVER lands, so it keeps no finalized key and its pin is read. */
  const stuckTake = () => {
    bareTake()
    adoptLost = 99
  }
  const ctx = (): RunContext =>
    ({ locale: 'ja', customers: [], takeId: TAKE, duration: 42, recordingSessionId: null, serverRowMissing: true }) as RunContext
  const takeless = { locale: 'ja', customers: [], takeId: null, recordingSessionId: null, serverRowMissing: true } as RunContext
  const mints = () => prepareTranscription.mock.calls.filter(([, path]) => path === null).length
  const chainSlot = () => (globalPipeline as unknown as { fallbackPin: Pin & { path?: string } | null }).fallbackPin
  const chainRow = () => (globalPipeline as unknown as { context: { recordingSessionId: string | null } | null }).context?.recordingSessionId
  /** The web arm's order on a mint (S53-B): PUT → hand-over (onUploaded) → read URL. */
  const webArmOnce = () =>
    prepareTranscription.mockImplementationOnce(async (_b, _p, opts) => {
      const n = ++unboundSeq
      const row = opts?.attachOutcome === 'no_session' ? `rs_minted_${n}` : null
      if (row) await lastOnUploaded?.(row, unbound(n))
      return { body: row ? { path: unbound(n), recordingSessionId: row } : { path: unbound(n) }, path: unbound(n), recordingSessionId: row }
    })
  /** The web port's read-URL door answers for the re-presented key (recording-port.ts). */
  const readUrlRefuses = (refusal: 'forbidden' | 'upstream') =>
    prepareTranscription.mockImplementationOnce(async () => {
      throw Object.assign(new Error('could not mint a read URL'), { refusal })
    })
  /** Run 1: the paid answer is lost (paid, remembered, never received); the take is pinned at K. */
  const lostFirstRun = async (context: RunContext = ctx()) => {
    transcribeNet.push('lose', 'unreached')
    globalPipeline.start(memory, context)
    await settle()
    expect(globalPipeline.state).toBe('error')
    expect(paidCalls).toBe(1)
  }
  const retry = async () => {
    globalPipeline.retry()
    await settle()
  }
  /** The phone door's OWN key refusal, built by its own code (app/v1/ai/transcribe/route.ts:54 + :100 → errors.ts errorBody). */
  const doorBody = (code: 'not_found' | 'no_audio', message = 'recording not found in this business') =>
    JSON.stringify(errorBody(new AppApiError(code, message)))
  /** This run's port is the PHONE's (refusesMissingKeyWith404: true); its 404s carry `body`. */
  const phoneDoor = (body = doorBody('not_found')) => {
    portRefuses404 = true
    refusalBody404 = body
  }

  it('(t9a) the first attempt’s adoption was LOST twice (hand-over + answer) and its answer lost → the 再試行 re-presents K AND links the take to R; ONE paid call, no new mint', async () => {
    bareTake()
    webArmOnce()
    adoptLost = 2
    let reached = 0
    onTranscribeReached = () => {
      reached++
    }
    await lostFirstRun()
    expect(adoptTakeSession.mock.calls).toEqual([[TAKE, R, K], [TAKE, R, K]])
    expect(store.meta?.recordingSessionId).toBeUndefined()
    expect(store.meta?.fallbackPin).toMatchObject({ finalizedPath: K, recordingSessionId: R })

    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(prepareTranscription.mock.calls[1].slice(1, 3)).toEqual([K, { takeRow: R }])
    expect(adoptTakeSession).toHaveBeenCalledTimes(3)
    expect(adoptTakeSession).toHaveBeenLastCalledWith(TAKE, R, K)
    expect(store.meta).toMatchObject({ recordingSessionId: R, finalizedPath: K })
    expect(chainRow()).toBe(R)
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(1)
    expect(reached).toBe(2) // the lost POST and the replayed one — Deepgram ran once
  })

  it('(t9b) the first attempt’s adoption LANDED → the 再試行 asks K as the take’s own key: the pin is not read, no second adoption', async () => {
    bareTake()
    webArmOnce()
    await lostFirstRun()
    expect(adoptTakeSession).toHaveBeenCalledTimes(1)
    expect(store.meta).toMatchObject({ recordingSessionId: R, finalizedPath: K })

    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(adoptTakeSession).toHaveBeenCalledTimes(1)
    expect(prepareTranscription.mock.calls[1].slice(1, 3)).toEqual([K, { takeRow: R }])
    expect(store.meta?.recordingSessionId).toBe(R)
    expect(paidCalls).toBe(1)
  })

  it('(t9b) a take stamped with ANOTHER row after its pin → the re-link is asked and refused (first stamp wins): the take keeps its row, the run is not told R', async () => {
    bareTake()
    webArmOnce()
    adoptLost = 2
    await lostFirstRun()
    store.meta = { ...store.meta!, recordingSessionId: 'rs_late_stamp' } // a late start-mint answer, say
    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(adoptTakeSession).toHaveBeenCalledTimes(3)
    expect(adoptTakeSession).toHaveBeenLastCalledWith(TAKE, R, K)
    expect(store.meta?.recordingSessionId).toBe('rs_late_stamp')
    expect(store.meta?.finalizedPath).toBeUndefined()
    expect(chainRow()).toBeNull()
    expect(paidCalls).toBe(1)
  })

  it('(t10c) a hand-over whose write was LOST gets its second chance from the answer in the SAME run (the fresh-eyes surviving mutant)', async () => {
    bareTake()
    webArmOnce()
    adoptLost = 1
    await direct()
    expect(adoptTakeSession).toHaveBeenCalledTimes(2)
    expect(store.meta).toMatchObject({ recordingSessionId: R, finalizedPath: K })
  })

  it('(t10a) web: the read-URL door refuses the re-presented key (forbidden) → the pin is MARKED retired on the take AND the chain slot, kept whole; the error stands, nothing minted; the next 再試行 mints fresh and pays', async () => {
    stuckTake()
    await lostFirstRun()
    const pinned = store.meta?.fallbackPin
    readUrlRefuses('forbidden')
    await retry()
    expect(globalPipeline.state).toBe('error')
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(1)
    expect(retireTakeFallback).toHaveBeenCalledWith(TAKE, K, expect.any(Number), 'read_url_forbidden')
    expect(store.meta?.fallbackPin).toEqual({ ...pinned, retiredAt: expect.any(Number), retiredReason: 'read_url_forbidden' })
    expect(chainSlot()).toMatchObject({ path: K, recordingSessionId: R, retiredAt: expect.any(Number), retiredReason: 'read_url_forbidden' })

    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(mints()).toBe(2)
    expect(paidCalls).toBe(2)
  })

  it('(t10a · t10g) phone: the door answers 404 for the re-presented key (not this business’s / a colleague’s row) → retired on the take and the slot; the next 再試行 mints fresh', async () => {
    phoneDoor()
    stuckTake()
    await lostFirstRun()
    transcribeStatus.push(404, 404) // fetchWithRetry asks twice; nothing is paid
    await retry()
    expect(globalPipeline.state).toBe('error')
    expect(mints()).toBe(1)
    expect(store.meta?.fallbackPin).toMatchObject({ finalizedPath: K, retiredAt: expect.any(Number), retiredReason: 'transcribe_404' })
    expect(chainSlot()).toMatchObject({ path: K, retiredReason: 'transcribe_404' })

    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(mints()).toBe(2)
    expect(paidCalls).toBe(2)
  })

  it('(t10a) take-less, phone: the door’s 404 retires the chain slot’s pin (no take to mark); the next 再試行 mints fresh', async () => {
    phoneDoor()
    await lostFirstRun(takeless)
    transcribeStatus.push(404, 404)
    await retry()
    expect(globalPipeline.state).toBe('error')
    expect(retireTakeFallback).not.toHaveBeenCalled()
    expect(chainSlot()).toMatchObject({ takeId: null, path: K, retiredReason: 'transcribe_404' })
    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(mints()).toBe(2)
    expect(paidCalls).toBe(2)
  })

  it.each([
    ['the door’s 502 (unreadable — a core read blip)', () => transcribeStatus.push(502, 502)],
    ['a 429 (the ceiling)', () => transcribeStatus.push(429)],
    ['a 503', () => transcribeStatus.push(503, 503)],
    ['a 403 (the plan / capability gate — not this key)', () => transcribeStatus.push(403)],
    ['a network error, twice', () => transcribeNet.push('unreached', 'unreached')],
    ['a phone-door 404 then a network error (the LAST answer decides)', () => {
      phoneDoor()
      transcribeStatus.push(404)
      transcribeNet.push(undefined, 'unreached')
    }],
    ['the read-URL door’s upstream (a blip)', () => readUrlRefuses('upstream')],
  ])('(t10b) %s → the pin is NOT retired: the error stands and the next 再試行 re-presents the same key', async (_name, refuse) => {
    stuckTake()
    await lostFirstRun()
    refuse()
    await retry()
    expect(globalPipeline.state).toBe('error')
    expect(retireTakeFallback).not.toHaveBeenCalled()
    expect(store.meta?.fallbackPin?.retiredAt).toBeUndefined()
    expect(chainSlot()?.retiredAt).toBeUndefined()
    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(1)
  })

  // Branch 3 (S54 B): a 409 is STILL WORKING, never the error card, so its t10b row asserts that instead: the
  // run waits what the 409 asked (none named → 5 s, made immediate here), re-POSTs the SAME key, and the
  // remembered answer replays — no 再試行, nothing retired, nothing paid twice.
  it('(t10b) a 409 → the pin is NOT retired: the run stays still-working (S54 B), re-POSTs the same key, and the remembered answer replays', async () => {
    const wait = jest.mocked(global.setTimeout).getMockImplementation()!
    jest.mocked(global.setTimeout).mockImplementation(((fn: () => void, ms?: number) => wait(fn, ms === 5_000 ? 0 : ms)) as typeof setTimeout)
    try {
      stuckTake()
      await lostFirstRun()
      transcribeStatus.push(409, 409)
      await retry()
      expect(transcribeStatus).toEqual([]) // both 409s were met, then the replay
      expect(globalPipeline.state).toBe('review')
      expect(retireTakeFallback).not.toHaveBeenCalled()
      expect(store.meta?.fallbackPin?.retiredAt).toBeUndefined()
      expect(chainSlot()?.retiredAt).toBeUndefined()
      expect(prepareTranscription.mock.calls.slice(1).map(([, path]) => path)).toEqual([K])
      expect(mints()).toBe(1)
      expect(paidCalls).toBe(1)
    } finally {
      jest.mocked(global.setTimeout).mockImplementation(wait)
    }
  })

  // S56 STRESS LENS — the 409→404 chain (the one composition S55-E named as untested:
  // "No test drives a 409 followed by a 404 on the same POST chain"). Send #1 = still-working
  // (409, no wait named → the 5 s floor, compressed like the t10b test above). Send #2 = the
  // whileStillTranscribing loop's OWN continuation/poll re-POST — the SAME chain — meets a
  // genuine phone-door not_found 404. Since that 404 bubbles out of the still-working wrapper as
  // a plain fetchWithRetry failure, fetchWithRetry's OWN pre-existing 1.5 s resend fires next
  // (unrelated to this PR, unchanged): send #3 is fed the same not_found 404 so the chain resolves
  // to a genuine, honest failure rather than an unfed queue accidentally paying. Asserts: the pin
  // is soft-retired (KEPT, never deleted), no second paid call, the truthful blocked/error state
  // (not a stale success), and the next 再試行 mints fresh exactly like a plain 404 (t10a).
  it('(t10-chain, S56 stress) 409 (still working) then 404 (not_found) on the SAME POST chain → the pin IS soft-retired (kept, not deleted), nothing paid twice, the state is truthful', async () => {
    const wait = jest.mocked(global.setTimeout).getMockImplementation()!
    jest.mocked(global.setTimeout).mockImplementation(((fn: () => void, ms?: number) => wait(fn, ms === 5_000 ? 0 : ms)) as typeof setTimeout)
    try {
      phoneDoor()
      stuckTake()
      await lostFirstRun()
      // #1 still-working 409 (the wrapper's poll loop) · #2 the SAME chain's continuation meets
      // the door's own not_found 404 · #3 fetchWithRetry's pre-existing 1.5 s resend meets it again.
      transcribeStatus.push(409, 404, 404)
      await retry()
      expect(transcribeStatus).toEqual([]) // all three answers were consumed by this one chain
      expect(globalPipeline.state).toBe('error') // truthful: never a stale/false success
      expect(mints()).toBe(1) // no new mint from the retire path itself
      expect(paidCalls).toBe(1) // nothing paid on the 409 leg, the 404 leg, or the resend
      // SOFT-RETIRED, i.e. KEPT (never deleted) with a retiredAt/retiredReason stamp:
      expect(store.meta?.fallbackPin).toBeDefined()
      expect(store.meta?.fallbackPin).toMatchObject({ finalizedPath: K, retiredAt: expect.any(Number), retiredReason: 'transcribe_404' })
      expect(chainSlot()).toMatchObject({ path: K, retiredReason: 'transcribe_404' })
      expect(retireTakeFallback).toHaveBeenCalledWith(TAKE, K, expect.any(Number), 'transcribe_404')

      // the next 再試行 mints fresh, exactly like a plain 404 (t10a) — the transcript/answer path
      // is never lost, it simply starts over on a fresh key:
      await retry()
      expect(globalPipeline.state).toBe('review')
      expect(mints()).toBe(2)
      expect(paidCalls).toBe(2)
    } finally {
      jest.mocked(global.setTimeout).mockImplementation(wait)
    }
  })

  it('(t10b) switch transcribePaidOnce OFF: a pin left by an ON run is not read, and a 404 retires nothing (OFF == today)', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    try {
      bareTake()
      const left: Pin = { finalizedPath: K, recordingSessionId: R, locale: 'ja', audio: await pinFp(memory, 42), at: 1 }
      store.meta = { ...store.meta!, fallbackPin: left }
      phoneDoor()
      transcribeStatus.push(404, 404)
      expect(await outcome(direct())).toBeInstanceOf(Error)
      expect(mints()).toBe(1)
      expect(retireTakeFallback).not.toHaveBeenCalled()
      expect(pinTakeFallback).not.toHaveBeenCalled()
      expect(store.meta?.fallbackPin).toEqual(left)
    } finally {
      off.restore()
    }
  })

  // ⚖ S54 delta read — a 404 retires the pin ONLY as the phone door's own key refusal: the port says its door
  // answers 404 for a refused key (the web door never answers 404 at all) AND the body carries that door's code.
  it.each([
    ['carrying the phone door’s own code (only the port rule stands)', doorBody('not_found')],
    ['a platform page (a deploy window / a misrouted base)', 'The page could not be found\n\nNOT_FOUND\n'],
    ['no body', ''],
  ])('(t10d) web: the POST answers 404 %s → the pin is NOT retired: the error stands and the next 再試行 re-presents the same key', async (_name, body) => {
    refusalBody404 = body // portRefuses404 stays false: the web door
    stuckTake()
    await lostFirstRun()
    transcribeStatus.push(404, 404)
    await retry()
    expect(globalPipeline.state).toBe('error')
    expect(retireTakeFallback).not.toHaveBeenCalled()
    expect(store.meta?.fallbackPin?.retiredAt).toBeUndefined()
    expect(chainSlot()?.retiredAt).toBeUndefined()
    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(1)
  })

  it('(t10e) phone: a 404 carrying the door’s own code → the pin is retired on the take AND told to the chain slot, and the error is rethrown; nothing minted, nothing paid', async () => {
    phoneDoor()
    bareTake()
    const left: Pin = { finalizedPath: K, recordingSessionId: R, locale: 'ja', audio: await pinFp(memory, 42), at: 1 }
    store.meta = { ...store.meta!, fallbackPin: left }
    const onFallbackRetired = jest.fn()
    transcribeStatus.push(404, 404)
    const err = await outcome(direct('ja', { onFallbackRetired }))
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/^Transcription failed: /)
    expect(mints()).toBe(0)
    expect(paidCalls).toBe(0)
    expect(retireTakeFallback).toHaveBeenCalledWith(TAKE, K, expect.any(Number), 'transcribe_404')
    expect(store.meta?.fallbackPin).toEqual({ ...left, retiredAt: expect.any(Number), retiredReason: 'transcribe_404' })
    expect(onFallbackRetired).toHaveBeenCalledWith(
      expect.objectContaining({ takeId: TAKE, path: K, recordingSessionId: R, retiredAt: expect.any(Number), retiredReason: 'transcribe_404' }),
    )
  })

  it.each([
    ['another code of the same door (no_audio)', doorBody('no_audio', 'no audio')],
    ['the web door’s string shape naming not_found', '{"error":"not_found"}'],
    ['a platform page', 'The page could not be found\n\nNOT_FOUND\n'],
    ['no body', ''],
  ])('(t10f) phone: a 404 with %s → the pin is NOT retired: the error stands and the next 再試行 re-presents the same key', async (_name, body) => {
    phoneDoor(body)
    stuckTake()
    await lostFirstRun()
    transcribeStatus.push(404, 404)
    await retry()
    expect(globalPipeline.state).toBe('error')
    expect(retireTakeFallback).not.toHaveBeenCalled()
    expect(store.meta?.fallbackPin?.retiredAt).toBeUndefined()
    expect(chainSlot()?.retiredAt).toBeUndefined()
    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(1)
  })

  // ⚖ S55 stress — the 404 rule's other edges. (g3 is the refused arm above: a real Response, so t10e fails the
  // moment the rule reads the answer itself instead of its clone.)
  it.each([
    ['a 403 (refused on the first answer)', () => transcribeStatus.push(403)],
    ['a 500, twice', () => transcribeStatus.push(500, 500)],
  ])('(g1) phone: %s whose body carries the door’s own not_found code → NOT retired (only a 404 is the key refusal): the error stands and the next 再試行 re-presents the same key', async (_name, refuse) => {
    phoneDoor()
    refusalBodyOther = doorBody('not_found')
    stuckTake()
    await lostFirstRun()
    refuse()
    await retry()
    expect(globalPipeline.state).toBe('error')
    expect(retireTakeFallback).not.toHaveBeenCalled()
    expect(store.meta?.fallbackPin?.retiredAt).toBeUndefined()
    expect(chainSlot()?.retiredAt).toBeUndefined()
    await retry()
    expect(globalPipeline.state).toBe('review')
    expect(prepareTranscription.mock.calls.slice(1).map(([, path]) => path)).toEqual([K, K])
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(1)
  })

  it('(g2) phone: an UNPINNED run (a fresh mint — no pin read at its start) meets the door’s 404 not_found → nothing to retire: no take mark, no chain-slot call, no TypeError; the ordinary “Transcription failed”', async () => {
    phoneDoor()
    stuckTake()
    const onFallbackRetired = jest.fn()
    transcribeStatus.push(404, 404)
    const err = await outcome(direct('ja', { onFallbackRetired }))
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(TypeError)
    expect((err as Error).message).toMatch(/^Transcription failed: /)
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(0)
    expect(retireTakeFallback).not.toHaveBeenCalled()
    expect(onFallbackRetired).not.toHaveBeenCalled()
    // The key this run pinned before its POST is not one it read, so it is not this run's to retire.
    expect(store.meta?.fallbackPin).toMatchObject({ finalizedPath: K })
    expect(store.meta?.fallbackPin?.retiredAt).toBeUndefined()

    const next = await outcome(direct('ja', { onFallbackRetired }))
    expect(next).toBe('ok')
    expect(prepareTranscription.mock.calls.map(([, path]) => path)).toEqual([null, K])
    expect(mints()).toBe(1)
    expect(paidCalls).toBe(1)
  })

  it('(g4) phone: a 404 whose body is not JSON (a platform page) on a pinned run → the ordinary “Transcription failed: HTTP 404…”, never a raw JSON SyntaxError; not retired', async () => {
    phoneDoor('The page could not be found\n\nNOT_FOUND\n')
    bareTake()
    const left: Pin = { finalizedPath: K, recordingSessionId: R, locale: 'ja', audio: await pinFp(memory, 42), at: 1 }
    store.meta = { ...store.meta!, fallbackPin: left }
    transcribeStatus.push(404, 404)
    const err = await outcome(direct('ja'))
    expect(err).not.toBeInstanceOf(SyntaxError)
    expect((err as Error).message).toMatch(/^Transcription failed: HTTP 404: The page could not be found/)
    expect(retireTakeFallback).not.toHaveBeenCalled()
    expect(store.meta?.fallbackPin).toEqual(left)
  })
})

// ── ⚖ S56 (PR 1 Greptile Finding 2: "Pin can select different audio") ─────
// A re-presented key makes the server transcribe the object ALREADY under it.
// The pin used to match on size + type (+ length) alone, so recovered audio
// with the same coarse fields but different bytes skipped its own upload and
// got the OLD recording's words. The pin now carries the SHA-256 of the bytes
// its PUT sent; a key is re-presented only onto the same hash, a hash-less pin
// never matches, and the coarse check still runs first (no hashing unless a
// pin could match).
describe('⚖ S56 — a pin is re-presented only onto the SAME BYTES (content hash)', () => {
  beforeEach(() => {
    serverMemo = new Map()
  })
  const bareTake = () => {
    store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
    store.blob = new Blob(['stored'], { type: 'audio/webm' })
    refuseTakeMints = 99
  }
  const mints = () => prepareTranscription.mock.calls.filter(([, path]) => path === null).length
  const run = (blob: Blob) => runAIPipeline(blob, TAKE, 'ja', () => {}, { durationSeconds: 42 })
  /** Run 1: the paid answer is lost (paid, remembered, never received); the take is pinned. */
  const lostFirstRun = async (blob: Blob = memory) => {
    transcribeNet.push('lose', 'unreached')
    expect(await outcome(run(blob))).toBeInstanceOf(Error)
    expect(paidCalls).toBe(1)
  }
  const digestLines = () =>
    (console.info as jest.Mock).mock.calls.filter(([line]) => line === '[ai-pipeline] audio digest unavailable')

  it('h1 the same bytes in a new blob (a reload) → the hash is equal → the pinned key is re-presented: no fresh mint, the old path, ONE paid call', async () => {
    bareTake()
    await lostFirstRun()
    // The pin carries the hash of the EXACT bytes the PUT sent — checked against node:crypto.
    expect(store.meta?.fallbackPin?.audio).toEqual(await pinFp(memory, 42))
    const sameBytes = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })

    const res = await run(sameBytes)

    expect(res.transcript).toBe('answer-1')
    expect(mints()).toBe(1)
    expect(prepareTranscription.mock.calls[1][1]).toBe(unbound(1))
    expect(paidCalls).toBe(1)
  })

  it('h2 same size + type + length, DIFFERENT bytes → the hash differs → NO match: a fresh mint, its own PUT of the new bytes, a new path, paid once for it', async () => {
    bareTake()
    await lostFirstRun()
    const twin = new Blob(['IN-MEMORY: EVERY CHUNK THE RECORDER CAPTURED'], { type: 'audio/webm' })
    expect(twin.size).toBe(memory.size) // the coarse fields agree — only the bytes differ

    const res = await run(twin)

    expect(mints()).toBe(2)
    // The port's mint arm PUTs the blob it is given: the NEW bytes, to a NEW key.
    expect(prepareTranscription.mock.calls[1][0]).toBe(twin)
    expect(prepareTranscription.mock.calls[1][1]).toBeNull()
    expect(paidCalls).toBe(2)
    expect(res.transcript).toBe('answer-2')
    expect(store.meta?.fallbackPin).toMatchObject({ finalizedPath: unbound(2), audio: await pinFp(twin, 42) })
  })

  it('h3 a pin WITHOUT a hash (the pre-S56 shape) never matches → a fresh mint, and the new pin carries a hash', async () => {
    bareTake()
    const legacy: Pin = { finalizedPath: unbound(7), recordingSessionId: null, locale: 'ja', audio: fp(memory, 42), at: 1 }
    store.meta = { ...store.meta!, fallbackPin: legacy }

    await run(memory)

    expect(mints()).toBe(1)
    expect(prepareTranscription.mock.calls[0][1]).toBeNull()
    expect(paidCalls).toBe(1)
    expect(pinTakeFallback).toHaveBeenCalledWith(TAKE, expect.objectContaining({ audio: await pinFp(memory, 42) }))
  })

  it('h4 no crypto.subtle (an insecure origin) → no hash, ONE line; the pin is written WITHOUT a hash and the next attempt does not match', async () => {
    bareTake()
    const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true })
    try {
      await lostFirstRun()
      expect(digestLines()).toHaveLength(1)
      expect(digestLines()[0][1]).toEqual({ subtle: false })
      expect(store.meta?.fallbackPin?.audio).toEqual(fp(memory, 42))
      expect(store.meta?.fallbackPin?.audio).not.toHaveProperty('sha256')

      await run(memory)

      expect(mints()).toBe(2) // the hash-less pin was not re-presented
      expect(paidCalls).toBe(2)
    } finally {
      if (real) Object.defineProperty(globalThis, 'crypto', real)
    }
    expect(typeof globalThis.crypto?.subtle?.digest).toBe('function')
  })

  it('h5 the coarse check still runs FIRST: a different-size blob never reaches the hash — the only digest is the NEW pin’s, after its PUT', async () => {
    bareTake()
    await lostFirstRun()
    const digest = jest.spyOn(globalThis.crypto.subtle, 'digest')
    try {
      await run(recovered) // shorter: the coarse check fails

      expect(mints()).toBe(2)
      expect(digest).toHaveBeenCalledTimes(1)
      // …and that one digest is the pin write's, strictly AFTER the mint + PUT (prepareTranscription).
      expect(digest.mock.invocationCallOrder[0]).toBeGreaterThan(prepareTranscription.mock.invocationCallOrder[1])
    } finally {
      digest.mockRestore()
    }
  })

  it('h5′ a coarse match hashes ONCE per attempt (the match), and a matched run writes no new pin', async () => {
    bareTake()
    await lostFirstRun()
    pinTakeFallback.mockClear()
    const digest = jest.spyOn(globalThis.crypto.subtle, 'digest')
    try {
      await run(memory)
      expect(digest).toHaveBeenCalledTimes(1)
      expect(digest.mock.invocationCallOrder[0]).toBeLessThan(prepareTranscription.mock.invocationCallOrder[1])
      expect(pinTakeFallback).not.toHaveBeenCalled()
    } finally {
      digest.mockRestore()
    }
  })

  // ⚖ S56 (stress lens N8): h4 has no `subtle` from the FIRST run, so its pin never carries a
  // hash and is skipped before the current digest is even asked. Here the pin DOES carry a
  // hash (run 1 had a working `subtle`) and passes the coarse check; only THIS attempt's digest
  // is unavailable. An unknown current hash is never a match — above all for different bytes of
  // the same size, where a match would hand back the OLD take's words for new audio.
  it('h6 a HASHED pin passes the coarse check but THIS attempt’s digest is unavailable → NO match: a fresh mint + PUT of the new bytes, the old path never re-presented, ONE line', async () => {
    bareTake()
    await lostFirstRun()
    expect(store.meta?.fallbackPin?.audio).toEqual(await pinFp(memory, 42))
    expect(store.meta?.fallbackPin?.audio).toHaveProperty('sha256')
    expect(digestLines()).toHaveLength(0)
    const twin = new Blob(['IN-MEMORY: EVERY CHUNK THE RECORDER CAPTURED'], { type: 'audio/webm' })
    expect(twin.size).toBe(memory.size) // the coarse fields agree — the pin is a candidate
    const digest = jest.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('digest failed'))
    try {
      const res = await run(twin)

      // Asked once for this attempt (the match check); the new pin's write reuses that answer.
      expect(digest).toHaveBeenCalledTimes(1)
      expect(digestLines()).toHaveLength(1)
      expect(digestLines()[0][1]).toEqual({ subtle: true })
      expect(mints()).toBe(2)
      expect(prepareTranscription.mock.calls[1][0]).toBe(twin)
      expect(prepareTranscription.mock.calls[1][1]).toBeNull()
      expect(prepareTranscription.mock.calls.map(([, path]) => path)).not.toContain(unbound(1))
      expect(paidCalls).toBe(2)
      expect(res.transcript).toBe('answer-2')
      // The new pin carries no hash (none could be taken): it too never matches.
      expect(store.meta?.fallbackPin).toMatchObject({ finalizedPath: unbound(2), audio: fp(twin, 42) })
      expect(store.meta?.fallbackPin?.audio).not.toHaveProperty('sha256')
    } finally {
      digest.mockRestore()
    }
  })
})
