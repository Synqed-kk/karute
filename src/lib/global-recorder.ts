'use client'

import { recordingAudioConstraints } from '@/lib/recording-constraints'
import type { RecordingResult } from '@/hooks/use-media-recorder'
import { startRecordingSession } from '@/actions/recordings'
import {
  appendTakeSegment,
  createTake,
  deleteTake,
  stampTakeSession,
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
  private chunks: Blob[] = []
  /** Take-durability flush state. `persistedChunkCount` indexes into `chunks`
   *  (how many are already on disk); the queue serializes flushes so timer /
   *  pause / visibility triggers never interleave. */
  private persistDisabled = false
  private persistSeq = 0
  private persistedChunkCount = 0
  private persistTimer: ReturnType<typeof setInterval> | null = null
  private persistQueue: Promise<void> = Promise.resolve()
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
    this.persistTimer = setInterval(() => this.flushTake(), TAKE_FLUSH_MS)
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

  /** Flush chunks not yet on disk as one segment. Serialized via the queue;
   *  fire-and-forget — MUST never block or throw into the capture path. */
  private flushTake() {
    if (this.persistDisabled || !this.takeId) return
    const takeId = this.takeId
    this.persistQueue = this.persistQueue
      .then(async () => {
        // Re-check inside the queued task: a discard may have run meanwhile.
        if (this.persistDisabled || this.takeId !== takeId) return
        const pending = this.chunks.slice(this.persistedChunkCount)
        if (pending.length === 0) return
        const seq = this.persistSeq
        const count = this.persistedChunkCount + pending.length
        const ok = await appendTakeSegment(takeId, seq, new Blob(pending))
        if (this.takeId !== takeId) return
        if (!ok) {
          // ponytail: fail-open to memory-only — capture continues as today.
          this.persistDisabled = true
          return
        }
        this.persistSeq = seq + 1
        this.persistedChunkCount = count
      })
      .catch(() => {
        this.persistDisabled = true
      })
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
  }): Promise<string | null> {
    const gen = ++this.recordingSessionGen
    this.recordingSessionMintInFlight = true
    this.recordingSessionMintTakeId = input.stampTakeId ?? null
    const promise = startRecordingSession({
      customerId: input.customerId,
      appointmentId: input.appointmentId,
    }).then((res) => {
      // Stale mint (user discarded / started a new recording while this was
      // in flight): drop it — its row belongs to a different take/customer.
      // The flag is NOT cleared here: it belongs to whichever mint owns the
      // current generation, and that one is still in flight.
      if (gen !== this.recordingSessionGen) return null
      // Settled (this call swallows every failure to null, so it never rejects).
      this.recordingSessionMintInFlight = false
      this.recordingSessionId = res?.id ?? null
      // Stamp the persisted take so a crash-recovered save still dedupes.
      // (If the meta row isn't written yet, createTake's callback re-stamps.)
      const stampTakeId = input.stampTakeId ?? this.takeId
      if (stampTakeId && this.recordingSessionId) {
        void stampTakeSession(stampTakeId, this.recordingSessionId)
      }
      this.notify()
      return this.recordingSessionId
    })
    this.recordingSessionPromise = promise
    return promise
  }

  async start(opts?: { noiseSuppression?: boolean; target?: RecordingTarget | null }) {
    this.error = null
    this.result = null
    this.chunks = []
    this.pausedDuration = 0
    this.overrun = false
    this.autoStopped = false
    this.target = opts?.target ?? null
    this.recordingSessionId = null

    // Mint the recording-session id (synqed-core) IN PARALLEL with getUserMedia
    // below — a network call must NEVER block or delay the mic prompt. Held so
    // handleUseRecording can await it briefly at save time; a slow/failed mint
    // just leaves this null (save proceeds without recording_session_id).
    void this.mintRecordingSession({
      customerId: this.target?.customerId ?? null,
      appointmentId: this.target?.appointmentId ?? null,
    })

    let micStream: MediaStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: recordingAudioConstraints(opts?.noiseSuppression ?? true),
        video: false,
      })
    } catch {
      this.error = 'Microphone access denied.'
      this.notify()
      return
    }

    this.stream = micStream
    const mimeType = getSupportedMimeType()
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

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }

    recorder.onstop = () => {
      this.clearRunawayGuard()
      const totalElapsed = Date.now() - this.startTime
      const durationMs = totalElapsed - this.pausedDuration
      const blob = new Blob(this.chunks, { type: mimeType || recorder.mimeType })
      this.result = { blob, mimeType: mimeType || recorder.mimeType, durationMs }
      this.state = 'recorded'
      this.startedAt = null
      micStream.getTracks().forEach(t => t.stop())
      this.stream = null
      // Final tail flush (onstop fires after the last ondataavailable). The
      // timer stops but the persisted take is KEPT — it outlives the recorder
      // until the karute record is saved / discarded / TTL / logout.
      this.clearTakePersistence()
      this.flushTake()
      this.notify()
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
    const takeId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.takeId = takeId
    this.persistDisabled = false
    this.persistSeq = 0
    this.persistedChunkCount = 0
    void createTake({
      takeId,
      target: this.target,
      recordingSessionId: this.recordingSessionId,
      mimeType: mimeType || recorder.mimeType,
      startedAt: this.startTime,
    }).then((ok) => {
      if (this.takeId !== takeId) return
      if (!ok) {
        this.persistDisabled = true
        return
      }
      // Mint may have resolved while the meta row was being written — the
      // mint's own stamp would have hit a missing row, so re-stamp here.
      if (this.recordingSessionId) void stampTakeSession(takeId, this.recordingSessionId)
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
   * ponytail: a review-path retry writes its id onto this singleton like any
   * other mint (the gen guard is what keeps that safe — a newer recording
   * invalidates it). The recorder is idle in that case and the next start()
   * clears the field, so the value is only ever read by the caller that asked
   * for it. Upgrade path if a second consumer ever appears: return the id
   * without touching the field when `stampTakeId` is someone else's take.
   */
  async retryRecordingSessionMint(opts?: {
    customerId?: string | null
    appointmentId?: string | null
    /** The take this mint is for. Omitted → the recorder's own live take. */
    takeId?: string | null
    timeoutMs?: number
  }): Promise<string | null> {
    if (this.recordingSessionId !== null) return this.recordingSessionId
    const takeId = opts?.takeId ?? this.takeId
    if (!takeId) return null
    const inFlightForThisTake =
      this.recordingSessionMintInFlight &&
      (this.recordingSessionMintTakeId ?? this.takeId) === takeId
        ? this.recordingSessionPromise
        : null
    const promise =
      inFlightForThisTake ??
      this.mintRecordingSession({
        customerId: opts?.customerId ?? this.target?.customerId ?? null,
        appointmentId: opts?.appointmentId ?? this.target?.appointmentId ?? null,
        stampTakeId: takeId,
      })
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), opts?.timeoutMs ?? MINT_AWAIT_MS),
    )
    return Promise.race([promise, timeout])
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
   * `keepTake` is for the pipeline handoff ONLY (handleUseRecording): the
   * recorder is cleared but the persisted audio stays in take-store until the
   * karute record actually SAVES — a reload during transcription can then
   * re-offer the audio. A plain discard() deletes the persisted take too.
   */
  discard(opts?: { keepTake?: boolean }) {
    this.clearRunawayGuard()
    this.clearTakePersistence()
    if (this.takeId && !opts?.keepTake) void deleteTake(this.takeId)
    this.takeId = null
    this.persistDisabled = false
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
    this.chunks = []
    this.pausedDuration = 0
    this.overrun = false
    this.autoStopped = false
    this.target = null
    this.recordingSessionId = null
    this.recordingSessionPromise = null
    // Invalidate any in-flight mint so its late resolution can't stamp a
    // discarded take's session id onto the next recording.
    this.recordingSessionGen++
    this.state = 'idle'
    this.startedAt = null
    this.recorder = null
    this.notify()
  }
}

// Module-level singleton
export const globalRecorder = new GlobalRecorder()
