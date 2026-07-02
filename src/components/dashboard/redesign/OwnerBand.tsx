'use client'

// オーナー帯 — every yen-denominated surface lives here, and ONLY here
// (staff never see money). Two metric tiles + expandable count rows.
// Expanding a row reveals the existing, battle-tested widgets
// (PackAlertsCard with its 連絡済み/解除 actions, ReconcileStrip with
// この日に消化) — progressive disclosure without rebuilding any action.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { PackAlerts } from '@/lib/packs/alerts'
import type { ReconcileData } from '@/lib/packs/reconcile'
import { PackAlertsCard } from './PackAlertsCard'
import { ReconcileStrip } from './ReconcileStrip'

interface OwnerBandProps {
  alerts: PackAlerts
  reconcile: ReconcileData
  canDismissAlerts: boolean
  /** 7-day pulse: burned sessions + karute written (rolling window). */
  pulse: { redemptions: number; karute: number }
}

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

function CountRow({
  tone,
  label,
  value,
  expanded,
  onToggle,
  children,
}: {
  tone: 'red' | 'amber' | 'neutral'
  label: string
  value: string
  expanded?: boolean
  onToggle?: () => void
  children?: React.ReactNode
}) {
  const dot =
    tone === 'red'
      ? 'bg-red-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : 'bg-muted-foreground/50'
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        className="flex w-full items-center gap-2 px-1 py-2.5 text-left text-[13px]"
        aria-expanded={expanded}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <span className="ml-auto shrink-0 font-medium tabular-nums">{value}</span>
        {onToggle && (
          <span className="shrink-0 text-muted-foreground" aria-hidden>
            {expanded ? '▴' : '▾'}
          </span>
        )}
      </button>
      {expanded && children && <div className="pb-3">{children}</div>}
    </li>
  )
}

export function OwnerBand({ alerts, reconcile, canDismissAlerts, pulse }: OwnerBandProps) {
  const t = useTranslations('dashboard.flow')
  const [open, setOpen] = useState<null | 'contact' | 'reconcile' | 'low'>(null)
  const toggle = (key: 'contact' | 'reconcile' | 'low') =>
    setOpen((cur) => (cur === key ? null : key))

  const { totals } = alerts
  const lowWithBooking = alerts.low.filter((e) => e.hasNextBooking).length
  const reconcileCount = reconcile.entries.length + reconcile.truncated

  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        {t('ownerBandTitle')}
      </h2>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-red-50 p-3 dark:bg-red-500/10">
          <p className="text-[11px] text-red-700 dark:text-red-300">{t('riskTitle')}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-red-800 dark:text-red-200">
            {yen(totals.atRiskValue)}
          </p>
          <p className="text-[11px] text-red-700/80 dark:text-red-300/80">
            {t('riskSub', { n: alerts.contact.length })}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-[11px] text-muted-foreground">{t('liabilityTitle')}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {yen(totals.unconsumedTotal)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t('liabilitySub', { n: totals.holderCount })}
          </p>
        </div>
      </div>

      <ul className="mt-2">
        <CountRow
          tone="red"
          label={t('contactRow')}
          value={t('personCount', { n: alerts.contact.length })}
          expanded={open === 'contact'}
          onToggle={() => toggle('contact')}
        >
          <PackAlertsCard alerts={alerts} canDismiss={canDismissAlerts} />
        </CountRow>
        <CountRow
          tone="amber"
          label={t('backlogRow')}
          value={t('itemCount', { n: reconcileCount })}
          expanded={open === 'reconcile'}
          onToggle={() => toggle('reconcile')}
        >
          <ReconcileStrip data={reconcile} />
        </CountRow>
        <CountRow
          tone="amber"
          label={t('lastOneRow')}
          value={t('lastOneMeta', { n: alerts.low.length, m: lowWithBooking })}
          expanded={open === 'low'}
          onToggle={() => toggle('low')}
        >
          <ul className="flex flex-wrap gap-1.5 px-1">
            {alerts.low.map((e) => (
              <li key={e.customerId}>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  {e.name}
                  {e.hasNextBooking && <span aria-hidden>·</span>}
                  {e.hasNextBooking && t('hasBooking')}
                </span>
              </li>
            ))}
          </ul>
        </CountRow>
        <CountRow
          tone="neutral"
          label={t('pulseRow')}
          value={t('pulseValue', { r: pulse.redemptions, k: pulse.karute })}
        />
      </ul>
    </section>
  )
}
