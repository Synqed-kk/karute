'use client'

// ─────────────────────────────────────────────────────────────
// StaffDrillDownView — /coaching/staff/[id] client view
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: app/[locale]/(app)/coaching/staff/[id]/page.tsx
// (~149 lines). Page chrome preserved 1:1 — avatar header,
// top-performer badge, sub-label, assign-modules CTA, metric
// row, trajectory chart, gap analysis list.
//
// PRIVACY: Layer 2 — Owner-only. The server page does the role
// check upstream and only renders this view when the caller is
// an owner. Even so: backend MUST also enforce the same gate at
// the API + RLS layer, because the frontend role check exists
// for UI rendering only.
//
// DATA STRATEGY:
//   - Header (name/initials/role) comes from the DB-backed
//     StaffMember record passed in as `staff`.
//   - tenureMonths/sessionsThisMonth/isTopPerformer/metrics/
//     trajectory/gap insights all come from the (not-yet-wired)
//     useStaffPerformanceData() + useCategoricalInsightsData()
//     hooks. Until then: real chrome + 対応予定 scaffolds.

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BookPlus, Crown } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { GapAnalysisList } from './GapAnalysisList'
import { GrowthTrajectoryChart } from './GrowthTrajectoryChart'
import { PrivacyNoticeInline } from './PrivacyNoticeInline'
import { StaffDrillDownModal } from './StaffDrillDownModal'
import type { CategoricalInsight, StaffPerformance } from './owner-types'

import { ScaffoldHint } from './ScaffoldHint'

interface StaffDrillDownViewProps {
  staffId: string
  staffName: string
  initials: string
  role: string
  /** Live performance data — null until Anthony wires
   *  useStaffPerformanceData() on the server page. */
  performance?: StaffPerformance | null
  /** Categorical gap insights — null until Anthony wires
   *  useCategoricalInsightsData(staffId). */
  insights?: CategoricalInsight[] | null
}

export function StaffDrillDownView({
  staffId,
  staffName,
  initials,
  role,
  performance = null,
  insights = null,
}: StaffDrillDownViewProps) {
  const t = useTranslations('coaching.staffDrill')
  const locale = useLocale()
  const router = useRouter()
  const [confirmed, setConfirmed] = useState(false)

  const backHref = `/${locale}/coaching`
  const onCancel = useCallback(() => router.push(backHref), [router, backHref])
  const onConfirm = useCallback(() => setConfirmed(true), [])

  const hasMetrics = performance !== null
  const isTop = performance?.isTopPerformer === true

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-5 md:px-8 md:py-8">
      <StaffDrillDownModal
        open={!confirmed}
        staffName={staffName}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />

      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('back')}
      </Link>

      <div className="mb-5 md:mb-6">
        <div className="flex items-start gap-3 md:gap-4">
          <Avatar className="size-12 shrink-0 border border-gray-200 dark:border-white/10 md:size-14">
            <AvatarFallback className="bg-gray-100 font-semibold text-gray-700 dark:bg-neutral-800 dark:text-gray-300">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
                {staffName}
              </h1>
              {isTop && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                  <Crown className="size-3" aria-hidden />
                  {t('topPerformerBadge')}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
              {hasMetrics && performance
                ? t('roleAndTenure', {
                    role,
                    months: performance.tenureMonths ?? 0,
                    sessions: performance.sessionsThisMonth,
                  })
                : role}
            </p>
          </div>
          <Link
            href={`/${locale}/coaching/modules?staff=${staffId}`}
            className={cn(
              buttonVariants({ variant: 'default' }),
              'hidden shrink-0 bg-indigo-600 hover:bg-indigo-700 md:inline-flex',
            )}
          >
            <BookPlus className="size-3.5" aria-hidden />
            {t('assignModulesCta')}
          </Link>
        </div>
        {/* Mobile: full-width assign button below the header row */}
        <Link
          href={`/${locale}/coaching/modules?staff=${staffId}`}
          className={cn(
            buttonVariants({ variant: 'default' }),
            'mt-3 w-full bg-indigo-600 hover:bg-indigo-700 md:hidden',
          )}
        >
          <BookPlus className="size-3.5" aria-hidden />
          {t('assignModulesCta')}
        </Link>
      </div>

      <div className="mb-5">
        <PrivacyNoticeInline />
      </div>

      {/* Metric row — real chrome; values fall back to "—" + scaffold
       *  hint card when performance data isn't wired yet. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCell
          label={t('metricClosing')}
          value={
            performance
              ? `${Math.round(performance.closingRate * 100)}%`
              : t('metricScaffoldValue')
          }
        />
        <MetricCell
          label={t('metricRebooking')}
          value={
            performance
              ? `${Math.round(performance.rebookingRate * 100)}%`
              : t('metricScaffoldValue')
          }
        />
        <MetricCell
          label={t('metricRevenue')}
          value={
            performance
              ? `¥${performance.avgRevenueJpy.toLocaleString('ja-JP')}`
              : t('metricScaffoldValue')
          }
        />
        <MetricCell
          label={t('metricSatisfaction')}
          value={
            performance
              ? t('metricSatisfactionValue', {
                  score: performance.customerSatisfaction.toFixed(1),
                })
              : t('metricScaffoldValue')
          }
        />
      </div>

      {!hasMetrics && (
        <div className="mb-5">
          <ScaffoldHint hint={t('metricsScaffoldHint')} />
        </div>
      )}

      <div className="mb-5">
        <GrowthTrajectoryChart
          points={performance?.trajectoryL2 ?? null}
          title={t('chartTitle', { name: staffName })}
        />
      </div>

      <GapAnalysisList insights={insights} />
    </main>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-card px-4 py-3 dark:border-white/10">
      <div className="mb-0.5 text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

