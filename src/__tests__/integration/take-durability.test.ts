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
  constructor(exec: () => T) {
    queueMicrotask(() => {
      try {
        this.result = exec()
        this.onsuccess?.()
      } catch (e) {
        this.error = e
        this.onerror?.()
      }
    })
  }
}

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
            new FakeRequest(() => {
              if (failWrites) throw new Error('idb write failure (test)')
              s.data.set(s.keyOf(row), row)
            }),
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
  loadTakeBlob,
  stampTakeOutcome,
} from '@/lib/karute/take-store'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'

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
  mockUid = 'staff-A'
  failWrites = false
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

  it('expired takes (24 h TTL) are dropped and deleted in passing', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    // Age the take past the TTL directly in the store.
    const key = JSON.stringify(takeId)
    const meta = takes().get(key)!
    takes().set(key, {
      ...meta,
      startedAt: Date.now() - 25 * 60 * 60 * 1000,
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
    })
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
