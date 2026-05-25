'use client'

import { useTranslations } from 'next-intl'
import {
  BookOpen,
  Sparkles,
  Star,
  Target,
  TrendingUp,
} from 'lucide-react'

import { CoachingScaffoldCard } from './CoachingScaffoldCard'

// ─────────────────────────────────────────────────────────────
// Staff coaching dashboard — SCAFFOLD ONLY
// ─────────────────────────────────────────────────────────────
// Mirrors the spike's StaffDashboard grid (synqed-karute-design-
// spike/src/components/coaching/StaffDashboard.tsx) so the layout
// + privacy posture survive when Anthony swaps each scaffold card
// for its real implementation. Cards (top-to-bottom, left-to-right):
//
//   Row 1  | MonthlyGrowthCard    | LearnFromTopCard
//          | (Layer 1, staff-     | (Layer 2, team-
//          |  private growth)     |  shared patterns)
//
//   Row 2  | StrengthsCard        | NextFocusCard
//          | (Layer 1)            | (Layer 1)
//
//   Row 3  | RecentModulesCard (full width, Layer 1 assignments)
//
// ANTHONY: each <CoachingScaffoldCard> slot maps 1:1 to a spike
// component. Replace one at a time — the data hooks are listed
// inline next to each scaffold's `data-source` comment so you
// know what to wire.
export function StaffDashboardScaffold() {
  const t = useTranslations('coaching.staff')

  return (
    <div className="space-y-5">
      {/* Row 1 — Layer 1 personal growth + Layer 2 team patterns */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
        {/* data-source: usePersonalGrowthData() — staff_id = auth.uid() */}
        <CoachingScaffoldCard
          icon={<Sparkles size={18} />}
          title={t('monthlyGrowth.title')}
          subtitle={t('monthlyGrowth.subtitle')}
          body={t('monthlyGrowth.body')}
          privacyLayer="layer1"
          tone="indigo"
        />
        {/* data-source: useTopPerformerPatternsData() — anonymized
         *  patterns from top performers, no identifying staff_id. */}
        <CoachingScaffoldCard
          icon={<Star size={18} />}
          title={t('learnFromTop.title')}
          subtitle={t('learnFromTop.subtitle')}
          body={t('learnFromTop.body')}
          privacyLayer="layer2"
          tone="violet"
        />
      </div>

      {/* Row 2 — Layer 1 strengths + next focus, both from growth hook */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* data-source: usePersonalGrowthData().growth.strengths */}
        <CoachingScaffoldCard
          icon={<TrendingUp size={18} />}
          title={t('strengths.title')}
          body={t('strengths.body')}
          privacyLayer="layer1"
          tone="emerald"
        />
        {/* data-source: usePersonalGrowthData().growth.focusRecommendations */}
        <CoachingScaffoldCard
          icon={<Target size={18} />}
          title={t('nextFocus.title')}
          body={t('nextFocus.body')}
          privacyLayer="layer1"
          tone="indigo"
        />
      </div>

      {/* Row 3 — Assigned learning modules, full width */}
      {/* data-source: useLearningModulesData({ assignedTo: viewerId }) */}
      <CoachingScaffoldCard
        icon={<BookOpen size={18} />}
        title={t('recentModules.title')}
        subtitle={t('recentModules.subtitle')}
        body={t('recentModules.body')}
        privacyLayer="layer1"
        tone="indigo"
        spanCols={2}
      />
    </div>
  )
}
