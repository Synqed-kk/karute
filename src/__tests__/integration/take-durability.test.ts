/**
 * @jest-environment jsdom
 *
 * Take durability (lib/karute/take-store + GlobalRecorder persistence).
 *
 * A staff session recording must survive a WKWebView kill / tab reload /
 * crash: GlobalRecorder flushes captured chunks to IndexedDB every ~5 s and
 * the take stays until the karute record saves. These tests run against a
 * minimal in-memory IndexedDB shim (no fake-indexeddb dependency) covering
 * exactly the surface take-store uses.
 *
 * The one non-negotiable: persistence failing must NEVER affect capture.
 */

let mockUid: string | null = 'staff-A'
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: mockUid ? { user: { id: mockUid } } : null },
        error: null,
      }),
    },
  }),
}))

const mockStartRecordingSession = jest.fn(
  async (_input?: unknown): Promise<{ id: string } | null> => null,
)
// The ARGUMENTS reach the mock (fix round 8): what the start-mint names is now
// what the door composes this take's key from, so a dropped field is a row born
// unbound — invisible if the door is called with nothing to inspect.
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: (input: unknown) => mockStartRecordingSession(input),
}))

// ── Minimal IndexedDB shim ──────────────────────────────────────────────────

type Row = Record<string, unknown>
const norm = (k: unknown) => JSON.stringify(k)
let failWrites = false
/** Make SEGMENT writes land on a timer instead of a microtask. Real IndexedDB
 *  writes a multi-MB blob to disk — it is nothing like a microtask — and with a
 *  microtask-fast shim "the tail flush is awaited" is proven by nothing: an
 *  UNawaited secureTake wins the race anyway, because its own store reads cost
 *  more microtasks than the flush does. One test flips this so the ordering has
 *  to be real. */
let slowSegmentWrites = false
/** …and one that never answers AT ALL — a store request that neither succeeds
 *  nor errors. It is the only shape of failure the stop leg's `finally` cannot
 *  cover (a leg that never exits runs no finally), and it is what fix round
 *  15's hold deadline exists for. The parked settlers are released rather than
 *  dropped: an unanswered segment write blocks the persist QUEUE, so leaving
 *  one behind would starve every take in every test after it. */
let hangSegmentWrites = false
/** …and the same park for the STOP STAMP's own TAKES put (fix round 19). The
 *  first act's write is in flight for a real moment, and 停止 then 録音 lands a
 *  start() inside it — the window in which the flush behind it answers
 *  "skipped" for a take that is already whole and already stamped. */
let hangStampWrites = false
/** …and the next N CREATE writes — the row a take is born with (`lastSeq: -1`).
 *  A create that answers AFTER the staffer has started the next recording is
 *  the window fix round 20's per-take object is measured in: its verdict is
 *  about ITS take's row and must reach nothing else. */
let hangNextCreates = 0
const isCreatePut = (store: string, row: Row) =>
  store === TAKES_STORE && (row as { lastSeq?: number }).lastSeq === -1
const parkCreate = (store: string, row: Row) => {
  if (hangNextCreates <= 0 || !isCreatePut(store, row)) return false
  hangNextCreates--
  return true
}
const hungWrites: Array<() => void> = []
const releaseHungWrites = () => {
  hangSegmentWrites = false
  hangStampWrites = false
  hangNextCreates = 0
  hungWrites.splice(0).forEach((settle) => settle())
}
/** Fail the next N writes that carry a STOP STAMP — the one write fix round 13
 *  is about. Narrower than `failWrites` on purpose: a transient IndexedDB
 *  failure hits one transaction, not the store forever.
 *
 *  ⚖ SINCE FIX ROUND 18 that write can be the TAIL FLUSH'S OWN meta put: the
 *  stamp rides the transaction that lands the tail bytes. Failing it is
 *  therefore how the fold's atomicity is proven — the segment must roll back
 *  with it — as well as how a lost stamp is still modelled where there is no
 *  tail to ride (`emptyTailChunk`). */
let failNextDurationStamps = 0
/** …and the next N writes that carry round 16's TAIL MARK — the write that says
 *  a stop lost its tail. Same narrow shape as the stamp above, and the case it
 *  models is the same one: a transaction refusing, not the store dying. */
let failNextTailMarks = 0
/** …and the next N SEGMENT writes. Since fix round 20 a refused write is the
 *  ONLY way a stop can end with a tail it did not write: the stop→start and
 *  stop→discard shapes that used to report a "skipped" tail no longer do, because
 *  the take's own array and counters go with the take. So every skipped-tail
 *  case below is re-based on this — the honest one. */
let failNextSegmentWrites = 0
/** A real MediaRecorder whose last timeslice ended AT the stop emits a
 *  zero-size final chunk, and `ondataavailable` drops it — so the stop leg
 *  finds nothing pending and the disk is already whole. That is the shape fix
 *  round 18's first act stamps in, and the only shape in which a stop stamp can
 *  still lose a write of its own. */
let emptyTailChunk = false
/** Every TAKES put that INTRODUCED a `durationMs` (the row had none before),
 *  by the `lastSeq` it carried. The round-18 claim in one array: exactly one
 *  write ever carries the stamp, and when a tail is owed it is the write that
 *  carried the tail. Later puts spread the stamp forward, which is why this
 *  counts the introduction and not the presence. */
const stampWrites: number[] = []

class FakeObjectStore {
  data = new Map<string, Row>()
  constructor(public keyPath: string | string[]) {}
  keyOf(row: Row): string {
    return norm(
      Array.isArray(this.keyPath)
        ? this.keyPath.map((p) => row[p])
        : row[this.keyPath],
    )
  }
}

class FakeRequest<T> {
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  result!: T
  error: unknown = null
  constructor(exec: () => T, slow = false, hang = false) {
    const settle = () => {
      try {
        this.result = exec()
        this.onsuccess?.()
      } catch (e) {
        this.error = e
        this.onerror?.()
      }
    }
    if (hang) {
      hungWrites.push(settle)
      return
    }
    if (slow) setTimeout(settle, 0)
    else queueMicrotask(settle)
  }
}

const SEGMENTS_STORE = 'segments'
const TAKES_STORE = 'takes'

class FakeIDB {
  stores = new Map<string, FakeObjectStore>()
  objectStoreNames = { contains: (n: string) => this.stores.has(n) }
  createObjectStore(name: string, opts: { keyPath: string | string[] }) {
    const s = new FakeObjectStore(opts.keyPath)
    this.stores.set(name, s)
    return s
  }
  // Args ignored — the shim scopes stores per call, not per transaction.
  transaction() {
    // ⚖ AND IT IS ALL OR NOTHING (fix round 18). Real IndexedDB ABORTS the whole
    // transaction when one request errors and rolls back every write it already
    // made. The shim used to leave the earlier ones standing, so "the tail bytes
    // and the stamp land together or not at all" — the whole of AG1 — could not
    // be proven here at all: the segment would land beside a refused stamp and
    // the test would be pinning the shim's own leniency.
    // ponytail: only `put` is undone. Nothing in this file deletes or clears
    // inside a multi-write transaction, and a rollback nobody needs is code
    // nobody reads.
    const undo: Array<() => void> = []
    const abortOnError =
      <T,>(exec: () => T) =>
      () => {
        try {
          return exec()
        } catch (e) {
          undo.splice(0).reverse().forEach((back) => back())
          throw e
        }
      }
    return {
      objectStore: (n: string) => {
        const s = this.stores.get(n)!
        return {
          put: (row: Row) =>
            new FakeRequest(
              abortOnError(() => {
                if (failWrites) throw new Error('idb write failure (test)')
                if (n === SEGMENTS_STORE && failNextSegmentWrites > 0) {
                  failNextSegmentWrites--
                  throw new Error('idb segment write failure (test)')
                }
                if (
                  n === TAKES_STORE &&
                  failNextDurationStamps > 0 &&
                  (row as { durationMs?: number }).durationMs !== undefined
                ) {
                  failNextDurationStamps--
                  throw new Error('idb stop-stamp write failure (test)')
                }
                if (
                  n === TAKES_STORE &&
                  failNextTailMarks > 0 &&
                  (row as { tailIncomplete?: boolean }).tailIncomplete !== undefined
                ) {
                  failNextTailMarks--
                  throw new Error('idb tail-mark write failure (test)')
                }
                const key = s.keyOf(row)
                const had = s.data.get(key)
                if (
                  n === TAKES_STORE &&
                  (row as { durationMs?: number }).durationMs !== undefined &&
                  (had as { durationMs?: number } | undefined)?.durationMs === undefined
                )
                  stampWrites.push((row as { lastSeq: number }).lastSeq)
                undo.push(() => {
                  if (had === undefined) s.data.delete(key)
                  else s.data.set(key, had)
                })
                s.data.set(key, row)
              }),
              slowSegmentWrites && n === SEGMENTS_STORE,
              (hangSegmentWrites && n === SEGMENTS_STORE) ||
                (hangStampWrites &&
                  n === TAKES_STORE &&
                  (row as { durationMs?: number }).durationMs !== undefined) ||
                parkCreate(n, row),
            ),
          get: (key: unknown) => new FakeRequest(() => s.data.get(norm(key))),
          getAll: () => new FakeRequest(() => [...s.data.values()]),
          delete: (key: unknown) =>
            new FakeRequest(() => {
              s.data.delete(norm(key))
            }),
          clear: () =>
            new FakeRequest(() => {
              s.data.clear()
            }),
        }
      },
    }
  }
}

const fakeDb = new FakeIDB()
;(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () => {
    const req = {
      result: fakeDb,
      error: null,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    }
    queueMicrotask(() => {
      if (fakeDb.stores.size === 0) req.onupgradeneeded?.()
      req.onsuccess?.()
    })
    return req
  },
}

// ── MediaRecorder / getUserMedia fakes ──────────────────────────────────────

class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null
  static isTypeSupported() {
    return true
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'audio/webm'
  constructor() {
    FakeMediaRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    // Real MediaRecorder emits the final dataavailable BEFORE the stop event —
    // the tail chunk exercises the onstop final flush.
    if (this.state !== 'inactive') {
      this.ondataavailable?.({ data: new Blob(emptyTailChunk ? [] : ['TAIL']) })
    }
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
;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
  FakeMediaRecorder
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: async () => ({ getTracks: () => [] }) },
})

import { globalRecorder } from '@/lib/global-recorder'
import {
  clearOwnTakes,
  getRecoverableTake,
  listOwnTakes,
  listOwnStoppedUnsecuredTakeIds,
  listPendingDiscardTakes,
  loadTakeBlob,
  markTakeFinalized,
  markTakeSecureError,
  markTakeStopPending,
  markTakeTailIncomplete,
  readTakeOutcome,
  readTakeSecureMeta,
  stampDiscardPending,
  stampTakeDuration,
  stampTakeOutcome,
  stampTakeSession,
  TERMINAL_SECURE_ERRORS,
  writeTakeHeartbeat,
} from '@/lib/karute/take-store'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'
import { deriveInboxRows, type InboxLocalTake } from '@/lib/recordings/inbox'
import {
  getRecordingPipelinePort,
  setRecordingPipelinePort,
  type MintTakeUrlPortResult,
  type RecordingPipelinePort,
} from '@/lib/ports/recording-port'
import { secureTake } from '@/lib/recording/secure-take'
import { extFromMime, normalizeAudioMime } from '@/lib/recording/key-grammar'

// ── The secure-at-stop doors (capture pipeline PR3) ─────────────────────────
// onstop now reaches the port, so EVERY test in this file would otherwise fire
// the real web port's dynamic server-action import. One fake stands in for the
// whole file; the last describe drives it.
const order: string[] = []
const putBodies: Blob[] = []
/** The row the SESSION DOOR mints for a take that has none — the id the device
 *  has never seen, so "the minted id is stamped" is provable rather than an
 *  echo. Fix round 6: the door that answers it is the recorder's own
 *  start-mint door, reached through the port; the upload mint stopped minting
 *  rows entirely (PR2 fix round 7). */
const MINTED_SESSION = 'rs-minted-by-the-session-door'
/** What the SERVER would compose for this take (mint-take-url.ts →
 *  composeTakeKey): the codec parameters are stripped, and BOTH the extension
 *  and the content type come off the same closed map — so the recorder's
 *  `audio/webm;codecs=opus` becomes an `audio/webm` object under a `.webm`
 *  name, which is the mislabelling bug dying.
 *
 *  The reply also names the row the key is now BOUND to (PR2 fix round 4): the
 *  caller's own session when it named one, and a row the mint created when it
 *  did not — the two branches reserveTakeForRecorder actually has. */
function mintedFor(takeId: string, mimeType: string, recordingSessionId: string) {
  const contentType = normalizeAudioMime(mimeType) ?? 'audio/webm'
  const ext = extFromMime(contentType) ?? 'webm'
  return {
    path: `app_biz-1_${takeId}.${ext}`,
    url: `https://proj.supabase.co/upload/app_biz-1_${takeId}.${ext}?token=up`,
    contentType,
    recordingSessionId,
  }
}
/** The session door — the row minter, and the ONLY one (fix round 6). The
 *  recorder's start-mint knocks on it, and so does a drain whose take never got
 *  an id. */
const startSession = jest.fn(
  async (_input: {
    customerId: string | null
    appointmentId: string | null
  }): Promise<{ id: string } | null> => {
    order.push('session')
    return { id: MINTED_SESSION }
  },
)
/** Composes the key the SERVER would compose (same closed MIME map), so the
 *  container the client sends is provable from the name that comes back.
 *
 *  REFUSES A NAMELESS TAKE, exactly as the real door does since PR2 fix round 7:
 *  a client-named mint with no recordingSessionId is `bad_input`, because row
 *  minting has one home and it is not this one. That refusal is what makes the
 *  session call provable — skip it and the leg dies here. */
const mintTakeUrl = jest.fn(
  async (
    takeId: string,
    mimeType: string,
    recordingSessionId: string | null,
  ): Promise<MintTakeUrlPortResult> => {
    order.push('mint')
    if (!recordingSessionId) return { error: 'bad_input' }
    return mintedFor(takeId, mimeType, recordingSessionId)
  },
)
/** The door's own reply shape: it finalizes AGAINST the session the client
 *  named, and MINTS one only when the client named none (a failed start-mint) —
 *  so echoing the input back is what makes "the minted id is stamped" provable
 *  rather than a constant this file wrote. */
const finalizeTake = jest.fn(async (input: unknown) => {
  order.push('finalize')
  const named = (input as { recordingSessionId?: string | null } | undefined)
    ?.recordingSessionId
  return { ok: true as const, recordingSessionId: named ?? 'rs-1' }
})
const putMock = jest.fn(async (_url: string, init?: RequestInit) => {
  order.push('put')
  putBodies.push(init?.body as Blob)
  return { ok: true, status: 200 } as unknown as Response
})
setRecordingPipelinePort({
  ...getRecordingPipelinePort(),
  startSession,
  mintTakeUrl,
  finalizeTake,
} as RecordingPipelinePort)
global.fetch = putMock as unknown as typeof fetch

const TARGET = {
  customerId: 'cust-1',
  customerName: 'C',
  karuteNumber: null,
  appointmentId: 'appt-1',
}

const takes = () => fakeDb.stores.get('takes')!.data
const segments = () => fakeDb.stores.get('segments')!.data

const drain = async (n = 25) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

function pushChunk(text: string) {
  FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob([text]) })
}

async function startAndSettle() {
  await globalRecorder.start({ target: TARGET })
  await drain() // createTake (openDb → currentUserId → put)
  return globalRecorder.takeId!
}

/** Recovery skips takes flushed within the 20 s "possibly live in another
 *  tab" grace — tests that expect an offer must first let the take go quiet.
 *  (Advancing while a recorder is still armed only triggers empty no-op
 *  flushes, which do NOT bump updatedAt.) */
const passGrace = () => jest.advanceTimersByTimeAsync(20_000)

/** Put this runtime inside the Capacitor shell, the way src/lib/platform.ts
 *  detects it (the runtime injects `window.Capacitor`). Feature-based, so this
 *  IS the production check — there is no second one to mock. Cleared in
 *  beforeEach, so every other test in this file runs on the WEB. */
const asNativeShell = () => {
  ;(window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
  }
}

/** THE BEAT, read where it lives since fix round 15: the take's own meta row,
 *  the same store the drain reads. Nothing goes near localStorage. */
const heartbeatOf = (takeId: string) =>
  (takes().get(JSON.stringify(takeId)) as { heartbeatAt?: number } | undefined)
    ?.heartbeatAt

/** ANOTHER TAB is holding this take — one beat from the recorder next door
 *  (fix round 14). It calls the exported writer because that is literally what
 *  that recorder's flush tick calls; this runtime's singleton has let the take
 *  go, and `isActive` cannot see across the gap. */
const beatFromAnotherTab = (takeId: string) => writeTakeHeartbeat(takeId)

beforeEach(async () => {
  // The IDB shim resolves via queueMicrotask — modern fake timers fake it by
  // default, which would deadlock every store call.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
  jest.clearAllMocks()
  order.length = 0
  putBodies.length = 0
  // clearAllMocks keeps IMPLEMENTATIONS, so every mock a test rewrites is put
  // back here — the start-mint door included since fix round 9, whose step-back
  // case needs an implementation of its own.
  mockStartRecordingSession.mockImplementation(async () => null)
  startSession.mockImplementation(async () => {
    order.push('session')
    return { id: MINTED_SESSION }
  })
  mintTakeUrl.mockImplementation(
    async (takeId: string, mimeType: string, recordingSessionId: string | null) => {
      order.push('mint')
      if (!recordingSessionId) return { error: 'bad_input' }
      return mintedFor(takeId, mimeType, recordingSessionId)
    },
  )
  finalizeTake.mockImplementation(async (input: unknown) => {
    order.push('finalize')
    const named = (input as { recordingSessionId?: string | null } | undefined)
      ?.recordingSessionId
    return { ok: true as const, recordingSessionId: named ?? 'rs-1' }
  })
  putMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    order.push('put')
    putBodies.push(init?.body as Blob)
    return { ok: true, status: 200 } as unknown as Response
  })
  mockUid = 'staff-A'
  failWrites = false
  slowSegmentWrites = false
  releaseHungWrites()
  failNextDurationStamps = 0
  failNextTailMarks = 0
  failNextSegmentWrites = 0
  emptyTailChunk = false
  stampWrites.length = 0
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
  localStorage.clear()
  globalRecorder.discard()
  await drain()
  fakeDb.stores.get('takes')?.data.clear()
  fakeDb.stores.get('segments')?.data.clear()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('take durability — capture persistence', () => {
  it('flushes segments to IndexedDB during capture (~5 s cadence, not per chunk)', async () => {
    const takeId = await startAndSettle()
    expect(takes().size).toBe(1)

    pushChunk('aaa')
    pushChunk('bbb')
    expect(segments().size).toBe(0) // nothing per-chunk

    await jest.advanceTimersByTimeAsync(5_000)
    expect(segments().size).toBe(1)

    pushChunk('cc')
    await jest.advanceTimersByTimeAsync(5_000)
    expect(segments().size).toBe(2)

    const meta = takes().get(JSON.stringify(takeId)) as {
      ownerUid: string
      lastSeq: number
    }
    expect(meta.ownerUid).toBe('staff-A')
    expect(meta.lastSeq).toBe(1)
  })

  it('take survives a simulated reload: a fresh store read reassembles the full audio, tail included', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.stop() // emits final 'TAIL' chunk, then onstop tail-flush
    await drain()
    await passGrace()

    // Simulated reload: no recorder state consulted — pure store reads.
    const offered = await getRecoverableTake([])
    expect(offered?.takeId).toBe(takeId)
    expect(offered?.target).toEqual(TARGET)
    const blob = await loadTakeBlob(takeId)
    expect(blob?.size).toBe('aaa'.length + 'TAIL'.length)
  })

  it('a take with no flushed segments (crash before first flush) is never offered', async () => {
    await startAndSettle()
    pushChunk('aaa') // captured but not yet flushed
    globalRecorder.discard({ keepTake: true }) // leave the meta row behind
    await drain()
    expect(await getRecoverableTake([])).toBeNull()
  })
})

describe('take durability — owner gate (store layer)', () => {
  it('offers a take ONLY to the uid that recorded it; signed-out gets nothing', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    await passGrace()

    mockUid = 'staff-B'
    expect(await getRecoverableTake([])).toBeNull()
    mockUid = null
    expect(await getRecoverableTake([])).toBeNull()
    mockUid = 'staff-A'
    expect((await getRecoverableTake([]))?.takeId).toBe(takeId)
  })

  it('loadTakeBlob is its own owner gate: a non-owner (or signed-out) uid gets null audio', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    mockUid = 'staff-B'
    expect(await loadTakeBlob(takeId)).toBeNull()
    mockUid = null
    expect(await loadTakeBlob(takeId)).toBeNull()
    mockUid = 'staff-A'
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
  })

  // The gate lives in readOwnTakeMeta, which these two are the ONLY callers of.
  // Called directly on purpose: routing through loadTakeBlob (which carries its
  // own, separate gate) would prove loadTakeBlob's gate and nothing else — so
  // dropping the one here would still read green.
  it('readTakeSecureMeta and readTakeOutcome carry the owner gate THEMSELVES', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    await stampTakeOutcome(takeId, { status: 'no_deal' })
    await drain()

    mockUid = 'staff-B'
    expect(await readTakeSecureMeta(takeId)).toBeNull()
    expect(await readTakeOutcome(takeId)).toBeNull()
    mockUid = null
    expect(await readTakeSecureMeta(takeId)).toBeNull()
    expect(await readTakeOutcome(takeId)).toBeNull()

    // …and the rightful owner still gets both, so the null above is the gate
    // and not an unreadable row.
    mockUid = 'staff-A'
    expect((await readTakeSecureMeta(takeId))?.mimeType).toBe('audio/webm;codecs=opus')
    expect((await readTakeOutcome(takeId))?.outcome).toEqual({ status: 'no_deal' })
  })

  // The WRITES carry the same gate (fix round 7). A shared salon device signs
  // one staffer out and the next one in, and these stamps take a take id from
  // wherever their caller got it — a stale drain, a late resolution — so
  // without the gate one staffer's device could scribble a duration, a failure
  // code, or a finalized stamp onto a colleague's row.
  it('the STAMPS are owner-gated too: nobody else writes on this take', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    await stampTakeDuration(takeId, 5_000)

    mockUid = 'staff-B'
    await stampTakeDuration(takeId, 999)
    await markTakeSecureError(takeId, 'forbidden')
    await markTakeFinalized(takeId)
    // …the session stamp included (fix round 8): it was the one write here that
    // never carried the gate, and it is the one that decides which core row a
    // take's audio finalizes against — pointed at a colleague's mint, the audio
    // lands on one row and the karute is read beside another.
    await stampTakeSession(takeId, 'sess-someone-else')
    mockUid = null
    await markTakeSecureError(takeId, 'network')
    await stampTakeSession(takeId, 'sess-nobody')

    mockUid = 'staff-A'
    const meta = takes().get(JSON.stringify(takeId)) as {
      durationMs?: number
      secureError?: string
      finalizedAt?: number
      recordingSessionId?: string | null
    }
    // The owner's own measurement, untouched — and no code, no false 'secured'.
    expect(meta.durationMs).toBe(5_000)
    expect(meta.secureError).toBeUndefined()
    expect(meta.finalizedAt).toBeUndefined()
    expect(meta.recordingSessionId).toBeNull()

    // …and the gate is what refused, not an unwritable row: the owner's own
    // stamp still lands.
    await stampTakeSession(takeId, 'sess-mine')
    expect(
      (takes().get(JSON.stringify(takeId)) as { recordingSessionId?: string | null })
        .recordingSessionId,
    ).toBe('sess-mine')
  })

  it('persists nothing at all when no user is signed in (fail-closed)', async () => {
    mockUid = null
    await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    expect(takes().size).toBe(0)
    expect(segments().size).toBe(0)
  })

  it('a freshly-flushed take (possibly live in another tab) is not offered until the grace passes', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    // Flushed 0 s ago → inside the 20 s activity grace → withheld.
    expect(await getRecoverableTake([])).toBeNull()
    await passGrace()
    expect((await getRecoverableTake([]))?.takeId).toBe(takeId)
  })

  it('excludeTakeIds hides the live take so an in-progress session is not its own recovery', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    await passGrace()
    expect(await getRecoverableTake([takeId])).toBeNull()
    expect((await getRecoverableTake([]))?.takeId).toBe(takeId)
  })
})

describe('take durability — deletion lifecycle', () => {
  it('discard() deletes the persisted take; keepTake (pipeline handoff) retains it', async () => {
    await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard()
    await drain()
    expect(takes().size).toBe(0)
    expect(segments().size).toBe(0)

    const takeId2 = await startAndSettle()
    pushChunk('bbb')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    await passGrace()
    expect(takes().size).toBe(1)
    expect((await getRecoverableTake([]))?.takeId).toBe(takeId2)
  })

  it('logout wipe (clearOwnTakes) deletes ONLY the signing-out user\'s takes — another staff member\'s crash-recovery audio survives', async () => {
    // Staff B has an orphaned crash take on the shared device.
    const takeIdB = await startAndSettle()
    pushChunk('bbb')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    const keyB = JSON.stringify(takeIdB)
    takes().set(keyB, { ...takes().get(keyB)!, ownerUid: 'staff-B' })

    // Staff A records, then logs out.
    await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    await clearOwnTakes()
    await drain()

    // A's takes gone; B's take (and its audio) untouched.
    expect(takes().size).toBe(1)
    expect((takes().get(keyB) as { ownerUid: string }).ownerUid).toBe('staff-B')
    mockUid = 'staff-B'
    await passGrace()
    expect((await getRecoverableTake([]))?.takeId).toBe(takeIdB)
  })

  it('wipeSessionVault({uid}) deletes that uid\'s takes end-to-end through the REAL chain, with the session store already nulled (T4, F3 real chain)', async () => {
    await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    expect(takes().size).toBe(1)

    // Simulates thin/auth/session.ts's SIGNED_OUT listener AFTER
    // setSessionState has already nulled the session — currentUserId()
    // (draft.ts, mocked above via mockUid) would resolve null from here on;
    // only the explicit uid, captured before the null, can still target the
    // right rows. wipeSessionVault itself is UNMOCKED — this exercises its
    // real dynamic-import composition (global-recorder + global-pipeline +
    // draft + take-store), not a fake of the uid-threading seam.
    mockUid = null
    await wipeSessionVault({ uid: 'staff-A' })
    await drain()
    expect(takes().size).toBe(0)
  })

  it('packet 13: the uid captured pre-purge by client-session.ts\'s signOut() (session.user.id) still threads through the REAL chain, same as T4', async () => {
    await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    expect(takes().size).toBe(1)

    // createMobileAuth.signOut() now captures the outgoing uid from the live
    // session (session.user.id) BEFORE purging anything, then threads it
    // into purgeLocalCaches(uid) — which thin/auth/session.ts wires to
    // wipeSessionVault({ uid }), the EXACT call below. wipeSessionVault is
    // UNMOCKED, same real chain as T4 — this pins that the packet-13 capture
    // idiom still lands on the real rows, not just the mocked seam covered
    // in mobile-client-session.test.ts.
    const capturedSession = { user: { id: 'staff-A' } }
    mockUid = null // the session/storage this uid was read from is already gone
    await wipeSessionVault({ uid: capturedSession.user.id })
    await drain()
    expect(takes().size).toBe(0)
  })

  it('clearOwnTakes(explicitUid) deletes that uid\'s takes even when the session-derived uid would resolve null (F3: server-driven sign-out ordering)', async () => {
    await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    expect(takes().size).toBe(1)

    // Simulates thin/auth/session.ts's SIGNED_OUT listener: by the time the
    // wipe runs, the session store (and therefore currentUserId()) already
    // resolves null — the explicit uid, captured BEFORE the store nulled,
    // is the only thing that still targets the right rows.
    mockUid = null
    await clearOwnTakes('staff-A')
    await drain()
    expect(takes().size).toBe(0)
  })

  // R2 (⚖ Liam 2026-08-25): the window is 7 DAYS, not 24 h — a Friday-evening
  // crash has to still be recoverable on Saturday's shift, and the 録音履歴
  // inbox lists 復元可能 takes over the same 7 days.
  it('a take past yesterday is still recoverable (7-day TTL)', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    const key = JSON.stringify(takeId)
    const meta = takes().get(key)!
    takes().set(key, {
      ...meta,
      startedAt: Date.now() - 25 * 60 * 60 * 1000,
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
    })
    expect(await getRecoverableTake([])).not.toBeNull()
    await drain()
    expect(takes().size).toBe(1)
  })

  // FX-6(a): the prune is `> TAKE_TTL_MS`, so a take aged EXACTLY the TTL is
  // still offered. Pinned because the 録音履歴 window uses the same convention
  // (a row at exactly the floor is kept) — the two must not drift apart.
  it('a take aged exactly TAKE_TTL_MS is STILL recoverable (> , not >=)', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    const key = JSON.stringify(takeId)
    const meta = takes().get(key)!
    const exactly = Date.now() - 7 * 24 * 60 * 60 * 1000
    takes().set(key, { ...meta, startedAt: exactly, updatedAt: exactly })
    expect(await getRecoverableTake([])).not.toBeNull()
    await drain()
    expect(takes().size).toBe(1)
  })

  it('expired takes (7-day TTL) are dropped and deleted in passing', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    // Age the take past the TTL directly in the store.
    const key = JSON.stringify(takeId)
    const meta = takes().get(key)!
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000
    takes().set(key, { ...meta, startedAt: past, updatedAt: past })
    expect(await getRecoverableTake([])).toBeNull()
    await drain()
    expect(takes().size).toBe(0)
    expect(segments().size).toBe(0)
  })
})

describe('take durability — the invariant: persistence NEVER touches capture', () => {
  it('IndexedDB write failures leave recording fully intact (fail-open to memory-only)', async () => {
    failWrites = true
    await startAndSettle()
    expect(globalRecorder.state).toBe('recording')

    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    pushChunk('bbb')
    await jest.advanceTimersByTimeAsync(5_000)
    expect(globalRecorder.state).toBe('recording')
    expect(segments().size).toBe(0)

    globalRecorder.stop()
    await drain()
    expect(globalRecorder.state).toBe('recorded')
    // The in-memory result has every byte, exactly as before this feature.
    expect(globalRecorder.result?.blob.size).toBe(
      'aaa'.length + 'bbb'.length + 'TAIL'.length,
    )
  })
})

describe('take durability — recovered-save dedupe', () => {
  it('the recovered take carries the server-minted recordingSessionId', async () => {
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'sess-1' })
    await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.stop()
    await drain()
    await passGrace()

    const offered = await getRecoverableTake([])
    expect(offered?.recordingSessionId).toBe('sess-1')
  })

  // ── ⚖ THE ROW IS BORN RESERVED (fix round 8) ─────────────────────────────
  // The start-mint used to name only the customer, so every session began life
  // pointing at no audio and the mint at stop had to bind it afterwards — the
  // window two client-named mints could race in (PR2 fix round 10 closes it at
  // the door). The recorder knows BOTH facts before the mic is even live, so it
  // names them here and the door composes the key at create.
  it('the start-mint names the take it is for AND the container it will record', async () => {
    const takeId = await startAndSettle()

    expect(mockStartRecordingSession).toHaveBeenCalledWith({
      customerId: TARGET.customerId,
      appointmentId: TARGET.appointmentId,
      // …the very take this start went on to create — not a fresh id, or the
      // row would be reserved for audio that will never be uploaded.
      takeId,
      // …and the container the take is actually persisted with, so the key the
      // door composes and the one secureTake asks the mint for cannot differ.
      mimeType: 'audio/webm;codecs=opus',
    })
    expect(
      (takes().get(JSON.stringify(takeId)) as { mimeType?: string }).mimeType,
    ).toBe('audio/webm;codecs=opus')
  })

  // ── ⚖ ONE BOUND ATTEMPT PER TAKE (fix round 9) ───────────────────────────
  // A create that carries a key is not blind-retry-safe — PR2 fix round 10's
  // own named ceiling: a reply lost after a SUCCESSFUL create leaves us with no
  // id, and the same take composes the same key, which core's unique index
  // refuses from then on. So a reserved create that fails for ANY reason steps
  // back to the argument-less one instead of trying the same key again.
  const rowOf = (takeId: string) =>
    takes().get(JSON.stringify(takeId)) as {
      recordingSessionId?: string | null
      startBoundAttempted?: boolean
    }

  it('a start-mint whose bound create fails steps back to the argument-less one, once', async () => {
    mockStartRecordingSession.mockImplementation(async (input) =>
      (input as { mimeType?: string }).mimeType ? null : { id: 'sess-unbound' },
    )

    const takeId = await startAndSettle()
    await drain()

    expect(mockStartRecordingSession).toHaveBeenCalledTimes(2)
    expect(mockStartRecordingSession).toHaveBeenLastCalledWith({
      customerId: TARGET.customerId,
      appointmentId: TARGET.appointmentId,
    })
    // …and THAT row is the take's: the karute saves against it, and the mint
    // reserves this take's key on it through the legacy update path.
    expect(globalRecorder.recordingSessionId).toBe('sess-unbound')
    expect(rowOf(takeId).recordingSessionId).toBe('sess-unbound')
    // The take is BORN remembering the attempt — the only thing that survives a
    // reload, and what stops every later route re-sending the same bound create.
    expect(rowOf(takeId).startBoundAttempted).toBe(true)
  })

  it('the review-path retry never offers the pair for a take that already sent one', async () => {
    const takeId = await startAndSettle() // its own start-mint sent the pair, and failed
    await drain()
    mockStartRecordingSession.mockClear()
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'sess-retry' })

    await expect(globalRecorder.retryRecordingSessionMint({ takeId })).resolves.toBe(
      'sess-retry',
    )
    expect(mockStartRecordingSession).toHaveBeenCalledTimes(1)
    expect(mockStartRecordingSession).toHaveBeenCalledWith({
      customerId: TARGET.customerId,
      appointmentId: TARGET.appointmentId,
    })
  })
})

// ── PR-B1 D6 (R-B3): the 結果 answer survives the crash ────────────────────
//
// Before this, the answer rode ONLY the in-memory pipeline context, so a crash
// between the money writes (durable server-side the instant they land) and the
// karute save lost it — and recovery re-asked, offering a SECOND burn for one
// visit. stampTakeOutcome writes it onto the take at answer time; recovery
// reads it back and never asks again.
describe('take durability — outcome survives the crash (R-B3)', () => {
  async function quietTake(): Promise<string> {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.stop()
    await drain()
    await passGrace()
    return takeId
  }

  it('round-trips a stamped outcome to the recovery offer', async () => {
    const takeId = await quietTake()
    // No answer yet → nothing to restore, and the app must NEVER invent one.
    expect((await getRecoverableTake([]))?.outcome).toBeUndefined()

    await stampTakeOutcome(takeId, { status: 'success', reason: null, isFirstVisit: true })
    await drain()

    const offered = await getRecoverableTake([])
    expect(offered?.takeId).toBe(takeId)
    expect(offered?.outcome).toEqual({ status: 'success', reason: null, isFirstVisit: true })
    // B-5: an omitted field is left ALONE, not written as false — a later
    // partial stamp must never blank an answer already stored.
    expect(offered?.outcomeSkipped).toBeUndefined()
  })

  it('B-5: a later partial stamp never blanks the stored answer', async () => {
    const takeId = await quietTake()
    await stampTakeOutcome(takeId, { status: 'success' }, false)
    await drain()
    // Re-stamp with ONLY the skip flag — the answer must survive.
    await stampTakeOutcome(takeId, undefined, true)
    await drain()

    const offered = await getRecoverableTake([])
    expect(offered?.outcome).toEqual({ status: 'success' })
    expect(offered?.outcomeSkipped).toBe(true)
  })

  it('round-trips a deliberate SKIP (mid-pack auto flow) distinctly from an answer', async () => {
    const takeId = await quietTake()
    await stampTakeOutcome(takeId, undefined, true)
    await drain()

    const offered = await getRecoverableTake([])
    expect(offered?.outcome).toBeUndefined()
    expect(offered?.outcomeSkipped).toBe(true)
  })

  it('never resurrects an outcome for a DIFFERENT take, and no-ops on a gone one', async () => {
    const takeId = await quietTake()
    await stampTakeOutcome('take-that-never-existed', { status: 'no_deal' })
    await drain()
    expect((await getRecoverableTake([]))?.outcome).toBeUndefined()
    // The real take is untouched and still offerable.
    expect((await getRecoverableTake([]))?.takeId).toBe(takeId)
  })

  it('stays best-effort: a failing write never throws at the caller', async () => {
    const takeId = await quietTake()
    failWrites = true
    // Through patchTakeMeta since fix round 14 (AA3, for its owner gate), so a
    // thrown write now costs the two shared backoffs before it gives up.
    const stamped = stampTakeOutcome(takeId, { status: 'pending' })
    await jest.advanceTimersByTimeAsync(200)
    await expect(stamped).resolves.toBeUndefined()
    failWrites = false
  })
})

// ── A2-2 — the discard-transcript register ──────────────────────────────────
// A take that has ALREADY been discarded with a written reason is kept only
// long enough for its words to be transcribed onto the discard record. For as
// long as it is kept it must be INVISIBLE to every recovery surface: re-offering
// it would hand back the exact recording the staff member deliberately threw
// away (⚖ 8/20 doctrine R2). One filter in listOwnTakes covers them all — the
// banner, the 録音履歴 fold and the fold's own 保存する re-read.

describe('take durability — the discard-transcript register (A2-2)', () => {
  const PENDING = {
    recordingSessionId: 'sess-9',
    durationSeconds: 62,
    locale: 'ja',
    stampedAt: 1_756_000_000_000,
  }

  async function recoverableTake() {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    await passGrace()
    return takeId
  }

  it('a registered take is offered NOWHERE — not the banner, not the inbox fold', async () => {
    const takeId = await recoverableTake()
    // Both directions: offered before the stamp…
    expect((await getRecoverableTake([]))?.takeId).toBe(takeId)
    expect((await listOwnTakes()).map((t) => t.takeId)).toEqual([takeId])

    expect(await stampDiscardPending(takeId, PENDING)).toBe(true)

    // …and offered by nothing after it.
    expect(await getRecoverableTake([])).toBeNull()
    expect(await listOwnTakes()).toEqual([])
    // The AUDIO is still readable — that is the whole point of keeping it.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
  })

  it('the sweep list carries the discard back verbatim, and is owner-gated like every other read', async () => {
    const takeId = await recoverableTake()
    await stampDiscardPending(takeId, PENDING)

    expect(await listPendingDiscardTakes()).toEqual([
      { takeId, discardPending: PENDING },
    ])
    // Another staff member on the same shared device sees nothing of it — and
    // it is left untouched for its rightful owner's own sweep.
    mockUid = 'staff-B'
    expect(await listPendingDiscardTakes()).toEqual([])
    mockUid = null
    expect(await listPendingDiscardTakes()).toEqual([])
    mockUid = 'staff-A'
    expect(await listPendingDiscardTakes()).toHaveLength(1)
  })

  it('a registered take still expires on the normal TTL — a never-collected discard cannot linger', async () => {
    const takeId = await recoverableTake()
    await stampDiscardPending(takeId, PENDING)
    expect(takes().size).toBe(1)

    await jest.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000 + 1)
    await listOwnTakes() // the read-time prune
    await drain()
    expect(takes().size).toBe(0)
  })

  it('stamping a take that is already gone reports false — the caller must not hold audio back', async () => {
    expect(await stampDiscardPending('take-that-never-existed', PENDING)).toBe(false)
  })
})

// ── Capture pipeline PR3 — the take is SECURED at stop ──────────────────────
// Until now audio left the device only after 録音を使用 (durability trace §3).
// What these pin is the new promise: the whole take goes to its finalized key
// the moment recording stops, the outcome lands on the take meta, and NOTHING
// about it can make the UI wait or throw.
describe('secure at stop', () => {
  const port = () => getRecordingPipelinePort()

  /** A take with one flushed segment, recorder stopped and settled. */
  async function stoppedTake(): Promise<string> {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.stop()
    await drain(200)
    return takeId
  }

  /** A take with a flushed segment whose recorder was never STOPPED — the shape
   *  every retry-path case needs (no onstop, so nothing has been secured). */
  async function keptTake(): Promise<string> {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    return takeId
  }

  /** The same take after a recorder STOPPED it — the shape the mount drain
   *  exists for (a stop whose upload died). `keptTake` deliberately leaves no
   *  stop stamp, because "never stopped" is now its own case, so the stamp
   *  onstop would have written is added here instead. */
  async function stoppedOwedTake(): Promise<string> {
    const takeId = await keptTake()
    await stampTakeDuration(takeId, 5_000)
    return takeId
  }

  const metaOf = (takeId: string) =>
    takes().get(JSON.stringify(takeId)) as {
      finalizedAt?: number
      secureError?: string
      mimeType?: string
      recordingSessionId?: string | null
      durationMs?: number
      startBoundAttempted?: boolean
      tailIncomplete?: boolean
      stopPendingAt?: number
      lastSeq: number
      startedAt: number
      updatedAt: number
    }

  const lastFinalized = () =>
    finalizeTake.mock.calls.at(-1)![0] as { durationSeconds: number }

  it('onstop: `recorded` renders synchronously, the tail flush is awaited, THEN the take is uploaded', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    // The tail segment now takes a TIMER to land, the way a real multi-MB
    // IndexedDB write does. That is what makes "awaited" mean something: an
    // unawaited secureTake has all the microtasks it needs to read the take
    // back and PUT it short.
    slowSegmentWrites = true
    globalRecorder.stop()
    // The whole point of item 2: the card is already on screen and NOTHING has
    // touched the network yet.
    expect(globalRecorder.state).toBe('recorded')
    expect(order).toEqual([])

    // Every microtask in the queue, and the flush is STILL pending — so the
    // upload must be too. (Un-await the flush and the whole leg runs here.)
    await drain(200)
    expect(order).toEqual([])

    await jest.advanceTimersByTimeAsync(0)
    await drain(200)
    // This take's start-mint failed, so the row is minted HERE, first (fix
    // round 6) — the upload mint refuses a take that names none.
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    // The tail flush landed BEFORE the read-back: the uploaded object carries
    // the final 'TAIL' chunk, not just the 5 s segment.
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(putBodies[0].size).toBe('aaa'.length + 'TAIL'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ⚖ THE NEXT RECORDING IS BORN ON ITS OWN ROW (fix round 12, P1).
  //
  // start() fires its mint BEFORE the mic, and only names its take once the mic
  // is live — so for that whole window the take on the singleton is the
  // PREVIOUS recording's. The mint's resolution read `this.takeId` as "my take"
  // and, when the store refused the stamp (A already had a row), ADOPTED what
  // was there. B was then created on A's row: B's own upload mint reserved
  // against a row already bound to A's key, the door answered
  // `reserved_elsewhere` — TERMINAL — and B's audio never left the phone, with
  // B's karute pointing at A's session.
  //
  // The mic is held on a timer here so the mint definitively answers inside
  // that window; a microtask race would prove nothing.
  async function slowMic(): Promise<() => void> {
    const real = navigator.mediaDevices.getUserMedia
    ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = () =>
      new Promise((resolve) => setTimeout(() => resolve({ getTracks: () => [] }), 50))
    return () => {
      ;(navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = real
    }
  }

  it("a start-mint that answers before the mic stamps nothing on the STOPPED take — B carries B's row", async () => {
    // A: a normal stop, secured, its row on its meta. Still HELD — 使用/破棄
    // has not happened yet, which is exactly when the next customer is started.
    mockStartRecordingSession.mockImplementationOnce(async () => ({ id: 'session-A' }))
    const takeA = await stoppedTake()
    expect(metaOf(takeA).recordingSessionId).toBe('session-A')
    expect(metaOf(takeA).finalizedAt).toEqual(expect.any(Number))

    const restore = await slowMic()
    try {
      mockStartRecordingSession.mockImplementationOnce(async () => ({ id: 'session-B' }))
      const started = globalRecorder.start({ target: TARGET })
      await drain(50) // the mint lands; the mic is still pending
      await jest.advanceTimersByTimeAsync(50) // …now B exists
      await started
      await drain(50)
    } finally {
      restore()
    }

    const takeB = globalRecorder.takeId!
    expect(takeB).not.toBe(takeA)
    expect(metaOf(takeB).recordingSessionId).toBe('session-B')
    // A keeps everything: its row, its finalized stamp, its audio.
    expect(metaOf(takeA).recordingSessionId).toBe('session-A')
    expect(metaOf(takeA).finalizedAt).toEqual(expect.any(Number))
  })

  // …and the guard closes the moment start() names its take, or the ordinary
  // reply — the one that lands after the mic — would stamp nothing at all and
  // every second recording would save unlinked.
  it('a start-mint that answers AFTER the mic still stamps its own take (control)', async () => {
    mockStartRecordingSession.mockImplementationOnce(async () => ({ id: 'session-A' }))
    const takeA = await stoppedTake()

    let answer: (v: { id: string }) => void = () => {}
    mockStartRecordingSession.mockImplementationOnce(
      () => new Promise<{ id: string }>((res) => (answer = res)),
    )
    const takeB = await startAndSettle()
    expect(takeB).not.toBe(takeA)

    answer({ id: 'session-B' })
    await drain(50)

    expect(metaOf(takeB).recordingSessionId).toBe('session-B')
    expect(globalRecorder.recordingSessionId).toBe('session-B')
    expect(metaOf(takeA).recordingSessionId).toBe('session-A')
  })

  // ⚖ A SKIPPED TAIL SEALS NOTHING (fix round 7, P1) — AND THE TAIL IS NO
  // LONGER SKIPPED (fix round 20). The tail flush is queued at stop; start()
  // used to empty `chunks` SYNCHRONOUSLY under it and take a new id, so the
  // queued task found the array reset and answered "skipped" for a take whose
  // last chunks it never wrote. Round 7 answered that by refusing to stamp or
  // seal — correct then, and the whole recording still sat on the device with
  // 「途中で終わっています」 against its name.
  //
  // The state a queued task reads is the TAKE'S now, captured by reference at
  // queue time, and start() replaces the object rather than resetting fields
  // under it. So the old take writes its own tail from its own array, the stamp
  // rides that write (round 18, AG3), and the recording goes up WHOLE while the
  // next customer is already recording. This is the test round 7 wrote, on the
  // truth that replaced its expectation.
  it('the next customer starts before the tail lands: the OLD take still writes its own tail', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // one segment on disk
    pushChunk('bbb') // …and this one is still memory-only

    slowSegmentWrites = true
    globalRecorder.stop()
    // The staffer is already recording the next customer — BEFORE the queued
    // tail task has run at all, which is one write EARLIER than the window
    // round 18's own case lands in.
    void globalRecorder.start({ target: TARGET })
    await drain(200)
    const next = globalRecorder.takeId!
    expect(next).not.toBe(takeId)

    await jest.advanceTimersByTimeAsync(0)
    await drain(400)

    const whole = 'aaa'.length + 'bbb'.length + 'TAIL'.length
    // Every byte the recorder captured is on the OLD row, stamped by the write
    // that landed it, wearing neither mark — and it went up whole.
    expect((await loadTakeBlob(takeId))?.size).toBe(whole)
    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
    expect(metaOf(takeId).stopPendingAt).toBeUndefined()
    expect(stampWrites).toEqual([1]) // the tail's own write carried it
    expect(putBodies.at(-1)!.size).toBe(whole)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))

    // …and the NEW take is untouched: its own object starts at seq 0, so the
    // old take's counters were never spent on it.
    slowSegmentWrites = false
    pushChunk('ccc')
    await jest.advanceTimersByTimeAsync(5_000)
    await drain(200)
    expect(metaOf(next).lastSeq).toBe(0)
    expect((await loadTakeBlob(next))?.size).toBe('ccc'.length)
  })

  // The same window, the other way out of it: the stop is handed to the
  // pipeline (or a reasoned discard), which KEEPS the audio and nulls the
  // recorder's take id. Since fix round 20 the queued tail does not care what
  // the recorder is holding — it holds the take's own array and the take's own
  // id, and writes them.
  it('a stop handed straight to the pipeline (keepTake) still lands its own tail', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    pushChunk('bbb')

    slowSegmentWrites = true
    globalRecorder.stop()
    globalRecorder.discard({ keepTake: true })
    await drain(200)
    await jest.advanceTimersByTimeAsync(0)
    await drain(400)

    expect((await loadTakeBlob(takeId))?.size).toBe(
      'aaa'.length + 'bbb'.length + 'TAIL'.length,
    )
    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
  })

  it('finalize is told the take id, container, byte length and session — never a path', async () => {
    const takeId = await stoppedTake()
    expect(finalizeTake).toHaveBeenCalledWith({
      takeId,
      // The recorder's OWN negotiated container, codec parameters and all —
      // the door normalizes (composeTakeKey), the client never guesses.
      mimeType: 'audio/webm;codecs=opus',
      durationSeconds: expect.any(Number),
      byteLength: 'aaa'.length + 'TAIL'.length,
      // REQUIRED now, and never null: this start-mint failed, so the row is the
      // one the SESSION DOOR minted a moment earlier (fix round 6).
      recordingSessionId: MINTED_SESSION,
    })
    // The PUT carries the SERVER's content type for the key it composed —
    // normalized, not the client's string.
    expect(putMock.mock.calls[0][1]?.headers).toEqual({ 'content-type': 'audio/webm' })
    expect(putMock.mock.calls[0][0]).toContain(`app_biz-1_${takeId}.webm`)
  })

  it('a refused PUT never finalizes — the take keeps its audio, un-finalized, with the reason', async () => {
    putMock.mockImplementation(async () => {
      order.push('put')
      return { ok: false, status: 503 } as unknown as Response
    })
    const takeId = await stoppedTake()

    expect(order).toEqual(['session', 'mint', 'put'])
    expect(finalizeTake).not.toHaveBeenCalled()
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    expect(metaOf(takeId).secureError).toBe('upload_503')
    // The audio is untouched — nothing here deletes.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length + 'TAIL'.length)
  })

  // ⚖ NO CALL WAITS FOREVER (fix round 7, P1). A phone that walks out of signal
  // does not FAIL its upload — it stalls it. The take then held secureTake's
  // one-at-a-time slot for the whole page lifetime: the stop path was gone, and
  // every later attempt (and every other owed take behind it) hit the in-flight
  // guard and returned. So the PUT carries a deadline of its own bytes at
  // ~50 KB/s, floored at a minute.
  it('a PUT that never answers is abandoned at its deadline — retryable, and the take is RELEASED', async () => {
    putMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          order.push('put')
          // What a real fetch does on an aborted request.
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
        }),
    )
    const takeId = await stoppedOwedTake()

    const stalled = secureTake(port(), takeId)
    await drain(200)
    // Hanging: nothing marked, and this take is in flight.
    expect(order).toEqual(['session', 'mint', 'put'])
    expect(metaOf(takeId).secureError).toBeUndefined()

    await jest.advanceTimersByTimeAsync(60_000)
    await stalled
    // A deadline is a moment in time, so it lands RETRYABLE — never a code that
    // would stop this take from ever being sent again.
    expect(metaOf(takeId).secureError).toBe('network')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()

    // …and the slot is free: the very next attempt runs the whole leg.
    putMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      order.push('put')
      putBodies.push(init?.body as Blob)
      return { ok: true, status: 200 } as unknown as Response
    })
    order.length = 0
    await secureTake(port(), takeId)
    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // PR2 fix round 3: the mint stopped signing for upsert, so a finalized key is
  // immutable and a second PUT to it comes back 409. That is the RETRY — the
  // object landed, only the finalize call was lost — so it must finish the leg,
  // not record a failure. Every other refusal still stops the leg (above).
  it('a 409 PUT means the object is ALREADY there — finalize still runs and the take is secured', async () => {
    putMock.mockImplementation(async () => {
      order.push('put')
      return { ok: false, status: 409 } as unknown as Response
    })
    const takeId = await stoppedTake()

    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(finalizeTake).toHaveBeenCalledWith(
      expect.objectContaining({ takeId, byteLength: 'aaa'.length + 'TAIL'.length }),
    )
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    expect(metaOf(takeId).secureError).toBeUndefined()
  })

  // …and that conflict does not always arrive AS a 409 (fix round 12, P2).
  // Supabase's signed-upload endpoint has answered HTTP 400 with the real code
  // demoted into the body — {"statusCode":"409","error":"Duplicate"}. Read as a
  // plain 400 it became a retryable `upload_400`, so a take whose object had
  // LANDED and whose finalize was merely lost re-PUT its whole self on every
  // cooldown, forever, and never finalized. Both body shapes, and the 400 that
  // really is a 400.
  const put400 = (body: unknown) => {
    putMock.mockImplementation(async () => {
      order.push('put')
      return {
        ok: false,
        status: 400,
        clone: () => ({ json: async () => body }),
      } as unknown as Response
    })
  }

  it('a 400 whose body carries statusCode 409 is the same answer — finalize still runs', async () => {
    put400({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
    const takeId = await stoppedTake()

    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    expect(metaOf(takeId).secureError).toBeUndefined()
  })

  it('…and a 400 that only NAMES the duplicate is read the same way', async () => {
    put400({ error: 'Duplicate' })
    const takeId = await stoppedTake()

    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  it('a 400 that means something else is still a refusal — nothing finalizes', async () => {
    put400({ statusCode: '400', error: 'InvalidRequest' })
    const takeId = await stoppedTake()

    expect(order).toEqual(['session', 'mint', 'put'])
    expect(finalizeTake).not.toHaveBeenCalled()
    expect(metaOf(takeId).secureError).toBe('upload_400')
  })

  it('an unreadable 400 body is a refusal too — the safe side', async () => {
    putMock.mockImplementation(async () => {
      order.push('put')
      // A proxy's HTML page: `clone().json()` throws, and so does a double
      // whose Response shape stops at ok/status.
      return { ok: false, status: 400 } as unknown as Response
    })
    const takeId = await stoppedTake()

    expect(order).toEqual(['session', 'mint', 'put'])
    expect(metaOf(takeId).secureError).toBe('upload_400')
  })

  it("finalize 'failed' is recorded and stays RETRYABLE — the next attempt runs the whole leg again", async () => {
    finalizeTake.mockImplementation(async () => {
      order.push('finalize')
      return { error: 'failed' } as unknown as { ok: true; recordingSessionId: string }
    })
    const takeId = await stoppedTake()
    expect(metaOf(takeId).secureError).toBe('failed')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()

    order.length = 0
    finalizeTake.mockImplementation(async () => {
      order.push('finalize')
      return { ok: true as const, recordingSessionId: 'rs-1' }
    })
    await secureTake(port(), takeId)
    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    // A success is the last word on the failure that preceded it.
    expect(metaOf(takeId).secureError).toBeUndefined()
  })

  it('a settled take is never uploaded twice — a second call touches nothing', async () => {
    const takeId = await stoppedTake()
    order.length = 0
    await secureTake(port(), takeId)
    expect(order).toEqual([])
  })

  it("finalize's `already` counts as secured — an exact retry is a success, not a failure", async () => {
    finalizeTake.mockImplementation(async () => {
      order.push('finalize')
      return { ok: true as const, recordingSessionId: 'rs-1', already: true as const }
    })
    const takeId = await stoppedTake()
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    expect(metaOf(takeId).secureError).toBeUndefined()
  })

  it('a stop and a mount retry racing the same take PUT it ONCE', async () => {
    const takeId = await stoppedOwedTake()

    await Promise.all([secureTake(port(), takeId), secureTake(port(), takeId)])
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
  })

  it('a take stamped before mimeType existed falls back to audio/webm — and to a .webm key', async () => {
    const takeId = await stoppedOwedTake()
    delete metaOf(takeId).mimeType

    await secureTake(port(), takeId)
    expect(mintTakeUrl).toHaveBeenCalledWith(takeId, 'audio/webm', MINTED_SESSION)
    expect(putMock.mock.calls[0][0]).toContain(`app_biz-1_${takeId}.webm`)
    expect(finalizeTake).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/webm' }),
    )
  })

  it('a throwing door never escapes: the take stays un-finalized with the reason', async () => {
    mintTakeUrl.mockImplementation(async () => {
      throw new Error('offline')
    })
    const takeId = await stoppedTake()
    expect(metaOf(takeId).secureError).toBe('network')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
  })

  it("another staff member's take is never secured from this device (the store's own owner gate)", async () => {
    const takeId = await keptTake()
    // The OWNER's own last attempt left a code on the row.
    await markTakeSecureError(takeId, 'failed')
    order.length = 0

    mockUid = 'staff-B'
    await secureTake(port(), takeId)
    expect(order).toEqual([])
    // A null meta read is "not mine / not there", never "it failed" — writing a
    // code here would let one staffer scribble on another's row, and would
    // overwrite the only record of why the owner's attempt stopped.
    expect(metaOf(takeId).secureError).toBe('failed')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
  })

  // ── The take has no bytes ─────────────────────────────────────────────────
  // Nothing is sent, and nothing is finalized — but the attempt IS recorded
  // (fix round 13). With no mark the take carried no `lastSecureAttemptAt`, so
  // the cooldown never started: the re-drain re-read this take's meta and its
  // empty blob on every tick for the whole page life. `no_segments` is
  // deliberately NOT terminal — a queued flush can still land bytes.
  it('a zero-byte take is not uploaded, and its empty attempt enters the cooldown', async () => {
    const takeId = await stoppedOwedTake()
    // Everything on disk is empty (a kill between the meta row and the first
    // real chunk). loadTakeBlob still answers a Blob — a zero-length one — so
    // only the size guard stands between this and an empty object PUT under an
    // IMMUTABLE key, which no later retry could ever replace.
    segments().clear()
    segments().set(JSON.stringify([takeId, 0]), {
      takeId,
      seq: 0,
      blob: new Blob([]),
    })

    await secureTake(port(), takeId)
    expect(order).toEqual([])
    expect(metaOf(takeId).secureError).toBe('no_segments')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    // Retryable — so the take is merely resting, not abandoned.
    expect(TERMINAL_SECURE_ERRORS.has('no_segments')).toBe(false)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])
    await jest.advanceTimersByTimeAsync(60_000)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])
  })

  // ── ⚖ THE TAKE GETS ITS ROW FIRST (fix round 6) ──────────────────────────
  // When the start-mint failed the take carries no session, and the upload mint
  // no longer creates one (PR2 fix round 7 — a create whose response was lost
  // orphaned a row the retry could not name). So this leg knocks on the SAME
  // session door the recorder's start-mint uses, stamps the id, and only then
  // asks for a key. Throw that id away and the recorder's own retry mints a
  // SECOND row: the audio pointer lands on one, the karute on the other.
  it('a take with no row gets one from the session door FIRST, and the mint then carries it', async () => {
    const takeId = await stoppedOwedTake()
    expect(metaOf(takeId).recordingSessionId).toBeNull() // the start-mint failed

    await secureTake(port(), takeId)
    // The door is asked for the customer this recording is FOR — a row minted
    // without that attribution is a row the karute could never be read beside.
    expect(startSession).toHaveBeenCalledWith({
      customerId: TARGET.customerId,
      appointmentId: TARGET.appointmentId,
      // …and the take itself, which is what keys the mint's idempotency (fix
      // round 7): a retried session call must land on the same row, not mint a
      // fresh orphan every time a reply is lost.
      takeId,
      // …and NO container (fix round 9): start() already spent this take's one
      // bound attempt, and a second born-reserved create would compose the very
      // key core's unique index may already be holding. So the drain's create
      // is the argument-less one, and the mint below reserves that unbound row
      // through its legacy update path.
    })
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(mintTakeUrl).toHaveBeenCalledWith(takeId, expect.any(String), MINTED_SESSION)
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))

    // …and that is the id the recorder's retry answers with, without reaching
    // upstream at all (the fake create would answer null — a fresh row).
    mockStartRecordingSession.mockClear()
    await expect(
      globalRecorder.retryRecordingSessionMint({ takeId }),
    ).resolves.toBe(MINTED_SESSION)
    expect(mockStartRecordingSession).not.toHaveBeenCalled()
  })

  // ── ⚖ ONE BOUND ATTEMPT PER TAKE, the drain's half (fix round 9) ─────────

  /** A take whose start never offered the pair — the only shape the drain still
   *  binds: a row written before this field existed, or a browser that
   *  negotiated no container at start(). */
  async function unattemptedTake(): Promise<string> {
    const takeId = await stoppedOwedTake()
    delete (metaOf(takeId) as Record<string, unknown>).startBoundAttempted
    return takeId
  }

  it('a take that never sent a bound start still gets one from the drain — and remembers it', async () => {
    const takeId = await unattemptedTake()

    await secureTake(port(), takeId)
    expect(startSession).toHaveBeenCalledWith({
      customerId: TARGET.customerId,
      appointmentId: TARGET.appointmentId,
      takeId,
      // Born reserved (fix round 8) — the row points at this take's finalized
      // key from the moment it exists.
      mimeType: 'audio/webm;codecs=opus',
    })
    // Stamped BEFORE the request left, which is the only ordering a LOST reply
    // survives.
    expect(metaOf(takeId).startBoundAttempted).toBe(true)
  })

  it('a bound start that fails steps back to the argument-less one, and THAT row is the take\'s', async () => {
    const takeId = await unattemptedTake()
    // Any refusal at all reaches the caller as the door's fail-open null: a
    // validation 400 from a server that predates the pair, a 409 on a key core
    // already holds, a 5xx, a reply lost on the way back.
    startSession.mockImplementation(async (input: {
      customerId: string | null
      appointmentId: string | null
      mimeType?: string
    }) => {
      order.push(input.mimeType ? 'session-bound' : 'session')
      return input.mimeType ? null : { id: MINTED_SESSION }
    })

    await secureTake(port(), takeId)
    expect(order).toEqual(['session-bound', 'session', 'mint', 'put', 'finalize'])
    expect(startSession).toHaveBeenLastCalledWith({
      customerId: TARGET.customerId,
      appointmentId: TARGET.appointmentId,
      takeId,
    })
    // The UNBOUND row is what the take is stamped with and what the mint
    // reserves this key on — the legacy update path, still there for this.
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)
    expect(mintTakeUrl).toHaveBeenCalledWith(
      takeId,
      'audio/webm;codecs=opus',
      MINTED_SESSION,
    )
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  it('the bound start is NEVER re-sent for a take that already tried one', async () => {
    const takeId = await unattemptedTake()
    startSession.mockImplementation(async () => {
      order.push('session')
      return null
    })

    // Both calls answer nothing, so the take still has no row — but it now
    // remembers that a bound create went out, and that is what survives.
    await secureTake(port(), takeId)
    expect(startSession).toHaveBeenCalledTimes(2)
    expect(metaOf(takeId).startBoundAttempted).toBe(true)
    expect(metaOf(takeId).secureError).toBe('session')

    await jest.advanceTimersByTimeAsync(60_000)
    startSession.mockClear()
    startSession.mockImplementation(async () => {
      order.push('session')
      return { id: MINTED_SESSION }
    })
    await secureTake(port(), takeId)
    // ONE call, and it carries no container: the key that first create may have
    // reserved is one core's unique index would refuse for the life of the row.
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledWith({
      customerId: TARGET.customerId,
      appointmentId: TARGET.appointmentId,
      takeId,
    })
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ── ⚖ ONE SESSION ID PER TAKE, whoever answers first (fix round 10, P1) ──
  // The start-mint is a network call with no answer time anyone controls, and
  // until now nothing stopped a LATE reply from re-pointing a take the stop had
  // already secured against another row: the audio finalizes on one row and the
  // karute is read beside another (or the late row's key is refused and the
  // audio never leaves the device). Both are silent, and neither is undoable.

  /** A start-mint the test resolves by hand — "still in flight" is the whole
   *  scenario, so it cannot be a mock that answers on its own. */
  function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
  }

  // The common case, and the belt in front of everything below: the stop WAITS
  // for the mint (bounded, and behind a card that is already on screen), so the
  // take is secured against the row it was born with and no race happens at all.
  it('the stop waits for an in-flight start-mint, then secures the take against THAT row', async () => {
    const slow = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(slow.promise)
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    globalRecorder.stop()
    // The card is up (item 2 is untouched) and NOTHING is on the wire yet.
    expect(globalRecorder.state).toBe('recorded')
    await drain(200)
    expect(order).toEqual([])

    // The mint lands two seconds later, well inside the stop's window.
    await jest.advanceTimersByTimeAsync(2_000)
    slow.resolve({ id: 'rs-start' })
    await drain(200)

    // No session door at all: the take already had its row, so the leg is the
    // three calls a take with a session makes.
    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(metaOf(takeId).recordingSessionId).toBe('rs-start')
    expect(finalizeTake).toHaveBeenCalledWith(
      expect.objectContaining({ recordingSessionId: 'rs-start' }),
    )
    expect(globalRecorder.recordingSessionId).toBe('rs-start')
  })

  // …and when it does NOT come back in time, the two rows exist at once. THE
  // FIRST STAMP IS THE TAKE'S: the audio is on it, so the late reply is
  // refused and the recorder ADOPTS what the take says.
  it('a start-mint that answers after the stop is dropped — one id end to end', async () => {
    const late = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(late.promise)
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    globalRecorder.stop()
    await drain(200)
    expect(order).toEqual([])
    // The stop gives up on the mint after 10 s (SECURE_MINT_AWAIT_MS) and
    // secures the take through the session door, which mints a row of its own.
    await jest.advanceTimersByTimeAsync(10_000)
    await drain(200)
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)

    // NOW the start-mint answers, with a different row.
    late.resolve({ id: 'rs-late' })
    await drain(200)

    // The row the audio is on IS the row the karute will name. (Drop
    // first-write-wins and the take says 'rs-late' while the object sits under
    // MINTED_SESSION's key — the strand this round closes.)
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)
    expect(finalizeTake).toHaveBeenCalledWith(
      expect.objectContaining({ recordingSessionId: MINTED_SESSION }),
    )
    // The recorder adopted it — this field is what the karute save attaches.
    expect(globalRecorder.recordingSessionId).toBe(MINTED_SESSION)
    expect(await globalRecorder.awaitRecordingSessionId()).toBe(MINTED_SESSION)
    // Nothing else was sent: the late row is not re-minted, re-bound or re-PUT.
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
  })

  // The other way a late reply arrives: it FAILS. Its step back is an
  // argument-less create, and firing that onto a take the stop already gave a
  // row would leave core a second row for one take — an orphan nothing points
  // at, one per slow start-mint.
  it('a start that fails LATE mints no step-back row when the take already has one', async () => {
    const late = deferred<{ id: string } | null>()
    mockStartRecordingSession.mockReturnValueOnce(late.promise)
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    globalRecorder.stop()
    await jest.advanceTimersByTimeAsync(10_000)
    await drain(200)
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)

    mockStartRecordingSession.mockClear()
    late.resolve(null)
    await drain(200)

    expect(mockStartRecordingSession).not.toHaveBeenCalled()
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)
    // …and the recorder still ends up naming the take's row, not null.
    expect(globalRecorder.recordingSessionId).toBe(MINTED_SESSION)
  })

  // The drain minted the row, so the RECORDER's own field is still null — and
  // awaitRecordingSessionId reads that field first, against a mint promise that
  // settled null and will never resolve again. Without this the save that
  // follows writes a karute linked to nothing, on a take whose audio is
  // already on that very row.
  it("the id the retry reads back becomes the recorder's own, when it is the recorder's take", async () => {
    const takeId = await stoppedTake() // secured on stop → the drain minted it
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)
    expect(globalRecorder.takeId).toBe(takeId)
    expect(globalRecorder.recordingSessionId).toBeNull()

    await expect(globalRecorder.retryRecordingSessionMint()).resolves.toBe(MINTED_SESSION)
    expect(globalRecorder.recordingSessionId).toBe(MINTED_SESSION)
    // …which is what the save path actually asks (it reads the field, not the
    // return value, and the settled mint promise answers null forever).
    expect(await globalRecorder.awaitRecordingSessionId()).toBe(MINTED_SESSION)
  })

  // …and never for SOMEONE ELSE'S take: a review-path retry names a take this
  // singleton is not holding, and writing its row onto the live recorder would
  // link the next save to the wrong recording.
  it("a stamped id read for another take never lands on the recorder's field", async () => {
    const other = await stoppedOwedTake()
    await secureTake(port(), other)
    expect(metaOf(other).recordingSessionId).toBe(MINTED_SESSION)

    globalRecorder.discard()
    await drain()
    globalRecorder.takeId = 'take-live-1'
    globalRecorder.recordingSessionId = null
    try {
      await expect(
        globalRecorder.retryRecordingSessionMint({ takeId: other }),
      ).resolves.toBe(MINTED_SESSION)
      expect(globalRecorder.recordingSessionId).toBeNull()
    } finally {
      globalRecorder.takeId = null
    }
  })

  // A door that cannot answer is a MOMENT, not a verdict: the staff member is
  // offline, or core is down. Retryable, and nothing is uploaded blind — the
  // bytes would have no row to be claimed against.
  it("a session door that answers nothing marks 'session', uploads nothing, and stays retryable", async () => {
    startSession.mockImplementation(async () => {
      order.push('session')
      return null
    })
    const takeId = await stoppedOwedTake()

    await secureTake(port(), takeId)
    expect(order).toEqual(['session'])
    expect(finalizeTake).not.toHaveBeenCalled()
    expect(metaOf(takeId).secureError).toBe('session')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    expect(metaOf(takeId).recordingSessionId).toBeNull()
    // Retryable: the drain still owes this take, and the next attempt runs the
    // whole leg — including a session door that has come back. (Past the
    // cooldown the failure just started — fix round 7.)
    await jest.advanceTimersByTimeAsync(60_000)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])
    startSession.mockImplementation(async () => {
      order.push('session')
      return { id: MINTED_SESSION }
    })
    order.length = 0
    await secureTake(port(), takeId)
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // THE ORDER THIS ROUND EXISTS FOR. The mint writes this key onto the row, so
  // the device's copy of that binding must be on disk BEFORE anything is bound
  // or sent: a kill between the PUT and the finalize otherwise leaves uploaded
  // audio whose retry cannot name its own row.
  it('the minted session is stamped on the take BEFORE the key is even reserved', async () => {
    const takeId = await stoppedOwedTake()
    let sessionAtMint: string | null | undefined
    let sessionAtPut: string | null | undefined
    mintTakeUrl.mockImplementation(
      async (id: string, mimeType: string, recordingSessionId: string | null) => {
        order.push('mint')
        sessionAtMint = metaOf(id).recordingSessionId
        if (!recordingSessionId) return { error: 'bad_input' }
        return mintedFor(id, mimeType, recordingSessionId)
      },
    )
    putMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      order.push('put')
      putBodies.push(init?.body as Blob)
      sessionAtPut = metaOf(takeId).recordingSessionId
      return { ok: true, status: 200 } as unknown as Response
    })

    await secureTake(port(), takeId)
    expect(sessionAtMint).toBe(MINTED_SESSION)
    expect(sessionAtPut).toBe(MINTED_SESSION)
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)
  })

  // The other branch: a take that ALREADY has a row names it, and the reply
  // never re-points it — that row is what its discard and its karute write on.
  it("the mint is told the take's OWN session when it has one, and it is not re-pointed", async () => {
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'sess-1' })
    const takeId = await stoppedTake()

    // The session door is never knocked on for a take that already has a row —
    // a second row would be one the audio is not on (fix round 6).
    expect(startSession).not.toHaveBeenCalled()
    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(mintTakeUrl).toHaveBeenCalledWith(takeId, 'audio/webm;codecs=opus', 'sess-1')
    expect(metaOf(takeId).recordingSessionId).toBe('sess-1')
    expect(finalizeTake).toHaveBeenCalledWith(
      expect.objectContaining({ recordingSessionId: 'sess-1' }),
    )
  })

  // A refusal is an ANSWER now, not a throw — so the take meta records WHICH
  // one. 'exists' means a colleague's object already sits on this key: no
  // amount of retrying makes it claimable, and nothing is uploaded against it.
  it('a NAMED mint refusal is recorded verbatim, uploads nothing, and is never retried', async () => {
    mintTakeUrl.mockImplementation(async () => {
      order.push('mint')
      return { error: 'exists' as const }
    })
    const takeId = await stoppedTake()

    expect(order).toEqual(['session', 'mint'])
    expect(finalizeTake).not.toHaveBeenCalled()
    expect(metaOf(takeId).secureError).toBe('exists')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    // The audio is untouched — nothing here deletes — but the drain is done
    // asking for it.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length + 'TAIL'.length)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])
  })

  // ── Refusals that can never turn into a yes ───────────────────────────────
  it('a TERMINAL refusal is never retried — no mint, no whole-take re-PUT', async () => {
    const takeId = await stoppedOwedTake()
    for (const code of [
      'bad_input',
      'forbidden',
      'size_mismatch',
      'not_found',
      'no_uuid',
      // The BINDING refusals (fix round 4). Each is a statement about the row
      // this take's key is bound to, and a binding does not change with time.
      'exists',
      'reserved_elsewhere',
      'not_reserved',
      'superseded',
      'bad_take_id',
      'bad_mime',
    ]) {
      await markTakeSecureError(takeId, code)
      order.length = 0
      await secureTake(port(), takeId)
      expect(order).toEqual([])
      // And the reason is preserved — this take surfaces as 要対応, it is not
      // silently forgotten.
      expect(metaOf(takeId).secureError).toBe(code)
    }
  })

  it('a RETRYABLE refusal runs the whole leg again — the moment may simply have passed', async () => {
    const takeId = await stoppedOwedTake()
    // Its row is already on the take, so every turn below is the same three
    // calls — the session door belongs to the take that has none.
    await stampTakeSession(takeId, 'sess-1')
    // finalize keeps refusing, so each turn is judged on the code under test
    // rather than on a finalizedAt the previous turn wrote.
    finalizeTake.mockImplementation(async () => {
      order.push('finalize')
      return { error: 'failed' } as unknown as { ok: true; recordingSessionId: string }
    })
    for (const code of [
      'session',
      'network',
      'upload_503',
      'object_missing',
      'mint_502',
      // Storage or core did not ANSWER — the moment passed, nothing is settled.
      'upstream',
      'failed',
    ]) {
      await markTakeSecureError(takeId, code)
      order.length = 0
      await secureTake(port(), takeId)
      expect(order).toEqual(['mint', 'put', 'finalize'])
    }
  })

  // ── How long the take actually ran ────────────────────────────────────────
  it("a later attempt finalizes the recorder's PAUSED-AWARE duration, not the flush window", async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.pause()
    await jest.advanceTimersByTimeAsync(60_000) // a minute of NOT recording
    globalRecorder.resume()
    await jest.advanceTimersByTimeAsync(5_000)

    // The stop's own upload dies, so the leg is left to a later attempt.
    putMock.mockImplementation(async () => {
      order.push('put')
      return { ok: false, status: 503 } as unknown as Response
    })
    globalRecorder.stop()
    await drain(200)
    expect(metaOf(takeId).secureError).toBe('upload_503')
    expect(metaOf(takeId).durationMs).toBe(10_000)

    // The retry has no recorder to ask — what it finalizes is what stop stamped.
    putMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      order.push('put')
      putBodies.push(init?.body as Blob)
      return { ok: true, status: 200 } as unknown as Response
    })
    await secureTake(port(), takeId)
    // 10 s recorded across a 70 s wall clock. The flush window would have said
    // 70 — a minute of silence billed as session time.
    expect(lastFinalized().durationSeconds).toBeCloseTo(10, 1)
  })

  // ── ⚖ THE STOP STAMP GETS THREE TRIES (fix round 13) ─────────────────────
  // `durationMs` is the ONE positive fact that says a recorder finished this
  // take, and it is a best-effort IndexedDB write that swallows its own error.
  // One transaction lost to memory pressure or a store another tab had locked
  // therefore made a STOPPED take look unstopped — excluded from every drain
  // for the rest of the page's life, silently.
  it('a stop stamp whose write is lost twice still lands on the third try', async () => {
    const takeId = await keptTake()
    failNextDurationStamps = 2

    const stamped = stampTakeDuration(takeId, 5_000)
    // The two backoffs (50 ms, then 100 ms) — the stamp is genuinely waiting.
    await jest.advanceTimersByTimeAsync(200)
    expect(await stamped).toBe(true)
    expect(metaOf(takeId).durationMs).toBe(5_000)
    // …and the drain can see the take again, which is the whole point.
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([takeId])
  })

  // Three losses IS the store saying no. The stamp gives up — and the stop path
  // does not care, because it never needed the stamp: it is holding the live
  // measurement and hands it straight to secureTake. The stamp exists for the
  // LATER attempt, which is the one this leaves without a duration.
  it('a stop stamp lost three times gives up — and the stop still secures the take with its own measurement', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    // ⚖ FIX ROUND 18 RESHAPED THIS CASE, and the reshaping is the fix. The
    // stamp is no longer a write of its own that can lose while the take is
    // otherwise fine — it rides the write that makes the take whole. So the one
    // shape where it can still lose alone is the one where there is NOTHING
    // left to write: the last timer flush caught everything, and the leg's
    // queued first act IS the stamp (AG2). A tail that IS owed and whose fold
    // fails is a different case now — the take is not whole either, and the
    // test below pins it.
    emptyTailChunk = true
    failNextDurationStamps = 3
    order.length = 0
    globalRecorder.stop()
    await jest.advanceTimersByTimeAsync(500) // the two backoffs, and then some
    await drain(200)

    expect(metaOf(takeId).durationMs).toBeUndefined() // the stamp never landed
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    // The recorder's own paused-aware seconds, not a store read.
    expect(lastFinalized().durationSeconds).toBeCloseTo(5, 1)
  })

  // ── ⚖ NO STOP STAMP, NO SECURING (fix round 6) ───────────────────────────
  // The isActive belt can only answer for the take the recorder in THIS runtime
  // holds. Stop, then navigate to 記録 before the tail flush resolves: the page
  // mounts with no live recorder to ask, and securing there would seal the
  // segments flushed so far under the IMMUTABLE key while the tail is still
  // being written — permanently truncated audio, and the stop path's own call
  // then finds the take claimed. The stop stamp (or the stop path's own
  // argument) is the positive fact that a recorder finished this take.
  it('an UNSTAMPED take is never secured by the mount path — and is not marked failed', async () => {
    const takeId = await keptTake() // no onstop, so no stop stamp
    expect(metaOf(takeId).durationMs).toBeUndefined()

    await secureTake(port(), takeId)
    expect(order).toEqual([])
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    // Unfinished is not failed: nothing is written on the take at all.
    expect(metaOf(takeId).secureError).toBeUndefined()
  })

  it('…while the STOP path, which carries its own measurement, secures the same take', async () => {
    const takeId = await keptTake()
    expect(metaOf(takeId).durationMs).toBeUndefined()

    // Exactly what onstop hands over — the paused-aware seconds it just measured.
    await secureTake(port(), takeId, 5)
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(lastFinalized().durationSeconds).toBe(5)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // Two tabs, one take: the winner finalizes it, the loser's mint answers
  // `exists` a moment later. That late mark used to put a TERMINAL code on a
  // take whose audio is provably on the server — the 要対応 surface reads
  // exactly that field, so a finished recording would sit there as broken.
  it('a late failure never lands on a take that is already FINALIZED', async () => {
    const takeId = await stoppedTake()
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))

    await markTakeSecureError(takeId, 'exists')
    expect(metaOf(takeId).secureError).toBeUndefined()
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    // …and it stays out of the owed list, which is the fact that matters.
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])
  })

  it('markTakeFinalized clears an earlier failure and survives a store read', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    await passGrace()

    await markTakeFinalized(takeId)
    // The recovery read carries it, so a surface can tell "already on the
    // server" from "still device-only" without a second store read.
    expect((await getRecoverableTake([]))?.finalizedAt).toEqual(expect.any(Number))
  })

  it('a take row written before these fields existed still loads and still secures', async () => {
    const takeId = await stoppedOwedTake()
    // The exact pre-PR3 row shape: no finalizedAt, no secureError.
    const row = metaOf(takeId) as Record<string, unknown>
    delete row.finalizedAt
    delete row.secureError
    await passGrace()

    expect((await getRecoverableTake([]))?.takeId).toBe(takeId)
    await secureTake(port(), takeId)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ── The mount drain (fix round 3) ────────────────────────────────────────
  // The record page's mount retry, in the two lines the component runs. It used
  // to ride getRecoverableTake — the OFFER read, which hides a take flushed
  // within ACTIVE_GRACE_MS because it might be live in another tab. A stop whose
  // upload failed, plus a full reload inside those 20 s, therefore left a page
  // whose fresh recorder held no take and whose offer read hid the one owed:
  // the audio stayed on the device for the whole page lifetime (the effect runs
  // once).
  /** The singleton's live-take probe, exactly as RecordPageView passes it — to
   *  the WORKLIST as well as to secureTake since fix round 13. */
  const isActive = (id: string) => globalRecorder.isActiveTake(id)

  const mountDrain = async () => {
    // The component's own arguments: no recorder duration (this leg has no
    // recorder) and the singleton's live-take probe, on both calls.
    for (const id of await listOwnStoppedUnsecuredTakeIds(false, isActive))
      await secureTake(port(), id, undefined, isActive)
  }

  it('a reload INSIDE the 20 s grace still secures the take the recovery read hides', async () => {
    // A stop whose secure leg never got to run at all (the app was killed
    // between the stamp and the upload) — owed, and freshly flushed.
    const takeId = await stoppedOwedTake()

    // The page is reloaded 5 s later — well inside the grace.
    await jest.advanceTimersByTimeAsync(5_000)
    // The offer read says there is nothing (and the fresh recorder has no take
    // of its own), which is exactly why the drain must not ask it.
    expect(await getRecoverableTake([])).toBeNull()
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])

    order.length = 0
    await mountDrain()
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ── The retry COOLDOWN (fix round 7, P3) ─────────────────────────────────
  // The other half of that scenario: a stop that actually FAILED. This effect
  // runs on every mount, and a take is the whole recording — a staffer bouncing
  // on and off this page re-uploaded tens of megabytes each time, against a
  // refusal seconds old. The take is never abandoned; it waits a minute.
  it('a stop whose upload died is left alone for a minute, then the next mount takes it', async () => {
    putMock.mockImplementation(async () => {
      order.push('put')
      return { ok: false, status: 503 } as unknown as Response
    })
    const takeId = await stoppedTake()
    expect(metaOf(takeId).secureError).toBe('upload_503')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()

    // Two mounts in the next five seconds change nothing — no re-PUT storm.
    await jest.advanceTimersByTimeAsync(5_000)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])

    putMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      order.push('put')
      putBodies.push(init?.body as Blob)
      return { ok: true, status: 200 } as unknown as Response
    })
    order.length = 0
    await mountDrain()
    expect(order).toEqual([])

    // …and a minute after the failure the take is owed again, and finishes.
    await jest.advanceTimersByTimeAsync(60_000)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])
    await mountDrain()
    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ── ⚖ STOPPED ONLY (fix round 5) ─────────────────────────────────────────
  // The drain used to name any un-finalized take with bytes on disk. That
  // included takes STILL RECORDING — this tab remounting, another same-origin
  // tab, a paused session — and a finalized key is IMMUTABLE: sealing the
  // segments flushed so far means the rest of the recording can never land.
  // No age or grace window can stand in for the stop: a paused take flushes
  // nothing, so it looks stale within seconds. The stop stamp
  // (stampTakeDuration, written at onstop) proves a take is complete — and
  // since fix round 14 a take that is still BEATING proves the opposite just as
  // positively, which is what keeps the live one below out of the worklist.
  it('the drain is STOPPED-ONLY: a live unstopped take is skipped, a fresh stopped one is taken', async () => {
    const running = await keptTake() // no onstop, so no stop stamp
    expect(metaOf(running).durationMs).toBeUndefined()
    await jest.advanceTimersByTimeAsync(60_000) // a minute of silence proves nothing
    await beatFromAnotherTab(running) // …because the recorder holding it is elsewhere
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])

    // A take a recorder DID stop, flushed seconds ago: no grace to wait out.
    const stopped = await stoppedOwedTake()
    expect(Date.now() - metaOf(stopped).updatedAt).toBeLessThan(20_000)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([stopped])

    order.length = 0
    await mountDrain()
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(stopped).finalizedAt).toEqual(expect.any(Number))
    // The unstopped one is untouched — still on the device, still un-finalized,
    // and NOT marked failed: it is unfinished, not broken. It waits for PR5's
    // launch drain, where the single-webview shell proves nothing is live.
    expect(metaOf(running).finalizedAt).toBeUndefined()
    expect(metaOf(running).secureError).toBeUndefined()
  })

  // ── ⚖ THE NATIVE SHELL'S SECOND PROOF (fix round 13) ─────────────────────
  // The stop stamp is a best-effort write. When it loses AND the stop-time
  // upload loses too, a reload takes the recorder singleton with it and the
  // take was excluded from every drain — device-only, silent, until PR5.
  // The phone apps are a SINGLE WebView: a page loading there means no recorder
  // anywhere can be live, so an unstamped take with bytes that has been quiet
  // past the grace is a stopped take whose stamp failed. Its audio may go.
  it('the native shell drains an unstamped take that has gone quiet — a stop stamp that never landed', async () => {
    const takeId = await keptTake() // flushed, never stopped, never stamped
    expect(metaOf(takeId).durationMs).toBeUndefined()
    asNativeShell()
    await jest.advanceTimersByTimeAsync(20_000) // …and quiet past ACTIVE_GRACE_MS

    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([takeId])
    order.length = 0
    await mountDrain()
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    // The flush window stands in for the measurement nobody stamped: 5 s of
    // recording before the flush, and the 20 s of silence after it are NOT
    // counted (updatedAt stops moving when the flushes do). A take PAUSED for
    // twenty minutes would still finalize twenty minutes long — the documented
    // trade, and the reason this is not the preferred number.
    expect(lastFinalized().durationSeconds).toBeCloseTo(5, 1)
  })

  // …and never the take the recorder is still holding. This is the case no age
  // or grace window can decide by itself (fix round 5): a PAUSED take flushes
  // nothing, so it looks stale within seconds. Inside the single WebView the
  // singleton IS the whole answer, which is why the rule asks it.
  it('…but never a take the singleton is still holding, paused and silent', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.pause()
    await drain()
    asNativeShell()
    await jest.advanceTimersByTimeAsync(20_000) // a paused take flushes nothing

    expect(globalRecorder.state).toBe('paused')
    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])

    order.length = 0
    await mountDrain()
    expect(order).toEqual([])
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    // Not failed — unfinished. And the moment it really stops, the leg runs.
    expect(metaOf(takeId).secureError).toBeUndefined()
    globalRecorder.stop()
    await drain(200)
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ── ⚖ AND THE WEB ASKS THE OTHER TABS (fix round 14) ─────────────────────
  // Round 5's hazard is real: ANOTHER SAME-ORIGIN TAB can be recording this
  // take, isActive cannot see into it, and a finalized key is immutable — so
  // sealing it here would truncate that recording forever. But "quiet" was
  // never the same fact as "gone", and reading them as one left the failed
  // stamp above device-only on every browser. A live recorder now re-stamps a
  // localStorage heartbeat every ~5 s, paused or not, so the two can be told
  // apart. A take that is beating stays exactly as untouchable as before.
  it('the WEB never drains a take another tab is still holding — a fresh heartbeat is a live recorder', async () => {
    const takeId = await keptTake()
    await jest.advanceTimersByTimeAsync(60_000) // three graces of silence…
    await beatFromAnotherTab(takeId) // …and a recorder next door that just checked in

    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    order.length = 0
    await mountDrain()
    expect(order).toEqual([])
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    expect(metaOf(takeId).secureError).toBeUndefined()

    // The belt refuses it too, not just the worklist: a caller that named this
    // take directly gets the same answer.
    await secureTake(port(), takeId, undefined, isActive)
    expect(order).toEqual([])
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
  })

  // …and the other half of the same rule, which is the fix itself: nothing
  // beating for a quiet unstamped take means no recorder anywhere is holding
  // it. Both shapes of "nothing" count — a heartbeat that has gone stale (the
  // tab was killed mid-take) and a take that never had one (recorded by a
  // bundle older than this round, or in a browser whose storage refused).
  it('…and takes it once its beat has EXPIRED — the stop stamp the web used to lose', async () => {
    const stale = await keptTake()
    await beatFromAnotherTab(stale) // that tab then went away and never came back
    const never = await keptTake() // an older bundle's take: nothing ever beat
    // Three minutes, not one: a beat speaks for two (HEARTBEAT_STALE_MS), so a
    // minute of silence is exactly what a THROTTLED live tab looks like.
    await jest.advanceTimersByTimeAsync(180_000)

    // ⚖ …and ONLY the expired one (fix round 17, AF2). A take that never beat
    // at all is not a take proved free: it is a pre-round-15 bundle's take, or
    // one paused in a tab whose storage refused the write, and on the web those
    // are indistinguishable from a finished recording. It waits for a human.
    expect(heartbeatOf(never)).toBeUndefined()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([stale])

    order.length = 0
    await mountDrain()
    expect(metaOf(stale).finalizedAt).toEqual(expect.any(Number))
    // Same flush-window fallback as the native arm — nobody stamped these.
    expect(lastFinalized().durationSeconds).toBeCloseTo(5, 1)
    // Untouched, and NOT marked failed: unfinished is not broken.
    expect(metaOf(never).finalizedAt).toBeUndefined()
    expect(metaOf(never).secureError).toBeUndefined()

    // …and the single WebView is its own proof, so the native arm still has it.
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([never])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
  })

  // The signal itself, at the recorder end: it rides the flush timer that was
  // already there (no third timer), it keeps beating through a PAUSE — the
  // case that has no other tell, since a paused take flushes nothing — and it
  // is gone the moment the recorder is.
  it('a live take beats every 5 s, PAUSED included, and stops beating at the stop', async () => {
    const takeId = await startAndSettle()
    expect(heartbeatOf(takeId)).toBeUndefined() // nothing yet — one tick old
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    expect(heartbeatOf(takeId)).toBe(Date.now())

    globalRecorder.pause()
    await drain()
    const quietSince = metaOf(takeId).updatedAt
    await jest.advanceTimersByTimeAsync(20_000)

    // On disk this take has been silent for a full grace…
    expect(metaOf(takeId).updatedAt).toBe(quietSince)
    expect(Date.now() - quietSince).toBeGreaterThanOrEqual(20_000)
    // …and it is still plainly alive. The probe lies (this is what the OTHER
    // tab's drain sees — no singleton of its own to ask), so the heartbeat is
    // the only thing standing between a paused session and an immutable key.
    expect(heartbeatOf(takeId)).toBe(Date.now())
    expect(await listOwnStoppedUnsecuredTakeIds(false, () => false)).toEqual([])

    globalRecorder.stop()
    await drain(200)
    // Not at the top of the stop — at the END of it, once the leg has nothing
    // short left to seal (round 15). See the AA1 test below.
    expect(heartbeatOf(takeId)).toBeUndefined()
  })

  // ── ⚖ ONE HOME FOR THE BEAT (fix round 15) ──────────────────────────────
  // It used to live in localStorage, where a WRITE that threw (Safari private
  // mode, quota) left a live recording looking stopped while a READ that threw
  // left a stopped one looking live: two stores, two failure modes, one
  // judgement. It lives on the take row now — the same store the drain reads —
  // so a beat that cannot be written makes the take look OLDER, never deader,
  // and a store that cannot be written cannot be read either: a drain that
  // cannot open IndexedDB has no worklist at all, so it seals nothing.
  it('the beat lives on the take row — nothing touches localStorage at all', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem')
    try {
      const takeId = await startAndSettle()
      pushChunk('aaa')
      await jest.advanceTimersByTimeAsync(5_000)

      expect(heartbeatOf(takeId)).toBe(Date.now())
      expect(setItem).not.toHaveBeenCalled()
      expect(localStorage.length).toBe(0)
    } finally {
      setItem.mockRestore()
    }
  })

  // ── ⚖ A THROTTLED TAB IS STILL RECORDING (fix round 15) ──────────────────
  // A hidden tab's timers are clamped to roughly ONE firing a minute after
  // five minutes in the background, and a tab that is merely capturing gets no
  // audible-media exemption. So the beat of a perfectly live recording next
  // door arrives once a minute, not every five seconds — and judged against
  // the 20 s flush grace it would read as dead on every single tick, which is
  // the reading that seals a live recording under its immutable key.
  it('a BACKGROUND tab beating once a MINUTE still holds its take', async () => {
    const takeId = await keptTake()
    for (let tick = 0; tick < 3; tick++) {
      await beatFromAnotherTab(takeId) // the throttled tick fires…
      await jest.advanceTimersByTimeAsync(60_000) // …and the next is a minute off
      expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    }
    order.length = 0
    await mountDrain()
    expect(order).toEqual([])
    expect(metaOf(takeId).finalizedAt).toBeUndefined()

    // …and when that tab really is gone, the window still ends — it just ends
    // LATE, which costs an upload a couple of minutes rather than an audio
    // file its tail.
    await jest.advanceTimersByTimeAsync(120_000)
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([takeId])
  })

  // ── ⚖ A STOP IS NOT FINISHED UNTIL ITS TAIL IS ON DISK (fix round 14, AA1) ─
  // The window between onstop and the end of the stop leg reads, to every rule
  // above, as a stopped take free to seal: no stamp yet (it comes after the
  // tail flush), the heartbeat already removed, state 'recorded' — and a slow
  // IndexedDB write holds it open while `updatedAt` ages past the grace. A
  // drain in that window would upload only the COMMITTED segments under the
  // IMMUTABLE key, and the tail could then never land: truncated, forever.
  it('a stop whose tail is still being written is untouchable — the drain would seal it short', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // one segment committed
    // A long quiet stretch: no chunks, so the empty flushes write nothing and
    // `updatedAt` stops moving — the take is already stale when the stop comes.
    // (The tail chunk itself arrives from the recorder AT the stop, as a real
    // MediaRecorder emits it, and its write is the slow one below.)
    await jest.advanceTimersByTimeAsync(60_000)

    slowSegmentWrites = true
    globalRecorder.stop()
    await drain(200)

    // Every fact the drain reads says "stopped, seal it".
    expect(globalRecorder.state).toBe('recorded')
    expect(metaOf(takeId).durationMs).toBeUndefined()
    // …and the leg has ALREADY written the stop down (fix round 17), ahead of
    // the tail flush: nothing that fails after this point can make the take
    // look like one that finished.
    expect(metaOf(takeId).stopPendingAt).toEqual(expect.any(Number))
    expect(Date.now() - metaOf(takeId).updatedAt).toBeGreaterThan(20_000)
    // …every fact except the one beat this leg writes at its TOP (round 15).
    expect(heartbeatOf(takeId)).toBe(Date.now())
    // The recorder is the one thing that knows better — on BOTH arms.
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    // ⚖ AND SO IS THE TAB NEXT DOOR — which has no securingTakeIds of ours to
    // consult (its probe answers false for a take it has never held), so the
    // beat is the whole of the defence there. Round 14 cleared it at the top
    // of this leg and left that tab free to seal the short blob.
    expect(await listOwnStoppedUnsecuredTakeIds(false, () => false)).toEqual([])

    order.length = 0
    await mountDrain()
    expect(order).toEqual([]) // nothing uploaded short

    // The leg finishes: the tail lands and the take goes up WHOLE.
    await jest.advanceTimersByTimeAsync(0)
    await drain(200)
    expect(putBodies[0].size).toBe('aaa'.length + 'TAIL'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    // …and the hold is released with it — and the beat with the hold.
    expect(globalRecorder.isActiveTake(takeId)).toBe(false)
    expect(heartbeatOf(takeId)).toBeUndefined()
    // THE CONTROL for the test below: a tail that LANDED writes no flag. The
    // mark has to mean something, and it means nothing if a normal stop wears
    // it too.
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
    // …and the stamp is the write that CLEARS the in-flight flag: a stop that
    // finished wears neither mark.
    expect(metaOf(takeId).stopPendingAt).toBeUndefined()
  })

  // The other exit of that leg: the tail was SKIPPED — and since fix round 20
  // there is exactly one way that happens, the tail WRITE being refused. (The
  // next customer's recording starting first no longer does it: the take's own
  // array and counters go with the take, so its tail is written from them.)
  // Nothing is stamped and nothing is sealed, and the hold must still be
  // released, or the take would be invisible to every drain for the rest of the
  // page's life.
  //
  // ⚖ AND THE MISSING TAIL IS WRITTEN DOWN (fix round 16, AC1/AC3). Round 7
  // answered this case with SILENCE: leave the take unstamped, and no drain
  // reads an unstamped take. Rounds 13/14 then taught BOTH drains to read
  // exactly that shape — unstamped, quiet, nothing beating for it — so the
  // absence of a stamp stopped being a defence, and the moment the hold is
  // released the drain seals the committed PREFIX under the immutable key with
  // the rest of the recording nowhere to land. The fact is a fact now.
  it('…and a skipped tail releases the hold, marked tailIncomplete and sealed by NOBODY', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // 3 bytes committed
    // …and the recorder's own tail chunk ('TAIL', 4 more) arrives at the stop
    // below, so the whole recording is 7 bytes and the disk holds 3 of them.

    failNextSegmentWrites = 1 // the tail write itself is refused
    globalRecorder.stop()
    await drain(200)
    await jest.advanceTimersByTimeAsync(0)
    await drain(200)

    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    expect(globalRecorder.isActiveTake(takeId)).toBe(false)
    // The positive fact, on the row — and NOT an error: nothing failed here.
    expect(metaOf(takeId).tailIncomplete).toBe(true)
    expect(metaOf(takeId).secureError).toBeUndefined()

    // Now make every OTHER fact say "seal it": the hold is gone, the beat was
    // cleared with it, and the take goes quiet past the grace. Round 13/14's
    // rules would take it on both arms; the flag is the only thing left.
    expect(heartbeatOf(takeId)).toBeUndefined()
    await passGrace()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    // …and the tab next door, which has no hold of ours to consult.
    expect(await listOwnStoppedUnsecuredTakeIds(false, () => false)).toEqual([])

    order.length = 0
    await mountDrain()
    // Drop the flag check in isStoppedTake and this is where the committed
    // 3 of 7 bytes go up under the immutable finalized key.
    expect(putBodies.map((b) => b.size)).toEqual([])
    expect(order).toEqual([])

    // The belt, for the caller that names the take directly instead of taking
    // it off a worklist — the stop path carries its own measurement and would
    // otherwise walk straight past the drain's rule.
    await secureTake(port(), takeId, 5, isActive)
    expect(order).toEqual([])
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    expect(metaOf(takeId).secureError).toBeUndefined()
    // Nothing deleted: the 3 bytes that did land are still on the device, for
    // a human to decide about.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
  })

  // ── ⚖ AND THE HOLD LASTS UNTIL THE LEG LETS GO (fix round 16, AD1) ───────
  // The `finally` above covers every exit of the leg — but only legs that
  // EXIT. A store request that neither succeeds nor errors leaves the leg
  // suspended, and the hold with it. Round 15 answered that with a two-minute
  // deadline; the deadline was 120_000 and the beat's own stale window is
  // 120_000, so at the two-minute mark BOTH defences fell in the same instant
  // and a drain inside that window sealed the committed prefix under the
  // immutable key while the tail was still unwritten.
  //
  // The two outcomes are not comparable. A pinned take keeps its audio on the
  // device until the next launch drain — an upload delayed. A sealed one loses
  // the rest of the recording forever. So the hold has no deadline: it lasts
  // until the leg lets go, and the Set dies with the page.
  it('a stop leg that HANGS keeps its take — no deadline, and no drain takes it', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    hangSegmentWrites = true // the tail write never answers: the leg never exits
    globalRecorder.stop()
    await drain(200)
    expect(globalRecorder.isActiveTake(takeId)).toBe(true)
    expect(metaOf(takeId).durationMs).toBeUndefined() // …and never will be

    // Still held a minute in — a slow stop is not a stuck one.
    await jest.advanceTimersByTimeAsync(60_000)
    expect(globalRecorder.isActiveTake(takeId)).toBe(true)

    // FIVE MINUTES, two and a half times the window round 15 let go at.
    await jest.advanceTimersByTimeAsync(4 * 60_000)
    expect(globalRecorder.isActiveTake(takeId)).toBe(true)
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor

    order.length = 0
    await mountDrain()
    // Re-add round 15's deadline and this is where the committed 3 of the
    // take's 7 bytes are sealed under the immutable finalized key — the tail
    // that is still queued behind the hung write would have nowhere to land.
    expect(putBodies.map((b) => b.size)).toEqual([])
    expect(order).toEqual([])

    // …and nothing is lost by holding on: the store answers at last, the leg
    // runs the rest of the way and the take goes up WHOLE.
    order.length = 0
    releaseHungWrites()
    await drain(400)
    expect(putBodies.at(-1)!.size).toBe('aaa'.length + 'TAIL'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ── ⚖ AND THE STOP ITSELF IS ON THE ROW (fix round 17, AE1) ─────────────
  // Everything above defends this window with things that die with the page:
  // the hold is a Set in memory, and the beat is written by a timer this page
  // owns. A stop that dies IN the leg — the tab closed, the WebView killed —
  // takes both away, and leaves the take unstamped, unmarked, quiet and
  // unbeating: the shape rounds 13/14 taught both drains to take. The tab next
  // door (and the page after the reload) reads exactly that, and `() => false`
  // is what any of them answers for a hold it never had.
  it('a stop that died in flight is refused by the ROW — no other tab can see the hold', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // 3 bytes committed; 'TAIL' (4) not

    hangSegmentWrites = true // the tail write never answers: the leg never exits
    globalRecorder.stop()
    await drain(200)
    // The first thing the leg did — before the flush, before anything could
    // release either defence.
    expect(metaOf(takeId).stopPendingAt).toEqual(expect.any(Number))

    // Five minutes on, with the beats queued behind the hung write and never
    // running: nothing is beating for this take any more.
    await jest.advanceTimersByTimeAsync(5 * 60_000)
    expect(Date.now() - heartbeatOf(takeId)!).toBeGreaterThan(120_000)
    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()

    const elsewhere = () => false
    expect(await listOwnStoppedUnsecuredTakeIds(false, elsewhere)).toEqual([])
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(false, elsewhere)).toEqual([])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor

    order.length = 0
    for (const id of await listOwnStoppedUnsecuredTakeIds(false, elsewhere))
      await secureTake(port(), id, undefined, elsewhere)
    // Drop the stopPendingAt check in isStoppedTake and this is where the
    // committed 3 of the take's 7 bytes are sealed under the immutable
    // finalized key, with the tail nowhere left to land.
    expect(putBodies.map((b) => b.size)).toEqual([])
    expect(order).toEqual([])
    // Nothing deleted, nothing marked failed — it is a truth for a human.
    expect(metaOf(takeId).secureError).toBeUndefined()
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)

    releaseHungWrites() // give the queue back to the tests after this one
    await drain(400)
  })

  // …and the same protection when round 16's OWN write is the one that fails.
  // The marker is written from inside the leg, so a store that refuses it
  // leaves the `finally` releasing the hold and clearing the beat over a take
  // with nothing on it — and once storage recovers, the quiet unstamped
  // unmarked prefix reads as a finished recording on both arms.
  it('a skipped tail whose MARK could not be written is still sealed by nobody', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // 3 of the take's 7 bytes

    failNextTailMarks = 3 // the write and both its retries: the store says no
    failNextSegmentWrites = 1 // …and the tail write that provoked it
    globalRecorder.stop()
    await drain(200)
    await jest.advanceTimersByTimeAsync(0)
    await drain(200)
    await jest.advanceTimersByTimeAsync(400) // the mark's two backoffs
    await drain(200)

    // Round 16's fact never made it onto the row…
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
    expect(metaOf(takeId).durationMs).toBeUndefined()
    // …and the leg let go anyway, as it must: a `finally` that waited on the
    // store would pin the take for the rest of the page's life.
    expect(globalRecorder.isActiveTake(takeId)).toBe(false)
    expect(heartbeatOf(takeId)).toBeUndefined()
    // The fact written FIRST is the one still standing.
    expect(metaOf(takeId).stopPendingAt).toEqual(expect.any(Number))

    await passGrace()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(false, isActive)).toEqual([])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    expect(await listOwnStoppedUnsecuredTakeIds(false, () => false)).toEqual([])

    order.length = 0
    await mountDrain()
    // The same 3 of 7 bytes, and the same single-line mutation reaches them.
    expect(putBodies.map((b) => b.size)).toEqual([])
    expect(order).toEqual([])
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
  })

  // ── ⚖ AND THE LEG SAYS WHEN IT IS DONE (fix round 17, AE2) ──────────────
  // A drain that ran while the take was held found nothing owed — correctly,
  // the tail was still being written — and the page then stopped looking. The
  // duration stamp lands a moment later and makes the take eligible with nobody
  // left to take it, so a stop-time upload that missed sat on the device until
  // a remount or a return to the front. This is the RECORDER's half: one more
  // notify, at the point where the take has become drainable. The page's half —
  // its subscription scheduling on exactly this edge — is pinned in
  // record-mount-drain-sequential.test.tsx.
  it('the stop leg notifies once more when it settles, and by then the take is owed', async () => {
    putMock.mockImplementation(async () => {
      order.push('put')
      return { ok: false, status: 503 } as unknown as Response
    })
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    /** The page's subscription in miniature — the edge it schedules on. */
    const settleEdges: number[] = []
    let wasSecuring = globalRecorder.isSecuring()
    const unsubscribe = globalRecorder.subscribe(() => {
      const securing = globalRecorder.isSecuring()
      if (wasSecuring && !securing) settleEdges.push(Date.now())
      wasSecuring = securing
    })

    slowSegmentWrites = true
    globalRecorder.stop()
    await drain(200)
    // In this window there is nothing to take, and nothing has settled.
    expect(globalRecorder.isSecuring()).toBe(true)
    expect(await listOwnStoppedUnsecuredTakeIds(true, isActive)).toEqual([])
    expect(settleEdges).toEqual([])

    await jest.advanceTimersByTimeAsync(0)
    await drain(200)
    unsubscribe()

    // Drop the notify from the leg's `finally` and this is empty: the take is
    // owed, nothing on the page hears about it, and the audio stays on the
    // device until a remount or a return to the front.
    expect(settleEdges).toHaveLength(1)
    expect(metaOf(takeId).secureError).toBe('upload_503')
    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    expect(await listOwnStoppedUnsecuredTakeIds(true, isActive)).toEqual([takeId])
  })

  // The belt behind that filter. The store answers from a stamp on disk; only
  // the recorder can answer for the take it is holding right now, so secureTake
  // asks it directly and refuses regardless of what the worklist said.
  it("the recorder's own LIVE take is refused even when the worklist names it", async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.pause()
    await drain()
    // Forced INTO the worklist, so the belt is what stops this and not the
    // filter in front of it.
    await stampTakeDuration(takeId, 5_000)
    expect(globalRecorder.state).toBe('paused')
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])

    order.length = 0
    await mountDrain()
    expect(order).toEqual([])
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    // No mark: a take that is simply not finished has not failed at anything.
    expect(metaOf(takeId).secureError).toBeUndefined()

    // …and the moment it really stops, the whole leg runs.
    globalRecorder.stop()
    await drain(200)
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  it('the drain names only takes the server LACKS — secured, terminally refused and segment-less takes are out', async () => {
    // All four are STOPPED takes, so each is excluded (or kept) for the reason
    // this test names rather than for want of a stop stamp.
    const secured = await stoppedOwedTake()
    await secureTake(port(), secured)
    expect(metaOf(secured).finalizedAt).toEqual(expect.any(Number))

    const refused = await stoppedOwedTake()
    await markTakeSecureError(refused, 'forbidden') // can never turn into a yes

    const empty = await startAndSettle() // a kill before the first flush
    globalRecorder.discard({ keepTake: true })
    await drain()
    await stampTakeDuration(empty, 5_000)

    const owed = await stoppedOwedTake()
    await markTakeSecureError(owed, 'failed') // retryable — the moment passed

    expect(takes().size).toBe(4)
    // Past the cooldown the two marks above started (fix round 7) — what this
    // test judges is WHICH takes the drain owes, not how recently they failed.
    await jest.advanceTimersByTimeAsync(60_000)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([owed])
    expect(await listOwnStoppedUnsecuredTakeIds()).not.toContain(empty)
  })

  it("another staff member's owed take is invisible to this device's drain", async () => {
    const takeId = await stoppedOwedTake()
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])

    mockUid = 'staff-B'
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])
    mockUid = null
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])
    mockUid = 'staff-A'
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])
  })

  // ── ⚖ THE STAMP RIDES THE TAIL (fix round 18, AG1-AG3) ──────────────────
  // Round 17 wrote the stop down before anything could lose it, and the write
  // that CLEARS that flag — the duration stamp — was still a separate
  // patchTakeMeta. Lose all three of its tries and the row carries
  // `stopPendingAt` with no `durationMs`: a shape isStoppedTake refuses on BOTH
  // arms, for ever. The take is whole on the device and no drain will ever
  // take it. There is no separate stamp write left to lose.

  it('the tail bytes and the stop stamp are ONE write — a meta put that fails takes the segment with it', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // seq 0 committed
    expect(segments().size).toBe(1)

    // The TAKES put inside appendTakeSegment's transaction refuses — and after
    // AG1 that put is the one carrying the stamp.
    failNextDurationStamps = 3
    order.length = 0
    globalRecorder.stop() // emits 'TAIL': a tail IS owed
    await jest.advanceTimersByTimeAsync(500)
    await drain(200)

    // The transaction aborted, so the tail segment did not land on its own —
    // split the stamp back out and this is 2 segments and lastSeq 1, with the
    // stamp missing: the take listed by nobody, which is the strand itself.
    expect(segments().size).toBe(1)
    expect(metaOf(takeId).lastSeq).toBe(0)
    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(stampWrites).toEqual([])
    // …the flush answered false, so the leg took its skipped-tail exit and said
    // so on the row.
    expect(metaOf(takeId).tailIncomplete).toBe(true)
    expect(order).toEqual([]) // nothing sealed short

    await passGrace()
    expect(await listOwnStoppedUnsecuredTakeIds(true, isActive)).toEqual([])
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(true, isActive)).toEqual([])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    // Nothing deleted: the committed bytes wait on the device for a human.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
  })

  // Greptile's interleaving, closed at the shape. Nothing is pending at the
  // stop (the last timer flush caught everything), so the first act IS the
  // stamp — and when its write loses every try the row wears NO flag for it to
  // have cleared. The stop-time upload then fails retryably, which is the
  // common case the drains exist for, and the take is still reachable.
  it('a stamp that loses every try no longer strands the take — the disk was already whole', async () => {
    putMock.mockImplementation(async () => {
      order.push('put')
      return { ok: false, status: 503 } as unknown as Response
    })
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    emptyTailChunk = true // nothing left to write at the stop
    failNextDurationStamps = 3 // …and the stamp's own write loses all three
    globalRecorder.stop()
    await jest.advanceTimersByTimeAsync(500)
    await drain(200)

    // Make the first act unconditionally markTakeStopPending and this flag is
    // standing with no stamp to clear it — the round-17 strand.
    expect(metaOf(takeId).stopPendingAt).toBeUndefined()
    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
    // The leg still tried, with the live measurement it holds either way.
    expect(order.at(-1)).toBe('put')
    expect(metaOf(takeId).secureError).toBe('upload_503')

    await passGrace()
    // On the phone the take is BACK on the worklist: quiet, unstamped, whole on
    // disk, nothing holding it — rounds 13/14's own reading, and correct here.
    asNativeShell()
    expect(await listOwnStoppedUnsecuredTakeIds(true, isActive)).toEqual([takeId])
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    // On the web AF2 leaves it to a human: the leg's `finally` cleared the
    // beat, so there is no beat left to prove nothing is holding it.
    expect(await listOwnStoppedUnsecuredTakeIds(true, isActive)).toEqual([])
    // …and 録音履歴 is where that human finds it.
    expect((await listOwnTakes()).map((t) => t.takeId)).toEqual([takeId])
  })

  it('a normal stop with a tail: the flag goes WITH the tail, on the one write that carried it', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    slowSegmentWrites = true
    globalRecorder.stop()
    await drain(200)
    // A tail is owed, so the first act was the FACT, not the stamp.
    expect(metaOf(takeId).stopPendingAt).toEqual(expect.any(Number))
    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(stampWrites).toEqual([])

    await jest.advanceTimersByTimeAsync(0)
    await drain(200)
    // …and it is gone WITH the tail. Drop the stamp argument from the flush and
    // both of these fail: no stamp on the row, and the flag left standing.
    expect(metaOf(takeId).stopPendingAt).toBeUndefined()
    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    // ONE write introduced the stamp, and it carried the tail's own seq — the
    // whole claim of the round in one line.
    expect(stampWrites).toEqual([1])
    expect(putBodies.at(-1)!.size).toBe('aaa'.length + 'TAIL'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // The id changes AFTER the write lands: the staffer starts the next customer
  // while the tail transaction is still in flight. The bytes AND the stamp are
  // on the OLD row, so answering `false` here would send the leg down its
  // skipped-tail branch and mark a whole, stamped take `tailIncomplete` — a row
  // that contradicts itself, and reads 途中 to the human looking at it.
  it('a take id that changes AFTER the write keeps the OLD take whole, stamped and unmarked', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)

    slowSegmentWrites = true
    globalRecorder.stop()
    await drain(200) // the tail transaction is parked on the timer
    expect(metaOf(takeId).stopPendingAt).toEqual(expect.any(Number))

    void globalRecorder.start({ target: TARGET }) // the next customer
    await drain(200)
    const next = globalRecorder.takeId!
    expect(next).not.toBe(takeId)

    await jest.advanceTimersByTimeAsync(0)
    await drain(400)

    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    expect(metaOf(takeId).stopPendingAt).toBeUndefined()
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length + 'TAIL'.length)
    expect(putBodies.at(-1)!.size).toBe('aaa'.length + 'TAIL'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))

    // …and the counters below the branch still belong to the NEW take: its
    // first flush is seq 0, not a continuation of the old take's.
    slowSegmentWrites = false // …and the queue is handed back to the next test
    pushChunk('bbb')
    await jest.advanceTimersByTimeAsync(5_000)
    await drain(200)
    expect(metaOf(next).lastSeq).toBe(0)
  })

  // ── ⚖ THE STAMP IS THE TRUTH ABOUT THE DISK (fix round 19, AI1) ─────────
  // The same tap sequence one write EARLIER. Nothing is pending at the stop, so
  // the first act stamps — the disk was whole at that instant, and the segments
  // are already written, so no later tap can undo it. A start() landing inside
  // that write used to leave the flush behind it reading a changed id, and the
  // leg's skipped-tail branch wrote `tailIncomplete` over the stamp: one row
  // holding both facts, which isStoppedTake reads FLAG-first — so a complete
  // recording was on nobody's worklist and told the staffer it ended partway.
  //
  // ⚖ REWRITTEN ON THE NEW TRUTH (fix round 20). The flush behind the stamp
  // reads THIS take's own array now, finds the nothing that was there at the
  // stop, and answers `true` — so the leg does not take its skipped-tail exit
  // at all: it secures the take, then and there, while the next customer
  // records. The claim in the title survives untouched and is simply stronger.
  it('a take its own first act STAMPED is whole — and the flush behind it says so', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // seq 0 committed: the disk is whole
    order.length = 0

    /** The page's subscription in miniature — the edge it schedules its drain
     *  on, and the only thing that tells it this take is owed (round 17, AE2). */
    const settleEdges: number[] = []
    let wasSecuring = globalRecorder.isSecuring()
    const unsubscribe = globalRecorder.subscribe(() => {
      const securing = globalRecorder.isSecuring()
      if (wasSecuring && !securing) settleEdges.push(Date.now())
      wasSecuring = securing
    })

    emptyTailChunk = true // …so the stop has nothing left to write
    hangStampWrites = true // …and the first act's stamp is parked in flight
    globalRecorder.stop()
    await drain(200)
    expect(metaOf(takeId).durationMs).toBeUndefined() // still in flight

    void globalRecorder.start({ target: TARGET }) // 停止 → 録音, the next customer
    await drain(200)
    expect(globalRecorder.takeId).not.toBe(takeId)

    releaseHungWrites() // the stamp lands on the OLD row; the flush runs behind it
    await drain(400)
    unsubscribe()

    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
    expect(metaOf(takeId).stopPendingAt).toBeUndefined()
    expect(stampWrites).toEqual([0]) // one write carried it, the first act's
    // …and the leg took the WHOLE-take exit: it secured the recording itself,
    // rather than leaving it for a drain to find.
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
    expect(putBodies.at(-1)!.size).toBe('aaa'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    expect(settleEdges).toHaveLength(1) // the edge the page drains on, still one
    // Nothing was deleted either: the whole recording is on the device.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
  })

  // ── ⚖ THE STOP LEG OWNS ITS TAKE'S STATE (fix round 20, AK1) ────────────
  // GREPTILE'S OWN INTERLEAVING, which is the one window the two rounds above
  // left: the queue tail is BUSY at the stop (a segment write in flight), so
  // the first act has not run yet when the staffer taps 録音開始. It used to
  // read `this.takeId`, `this.persistDisabled`, `this.chunks` and
  // `this.persistedChunkCount` at RUN time — every one of them already the NEXT
  // recording's — so a take whose disk was whole was written down as a stop
  // still in flight, and the flush behind it then marked it 途中: withheld from
  // every automatic drain, device-only, 「途中で終わっています」 to the staffer.
  it('a first act that runs AFTER the next recording began still reads ITS take', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    hangSegmentWrites = true // the beat's segment write never answers…
    await jest.advanceTimersByTimeAsync(5_000) // …so the queue tail is busy
    await drain(50)
    hangSegmentWrites = false // (only that one)
    expect(metaOf(takeId).lastSeq).toBe(-1) // nothing committed yet
    order.length = 0

    emptyTailChunk = true // nothing pending at the stop: the disk IS whole
    globalRecorder.stop()
    await drain(200) // the first act and the tail flush queue BEHIND the hang

    void globalRecorder.start({ target: TARGET }) // 停止 → 録音, the next customer
    await drain(200)
    const next = globalRecorder.takeId!
    expect(next).not.toBe(takeId)
    pushChunk('bbb') // …and that customer is already being recorded

    releaseHungWrites() // now the queue drains: the segment, then the first act
    await drain(400)

    // Read `this.persist` in the first act instead of the captured object and
    // the new take's un-flushed chunk answers for the old take: a stop still in
    // flight, and the whole recording refused by both worklists.
    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    expect(metaOf(takeId).stopPendingAt).toBeUndefined()
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()
    expect(stampWrites).toEqual([0])
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))

    // …and the new take's own object starts where a new take starts.
    await jest.advanceTimersByTimeAsync(5_000)
    await drain(200)
    expect(metaOf(next).lastSeq).toBe(0)
    expect((await loadTakeBlob(next))?.size).toBe('bbb'.length)
  })

  // A LIVE discard with a flush already in the queue. The reasoned discard
  // (A2-2) KEEPS the audio — it still owes its words to the discard record —
  // so the queued flush must land the chunks it was queued with, under the id
  // it was queued with. It used to find `chunks` emptied and the id nulled and
  // write nothing at all.
  it('a discard mid-queue: the flush still writes the discarded take\'s own chunks', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    hangSegmentWrites = true
    await jest.advanceTimersByTimeAsync(5_000) // flush #1's write hangs
    await drain(50)
    hangSegmentWrites = false
    pushChunk('bbb')
    await jest.advanceTimersByTimeAsync(5_000) // flush #2 queues behind it

    globalRecorder.discard({ keepTake: true }) // 破棄 with the words still owed
    expect(globalRecorder.takeId).toBeNull()
    releaseHungWrites()
    await drain(400)

    // Both chunks, under the discarded take's own id — nothing thrown, and
    // nothing written under the recorder's (now absent) one.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length + 'bbb'.length)
    expect(metaOf(takeId).lastSeq).toBe(1)

    // …and the recorder's own state is a FRESH object, not the discarded
    // take's counters: the next recording flushes at seq 0.
    const next = await startAndSettle()
    pushChunk('ccc')
    await jest.advanceTimersByTimeAsync(5_000)
    await drain(200)
    expect(metaOf(next).lastSeq).toBe(0)
    expect((await loadTakeBlob(next))?.size).toBe('ccc'.length)
  })

  // The create's verdict is about ITS take's row. It answers after a store
  // round trip, so the staffer can be recording the next customer by then —
  // and `persistDisabled` was a singleton, so a create that failed for a take
  // already gone took the LIVE recording's persistence down with it.
  it('a createTake that fails disables its own take only, not the one now recording', async () => {
    hangNextCreates = 1
    const gone = await startAndSettle() // its row write is parked
    const live = await startAndSettle() // the next customer; this row lands
    expect(live).not.toBe(gone)
    pushChunk('bbb')

    failWrites = true // …and the parked create answers, having failed
    releaseHungWrites()
    failWrites = false
    await drain(200)

    await jest.advanceTimersByTimeAsync(5_000)
    await drain(200)
    // Write the failure to `this.persist` and the live recording is memory-only
    // from here on, for a take it never had anything to do with.
    expect((await loadTakeBlob(live))?.size).toBe('bbb'.length)
    expect(metaOf(live).lastSeq).toBe(0)
    expect(takes().get(JSON.stringify(gone))).toBeUndefined()
  })

  // …and the OTHER half of that reply keeps its guard, because it does not read
  // the take's own state: `recordingSessionId` is the SINGLETON's, and by the
  // time a parked create answers, start() has nulled it and the next mint may
  // have filled it in. Stamping there would point one recording's audio at the
  // next recording's row.
  it('a create that answers late never stamps the NEXT recording\'s session on it', async () => {
    hangNextCreates = 1
    const gone = await startAndSettle() // no session: the door answers null
    mockStartRecordingSession.mockImplementationOnce(async () => ({ id: 'session-B' }))
    const live = await startAndSettle()
    expect(globalRecorder.recordingSessionId).toBe('session-B')

    releaseHungWrites() // the parked create lands, and its reply runs now
    await drain(400)

    // The row is the one the create wrote: born with no session, and still
    // carrying none. Drop the guard and it carries `session-B`.
    expect(metaOf(gone).recordingSessionId).toBeNull()
    expect(metaOf(live).recordingSessionId).toBe('session-B')
  })

  // ⚖ AI1's brace, pinned where it now lives (fix round 20). A row that is
  // stamped AND 途中 is unreachable from the recorder since this round — the
  // first act only stamps when nothing is pending, and the flush behind a
  // nothing answers `true` — so the guard that refuses it is belt, and belt
  // with no mutation behind it is not shipped. This is the claim itself, at
  // the store, one transaction wide.
  it('markTakeTailIncomplete refuses a take that already carries its duration', async () => {
    const takeId = await stoppedTake()
    expect(metaOf(takeId).durationMs).toEqual(expect.any(Number))
    await markTakeTailIncomplete(takeId)
    expect(metaOf(takeId).tailIncomplete).toBeUndefined()

    // …and it still marks the take the flag is FOR: one with no stamp on it.
    const unstamped = await startAndSettle()
    await markTakeTailIncomplete(unstamped)
    expect(metaOf(unstamped).tailIncomplete).toBe(true)
  })

  // ── ⚖ THE SINGLETON ANSWERS FOR ITS OWN TAKE ONLY (fix round 18, AH1) ────
  // AF1 made the recovery / 録音履歴 保存する path the first caller to hand this
  // method a FOREIGN take id, and it answered the singleton's session before it
  // read the take it was asked about — then wrote every mint back onto that
  // singleton. Recover A, recover B, and B's save carried A's session: the
  // server-job path finds that row already done and deletes B's local audio
  // against A's record. The mirror is worse still — a foreign mint parked on
  // the singleton is what the recorder's OWN stopped take reads at its save.

  /** A door that NAMES every row it mints, so "whose session is this?" is
   *  provable rather than one constant echoed back at every caller. */
  const namedSessions = () => {
    let n = 0
    mockStartRecordingSession.mockImplementation(async () => ({ id: `sess-${++n}` }))
  }

  it("a recovered take never carries another take's session — the singleton speaks for its own", async () => {
    // Two takes from an earlier device life, neither ever stamped (the default
    // door answers null, which is exactly why the retry path exists).
    const a = await keptTake()
    const b = await keptTake()
    expect(metaOf(a).recordingSessionId).toBeFalsy()

    // …and a recorder holding a session of its own, which is what the fixture
    // was missing: the short-circuit is only reachable with a non-null field.
    namedSessions()
    await startAndSettle()
    await drain(50)
    expect(await globalRecorder.awaitRecordingSessionId()).toBe('sess-1')

    const idA = await globalRecorder.retryRecordingSessionMint({
      takeId: a,
      customerId: 'cust-1',
      appointmentId: null,
    })
    const idB = await globalRecorder.retryRecordingSessionMint({
      takeId: b,
      customerId: 'cust-1',
      appointmentId: null,
    })
    // Restore the unconditional short-circuit and BOTH of these are 'sess-1' —
    // the recorder's own session, handed to two other takes.
    expect(idA).toBe('sess-2')
    expect(idB).toBe('sess-3')
    expect(metaOf(a).recordingSessionId).toBe('sess-2')
    expect(metaOf(b).recordingSessionId).toBe('sess-3')
  })

  it("a recovered take's mint never becomes the RECORDER's own session", async () => {
    const b = await keptTake()
    // The recorder's own start-mint failed — offline, core 5xx: the case the
    // whole retry path exists for, and the one where the field is null and its
    // promise is settled null, so both halves of the write are readable.
    await startAndSettle()
    expect(await globalRecorder.awaitRecordingSessionId()).toBeNull()

    namedSessions()
    expect(
      await globalRecorder.retryRecordingSessionMint({
        takeId: b,
        customerId: 'cust-1',
        appointmentId: null,
      }),
    ).toBe('sess-1')
    expect(metaOf(b).recordingSessionId).toBe('sess-1')

    // Drop either half of the write guard — the field or the parked promise —
    // and this answers 'sess-1': the live recording's karute filed against a
    // recovered take's row.
    expect(await globalRecorder.awaitRecordingSessionId()).toBeNull()
  })

  // AF1's own target, which the read used to defeat outright: a take the mount
  // drain's session-first leg already stamped was never even looked at.
  it('a take the DRAIN stamped is read from ITS row, singleton or not', async () => {
    const b = await keptTake()
    await stampTakeSession(b, 'rs-drained')

    namedSessions()
    await startAndSettle()
    await drain(50)
    expect(await globalRecorder.awaitRecordingSessionId()).toBe('sess-1')
    const mintsBefore = mockStartRecordingSession.mock.calls.length

    expect(
      await globalRecorder.retryRecordingSessionMint({
        takeId: b,
        customerId: 'cust-1',
        appointmentId: null,
      }),
    ).toBe('rs-drained')
    // Nothing was minted for it — the row already answered.
    expect(mockStartRecordingSession).toHaveBeenCalledTimes(mintsBefore)
  })

  // ── ⚖ AND 録音履歴 READS THE STOP FACTS THROUGH THE STORE (round 18, AH2) ─
  // Both fields are optional on RecoverableTake, so listOwnTakes dropping them
  // type-checked in silence: the refusing half of rounds 16/17 worked and the
  // TELLING half — the sub-line a staffer reads — could never fire in
  // production. The existing derivation tests build their takes by hand and are
  // blind to it by construction.

  /** The inbox's own read, in one line: exactly the projection
   *  inbox-store.readLocalTakes makes from what the store hands back. */
  const asInboxTake = (t: {
    takeId: string
    recordingSessionId?: string | null
    startedAt: number
    updatedAt: number
    tailIncomplete?: boolean
    stopPendingAt?: number
  }): InboxLocalTake => ({
    takeId: t.takeId,
    recordingSessionId: t.recordingSessionId ?? null,
    customerId: null,
    customerName: null,
    startedAt: t.startedAt,
    updatedAt: t.updatedAt,
    tailIncomplete: t.tailIncomplete,
    stopPendingAt: t.stopPendingAt,
  })

  it('録音履歴 reads a lost tail THROUGH the store, not from a hand-built take', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    failNextSegmentWrites = 1 // the tail write is refused: the tail is skipped
    globalRecorder.stop()
    await drain(200)
    await jest.advanceTimersByTimeAsync(0)
    await drain(200)
    expect(metaOf(takeId).tailIncomplete).toBe(true)

    await passGrace()
    const listed = (await listOwnTakes()).find((t) => t.takeId === takeId)!
    expect(listed.tailIncomplete).toBe(true)
    const [row] = deriveInboxRows({
      sessions: [],
      takes: [asInboxTake(listed)],
      now: Date.now(),
    })
    expect(row.state).toBe('recoverable')
    expect(row.reason).toBe('tailIncomplete')
  })

  it('…and a stop that never finished, the same way', async () => {
    const takeId = await keptTake()
    await markTakeStopPending(takeId)
    await passGrace()

    const listed = (await listOwnTakes()).find((t) => t.takeId === takeId)!
    expect(listed.stopPendingAt).toEqual(expect.any(Number))
    const [row] = deriveInboxRows({
      sessions: [],
      takes: [asInboxTake(listed)],
      now: Date.now(),
    })
    expect(row.reason).toBe('tailIncomplete')
  })

  // Bytes are never gated on what a surface may SHOW: a discarded take still
  // owes its words to the discard record, so its audio must still reach the
  // server. (The offer read excludes it — that is a different question.)
  it('a discarded take still owes its bytes — the drain names it', async () => {
    const takeId = await stoppedOwedTake()
    await stampDiscardPending(takeId, {
      recordingSessionId: 'rs-1',
      durationSeconds: 60,
      locale: 'ja',
      stampedAt: Date.now(),
    })
    await passGrace()
    expect(await getRecoverableTake([])).toBeNull() // never re-offered
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId]) // still sent
  })
})
