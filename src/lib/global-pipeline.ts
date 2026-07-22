'use client'

import {
  runAIPipeline,
  EmptyTranscriptError,
  type PipelineStep,
  type PipelineResult,
} from '@/lib/ai-pipeline'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import type { SessionOutcome } from '@/lib/karute/outcome-types'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'
import { deleteTake } from '@/lib/karute/take-store'
import { CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import type { RecordingJobStatusView } from '@/actions/recording-jobs'

/**
 * Global AI-pipeline singleton — the background counterpart to globalRecorder.
 *
 * WHY: transcription of a 60–90 min session takes minutes. Previously the
 * pipeline ran inside the record page's component state behind a full-screen
 * blocking ProcessingModal, so the whole app was frozen until it finished AND
 * the pipeline died the instant you navigated away. This singleton runs the
 * pipeline at module level (survives navigation, like the recorder) so staff
 * can keep using the app while it processes; a top-corner ProcessingIndicator
 * subscribes to it and the record tab opens the review when it's done.
 *
 * Lifecycle:  idle → (start) processing → review → (reset on save/discard) idle
 *                                       ↘ error → (retry) processing
 *
 * NOTE: like globalRecorder, this is in-memory — it survives in-app navigation
 * but NOT a full page reload/close. The AUDIO does survive: the persisted take
 * (lib/karute/take-store, context.takeId) is kept until the save lands, and
 * RecordPageView re-offers it after a reload — costing a re-transcription, not
 * the session.
 *
 * SERVER PATH (packet 22 Stage 1): the autosave cohort — a known customer +
 * outcome AND a minted recording_sessions id — runs on Anthony's server
 * worker instead (runServerJob): stage the blob, enqueue a core job, poll.
 * That job survives a dead tab (core owns it, not this in-memory singleton),
 * closing the exact gap the note above describes for that cohort. Walk-ins,
 * review takes, and take-recovery accepts still run the original run() below
 * — Stage 2 (durable v2 for the review cohort) is a later PR.
 */

export interface PipelineContext {
  locale: string
  customers: CustomerOption[]
  /** Recording length in seconds — passed straight to ReviewScreen. */
  duration?: number
  /** The booking this recording targets, if any. */
  appointmentId?: string
  /** Customer carried from the booking so review pre-fills attribution. */
  appointmentCustomerId?: string
  /** Outcome chosen at stop (the coaching label) — carried to the save so the
   *  staff decides once, up front, and never re-opens a dialog at the end. */
  outcome?: SessionOutcome
  /** Mid-pack sessions DELIBERATELY have no outcome (no conversion conversation
   *  happened — asking would pollute the coaching labels). true = autosave
   *  proceeds without one; the save simply writes no outcome row. */
  outcomeSkipped?: boolean
  /** Server-minted recording_sessions id (synqed-core), captured at record-start
   *  — carried to the save so core's idempotent-save dedupe (unique FK on
   *  karute_records.recording_session_id) has something to key on. null when
   *  the mint failed or hadn't resolved by save time (graceful degradation:
   *  save proceeds, just without dedupe for that save). */
  recordingSessionId?: string | null
  /** Persisted-take id (lib/karute/take-store) for this audio. The take is
   *  KEPT until the karute record actually saves — the save/discard paths
   *  (ReviewScreen callbacks, ProcessingIndicator autosave) delete it via this
   *  id. null/absent when persistence was disabled for the take. */
  takeId?: string | null
}

export type PipelineState =
  | 'idle'
  | 'processing'
  | 'autosaving' // known customer + outcome → saving in the background, no review
  | 'review'
  | 'error'

/** Stable UI-facing failure codes. The error card renders a localized message
 *  from THIS — raw exception text must never reach the screen (it surfaced
 *  English mid-app; the raw error goes to the console for field debugging).
 *  'consent-required' (packet 22 B3): the server job's FAILED status carries
 *  CONSENT_REQUIRED_ERROR when consent was revoked mid-session. NOTE this is
 *  NOT full parity with the in-tab path, which routes a consent failure to
 *  'review' → ReviewScreen's RecordingConsentDialog so staff can grant consent
 *  and resave in place. The server path has no client-side result to review, so
 *  Stage 1 surfaces the error card instead; the take is KEPT and recoverable
 *  via the record-page banner (which runs the in-tab review/consent flow).
 *  Wiring a grant-consent affordance onto the server path is Stage 2. */
export type PipelineErrorCode = 'empty-transcript' | 'consent-required' | 'unknown'

type Listener = () => void

/** Stage-1 server-path cohort (packet 22, locked scope — do not widen here):
 *  takes that autosave with ZERO staff interaction AND have a server-minted
 *  recording_sessions id to key the job on. Walk-ins, review takes, and
 *  take-recovery accepts (they never carry outcome — see RecordPageView's
 *  doRecoverTake) fall through to the unchanged in-tab run() below. */
function isServerJobEligible(context: PipelineContext): boolean {
  return !!(
    context.recordingSessionId &&
    context.appointmentCustomerId &&
    (context.outcome || context.outcomeSkipped)
  )
}

/** Poll cadence + caps for the server path (packet 22 B3). 5s while fresh;
 *  past the fast window the cadence backs off to 30s — a busy day's queue
 *  backlog (worker ticks process jobs sequentially) can push a real job past
 *  10 minutes, and declaring failure while it's alive would show 処理に失敗
 *  for a record that then saves (Greptile #587 P2). Core terminally settles
 *  every job (stale-claim reclaim, attempts→FAILED), so the 60-min cap is a
 *  poller backstop, not the job's arbiter. */
const SERVER_POLL_INTERVAL_MS = 5_000
const SERVER_POLL_SLOW_INTERVAL_MS = 30_000
const SERVER_POLL_FAST_WINDOW_MS = 10 * 60 * 1000
const SERVER_JOB_TIMEOUT_MS = 60 * 60 * 1000
/** How long resolveAmbiguousEnqueue keeps re-probing a network-dark status
 *  endpoint before giving up (Greptile #587 P1). Long enough to ride out a
 *  radio blip/handoff; short enough that a genuinely dead connection surfaces
 *  an actionable error instead of a silent forever-spinner. */
const AMBIGUOUS_RESOLVE_BUDGET_MS = 90_000

class GlobalPipeline {
  state: PipelineState = 'idle'
  step: PipelineStep = 'transcribing'
  result: PipelineResult | null = null
  error: PipelineErrorCode | null = null
  context: PipelineContext | null = null
  /** Bumped on every change so useSyncExternalStore re-renders subscribers. */
  version = 0
  /**
   * Set the instant a server-path job reaches DONE (packet 22 B3) — the
   * karute record already exists server-side under this id. ProcessingIndicator's
   * 'autosaving' effect checks this FIRST: when set, it skips saveKaruteRecordInline
   * entirely and settles with the SAME toast/hold/reset the in-tab autosave
   * produces (reusing that effect is the smallest wiring that gets the
   * localized toast strings + router without duplicating them here — this
   * module is not a React component). null for every in-tab run.
   */
  serverSavedRecordId: string | null = null

  private blob: Blob | null = null
  private listeners = new Set<Listener>()
  /**
   * Identifies the live run. A new start()/retry() supersedes an in-flight run,
   * and reset() invalidates it — a stale run() resolving late checks this and
   * bails instead of clobbering newer state (e.g. record-while-processing).
   *
   * Public (read-only outside the class) so the auto-save in ProcessingIndicator
   * can capture the run it belongs to and pass it back to reset()/
   * failAutosaveToReview(), which bail if a newer run has superseded it.
   */
  runId = 0

  /** True when `runId` is still the live run — the same check
   *  failAutosaveToReview/reset guard with internally, exposed for callers
   *  (ProcessingIndicator's post-await toast tail, F2 packet 12 fix batch)
   *  that need to bail on a stale run WITHOUT mutating pipeline state. */
  isCurrentRun(runId: number): boolean {
    return runId === this.runId
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private notify() {
    this.version++
    this.listeners.forEach((fn) => fn())
  }

  /** Kick off processing in the background. Returns immediately.
   *
   *  ⚠ Single-slot by design (pre-existing): a start() while a previous run
   *  is still processing SUPERSEDES it — the old run's result is dropped
   *  un-settled (no review, no autosave, no error) and nothing deletes its
   *  persisted take. That take is exactly what the recovery banner re-offers
   *  on the next record-page mount, so since take-store the cost of the
   *  clobber is the old run's transcription fee, not the session. True
   *  concurrent takes need the server-side durable pipeline (v2, Anthony). */
  start(blob: Blob, context: PipelineContext) {
    this.blob = blob
    this.context = context
    this.state = 'processing'
    this.step = 'transcribing'
    this.result = null
    this.error = null
    this.serverSavedRecordId = null
    this.notify()
    // Server path only where the world can stage a tenant-scoped key the worker
    // can prove ownership of (thin arm). Web stays in-tab — see the port's
    // supportsServerJob doc. Everything else (walk-ins, review, recovery) too.
    if (isServerJobEligible(context) && getRecordingPipelinePort().supportsServerJob) {
      void this.runServerJob()
    } else {
      void this.run()
    }
  }

  private async run() {
    if (!this.blob || !this.context) return
    const runId = ++this.runId
    try {
      // Anchor context for the extraction/summary prompts. Without it the JA
      // prompts run with a generic このお客様 and no absolute date to resolve
      // 来月/再来週 against — the regenerate path derives both server-side, but
      // the first pass only knows the customer when the take came from a
      // booking. Walk-ins stay null (the prompt's generic fallback).
      const customerName =
        this.context.customers.find((c) => c.id === this.context?.appointmentCustomerId)
          ?.name ?? null
      // Device-local date, not toISOString (UTC would mislabel late-night JST
      // sessions as the previous day).
      const now = new Date()
      const sessionDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const result = await runAIPipeline(
        this.blob,
        this.context.locale,
        (step) => {
          if (runId !== this.runId) return
          this.step = step
          this.notify()
        },
        { customerName, sessionDate },
      )
      if (runId !== this.runId) return
      this.result = result
      // Auto-save when nothing more is needed from the staff: a known customer
      // (from the booking) + an outcome chosen at stop. The always-mounted
      // ProcessingIndicator performs the save, so the staff never comes back.
      // Otherwise fall to review — a walk-in still needs customer selection,
      // and a take with no outcome needs the manual save.
      this.state =
        (this.context?.outcome || this.context?.outcomeSkipped) &&
        this.context?.appointmentCustomerId
          ? 'autosaving'
          : 'review'
      this.notify()
    } catch (err) {
      if (runId !== this.runId) return
      // Raw text is for the console only — the UI localizes from the code.
      console.error('[global-pipeline] run failed:', err)
      this.error = err instanceof EmptyTranscriptError ? 'empty-transcript' : 'unknown'
      this.state = 'error'
      this.notify()
    }
  }

  /** Server-path run (packet 22 B3, Stage-1 eligible cohort only): stage the
   *  blob, enqueue a core job, then poll. NO fallback once enqueue succeeds —
   *  the job now owns the save, so falling back here would double-process
   *  (double AI spend, a possible duplicate record). The chip stays on
   *  'processing'/'transcribing' the whole time (no server-side sub-steps to
   *  report) until the settle below flips it to 'autosaving'. */
  private async runServerJob() {
    if (!this.blob || !this.context) return
    const runId = ++this.runId
    const blob = this.blob
    const context = this.context
    const port = getRecordingPipelinePort()
    let sessionId: string
    let enqueueDispatched = false
    try {
      const { path } = await port.stageForJob(blob)
      enqueueDispatched = true
      const enqueued = await port.enqueueJob({
        recordingSessionId: context.recordingSessionId as string,
        customerId: context.appointmentCustomerId as string,
        audioPath: path,
        appointmentId: context.appointmentId,
        locale: context.locale,
        durationSeconds: context.duration,
        outcome: context.outcome,
      })
      if ('error' in enqueued) throw new Error(enqueued.error)
      sessionId = context.recordingSessionId as string
    } catch (err) {
      if (runId !== this.runId) return
      // THE INVARIANT (Greptile #587 r3 P1): the in-tab pipeline NEVER starts
      // after a server-path attempt except on a DEFINITIVE server answer that
      // no live job owns this session (notFound, or a FAILED job). A dark or
      // erroring probe permits NOTHING — some prior run (superseded mid-poll,
      // a lost response, a double-fire) may have enqueued this session, and a
      // failed probe cannot rule that out.
      //
      // Stage-failures (THIS run dispatched no enqueue) settle it with ONE
      // probe: alive job → poll it; notFound/FAILED → in-tab fallback; dark
      // or trouble → error with the take KEPT. Erroring beats a blind in-tab
      // attempt even for UX: staging just failed, so the network is already
      // suspect and in-tab transcription needs it too — the error card
      // surfaces in one round-trip instead of after a doomed pipeline run,
      // and retry() re-dispatches through the server path, where core's
      // idempotent enqueue reconciles with any live job.
      if (!enqueueDispatched) {
        const ghost = await port
          .jobStatus(context.recordingSessionId as string)
          .catch(() => null)
        if (runId !== this.runId) return
        if (ghost && !('error' in ghost) && ghost.status !== 'FAILED') {
          console.warn('[global-pipeline] stage failed but a prior job is live — polling it:', err)
          await this.pollServerJob(runId, context.recordingSessionId as string)
          return
        }
        if (ghost && ('error' in ghost ? ghost.notFound : true)) {
          // Definitive: FAILED job or no job at all — nothing live can race.
          console.warn('[global-pipeline] server staging failed, falling back to in-tab:', err)
          void this.run()
          return
        }
        // Dark or server trouble — not an answer; never fall back on a guess.
        console.warn('[global-pipeline] staging failed and the probe gave no definitive answer — take kept:', err)
        this.error = 'unknown'
        this.state = 'error'
        this.notify()
        return
      }
      // THIS run dispatched the enqueue and its outcome is AMBIGUOUS (Greptile
      // #587 P1: the response can be lost AFTER core committed the job).
      // Blindly falling back would run BOTH pipelines — double AI spend +
      // competing saves on one session. So ambiguity is RESOLVED, never
      // guessed: keep probing the job status until the server answers. A
      // live/DONE job → poll it. A DEFINITIVE no-job answer (HTTP 404, surfaced
      // as notFound by the port — server trouble like a 5xx/429 is NOT an
      // answer and keeps probing) or a FAILED job → fall back (a dead or
      // absent job can't race; the one residual is an in-transit enqueue
      // delivered AFTER a client-side reject — exotic, and it converges on ONE
      // record via core's idempotent by-session save). Server never answers
      // within the budget → surface the error with the take KEPT: the in-tab
      // pipeline needs the same network, so falling back offline would just
      // fail slower AND reopen the dual-run window the moment connectivity
      // returns; retry() re-dispatches through the server path, where core's
      // idempotent enqueue reconciles with any ghost job this attempt may have
      // committed.
      const resolution = await this.resolveAmbiguousEnqueue(
        runId,
        context.recordingSessionId as string,
      )
      if (resolution === 'superseded') return
      if (resolution === 'poll') {
        console.warn('[global-pipeline] enqueue ambiguous but the job landed — polling it:', err)
        await this.pollServerJob(runId, context.recordingSessionId as string)
        return
      }
      if (resolution === 'error') {
        console.warn('[global-pipeline] enqueue ambiguous and the server unreachable — take kept:', err)
        this.error = 'unknown'
        this.state = 'error'
        this.notify()
        return
      }
      // 'fallback': the server answered — no live job owns this session.
      // Recording must never be degraded by the new path — warn once and fall
      // back to the proven in-tab pipeline with the SAME blob/context.
      console.warn('[global-pipeline] server stage/enqueue failed, falling back to in-tab:', err)
      void this.run()
      return
    }
    // Enqueue landed — but a NEWER run may have superseded while we were
    // awaiting it; pollServerJob re-checks runId at every await return.
    if (runId !== this.runId) return
    await this.pollServerJob(runId, sessionId)
  }

  /** Resolve an ambiguous enqueue failure to a DEFINITIVE answer (Greptile
   *  #587 P1). Probes immediately (the common lost-response case settles on
   *  the first probe, no added latency), then re-probes every
   *  SERVER_POLL_INTERVAL_MS until the budget runs out. Definitive answers:
   *  a status view (the job's truth) or `notFound` (HTTP 404 = the server
   *  answered "no job for this session"). NOT answers, keep probing: a
   *  rejected fetch (network-dark) AND a non-404 {error} (5xx/429/upstream
   *  trouble — the same transient class pollServerJob rides out; reading it
   *  as job absence would reopen the dual-run window on a server blip). */
  private async resolveAmbiguousEnqueue(
    runId: number,
    recordingSessionId: string,
  ): Promise<'poll' | 'fallback' | 'error' | 'superseded'> {
    const port = getRecordingPipelinePort()
    const deadline = Date.now() + AMBIGUOUS_RESOLVE_BUDGET_MS
    while (Date.now() < deadline) {
      if (runId !== this.runId) return 'superseded'
      let view: RecordingJobStatusView | { error: string; notFound?: boolean } | null
      try {
        view = await port.jobStatus(recordingSessionId)
      } catch {
        view = null // network-dark — not an answer; keep probing
      }
      if (runId !== this.runId) return 'superseded'
      if (view && !('error' in view)) return view.status === 'FAILED' ? 'fallback' : 'poll'
      if (view?.notFound) return 'fallback'
      await new Promise((r) => setTimeout(r, SERVER_POLL_INTERVAL_MS))
    }
    return runId === this.runId ? 'error' : 'superseded'
  }

  /** Poll the enqueued job to settlement. Every tick (and every await return)
   *  re-checks runId — a superseding start()/reset() must make a stale poll
   *  settle nothing, same guard class as run(). */
  private async pollServerJob(runId: number, recordingSessionId: string) {
    const start = Date.now()
    const deadline = start + SERVER_JOB_TIMEOUT_MS
    const port = getRecordingPipelinePort()
    while (Date.now() < deadline) {
      if (runId !== this.runId) return
      const interval =
        Date.now() - start < SERVER_POLL_FAST_WINDOW_MS
          ? SERVER_POLL_INTERVAL_MS
          : SERVER_POLL_SLOW_INTERVAL_MS
      await new Promise((r) => setTimeout(r, interval))
      if (runId !== this.runId) return

      const status = await port.jobStatus(recordingSessionId).catch(
        (err): { error: string } => ({ error: err instanceof Error ? err.message : 'poll failed' }),
      )
      if (runId !== this.runId) return
      // A transient hiccup checking OUR OWN status endpoint is not the job's
      // outcome — keep polling rather than declaring failure on a blip.
      if ('error' in status) continue

      if (status.status === 'DONE' && status.karuteRecordId) {
        // The record already exists server-side. Delete the take, then settle
        // via the SAME 'autosaving' path the in-tab autosave uses — its effect
        // (ProcessingIndicator) checks serverSavedRecordId FIRST and skips
        // straight to the toast/hold/reset, reusing that UI verbatim instead
        // of duplicating localized strings in this non-React module.
        // Guard on karuteRecordId (typed string|null): a DONE with no id is a
        // core anomaly — treat it as a generic failure with the take KEPT
        // rather than deleting the audio and then settling on a falsy id (which
        // would slip past ProcessingIndicator's truthy check into the in-tab
        // branch with no result → a dead review state, audio already gone).
        if (this.context?.takeId) void deleteTake(this.context.takeId)
        this.serverSavedRecordId = status.karuteRecordId
        this.state = 'autosaving'
        this.notify()
        return
      }
      if (status.status === 'DONE') {
        // DONE but no karuteRecordId — see the guard above. Take kept.
        this.error = 'unknown'
        this.state = 'error'
        this.notify()
        return
      }
      if (status.status === 'FAILED') {
        // Take is NEVER deleted on FAILED — the staff can retry or fall back.
        this.error =
          status.lastError === CONSENT_REQUIRED_ERROR
            ? 'consent-required'
            : status.lastError === 'EMPTY_TRANSCRIPT'
              ? 'empty-transcript'
              : 'unknown'
        this.state = 'error'
        this.notify()
        return
      }
      // QUEUED/RUNNING — keep polling; the chip stays on 'transcribing'.
    }
    // Hard cap reached — generic failure, take kept (same as any other FAILED).
    // The job may still be alive behind a backlog; that is safe: no fallback
    // ever runs without a definitive no-live-job answer, and retry()
    // re-dispatches the server path where the idempotent enqueue reconciles.
    if (runId !== this.runId) return
    this.error = 'unknown'
    this.state = 'error'
    this.notify()
  }

  /** Re-run after an error (the blob + context are retained). Re-dispatches
   *  by the SAME rule as start(): an eligible take retries through the server
   *  path, where core's idempotent enqueue reconciles with any job an earlier
   *  attempt committed — returned unchanged while QUEUED/RUNNING/DONE (the
   *  poll then converges on it), RE-ARMED with a fresh payload when FAILED
   *  (so runServerJob's from-scratch re-stage is exactly right; the old
   *  object is orphaned to the daily sweep). A retry can therefore never
   *  start a second pipeline for a session that a live job already owns. */
  retry() {
    if (!this.blob || !this.context) return
    this.state = 'processing'
    this.step = 'transcribing'
    this.error = null
    this.notify()
    if (isServerJobEligible(this.context) && getRecordingPipelinePort().supportsServerJob) {
      void this.runServerJob()
    } else {
      void this.run()
    }
  }

  /** Auto-save failed — fall back to review so the take is never lost. The
   *  staff finishes it manually on the record page. `ownRunId` is the run the
   *  caller started saving; if a newer run has superseded it (the staff began
   *  a new recording mid-save), this is a no-op so we never hijack the new
   *  take's state. */
  failAutosaveToReview(ownRunId?: number) {
    if (ownRunId !== undefined && ownRunId !== this.runId) return
    if (this.state !== 'autosaving') return
    this.state = 'review'
    this.notify()
  }

  /** Clear everything — called after the karute is saved or discarded. A late
   *  auto-save passes its `ownRunId`; if a newer run has started, reset() bails
   *  so it can't wipe the NEW take's result/blob/context. Lifecycle owners
   *  (review save/discard, error dismiss) pass nothing and always reset. */
  reset(ownRunId?: number) {
    if (ownRunId !== undefined && ownRunId !== this.runId) return
    // Invalidate any in-flight run so a late resolve can't revive the chip.
    this.runId++
    this.state = 'idle'
    this.step = 'transcribing'
    this.result = null
    this.error = null
    this.context = null
    this.blob = null
    this.serverSavedRecordId = null
    this.notify()
  }
}

// Module-level singleton — mirrors globalRecorder.
export const globalPipeline = new GlobalPipeline()
