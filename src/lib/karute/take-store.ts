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
import { isNativeShell } from '@/lib/platform'
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

/** ⚖ THE CROSS-TAB LIVENESS SIGNAL (fix round 14, moved onto the take row in
 *  round 15) — `heartbeatAt` on the take's OWN meta row, re-stamped every ~5 s
 *  by the recorder holding it (global-recorder writes it on the flush timer it
 *  already runs; nothing here schedules anything). IndexedDB is shared between
 *  same-origin tabs but says nothing about who is RECORDING; `isActive` can
 *  only answer for the singleton in the caller's own runtime.
 *
 *  A PAUSED take is exactly the case it exists for: it flushes nothing, so it
 *  looks stale within seconds, and on the web it may be paused in the tab next
 *  door. The beat keeps beating while paused, so "quiet" and "gone" stop being
 *  the same reading.
 *
 *  ⚖ ONE HOME (fix round 15). Round 14 kept the beat in localStorage, and two
 *  stores meant two failure modes feeding one judgement: a READ that threw was
 *  read as "might be live" while a WRITE that threw (Safari private mode,
 *  quota) left a live recording looking stopped — the asymmetry that seals
 *  audio. On the take row there is only the store the drain ALREADY reads. A
 *  beat whose write is lost makes the take look older, never deader, and the
 *  stale window below absorbs a missed tick; and if IndexedDB is the thing
 *  failing, the drain cannot read its worklist either, so it seals nothing. */

/** HOW LONG ONE BEAT SPEAKS FOR — deliberately far longer than the ~5 s
 *  cadence that writes it (fix round 15). A hidden tab's timers are throttled
 *  to roughly once a MINUTE after five minutes in the background, and a tab
 *  that is merely capturing gets no audible-media exemption: the beat of a
 *  perfectly live recording in the tab next door can be a full minute old.
 *
 *  The two errors are not symmetric. A beat that expires LATE only delays an
 *  upload by a couple of minutes; one that expires EARLY seals a live
 *  recording under its IMMUTABLE key and destroys the rest of the audio. So
 *  this is two minutes — not the 20 s ACTIVE_GRACE_MS above, which judges a
 *  different fact (how long since bytes were flushed) and keeps its own value. */
const HEARTBEAT_STALE_MS = 120_000

/** Stamp this take as still held by a live recorder. Best-effort like every
 *  other write in this file — patchTakeMeta swallows its errors and answers
 *  false, and capture must never notice. */
export async function writeTakeHeartbeat(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { heartbeatAt: Date.now() })
}

/** …and the recorder let go of it: the stop leg's `finally` (the point after
 *  which there is no short blob left to seal), a discard, or the next take.
 *  Leaving the beat would make a finished take claim a recorder for two whole
 *  minutes. */
export async function clearTakeHeartbeat(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { heartbeatAt: undefined })
}

/** How long the drain leaves a take alone after a failed secure attempt (fix
 *  round 7). Retryable failures are moments in time — an offline stop, a 502 —
 *  and the record page's drain runs on every mount, so without a floor a
 *  staffer bouncing between screens re-uploads the same whole take every few
 *  seconds. One minute: long enough that the moment can pass, short enough that
 *  a take still finishes inside the same shift. */
const SECURE_RETRY_COOLDOWN_MS = 60_000

/** How many times a stamp tries its write before giving up, and how long it
 *  waits between tries (fix round 13).
 *
 *  Best-effort was never meant to be one-shot. `durationMs` is the stop stamp —
 *  the ONE positive fact that says a recorder finished this take, and the whole
 *  gate the drain reads. A single IndexedDB write that loses (a transaction the
 *  browser aborted under memory pressure, a store momentarily locked by another
 *  tab's transaction, a quota blip) therefore used to make a STOPPED take look
 *  unstopped for the rest of the page's life: excluded from every drain, its
 *  audio device-only, and silent — the stamp swallows its error by design.
 *
 *  Three tries and two short pauses, because the failures worth catching here
 *  are momentary by nature; anything that survives 150 ms is a store that is
 *  not coming back, and capture must never wait on one. */
const STAMP_WRITE_TRIES = 3
const STAMP_RETRY_MS = 50

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
  /** ⚖ THE CROSS-TAB LIVENESS BEAT (fix round 15) — when a recorder last said
   *  it is still holding this take. Re-stamped every ~5 s while recording OR
   *  paused and once more at the stop, cleared when the stop leg has nothing
   *  short left to seal. Absent = nothing is claiming it (a finished take, or
   *  one recorded by a bundle older than this field — read as no beat, which
   *  is what those takes are). Read by isStoppedTake, and only on the web —
   *  see HEARTBEAT_STALE_MS. */
  heartbeatAt?: number
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
  /** Capture pipeline PR4: the words of that discard have LANDED (or were
   *  deliberately not kept). The take used to be deleted at that moment; audio
   *  is never deleted now, so the settle needs a mark of its own or the sweep
   *  would re-read a whole take off disk on every record-page mount forever.
   *  `discardPending` deliberately STAYS — it is the recovery exclusion that
   *  keeps a deliberately-discarded recording from being offered back. */
  discardTranscriptDoneAt?: number
  /** Capture pipeline PR3: the whole take is on the server under its finalized
   *  key AND its core row carries the pointer (lib/recording/secure-take.ts).
   *  THE STOP CONDITION PR5's launch drain reads: a take with segments and NO
   *  finalizedAt is audio the server does not have yet, whatever else is on the
   *  row. Absent on every take stamped before this field existed — read as "not
   *  secured", which is the honest answer for them. */
  finalizedAt?: number
  /** Capture pipeline PR4: the finalized KEY the mint composed for this take —
   *  the object the whole pipeline now reads (transcription, the core job's
   *  audio_path). Written beside finalizedAt at secure time because the client
   *  must never compose a tenant key itself: this is the server's own answer,
   *  carried back from the mint. Absent on a take secured before this field
   *  existed — read as "no pointer of my own", which sends that take down the
   *  in-tab fallback leg instead of naming an object nobody proved. */
  finalizedPath?: string
  /** Capture pipeline PR4 fix round 4: where this take's audio was STAGED — the
   *  row-less copy the discard's word-collection uploads for a take that can
   *  never be sealed under a finalized key (lib/recording/discard-transcript).
   *  Written right after the first successful staging, and read by the next
   *  sweep instead of staging again: a transcription that keeps answering
   *  `failed` re-uploaded the WHOLE take on every record-page mount, for ever.
   *  Never a substitute for `finalizedPath` — that one wins wherever both
   *  exist, because it is the key the whole pipeline reads. */
  stagedPath?: string
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
  /** ⚖ ONE BOUND START PER TAKE (capture pipeline PR3 fix round 9). A session
   *  created with `{takeId, mimeType}` is BORN RESERVED (PR2 fix round 10) — and
   *  a create that carries a key is not blind-retry-safe, which is that round's
   *  own named ceiling: if the reply is lost after core made the row, the client
   *  has no id, and re-sending the same take composes the same key, which core's
   *  unique index refuses forever. So the bound create is attempted exactly ONCE
   *  per take, and this records that it was ATTEMPTED — never that it succeeded,
   *  because the failure it exists for is precisely the one that answers
   *  nothing. Every later attempt sends the argument-less start instead, whose
   *  unbound row the upload mint still reserves through its legacy update path.
   *  Absent = a take stamped before this field existed, read as "never
   *  attempted", which is what those takes are. */
  startBoundAttempted?: boolean
  /** The recorder's OWN measurement of this take, stamped at stop. It subtracts
   *  paused time, which no store-side estimate can: the retry's only other
   *  source is (updatedAt − startedAt), and a take paused for twenty minutes
   *  would finalize twenty minutes too long. Absent = no recorder ever stamped
   *  it (a pre-PR3 take, or a kill before stop) → that window stands in. */
  durationMs?: number
  /** ⚖ THE TAIL NEVER LANDED (fix round 16). The stop's final flush reported
   *  SKIPPED: the staffer stopped and immediately started the next recording
   *  (or discarded), so the chunks were cleared out from under the queued
   *  write and what is on disk is SHORT of what the recorder captured.
   *
   *  Round 7 left such a take merely unstamped, and that was enough while
   *  "unstamped" meant "no drain will touch it". Rounds 13/14 changed exactly
   *  that — an unstamped, quiet take with no beat is now drainable on both
   *  arms — so the absence of a stamp is no longer a defence and the missing
   *  tail has to be written down as the POSITIVE fact it is. Read by
   *  isStoppedTake (and secure-take's belt): a take with this flag is never
   *  sealed automatically, because sealing the prefix under the IMMUTABLE
   *  finalized key would leave the rest of the recording nowhere to land.
   *
   *  It is not an error and it is not a failure — nothing marks, nothing
   *  deletes, the audio stays on the device and the take stays plainly
   *  un-finalized, which is what surfaces it as 要対応 for a human. */
  tailIncomplete?: boolean
  /** ⚖ A STOP IS IN FLIGHT — OR DIED IN ONE (fix round 17). Written by the stop
   *  leg as its FIRST act, ahead of the tail flush and of anything that could
   *  release the hold; cleared in the same patch that stamps `durationMs`.
   *
   *  Round 16 writes the missing tail down from INSIDE the leg, after the fact,
   *  which covers only the ways a leg can end while still able to write. The
   *  marker's own write failing, or the tab closing mid-stop, leaves the take in
   *  exactly the shape rounds 13/14 taught both drains to take — unstamped,
   *  quiet, nothing beating for it — and the hold and the beat that were
   *  covering it die with the page. A fact written FIRST cannot be lost that
   *  way: it is on the row before either defence can lapse, and every tab and
   *  every reload reads it there.
   *
   *  With no `durationMs` beside it, it says the stop never finished. Such a
   *  take is never sealed automatically (isStoppedTake, and the drain's
   *  worklist through it) and stays plainly un-finalized, which surfaces it as
   *  要対応 for a human exactly like a lost tail. If THIS write fails, IndexedDB
   *  itself is failing — and a drain that cannot write cannot read its worklist
   *  either, so it seals nothing. */
  stopPendingAt?: number
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
  /** Capture pipeline PR4 fix round 4: this discard was BELOW the accidental-tap
   *  floor, so no words were ever owed for it (⚖ spend gate) and the stamp
   *  exists only to keep the recording the staffer threw away out of every
   *  recovery offer. Stamped together with markDiscardTranscriptDone, so the
   *  sweep never reads it either. */
  belowFloor?: boolean
}

/** What the recovery banner needs — everything except the audio itself. */
export type RecoverableTake = Omit<TakeMeta, 'ownerUid' | 'lastSeq'> & {
  /** Capture pipeline PR4 fix round 1: this take is PAST the TTL and the
   *  server still does not have it, so the prune refused it (the never-delete
   *  guard in deleteTakeRows). NOT a stored field — derived by listOwnTakes,
   *  the one place that owns TAKE_TTL_MS — and the reason 録音履歴 shows the
   *  row at all: an expired unsecured take is outside the inbox's own 7-day
   *  window, so without this the fold would drop the one row a human can act
   *  on. */
  expiredUnsecured?: boolean
}

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
 *
 * ⚖ OWNER-GATED AT LAST (capture pipeline PR4, packet rider). This was the ONE
 * ungated write left in the file — a shared salon device that signed one
 * staffer out mid-flush could append a colleague's audio onto their row — and
 * fix round 10 deferred it on COST: a session read every ~5 s, for the length
 * of a recording, on the capture hot loop.
 *
 * The cost was measured before it was paid, and it is not one: `currentUserId`
 * resolves through supabase-js `auth.getSession()`, which reads the persisted
 * session out of localStorage and parses it — no network call unless the token
 * has expired, and that refresh is on the auth client's own schedule whether
 * this runs or not. Sub-millisecond against a 5 s interval. The uid is resolved
 * BEFORE the transaction (an await inside one closes it), exactly as
 * patchTakeMeta does it, so the gate costs no second IndexedDB read either.
 *
 * A refusal reads as "the meta row is gone" to the caller — the recorder
 * disables persistence for this take — which is the honest outcome: for THIS
 * signed-in staffer, that take is not theirs to write.
 *
 * ⚖ AND THE STOP STAMP RIDES THE TAIL (fix round 18, AG1). `stampDurationMs`
 * folds the duration stamp into the TAKES put this transaction was already
 * making. Until now the stamp was a SEPARATE write (patchTakeMeta), so it could
 * lose on its own — leaving a row that carries `stopPendingAt` and no
 * `durationMs`, which isStoppedTake refuses on BOTH arms for ever: the audio is
 * whole on disk and no drain will ever take it. One transaction removes the
 * shape rather than guarding it: the tail bytes and the fact that the take is
 * complete land together or not at all. The gate above is what round 18 named
 * as the fold's one cost — a stamp riding an ungated write — and it is paid.
 */
export async function appendTakeSegment(
  takeId: string,
  seq: number,
  blob: Blob,
  stampDurationMs?: number,
): Promise<boolean> {
  try {
    const db = await openDb()
    if (!db) return false
    // ⚖ A TRANSIENT NULL SESSION MUST NEVER COST AUDIO (fix round 3). The uid
    // is COMPARED, never required: `getSession()` answers null on a FAILED
    // refresh too (auth-js 2.99.1), so a long recording that crosses its token
    // expiry while the network is down used to fail this write, latch the
    // recorder's `p.disabled`, go memory-only and be marked tailIncomplete at
    // the stop — permanently unsecurable, for a blip. The gate is here for
    // FOREIGN callers, and a known mismatch is still refused; the only caller
    // is the recorder's own flush, with the take id it minted this session. The
    // read paths are all gated on their own, so nothing a null-uid flush writes
    // is ever visible to a colleague.
    const uid = await currentUserId()
    const tx = db.transaction([TAKES, SEGMENTS], 'readwrite')
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (!meta || (uid && meta.ownerUid !== uid)) return false
    await req(tx.objectStore(SEGMENTS).put({ takeId, seq, blob } satisfies SegmentRow))
    await req(
      tx.objectStore(TAKES).put(
        stampDurationMs === undefined
          ? { ...meta, updatedAt: Date.now(), lastSeq: seq }
          : {
              ...meta,
              updatedAt: Date.now(),
              lastSeq: seq,
              durationMs: stampDurationMs,
              // The one write that clears it, exactly as stampTakeDuration does.
              stopPendingAt: undefined,
            },
      ),
    )
    return true
  } catch (err) {
    console.error('[take-store] appendTakeSegment failed:', err)
    return false
  }
}

/** Stamp the server-minted recording_sessions id once the mint resolves.
 *  Best-effort; no-op if the take is gone. Answers whether it WROTE.
 *
 *  ⚖ FIRST WRITE WINS (fix round 10, P1). Two routes can hand a take a row —
 *  the recorder's start-mint and secure-take's own session call — and the mint
 *  is a network call with no answer time anyone controls. A start-mint reply
 *  that comes back LATE therefore used to land on a take the stop had already
 *  finalized against the OTHER row: the audio sits on one row and the karute is
 *  read beside another, or the late row's key is refused and the audio never
 *  leaves the device. Neither is recoverable, and both are silent.
 *
 *  So the FIRST id a take is given is the take's, for good. The `when` hook
 *  below reads the row inside the write transaction, so there is no window
 *  between the check and the refusal — and the answer lets a caller whose
 *  write lost ADOPT the id that won instead of carrying its own orphan on.
 *
 *  OWNER-GATED like every other write here (fix round 8 — it was the one stamp
 *  that never was, though the shared body below already claimed it). This one
 *  carries a take id from the SAME places the others do — a late mint
 *  resolution, a drain — and a shared salon device signs one staffer out and
 *  the next one in, so without the gate a stale resolution could point a
 *  colleague's take at a row minted for someone else's recording: the audio
 *  finalizes against one row and the karute is read beside another. */
export async function stampTakeSession(
  takeId: string,
  recordingSessionId: string,
): Promise<boolean> {
  return patchTakeMeta(takeId, { recordingSessionId }, (meta) => !meta.recordingSessionId)
}

/** Merge fields into a take's meta row — the body stampTakeSession above and
 *  the two marks below share. Best-effort, no-throw, no-op-if-gone, exactly
 *  like every other stamp in this file.
 *
 *  `when` is read on the row this transaction just fetched, so a caller can
 *  refuse to write against a state it must not overwrite without opening a
 *  read-then-write window of its own. Answers whether the row was WRITTEN —
 *  false covers every reason it was not (no store, signed out, gone, another
 *  staffer's, refused by `when`), which is all a caller needs to know that the
 *  value it holds is not the one on the take.
 *
 *  OWNER-GATED like every read in this file (fix round 7). A shared salon
 *  device signs one staffer out and the next one in, and these stamps carry a
 *  take id from wherever the caller got it — so without this, a stale drain or
 *  a late resolution could scribble a duration or a failure code onto the
 *  colleague's row it names. The uid is resolved BEFORE the transaction (an
 *  await inside one closes it) and compared on the row this transaction
 *  fetched, so the gate costs no second read.
 *
 *  ⚖ AND A LOST WRITE GETS TWO MORE TRIES (fix round 13). Only a THROWN write
 *  is retried — see STAMP_WRITE_TRIES. Every other `false` here is a settled
 *  ANSWER, not a failure: no store, nobody signed in, the take is gone, it is
 *  another staffer's, or `when` refused it. Re-asking those costs time and
 *  changes nothing, and re-asking `when` would be worse — it is the
 *  first-write-wins brace, and its "no" is the point. */
async function patchTakeMeta(
  takeId: string,
  patch: Partial<TakeMeta>,
  when?: (meta: TakeMeta) => boolean,
): Promise<boolean> {
  for (let attempt = 1; attempt <= STAMP_WRITE_TRIES; attempt++) {
    try {
      const db = await openDb()
      if (!db) return false
      const uid = await currentUserId()
      if (!uid) return false
      const tx = db.transaction(TAKES, 'readwrite')
      const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
      if (!meta || meta.ownerUid !== uid) return false
      if (when && !when(meta)) return false
      await req(tx.objectStore(TAKES).put({ ...meta, ...patch }))
      return true
    } catch (err) {
      console.error('[take-store] patchTakeMeta failed:', err)
      if (attempt < STAMP_WRITE_TRIES)
        await new Promise((resolve) => setTimeout(resolve, STAMP_RETRY_MS * attempt))
    }
  }
  return false
}

/** Capture pipeline PR3: this take's audio is on the server and its core row
 *  points at it. Clears any earlier failure — a success is the last word.
 *
 *  PR4: it carries the KEY now. That object is what the pipeline transcribes
 *  and what the core job's audio_path names, so the take has to remember where
 *  it is — and the value is the MINT's own composed key, never one this device
 *  assembled from a tenant id it should not be composing with. */
export async function markTakeFinalized(takeId: string, finalizedPath: string): Promise<void> {
  await patchTakeMeta(takeId, {
    finalizedAt: Date.now(),
    finalizedPath,
    secureError: undefined,
  })
}

/** Capture pipeline PR4: this take's discard transcript is SETTLED — the words
 *  landed, or were deliberately not kept. The sweep's stop condition, in place
 *  of the deleteTake that used to be it. */
export async function markDiscardTranscriptDone(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { discardTranscriptDoneAt: Date.now() })
}

/** Capture pipeline PR4 fix round 4: this take's audio has been STAGED, and
 *  here is the key it went to. Written once, right after the first successful
 *  staging, so a transcription that keeps failing re-reads that copy instead of
 *  re-uploading the whole take on every record-page mount. */
export async function markTakeStaged(takeId: string, stagedPath: string): Promise<void> {
  await patchTakeMeta(takeId, { stagedPath })
}

/** Capture pipeline PR4 fix round 7: forget where this take was staged, so the
 *  next sweep stages it again. ONE cohort needs it — a take stamped before this
 *  round, whose staged copy carries the old anonymous take-shaped key the
 *  transcribe door now refuses (it honours only a copy NAMED for the session).
 *  Clearing the pointer is what lets that take re-stage under a bound key; the
 *  discard stamp itself is untouched, so nothing is lost and nothing is
 *  deleted — the old object stays on storage as the evidence it is. */
export async function clearTakeStaged(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { stagedPath: undefined })
}

/**
 * The finalized key for a take that has `finalizedAt` but no `finalizedPath`
 * (capture pipeline PR4 fix round 7) — asked once, then remembered.
 *
 * THE COHORT. Slice three's markTakeFinalized wrote the TIMESTAMP alone; slice
 * four's readers gate on the KEY. A web take finalized between the two deploys
 * and still unprocessed therefore reads as unsecured: the in-tab leg stages a
 * row-less duplicate of audio the server already holds, and the discard sweep
 * waits for an object it will never name. The key is DETERMINISTIC — the mint
 * composed it from this take's id and container and reserved exactly that on
 * the row — so the port recomposes it server-side, where the tenant prefix
 * lives, and the answer is written back so this is asked at most once per take.
 *
 * The port is passed IN rather than reached for: this module is the durable
 * store, and a store that imports the network seam is one import cycle away
 * from a page that cannot load. `null` from the port ("this world cannot say" —
 * the thin arm always) leaves the take exactly as it is.
 */
export async function ensureFinalizedPath(
  takeId: string,
  meta: Pick<TakeMeta, 'mimeType' | 'finalizedAt' | 'finalizedPath'>,
  port: { finalizedKey(takeId: string, mimeType: string): Promise<string | null> },
): Promise<string | null> {
  if (meta.finalizedPath) return meta.finalizedPath
  if (!meta.finalizedAt) return null
  const key = await port.finalizedKey(takeId, meta.mimeType)
  if (!key) return null
  await patchTakeMeta(takeId, { finalizedPath: key })
  return key
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

/** Capture pipeline PR3 fix round 9: a BORN-RESERVED start is about to be sent
 *  for this take. Stamped BEFORE the request leaves, because the case it guards
 *  is a LOST RESPONSE — a flag written when the reply lands is a flag the one
 *  failure that matters never writes. See `startBoundAttempted` above for why
 *  one attempt is all a bound create ever gets. */
export async function markTakeStartBoundAttempted(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { startBoundAttempted: true })
}

/** Capture pipeline PR3 fix round 16: this take's final flush was SKIPPED, so
 *  the disk copy is short of what the recorder captured. Written by the stop
 *  leg BEFORE it releases its hold — see `tailIncomplete` above for why the
 *  missing stamp stopped being enough.
 *
 *  ⚖ BUT NEVER OVER A STAMPED TAKE (fix round 19). The stamp says the disk held
 *  the WHOLE recording at the stop instant — the segments were already written,
 *  and no later tap can undo that. A stop with nothing pending stamps in its
 *  first act, so a start()/discard landing inside THAT write leaves the flush
 *  behind it answering "skipped", and this mark would then write 途中 across a
 *  complete take. `when` is patchTakeMeta's own first-write-wins brace, read
 *  inside the write transaction, so there is no window of its own. */
export async function markTakeTailIncomplete(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { tailIncomplete: true }, (m) => m.durationMs === undefined)
}

/** Capture pipeline PR3 fix round 17: this take's stop leg has BEGUN. Queued as
 *  the leg's first act — see `stopPendingAt` above for why the stop is written
 *  down before the tail rather than after it. */
export async function markTakeStopPending(takeId: string): Promise<void> {
  await patchTakeMeta(takeId, { stopPendingAt: Date.now() })
}

/** Capture pipeline PR3: the recorder's own paused-aware duration for this take,
 *  stamped at stop so a LATER attempt (the record page's mount retry, PR5's
 *  drain) finalizes the same number the stop would have. Without it those
 *  callers have only the flush window, which counts pause time as recording.
 *
 *  It is also THE STOP STAMP — the fact listOwnStoppedUnsecuredTakeIds gates
 *  on — so a write that quietly loses hides a finished take from every drain.
 *  Retried by the shared body above, and it ANSWERS now (fix round 13): true
 *  when the stamp is on disk. onstop does not wait on that answer — it holds
 *  the live measurement either way — but a caller that needs to know whether a
 *  later attempt will find this take can ask. */
export async function stampTakeDuration(
  takeId: string,
  durationMs: number,
): Promise<boolean> {
  // …and it is the one write that CLEARS `stopPendingAt` (fix round 17): the
  // stop that set it has finished, and this stamp is how it says so.
  return patchTakeMeta(takeId, { durationMs, stopPendingAt: undefined })
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
 *  plus the recorder's own duration — the measurement a take is normally
 *  finalized with — and whether a BOUND start has already been sent for this
 *  take (fix round 9), which both routes to the session door read before they
 *  offer the pair.
 *
 *  The three flush-window fields (`startedAt`, `updatedAt`, `lastSeq`) are read
 *  out again since fix round 13. Round 7 dropped them because the stop-stamp
 *  gate had made the window unreachable; the native shell's own rule below
 *  (isStoppedTake) reaches it again, for exactly the takes whose stop stamp
 *  never landed. */
export async function readTakeSecureMeta(takeId: string): Promise<Pick<
  TakeMeta,
  | 'mimeType'
  | 'recordingSessionId'
  | 'target'
  | 'finalizedAt'
  | 'finalizedPath'
  | 'stagedPath'
  | 'secureError'
  | 'durationMs'
  | 'startBoundAttempted'
  | 'startedAt'
  | 'updatedAt'
  | 'lastSeq'
  | 'heartbeatAt'
  | 'tailIncomplete'
  | 'stopPendingAt'
> | null> {
  const meta = await readOwnTakeMeta(takeId)
  if (!meta) return null
  return {
    mimeType: meta.mimeType,
    recordingSessionId: meta.recordingSessionId,
    target: meta.target,
    finalizedAt: meta.finalizedAt,
    finalizedPath: meta.finalizedPath,
    stagedPath: meta.stagedPath,
    secureError: meta.secureError,
    durationMs: meta.durationMs,
    startBoundAttempted: meta.startBoundAttempted,
    startedAt: meta.startedAt,
    updatedAt: meta.updatedAt,
    lastSeq: meta.lastSeq,
    heartbeatAt: meta.heartbeatAt,
    tailIncomplete: meta.tailIncomplete,
    stopPendingAt: meta.stopPendingAt,
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
 *  blank an answer already stored.
 *
 *  Through patchTakeMeta since fix round 14 (AA3), which is where this file's
 *  owner gate lives: a shared salon device signs one staffer out and the next
 *  one in, and this carries a take id from wherever its caller got it — so
 *  without the gate a stale answer could stamp a colleague's recording as
 *  resolved and skip the popup on a session that never got one. */
export async function stampTakeOutcome(
  takeId: string,
  outcome: SessionOutcome | undefined,
  outcomeSkipped?: boolean,
  outcomeLegs?: TakeMeta['outcomeLegs'],
  /** null CLEARS it (the leg finished); undefined leaves it alone. */
  outcomeNewPack?: TakeMeta['outcomeNewPack'],
): Promise<void> {
  await patchTakeMeta(takeId, {
    ...(outcome === undefined ? {} : { outcome }),
    ...(outcomeSkipped === undefined ? {} : { outcomeSkipped }),
    ...(outcomeLegs === undefined ? {} : { outcomeLegs }),
    ...(outcomeNewPack === undefined ? {} : { outcomeNewPack }),
  })
}

/** A2-2: mark a take as "discarded, words still owed". Written BEFORE anything
 *  can delete the audio, so a crash between the discard landing and the
 *  transcript landing still leaves a take the sweep can finish.
 *  Best-effort, no-throw, no-op-if-gone — same contract as stampTakeSession.
 *  Returns false when nothing was stamped: the caller must then let the take be
 *  deleted as it always was, rather than keeping audio nothing will collect.
 *  Owner-gated through patchTakeMeta since fix round 14 (AA3) — a false from
 *  the gate is the same answer as a false from a missing row, and the caller
 *  already knows what to do with it. */
export async function stampDiscardPending(
  takeId: string,
  discardPending: DiscardPending,
): Promise<boolean> {
  return patchTakeMeta(takeId, { discardPending })
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
      // `discardTranscriptDoneAt` is the settle (PR4). Before it, the take was
      // DELETED once the words landed and its absence was the stop condition;
      // audio is never deleted now, so the mark is what stops the sweep from
      // re-reading a whole take off disk on every record-page mount.
      .filter((m) => m.ownerUid === uid && m.discardPending && !m.discardTranscriptDoneAt)
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
 *  explicit discard, and TTL expiry.
 *
 *  OWNER-GATED at the door since fix round 14 (AA3). This is the one call in
 *  the file that DESTROYS audio, and it carries a take id from wherever its
 *  caller got it — a pipeline context or a banner snapshot held across the
 *  logout/login swap a shared salon device does all day. Without the gate such
 *  a stale id would delete the take of the colleague who is now signed in, and
 *  the store's own doctrine is that another owner's take is hidden but never
 *  touched (their TTL, or their own logout, collects it).
 *
 * ⚖ THE ONE WAY PAST THE NEVER-DELETE GUARD IS A HUMAN (capture pipeline PR4
 * fix round 1). `humanResolved` is the 録音履歴 row a staff member is looking at
 * and has just settled themselves — the karute record exists on the server,
 * they tapped 確認する, and all that is left on the device is bytes nothing is
 * waiting for. Only the inbox passes it; every AUTOMATIC path (the save, the
 * TTL prune, the logout wipe, a pipeline reset) keeps the refusal below, which
 * is what makes "nothing destroys audio the server does not have" a rule rather
 * than a default. Without it the refusal had no exit at all: a 確認待ち row
 * whose take was never secured could not be cleared by anyone, which is the
 * unclearable 要対応 badge this family has already been burned by once
 * (session-cleanup.ts's header). It is passed straight through to the rows
 * below, where the one guard lives. */
export async function deleteTake(
  takeId: string,
  opts?: { humanResolved?: boolean },
): Promise<void> {
  if (!(await readOwnTakeMeta(takeId))) return
  await deleteTakeRows(takeId, opts)
}

/** ⚖ WHAT A SAVE MAY SETTLE — the rule, in ONE place, for all three exits
 *  (capture pipeline PR4 fix round 4). Every settled save used to pass
 *  `humanResolved: true` as a CONSTANT, and round 3's premise for that ("an
 *  ordinary recording is finalized by then") is false for a real cohort: a take
 *  whose stop-time secure failed RETRYABLY (upload_5xx, network, upstream —
 *  none of them terminal) reaches the save with no finalized key at all. The
 *  pipeline staged a ROW-LESS copy, the save succeeds from it, and the constant
 *  then deleted the device copy — leaving the row's finalized key empty for
 *  ever, the only audio an object nothing can look up, and the drain's retry
 *  (which would have secured it under the take's OWN key) dead with the take.
 *
 *  The device copy may go after a save ONLY IF:
 *    (a) the take is FINALIZED — the plain unflagged delete below succeeds by
 *        itself, exactly as it always did; or
 *    (b) the take can NEVER be secured (isUnsecurableTake) — its staged copy is
 *        the best the server will ever hold, so nothing is waiting for these
 *        bytes and the flag is the truth.
 *  A RETRYABLE-unsecured take is KEPT: the drain finalizes it later, and the
 *  24 h TTL prune (allowed the moment it is finalized) takes the device copy
 *  then. On the inbox row that means 確認する leaves a retryable take's row
 *  standing until the drain has been — and the next tap clears it. Honest: the
 *  server does not have that audio yet, and the row says so.
 *
 *  So `humanResolved` asserts exactly this, at all three of its call sites: a
 *  save or a tap settled this row, and the server can never hold this audio
 *  under its own key — the staged copy it holds is all there will ever be. */
export async function settleTakeAfterSave(takeId: string): Promise<void> {
  const meta = await readTakeSecureMeta(takeId)
  return deleteTake(takeId, { humanResolved: !!meta && isUnsecurableTake(meta) })
}

/** The rows themselves, no owner question asked — for THIS file's two sweeps,
 *  which have already settled ownership in ways the gate above cannot: the TTL
 *  prune in listOwnTakes drops EXPIRED takes of every owner (nobody is coming
 *  for them), and clearOwnTakes matches `ownerUid` itself, against a uid that
 *  may be EXPLICIT precisely because the session is already gone — the logout
 *  wipe, where currentUserId() answers null and the gate would leave the
 *  leaving staffer's audio sitting on the device.
 *
 * ⚖ NOTHING DELETES AUDIO THE SERVER DOES NOT HAVE (capture pipeline PR4, v2
 * item 8). ONE guard, HERE, because this is the only door: every destroying
 * path in the app routes through this function — deleteTake above with its
 * twelve call sites (the save, the below-floor discard, the reasoned discard,
 * the inbox), plus the TTL prune and the logout wipe that come straight here —
 * and each of them used to be free to destroy the only copy of a recording. A
 * take with no `finalizedAt` is audio that exists NOWHERE ELSE, so it is
 * refused and kept; the record page's mount retry (and PR5's launch drain) is
 * what turns it into a finalized one, and then the same call succeeds. The one
 * exception is a human who settled the row themselves — see `humanResolved` on
 * the door above. What that flag ASSERTS, stated once for all three of its call
 * sites (fix round 4): a save or a tap settled this row, and the server can
 * NEVER hold this audio under the take's own key — the staged copy it has is
 * all there will ever be. No call site writes it as a constant any more; the
 * one place that decides it is settleTakeAfterSave above, which reads the take
 * rather than assuming it (fix round 3 assumed, and was wrong for the takes
 * whose secure failed retryably).
 *
 * Silent by contract, like every other failure in this file: the callers are
 * `void deleteTake(...)` fire-and-forget, and a refusal is not an error — it is
 * the take waiting for its moment.
 *
 * A take whose META is already GONE still has its orphan segments swept HERE:
 * there is no audio to protect, only orphan rows to clear. (Through the door
 * above it does not get that far — round 14's owner gate cannot answer for a
 * row that is not there, and fails closed. The sweeps are where such rows are
 * collected.)
 *
 * It removes IndexedDB rows and NOTHING else — no server object has ever been
 * reachable from this function — and it files no audit row: there is no action
 * for a device-local take in the registry (docs/AUDIT_ACTIONS.md), and this
 * module is 'use client' with a no-network, never-block-capture contract. */
async function deleteTakeRows(
  takeId: string,
  opts?: { humanResolved?: boolean },
): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const tx = db.transaction([TAKES, SEGMENTS], 'readwrite')
    const meta = (await req(tx.objectStore(TAKES).get(takeId))) as TakeMeta | undefined
    if (meta && !meta.finalizedAt && !opts?.humanResolved) return
    await req(tx.objectStore(TAKES).delete(takeId))
    // ponytail: full getAll + filter — rows are few and blobs are lazy
    // handles; switch to IDBKeyRange.bound([takeId], [takeId, []]) on the
    // compound key if profiling ever cares.
    const segments = (await req(tx.objectStore(SEGMENTS).getAll())) as SegmentRow[]
    for (const s of segments) {
      if (s.takeId === takeId) await req(tx.objectStore(SEGMENTS).delete([s.takeId, s.seq]))
    }
  } catch (err) {
    console.error('[take-store] deleteTakeRows failed:', err)
  }
}

/** Logout wipe — deletes the SIGNING-OUT user's takes only (call before
 *  supabase signOut, while their uid still resolves). Other staff members'
 *  takes are preserved: they are already invisible to everyone else (owner
 *  gate on every read path), and destroying them here would let staff B's
 *  logout erase staff A's crash-recovery audio — the exact loss this store
 *  exists to prevent. Their cleanup is the 24 h TTL.
 *
 *  PR4: this prunes FINALIZED takes only, because the never-delete guard in
 *  deleteTakeRows (which this sweep calls directly) refuses the rest.
 *  Logging out with audio the server never received no longer destroys it —
 *  the staffer signs back in and the drain finishes it. Unlike the draft
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
      if (m.ownerUid === uid) await deleteTakeRows(m.takeId)
    }
  } catch (err) {
    console.error('[take-store] clearOwnTakes failed:', err)
  }
}

/**
 * EVERY recoverable take for the SIGNED-IN user, newest first. Owner gate at
 * the store layer: another user's takes are hidden (never deleted — their
 * rightful owner can still recover them; TTL cleans up). Expired takes (any
 * owner) are deleted in passing, like loadDraft's stale-draft sweep — unless
 * the never-delete guard refuses them, in which case they are RETURNED, flagged
 * `expiredUnsecured`, instead of vanishing (see the branch below). Takes
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
      // PR4: the TTL asks; the never-delete guard decides. A FINALIZED take
      // expires exactly as it always did — the server has it. The sweep goes
      // through deleteTakeRows (fix round 14, AA3): this prune drops expired
      // takes of EVERY owner, which the door's owner gate cannot answer for.
      const expired = now - lastActivity > TAKE_TTL_MS
      if (expired && m.finalizedAt) {
        void deleteTakeRows(m.takeId)
        continue
      }
      // ⚖ AND A REFUSED PRUNE IS NEVER A SILENT ONE (fix round 1). An expired
      // UNFINALIZED take is audio that exists nowhere else, so the guard keeps
      // it — and this used to `continue` on top of that, which made it immortal
      // AND invisible: the drain skips it (stopped-only), every recovery
      // surface reads this function, and nothing on any screen said tens of
      // megabytes were sitting there. It falls through instead, carrying the
      // flag, and 録音履歴 renders it as a 要対応 row (lib/recordings/inbox.ts)
      // — the one place a human can finish it (保存する) or, once its record
      // exists, settle it (確認する → deleteTake's humanResolved door).
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
        // …and the two facts a stop can leave behind (fix round 18, AH2). Both
        // are optional on RecoverableTake, so their absence type-checked
        // silently and `recoverableReason` could never answer 'tailIncomplete'
        // in production — rounds 16/17 wrote the facts down and this read threw
        // them away.
        tailIncomplete: m.tailIncomplete,
        stopPendingAt: m.stopPendingAt,
        // Only ever true past the TTL with no finalizedAt — the branch above
        // returned every other expired take to the prune.
        expiredUnsecured: expired || undefined,
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
 *  one prune path, one owner gate, no second copy of the rules to drift).
 *
 *  MINUS the expired ones (fix round 1). The banner is the ⚖ 8/20 last-resort
 *  residue for the crash that just happened; a week-old take arriving there as
 *  「復元しますか」 is a different question, and 録音履歴 — which lists every
 *  take with its age and its state — is where it belongs. Nothing is hidden:
 *  the row is in the inbox, counted in 要対応. */
export async function getRecoverableTake(
  excludeTakeIds: ReadonlyArray<string | null | undefined> = [],
): Promise<RecoverableTake | null> {
  return (await listOwnTakes(excludeTakeIds)).find((t) => !t.expiredUnsecured) ?? null
}

/** ⚖ IS THIS TAKE FINISHED? — the one rule the drain's worklist and secureTake
 *  itself both gate on, in one place so they can never drift apart.
 *
 *  THE STOP STAMP is the answer whenever it is there: `durationMs` is written
 *  by stampTakeDuration at onstop, so its presence means a recorder measured
 *  this take and said so. Nothing below weakens that; everything below is what
 *  to do when the stamp is ABSENT.
 *
 *  ⚖ AND ON THE NATIVE SHELL, ABSENT IS NOT UNKNOWABLE (fix round 13). The
 *  stamp is a best-effort IndexedDB write. If it loses (and it now takes three
 *  tries to lose) AND the stop-time upload also fails, a reload takes the
 *  recorder singleton with it — and the take was then excluded from every
 *  drain, device-only, silent. The phone apps are a SINGLE WebView: a page
 *  loading there means no recorder anywhere can be live, so a take that is
 *  · not the singleton's active take (the ONE thing that can answer for a
 *    PAUSED take, which flushes nothing and looks stale within seconds),
 *  · has bytes on disk (lastSeq >= 0), and
 *  · has been quiet longer than ACTIVE_GRACE_MS
 *  is a stopped take whose stamp failed. Its bytes may go.
 *
 *  ⚖ AND THE WEB ASKS THE OTHER TABS (fix round 14; the beat moved onto this
 *  very row in round 15). Round 5's hazard is real — another same-origin tab
 *  can be recording this very take, `isActive` cannot see into it, and a
 *  finalized key is IMMUTABLE, so sealing it there would truncate that
 *  recording forever. But "quiet" was never the same fact as "gone", and until
 *  now the web had no way to tell them apart, which left the failed-stamp case
 *  above device-only on every browser. The beat above is that way: a live
 *  recorder re-stamps `heartbeatAt` every ~5 s, paused or not, so on the web
 *  the same four facts plus a beat that HAS gone stale mean no recorder
 *  anywhere is holding this take. A tab that is merely PAUSED keeps beating and
 *  keeps its take — and one whose timers the browser has THROTTLED to a beat a
 *  minute keeps it too, which is why that window is two minutes and not the
 *  grace.
 *
 *  ⚖ AND THE WEB NEEDS A BEAT TO POINT AT (fix round 17, AF2). Round 14 read a
 *  take that NEVER beat as unheld, which is not a fact about it at all: a
 *  pre-round-15 bundle's take carries no beat, and neither does one paused in a
 *  tab whose storage refused the write — and both are indistinguishable from a
 *  finished recording. Only a beat that EXISTS and has expired says the
 *  recorder that wrote it is gone. Without one the take is left to the inbox
 *  and a human; nothing about it is auto-sealed.
 *
 *  The native shell does not need it (round 13's reading stands on its own: one
 *  WebView, so a page that is loading is proof enough), and must not depend on
 *  it — a take recorded by an older bundle carries no beat at all.
 *
 *  ⚖ AND A TAKE WHOSE TAIL NEVER LANDED IS NEVER "STOPPED" (fix round 16),
 *  on EITHER arm and ahead of every rule below — the stamp included, since a
 *  take that lost its tail is exactly a take no recorder stamped. "Finished"
 *  here has only ever meant one thing: the disk holds the WHOLE recording, so
 *  sealing it under the immutable key cannot orphan anything. A skipped tail
 *  says in so many words that it does not. Round 7 answered this with silence
 *  (leave it unstamped, no drain reads it), and rounds 13/14 then taught both
 *  drains to read unstamped takes — so the fact is written down now.
 *
 *  `isActive` comes from the caller because the recorder is a module singleton
 *  in the layer ABOVE this one (globalRecorder.isActiveTake); a caller with no
 *  recorder in its runtime at all (PR5's launch drain) passes nothing rather
 *  than inventing a check it never made — at launch there is nothing to ask. */
export function isStoppedTake(
  takeId: string,
  meta: Pick<
    TakeMeta,
    | 'durationMs'
    | 'lastSeq'
    | 'updatedAt'
    | 'heartbeatAt'
    | 'tailIncomplete'
    | 'stopPendingAt'
  >,
  isActive?: (takeId: string) => boolean,
): boolean {
  if (meta.tailIncomplete) return false
  if (meta.durationMs !== undefined) return true
  // …and a stop that never finished is not a stop (fix round 17). Read AFTER
  // the stamp, which is the very write that clears this: the flag with no stamp
  // beside it is a leg still in flight, or one that died in it.
  if (meta.stopPendingAt !== undefined) return false
  if (meta.lastSeq < 0) return false
  if (isActive?.(takeId)) return false
  if (Date.now() - meta.updatedAt < ACTIVE_GRACE_MS) return false
  if (isNativeShell()) return true
  // …and on the web the beat on this very row is the only thing that can
  // answer for a recorder in ANOTHER TAB — so there has to BE one: a take that
  // never beat says nothing about who is holding it (AF2 above). A beat older
  // than the throttled cadence a background tab can manage is the only reading
  // that means nothing is holding this take.
  return (
    meta.heartbeatAt !== undefined &&
    Date.now() - meta.heartbeatAt >= HEARTBEAT_STALE_MS
  )
}

/** …and the other side of that coin: a take that will NEVER be sealed under
 *  its finalized key, however many drains run (capture pipeline PR4 fix round
 *  2). Not "not secured yet" — that is an offline stop, and it becomes secured
 *  the moment the phone finds signal. This is the cohort for which waiting is
 *  the wrong answer for ever, and it is read off isStoppedTake's own two
 *  permanent refusals plus the settled-refusal list above:
 *
 *   · `tailIncomplete` — the disk copy is SHORT of what the recorder captured,
 *     and the finalized key is immutable, so sealing it could only truncate the
 *     recording permanently (fix round 16);
 *   · `stopPendingAt` with no `durationMs` — a stop leg that died in flight.
 *     The stamp is the write that clears the flag, so the pair says the stamp
 *     never came and nothing left alive will write it (fix round 17);
 *   · a TERMINAL secureError — the drain has already stopped re-uploading it.
 *
 *  It lives here beside both rules it reads. Its one caller today is the
 *  discard's word-collection (lib/recording/discard-transcript.ts): the audio
 *  of these takes is real and the manager-review half of the ⚖ 8/20 doctrine
 *  needs its words, so that path stages the disk blob instead of waiting for a
 *  finalized object that can never exist. Nothing here deletes, and nothing
 *  here seals: an unsecurable take stays on the device, plainly un-finalized,
 *  as 要対応 for a human. */
export function isUnsecurableTake(
  meta: Pick<TakeMeta, 'durationMs' | 'tailIncomplete' | 'stopPendingAt' | 'secureError'>,
): boolean {
  if (meta.tailIncomplete) return true
  if (meta.stopPendingAt !== undefined && meta.durationMs === undefined) return true
  return meta.secureError !== undefined && TERMINAL_SECURE_ERRORS.has(meta.secureError)
}

/** Every take of the SIGNED-IN user that is KNOWN STOPPED and whose audio the
 *  SERVER DOES NOT HAVE — the record page's mount drain worklist.
 *
 *  ⚖ STOPPED ONLY (capture pipeline PR3 fix round 5). A finalized key is
 *  IMMUTABLE: securing a take whose recorder is still running would upload the
 *  segments flushed so far, finalize them, and leave the rest of the recording
 *  with nowhere to land — permanently truncated audio, in exchange for saving a
 *  few seconds. "Stopped" is isStoppedTake above: the stop stamp, or a take no
 *  recorder can be holding — read from the single WebView on the shell (fix
 *  round 13) and from the cross-tab heartbeat on the web (fix round 14), so a
 *  stamp that lost its write no longer loses the take on either arm.
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
 *  Owner-gated like every other read here.
 *
 *  @param includeCoolingDown counts the takes the cooldown is currently HIDING
 *    as well — the answer to "is anything still owed?", which is not the same
 *    question as "what may I try right now?". The record page's re-drain
 *    (fix round 11) needs both: the eligible list is what it works, and this
 *    one is what tells it whether to keep looking. Without the distinction its
 *    tick would stop on an empty eligible list — which is exactly what a take
 *    that failed a minute ago produces, so the retry would end at the moment it
 *    became necessary.
 *  @param isActive the recorder singleton's own live-take probe, passed by a
 *    caller that shares its runtime — see isStoppedTake, which is the only
 *    thing that reads it. */
export async function listOwnStoppedUnsecuredTakeIds(
  includeCoolingDown = false,
  isActive?: (takeId: string) => boolean,
): Promise<string[]> {
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
          // The proof this take is COMPLETE — the stop stamp, or the native
          // shell's own reading of a stamp that never landed.
          isStoppedTake(m.takeId, m, isActive) &&
          !m.finalizedAt &&
          !(m.secureError && TERMINAL_SECURE_ERRORS.has(m.secureError)) &&
          // ponytail: one flat cooldown, not per-code backoff — the record page
          // mounts on every navigation onto it, and a take is the whole
          // recording, so a failing take would re-PUT tens of megabytes several
          // times a minute. A minute of quiet is enough to stop the storm; the
          // take is never abandoned (the next mount after it takes it).
          (includeCoolingDown ||
            Date.now() - (m.lastSecureAttemptAt ?? 0) >= SECURE_RETRY_COOLDOWN_MS) &&
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
