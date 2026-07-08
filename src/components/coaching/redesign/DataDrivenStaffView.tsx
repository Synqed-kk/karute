'use client'

// ─────────────────────────────────────────────────────────────
// DataDrivenStaffView — the honest, data-driven staff coaching screen
// ─────────────────────────────────────────────────────────────
// The staff member's own mirror (Layer 1). Leads with the REAL business metrics
// (成約率 / 再来率 / 満足度 / 平均客単価) as the backbone — a professional dashboard,
// not a game skin — then the honest findings (the good AND the bad, with receipts,
// ranked by impact) and the you-vs-top category gaps. This is the data-driven design
// Liam signed off on (artifact 55472894), built against the coaching data contract.
//
// Reads StaffCoachingView (src/lib/karute/coaching/contract.ts). DORMANT: pass
// view={null} and it renders the 対応予定 scaffold until Anthony wires the real hook.
// Every field is L1 staff-private; the contract's type shape is what guarantees an
// owner can never receive this screen's detail.
//
// ANTHONY: swap StaffDashboardScaffold → DataDrivenStaffView in CoachingPageView and
// feed it useStaffCoachingData() returning a StaffCoachingView. Nothing else changes.

import { useLocale, useTranslations } from 'next-intl'
import { TrendingUp, AlertTriangle, Eye, Sparkles } from 'lucide-react'

import type {
  StaffCoachingView,
  CoreMetrics,
  CategoryScore,
  HonestFinding,
  MoneyAmount,
} from '@/lib/karute/coaching/contract'

import { PrivacyLockBadge } from './PrivacyLockBadge'
import { ScaffoldHint } from './ScaffoldHint'

interface DataDrivenStaffViewProps {
  /** Real coaching data, or null (default) → dormant scaffold. */
  view?: StaffCoachingView | null
}

function formatMoney(m: MoneyAmount, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: m.currency,
      maximumFractionDigits: 0,
    }).format(m.amount)
  } catch {
    return `${m.amount.toLocaleString()} ${m.currency}`
  }
}

const pct = (r: number) => `${Math.round(r * 100)}%`

// ── Metric backbone ──────────────────────────────────────────
function MetricBackbone({ metrics, locale }: { metrics: CoreMetrics; locale: string }) {
  const t = useTranslations('coaching.staff.dataView')
  const stats: Array<{ label: string; value: string }> = [
    { label: t('closingRate'), value: pct(metrics.closingRate) },
    { label: t('rebookingRate'), value: pct(metrics.rebookingRate) },
    { label: t('satisfaction'), value: `${metrics.customerSatisfaction.toFixed(1)}` },
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

// ── Honest findings (the heart) ──────────────────────────────
const SEVERITY: Record<
  HonestFinding['severity'],
  { icon: typeof AlertTriangle; ring: string; tag: string; tagKey: string }
> = {
  priority: {
    icon: AlertTriangle,
    ring: 'border-rose-200 bg-rose-50/50 dark:border-rose-500/20 dark:bg-rose-500/[0.06]',
    tag: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    tagKey: 'sevPriority',
  },
  watch: {
    icon: Eye,
    ring: 'border-amber-200 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/[0.06]',
    tag: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    tagKey: 'sevWatch',
  },
  strength: {
    icon: Sparkles,
    ring: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]',
    tag: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    tagKey: 'sevStrength',
  },
}

function FindingRow({ finding }: { finding: HonestFinding }) {
  const t = useTranslations('coaching.staff.dataView')
  const s = SEVERITY[finding.severity]
  const Icon = s.icon
  return (
    <div className={`rounded-lg border p-4 ${s.ring}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-foreground/70" />
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.tag}`}>
          {t(s.tagKey)}
        </span>
        <h4 className="text-sm font-semibold text-foreground text-balance">{finding.headline}</h4>
      </div>
      {/* The receipt: the quantified impact, tied to a real metric + count. */}
      <p className="text-xs leading-relaxed text-foreground/80">{finding.impact}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground/70">{t('doThis')}: </span>
        {finding.recommendation}
      </p>
      {finding.confidenceNote && (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground/80">{finding.confidenceNote}</p>
      )}
    </div>
  )
}

// ── Category gaps (you vs top) ───────────────────────────────
function CategoryGap({ category }: { category: CategoryScore }) {
  const t = useTranslations('coaching.staff.dataView')
  const top = category.topBenchmark
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{/* label localized upstream */}{categoryLabel(category)}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{category.score}</span>
          {top != null && ` / ${t('top')} ${top}`}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted dark:bg-white/10">
        {top != null && (
          <div className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${Math.min(top, 100)}%` }} aria-hidden />
        )}
        <div className="h-full rounded-full bg-indigo-500/80 dark:bg-indigo-400/80" style={{ width: `${Math.min(category.score, 100)}%` }} />
      </div>
    </div>
  )
}

/** The category carries a stable key; the human label is resolved upstream into
 *  the contract at build time. Fall back to the key if a label wasn't attached. */
function categoryLabel(c: CategoryScore & { label?: string }): string {
  return c.label ?? c.key
}

// ── The screen ───────────────────────────────────────────────
export function DataDrivenStaffView({ view = null }: DataDrivenStaffViewProps) {
  const t = useTranslations('coaching.staff.dataView')
  const tCommon = useTranslations('coaching.common')
  const locale = useLocale()

  if (!view) {
    return (
      <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-indigo-600 dark:text-indigo-300" />
            <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
          </div>
          <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
        </div>
        <ScaffoldHint hint={t('emptyHint')} />
      </div>
    )
  }

  const strengths = view.findings.filter((f) => f.severity === 'strength')
  const issues = view.findings.filter((f) => f.severity !== 'strength')

  return (
    <div className="space-y-5">
      {/* Backbone + honesty caveat */}
      <section className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
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
      </section>

      {/* Honest findings — the heart. Issues first (ranked), strengths after. */}
      {(issues.length > 0 || strengths.length > 0) && (
        <section className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('findingsTitle')}</h3>
          <div className="space-y-3">
            {issues.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
            {strengths.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </div>
        </section>
      )}

      {/* You vs top, per conversation-skill category */}
      {view.categories.length > 0 && (
        <section className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
          <h3 className="mb-4 text-sm font-semibold text-foreground">{t('categoriesTitle')}</h3>
          <div className="space-y-3.5">
            {view.categories.map((c) => (
              <CategoryGap key={c.key} category={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
