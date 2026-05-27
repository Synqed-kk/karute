'use client'

// ─────────────────────────────────────────────────────────────
// StrengthsCard — staff dashboard Row 2 left
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/StrengthsCard.tsx
// (~44 lines). Visual preserved 1:1. Spike's `strengths` prop
// is non-nullable; widened to optional so the card renders
// the chrome + 対応予定 scaffold until Anthony wires
// usePersonalGrowthData().growth.strengths.
//
// PRIVACY: Layer 1 — staff-private.
// RLS: SELECT only where staff_id = auth.uid().
// AI: generator reads staff's own sessions to identify strengths.

import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'

import { PrivacyLockBadge } from './PrivacyLockBadge'

import { ScaffoldHint } from './ScaffoldHint'

export interface StrengthItem {
  label: string
  detail: string
}

interface StrengthsCardProps {
  strengths?: StrengthItem[] | null
}

export function StrengthsCard({ strengths = null }: StrengthsCardProps) {
  const t = useTranslations('coaching.staff.strengths')
  const tCommon = useTranslations('coaching.common')
  const items = strengths ?? []
  const hasItems = items.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-green-600 dark:text-green-300" />
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        </div>
        <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
      </div>

      {hasItems ? (
        <div className="space-y-3">
          {items.map((s, i) => (
            <div
              key={i}
              className="rounded-md border border-green-100 bg-green-50/50 p-3 dark:border-green-500/15 dark:bg-green-500/[0.08]"
            >
              <div className="mb-0.5 text-sm font-medium text-green-900 dark:text-green-200">
                {s.label}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {s.detail}
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
