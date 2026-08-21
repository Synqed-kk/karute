'use client'

/**
 * IndexedDB persistence for in-flight recording takes ("take durability").
 *
 * A 60–90 min session recording lives entirely in JS memory from mic-start
 * until the karute record is saved — a WKWebView kill, tab reload, crash, or
 * OS suspension anywhere in that window loses the audio with no recovery.
 * GlobalRecorder flushes captured audio here in ~5 s segments; the take stays
 * until the karute record is SAVED (not merely handed to the pipeline), so a
 * reload during transcription can re-offer the persisted audio too.
 *
 * PRIVACY (shared salon device): a take is customer audio. Exactly like
 * lib/karute/draft.ts, the owner check lives at THIS layer — the single choke
 * point — not in components. A take is stamped with the auth user who recorded
 * it and only ever returned to that same signed-in user; no user resolvable
 * (thin bundle's null-session stub, signed out) → nothing is persisted or
 * returned (fail-closed). clearOwnTakes() on logout deletes the leaving
 * user's takes (other owners' survive — see its doc).
 *
 * DURABILITY INVARIANT: this layer is best-effort and must NEVER block or
 * break capture. Every function swallows its errors — a failure just means
 * the recording continues memory-only, exactly as before this file existed.
 * IndexedDB is the only browser store that holds multi-MB blobs and works
 * identically in Safari and the WKWebView shell.
 */

import { currentUserId } from '@/lib/karute/draft'
import type { RecordingTarget } from '@/lib/global-recorder'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

const DB_NAME = 'karute_takes'
const TAKES = 'takes'
const SEGMENTS = 'segments'
/** How long a take stays recoverable. 7 days (⚖ Liam 2026-08-25, R2): at 24 h
 *  a crash on Friday evening was unrecoverable by Saturday's shift, and the
 *  録音履歴 inbox now SHOWS those takes as 復元可能 — a window shorter than the
 *  inbox's would offer a row whose audio had already been swept. Read-time
 *  prune only (getRecoverableTake/listOwnTakes), so this constant is the whole
 *  lifetime rule; nothing else reads it. */
const TAKE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** A take flushed within this window may belong to a LIVE session in another
 *  same-origin tab (IndexedDB is shared; the caller's exclude list only knows
 *  its own tab's singletons). Live takes flush every ~5 s, so anything quiet
 *  for 20 s is genuinely orphaned. Recovery waits out the grace rather than
 *  offering — and letting a save delete — another tab's in-progress audio. */
const ACTIVE_GRACE_MS = 20_000

export type TakeMeta = {
  takeId: string
  /** Auth user id (Supabase auth.uid) of the staff member who recorded it. */
  ownerUid: string
  target: RecordingTarget | null
  /** Server-minted recording_sessions id — carried so a recovered save still
   *  dedupes via core's unique FK on karute_records.recording_session_id. */
  recordingSessionId: string | null
  mimeType: string
  startedAt: number
  /** Bumped on every segment flush — TTL anchor + rough duration estimate. */
  updatedAt: number
  /** Highest persisted segment seq; -1 until the first flush lands. */
  lastSeq: number
  /** R-B3: the 結果 answer, stamped HERE the moment staff answer it. Without
   *  it the answer rides only the in-memory pipeline context
   *  (global-pipeline.ts), so a crash between the money writes (already
   *  durable server-side) and the karute save loses it and recovery re-asks.
   *  Absent = never answered — the app NEVER invents an outcome. */
  outcome?: SessionOutcome
  /** True when the stop flow deliberately skipped the question (自動 mid-pack
   *  flow / tickets off) — the pipeline's isServerJobEligible reads it the
   *  same way `outcome` is read. */
  outcomeSkipped?: boolean
  /** F-3: which of the answer's MONEY LEGS provably finished. A retry after a
   *  failed karute save re-runs only what is still 'pending', so a settled
   *  pack sale is never minted twice and a transiently-failed burn is never
   *  lost in silence. Absent on takes stamped before this field existed —
   *  read as "no legs pending", which is the old all-or-nothing behavior. */
  outcomeLegs?: { burn: 'none' | 'pending' | 'done'; pack: 'none' | 'pending' | 'done' }
  /** The 新しい回数券 the staffer registered, kept ONLY while its leg is still
   *  pending. `outcomeLegs.pack === 'pending'` says a sale is owed; without the
   *  numbers a reload could not re-run it, so the sale was silently dropped and
   *  the karute saved anyway. Cleared to null the moment the leg is done, so a
   *  later crash can never re-mint from a stale payload. */
  outcomeNewPack?: { size: number; unitPrice: number } | null
}

/** What the recovery banner needs — everything except the audio itself. */
export type RecoverableTake = Omit<TakeMeta, 'ownerUid' | 'lastSeq'>

type SegmentRow = { takeId: string; seq: number; blob: Blob }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

let dbPromise: Promise<IDBDatabase | null> | null = null

/** Open (once). Resolves null when IndexedDB is unavailable or the open
 *  fails — every caller treats null as "layer disabled". */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains(TAKES))
          db.createObjectStore(TAKES, { keyPath: 'takeId' })
        if (!db.objectStoreNames.contains(SEGMENTS))
          db.createObjectStore(SEGMENTS, { keyPath: ['takeId', 'seq'] })
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => {
        console.error('[take-store] open failed:', open.error)
        resolve(null)
      }
      open.onblocked = () => resolve(null)
    } catch (err) {
      console.error('[take-store] open threw:', err)
      resolve(null)
    }
  })
  return dbPromise
}

let persistRequested = false

/** Best-effort eviction guard — ask the browser to treat storage as
 *  persistent. Fired once; the answer doesn't gate anything. */
function requestPersistentStorage(): void {
  if (persistRequested) return
  persistRequested = true
  try {
    void navigator.storage?.persist?.().catch(() => {})
  } catch {
    /* unavailable — best-effort only */
  }
}

/**
 * Create the meta row for a new take. Resolves the owner HERE (store-layer
 * gate): no signed-in user → false, nothing written. Returns false on any
 * failure so the recorder disables persistence for this take (fail-open to
 * memory-only capture).
 */
export async function createTake(
  meta: Omit<TakeMeta, 'ownerUid' | 'updatedAt' | 'lastSeq'>,
): Promise<boolean> {
  try {
    const db = await openDb()
    if (!db) return false
    const uid = await currentUserId()
    if (!uid) return false
    requestPersistentStorage()
    const row: TakeMeta = {
      ...meta,
      ownerUid: uid,
      updatedAt: meta.startedAt,
      lastSeq: -1,
    }
    await req(db.transaction(TAKES, 'readwrite').objectStore(TAKES).put(row))
    return true
  } catch (err) {
    console.error('[take-store] createTake failed:', err)
    return false
  }
}

/**
 * Append one flushed segment (~5 s of audio) and bump the meta row. Returns
 * false on failure OR when the meta row is gone (logged out / discarded
 * mid-flight) — the recorder then disables persistence for this take.
 */
export async function appendTakeSegment(
  takeId: string,
  seq: number,
  blob: Blob,
): Promise<boolean> {
  try {
    const db = await openDb()
    if (!db) return false
    const tx = db.transaction([TAKES, SEGMENTS], 'readwrite')
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (!meta) return false
    await req(tx.objectStore(SEGMENTS).put({ takeId, seq, blob } satisfies SegmentRow))
    await req(
      tx.objectStore(TAKES).put({ ...meta, updatedAt: Date.now(), lastSeq: seq }),
    )
    return true
  } catch (err) {
    console.error('[take-store] appendTakeSegment failed:', err)
    return false
  }
}

/** Stamp the server-minted recording_sessions id once the mint resolves.
 *  Best-effort; no-op if the take is gone. */
export async function stampTakeSession(
  takeId: string,
  recordingSessionId: string,
): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const tx = db.transaction(TAKES, 'readwrite')
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (!meta) return
    await req(tx.objectStore(TAKES).put({ ...meta, recordingSessionId }))
  } catch (err) {
    console.error('[take-store] stampTakeSession failed:', err)
  }
}

/** R-B3: stamp the 結果 answer onto the take so recovery restores it instead of
 *  re-asking.
 *
 *  THE INVARIANT (fix round 1, A-3): a stamp means "this answer's MONEY PHASE
 *  COMPLETED" — not merely "the staffer picked something". Every call site
 *  therefore stamps only AFTER its burn/pack-create legs have settled. Stamping
 *  earlier would certify money that never moved: recovery reads a stamped take
 *  as already-resolved and skips the popup entirely, so a crash (or a failed
 *  burn) between the pick and the write would be permanently un-re-offerable.
 *
 *  Best-effort, no-throw, no-op-if-gone — same contract as stampTakeSession.
 *  B-5: only SUPPLIED fields are written, so a later partial stamp can never
 *  blank an answer already stored. */
export async function stampTakeOutcome(
  takeId: string,
  outcome: SessionOutcome | undefined,
  outcomeSkipped?: boolean,
  outcomeLegs?: TakeMeta['outcomeLegs'],
  /** null CLEARS it (the leg finished); undefined leaves it alone. */
  outcomeNewPack?: TakeMeta['outcomeNewPack'],
): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const tx = db.transaction(TAKES, 'readwrite')
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (!meta) return
    await req(
      tx.objectStore(TAKES).put({
        ...meta,
        ...(outcome === undefined ? {} : { outcome }),
        ...(outcomeSkipped === undefined ? {} : { outcomeSkipped }),
        ...(outcomeLegs === undefined ? {} : { outcomeLegs }),
        ...(outcomeNewPack === undefined ? {} : { outcomeNewPack }),
      }),
    )
  } catch (err) {
    console.error('[take-store] stampTakeOutcome failed:', err)
  }
}

/** F-2: read back a stamped answer by take id — the durable seam a recovered
 *  DRAFT uses (it carries the take id it deletes on save, so its answer can
 *  survive a reload too). Deliberately NOT owner-filtered differently from the
 *  rest of this module: same gate, same fail-closed null. */
export async function readTakeOutcome(takeId: string): Promise<
  Pick<TakeMeta, 'outcome' | 'outcomeSkipped' | 'outcomeLegs' | 'outcomeNewPack'> | null
> {
  try {
    const db = await openDb()
    if (!db) return null
    const uid = await currentUserId()
    if (!uid) return null
    const meta = (await req(
      db.transaction(TAKES).objectStore(TAKES).get(takeId),
    )) as TakeMeta | undefined
    if (!meta || meta.ownerUid !== uid) return null
    return {
      outcome: meta.outcome,
      outcomeSkipped: meta.outcomeSkipped,
      outcomeLegs: meta.outcomeLegs,
      outcomeNewPack: meta.outcomeNewPack,
    }
  } catch (err) {
    console.error('[take-store] readTakeOutcome failed:', err)
    return null
  }
}

/** Remove a take (meta + all segments). Called on successful karute save,
 *  explicit discard, and TTL expiry. */
export async function deleteTake(takeId: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const tx = db.transaction([TAKES, SEGMENTS], 'readwrite')
    await req(tx.objectStore(TAKES).delete(takeId))
    // ponytail: full getAll + filter — rows are few and blobs are lazy
    // handles; switch to IDBKeyRange.bound([takeId], [takeId, []]) on the
    // compound key if profiling ever cares.
    const segments = (await req(tx.objectStore(SEGMENTS).getAll())) as SegmentRow[]
    for (const s of segments) {
      if (s.takeId === takeId) await req(tx.objectStore(SEGMENTS).delete([s.takeId, s.seq]))
    }
  } catch (err) {
    console.error('[take-store] deleteTake failed:', err)
  }
}

/** Logout wipe — deletes the SIGNING-OUT user's takes only (call before
 *  supabase signOut, while their uid still resolves). Other staff members'
 *  takes are preserved: they are already invisible to everyone else (owner
 *  gate on every read path), and destroying them here would let staff B's
 *  logout erase staff A's crash-recovery audio — the exact loss this store
 *  exists to prevent. Their cleanup is the 24 h TTL. Unlike the draft
 *  (one shared key, wipe-all is the only option), takes carry ownerUid.
 *
 *  `explicitUid` (F3, packet 12 fix batch) overrides the currentUserId()
 *  read — for callers (thin/auth/session.ts's SIGNED_OUT listener) invoked
 *  AFTER the session that currentUserId() would read from has already been
 *  nulled. Omitted, this is identical to the original no-arg behavior. */
export async function clearOwnTakes(explicitUid?: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const uid = explicitUid ?? (await currentUserId())
    // uid unresolvable (session already expired at logout): nothing is
    // deleted — with no identity there is no way to target the leaving
    // user's rows without destroying other staff members' takes. The rows
    // stay unreadable to every other uid and expire via the TTL.
    if (!uid) return
    const metas = (await req(
      db.transaction(TAKES).objectStore(TAKES).getAll(),
    )) as TakeMeta[]
    for (const m of metas) {
      if (m.ownerUid === uid) await deleteTake(m.takeId)
    }
  } catch (err) {
    console.error('[take-store] clearOwnTakes failed:', err)
  }
}

/**
 * EVERY recoverable take for the SIGNED-IN user, newest first. Owner gate at
 * the store layer: another user's takes are hidden (never deleted — their
 * rightful owner can still recover them; TTL cleans up). Expired takes (any
 * owner) are deleted in passing, like loadDraft's stale-draft sweep. Takes
 * with no persisted segments (crash before the first flush) are skipped, so
 * every row this returns HAS audio. `excludeTakeIds` filters the live
 * recorder/pipeline take so an in-progress session is never offered as its own
 * recovery.
 *
 * The recovery BANNER still takes only the newest (getRecoverableTake below —
 * ⚖ 8/20 keeps it the last-resort residue). The 録音履歴 inbox is what needed
 * the rest: older valid takes used to sit un-offered until the TTL swept them,
 * which is the multi-take loss the inbox exists to end.
 */
export async function listOwnTakes(
  excludeTakeIds: ReadonlyArray<string | null | undefined> = [],
): Promise<RecoverableTake[]> {
  try {
    const db = await openDb()
    if (!db) return []
    const uid = await currentUserId()
    if (!uid) return []
    const metas = (await req(
      db.transaction(TAKES).objectStore(TAKES).getAll(),
    )) as TakeMeta[]
    const now = Date.now()
    const exclude = new Set(excludeTakeIds.filter(Boolean))
    const out: RecoverableTake[] = []
    for (const m of metas) {
      const lastActivity = m.updatedAt ?? m.startedAt
      if (now - lastActivity > TAKE_TTL_MS) {
        void deleteTake(m.takeId)
        continue
      }
      if (m.ownerUid !== uid || exclude.has(m.takeId)) continue
      if (m.lastSeq < 0) continue
      // Recently flushed = possibly live in another tab; wait out the grace.
      if (now - lastActivity < ACTIVE_GRACE_MS) continue
      out.push({
        takeId: m.takeId,
        target: m.target,
        recordingSessionId: m.recordingSessionId,
        mimeType: m.mimeType,
        startedAt: m.startedAt,
        updatedAt: m.updatedAt,
        outcome: m.outcome,
        outcomeSkipped: m.outcomeSkipped,
        outcomeLegs: m.outcomeLegs,
        outcomeNewPack: m.outcomeNewPack,
      })
    }
    out.sort((a, b) => b.startedAt - a.startedAt)
    return out
  } catch (err) {
    console.error('[take-store] listOwnTakes failed:', err)
    return []
  }
}

/** The newest recoverable take for the signed-in user, or null — the recovery
 *  banner's single offer. Same gates as listOwnTakes above (it IS listOwnTakes;
 *  one prune path, one owner gate, no second copy of the rules to drift). */
export async function getRecoverableTake(
  excludeTakeIds: ReadonlyArray<string | null | undefined> = [],
): Promise<RecoverableTake | null> {
  return (await listOwnTakes(excludeTakeIds))[0] ?? null
}

/** Reassemble a take's audio from its persisted segments, in seq order.
 *  Owner-gated HERE too, not only in getRecoverableTake — the blob read is its
 *  own choke point, so a takeId arriving from any future caller (or a stale
 *  banner across a logout/login swap) still can't yield another user's audio.
 *  null when the caller isn't the owner, the take has no segments, or the
 *  read fails. */
export async function loadTakeBlob(takeId: string): Promise<Blob | null> {
  try {
    const db = await openDb()
    if (!db) return null
    const uid = await currentUserId()
    if (!uid) return null
    const tx = db.transaction([TAKES, SEGMENTS])
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (!meta || meta.ownerUid !== uid) return null
    // ponytail: getAll + filter, same trade-off as deleteTake above.
    const segments = (await req(tx.objectStore(SEGMENTS).getAll())) as SegmentRow[]
    const parts = segments
      .filter((s) => s.takeId === takeId)
      .sort((a, b) => a.seq - b.seq)
      .map((s) => s.blob)
    if (parts.length === 0) return null
    return new Blob(parts, meta.mimeType ? { type: meta.mimeType } : undefined)
  } catch (err) {
    console.error('[take-store] loadTakeBlob failed:', err)
    return null
  }
}
