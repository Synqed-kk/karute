/**
 * @jest-environment jsdom
 *
 * THE SEGMENT PUMP (src/lib/recording/segment-uploader.ts — slice five packet C,
 * D7). What this file owns is the ONE decision the pump makes over and over:
 * **has the server got this segment, provably?** Everything else follows from it.
 *
 * The three answers that must never be confused, because the assembler will one
 * day rebuild a take out of these objects:
 *   · storage's own 2xx  → landed;
 *   · an object already at the key whose byte length is THIS DEVICE'S segment
 *     → landed, and nothing is uploaded (the retry whose mark was lost);
 *   · anything else, the 409 on a freshly signed PUT included → NOT landed. A
 *     segment key is composable in advance, so meeting an object there is not
 *     evidence anybody recorded it.
 *
 * And the mark it writes is a CONTIGUOUS PREFIX, never a set: a seq that landed
 * behind a hole is real on storage and still does not advance `uploadedSeq`,
 * because "everything up to here is present" is the only claim an assembler can
 * use.
 *
 * The store and the door are mocked — their own behaviour is proved in
 * take-durability.test.ts and the two port suites. TERMINAL_SECURE_ERRORS is
 * the REAL list, because "which refusals can never turn into a yes" is shared
 * with the whole-take path and the two must not drift.
 */

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  }),
}))

type UploadMeta = {
  recordingSessionId: string | null
  mimeType: string
  uploadedSeq?: number
  lastSeq: number
  finalizedAt?: number
  segmentError?: string
}
const readTakeUploadMeta = jest.fn<Promise<UploadMeta | null>, [string]>(async () => null)
const listTakeSegmentsAfter = jest.fn<
  Promise<{ seq: number; blob: Blob }[]>,
  [string, number, number]
>(async () => [])
const markSegmentsUploaded = jest.fn<Promise<void>, [string, number]>(async () => {})
const markSegmentError = jest.fn<Promise<void>, [string, string]>(async () => {})
jest.mock('@/lib/karute/take-store', () => ({
  readTakeUploadMeta: (id: string) => readTakeUploadMeta(id),
  listTakeSegmentsAfter: (id: string, after: number, limit: number) =>
    listTakeSegmentsAfter(id, after, limit),
  markSegmentsUploaded: (id: string, seq: number) => markSegmentsUploaded(id, seq),
  markSegmentError: (id: string, code: string) => markSegmentError(id, code),
  // The REAL set, reached through the file's own idiom: this is the one place
  // that says which door refusals are terminal, and a literal copy here would
  // pass happily on the day the real list changed underneath it.
  TERMINAL_SECURE_ERRORS: jest.requireActual('@/lib/karute/take-store').TERMINAL_SECURE_ERRORS,
}))

import type {
  MintSegmentUrlsPortResult,
  RecordingPipelinePort,
} from '@/lib/ports/recording-port'
import {
  pumpSegments,
  SEGMENT_BACKOFF_MIN_MS,
  SEGMENT_BATCH,
  SEGMENT_CONCURRENCY,
  SEGMENT_PUT_FLOOR_MS,
  __resetSegmentPumpState,
} from '@/lib/recording/segment-uploader'
import { putDeadlineMs } from '@/lib/recording/storage-put'
import { MAX_SEGMENT_BATCH } from '@/lib/app-api/record-schemas'

const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const RS = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const segPath = (seq: number) => `seg/app_biz-1_${TAKE}/${String(seq).padStart(6, '0')}.webm`
const segUrl = (seq: number) => `https://proj.supabase.co/upload/${segPath(seq)}?token=up`
/** The seq a signed URL belongs to — how the fetch mock knows which PUT it is. */
const seqOf = (url: string) => Number(url.match(/\/(\d{6})\.webm/)![1])

/** A segment blob whose SIZE is distinctive per seq, so an `existingSize`
 *  comparison can be wrong in a way the test can name. */
const segBlob = (seq: number) => new Blob(['x'.repeat(10 + seq)])
const rows = (...seqs: number[]) => seqs.map((seq) => ({ seq, blob: segBlob(seq) }))

const meta = (over: Partial<UploadMeta> = {}): UploadMeta => ({
  recordingSessionId: RS,
  mimeType: 'audio/webm',
  lastSeq: 2,
  ...over,
})

// Typed as the PORT's own union, so a case that answers the already-there arm
// or a refusal is the contract being exercised rather than the mock's inferred
// shape widening under it.
const mintSegmentUrls = jest.fn(
  async (
    _takeId: string,
    _mimeType: string,
    _rs: string,
    seqs: number[],
  ): Promise<MintSegmentUrlsPortResult> => ({
    segments: seqs.map((seq) => ({
      seq,
      path: segPath(seq),
      url: segUrl(seq),
      contentType: 'audio/webm',
    })),
  }),
)
const port = { mintSegmentUrls } as unknown as RecordingPipelinePort

/** Which seqs were LAUNCHED, in order, and how many were in flight at the peak. */
let launched: number[] = []
let inFlight = 0
let highWater = 0
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>(
  async () => ({ ok: true, status: 200 }) as unknown as Response,
)

/** A PUT that takes a real tick to answer, so overlap is observable at all: an
 *  instantly-resolved fetch never has two in flight, whatever the pool does. */
const slowPut = (answer: (seq: number) => { ok: boolean; status: number }, ms = 0) =>
  fetchMock.mockImplementation(async (url: string) => {
    const seq = seqOf(url)
    launched.push(seq)
    inFlight++
    highWater = Math.max(highWater, inFlight)
    await new Promise((r) => setTimeout(r, ms))
    inFlight--
    return answer(seq) as unknown as Response
  })

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  __resetSegmentPumpState()
  launched = []
  inFlight = 0
  highWater = 0
  readTakeUploadMeta.mockImplementation(async () => meta())
  listTakeSegmentsAfter.mockImplementation(async () => rows(0, 1, 2))
  markSegmentsUploaded.mockImplementation(async () => {})
  markSegmentError.mockImplementation(async () => {})
  mintSegmentUrls.mockImplementation(async (_t, _m, _r, seqs: number[]) => ({
    segments: seqs.map((seq) => ({
      seq,
      path: segPath(seq),
      url: segUrl(seq),
      contentType: 'audio/webm',
    })),
  }))
  slowPut(() => ({ ok: true, status: 200 }))
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('the segment pump — what it sends, and in what order', () => {
  it('asks the door for the CONTIGUOUS seqs the store handed it, and PUTs every one', async () => {
    await pumpSegments(port, TAKE)
    expect(listTakeSegmentsAfter).toHaveBeenCalledWith(TAKE, -1, SEGMENT_BATCH)
    expect(mintSegmentUrls).toHaveBeenCalledWith(TAKE, 'audio/webm', RS, [0, 1, 2])
    expect(launched.sort()).toEqual([0, 1, 2])
    expect(markSegmentsUploaded).toHaveBeenCalledWith(TAKE, 2)
  })

  it('resumes from uploadedSeq — never re-sends what the server already has', async () => {
    readTakeUploadMeta.mockImplementation(async () => meta({ uploadedSeq: 4, lastSeq: 7 }))
    listTakeSegmentsAfter.mockImplementation(async () => rows(5, 6, 7))
    await pumpSegments(port, TAKE)
    expect(listTakeSegmentsAfter).toHaveBeenCalledWith(TAKE, 4, SEGMENT_BATCH)
    expect(mintSegmentUrls).toHaveBeenCalledWith(TAKE, 'audio/webm', RS, [5, 6, 7])
    expect(markSegmentsUploaded).toHaveBeenCalledWith(TAKE, 7)
  })

  // The earliest seqs are the only ones that can advance the prefix, so they
  // must be the ones that go first when the network has room for three.
  it('launches in SEQ ORDER, never more than SEGMENT_CONCURRENCY at once', async () => {
    listTakeSegmentsAfter.mockImplementation(async () => rows(0, 1, 2, 3, 4, 5, 6, 7))
    readTakeUploadMeta.mockImplementation(async () => meta({ lastSeq: 7 }))
    slowPut(() => ({ ok: true, status: 200 }), 5)

    await pumpSegments(port, TAKE)

    expect(launched).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(highWater).toBe(SEGMENT_CONCURRENCY)
    expect(markSegmentsUploaded).toHaveBeenCalledWith(TAKE, 7)
  })

  it('the batch cap is the door’s own — one number, not two', () => {
    expect(SEGMENT_BATCH).toBe(MAX_SEGMENT_BATCH)
  })
})

describe('the segment pump — what counts as LANDED', () => {
  it('a 2xx advances the mark', async () => {
    await pumpSegments(port, TAKE)
    expect(markSegmentsUploaded).toHaveBeenCalledWith(TAKE, 2)
    expect(markSegmentError).not.toHaveBeenCalled()
  })

  // ⚖ A 409 ON A FRESHLY SIGNED PUT IS NOT A LANDING. The mint probed this key a
  // moment ago and found it free, so an object appearing since is a race the
  // door did not see — and "already there" is only ever actionable as a SIZE.
  it('a 409 on a freshly signed PUT does NOT advance — the take backs off instead', async () => {
    slowPut((seq) => (seq === 1 ? { ok: false, status: 409 } : { ok: true, status: 200 }))
    await pumpSegments(port, TAKE)
    // seq 0 landed, so the prefix moves to 0 and no further.
    expect(markSegmentsUploaded).toHaveBeenCalledWith(TAKE, 0)
    expect(markSegmentError).not.toHaveBeenCalled()
    // …and the failure put the take in a backoff window: the next flush a
    // moment later mints nothing.
    mintSegmentUrls.mockClear()
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).not.toHaveBeenCalled()
  })

  // ⚖ THE ONE LEGITIMATE "ALREADY THERE": our own bytes, our own length — the
  // retry whose markSegmentsUploaded was lost.
  it('an existingSize that MATCHES the blob advances with no PUT at all', async () => {
    mintSegmentUrls.mockImplementation(async (_t, _m, _r, seqs: number[]) => ({
      segments: seqs.map((seq) => ({
        seq,
        path: segPath(seq),
        contentType: 'audio/webm',
        existingSize: segBlob(seq).size,
      })),
    }))
    await pumpSegments(port, TAKE)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markSegmentsUploaded).toHaveBeenCalledWith(TAKE, 2)
    expect(markSegmentError).not.toHaveBeenCalled()
  })

  it.each([
    ['a DIFFERENT length', 999],
    ['no length at all — storage answered without one', null],
  ])('an existingSize that is %s → seg_mismatch, no PUT, and no second mint', async (_l, size) => {
    mintSegmentUrls.mockImplementation(async (_t, _m, _r, seqs: number[]) => ({
      segments: seqs.map((seq) => ({
        seq,
        path: segPath(seq),
        contentType: 'audio/webm',
        existingSize: seq === 0 ? (size as number | null) : segBlob(seq).size,
      })),
    }))
    await pumpSegments(port, TAKE)
    // Nothing uploaded, nothing overwritten, nothing deleted.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markSegmentError).toHaveBeenCalledWith(TAKE, 'seg_mismatch')
    // The prefix never started, so the mark never moves.
    expect(markSegmentsUploaded).not.toHaveBeenCalled()
    // …and the mark is terminal FOR THE SEGMENTS: the next flush asks the store
    // and stops, without touching the door.
    readTakeUploadMeta.mockImplementation(async () => meta({ segmentError: 'seg_mismatch' }))
    mintSegmentUrls.mockClear()
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).not.toHaveBeenCalled()
  })

  // ⚖ THE MARK IS A PREFIX. Seqs 4 and 5 really did land — they are on storage
  // and nothing removes them — and they still do not count, because everything
  // an assembler can do starts at the beginning.
  it('a failure at seq 3 of 5 marks 2, even when 4 and 5 landed', async () => {
    // The server already has seq 0, so the store hands back 1..5 — contiguous
    // from `uploadedSeq + 1`, which is that function's whole contract.
    readTakeUploadMeta.mockImplementation(async () => meta({ uploadedSeq: 0, lastSeq: 5 }))
    listTakeSegmentsAfter.mockImplementation(async () => rows(1, 2, 3, 4, 5))
    // seq 3 answers LAST, so 4 and 5 are launched and landed before the pool
    // learns anything went wrong — the honest shape of this race.
    fetchMock.mockImplementation(async (url: string) => {
      const seq = seqOf(url)
      launched.push(seq)
      if (seq === 3) {
        await new Promise((r) => setTimeout(r, 50))
        return { ok: false, status: 500 } as unknown as Response
      }
      return { ok: true, status: 200 } as unknown as Response
    })

    await pumpSegments(port, TAKE)

    expect(launched.sort()).toEqual([1, 2, 3, 4, 5])
    expect(markSegmentsUploaded).toHaveBeenCalledWith(TAKE, 2)
    expect(markSegmentsUploaded).toHaveBeenCalledTimes(1)
    // A refusal is a moment in time, not a fact about the take — never marked.
    expect(markSegmentError).not.toHaveBeenCalled()
    mintSegmentUrls.mockClear()
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).not.toHaveBeenCalled()
  })

  it('a failure stops the pool LAUNCHING more — the recording still running keeps the bandwidth', async () => {
    readTakeUploadMeta.mockImplementation(async () => meta({ lastSeq: 9 }))
    listTakeSegmentsAfter.mockImplementation(async () => rows(0, 1, 2, 3, 4, 5, 6, 7, 8, 9))
    slowPut((seq) => (seq === 0 ? { ok: false, status: 503 } : { ok: true, status: 200 }), 5)

    await pumpSegments(port, TAKE)

    // The three the pool had already started, and nothing after them.
    expect(launched.length).toBeLessThanOrEqual(SEGMENT_CONCURRENCY)
    expect(markSegmentsUploaded).not.toHaveBeenCalled()
  })
})

describe('the segment pump — when it does nothing at all', () => {
  it.each([
    ['the take is gone, or is another staffer’s', null],
    ['the start-mint has not stamped a row yet', meta({ recordingSessionId: null })],
    ['the WHOLE take is already on the server', meta({ finalizedAt: Date.now() })],
    ['a terminal segment refusal is already recorded', meta({ segmentError: 'not_reserved' })],
    ['the disk holds nothing the server does not', meta({ uploadedSeq: 2, lastSeq: 2 })],
  ])('%s → no store walk, no mint, no PUT', async (_label, m) => {
    readTakeUploadMeta.mockImplementation(async () => m)
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markSegmentsUploaded).not.toHaveBeenCalled()
  })

  it('an empty segment list → nothing minted', async () => {
    listTakeSegmentsAfter.mockImplementation(async () => [])
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).not.toHaveBeenCalled()
  })

  // SINGLE-FLIGHT. The pump is fired from the flush queue AND awaited by the
  // stop leg, so two calls genuinely overlap — and two runs would mint the same
  // seqs twice and PUT the same immutable keys twice.
  it('two overlapping calls are ONE run, and the second waits for the first', async () => {
    slowPut(() => ({ ok: true, status: 200 }), 10)
    const a = pumpSegments(port, TAKE)
    const b = pumpSegments(port, TAKE)
    await Promise.all([a, b])
    expect(mintSegmentUrls).toHaveBeenCalledTimes(1)
    expect(launched.sort()).toEqual([0, 1, 2])
    expect(markSegmentsUploaded).toHaveBeenCalledTimes(1)
    // …and once it has finished, the take is pumpable again.
    readTakeUploadMeta.mockImplementation(async () => meta({ uploadedSeq: 2, lastSeq: 3 }))
    listTakeSegmentsAfter.mockImplementation(async () => rows(3))
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).toHaveBeenCalledTimes(2)
  })
})

describe('the segment pump — what the door’s refusals cost', () => {
  it('a TERMINAL mint refusal is written on the take, and never asked again', async () => {
    mintSegmentUrls.mockImplementation(async () => ({ error: 'not_reserved' }))
    await pumpSegments(port, TAKE)
    expect(markSegmentError).toHaveBeenCalledWith(TAKE, 'not_reserved')
    expect(fetchMock).not.toHaveBeenCalled()

    readTakeUploadMeta.mockImplementation(async () => meta({ segmentError: 'not_reserved' }))
    mintSegmentUrls.mockClear()
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).not.toHaveBeenCalled()
  })

  it.each(['upstream', 'mint_502', 'mint_429'])(
    'a RETRYABLE mint refusal (%s) marks nothing — it only backs off',
    async (code) => {
      mintSegmentUrls.mockImplementation(async () => ({ error: code }))
      await pumpSegments(port, TAKE)
      expect(markSegmentError).not.toHaveBeenCalled()
      expect(markSegmentsUploaded).not.toHaveBeenCalled()
      mintSegmentUrls.mockClear()
      await pumpSegments(port, TAKE)
      expect(mintSegmentUrls).not.toHaveBeenCalled()
    },
  )

  it('a door that answers a seq it was not asked about is a refusal, not a guess', async () => {
    mintSegmentUrls.mockImplementation(async () => ({
      segments: [{ seq: 99, path: segPath(99), url: segUrl(99), contentType: 'audio/webm' }],
    }))
    await pumpSegments(port, TAKE)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markSegmentsUploaded).not.toHaveBeenCalled()
    expect(markSegmentError).not.toHaveBeenCalled()
  })

  // NEVER THROWS: the callers are the capture path and the stop leg, and
  // neither may be failed by an upload.
  it.each([
    ['the store throws', () => readTakeUploadMeta.mockImplementation(async () => { throw new Error('idb') })],
    ['the door throws', () => mintSegmentUrls.mockImplementation(async () => { throw new Error('boom') })],
    ['fetch throws', () => fetchMock.mockImplementation(async () => { throw new Error('socket') })],
  ])('%s → the pump settles, and the take is untouched', async (_label, arrange) => {
    arrange()
    await expect(pumpSegments(port, TAKE)).resolves.toBeUndefined()
    expect(markSegmentsUploaded).not.toHaveBeenCalled()
    expect(markSegmentError).not.toHaveBeenCalled()
  })
})

describe('the segment pump — the backoff window', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  // Every PUT carries a size-derived deadline — storage-put's shared RATE under
  // this file's own floor (SEGMENT_PUT_FLOOR_MS) — so a socket that stalls
  // releases instead of holding the pump for the page's life, and the seq is
  // simply not landed, which is retryable.
  it('a PUT that never answers is aborted at its deadline, and stays retryable', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        }) as unknown as Promise<Response>,
    )
    const done = pumpSegments(port, TAKE)
    // The store read, the door call and the pool all settle on microtasks, and
    // the PUT deadlines do not exist until the fetches are actually in flight —
    // advancing the clock before that would find no timers to fire.
    for (let i = 0; i < 25; i++) await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(SEGMENT_CONCURRENCY)

    await jest.advanceTimersByTimeAsync(60_000)
    await expect(done).resolves.toBeUndefined()

    expect(markSegmentsUploaded).not.toHaveBeenCalled()
    // Retryable, never terminal: a stall is a moment in time.
    expect(markSegmentError).not.toHaveBeenCalled()
    // …and once the window passes, the pump asks again.
    mintSegmentUrls.mockClear()
    // An INSTANT answer for the second half — the clock is faked here, so a PUT
    // that waits on a real tick would simply never come back.
    fetchMock.mockImplementation(
      async () => ({ ok: true, status: 200 }) as unknown as Response,
    )
    // Comfortably past the first step's ceiling (MIN·2^0 + up to one MIN of
    // jitter), so the case cannot pass or fail on a random draw.
    await jest.advanceTimersByTimeAsync(5 * SEGMENT_BACKOFF_MIN_MS)
    await pumpSegments(port, TAKE)
    expect(mintSegmentUrls).toHaveBeenCalledTimes(1)
  })

  // ⚖ AND THE FLOOR IS THE SEGMENT'S OWN, NOT THE TAKE'S (rebase round 1, R2).
  // `putDeadlineMs` floors at 60 s because it is written for a TAKE — "never
  // under a minute", so the number that mercy-kills a stalled 2 MB upload
  // cannot cut a 90-minute one off mid-flight. But the STOP LEG AWAITS this
  // pump before it secures the whole take, so on a dead link three in-flight
  // segment PUTs of a few tens of KB held the stop for that full minute before
  // secureTake even started — and awaitTakeSecured's 120 s belt then fired on
  // the in-tab reader waiting behind it. The RATE is unchanged and imported;
  // only the floor is this file's.
  it('a stalled segment PUT is cut at the SEGMENT floor, not the take’s minute', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        }) as unknown as Promise<Response>,
    )
    let settled = false
    const done = pumpSegments(port, TAKE).then(() => {
      settled = true
    })
    for (let i = 0; i < 25; i++) await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(SEGMENT_CONCURRENCY)

    // One millisecond short of the floor: still on the wire, and the stop leg
    // behind it is still waiting.
    await jest.advanceTimersByTimeAsync(SEGMENT_PUT_FLOOR_MS - 1)
    expect(settled).toBe(false)

    // …and the floor itself releases it — the abort, the pool and the pump's
    // own tail all settle on microtasks from there.
    await jest.advanceTimersByTimeAsync(1)
    for (let i = 0; i < 25; i++) await Promise.resolve()
    expect(settled).toBe(true)
    await done

    // The two floors, named rather than assumed: on these very bytes the TAKE's
    // rule would still have four more times this long to run, which is exactly
    // the minute the stop leg used to spend.
    expect(putDeadlineMs(segBlob(0).size)).toBe(60_000)
    expect(SEGMENT_PUT_FLOOR_MS).toBe(15_000)

    // Retryable, never terminal: a stall is a moment in time, and the whole
    // take still goes up under its own key regardless.
    expect(markSegmentsUploaded).not.toHaveBeenCalled()
    expect(markSegmentError).not.toHaveBeenCalled()
  })
})
