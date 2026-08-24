// Facade GET /api/app/v1/karute/window (PR-2a 日付チャンク読み込み). Phone
// twin of loadKaruteWindow. Pins:
//   1. RBAC: missing customers.view → 403, no reads.
//   2. Store clamp: EVERY read of the walk carries the clamped store — the
//      probe, the paged fetch and the store-total read alike (a lens lost
//      mid-walk leaks another branch's history one さらに表示 at a time).
//   3. Fail-closed on a clamp error: 403 BEFORE any data read.
//   4. Malformed olderThan/month/loadedCount → 400, never a silently-ignored
//      param that hands back the newest window and reads as end-of-history.
//   5. Upstream failure → 502, never an empty-but-200 chunk.
//   6. Response shape = the action's KaruteWindowPage (items/windowStart/
//      freshStoreTotal/hasMore).
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
  staffListByBusinessOrThrow: jest.fn(async () => [
    { id: 'auth-user-1', full_name: '田中 太郎' },
  ]),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  storeStaffIdSetForBusiness: jest.fn(async () => null),
}))
const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const storeClamp = {
  current: { storeId: null as string | null, allowedStoreIds: null as string[] | null },
}
const resolveStoreForRequest = jest.fn(async () => storeClamp.current)
jest.mock('@/lib/app-api/store-clamp', () => ({
  resolveStoreForRequest: () => resolveStoreForRequest(),
}))

const customersList = jest.fn()
const karuteRecordsList = jest.fn()
const staffList = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({
    customers: { list: customersList },
    karuteRecords: { list: karuteRecordsList },
    staff: { list: staffList },
  }),
}))

import { GET } from '@/app/api/app/v1/karute/window/route'
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
const req = (qs = '') =>
  new Request(`https://s/api/app/v1/karute/window${qs}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer()}` },
  })
const route = { params: Promise.resolve({}) }

const TODAY = new Date().toISOString()
const KARUTE = [
  {
    id: 'rec-1',
    customer_id: 'cust-1',
    business_id: 'business-1',
    staff_id: 'auth-user-1',
    created_at: TODAY,
    session_date: TODAY,
    ai_summary: 'まとめ',
    transcript: null,
    entry_count: 1,
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  storeClamp.current = { storeId: null, allowedStoreIds: null }
  customersList.mockResolvedValue({
    customers: [{ id: 'cust-1', name: '山田 花子', created_at: '2026-01-01T00:00:00.000Z' }],
    total: 1,
  })
  staffList.mockResolvedValue({ staff: [] })
  karuteRecordsList.mockResolvedValue({ karute_records: KARUTE, total: 1 })
})

describe('GET /api/app/v1/karute/window', () => {
  it('missing customers.view → 403, no reads', async () => {
    capabilities.current = new Set()
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(karuteRecordsList).not.toHaveBeenCalled()
  })

  it('returns the KaruteWindowPage shape the action returns', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual([
      'freshStoreTotal',
      'hasMore',
      'items',
      'windowStart',
    ])
    expect(body.items).toHaveLength(1)
    expect(body.items[0].customerName).toBe('山田 花子')
    expect(body.freshStoreTotal).toBe(1)
    expect(body.hasMore).toBe(false)
  })

  it('EVERY read of the walk carries the clamped store — probe, page and total alike', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const res = await GET(req('?olderThan=2026-08-12&loadedCount=12'), route)
    expect(res.status).toBe(200)
    expect(karuteRecordsList.mock.calls.length).toBeGreaterThan(1)
    for (const [opts] of karuteRecordsList.mock.calls) {
      expect(opts.store_id).toBe('store-A')
    }
    // Customer read is clamped too (listAllCustomers consumes enforceStore
    // internally — what reaches the SDK is the store lens it decided on).
    expect(customersList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-A' }),
    )
  })

  it('a clamp failure is 403 BEFORE any data read (fail-closed)', async () => {
    // A REAL AppApiError, not a duck-typed Error carrying a `code` field: the
    // handler branches on `instanceof`, so the duck only ever proved the
    // generic 500 path. 403 EXACTLY — a 500 here would read to the client as
    // "retry later" instead of "this store is not yours".
    resolveStoreForRequest.mockRejectedValueOnce(
      new AppApiError('store_forbidden', 'store-id outside your assignment'),
    )
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(karuteRecordsList).not.toHaveBeenCalled()
  })

  it.each(['?olderThan=2026-8-1', '?olderThan=yesterday', '?month=2026-8', '?loadedCount=-3', '?loadedCount=abc'])(
    'malformed %s → 400, never a silently-ignored param',
    async (qs) => {
      const res = await GET(req(qs), route)
      expect(res.status).toBe(400)
      expect(karuteRecordsList).not.toHaveBeenCalled()
    },
  )

  // Greptile PR #779 P1: these are regex-VALID and calendar-IMPOSSIBLE. The
  // shape-only schema forwarded them into date arithmetic, where JS Date
  // mishandles them two different ways — 2026-02-30 rolls over to 2026-03-02
  // (a window nobody asked for, reported back as the boundary) and 2026-13
  // becomes an Invalid Date that throws inside the walk and lands in the
  // upstream catch as a 502. Both must be the SAME 400 as a malformed shape.
  it.each(['?month=2026-13', '?month=2026-00', '?olderThan=2026-02-30', '?olderThan=2026-13-01'])(
    'calendar-impossible %s → 400, never a rolled-over window or a 502',
    async (qs) => {
      const res = await GET(req(qs), route)
      expect(res.status).toBe(400)
      expect(karuteRecordsList).not.toHaveBeenCalled()
    },
  )

  it('a REAL leap date is accepted — the validator rejects impossible days, not unusual ones', async () => {
    const res = await GET(req('?olderThan=2028-02-29'), route)
    expect(res.status).toBe(200)
    expect(karuteRecordsList).toHaveBeenCalled()
  })

  it('an upstream failure is a 502, never an empty-but-200 chunk', async () => {
    karuteRecordsList.mockRejectedValue(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
  })
})
