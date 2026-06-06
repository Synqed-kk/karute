'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  CalendarClock,
  Coins,
  RefreshCw,
  Repeat,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { BADGE_COLORS } from '@/lib/badge-styles'
import { loadCustomerVisitHistory } from '@/actions/visit-history'
import type {
  CustomerVisit,
  CustomerVisitHistory,
  VisitStatus,
} from '@/lib/customers/visit-history'

interface BookingHistoryTabContentProps {
  customerName: string
  memberNumber: string | null
}

const STATUS_TONE: Record<VisitStatus, keyof typeof BADGE_COLORS> = {
  settled: 'green',
  booked: 'blue',
  cancelled: 'red',
}

function yen(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(n)
}

function longDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: locale.startsWith('ja') ? 'long' : 'short',
    day: 'numeric',
  }).format(new Date(iso))
}

export function BookingHistoryTabContent({
  customerName,
  memberNumber,
}: BookingHistoryTabContentProps) {
  const t = useTranslations('customers.bookings')
  const locale = useLocale()
  const [history, setHistory] = useState<CustomerVisitHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadCustomerVisitHistory(customerName, memberNumber)
      .then((data) => {
        if (!cancelled) setHistory(data)
      })
      .catch(() => {
        if (!cancelled)
          setHistory({
            available: false,
            reason: 'error',
            visits: [],
            summary: {
              totalVisits: 0,
              totalSpend: 0,
              avgSpend: 0,
              firstVisit: null,
              lastVisit: null,
              cancelledCount: 0,
              avgIntervalDays: null,
            },
          })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerName, memberNumber, reloadKey])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  if (loading) return <HistorySkeleton />
  if (!history) return null

  if (!history.available || history.visits.length === 0) {
    return (
      <EmptyState
        reason={history.reason}
        empty={history.available && history.visits.length === 0}
        onRetry={retry}
      />
    )
  }

  const { summary, visits } = history

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Summary band */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
              <TrendingUp size={14} />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {t('summaryTitle')}
            </h3>
          </div>
          <SourceChip label={t('source')} />
        </header>

        <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
          <Stat
            icon={<CalendarClock size={13} />}
            label={t('stat.visits')}
            value={t('visitsValue', { n: summary.totalVisits })}
          />
          <Stat
            icon={<Wallet size={13} />}
            label={t('stat.total')}
            value={yen(summary.totalSpend, locale)}
            emphasis
          />
          <Stat
            icon={<Coins size={13} />}
            label={t('stat.avg')}
            value={yen(summary.avgSpend, locale)}
          />
          <Stat
            icon={<Repeat size={13} />}
            label={t('stat.cadence')}
            value={
              summary.avgIntervalDays
                ? t('cadenceValue', { n: summary.avgIntervalDays })
                : '—'
            }
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
          {summary.firstVisit && (
            <span>
              <span className="text-muted-foreground/70">{t('firstVisit')} </span>
              <span className="tabular-nums text-foreground">
                {longDate(summary.firstVisit, locale)}
              </span>
            </span>
          )}
          {summary.lastVisit && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="text-muted-foreground/70">{t('lastVisit')} </span>
                <span className="tabular-nums text-foreground">
                  {longDate(summary.lastVisit, locale)}
                </span>
              </span>
            </>
          )}
          {summary.cancelledCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-muted-foreground">
                {t('cancelledCount', { n: summary.cancelledCount })}
              </span>
            </>
          )}
        </div>
      </section>

      {/* Timeline */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <header className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300">
              <CalendarClock size={14} />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {t('historyTitle')}
            </h3>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('count', { n: visits.length })}
          </span>
        </header>
        <ul className="flex flex-col">
          {visits.map((v) => (
            <VisitRow key={v.qrReservationId} v={v} locale={locale} />
          ))}
        </ul>
      </section>
    </div>
  )
}

function VisitRow({ v, locale }: { v: CustomerVisit; locale: string }) {
  const t = useTranslations('customers.bookings')
  const tone = BADGE_COLORS[STATUS_TONE[v.status]]
  return (
    <li className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-start gap-3 border-b border-border py-3 last:border-b-0">
      <span className="pt-0.5 text-xs font-semibold tabular-nums text-foreground">
        {longDate(v.date, locale)}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {v.courseName ?? '—'}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {v.staffName && <span>{v.staffName}</span>}
          {v.note && (
            <>
              {v.staffName && <span aria-hidden>·</span>}
              <span className="line-clamp-1 text-muted-foreground/80">
                {v.note}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {v.salesAmount > 0 && (
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {yen(v.salesAmount, locale)}
          </span>
        )}
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text} ${tone.border}`}
        >
          {t(`status.${v.status}`)}
        </span>
      </div>
    </li>
  )
}

function Stat({
  icon,
  label,
  value,
  emphasis = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          emphasis
            ? 'text-lg font-bold text-foreground'
            : 'text-base font-semibold text-foreground'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function SourceChip({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  )
}

function EmptyState({
  reason,
  empty,
  onRetry,
}: {
  reason: CustomerVisitHistory['reason']
  empty: boolean
  onRetry: () => void
}) {
  const t = useTranslations('customers.bookings')
  const key = empty ? 'empty' : reason
  const showRetry = reason === 'error'
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{t(`state.${key}.title`)}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        {t(`state.${key}.hint`)}
      </p>
      {showRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <RefreshCw size={13} />
          {t('state.retry')}
        </button>
      )}
    </section>
  )
}

function HistorySkeleton() {
  return (
    <div className="space-y-4 md:space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="mb-4 h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="h-5 w-20 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
          >
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
