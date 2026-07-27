// Contract §7 / PR-M5 pieces ③ + ⑤ (facade half). §7: the facade no longer
// trusts the client `request-id` header as the row's canonical id — the
// server always mints; the client's value (when sent) survives only as a
// correlation hint on the audit row's detail.client_request_id. §5/⑤:
// logFacadeAudit's outer catch used to swallow a production failure with
// nothing but the rethrow-skip — it now also gets a structured console line
// + a drop counter, mirroring audit.ts's forwardToCore catch.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

import { createHmac } from 'node:crypto'
import { facadeHandler, ok, getFacadeAuditDropCount, _resetFacadeAuditDropCount } from '@/lib/app-api/handler'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'
import { auditLines } from './helpers/audit-lines'

jest.mock('@/lib/staff', () => ({ businessIdForUser: jest.fn(async () => 'business-1') }))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view'])),
}))
// audit()'s durable sink lazy-imports this — mock it so a stray core-forward
// attempt (env vars possibly set by another test file sharing this worker)
// can never make a real network call. Same pattern as app-api-audit-log.test.ts.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))

const ISSUER = 'https://testproj.supabase.co/auth/v1'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

function hs256Token(secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'u1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const SECRET = 'test-jwt-secret-do-not-use-in-prod'
const HS_CONFIG: VerifierConfig = { issuer: ISSUER, audience: 'authenticated', hs256Secret: SECRET, algorithms: ['HS256'] }
const route = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) })

describe('facade requestId — server mints, client value survives as a correlation hint (piece ③)', () => {
  it("the audit row's requestId is the SERVER mint (matches the response header), and detail.client_request_id carries the client's header value", async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    let res!: Response
    const lines = await auditLines(async () => {
      res = await handler(
        new Request('https://s/api/app/v1/x', {
          headers: { authorization: `Bearer ${hs256Token(SECRET)}`, 'request-id': 'client-forged-id' },
        }),
        route({ id: 'c-9' }),
      )
    })
    const serverMint = res.headers.get('request-id')
    expect(serverMint).not.toBe('client-forged-id')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'customer.view',
      request_id: serverMint,
      detail: { client_request_id: 'client-forged-id' },
    })
  })

  it('an oversized client header is BOUNDED to 128 chars — untrusted input cannot balloon detail past the core cap (Greptile #634 r1)', async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    const huge = 'x'.repeat(8_000)
    const lines = await auditLines(async () => {
      await handler(
        new Request('https://s/api/app/v1/x', {
          headers: { authorization: `Bearer ${hs256Token(SECRET)}`, 'request-id': huge },
        }),
        route({ id: 'c-9' }),
      )
    })
    expect(lines).toHaveLength(1)
    const hint = (lines[0].detail as { client_request_id: string }).client_request_id
    expect(hint).toHaveLength(128)
    expect(hint).toBe(huge.slice(0, 128))
  })

  it('with no client header, the row carries the server-minted id and no client_request_id in detail', async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    let res!: Response
    const lines = await auditLines(async () => {
      res = await handler(
        new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }),
        route({ id: 'c-9' }),
      )
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].request_id).toBe(res.headers.get('request-id'))
    expect(lines[0].detail).toBeNull()
  })
})

describe('logFacadeAudit production failure — structured line + drop counter (piece ⑤)', () => {
  const prevNodeEnv = process.env.NODE_ENV
  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: prevNodeEnv, configurable: true })
  })

  it('production: a post-handler audit failure never breaks the response, logs facade_audit_error, and increments the drop counter', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
    _resetFacadeAuditDropCount()
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    // A rejecting params promise throws INSIDE logFacadeAudit's try (it
    // awaits route.params for the view row's targetId) — a forced failure
    // that has nothing to do with the unmapped-endpoint path CP6 already
    // covers.
    const brokenRoute = { params: Promise.reject(new Error('params blew up')) }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await handler(
      new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }),
      brokenRoute,
    )
    expect(res.status).toBe(200) // the response is never broken by an audit failure

    const parsed = warnSpy.mock.calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0]))
        } catch {
          return null
        }
      })
      .filter((j): j is Record<string, unknown> => !!j)
    warnSpy.mockRestore()

    expect(parsed).toContainEqual(
      expect.objectContaining({ evt: 'facade_audit_error', endpoint: 'customer.read' }),
    )
    expect(getFacadeAuditDropCount()).toBe(1)
  })

  it("dev/test: the same failure still rethrows (CP6's loud-while-building contract, unchanged) and does NOT increment the drop counter", async () => {
    _resetFacadeAuditDropCount()
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    const brokenRoute = { params: Promise.reject(new Error('params blew up')) }
    const res = await handler(
      new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } }),
      brokenRoute,
    )
    expect(res.status).toBe(500)
    expect(getFacadeAuditDropCount()).toBe(0)
  })
})
