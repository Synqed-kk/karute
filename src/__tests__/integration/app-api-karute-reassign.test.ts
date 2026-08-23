// Facade POST /karute/[id]/reassign (F4, packet §2c). Pins:
//   1. RBAC: missing records.reassign → 403, no read/write.
//   2. Store clamp: resolveStoreForRequest's assignment refuses an
//      out-of-store to-customer; a viewAll actor is unaffected.
//   3. Two-phase: confirmed:false → 200 { requires_confirm: true, ... },
//      NEVER calls karuteRecords.update.
//   4. Write shape: EXACTLY { customer_id: toId }.
//   5. Audit: karute.customer_reassign fires exactly once on the confirmed
//      write via the generic success hook (ctx.auditTargetId/auditDetail);
//      the preview phase (ctx.auditSuppress='preview') emits NOTHING; a
//      refusal emits nothing.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  // toCustomerInScope's lazy import of list-all.ts mints an
  // unstable_cache(...) instance at module scope.
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

const auditSpy = jest.fn()
// Spread the REAL module so FACADE_AUDIT_MAP stays live inside logFacadeAudit
// (same reasoning as app-api-karute-summary-edit.test.ts) — only the emitter
// primitive is stubbed.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => auditSpy(...(a as [])),
}))

// Store clamp mocked directly (same idiom as the web test's
// resolveStoreScope mock) — precise per-test control without a
// stores/staffStores fixture graph.
const storeClamp = { current: { storeId: null as string | null, allowedStoreIds: null as string[] | null } }
const resolveStoreForRequest = jest.fn(async () => storeClamp.current)
jest.mock('@/lib/app-api/store-clamp', () => ({
  resolveStoreForRequest: () => resolveStoreForRequest(),
}))

// store_id: 'store-A' by default — the clamped-actor fixtures below are
// assigned to store-A, so pre-existing pins stay in scope. R3-1/R5-1 tests
// override per-case ('store-B' foreign, null unlabeled — R5-1 fail-closed).
const KARUTE = { current: { id: 'kar-1', customer_id: 'cust-FROM', appointment_id: null, recording_session_id: null, store_id: 'store-A' } as Record<string, unknown> }
const CUSTOMERS: Record<string, { id: string; name: string }> = {
  'cust-FROM': { id: 'cust-FROM', name: '田中 美咲' },
  'cust-TO': { id: 'cust-TO', name: '佐藤 花子' },
  'cust-OTHER-STORE': { id: 'cust-OTHER-STORE', name: '他店 太郎' },
}
const karuteGet = jest.fn(async (id: string) => {
  if (id !== 'kar-1') throw Object.assign(new Error('not found'), { status: 404 })
  return KARUTE.current
})
const karuteUpdate = jest.fn(async (_id: string, _input: { customer_id: string }) => ({}))
const customersGet = jest.fn(async (id: string) => {
  const c = CUSTOMERS[id]
  if (!c) throw Object.assign(new Error('not found'), { status: 404 })
  return c
})
const customersList = jest.fn(async (opts: { store_id?: string }) => {
  const byStore: Record<string, string[]> = { 'store-A': ['cust-TO'], 'store-B': ['cust-OTHER-STORE'] }
  const ids = opts.store_id ? (byStore[opts.store_id] ?? []) : Object.keys(CUSTOMERS)
  return { customers: ids.map((id) => ({ id, name: CUSTOMERS[id].name })), total: ids.length }
})
const packsListRedemptions = jest.fn(async (): Promise<Array<Record<string, unknown>>> => [])
const customersListPhotos = jest.fn(async () => ({ photos: [] }))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({
    karuteRecords: { get: (id: string) => karuteGet(id), update: karuteUpdate },
    customers: { get: customersGet, list: customersList, listPhotos: customersListPhotos },
    packs: { listRedemptions: packsListRedemptions },
  }),
}))

import { POST } from '@/app/api/app/v1/karute/[id]/reassign/route'

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
const postReq = (body: unknown) =>
  new Request('https://s/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${bearer()}` },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.reassign'])
  storeClamp.current = { storeId: null, allowedStoreIds: null } // viewAll-shaped by default
  KARUTE.current = { id: 'kar-1', customer_id: 'cust-FROM', appointment_id: null, recording_session_id: null, store_id: 'store-A' }
})

describe('POST /karute/[id]/reassign', () => {
  it('missing records.reassign → 403, no read/write', async () => {
    capabilities.current = new Set()
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(karuteGet).not.toHaveBeenCalled()
    expect(karuteUpdate).not.toHaveBeenCalled()
  })

  it('confirmed:false → 200 requires_confirm, NEVER calls karuteRecords.update, emits nothing (auditSuppress=preview)', async () => {
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: false }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      requires_confirm: true,
      from_customer_id: 'cust-FROM',
      from_name: '田中 美咲',
      to_name: '佐藤 花子',
      linked_burn_count: 0,
      same_day_burn_count: 0,
      photo_count: 0,
    })
    expect(karuteUpdate).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('confirmed:true → 200, writes EXACTLY { customer_id: toId }, emits karute.customer_reassign exactly once (R11-1: response body AND audit detail both carry linked_burn_count + same_day_burn_count)', async () => {
    // Distinct nonzero values in both buckets — one link-shaped burn, one
    // same-day-only burn — so a swap between the two keys, not just a drop,
    // flips this exact-shape pin too.
    KARUTE.current = { ...KARUTE.current, session_date: '2026-08-01' }
    packsListRedemptions.mockResolvedValueOnce([
      { pack_id: 'p1', redeemed_on: '2026-08-01', karute_record_id: 'kar-1' },
      { pack_id: 'p2', redeemed_on: '2026-08-01' },
    ])
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // R11-1 (fix round 11, Greptile round-6 closure): the response body
    // (UI contract) now carries BOTH counts too — the confirm panel needs
    // linkedBurnCount vs sameDayBurnCount to render the right copy branch.
    expect(body).toMatchObject({ linked_burn_count: 1, same_day_burn_count: 1, photo_count: 0 })
    expect(karuteUpdate).toHaveBeenCalledTimes(1)
    expect(karuteUpdate).toHaveBeenCalledWith('kar-1', { customer_id: 'cust-TO' })
    expect(auditSpy).toHaveBeenCalledTimes(1)
    // R3-2: burn_count → same_day_burn_count. R11-1: split further into
    // linked_burn_count + same_day_burn_count (red-run: emit the old
    // single-key shape, or swap the two → this pin goes red).
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.customer_reassign',
        actorId: 'auth-user-1',
        businessId: 'business-1',
        targetType: 'karute',
        targetId: 'kar-1',
        source: 'facade',
        detail: {
          from_customer_id: 'cust-FROM',
          to_customer_id: 'cust-TO',
          linked_burn_count: 1,
          same_day_burn_count: 1,
          photo_count: 0,
        },
      }),
    )
  })

  it('store clamp: an out-of-store to-customer is refused → 403, no write, no audit', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const res = await POST(postReq({ to_customer_id: 'cust-OTHER-STORE', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(karuteUpdate).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('store clamp: a viewAll actor (stores.viewAll capability) reaches the SAME out-of-store target', async () => {
    capabilities.current = new Set(['records.reassign', 'stores.viewAll'])
    storeClamp.current = { storeId: null, allowedStoreIds: null }
    const res = await POST(postReq({ to_customer_id: 'cust-OTHER-STORE', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect(karuteUpdate).toHaveBeenCalledWith('kar-1', { customer_id: 'cust-OTHER-STORE' })
  })

  // R3-1 (fix round 3, Greptile issue 1 — REAL): the SOURCE karute record's
  // own store, proven regardless of what the request's to_customer_id is.
  // R9-2 (fix round 9, existence-oracle class): status CHANGED 403 → 404 —
  // store_forbidden let a clamped actor distinguish this from a genuinely
  // nonexistent karute id (both used to 404). Now byte-identical (see the
  // comparison pin below).
  it('R9-2 (was R3-1): clamped actor + an out-of-store SOURCE record → 404, no write, no audit (confirmed:true)', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(404)
    expect(karuteUpdate).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('R9-2 (was R3-1): clamped actor + an out-of-store SOURCE record → 404 on the PREVIEW phase too (confirmed:false) — the leak-close half', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: false }), routeFor('kar-1'))
    expect(res.status).toBe(404)
    expect(karuteUpdate).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  // R5-1: flips the round-3 "ALLOWED" pin — null-store now fails closed for
  // a clamped actor (membership unprovable). R9-2: status CHANGED 403 → 404,
  // same reasoning as the two pins above.
  it('R9-2 (was R5-1): null-store SOURCE record + clamped actor is REFUSED → 404, no write, no audit', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: null }
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(404)
    expect(karuteUpdate).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  // R9-1/R9-2 (fix round 9, Greptile round-5 3/5) — existence-oracle class.
  it('pin 3: clamped + out-of-store karute id vs clamped + nonexistent karute id → byte-identical response (facade POST)', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const outOfStore = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-1'))
    const outOfStoreBody = await outOfStore.json()
    const nonexistent = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-DOES-NOT-EXIST'))
    const nonexistentBody = await nonexistent.json()
    expect(outOfStore.status).toBe(404)
    expect(nonexistent.status).toBe(404)
    expect(outOfStoreBody).toEqual(nonexistentBody)
  })

  it('pin 1: clamped + nonexistent to-id vs clamped + exists-in-other-store to-id → byte-identical response (facade POST)', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    const nonexistent = await POST(postReq({ to_customer_id: 'cust-DOES-NOT-EXIST', confirmed: true }), routeFor('kar-1'))
    const nonexistentBody = await nonexistent.json()
    const existsElsewhere = await POST(postReq({ to_customer_id: 'cust-OTHER-STORE', confirmed: true }), routeFor('kar-1'))
    const existsElsewhereBody = await existsElsewhere.json()
    expect(nonexistent.status).toBe(403)
    expect(existsElsewhere.status).toBe(403)
    expect(nonexistentBody).toEqual(existsElsewhereBody)
  })

  it('pin 2: no customers.get for an out-of-scope destination — the clamp refuses before any lookup (facade POST)', async () => {
    storeClamp.current = { storeId: 'store-A', allowedStoreIds: ['store-A'] }
    await POST(postReq({ to_customer_id: 'cust-OTHER-STORE', confirmed: true }), routeFor('kar-1'))
    expect(customersGet).not.toHaveBeenCalled()
  })

  it('R3-1: viewAll actor + an out-of-store SOURCE record is ALLOWED', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    capabilities.current = new Set(['records.reassign', 'stores.viewAll'])
    storeClamp.current = { storeId: null, allowedStoreIds: null }
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect(karuteUpdate).toHaveBeenCalledWith('kar-1', { customer_id: 'cust-TO' })
  })

  it('same-customer no-op → 400, no write', async () => {
    const res = await POST(postReq({ to_customer_id: 'cust-FROM', confirmed: true }), routeFor('kar-1'))
    expect(res.status).toBe(400)
    expect(karuteUpdate).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('foreign/missing karute id → 404 before any write', async () => {
    const res = await POST(postReq({ to_customer_id: 'cust-TO', confirmed: true }), routeFor('kar-OTHER'))
    expect(res.status).toBe(404)
    expect(karuteUpdate).not.toHaveBeenCalled()
  })

  it('an unknown body key is rejected by the strict schema (400)', async () => {
    const res = await POST(
      postReq({ to_customer_id: 'cust-TO', confirmed: true, entries: [{ smuggled: true }] }),
      routeFor('kar-1'),
    )
    expect(res.status).toBe(400)
    expect(karuteUpdate).not.toHaveBeenCalled()
  })
})
