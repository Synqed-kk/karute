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
import { AppApiError, describeUnknownThrow } from '@/lib/app-api/errors'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'

jest.mock('@/lib/staff', () => ({ businessIdForUser: jest.fn(async () => 'business-1') }))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view'])),
}))
// Wraps the REAL describeUnknownThrow by default (every existing test below
// gets its real behavior unchanged) — only the m4 mutant test below swaps in
// a throwing implementation for ONE call, to test logFacadeError's OWN
// try/catch (fix round 2, MUST-1b) independent of errors.ts's own safety.
jest.mock('@/lib/app-api/errors', () => {
  const actual = jest.requireActual('@/lib/app-api/errors')
  return { ...actual, describeUnknownThrow: jest.fn(actual.describeUnknownThrow) }
})

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

  // PKT-A (incident-recording-fallback-20260918): an unclassified throw's
  // reason used to be unrecoverable — only code+status ever reached the log.
  it('an unclassified throw carrying a signed-URL secret logs a sanitised reason, never the secret — client body unchanged', async () => {
    const handler = facadeHandler(
      'customer.read',
      async () => {
        throw new Error('deepgram said no https://x.supabase.co/storage/v1/object/sign/recordings/a.webm?token=SECRET')
      },
      { config: HS_CONFIG },
    )
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await handler(new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }), route)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: { code: 'internal', message: 'Internal error' } })
      const lines = warn.mock.calls
        .map(([first]) => (typeof first === 'string' ? first : ''))
        .filter((l) => l.includes('"evt":"facade_error"'))
      expect(lines).toHaveLength(1)
      expect(lines[0]).not.toContain('SECRET')
      const line = JSON.parse(lines[0]) as Record<string, unknown>
      expect(line.errName).toBe('Error')
      expect(line.errMessage).toContain('deepgram said no')
    } finally {
      warn.mockRestore()
    }
  })

  it('a classified AppApiError throw logs NO errName/errMessage/errStatus keys — byte-identical to before', async () => {
    const handler = facadeHandler(
      'customer.read',
      async () => { throw new AppApiError('forbidden', 'nope') },
      { config: HS_CONFIG },
    )
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await handler(new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }), route)
      expect(res.status).toBe(403)
      const requestId = res.headers.get('request-id')
      const lines = warn.mock.calls
        .map(([first]) => (typeof first === 'string' ? first : ''))
        .filter((l) => l.includes('"evt":"facade_error"'))
      expect(lines).toHaveLength(1)
      const expectedLine = JSON.stringify({
        evt: 'facade_error',
        endpoint: 'customer.read',
        code: 'forbidden',
        status: 403,
        requestId,
        appVersion: null,
        platform: null,
        businessId: 'business-1',
      })
      expect(lines[0]).toBe(expectedLine)
    } finally {
      warn.mockRestore()
    }
  })

  // Fix round 2, MUST-1: a hostile thrown shape must never make the request
  // promise reject — it must still answer 500 Internal error, with the log
  // degrading (or masking) rather than the response breaking.
  it('every MUST-1 hostile thrown shape still answers 500 through the real handler, with exactly one parseable warn line', async () => {
    const hostileShapes: Array<() => unknown> = [
      () => {
        const e = new Error('placeholder')
        Object.defineProperty(e, 'message', { get() { throw new Error('boom') } })
        return e
      },
      () => ({ toString() { throw new Error('boom') } }),
      () => {
        const e = new Error('fine')
        Object.defineProperty(e, 'status', { get() { throw new Error('boom') } })
        return e
      },
      () => Object.assign(new Error('fine'), { name: BigInt(1) as unknown as string }),
    ]
    for (const makeHostile of hostileShapes) {
      const handler = facadeHandler('customer.read', async () => { throw makeHostile() }, { config: HS_CONFIG })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const res = await handler(
          new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }),
          route,
        )
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: { code: 'internal', message: 'Internal error' } })
        const lines = warn.mock.calls
          .map(([first]) => (typeof first === 'string' ? first : ''))
          .filter((l) => l.includes('"evt":"facade_error"'))
        expect(lines).toHaveLength(1)
        expect(() => JSON.parse(lines[0])).not.toThrow()
      } finally {
        warn.mockRestore()
      }
    }
  })

  // Fix round 2, MUST-1b (mutant m4 target): decoupled from errors.ts's own
  // correctness — mock describeUnknownThrow itself to throw, and prove
  // logFacadeError's OWN try/catch still protects the response.
  it("logFacadeError's own try/catch protects the response even if describeUnknownThrow itself throws", async () => {
    const spy = describeUnknownThrow as jest.Mock
    spy.mockImplementationOnce(() => {
      throw new Error('mock describeUnknownThrow failure')
    })
    const handler = facadeHandler('customer.read', async () => { throw new Error('deepgram said no') }, { config: HS_CONFIG })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await handler(new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }), route)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: { code: 'internal', message: 'Internal error' } })
      const lines = warn.mock.calls
        .map(([first]) => (typeof first === 'string' ? first : ''))
        .filter((l) => l.includes('"evt":"facade_error"'))
      expect(lines).toHaveLength(1)
      const line = JSON.parse(lines[0]) as Record<string, unknown>
      // Fallback line (MUST-1b's "ORIGINAL pre-change line") — no enrichment keys.
      expect('errName' in line).toBe(false)
      expect('errMessage' in line).toBe(false)
      expect('errStatus' in line).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })
})
