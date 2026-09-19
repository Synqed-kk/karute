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
// The create route's roster clamp (only these profile ids are bookable) AND,
// since ⚖ fold round 2, the store scope's PLACEMENT check — a mutable ref
// rather than a per-test `mockResolvedValueOnce`, so an unconsumed queue entry
// can never leak into the next case (jest.clearAllMocks does not drain them).
const ROSTER = [
  { id: 'profile-1', full_name: 'Mika' },
  { id: 'auth-user-1', full_name: 'Viewer' },
]
const roster = { current: ROSTER as { id: string; full_name: string }[] }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
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

// customer_id/store_id echo the create input — createAppointmentCore reads
// its audit row's target off the create() return, same as the real client.
const apptCreate = jest.fn(async (input: { customer_id: string; store_id?: string | null }) => ({
  id: 'appt-new',
  customer_id: input.customer_id,
  store_id: input.store_id ?? null,
}))
// created_at (Fable fix-round FIX 1): the burn dedup window now anchors to
// min(starts_at, created_at) — set equal to starts_at here so every existing
// burn-window computation (the same-day cancel/no-show burn tests below) is
// unchanged.
const apptGet = jest.fn(async () => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  store_id: 'store-1',
  status: 'SCHEDULED',
  starts_at: '2026-07-20T02:00:00.000Z',
  created_at: '2026-07-20T02:00:00.000Z',
}))
const apptUpdate = jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-1' }))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  appointments: { create: apptCreate, get: apptGet, update: apptUpdate },
  packs: { listRecentRedemptions: jest.fn(async () => [] as { appointment_id: string }[]) },
  staffStores: { get: staffStoresGet },
  stores: {
    // ⚖ Liam 2026-09-16 (fold round 2): ONE store here. The front gate now
    // reads the unassigned verdict itself, and the verdict's third fact is the
    // store COUNT — with two stores this suite's default EMPTY assignment
    // would be the UNASSIGNED shape and every door below would 403 before
    // running. This salon has one store, so the default caller stays FLOATING
    // exactly as these tests were written. `stores.get` still validates the
    // store-id header, which is what the tenancy cases use.
    list: jest.fn(async () => ({
      stores: [{ id: 'store-A', name: '代官山', is_primary: true, active: true }],
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
import { auditLines } from './helpers/audit-lines'

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
const MENU_ID = '2c9f5e3a-70b6-4d84-a153-4e8f12cd96a7'

beforeEach(() => {
  jest.clearAllMocks()
  roster.current = ROSTER
  mockCapabilities.mockResolvedValue(new Set(['bookings.manage']))
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  listPacks.mockResolvedValue([])
  apptGet.mockResolvedValue({
    id: 'appt-1',
    customer_id: 'cust-1',
    store_id: 'store-1',
    status: 'SCHEDULED',
    starts_at: '2026-07-20T02:00:00.000Z',
    created_at: '2026-07-20T02:00:00.000Z',
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

  it('an over-long Idempotency-Key → 400, no write; the 200-char cap itself passes', async () => {
    const over = await createPOST(
      post(CREATE_URL, CREATE_BODY, { 'idempotency-key': 'k'.repeat(201) }),
      noParams,
    )
    expect(over.status).toBe(400)
    expect(apptCreate).not.toHaveBeenCalled()

    const atCap = await createPOST(
      post(CREATE_URL, CREATE_BODY, { 'idempotency-key': 'k'.repeat(200) }),
      noParams,
    )
    expect(atCap.status).toBe(201)
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

  it('non-roster staffProfileId → 400, never reaches the create-on-miss resolver', async () => {
    const { resolveSynqedStaffIdForBusiness } = jest.requireMock('@/lib/synqed/staff-map')
    const res = await createPOST(
      post(CREATE_URL, { ...CREATE_BODY, staffProfileId: 'cust-1' }),
      noParams,
    )
    expect(res.status).toBe(400)
    expect(resolveSynqedStaffIdForBusiness).not.toHaveBeenCalled()
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('out-of-hours booking → { error } BEFORE the resolver runs (no staff-mint side effect)', async () => {
    const { resolveSynqedStaffIdForBusiness } = jest.requireMock('@/lib/synqed/staff-map')
    // 03:00 JST — outside the default operating hours.
    const res = await createPOST(
      post(CREATE_URL, { ...CREATE_BODY, startTime: '2026-07-20T18:00:00.000Z' }),
      noParams,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).error).toMatch(/operating hours/)
    expect(resolveSynqedStaffIdForBusiness).not.toHaveBeenCalled()
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('a linked menuId passes .strict() and reaches core as menu_id', async () => {
    const res = await createPOST(
      post(CREATE_URL, { ...CREATE_BODY, menuId: MENU_ID }),
      noParams,
    )
    expect(res.status).toBe(201)
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ menu_id: MENU_ID }))
  })

  it('a non-uuid menuId → 400, no write', async () => {
    const res = await createPOST(
      post(CREATE_URL, { ...CREATE_BODY, menuId: 'cut' }),
      noParams,
    )
    expect(res.status).toBe(400)
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

  it('a FAILED pack read keeps the web contract: no_burnable_pack code, no write, no burn', async () => {
    listPacks.mockRejectedValueOnce(new Error('core down'))
    const res = await cancelPOST(
      post(URL_, { reason: 'cancel-same-day-contact', burnPack: true }),
      params('appt-1'),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe('no_burnable_pack')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
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
    // core #69, end to end: the REAL header on the request (`idem` above)
    // survives route → BookingActor → cancel core → store, so whatever key the
    // client sent is the key core will see.
    expect(addRedemption).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'test-key-1' }),
    )
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
    // Same end-to-end pin as the cancel twin above (core #69).
    expect(addRedemption).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'test-key-1' }),
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
      store_id: 'store-1',
      status: 'CANCELLED',
      starts_at: '2026-07-20T02:00:00.000Z',
      created_at: '2026-07-20T02:00:00.000Z',
    })
    const res = await restorePOST(post(URL_, undefined), params('appt-1'))
    expect(await res.json()).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledWith(
      'appt-1',
      expect.objectContaining({ status: 'SCHEDULED' }),
    )
  })
})

// ── ⚖ THE STORE LOCK'S WIRING, PER BOOKING ROUTE (fold round 2, F1) ────────
// store-write-locks.test.ts pins the five CORES with a hand-built scope. What
// nothing pinned was these three routes RESOLVING one and handing it over:
// a blind round proved that giving any of the three an unclamped scope left
// the whole 638-suite battery green. Each case below fails if its own route
// stops resolving the clamp.
//
// The refusal is the core's result, and these routes return it VERBATIM at
// HTTP 200 (RPC-style — the sheet branches on `code`/`burnError`, so an
// HTTP-normalised error would lose the discriminators). There is no 404 on
// this transport for a missing id either, which is exactly why byte-identity
// is asserted against a real missing-id response rather than against a status
// code.
describe('booking facade routes — the store lock is wired, on each route', () => {
  const FOREIGN = { store_ids: ['store-other'] }
  const call = {
    cancel: () => cancelPOST(post('https://s/x', {}), params('appt-1')),
    'no-show': () => noShowPOST(post('https://s/x', { burnPack: false }), params('appt-1')),
    restore: () => restorePOST(post('https://s/x', undefined), params('appt-1')),
  } as const
  const missing = {
    cancel: () => cancelPOST(post('https://s/x', {}), params('appt-gone')),
    'no-show': () => noShowPOST(post('https://s/x', { burnPack: false }), params('appt-gone')),
    restore: () => restorePOST(post('https://s/x', undefined), params('appt-gone')),
  } as const

  for (const route of ['cancel', 'no-show', 'restore'] as const) {
    it(`${route}: a clamped caller + another store's booking → refused, nothing written`, async () => {
      staffStoresGet.mockResolvedValue(FOREIGN) // the booking lives in store-1
      const res = await call[route]()
      expect(await res.json()).toEqual({ error: 'Appointment not found' })
      expect(apptUpdate).not.toHaveBeenCalled()
      expect(addRedemption).not.toHaveBeenCalled()
    })

    it(`${route}: that refusal is byte-identical to a genuinely missing id`, async () => {
      staffStoresGet.mockResolvedValue(FOREIGN)
      const refused = await call[route]()
      const refusedBody = await refused.json()

      staffStoresGet.mockResolvedValue({ store_ids: [] })
      apptGet.mockRejectedValueOnce(
        Object.assign(new Error('Appointment not found'), { status: 404 }),
      )
      const gone = await missing[route]()
      expect(refused.status).toBe(gone.status)
      expect(refusedBody).toEqual(await gone.json())
    })

    it(`${route}: a clamped caller inside the booking's own store still writes`, async () => {
      staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
      if (route === 'restore') {
        apptGet.mockResolvedValue({
          id: 'appt-1',
          customer_id: 'cust-1',
          store_id: 'store-1',
          status: 'CANCELLED',
          starts_at: '2026-07-20T02:00:00.000Z',
          created_at: '2026-07-20T02:00:00.000Z',
        })
      }
      const res = await call[route]()
      expect(await res.json()).toMatchObject({ success: true })
      expect(apptUpdate).toHaveBeenCalledTimes(1)
    })

    // ⚖ fold round 2, F4: core answers `{ store_ids: [] }` for an auth id it
    // holds no staff row for — indistinguishable from genuinely floating
    // staff — so the route places the caller first and refuses if it cannot.
    it(`${route}: a caller with NO roster row is refused, never treated as floating`, async () => {
      roster.current = []
      const res = await call[route]()
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('store_forbidden')
      expect(apptUpdate).not.toHaveBeenCalled()
    })
  }
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

// Booking mutations now audit from the shared cores (Liam ruling
// 2026-07-26). These pin the facade-specific half of the single-write
// contract: source:'facade', identity off ctx.identity (not a re-lookup),
// and — the point of routing the emit through the core instead of
// FACADE_AUDIT_MAP — EXACTLY ONE row per request (a second row here would
// mean the map's 'skip' rows regressed and the write is double-logging).
describe('booking mutation facade routes — audit (single-write, no double-log)', () => {
  it('create → exactly one booking.create row, source facade', async () => {
    const lines = await auditLines(async () => {
      const res = await createPOST(post(CREATE_URL, CREATE_BODY), noParams)
      expect(res.status).toBe(201)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.create',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_type: 'customer',
      target_id: 'cust-1',
      source: 'facade',
    })
  })

  it('cancel → exactly one booking.cancel row, source facade', async () => {
    const lines = await auditLines(async () => {
      const res = await cancelPOST(post('https://s/api/app/v1/appointments/appt-1/cancel', {}), params('appt-1'))
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.cancel',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'cust-1',
      source: 'facade',
    })
  })

  it('no-show → exactly one booking.no_show row, source facade', async () => {
    const lines = await auditLines(async () => {
      const res = await noShowPOST(
        post('https://s/api/app/v1/appointments/appt-1/no-show', { burnPack: false }),
        params('appt-1'),
      )
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.no_show',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'cust-1',
      source: 'facade',
    })
  })

  it('restore → exactly one booking.restore row, source facade', async () => {
    apptGet.mockResolvedValue({
      id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      status: 'CANCELLED',
      starts_at: '2026-07-20T02:00:00.000Z',
      created_at: '2026-07-20T02:00:00.000Z',
    })
    const lines = await auditLines(async () => {
      const res = await restorePOST(post('https://s/api/app/v1/appointments/appt-1/restore', undefined), params('appt-1'))
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.restore',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'cust-1',
      source: 'facade',
    })
  })
})
