// Entitlement facade route (design-parity packet 12 §B-3 S2). Pins: 401
// without Bearer · 403 without stores.viewAll (same deliberate
// least-privilege gate as the stores list route — a new callable Bearer
// surface, S1 voice_enrollments precedent) · happy path returns the SAME
// Entitlement the loadEntitlementWithClient twin resolves (the web action's
// core) · a degraded core read still resolves 200 with `degraded: true`,
// never a 502 (loadEntitlementWithClient is fully tolerant by design).
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))

const mockCapabilities = jest.fn(async () => new Set(['stores.viewAll']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))

const entitlementsGet = jest.fn(async () => ({ tier: 'professional', is_unlimited: false }))
const storesList = jest.fn(async () => ({ stores: [] as unknown[] }))
const fakeClient = { entitlements: { get: entitlementsGet }, stores: { list: storesList } }
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET } from '@/app/api/app/v1/entitlement/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const route = { params: Promise.resolve({}) }
const req = (headers: Record<string, string> = {}) =>
  new Request('https://s/api/app/v1/entitlement', { headers: { authorization: `Bearer ${bearer()}`, ...headers } })

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.KARUTE_BILLING_ENFORCEMENT
  mockCapabilities.mockResolvedValue(new Set(['stores.viewAll']))
  entitlementsGet.mockResolvedValue({ tier: 'professional', is_unlimited: false })
  storesList.mockResolvedValue({ stores: [] })
})

describe('GET /api/app/v1/entitlement', () => {
  it('missing Bearer → 401, no read', async () => {
    const res = await GET(new Request('https://s/api/app/v1/entitlement'), route)
    expect(res.status).toBe(401)
    expect(entitlementsGet).not.toHaveBeenCalled()
  })

  it('missing stores.viewAll → 403, no read', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(entitlementsGet).not.toHaveBeenCalled()
  })

  it('happy path → 200 { entitlement } matching the WithClient twin, client scoped to the resolved businessId', async () => {
    storesList.mockResolvedValue({ stores: [{ id: 'a' }, { id: 'b' }] })
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    const body = await res.json()
    expect(body.entitlement).toMatchObject({
      tier: 'professional',
      storeCount: 2,
      isUnlimited: false,
      canAddStore: true,
      enforced: false,
      degraded: false,
    })
  })

  it('a degraded core read → 200 with degraded: true, never a 502', async () => {
    entitlementsGet.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect((await res.json()).entitlement).toMatchObject({ tier: 'free', degraded: true })
  })
})
