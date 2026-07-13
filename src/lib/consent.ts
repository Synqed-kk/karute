// Recording-consent policy version + the current-version check.
//
// Client-safe (a PLAIN module, not a 'use server' file) so the recording gate
// (client components) and the server actions share ONE source of truth for the
// version constant.

export const RECORDING_CONSENT_POLICY_VERSION = 'v1-2026-05'

/**
 * A consent is valid for recording only if it EXISTS *and* was granted under
 * the CURRENT policy version. Bumping RECORDING_CONSENT_POLICY_VERSION (new
 * wording / modality / business type — the legal-invalidation lever) must
 * re-block recording until the customer re-consents.
 *
 * synqed's getConsent returns the latest non-revoked row regardless of version,
 * so checking `!!row` alone treats a stale consent as valid. This comparison is
 * what actually enforces the invalidation.
 */
export function isConsentCurrent(
  consent: { policy_version?: string | null } | null | undefined,
): boolean {
  return (
    !!consent && consent.policy_version === RECORDING_CONSENT_POLICY_VERSION
  )
}

/**
 * The server-side save gate's rejection message (both karute save actions).
 * Lives here (plain module) because 'use server' files may only export async
 * functions — and the review screen matches on it to open the consent flow
 * instead of a dead-end toast when a save is refused.
 */
export const CONSENT_REQUIRED_ERROR =
  '保存には顧客の録音同意（現行バージョン）が必要です'
