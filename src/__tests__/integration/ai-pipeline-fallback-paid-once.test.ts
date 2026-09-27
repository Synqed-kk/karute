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
 *
 * Real ai-pipeline + secure-take + global-pipeline; the take store, the port,
 * the recorder and the network are faked. The fake port's unbound mint models
 * the server's switch arm (mint-take-url.ts:952-955: a row only when
 * bindUnboundUploads is ON and the outcome is 'no_session'), so the layer
 * matrix forces the switch the lane's way (jest.replaceProperty, as in
 * mint-take-unbound-bind.test.ts). Every id is invented; nothing leaves jest.
 */
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: async () => {} },
}))

type Stamp = { finalizedPath: string; locale: string; response: unknown; at: number; fallback?: true }
type Meta = {
  recordingSessionId?: string
  mimeType?: string
  durationMs?: number
  finalizedAt?: number
  finalizedPath?: string
  startedAt: number
  updatedAt: number
  transcript?: Stamp
}
const store = { meta: null as Meta | null, blob: null as Blob | null }
let onTranscriptRead: (() => void) | null = null
// The shape of take-store's stampTakeTranscript: whole body + path + locale,
// `fallback` only when the unbound door answered. A missing take is a no-op,
// and a fallback answer never lands on a take finalized at ANOTHER key (the
// store's own guard — take-durability.test.ts pins the real one).
const stampTakeTranscript = jest.fn(
  async (_id: string, path: string, locale: string, response: unknown, fallback?: boolean) => {
    if (!store.meta) return
    if (fallback && store.meta.finalizedPath && store.meta.finalizedPath !== path) return
    store.meta = {
      ...store.meta,
      transcript: { finalizedPath: path, locale, response, at: 1, ...(fallback ? { fallback: true as const } : {}) },
    }
  },
)
jest.mock('@/lib/karute/take-store', () => ({
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
  stampTakeTranscript: (id: string, path: string, locale: string, response: unknown, fallback?: boolean) =>
    stampTakeTranscript(id, path, locale, response, fallback),
  isStoppedTake: () => false,
  markTakeFinalized: async (_id: string, path: string) => {
    if (store.meta) store.meta = { ...store.meta, finalizedAt: 1, finalizedPath: path }
  },
  markTakeSecureError: async () => {},
  markTakeStartBoundAttempted: async () => {},
  // First stamp wins; the take is secured at the minted key in the same write
  // (take-durability.test.ts pins the real one).
  adoptTakeSession: async (_id: string, session: string, path: string) => {
    if (!store.meta || store.meta.recordingSessionId || store.meta.finalizedAt) return false
    store.meta = { ...store.meta, recordingSessionId: session, finalizedAt: 1, finalizedPath: path }
    return true
  },
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
    prepareTranscription: (b: Blob, p: string | null, o?: { attachOutcome?: string; takeRow?: string }) =>
      prepareTranscription(b, p, o),
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
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string) => {
      posts.push(url)
      if (url.endsWith('/transcribe')) {
        const body = { transcript: transcriptText(++transcribeSeq) }
        const gate = transcribeGates.shift()
        if (gate) await gate
        return { ok: true, json: async () => body } as unknown as Response
      }
      if (url.endsWith('/extract') && extractRefuses)
        return { ok: false, status: 429, text: async () => '{"error":"limit"}' } as unknown as Response
      const body = url.endsWith('/extract') ? { entries: [] } : { summary: 'まとめ' }
      return { ok: true, json: async () => body } as unknown as Response
    },
  }),
}))

const put = jest.fn(async (_url: string, _init: { body: Blob }) => ({ ok: true, status: 200 }) as Response)
global.fetch = put as unknown as typeof fetch

import { EmptyTranscriptError, runAIPipeline, type PipelineContext } from '@/lib/ai-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

const memory = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
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
    const paidFallback = { takeId: TAKE, locale: 'ja', response: { transcript: 'slot-answer' } }
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
    const paidFallback = { takeId: null, locale: 'ja', response: { transcript: 'remembered' } }
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
    const paidFallback = { takeId: null, locale: 'ja', response: { transcript: 'remembered' } }
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
    const paidFallback = { takeId: 'another-take', locale: 'ja', response: { transcript: 'not-mine' } }
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
