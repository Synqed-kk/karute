// `resolveIdentity` — THE single seam (PLAN §5, packet point 1).
//
// ONE place turns a request into a caller identity, from EITHER a cookie jar
// (web) OR an `Authorization: Bearer` header (facade), and routes BOTH through
// the identical downstream business-id + capability resolution. The facade arm
// is BEARER-ONLY: a cookie present on a facade request is IGNORED, never used as
// identity — accepting both credentials on one endpoint is a CSRF /
// credential-precedence hole (CORS is not CSRF protection).
//
// The Bearer path uses packet 01's standards-compliant verifier + revocation
// resolver, NOT local-jwt trust.

import { createClient } from '@supabase/supabase-js'
import {
  verifierConfigFromEnv,
  type VerifierConfig,
} from '@/lib/auth/verify-bearer'
import {
  resolveFacadeIdentity,
  type GetUserFn,
} from '@/lib/auth/revocation'
import { businessIdForUser } from '@/lib/staff'
import { capabilitiesForUser } from '@/lib/auth/require-permission'
import type { Capability } from '@/lib/auth/permissions'
import { AppApiError } from './errors'

export interface RequestIdentity {
  /** Supabase auth user UUID (the JWT `sub`). Distinct from a synqed staff id. */
  authUserId: string
  /** The tenant boundary — every downstream read/write is scoped to it. */
  businessId: string
  /** Effective RBAC capability set for this caller. */
  capabilities: Set<Capability>
  /** How identity was established. */
  via: 'bearer' | 'cookie'
}

/** Extract the raw Bearer token, or throw `unauthenticated`. A cookie on this
 *  request is deliberately NOT consulted. */
export function extractBearer(req: { headers: Headers }): string {
  const auth = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  if (!m || !m[1].trim()) {
    throw new AppApiError('unauthenticated', 'Missing or malformed Authorization: Bearer header')
  }
  return m[1].trim()
}

/** Real getUser round-trip against GoTrue for revocation-sensitive endpoints.
 *  Uses the anon key + the caller's own token (NOT service role) so GoTrue
 *  confirms the token is still valid server-side. Adapts supabase's shape per
 *  revocation.ts's contract. */
function defaultGetUser(): GetUserFn {
  const url = process.env.AUTH_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new AppApiError('config', 'Supabase URL / anon key required for revocation checks')
  }
  const client = createClient(url, anon)
  return (token) =>
    client.auth.getUser(token).then(({ data, error }) =>
      error || !data.user ? null : { id: data.user.id },
    )
}

/**
 * Resolve a FACADE (Bearer) request into an identity. `endpoint` selects the
 * revocation policy (packet 01: staff CRUD / PIN / permissions / export
 * re-verify via getUser; other reads take the local fast-path). Tenancy +
 * capabilities are then resolved from the CONFIRMED auth-user id — never from
 * client-supplied fields.
 */
export async function resolveBearerIdentity(
  req: { headers: Headers },
  endpoint: string,
  deps: { config?: VerifierConfig; getUser?: GetUserFn } = {},
): Promise<RequestIdentity> {
  const token = extractBearer(req)
  const config = deps.config ?? verifierConfigFromEnv()
  const getUser = deps.getUser ?? defaultGetUser()

  const resolved = await resolveFacadeIdentity({ token, endpoint, config, getUser })
  const authUserId = resolved.userId

  // businessIdForUser IS the membership gate AND classifies its own failures:
  // an absent profile row → membership_inactive (403, fail-closed); a transient
  // lookup/connection failure → upstream_unavailable (502). Preserve that
  // classification. Only a truly unexpected throw (e.g. a network reject that
  // never became an AppApiError) falls through as internal — NEVER a false 403
  // that reads to the client as "you were removed".
  let businessId: string
  try {
    businessId = await businessIdForUser(authUserId)
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('internal', 'Business membership resolution failed')
  }

  const capabilities = await capabilitiesForUser(authUserId)
  return { authUserId, businessId, capabilities, via: 'bearer' }
}
