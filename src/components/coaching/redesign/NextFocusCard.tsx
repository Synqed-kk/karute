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
import { Target } from 'lucide-react'

import { PrivacyLockBadge } from './PrivacyLockBadge'

import { ScaffoldHint } from './ScaffoldHint'

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
        <ScaffoldHint hint={t('emptyHint')} />
      )}
    </div>
  )
}
