import {
  createHmac,
  timingSafeEqual,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto'

// Standards-compliant Bearer verifier for the mobile bundle → facade (BFF) path.
//
// WHY THIS EXISTS (do not fold back into local-jwt.ts):
//   local-jwt.ts checks HMAC + expiry + subject ONLY — no issuer, no audience,
//   and it ignores the JWT header so it cannot verify a token from a different
//   project or an asymmetric key. The auth cutover (project jdbsqvlfwsmzfmisuwmw)
//   makes cross-project / rotated-key tokens a real possibility, so the facade
//   MUST NOT trust local-jwt for Bearer requests. This module is that stricter
//   verifier: issuer + audience + signature, with an alg allow-list.
//
// CONFIG IS PARAMETERIZED (PLAN §4/§6): issuer is derived from the auth Supabase
// URL, never a hardcoded project. A missing required var fails LOUD (no default).
//
// HS256 (symmetric) is TODAY's live setup — verified in-process with node:crypto.
// RS256/ES256 via JWKS (with key rotation) is the forward path for when Supabase
// rotates to signing keys; the actual signature check uses node:crypto's native
// JWK import (Node 18+), and the ONLY bespoke plumbing is JWKS fetch + kid
// selection + refetch-on-unknown-kid (= rotation). ponytail: HS256 is the only
// path exercised against the live project today; the asymmetric branch is proven
// with a locally-generated keypair test, not a live asymmetric project.

export interface BearerClaims {
  sub: string
  email?: string
  role?: string
  iss: string
  aud: string | string[]
  exp: number
  iat?: number
  nbf?: number
}

export type BearerErrorCode =
  | 'malformed'
  | 'unsupported_alg'
  | 'signature'
  | 'expired'
  | 'not_yet_valid'
  | 'issuer'
  | 'audience'
  | 'claims'
  | 'config'
  // The verifier could not CHECK the token (JWKS endpoint down / unusable key).
  // The facade must map this to 503, never 401 — an upstream outage is not a
  // statement about the token.
  | 'jwks_unavailable'

export class BearerVerifyError extends Error {
  code: BearerErrorCode
  constructor(code: BearerErrorCode, message: string) {
    super(message)
    this.name = 'BearerVerifyError'
    this.code = code
  }
}

type JsonFetch = (uri: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface VerifierConfig {
  /** Expected `iss`, e.g. https://<project>.supabase.co/auth/v1 */
  issuer: string
  /** Expected `aud`, e.g. 'authenticated' */
  audience: string
  /** HS256 shared secret (Supabase JWT secret). Required to accept HS256. */
  hs256Secret?: string
  /** JWKS endpoint for asymmetric verification + key rotation. */
  jwksUri?: string
  /** Algorithm allow-list. Anything outside it is rejected (blocks `none` and
   *  alg-confusion). Defaults to what the config can actually verify. */
  algorithms?: string[]
  /** Clock-skew tolerance in seconds. Default 0. */
  clockToleranceSec?: number
  /** JWKS fetcher, injectable for tests. Defaults to global fetch. */
  jwksFetch?: JsonFetch
}

const ASYMMETRIC_ALGS = new Set(['RS256', 'ES256'])

function b64urlToBuffer(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function decodeSegment(seg: string): Record<string, unknown> {
  try {
    return JSON.parse(b64urlToBuffer(seg).toString('utf8'))
  } catch {
    throw new BearerVerifyError('malformed', 'segment is not valid JSON')
  }
}

/** Algorithms a given config is *able* to verify — the effective allow-list
 *  when the caller does not pin one explicitly. */
function defaultAlgorithms(config: VerifierConfig): string[] {
  const algs: string[] = []
  if (config.hs256Secret) algs.push('HS256')
  if (config.jwksUri) algs.push('RS256', 'ES256')
  return algs
}

function assertRegisteredClaims(
  claims: BearerClaims,
  config: VerifierConfig,
): void {
  const skew = config.clockToleranceSec ?? 0
  const now = Math.floor(Date.now() / 1000)

  if (typeof claims.exp !== 'number') {
    throw new BearerVerifyError('claims', 'missing exp claim')
  }
  if (claims.exp + skew <= now) {
    throw new BearerVerifyError('expired', 'token expired')
  }
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) {
    throw new BearerVerifyError('not_yet_valid', 'token not yet valid')
  }
  if (!claims.sub) {
    throw new BearerVerifyError('claims', 'missing sub claim')
  }
  if (claims.iss !== config.issuer) {
    throw new BearerVerifyError('issuer', 'unexpected issuer')
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(config.audience)) {
    throw new BearerVerifyError('audience', 'unexpected audience')
  }
}

// --- JWKS resolution (asymmetric path) -------------------------------------

type Jwk = { kid?: string; kty: string; alg?: string; [k: string]: unknown }

/** Cache freshness: entries older than the TTL are refetched even on a kid hit,
 *  so a key removed upstream stops being trusted within one TTL. */
const JWKS_TTL_MS = 10 * 60_000
/** Minimum gap between kid-miss refetches per URI, so a stream of tokens minted
 *  with arbitrary kids cannot turn auth requests into unbounded JWKS traffic. */
const JWKS_COOLDOWN_MS = 30_000

type JwksEntry = { keys: Jwk[]; fetchedAt: number }
const jwksCache = new Map<string, JwksEntry>()

/** Test seam: clear the module-level JWKS cache between cases. */
export function _resetJwksCache(): void {
  jwksCache.clear()
}

async function fetchJwks(uri: string, fetchImpl: JsonFetch): Promise<Jwk[]> {
  let res: Awaited<ReturnType<JsonFetch>>
  try {
    res = await fetchImpl(uri)
  } catch {
    throw new BearerVerifyError('jwks_unavailable', 'JWKS fetch failed')
  }
  if (!res.ok) {
    throw new BearerVerifyError('jwks_unavailable', `JWKS fetch failed: ${res.status}`)
  }
  let body: { keys?: Jwk[] }
  try {
    body = (await res.json()) as { keys?: Jwk[] }
  } catch {
    throw new BearerVerifyError('jwks_unavailable', 'JWKS response is not JSON')
  }
  if (!Array.isArray(body?.keys)) {
    throw new BearerVerifyError('jwks_unavailable', 'malformed JWKS response')
  }
  return body.keys
}

async function getSigningKey(
  uri: string,
  kid: string,
  fetchImpl: JsonFetch,
): Promise<Jwk> {
  const find = (keys?: Jwk[]) => keys?.find((k) => k.kid === kid)
  const nowMs = Date.now()
  const entry = jwksCache.get(uri)
  const age = entry ? nowMs - entry.fetchedAt : Infinity

  let jwk = age < JWKS_TTL_MS ? find(entry!.keys) : undefined
  if (!jwk && age >= JWKS_COOLDOWN_MS) {
    // Key rotation: an unknown kid (or a stale cache) triggers a JWKS refetch.
    // The cooldown bounds refetch traffic; the TTL bounds stale-key trust.
    const keys = await fetchJwks(uri, fetchImpl)
    jwksCache.set(uri, { keys, fetchedAt: nowMs })
    jwk = find(keys)
  }
  if (!jwk) {
    throw new BearerVerifyError('signature', `no JWKS key for kid ${kid}`)
  }
  return jwk
}

function verifyAsymmetric(
  signingInput: string,
  signature: Buffer,
  jwk: Jwk,
  alg: string,
): boolean {
  const key = createPublicKey({ key: jwk as never, format: 'jwk' })
  const data = Buffer.from(signingInput)
  if (alg === 'ES256') {
    // JWS EC signatures are raw R||S (IEEE P1363), not DER — node defaults to
    // DER for EC, so this MUST be set or every ES256 verify silently fails.
    return cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature)
  }
  // RS256: RSASSA-PKCS1-v1_5 with SHA-256 (node default padding).
  return cryptoVerify('sha256', data, key, signature)
}

/**
 * Verify a Supabase Bearer JWT: signature + issuer + audience + expiry, with an
 * algorithm allow-list. Returns the claims on success; throws BearerVerifyError
 * with a stable `code` on any failure — including `jwks_unavailable` when the
 * verifier itself could not check the token (facade: 503, not 401).
 *
 * This is signature/claims verification ONLY. It does NOT detect a token that
 * was revoked server-side before its `exp` — that is the revocation resolver's
 * job (see revocation.ts), which does a real getUser() round-trip for
 * security-sensitive endpoints.
 */
export async function verifyBearer(
  token: string,
  config: VerifierConfig,
): Promise<BearerClaims> {
  if (!config.issuer || !config.audience) {
    throw new BearerVerifyError('config', 'issuer and audience are required')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new BearerVerifyError('malformed', 'token must have three segments')
  }
  const [headerB64, payloadB64, signatureB64] = parts

  const header = decodeSegment(headerB64) as { alg?: string; kid?: string }
  const alg = header.alg
  if (!alg || alg === 'none') {
    throw new BearerVerifyError('unsupported_alg', 'missing or "none" alg')
  }

  const allow = config.algorithms ?? defaultAlgorithms(config)
  if (!allow.includes(alg)) {
    throw new BearerVerifyError('unsupported_alg', `alg ${alg} not allowed`)
  }

  const signingInput = `${headerB64}.${payloadB64}`
  const signature = b64urlToBuffer(signatureB64)

  if (alg === 'HS256') {
    if (!config.hs256Secret) {
      throw new BearerVerifyError('config', 'HS256 token but no secret configured')
    }
    const expected = createHmac('sha256', config.hs256Secret)
      .update(signingInput)
      .digest()
    if (
      expected.length !== signature.length ||
      !timingSafeEqual(expected, signature)
    ) {
      throw new BearerVerifyError('signature', 'HS256 signature mismatch')
    }
  } else if (ASYMMETRIC_ALGS.has(alg)) {
    if (!config.jwksUri) {
      throw new BearerVerifyError('config', 'asymmetric token but no JWKS URI')
    }
    if (!header.kid) {
      throw new BearerVerifyError('malformed', 'asymmetric token missing kid')
    }
    const jwk = await getSigningKey(config.jwksUri, header.kid, config.jwksFetch ?? (fetch as JsonFetch))
    let ok: boolean
    try {
      ok = verifyAsymmetric(signingInput, signature, jwk, alg)
    } catch {
      // The trusted endpoint served a key node:crypto cannot import — a
      // verifier-side failure, not a statement about the token.
      throw new BearerVerifyError('jwks_unavailable', 'JWKS key unusable for verification')
    }
    if (!ok) {
      throw new BearerVerifyError('signature', 'asymmetric signature mismatch')
    }
  } else {
    throw new BearerVerifyError('unsupported_alg', `alg ${alg} not supported`)
  }

  const claims = decodeSegment(payloadB64) as unknown as BearerClaims
  assertRegisteredClaims(claims, config)
  return claims
}

/**
 * Build a VerifierConfig from environment, deriving the issuer from the auth
 * Supabase URL so there is NO hardcoded project. Fails LOUD if the URL is
 * absent (PLAN §4: a missing var must not silently default to prod).
 *
 *   AUTH_SUPABASE_URL          → issuer + jwksUri (required)
 *   AUTH_SUPABASE_JWT_SECRET   → HS256 verification (required for today's setup)
 *   AUTH_JWT_AUDIENCE          → audience (default 'authenticated')
 */
export function verifierConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): VerifierConfig {
  const url = env.AUTH_SUPABASE_URL
  if (!url) {
    throw new BearerVerifyError(
      'config',
      'AUTH_SUPABASE_URL is required (no fallback default — set it explicitly)',
    )
  }
  const base = url.replace(/\/+$/, '')
  const issuer = `${base}/auth/v1`
  return {
    issuer,
    audience: env.AUTH_JWT_AUDIENCE || 'authenticated',
    hs256Secret: env.AUTH_SUPABASE_JWT_SECRET,
    jwksUri: `${issuer}/.well-known/jwks.json`,
  }
}
