/**
 * The recorder's yellow notice, decided (recording hole PR-6) — the pure
 * detector. Every threshold is pinned on both sides of its edge, `device`
 * outranking `server` is pinned with both true, and recovery is pinned as a
 * return to null (no latch).
 */
import {
  computeCaptureWarning,
  DEVICE_GRACE_MS,
  SEGMENTS_BEHIND,
  SERVER_SILENT_MS,
} from '@/lib/recording/capture-warning-detect'

const NOW = 1_000_000_000

/** A healthy live take: storage on, the server one segment behind. */
const healthy = {
  recordedMs: 5 * 60_000,
  disabled: false,
  reviveAt: 0,
  uploadedSeq: 10,
  lastSeq: 11,
  segmentError: null,
  now: NOW,
}

describe('computeCaptureWarning — the thresholds', () => {
  it('the constants are the ones the plan names', () => {
    expect(SERVER_SILENT_MS).toBe(60_000)
    expect(SEGMENTS_BEHIND).toBe(18)
    expect(DEVICE_GRACE_MS).toBe(15_000)
  })

  it('a healthy take warns nothing', () => {
    expect(computeCaptureWarning(healthy)).toBeNull()
  })

  it('59 s recorded with nothing on the server → null; 60 s → server', () => {
    const silent = { ...healthy, uploadedSeq: -1, lastSeq: 10 }
    expect(computeCaptureWarning({ ...silent, recordedMs: 59_000 })).toBeNull()
    expect(computeCaptureWarning({ ...silent, recordedMs: 59_999 })).toBeNull()
    expect(computeCaptureWarning({ ...silent, recordedMs: 60_000 })).toBe('server')
  })

  it('one segment on the server is not "never" — 60 s with uploadedSeq 0 → null', () => {
    expect(
      computeCaptureWarning({ ...healthy, recordedMs: 60_000, uploadedSeq: 0, lastSeq: 1 }),
    ).toBeNull()
  })

  it('17 segments behind → null; 18 → server', () => {
    expect(computeCaptureWarning({ ...healthy, uploadedSeq: 3, lastSeq: 20 })).toBeNull()
    expect(computeCaptureWarning({ ...healthy, uploadedSeq: 3, lastSeq: 21 })).toBe('server')
  })

  it('a terminal segment error → server; an empty one does not count', () => {
    expect(computeCaptureWarning({ ...healthy, segmentError: 'forbidden' })).toBe('server')
    expect(computeCaptureWarning({ ...healthy, segmentError: '' })).toBeNull()
    expect(computeCaptureWarning({ ...healthy, segmentError: undefined })).toBeNull()
  })

  it('storage off, the revive tried 14.9 s ago → null; 15 s ago → device', () => {
    const off = { ...healthy, disabled: true }
    expect(computeCaptureWarning({ ...off, reviveAt: NOW - 14_900 })).toBeNull()
    expect(computeCaptureWarning({ ...off, reviveAt: NOW - 14_999 })).toBeNull()
    expect(computeCaptureWarning({ ...off, reviveAt: NOW - 15_000 })).toBe('device')
  })

  it('storage off but the revive has not tried yet → not device', () => {
    expect(computeCaptureWarning({ ...healthy, disabled: true, reviveAt: 0 })).toBeNull()
  })

  it('the revive tried long ago but storage is back on → not device', () => {
    expect(computeCaptureWarning({ ...healthy, disabled: false, reviveAt: NOW - 60_000 })).toBeNull()
  })

  it('device and server both true → device', () => {
    expect(
      computeCaptureWarning({
        ...healthy,
        disabled: true,
        reviveAt: NOW - 30_000,
        recordedMs: 120_000,
        uploadedSeq: -1,
        lastSeq: 30,
        segmentError: 'forbidden',
      }),
    ).toBe('device')
  })

  it('recovery clears it: storage back and the server caught up → null', () => {
    const bad = {
      ...healthy,
      disabled: true,
      reviveAt: NOW - 30_000,
      recordedMs: 120_000,
      uploadedSeq: -1,
      lastSeq: 20,
    }
    expect(computeCaptureWarning(bad)).toBe('device')
    // The revive won the storage back: the server side still holds.
    expect(computeCaptureWarning({ ...bad, disabled: false })).toBe('server')
    // …and the pump caught up: nothing holds, nothing is latched.
    expect(computeCaptureWarning({ ...bad, disabled: false, uploadedSeq: 19 })).toBeNull()
  })
})

describe('computeCaptureWarning — PR-6 fix 3: while storage is off, only a terminal refusal says server', () => {
  /** Memory's meta after storage died on a take that uploaded healthily: its
   *  own cursor never moved (−1), 30 segments held, two minutes recorded —
   *  both count rules would say server if they read it. */
  const memoryAfterHealthyUploads = {
    ...healthy,
    disabled: true,
    recordedMs: 120_000,
    uploadedSeq: -1,
    lastSeq: 30,
  }

  it('(1) inside the 15 s grace the counts say nothing → null; at 15 s → device', () => {
    expect(computeCaptureWarning({ ...memoryAfterHealthyUploads, reviveAt: 0 })).toBeNull()
    expect(computeCaptureWarning({ ...memoryAfterHealthyUploads, reviveAt: NOW - 14_999 })).toBeNull()
    expect(computeCaptureWarning({ ...memoryAfterHealthyUploads, reviveAt: NOW - 15_000 })).toBe('device')
  })

  it('(2) a terminal refusal memory\'s own pump received → server inside the grace; device outranks it at 15 s', () => {
    const refused = { ...memoryAfterHealthyUploads, segmentError: 'forbidden' }
    expect(computeCaptureWarning({ ...refused, reviveAt: 0 })).toBe('server')
    expect(computeCaptureWarning({ ...refused, reviveAt: NOW - 14_999 })).toBe('server')
    expect(computeCaptureWarning({ ...refused, reviveAt: NOW - 15_000 })).toBe('device')
  })

  it('(3) storage on, nothing uploaded in 60 s → server (the row\'s rules, unchanged)', () => {
    expect(
      computeCaptureWarning({ ...healthy, disabled: false, recordedMs: 60_000, uploadedSeq: -1, lastSeq: 11 }),
    ).toBe('server')
    expect(computeCaptureWarning({ ...healthy, disabled: false, uploadedSeq: 3, lastSeq: 21 })).toBe('server')
  })
})
