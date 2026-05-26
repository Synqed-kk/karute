'use client'

// ─────────────────────────────────────────────────────────────
// PrivacyNoticeInline — drill-down disclosure banner
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/PrivacyNoticeInline.tsx
// (15 lines). Visual preserved 1:1. Permanent fixture above the
// per-staff drill-down content — reminds the owner that this
// surface is intentionally restricted to Layer 2 (aggregate
// categorical) data even after they've passed the modal.

import { Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function PrivacyNoticeInline() {
  const t = useTranslations('coaching.staffDrill')

  return (
    <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.04]">
      <Shield
        className="mt-0.5 size-4 shrink-0 text-slate-500 dark:text-slate-400"
        aria-hidden
      />
      <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
        {t('privacyNotice')}
      </p>
    </div>
  )
}
