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
  | 'no_audio' // 404 — the server holds no audio for this recording (distinct from not_found so the phone can say which; a detail.reason never crosses the thin port)
  | 'conflict' // 409 — If-Match / optimistic-concurrency mismatch
  | 'not_returning' // 422 — the revisit label cannot be true for this customer (a fact about the customer, not the request's shape)
  | 'rate_limited' // 429 — throttled (e.g. PIN attempts)
  | 'not_implemented' // 501 — a valid-but-unwired param combo (export scope/format)
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
  no_audio: 404,
  conflict: 409,
  not_returning: 422,
  rate_limited: 429,
  not_implemented: 501,
  jwks_unavailable: 503,
  upstream_unavailable: 502,
  config: 500,
  internal: 500,
}

export class AppApiError extends Error {
  code: AppApiErrorCode
  /** Optional machine-readable extras merged into the JSON body (never secrets). */
  detail?: Record<string, unknown>
  /** The original thrown value, when this wraps an unclassified throw
   *  (`toAppApiError`'s unknown arm). Standard `Error` `cause` — non-enumerable,
   *  dropped by `JSON.stringify` — so `errorBody` and the client response never
   *  see it; only `logFacadeError` (handler.ts) reads it, via `describeUnknownThrow`
   *  below, for the server log. */
  constructor(code: AppApiErrorCode, message: string, detail?: Record<string, unknown>, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
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
  // Unknown throw: never leak internals to the CLIENT body — but keep the
  // original value as a non-enumerable `cause` so the SERVER log can still
  // say why (logFacadeError, handler.ts, via describeUnknownThrow below).
  return new AppApiError('internal', 'Internal error', undefined, err)
}

/** Sanitised, bounded one-line description of an unclassified thrown value —
 *  read only by `logFacadeError` (handler.ts), never by `errorBody`. Never the
 *  stack, never `cause.cause`. Pure — never throws on any input shape. */
export function describeUnknownThrow(err: unknown): { errName: string; errStatus?: number; errMessage: string } {
  const errName = err instanceof Error ? err.name : typeof err
  const raw = err instanceof Error ? err.message : String(err)
  const firstLine = raw.split('\n')[0].replace(/\s+/g, ' ').trim()
  const capped = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine
  const errMessage = maskSensitive(capped)
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? { errName, errStatus: status, errMessage } : { errName, errMessage }
}

/** Masking order matters: email → URL (origin+path, query stripped — signed-URL
 *  tokens live in the query) → JWT → 7+-digit runs (phone/card-like strings).
 *  UUIDs are left alone — ids are already on the log line via other fields. */
function maskSensitive(s: string): string {
  let out = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
  out = out.replace(/https?:\/\/\S+/g, (m) => {
    try {
      const u = new URL(m)
      return u.origin + u.pathname
    } catch {
      return '<url>'
    }
  })
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<jwt>')
  out = out.replace(/\d{7,}/g, '<digits>')
  return out
}

/** The stable JSON body shape for every facade error response. */
export function errorBody(err: AppApiError): { error: { code: AppApiErrorCode; message: string } & Record<string, unknown> } {
  return { error: { code: err.code, message: err.message, ...(err.detail ?? {}) } }
}
