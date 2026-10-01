/**
 * @jest-environment jsdom
 *
 * PR-B commit 4 — capture that ends by itself says so (B8, B-S66-1/8, K-4,
 * K-12, AMB-2, AMB-3). The hooks record `endedBySystem {at, why}` on the take
 * (LOCAL only) and restart nothing; the 'recorded'-state line is gated OUTER
 * captureWarningNotice, INNER captureEndHooks.
 * Harness: capture-warning-recorder.test.ts's fake mic + MediaRecorder, with
 * a track that can fire ended / mute / unmute.
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
jest.mock('@/lib/recording/secure-take', () => ({ secureTake: async () => {} }))
jest.mock('@/lib/ports/recording-port', () => ({ getRecordingPipelinePort: () => ({}) }))

import { globalRecorder } from '@/lib/global-recorder'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

const drain = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
const TARGET = { customerId: 'cust-1', customerName: 'C', karuteNumber: null, appointmentId: null }
async function startLive() {
  await globalRecorder.start({ target: TARGET })
  await drain()
  return globalRecorder.takeId!
}
const off = (key: 'captureEndHooks' | 'captureWarningNotice') =>
  jest.replaceProperty(RECORDING_SWITCHES as Record<typeof key, boolean>, key, false)

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
  jest.clearAllMocks()
  FakeMediaRecorder.starts = 0
  track = { onended: null, onmute: null, onunmute: null, stop: () => {} }
  globalRecorder.discard()
  await drain()
})
afterEach(() => {
  globalRecorder.discard()
  jest.useRealTimers()
})

describe('the hooks record, never restart (B8)', () => {
  it('track ended → endedBySystem track_ended on the take; the recorder is not restarted or stopped', async () => {
    const takeId = await startLive()
    track.onended!()
    await drain()
    expect(globalRecorder.endedBySystem).toMatchObject({ why: 'track_ended' })
    expect(mockMarkEnded).toHaveBeenCalledWith(takeId, expect.objectContaining({ why: 'track_ended', at: expect.any(Number) }))
    expect(FakeMediaRecorder.starts).toBe(1)
    expect(globalRecorder.state).toBe('recording')
  })
  it('the first sign wins: a recorder error after the track ended keeps track_ended, one write', async () => {
    await startLive()
    track.onended!()
    FakeMediaRecorder.last!.onerror!()
    await drain()
    expect(globalRecorder.endedBySystem?.why).toBe('track_ended')
    expect(mockMarkEnded).toHaveBeenCalledTimes(1)
  })
  it('a mute is a warning: unmute withdraws it (null written); an unmute never withdraws a real end', async () => {
    const takeId = await startLive()
    track.onmute!()
    await drain()
    expect(globalRecorder.endedBySystem?.why).toBe('muted')
    track.onunmute!()
    await drain()
    expect(globalRecorder.endedBySystem).toBeNull()
    expect(mockMarkEnded).toHaveBeenLastCalledWith(takeId, null)
    track.onended!()
    track.onunmute!()
    await drain()
    expect(globalRecorder.endedBySystem?.why).toBe('track_ended')
  })
  // PR-B Wn (W-6 + R-S77-9): a real sign replaces a held 'muted' and keeps
  // the mute's EXACT onset; the later unmute cannot wipe it.
  it.each([
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    ['freeze', () => document.dispatchEvent(new Event('freeze'))],
    ['track_ended', () => track.onended!()],
    ['recorder_error', () => FakeMediaRecorder.last!.onerror!()],
  ])('mute → %s → unmute: the real sign replaces the mute, keeps mutedAt, survives the unmute', async (why, fire) => {
    const takeId = await startLive()
    jest.setSystemTime(1_000_000)
    track.onmute!()
    await drain()
    jest.setSystemTime(2_000_000)
    fire()
    await drain()
    track.onunmute!()
    await drain()
    const mark = { at: 2_000_000, why, mutedAt: 1_000_000 }
    expect(globalRecorder.endedBySystem).toEqual(mark)
    expect(mockMarkEnded.mock.calls).toEqual([
      [takeId, { at: 1_000_000, why: 'muted' }],
      [takeId, mark],
    ])
  })
  it("'muted' over a held 'muted' → no new at, no second write", async () => {
    const takeId = await startLive()
    jest.setSystemTime(1_000_000)
    track.onmute!()
    await drain()
    jest.setSystemTime(2_000_000)
    track.onmute!()
    await drain()
    expect(globalRecorder.endedBySystem).toEqual({ at: 1_000_000, why: 'muted' })
    expect(mockMarkEnded.mock.calls).toEqual([[takeId, { at: 1_000_000, why: 'muted' }]])
  })
  it('the first REAL sign still wins over a later real sign and a later mute; no mutedAt without a mute', async () => {
    const takeId = await startLive()
    jest.setSystemTime(3_000_000)
    window.dispatchEvent(new Event('pagehide'))
    await drain()
    track.onended!()
    track.onmute!()
    track.onunmute!()
    await drain()
    expect(globalRecorder.endedBySystem).toEqual({ at: 3_000_000, why: 'pagehide' })
    expect(mockMarkEnded.mock.calls).toEqual([[takeId, { at: 3_000_000, why: 'pagehide' }]])
  })
  it.each([
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    ['freeze', () => document.dispatchEvent(new Event('freeze'))],
  ])('%s during a live take → endedBySystem %s', async (why, fire) => {
    await startLive()
    fire()
    await drain()
    expect(globalRecorder.endedBySystem?.why).toBe(why)
  })
  it('after the stop a page event writes nothing (the listeners go with the take)', async () => {
    await startLive()
    globalRecorder.stop()
    await drain()
    window.dispatchEvent(new Event('pagehide'))
    await drain()
    expect(globalRecorder.endedBySystem).toBeNull()
    expect(mockMarkEnded).not.toHaveBeenCalled()
  })
})

describe('the recorded-state line — gate order (AMB-3)', () => {
  it('(a) both switches ON + endedBySystem set → the line shows after the stop', async () => {
    await startLive()
    track.onended!()
    expect(globalRecorder.endedBySystemNotice).toBe(false) // live: not the recorded state
    globalRecorder.stop()
    await drain()
    expect(globalRecorder.state).toBe('recorded')
    expect(globalRecorder.endedBySystemNotice).toBe(true)
  })
  it('(b) captureWarningNotice OFF → no line, even with endedBySystem set', async () => {
    await startLive()
    track.onended!()
    globalRecorder.stop()
    await drain()
    const o = off('captureWarningNotice')
    try {
      expect(globalRecorder.endedBySystem).not.toBeNull()
      expect(globalRecorder.endedBySystemNotice).toBe(false)
    } finally {
      o.restore()
    }
  })
  it('(c) captureEndHooks OFF → no hook attached, no field, no write, no line', async () => {
    const o = off('captureEndHooks')
    try {
      await startLive()
      expect(track.onended).toBeNull()
      expect(track.onmute).toBeNull()
      expect(FakeMediaRecorder.last!.onerror).toBeNull()
      window.dispatchEvent(new Event('pagehide'))
      document.dispatchEvent(new Event('freeze'))
      globalRecorder.stop()
      await drain()
      expect(globalRecorder.endedBySystem).toBeNull()
      expect(mockMarkEnded).not.toHaveBeenCalled()
      expect(globalRecorder.endedBySystemNotice).toBe(false)
    } finally {
      o.restore()
    }
  })
})
