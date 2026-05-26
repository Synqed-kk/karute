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
import { Sparkles, Wand2 } from 'lucide-react'

import { PrivacyLockBadge } from './PrivacyLockBadge'

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
