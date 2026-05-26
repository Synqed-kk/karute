// ─────────────────────────────────────────────────────────────
// Coaching consent — types
// ─────────────────────────────────────────────────────────────
// Same shape as the spike's consent-status mock. Karute version
// adds 'unset' as the default-pre-prompt state.

export type CoachingConsentStatus = 'unset' | 'granted' | 'declined'

export interface CoachingConsentRecord {
  status: CoachingConsentStatus
  /** ISO timestamp of the most recent grant/decline. */
  decidedAt: string | null
  /** Policy version the staff agreed/declined to. Append-only on
   *  the backend — see hooks.ts for the schema. */
  policyVersion: string | null
}
