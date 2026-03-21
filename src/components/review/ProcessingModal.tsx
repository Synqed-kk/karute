'use client'

import { PipelineStep } from '@/lib/ai-pipeline'

interface ProcessingModalProps {
  currentStep: PipelineStep
  error?: string
  onRetry: () => void
}

type StepConfig = {
  key: PipelineStep
  label: string
}

const STEPS: StepConfig[] = [
  { key: 'transcribing', label: 'Transcribing...' },
  { key: 'extracting', label: 'Extracting entries...' },
  { key: 'summarizing', label: 'Generating summary...' },
]

const STEP_ORDER: PipelineStep[] = ['transcribing', 'extracting', 'summarizing', 'complete']

function getStepStatus(
  step: PipelineStep,
  currentStep: PipelineStep,
): 'pending' | 'active' | 'done' {
  const currentIndex = STEP_ORDER.indexOf(currentStep)
  const stepIndex = STEP_ORDER.indexOf(step)

  if (currentIndex === -1) return 'pending'
  if (stepIndex < currentIndex) return 'done'
  if (currentStep === 'extracting' && (step === 'extracting' || step === 'summarizing')) return 'active'
  if (stepIndex === currentIndex) return 'active'
  return 'pending'
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-primary"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 text-emerald-500"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function ProcessingModal({ currentStep, error, onRetry }: ProcessingModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-8">
        {error ? (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30">
              <svg
                className="h-6 w-6 text-red-500"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">Processing failed</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">Processing recording</h2>
              <p className="text-sm text-muted-foreground">Please wait while AI analyzes your session...</p>
            </div>

            <div className="flex flex-col gap-4">
              {STEPS.map(({ key, label }) => {
                const status = getStepStatus(key, currentStep)
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      {status === 'done' && <CheckIcon />}
                      {status === 'active' && <Spinner />}
                      {status === 'pending' && (
                        <div className="w-4 h-4 rounded-full border border-border" />
                      )}
                    </div>
                    <span
                      className={
                        status === 'active'
                          ? 'text-sm text-foreground font-medium'
                          : status === 'done'
                            ? 'text-sm text-muted-foreground line-through'
                            : 'text-sm text-muted-foreground/50'
                      }
                    >
                      {status === 'done' ? label.replace('...', '') : label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
