'use client'

// ─────────────────────────────────────────────────────────────
// RecentModulesCard — staff dashboard Row 3 (full width)
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/RecentModulesCard.tsx
// (~84 lines). Visual preserved 1:1. Spike already had a
// proper empty state (line 24-36) — preserved + augmented with
// the 対応予定 scaffold hint so empty doesn't read as "you
// have no modules" but as "data layer not wired yet".
//
// PRIVACY: Assignment + completion rate are Layer 2 for owner
// (sees roll-up across staff); Layer 1 for per-step progress.
// This card shows high-level completion only.
//
// DATA SOURCE (when wired):
//   useLearningModulesData({ assignedTo: viewerStaffId })
//   for staff view; useLearningModulesData() for owner view.

import { useTranslations } from 'next-intl'
import { BookOpen, Clock } from 'lucide-react'

import { ScaffoldHint } from './ScaffoldHint'

export interface LearningModule {
  id: string
  title: string
  category: string
  durationMin: number
  completionRate?: number // 0..1
  assignedBy?: string | null
}

interface RecentModulesCardProps {
  modules?: LearningModule[] | null
}

export function RecentModulesCard({ modules = null }: RecentModulesCardProps) {
  const t = useTranslations('coaching.staff.recentModules')
  const items = modules ?? []
  const hasItems = items.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="size-4 text-indigo-600 dark:text-indigo-300" />
        <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
      </div>

      {hasItems ? (
        <div className="space-y-3">
          {items.map((m) => {
            const pct = Math.round((m.completionRate ?? 0) * 100)
            return (
              <div
                key={m.id}
                className="rounded-md border border-gray-100 bg-gray-50/60 p-3 dark:border-white/5 dark:bg-white/[0.03]"
              >
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {m.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{m.category}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5">
                        <Clock className="size-2.5" aria-hidden />
                        {t('durationMin', { n: m.durationMin })}
                      </span>
                      {m.assignedBy && (
                        <>
                          <span>·</span>
                          <span>{t('assignedBy', { name: m.assignedBy })}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-medium tabular-nums text-indigo-700 dark:text-indigo-300">
                    {pct}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-500/15">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <ScaffoldHint hint={t('emptyHint')} />
      )}
    </div>
  )
}
