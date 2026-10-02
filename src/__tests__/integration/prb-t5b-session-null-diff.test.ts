/**
 * @jest-environment jsdom
 *
 * PR-B commit 8 — T-5b (R-S74-11, the M-B16 killer): the recorder's
 * start-to-stop session-null difference reaches the finalize input.
 * newPersist snapshots sessionNullReadCount() at start; the stop leg passes
 * the difference as secureTake's LAST argument. Here currentUserId answers
 * null N = 3 times between start and stop (the counter really moves — this
 * suite does not stub sessionNullReadCount), so a stop leg that passed 0
 * fails. Harness: prb-capture-end-hooks.test.ts's fake mic + MediaRecorder.
 */
class FakeMediaRecorder {
  static starts = 0
  static last: FakeMediaRecorder | null = null
  static isTypeSupported() {
    return true
  }
  constructor() {
    FakeMediaRecorder.last = this
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'audio/webm'
  start() {
    FakeMediaRecorder.starts++
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
type FakeTrack = { onended: (() => void) | null; onmute: (() => void) | null; onunmute: (() => void) | null; stop: () => void }
let track: FakeTrack
;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
})

jest.mock('@/actions/recordings', () => ({
  startRecordingSession: async () => ({ id: 'rs-1' }),
  recordCaptureWarning: async () => ({ ok: true }),
}))
const mockMarkEnded = jest.fn<Promise<void>, [string, unknown]>(async () => {})
jest.mock('@/lib/karute/take-store', () => ({
  createTake: async () => true,
  appendTakeSegment: async () => true,
  deleteTake: async () => {},
  isTakeHeldByAnother: async () => false,
  markSegmentError: async () => {},
  TERMINAL_SECURE_ERRORS: new Set(['forbidden']),
  markSegmentsUploaded: async () => {},
  markTakeStartBoundAttempted: async () => {},
  markTakeStopPending: async () => {},
  markTakeTailIncomplete: async () => {},
  markTakeEndedBySystem: (takeId: string, mark: unknown) => mockMarkEnded(takeId, mark),
  readTakeSecureMeta: async () => null,
  readTakeUploadMeta: async () => ({ recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: -1, lastSeq: -1 }),
  stampTakeDuration: async () => {},
  stampTakeSession: async () => true,
  writeTakeHeartbeat: async () => {},
  clearTakeHeartbeat: async () => {},
}))
jest.mock('@/lib/recording/segment-uploader', () => ({ pumpSegments: async () => {} }))
const mockSecureTake = jest.fn<Promise<void>, unknown[]>(async () => {})
jest.mock('@/lib/recording/secure-take', () => ({ secureTake: (...a: unknown[]) => mockSecureTake(...a) }))
jest.mock('@/lib/ports/recording-port', () => ({ getRecordingPipelinePort: () => ({}) }))
let mockSession: { user: { id: string } } | null = { user: { id: 'staff-A' } }
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: mockSession } }) } }),
}))

import { globalRecorder } from '@/lib/global-recorder'
import { currentUserId, sessionNullReadCount } from '@/lib/karute/draft'

const drain = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
const TARGET = { customerId: 'cust-1', customerName: 'C', karuteNumber: null, appointmentId: null }

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
  jest.clearAllMocks()
  mockSession = { user: { id: 'staff-A' } }
  track = { onended: null, onmute: null, onunmute: null, stop: () => {} }
  globalRecorder.discard()
  await drain()
})
afterEach(() => {
  globalRecorder.discard()
  jest.useRealTimers()
})

describe('T-5b — the recorder carries the session-null difference to the finalize input', () => {
  it('the recorder\'s start-to-stop difference reaches the finalize input (3 null answers → last argument 3)', async () => {
    await globalRecorder.start({ target: TARGET })
    await drain()
    const takeId = globalRecorder.takeId!
    const before = sessionNullReadCount()
    mockSession = null
    for (let i = 0; i < 3; i++) await currentUserId()
    mockSession = { user: { id: 'staff-A' } }
    expect(sessionNullReadCount() - before).toBe(3) // the counter really moved
    globalRecorder.stop()
    for (let i = 0; i < 40 && mockSecureTake.mock.calls.length === 0; i++) {
      await jest.advanceTimersByTimeAsync(1_000)
      await drain()
    }
    expect(mockSecureTake).toHaveBeenCalledTimes(1)
    const args = mockSecureTake.mock.calls[0]
    expect(args[1]).toBe(takeId)
    // S87 F3 appended the recorder's emitted count after it: the session-null
    // count stays secureTake's 5th argument (sessionNullCount).
    expect(args[4]).toBe(3)
  })
})
