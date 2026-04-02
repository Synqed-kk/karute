'use client'

import { useEffect, useState, useCallback } from 'react'
import { runAIPipeline, PipelineStep, PipelineResult } from '@/lib/ai-pipeline'
import { ProcessingModal } from './ProcessingModal'
import { ReviewScreen } from './ReviewScreen'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

interface PipelineContainerProps {
  audioBlob: Blob
  locale: string
  customers: CustomerOption[]
  duration?: number
  appointmentId?: string
  appointmentCustomerId?: string
  onCancel: () => void
  onSaved: () => void
}

type ContainerPhase = 'processing' | 'review'

export function PipelineContainer({
  audioBlob,
  locale,
  customers,
  duration,
  appointmentId,
  appointmentCustomerId,
  onCancel,
  onSaved,
}: PipelineContainerProps) {
  const [phase, setPhase] = useState<ContainerPhase>('processing')
  const [currentStep, setCurrentStep] = useState<PipelineStep>('transcribing')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)

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
      setCurrentStep('error')
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.',
      )
    }
  }, [audioBlob, locale])

  useEffect(() => {
    runPipeline()
  }, [runPipeline])

  function handleRetry() {
    setPhase('processing')
    runPipeline()
  }

  if (phase === 'processing' || result === null) {
    return (
      <ProcessingModal
        currentStep={currentStep}
        error={error ?? undefined}
        onRetry={handleRetry}
        onCancel={onCancel}
      />
    )
  }

  return (
    <ReviewScreen
      transcript={result.transcript}
      entries={result.entries}
      summary={result.summary}
      customers={customers}
      duration={duration}
      appointmentId={appointmentId}
      appointmentCustomerId={appointmentCustomerId}
      onSaved={onSaved}
    />
  )
}
