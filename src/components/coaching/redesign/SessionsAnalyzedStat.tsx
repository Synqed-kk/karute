'use client'

// ─────────────────────────────────────────────────────────────
// SessionsAnalyzedStat — 3-up stat row
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/SessionsAnalyzedStat.tsx
// (~38 lines). Visual preserved 1:1.
//
// PRIVACY: Layer 1 — staff-private (the count of analyzed
// sessions is itself private). RLS: SELECT only where
// staff_id = auth.uid().
//
// Scaffold posture: when no value is wired, each cell shows
// "—" so the layout doesn't jump.

import { CheckCircle2, Circle, FileText } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface SessionsAnalyzedStatProps {
  sessionsAnalyzed?: number | null
  patternsMastered?: number | null
  patternsInProgress?: number | null
}

export function SessionsAnalyzedStat({
  sessionsAnalyzed = null,
  patternsMastered = null,
  patternsInProgress = null,
}: SessionsAnalyzedStatProps) {
  const t = useTranslations('coaching.growth')

  const stats = [
    {
      key: 'sessions',
      Icon: FileText,
      iconColor: 'text-blue-600 dark:text-blue-300',
      label: t('statSessions'),
      value: sessionsAnalyzed,
    },
    {
      key: 'mastered',
      Icon: CheckCircle2,
      iconColor: 'text-green-600 dark:text-green-300',
      label: t('statMastered'),
      value: patternsMastered,
    },
    {
      key: 'inProgress',
      Icon: Circle,
      iconColor: 'text-indigo-600 dark:text-indigo-300',
      label: t('statInProgress'),
      value: patternsInProgress,
    },
  ] as const

  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map(({ key, Icon, iconColor, label, value }) => (
        <div
          key={key}
          className="rounded-xl bg-card p-4 ring-1 ring-black/5 shadow-sm dark:ring-white/10"
        >
          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
            <Icon className={`size-3.5 ${iconColor}`} aria-hidden />
            <span className="text-[11px]">{label}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {value ?? '—'}
          </div>
        </div>
      ))}
    </div>
  )
}
