// Facade GET /api/app/v1/karute/reveal (PR-1b 検索リビール, karute-tab
// restructure packet). Web twin of karute-reveal-action.test.ts — same
// store-scoping rules, mirrored via resolveStoreForRequest instead of the
// cookie-bound resolveStoreScope. Pins:
//   1. RBAC: missing customers.view → 403, no reads.
//   2. Store clamp: a clamped actor's search AND zero-karute check are both
//      { store_id: THEIR store } — never business-wide.
//   3. viewAll actor → business-wide search, store-scoped zero-karute check.
//   4. Fail-closed: a clamp with no resolvable store never reaches an
//      unscoped read.
//   5. Empty q → no candidate, no reads.
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
const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const storeClamp = { current: { storeId: null as string | null, allowedStoreIds: null as string[] | null } }
const resolveStoreForRequest = jest.fn(async () => storeClamp.current)
jest.mock('@/lib/app-api/store-clamp', () => ({
  resolveStoreForRequest: () => resolveStoreForRequest(),
}))

const customersList = jest.fn()
const karuteRecordsList = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({
    customers: { list: customersList },
    karuteRecords: { list: karuteRecordsList },
  }),
}))

import { GET } from '@/app/api/app/v1/karute/reveal/route'

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
const req = (q: string) =>
  new Request(`https://s/api/app/v1/karute/reveal?q=${encodeURIComponent(q)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer()}` },
  })
const route = { params: Promise.resolve({}) }

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  storeClamp.current = { storeId: null, allowedStoreIds: null }
})

describe('GET /api/app/v1/karute/reveal', () => {
  it('missing customers.view → 403, no reads', async () => {
    capabilities.current = new Set()
    const res = await GET(req('田中'), route)
    expect(res.status).toBe(403)
    expect(customersList).not.toHaveBeenCalled()
  })

  it('clamped actor → search AND zero-karute check are both store-scoped', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    customersList.mockResolvedValueOnce({
      customers: [{ id: 'cust-1', name: '田中太郎', karute_number: null, created_at: '2026-01-01T00:00:00.000Z' }],
      total: 1,
    })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [], total: 0 })
    const res = await GET(req('田中'), route)
    expect(res.status).toBe(200)
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-A' }))
    expect(karuteRecordsList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-A', customer_id: 'cust-1' }),
    )
    const body = (await res.json()) as { candidate: unknown }
    expect(body.candidate).toEqual({
      id: 'cust-1',
      name: '田中太郎',
      code: '#00000',
      registeredDate: '2026-01-01T00:00:00.000Z',
    })
  })

  it('viewAll actor → search is business-wide, zero-karute check stays store-scoped', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: null }
    customersList.mockResolvedValueOnce({
      customers: [{ id: 'cust-1', name: '田中太郎', karute_number: null, created_at: '2026-01-01T00:00:00.000Z' }],
      total: 1,
    })
    karuteRecordsList.mockResolvedValueOnce({ karute_records: [], total: 0 })
    const res = await GET(req('田中'), route)
    expect(res.status).toBe(200)
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
    expect(karuteRecordsList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-A' }))
  })

  it('fail-closed: a clamp with no resolvable store never reaches an unscoped read', async () => {
    storeClamp.current = { storeId: null, allowedStoreIds: ['store-A'] }
    const res = await GET(req('田中'), route)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { candidate: unknown }
    expect(body.candidate).toBeNull()
    expect(customersList).not.toHaveBeenCalled()
  })

  it('empty q → no candidate, no reads', async () => {
    const res = await GET(req(''), route)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { candidate: unknown }
    expect(body.candidate).toBeNull()
    expect(customersList).not.toHaveBeenCalled()
  })
})
