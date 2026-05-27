'use client'

// ─────────────────────────────────────────────────────────────
// PatternsMasteredList — staff growth detail
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/PatternsMasteredList.tsx
// (~72 lines).
//
// PRIVACY: Layer 1 — staff-private (per-staff progress is private
// even though the module catalog itself is shared). RLS: assigned
// staff only — owners can read aggregate completion rollups, not
// individual rows.
//
// DATA SOURCE (when wired):
//   useLearningModulesData({ assignedTo: viewerStaffId })
//
// The list is bucketed into "mastered" (completionRate >= 1) and
// "in progress" (0 < completionRate < 1).

import { CheckCircle2, Circle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { ScaffoldHint } from './ScaffoldHint'
import type { LearningModule } from './owner-types'

interface PatternsMasteredListProps {
  modules?: LearningModule[] | null
}

export function PatternsMasteredList({
  modules = null,
}: PatternsMasteredListProps) {
  const t = useTranslations('coaching.growth')
  const list = modules ?? []
  const hasModules = list.length > 0

  const mastered = list.filter((m) => (m.completionRate ?? 0) >= 1)
  const inProgress = list.filter((m) => {
    const r = m.completionRate ?? 0
    return r > 0 && r < 1
  })

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <h3 className="mb-4 text-sm font-semibold">{t('masteredTitle')}</h3>

      {hasModules ? (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <CheckCircle2
                className="size-3.5 text-green-600 dark:text-green-300"
                aria-hidden
              />
              <h4 className="text-xs font-semibold text-green-900 dark:text-green-200">
                {t('masteredHeader', { n: mastered.length })}
              </h4>
            </div>
            {mastered.length === 0 ? (
              <p className="pl-5 text-xs text-muted-foreground">
                {t('masteredEmpty')}
              </p>
            ) : (
              <ul className="space-y-1 pl-5">
                {mastered.map((m) => (
                  <li key={m.id} className="text-xs text-foreground">
                    {m.title}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Circle
                className="size-3.5 text-indigo-600 dark:text-indigo-300"
                aria-hidden
              />
              <h4 className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                {t('inProgressHeader', { n: inProgress.length })}
              </h4>
            </div>
            {inProgress.length === 0 ? (
              <p className="pl-5 text-xs text-muted-foreground">
                {t('inProgressEmpty')}
              </p>
            ) : (
              <ul className="space-y-2 pl-5">
                {inProgress.map((m) => {
                  const pct = Math.round((m.completionRate ?? 0) * 100)
                  return (
                    <li key={m.id}>
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-foreground">
                          {m.title}
                        </span>
                        <span className="shrink-0 text-[11px] font-medium tabular-nums text-indigo-700 dark:text-indigo-300">
                          {pct}%
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-500/15">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <ScaffoldHint hint={t('masteredEmptyHint')} />
      )}
    </div>
  )
}
