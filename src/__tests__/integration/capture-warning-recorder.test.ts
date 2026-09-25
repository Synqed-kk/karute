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
const mockAppendTakeSegment = jest.fn<Promise<boolean>, unknown[]>(async () => mockAppendOk)
jest.mock('@/lib/karute/take-store', () => ({
  createTake: async () => mockCreateOk,
  appendTakeSegment: (...args: unknown[]) => mockAppendTakeSegment(...args),
  deleteTake: async () => {},
  isTakeHeldByAnother: (takeId: string) => mockIsTakeHeldByAnother(takeId),
  markSegmentError: async () => {},
  // The one code thread 3's pin uses — a member of the real set (take-store.ts).
  TERMINAL_SECURE_ERRORS: new Set(['forbidden']),
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
/** A no-op by default; thread 3's pin below runs the REAL pump for memory. */
const mockPumpSegments = jest.fn<Promise<void>, unknown[]>(async () => {})
jest.mock('@/lib/recording/segment-uploader', () => ({
  pumpSegments: (...args: unknown[]) => mockPumpSegments(...args),
}))
jest.mock('@/lib/recording/secure-take', () => ({ secureTake: async () => {} }))
jest.mock('@/lib/ports/recording-port', () => ({ getRecordingPipelinePort: () => ({}) }))

import { globalRecorder } from '@/lib/global-recorder'
import type { SegmentSource } from '@/lib/recording/segment-uploader'
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
  (globalRecorder as unknown as { persist: { disabled: boolean; seq: number; revive: { since: number } } }).persist

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

  it('a stopped take still waiting for its session never files against the NEXT take\'s id (start()\'s mint lands before it names its take)', async () => {
    const slowA = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slowA.promise)
    await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    globalRecorder.stop()
    await drain()
    expect(globalRecorder.state).toBe('recorded')

    // The next start(): its mint answers while the mic prompt is still up —
    // the singleton's field holds B's id, and A's take is still the one held.
    let grant!: () => void
    const realGum = navigator.mediaDevices.getUserMedia
    ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = () =>
      new Promise((resolve) => {
        grant = () => resolve({ getTracks: () => [] })
      })
    try {
      mockStartRecordingSession.mockImplementation(async () => ({ id: 'rs-B' }))
      const starting = globalRecorder.start({ target: TARGET })
      await drain()
      expect(globalRecorder.recordingSessionId).toBe('rs-B')
      expect(mockRecordCaptureWarning).not.toHaveBeenCalled()

      grant()
      await starting
      await drain()
    } finally {
      grant()
      ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = realGum
    }
    slowA.resolve({ id: 'rs-A' })
    await drain()
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

describe('PR-6 — the four pins the fresh-eyes mutants found missing (FRESH-S39-PR6 N2 · N3 · N6 · N7)', () => {
  /** A row meta that WOULD raise 'server' for any live take: 31 segments
   *  written, not one on the server. */
  const BEHIND: UploadMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: -1, lastSeq: 30 }

  it('N2: a meta read that settles after the take STOPPED is no verdict — the stopped take gets no notice and files no fact', async () => {
    await startLive()
    await tick(11) // 55 s
    expect(globalRecorder.captureWarning).toBeNull()
    const slow = deferred<UploadMeta | null>()
    mockReadTakeUploadMeta.mockImplementationOnce(() => slow.promise)
    await tick() // 60 s: the tick's read is out and has not answered
    expect(globalRecorder.captureWarning).toBeNull()

    globalRecorder.stop()
    await drain()
    expect(globalRecorder.state).toBe('recorded')
    slow.resolve(BEHIND)
    await drain()
    expect(globalRecorder.captureWarning).toBeNull()
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()
  })

  it('N2: …and one that settles after the NEXT take started never lands on it — no notice, no fact against the new take', async () => {
    await startLive()
    await tick(11)
    const slow = deferred<UploadMeta | null>()
    mockReadTakeUploadMeta.mockImplementationOnce(() => slow.promise)
    await tick() // 60 s: take A's read is out
    globalRecorder.stop()
    await drain()
    const takeB = await startLive()
    expect(globalRecorder.state).toBe('recording')
    expect(globalRecorder.takeId).toBe(takeB)

    slow.resolve(BEHIND) // A's late verdict
    await drain()
    expect(globalRecorder.captureWarning).toBeNull()
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()
    // B's own tick still reads B's own row, and B is healthy.
    await tick()
    expect(globalRecorder.captureWarning).toBeNull()
  })

  it('N3: the same reason raised twice before the first fact has answered files ONE fact — the mark goes on before the send, not after it', async () => {
    const pending = deferred<unknown>()
    mockRecordCaptureWarning.mockImplementationOnce(() => pending.promise)
    const takeId = await startLive()
    await tick(12) // 60 s: raised, the fact is out and has not answered
    expect(globalRecorder.captureWarning).toBe('server')
    expect(mockRecordCaptureWarning).toHaveBeenCalledTimes(1)

    // The notice flaps inside the send's window: clears, then the same reason again.
    mockRowMeta = { ...mockRowMeta!, uploadedSeq: 11, lastSeq: 11 }
    await tick()
    expect(globalRecorder.captureWarning).toBeNull()
    mockRowMeta = { ...mockRowMeta!, uploadedSeq: -1, lastSeq: 30 }
    await tick()
    expect(globalRecorder.captureWarning).toBe('server')
    expect(mockRecordCaptureWarning).toHaveBeenCalledTimes(1)

    pending.resolve({ ok: true })
    await drain()
    await tick(3)
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-1', takeId, reason: 'server', warnedAt: expect.any(String) },
    ])
  })

  it('N3: …and while the fact waits for its session, a flap of the same reason still leaves ONE fact when the id lands', async () => {
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    const takeId = await startLive()
    await tick(12)
    expect(globalRecorder.captureWarning).toBe('server')
    mockRowMeta = { ...mockRowMeta!, uploadedSeq: 11, lastSeq: 11 }
    await tick()
    expect(globalRecorder.captureWarning).toBeNull()
    mockRowMeta = { ...mockRowMeta!, uploadedSeq: -1, lastSeq: 30 }
    await tick()
    expect(globalRecorder.captureWarning).toBe('server')
    expect(globalRecorder.recordingSessionId).toBeNull()
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()

    slow.resolve({ id: 'rs-late' })
    await drain()
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-late', takeId, reason: 'server', warnedAt: expect.any(String) },
    ])
  })

  it('N6: a fresh row whose uploadedSeq was never written (undefined, exactly as the store returns it) reads as "nothing on the server" — 60 s recorded → server, not ~90 s later at 18 behind', async () => {
    // take-store.ts: TakeMeta.uploadedSeq is optional until the first
    // markSegmentsUploaded patch, and readTakeUploadMeta passes it through.
    // Twelve segments written by 60 s — twelve behind, under the 18 rule.
    mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: undefined, lastSeq: 11 }
    await startLive()
    await tick(11) // 55 s
    expect(globalRecorder.captureWarning).toBeNull()
    await tick() // 60 s
    expect(globalRecorder.captureWarning).toBe('server')
  })

  it('N7 / fix 2 (gr thread 4): after a COMPLETE recovery — the catch-up lands every segment memory held — a SECOND outage gets its own 15 s from its own first try, never at once', async () => {
    mockCreateOk = false // storage off from the start: no row, no seq written
    await startLive()
    await tick() // 5 s: the first outage's first try
    const firstSince = persistOf().revive.since
    expect(firstSince).toBeGreaterThan(0)

    // Storage comes back: the 10 s try creates the row, and the catch-up
    // behind it writes what memory held — sixty chunks, TWO segments — and
    // both land. That is the recovery completing, and only it clears the clock.
    mockCreateOk = true
    mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: 1, lastSeq: 1 }
    for (let i = 0; i < 60; i++) FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['x']) })
    await tick() // 10 s
    expect(persistOf().disabled).toBe(false)
    expect(persistOf().seq).toBe(2)
    expect(persistOf().revive.since).toBe(0)
    await tick() // 15 s
    expect(persistOf().disabled).toBe(false)
    expect(globalRecorder.captureWarning).toBeNull()
    await tick() // 20 s
    expect(globalRecorder.captureWarning).toBeNull()

    // The second outage: the next write refuses. That tick's meta read is slow
    // — it settles after the refusing flush turned storage off, and before the
    // next tick's first try — 20 s after the FIRST outage's first try.
    mockAppendOk = false
    FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['y']) })
    const slow = deferred<UploadMeta | null>()
    mockReadTakeUploadMeta.mockImplementationOnce(() => slow.promise)
    await tick() // 25 s
    expect(persistOf().disabled).toBe(true)
    slow.resolve(mockRowMeta)
    await drain()
    expect(Date.now() - firstSince).toBeGreaterThanOrEqual(15_000)
    expect(globalRecorder.captureWarning).toBeNull()

    await tick() // 30 s: the second outage's first try
    const secondSince = persistOf().revive.since
    expect(secondSince).toBe(Date.now())
    expect(secondSince).toBeGreaterThan(firstSince)
    expect(globalRecorder.captureWarning).toBeNull()
    await tick(2) // 40 s: ten seconds after it
    expect(globalRecorder.captureWarning).toBeNull()
    await tick() // 45 s: fifteen after it
    expect(Date.now() - secondSince).toBe(15_000)
    expect(globalRecorder.captureWarning).toBe('device')
  })
})

describe('PR-6 fix 2 — Greptile thread 1: every reason a take shows is filed once', () => {
  it('device → server (storage back, the server still stalled) files the server fact once; a later server → device files nothing new', async () => {
    mockCreateOk = false // storage off from the start
    const takeId = await startLive()
    await tick(4) // 20 s: fifteen after the revive's first try
    expect(globalRecorder.captureWarning).toBe('device')
    await drain()
    expect(facts().map((f) => f.reason)).toEqual(['device'])

    // The revive's tries go out at 5, 10, 20, 40, 80 s. Storage stays off
    // through the 40 s one; the 80 s one wins it back — past 60 s recorded,
    // with the server 31 segments behind, so no reading on the way can say
    // null: the notice goes straight from device to server.
    await tick(4) // 40 s
    expect(persistOf().disabled).toBe(true)
    mockCreateOk = true
    mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: -1, lastSeq: 30 }
    FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['x']) })
    const seen: (string | null)[] = []
    for (let i = 0; i < 9; i++) {
      await tick() // …85 s
      seen.push(globalRecorder.captureWarning)
    }
    expect(persistOf().disabled).toBe(false)
    expect(globalRecorder.captureWarning).toBe('server')
    expect(seen).not.toContain(null)
    await drain()
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-1', takeId, reason: 'device', warnedAt: expect.any(String) },
      { recordingSessionId: 'rs-1', takeId, reason: 'server', warnedAt: expect.any(String) },
    ])
    await tick(3)
    expect(facts()).toHaveLength(2)

    // Storage goes again and the revive cannot win it back (a seq is on disk
    // and the row cannot be read): server → device, already filed.
    mockAppendOk = false
    FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['y']) })
    await tick()
    expect(persistOf().disabled).toBe(true)
    await tick(4)
    expect(globalRecorder.captureWarning).toBe('device')
    await tick(3)
    await drain()
    expect(facts().map((f) => f.reason)).toEqual(['device', 'server'])
  })
})

describe('PR-6 fix 2 — Greptile thread 2: one notice read at a time', () => {
  const BEHIND: UploadMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: -1, lastSeq: 30 }
  const CAUGHT_UP: UploadMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: 12, lastSeq: 12 }
  /** A second evaluation while a read is out. Since fix 3 a read is let go at
   *  4 s, before the next 5 s tick, so only a tick that fires inside that
   *  window (a throttled timer catching up) can meet one — this is that tick. */
  const evaluateNow = async () => {
    void (globalRecorder as unknown as { evaluateCaptureWarning(): Promise<void> }).evaluateCaptureWarning()
    await drain()
  }

  it('a read still out when another evaluation comes: that one is skipped, the read that was out applies once, and the tick after reads fresh', async () => {
    await startLive()
    await tick(11) // 55 s
    expect(globalRecorder.captureWarning).toBeNull()
    const slow = deferred<UploadMeta | null>()
    mockReadTakeUploadMeta.mockImplementationOnce(() => slow.promise)
    await tick() // 60 s: the read is out
    const reads = mockReadTakeUploadMeta.mock.calls.length
    await jest.advanceTimersByTimeAsync(2_000) // 62 s: inside its deadline
    await evaluateNow() // skipped — no second read while the first is out
    expect(mockReadTakeUploadMeta).toHaveBeenCalledTimes(reads)
    expect(globalRecorder.captureWarning).toBeNull()

    const v = globalRecorder.version
    slow.resolve(BEHIND)
    await drain()
    expect(globalRecorder.captureWarning).toBe('server')
    expect(globalRecorder.version).toBe(v + 1)
    expect(facts().map((f) => f.reason)).toEqual(['server'])

    mockRowMeta = CAUGHT_UP
    await tick() // 65 s: a fresh read, and its answer stands
    expect(mockReadTakeUploadMeta).toHaveBeenCalledTimes(reads + 1)
    expect(globalRecorder.captureWarning).toBeNull()
    expect(facts()).toHaveLength(1)
  })

  it('a stale server read can never land after a fresh one saw recovery — no notice put back, no fact filed', async () => {
    await startLive()
    await tick(11) // 55 s
    expect(globalRecorder.captureWarning).toBeNull()
    const out: ReturnType<typeof deferred<UploadMeta | null>>[] = []
    mockReadTakeUploadMeta.mockImplementation(() => {
      const d = deferred<UploadMeta | null>()
      out.push(d)
      return d.promise
    })
    try {
      await tick() // 60 s: a read goes out
      await jest.advanceTimersByTimeAsync(2_000) // 62 s: inside its deadline
      await evaluateNow() // the evaluation a second read would have gone out on
      // Whatever reads are out: the NEWEST sees the server caught up, every
      // older one answers with what it saw before the catch-up — all of them
      // inside the first one's deadline.
      out[out.length - 1].resolve(CAUGHT_UP)
      await drain()
      for (const d of out.slice(0, -1)) d.resolve(BEHIND)
      await drain()
      expect(globalRecorder.captureWarning).toBeNull()
      expect(mockRecordCaptureWarning).not.toHaveBeenCalled()
    } finally {
      mockReadTakeUploadMeta.mockImplementation(async () => mockRowMeta)
    }
  })
})

describe('PR-6 fix 2 — Greptile thread 4: a partial recovery keeps the outage clock', () => {
  it('the first catch-up append lands, the second refuses, storage is off again: the device notice fires 15 s after the ORIGINAL first try — the clock never restarts', async () => {
    mockCreateOk = false // storage off from the start: no row, no seq written
    await startLive()
    await tick() // 5 s: the outage's first try
    const firstSince = persistOf().revive.since
    expect(firstSince).toBeGreaterThan(0)

    // Storage comes back for one write only: the 10 s try creates the row, the
    // catch-up's first segment lands and its second refuses. The row cannot
    // be won back after that (a seq is on disk, the row cannot be read).
    mockCreateOk = true
    mockAppendTakeSegment.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    for (let i = 0; i < 60; i++) FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['x']) })
    await tick() // 10 s
    expect(mockAppendTakeSegment).toHaveBeenCalledTimes(2)
    expect(persistOf().seq).toBe(1)
    expect(persistOf().disabled).toBe(true)
    expect(persistOf().revive.since).toBe(firstSince)
    mockAppendOk = false

    await tick() // 15 s: the next try — ten seconds into the outage, not a new one
    expect(persistOf().revive.since).toBe(firstSince)
    expect(globalRecorder.captureWarning).toBeNull()
    await tick() // 20 s: fifteen after the ORIGINAL first try
    expect(Date.now() - firstSince).toBe(15_000)
    expect(globalRecorder.captureWarning).toBe('device')
  })
})

describe('PR-6 fix 2 — Greptile thread 3 (verified, pinned): a row refusal is not hidden once storage dies', () => {
  it('storage dies after the ROW took a terminal refusal: the real pump asks the door once more from memory, the refusal lands on memory, and the server notice is back on the next tick — no 60 s / 18-behind wait, one fact', async () => {
    type Pump = typeof import('@/lib/recording/segment-uploader')
    const real = jest.requireActual<Pump>('@/lib/recording/segment-uploader')
    real.__resetSegmentPumpState()
    const mint = jest.fn(async () => ({ error: 'forbidden' as const }))
    const memoryRuns: number[] = []
    mockPumpSegments.mockImplementation(async (...args: unknown[]) => {
      const [, takeId, opts] = args as [unknown, string, { source?: SegmentSource } | undefined]
      // The store pump stays a no-op here (its own file proves it); memory's
      // runs are the real one, against a door that refuses as it did before.
      if (!opts?.source) return
      memoryRuns.push(Date.now())
      await real.pumpSegments({ mintSegmentUrls: mint } as unknown as Parameters<Pump['pumpSegments']>[0], takeId, opts)
    })
    try {
      await startLive()
      // 5 s: seq 0 lands, and the ROW says the door refused this take for good.
      FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['a']) })
      mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: -1, lastSeq: 0, segmentError: 'forbidden' }
      await tick()
      expect(globalRecorder.captureWarning).toBe('server')

      // 10 s: storage dies. From here the notice reads memory, which never
      // saw the row's refusal — under 60 s recorded and 18 behind.
      mockAppendOk = false
      mockCreateOk = false
      FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['b']) })
      await tick()
      expect(persistOf().disabled).toBe(true)

      await tick() // 15 s: the first flush with storage off — memory's first pump run
      expect(memoryRuns).toHaveLength(1)
      expect(mint).toHaveBeenCalledTimes(1)
      await tick() // 20 s: the tick after that one attempt
      expect(globalRecorder.captureWarning).toBe('server')
      // Since fix 4 the hold alone would keep this 'server' up (it was up
      // when storage died), so the refusal is pinned where it lands: memory.
      expect((persistOf() as unknown as { segmentError?: string | null }).segmentError).toBe('forbidden')
      expect(Date.now() - memoryRuns[0]).toBe(5_000)
      await drain()
      expect(facts().map((f) => f.reason)).toEqual(['server'])
    } finally {
      mockPumpSegments.mockImplementation(async () => {})
      real.__resetSegmentPumpState()
    }
  })
})

describe('PR-6 fix 3 — FIX E: storage dying after healthy uploading is the device notice\'s, never a false server', () => {
  const recordedMsOf = () => (globalRecorder as unknown as { recordedMs(): number }).recordedMs()

  /** 90 s of healthy recording: a segment a tick, and the row's server cursor
   *  keeping up with every one of them. */
  async function ninetySecondsHealthy() {
    const takeId = await startLive()
    for (let i = 0; i < 18; i++) {
      FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['x']) })
      await tick()
      expect(globalRecorder.captureWarning).toBeNull()
      const s = persistOf().seq - 1
      mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: s, lastSeq: s }
    }
    expect(persistOf().seq).toBe(18)
    return takeId
  }

  /** Storage goes and cannot be won back (segments are on disk, the row
   *  cannot be read): the refusing flush's tick, then the revive's first try. */
  async function storageDies() {
    mockAppendOk = false
    mockCreateOk = false
    FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['y']) })
    await tick() // the flush refuses
    expect(persistOf().disabled).toBe(true)
    await tick() // the revive's first try: the outage's clock starts
    const since = persistOf().revive.since
    expect(since).toBe(Date.now())
    return since
  }

  it('(1) inside the 15 s grace the field is null — memory\'s −1 cursor is not "nothing on the server" — and no fact; at 15 s → device, one device fact', async () => {
    const takeId = await ninetySecondsHealthy()
    const since = await storageDies()
    expect(recordedMsOf()).toBeGreaterThanOrEqual(60_000)
    expect(globalRecorder.captureWarning).toBeNull()
    await tick(2) // ten seconds into the grace
    expect(globalRecorder.captureWarning).toBeNull()
    await drain()
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()

    await tick() // fifteen
    expect(Date.now() - since).toBe(15_000)
    expect(globalRecorder.captureWarning).toBe('device')
    await tick(3)
    await drain()
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-1', takeId, reason: 'device', warnedAt: expect.any(String) },
    ])
  })

  it('(2) storage off and memory\'s own pump gets a terminal refusal → server inside the grace, device at 15 s outranks it; one server fact, one device fact', async () => {
    // Memory's pump: the door refuses this take for good on its first ask.
    mockPumpSegments.mockImplementation(async (...args: unknown[]) => {
      const [, , opts] = args as [unknown, string, { source?: SegmentSource } | undefined]
      if (opts?.source) await opts.source.markError('forbidden')
    })
    try {
      const takeId = await ninetySecondsHealthy()
      const since = await storageDies() // memory's pump first asks on this tick
      await tick() // the tick after that one ask
      expect(Date.now() - since).toBe(5_000)
      expect(globalRecorder.captureWarning).toBe('server')
      await tick() // ten
      expect(globalRecorder.captureWarning).toBe('server')
      await tick() // fifteen
      expect(globalRecorder.captureWarning).toBe('device')
      await tick(3)
      expect(globalRecorder.captureWarning).toBe('device')
      await drain()
      expect(facts()).toEqual([
        { recordingSessionId: 'rs-1', takeId, reason: 'server', warnedAt: expect.any(String) },
        { recordingSessionId: 'rs-1', takeId, reason: 'device', warnedAt: expect.any(String) },
      ])
    } finally {
      mockPumpSegments.mockImplementation(async () => {})
    }
  })

  it('(3) storage on, nothing on the server in 60 s → server (the row\'s rule, unchanged)', async () => {
    await startLive()
    await tick(11)
    expect(globalRecorder.captureWarning).toBeNull()
    await tick()
    expect(persistOf().disabled).toBe(false)
    expect(globalRecorder.captureWarning).toBe('server')
  })

  it('storage comes back while memory\'s meta is out: no verdict from memory\'s counts — no false server, no fact; the next tick reads the row', async () => {
    mockCreateOk = false // storage off from the start: no seq written
    const takeId = await startLive()
    await tick(4) // 20 s: fifteen after the revive's first try
    expect(globalRecorder.captureWarning).toBe('device')
    await tick(11) // 75 s: tries went out at 5, 10, 20, 40 s — the next is due at 80 s
    expect(persistOf().disabled).toBe(true)

    // The 80 s tick: memory's meta read hangs on its held-by-another check
    // while the revive wins the row and the catch-up lands behind it.
    mockCreateOk = true
    mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: 1, lastSeq: 1 }
    const held = deferred<boolean>()
    mockIsTakeHeldByAnother.mockImplementationOnce(() => held.promise)
    for (let i = 0; i < 60; i++) FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['x']) })
    await tick() // 80 s
    expect(persistOf().disabled).toBe(false)
    expect(recordedMsOf()).toBeGreaterThanOrEqual(60_000)
    held.resolve(false) // memory's meta: its cursor −1, 80 s recorded
    await drain()
    expect(globalRecorder.captureWarning).toBe('device')
    await tick() // 85 s: the row, caught up
    expect(globalRecorder.captureWarning).toBeNull()
    await drain()
    expect(facts()).toEqual([
      { recordingSessionId: 'rs-1', takeId, reason: 'device', warnedAt: expect.any(String) },
    ])
  })
})

describe('PR-6 fix 4 — FIX G (gr thread 4108115336): a server notice already up is held through a storage outage\'s grace', () => {
  it('server stalled (the row) → storage dies → the field STAYS server through the grace, no null heard, no new fact → device at 15 s, one device fact → storage back, the row caught up → null', async () => {
    const takeId = await startLive()
    await tick(12) // 60 s recorded, nothing on the server: the row says server
    expect(persistOf().disabled).toBe(false)
    expect(globalRecorder.captureWarning).toBe('server')
    await drain()
    expect(facts().map((f) => f.reason)).toEqual(['server'])

    // Every value subscribers hear from here on.
    const heard: (string | null)[] = []
    const off = globalRecorder.subscribe(() => heard.push(globalRecorder.captureWarning))
    try {
      // Storage goes, and the revive cannot win it back yet (no segment on
      // disk, the row cannot be made).
      mockAppendOk = false
      mockCreateOk = false
      FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob(['y']) })
      await tick() // 65 s: the flush refuses
      expect(persistOf().disabled).toBe(true)
      expect(globalRecorder.captureWarning).toBe('server')
      const rowReads = mockReadTakeUploadMeta.mock.calls.length
      await tick() // 70 s: the revive's first try — the outage's clock starts
      const since = persistOf().revive.since
      expect(since).toBe(Date.now())

      // The grace: memory is read (not the row), memory has no refusal of its
      // own and its counts say nothing — the notice staff are reading stays.
      const seen: (string | null)[] = [globalRecorder.captureWarning]
      for (let i = 0; i < 2; i++) {
        await tick() // 75 s, 80 s
        seen.push(globalRecorder.captureWarning)
      }
      expect(seen).toEqual(['server', 'server', 'server'])
      expect(mockReadTakeUploadMeta.mock.calls.length).toBe(rowReads)
      expect(mockIsTakeHeldByAnother).toHaveBeenCalled()
      await drain()
      expect(facts().map((f) => f.reason)).toEqual(['server'])

      await tick() // 85 s: fifteen after the first try
      expect(Date.now() - since).toBe(15_000)
      expect(globalRecorder.captureWarning).toBe('device')
      await tick(3)
      expect(globalRecorder.captureWarning).toBe('device')
      await drain()
      expect(facts()).toEqual([
        { recordingSessionId: 'rs-1', takeId, reason: 'server', warnedAt: expect.any(String) },
        { recordingSessionId: 'rs-1', takeId, reason: 'device', warnedAt: expect.any(String) },
      ])

      // Storage comes back: the 105 s try (tries at 70, 75, 85, 105 s) makes
      // the row, the catch-up writes the one segment memory held, and the
      // row says the server has it.
      mockCreateOk = true
      mockAppendOk = true
      mockRowMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: 0, lastSeq: 0 }
      await tick() // 105 s
      expect(persistOf().disabled).toBe(false)
      await tick() // 110 s: the row, caught up — the hold is over
      expect(globalRecorder.captureWarning).toBeNull()
      await tick(2)
      expect(globalRecorder.captureWarning).toBeNull()
      await drain()
      expect(facts()).toHaveLength(2)
      // Heard: server held (nothing), then device, then null — never a null
      // between server and device.
      expect(heard.filter((v, i) => v !== heard[i - 1])).toEqual(['device', null])
    } finally {
      off()
    }
  })
})

describe('PR-6 fix 3 — FIX F: a read that never answers never freezes the notice', () => {
  const BEHIND: UploadMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: -1, lastSeq: 30 }
  const CAUGHT_UP: UploadMeta = { recordingSessionId: 'rs-1', mimeType: 'audio/webm', uploadedSeq: 12, lastSeq: 12 }

  it('a read that never answers is let go at 4 s: the next tick still reads, and its answer sets the field', async () => {
    await startLive()
    await tick(11) // 55 s
    mockReadTakeUploadMeta.mockImplementationOnce(() => new Promise<UploadMeta | null>(() => {}))
    await tick() // 60 s: the read is out, and never answers
    expect(globalRecorder.captureWarning).toBeNull()
    const reads = mockReadTakeUploadMeta.mock.calls.length
    await tick() // 65 s: let go at 64 s — this tick reads fresh
    expect(mockReadTakeUploadMeta).toHaveBeenCalledTimes(reads + 1)
    expect(globalRecorder.captureWarning).toBe('server')
    await drain()
    expect(facts().map((f) => f.reason)).toEqual(['server'])
  })

  it('a read that answers after its deadline sets nothing — no notice, no change heard, no fact; the next tick\'s read is the one that stands', async () => {
    await startLive()
    await tick(11) // 55 s
    const slow = deferred<UploadMeta | null>()
    mockReadTakeUploadMeta.mockImplementationOnce(() => slow.promise)
    await tick() // 60 s: the read is out
    await jest.advanceTimersByTimeAsync(3_999)
    await drain()
    const v = globalRecorder.version
    await jest.advanceTimersByTimeAsync(1) // 64 s: the deadline wins
    await drain()
    slow.resolve(BEHIND) // too late
    await drain()
    expect(globalRecorder.captureWarning).toBeNull()
    expect(globalRecorder.version).toBe(v)
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()

    mockRowMeta = CAUGHT_UP
    await jest.advanceTimersByTimeAsync(1_000) // 65 s
    await drain()
    expect(globalRecorder.captureWarning).toBeNull()
    expect(mockRecordCaptureWarning).not.toHaveBeenCalled()
  })

  it('a stop or a discard lets go of a read that is out at once — its deadline timer never outlives them', async () => {
    const setSpy = jest.spyOn(globalThis, 'setTimeout')
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout')
    try {
      for (const end of [() => globalRecorder.stop(), () => globalRecorder.discard()]) {
        globalRecorder.discard()
        await startLive()
        await tick(11)
        mockReadTakeUploadMeta.mockImplementationOnce(() => new Promise<UploadMeta | null>(() => {}))
        setSpy.mockClear()
        clearSpy.mockClear()
        await tick() // the read is out, its deadline armed
        const armed = setSpy.mock.calls.findIndex(([, ms]) => ms === 4_000)
        expect(armed).toBeGreaterThanOrEqual(0)
        const deadline = setSpy.mock.results[armed].value
        expect(clearSpy).not.toHaveBeenCalledWith(deadline)
        end()
        expect(clearSpy).toHaveBeenCalledWith(deadline)
        expect((globalRecorder as unknown as { evaluatingCaptureWarning: unknown }).evaluatingCaptureWarning).toBeNull()
      }
    } finally {
      setSpy.mockRestore()
      clearSpy.mockRestore()
    }
  })
})
