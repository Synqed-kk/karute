export type CoachingConsentStatus = 'unset' | 'granted' | 'declined'

export interface CoachingConsentRecord {
  status: CoachingConsentStatus
  decidedAt: string | null
  policyVersion: string | null
}

/** Core's authenticated consent API; no staff identity is accepted from the UI. */
export interface CoachingConsentDecision {
  id: string
  status: 'granted' | 'declined'
  policy_version: string
  decided_at: string
}
export interface CoachingConsentState {
  current_policy_version: string
  status: CoachingConsentStatus
  decision: CoachingConsentDecision | null
}
export type ConsentResult<T> = { ok: true; data: T } | { ok: false; error: 'failed' | 'policyChanged' }
