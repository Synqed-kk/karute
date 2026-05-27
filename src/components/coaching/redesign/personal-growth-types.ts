// ─────────────────────────────────────────────────────────────
// Personal growth — staff-private types
// ─────────────────────────────────────────────────────────────
// All types here are Layer 1 — staff-private. Backend RLS MUST
// enforce SELECT only where staff_id = auth.uid() and explicit
// policy denies owners + managers.
//
// Spike sources:
//   src/mock/coaching/personal-growth.ts
//   src/mock/coaching/personal-coaching-insights.ts
//   src/mock/coaching/session-transcripts.ts

import type { FocusRecommendation } from './NextFocusCard'
import type { StrengthItem } from './StrengthsCard'

/** One month's aggregate score on the staff's growth chart.
 *  Same shape as TrajectoryPoint in owner-types but kept
 *  separate so the access layer can't accidentally cross-link
 *  staff Layer-1 data with the owner-side trajectory. */
export interface GrowthPoint {
  /** "YYYY-MM" — the chart slices the year for the x-axis label. */
  month: string
  /** 0..100 staff-private monthly score. */
  score: number
}

export type InsightOutcome =
  /** Staff tried it and reported it worked. */
  | 'worked'
  /** Staff acknowledged + tried. */
  | 'tried'
  /** Staff explicitly chose not to apply. */
  | 'skipped'
  /** Default: staff hasn't responded yet. */
  | 'unconfirmed'

/** One AI coaching suggestion the staff received either in-
 *  session (haiku, realtime) or post-session (sonnet, batch).
 *  ACCESS LAYER 1 — owners NEVER read this. */
export interface PersonalCoachingInsight {
  id: string
  /** Categorical label — e.g. "クロージング". */
  category: string
  /** Localized timestamp string. */
  receivedAt: string
  /** Short context line (which session / what stage). */
  context: string
  /** The actual suggestion the AI gave. */
  suggestion: string
  /** Staff's response (or default 'unconfirmed'). */
  outcome: InsightOutcome
}

/** One excerpt from a staff session with the AI coaching note
 *  the model attached at that timestamp. ACCESS LAYER 1 —
 *  owners NEVER read transcript content, even via join. */
export interface TranscriptExcerpt {
  id: string
  /** Short context label — e.g. "カウンセリング". */
  context: string
  /** Localized date string. */
  date: string
  /** Raw transcript chunk (staff's own words + customer's). */
  excerpt: string
  /** AI's coaching note attached to this excerpt. */
  coachingNote: string
}

/** Staff's personal growth dataset — superset of
 *  MonthlyGrowthData with the longitudinal series + named
 *  strengths/focus areas the dashboard summary doesn't show.
 *  The `strengths` + `focusRecommendations` shapes match the
 *  existing StrengthsCard + NextFocusCard prop contracts so
 *  Anthony's eventual hook can return a single object that
 *  feeds every staff-side growth surface. */
export interface PersonalGrowth {
  monthlyScore: number
  scoreDelta: number
  sessionsAnalyzed: number
  patternsMastered: number
  patternsInProgress: number
  /** Month-by-month growth series for the chart. */
  progressHistory: GrowthPoint[]
  /** Categorical strengths with short explanatory detail. */
  strengths: StrengthItem[]
  /** Next-focus recommendations with suggested-action detail. */
  focusRecommendations: FocusRecommendation[]
}
