'use client'

// ─────────────────────────────────────────────────────────────
// Owner coaching dashboard
// ─────────────────────────────────────────────────────────────
// Mirrors the spike's OwnerDashboard grid (synqed-karute-design-
// spike/src/components/coaching/OwnerDashboard.tsx). All cards
// here are Layer 2 or Layer 3 — no Layer 1 (staff-private) data
// ever surfaces in the owner view.
//
//   Row 1  | TeamPerformanceCard  | TeamTrendsCard
//          | (Layer 3, aggregate) | (Layer 2, categorical)
//
//   Row 2  | TopPerformersCard (full width, Layer 2 named)
//
//   Row 3  | StaffPerformanceTable (Layer 2, per-staff with consent)
//
//   Row 4  | AssignModulesCard (Layer 3 owner action)
//
// All 5 cards now lifted from spike with real visual chrome.
// Each accepts nullable data props; renders empty state with
// 対応予定 hint until Anthony wires the data hooks.

import { AssignModulesCard } from './AssignModulesCard'
import { StaffPerformanceTable } from './StaffPerformanceTable'
import { TeamPerformanceCard } from './TeamPerformanceCard'
import { TeamTrendsCard } from './TeamTrendsCard'
import { TopPerformersCard } from './TopPerformersCard'

export function OwnerDashboardScaffold() {
  return (
    <div className="space-y-5">
      {/* Row 1 — Layer 3 team aggregates + Layer 2 categorical trends
       *  ANTHONY: useStaffPerformanceData().teamSummary → TeamPerformanceCard
       *           useStaffPerformanceData().staff → TeamTrendsCard.staff */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <TeamPerformanceCard summary={null} />
        <TeamTrendsCard staff={null} />
      </div>

      {/* Row 2 — named top performers (Layer 2, owner-only)
       *  ANTHONY: useStaffPerformanceData().staff.filter(isTopPerformer) */}
      <TopPerformersCard staff={null} />

      {/* Row 3 — per-staff drill-down table (Layer 2, links to
       *  /coaching/staff/[id] which gates on consent)
       *  ANTHONY: useStaffPerformanceData().staff (full list) */}
      <StaffPerformanceTable staff={null} />

      {/* Row 4 — assign learning modules to staff (Layer 3 owner action)
       *  ANTHONY: useLearningModulesData() catalog + useStaffPerformanceData().staff
       *           Toggle handler inserts/deletes learning_assignments rows
       *           + sends realtime notification to the assigned staff. */}
      <AssignModulesCard modules={null} staff={null} />
    </div>
  )
}
