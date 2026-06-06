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
 * but NOT a full page reload/close. Persisting across reload would mean a
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
}

export type PipelineState = 'idle' | 'processing' | 'review' | 'error'

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
   */
  private runId = 0

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

  /** Kick off processing in the background. Returns immediately. */
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
      const result = await runAIPipeline(this.blob, this.context.locale, (step) => {
        if (runId !== this.runId) return
        this.step = step
        this.notify()
      })
      if (runId !== this.runId) return
      this.result = result
      this.state = 'review'
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

  /** Clear everything — called after the karute is saved or discarded. */
  reset() {
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
