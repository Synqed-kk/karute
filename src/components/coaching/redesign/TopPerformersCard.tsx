'use client'

// ─────────────────────────────────────────────────────────────
// TopPerformersCard — owner dashboard Row 2
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/TopPerformersCard.tsx
// (~64 lines). Visual preserved 1:1.
//
// PRIVACY: Layer 2 — named staff visible to OWNER ONLY.
// Staff view of this surface gets the anonymized
// LearnFromTopCard instead (separate card on the staff
// dashboard).
//
// DATA SOURCE (when wired):
//   useStaffPerformanceData().staff → filter isTopPerformer
//   = true. Boolean flag derived from aggregate metrics
//   (no AI call needed).

import { useTranslations } from 'next-intl'
import { Crown } from 'lucide-react'

import type { StaffPerformance } from './owner-types'

import { ScaffoldHint } from './ScaffoldHint'

interface TopPerformersCardProps {
  staff?: StaffPerformance[] | null
}

export function TopPerformersCard({ staff = null }: TopPerformersCardProps) {
  const t = useTranslations('coaching.owner.topPerformers')
  const top = (staff ?? []).filter((s) => s.isTopPerformer)
  const hasItems = top.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center gap-2">
        <Crown className="size-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">{t('cardTitle')}</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{t('cardIntro')}</p>

      {hasItems ? (
        <div className="space-y-2">
          {top.map((s) => (
            <div
              key={s.staffId}
              className="flex items-center gap-3 rounded-lg bg-amber-50/50 p-3 dark:bg-amber-500/[0.08]"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-900 ring-1 ring-amber-200/60 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/20">
                {s.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {s.name}
                </div>
                <div className="text-[11px] text-muted-foreground">{s.role}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-medium tabular-nums text-foreground">
                  {t('closingShort', { pct: Math.round(s.closingRate * 100) })}
                </div>
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  {t('rebookingShort', { pct: Math.round(s.rebookingRate * 100) })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ScaffoldHint hint={t('emptyHint')} />
      )}
    </div>
  )
}
