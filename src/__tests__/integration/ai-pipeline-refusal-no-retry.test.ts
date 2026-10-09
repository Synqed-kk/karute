/**
 * A REFUSAL IS NOT A BLIP (the transcription spend wall, 2026-09-08).
 *
 * `fetchWithRetry` retried EVERY non-ok answer once, 1.5 s later — including a
 * 429 (the AI spend/rate ceiling) and a 403 (the plan gate), which answer
 * exactly the same the second time. Two costs came with that: a doubled refusal
 * round-trip on a wall that is already saying no, and the retry arm's own
 * message — the raw `HTTP ${status}: ${body}` that puts English on a Japanese
 * screen, which is the leak PipelineErrorCard exists to prevent.
 *
 * A real failure (500, a network throw) keeps its one retry, unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const awaitTakeSecured = jest.fn(async (_takeId: string) => {})
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: (takeId: string) => awaitTakeSecured(takeId) },
}))
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: jest.fn(async () => null),
  ensureFinalizedPath: jest.fn(async () => null),
}))
const prepareTranscription = jest.fn(async () => ({
  body: { path: 'app_biz-1_take-1.webm' },
  path: 'app_biz-1_take-1.webm',
  recordingSessionId: null,
}))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    prepareTranscription: (...a: unknown[]) => prepareTranscription(...(a as [])),
    finalizedKey: jest.fn(async () => null),
  }),
}))

const apiFetch = jest.fn()
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({ apiFetch: (url: string, init: unknown) => apiFetch(url, init) }),
}))

import { runAIPipeline, type PipelineStep } from '@/lib/ai-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'
import { TRANSCRIPT_LEASE_TTL_MS } from '@/lib/recording/transcript-lease-ttl'

/** The refusal body the two transcribe routes really send (the 429 rebuilt
 *  from the classified error, and the plan gate's 403). */
const refusal = (status: number, body: unknown) =>
  ({ ok: false, status, text: async () => JSON.stringify(body), json: async () => body }) as unknown as Response

const blob = { size: 1, type: 'audio/webm' } as unknown as Blob
const run = () => runAIPipeline(blob, null, 'ja', () => {})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('fetchWithRetry — refusals are not retried', () => {
  it('429 → ONE fetch, and the message is the route’s own readable one', async () => {
    apiFetch.mockResolvedValue(
      refusal(429, { error: '本日の文字起こしの上限に達しました', reason: 'daily_cost' }),
    )

    await expect(run()).rejects.toThrow('本日の文字起こしの上限に達しました')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('403 (the plan gate) → ONE fetch', async () => {
    apiFetch.mockResolvedValue(refusal(403, { error: 'PLAN_LOCKED' }))

    await expect(run()).rejects.toThrow('PLAN_LOCKED')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('500 → still TWO fetches (a real failure keeps its one retry)', async () => {
    apiFetch.mockResolvedValue(refusal(500, { error: 'Transcription failed' }))

    await expect(run()).rejects.toThrow()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})

/**
 * ⚖ A 409 FROM THE TRANSCRIBE DOOR IS "STILL WORKING" (S54 B). With the S53 A5
 * lease, a call on audio another call is inside the provider for is answered
 * 409 and pays nothing. The run used to re-send once after 1.5 s, meet the
 * same live lease, and show the generic error card for a recording about to
 * finish fine. Now it stays on 「文字起こし中...」, waits what the door asked
 * (web: `Retry-After`; phone: the body's `error.retry_after_seconds`; else
 * 5 s; never under 1 s), and re-POSTs the same request until the lease could
 * no longer be alive (the shared TTL + one wait); then today's error path.
 */
describe('fetchWithRetry — a 409 from the transcribe door is still working (S54 B)', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  /** The answer the first call saved — what the re-POST replays. */
  const SAVED = { transcript: '本日はカットとカラーで', paragraphs: [], words: [], confidence: 0.9 }
  /** The web door's 409 (api/ai/transcribe/route.ts): the seconds ride in `Retry-After`. */
  const web409 = (retryAfter: string) =>
    json(409, { error: 'this recording is being transcribed — try again shortly', reason: 'transcribing' }, { 'Retry-After': retryAfter })
  /** The phone door's 409 (the facade's errorBody): the seconds ride in the body only, no header. */
  const phone409 = (seconds: number) =>
    json(409, {
      error: {
        code: 'conflict',
        message: 'this recording is being transcribed — try again shortly',
        reason: 'transcribing',
        retry_after_seconds: seconds,
      },
    })
  /** The transcribe door answers these in turn (the last repeats); extract/summarize answer 200 unless told. */
  const doors = (transcribe: Array<() => Response>, extract?: () => Response) => {
    let i = 0
    apiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/transcribe')) return transcribe[Math.min(i++, transcribe.length - 1)]()
      if (url.endsWith('/extract')) return extract ? extract() : json(200, { entries: [] })
      return json(200, { summary: 'まとめ' })
    })
  }
  const posts = (door = '/transcribe') => apiFetch.mock.calls.filter(([url]) => String(url).endsWith(door))
  /** Real macrotask turns (setImmediate is not faked): lets every body read settle. */
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  }
  const advance = async (ms: number, step = ms) => {
    for (let done = 0; done < ms; done += step) {
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - done))
      await flush()
    }
    if (ms === 0) await flush()
  }
  const track = <T,>(promise: Promise<T>) => {
    const t = { settled: false, promise }
    promise.then(
      () => (t.settled = true),
      () => (t.settled = true),
    )
    return t
  }
  const steps: PipelineStep[] = []
  const start = () => track(runAIPipeline(blob, null, 'ja', (step) => steps.push(step)))

  beforeEach(() => {
    steps.length = 0
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate'] })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    globalPipeline.reset()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('t1 409 + Retry-After: 7 → no error, waits 7 s, re-POSTs the SAME request, and the saved answer is used', async () => {
    doors([() => web409('7'), () => json(200, SAVED)])
    const run = start()
    await advance(0)
    expect(posts()).toHaveLength(1)
    await advance(6_999)
    expect(posts()).toHaveLength(1)
    expect(run.settled).toBe(false)
    await advance(1)
    await expect(run.promise).resolves.toMatchObject({ transcript: SAVED.transcript })
    expect(posts()).toHaveLength(2)
    // The pin: the same request, byte for byte — one prepare, one key.
    expect(posts()[1][1]).toEqual(posts()[0][1])
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
    expect(steps).not.toContain('error')
  })

  it('t2 the phone shape (the seconds in the body only, no header) → the same wait, the same re-POST', async () => {
    doors([() => phone409(7), () => json(200, SAVED)])
    const run = start()
    await advance(6_999)
    expect(posts()).toHaveLength(1)
    expect(run.settled).toBe(false)
    await advance(1)
    await expect(run.promise).resolves.toMatchObject({ transcript: SAVED.transcript })
    expect(posts()).toHaveLength(2)
    expect(posts()[1][1]).toEqual(posts()[0][1])
  })

  it('t3 a 409 that names no wait (no header, no body seconds — or no JSON) → the 5 s floor', async () => {
    doors([() => json(409, { error: 'busy' }), () => new Response('busy', { status: 409 }), () => json(200, SAVED)])
    const run = start()
    await advance(4_999)
    expect(posts()).toHaveLength(1)
    await advance(1)
    expect(posts()).toHaveLength(2)
    await advance(4_999)
    expect(posts()).toHaveLength(2)
    await advance(1)
    await expect(run.promise).resolves.toMatchObject({ transcript: SAVED.transcript })
    expect(posts()).toHaveLength(3)
  })

  it('t4 409 forever → re-asked until the lease could no longer be alive (the shared TTL + one wait), then today’s error path', async () => {
    doors([() => web409('7')])
    const run = start()
    await advance(TRANSCRIPT_LEASE_TTL_MS, 500)
    expect(run.settled).toBe(false)
    await advance(7_000 + 1_500 + 500, 500)
    expect(run.settled).toBe(true)
    await expect(run.promise).rejects.toThrow(/^Transcription failed: HTTP 409/)
    // One POST per wait while the lease could live, then today's one 1.5 s re-send — never a tight loop.
    expect(posts()).toHaveLength(Math.floor(TRANSCRIPT_LEASE_TTL_MS / 7_000) + 3)
    await advance(60_000, 1_000)
    expect(posts()).toHaveLength(Math.floor(TRANSCRIPT_LEASE_TTL_MS / 7_000) + 3)
  })

  it('t5 a 500 → today’s single 1.5 s re-send, then the error, unchanged', async () => {
    doors([() => json(500, { error: 'Transcription failed' })])
    const run = start()
    await advance(1_499)
    expect(posts()).toHaveLength(1)
    await advance(1)
    await expect(run.promise).rejects.toThrow(/^Transcription failed: HTTP 500/)
    expect(posts()).toHaveLength(2)
  })

  it('t5b another 4xx (a 404) is NOT still-working → today’s single 1.5 s re-send, then the error', async () => {
    doors([() => json(404, { error: 'recording not found in this business' }, { 'Retry-After': '7' })])
    const run = start()
    await advance(1_499)
    expect(posts()).toHaveLength(1)
    await advance(1)
    await expect(run.promise).rejects.toThrow(/^Transcription failed: HTTP 404/)
    expect(posts()).toHaveLength(2)
  })

  it('t6 409 then 502 → the 502 takes today’s path (one 1.5 s re-send, then the error), not the 409 wait', async () => {
    doors([() => web409('7'), () => json(502, { error: 'could not read the recording' })])
    const run = start()
    await advance(7_000)
    expect(posts()).toHaveLength(2)
    await advance(1_499)
    expect(posts()).toHaveLength(2)
    await advance(1)
    await expect(run.promise).rejects.toThrow(/^Transcription failed: HTTP 502/)
    expect(posts()).toHaveLength(3)
    await advance(60_000, 1_000)
    expect(posts()).toHaveLength(3)
  })

  it('t7 the pill stays 「文字起こし中...」 throughout: globalPipeline is processing/transcribing, never error', async () => {
    doors([() => phone409(7), () => web409('7'), () => json(200, SAVED)])
    const seen: string[] = []
    const off = globalPipeline.subscribe(() => seen.push(`${globalPipeline.state}/${globalPipeline.step}`))
    globalPipeline.start(blob, { locale: 'ja', customers: [], takeId: null })
    for (const ms of [0, 3_500, 3_500, 3_500, 3_499]) {
      await advance(ms)
      expect(globalPipeline.state).toBe('processing')
      expect(globalPipeline.step).toBe('transcribing')
      expect(globalPipeline.error).toBeNull()
    }
    expect(posts()).toHaveLength(2)
    await advance(1)
    expect(posts()).toHaveLength(3)
    expect(globalPipeline.state).toBe('review')
    expect(seen.some((s) => s.startsWith('error'))).toBe(false)
    off()
  })

  it('t8 the other callers of fetchWithRetry (extract, summarize) see today’s behaviour on a 409: one 1.5 s re-send, then the error', async () => {
    doors([() => json(200, SAVED)], () => web409('7'))
    const run = start()
    await advance(1_499)
    expect(posts('/extract')).toHaveLength(1)
    await advance(1)
    await expect(run.promise).rejects.toThrow(/^Extraction failed: HTTP 409/)
    expect(posts('/extract')).toHaveLength(2)
    expect(posts()).toHaveLength(1)
  })

  // ⚖ S55 — THE CLIENT CAPS ONE WAIT AT 10 s. Both doors name the lease's full seconds left (up to the
  // TTL), so an uncapped wait held the pill ~5½ min after a first call that finished in seconds. The
  // loop re-asks after each capped wait until an answer or the unchanged deadline (t4 / c4).
  it.each([
    ['web (Retry-After: 300)', () => web409('300')],
    ['phone (body retry_after_seconds: 300)', () => phone409(300)],
  ] as const)('c1 (S55) %s → the run waits the 10 s cap, not 300 s, then re-POSTs the SAME request', async (_door, conflict) => {
    doors([conflict, () => json(200, SAVED)])
    const run = start()
    await advance(9_999)
    expect(posts()).toHaveLength(1)
    expect(run.settled).toBe(false)
    await advance(1)
    await expect(run.promise).resolves.toMatchObject({ transcript: SAVED.transcript })
    expect(posts()).toHaveLength(2)
    expect(posts()[1][1]).toEqual(posts()[0][1])
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
    expect(steps).not.toContain('error')
  })

  it('c2 (S55) a wait under the cap is unchanged: 3 s → 3 s; Retry-After: 0 → still the 1 s floor', async () => {
    doors([() => web409('3'), () => web409('0'), () => json(200, SAVED)])
    const run = start()
    await advance(2_999)
    expect(posts()).toHaveLength(1)
    await advance(1)
    expect(posts()).toHaveLength(2)
    await advance(999)
    expect(posts()).toHaveLength(2)
    await advance(1)
    await expect(run.promise).resolves.toMatchObject({ transcript: SAVED.transcript })
    expect(posts()).toHaveLength(3)
  })

  it('c3 (S55) 409 (300 s) → 409 (290 s) → 200: two capped waits, the SAME request each time, paid once, no new mint', async () => {
    doors([() => web409('300'), () => phone409(290), () => json(200, SAVED)])
    const run = start()
    await advance(9_999)
    expect(posts()).toHaveLength(1)
    await advance(1)
    expect(posts()).toHaveLength(2)
    await advance(9_999)
    expect(posts()).toHaveLength(2)
    expect(run.settled).toBe(false)
    await advance(1)
    await expect(run.promise).resolves.toMatchObject({ transcript: SAVED.transcript })
    expect(posts()).toHaveLength(3)
    // The pin: every re-POST is the first request, byte for byte — one prepare (the only mint), one 200 (the only payment).
    expect(posts()[1][1]).toEqual(posts()[0][1])
    expect(posts()[2][1]).toEqual(posts()[0][1])
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
    expect(steps).not.toContain('error')
  })

  it('c4 (S55) 409 (300 s) forever → capped waits until the unchanged deadline (TTL + one wait), then today’s error — never an infinite loop', async () => {
    doors([() => web409('300')])
    const run = start()
    await advance(TRANSCRIPT_LEASE_TTL_MS, 500)
    expect(run.settled).toBe(false)
    // The deadline (first 409 + TTL + one capped wait) plus one cap bounds the whole wait.
    await advance(10_000 + 10_000, 500)
    expect(run.settled).toBe(true)
    await expect(run.promise).rejects.toThrow(/^Transcription failed: HTTP 409/)
    expect(posts()).toHaveLength(Math.floor(TRANSCRIPT_LEASE_TTL_MS / 10_000) + 3)
    await advance(60_000, 1_000)
    expect(posts()).toHaveLength(Math.floor(TRANSCRIPT_LEASE_TTL_MS / 10_000) + 3)
  })

  it('t9 a 409 asking for no wait (Retry-After: 0) still waits the 1 s floor — never a tight loop', async () => {
    doors([() => web409('0'), () => json(200, SAVED)])
    const run = start()
    await advance(999)
    expect(posts()).toHaveLength(1)
    await advance(1)
    await expect(run.promise).resolves.toMatchObject({ transcript: SAVED.transcript })
    expect(posts()).toHaveLength(2)
  })

  // ⚖ G8 (S120): the wait's deadline is on the monotonic clock, so a wall clock stepped
  // while a 409 holds neither stretches the polling (back) nor cuts it short (forward).
  it('t10 the wall clock set BACK 1 h, 10 s into the wait → still settles by TTL + 19.5 s, the same POSTs as t4', async () => {
    doors([() => web409('7')])
    const run = start()
    await advance(10_000, 500)
    jest.setSystemTime(Date.now() - 3_600_000)
    await advance(TRANSCRIPT_LEASE_TTL_MS + 9_500, 500)
    expect(run.settled).toBe(true)
    await expect(run.promise).rejects.toThrow(/^Transcription failed: HTTP 409/)
    expect(posts()).toHaveLength(Math.floor(TRANSCRIPT_LEASE_TTL_MS / 7_000) + 3)
  })

  it('t11 the wall clock set FORWARD 1 h, 10 s into the wait → waits the lease out like t4, not an early error', async () => {
    doors([() => web409('7')])
    const run = start()
    await advance(10_000, 500)
    jest.setSystemTime(Date.now() + 3_600_000)
    await advance(TRANSCRIPT_LEASE_TTL_MS - 10_000, 500)
    expect(run.settled).toBe(false)
    await advance(7_000 + 1_500 + 500, 500)
    expect(run.settled).toBe(true)
    expect(posts()).toHaveLength(Math.floor(TRANSCRIPT_LEASE_TTL_MS / 7_000) + 3)
  })
})
