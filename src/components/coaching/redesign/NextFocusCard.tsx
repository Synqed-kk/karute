'use client'

// ─────────────────────────────────────────────────────────────
// NextFocusCard — staff dashboard Row 2 right
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/NextFocusCard.tsx
// (~44 lines). Same pattern as StrengthsCard — list of items,
// optional prop, scaffold when empty.
//
// PRIVACY: Layer 1 — staff-private.
// RLS: SELECT only where staff_id = auth.uid().
// AI: generator identifies focus areas from staff's own sessions.

import { useTranslations } from 'next-intl'
import { Target, Wand2 } from 'lucide-react'

import { PrivacyLockBadge } from './PrivacyLockBadge'

export interface FocusRecommendation {
  label: string
  description: string
}

interface NextFocusCardProps {
  focus?: FocusRecommendation[] | null
}

export function NextFocusCard({ focus = null }: NextFocusCardProps) {
  const t = useTranslations('coaching.staff.nextFocus')
  const tCommon = useTranslations('coaching.common')
  const items = focus ?? []
  const hasItems = items.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-indigo-600 dark:text-indigo-300" />
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        </div>
        <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
      </div>

      {hasItems ? (
        <div className="space-y-3">
          {items.map((f, i) => (
            <div
              key={i}
              className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3 dark:border-indigo-500/15 dark:bg-indigo-500/[0.08]"
            >
              <div className="mb-0.5 text-sm font-medium text-indigo-900 dark:text-indigo-200">
                {f.label}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
          <Wand2
            className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 inline-flex items-center">
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {tCommon('scaffoldLabel')}
              </span>
            </div>
            <p className="text-[11px] italic leading-relaxed text-muted-foreground">
              {t('emptyHint')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
