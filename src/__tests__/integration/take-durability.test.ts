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
  stampTakeSession,
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
      startBoundAttempted?: boolean
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
    expect(putBodies[0].size).toBe('aaa'.length + 'TAIL'.length)
    expect(metaOf(takeId).finalizedAt).toEqual(expect.any(Number))
  })

  // ⚖ A SKIPPED TAIL SEALS NOTHING (fix round 7, P1). The tail flush is queued
  // at stop; start() empties `chunks` SYNCHRONOUSLY and only takes its new take
  // id once the mic is live, so the queued task could find nothing pending and
  // report "written" for a take whose last chunks it never wrote. onstop then
  // stamped and secured a SHORT blob under the immutable finalized key — the
  // rest of that recording could never land afterwards.
  it('the next customer starts before the tail lands: the short take is never stamped, never sealed', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000) // one segment on disk
    pushChunk('bbb') // …and this one is still memory-only

    slowSegmentWrites = true
    globalRecorder.stop()
    // The staffer is already recording the next customer.
    void globalRecorder.start({ target: TARGET })
    await drain(200)
    await jest.advanceTimersByTimeAsync(0)
    await drain(200)

    // Nothing was sent, and the take carries NO stop stamp — so the mount drain
    // will not touch it either (PR5's launch drain rules on unstamped takes).
    expect(order).toEqual([])
    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
    // The audio that did land is untouched — nothing here deletes.
    expect((await loadTakeBlob(takeId))?.size).toBe('aaa'.length)
  })

  // The same window, the other way out of it: the stop is handed to the
  // pipeline (or a reasoned discard), which KEEPS the audio and nulls the
  // recorder's take id. The queued tail is skipped just the same.
  it('a stop handed straight to the pipeline (keepTake) is not sealed by a skipped tail', async () => {
    const takeId = await startAndSettle()
    pushChunk('aaa')
    await jest.advanceTimersByTimeAsync(5_000)
    pushChunk('bbb')

    slowSegmentWrites = true
    globalRecorder.stop()
    globalRecorder.discard({ keepTake: true })
    await drain(200)
    await jest.advanceTimersByTimeAsync(0)
    await drain(200)

    expect(order).toEqual([])
    expect(metaOf(takeId).durationMs).toBeUndefined()
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
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
  it('a zero-byte take is not uploaded — and is not marked failed either', async () => {
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
    // Not an error: there is simply nothing to send yet.
    expect(metaOf(takeId).secureError).toBeUndefined()
    expect(metaOf(takeId).finalizedAt).toBeUndefined()
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
  const mountDrain = async () => {
    // The component's own two arguments: no recorder duration (this leg has no
    // recorder) and the singleton's live-take probe.
    const isActive = (id: string) => globalRecorder.isActiveTake(id)
    for (const id of await listOwnStoppedUnsecuredTakeIds())
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
    expect(order).toEqual(['session', 'mint', 'put', 'finalize'])
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
