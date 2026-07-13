'use client'

// ─────────────────────────────────────────────────────────────
// DataDrivenStaffView — the honest, data-driven staff coaching screen
// ─────────────────────────────────────────────────────────────
// The staff member's own mirror (Layer 1). The data-driven design Liam signed off
// on (artifact d8b93369, enriched vision), built against the coaching data contract.
// Top → bottom:
//   1. 今週の一手      — the single highest-impact move to practice (focus[0])
//   2. あなたの成績    — the metric backbone (成約率/再来率/満足度/客単価)
//   3. 推移            — the primary metric climbing over the window (progressHistory)
//   4. 今月の気づき    — honest findings, ranked, with receipts (the heart)
//   5. 不成約の理由    — why deals slipped + the "decide later" backlog nudge (outcomes)
//   6. 会話スキル      — you vs the top-performer benchmark (categories)
//   7. トップ層から学ぶ — anonymized techniques the best staff use (learnFromTop, §14)
//
// Reads StaffCoachingView (src/lib/karute/coaching/contract.ts). DORMANT: pass
// view={null} → the 対応予定 scaffold, until Anthony wires useStaffCoachingData().
// Every field is L1 staff-private; the contract's type shape is the guarantee an
// owner can never receive this screen's detail.

import { useLocale, useTranslations } from 'next-intl'
import { TrendingUp, AlertTriangle, Eye, Sparkles, Lightbulb, Clock, PlayCircle, Users } from 'lucide-react'

import type {
  StaffCoachingView,
  CoreMetrics,
  CategoryScore,
  HonestFinding,
  FocusRecommendation,
  OutcomesSummary,
  TeamPattern,
  MetricPoint,
  MoneyAmount,
} from '@/lib/karute/coaching/contract'

import { PrivacyLockBadge } from './PrivacyLockBadge'
import { ScaffoldHint } from './ScaffoldHint'

interface DataDrivenStaffViewProps {
  view?: StaffCoachingView | null
}

function formatMoney(m: MoneyAmount, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(m.amount)
  } catch {
    return `${m.amount.toLocaleString()} ${m.currency}`
  }
}
const pct = (r: number) => `${Math.round(r * 100)}%`

function Card({ children, fresh }: { children: React.ReactNode; fresh?: boolean }) {
  return (
    <section className={`rounded-xl bg-card p-5 shadow-sm ${fresh ? 'ring-1 ring-amber-300/40 dark:ring-amber-400/20' : 'ring-1 ring-black/5 dark:ring-white/10'}`}>
      {children}
    </section>
  )
}

// ── 1. This week's move ──────────────────────────────────────
function ThisWeeksMove({ focus }: { focus: FocusRecommendation }) {
  const t = useTranslations('coaching.staff.dataView')
  return (
    <Card fresh>
      <div className="rounded-lg bg-gradient-to-b from-amber-50/60 to-transparent p-4 dark:from-amber-500/[0.06]">
        <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          <Lightbulb className="size-3.5" />
          {t('thisWeek')}
        </div>
        <h3 className="mt-1.5 text-[15px] font-semibold text-foreground text-balance">{focus.headline}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{focus.rationale}</p>
        {focus.moduleId && (
          <button className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500">
            <PlayCircle className="size-3.5" />
            {t('practice')}
          </button>
        )}
      </div>
    </Card>
  )
}

// ── 2. Metric backbone ───────────────────────────────────────
function MetricBackbone({ metrics, locale }: { metrics: CoreMetrics; locale: string }) {
  const t = useTranslations('coaching.staff.dataView')
  const stats = [
    { label: t('closingRate'), value: pct(metrics.closingRate) },
    { label: t('rebookingRate'), value: pct(metrics.rebookingRate) },
    { label: t('satisfaction'), value: metrics.customerSatisfaction.toFixed(1) },
    { label: t('avgRevenue'), value: formatMoney(metrics.avgRevenue, locale) },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg bg-muted/40 p-3 dark:bg-white/[0.03]">
          <div className="text-[11px] font-medium text-muted-foreground">{s.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{s.value}</div>
        </div>
      ))}
    </div>
  )
}

// ── 3. Progress trend ────────────────────────────────────────
function ProgressTrend({ history }: { history: MetricPoint[] }) {
  const t = useTranslations('coaching.staff.dataView')
  if (history.length < 2) return null
  const vals = history.map((p) => p.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const W = 320
  const pts = history
    .map((p, i) => {
      const x = 6 + (i / (history.length - 1)) * (W - 12)
      const y = 12 + (1 - (p.value - min) / range) * 52
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const last = pts.split(' ').at(-1)!.split(',')
  const first = history[0].value
  const latest = history[history.length - 1].value
  const delta = Math.round((latest - first) * 100)
  return (
    <Card fresh>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <TrendingUp className="size-4 text-indigo-600 dark:text-indigo-300" />
        {t('trendTitle')}
      </h3>
      <svg viewBox="0 0 320 78" width="100%" height="78" preserveAspectRatio="none" aria-label={t('trendTitle')}>
        <line x1="0" y1="64" x2="320" y2="64" stroke="currentColor" className="text-muted-foreground/15" strokeWidth="1" />
        <polyline points={pts} fill="none" stroke="currentColor" className="text-indigo-500 dark:text-indigo-400" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last[0]} cy={last[1]} r="4" className="fill-indigo-500 dark:fill-indigo-400" />
      </svg>
      <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>{pct(first)}</span>
        <span>
          {t('nowLabel')} <b className="text-emerald-700 dark:text-emerald-400">{pct(latest)}</b>
          {delta > 0 && ` · +${delta}pt`}
        </span>
      </div>
    </Card>
  )
}

// ── 4. Honest findings (the heart) ───────────────────────────
const SEVERITY: Record<HonestFinding['severity'], { icon: typeof AlertTriangle; ring: string; tag: string; tagKey: string }> = {
  priority: { icon: AlertTriangle, ring: 'border-rose-200 bg-rose-50/50 dark:border-rose-500/20 dark:bg-rose-500/[0.06]', tag: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', tagKey: 'sevPriority' },
  watch: { icon: Eye, ring: 'border-amber-200 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/[0.06]', tag: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', tagKey: 'sevWatch' },
  strength: { icon: Sparkles, ring: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]', tag: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', tagKey: 'sevStrength' },
}

function FindingRow({ finding }: { finding: HonestFinding }) {
  const t = useTranslations('coaching.staff.dataView')
  const s = SEVERITY[finding.severity]
  const Icon = s.icon
  return (
    <div className={`rounded-lg border p-4 ${s.ring}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-foreground/70" />
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.tag}`}>{t(s.tagKey)}</span>
        <h4 className="text-sm font-semibold text-foreground text-balance">{finding.headline}</h4>
      </div>
      <p className="text-xs leading-relaxed text-foreground/80">{finding.impact}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground/70">{t('doThis')}: </span>
        {finding.recommendation}
      </p>
      {finding.confidenceNote && <p className="mt-1.5 text-[11px] italic text-muted-foreground/80">{finding.confidenceNote}</p>}
    </div>
  )
}

// ── 5. Why deals slipped + decide-later nudge ────────────────
function OutcomesReasons({ outcomes }: { outcomes: OutcomesSummary }) {
  const t = useTranslations('coaching.staff.dataView')
  const total = outcomes.noDealTotal || 1
  const reasonLabel = (r: string) => {
    const key = `reason.${r}`
    const val = t(key)
    return val === key ? r : val
  }
  return (
    <Card fresh>
      <h3 className="mb-3.5 text-sm font-semibold text-foreground">{t('reasonsTitle', { n: outcomes.noDealTotal })}</h3>
      <div className="space-y-2.5">
        {outcomes.declineReasons.map((d) => (
          <div key={d.reason} className="flex items-center gap-2.5">
            <span className="w-24 shrink-0 text-xs text-foreground">{reasonLabel(d.reason)}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted/50 dark:bg-white/10">
              <span className="block h-full rounded-full bg-rose-500/70" style={{ width: `${Math.round((d.count / total) * 100)}%` }} />
            </span>
            <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{d.count}</span>
          </div>
        ))}
      </div>
      {outcomes.pendingCount > 0 && (
        <div className="mt-3.5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/[0.07]">
          <Clock className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <div className="text-[12.5px] font-semibold text-foreground">{t('pendingTitle', { n: outcomes.pendingCount })}</div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{t('pendingBody')}</div>
          </div>
        </div>
      )}
    </Card>
  )
}

// ── 6. Category gaps ─────────────────────────────────────────
function CategoryGap({ category }: { category: CategoryScore }) {
  const t = useTranslations('coaching.staff.dataView')
  const top = category.topBenchmark
  const label = (category as CategoryScore & { label?: string }).label ?? category.key
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{category.score}</span>
          {top != null && ` / ${t('top')} ${top}`}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted dark:bg-white/10">
        {top != null && <div className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground/40" style={{ left: `${Math.min(top, 100)}%` }} aria-hidden />}
        <div className="h-full rounded-full bg-indigo-500/80 dark:bg-indigo-400/80" style={{ width: `${Math.min(category.score, 100)}%` }} />
      </div>
    </div>
  )
}

// ── 7. Learn from top ────────────────────────────────────────
function LearnFromTop({ patterns }: { patterns: TeamPattern[] }) {
  const t = useTranslations('coaching.staff.dataView')
  return (
    <Card fresh>
      <h3 className="mb-3.5 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Users className="size-4 text-indigo-600 dark:text-indigo-300" />
        {t('learnTitle')}
      </h3>
      <div className="space-y-2.5">
        {patterns.map((p) => (
          <div key={p.id} className="rounded-lg border border-amber-200/70 bg-amber-50/40 p-3.5 dark:border-amber-500/20 dark:bg-amber-500/[0.05]">
            <div className="text-[12.5px] font-medium text-foreground">{p.behavior}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{p.adoptionNote}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── The screen ───────────────────────────────────────────────
export function DataDrivenStaffView({ view = null }: DataDrivenStaffViewProps) {
  const t = useTranslations('coaching.staff.dataView')
  const tCommon = useTranslations('coaching.common')
  const locale = useLocale()

  if (!view) {
    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-indigo-600 dark:text-indigo-300" />
            <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
          </div>
          <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
        </div>
        <ScaffoldHint hint={t('emptyHint')} />
      </Card>
    )
  }

  const strengths = view.findings.filter((f) => f.severity === 'strength')
  const issues = view.findings.filter((f) => f.severity !== 'strength')

  return (
    <div className="space-y-5">
      {view.focus[0] && <ThisWeeksMove focus={view.focus[0]} />}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-indigo-600 dark:text-indigo-300" />
            <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
          </div>
          <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
        </div>
        <MetricBackbone metrics={view.metrics} locale={locale} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('basedOn', { n: view.metrics.sessionsAnalyzed })}
          {view.maturityNote ? ` · ${view.maturityNote}` : ''}
        </p>
      </Card>

      <ProgressTrend history={view.progressHistory} />

      {(issues.length > 0 || strengths.length > 0) && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('findingsTitle')}</h3>
          <div className="space-y-3">
            {issues.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
            {strengths.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </div>
        </Card>
      )}

      {view.outcomes.noDealTotal > 0 && <OutcomesReasons outcomes={view.outcomes} />}

      {view.categories.length > 0 && (
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-foreground">{t('categoriesTitle')}</h3>
          <div className="space-y-3.5">
            {view.categories.map((c) => (
              <CategoryGap key={c.key} category={c} />
            ))}
          </div>
        </Card>
      )}

      {view.learnFromTop.length > 0 && <LearnFromTop patterns={view.learnFromTop} />}
    </div>
  )
}
