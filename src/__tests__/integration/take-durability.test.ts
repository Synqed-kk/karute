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
  async (): Promise<{ id: string } | null> => null,
)
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: () => mockStartRecordingSession(),
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
  constructor(exec: () => T, slow = false) {
    const settle = () => {
      try {
        this.result = exec()
        this.onsuccess?.()
      } catch (e) {
        this.error = e
        this.onerror?.()
      }
    }
    if (slow) setTimeout(settle, 0)
    else queueMicrotask(settle)
  }
}

const SEGMENTS_STORE = 'segments'

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
    return {
      objectStore: (n: string) => {
        const s = this.stores.get(n)!
        return {
          put: (row: Row) =>
            new FakeRequest(
              () => {
                if (failWrites) throw new Error('idb write failure (test)')
                s.data.set(s.keyOf(row), row)
              },
              slowSegmentWrites && n === SEGMENTS_STORE,
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
      this.ondataavailable?.({ data: new Blob(['TAIL']) })
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
  readTakeOutcome,
  readTakeSecureMeta,
  stampDiscardPending,
  stampTakeDuration,
  stampTakeOutcome,
} from '@/lib/karute/take-store'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'
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
/** The row the door RESERVES for a take that names none — the id the device has
 *  never seen, so "the minted id is stamped" is provable rather than an echo. */
const MINTED_SESSION = 'rs-reserved-by-the-mint'
/** What the SERVER would compose for this take (mint-take-url.ts →
 *  composeTakeKey): the codec parameters are stripped, and BOTH the extension
 *  and the content type come off the same closed map — so the recorder's
 *  `audio/webm;codecs=opus` becomes an `audio/webm` object under a `.webm`
 *  name, which is the mislabelling bug dying.
 *
 *  The reply also names the row the key is now BOUND to (PR2 fix round 4): the
 *  caller's own session when it named one, and a row the mint created when it
 *  did not — the two branches reserveTakeForRecorder actually has. */
function mintedFor(takeId: string, mimeType: string, recordingSessionId: string | null) {
  const contentType = normalizeAudioMime(mimeType) ?? 'audio/webm'
  const ext = extFromMime(contentType) ?? 'webm'
  return {
    path: `app_biz-1_${takeId}.${ext}`,
    url: `https://proj.supabase.co/upload/app_biz-1_${takeId}.${ext}?token=up`,
    contentType,
    recordingSessionId: recordingSessionId ?? MINTED_SESSION,
  }
}
/** Composes the key the SERVER would compose (same closed MIME map), so the
 *  container the client sends is provable from the name that comes back. */
const mintTakeUrl = jest.fn(
  async (
    takeId: string,
    mimeType: string,
    recordingSessionId: string | null,
  ): Promise<MintTakeUrlPortResult> => {
    order.push('mint')
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

beforeEach(async () => {
  // The IDB shim resolves via queueMicrotask — modern fake timers fake it by
  // default, which would deadlock every store call.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
  jest.clearAllMocks()
  order.length = 0
  putBodies.length = 0
  mintTakeUrl.mockImplementation(
    async (takeId: string, mimeType: string, recordingSessionId: string | null) => {
      order.push('mint')
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
    await expect(
      stampTakeOutcome(takeId, { status: 'pending' }),
    ).resolves.toBeUndefined()
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
    expect(order).toEqual(['mint', 'put', 'finalize'])
    // The tail flush landed BEFORE the read-back: the uploaded object carries
    // the final 'TAIL' chunk, not just the 5 s segment.
    expect(putBodies[0].size).toBe('aaa'.length + 'TAIL'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
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
      // one the MINT reserved a moment earlier.
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

    expect(order).toEqual(['mint', 'put'])
    expect(finalizeTake).not.toHaveBeenCalled()
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    expect(metaOf(takeId).secureError).toBe('upload_503')
    // The audio is untouched — nothing here deletes.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length + 'TAIL'.length)
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

    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(finalizeTake).toHaveBeenCalledWith(
      expect.objectContaining({ takeId, byteLength: 'aaa'.length + 'TAIL'.length }),
    )
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
    expect(metaOf(takeId).secureError).toBeUndefined()
  })

  it("finalize 'busy' is recorded and stays RETRYABLE — the next attempt runs the whole leg again", async () => {
    finalizeTake.mockImplementation(async () => {
      order.push('finalize')
      return { error: 'busy' } as unknown as { ok: true; recordingSessionId: string }
    })
    const takeId = await stoppedTake()
    expect(metaOf(takeId).secureError).toBe('busy')
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
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true }) // leave the take, no onstop
    await drain()

    await Promise.all([secureTake(port(), takeId), secureTake(port(), takeId)])
    expect(order).toEqual(['mint', 'put', 'finalize'])
  })

  it('a take stamped before mimeType existed falls back to audio/webm — and to a .webm key', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
    delete metaOf(takeId).mimeType

    await secureTake(port(), takeId)
    expect(mintTakeUrl).toHaveBeenCalledWith(takeId, 'audio/webm', null)
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
    await markTakeSecureError(takeId, 'busy')
    order.length = 0

    mockUid = 'staff-B'
    await secureTake(port(), takeId)
    expect(order).toEqual([])
    // A null meta read is "not mine / not there", never "it failed" — writing a
    // code here would let one staffer scribble on another's row, and would
    // overwrite the only record of why the owner's attempt stopped.
    expect(metaOf(takeId).secureError).toBe('busy')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
  })

  // ── The take has no bytes ─────────────────────────────────────────────────
  it('a zero-byte take is not uploaded — and is not marked failed either', async () => {
    const takeId = await keptTake()
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
    // Not an error: there is simply nothing to send yet.
    expect(metaOf(takeId).secureError).toBeUndefined()
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
  })

  // ── The session id the MINT reserved ──────────────────────────────────────
  // When the start-mint failed the take carries no session, so the MINT creates
  // the row (fix round 4 — it binds the key before a byte can exist) and hands
  // back its id. Throw that id away and the recorder's own retry mints a SECOND
  // row: the audio pointer lands on one, the karute on the other.
  it("the mint's own reserved session lands on the take, and the mint retry then mints NOTHING", async () => {
    const takeId = await keptTake()
    expect(metaOf(takeId).recordingSessionId).toBeNull() // the start-mint failed

    await secureTake(port(), takeId)
    expect(mintTakeUrl).toHaveBeenCalledWith(takeId, expect.any(String), null)
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

  // THE ORDER THIS ROUND EXISTS FOR. The server has already written the key onto
  // the row by the time it answers, so the device's copy of that binding must be
  // on disk BEFORE the bytes go out: a kill between the PUT and the finalize
  // otherwise leaves uploaded audio whose retry cannot name its own row.
  it('the reserved session is stamped on the take BEFORE the bytes go out', async () => {
    const takeId = await keptTake()
    let sessionAtPut: string | null | undefined
    putMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      order.push('put')
      putBodies.push(init?.body as Blob)
      sessionAtPut = metaOf(takeId).recordingSessionId
      return { ok: true, status: 200 } as unknown as Response
    })

    await secureTake(port(), takeId)
    expect(sessionAtPut).toBe(MINTED_SESSION)
    expect(metaOf(takeId).recordingSessionId).toBe(MINTED_SESSION)
  })

  // The other branch: a take that ALREADY has a row names it, and the reply
  // never re-points it — that row is what its discard and its karute write on.
  it("the mint is told the take's OWN session when it has one, and it is not re-pointed", async () => {
    mockStartRecordingSession.mockResolvedValueOnce({ id: 'sess-1' })
    const takeId = await stoppedTake()

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

    expect(order).toEqual(['mint'])
    expect(finalizeTake).not.toHaveBeenCalled()
    expect(metaOf(takeId).secureError).toBe('exists')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    // The audio is untouched — nothing here deletes — but the drain is done
    // asking for it.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length + 'TAIL'.length)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])
  })

  // Impossible against the real door (a client-named mint always reserves a
  // row), which is exactly why it must not upload BLIND if it ever happens:
  // finalize requires the id, so those bytes could never be claimed.
  it('a mint that reserved NO row is terminal — the bytes never go out', async () => {
    mintTakeUrl.mockImplementation(async (takeId: string, mimeType: string) => {
      order.push('mint')
      return { ...mintedFor(takeId, mimeType, null), recordingSessionId: null }
    })
    const takeId = await stoppedTake()

    expect(order).toEqual(['mint'])
    expect(metaOf(takeId).secureError).toBe('no_session')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])
  })

  // ── Refusals that can never turn into a yes ───────────────────────────────
  it('a TERMINAL refusal is never retried — no mint, no whole-take re-PUT', async () => {
    const takeId = await keptTake()
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
      'no_session',
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
    const takeId = await keptTake()
    // finalize keeps refusing, so each turn is judged on the code under test
    // rather than on a finalizedAt the previous turn wrote.
    finalizeTake.mockImplementation(async () => {
      order.push('finalize')
      return { error: 'busy' } as unknown as { ok: true; recordingSessionId: string }
    })
    for (const code of [
      'busy',
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

  it('a take with no stamped duration still falls back to the flush window (pre-PR3 rows)', async () => {
    const takeId = await keptTake()
    expect(metaOf(takeId).durationMs).toBeUndefined()
    await secureTake(port(), takeId)
    expect(lastFinalized().durationSeconds).toBeCloseTo(
      (metaOf(takeId).updatedAt - metaOf(takeId).startedAt) / 1000,
      1,
    )
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
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    globalRecorder.discard({ keepTake: true })
    await drain()
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
  const mountDrain = async () => {
    // The component's own two arguments: no recorder duration (this leg has no
    // recorder) and the singleton's live-take probe.
    const isActive = (id: string) => globalRecorder.isActiveTake(id)
    for (const id of await listOwnStoppedUnsecuredTakeIds())
      await secureTake(port(), id, undefined, isActive)
  }

  it('a reload INSIDE the 20 s grace still secures the take the recovery read hides', async () => {
    // The stop's own upload dies (phone locked, tunnel gone).
    putMock.mockImplementation(async () => {
      order.push('put')
      return { ok: false, status: 503 } as unknown as Response
    })
    const takeId = await stoppedTake()
    expect(metaOf(takeId).secureError).toBe('upload_503')
    expect(metaOf(takeId).finalizedAt).toBeUndefined()

    // The page is reloaded 5 s later — well inside the grace.
    await jest.advanceTimersByTimeAsync(5_000)
    // The offer read says there is nothing (and the fresh recorder has no take
    // of its own), which is exactly why the drain must not ask it.
    expect(await getRecoverableTake([])).toBeNull()
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([takeId])

    putMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      order.push('put')
      putBodies.push(init?.body as Blob)
      return { ok: true, status: 200 } as unknown as Response
    })
    order.length = 0
    await mountDrain()
    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ── ⚖ STOPPED ONLY (fix round 5) ─────────────────────────────────────────
  // The drain used to name any un-finalized take with bytes on disk. That
  // included takes STILL RECORDING — this tab remounting, another same-origin
  // tab, a paused session — and a finalized key is IMMUTABLE: sealing the
  // segments flushed so far means the rest of the recording can never land.
  // No age or grace window can stand in for the stop, either: a paused take
  // flushes nothing, so it looks stale within seconds. Only the stop stamp
  // (stampTakeDuration, written at onstop) proves a take is complete.
  it('the drain is STOPPED-ONLY: a stale unstopped take is skipped, a fresh stopped one is taken', async () => {
    const running = await keptTake() // no onstop, so no stop stamp
    expect(metaOf(running).durationMs).toBeUndefined()
    await jest.advanceTimersByTimeAsync(60_000) // a minute of silence proves nothing
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([])

    // A take a recorder DID stop, flushed seconds ago: no grace to wait out.
    const stopped = await stoppedOwedTake()
    expect(Date.now() - metaOf(stopped).updatedAt).toBeLessThan(20_000)
    expect(await listOwnStoppedUnsecuredTakeIds()).toEqual([stopped])

    order.length = 0
    await mountDrain()
    expect(order).toEqual(['mint', 'put', 'finalize'])
    expect(metaOf(stopped).finalizedAt).toEqual(expect.any(Number))
    // The unstopped one is untouched — still on the device, still un-finalized,
    // and NOT marked failed: it is unfinished, not broken. It waits for PR5's
    // launch drain, where the single-webview shell proves nothing is live.
    expect(metaOf(running).finalizedAt).toBeUndefined()
    expect(metaOf(running).secureError).toBeUndefined()
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
    expect(order).toEqual(['mint', 'put', 'finalize'])
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
    await markTakeSecureError(owed, 'busy') // retryable — the moment passed

    expect(takes().size).toBe(4)
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
