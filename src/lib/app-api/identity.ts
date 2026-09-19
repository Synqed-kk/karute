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
import { actorIsUnassigned } from '@/lib/auth/store-gate'
import type { Capability } from '@/lib/auth/permissions'
import { AppApiError } from './errors'

export interface RequestIdentity {
  /** Supabase auth user UUID (the JWT `sub`) — and, for a PLACED member, the
   *  same id the core roster carries as its staff `id`: resolveSelfStaffId
   *  compares them directly (app-api/customer-facade.ts:99), as do
   *  getCurrentUserStaffId (lib/staff.ts:263) and isRosterOwner
   *  (actions/stores.ts:33). A caller the roster cannot place is refused where
   *  it matters — viewerAllowedStoreIds returns [] (app-api/store-clamp.ts). */
  authUserId: string
  /** The tenant boundary — every downstream read/write is scoped to it. */
  businessId: string
  /** Effective RBAC capability set for this caller. */
  capabilities: Set<Capability>
  /** How identity was established. */
  via: 'bearer' | 'cookie'
  /** ⚖ Liam 2026-09-16: this caller is a staff member of a multi-store
   *  business whom nobody has assigned to a store yet. `capabilities` is
   *  EMPTY whenever this is true (the gate's one truth, capabilitiesForUser),
   *  and facadeHandler refuses every endpoint with `store_unassigned` so the
   *  shell shows the honest screen instead of a wall of 403 forbiddens. */
  unassigned: boolean
  /** The Bearer token's own `email` claim (BearerClaims.email), or null when
   *  absent — the facade's parity source for the web page's
   *  supabase.auth.getUser().email (no cookie session to read a user object
   *  from on this path). ADDITIVE: every other field/behavior unchanged. */
  email: string | null
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

  // businessId from the VERIFIED token — never the cookie session, which on
  // this transport would resolve another tenant's stores (see the gate's note
  // in unassignedForUser).
  const capabilities = await capabilitiesForUser(authUserId, { businessId })
  return {
    authUserId,
    businessId,
    capabilities,
    // ⚠ THE FRONT GATE READS THE VERDICT ITSELF — it does NOT test
    // `capabilities.size === 0` first. That short-circuit was here as a
    // performance win, and it made Layer 2 inherit Layer 1's correctness
    // instead of standing beside it: remove the capability-emptying line and
    // BOTH front gates silently stopped firing while 641 of 642 suites stayed
    // green (fresh-eyes M2/F4, 2026-09-16).
    //
    // What IS still read first is `stores.viewAll`, and that is not the same
    // thing: it is an INPUT to the verdict (a cross-store role's assignment is
    // never consulted by any layer), not the gate's own OUTPUT. Emptying the
    // set never touches it — the gate only empties for non-viewAll actors — so
    // the mutant above still trips this line. It also keeps the owner's every
    // request free of an assignment lookup.
    unassigned: capabilities.has('stores.viewAll')
      ? false
      : await actorIsUnassigned(authUserId, businessId),
    via: 'bearer',
    email: resolved.claims.email ?? null,
  }
}
