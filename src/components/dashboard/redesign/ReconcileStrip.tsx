'use client'

// 未処理来店 strip (Liam-approved mock) — housekeeping, not alarm: amber,
// below the red 要連絡 block, renders NOTHING when there's nothing to fix.
// Two states say how big the miss was: 記録なし (full forget) vs 消化のみ未処理
// (karute exists, pack untipped). この日に消化 writes the consumption dated to
// the ACTUAL visit day (source 'backfill', undo toast) so the ledger stays
// historically true. Any staff may act — fixing a record isn't a privilege
// (unlike the manager-gated alert dismissal).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { toast } from 'sonner'
import {
  dismissVisitReconcileAction,
  redeemSessionAction,
  undoRedemptionAction,
} from '@/actions/packs'
import type { ReconcileData, ReconcileEntry } from '@/lib/packs/reconcile'

function visitDayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00+09:00`)
  const md = d.toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
  })
  const wd = d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short' })
  return `${md}(${wd})`
}

export function ReconcileStrip({ data }: { data: ReconcileData }) {
  const t = useTranslations('dashboard.reconcile')
  if (data.entries.length === 0) return null
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-card dark:border-amber-500/30">
      <div className="flex items-baseline justify-between gap-3 bg-amber-50 px-4 py-2.5 dark:bg-amber-500/10">
        <h2 className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
          {t('title', { n: data.entries.length })}
        </h2>
        <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
          {t('subtitle')}
        </span>
      </div>
      <ul className="divide-y divide-border/60">
        {data.entries.map((e) => (
          <ReconcileRow key={`${e.customerId}|${e.visitDay}`} entry={e} />
        ))}
      </ul>
      {data.truncated > 0 && (
        <p className="px-4 py-2 text-[11px] text-muted-foreground">
          {t('more', { n: data.truncated })}
        </p>
      )}
    </section>
  )
}

function ReconcileRow({ entry: e }: { entry: ReconcileEntry }) {
  const t = useTranslations('dashboard.reconcile')
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const redeem = async () => {
    if (!e.packId) return
    setBusy(true)
    const res = await redeemSessionAction({
      packId: e.packId,
      customerId: e.customerId,
      redeemedOn: e.visitDay,
      appointmentId: e.appointmentId,
      source: 'backfill',
    })
    setBusy(false)
    if (res.ok) {
      const rid = res.redemptionId
      toast.success(t('redeemed', { date: visitDayLabel(e.visitDay) }), {
        action: rid
          ? {
              label: t('undo'),
              onClick: () => {
                void undoRedemptionAction(rid).then(() => router.refresh())
              },
            }
          : undefined,
      })
      router.refresh()
    } else {
      toast.error(t(res.error === 'below_zero' ? 'redeemNoSessionsLeft' : 'redeemFailed'))
    }
  }

  const dismiss = async () => {
    setBusy(true)
    const res = await dismissVisitReconcileAction({
      customerId: e.customerId,
      appointmentId: e.appointmentId,
      visitDay: e.visitDay,
    })
    setBusy(false)
    if (res.ok) {
      toast.success(t('dismissed'))
      router.refresh()
    } else {
      toast.error(t('dismissFailed'))
    }
  }

  const unrecorded = e.kind === 'unrecorded'
  return (
    <li className="px-4 py-2.5 text-[11px] text-muted-foreground tabular-nums">
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
          {e.name}
        </span>
        {e.karuteNumber && (
          <span className="shrink-0 font-mono text-[10px]">{e.karuteNumber}</span>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap">
          {t('visitLine', { date: visitDayLabel(e.visitDay) })}
          {e.size > 0 && ` · ${t('packShort', { n: e.remaining, m: e.size })}`}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] ${
            unrecorded
              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
              : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
          }`}
        >
          {unrecorded ? t('chipUnrecorded') : t('chipUnredeemed')}
        </span>
        <span className="hidden text-[10px] text-muted-foreground/70 sm:inline">
          {unrecorded ? t('hintUnrecorded') : t('hintUnredeemed')}
        </span>
        <span className="ml-auto flex shrink-0 gap-1.5">
          {e.packId && (
            <button
              type="button"
              disabled={busy}
              onClick={redeem}
              className="rounded-lg border border-emerald-500/50 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              {t('actionRedeem')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={dismiss}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {t('actionNoVisit')}
          </button>
        </span>
      </div>
    </li>
  )
}
