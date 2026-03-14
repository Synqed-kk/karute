'use client'

/**
 * PipelineContainer
 *
 * Orchestrates the full AI processing flow: audio blob in → review screen out.
 *
 * Flow:
 *   1. On mount, calls runAIPipeline(audioBlob, locale, onProgress)
 *   2. While processing, renders a blocking ProcessingModal with live step progress
 *   3. On success, transitions to ReviewScreen with transcript, entries, and summary
 *   4. On failure, ProcessingModal shows the error + a Retry button
 *   5. Retry clears error state and re-runs the full pipeline
 *
 * Note: This component does NOT persist anything to Supabase.
 * The onConfirm callback delegates saving to the parent (Phase 4 concern).
 */

import { useEffect, useState, useCallback } from 'react'
import { runAIPipeline, PipelineStep, PipelineResult } from '@/lib/ai-pipeline'
import { Entry } from '@/types/ai'
import { ProcessingModal } from './ProcessingModal'
import { ReviewScreen } from './ReviewScreen'

interface PipelineContainerProps {
  /** The raw audio blob captured from MediaRecorder after the session ends */
  audioBlob: Blob
  /** BCP-47 locale string, e.g. 'ja' or 'en' — passed through to AI prompts for locale-aware output */
  locale: string
  /** Called when the user reviews and confirms the AI results; receives final entries + summary */
  onConfirm: (data: { entries: Entry[]; summary: string }) => void
  /** Optional cancel handler — reserved for future use (e.g., discard and re-record) */
  onCancel?: () => void
}

/**
 * The two top-level phases of this container:
 *  - processing: pipeline is running (or errored), ProcessingModal is shown
 *  - review: pipeline completed, ReviewScreen is shown
 */
type ContainerPhase = 'processing' | 'review'

export function PipelineContainer({
  audioBlob,
  locale,
  onConfirm,
  onCancel: _onCancel,
}: PipelineContainerProps) {
  const [phase, setPhase] = useState<ContainerPhase>('processing')
  const [currentStep, setCurrentStep] = useState<PipelineStep>('transcribing')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)

  /**
   * Executes the full AI pipeline. Reusable for both initial run and retry.
   * Resets error + step state before starting.
   */
  const runPipeline = useCallback(async () => {
    setError(null)
    setCurrentStep('transcribing')

    try {
      const pipelineResult = await runAIPipeline(audioBlob, locale, (step) => {
        setCurrentStep(step)
      })
      setResult(pipelineResult)
      setPhase('review')
    } catch (err) {
      // Mark error step so ProcessingModal shows the error UI
      setCurrentStep('error')
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.',
      )
    }
  }, [audioBlob, locale])

  // Kick off pipeline immediately on mount
  useEffect(() => {
    runPipeline()
  }, [runPipeline])

  /**
   * Retry handler: resets phase to processing and re-runs the pipeline.
   * Called by ProcessingModal's Retry button after an error.
   */
  function handleRetry() {
    setPhase('processing')
    runPipeline()
  }

  // Show processing modal while pipeline is running or if result is not yet available
  if (phase === 'processing' || result === null) {
    return (
      <ProcessingModal
        currentStep={currentStep}
        error={error ?? undefined}
        onRetry={handleRetry}
      />
    )
  }

  // Pipeline complete — hand off to review screen
  return (
    <ReviewScreen
      transcript={result.transcript}
      entries={result.entries}
      summary={result.summary}
      onConfirm={onConfirm}
    />
  )
}
