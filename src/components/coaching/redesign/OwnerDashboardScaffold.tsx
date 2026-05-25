'use client'

import { useTranslations } from 'next-intl'
import {
  Award,
  BookOpen,
  TrendingUp,
  Users,
  Users2,
} from 'lucide-react'

import { CoachingScaffoldCard } from './CoachingScaffoldCard'

// ─────────────────────────────────────────────────────────────
// Owner coaching dashboard — SCAFFOLD ONLY
// ─────────────────────────────────────────────────────────────
// Mirrors the spike's OwnerDashboard grid (synqed-karute-design-
// spike/src/components/coaching/OwnerDashboard.tsx). All cards
// here are Layer 2 or Layer 3 — no Layer 1 (staff-private) data
// ever surfaces in the owner view.
//
//   Row 1  | TeamPerformanceCard  | TeamTrendsCard
//          | (Layer 3, aggregate) | (Layer 3, trends)
//
//   Row 2  | TopPerformersCard (full width, anonymized standouts)
//
//   Row 3  | StaffPerformanceTable (Layer 2, per-staff with consent)
//
//   Row 4  | AssignModulesCard (Layer 2, module-to-staff assignment)
//
// ANTHONY: same swap pattern as StaffDashboardScaffold — each slot
// maps 1:1 to a spike component; data hooks are noted inline.
export function OwnerDashboardScaffold() {
  const t = useTranslations('coaching.owner')

  return (
    <div className="space-y-5">
      {/* Row 1 — Layer 3 team aggregates */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        {/* data-source: useStaffPerformanceData().teamSummary */}
        <CoachingScaffoldCard
          icon={<Users2 size={18} />}
          title={t('teamPerformance.title')}
          subtitle={t('teamPerformance.subtitle')}
          body={t('teamPerformance.body')}
          privacyLayer="layer3"
          tone="amber"
        />
        {/* data-source: useStaffPerformanceData().staff → trends aggregate */}
        <CoachingScaffoldCard
          icon={<TrendingUp size={18} />}
          title={t('teamTrends.title')}
          body={t('teamTrends.body')}
          privacyLayer="layer3"
          tone="amber"
        />
      </div>

      {/* Row 2 — anonymized top performers, full width */}
      {/* data-source: useStaffPerformanceData().staff (sorted), shown
       *  WITHOUT identifying staff_id (Layer 2 anonymized rank). */}
      <CoachingScaffoldCard
        icon={<Award size={18} />}
        title={t('topPerformers.title')}
        subtitle={t('topPerformers.subtitle')}
        body={t('topPerformers.body')}
        privacyLayer="layer2"
        tone="amber"
        spanCols={2}
      />

      {/* Row 3 — per-staff drill-down table (gated by consent_status) */}
      {/* data-source: useStaffPerformanceData().staff (full),
       *  RLS-filtered by per-staff coaching_consent.granted_at. */}
      <CoachingScaffoldCard
        icon={<Users size={18} />}
        title={t('staffTable.title')}
        subtitle={t('staffTable.subtitle')}
        body={t('staffTable.body')}
        privacyLayer="layer2"
        tone="amber"
        spanCols={2}
      />

      {/* Row 4 — assign learning modules to staff */}
      {/* data-source: useLearningModulesData() + assignment mutation */}
      <CoachingScaffoldCard
        icon={<BookOpen size={18} />}
        title={t('assignModules.title')}
        subtitle={t('assignModules.subtitle')}
        body={t('assignModules.body')}
        privacyLayer="layer2"
        tone="amber"
        spanCols={2}
      />
    </div>
  )
}
