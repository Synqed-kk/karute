// Sessions-list (カルテ tab) screen facade GET (packet 05, inventory #3) — the
// #441 leak-class endpoint. The store clamp + row assembly run REAL (only the
// synqed SDK client + supabase/staff lookups are faked), so these tests exercise
// the actual resolveStoreForRequest + buildSessionsListScreen code:
//   wrong-tenant store-id → store_forbidden (tenancy proven FIRST)
//   in-tenant store outside assignment → store_forbidden
//   errored assignment lookup → store_forbidden (fail-CLOSED)
//   branch-restricted staff → clamped customer + karute reads (store_id + enforceStore)
//   viewAll + store-id → karute rows scoped, customer name-map business-wide (lens parity)
//   missing Bearer w/ cookie → 401 · missing capability → 403 (no reads)
//   synqed karute failure → 502, never a swallowed empty DTO
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
const STAFF = [
  { id: 'auth-user-1', full_name: '佐藤 美咲' },
  { id: 'staff-2', full_name: '田中 太郎' },
]
const staffListOrThrow = jest.fn(async () => STAFF)
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  // The route uses the THROWING variant (fix round 1) — a staff-read failure
  // must land in the 502 catch, never resolve [] into a schema-legal 200.
  staffListByBusinessOrThrow: () => staffListOrThrow(),
}))
const mockCapabilities = jest.fn(async () => new Set(['customers.view', 'stores.viewAll']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})
// Untransformed ESM package — stub it (the route only touches the SDK through
// the mocked newSynqedClient / the type-only store-clamp import).
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))

const TODAY = new Date().toISOString()
const CUSTOMERS = [
  { id: 'cust-1', name: '山田 花子', phone: '090-1', assigned_staff_id: 'staff-2', created_at: '2026-01-01T00:00:00Z' },
  { id: 'cust-2', name: '鈴木 一郎', phone: null, assigned_staff_id: null, created_at: '2026-02-01T00:00:00Z' },
  { id: 'cust-3', name: '高橋 実', phone: null, assigned_staff_id: null, created_at: '2026-03-01T00:00:00Z' },
]
// rec-1: summary present → 'summarized', 2 entries → 'active'
// rec-2: transcript only → 'pending', 0 entries → 'provisional'
const KARUTE = [
  { id: 'rec-1', customer_id: 'cust-1', created_at: TODAY, session_date: TODAY, ai_summary: 'まとめ', transcript: '発話', staff_id: 'sstaff-1', business_id: 'business-1', entry_count: 2 },
  { id: 'rec-2', customer_id: 'cust-2', created_at: TODAY, session_date: TODAY, ai_summary: null, transcript: '録音のみ', staff_id: 'sstaff-1', business_id: 'business-1', entry_count: 0 },
]

const listCustomers = jest.fn(async () => ({ customers: CUSTOMERS, total: CUSTOMERS.length }))
const storesGet = jest.fn(async (id: string) => {
  if (id !== 'store-1' && id !== 'store-2') throw new Error('404 not this tenant')
  return { id }
})
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const karuteList = jest.fn(async () => ({ karute_records: KARUTE, total: KARUTE.length }))
// cust-3 has a booking with synqed staff sstaff-1 → resolves to profile staff-2.
const apptsList = jest.fn(async () => ({
  appointments: [{ customer_id: 'cust-3', staff_id: 'sstaff-1', starts_at: TODAY }],
}))
const staffList = jest.fn(async () => ({ staff: [{ id: 'sstaff-1', user_id: 'staff-2' }] }))
const fakeClient = {
  customers: { list: listCustomers },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
  karuteRecords: { list: karuteList },
  appointments: { list: apptsList },
  staff: { list: staffList },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { GET, OPTIONS } from '@/app/api/app/v1/screens/sessions/route'
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
const req = (init: RequestInit = {}) =>
  new Request('https://s/api/app/v1/screens/sessions', init)

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  listCustomers.mockResolvedValue({ customers: CUSTOMERS, total: CUSTOMERS.length })
  karuteList.mockResolvedValue({ karute_records: KARUTE, total: KARUTE.length })
})

describe('GET /api/app/v1/screens/sessions — record 担当 id-space translation (Liam field report 7/24)', () => {
  it('a pipeline-written record (SYNQED staff id) resolves 担当 name + profile-space staffId; a legacy profile-id record still resolves', async () => {
    karuteList.mockResolvedValue({
      karute_records: [
        // Pipeline shape: core staff_id = SYNQED staff id (sstaff-1)
        { id: 'rec-syn', customer_id: 'cust-1', created_at: TODAY, session_date: TODAY, ai_summary: 'x', transcript: 't', staff_id: 'sstaff-1', business_id: 'business-1', entry_count: 1 },
        // Legacy interactive-save shape: core staff_id = profile id (staff-2)
        { id: 'rec-prof', customer_id: 'cust-2', created_at: TODAY, session_date: TODAY, ai_summary: 'y', transcript: 't', staff_id: 'staff-2', business_id: 'business-1', entry_count: 1 },
      ],
      total: 2,
    })
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(200)
    const dto = await res.json()
    const syn = dto.items.find((i: { id: string }) => i.id === 'rec-syn')
    // Before the 7/24 boundary translation these rendered 担当 "Unknown" and
    // escaped the 自分/担当 filters (staffId stayed in the synqed space).
    expect(syn.staffName).toBe('田中 太郎')
    expect(syn.staffId).toBe('staff-2')
    const prof = dto.items.find((i: { id: string }) => i.id === 'rec-prof')
    expect(prof.staffName).toBe('田中 太郎')
    expect(prof.staffId).toBe('staff-2')
  })
})

describe('GET /api/app/v1/screens/sessions — happy path', () => {
  it('returns the screen DTO assembled by the shared builder', async () => {
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(200)
    const dto = await res.json()

    // 2 real records, 1 placeholder (cust-3 has no karute), monthCount = both
    // records dated today (current month).
    expect(dto.items).toHaveLength(2)
    expect(dto.placeholders).toHaveLength(1)
    expect(dto.monthCount).toBe(2)

    const rec1 = dto.items.find((i: { id: string }) => i.id === 'rec-1')
    expect(rec1.aiStatus).toBe('summarized')
    expect(rec1.conversionStatus).toBe('active')
    expect(rec1.customerName).toBe('山田 花子')
    const rec2 = dto.items.find((i: { id: string }) => i.id === 'rec-2')
    expect(rec2.aiStatus).toBe('pending')
    expect(rec2.conversionStatus).toBe('provisional')

    // Placeholder 担当 resolved from the booking (synqed sstaff-1 → profile staff-2).
    const ph = dto.placeholders[0]
    expect(ph.customerId).toBe('cust-3')
    expect(ph.isPlaceholder).toBe(true)
    expect(ph.staffId).toBe('staff-2')
    expect(ph.staffName).toBe('田中 太郎')

    expect(dto.currentStaffId).toBe('auth-user-1') // on the roster
    expect(dto.customerOptions).toHaveLength(3)
    // Companion to the staff-failure 502 test: the degraded-200 shape
    // (staffList [] / names 'Unknown') must never be the happy path.
    expect(dto.staffList.length).toBeGreaterThan(0)
    expect(dto.staffList).toEqual([
      { id: 'auth-user-1', name: '佐藤 美咲', initials: expect.any(String) },
      { id: 'staff-2', name: '田中 太郎', initials: expect.any(String) },
    ])
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })
})

describe('store clamp (#441 leak class) — REAL resolveStoreForRequest', () => {
  it('wrong-tenant store-id → 403 store_forbidden BEFORE any read', async () => {
    const res = await GET(req({ headers: { ...auth, 'store-id': 'store-OTHER-TENANT' } }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(listCustomers).not.toHaveBeenCalled()
    expect(karuteList).not.toHaveBeenCalled()
  })

  it('in-tenant store OUTSIDE the caller assignment → 403 store_forbidden', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view'])) // no viewAll
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req({ headers: { ...auth, 'store-id': 'store-2' } }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(listCustomers).not.toHaveBeenCalled()
    expect(karuteList).not.toHaveBeenCalled()
  })

  it('errored assignment lookup → fails CLOSED (403), never business-wide', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    staffStoresGet.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(listCustomers).not.toHaveBeenCalled()
    expect(karuteList).not.toHaveBeenCalled()
  })

  it('branch-restricted staff: customer + karute reads are CLAMPED (store_id + enforceStore)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(200)
    // enforceStore keeps the store filter on the customer read (no search → the
    // store lens applies); the karute read is scoped to the same store.
    expect(listCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-1', page: 1 }),
    )
    expect(karuteList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-1' }),
    )
  })

  it('viewAll + store-id → karute rows scoped, customer name-map stays business-wide', async () => {
    const res = await GET(req({ headers: { ...auth, 'store-id': 'store-2' } }), route)
    expect(res.status).toBe(200)
    const dto = await res.json()
    // Karute + placeholder roster scoped to store-2 …
    expect(karuteList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-2' }))
    // … while the customer name-map + options stay business-wide (walk-in parity):
    // the primary customer read carries NO store_id.
    expect(listCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: undefined, page: 1 }),
    )
    expect(dto.customerOptions).toHaveLength(3)
  })
})

describe('authn / failure contract', () => {
  it('missing Bearer with a cookie present → 401, no reads', async () => {
    const res = await GET(req({ headers: { cookie: 'sb-access-token=evil' } }), route)
    expect(res.status).toBe(401)
    expect(karuteList).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no reads (clamp not even consulted)', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(storesGet).not.toHaveBeenCalled()
    expect(karuteList).not.toHaveBeenCalled()
  })

  it('karute read failure → 502 upstream_unavailable, never a swallowed empty DTO', async () => {
    karuteList.mockRejectedValueOnce(new Error('synqed-core down'))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('customer read failure → 502 upstream_unavailable', async () => {
    listCustomers.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req({ headers: auth }), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('staff read failure → 502, never a degraded 200 with an empty roster (fix round 1)', async () => {
    staffListOrThrow.mockRejectedValueOnce(new Error('profiles down'))
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
