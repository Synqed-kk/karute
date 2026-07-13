// Customers-list screen facade GET (packet 04, inventory #2) — the #441
// leak-class endpoint. The store clamp + row assembly run REAL (only the
// synqed SDK client + supabase/staff lookups are faked), so these tests
// exercise the actual resolveStoreForRequest + buildCustomersListScreen code:
//   wrong-tenant store-id → store_forbidden (tenancy proven FIRST)
//   in-tenant store outside assignment → store_forbidden
//   errored assignment lookup → store_forbidden (fail-CLOSED)
//   branch-restricted staff → clamped list read (enforceStore + store_id)
//   missing Bearer w/ cookie → 401 · missing capability → 403 (no reads)
//   synqed failure (incl. packs) → 502, never a swallowed empty DTO
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => {
    const t = (k: string) => k
    return t
  },
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusiness: jest.fn(async () => [
    { id: 'auth-user-1', full_name: '佐藤 美咲' },
    { id: 'staff-2', full_name: '田中 太郎' },
  ]),
}))
const mockCapabilities = jest.fn(async () => new Set(['customers.view', 'stores.viewAll']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})
// list-enrich imports the ESM SynqedClient class at module scope — stub the
// package (untransformed ESM) since enrichCustomers itself is mocked below.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))
// enrichment hits its own env-constructed client — pin it; formatters stay real.
jest.mock('@/lib/customers/list-enrich', () => {
  const actual = jest.requireActual('@/lib/customers/list-enrich')
  return {
    ...actual,
    enrichCustomers: jest.fn(async (_b: string, ids: string[]) => {
      const map = new Map()
      for (const id of ids)
        map.set(id, {
          totalKarute: 3,
          lastVisitIso: '2026-06-01T00:00:00Z',
          pastAppointmentCount: 2,
          lastVisitService: 'カット',
          bookingStaffId: 'staff-2',
          nextAppointmentIso: null,
          firstVisitIso: '2025-01-01T00:00:00Z',
          datedVisitCount: 3,
          noShowCount: 0,
        })
      return map
    }),
  }
})

const CUSTOMERS = [
  {
    id: 'cust-1', name: '山田 花子', phone: '090-1', assigned_staff_id: 'staff-2',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
  },
  {
    id: 'cust-2', name: '鈴木 一郎', phone: null, assigned_staff_id: null,
    created_at: '2026-02-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  },
]
const listCustomers = jest.fn(async () => ({ customers: CUSTOMERS, total: 2 }))
const storesGet = jest.fn(async (id: string) => {
  if (id !== 'store-1' && id !== 'store-2') throw new Error('404 not this tenant')
  return { id }
})
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const listActivePacks = jest.fn(async () => [
  { id: 'pack-1', customer_id: 'cust-1', kind: 'pack', pack_size: 10, unit_price: 5000 },
])
const fakeClient = {
  customers: { list: listCustomers },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
  packs: {
    listActivePacks,
    listAllRedemptionPackIds: jest.fn(async () => ['pack-1', 'pack-1']),
    listLifecycles: jest.fn(async () => [{ customer_id: 'cust-2', status: 'graduated' }]),
  },
  orgSettings: { get: jest.fn(async () => ({ settings: { ticket_packs_enabled: true } })) },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { GET, OPTIONS } from '@/app/api/app/v1/screens/customers/route'
import { newSynqedClient } from '@/lib/synqed/client'

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
const req = (init: RequestInit = {}, qs = '') =>
  new Request(`https://s/api/app/v1/screens/customers${qs}`, init)

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  listCustomers.mockResolvedValue({ customers: CUSTOMERS, total: 2 })
})

describe('GET /api/app/v1/screens/customers — happy path', () => {
  it('returns the screen DTO assembled by the shared row builder', async () => {
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.totalRegistered).toBe(2)
    expect(dto.selfStaffId).toBe('auth-user-1')
    expect(dto.bookingDataAvailable).toBe(true)
    expect(dto.staffList).toEqual([
      { id: 'auth-user-1', name: '佐藤 美咲', initials: expect.any(String) },
      { id: 'staff-2', name: '田中 太郎', initials: expect.any(String) },
    ])
    const row1 = dto.rows.find((r: { id: string }) => r.id === 'cust-1')
    expect(row1.preferredStaffName).toBe('田中 太郎')
    expect(row1.pack).toEqual({ remaining: 8, size: 10, unconsumed: 40000 })
    const row2 = dto.rows.find((r: { id: string }) => r.id === 'cust-2')
    expect(row2.status).toBe('graduated') // lifecycle outranks cadence
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('回数券 off blanks pack data (page parity)', async () => {
    fakeClient.orgSettings.get.mockResolvedValueOnce({ settings: { ticket_packs_enabled: false } })
    const res = await GET(req({ headers: auth }), route)
    const dto = await res.json()
    expect(dto.rows.find((r: { id: string }) => r.id === 'cust-1').pack).toBeNull()
  })
})

describe('store clamp (#441 leak class) — REAL resolveStoreForRequest', () => {
  it('wrong-tenant store-id → 403 store_forbidden BEFORE any customer read', async () => {
    const res = await GET(req({ headers: { ...auth, 'store-id': 'store-OTHER-TENANT' } }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(listCustomers).not.toHaveBeenCalled()
  })

  it('in-tenant store OUTSIDE the caller assignment → 403 store_forbidden', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view'])) // no viewAll
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req({ headers: { ...auth, 'store-id': 'store-2' } }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(listCustomers).not.toHaveBeenCalled()
  })

  it('errored assignment lookup → fails CLOSED (403), never floating', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    staffStoresGet.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(listCustomers).not.toHaveBeenCalled()
  })

  it('branch-restricted staff: list read is CLAMPED (store_id + enforceStore)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req({ headers: auth }, '?query=yama'), route)
    expect(res.status).toBe(200)
    // enforceStore keeps the store filter DURING search — the RBAC search clamp.
    expect(listCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'yama', store_id: 'store-1', page: 1 }),
    )
  })

  it('cross-store viewer with an in-tenant store-id scopes to it', async () => {
    const res = await GET(req({ headers: { ...auth, 'store-id': 'store-2' } }), route)
    expect(res.status).toBe(200)
    expect(listCustomers).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-2' }))
  })
})

describe('authn / validation / failure contract', () => {
  it('missing Bearer with a cookie present → 401, no reads', async () => {
    const res = await GET(req({ headers: { cookie: 'sb-access-token=evil' } }), route)
    expect(res.status).toBe(401)
    expect(listCustomers).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no reads (clamp not even consulted)', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(storesGet).not.toHaveBeenCalled()
    expect(listCustomers).not.toHaveBeenCalled()
  })

  it('over-long query → 400 validation', async () => {
    const res = await GET(req({ headers: auth }, `?query=${'x'.repeat(201)}`), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
  })

  it('customer list failure → 502 upstream_unavailable', async () => {
    listCustomers.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('packs failure → 502 (throwing WithClient variant, no silent empty)', async () => {
    listActivePacks.mockRejectedValueOnce(new Error('packs down'))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
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
