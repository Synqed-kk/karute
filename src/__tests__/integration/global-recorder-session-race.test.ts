/**
 * @jest-environment jsdom
 *
 * GlobalRecorder recording-session mint — staleness guard.
 *
 * The mint fires in parallel with getUserMedia at start(). A SLOW mint from
 * recording A that resolves after discard() (or after a new start()) must be
 * dropped — its recording_sessions row was minted for A's customer, and
 * stamping it onto recording B would link B's karute record to A's session.
 * getUserMedia is absent in jsdom, so start() lands in its mic-error path —
 * irrelevant here: the mint is fired before the mic is touched.
 */

const mockStartRecordingSession = jest.fn(
  async (_input: { customerId?: string | null; appointmentId?: string | null }): Promise<{ id: string } | null> =>
    null,
)
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: (input: { customerId?: string | null; appointmentId?: string | null }) =>
    mockStartRecordingSession(input),
}))

import { globalRecorder } from '@/lib/global-recorder'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** A resolved mint no longer finishes in one microtask (fix round 10): it
 *  STAMPS the take before it settles, and adopts whatever is already there when
 *  the store refuses the write — a store round trip either way, even here where
 *  there is no IndexedDB at all and every call answers "layer disabled". */
const settle = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}

const TARGET_A = { customerId: 'cust-A', customerName: 'A', karuteNumber: null, appointmentId: null }
const TARGET_B = { customerId: 'cust-B', customerName: 'B', karuteNumber: null, appointmentId: null }

beforeEach(() => {
  jest.clearAllMocks()
  globalRecorder.discard()
})

describe('GlobalRecorder — recording-session mint staleness guard', () => {
  it('drops a mint that resolves after discard()', async () => {
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    await globalRecorder.start({ target: TARGET_A })

    globalRecorder.discard()
    slow.resolve({ id: 'session-A' })
    await slow.promise
    await settle()

    expect(globalRecorder.recordingSessionId).toBeNull()
  })

  it("drops recording A's late mint after a new start(); B's own mint wins", async () => {
    const slowA = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slowA.promise)
    await globalRecorder.start({ target: TARGET_A })

    globalRecorder.discard()
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-B' })
    await globalRecorder.start({ target: TARGET_B })
    await Promise.resolve()

    // A's mint resolves late — must NOT overwrite B's id.
    slowA.resolve({ id: 'session-A' })
    await slowA.promise
    await settle()

    expect(globalRecorder.recordingSessionId).toBe('session-B')
    expect(await globalRecorder.awaitRecordingSessionId()).toBe('session-B')
  })

  // The retry exists because a FAILED mint leaves recordingSessionId null
  // forever. An IN-FLIGHT one reads exactly the same, so without the in-flight
  // guard every further confirm tap issued another upstream create — each one
  // bumping the generation and orphaning the row the previous one had just
  // made. Two taps must cost ONE create.
  it('two rapid confirms while the first mint is still in flight issue ONE upstream create', async () => {
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    await globalRecorder.start({ target: TARGET_A })
    expect(mockStartRecordingSession).toHaveBeenCalledTimes(1)

    // start() lands in jsdom's mic-error path before it creates the take, so
    // the take a real device would be holding is set here. The recorder arm
    // then retries the way RecordPageView does: no opts, its own live take.
    globalRecorder.takeId = 'take-A'
    const first = await globalRecorder.retryRecordingSessionMint({ timeoutMs: 1 })
    const second = await globalRecorder.retryRecordingSessionMint({ timeoutMs: 1 })

    expect(mockStartRecordingSession).toHaveBeenCalledTimes(1)
    expect(first).toBeNull()
    expect(second).toBeNull()

    // The one mint everybody was waiting on still lands, on the live generation.
    slow.resolve({ id: 'session-A' })
    await slow.promise
    await settle()
    expect(globalRecorder.recordingSessionId).toBe('session-A')
  })

  it('a mint in flight for a DIFFERENT take is never reused', async () => {
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    await globalRecorder.start({ target: TARGET_A })
    globalRecorder.takeId = 'take-A'

    // A review-path retry names its own take. Handing it recording A's session
    // would key the discard row to the wrong recording.
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-review' })
    expect(await globalRecorder.retryRecordingSessionMint({ takeId: 'take-review' })).toBe(
      'session-review',
    )
    expect(mockStartRecordingSession).toHaveBeenCalledTimes(2)
  })

  // The fallback above reads "no named take" as "the recorder's own live take",
  // which holds only because start() fires its mint BEFORE creating that take.
  // If a previous recording's take is still sitting there, the in-flight mint
  // belongs to the NEW recording — reusing it would key the old take's discard
  // row to a session minted for a different one.
  it('refuses to reuse a mint issued while another take was still live', async () => {
    globalRecorder.takeId = 'take-old'
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    await globalRecorder.start({ target: TARGET_B })

    mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-old' })
    expect(await globalRecorder.retryRecordingSessionMint({ takeId: 'take-old', timeoutMs: 1 })).toBe(
      'session-old',
    )
    expect(mockStartRecordingSession).toHaveBeenCalledTimes(2)
  })

  it('a current-generation mint still lands (control)', async () => {
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-live' })
    await globalRecorder.start({ target: TARGET_A })
    expect(await globalRecorder.awaitRecordingSessionId()).toBe('session-live')
    expect(globalRecorder.recordingSessionId).toBe('session-live')
  })
})
