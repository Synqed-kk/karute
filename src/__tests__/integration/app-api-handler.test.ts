// Facade handler wrapper (packet 03 points 5,6,10). Proves the jwks_unavailable
// → 503 mapping THROUGH the handler (an upstream JWKS outage must not read as a
// 401), the OPTIONS preflight short-circuit, request-id echo, and 403 for a
// handler that rejects on capability.
// resolveBearerIdentity eagerly builds defaultGetUser() (revocation client)
// even when deps.config is injected — it needs the anon key or throws 'config',
// which turns every assertion here into a 500. Local runs always pass because
// next/jest loads .env; CI has no .env, so default it like the sibling
// app-api-* suites do.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'

jest.mock('@/lib/staff', () => ({ businessIdForUser: jest.fn(async () => 'business-1') }))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view'])),
}))

const ISSUER = 'https://testproj.supabase.co/auth/v1'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const route = { params: Promise.resolve({}) }

function hs256Token(secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'u1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

// RS256 token whose JWKS fetch will FAIL → jwks_unavailable.
function rs256Token() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })
  const payload = b64({ sub: 'u1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = cryptoSign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  return { token: `${header}.${payload}.${sig}`, publicKey }
}

const SECRET = 'test-jwt-secret-do-not-use-in-prod'
const HS_CONFIG: VerifierConfig = { issuer: ISSUER, audience: 'authenticated', hs256Secret: SECRET, algorithms: ['HS256'] }

describe('facadeHandler', () => {
  it('OPTIONS preflight short-circuits BEFORE auth (no token needed)', async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { ok: true }))
    const res = await handler(new Request('https://s/api/app/v1/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), route)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
  })

  it('maps an upstream JWKS outage → 503 (NOT 401)', async () => {
    const { token } = rs256Token()
    const jwksFetch = jest.fn(() => Promise.reject(new Error('JWKS host down')))
    const config: VerifierConfig = { issuer: ISSUER, audience: 'authenticated', jwksUri: 'https://testproj.supabase.co/auth/v1/.well-known/jwks.json', algorithms: ['RS256'], jwksFetch }
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { ok: true }), { config })
    const res = await handler(new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${token}` } }), route)
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('jwks_unavailable')
  })

  it('mints its OWN request-id and applies CORS on a success response — a client-supplied header is never echoed back (contract §7 / PR-M5 piece ③)', async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    const res = await handler(
      new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}`, origin: 'capacitor://localhost', 'request-id': 'req-abc' } }),
      route,
    )
    expect(res.status).toBe(200)
    // Never the (possibly forged) client value...
    expect(res.headers.get('request-id')).not.toBe('req-abc')
    // ...but a real minted id (UUID by default on this runtime).
    expect(res.headers.get('request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
  })

  it('with NO client request-id header, still mints its own (unchanged behavior)', async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    const res = await handler(
      new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }),
      route,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('maps a capability rejection in the handler body → 403', async () => {
    const handler = facadeHandler(
      'customer.read',
      async () => { throw new AppApiError('forbidden', 'nope') },
      { config: HS_CONFIG },
    )
    const res = await handler(new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
  })

  it('rejects a bad-signature token → 401 unauthenticated', async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, {}), { config: HS_CONFIG })
    const res = await handler(new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token('wrong-secret')}` } }), route)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('unauthenticated')
  })
})
