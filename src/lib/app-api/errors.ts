// Classified error contract for the mobile facade (BFF). A service layer that
// THROWS classified errors (PLAN §5): today's web helpers swallow failures into
// `[]`/`null`, which a mobile cache would freeze as a false "empty salon". HTTP
// adapters must instead return a STABLE code the client can branch on, and an
// UPSTREAM outage (JWKS down) must be a retryable 5xx, never a 401 that tells the
// client "your token is bad" and triggers a re-login.

import { BearerVerifyError } from '@/lib/auth/verify-bearer'
import { RevocationError } from '@/lib/auth/revocation'

/** Stable, client-facing error codes. Additive-only — clients branch on these. */
export type AppApiErrorCode =
  | 'validation' // 400 — request body/params failed a schema
  | 'unauthenticated' // 401 — no/blank/invalid Bearer, or a bad-signature/expired token
  | 'revoked' // 401 — token was revoked server-side (getUser round-trip failed)
  | 'forbidden' // 403 — authenticated but lacks the capability
  | 'tenant_forbidden' // 403 — resource belongs to another business
  | 'store_forbidden' // 403 — store-id outside the caller's assignment/tenant
  | 'membership_inactive' // 403 — no active business membership for this user
  | 'not_found' // 404
  | 'conflict' // 409 — If-Match / optimistic-concurrency mismatch
  | 'rate_limited' // 429 — throttled (e.g. PIN attempts)
  | 'jwks_unavailable' // 503 — the verifier could not CHECK the token (upstream down)
  | 'upstream_unavailable' // 502 — synqed-core / dependency failed
  | 'config' // 500 — server misconfiguration (missing env)
  | 'internal' // 500 — unexpected

const STATUS: Record<AppApiErrorCode, number> = {
  validation: 400,
  unauthenticated: 401,
  revoked: 401,
  forbidden: 403,
  tenant_forbidden: 403,
  store_forbidden: 403,
  membership_inactive: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  jwks_unavailable: 503,
  upstream_unavailable: 502,
  config: 500,
  internal: 500,
}

export class AppApiError extends Error {
  code: AppApiErrorCode
  /** Optional machine-readable extras merged into the JSON body (never secrets). */
  detail?: Record<string, unknown>
  constructor(code: AppApiErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message)
    this.name = 'AppApiError'
    this.code = code
    this.detail = detail
  }
  get status(): number {
    return STATUS[this.code]
  }
}

// Bearer-verifier codes → facade codes. The load-bearing rule (packet 01 point
// 4): `jwks_unavailable` is an UPSTREAM outage → 503, NEVER 401. Every other
// verifier failure is a statement about the token → 401 (unauthenticated).
const BEARER_CODE_MAP: Record<string, AppApiErrorCode> = {
  jwks_unavailable: 'jwks_unavailable',
  config: 'config',
  malformed: 'unauthenticated',
  unsupported_alg: 'unauthenticated',
  signature: 'unauthenticated',
  expired: 'unauthenticated',
  not_yet_valid: 'unauthenticated',
  issuer: 'unauthenticated',
  audience: 'unauthenticated',
  claims: 'unauthenticated',
}

/** Normalize any thrown value into an AppApiError with a stable code. */
export function toAppApiError(err: unknown): AppApiError {
  if (err instanceof AppApiError) return err
  if (err instanceof BearerVerifyError) {
    const code = BEARER_CODE_MAP[err.code] ?? 'unauthenticated'
    return new AppApiError(code, err.message)
  }
  if (err instanceof RevocationError) {
    return new AppApiError('revoked', err.message)
  }
  // Unknown throw: never leak internals to the client body.
  return new AppApiError('internal', 'Internal error')
}

/** The stable JSON body shape for every facade error response. */
export function errorBody(err: AppApiError): { error: { code: AppApiErrorCode; message: string } & Record<string, unknown> } {
  return { error: { code: err.code, message: err.message, ...(err.detail ?? {}) } }
}
