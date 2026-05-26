'use client'

// ─────────────────────────────────────────────────────────────
// PersonalGrowthView — /coaching/growth client root
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: app/[locale]/(app)/coaching/growth/page.tsx
// (~95 lines).
//
// STAFF-ONLY surface. All content is Layer 1 (staff-private).
// Server page only lets non-staff callers through when the dev-
// preview env flag is on; when the dev flips the preview pill to
// "owner" this view renders a staff-only notice instead of the
// growth content, mirroring what a real owner would see if they
// bypassed the server gate.
//
// LAYOUT (top to bottom):
//   Back link
//   Title row (Sparkles + heading + PrivacyLockBadge + subtitle)
//   GrowthProgressChart        — Layer 1 longitudinal score
//   SessionsAnalyzedStat       — 3 stat cells
//   2-col: StrengthsCard + NextFocusCard (existing components)
//   PatternsMasteredList       — assigned modules by progress
//   RecentInsightsList         — past AI suggestions + outcomes
//   TranscriptExcerptCard      — raw transcript chunks + AI notes
//
// All data props are nullable; each section degrades to its own
// ScaffoldHint until Anthony wires the data hooks.

import Link from 'next/link'
import { ArrowLeft, Shield, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { useEffectiveCoachingRole } from '@/lib/coaching-dev-preview/hooks'

import { GrowthProgressChart } from './GrowthProgressChart'
import { NextFocusCard } from './NextFocusCard'
import { PatternsMasteredList } from './PatternsMasteredList'
import { PrivacyLockBadge } from './PrivacyLockBadge'
import { RecentInsightsList } from './RecentInsightsList'
import { SessionsAnalyzedStat } from './SessionsAnalyzedStat'
import { StrengthsCard } from './StrengthsCard'
import { TranscriptExcerptCard } from './TranscriptExcerptCard'
import type { LearningModule } from './owner-types'
import type {
  PersonalCoachingInsight,
  PersonalGrowth,
  TranscriptExcerpt,
} from './personal-growth-types'

interface PersonalGrowthViewProps {
  viewerRealRole: 'owner' | 'staff'
  /** Live growth data — null until Anthony wires
   *  usePersonalGrowthData(). */
  growth?: PersonalGrowth | null
  /** Per-session AI suggestions with outcomes — null until wired. */
  insights?: PersonalCoachingInsight[] | null
  /** Transcript chunks + AI notes — null until wired. */
  excerpts?: TranscriptExcerpt[] | null
  /** Staff's assigned modules with completion rates — null until
   *  wired (useLearningModulesData({ assignedTo: viewerStaffId })). */
  modules?: LearningModule[] | null
}

export function PersonalGrowthView({
  viewerRealRole,
  growth = null,
  insights = null,
  excerpts = null,
  modules = null,
}: PersonalGrowthViewProps) {
  const t = useTranslations('coaching.growth')
  const tCommon = useTranslations('coaching.common')
  const locale = useLocale()
  const role = useEffectiveCoachingRole(viewerRealRole)

  if (role !== 'staff') {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-5 md:px-8 md:py-8">
        <Link
          href={`/${locale}/coaching`}
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t('back')}
        </Link>
        <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-6 text-sm leading-relaxed text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
          <Shield
            className="mt-0.5 size-4 shrink-0 text-slate-500 dark:text-slate-400"
            aria-hidden
          />
          <p>{t('staffOnlyNotice')}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-5 md:px-8 md:py-8">
      <Link
        href={`/${locale}/coaching`}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('back')}
      </Link>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-6 text-indigo-600 dark:text-indigo-300" />
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-5">
        <GrowthProgressChart points={growth?.progressHistory ?? null} />

        <SessionsAnalyzedStat
          sessionsAnalyzed={growth?.sessionsAnalyzed ?? null}
          patternsMastered={growth?.patternsMastered ?? null}
          patternsInProgress={growth?.patternsInProgress ?? null}
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <StrengthsCard strengths={growth?.strengths ?? null} />
          <NextFocusCard focus={growth?.focusRecommendations ?? null} />
        </div>

        <PatternsMasteredList modules={modules} />

        <RecentInsightsList insights={insights} />

        <TranscriptExcerptCard excerpts={excerpts} />
      </div>
    </main>
  )
}
