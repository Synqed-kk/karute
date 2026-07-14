import { verifyBearer, type BearerClaims, type VerifierConfig } from './verify-bearer'

// Revocation-lag bound for the mobile Bearer path (PLAN §4, high severity).
//
// PROBLEM: a persistent mobile Bearer token skips web's ~1h cookie-refresh
// revocation window, so a purely-local verify lets a terminated staffer / lost
// device keep working until the refresh-token lifetime ends. UNACCEPTABLE for
// security-sensitive operations (staff CRUD, PIN, permissions, export).
//
// RULE: security-sensitive facade endpoints do a REAL supabase.auth.getUser()
// round-trip (GoTrue confirms the user is still valid server-side). Non-sensitive
// reads keep the local fast-path (signature/iss/aud/exp only). The endpoint list
// is a constant the BFF (packet 03) imports so classification lives in ONE place.

/**
 * Facade endpoint keys that MUST NOT trust the local fast-path. These map to the
 * operations PLAN §4 names: staff CRUD, PIN, permissions, and data export. The
 * BFF's route table (packet 03) references these keys; keep it the single source
 * of truth for "does this call re-check revocation".
 */
export const REVOCATION_SENSITIVE_ENDPOINTS = new Set<string>([
  // staff CRUD
  'staff.create',
  'staff.update',
  'staff.delete',
  // PIN
  'staff.setPin',
  'staff.removePin',
  'staff.verifyPin',
  // permissions
  'permissions.update',
  'orgSettings.update',
  // export
  'export',
  // facade resource WRITES — as a rule every facade mutation re-checks
  // revocation, so a just-terminated staffer cannot edit data (e.g. customer PII)
  // on the local fast-path until token expiry. Cost = one getUser per edit
  // (writes are infrequent — acceptable for a fail-closed foundation).
  'customer.update',
  // customer-profile mutations (packet 06 batch 3 — the highest customer-data
  // class). EVERY write re-checks revocation; the follow-up-e exhaustive test
  // (app-api-revocation-coverage.test.ts) fails if any facade write method ships
  // a key that is not in this set.
  'customer.consent.revoke',
  'customer.photo.upload',
  'customer.memory.add',
  'customer.memory.update',
  'customer.memory.delete',
  'customer.memory.relearn',
  'customer.passport.upsert',
  'customer.pack.create',
  'customer.pack.redeem',
  'customer.lifecycle.set',
  // session-detail mutations (packet 07 batch 4 — recording-privacy + AI-on-PII).
  // regenerate reads the raw transcript + runs the LLM; outcome upserts the
  // coaching label. Both re-check revocation (no local fast-path).
  'karute.regenerate',
  'karute.outcome.set',
  // recording-flow mutations (packet 08 batch 5 — customer VOICE data). Consent
  // grant, the recording-session mint, and the signed-upload-url mint are all
  // non-GET facade writes → they re-check revocation (no local fast-path) so a
  // just-terminated staffer cannot grant consent, mint sessions, or stage audio.
  // upload-url mints no durable state but is a POST, so it re-checks too (the
  // "every facade mutation re-checks revocation" rule; the coverage test enforces it).
  'customer.consent.grant',
  'recordings.session.mint',
  'recordings.uploadUrl',
])

/** True when `endpoint` must re-verify revocation via a server round-trip. */
export function requiresRevocationCheck(endpoint: string): boolean {
  return REVOCATION_SENSITIVE_ENDPOINTS.has(endpoint)
}

export type ResolvedIdentity = {
  /** Supabase auth user UUID (the `sub` claim / getUser id). */
  userId: string
  /** How identity was established for this request. */
  via: 'local' | 'server'
  claims: BearerClaims
}

export class RevocationError extends Error {
  code = 'revoked' as const
  constructor(message: string) {
    super(message)
    this.name = 'RevocationError'
  }
}

/**
 * getUser round-trip signature. In the BFF, ADAPT supabase's response shape —
 * it is NOT `supabase.auth.getUser` directly (that resolves
 * `{ data: { user }, error }`, always a truthy object, so a naive `!user` check
 * would never fire and `.id` would be undefined). Wire it as:
 *   (token) => supabase.auth.getUser(token).then(({ data, error }) =>
 *     error || !data.user ? null : { id: data.user.id })
 * Injected here so the resolver is testable without network. Returns the
 * confirmed user, or null/throws when the token has been revoked server-side.
 */
export type GetUserFn = (
  token: string,
) => Promise<{ id: string } | null>

/**
 * Resolve the caller's identity for a facade request.
 *
 *  - Always verify the Bearer token locally first (signature/iss/aud/exp). A
 *    token that fails here never reaches the network — cheap rejection.
 *  - For a revocation-sensitive endpoint, ALSO round-trip getUser(); a
 *    revoked/deleted user (null / thrown) is rejected even though the signature
 *    is still valid and unexpired.
 *  - A getUser id that disagrees with the token subject is rejected (the token
 *    must belong to the confirmed user).
 */
export async function resolveFacadeIdentity(args: {
  token: string
  endpoint: string
  config: VerifierConfig
  getUser: GetUserFn
}): Promise<ResolvedIdentity> {
  const { token, endpoint, config, getUser } = args

  const claims = await verifyBearer(token, config)

  if (!requiresRevocationCheck(endpoint)) {
    return { userId: claims.sub, via: 'local', claims }
  }

  let user: { id: string } | null
  try {
    user = await getUser(token)
  } catch (err) {
    throw new RevocationError(
      `revocation check failed for ${endpoint}: ${(err as Error).message}`,
    )
  }
  if (!user) {
    throw new RevocationError(`token revoked or user missing for ${endpoint}`)
  }
  if (user.id !== claims.sub) {
    throw new RevocationError('getUser id does not match token subject')
  }
  return { userId: user.id, via: 'server', claims }
}
