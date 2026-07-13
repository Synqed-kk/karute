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
    await Promise.resolve()

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
    await Promise.resolve()

    expect(globalRecorder.recordingSessionId).toBe('session-B')
    expect(await globalRecorder.awaitRecordingSessionId()).toBe('session-B')
  })

  it('a current-generation mint still lands (control)', async () => {
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'session-live' })
    await globalRecorder.start({ target: TARGET_A })
    expect(await globalRecorder.awaitRecordingSessionId()).toBe('session-live')
    expect(globalRecorder.recordingSessionId).toBe('session-live')
  })
})
