'use client'

// ─────────────────────────────────────────────────────────────
// ImportStepper — 4-step progress indicator
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/import/ImportStepper.tsx
// Steps: Upload → Mapping → Validate → Done. Active step has a
// solid blue chip; completed steps have a bordered blue chip;
// future steps are muted.

import { Check, ListChecks, ShieldCheck, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ImportStepperProps {
  activeStep: number
}

export function ImportStepper({ activeStep }: ImportStepperProps) {
  const t = useTranslations('dataImport.stepper')
  const STEPS: { labelKey: string; icon: LucideIcon }[] = [
    { labelKey: 'stepUpload', icon: Upload },
    { labelKey: 'stepMapping', icon: ListChecks },
    { labelKey: 'stepValidate', icon: ShieldCheck },
    { labelKey: 'stepDone', icon: Check },
  ]

  return (
    <div className="ios-scroll -mx-1 mb-5 flex items-center overflow-x-auto px-1">
      {STEPS.map((step, i) => {
        const isActive = i === activeStep
        const isDone = i < activeStep
        const Icon = step.icon
        return (
          <div key={i} className="flex min-w-0 flex-1 items-center">
            <div className="flex shrink-0 items-center gap-2">
              <div
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isDone
                      ? 'border border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'border border-gray-200 bg-gray-100 text-muted-foreground dark:border-white/10 dark:bg-neutral-800'
                }`}
              >
                <Icon className="size-3.5" />
              </div>
              <span
                className={`text-xs font-medium tabular-nums ${
                  isActive || isDone ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {i + 1}.{' '}
                <span className="hidden sm:inline">{t(step.labelKey)}</span>
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-2 h-px min-w-4 flex-1 md:mx-3 ${
                  isDone ? 'bg-blue-300' : 'bg-gray-200 dark:bg-white/10'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
