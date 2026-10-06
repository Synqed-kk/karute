// PR-B part 2 — assigning the staff of a 担当未定 booking. The facade door
// (POST /api/app/v1/appointments/[id]/assign-staff) and the web action share
// updateAppointmentCore, so the staff check (active · this business · works at
// the booking's store) is pinned once on the core and once through the door.
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

import {
  assignStaffToBooking,
  BOOKING_ALREADY_STAFFED,
  updateAppointmentCore,
  STAFF_NOT_ELIGIBLE,
} from '@/lib/appointments/mutations'

/** The store clamp reads the CALLER's assignment by auth user id. */
const VIEWER_KEY = 'auth-user-1'

/** store_ids per core staff id; the viewer floats (unclamped). */
let assignments: Record<string, string[]>
let staffRows: Record<string, { is_active: boolean; business_id: string }>

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['bookings.manage']))
  assignments = { 'staff-new': ['store-1'], [VIEWER_KEY]: [] }
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

describe('fix round 1', () => {
  const actor = { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' as const, requestId: 'r' }
  const scope = { storeId: null, allowedStoreIds: null } as unknown as Parameters<typeof assignStaffToBooking>[4]
  const staffed = {
    id: 'appt-1',
    customer_id: 'cust-1',
    store_id: 'store-1',
    staff_id: 'staff-someone',
    status: 'SCHEDULED',
    starts_at: '2026-10-06T01:00:00.000Z',
    ends_at: '2026-10-06T02:00:00.000Z',
  }

  it("second tap (web: the action's core function) → refused, nothing written", async () => {
    apptGet.mockResolvedValue(staffed)
    await expect(assignStaffToBooking(fakeClient as never, 'appt-1', 'staff-new', actor, scope)).resolves.toEqual({
      error: BOOKING_ALREADY_STAFFED,
    })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('first tap through assignStaffToBooking writes the staff only', async () => {
    await expect(assignStaffToBooking(fakeClient as never, 'appt-1', 'staff-new', actor, scope)).resolves.toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { staff_id: 'staff-new' })
  })

  it('no business on the actor → refused (never skipped), nothing written', async () => {
    const noBiz = { ...actor, businessId: null } as unknown as typeof actor
    await expect(assignStaffToBooking(fakeClient as never, 'appt-1', 'staff-new', noBiz, scope)).resolves.toEqual({
      error: STAFF_NOT_ELIGIBLE,
    })
    expect(apptUpdate).not.toHaveBeenCalled()
  })
})
