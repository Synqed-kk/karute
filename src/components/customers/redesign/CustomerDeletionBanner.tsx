'use client'

// ─────────────────────────────────────────────────────────────
// CustomerDeletionBanner — "Pending deletion · N days" banner
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/customers/CustomerDeletionBanner.tsx
//
// Shown at the top of a customer's profile page whenever their
// record is inside the 30-day soft-delete window. Amber by
// default; flips red in the last 7 days to signal urgency.
//
// ANTHONY contract (full schema sketch in
// src/lib/scheduled-deletions/hooks.ts header):
//   - undo flips deleted_at to null + writes a privacy.customer_
//     delete_canceled audit row
//   - hard-delete runs nightly via cron against
//     scheduled_hard_deletes where canceled_at IS NULL

import { AlertTriangle, Undo2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import {
  SCHEDULED_DELETION_WINDOW_DAYS,
  useCustomerDeletionStatus,
  useScheduledDeletions,
} from '@/lib/scheduled-deletions/hooks'

interface CustomerDeletionBannerProps {
  customerId: string
  customerName: string
}

export function CustomerDeletionBanner({
  customerId,
  customerName,
}: CustomerDeletionBannerProps) {
  const t = useTranslations('customers.deletionBanner')
  const locale = useLocale()
  const status = useCustomerDeletionStatus(customerId)
  const { cancelDeletion } = useScheduledDeletions()

  if (!status.isScheduled) return null

  const daysRemaining = status.daysRemaining ?? 0
  const hardDeleteDate = status.hardDeleteAt
    ? new Date(status.hardDeleteAt).toLocaleDateString(
        locale === 'en' ? 'en-US' : 'ja-JP',
        { year: 'numeric', month: 'short', day: 'numeric' },
      )
    : '—'

  // Heat up tone in the last week.
  const isUrgent = daysRemaining <= 7
  const ring = isUrgent
    ? 'ring-red-300/70 dark:ring-red-500/30'
    : 'ring-amber-300/70 dark:ring-amber-500/30'
  const bg = isUrgent
    ? 'bg-red-50/80 dark:bg-red-500/10'
    : 'bg-amber-50/80 dark:bg-amber-500/10'
  const iconTone = isUrgent
    ? 'text-red-700 dark:text-red-300'
    : 'text-amber-700 dark:text-amber-300'
  const titleTone = isUrgent
    ? 'text-red-900 dark:text-red-200'
    : 'text-amber-900 dark:text-amber-200'

  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ${ring} ${bg}`}
    >
      <AlertTriangle
        className={`mt-0.5 size-5 shrink-0 ${iconTone}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-semibold ${titleTone}`}>
          {daysRemaining > 0
            ? t('title', { name: customerName, days: daysRemaining })
            : t('titleToday', { name: customerName })}
        </div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-foreground/75">
          {t('body', { date: hardDeleteDate, window: SCHEDULED_DELETION_WINDOW_DAYS })}
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {t('blocked')}
        </div>
      </div>
      <button
        type="button"
        onClick={() => cancelDeletion(customerId)}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-card px-3 text-[12px] font-medium text-foreground ring-1 ring-black/10 transition-colors hover:bg-black/[0.03] dark:ring-white/15 dark:hover:bg-white/[0.05]"
      >
        <Undo2 className="size-3.5" aria-hidden />
        {t('undoButton')}
      </button>
    </div>
  )
}
