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

// The other two ECMAScript LineTerminator characters besides \r\n — LINE
// SEPARATOR (U+2028) and PARAGRAPH SEPARATOR (U+2029). Built via
// String.fromCharCode rather than a \u-escape literal (source-encoding
// safety, not a functional requirement).
const LINE_TERMINATOR_RE = new RegExp(`[\r\n${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`)

/** Sanitised, bounded one-line description of an unclassified thrown value —
 *  read only by `logFacadeError` (handler.ts), never by `errorBody`. Never the
 *  stack, never `cause.cause`. TOTAL (fix round 2, MUST-1a): every property
 *  read/coercion below sits inside ONE try — a hostile shape (a throwing
 *  `message`/`status` getter, a throwing `toString`, a non-string `name` that
 *  would break `JSON.stringify`) can never escape this function; it degrades
 *  to `{errName:'unformattable', errMessage:''}` instead. `errName`/
 *  `errMessage` are only ever a value already confirmed `typeof === 'string'`
 *  — never a raw coercion of the hostile input itself. */
export function describeUnknownThrow(err: unknown): { errName: string; errStatus?: number; errMessage: string } {
  try {
    const rawName = err instanceof Error ? err.name : typeof err
    const errName = capWithEllipsis(maskSensitive(typeof rawName === 'string' ? rawName : typeof err), 60)

    const rawMessage = err instanceof Error ? err.message : String(err)
    const message = typeof rawMessage === 'string' ? rawMessage : ''
    // Line boundary = any ECMAScript LineTerminator (LF, CR, LS, PS) — not
    // just `\n`: a bare `\r` used to survive into "the first line" and then
    // get flattened to a space by the whitespace-collapse below, leaking
    // whatever followed it (fix round 2 SHOULD).
    const lineEnd = message.search(LINE_TERMINATOR_RE)
    const firstLine = lineEnd === -1 ? message : message.slice(0, lineEnd)
    // Bound BEFORE masking (fix round 2, MUST-2): keeps every regex below
    // operating on at most 2000 chars regardless of the original message
    // size. `preBound` trims back to the last whitespace so a secret split
    // by THIS bound is discarded rather than left half-exposed.
    const bounded = preBound(firstLine).replace(/\s+/g, ' ').trim()
    const masked = maskSensitive(bounded)
    const errMessage = capWithEllipsis(masked, 200)

    const rawStatus = (err as { status?: unknown } | null)?.status
    const errStatus = typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : undefined

    return errStatus === undefined ? { errName, errMessage } : { errName, errStatus, errMessage }
  } catch {
    return { errName: 'unformattable', errMessage: '' }
  }
}

function capWithEllipsis(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Defense-in-depth against a huge thrown message (perf, fix round 2,
 *  MUST-2): bound to 2000 chars BEFORE any masking regex runs. If the cut
 *  lands mid-token, trim back to the last whitespace char (found by scanning
 *  backward — cheap, bounded to 2000 steps); no whitespace in the first 2000
 *  chars → keep the 2000 and let the masks + the final 200-char cap handle it. */
function preBound(firstLine: string): string {
  if (firstLine.length <= 2000) return firstLine
  const cut = firstLine.slice(0, 2000)
  for (let i = cut.length - 1; i >= 0; i--) {
    if (/\s/.test(cut[i])) return cut.slice(0, i)
  }
  return cut
}

// A canonical UUID (8-4-4-4-12 hex) is exempt from the blob rule below — ids
// are already on the log line via other fields, and a UUID's hyphens don't
// break a blob-charset run the way they'd need to for the rule to skip it
// on its own.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Masking order (fix round 2): URL (origin+path, query stripped — a
 *  case-insensitive scheme) → Bearer token → labelled credentials
 *  (token/apikey/api_key/key/secret/password/authorization = value — this
 *  also catches a secret embedded in a URL PATH, which the URL step above
 *  only strips the QUERY of) → JWT → email (bounded quantifiers — no
 *  nested/overlapping-quantifier ambiguity, paired with `preBound` above) →
 *  opaque 32+-char blobs (base64 / API keys; a canonical UUID is exempt) →
 *  7+-digit runs (phone/card-like strings).
 *
 *  Fix round 3: the labelled-credential pattern has no leading `\b` so
 *  prefixed/camelCase names (access_token, clientSecret) are caught as
 *  substrings too; this accepts over-masking an innocent word that merely
 *  ends in a label (e.g. `monkey: banana`).
 *
 *  The blob charset deliberately drops `/` from the base64 alphabet
 *  (`+/_=-`) despite it being a legal base64 char: a URL's kept origin+path
 *  (the step right above) is itself very often a 32+-char run of letters,
 *  digits and `/` between dots, and matching against it there re-mangled an
 *  already-correctly-masked URL into fragments (found empirically running
 *  the pinned URL test in fix round 2). Base64url secrets — the far more
 *  common real-world shape, precisely because it's URL-safe — use `-`/`_`
 *  instead of `+`/`/` and are unaffected. */
function maskSensitive(s: string): string {
  let out = s.replace(/https?:\/\/\S+/gi, (m) => {
    try {
      const u = new URL(m)
      return u.origin + u.pathname
    } catch {
      return '<url>'
    }
  })
  out = out.replace(/\bBearer\s+\S+/gi, 'Bearer <token>')
  out = out.replace(
    /(?:token|apikey|api_key|key|secret|password|authorization)\s*[:=]\s*['"]?[^\s&'"]+/gi,
    '<label>=<redacted>',
  )
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<jwt>')
  out = out.replace(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g, '<email>')
  out = out.replace(/[A-Za-z0-9+_=-]{32,}/g, (m) => (UUID_RE.test(m) ? m : '<blob>'))
  out = out.replace(/\d{7,}/g, '<digits>')
  return out
}

/** The stable JSON body shape for every facade error response. */
export function errorBody(err: AppApiError): { error: { code: AppApiErrorCode; message: string } & Record<string, unknown> } {
  return { error: { code: err.code, message: err.message, ...(err.detail ?? {}) } }
}
