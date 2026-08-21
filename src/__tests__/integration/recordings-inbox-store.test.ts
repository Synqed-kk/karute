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
const listOwnTakes = jest.fn(async () => [] as unknown[])
jest.mock('@/lib/karute/take-store', () => ({ listOwnTakes: () => listOwnTakes() }))
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { takeId: null } }))
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: { state: 'idle', context: null, subscribe: () => () => {} },
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
