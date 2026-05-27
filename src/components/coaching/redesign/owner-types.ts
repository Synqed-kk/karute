// ─────────────────────────────────────────────────────────────
// Owner coaching — shared data types
// ─────────────────────────────────────────────────────────────
// Lifted from spike: src/mock/coaching/staff-performance.ts +
// learning-modules.ts. Karute consumers (the 4 owner cards)
// share these shapes so Anthony's data hook fits all of them
// without per-card type drift.

export type GrowthTrend = 'up' | 'flat' | 'down'

export interface StaffPerformance {
  staffId: string
  name: string
  initials: string
  role: string
  closingRate: number // 0..1
  rebookingRate: number // 0..1
  avgRevenueJpy: number
  customerSatisfaction: number // 0..5
  sessionsThisMonth: number
  growthTrend: GrowthTrend
  trendDeltaPct: number // signed integer percentage
  focusAreas: string[] // categorical labels
  isTopPerformer: boolean
  /** True when this staff has completed CoachingConsentDialog
   *  with status='granted'. Owner-side mutations (assign module,
   *  show in StaffPerformanceTable) should gate on this. */
  consentGiven: boolean
  /** Drill-down only: months at the salon (header sub-label). */
  tenureMonths?: number
  /** Drill-down only: month-by-month Layer 2 score series for
   *  the trajectory chart. Each point is a pure aggregate; no
   *  AI calls, just rolled-up category scores. */
  trajectoryL2?: TrajectoryPoint[]
}

export interface TrajectoryPoint {
  /** ISO-ish "YYYY-MM" — the chart slices the year for the x-axis label. */
  month: string
  /** 0..100 category score (Layer 2 aggregate). */
  score: number
}

export type InsightPriority = 'high' | 'medium' | 'low'

/** Drill-down only: per-staff categorical gap analysis.
 *  Server-side prompt guard MUST reject + regenerate any output
 *  that references a specific customer, session date, or
 *  transcript quote before it is returned to the owner. */
export interface CategoricalInsight {
  id: string
  staffId: string
  /** Category label only — e.g. "質問の深さ". Never a session ID. */
  category: string
  /** Generic narrative; must not name customers or quote transcripts. */
  summary: string
  /** Percentage gap to the top-performer baseline (0..100). */
  gapFromTopPerformerPct: number
  priority: InsightPriority
  /** Pattern library IDs that address this gap. */
  suggestedPatternIds: string[]
}

export interface LearningModule {
  id: string
  title: string
  category: string
  durationMin: number
  /** Module library page surface — short marketing-style blurb shown
   *  under the title. Safe to omit on assignment-card surfaces where
   *  space is tight. */
  description?: string
  /** 0..1 progress for the assigned staff. Only meaningful when
   *  `assigned` is true; otherwise leave undefined. */
  completionRate?: number
  /** Owner-side: is this module assigned to a staff yet? */
  assigned?: boolean
  /** staffId of the owner/manager who made the assignment. */
  assignedBy?: string | null
  /** staffId — owner-side bookkeeping. */
  assignedTo?: string
}

// ─────────────────────────────────────────────────────────────
// Coaching data-hook contracts (for Anthony)
// ─────────────────────────────────────────────────────────────
// Centralized so the hook signatures are explicit, not implicit
// from call-site patterns. Anthony's real hooks live in
// src/lib/data/coaching/* — the names + arg shapes here are the
// frontend contract.

/** Args for useLearningModulesData. */
export interface UseLearningModulesDataArgs {
  /** Filter to modules assigned to this staff. Omit for the
   *  full catalog (owner view). */
  assignedTo?: string
}

/** Return for useLearningModulesData. */
export interface UseLearningModulesDataResult {
  /** Loading state — undefined while in-flight, defined after. */
  data?: { modules: LearningModule[] }
}

/** Return for useStaffPerformanceData. */
export interface UseStaffPerformanceDataResult {
  data?: {
    staff: StaffPerformance[]
    /** Team-wide rollup. Undefined while staff list still loading. */
    teamSummary?: {
      avgClosingRate: number
      avgRebookingRate: number
      avgRevenueJpy: number
      avgSatisfaction: number
      totalSessionsThisMonth: number
    }
  }
}
