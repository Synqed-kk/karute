'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Check, Clock, Pencil, RotateCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { PostSessionResolutionDialog } from '../record/PostSessionResolutionDialog'
import { updateKaruteOutcome } from '@/actions/karute-outcome'
import type {
  DeclineReason,
  Outcome,
  SessionOutcome,
} from '@/lib/karute/outcome-types'

interface OutcomeCardProps {
  karuteRecordId: string
  customerId: string | null
  customerName: string
  current: {
    /** Plain string, not `Outcome` — see KaruteOutcomeRow. A value this build
     *  doesn't know falls back to the neutral chip below. */
    outcome: string
    reason: DeclineReason | null
    autoDecided: boolean
    isFirstVisit: boolean
  } | null
}

const CHIP: Record<
  Outcome,
  { cls: string; icon: React.ReactNode }
> = {
  success: {
    cls: 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300',
    icon: <Check size={12} strokeWidth={3} />,
  },
  no_deal: {
    cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300',
    icon: <X size={12} strokeWidth={3} />,
  },
  pending: {
    cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
    icon: <Clock size={12} strokeWidth={2.5} />,
  },
  revisit: {
    cls: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300',
    icon: <RotateCw size={12} strokeWidth={2.5} />,
  },
}

/** A row written by a newer server can carry an outcome this build has no CHIP
 *  for — render it neutrally rather than throwing on CHIP[unknown].cls. */
const UNKNOWN_CHIP = { cls: 'border-border bg-muted text-muted-foreground', icon: null }
const chipFor = (status: string) =>
  (CHIP as Partial<Record<string, (typeof CHIP)[Outcome]>>)[status] ?? UNKNOWN_CHIP

export function OutcomeCard({
  karuteRecordId,
  customerId,
  customerName,
  current,
}: OutcomeCardProps) {
  const t = useTranslations('recording.outcome')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  if (!customerId) return null

  const status = current?.outcome ?? null

  function handleResolve(outcome: SessionOutcome) {
    if (!customerId) return
    startTransition(async () => {
      const res = await updateKaruteOutcome(karuteRecordId, outcome)
      setOpen(false)
      if (res.error) toast.error(res.error)
      else router.refresh()
    })
  }

  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t('cardTitle')}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {status ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chipFor(status).cls}`}
            >
              {chipFor(status).icon}
              {status in CHIP ? t(`chip.${status}`) : status}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {t('chip.none')}
            </span>
          )}
          {status === 'no_deal' && current?.reason && (
            <span className="text-xs text-muted-foreground">
              {t(`reason.${current.reason}`)}
            </span>
          )}
          {current?.autoDecided && (
            <span className="text-[11px] text-muted-foreground/70">
              {t('autoNote')}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
      >
        <Pencil size={13} />
        {status ? t('edit') : t('record')}
      </button>

      <PostSessionResolutionDialog
        open={open}
        customerName={customerName}
        isFirstVisit={current?.isFirstVisit ?? false}
        // One-way door otherwise: a saved revisit row could never be
        // re-selected in 編集. The row itself IS the returning-customer proof —
        // no other status implies it, so everything else stays UNKNOWN (mode
        // threading is still blocked on core's decision_context).
        isReturningCustomer={current?.outcome === 'revisit' ? true : null}
        saving={pending}
        onCancel={() => setOpen(false)}
        onResolve={handleResolve}
      />
    </section>
  )
}
