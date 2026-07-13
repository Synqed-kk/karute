// ─────────────────────────────────────────────────────────────────────────
// Coaching prompt library — public surface
// ─────────────────────────────────────────────────────────────────────────
// One prompt module per coaching-page section. Each is dormant until Anthony
// wires it behind the data contract (../contract.ts). See config.ts for the
// shared shape and the governing note on why consistency comes from the rubric,
// not from sampling params.

export * from './config'
export * from './categories'
export { categoryScoringPrompt } from './category-scoring'
export type { CategoryScoringInput, CategoryScoringTurn } from './category-scoring'
export { personalFindingsPrompt } from './personal-findings'
export type { PersonalFindingsInput, FindingSession, FindingSessionEntry } from './personal-findings'
export { retentionAnalysisPrompt } from './retention-analysis'
export type { RetentionAnalysisInput, RetentionCustomer } from './retention-analysis'
export { staffFocusPrompt } from './staff-focus'
export type { StaffFocusInput, StaffFocusHorizonMetric } from './staff-focus'
export { learningModulePrompt } from './learning-module'
export type { LearningModuleInput, ModuleExemplar, ModuleHorizon } from './learning-module'
export { topPerformerPatternsPrompt } from './top-performer-patterns'
export type { TopPerformerPatternsInput, PatternSession, PatternSessionEntry } from './top-performer-patterns'
