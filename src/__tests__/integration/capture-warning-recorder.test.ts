/**
 * @jest-environment jsdom
 *
 * The recorder's yellow notice (recording hole PR-6) — the recorder and hook
 * half. The detector itself is capture-warning-detect.test.ts; what this file
 * owns is WHERE the recorder reads the meta from (memory while storage is off,
 * the row otherwise), WHEN it evaluates (the flush tick, live takes only),
 * that the field clears on recovery / stop / discard, that subscribers hear
 * only a change, and that the switch OFF means nothing at all.
 *
 * Harness: the fake mic + MediaRecorder of global-recorder-session-race.test.ts,
 * a take-store mocked down to the calls the recorder makes, and the segment
 * pump / secure leg as no-ops (their own files prove them).
 */
import { renderHook, act } from '@testing-library/react'

class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null
  static isTypeSupported() {
    return true
  }
  constructor() {
    FakeMediaRecorder.last = this
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

const mockStartRecordingSession = jest.fn<Promise<{ id: string } | null>, [unknown?]>(async () => ({
  id: 'rs-1',
}))
const mockRecordCaptureWarning = jest.fn<Promise<unknown>, [unknown]>(async () => ({ ok: true }))
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: (input: unknown) => mockStartRecordingSession(input),
  recordCaptureWarning: (input: unknown) => mockRecordCaptureWarning(input),
}))

/** The row's upload meta — what the STORE path answers. */
type UploadMeta = { recordingSessionId: string | null; mimeType: string; uploadedSeq?: number; lastSeq: number; segmentError?: string }
let mockRowMeta: UploadMeta | null = null
let mockCreateOk = true
let mockAppendOk = true
const mockReadTakeUploadMeta = jest.fn<Promise<UploadMeta | null>, [string]>(async () => mockRowMeta)
const mockIsTakeHeldByAnother = jest.fn<Promise<boolean>, [string]>(async () => false)
jest.mock('@/lib/karute/take-store', () => ({
  createTake: async () => mockCreateOk,
  appendTakeSegment: async () => mockAppendOk,
  deleteTake: async () => {},
  isTakeHeldByAnother: (takeId: string) => mockIsTakeHeldByAnother(takeId),
  markSegmentError: async () => {},
  markSegmentsUploaded: async () => {},
  markTakeStartBoundAttempted: async () => {},
  markTakeStopPending: async () => {},
  markTakeTailIncomplete: async () => {},
  readTakeSecureMeta: async () => null,
  readTakeUploadMeta: (takeId: string) => mockReadTakeUploadMeta(takeId),
  stampTakeDuration: async () => {},
  stampTakeSession: async () => true,
  writeTakeHeartbeat: async () => {},
  clearTakeHeartbeat: async () => {},
}))
jest.mock('@/lib/recording/segment-uploader', () => ({ pumpSegments: async () => {} }))
jest.mock('@/lib/recording/secure-take', () => ({ secureTake: async () => {} }))
jest.mock('@/lib/ports/recording-port', () => ({ getRecordingPipelinePort: () => ({}) }))

import { globalRecorder } from '@/lib/global-recorder'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

const drain = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
/** One flush tick (TAKE_FLUSH_MS), and everything it queued. */
const tick = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    await jest.advanceTimersByTimeAsync(5_000)
    await drain()
  }
}
const persistOf = () =>
  (globalRecorder as unknown as { persist: { disabled: boolean; revive: { since: number } } }).persist

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const facts = () => mockRecordCaptureWarning.mock.calls.map(([input]) => input as Record<string, unknown>)

const TARGET = { customerId: 'cust-1', customerName: 'C', karuteNumber: null, appointmentId: null }

async function startLive() {
  await globalRecorder.start({ target: TARGET })
  await drain()
  return globalRecorder.takeId!
}

let switchOff: jest.ReplaceProperty<boolean> | null = null

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
  jest.clearAllMocks()
  mockStartRecordingSession.mockImplementation(async () => ({ id: 'rs-1' }))
  mockRecordCaptureWarning.mockImplementation(async () => ({ ok: true }))
  mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: -1, lastSeq: -1 }
  mockCreateOk = true
  mockAppendOk = true
  globalRecorder.discard()
  await drain()
})

afterEach(() => {
  switchOff?.restore()
  switchOff = null
  globalRecorder.discard()
  jest.useRealTimers()
})

describe('PR-6 — where the recorder reads the meta', () => {
  it('storage off: the meta comes from memory (the row is never read), and the phone is called unable to save 15 s after the revive first tried', async () => {
    mockCreateOk = false // the row can never be made: storage off from the start
    await startLive()
    expect(persistOf().disabled).toBe(true)

    await tick() // 5 s — the revive's first try
    const since = persistOf().revive.since
    expect(since).toBeGreaterThan(0)
    expect(globalRecorder.captureWarning).toBeNull()

    await tick(2) // 15 s — ten seconds after the first try
    expect(globalRecorder.captureWarning).toBeNull()
    await tick() // 20 s — fifteen after it
    expect(Date.now() - since).toBeGreaterThanOrEqual(15_000)
    expect(globalRecorder.captureWarning).toBe('device')

    // The memory door was asked, the store's never.
    expect(mockIsTakeHeldByAnother).toHaveBeenCalled()
    expect(mockReadTakeUploadMeta).not.toHaveBeenCalled()
  })

  it('storage off: the device notice does not flap while the revive keeps retrying', async () => {
    mockCreateOk = false
    await startLive()
    await tick(4)
    expect(globalRecorder.captureWarning).toBe('device')
    // Revive tries land at 35 s, 75 s, 115 s… — none of them clears the notice.
    for (let i = 0; i < 24; i++) {
      await tick()
      expect(globalRecorder.captureWarning).toBe('device')
    }
  })

  it('storage on: the row is read, and 60 s recorded with nothing on the server → server', async () => {
    await startLive()
    expect(persistOf().disabled).toBe(false)
    await tick(11) // 55 s
    expect(globalRecorder.captureWarning).toBeNull()
    expect(mockReadTakeUploadMeta).toHaveBeenCalled()
    await tick() // 60 s
    expect(globalRecorder.captureWarning).toBe('server')
  })

  it('clears on recovery: the server catches up → null on the next tick', async () => {
    await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    mockRowMeta = { ...mockRowMeta!, uploadedSeq: 11, lastSeq: 11 }
    await tick()
    expect(globalRecorder.captureWarning).toBeNull()
  })

  it('an unreadable meta is no verdict: the notice stays as it was', async () => {
    await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    mockRowMeta = null
    await tick()
    expect(globalRecorder.captureWarning).toBe('server')
  })
})

describe('PR-6 — the field speaks for a live take only', () => {
  it('null when idle, and back to null at stop and at discard', async () => {
    expect(globalRecorder.state).toBe('idle')
    expect(globalRecorder.captureWarning).toBeNull()

    await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    globalRecorder.stop()
    await drain()
    expect(globalRecorder.state).toBe('recorded')
    expect(globalRecorder.captureWarning).toBeNull()
    // No tick after the stop brings it back.
    await tick(3)
    expect(globalRecorder.captureWarning).toBeNull()

    globalRecorder.discard()
    await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    globalRecorder.discard()
    expect(globalRecorder.state).toBe('idle')
    expect(globalRecorder.captureWarning).toBeNull()
  })

  it('paused still counts as live', async () => {
    await startLive()
    await tick(12)
    globalRecorder.pause()
    expect(globalRecorder.state).toBe('paused')
    await tick()
    expect(globalRecorder.captureWarning).toBe('server')
  })
})

describe('PR-6 — the hook', () => {
  it('exposes captureWarning, and subscribers hear only a change', async () => {
    const { result } = renderHook(() => useGlobalRecorder())
    expect(result.current.captureWarning).toBeNull()
    await act(async () => {
      await startLive()
      await tick(12)
    })
    expect(result.current.captureWarning).toBe('server')

    const v = globalRecorder.version
    await act(async () => {
      await tick(3) // still server
    })
    expect(globalRecorder.version).toBe(v)
  })
})

describe('PR-6 — the switch', () => {
  it('OFF: never computed — no meta read for it, the field stays null through every trigger', async () => {
    switchOff = jest.replaceProperty(
      RECORDING_SWITCHES as { captureWarningNotice: boolean },
      'captureWarningNotice',
      false,
    )
    await startLive()
    await tick(20)
    expect(globalRecorder.captureWarning).toBeNull()
    expect(mockReadTakeUploadMeta).not.toHaveBeenCalled()

    globalRecorder.discard()
    mockCreateOk = false
    await startLive()
    await tick(20)
    expect(globalRecorder.captureWarning).toBeNull()
    expect(mockIsTakeHeldByAnother).not.toHaveBeenCalled()
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()
  })
})

describe('PR-6 — the fact, once per raise', () => {
  it('a raise files ONE fact with the take, the session, the reason and an ISO stamp — and a notice that stays up files nothing more', async () => {
    const takeId = await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    await drain()
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-1', takeId, reason: 'server', warnedAt: expect.any(String) },
    ])
    expect(new Date(facts()[0].warnedAt as string).toISOString()).toBe(facts()[0].warnedAt)
    await tick(6)
    expect(facts()).toHaveLength(1)
  })

  it('no session at the raise: the fact waits, then goes exactly once when the id lands', async () => {
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    const takeId = await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    expect(globalRecorder.recordingSessionId).toBeNull()
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()

    slow.resolve({ id: 'rs-late' })
    await drain()
    expect(globalRecorder.recordingSessionId).toBe('rs-late')
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-late', takeId, reason: 'server', warnedAt: expect.any(String) },
    ])
    await tick(4)
    expect(facts()).toHaveLength(1)
  })

  it('…and when the id comes from the session RETRY (the first mint failed), the waiting fact rides it', async () => {
    // Every mint fails until the recorder's own 90 s retry (the start-mint is
    // two calls — the born-reserved create and its step back — then 30 s, 90 s).
    let landed = false
    mockStartRecordingSession.mockImplementation(async () => (landed ? { id: 'rs-retry' } : null))
    const takeId = await startLive()
    await tick(12) // 60 s: raised, no session
    expect(globalRecorder.captureWarning).toBe('server')
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()
    landed = true
    await tick(6) // 90 s: the second retry
    expect(globalRecorder.recordingSessionId).toBe('rs-retry')
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-retry', takeId, reason: 'server', warnedAt: expect.any(String) },
    ])
  })

  it('a take discarded before any session takes its waiting fact with it — the next take never carries it', async () => {
    const slowA = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slowA.promise)
    await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    globalRecorder.discard()
    mockStartRecordingSession.mockImplementation(async () => ({ id: 'rs-B' }))
    await startLive()
    slowA.resolve({ id: 'rs-A' })
    await drain()
    expect(globalRecorder.recordingSessionId).toBe('rs-B')
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()
  })

  it('a notice that clears and re-raises with the SAME reason files nothing new; device after server files once more', async () => {
    const takeId = await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    mockRowMeta = { ...mockRowMeta!, uploadedSeq: 11, lastSeq: 11 }
    await tick()
    expect(globalRecorder.captureWarning).toBeNull()
    mockRowMeta = { ...mockRowMeta!, uploadedSeq: -1, lastSeq: 30 }
    await tick()
    expect(globalRecorder.captureWarning).toBe('server')
    await drain()
    expect(facts().map((f) => f.reason)).toEqual(['server'])

    // Storage goes: a segment write refuses, the revive cannot win it back.
    mockAppendOk = false
    mockCreateOk = false
    FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['x']) })
    await tick()
    expect(persistOf().disabled).toBe(true)
    await tick(4)
    expect(globalRecorder.captureWarning).toBe('device')
    await drain()
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-1', takeId, reason: 'server', warnedAt: expect.any(String) },
      { recordingSessionId: 'rs-1', takeId, reason: 'device', warnedAt: expect.any(String) },
    ])
    await tick(6)
    expect(facts()).toHaveLength(2)
  })

  it('a fact that fails is logged, never retried, and never touches the recording', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockRecordCaptureWarning.mockImplementation(async () => {
      throw new Error('offline')
    })
    await startLive()
    await tick(12)
    await drain()
    expect(mockRecordCaptureWarning).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[global-recorder] capture warning not filed:', expect.any(Error))
    await tick(6)
    expect(mockRecordCaptureWarning).toHaveBeenCalledTimes(1)
    expect(globalRecorder.state).toBe('recording')
    expect(globalRecorder.captureWarning).toBe('server')

    // A settled refusal is logged the same way.
    warn.mockClear()
    globalRecorder.discard()
    mockRecordCaptureWarning.mockImplementation(async () => ({ error: 'failed' }))
    await startLive()
    await tick(12)
    await drain()
    expect(warn).toHaveBeenCalledWith('[global-recorder] capture warning not filed:', 'failed')
    warn.mockRestore()
  })
})
