'use client'

// ─────────────────────────────────────────────────────────────
// CustomerDeletionBanner — "Pending deletion · N days" banner
// ─────────────────────────────────────────────────────────────
// Shown at the top of a customer's profile page whenever their record is
// inside the 30-day soft-delete window (core deleted_at set — server-prop
// driven; the old localStorage stub is gone). Amber by default; flips red in
// the last 7 days. Undo calls cancelCustomerDeletion, which nulls deleted_at
// and writes the privacy.customer_delete_canceled audit row; the nightly
// sweep (/api/cleanup-deleted) hard-deletes at deleted_at + 30d.

import { useState } from 'react'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useRouter } from '@/i18n/navigation'
import { cancelCustomerDeletion } from '@/actions/customers'
import {
  SCHEDULED_DELETION_WINDOW_DAYS,
  daysRemaining,
  hardDeleteDeadlineMs,
} from '@/lib/customers/deletion'

interface CustomerDeletionBannerProps {
  customerId: string
  customerName: string
  /** core deleted_at — null = not scheduled, banner renders nothing. */
  deletedAt: string | null
}

export function CustomerDeletionBanner({
  customerId,
  customerName,
  deletedAt,
}: CustomerDeletionBannerProps) {
  const t = useTranslations('customers.deletionBanner')
  const locale = useLocale()
  const router = useRouter()
  const [undoing, setUndoing] = useState(false)

  if (!deletedAt) return null

  const days = daysRemaining(deletedAt)
  const hardDeleteDate = new Date(hardDeleteDeadlineMs(deletedAt)).toLocaleDateString(
    locale === 'en' ? 'en-US' : 'ja-JP',
    { year: 'numeric', month: 'short', day: 'numeric' },
  )

  async function handleUndo() {
    setUndoing(true)
    try {
      const res = await cancelCustomerDeletion(customerId)
      if (!res.success) {
        if (res.error === 'not_scheduled') {
          // Already undone elsewhere (another tab/staff) — that IS success;
          // refresh so the stale banner unmounts instead of dead-end retrying.
          toast.success(t('undoSuccess', { name: customerName }))
          router.refresh()
          return
        }
        toast.error(
          res.error === 'window_expired' ? t('undoExpired') : t('undoFailed'),
        )
        return
      }
      toast.success(t('undoSuccess', { name: customerName }))
      router.refresh()
    } catch {
      // Network-level rejection (offline, mid-deploy) — feedback, not an
      // unhandled rejection with a silently re-enabled button.
      toast.error(t('undoFailed'))
    } finally {
      setUndoing(false)
    }
  }

  // Heat up tone in the last week.
  const isUrgent = days <= 7
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
          {days > 0
            ? t('title', { name: customerName, days })
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
        onClick={handleUndo}
        disabled={undoing}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-card px-3 text-[12px] font-medium text-foreground ring-1 ring-black/10 transition-colors hover:bg-black/[0.03] disabled:opacity-60 dark:ring-white/15 dark:hover:bg-white/[0.05]"
      >
        <Undo2 className="size-3.5" aria-hidden />
        {t('undoButton')}
      </button>
    </div>
  )
}
