'use client'

import { useTranslations } from 'next-intl'
import { Database, ListChecks, Filter, Check } from 'lucide-react'

interface ExportStepperProps {
  activeStep: number
}

export function ExportStepper({ activeStep }: ExportStepperProps) {
  const t = useTranslations('dataExport')

  const steps = [
    { label: t('stepScope'), Icon: Database },
    { label: t('stepColumns'), Icon: ListChecks },
    { label: t('stepFilter'), Icon: Filter },
    { label: t('stepDownload'), Icon: Check },
  ]

  return (
    <div className="flex items-center mb-6 overflow-x-auto -mx-1 px-1">
      {steps.map((s, i) => {
        const Icon = s.Icon
        const isActive = i === activeStep
        const isDone = i < activeStep
        return (
          <div key={i} className="flex-1 flex items-center min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                  isActive
                    ? 'border-[1.5px] border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300'
                    : isDone
                      ? 'border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300/80'
                      : 'bg-muted text-muted-foreground border border-border/40'
                }`}
              >
                {isDone ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
              </div>
              <span
                className={`text-xs font-medium ${
                  isActive
                    ? 'text-foreground font-semibold'
                    : isDone
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                }`}
              >
                {i + 1}.{' '}
                <span className="hidden sm:inline">{s.label}</span>
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-px mx-3 ${
                  isDone ? 'bg-blue-200 dark:bg-blue-500/20' : 'bg-border/40'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
