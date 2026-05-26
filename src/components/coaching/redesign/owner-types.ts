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
}

export interface LearningModule {
  id: string
  title: string
  category: string
  durationMin: number
  /** Owner-side: is this module assigned to a staff yet? */
  assigned?: boolean
  /** staffId — owner-side bookkeeping. */
  assignedTo?: string
}
