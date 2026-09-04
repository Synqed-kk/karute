'use client'

import { recordingAudioConstraints } from '@/lib/recording-constraints'
import type { RecordingResult } from '@/hooks/use-media-recorder'
import { startRecordingSession } from '@/actions/recordings'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'
import { secureTake } from '@/lib/recording/secure-take'
import {
  appendTakeSegment,
  clearTakeHeartbeat,
  createTake,
  deleteTake,
  markTakeStartBoundAttempted,
  markTakeStopPending,
  markTakeTailIncomplete,
  readTakeSecureMeta,
  stampTakeDuration,
  stampTakeSession,
  writeTakeHeartbeat,
} from '@/lib/karute/take-store'

/**
 * Global MediaRecorder singleton.
 * Survives React component unmounts/remounts so recording
 * continues when navigating between pages.
 */

type Listener = () => void

export interface RecordingTarget {
  customerId: string
  customerName: string
  karuteNumber: string | null
  appointmentId: string | null // null = walk-in (no booking)
  // Display snapshot for the 録音対象 card, captured at recording start so
  // the card keeps the booking's pixels while live instead of degrading to
  // placeholders (field bug 7/29: 担当:— mid-recording). Optional: takes
  // persisted before this change lack them and fall back to placeholders.
  service?: string | null
  timeRange?: string | null
  statusKey?: import('@/components/karute/redesign/record/RecordingTargetCard').RecordTargetAppointment['statusKey']
  isNew?: boolean
}

// ── Runaway-recording safety nets ────────────────────────────────────────────
// Interim guard until segmented capture removes the length ceiling entirely.
// Tied to the storage limit: at 48 kbps a recording is ~0.36 MB/min, and the
// effective upload cap is 50 MB (Supabase Free plan's global file size limit —
// it overrides any larger per-bucket value, so ~139 min is the absolute max).
// The 2h hard stop yields ~43 MB, a comfortable margin under the cap, so the
// auto-saved recording can still upload. A forgotten 3-4h recording would
// otherwise be both too big to save AND a total loss of the session.
//
// NOTE: this only covers a recording the OS keeps alive (e.g. phone on the
// counter, screen on). A pocketed/locked phone still SUSPENDS capture (a
// native background-audio concern); what take-store persistence guarantees is
// that whatever WAS captured before the suspension/kill is recoverable.
const OVERRUN_WARN_MS = 100 * 60_000 // 1h40 — soft "still recording?" nudge (past any booked session)
const AUTO_STOP_MS = 120 * 60_000 // 2h — hard stop-and-save (~43 MB, keeps blob < 50 MB cap)
const RUNAWAY_TICK_MS = 15_000 // how often we re-check the elapsed recording time

// Take durability: flush accumulated chunks to IndexedDB (take-store) every
// ~5 s — NOT per 100 ms chunk, so the disk isn't ground — plus on pause/stop/
// visibilitychange-hidden. Persistence is best-effort and must NEVER block
// capture: any failure disables the layer for this take and recording
// continues memory-only exactly as before.
const TAKE_FLUSH_MS = 5_000

// How long any caller waits on the session-id mint before giving up. Shared by
// awaitRecordingSessionId and the retry below so "bounded the same way" is a
// fact rather than two literals that can drift apart.
const MINT_AWAIT_MS = 1_500

// How long the STOP path waits for that mint before it secures the take anyway
// (fix round 10, P1). Longer than the save-time wait on purpose: this is the
// one moment where waiting COSTS nothing visible — `recorded` has already
// rendered and the card is on screen — and buys everything, because a mint
// that lands before secureTake reads the take makes the whole late-reply race
// unreachable rather than merely survivable. The phone's own door aborts at
// the same 10 s (thin/ports/actions.vite.ts), so on that arm this deadline and
// the socket's expire together; the web arm is a server action with no signal
// to give, and this race IS its bound.
export const SECURE_MINT_AWAIT_MS = 10_000

// The BELT on awaitTakeSecured (fix round 2 of PR4): how long a reader will
// wait on a stop leg that never exits before it goes on without it. Same figure
// as take-store's HEARTBEAT_STALE_MS (120 s) and read the same way — a leg
// quiet for two minutes is AD1's hung store, not a slow upload, and a pipeline
// that waits on it for ever is a recording the staffer can never finish. Past
// the belt the reader proceeds and the port's existing staging fallback does
// exactly what it does today.
const SECURE_SETTLE_BELT_MS = 120_000

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const formats = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ]
  return formats.find(f => MediaRecorder.isTypeSupported(f)) ?? ''
}

/** One take's persistence state (fix round 20). Everything a queued take-write
 *  reads about the recording it belongs to, in one object the NEXT take cannot
 *  reach: start() and discard() replace `this.persist` rather than resetting
 *  fields under tasks that are already in the queue. */
type TakePersist = { chunks: Blob[]; seq: number; count: number; disabled: boolean }

class GlobalRecorder {
  state: 'idle' | 'recording' | 'paused' | 'recorded' = 'idle'
  result: RecordingResult | null = null
  error: string | null = null
  stream: MediaStream | null = null
  startedAt: number | null = null
  /** True once recording passes OVERRUN_WARN_MS — UI shows a "still recording?" nudge. */
  overrun = false
  /** True when the hard cap auto-stopped + saved the recording (UI informs staff). */
  autoStopped = false
  /** Customer/appointment the recording is BOUND to, captured at start(). The
   *  single source of truth for what the save attaches to — immune to nav drift.
   *  Survives stop→complete; cleared only on discard(). */
  target: RecordingTarget | null = null
  /** Server-minted `recording_sessions.id` (synqed-core), fired in parallel with
   *  getUserMedia at start() so it never delays/blocks the mic. null until it
   *  resolves, and null forever if the mint failed — the save then proceeds
   *  without it exactly as before this existed (no dedupe for that save). */
  recordingSessionId: string | null = null
  /** Id of the take being persisted to take-store. Set at start(); survives
   *  stop → handoff (the persisted audio outlives the recorder — deleted only
   *  on save/discard/logout/TTL); cleared on discard(). null while idle or
   *  when persistence is disabled for this take. */
  takeId: string | null = null

  private recorder: MediaRecorder | null = null
  /** Take-durability flush state, ONE OBJECT PER TAKE (fix round 20). `count`
   *  indexes into `chunks` (how many are already on disk); the queue serializes
   *  flushes so timer / pause / visibility triggers never interleave.
   *
   *  ⚖ AND EVERY QUEUED TASK CAPTURES IT BY REFERENCE. These were four fields
   *  on the singleton, read at RUN time by tasks the stop leg had already
   *  queued — so a start() or a discard landing inside the queue tail's
   *  IndexedDB latency reset them under the OLD take's own tasks, and a
   *  recording that had finished was written down as 途中 and withheld from
   *  every automatic drain (rounds 18 and 19 each closed one interleaving of
   *  exactly this). start() and discard() REPLACE this object; the old take's
   *  tasks keep the old one, and nothing they read can be changed by anything
   *  but their own writes. */
  private persist: TakePersist = { chunks: [], seq: 0, count: 0, disabled: false }
  private persistTimer: ReturnType<typeof setInterval> | null = null
  private persistQueue: Promise<void> = Promise.resolve()
  /** Takes this recorder STOPPED but has not finished securing (fix round 14,
   *  AA1). Between onstop and the end of that leg every drain rule in THIS
   *  runtime reads the take as free to seal — it is unstamped (the stamp comes
   *  after the tail flush), `state` is 'recorded', and a slow IndexedDB write
   *  can push the last flush past ACTIVE_GRACE_MS while the tail is still
   *  being written. (Another TAB's drain is held off by the beat onstop writes
   *  instead — this set only ever knew about its own runtime.) Sealing there would upload only the
   *  COMMITTED segments under the IMMUTABLE finalized key and the tail could
   *  never land: truncated audio, permanently. So isActiveTake answers for
   *  these too — until the tail IS on disk and the row is stamped, which is
   *  where the leg releases the hold (everything after that point may take the
   *  take, and takes it whole).
   *
   *  ⚖ AND THE HOLD LASTS UNTIL THE LEG LETS GO (fix round 16). Round 15 gave
   *  it a two-minute deadline so a leg that never exits could not pin a take
   *  for the page's life — but that deadline expired in LOCKSTEP with the
   *  heartbeat's own 120 s window, so at the two-minute mark both defences
   *  fell in the same instant and the take became drainable while its tail was
   *  still unwritten: the prefix sealed under the immutable key. The two
   *  outcomes are not comparable — a pinned take keeps its audio on the device
   *  until the next launch drain, a sealed one loses the rest of the recording
   *  forever — so the hold has no deadline, and the Set dies with the page. */
  private securingTakeIds = new Set<string>()
  /** Keeps the cross-tab beat alive for every take this leg is holding (fix
   *  round 16). The flush timer that normally writes it is cleared at the top
   *  of onstop, so without this the beat written there is the LAST one and a
   *  hold outliving HEARTBEAT_STALE_MS leaves the tab next door reading a
   *  stale beat on a take whose tail is still unwritten.
   *
   *  ponytail: same ~5 s cadence and the same persist queue as the live beat —
   *  the ceiling that buys is a store request that never answers, which blocks
   *  the queue and every beat behind it. That case needs nothing else: a
   *  never-settling readwrite transaction on the take row blocks every OTHER
   *  tab's read of the same store too (IndexedDB serializes overlapping
   *  scopes), so no drain anywhere has a worklist to seal from. */
  private securingBeatTimer: ReturnType<typeof setInterval> | null = null
  /** The stop leg itself, per take, for the whole of its life — set in `onstop`
   *  and dropped in the leg's own `finally` (fix round 2 of PR4).
   *
   *  ⚠ IT IS NOT `securingTakeIds`, and the difference is the entire point.
   *  That hold answers "may anything else SEAL this take?", so it has to be
   *  released BEFORE the leg calls secureTake — secureTake asks `isActive`
   *  first and would otherwise refuse the one caller holding the live
   *  measurement (see the release below). Which means the hold is already gone
   *  for the whole of the PUT and the finalize: a reader that asked it "is the
   *  stop still working on this take?" would be told no while 43 MB is in
   *  flight, read `finalizedPath` as null, and stage a SECOND whole copy of
   *  the same recording to a row-less key. The leg's own promise is the only
   *  thing in this file that spans the upload, so it is what `awaitTakeSecured`
   *  waits on. */
  private stopLegs = new Map<string, Promise<void>>()
  private startTime = 0
  private pausedDuration = 0
  private pauseStart = 0
  private runawayTimer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<Listener>()
  /** The in-flight session-mint promise from the current recording, so save
   *  time can await it briefly instead of only reading whatever has resolved
   *  so far. Cleared on discard(). */
  private recordingSessionPromise: Promise<string | null> | null = null
  /** True from the moment a mint is ISSUED until it settles. `recordingSessionId`
   *  reads null in BOTH the failed and the still-in-flight case, so this is the
   *  only thing that lets the retry below tell "it failed, mint again" apart
   *  from "it is merely slow, wait for it". */
  private recordingSessionMintInFlight = false
  /** The take the in-flight mint will stamp, or null for "the recorder's own
   *  live take, read at resolution" (start()'s mint, fired before the take
   *  exists). The retry reuses an in-flight mint ONLY when it is for the same
   *  take — a session minted for a different one would key the discard row to
   *  the wrong recording, which is worse than the orphan row it avoids. */
  private recordingSessionMintTakeId: string | null = null
  /** True when the mint above was issued while ANOTHER take was still live —
   *  the one case where the null marker must NOT be read as "the live take":
   *  start() fires its mint before creating its own take, so a take sitting
   *  there belongs to the PREVIOUS recording. Pins what the retry's fallback
   *  silently assumed (start() runs with no take live) — and, since fix round
   *  12, what mintStampTakeId reads to keep a fast reply off that take. True
   *  only for the window between the mint and start() naming its own take. */
  private recordingSessionMintTakeUnknown = false
  /** Staleness guard for the mint. A slow mint from recording A resolving
   *  AFTER discard()/a new start() must not stamp its id (minted for A's
   *  customer) onto recording B — bump on every start() and discard(); the
   *  mint's .then only writes when its generation is still current. */
  private recordingSessionGen = 0
  version = 0

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private notify() {
    this.version++
    this.listeners.forEach(fn => fn())
  }

  /** Actual recorded milliseconds, excluding paused time (incl. an ongoing pause). */
  private recordedMs(): number {
    const pausedNow = this.state === 'paused' ? Date.now() - this.pauseStart : 0
    return Date.now() - this.startTime - this.pausedDuration - pausedNow
  }

  private armRunawayGuard() {
    this.clearRunawayGuard()
    this.runawayTimer = setInterval(() => {
      const ms = this.recordedMs()
      if (ms >= AUTO_STOP_MS) {
        // Hard cap: stop + save so a forgotten recording is never lost to size and
        // never grows past what the storage bucket accepts. stop() routes through
        // onstop → the existing pipeline saves it.
        this.autoStopped = true
        this.stop()
        return
      }
      if (ms >= OVERRUN_WARN_MS && !this.overrun) {
        this.overrun = true
        this.notify()
      }
    }, RUNAWAY_TICK_MS)
  }

  private clearRunawayGuard() {
    if (this.runawayTimer) {
      clearInterval(this.runawayTimer)
      this.runawayTimer = null
    }
  }

  // ── Take durability (see lib/karute/take-store.ts) ─────────────────────────

  private handleVisibilityHidden = () => {
    // The last flush before a WKWebView suspension/kill — the whole point.
    if (document.visibilityState === 'hidden') this.flushTake()
  }

  private armTakePersistence() {
    this.clearTakePersistence()
    this.persistTimer = setInterval(() => {
      // ⚖ THE CROSS-TAB LIVENESS SIGNAL (fix round 14), riding the flush timer
      // rather than a third one of its own. On the web the drain cannot see
      // into another tab, so a take that is merely PAUSED there — flushing
      // nothing, stale within seconds — was indistinguishable from a stopped
      // one whose stop stamp was lost. This says "a recorder still has it",
      // every 5 s, for as long as this timer lives: start() arms it and only
      // the stop and discard paths clear it, which is exactly the
      // recording-or-paused window. The state check is the belt for that.
      if (
        this.takeId &&
        (this.state === 'recording' || this.state === 'paused')
      )
        this.queueHeartbeat(this.takeId)
      this.flushTake()
    }, TAKE_FLUSH_MS)
    document.addEventListener('visibilitychange', this.handleVisibilityHidden)
  }

  private clearTakePersistence() {
    if (this.persistTimer) {
      clearInterval(this.persistTimer)
      this.persistTimer = null
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityHidden)
    }
  }

  /** The beat, QUEUED rather than fired beside the flush (fix round 15) — see
   *  queueTakeWrite below for why the two must never interleave. */
  private queueHeartbeat(takeId: string) {
    void this.queueTakeWrite(() => writeTakeHeartbeat(takeId))
  }

  /** …and its CLEAR rides the same queue (fix round 16, AD2). Fired straight
   *  at the store it could run BEFORE a beat already queued behind a flush,
   *  and the beat would then land last — resurrecting a two-minute claim on a
   *  take no recorder is holding any more. */
  private queueClearHeartbeat(takeId: string) {
    void this.queueTakeWrite(() => clearTakeHeartbeat(takeId))
  }

  /** Any take-row write that must not interleave with the segment flush,
   *  returning the tail so a caller can wait for it. Every write here is a
   *  read-modify-write of the SAME row the flush bumps (`lastSeq`,
   *  `updatedAt`), and real IndexedDB serializes overlapping transactions
   *  where the tests' shim does not — a lost `lastSeq` is a take with no bytes
   *  as far as every drain is concerned. One queue, one order, both places.
   *  Never rejects (the store swallows its own errors); the catch is the belt,
   *  since a rejected queue would make the NEXT flush disable persistence. */
  private queueTakeWrite(write: () => Promise<unknown>): Promise<void> {
    const done = this.persistQueue.then(write).then(
      () => {},
      () => {},
    )
    this.persistQueue = done
    return done
  }

  /** Hold this take against every drain in THIS runtime, and keep it beating
   *  for the tabs next door, until the stop leg lets go (fix round 16). */
  private holdTakeForSecuring(takeId: string) {
    this.securingTakeIds.add(takeId)
    this.queueHeartbeat(takeId)
    // Re-armed rather than left alone when one is already running: one stop
    // leg at a time in practice, and re-arming can never strand an interval.
    if (this.securingBeatTimer) clearInterval(this.securingBeatTimer)
    this.securingBeatTimer = setInterval(() => {
      for (const id of this.securingTakeIds) this.queueHeartbeat(id)
    }, TAKE_FLUSH_MS)
  }

  /** The tail is on disk (or was skipped and written down as such): nothing
   *  short is left for anyone to seal, so the hold goes and the beat with it. */
  private releaseTakeSecuringHold(takeId: string) {
    this.securingTakeIds.delete(takeId)
    if (this.securingTakeIds.size > 0 || !this.securingBeatTimer) return
    clearInterval(this.securingBeatTimer)
    this.securingBeatTimer = null
  }

  /** Flush chunks not yet on disk as one segment. Serialized via the queue;
   *  fire-and-forget — MUST never block or throw into the capture path.
   *
   *  Returns the queue tail so ONE caller can wait for it: onstop must know the
   *  tail segment is on disk before secureTake reads the take back, or the
   *  uploaded object would be short by the last chunk. Every other caller still
   *  ignores it, and the promise never rejects (the catch below is the queue's).
   *
   *  ⚖ AND IT SAYS WHETHER IT WROTE (fix round 7, P1 — RE-BASED fix round 20).
   *  `true` = the disk holds this take's chunks (it wrote them, or there was
   *  nothing left to write); `false` = the WRITE ITSELF FAILED, which is now the
   *  ONLY way a tail can be short. It used to mean "the recorder moved on before
   *  the queued task ran" as well — the staffer stopped and immediately started
   *  the next recording, or discarded — because the task read the singleton's
   *  chunks and counters at RUN time and start()/discard() had reset them under
   *  it. Both are captured per take now: a stop followed by any next action
   *  still writes its OWN tail from its OWN array, and the stop leg marks
   *  `tailIncomplete` only for a tail that genuinely did not land. That mark is
   *  what keeps a SHORT take from being sealed under its immutable finalized
   *  key, which would truncate it forever. */
  private flushTake(stampDurationMs?: number): Promise<boolean> {
    // Captured at QUEUE time, synchronously, before any `.then`: this take's
    // own state and this take's own id (fix round 20).
    const p = this.persist
    const takeId = this.takeId
    if (p.disabled || !takeId) return Promise.resolve(false)
    const flushed = this.persistQueue
      .then(async () => {
        // Re-read inside the queued task, because an EARLIER flush of THIS take
        // may have disabled persistence — the only writer `p` has.
        if (p.disabled) return false
        const pending = p.chunks.slice(p.count)
        if (pending.length === 0) return true
        const seq = p.seq
        const count = p.count + pending.length
        // ⚖ THE STAMP RIDES THIS WRITE (fix round 18, AG3). The stop's own
        // duration goes into the SAME transaction as the tail bytes, so the
        // fact that the take is complete cannot lose on its own — see AG1.
        const ok = await appendTakeSegment(takeId, seq, new Blob(pending), stampDurationMs)
        if (!ok) {
          // ponytail: fail-open to memory-only — capture continues as today.
          p.disabled = true
          return false
        }
        p.seq = seq + 1
        p.count = count
        return true
      })
      .catch(() => {
        p.disabled = true
        return false
      })
    // The queue itself stays a plain chain — the answer rides out to the one
    // caller that waits, and the next flush still serializes behind this one.
    this.persistQueue = flushed.then(() => {})
    return flushed
  }

  /**
   * WHICH take a mint resolution may stamp — or adopt a row from (fix round
   * 12, P1).
   *
   * The omitted-`stampTakeId` fallback means "the recorder's own live take,
   * read at resolution", and that reading is only true once the take exists.
   * start() fires its mint BEFORE getUserMedia and therefore before it names
   * its take, so a take sitting on the singleton at that moment is the
   * PREVIOUS recording's — stopped, maybe already stamped and secured. A fast
   * reply then stamped B's row onto A (refused, A has one), read A's stamp
   * back, and made A's row the recorder's: B was born on A's row, B's own mint
   * reserved against it, and the door answered `reserved_elsewhere` — terminal.
   * B's audio never left the device and B's karute pointed at A's session.
   *
   * `recordingSessionMintTakeUnknown` is exactly that condition, so null here
   * means "no take of mine yet": stamp nothing, adopt nothing, and let the
   * minted id stand. It reaches the new take the way it always did — start()
   * hands `recordingSessionId` to createTake, and createTake's callback
   * re-stamps — first-write-wins for THAT take.
   *
   * Only ever read from inside the generation guard, so the flag still belongs
   * to this mint: a newer one would have bumped the generation.
   */
  private mintStampTakeId(explicit?: string | null): string | null {
    return explicit ?? (this.recordingSessionMintTakeUnknown ? null : this.takeId)
  }

  /**
   * The session mint itself, extracted from start() so a FAILED one can be
   * re-run (see retryRecordingSessionMint). Assigns the held promise and
   * returns it.
   *
   * Gen-guarded exactly as start()'s mint always was — this IS start()'s mint,
   * lifted, not a second copy: a resolution whose generation is no longer
   * current belongs to a take the user has since discarded or replaced, so its
   * id must never be stamped onto whatever is live now.
   */
  private mintRecordingSession(input: {
    customerId: string | null
    appointmentId: string | null
    /** Take to stamp when the mint lands. Omitted → the recorder's own live
     *  `takeId` READ AT RESOLUTION TIME, which is what start() needs: it fires
     *  the mint before it creates the take, so capturing the value here would
     *  capture null. Passed explicitly by the review-path retry, whose take is
     *  held by the pipeline rather than by this singleton. */
    stampTakeId?: string | null
    /** ⚖ THE ROW IS BORN RESERVED (fix round 8, the client half of PR2 fix
     *  round 10). The take this row is for and the container the recorder
     *  negotiated, sent TO THE DOOR so it composes this take's finalized key
     *  and creates the row already pointing at it — one atomic create, no
     *  unbound window for two client-named mints to race in.
     *
     *  Deliberately NOT `stampTakeId`: this pair is what the door is told,
     *  while that one decides which take a resolution stamps. start() passes
     *  this one and not that one, because the mint still fires before the take
     *  exists as far as every other caller is concerned (retryRecordingSession-
     *  Mint's in-flight sharing reads that field, and start()'s mint is not
     *  its to share).
     *
     *  BOTH OR NEITHER — the door's schema refuses half a pair — so a take with
     *  no uuid to name (the composed fallback id below) or no negotiated
     *  container simply gets today's create.
     *
     *  ⚖ AND IT IS SENT ONCE (fix round 9). A create that carries a key is not
     *  blind-retry-safe: a lost reply after a successful create leaves us with
     *  no id, and the same take composes the same key, which core's unique
     *  index refuses forever. So ANY failure of a reserved create steps back to
     *  the argument-less one — below, inside this method — and every LATER
     *  attempt for the take reads `startBoundAttempted` off its meta and never
     *  offers the pair again. */
    reserve?: { takeId: string; mimeType: string } | null
  }): Promise<string | null> {
    // ⚖ A MINT FOR SOMEONE ELSE'S TAKE TOUCHES NOTHING HERE (fix round 19,
    // AJ1). The recovery / 録音履歴 保存する path and the discard gate name a
    // take the PIPELINE holds; the generation, the in-flight flags and the
    // field all speak for the recording THIS recorder is making. Bumping the
    // generation for a foreign mint dropped the live take's own start-mint at
    // its resolution: tap 録音開始, then 保存する on the banner still on screen
    // from mount, and the live take ends with no session id on its row and
    // `startBoundAttempted` already true — so secureTake takes the unbound
    // branch, mints a second row, and the upload mint answers
    // `reserved_elsewhere`, which is TERMINAL. The flags carry the mirror of
    // it: the foreign mint wrote `TakeUnknown = false` over the `true` start()
    // had just set, and a start-mint resolving before getUserMedia names the
    // take then falls back to the PREVIOUS recording's take (round 12, P1).
    // So a foreign mint is a PURE ROW-STAMPING MINT: its take's own stamp
    // (first write wins) and its return value, and nothing else.
    const foreign = input.stampTakeId != null && input.stampTakeId !== this.takeId
    const gen = foreign ? this.recordingSessionGen : ++this.recordingSessionGen
    if (!foreign) {
      this.recordingSessionMintInFlight = true
      this.recordingSessionMintTakeId = input.stampTakeId ?? null
      // Cleared the moment start() names its take (fix round 12, P1) — until
      // then it is what stops a resolution stamping/adopting on the previous
      // recording's take. discard() clears it too.
      this.recordingSessionMintTakeUnknown =
        input.stampTakeId == null && this.takeId !== null
    }
    // Assembled as a value, not an object literal at the call site: the action
    // learns the optional pair in PR2 fix round 10, and until that lands a
    // literal would be an excess-property error against its current signature.
    // The phone's door (thin/ports/actions.vite.ts) already reads them, and
    // steps back once if the server it is talking to does not.
    const args = {
      customerId: input.customerId,
      appointmentId: input.appointmentId,
      ...(input.reserve ?? {}),
    }
    const promise = startRecordingSession(args)
      // ⚖ ONE BOUND ATTEMPT, THEN THE UNBOUND ONE (fix round 9). Round 8's step
      // back lived in the phone's doors and fired only on the door's own 400.
      // Every other failure — a 409 on the key, a 5xx, a timeout, a reply lost
      // on the way back — left the take with no row at all, and no second
      // bound try can ever fix that (it composes the same key). So the step
      // back happens HERE, on ANY failure, and it is the argument-less create:
      // an unbound row, which the upload mint still reserves through its legacy
      // update path. Never a loop — one step, once.
      //
      // A stale generation spends nothing: its row would belong to a take the
      // user has already discarded or replaced.
      .then(async (res) => {
        if (res || !input.reserve || (!foreign && gen !== this.recordingSessionGen))
          return res
        // ⚖ NEVER STEP BACK ONTO A TAKE THAT ALREADY HAS ITS ROW (fix round
        // 10). A bound create that fails SLOWLY can find the stop path already
        // finished: secureTake minted this take's row through the session door
        // and stamped it. An argument-less create here would make a second row
        // for one take — an orphan nothing ever points at, one per slow
        // start-mint. The stamp is the answer, so take it and mint nothing.
        const stampTakeId = this.mintStampTakeId(input.stampTakeId)
        const stamped = stampTakeId
          ? (await readTakeSecureMeta(stampTakeId))?.recordingSessionId
          : null
        if (stamped) return { id: stamped }
        return startRecordingSession({
          customerId: input.customerId,
          appointmentId: input.appointmentId,
        })
      })
      .then(async (res) => {
      // Stale mint (user discarded / started a new recording while this was
      // in flight): drop it — its row belongs to a different take/customer.
      // The flag is NOT cleared here: it belongs to whichever mint owns the
      // current generation, and that one is still in flight.
      if (!foreign && gen !== this.recordingSessionGen) return null
      // Settled (this call swallows every failure to null, so it never rejects).
      if (!foreign) this.recordingSessionMintInFlight = false
      // Stamp the persisted take so a crash-recovered save still dedupes.
      // (If the meta row isn't written yet, createTake's callback re-stamps.)
      //
      // ⚖ FIRST WRITE WINS, AND A LATE REPLY ADOPTS (fix round 10, P1). The
      // store refuses this write when the take already carries a row — the one
      // secureTake minted and finalized the audio against while this call was
      // still out. Re-pointing the take at THIS row would strand the karute
      // beside audio that is on the other one, so the take keeps what it has
      // and the recorder takes it too: this field is what the save reads, and
      // it must name the row the audio is on. AWAITED, not fired off, because
      // awaitRecordingSessionId resolves with this promise — an id read before
      // the adoption settled would be the wrong one.
      const stampTakeId = this.mintStampTakeId(input.stampTakeId)
      const minted = res?.id ?? null
      const id =
        stampTakeId && minted && !(await stampTakeSession(stampTakeId, minted))
          ? ((await readTakeSecureMeta(stampTakeId))?.recordingSessionId ?? minted)
          : minted
      // Re-read after the store round trip: a discard (or a new start) while it
      // ran means this id belongs to a recording that is no longer here — a
      // FOREIGN take's id belongs to a recording this recorder never held, so
      // nothing it does can make it stale (AJ1).
      if (!foreign && gen !== this.recordingSessionGen) return null
      // ⚖ …AND A MINT FOR SOMEONE ELSE'S TAKE STOPS AT ITS OWN ROW (fix round
      // 18, AH1). The take's row stamp above IS the record — first write wins —
      // and every caller of the review path uses this return value. Writing the
      // field as well is what handed the NEXT reader another take's session:
      // the recovery save through retryRecordingSessionMint, and the recorder's
      // own stopped take at its karute save, which reads this field through
      // awaitRecordingSessionId. An IDLE recorder (`takeId === null`) is
      // included — a foreign mint there has no owner to speak for.
      //
      // `stampTakeId === null` is NOT a foreign mint: it is start()'s own mint
      // resolving inside the window before start() has named its take
      // (mintStampTakeId's `TakeUnknown`), and that id belongs to this
      // recorder. Excluding it would leave the field null with the row never
      // stamped either, and the next retry would mint a SECOND row for the
      // recording — so it keeps today's write.
      if (stampTakeId !== null && stampTakeId !== this.takeId) return id
      this.recordingSessionId = id
      this.notify()
      return this.recordingSessionId
    })
    // The same rule for the held promise (fix round 18, AH1): awaitRecording-
    // SessionId falls back to it whenever the field is null, so a foreign mint
    // parked here would be read by the recorder's own save just as surely.
    // `stampTakeId` is read at RESOLUTION time by the write guard above; here
    // only the explicit argument can be known, and it is exactly what the
    // review path passes — which is `foreign` itself, computed at entry.
    if (!foreign) this.recordingSessionPromise = promise
    return promise
  }

  async start(opts?: { noiseSuppression?: boolean; target?: RecordingTarget | null }) {
    // The take this recorder was holding is over the moment the next one
    // begins — its liveness key must not outlive it (fix round 14). Normally
    // already removed by the stop or discard that got here; this is the belt
    // for the paths that reach start() with a take still named.
    const previousTakeId = this.takeId
    if (previousTakeId) this.queueClearHeartbeat(previousTakeId)
    this.error = null
    this.result = null
    this.pausedDuration = 0
    this.overrun = false
    this.autoStopped = false
    this.target = opts?.target ?? null
    this.recordingSessionId = null

    // ⚖ BORN RESERVED (fix round 8) — both facts the door composes this take's
    // finalized key from are knowable BEFORE the mic: the id is ours to name,
    // and the container is a static capability probe (isTypeSupported needs no
    // permission and no stream). So they are settled here, ahead of the mint,
    // and used again below where they always were — the take is created at the
    // same moment it always was, this only names it earlier.
    //
    // A take id is a uuid or it is nothing the server will sign for: the key
    // grammar (composeTakeKey) refuses anything else, so the composed fallback
    // id is NEVER sent — it would be a 400 on every start. Same for a browser
    // that negotiated no container: half a pair is refused, so neither goes.
    const uuid =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null
    const mimeType = getSupportedMimeType()
    // Settled once, because the take row has to REMEMBER that this start sent a
    // bound create (fix round 9): the pair the door is offered and the flag the
    // take is born with must never disagree.
    const reserve = uuid && mimeType ? { takeId: uuid, mimeType } : null

    // Mint the recording-session id (synqed-core) IN PARALLEL with getUserMedia
    // below — a network call must NEVER block or delay the mic prompt. Held so
    // handleUseRecording can await it briefly at save time; a slow/failed mint
    // just leaves this null (save proceeds without recording_session_id).
    void this.mintRecordingSession({
      customerId: this.target?.customerId ?? null,
      appointmentId: this.target?.appointmentId ?? null,
      reserve,
    })

    let micStream: MediaStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: recordingAudioConstraints(opts?.noiseSuppression ?? true),
        video: false,
      })
    } catch {
      this.error = 'Microphone access denied.'
      // The mint above went out before the prompt did, so a refusal leaves a
      // row for a recording that will never exist. Nothing may file against it
      // — see abandonRecordingSessionMint (fix round 13, P3).
      this.abandonRecordingSessionMint()
      this.notify()
      return
    }

    this.stream = micStream
    // Voice-optimized bitrate. The browser default (~128 kbps) makes a 60-90 min
    // session ~80-90 MB, which blows past Supabase Storage's per-bucket limit
    // (50 MB on Free) — the upload fails with "object exceeded the maximum allowed
    // size". 48 kbps opus is ~2.7x smaller (~32 MB for 90 min) and keeps a
    // comfortable accuracy margin: ASR shows no significant Opus degradation at
    // ≥16 kbps, so 48 leaves 3x headroom for noisy-salon / phone-mic / 2-speaker
    // audio. Deepgram accuracy tracks sample rate, not bitrate. (Pair with a
    // raised bucket file_size_limit + resumable uploads for 2-hr sessions.)
    const recorder = new MediaRecorder(micStream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 48_000,
    })

    // ⚖ THIS TAKE'S OWN PERSISTENCE STATE (fix round 20), replacing whatever
    // the previous take left on `this.persist` and captured by reference here
    // — the one place both recorder callbacks and everything they queue can
    // read it from. Past the mic (a discard during the permission prompt is
    // therefore behind us, and cannot leave the callbacks writing into an
    // object the recorder no longer publishes) and synchronous from here to
    // `armTakePersistence`, so nothing can flush against a half-named take.
    const p: TakePersist = { chunks: [], seq: 0, count: 0, disabled: false }
    this.persist = p

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) p.chunks.push(e.data)
    }

    recorder.onstop = () => {
      this.clearRunawayGuard()
      const totalElapsed = Date.now() - this.startTime
      const durationMs = totalElapsed - this.pausedDuration
      const blob = new Blob(p.chunks, { type: mimeType || recorder.mimeType })
      this.result = { blob, mimeType: mimeType || recorder.mimeType, durationMs }
      this.state = 'recorded'
      this.startedAt = null
      micStream.getTracks().forEach(t => t.stop())
      this.stream = null
      // Final tail flush (onstop fires after the last ondataavailable). The
      // timer stops but the persisted take is KEPT — it outlives the recorder
      // until the karute record is saved / discarded / TTL / logout.
      this.clearTakePersistence()
      const takeId = this.takeId
      if (takeId) {
        // ⚖ ONE FRESH BEAT, NOT A CLEAR (fix round 15), AND IT KEEPS BEATING
        // (round 16). Round 14 removed the liveness signal here, at the TOP of
        // the leg — and everything below it is precisely the window in which
        // the take on disk may still be SHORT: the stamp is not written yet
        // and the tail flush has not landed. `securingTakeIds` holds this
        // runtime off, but it cannot speak to ANOTHER TAB, whose drain would
        // then read an unstamped, quiet, unbeating take as free to seal —
        // under the immutable key, with the tail still queued behind it. So
        // the hold beats for the take until the `finally` below releases it,
        // which is where the beat is cleared and where there is no short blob
        // left for anyone to seal. Taken BEFORE flushTake(), so no drain in
        // this runtime can read the gap either. (AA1 — securingTakeIds.)
        this.holdTakeForSecuring(takeId)
        // ⚖ …AND THE STOP ITSELF GOES ON THE ROW FIRST (fix round 17). Both
        // defences above die with this page: the hold is a Set in memory and
        // the beat stops being written the moment nothing is beating it. Every
        // way this leg can end without writing what it learned — round 16's
        // marker write failing, the tab closing mid-stop — therefore leaves the
        // take looking exactly like one that finished, and the drain seals the
        // committed prefix under the immutable key. Queued AHEAD of the tail
        // flush (one queue, one order), so the fact is on disk before anything
        // can release either defence, and it is cleared by the duration stamp.
        // ⚖ …AND THE FIRST ACT ASKS WHETHER THE DISK IS ALREADY WHOLE (fix
        // round 18, AG2). Evaluated INSIDE the queue, i.e. after every earlier
        // flush of THIS take has settled, which is the only moment `p.count` is
        // exact and `p.chunks` is final (onstop is the last data event, and
        // since fix round 20 nothing outside this take can touch either — the
        // next start() and a discard REPLACE the object rather than reset it,
        // so what this reads at run time is this take's own account of itself).
        // Nothing left to write ⇒ this write IS the stamp, so there is no
        // separate stamp write left to lose. A tail still owed ⇒ the stop is a
        // fact first and the stamp rides the tail (AG3).
        //
        // ponytail: if this FIRST act loses, IndexedDB is refusing writes at
        // the stop instant and the flush queued behind it will most likely lose
        // too → `p.disabled`, memory-only capture exactly as before PR3, and
        // the row carries no fact — the next drain reads it as rounds 13/14 do.
        // That is loss window 8, accepted; it is not the round-17 shape round 18
        // removed (a stamp lost AFTER a stop-pending write that landed).
        void this.queueTakeWrite(() =>
          !p.disabled && p.chunks.length === p.count
            ? stampTakeDuration(takeId, durationMs)
            : markTakeStopPending(takeId),
        )
      }
      const flushed = this.flushTake(durationMs)
      this.notify()
      // ⚖ THE AUDIO BECOMES SAFE HERE, not at 録音を使用 (design R4, v2 items
      // 1-2). Deliberately last and deliberately un-awaited: `recorded` is
      // already set and notify() has already run, so the card renders at the
      // same instant it always did — offline included. The tail flush IS
      // awaited first (secureTake reads the take back off disk), and whatever
      // this cannot finish is recorded on the take meta for the record page's
      // mount retry, and for PR5's launch drain after that.
      if (takeId) {
        // …AND THE LEG IS SOMETHING A READER CAN WAIT ON (fix round 2 of PR4).
        // Registered here, synchronously inside onstop and before the callback
        // can run, so there is no instant at which the stop is under way and
        // the map says otherwise — which is exactly the instant the 自動
        // pipeline starts in. Dropped in the `finally` below. See
        // awaitTakeSecured for why `securingTakeIds` cannot answer this.
        const leg = flushed.then(async (flushedWholeTake) => {
          try {
            // ⚖ A SKIPPED TAIL SEALS NOTHING (fix round 7). The staffer who
            // stops and immediately starts the next recording — or discards —
            // clears the chunks out from under the queued tail flush, so what is
            // on disk may be short of what this recorder captured. Stamping the
            // duration and securing it would seal that short blob under the
            // IMMUTABLE finalized key: the rest of the recording could never
            // land. Leave the take unstamped instead; nothing here deletes, the
            // mount drain reads the stamp so it will not touch it, and PR5's
            // launch drain decides what an unstamped take deserves.
            // ⚖ …AND IT SAYS SO ON THE ROW (fix round 16). Unstamped was the
            // whole defence in round 7, and rounds 13/14 dismantled it:
            // an unstamped take that has gone quiet with nothing beating for
            // it is now drainable on BOTH arms, so the drain would seal this
            // prefix under the immutable key the moment the hold below is
            // released. The missing tail is therefore written down as a fact
            // of its own — no mark, no error, nothing deleted; the audio stays
            // on the device and the take stays plainly un-finalized, which is
            // what surfaces it as 要対応 for a human to decide about.
            // Queued (and awaited) so it cannot race the row's other writers,
            // and BEFORE the `finally` lets go of the hold.
            if (!flushedWholeTake) {
              await this.queueTakeWrite(() => markTakeTailIncomplete(takeId))
              return
            }
            // The measurement is already on the row — and it got there on the
            // write that made the take whole (fix round 18): `flushedWholeTake`
            // now means "whole on disk, AND stamped by that same write". Pending
            // empty ⇒ the queued first act was the stamp; pending written ⇒ the
            // tail segment carried it. There is no separate stamp write here
            // any more, which is the whole of the round: it could lose on its
            // own, and a row with `stopPendingAt` and no `durationMs` is one
            // isStoppedTake refuses on BOTH arms for ever.
            // THE HOLD ENDS HERE (AA1): the tail is on disk and the row is
            // stamped, so there is no short blob left for anyone to seal — and
            // it must end BEFORE the call below, because secureTake asks
            // isActive first and would otherwise refuse the one caller holding
            // the live measurement. A drain that takes the take from here on
            // takes it WHOLE; `inFlight` inside secureTake keeps the two from
            // overlapping in this runtime.
            this.releaseTakeSecuringHold(takeId)
            // ⚖ THE MINT GETS ITS MOMENT, AND ONLY A MOMENT (fix round 10, P1).
            // The belt in front of the first-write-wins braces above: wait for
            // the start-mint to settle (it stamps the take before it resolves),
            // so the common case never races at all and the take is secured
            // against the row it was born with. Bounded at 10 s and the UI is
            // already past — `recorded` was set and notify() ran before this
            // whole leg was even queued, un-awaited — so nothing on screen waits
            // for it. A mint still out after that is one secureTake mints past:
            // it takes the session door itself, and the late reply adopts.
            await this.awaitRecordingSessionId(SECURE_MINT_AWAIT_MS)
            await secureTake(
              getRecordingPipelinePort(),
              takeId,
              durationMs / 1000,
              (id) => this.isActiveTake(id),
            )
          } finally {
            // Every OTHER exit of the leg — the skipped-tail return above, and
            // anything that throws on the way. A `finally` rather than a delete
            // per branch: a branch that forgot would strand the take, invisible
            // to every drain for the rest of the page's life.
            this.releaseTakeSecuringHold(takeId)
            // …and THE BEAT ENDS WITH THE HOLD (round 15), for the same reason
            // and at the same instant: this is the point past which no tab —
            // this one or the one next door — can seal anything short.
            this.queueClearHeartbeat(takeId)
            // ⚖ AND THE LEG SAYS IT IS DONE (fix round 17). A drain that ran
            // while this take was held found nothing owed — correctly — and
            // stopped looking; the duration stamp a moment later makes the take
            // eligible with nobody left to take it, so a failed stop-time
            // upload sat on the device until a remount or a visibility change.
            // One more notify is the whole signal: the page's own subscription
            // schedules its next drain on it, and the lock and the cooldown
            // make a needless run free.
            this.notify()
            // …and the leg stops being something to wait on at the same
            // instant, for the same reason: everything it had to say is on the
            // row. Dropped INSIDE the leg rather than off its tail so the map
            // can never outlive the work by a turn.
            this.stopLegs.delete(takeId)
          }
        })
        // What the map holds cannot REJECT. A reader only asked whether to
        // wait, and must never be the thing that fails a recording — and
        // attaching the handler here also keeps the leg itself handled, which
        // the plain `void` this replaces never did.
        this.stopLegs.set(
          takeId,
          leg.catch(() => {}),
        )
      }
    }

    this.recorder = recorder
    this.startTime = Date.now()
    this.startedAt = Date.now()
    recorder.start(100)
    this.state = 'recording'
    this.armRunawayGuard()

    // Take durability: persist this take's meta row, then flush segments on
    // the timer. All fire-and-forget AFTER the mic is live — persistence can
    // never delay or break capture. createTake resolves the owner at the
    // store layer; no signed-in user / any failure → memory-only, as today.
    // A take id is a uuid or it is nothing the server will sign for: the key
    // grammar (composeTakeKey) refuses anything else, so a composed fallback id
    // could NEVER be secured — it would just re-upload and be refused on every
    // mount. The fallback still exists because crash RECOVERY (this store's
    // original job) does not care about the shape, so a browser with no
    // randomUUID keeps its durability; the take is simply born terminal for the
    // secure path (`no_uuid`, in secure-take's TERMINAL set). `uuid` itself is
    // minted at the top of start(), because the session mint is told the id it
    // is reserving for (fix round 8) — this take IS that one.
    const takeId = uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.takeId = takeId
    // …and from here `this.takeId` IS this mint's take, so the marker above is
    // no longer true (fix round 12, P1). It says "a take is live, but it is the
    // PREVIOUS recording's" — a fact about the window between the mint going
    // out and this line. Left standing, mintStampTakeId would refuse to stamp
    // this take with its own row, and a mint that answers after this line
    // (every ordinary one) would leave the take carrying nothing.
    this.recordingSessionMintTakeUnknown = false
    void createTake({
      takeId,
      target: this.target,
      recordingSessionId: this.recordingSessionId,
      mimeType: mimeType || recorder.mimeType,
      startedAt: this.startTime,
      ...(uuid ? {} : { secureError: 'no_uuid' }),
      // The take is BORN knowing a bound create went out for it (fix round 9),
      // so no later route offers the pair a second time — not the retry below,
      // not the drain's own session-first call. Written with the row rather
      // than stamped after the mint answers, because the failure this exists
      // for is the one that never answers.
      ...(reserve ? { startBoundAttempted: true } : {}),
    }).then((ok) => {
      if (!ok) {
        // No `this.takeId === takeId` guard any more (fix round 20): this is
        // THIS take's own verdict on its own row, and a create that answers
        // after the staffer has already started the next recording used to
        // return here and leave persistence enabled on a take with no row —
        // every flush of it then failed one at a time.
        p.disabled = true
        return
      }
      // Mint may have resolved while the meta row was being written — the
      // mint's own stamp would have hit a missing row, so re-stamp here. This
      // one KEEPS the guard: `recordingSessionId` is the singleton's, and a new
      // start() has already nulled it and may have replaced it with the NEXT
      // recording's session — the one thing here that is not this take's own.
      if (this.takeId === takeId && this.recordingSessionId)
        void stampTakeSession(takeId, this.recordingSessionId)
    })
    this.armTakePersistence()

    this.notify()
  }

  /**
   * Await the in-flight recording-session mint briefly at save time — bounded
   * so a slow network call can never hold up the save. Returns the id if
   * already resolved, races the in-flight promise against `timeoutMs`
   * otherwise, or null if start() was never called / it already failed.
   */
  async awaitRecordingSessionId(timeoutMs = MINT_AWAIT_MS): Promise<string | null> {
    if (this.recordingSessionId !== null) return this.recordingSessionId
    if (!this.recordingSessionPromise) return null
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    return Promise.race([this.recordingSessionPromise, timeout])
  }

  /**
   * Re-run a FAILED session mint (P5-A fix round 1).
   *
   * The mint runs exactly once, at start(). If it failed — offline, core 5xx —
   * its promise is SETTLED null forever, so awaitRecordingSessionId() returns
   * null instantly on every subsequent call. Every other caller shrugs that
   * off (a save just proceeds without the id), but the discard gate cannot:
   * the reason row KEYS on this id, so a failed mint used to leave the staff
   * member unable to throw a take away at all, behind copy promising a retry
   * that could never work.
   *
   * Refuses when there is nothing to mint FOR — an id already exists, or no
   * take is held any more, in which case there is no audio this row could
   * honestly describe. Bounded exactly like awaitRecordingSessionId.
   *
   * A mint that is merely SLOW is not a failed one: a second confirm tap while
   * the first is still in flight AWAITS it rather than issuing a parallel
   * upstream create (each new mint bumps the generation, so the previous one's
   * row would land referenced by nothing — one orphan per tap).
   *
   * A retry for someone ELSE'S take — the recovery / 録音履歴 save, the discard
   * gate — stamps that take's own row and returns the id, and touches nothing
   * on this singleton: not the field, not the held promise (fix round 18, AH1),
   * not the generation or the in-flight flags (fix round 19, AJ1). This
   * singleton speaks for the recording the recorder is making, and a mint for a
   * take the pipeline holds is not it.
   */
  async retryRecordingSessionMint(opts?: {
    customerId?: string | null
    appointmentId?: string | null
    /** The take this mint is for. Omitted → the recorder's own live take. */
    takeId?: string | null
    timeoutMs?: number
  }): Promise<string | null> {
    // ⚖ THE SINGLETON ANSWERS FOR ITS OWN TAKE ONLY (fix round 18, AH1). This
    // short-circuit used to run BEFORE `opts.takeId` was read, so the first
    // caller to pass a FOREIGN take id — the recovery / 録音履歴 保存する path
    // — was handed whatever session the singleton happened to be holding.
    // Recover take A (its mint lands on the field, and nothing clears it until
    // the next start()), then recover take B: B's save would carry A's session,
    // the server-job path would find that row already done, and B's local audio
    // would be deleted against A's record. It also defeated the very read this
    // method exists for — a take the drain had already stamped was never looked
    // at. Own-take behaviour is unchanged, the null-take case included: with no
    // `opts.takeId` and no live take, `takeId` and `this.takeId` are both null,
    // so `own` is true and the field still answers exactly as before.
    const takeId = opts?.takeId ?? this.takeId
    const own = takeId === this.takeId
    if (own && this.recordingSessionId !== null) return this.recordingSessionId
    if (!takeId) return null
    // Capture pipeline PR3: secureTake MINTS the row through the session door
    // when the start-mint failed, and stamps its id on the take before it sends
    // a byte. That id is this take's session — its audio pointer lives on that
    // row — so minting a second one here would key the discard/karute to a row
    // the audio is not on.
    //
    // ⚖ TWO PATHS, ONE ROW (fix round 6): this method is how the RECORDER path
    // gets a take its id, secureTake's own startSession call is how the DRAIN
    // path does, and both stamp the same field. Never both for one take —
    // whichever runs second reads the stamp first and returns it, which is what
    // this line is. Read before anything is issued; the store's own owner gate
    // answers null for a take that is gone or another staffer's, which falls
    // through to the mint.
    const meta = await readTakeSecureMeta(takeId)
    const stamped = meta?.recordingSessionId
    if (stamped) {
      // …and when the take is the one this singleton is holding, that id IS the
      // recorder's session. Leaving the field null would make the very next
      // awaitRecordingSessionId() (the save path) answer null — its settled
      // promise never resolves twice — so the karute would save unlinked and
      // the photo/hook readers would see nothing.
      if (takeId === this.takeId) {
        this.recordingSessionId = stamped
        this.notify()
      }
      return stamped
    }
    // …and the in-flight SHARE reads the parked promise, which since AH1 is
    // only ever the recorder's own — so it is asked for only then. A second tap
    // on a foreign take therefore issues its own mint (the file's documented
    // one-orphan-per-tap cost) instead of being handed a promise belonging to
    // another take, which is the very swap this item exists to stop.
    const inFlightForThisTake =
      own &&
      this.recordingSessionMintInFlight &&
      !this.recordingSessionMintTakeUnknown &&
      (this.recordingSessionMintTakeId ?? this.takeId) === takeId
        ? this.recordingSessionPromise
        : null
    let promise = inFlightForThisTake
    if (!promise) {
      // …and this row is born reserved too (fix round 8): the take already
      // knows its container, and a row minted here is the SAME row the take's
      // audio will land on. `no_uuid` is the store's own verdict that this
      // take id can never be signed for (stamped at creation, and terminal —
      // nothing overwrites it), so the pair is not offered for one.
      //
      // ⚖ AND ONLY WHILE NO BOUND CREATE HAS GONE OUT (fix round 9). start()
      // already sent one for every take it named, and a second would compose
      // the same key core's unique index refuses — so this route is the
      // argument-less create for all but a take whose start never offered the
      // pair at all.
      const reserve =
        meta?.mimeType && meta.secureError !== 'no_uuid' && !meta.startBoundAttempted
          ? { takeId, mimeType: meta.mimeType }
          : null
      // Before the send, never after: a lost reply is the case the flag is for.
      if (reserve) await markTakeStartBoundAttempted(takeId)
      promise = this.mintRecordingSession({
        customerId: opts?.customerId ?? this.target?.customerId ?? null,
        appointmentId: opts?.appointmentId ?? this.target?.appointmentId ?? null,
        stampTakeId: takeId,
        reserve,
      })
    }
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), opts?.timeoutMs ?? MINT_AWAIT_MS),
    )
    return Promise.race([promise, timeout])
  }

  /** Let go of the session mint this recording will never use — every field
   *  that could hand its row to a later caller, plus the generation bump that
   *  makes the mint's own late resolution stale.
   *
   *  Two callers, one behaviour: discard(), which always did this inline, and
   *  start()'s mic-denied path (fix round 13). That second one matters because
   *  the mint fires BEFORE getUserMedia — deliberately, so a network call can
   *  never delay the mic prompt — so a denied prompt leaves a real
   *  recording_sessions row for a recording that will never exist. Left on the
   *  singleton it is what the next save or discard gate files against: a karute
   *  keyed to an empty row, or a discard reason written onto one. Clearing
   *  `recordingSessionId` alone is not enough — `recordingSessionPromise` is
   *  SETTLED with that same id, and awaitRecordingSessionId reads the promise
   *  when the field is null. The row itself stays orphaned server-side, which
   *  is the same bounded degradation every other abandoned mint already has. */
  private abandonRecordingSessionMint() {
    this.recordingSessionId = null
    this.recordingSessionPromise = null
    this.recordingSessionMintInFlight = false
    this.recordingSessionMintTakeId = null
    this.recordingSessionMintTakeUnknown = false
    this.recordingSessionGen++
  }

  /** Is this take the one being CAPTURED right now? Capture pipeline PR3 fix
   *  round 5: securing a live take would seal the segments flushed so far under
   *  its IMMUTABLE finalized key, so the rest of the recording could never land.
   *  `recorded` is deliberately NOT active — its bytes are complete, and that
   *  state is exactly when the stop path secures it. Passed to secureTake by
   *  the callers that live in this singleton's runtime; the store's own drain
   *  filter (listOwnStoppedUnsecuredTakeIds) is the other half.
   *
   *  …EXCEPT WHILE THE STOP LEG IS STILL RUNNING (fix round 14, AA1). "Its
   *  bytes are complete" is true of the recorder, not yet of the disk: the tail
   *  flush is queued behind an IndexedDB write that can take seconds, and only
   *  when it lands is there a whole take to seal. Until then the take is held
   *  in `securingTakeIds` and answers active here, until that leg lets go —
   *  see the field for why round 16 took its deadline away. */
  isActiveTake(takeId: string): boolean {
    return (
      // Still being secured by the stop leg counts as active: its bytes are
      // not all on disk yet, so nothing else may seal it (AA1).
      this.securingTakeIds.has(takeId) ||
      (this.takeId === takeId &&
        (this.state === 'recording' || this.state === 'paused'))
    )
  }

  /** …and is a stop leg still finishing ANY of them? (fix round 17) A held take
   *  is not drainable yet, so the page that drains keeps looking while this is
   *  true instead of going quiet on an empty worklist — and looks again on the
   *  notify that follows the release. */
  isSecuring(): boolean {
    return this.securingTakeIds.size > 0
  }

  /** "Is the STOP still deciding this take?" — awaited by both readers of
   *  `finalizedPath` (global-pipeline's finalizedAudioPath, ai-pipeline's
   *  in-tab leg) before they read it (fix round 2 of PR4).
   *
   *  THE BUG IT CLOSES. The 自動 pipeline starts at the stop INSTANT, while
   *  the stop leg's PUT + finalize is still in flight — so `finalizedPath` read
   *  null on every ordinary recording and the in-tab leg staged a second whole
   *  copy of the same take to a server-named key nothing points at. Two uploads
   *  of the same 43 MB and a permanent orphan object, per recording. The
   *  fallback is meant for a take the store never held; this made it the
   *  common case.
   *
   *  Resolves IMMEDIATELY when this runtime has no stop leg for the take —
   *  another tab's take, the mount drain's, a take recorded before this bundle
   *  loaded. Otherwise it waits for the leg the way anything waits for work
   *  that is already running: on its promise. The leg awaits secureTake, and
   *  secureTake awaits `markTakeFinalized` / `markTakeSecureError` before it
   *  returns, so a resolved leg means the row's answer — the key, or a named
   *  failure — is already on disk for the read that follows.
   *
   *  Never rejects: the leg's own promise cannot (its body is wrapped in
   *  try/finally and everything inside secureTake is caught), and a reader that
   *  merely wanted to know whether to wait must never be the thing that fails
   *  a recording.
   *
   *  ponytail: the ceiling is a leg that never exits — a store that stopped
   *  answering — and the belt is what buys that back, at the cost of one
   *  needless staging upload two minutes later. The other known ceiling is
   *  narrower: a leg that returned early because the mount drain already had
   *  the take in `inFlight` resolves without a row answer, and the reader then
   *  behaves exactly as it does today. */
  async awaitTakeSecured(takeId: string): Promise<void> {
    const leg = this.stopLegs.get(takeId)
    if (!leg) return
    let belt: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        leg,
        new Promise<void>((resolve) => {
          belt = setTimeout(resolve, SECURE_SETTLE_BELT_MS)
        }),
      ])
    } finally {
      clearTimeout(belt)
    }
  }

  stop() {
    this.clearRunawayGuard()
    if (this.recorder && this.recorder.state !== 'inactive') {
      if (this.recorder.state === 'paused') this.recorder.resume()
      this.recorder.stop()
    }
  }

  pause() {
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.pause()
      this.pauseStart = Date.now()
      this.state = 'paused'
      this.flushTake()
      this.notify()
    }
  }

  resume() {
    if (this.recorder && this.recorder.state === 'paused') {
      this.recorder.resume()
      this.pausedDuration += Date.now() - this.pauseStart
      this.state = 'recording'
      this.notify()
    }
  }

  /**
   * `keepTake` has two callers, and both mean "the audio is owed to something
   * that has not finished yet": the pipeline handoff (handleUseRecording) keeps
   * it until the karute record actually SAVES, so a reload during transcription
   * can re-offer it; the reasoned discard (proceedDiscard, A2-2) keeps it for
   * the persist run that transcribes the words behind the discard and deletes
   * the object itself. A plain discard() deletes the persisted take too.
   */
  discard(opts?: { keepTake?: boolean }) {
    this.clearRunawayGuard()
    this.clearTakePersistence()
    // No recorder holds this take any more, whether its audio is kept or not
    // (fix round 14) — the same removal the stop path does.
    if (this.takeId) this.queueClearHeartbeat(this.takeId)
    if (this.takeId && !opts?.keepTake) void deleteTake(this.takeId)
    this.takeId = null
    // The next recording's state, and the discarded take's own object left to
    // whatever it already queued (fix round 20) — a timer flush queued before
    // this discard still writes ITS chunks under ITS id, rather than finding
    // the array emptied and reporting a tail it never wrote.
    this.persist = { chunks: [], seq: 0, count: 0, disabled: false }
    if (this.recorder && this.recorder.state !== 'inactive') {
      // Stop without triggering onstop result
      this.recorder.ondataavailable = null
      this.recorder.onstop = null
      try { this.recorder.stop() } catch {}
    }
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.result = null
    this.error = null
    this.pausedDuration = 0
    this.overrun = false
    this.autoStopped = false
    this.target = null
    this.abandonRecordingSessionMint()
    this.state = 'idle'
    this.startedAt = null
    this.recorder = null
    this.notify()
  }
}

// Module-level singleton
export const globalRecorder = new GlobalRecorder()
