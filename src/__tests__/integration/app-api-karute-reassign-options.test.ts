// Facade GET /karute/[id]/reassign-options (F4 fix round 2, item A — no test
// file existed for this route at all; VERIFY-F4-BLIND M22c/M22d GREEN).
// Pins:
//   1. RBAC: missing records.reassign → 403, no karute/customer read
//      (red-run: remove ensureCapability, M22d).
//   2. Store clamp: a clamped actor's request calls listAllCustomers with
//      { store_id: THEIR store, enforceStore: true } and the shipped array
//      is the exact store-scoped list, never length-only (red-run: force
//      enforceStore:false at the route, M22c).
//   3. Current customer excluded from the shipped array.
//   4. viewAll actor → business-wide list (pair).
//
// listAllCustomers itself is mocked directly (the house convention 8+ other
// test files already use for this module — customers-list-all.test.ts owns
// its own internal filtering logic), NOT the SDK customers.list level: this
// route never passes a `search` term, so list-all.ts's OWN storeFilter
// ternary can't distinguish enforceStore's value when store_id is always
// present — a real mutation on THIS route's enforceStore line would sail
// through list-all.ts's real logic untouched. What this route actually owns,
// and what needs pinning here, is that it computes and PASSES the right
// { store_id, enforceStore } pair — so the mock keys its returned roster off
// exactly that pair, making a dropped/flipped enforceStore observable.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
jest.mock('@synqed-kk/client', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '田中' }]),
}))
const capabilities = { current: new Set<string>(['records.reassign']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const storeClamp = { current: { storeId: null as string | null, allowedStoreIds: null as string[] | null } }
const resolveStoreForRequest = jest.fn(async () => storeClamp.current)
jest.mock('@/lib/app-api/store-clamp', () => ({
  resolveStoreForRequest: () => resolveStoreForRequest(),
}))

const KARUTE = { current: { id: 'kar-1', customer_id: 'cust-FROM' } as Record<string, unknown> }
const karuteGet = jest.fn(async (id: string) => {
  if (id !== 'kar-1') throw Object.assign(new Error('not found'), { status: 404 })
  return KARUTE.current
})
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({
    karuteRecords: { get: (id: string) => karuteGet(id) },
  }),
}))

const CUSTOMERS: Record<string, { id: string; name: string; furigana: null; phone: null }> = {
  'cust-FROM': { id: 'cust-FROM', name: '田中 美咲', furigana: null, phone: null },
  'cust-TO': { id: 'cust-TO', name: '佐藤 花子', furigana: null, phone: null },
  'cust-OTHER-STORE': { id: 'cust-OTHER-STORE', name: '他店 太郎', furigana: null, phone: null },
}
const listAllCustomers = jest.fn(
  async (_synqed: unknown, opts: { store_id?: string; enforceStore?: boolean }) => {
    if (opts.enforceStore && opts.store_id === 'store-A') {
      return { customers: [CUSTOMERS['cust-TO'], CUSTOMERS['cust-FROM']], total: 2 }
    }
    if (opts.enforceStore && opts.store_id === 'store-B') {
      return { customers: [CUSTOMERS['cust-OTHER-STORE']], total: 1 }
    }
    // enforceStore:false = business-wide, matching the real function's
    // shape for an unclamped/viewAll actor (and what a dropped/flipped
    // enforceStore on a clamped actor would leak).
    return { customers: Object.values(CUSTOMERS), total: 3 }
  },
)
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: (...a: Parameters<typeof listAllCustomers>) => listAllCustomers(...a),
}))

import { GET } from '@/app/api/app/v1/karute/[id]/reassign-options/route'

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
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const getReq = () => new Request('https://s/x', { method: 'GET', headers: { authorization: `Bearer ${bearer()}` } })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.reassign'])
  storeClamp.current = { storeId: null, allowedStoreIds: null } // viewAll-shaped by default
  KARUTE.current = { id: 'kar-1', customer_id: 'cust-FROM' }
})

describe('GET /karute/[id]/reassign-options', () => {
  it('missing records.reassign → 403, no karute or customer read', async () => {
    capabilities.current = new Set()
    const res = await GET(getReq(), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(karuteGet).not.toHaveBeenCalled()
    expect(listAllCustomers).not.toHaveBeenCalled()
  })

  it('clamped actor → exact store-scoped list, current customer excluded (red-run: force enforceStore:false, business-wide leaks through)', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const res = await GET(getReq(), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { customers: Array<{ id: string }> }
    expect(listAllCustomers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ store_id: 'store-A', enforceStore: true }),
    )
    expect(body.customers.map((c) => c.id)).toEqual(['cust-TO'])
  })

  it('viewAll actor → business-wide list (enforceStore:false)', async () => {
    storeClamp.current = { storeId: null, allowedStoreIds: null }
    const res = await GET(getReq(), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { customers: Array<{ id: string }> }
    expect(listAllCustomers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enforceStore: false }))
    expect(body.customers.map((c) => c.id).sort()).toEqual(['cust-OTHER-STORE', 'cust-TO'])
  })
})
