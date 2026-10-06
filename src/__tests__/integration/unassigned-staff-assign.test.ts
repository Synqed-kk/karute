// PR-B part 2 — assigning the staff of a 担当未定 booking. The facade door
// (POST /api/app/v1/appointments/[id]/assign-staff) and the web action share
// updateAppointmentCore, so the staff check (active · this business · works at
// the booking's store) is pinned once on the core and once through the door.
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
jest.mock('@/lib/customers/queries', () => ({ getCustomerWithClient: jest.fn(async () => ({ id: 'cust-1' })) }))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: 'Viewer' }]),
}))
const mockCapabilities = jest.fn(async () => new Set(['bookings.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: jest.fn(async () => 'staff-new'),
  lookupSynqedStaffIdForBusiness: jest.fn(async () => 'staff-viewer'),
}))
const mockAudit = jest.fn()
jest.mock('@/lib/audit', () => {
  const actual = jest.requireActual('@/lib/audit')
  return { ...actual, audit: (...a: unknown[]) => mockAudit(...a) }
})

const apptGet = jest.fn()
const apptUpdate = jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-1' }))
const staffGet = jest.fn()
const staffStoresGet = jest.fn()
const fakeClient = {
  appointments: { get: apptGet, update: apptUpdate },
  packs: {},
  staff: { get: staffGet },
  staffStores: { get: staffStoresGet },
  storePolicies: {},
  stores: { list: jest.fn(async () => ({ stores: [{ id: 'store-1', is_primary: true }] })) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: jest.fn(() => fakeClient) }))

import { POST as assignPOST } from '@/app/api/app/v1/appointments/[id]/assign-staff/route'
import { updateAppointmentCore, STAFF_NOT_ELIGIBLE } from '@/lib/appointments/mutations'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const URL_ = 'https://s/api/app/v1/appointments/appt-1/assign-staff'
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer()}`,
      'idempotency-key': 'k-1',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
const params = { params: Promise.resolve({ id: 'appt-1' }) }

/** store_ids per core staff id; the viewer floats (unclamped). */
let assignments: Record<string, string[]>
let staffRows: Record<string, { is_active: boolean; business_id: string }>
const updateAudits = () =>
  mockAudit.mock.calls.map((c) => c[0]).filter((e) => e.action === 'booking.update')

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['bookings.manage']))
  assignments = { 'staff-new': ['store-1'], 'staff-viewer': [] }
  staffRows = { 'staff-new': { is_active: true, business_id: 'business-1' } }
  staffStoresGet.mockImplementation(async (id: string) => ({ store_ids: assignments[id] ?? [] }))
  staffGet.mockImplementation(async (id: string) => {
    const row = staffRows[id]
    if (!row) throw new Error('Staff not found')
    return { id, ...row }
  })
  apptGet.mockResolvedValue({
    id: 'appt-1',
    customer_id: 'cust-1',
    store_id: 'store-1',
    staff_id: null,
    status: 'SCHEDULED',
    starts_at: '2026-10-06T01:00:00.000Z',
    ends_at: '2026-10-06T02:00:00.000Z',
  })
})

describe('POST /api/app/v1/appointments/[id]/assign-staff (facade)', () => {
  it('200 + the staff written (and nothing else) + one audit row carrying the store', async () => {
    const res = await assignPOST(post({ staffProfileId: 'profile-new' }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledTimes(1)
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { staff_id: 'staff-new' })
    const rows = updateAudits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ storeId: 'store-1', source: 'facade', detail: { changed: 'staff', store_id: 'store-1' } })
  })

  it('no bookings.manage → 403 (the sibling doors\' status), no write, no audit', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await assignPOST(post({ staffProfileId: 'profile-new' }), params)
    expect(res.status).toBe(403)
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(updateAudits()).toHaveLength(0)
  })

  it('staff of another store → refused by the shared check, nothing written', async () => {
    assignments['staff-new'] = ['store-2']
    const res = await assignPOST(post({ staffProfileId: 'profile-new' }), params)
    expect(await res.json()).toEqual({ error: STAFF_NOT_ELIGIBLE })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(updateAudits()).toHaveLength(0)
  })

  it('inactive staff → refused, nothing written', async () => {
    staffRows['staff-new'].is_active = false
    const res = await assignPOST(post({ staffProfileId: 'profile-new' }), params)
    expect(await res.json()).toEqual({ error: STAFF_NOT_ELIGIBLE })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('a strict body: unknown fields (a smuggled reschedule) → 400', async () => {
    const res = await assignPOST(post({ staffProfileId: 'p', startTime: '2026-10-06T03:00:00Z' }), params)
    expect(res.status).toBe(400)
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('missing Idempotency-Key → refused like the siblings, no write', async () => {
    const res = await assignPOST(post({ staffProfileId: 'profile-new' }, { 'idempotency-key': '' }), params)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(apptUpdate).not.toHaveBeenCalled()
  })
})

describe('updateAppointmentCore staff check (the web action\'s core, same rule)', () => {
  const actor = { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' as const, requestId: 'r' }
  const hours = { operatingHours: undefined, orgSaved: undefined }
  const scope = { storeId: null, allowedStoreIds: null } as unknown as Parameters<typeof updateAppointmentCore>[5]
  const run = (staffId: string) =>
    updateAppointmentCore(fakeClient as never, 'appt-1', { staffId }, actor, hours, scope)

  it('a floating staff (no staff_stores rows) may take the booking', async () => {
    assignments['staff-new'] = []
    await expect(run('staff-new')).resolves.toEqual({ success: true })
  })
  it('other store → { error: STAFF_NOT_ELIGIBLE }', async () => {
    assignments['staff-new'] = ['store-2']
    await expect(run('staff-new')).resolves.toEqual({ error: STAFF_NOT_ELIGIBLE })
  })
  it('inactive → refused', async () => {
    staffRows['staff-new'].is_active = false
    await expect(run('staff-new')).resolves.toEqual({ error: STAFF_NOT_ELIGIBLE })
  })
  it('another business\'s staff → refused', async () => {
    staffRows['staff-new'].business_id = 'business-2'
    await expect(run('staff-new')).resolves.toEqual({ error: STAFF_NOT_ELIGIBLE })
  })
  it('an unreadable staff row or assignment → refused (fail closed)', async () => {
    await expect(run('staff-ghost')).resolves.toEqual({ error: STAFF_NOT_ELIGIBLE })
    staffStoresGet.mockRejectedValueOnce(new Error('core down'))
    await expect(run('staff-new')).resolves.toEqual({ error: STAFF_NOT_ELIGIBLE })
    expect(apptUpdate).not.toHaveBeenCalled()
  })
})

describe('stress', () => {
  it('two assigns of different staff within a second: both pass the same gate, the later write stands, one audit row each', async () => {
    resolveMock().mockResolvedValueOnce('staff-new').mockResolvedValueOnce('staff-other')
    staffRows['staff-other'] = { is_active: true, business_id: 'business-1' }
    assignments['staff-other'] = []
    const [a, b] = await Promise.all([
      assignPOST(post({ staffProfileId: 'profile-new' }), params),
      assignPOST(post({ staffProfileId: 'profile-other' }, { 'idempotency-key': 'k-2' }), params),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(apptUpdate.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { staff_id: 'staff-new' },
      { staff_id: 'staff-other' },
    ])
    expect(updateAudits()).toHaveLength(2)
  })

  it('assign writes ONLY staff_id — no time, status or external_refs a re-sync could read as a move', async () => {
    await assignPOST(post({ staffProfileId: 'profile-new' }), params)
    const sent = (apptUpdate.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(['staff_id'])
  })
})

function resolveMock() {
  return jest.requireMock('@/lib/synqed/staff-map').resolveSynqedStaffIdForBusiness as jest.Mock
}
