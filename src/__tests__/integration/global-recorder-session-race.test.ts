/**
 * @jest-environment jsdom
 *
 * GlobalRecorder recording-session mint — staleness guard.
 *
 * The mint fires in parallel with getUserMedia at start(). A SLOW mint from
 * recording A that resolves after discard() (or after a new start()) must be
 * dropped — its recording_sessions row was minted for A's customer, and
 * stamping it onto recording B would link B's karute record to A's session.
 *
 * ⚖ THE MIC IS GRANTED HERE (fix round 13). This file used to lean on jsdom
 * having no getUserMedia at all: start() landed in its mic-error path, which
 * was a free way to hold the pre-mic window open. That path now ABANDONS the
 * mint — a denied prompt means there is no recording, so the row it minted is
 * an orphan nothing may file against — so leaning on it would test the abandon
 * rather than the staleness guard. So the mic and the recorder are faked here
 * (the same minimal pair take-durability.test.ts uses), and the two tests that
 * genuinely need the pre-mic window hold it open with slowMic() instead.
 */

class FakeMediaRecorder {
  static isTypeSupported() {
    return true
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'audio/webm'
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
}
;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: async () => ({ getTracks: () => [] }) },
})

/** Hold the mic on a REAL timer, so a mint resolving in microtasks definitively
 *  answers INSIDE the window between the mint going out and start() naming its
 *  take. `settle()` below only drains microtasks, so this timer cannot fire
 *  until the test awaits start() itself — which is what makes the window
 *  deterministic rather than a race. */
function slowMic(): () => void {
  const real = navigator.mediaDevices.getUserMedia
  ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = () =>
    new Promise((resolve) => setTimeout(() => resolve({ getTracks: () => [] }), 5))
  return () => {
    ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = real
  }
}

const mockStartRecordingSession = jest.fn(
  async (_input: { customerId?: string | null; appointmentId?: string | null }): Promise<{ id: string } | null> =>
    null,
)
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: (input: { customerId?: string | null; appointmentId?: string | null }) =>
    mockStartRecordingSession(input),
}))

/** The persisted take's session stamp — the only part of take-store a mint
 *  resolution touches, modelled with the store's own FIRST-WRITE-WINS rule
 *  (the real one refuses a take that already carries a row). jsdom has no
 *  IndexedDB, so without this every call answers "layer disabled" and the
 *  adoption arm below is unreachable. */
const mockTakeSessions = new Map<string, string>()
const mockStampTakeSession = jest.fn(async (takeId: string, sessionId: string) => {
  if (mockTakeSessions.has(takeId)) return false
  mockTakeSessions.set(takeId, sessionId)
  return true
})
jest.mock('@/lib/karute/take-store', () => ({
  createTake: async () => true,
  appendTakeSegment: async () => true,
  deleteTake: async () => {},
  markTakeStartBoundAttempted: async () => {},
  stampTakeDuration: async () => {},
  // The cross-tab heartbeat (fix round 14). This suite has no store layer at
  // all, so both calls are the no-ops the real ones become when localStorage
  // refuses — the recorder must not notice either way.
  writeTakeHeartbeat: async () => {},
  clearTakeHeartbeat: async () => {},
  readTakeSecureMeta: async (takeId: string) =>
    mockTakeSessions.has(takeId)
      ? { takeId, recordingSessionId: mockTakeSessions.get(takeId) }
      : null,
  stampTakeSession: (takeId: string, sessionId: string) =>
    mockStampTakeSession(takeId, sessionId),
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
  mockTakeSessions.clear()
  globalRecorder.discard()
})

// The mic is real here now, so every start() arms the flush interval — the
// discard above clears it between tests, and this one clears the last.
afterAll(() => {
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

    // Named, so the assertions read against a fixed id rather than the uuid
    // start() just minted. The recorder arm then retries the way RecordPageView
    // does: no opts, its own live take.
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

// ⚖ THE PREVIOUS TAKE IS NOT THIS MINT'S TAKE (fix round 12, P1).
//
// start() fires its mint BEFORE getUserMedia, so for that whole window the
// take sitting on the singleton belongs to the PREVIOUS recording — stopped,
// already secured, already carrying its row. The mint's resolution reads
// `this.takeId` as "my take" and, when the store refused the stamp, ADOPTED
// what was there (fix round 10's late-reply arm). So a fast reply for take B
// made A's row the recorder's: B was created on A's row, B's own upload mint
// reserved against it, and the door answered `reserved_elsewhere` — terminal.
// B's audio never left the phone and B's karute pointed at A's session.
//
// The mic is held on a timer here (slowMic), so the mint definitively answers
// inside that window — a microtask race would prove nothing.
describe('GlobalRecorder — a start-mint that answers before its own take exists', () => {
  /** Run start() with the mint answering INSIDE the pre-mic window, then let
   *  the mic land so the recording actually begins. */
  async function startInsideTheWindow() {
    const restore = slowMic()
    try {
      const started = globalRecorder.start({ target: TARGET_B })
      await settle() // the mint lands; the mic is still pending
      await started // …and now B exists
      await settle()
    } finally {
      restore()
    }
  }

  it("stamps nothing on the previous take, and keeps B's own row", async () => {
    // A: stopped and still held (not yet used or discarded), carrying the row
    // secureTake minted and finalized its audio against at stop.
    mockTakeSessions.set('take-A', 'session-A')
    globalRecorder.takeId = 'take-A'
    globalRecorder.state = 'recorded'

    // B starts; its mint answers inside the pre-mic window.
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-B' })
    await startInsideTheWindow()

    // The recorder holds B's OWN row — createTake carries it onto B's take.
    expect(globalRecorder.recordingSessionId).toBe('session-B')
    expect(globalRecorder.takeId).not.toBe('take-A')
    // A was not written to and not read FROM: its row is still its own, and
    // the recorder never adopted it. (B's own take IS stamped once the mic
    // lands — that is the ordinary path, and the control below pins it.)
    expect(mockStampTakeSession).not.toHaveBeenCalledWith('take-A', expect.anything())
    expect(mockTakeSessions.get('take-A')).toBe('session-A')
  })

  // The other half of the same window — the take is live, not stopped. Same
  // rule, and the reason is bigger: stamping a mint minted for the NEXT
  // customer onto a recording still being captured would put its audio on the
  // wrong customer's row.
  it('the same holds while the previous take is still RECORDING', async () => {
    globalRecorder.takeId = 'take-A'
    globalRecorder.state = 'recording'

    mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-B' })
    await startInsideTheWindow()

    expect(mockStampTakeSession).not.toHaveBeenCalledWith('take-A', expect.anything())
    expect(globalRecorder.recordingSessionId).toBe('session-B')
  })
})

// ⚖ A DENIED MIC LEAVES NOTHING TO FILE AGAINST (fix round 13, P3).
//
// The mint goes out BEFORE the permission prompt — deliberately, so a network
// call can never delay the mic. When the prompt is refused there is no
// recording, so that row is an orphan: a real recording_sessions row with no
// audio, no duration and no take. Left on the singleton it is what the very
// next save reads (awaitRecordingSessionId) and what the discard gate keys its
// reason row to — a karute linked to an empty session, silently.
describe('GlobalRecorder — the mic is denied', () => {
  it('abandons the row its own start-mint made — nothing can file against it', async () => {
    const denied = () => Promise.reject(new Error('NotAllowedError'))
    const real = navigator.mediaDevices.getUserMedia
    ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = denied
    try {
      mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-orphan' })
      await globalRecorder.start({ target: TARGET_A })
      await settle()
    } finally {
      ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = real
    }

    expect(globalRecorder.error).toBe('Microphone access denied.')
    expect(globalRecorder.recordingSessionId).toBeNull()
    // …and the SETTLED promise cannot hand the orphan back either — the field
    // being null is not enough, because that is exactly when the save falls
    // through to the promise.
    expect(await globalRecorder.awaitRecordingSessionId()).toBeNull()
  })

  it('a LATE mint answering after the refusal is dropped too', async () => {
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    const denied = () => Promise.reject(new Error('NotAllowedError'))
    const real = navigator.mediaDevices.getUserMedia
    ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = denied
    try {
      await globalRecorder.start({ target: TARGET_A })
      slow.resolve({ id: 'session-orphan' })
      await slow.promise
      await settle()
    } finally {
      ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = real
    }

    expect(globalRecorder.recordingSessionId).toBeNull()
    expect(mockStampTakeSession).not.toHaveBeenCalled()
  })
})
