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

/** How long the drain leaves a take alone after a failed secure attempt (fix
 *  round 7). Retryable failures are moments in time — an offline stop, a 502 —
 *  and the record page's drain runs on every mount, so without a floor a
 *  staffer bouncing between screens re-uploads the same whole take every few
 *  seconds. One minute: long enough that the moment can pass, short enough that
 *  a take still finishes inside the same shift. */
const SECURE_RETRY_COOLDOWN_MS = 60_000

/** Secure-attempt refusals that CANNOT become a yes by trying again, so trying
 *  again is pure cost — and the cost here is a whole take (43 MB on cellular)
 *  re-uploaded on every mount, forever. The door refuses these on facts that do
 *  not change: the input is malformed, the caller is not allowed, the object's
 *  bytes already disagree with the key, or there is no row to write. Everything
 *  else — session, network, upload_<status>, mint_<status>, object_missing — is
 *  a moment in time and stays retryable.
 *
 *  ⚠ These takes are NOT abandoned: the audio stays on the device and the take
 *  stays plainly un-finalized, which is what surfaces it as 要対応 (R10) for a
 *  human. What stops is the automatic re-PUT.
 *
 *  It lives HERE, beside the `secureError` field it judges, because both of its
 *  readers need it — secure-take's own guard and the drain read below.
 *  (Importing it the other way round would make this module and secure-take a
 *  cycle.) One home, one list. */
export const TERMINAL_SECURE_ERRORS = new Set([
  'bad_input',
  'forbidden',
  'size_mismatch',
  'not_found',
  // The device could not mint a uuid, so composeTakeKey will refuse this take
  // id for as long as it exists (global-recorder stamps it at create).
  'no_uuid',
  // ── The BINDING refusals (capture pipeline PR2 fix round 4) ──────────────
  // The mint reserves a take's key on the recorder's own row before a byte can
  // exist, and finalize accepts nothing else. Every refusal below is a
  // statement about THAT binding, and a binding does not change because time
  // passed — re-uploading the whole take can only produce the same answer.
  //
  // The object is already on storage and no row of this caller's reserved it;
  // or the row is bound to a DIFFERENT take. Both mean this take is spoken for.
  'exists',
  'reserved_elsewhere',
  // Finalize's twins: the row never reserved this key, or a job has moved the
  // row on to other audio and this object is now unreferenced.
  'not_reserved',
  'superseded',
  // A take id or container this server will not store — the recorder must
  // renegotiate, and a retry sends the identical rejected value.
  'bad_take_id',
  'bad_mime',
])

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
  /** A2-2: this take has ALREADY been discarded with a written reason, and its
   *  WORDS are still owed to that discard record. Set = the audio is kept only
   *  long enough to be transcribed onto the discarded session; it is deleted the
   *  moment that lands. */
  discardPending?: DiscardPending
  /** Capture pipeline PR3: the whole take is on the server under its finalized
   *  key AND its core row carries the pointer (lib/recording/secure-take.ts).
   *  THE STOP CONDITION PR5's launch drain reads: a take with segments and NO
   *  finalizedAt is audio the server does not have yet, whatever else is on the
   *  row. Absent on every take stamped before this field existed — read as "not
   *  secured", which is the honest answer for them. */
  finalizedAt?: number
   /** Why the last secure attempt did not finish — the finalize door's own code
   *  ('object_missing' | 'size_mismatch' | 'failed' | …), 'session' for a take
   *  that could not get a row at all, 'upload_<status>' for a refused PUT,
   *  'mint_<status>' for a refused mint, or 'network' for a throw. A
   *  success clears it. Mostly diagnostic — the one thing that READS it is
   *  TERMINAL_SECURE_ERRORS above, which stops re-uploading whole takes against
   *  a refusal that can never turn into a yes. */
  secureError?: string
  /** When that failure was recorded (fix round 7) — the anchor for the drain's
   *  cooldown. A take is the WHOLE recording, so a retryable failure that
   *  re-uploads on every mount is a storm of tens of megabytes each: the record
   *  page mounts on every navigation onto it. Absent = never attempted, or a
   *  take stamped before this field existed — both read as "cooled down". */
  lastSecureAttemptAt?: number
  /** The recorder's OWN measurement of this take, stamped at stop. It subtracts
   *  paused time, which no store-side estimate can: the retry's only other
   *  source is (updatedAt − startedAt), and a take paused for twenty minutes
   *  would finalize twenty minutes too long. Absent = no recorder ever stamped
   *  it (a pre-PR3 take, or a kill before stop) → that window stands in. */
  durationMs?: number
}

/** What a pending discard-transcript needs to finish after a reload — the
 *  discard's own session id and duration, not the take's (the gate may have
 *  re-minted the session id, and the discard's duration is what the receipt
 *  recorded). */
export type DiscardPending = {
  recordingSessionId: string
  durationSeconds: number
  locale: string
  stampedAt: number
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

/** Merge fields into a take's meta row — the body stampTakeSession above and
 *  the two marks below share. Best-effort, no-throw, no-op-if-gone, exactly
 *  like every other stamp in this file.
 *
 *  `when` is read on the row this transaction just fetched, so a caller can
 *  refuse to write against a state it must not overwrite without opening a
 *  read-then-write window of its own.
 *
 *  OWNER-GATED like every read in this file (fix round 7). A shared salon
 *  device signs one staffer out and the next one in, and these stamps carry a
 *  take id from wherever the caller got it — so without this, a stale drain or
 *  a late resolution could scribble a duration or a failure code onto the
 *  colleague's row it names. The uid is resolved BEFORE the transaction (an
 *  await inside one closes it) and compared on the row this transaction
 *  fetched, so the gate costs no second read. */
async function patchTakeMeta(
  takeId: string,
  patch: Partial<TakeMeta>,
  when?: (meta: TakeMeta) => boolean,
): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const uid = await currentUserId()
    if (!uid) return
    const tx = db.transaction(TAKES, 'readwrite')
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (!meta || meta.ownerUid !== uid) return
    if (when && !when(meta)) return
    await req(tx.objectStore(TAKES).put({ ...meta, ...patch }))
  } catch (err) {
    console.error('[take-store] patchTakeMeta failed:', err)
  }
}

/** Capture pipeline PR3: this take's audio is on the server and its core row
 *  points at it. Clears any earlier failure — a success is the last word. */
export async function markTakeFinalized(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { finalizedAt: Date.now(), secureError: undefined })
}

/** Capture pipeline PR3: the last secure attempt did not finish. Records WHY
 *  and nothing else — the take stays un-finalized, which is the only fact the
 *  retry (and PR5's drain) reads.
 *
 *  NEVER writes over a FINALIZED take (fix round 6). Two tabs can name the same
 *  take: the winner finalizes it, the loser's mint answers `exists` a moment
 *  later, and that late mark would put a TERMINAL code on a take whose audio is
 *  already safely on the server — which is what the 要対応 surface reads. The
 *  read and the write share one transaction in patchTakeMeta, so there is no
 *  window between them. */
export async function markTakeSecureError(takeId: string, code: string): Promise<void> {
  await patchTakeMeta(
    takeId,
    { secureError: code, lastSecureAttemptAt: Date.now() },
    (meta) => !meta.finalizedAt,
  )
}

/** Capture pipeline PR3: the recorder's own paused-aware duration for this take,
 *  stamped at stop so a LATER attempt (the record page's mount retry, PR5's
 *  drain) finalizes the same number the stop would have. Without it those
 *  callers have only the flush window, which counts pause time as recording. */
export async function stampTakeDuration(takeId: string, durationMs: number): Promise<void> {
  await patchTakeMeta(takeId, { durationMs })
}

/** The owner gate every read in this file shares, in one place: the take's meta
 *  row, or null when IndexedDB is unavailable, nobody is signed in, the take is
 *  gone, or it belongs to another staff member. */
async function readOwnTakeMeta(takeId: string): Promise<TakeMeta | null> {
  try {
    const db = await openDb()
    if (!db) return null
    const uid = await currentUserId()
    if (!uid) return null
    const meta = (await req(
      db.transaction(TAKES).objectStore(TAKES).get(takeId),
    )) as TakeMeta | undefined
    if (!meta || meta.ownerUid !== uid) return null
    return meta
  } catch (err) {
    console.error('[take-store] readOwnTakeMeta failed:', err)
    return null
  }
}

/** What secureTake needs: whether this take is already secured, why the last
 *  attempt failed (a TERMINAL code must not be re-uploaded against), which
 *  container the key must carry, which session to finalize against — and who
 *  the recording is FOR, so a take that has to mint its own row (fix round 6)
 *  mints one attributed the same way the recorder's start-mint would have —
 *  plus the recorder's own duration — the ONLY measurement a take is finalized
 *  with (fix round 7: the flush window that used to stand in behind it was
 *  unreachable, so the two fields that fed it are no longer read out). */
export async function readTakeSecureMeta(takeId: string): Promise<Pick<
  TakeMeta,
  'mimeType' | 'recordingSessionId' | 'target' | 'finalizedAt' | 'secureError' | 'durationMs'
> | null> {
  const meta = await readOwnTakeMeta(takeId)
  if (!meta) return null
  return {
    mimeType: meta.mimeType,
    recordingSessionId: meta.recordingSessionId,
    target: meta.target,
    finalizedAt: meta.finalizedAt,
    secureError: meta.secureError,
    durationMs: meta.durationMs,
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

/** A2-2: mark a take as "discarded, words still owed". Written BEFORE anything
 *  can delete the audio, so a crash between the discard landing and the
 *  transcript landing still leaves a take the sweep can finish.
 *  Best-effort, no-throw, no-op-if-gone — same contract as stampTakeSession.
 *  Returns false when nothing was stamped: the caller must then let the take be
 *  deleted as it always was, rather than keeping audio nothing will collect. */
export async function stampDiscardPending(
  takeId: string,
  discardPending: DiscardPending,
): Promise<boolean> {
  try {
    const db = await openDb()
    if (!db) return false
    const tx = db.transaction(TAKES, 'readwrite')
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (!meta) return false
    await req(tx.objectStore(TAKES).put({ ...meta, discardPending }))
    return true
  } catch (err) {
    console.error('[take-store] stampDiscardPending failed:', err)
    return false
  }
}

/** A2-2: every take of the SIGNED-IN user whose discard still owes its words.
 *  Owner-gated like every other read here — another staffer's pending take is
 *  invisible (and untouched: their own sweep finishes it). */
export async function listPendingDiscardTakes(): Promise<
  { takeId: string; discardPending: DiscardPending }[]
> {
  try {
    const db = await openDb()
    if (!db) return []
    const uid = await currentUserId()
    if (!uid) return []
    const metas = (await req(
      db.transaction(TAKES).objectStore(TAKES).getAll(),
    )) as TakeMeta[]
    return metas
      .filter((m) => m.ownerUid === uid && m.discardPending)
      .map((m) => ({ takeId: m.takeId, discardPending: m.discardPending as DiscardPending }))
  } catch (err) {
    console.error('[take-store] listPendingDiscardTakes failed:', err)
    return []
  }
}

/** F-2: read back a stamped answer by take id — the durable seam a recovered
 *  DRAFT uses (it carries the take id it deletes on save, so its answer can
 *  survive a reload too). Deliberately NOT owner-filtered differently from the
 *  rest of this module: same gate, same fail-closed null. */
export async function readTakeOutcome(takeId: string): Promise<
  Pick<TakeMeta, 'outcome' | 'outcomeSkipped' | 'outcomeLegs' | 'outcomeNewPack'> | null
> {
  const meta = await readOwnTakeMeta(takeId)
  if (!meta) return null
  return {
    outcome: meta.outcome,
    outcomeSkipped: meta.outcomeSkipped,
    outcomeLegs: meta.outcomeLegs,
    outcomeNewPack: meta.outcomeNewPack,
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
      // A2-2 — THE recovery exclusion. A take that has already been discarded
      // with a written reason is kept ONLY so its words can be transcribed onto
      // the discard record; re-offering it as recoverable audio would hand back
      // the very recording the staff member deliberately threw away (doctrine
      // R2). One filter here covers every offer surface — the banner
      // (getRecoverableTake), the 録音履歴 fold and its 保存する re-read all
      // route through this function. Placed AFTER the TTL prune above so a
      // pending take that is never collected still expires on schedule.
      if (m.discardPending) continue
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
        // Carried so a recovery surface can tell "the server already has this"
        // from "this is still device-only" without a second store read.
        finalizedAt: m.finalizedAt,
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

/** Every take of the SIGNED-IN user that is KNOWN STOPPED and whose audio the
 *  SERVER DOES NOT HAVE — the record page's mount drain worklist.
 *
 *  ⚖ STOPPED ONLY (capture pipeline PR3 fix round 5). A finalized key is
 *  IMMUTABLE: securing a take whose recorder is still running would upload the
 *  segments flushed so far, finalize them, and leave the rest of the recording
 *  with nowhere to land — permanently truncated audio, in exchange for saving a
 *  few seconds. So the drain reads a POSITIVE fact rather than a heuristic:
 *  `durationMs` is written by stampTakeDuration at onstop, so its presence means
 *  a recorder actually stopped this take. No age or grace window can substitute
 *  — a PAUSED take flushes nothing and looks stale within seconds.
 *
 *  Which leaves unstopped takes (a kill mid-recording) to PR5: the native shell
 *  is a single webview, so at APP LAUNCH no recorder can be live and that drain
 *  may take them; the web multi-tab case gets a heartbeat there. Until then
 *  their audio stays on the device, plainly un-finalized — 要対応, not lost.
 *
 *  Deliberately NOT listOwnTakes. That read is the recovery OFFER, and its 20 s
 *  ACTIVE_GRACE_MS hides a take flushed moments ago (it might be live in another
 *  tab). Offering is one question; getting the bytes off the device is another:
 *  a stop whose upload failed, followed by a reload inside those 20 s, left the
 *  fresh page with no recorder take and a recovery read that hid the take — so
 *  the audio stayed device-only for the whole page lifetime.
 *
 *  BYTES ARE NEVER GATED ON WHAT A SURFACE MAY SHOW. No grace, no discardPending
 *  filter (a discarded take still owes its words), no consent or binding filter
 *  — those decide what is SHOWN and what is KEPT. Exactly four facts exclude a
 *  take: no recorder stopped it (above), it is already finalized, its last
 *  refusal can never turn into a yes (TERMINAL_SECURE_ERRORS), or nothing has
 *  been flushed to disk yet (lastSeq < 0 — there is literally nothing to send).
 *  Owner-gated like every other read here. */
export async function listOwnStoppedUnsecuredTakeIds(): Promise<string[]> {
  try {
    const db = await openDb()
    if (!db) return []
    const uid = await currentUserId()
    if (!uid) return []
    const metas = (await req(
      db.transaction(TAKES).objectStore(TAKES).getAll(),
    )) as TakeMeta[]
    return metas
      .filter(
        (m) =>
          m.ownerUid === uid &&
          // The stop stamp — the only proof this take is complete.
          m.durationMs !== undefined &&
          !m.finalizedAt &&
          !(m.secureError && TERMINAL_SECURE_ERRORS.has(m.secureError)) &&
          // ponytail: one flat cooldown, not per-code backoff — the record page
          // mounts on every navigation onto it, and a take is the whole
          // recording, so a failing take would re-PUT tens of megabytes several
          // times a minute. A minute of quiet is enough to stop the storm; the
          // take is never abandoned (the next mount after it takes it).
          Date.now() - (m.lastSecureAttemptAt ?? 0) >= SECURE_RETRY_COOLDOWN_MS &&
          m.lastSeq >= 0,
      )
      .map((m) => m.takeId)
  } catch (err) {
    console.error('[take-store] listOwnStoppedUnsecuredTakeIds failed:', err)
    return []
  }
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
