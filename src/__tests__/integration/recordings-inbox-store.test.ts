/**
 * 録音履歴 store — the refresh machinery (fix round 1: FX-2, FX-3, FX-6c).
 *
 * Three things a fold-and-forget store gets wrong, each pinned here:
 *   · FX-2 — a refresh that arrives DURING a fold must not be lost. The one
 *     that matters most is a pipeline settle, which is exactly the moment the
 *     rows change.
 *   · FX-3 — a SUPERSEDED run's completion is silent by construction (the
 *     pipeline guards every settle on runId), so no client event will ever fire
 *     for it. A bounded poll is the only honest way a 処理中 row can resolve
 *     itself, and it must stop the moment nothing is processing.
 *   · FX-6c — a sign-out mid-fetch must never let the previous staffer's
 *     sessions land on a shared salon device.
 */
const listRecordingsInbox = jest.fn()
jest.mock('@/actions/recordings-inbox', () => ({
  listRecordingsInbox: () => listRecordingsInbox(),
}))
const listOwnTakes = jest.fn<Promise<unknown[]>, [exclude?: unknown[]]>(async () => [])
jest.mock('@/lib/karute/take-store', () => ({
  listOwnTakes: (exclude?: unknown[]) => listOwnTakes(exclude),
  // UPDATE 25 GROUP A, piece r — the real set `readLocalTakes` maps
  // `bindingRefused` against. FIX ROUND 2 (Greptile issue 2): the store now
  // maps from BINDING_SECURE_REFUSALS (the four "spoken for" codes), never
  // the full TERMINAL_SECURE_ERRORS — this mock must carry the SAME set
  // take-store's real one does, or the two can drift apart silently.
  BINDING_SECURE_REFUSALS: new Set(['exists', 'reserved_elsewhere', 'not_reserved', 'superseded']),
}))
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { takeId: null } }))
/** UPDATE 25 GROUP A, piece b — mutable so the reconcile tests can put the
 *  pipeline in `error` with a session id, and prove `reset` fires (or doesn't).
 *  FIX ROUND F3 adds `error`: the reconcile must read the pipeline's error
 *  CODE (not just its state) to know whether the card is still the only 破棄
 *  door for an empty-transcript failure. */
const pipelineState = {
  state: 'idle' as string,
  context: null as { recordingSessionId?: string; takeId?: string } | null,
  error: null as string | null,
}
const pipelineReset = jest.fn(() => {
  pipelineState.state = 'idle'
})
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    get state() {
      return pipelineState.state
    },
    get context() {
      return pipelineState.context
    },
    get error() {
      return pipelineState.error
    },
    subscribe: () => () => {},
    reset: (...a: unknown[]) => pipelineReset(...(a as [])),
  },
}))

import {
  INBOX_POLL_MS,
  getInboxState,
  loadInbox,
  resetInbox,
  subscribeInbox,
} from '@/lib/recordings/inbox-store'

const NOW = Date.parse('2026-08-25T04:00:00.000Z')

type Session = {
  recordingSessionId: string
  customerId: string | null
  createdAt: string
  durationSeconds: number | null
  karuteRecordId: string | null
  jobStatus: string | null
  jobProbeFailed: boolean
  jobLastError: string | null
  /** Slice ③ — what the server holds for this session's audio. */
  serverAudio?: 'segments' | 'object' | null
  discardedByStaff?: boolean
}
const session = (over: Partial<Session> & { recordingSessionId: string }): Session => ({
  customerId: 'cust-1',
  createdAt: new Date(NOW - 30 * 60_000).toISOString(),
  durationSeconds: 900,
  karuteRecordId: null,
  jobStatus: null,
  jobProbeFailed: false,
  jobLastError: null,
  ...over,
})

/** A promise this test resolves by hand, so a fold can be held mid-flight. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

let unsubscribe: (() => void) | null = null

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  jest.clearAllMocks()
  listOwnTakes.mockImplementation(async () => [])
  listRecordingsInbox.mockImplementation(async () => [])
  pipelineState.state = 'idle'
  pipelineState.context = null
  pipelineState.error = null
  resetInbox()
  // A mounted consumer — the poll only ever runs while something is watching.
  unsubscribe = subscribeInbox(() => {})
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = null
  resetInbox()
  jest.useRealTimers()
})

describe('FX-2 — a refresh during a fold is deferred, not dropped', () => {
  it('a settle landing mid-load produces exactly ONE follow-up fold, with the new data', async () => {
    const first = deferred<Session[]>()
    listRecordingsInbox.mockReturnValueOnce(first.promise)
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' }),
    ])

    const inFlight = loadInbox()
    await flush()
    // The pipeline settles while the first read is still open.
    void loadInbox()
    void loadInbox()
    void loadInbox()

    first.resolve([]) // the pre-settle world: nothing
    await inFlight
    await flush()

    // One initial read + exactly ONE trailing re-run, no matter how many
    // refreshes piled up.
    expect(listRecordingsInbox).toHaveBeenCalledTimes(2)
    expect(getInboxState().rows).toHaveLength(1)
    expect(getInboxState().rows[0].state).toBe('saved')
  })

  it('sequential loads are not throttled — only concurrent ones collapse', async () => {
    await loadInbox()
    await loadInbox()
    expect(listRecordingsInbox).toHaveBeenCalledTimes(2)
  })

  it('⚖ R2: a mid-fold caller gets a promise it can FOLLOW, not one already resolved', async () => {
    // The server save holds a UI latch until its reload settles. On the
    // single-flight path that reload used to resolve on the same tick: the
    // row re-enabled over a list that had not changed yet and a second tap
    // enqueued again. What the caller must wait for is the TRAILING re-run —
    // the only read that has seen its own write.
    const first = deferred<Session[]>()
    listRecordingsInbox.mockReturnValueOnce(first.promise)
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' }),
    ])

    const started = loadInbox()
    await flush()

    let settled = false
    let rowsWhenSettled = -1
    const follower = loadInbox().then(() => {
      settled = true
      // ⚖ R3 (fix round 3) — the state AT THE MOMENT the promise settled, read
      // inside the `.then()`. Asserting it after the test's own `flush()` below
      // proves nothing about the promise: the trailing re-run finishes inside
      // that flush whether or not anyone awaited it, so dropping the `await` in
      // inbox-store's re-run left this test green. This variable is the only
      // thing here that can tell the two apart.
      rowsWhenSettled = getInboxState().rows.length
    })
    await flush()
    expect(settled).toBe(false)

    first.resolve([]) // the pre-write world
    await started
    await follower
    await flush()

    expect(settled).toBe(true)
    // The FRESH fold — the trailing re-run's, not the one that ran before it.
    expect(rowsWhenSettled).toBe(1)
    expect(getInboxState().rows).toHaveLength(1)
    expect(getInboxState().rows[0].state).toBe('saved')
  })
})

describe('FX-3 — the bounded poll for processing rows', () => {
  it('a 処理中 row re-folds after the interval, and stops once it settles', async () => {
    listRecordingsInbox.mockResolvedValue([session({ recordingSessionId: 's1', jobStatus: 'RUNNING' })])
    await loadInbox()
    await flush()
    expect(getInboxState().rows[0].state).toBe('processing')
    expect(listRecordingsInbox).toHaveBeenCalledTimes(1)

    // The superseded run's record finally lands server-side — silently.
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' }),
    ])
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS)
    await flush()
    expect(listRecordingsInbox).toHaveBeenCalledTimes(2)
    expect(getInboxState().rows[0].state).toBe('saved')

    // …and the timer is gone: nothing is processing any more.
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 5)
    await flush()
    expect(listRecordingsInbox).toHaveBeenCalledTimes(2)
  })

  it('a settled list never arms a timer at all', async () => {
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' }),
    ])
    await loadInbox()
    await flush()
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 3)
    expect(listRecordingsInbox).toHaveBeenCalledTimes(1)
  })

  it('an unknown-job row (probe failed) is processing-class and polls too', async () => {
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', jobProbeFailed: true }),
    ])
    await loadInbox()
    await flush()
    expect(getInboxState().rows[0].state).toBe('processing')
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS)
    await flush()
    expect(listRecordingsInbox).toHaveBeenCalledTimes(2)
  })

  it('a partialOnServer row is 処理中 but does NOT poll — the nightly job resolves it', async () => {
    // Slice ③: this row is waiting on a cron that runs once a night, so a 90 s
    // re-read of the whole inbox for up to three days would cost real calls and
    // catch the change no sooner than the next mount does.
    listRecordingsInbox.mockResolvedValue([
      session({
        recordingSessionId: 's1',
        serverAudio: 'segments',
        createdAt: new Date(NOW - 5 * 60 * 60_000).toISOString(),
      }),
    ])
    await loadInbox()
    await flush()
    expect(getInboxState().rows[0].reason).toBe('partialOnServer')
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 3)
    await flush()
    expect(listRecordingsInbox).toHaveBeenCalledTimes(1)
  })

  it('a live job alongside it still arms the timer — the exclusion is per-reason', async () => {
    listRecordingsInbox.mockResolvedValue([
      session({
        recordingSessionId: 's1',
        serverAudio: 'segments',
        createdAt: new Date(NOW - 5 * 60 * 60_000).toISOString(),
      }),
      session({ recordingSessionId: 's2', jobStatus: 'RUNNING' }),
    ])
    await loadInbox()
    await flush()
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS)
    await flush()
    expect(listRecordingsInbox).toHaveBeenCalledTimes(2)
  })

  it('no mounted consumer → no timer (a nav-less background tab costs nothing)', async () => {
    unsubscribe?.()
    unsubscribe = null
    listRecordingsInbox.mockResolvedValue([session({ recordingSessionId: 's1', jobStatus: 'RUNNING' })])
    await loadInbox()
    await flush()
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 3)
    expect(listRecordingsInbox).toHaveBeenCalledTimes(1)
  })

  it('the last consumer unmounting stands the timer down', async () => {
    listRecordingsInbox.mockResolvedValue([session({ recordingSessionId: 's1', jobStatus: 'RUNNING' })])
    await loadInbox()
    await flush()
    unsubscribe?.()
    unsubscribe = null
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 3)
    expect(listRecordingsInbox).toHaveBeenCalledTimes(1)
  })
})

describe('FX-6c — the epoch guard (shared salon device)', () => {
  it('a sign-out mid-fetch leaves the store EMPTY when the read finally lands', async () => {
    const held = deferred<Session[]>()
    listRecordingsInbox.mockReturnValueOnce(held.promise)

    const inFlight = loadInbox()
    await flush()
    // The staffer signs out while their sessions are still in the air.
    resetInbox()
    held.resolve([session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' })])
    await inFlight
    await flush()

    expect(getInboxState()).toMatchObject({
      status: 'idle',
      rows: [],
      needsAttention: 0,
      serverFailed: false,
    })
  })

  it('resetInbox also kills a pending poll', async () => {
    listRecordingsInbox.mockResolvedValue([session({ recordingSessionId: 's1', jobStatus: 'RUNNING' })])
    await loadInbox()
    await flush()
    resetInbox()
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 3)
    expect(listRecordingsInbox).toHaveBeenCalledTimes(1)
  })
})

/**
 * FIX ROUND 2 (Greptile issue 1) — a THROWN server read must never manufacture
 * a d3 (`sessionUnlisted`) row: `runInbox` passes `serverReadFailed:
 * server.failed` into the fold, which withholds the whole unlisted-session
 * loop rather than reading the empty `sessions` array as a genuine "no
 * record" answer.
 */
describe('録音履歴 — FIX ROUND 2: a failed server read never manufactures a d3 row', () => {
  it('listRecordingsInbox throwing → serverFailed true, and a session-stamped take past the grace gets NO row', async () => {
    listOwnTakes.mockImplementation(async () => [
      {
        takeId: 't1',
        recordingSessionId: 'sess-ghost',
        customerId: 'cust-1',
        customerName: '佐藤 美咲',
        // Past SESSION_UNSETTLED_GRACE_MS (3h) — exactly the shape that used
        // to fold to `sessionUnlisted` off an empty, FAILED server read.
        startedAt: NOW - 4 * 60 * 60_000,
        updatedAt: NOW - 4 * 60 * 60_000,
      },
    ])
    listRecordingsInbox.mockRejectedValue(new Error('network down'))
    await loadInbox()
    await flush()
    expect(getInboxState().serverFailed).toBe(true)
    expect(getInboxState().rows).toHaveLength(0)
  })

  it('the SAME stamped take DOES fold to sessionUnlisted once the server read succeeds (empty, but complete)', async () => {
    listOwnTakes.mockImplementation(async () => [
      {
        takeId: 't1',
        recordingSessionId: 'sess-ghost',
        customerId: 'cust-1',
        customerName: '佐藤 美咲',
        startedAt: NOW - 4 * 60 * 60_000,
        updatedAt: NOW - 4 * 60 * 60_000,
      },
    ])
    listRecordingsInbox.mockResolvedValue([])
    await loadInbox()
    await flush()
    expect(getInboxState().serverFailed).toBe(false)
    expect(getInboxState().rows).toMatchObject([{ key: 'take:t1', reason: 'sessionUnlisted' }])
  })

  // MUTANT anchor: dropping the `serverReadFailed: server.failed` pass-through
  // (back to the bare `deriveInboxRows({ sessions, takes, now })` call) turns
  // the first test above's row count back to 1 — RED — see the report's
  // RED-then-restored capture.
})

/**
 * UPDATE 25 GROUP A, piece b — the pill reconciles with the row's durable
 * truth. Traced (cold read): `reset()`'s `notify()` re-fires the pipeline
 * watch INSIDE this call's own stack, but `loading` is still true at that
 * point, so the re-entrant `loadInbox()` defers to ONE trailing re-run, which
 * finds `idle` and resets nothing again.
 */
describe('録音履歴 — b: the pill reconciles with the row (piece b)', () => {
  it('error + a matching FAILED row with canRetry → reset called once; the next fold does not reset again', async () => {
    listOwnTakes.mockImplementation(async () => [
      { takeId: 't1', recordingSessionId: 's1', customerId: null, customerName: null, startedAt: NOW, updatedAt: NOW },
    ])
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'boom' }),
    ])
    pipelineState.state = 'error'
    pipelineState.context = { recordingSessionId: 's1', takeId: 't1' }

    await loadInbox()
    await flush()
    expect(pipelineReset).toHaveBeenCalledTimes(1)
    expect(getInboxState().rows[0].state).toBe('failed')
    expect(getInboxState().rows[0].canRetry).toBe(true)

    // Second fold: reset() flipped pipelineState.state to 'idle' (the mock's
    // own effect), so this fold must find nothing left to reconcile.
    await loadInbox()
    await flush()
    expect(pipelineReset).toHaveBeenCalledTimes(1)
  })

  it('error + a PROCESSING row → NOT reset (no server job exists for it — the card is the only truth)', async () => {
    listRecordingsInbox.mockResolvedValue([session({ recordingSessionId: 's1', jobStatus: 'RUNNING' })])
    pipelineState.state = 'error'
    pipelineState.context = { recordingSessionId: 's1', takeId: 't1' }
    await loadInbox()
    await flush()
    expect(pipelineReset).not.toHaveBeenCalled()
  })

  it('error + NO session id on the context → NOT reset (nothing to look up)', async () => {
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'boom' }),
    ])
    pipelineState.state = 'error'
    pipelineState.context = { takeId: 't1' }
    await loadInbox()
    await flush()
    expect(pipelineReset).not.toHaveBeenCalled()
  })

  it('error + a FAILED row with NO audio anywhere → NOT reset (the card’s blob is the last copy)', async () => {
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'boom' }),
    ])
    pipelineState.state = 'error'
    pipelineState.context = { recordingSessionId: 's1', takeId: 't1' }
    // No local take AND no serverAudio: canRetry is false, serverAudio undefined.
    await loadInbox()
    await flush()
    expect(pipelineReset).not.toHaveBeenCalled()
  })

  it('error + a session the staffer already DISCARDED → reset (a colleague’s decision, already inert)', async () => {
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', discardedByStaff: true }),
    ])
    pipelineState.state = 'error'
    pipelineState.context = { recordingSessionId: 's1', takeId: 't1' }
    await loadInbox()
    await flush()
    expect(pipelineReset).toHaveBeenCalledTimes(1)
  })

  it('the errored run’s OWN take IS in the fold — readLocalTakes stops excluding it', async () => {
    pipelineState.state = 'error'
    pipelineState.context = { recordingSessionId: 's1', takeId: 't-err' }
    listRecordingsInbox.mockResolvedValue([])
    await loadInbox()
    await flush()
    const excludeArg = listOwnTakes.mock.calls[0][0] as Array<string | null>
    expect(excludeArg).not.toContain('t-err')
  })

  it('idle (the ordinary case) still excludes the live take, unchanged', async () => {
    pipelineState.state = 'processing'
    pipelineState.context = { recordingSessionId: 's1', takeId: 't-live' }
    listRecordingsInbox.mockResolvedValue([])
    await loadInbox()
    await flush()
    const excludeArg = listOwnTakes.mock.calls[0][0] as Array<string | null>
    expect(excludeArg).toContain('t-live')
  })

  // FIX ROUND F3 — the card is the ONLY 破棄 door for an empty-transcript
  // failure while it still holds a take (the recovery banner's 破棄 is gated
  // `belowFloor`, and the 録音履歴 row itself offers no discard). Standing the
  // card down here would remove that door with nothing replacing it.
  it('error empty-transcript + context.takeId + a matching FAILED row with canRetry → NOT reset (the card is the only 破棄 door)', async () => {
    listOwnTakes.mockImplementation(async () => [
      { takeId: 't1', recordingSessionId: 's1', customerId: null, customerName: null, startedAt: NOW, updatedAt: NOW },
    ])
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'EMPTY_TRANSCRIPT' }),
    ])
    pipelineState.state = 'error'
    pipelineState.error = 'empty-transcript'
    pipelineState.context = { recordingSessionId: 's1', takeId: 't1' }

    await loadInbox()
    await flush()
    expect(pipelineReset).not.toHaveBeenCalled()
  })

  it('error empty-transcript with NO context.takeId → reset (nothing left holding the 破棄 door, the row speaks)', async () => {
    listOwnTakes.mockImplementation(async () => [
      { takeId: 't1', recordingSessionId: 's1', customerId: null, customerName: null, startedAt: NOW, updatedAt: NOW },
    ])
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', jobStatus: 'FAILED', jobLastError: 'EMPTY_TRANSCRIPT' }),
    ])
    pipelineState.state = 'error'
    pipelineState.error = 'empty-transcript'
    pipelineState.context = { recordingSessionId: 's1' }

    await loadInbox()
    await flush()
    expect(pipelineReset).toHaveBeenCalledTimes(1)
  })

  // MUTANT anchor: dropping the `error === 'empty-transcript' && context?.takeId`
  // clause lets the first case above reset — RED — see the report's
  // RED-then-restored capture.
})

/**
 * UPDATE 25 GROUP A, piece r — `readLocalTakes` maps `bindingRefused` from
 * take-store's own BINDING_SECURE_REFUSALS set (never re-derived here). FIX
 * ROUND 2 (Greptile issue 2): this is the narrower "spoken for" set, not the
 * full TERMINAL_SECURE_ERRORS — a terminal-but-non-binding code (`bad_mime`
 * and its six siblings) must map to `bindingRefused: false`.
 */
describe('録音履歴 — r: the store’s bindingRefused mapping', () => {
  it('a BINDING refusal (reserved_elsewhere) with a karute on its session folds to refusedHasRecord', async () => {
    listOwnTakes.mockImplementation(async () => [
      {
        takeId: 't1',
        recordingSessionId: 's1',
        customerId: 'cust-1',
        customerName: '佐藤 美咲',
        startedAt: NOW - 30 * 60_000,
        updatedAt: NOW - 10 * 60_000,
        secureError: 'reserved_elsewhere',
      },
    ])
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' }),
    ])
    await loadInbox()
    await flush()
    const rows = getInboxState().rows
    expect(rows.find((r) => r.key === 'session:s1')).toMatchObject({ state: 'saved', takeId: null })
    expect(rows.find((r) => r.key === 'take:t1')).toMatchObject({
      state: 'recoverable',
      reason: 'refusedHasRecord',
    })
  })

  it('an ORDINARY retryable failure (session) is NOT bindingRefused — 確認待ち unchanged', async () => {
    listOwnTakes.mockImplementation(async () => [
      {
        takeId: 't1',
        recordingSessionId: 's1',
        customerId: 'cust-1',
        customerName: '佐藤 美咲',
        startedAt: NOW - 30 * 60_000,
        updatedAt: NOW - 10 * 60_000,
        secureError: 'session',
      },
    ])
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' }),
    ])
    await loadInbox()
    await flush()
    const rows = getInboxState().rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'awaiting-check', reason: 'autoSaved' })
  })

  // FIX ROUND 2 (Greptile issue 2) — the case the bug actually was: `bad_mime`
  // IS in TERMINAL_SECURE_ERRORS (it stops the drain re-uploading) but is NOT
  // one of the four BINDING refusals — nothing about it says this take must
  // not attach to its session. Before this fix the store mapped off the full
  // set, so this take folded to `bindingRefused: true` and the page detached
  // + re-minted + saved it as a SEPARATE karute.
  it('a TERMINAL-but-non-binding refusal (bad_mime) is NOT bindingRefused — 確認待ち unchanged', async () => {
    listOwnTakes.mockImplementation(async () => [
      {
        takeId: 't1',
        recordingSessionId: 's1',
        customerId: 'cust-1',
        customerName: '佐藤 美咲',
        startedAt: NOW - 30 * 60_000,
        updatedAt: NOW - 10 * 60_000,
        secureError: 'bad_mime',
      },
    ])
    listRecordingsInbox.mockResolvedValue([
      session({ recordingSessionId: 's1', karuteRecordId: 'rec-1' }),
    ])
    await loadInbox()
    await flush()
    const rows = getInboxState().rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'awaiting-check', reason: 'autoSaved' })
  })

  // MUTANT anchor: mapping `bindingRefused` off the full TERMINAL_SECURE_ERRORS
  // again turns the bad_mime case above into a refusedHasRecord row — RED —
  // see the report's RED-then-restored capture.
})
