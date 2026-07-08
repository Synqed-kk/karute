'use client'

// ─────────────────────────────────────────────────────────────
// DataDrivenOwnerRoi — "coaching is growing your sales", honestly (L2-owner)
// ─────────────────────────────────────────────────────────────
// The owner surface that sells the next business (artifact be1f5b33). EVERY number
// is a difference-in-differences lift vs untreated control stores, computed by the
// effectiveness engine (effectiveness.ts, #404) — noise-corrected, confidence-
// labeled — so it can never mistake a good season for coaching, and never overclaims.
// Store aggregate only; no individual staff appears here.
//
// Reads StoreCoachingRoi (contract.ts). DORMANT: roi={null} → the 対応予定 scaffold,
// until Anthony wires useStoreCoachingRoi(). Answers Liam's "how accurate is this?"
// in the UI itself — an early signal is labeled 初期, never dressed up as certain.

import { useLocale, useTranslations } from 'next-intl'
import { TrendingUp, Info, BarChart3, CheckCircle2 } from 'lucide-react'

import type { StoreCoachingRoi, StoreMetricLift, MetricPoint, MoneyAmount } from '@/lib/karute/coaching/contract'

import { ScaffoldHint } from './ScaffoldHint'

interface DataDrivenOwnerRoiProps {
  roi?: StoreCoachingRoi | null
}

function formatMoney(m: MoneyAmount, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(m.amount)
  } catch {
    return `${m.amount.toLocaleString()} ${m.currency}`
  }
}

const CONF: Record<StoreMetricLift['confidence'], { key: string; cls: string }> = {
  mature: { key: 'confMature', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  building: { key: 'confBuilding', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  early: { key: 'confEarly', cls: 'bg-muted text-muted-foreground' },
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-black/5 dark:ring-white/10">{children}</section>
}

// ── Treated vs control trend ─────────────────────────────────
function TrendChart({ trend }: { trend: StoreCoachingRoi['trend'] }) {
  // Each series needs ≥2 points to draw a line — guard them independently, not by
  // combined length, or a single-point series produces NaN SVG coordinates
  // (i / (length-1) → i/0). (audit finding)
  if (trend.treated.length < 2 || trend.control.length < 2) return null
  const all = [...trend.treated, ...trend.control].map((p) => p.value)
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  const W = 320
  const line = (pts: MetricPoint[]) =>
    pts
      .map((p, i) => {
        const x = 6 + (i / (pts.length - 1)) * (W - 12)
        const y = 10 + (1 - (p.value - min) / range) * 60
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  const treatedPts = line(trend.treated)
  const last = treatedPts.split(' ').at(-1)!.split(',')
  const markLeft = `${Math.round(trend.coachingStartFraction * 100)}%`
  return (
    <div className="relative">
      <svg viewBox="0 0 320 84" width="100%" height="84" preserveAspectRatio="none">
        <line x1="0" y1="72" x2="320" y2="72" stroke="currentColor" className="text-muted-foreground/15" strokeWidth="1" />
        <polyline points={line(trend.control)} fill="none" stroke="currentColor" className="text-muted-foreground/60" strokeWidth="1.8" strokeDasharray="3 3" />
        <polyline points={treatedPts} fill="none" stroke="currentColor" className="text-emerald-600 dark:text-emerald-400" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last[0]} cy={last[1]} r="4" className="fill-emerald-600 dark:fill-emerald-400" />
      </svg>
      <div className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-amber-500/70" style={{ left: markLeft, bottom: '18px' }} aria-hidden />
    </div>
  )
}

// ── The screen ───────────────────────────────────────────────
export function DataDrivenOwnerRoi({ roi = null }: DataDrivenOwnerRoiProps) {
  const t = useTranslations('coaching.owner.roi')
  const locale = useLocale()

  if (!roi) {
    return (
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        </div>
        <ScaffoldHint hint={t('emptyHint')} />
      </Card>
    )
  }

  const metricLabel = (key: string) => {
    const k = `metric.${key}`
    const v = t(k)
    return v === k ? key : v
  }

  return (
    <div className="space-y-4">
      {/* Hero — the headline lift */}
      <section className="rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-600 p-6 text-white dark:from-teal-700 dark:to-emerald-700">
        <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85">{t('heroLabel')}</div>
        <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
          {metricLabel(roi.headline.key)} {roi.headline.liftDisplay}
        </div>
        <p className="mt-1 max-w-prose text-xs leading-relaxed opacity-90">{t('heroSub', { n: roi.headline.sinceMonths })}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold">
          <CheckCircle2 className="size-3" />
          {t('confidenceLead')}：{t(CONF[roi.headline.confidence].key)}
        </span>
      </section>

      {/* Trend — this store vs untreated stores */}
      <Card>
        <h3 className="text-sm font-semibold text-foreground">{t('trendTitle')}</h3>
        <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground">{t('trendSub')}</p>
        <TrendChart trend={roi.trend} />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{t('monthsAgo', { n: roi.trend.treated.length })}</span>
          <span>— — {t('controlLabel')}</span>
          <span>{t('nowLabel')}</span>
        </div>
      </Card>

      {/* Per-metric lift */}
      <Card>
        <h3 className="text-sm font-semibold text-foreground">{t('liftsTitle')}</h3>
        <p className="mb-3.5 mt-0.5 text-[11px] text-muted-foreground">{t('liftsSub')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {roi.lifts.map((l) => (
            <div key={l.key} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]">
              <div className="text-[11.5px] font-medium text-muted-foreground">{metricLabel(l.key)}</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{l.liftDisplay}</div>
              <div className="text-[10.5px] text-muted-foreground">{l.afterDisplay} ← {l.beforeDisplay}</div>
              <span className={`mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${CONF[l.confidence].cls}`}>{t(CONF[l.confidence].key)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Honesty note */}
      <Card>
        <div className="flex items-start gap-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
          <span>{t('honestyNote')}</span>
        </div>
      </Card>

      {/* The pitch */}
      {roi.monthlyValueEstimate && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]">
          <BarChart3 className="size-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <div className="text-[13.5px] font-semibold text-foreground">{t('pitchTitle')}</div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              {t('pitchSub', { amount: formatMoney(roi.monthlyValueEstimate, locale) })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
