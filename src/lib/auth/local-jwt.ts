import { createHmac, timingSafeEqual } from 'node:crypto'

// Local verification of a Supabase HS256 JWT. Skips the network round-trip
// to Supabase Auth that supabase.auth.getUser() makes on every request.
//
// Trade-off: a token that has been server-side revoked (banned/deleted user)
// continues to validate until its `exp` claim — typically 1 hour. For the
// karute use case this is acceptable; security-sensitive flows can still call
// supabase.auth.getUser() explicitly.

export interface SupabaseJwtClaims {
  sub: string // user uuid
  email?: string
  exp: number // seconds since epoch
  iat: number
  role?: string
  aud?: string
}

function base64UrlToBuffer(input: string): Buffer {
  // base64url → base64 (pad with =)
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export class LocalJwtError extends Error {}

/**
 * Verifies an HS256 JWT against the Supabase JWT secret and returns its claims.
 * Throws LocalJwtError if the token is malformed, signature is invalid, or
 * the token is expired.
 */
export function verifySupabaseJwt(
  token: string,
  secret: string,
): SupabaseJwtClaims {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new LocalJwtError('malformed token')
  }
  const [headerB64, payloadB64, signatureB64] = parts

  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest()
  const actual = base64UrlToBuffer(signatureB64)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new LocalJwtError('signature mismatch')
  }

  let claims: SupabaseJwtClaims
  try {
    claims = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf8'))
  } catch {
    throw new LocalJwtError('invalid payload json')
  }

  if (typeof claims.exp !== 'number') {
    throw new LocalJwtError('missing exp claim')
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (claims.exp <= nowSec) {
    throw new LocalJwtError('token expired')
  }
  if (!claims.sub) {
    throw new LocalJwtError('missing sub claim')
  }

  return claims
}
