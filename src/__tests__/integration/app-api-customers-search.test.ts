// Facade GET /api/app/v1/customers/search (P3 cross-branch search, ⚖ Liam
// 2026-09-16). Thin-bundle twin of customers-search-company-wide.test.ts —
// same business-wide search + other_store labelling, over the Bearer
// identity. Harness copied from app-api-karute-reveal.test.ts.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
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
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({ customers: { list: customersList } }),
}))

function cachedRow(id: string, over: Record<string, unknown> = {}) {
  return { id, name: `name-${id}`, phone: null, furigana: null, karute_number: null, ...over }
}
const getCachedCustomerListFor = jest.fn(async (...args: unknown[]) => {
  const storeId = args[1]
  return storeId === 'store-A' ? [cachedRow('cust-1')] : [cachedRow('cust-1'), cachedRow('cust-2')]
})
// Fold round: the route now loads this via a lazy `await import(...)` (same
// ESM-landmine fix as list-all.ts / actions/customers.ts), not a top-level
// import — jest.mock intercepts by module path either way, so this mock
// doesn't depend on which import style the route happens to use.
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: (...a: unknown[]) => getCachedCustomerListFor(...a),
}))

import { GET } from '@/app/api/app/v1/customers/search/route'

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
  new Request(`https://s/api/app/v1/customers/search?query=${encodeURIComponent(q)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer()}` },
  })
const route = { params: Promise.resolve({}) }

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  storeClamp.current = { storeId: null, allowedStoreIds: null }
})

describe('GET /api/app/v1/customers/search', () => {
  it('missing customers.view → 403, no reads', async () => {
    capabilities.current = new Set()
    const res = await GET(req('田中'), route)
    expect(res.status).toBe(403)
    expect(customersList).not.toHaveBeenCalled()
  })

  it('empty q → {options: []}, no reads', async () => {
    const res = await GET(req(''), route)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { options: unknown[] }
    expect(body.options).toEqual([])
    expect(customersList).not.toHaveBeenCalled()
  })

  it('clamped actor: business-wide search, other_store flags results outside their own store', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    customersList.mockResolvedValueOnce({
      customers: [
        { id: 'cust-1', name: '田中太郎', furigana: null, phone: null, karute_number: null },
        { id: 'cust-2', name: '田中花子', furigana: null, phone: null, karute_number: null },
      ],
      total: 2,
    })
    const res = await GET(req('田中'), route)
    expect(res.status).toBe(200)
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ search: '田中' }))
    const body = (await res.json()) as { options: { id: string; other_store: boolean }[] }
    expect(body.options).toEqual([
      expect.objectContaining({ id: 'cust-1', other_store: false }),
      expect.objectContaining({ id: 'cust-2', other_store: true }),
    ])
  })

  it('viewAll actor: never other_store', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: null }
    customersList.mockResolvedValueOnce({
      customers: [{ id: 'cust-2', name: '田中花子', furigana: null, phone: null, karute_number: null }],
      total: 1,
    })
    const res = await GET(req('田中'), route)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { options: { id: string; other_store: boolean }[] }
    expect(body.options).toEqual([expect.objectContaining({ id: 'cust-2', other_store: false })])
  })

  it('Greptile fold: a non-digit term never loads the business-wide cache (eligibility checked first)', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: null }
    customersList.mockResolvedValueOnce({
      customers: [{ id: 'cust-2', name: '田中花子', furigana: null, phone: null, karute_number: null }],
      total: 1,
    })
    await GET(req('田中'), route)
    // viewAll -> no own-store lens call; '田中' isn't karute-eligible -> no
    // business-wide call either. getCachedCustomerListFor never runs at all.
    expect(getCachedCustomerListFor).not.toHaveBeenCalled()
  })

  it('Greptile fold: a cache failure degrades that signal but never sinks the direct search result', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    customersList.mockResolvedValueOnce({
      customers: [{ id: 'cust-1', name: '田中太郎', furigana: null, phone: null, karute_number: null }],
      total: 1,
    })
    getCachedCustomerListFor.mockRejectedValue(new Error('cache down'))
    const res = await GET(req('0042'), route)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { options: { id: string; other_store: boolean }[] }
    expect(body.options).toEqual([expect.objectContaining({ id: 'cust-1', other_store: false })])
  })
})
