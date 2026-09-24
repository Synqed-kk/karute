/**
 * ⚖ THE IN-TAB RETRY NEVER PAYS TWICE (recording hole PR-2).
 *
 * On the in-tab arm, 再試行 (and every reload) re-runs `runAIPipeline`, which
 * POSTed the SAME finalized object to the transcribe door again — and that door
 * has no existing-karute check, so each run could pay for the same audio. The
 * take now keeps the door's whole answer for the object it was given
 * (`TakeMeta.transcript`), and a run over that same object replays it.
 *
 * The store is faked in memory: what is pinned here is the PIPELINE's rule —
 * when it asks the door, when it stamps, and that it stamps before the empty
 * check. The data port counts every `/transcribe` POST.
 */
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: async () => {} },
}))

const takes = new Map<string, { finalizedPath?: string; transcript?: unknown }>()
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: async (takeId: string) => takes.get(takeId) ?? null,
  ensureFinalizedPath: async (_takeId: string, meta: { finalizedPath?: string }) =>
    meta.finalizedPath ?? null,
  readTakeTranscript: async (takeId: string) => takes.get(takeId)?.transcript ?? null,
  stampTakeTranscript: async (
    takeId: string,
    finalizedPath: string,
    locale: string,
    response: unknown,
  ) => {
    const meta = takes.get(takeId)
    if (meta) meta.transcript = { finalizedPath, locale, response, at: 1 }
  },
}))

jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    prepareTranscription: async (_blob: Blob, finalizedPath: string | null) => ({
      body: { path: finalizedPath ?? 'app_biz-1_staged-9.webm' },
      path: finalizedPath ?? 'app_biz-1_staged-9.webm',
      recordingSessionId: null,
    }),
    finalizedKey: async () => null,
  }),
}))

let transcribeBody: Record<string, unknown> = { transcript: 'こんにちは' }
let extractFails = false
const posts: string[] = []
/** When set, the `/transcribe` answer waits for this — so two runs can both be
 *  in flight before the first answer lands. */
let transcribeGate: Promise<void> | null = null
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string) => {
      posts.push(url)
      if (url.endsWith('/extract') && extractFails) {
        return { ok: false, status: 500, text: async () => 'boom' } as unknown as Response
      }
      if (url.endsWith('/transcribe') && transcribeGate) await transcribeGate
      const body = url.endsWith('/transcribe')
        ? transcribeBody
        : url.endsWith('/extract')
          ? { entries: [] }
          : { summary: 'まとめ' }
      return { ok: true, json: async () => body } as unknown as Response
    },
  }),
}))

import { EmptyTranscriptError, runAIPipeline } from '@/lib/ai-pipeline'

const TAKE = 'take-1'
const FINALIZED = 'app_biz-1_take-1.webm'
const count = (suffix: string) => posts.filter((u) => u.endsWith(suffix)).length
const run = (takeId: string | null = TAKE, locale = 'ja') =>
  runAIPipeline(new Blob(['audio']), takeId, locale, () => {})

beforeEach(() => {
  jest.useRealTimers()
  takes.clear()
  takes.set(TAKE, { finalizedPath: FINALIZED })
  posts.length = 0
  transcribeBody = { transcript: 'こんにちは' }
  extractFails = false
  transcribeGate = null
})

describe('⚖ runAIPipeline never pays for the same finalized object twice', () => {
  it('(1) extraction fails → retry: ONE transcribe POST in total, THREE extract calls (two in run 1 incl. its own retry, one in run 2)', async () => {
    jest.useFakeTimers()
    extractFails = true
    const first = run().catch((e: unknown) => e)
    await jest.runAllTimersAsync()
    expect(await first).toBeInstanceOf(Error)
    jest.useRealTimers()

    extractFails = false
    const result = await run()

    expect(count('/transcribe')).toBe(1)
    // first run: extract + its one retry; second run: one more
    expect(count('/extract')).toBe(3)
    expect(result.transcript).toBe('こんにちは')
  })

  it('(2) a DIFFERENT finalized object is a different answer → the door is asked again', async () => {
    await run()
    takes.get(TAKE)!.finalizedPath = 'app_biz-1_take-1.mp4'
    await run()
    expect(count('/transcribe')).toBe(2)
  })

  it('(3) an empty 2xx is stamped, and replays as EmptyTranscriptError with ZERO POSTs', async () => {
    transcribeBody = { transcript: '' }
    await expect(run()).rejects.toBeInstanceOf(EmptyTranscriptError)
    expect(count('/transcribe')).toBe(1)

    posts.length = 0
    await expect(run()).rejects.toBeInstanceOf(EmptyTranscriptError)
    expect(posts).toHaveLength(0)
  })

  it('(5) the same object in a DIFFERENT locale → the door is asked again', async () => {
    await run(TAKE, 'ja')
    await run(TAKE, 'en')
    expect(count('/transcribe')).toBe(2)
  })

  it('(4) no take: nothing to key on — the door is asked every run, as before', async () => {
    await run(null)
    await run(null)
    expect(count('/transcribe')).toBe(2)
  })

  it('(6) a take with no finalized key yet: nothing to key on — the door is asked every run, nothing stamped', async () => {
    takes.set(TAKE, {})
    await run()
    await run()
    expect(count('/transcribe')).toBe(2)
    expect(takes.get(TAKE)!.transcript).toBeUndefined()
  })
})

describe('⚖ two tabs on the same object take turns (the Web Locks API)', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const setNavigator = (value: unknown) =>
    Object.defineProperty(globalThis, 'navigator', { value, configurable: true })
  afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
  })

  it('(7) two concurrent runs, both in flight before the first answer → ONE transcribe POST, same transcript', async () => {
    // A per-name promise chain: the next holder starts only when the last one
    // settles — what the browser's exclusive lock does across tabs.
    const tails = new Map<string, Promise<unknown>>()
    const requested: string[] = []
    setNavigator({
      locks: {
        request: (name: string, fn: () => Promise<unknown>) => {
          requested.push(name)
          const next = (tails.get(name) ?? Promise.resolve()).then(() => fn())
          tails.set(name, next.catch(() => {}))
          return next
        },
      },
    })
    let open!: () => void
    transcribeGate = new Promise<void>((r) => {
      open = r
    })

    const a = run()
    const b = run()
    for (let i = 0; i < 50; i++) await Promise.resolve()
    // both runs are in flight and one POST is parked before any answer arrives
    expect(requested).toEqual([`karute:transcribe:${FINALIZED}`, `karute:transcribe:${FINALIZED}`])
    open()
    const [ra, rb] = await Promise.all([a, b])

    expect(count('/transcribe')).toBe(1)
    expect(ra.transcript).toBe('こんにちは')
    expect(rb.transcript).toBe(ra.transcript)
  })

  it('(8) no navigator.locks: the run still goes through, unlocked — one run, one POST', async () => {
    setNavigator({})
    const result = await run()
    expect(count('/transcribe')).toBe(1)
    expect(result.transcript).toBe('こんにちは')
  })
})
