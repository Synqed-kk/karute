// Ask-AI screen facade GET (packet 04, inventory #1). Negative tests per the
// packet: missing Bearer with a cookie present → 401 (Bearer-only proof),
// missing capability → 403 with NO synqed call, upstream failure → 502 (never
// a swallowed zero-count DTO), inactive membership → 403, plus the happy DTO
// round-trip and OPTIONS preflight. Wrong-tenant/wrong-store don't apply: the
// route takes no resource id and every read runs on the business-scoped client
// (recorded in the packet-04 report). Reads are not revocation-sensitive
// (packet 01 set) — same fast-path ruling as customer.read, also recorded.
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))
const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

// Caller's own profile row — the userName (email local-part) source.
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { email: 'mika@example.com' }, error: null }),
        }),
      }),
    }),
  }),
}))

// Business-scoped synqed client: 3 count reads + org settings + the store
// clamp (parity fix, 2026-08-17: resolveStoreForRequest now runs BEFORE the
// count reads, same as the customers/appointments screen routes).
const listKarute = jest.fn(async () => ({
  total: 12,
  karute_records: [{ transcript: 'yes' }, { transcript: null }, { transcript: 'also' }],
}))
const listCustomers = jest.fn(async () => ({ total: 34 }))
const listAppointments = jest.fn(async () => ({ total: 5 }))
const storesGet = jest.fn(async (id: string) => {
  if (id !== 'store-1' && id !== 'store-2') throw new Error('404 not this tenant')
  return { id }
})
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  karuteRecords: { list: listKarute },
  customers: { list: listCustomers },
  appointments: { list: listAppointments },
  orgSettings: {
    get: jest.fn(
      async (): Promise<{ settings: { business_type?: string } }> => ({
        settings: { business_type: 'hair_salon' },
      }),
    ),
  },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { GET, OPTIONS } from '@/app/api/app/v1/screens/ask-ai/route'
import { newSynqedClient } from '@/lib/synqed/client'
import { businessIdForUser } from '@/lib/staff'
import { AppApiError } from '@/lib/app-api/errors'

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
const auth = { authorization: `Bearer ${bearer()}` }
const route = { params: Promise.resolve({}) }
const req = (init: RequestInit = {}) => new Request('https://s/api/app/v1/screens/ask-ai', init)

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  listKarute.mockResolvedValue({
    total: 12,
    karute_records: [{ transcript: 'yes' }, { transcript: null }, { transcript: 'also' }],
  })
  // Floating staff (unrestricted) default — matches every pre-existing test's
  // no-header, non-viewAll posture unchanged (clamp.storeId resolves null).
  staffStoresGet.mockResolvedValue({ store_ids: [] })
})

describe('GET /api/app/v1/screens/ask-ai', () => {
  it('returns the validated screen DTO assembled on the business-scoped client', async () => {
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto).toEqual({
      scope: { karute: 12, customers: 34, bookings: 5, recordings: 2 },
      businessType: 'hair_salon',
      userName: 'mika',
    })
    // Tenancy: the client is constructed from the Bearer-resolved business id.
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('empty business_type normalizes to null (page parity: generic profile)', async () => {
    fakeClient.orgSettings.get.mockResolvedValueOnce({ settings: {} })
    const res = await GET(req({ headers: auth }), route)
    expect((await res.json()).businessType).toBeNull()
  })

  it('missing Bearer with a cookie present → 401 (Bearer-only, cookie ignored)', async () => {
    const res = await GET(req({ headers: { cookie: 'sb-access-token=evil' } }), route)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('unauthenticated')
    expect(listKarute).not.toHaveBeenCalled()
  })

  it('missing capability → 403 with NO synqed read', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(listKarute).not.toHaveBeenCalled()
  })

  it('inactive membership → 403 membership_inactive, no synqed read', async () => {
    ;(businessIdForUser as jest.Mock).mockRejectedValueOnce(
      new AppApiError('membership_inactive', 'No active business membership for this user'),
    )
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('membership_inactive')
    expect(listKarute).not.toHaveBeenCalled()
  })

  it('synqed failure → 502 upstream_unavailable, NEVER a zero-count DTO', async () => {
    listKarute.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })
})

describe('store-scope parity (2026-08-17): counts thread resolveStoreForRequest', () => {
  it('branch-restricted staff (no header): counts clamp to their assigned store', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(200)
    expect(listKarute).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1' }))
    expect(listCustomers).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1' }))
    expect(listAppointments).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1' }))
  })

  it('viewAll caller with no store-id header: unchanged business-wide totals', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(200)
    expect(listCustomers).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })

  it('in-tenant store OUTSIDE the caller assignment → 403 store_forbidden, no reads', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req({ headers: { ...auth, 'store-id': 'store-2' } }), route)
    expect(res.status).toBe(403)
    expect(listCustomers).not.toHaveBeenCalled()
  })
})

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS for a shell origin, no auth required', async () => {
    const res = await OPTIONS(req({ method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), route)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })
})
