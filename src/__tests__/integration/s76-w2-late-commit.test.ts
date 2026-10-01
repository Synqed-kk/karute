/**
 * S76 commit W (W-2): the S75 red test, landed unchanged — green by the default OFF
 * (recording-switches awaitSegmentCommit); it pins that default (M-S75-10).
 * S75 RED — W-2: commit 7's 5-second deadline turns a slow-but-SUCCESSFUL
 * segment commit into a "lost" answer while the disk ends up holding the segment.
 *
 * Chosen seam: the STORE level (appendTakeSegment), not the recorder. Driving
 * globalRecorder needs a MediaRecorder, the start-mint, the flush queue and the
 * revive ticks; the trace (TRACE-S75-W2W3 §2) shows the recorder consequence is
 * a pure function of this answer: `!ok` → p.disabled, p.seq NOT advanced, and
 * every revive compares meta.lastSeq (N, written by the late commit) with
 * p.seq − 1 (N − 1) and refuses. So the contradiction that makes the store stay
 * off is exactly: append answered false, disk holds seq N.
 *
 * The shim is local and minimal (take-durability.test.ts's shim fires complete
 * in a microtask and is not exported): the transaction's requests succeed at
 * once, and the transaction COMMITS (rows become durable, `complete` fires)
 * LATE_COMMIT_MS after it opened — past SEGMENT_COMMIT_DEADLINE_MS. Nothing
 * aborts it, as in IndexedDB: a transaction nobody aborts auto-commits.
 *
 * RED today (awaitSegmentCommit ON): answered 'lost', disk holds seq N.
 * CONTROL (awaitSegmentCommit OFF): answered 'committed', disk holds seq N → GREEN.
 */
jest.mock('@/lib/karute/draft', () => ({ currentUserId: async () => 'staff-A' }))

import { appendTakeSegment, SEGMENT_COMMIT_DEADLINE_MS } from '@/lib/karute/take-store'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

const LATE_COMMIT_MS = SEGMENT_COMMIT_DEADLINE_MS + 1_000
type Row = Record<string, unknown>

/** The DURABLE state: what a later transaction (a revive's read) would see. */
const disk = { takes: new Map<string, Row>(), segments: new Map<string, Row>() }
const segKey = (takeId: unknown, seq: unknown) => `${takeId}|${seq}`

function request<T>(exec: () => T) {
  const r = { onsuccess: null as null | (() => void), onerror: null as null | (() => void), result: undefined as T, error: null as unknown }
  // A real microtask: jest's fake timers also fake queueMicrotask.
  void Promise.resolve().then(() => {
    try {
      r.result = exec()
      r.onsuccess?.()
    } catch (e) {
      r.error = e
      r.onerror?.()
    }
  })
  return r
}

function transaction() {
  const pending: Array<() => void> = []
  const tx = {
    onabort: null as null | (() => void),
    onerror: null as null | (() => void),
    oncomplete: null as null | (() => void),
    objectStore: (name: string) => ({
      get: (key: string) => request(() => (name === 'takes' ? disk.takes.get(key) : undefined)),
      put: (row: Row) =>
        request(() => {
          pending.push(() =>
            name === 'takes' ? disk.takes.set(row.takeId as string, row) : disk.segments.set(segKey(row.takeId, row.seq), row),
          )
          return undefined
        }),
      getAll: () => request(() => [...(name === 'takes' ? disk.takes : disk.segments).values()]),
    }),
  }
  // The commit phase is slow but succeeds: the writes land, then `complete`.
  setTimeout(() => {
    pending.splice(0).forEach((apply) => apply())
    tx.oncomplete?.()
  }, LATE_COMMIT_MS)
  return tx
}

const fakeDb = {
  objectStoreNames: { contains: () => true },
  createObjectStore: () => ({}),
  transaction,
  close: () => {},
  onversionchange: null,
  onclose: null,
}
;(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () => {
    const r = { result: fakeDb, onupgradeneeded: null, onsuccess: null as null | (() => void), onerror: null, onblocked: null }
    void Promise.resolve().then(() => r.onsuccess?.())
    return r
  },
}

const TAKE = '0b8d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const N = 1

beforeEach(() => {
  jest.useFakeTimers()
  disk.takes.clear()
  disk.segments.clear()
  // Seq 0 already landed; the recorder now flushes seq N = 1.
  disk.takes.set(TAKE, { takeId: TAKE, ownerUid: 'staff-A', startedAt: 0, updatedAt: 0, lastSeq: 0, bytesEmitted: 10, mimeType: 'audio/webm' })
  disk.segments.set(segKey(TAKE, 0), { takeId: TAKE, seq: 0, blob: new Blob(['0123456789']) })
})
afterEach(() => jest.useRealTimers())

/** Flush seq N with a commit that lands after the deadline; report the answer
 *  and what the disk holds once the commit has landed. */
async function lateCommitFlush() {
  let answered: boolean | undefined
  const flush = appendTakeSegment(TAKE, N, new Blob(['seg-one-tick'])).then((ok) => (answered = ok))
  // Let the store open, read and write (all microtasks) before the clock moves.
  for (let i = 0; i < 50; i++) await Promise.resolve()
  await jest.advanceTimersByTimeAsync(SEGMENT_COMMIT_DEADLINE_MS + 1)
  const answeredAtDeadline = answered
  await jest.advanceTimersByTimeAsync(LATE_COMMIT_MS)
  await flush
  const meta = disk.takes.get(TAKE) as { lastSeq?: number } | undefined
  return {
    answeredAtDeadline,
    appendAnswer: answered ? 'committed' : 'lost',
    diskAfterCommit: disk.segments.has(segKey(TAKE, N)) ? `holds seq ${N}` : `no seq ${N}`,
    diskLastSeq: meta?.lastSeq,
  }
}

describe('W-2 — a segment whose complete arrives after SEGMENT_COMMIT_DEADLINE_MS', () => {
  it('RED: the append answer agrees with the disk (the disk holds seq N, so the answer must not be "lost")', async () => {
    const r = await lateCommitFlush()
    expect({ appendAnswer: r.appendAnswer, diskAfterCommit: r.diskAfterCommit, diskLastSeq: r.diskLastSeq }).toEqual({
      appendAnswer: 'committed',
      diskAfterCommit: `holds seq ${N}`,
      diskLastSeq: N,
    })
  })

  it('CONTROL: awaitSegmentCommit OFF → answered committed, disk holds seq N (GREEN)', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { awaitSegmentCommit: boolean }, 'awaitSegmentCommit', false)
    try {
      const r = await lateCommitFlush()
      expect({ appendAnswer: r.appendAnswer, diskAfterCommit: r.diskAfterCommit, diskLastSeq: r.diskLastSeq }).toEqual({
        appendAnswer: 'committed',
        diskAfterCommit: `holds seq ${N}`,
        diskLastSeq: N,
      })
    } finally {
      off.restore()
    }
  })
})
