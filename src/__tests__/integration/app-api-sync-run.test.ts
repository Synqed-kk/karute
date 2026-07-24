// 今すぐ同期 facade trigger (Liam ruling 7/24, packet 32). Mirrors web's
// /api/sync/quickreserve POST contract 1:1 through the facade: success spread
// + folded skipped, a friendly not-configured message (200, not a failure),
// any other upstream throw → 502. Gate: sync.view (owner always carries it —
// see the route's own comment). Same harness style as
// app-api-karute-save.test.ts: real facadeHandler + real ensureCapability +
// real FACADE_AUDIT_MAP, only the network edges (supabase getUser, staff,
// capabilities, synqed client, audit sink) mocked.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

import { createHmac } from 'node:crypto'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }) }))

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))

const capabilities = { current: new Set<string>(['sync.view']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const runNow = jest.fn(async () => ({
  date_window: { start: '2026-07-24T00:00:00.000Z', end: '2026-07-25T00:00:00.000Z' },
  total_fetched: 10,
  created: 2,
  updated: 3,
  cancelled: 1,
  skipped_no_staff: 1,
  skipped_deleted: 1,
  unmatched_staff: [],
  duration_ms: 1234,
}))
const fakeClient = { sync: { runNow } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient }))

// Spread the REAL module so FACADE_AUDIT_MAP stays live inside logFacadeAudit
// (app-api-karute-save.test.ts's pattern) — only the emitter is stubbed.
const audit = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

import { POST } from '@/app/api/app/v1/sync/run/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(sub = 'auth-user-1') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const noRoute = { params: Promise.resolve({}) }
const post = () => new Request('https://s/api/app/v1/sync/run', { method: 'POST', headers: auth })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['sync.view'])
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
})

describe('POST /api/app/v1/sync/run', () => {
  it('no sync.view grant → 403, runNow never called, no audit row', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(403)
    expect(runNow).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('granted → 200, passthrough shape (success + result fields + folded skipped)', async () => {
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      created: 2,
      updated: 3,
      cancelled: 1,
      skipped: 2, // skipped_no_staff (1) + skipped_deleted (1)
      duration_ms: 1234,
    })
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE')
  })

  it('not-configured (upstream "config not found") → 200 friendly message, not a failure', async () => {
    runNow.mockRejectedValueOnce(new Error('config not found for business'))
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      // code is the machine-readable half the CLIENT localizes from
      // (Greptile #602) — pinned so the ja card never depends on the prose.
      code: 'not_configured',
      message: 'QR sync not configured — save your Quick Reserve login first.',
    })
  })

  it('not-configured ("no credentials") → 200 friendly message', async () => {
    runNow.mockRejectedValueOnce(new Error('no credentials stored'))
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).message).toMatch(/QR sync not configured/)
  })

  it('genuine upstream failure → 502', async () => {
    runNow.mockRejectedValueOnce(new Error('QuickReserve login expired'))
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(502)
  })

  it('success emits exactly one settings.sync_run_now audit row (map-row test)', async () => {
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(200)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'settings',
        action: 'settings.sync_run_now',
        actorId: 'auth-user-1',
        businessId: 'business-1',
        targetType: 'business',
        source: 'facade',
      }),
    )
  })

  it('the friendly not-configured 200 still emits the audit row (any 2xx on a mapped mutation logs)', async () => {
    runNow.mockRejectedValueOnce(new Error('config not found'))
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(200)
    expect(audit).toHaveBeenCalledTimes(1)
  })

  it('a 502 emits no audit row — errors are not actions', async () => {
    runNow.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(502)
    expect(audit).not.toHaveBeenCalled()
  })
})
