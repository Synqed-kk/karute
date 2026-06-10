'use client'

// 離客アラート — the dashboard's "回数券保持者でN日以上来店の無い顧客がX人います"
// card from the Kitano meeting. Always-visible pressure so staff can't forget;
// dismissal is MANAGER-ONLY (canDismiss) and audit-trailed. Data comes from
// getPackAlerts() → the SAME resolvePackAlert as the 顧客 list (chopstick), so
// this count and the list's 要連絡 pills always agree. Renders nothing when
// there are no alerts (and pre-migration) — zero clutter.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BellRing, Check, ChevronRight, Loader2 } from 'lucide-react'

import { Link } from '@/i18n/navigation'
import { dismissPackAlertAction } from '@/actions/packs'
import type { PackAlerts } from '@/lib/packs/alerts'
import { DEFAULT_CONTACT_THRESHOLD_DAYS } from '@/lib/packs/resolve'

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
const MAX_ROWS = 5

export function PackAlertsCard({
  alerts,
  canDismiss,
  thresholdDays = DEFAULT_CONTACT_THRESHOLD_DAYS,
}: {
  alerts: PackAlerts
  canDismiss: boolean
  thresholdDays?: number
}) {
  const t = useTranslations('dashboard.packAlerts')
  if (alerts.contact.length === 0 && alerts.low.length === 0) return null

  return (
    <section className="rounded-2xl border border-red-200/70 bg-card p-5 shadow-sm dark:border-red-500/25 md:p-6">
      {alerts.contact.length > 0 && (
        <>
          <header className="mb-1 flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <BellRing size={15} />
            </span>
            <span className="text-sm font-semibold text-foreground">{t('title')}</span>
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
              {alerts.contact.length}
            </span>
          </header>
          <p className="mb-3 text-[12px] text-muted-foreground">
            {t('summary', { days: thresholdDays, n: alerts.contact.length })}
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {alerts.contact.slice(0, MAX_ROWS).map((e) => (
              <AlertRow key={e.customerId} entry={e} canDismiss={canDismiss} />
            ))}
          </ul>
          {alerts.contact.length > MAX_ROWS && (
            <Link
              href={'/customers' as Parameters<typeof Link>[0]['href']}
              className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-red-600 hover:text-red-700 dark:text-red-400"
            >
              {t('showAll', { n: alerts.contact.length })}
              <ChevronRight size={13} />
            </Link>
          )}
        </>
      )}

      {alerts.low.length > 0 && (
        <div
          className={
            alerts.contact.length > 0
              ? 'mt-4 border-t border-border/60 pt-3.5'
              : ''
          }
        >
          <div className="mb-1.5 text-[12px] font-medium text-amber-700 dark:text-amber-300">
            {t('lowTitle', { n: alerts.low.length })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {alerts.low.map((e) => (
              <Link
                key={e.customerId}
                href={`/customers/${e.customerId}` as Parameters<typeof Link>[0]['href']}
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              >
                {e.name}
                <span className="tabular-nums opacity-70">
                  {t('lowChip', { remaining: e.remaining })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function AlertRow({
  entry,
  canDismiss,
}: {
  entry: PackAlerts['contact'][number]
  canDismiss: boolean
}) {
  const t = useTranslations('dashboard.packAlerts')
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const dismiss = async () => {
    setBusy(true)
    const res = await dismissPackAlertAction({ customerId: entry.customerId })
    setBusy(false)
    setConfirming(false)
    if (res.ok) {
      toast.success(t('dismissed'))
      router.refresh()
    } else {
      toast.error(res.error === 'forbidden' ? t('forbidden') : t('dismissFailed'))
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 py-2.5 last:border-b-0">
      <Link
        href={`/customers/${entry.customerId}` as Parameters<typeof Link>[0]['href']}
        className="flex min-w-0 items-baseline gap-1.5 hover:opacity-80"
      >
        <span className="truncate text-[13px] font-medium text-foreground">
          {entry.name}
        </span>
        {entry.karuteNumber && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {entry.karuteNumber}
          </span>
        )}
      </Link>
      <div className="flex shrink-0 items-center gap-2.5 text-[11px] tabular-nums">
        <span className="font-medium text-red-600 dark:text-red-400">
          {t('daysAbsent', { n: entry.daysSinceLastVisit ?? 0 })}
        </span>
        <span className="text-muted-foreground">
          {t('remaining', { remaining: entry.remaining, size: entry.size })}
        </span>
        <span className="text-muted-foreground">{yen(entry.unconsumed)}</span>
        {canDismiss &&
          (confirming ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={dismiss}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                {t('dismissConfirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t('cancel')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('dismiss')}
            </button>
          ))}
      </div>
    </li>
  )
}
