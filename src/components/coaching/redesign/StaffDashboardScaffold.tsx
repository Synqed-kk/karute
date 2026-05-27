'use client'

// ─────────────────────────────────────────────────────────────
// Staff coaching dashboard
// ─────────────────────────────────────────────────────────────
// Mirrors the spike's StaffDashboard grid (synqed-karute-design-
// spike/src/components/coaching/StaffDashboard.tsx) so the layout
// + privacy posture stay aligned when Anthony swaps the data
// hooks in. Cards (top-to-bottom, left-to-right):
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
// All 5 cards now lifted from spike with real visual chrome.
// Each renders an empty-state 対応予定 hint inside until
// Anthony passes real data through its respective prop.

import { LearnFromTopCard } from './LearnFromTopCard'
import { MonthlyGrowthCard } from './MonthlyGrowthCard'
import { NextFocusCard } from './NextFocusCard'
import { RecentModulesCard } from './RecentModulesCard'
import { StrengthsCard } from './StrengthsCard'

export function StaffDashboardScaffold() {
  return (
    <div className="space-y-5">
      {/* Row 1 — Layer 1 personal growth + Layer 2 team patterns
       *  ANTHONY: usePersonalGrowthData() → MonthlyGrowthCard.growth
       *           useTopPerformerPatternsData() → LearnFromTopCard.patterns
       *           (staff view passes showSource=false; owner view true) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
        <MonthlyGrowthCard growth={null} />
        <LearnFromTopCard patterns={null} showSource={false} />
      </div>

      {/* Row 2 — Layer 1 strengths + next focus, both from growth hook
       *  ANTHONY: usePersonalGrowthData().growth.strengths → StrengthsCard
       *           usePersonalGrowthData().growth.focusRecommendations → NextFocusCard */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <StrengthsCard strengths={null} />
        <NextFocusCard focus={null} />
      </div>

      {/* Row 3 — Assigned learning modules, full width
       *  ANTHONY: useLearningModulesData({ assignedTo: viewerStaffId })
       *           → RecentModulesCard.modules */}
      <RecentModulesCard modules={null} />
    </div>
  )
}
