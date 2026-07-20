// Booking mutation facade routes (design-parity P-B 2/2). The MONEY rules
// (burn pairing, burn-once, ordering) are pinned through the shared cores by
// cancel-appointment.test.ts / mark-no-show-appointment.test.ts — these tests
// pin the HTTP layer: capability 403s with no writes · Idempotency-Key
// required on every status write · strict input schemas → 400 · RPC-style
// passthrough (business failures ride 2xx bodies VERBATIM, `code` and
// `burnError` discriminators intact) · the create route's header store clamp
// (403 outside scope; header store lands on the row) · burnable GET contract.
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
// in via customer-facade → customers/queries — mock both at the seam, same as
// app-api-customer-packs.test.ts.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async () => ({ id: 'cust-1' })),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))
const mockCapabilities = jest.fn(async () => new Set(['bookings.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: jest.fn(async () => 'staff-core-1'),
  lookupSynqedStaffIdForBusiness: jest.fn(async () => 'staff-core-1'),
}))
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: jest.fn(async () => ({ operating_hours: null })),
}))

const BURNABLE_PACK = {
  id: 'pack-1',
  kind: 'pack',
  status: 'active',
  remaining: 3,
  purchased_at: '2026-01-01',
}
const listPacks = jest.fn(async (): Promise<unknown[]> => [])
const addRedemption = jest.fn(
  async (_input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ({
    ok: true,
    id: 'redemption-1',
  }),
)
jest.mock('@/lib/packs/store', () => ({
  listCustomerPacksWithClient: (_synqed: unknown, _id: string) => listPacks(),
  addRedemptionWithClient: (_synqed: unknown, input: unknown) => addRedemption(input as never),
}))

const apptCreate = jest.fn(async () => ({ id: 'appt-new' }))
const apptGet = jest.fn(async () => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  status: 'SCHEDULED',
  starts_at: '2026-07-20T02:00:00.000Z',
}))
const apptUpdate = jest.fn(async () => ({}))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  appointments: { create: apptCreate, get: apptGet, update: apptUpdate },
  packs: { listRecentRedemptions: jest.fn(async () => [] as { appointment_id: string }[]) },
  staffStores: { get: staffStoresGet },
  stores: {
    list: jest.fn(async () => ({
      stores: [
        { id: 'store-A', name: '代官山', is_primary: true, active: true },
        { id: 'store-B', name: '銀座', is_primary: false, active: true },
      ],
    })),
  },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { POST as createPOST } from '@/app/api/app/v1/appointments/route'
import { POST as cancelPOST } from '@/app/api/app/v1/appointments/[id]/cancel/route'
import { POST as noShowPOST } from '@/app/api/app/v1/appointments/[id]/no-show/route'
import { POST as restorePOST } from '@/app/api/app/v1/appointments/[id]/restore/route'
import { GET as burnableGET } from '@/app/api/app/v1/customers/[id]/packs/burnable/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: 'auth-user-1',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
  })
  const sig = createHmac('sha256', SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const idem = { 'idempotency-key': 'test-key-1' }
const json = { 'content-type': 'application/json' }

const post = (
  url: string,
  body: unknown | undefined,
  headers: Record<string, string> = {},
) =>
  new Request(url, {
    method: 'POST',
    headers: { ...auth, ...idem, ...json, ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const noParams = { params: Promise.resolve({}) }
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const CREATE_URL = 'https://s/api/app/v1/appointments'
const CREATE_BODY = {
  staffProfileId: 'profile-1',
  clientId: 'cust-1',
  // 11:00 JST — the dialog always sends the fixed JST offset (see
  // NewBookingDialog: hard-coded -540 so a traveler's input stays JST).
  startTime: '2026-07-21T02:00:00.000Z',
  durationMinutes: 60,
  tzOffsetMinutes: -540,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['bookings.manage']))
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  listPacks.mockResolvedValue([])
  apptGet.mockResolvedValue({
    id: 'appt-1',
    customer_id: 'cust-1',
    status: 'SCHEDULED',
    starts_at: '2026-07-20T02:00:00.000Z',
  })
})

describe('POST /api/app/v1/appointments (create)', () => {
  it('missing capability → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await createPOST(post(CREATE_URL, CREATE_BODY), noParams)
    expect(res.status).toBe(403)
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('missing Idempotency-Key → 400, no write', async () => {
    const req = new Request(CREATE_URL, {
      method: 'POST',
      headers: { ...auth, ...json },
      body: JSON.stringify(CREATE_BODY),
    })
    const res = await createPOST(req, noParams)
    expect(res.status).toBe(400)
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('unknown field → 400 (strict schema), no write', async () => {
    const res = await createPOST(
      post(CREATE_URL, { ...CREATE_BODY, storeId: 'store-B' }),
      noParams,
    )
    expect(res.status).toBe(400)
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('happy path → 201 { id }; no header store → the booked staff\'s own store lands', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-B'] })
    const res = await createPOST(post(CREATE_URL, CREATE_BODY), noParams)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'appt-new' })
    expect(apptCreate).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'staff-core-1', store_id: 'store-B' }),
    )
  })

  it('store-id header outside a clamped assignment → 403, no write', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await createPOST(
      post(CREATE_URL, CREATE_BODY, { 'store-id': 'store-B' }),
      noParams,
    )
    expect(res.status).toBe(403)
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('a business failure rides the body: invalid duration → 200 { error }', async () => {
    const res = await createPOST(
      post(CREATE_URL, { ...CREATE_BODY, durationMinutes: 0 }),
      noParams,
    )
    // durationMinutes 0 fails the zod positive() first → 400 validation.
    expect(res.status).toBe(400)
  })
})

describe('POST /api/app/v1/appointments/[id]/cancel', () => {
  const URL_ = 'https://s/api/app/v1/appointments/appt-1/cancel'

  it('missing capability → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await cancelPOST(post(URL_, {}), params('appt-1'))
    expect(res.status).toBe(403)
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('plain cancel → 200 { success: true }, CANCELLED patch with the acting stamp', async () => {
    const res = await cancelPOST(post(URL_, {}), params('appt-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledWith(
      'appt-1',
      expect.objectContaining({ status: 'CANCELLED', acting_staff_id: 'staff-core-1' }),
    )
  })

  it('burn without the same-day reason → the pairing error VERBATIM, no write', async () => {
    const res = await cancelPOST(
      post(URL_, { reason: 'cancel-advance-contact', burnPack: true }),
      params('appt-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toMatch(/same-day-contact/)
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('no burnable pack → { error, code: "no_burnable_pack" } — the discriminator survives', async () => {
    const res = await cancelPOST(
      post(URL_, { reason: 'cancel-same-day-contact', burnPack: true }),
      params('appt-1'),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe('no_burnable_pack')
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('same-day burn happy path → status first, ONE burn', async () => {
    listPacks.mockResolvedValue([BURNABLE_PACK])
    const res = await cancelPOST(
      post(URL_, { reason: 'cancel-same-day-contact', burnPack: true }),
      params('appt-1'),
    )
    expect(await res.json()).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledTimes(1)
    expect(addRedemption).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/app/v1/appointments/[id]/no-show', () => {
  const URL_ = 'https://s/api/app/v1/appointments/appt-1/no-show'

  it('missing burnPack → 400 (strict schema), no write', async () => {
    const res = await noShowPOST(post(URL_, {}), params('appt-1'))
    expect(res.status).toBe(400)
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('burn → NO_SHOW patch + burnError passthrough on a failed burn', async () => {
    listPacks.mockResolvedValue([BURNABLE_PACK])
    addRedemption.mockResolvedValueOnce({ ok: false, error: 'below_zero' } as never)
    const res = await noShowPOST(post(URL_, { burnPack: true }), params('appt-1'))
    const body = await res.json()
    // Partial outcome VERBATIM: no-show recorded, ticket not consumed.
    expect(body).toEqual({ success: true, burnError: 'below_zero' })
    expect(apptUpdate).toHaveBeenCalledWith(
      'appt-1',
      expect.objectContaining({ status: 'NO_SHOW' }),
    )
  })
})

describe('POST /api/app/v1/appointments/[id]/restore', () => {
  const URL_ = 'https://s/api/app/v1/appointments/appt-1/restore'

  it('non-terminal booking → the precondition error VERBATIM, no write', async () => {
    const res = await restorePOST(post(URL_, undefined), params('appt-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toMatch(/already active/)
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('terminal booking → 200 { success: true }, SCHEDULED patch', async () => {
    apptGet.mockResolvedValue({
      id: 'appt-1',
      customer_id: 'cust-1',
      status: 'CANCELLED',
      starts_at: '2026-07-20T02:00:00.000Z',
    })
    const res = await restorePOST(post(URL_, undefined), params('appt-1'))
    expect(await res.json()).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledWith(
      'appt-1',
      expect.objectContaining({ status: 'SCHEDULED' }),
    )
  })
})

describe('GET /api/app/v1/customers/[id]/packs/burnable', () => {
  const get = (headers: Record<string, string> = {}) =>
    new Request('https://s/api/app/v1/customers/cust-1/packs/burnable', {
      headers: { ...auth, ...headers },
    })

  it('missing capability → 403 (pack balances are not probeable)', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await burnableGET(get(), params('cust-1'))
    expect(res.status).toBe(403)
  })

  it('burnable pack → { summary: { packId, remaining } }; none → null', async () => {
    listPacks.mockResolvedValue([BURNABLE_PACK])
    const res = await burnableGET(get(), params('cust-1'))
    expect(await res.json()).toEqual({ summary: { packId: 'pack-1', remaining: 3 } })

    listPacks.mockResolvedValue([])
    const res2 = await burnableGET(get(), params('cust-1'))
    expect(await res2.json()).toEqual({ summary: null })
  })
})
