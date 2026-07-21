// Stores facade routes (design-parity packet 12 §B-3 S2). Pins: GET list is
// 'stores.viewAll'-gated (a new callable Bearer surface, deliberately
// tighter than web's ungated listStores() action) · list+counts merge
// parity via the SAME listStoresWithClient twin the web action delegates to
// · the GET route shares web's lazy 本店-create (byte-parity, 810e4b6d): an
// empty list provisions the primary store exactly once (name resolved from
// profiles), a race-lost create is swallowed, a non-empty list never
// creates · POST/PATCH require the owner role (roster + resolved Bearer
// identity) with a standard facade 403 on denial, NOT a soft 200 { error } ·
// Idempotency-Key required on create, not on update · STORE_LIMIT_REACHED
// when the entitlement cap is armed and reached · exactly one audit row per
// successful write, and none on a denied/failed write · an unknown/
// out-of-tenant update id writes nothing.
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
// The @synqed-kk/client package is ESM (jest node20 can't parse it) and rides
// in via the create route's requireIdempotencyKey import → customer-facade →
// customers/queries — mock both at the seam, same as
// app-api-appointments-mutations.test.ts / app-api-customer-packs.test.ts.
// Stores never touch customers, so getCustomerWithClient is unused here.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async () => ({ id: 'unused' })),
}))

// The lazy 本店-create's name resolver (primaryStoreName) reads the oldest
// profile row via createServiceClient — same chainable-builder mock shape as
// action-audit.test.ts's profileRow.
let profileRow: { full_name: string | null } | null = { full_name: 'テストサロン' }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: profileRow })
    return { from: () => builder }
  },
}))

const mockCapabilities = jest.fn(async () => new Set(['stores.viewAll']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

const storesList = jest.fn(async () => ({ stores: [] as Record<string, unknown>[] }))
const storesCreate = jest.fn(async (input: Record<string, unknown>) => ({
  id: 'store-new',
  ...input,
}))
const storesUpdate = jest.fn(async () => ({}))
const staffStoresCounts = jest.fn(async () => ({ counts: {} as Record<string, number> }))
const customersCountsByStore = jest.fn(async () => ({ counts: {} as Record<string, number> }))
const entitlementsGet = jest.fn(async () => ({ tier: 'professional', is_unlimited: false }))
const fakeClient = {
  stores: { list: storesList, create: storesCreate, update: storesUpdate },
  staffStores: { counts: staffStoresCounts },
  customers: { countsByStore: customersCountsByStore },
  entitlements: { get: entitlementsGet },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET as listGET, POST as createPOST } from '@/app/api/app/v1/stores/route'
import { PATCH as updatePATCH } from '@/app/api/app/v1/stores/[id]/route'
import { auditLines } from './helpers/audit-lines'

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
const noParams = { params: Promise.resolve({}) }
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const VALID_INPUT = { name: '渋谷店', address: '', phone: '', business_type: 'esthetic_salon' }

const getReq = (headers: Record<string, string> = {}) =>
  new Request('https://s/api/app/v1/stores', { headers: { ...auth, ...headers } })
const postReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://s/api/app/v1/stores', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': 'test-key-1', ...headers },
    body: JSON.stringify(body),
  })
const patchReq = (body: unknown) =>
  new Request('https://s/api/app/v1/stores/store-7', {
    method: 'PATCH',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.KARUTE_BILLING_ENFORCEMENT
  mockCapabilities.mockResolvedValue(new Set(['stores.viewAll']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
  ])
  storesList.mockResolvedValue({ stores: [] })
  storesCreate.mockResolvedValue({ id: 'store-new' })
  storesUpdate.mockResolvedValue({})
  staffStoresCounts.mockResolvedValue({ counts: {} })
  customersCountsByStore.mockResolvedValue({ counts: {} })
  entitlementsGet.mockResolvedValue({ tier: 'professional', is_unlimited: false })
  profileRow = { full_name: 'テストサロン' }
})

describe('GET /api/app/v1/stores', () => {
  it('missing Bearer → 401, no read', async () => {
    const res = await listGET(new Request('https://s/api/app/v1/stores'), noParams)
    expect(res.status).toBe(401)
    expect(storesList).not.toHaveBeenCalled()
  })

  it('missing stores.viewAll → 403, no read', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await listGET(getReq(), noParams)
    expect(res.status).toBe(403)
    expect(storesList).not.toHaveBeenCalled()
  })

  it('happy path → 200 { stores }, list+counts merged', async () => {
    storesList.mockResolvedValue({
      stores: [
        { id: 'store-A', name: '代官山', address: null, phone: null, is_primary: true, active: true },
      ],
    })
    staffStoresCounts.mockResolvedValue({ counts: { 'store-A': 3 } })
    customersCountsByStore.mockResolvedValue({ counts: { 'store-A': 12 } })
    const res = await listGET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stores).toEqual([
      {
        id: 'store-A',
        name: '代官山',
        address: null,
        phone: null,
        isPrimary: true,
        active: true,
        staffCount: 3,
        customerCount: 12,
        businessType: null,
      },
    ])
  })

  it('an empty list creates the 本店 primary exactly once, name resolved from profiles, then returns the re-listed rows', async () => {
    storesList
      .mockResolvedValueOnce({ stores: [] })
      .mockResolvedValueOnce({
        stores: [
          { id: 'store-primary', name: 'テストサロン', address: null, phone: null, is_primary: true, active: true },
        ],
      })
    const res = await listGET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect(storesCreate).toHaveBeenCalledTimes(1)
    expect(storesCreate).toHaveBeenCalledWith({ name: 'テストサロン', is_primary: true })
    expect((await res.json()).stores).toEqual([
      {
        id: 'store-primary',
        name: 'テストサロン',
        address: null,
        phone: null,
        isPrimary: true,
        active: true,
        staffCount: 0,
        customerCount: 0,
        businessType: null,
      },
    ])
  })

  it('a create rejection (race lost to another request) still returns the re-listed rows, no error', async () => {
    storesList
      .mockResolvedValueOnce({ stores: [] })
      .mockResolvedValueOnce({
        stores: [
          { id: 'store-winner', name: '別リクエスト', address: null, phone: null, is_primary: true, active: true },
        ],
      })
    storesCreate.mockRejectedValueOnce(new Error('duplicate primary'))
    const res = await listGET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toBeUndefined()
    expect(body.stores).toHaveLength(1)
    expect(body.stores[0].id).toBe('store-winner')
  })

  it('a non-empty list never creates', async () => {
    storesList.mockResolvedValue({
      stores: [{ id: 'store-A', name: '代官山', address: null, phone: null, is_primary: true, active: true }],
    })
    const res = await listGET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect(storesCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/app/v1/stores (create)', () => {
  it('missing Bearer → 401, no write', async () => {
    const res = await createPOST(
      new Request('https://s/api/app/v1/stores', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
        body: JSON.stringify(VALID_INPUT),
      }),
      noParams,
    )
    expect(res.status).toBe(401)
    expect(storesCreate).not.toHaveBeenCalled()
  })

  it('missing Idempotency-Key → 400, no write', async () => {
    const res = await createPOST(
      new Request('https://s/api/app/v1/stores', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(VALID_INPUT),
      }),
      noParams,
    )
    expect(res.status).toBe(400)
    expect(storesCreate).not.toHaveBeenCalled()
  })

  it('non-owner → 403 (standard facade throw, not a soft { error } 200), no write', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
    ])
    const res = await createPOST(postReq(VALID_INPUT), noParams)
    expect(res.status).toBe(403)
    expect(storesCreate).not.toHaveBeenCalled()
  })

  it('validation reject (empty name) → business-level { error } rides the 2xx body, no write', async () => {
    const res = await createPOST(postReq({ ...VALID_INPUT, name: '' }), noParams)
    expect(res.status).toBe(200)
    expect((await res.json()).error).toBeTruthy()
    expect(storesCreate).not.toHaveBeenCalled()
  })

  it('STORE_LIMIT_REACHED when the entitlement cap is armed and reached', async () => {
    process.env.KARUTE_BILLING_ENFORCEMENT = 'on'
    entitlementsGet.mockResolvedValue({ tier: 'free', is_unlimited: false })
    storesList.mockResolvedValue({ stores: [{ id: 'store-A', name: 'x', is_primary: true, active: true }] })
    const res = await createPOST(postReq(VALID_INPUT), noParams)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'STORE_LIMIT_REACHED' })
    expect(storesCreate).not.toHaveBeenCalled()
  })

  it('happy path → 201 { id }, exactly one settings.store_create audit row', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await createPOST(postReq(VALID_INPUT), noParams)
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'store-new' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'settings',
      action: 'settings.store_create',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_type: 'store',
      target_id: 'store-new',
      source: 'facade',
    })
  })

  it('a denied (non-owner) write emits no audit row', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
    ])
    const lines = await auditLines(async () => {
      await createPOST(postReq(VALID_INPUT), noParams)
    })
    expect(lines).toHaveLength(0)
  })
})

describe('PATCH /api/app/v1/stores/[id] (update)', () => {
  it('missing Bearer → 401, no write', async () => {
    const res = await updatePATCH(
      new Request('https://s/api/app/v1/stores/store-7', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_INPUT),
      }),
      params('store-7'),
    )
    expect(res.status).toBe(401)
    expect(storesUpdate).not.toHaveBeenCalled()
  })

  it('non-owner → 403, no write', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
    ])
    const res = await updatePATCH(patchReq(VALID_INPUT), params('store-7'))
    expect(res.status).toBe(403)
    expect(storesUpdate).not.toHaveBeenCalled()
  })

  it('happy path → 200 { ok: true }, exactly one settings.store_update audit row', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await updatePATCH(patchReq(VALID_INPUT), params('store-7'))
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'settings.store_update',
      target_id: 'store-7',
      source: 'facade',
    })
  })

  it('an unknown/out-of-tenant id does not write and emits no audit row', async () => {
    storesUpdate.mockRejectedValueOnce(new Error('not found'))
    const lines = await auditLines(async () => {
      const res = await updatePATCH(patchReq(VALID_INPUT), params('store-missing'))
      expect(res.status).toBe(200)
      expect((await res.json()).error).toBeTruthy()
    })
    expect(lines).toHaveLength(0)
  })
})
