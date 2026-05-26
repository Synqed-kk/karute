'use client'

// ─────────────────────────────────────────────────────────────
// RecentInsightsList — staff coaching history
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/RecentInsightsList.tsx
// (~89 lines).
//
// PRIVACY: Layer 1 — staff-private. Specific, session-level
// suggestions the AI gave + the staff's response (worked /
// tried / skipped / unconfirmed).
//   RLS: SELECT only where staff_id = auth.uid()
//
// DATA SOURCE (when wired):
//   usePersonalCoachingInsightsData() — backed by either:
//     - post-session generator (claude-sonnet, batch)
//     - in-session generator (claude-haiku, realtime)
//   Both write to the same personal_coaching_insights table;
//   the staff response (outcome) is updated in-app and stored
//   as a separate column.

import { Check, CircleDashed, MessageCircle, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { PrivacyLockBadge } from './PrivacyLockBadge'
import { ScaffoldHint } from './ScaffoldHint'
import type {
  InsightOutcome,
  PersonalCoachingInsight,
} from './personal-growth-types'

interface RecentInsightsListProps {
  insights?: PersonalCoachingInsight[] | null
}

export function RecentInsightsList({
  insights = null,
}: RecentInsightsListProps) {
  const t = useTranslations('coaching.growth')
  const tCommon = useTranslations('coaching.common')
  const list = insights ?? []
  const hasItems = list.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-indigo-600 dark:text-indigo-300" />
          <h3 className="text-sm font-semibold">{t('insightsTitle')}</h3>
        </div>
        <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
      </div>
      <p className="mb-4 text-[11px] text-muted-foreground">
        {t('insightsIntro')}
      </p>

      {hasItems ? (
        <div className="space-y-3">
          {list.map((ins) => (
            <div
              key={ins.id}
              className="rounded-md border border-gray-100 bg-gray-50/60 p-3 dark:border-white/5 dark:bg-white/[0.02]"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-5 items-center rounded-full border border-indigo-200 bg-indigo-100 px-2 text-[10px] font-medium text-indigo-800 dark:border-indigo-500/20 dark:bg-indigo-500/15 dark:text-indigo-300">
                  {ins.category}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {ins.receivedAt}
                </span>
                <span className="ml-auto">
                  <OutcomeBadge outcome={ins.outcome} t={t} />
                </span>
              </div>
              <div className="mb-1 text-[11px] text-muted-foreground">
                {ins.context}
              </div>
              <p className="text-sm leading-relaxed text-foreground">
                {ins.suggestion}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <ScaffoldHint hint={t('insightsEmptyHint')} />
      )}
    </div>
  )
}

function OutcomeBadge({
  outcome,
  t,
}: {
  outcome: InsightOutcome
  t: (key: string) => string
}) {
  if (outcome === 'worked') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300">
        <Sparkles className="size-2.5" aria-hidden />
        {t('outcomeWorked')}
      </span>
    )
  }
  if (outcome === 'tried') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
        <Check className="size-2.5" aria-hidden />
        {t('outcomeTried')}
      </span>
    )
  }
  if (outcome === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:border-white/10 dark:bg-neutral-800 dark:text-gray-400">
        {t('outcomeSkipped')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
      <CircleDashed className="size-2.5" aria-hidden />
      {t('outcomeUnconfirmed')}
    </span>
  )
}
