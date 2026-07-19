'use client'

import {
  runAIPipeline,
  type PipelineStep,
  type PipelineResult,
} from '@/lib/ai-pipeline'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

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
 * the session. A mid-processing state that survives reload would mean a
 * server-side job (upload + poll); that's the durable v2 (flagged for Anthony).
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

type Listener = () => void

class GlobalPipeline {
  state: PipelineState = 'idle'
  step: PipelineStep = 'transcribing'
  result: PipelineResult | null = null
  error: string | null = null
  context: PipelineContext | null = null
  /** Bumped on every change so useSyncExternalStore re-renders subscribers. */
  version = 0

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
    this.notify()
    void this.run()
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
      this.error =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.'
      this.state = 'error'
      this.notify()
    }
  }

  /** Re-run after an error (the blob + context are retained). */
  retry() {
    if (!this.blob || !this.context) return
    this.state = 'processing'
    this.step = 'transcribing'
    this.error = null
    this.notify()
    void this.run()
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
    this.notify()
  }
}

// Module-level singleton — mirrors globalRecorder.
export const globalPipeline = new GlobalPipeline()
