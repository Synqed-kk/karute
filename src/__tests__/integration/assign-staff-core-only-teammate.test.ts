/**
 * ⚖ Greptile pass 1 (B2 #1143) — both assign doors through the REAL staff
 * resolver (src/lib/synqed/staff-map.ts), only its stores mocked: the core
 * roster (SynqedClient.staff.list, per business) and the profiles read.
 *
 * P1: the roster the picker offers (staffListCore) carries an owner-created
 * teammate who has not signed up under its CORE staff id. That id must be one
 * the doors resolve — explicitly, as a card of THIS business's roster — and it
 * lands on the booking. An id that is neither a card of this business nor a
 * profile of it, and a card of ANOTHER business, are refused.
 */
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
process.env.SYNQED_CORE_URL = 'https://core.test'
process.env.SYNQED_CORE_API_KEY = 'key-123'

const BIZ = 'business-1'
/** What a roster read served (a cache, for round 7: the switched-off cards are
 *  still on it). The inactive card 'core-inactive' is not. */
const WEB_ROSTER_IDS = [
  'auth-user-1',
  'core-only-1',
  'core-store-2',
  'core-stores-unreadable',
  'core-switched-off',
  'profile-linked-off',
  'core-get-fails',
]

jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
// The REAL ja dictionary behind coreFailureLine's getTranslations (lazy import).
jest.mock('next-intl/server', () => {
  const ja = jest.requireActual<Record<string, Record<string, unknown>>>('../../../messages/ja.json')
  return { getTranslations: jest.fn(async (ns: string) => (key: string) => ja[ns]?.[key]) }
})
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))

/** Core staff cards per business — what synqedStaffListByBusiness reads. */
const ROSTERS: Record<string, Array<{ id: string; user_id: string | null; email: string | null; name: string }>> = {
  [BIZ]: [
    { id: 'staff-viewer', user_id: 'auth-user-1', email: 'viewer@x.test', name: 'Viewer' },
    { id: 'core-only-1', user_id: null, email: 'new@x.test', name: 'New Teammate' },
    // F4: cards of THIS business the write gate must still refuse.
    { id: 'core-store-2', user_id: null, email: null, name: 'Other Branch' },
    { id: 'core-inactive', user_id: null, email: null, name: 'Departed' },
    { id: 'core-stores-unreadable', user_id: null, email: null, name: 'Unreadable' },
    // Round 7: still on every CACHED roster, switched off in core since.
    { id: 'core-switched-off', user_id: null, email: null, name: 'Switched Off' },
    // Round 7: a signed-up staffer whose core card is switched off.
    { id: 'core-linked-off', user_id: 'profile-linked-off', email: null, name: 'Linked Off' },
    // Round 7: a card whose live staff.get fails.
    { id: 'core-get-fails', user_id: null, email: null, name: 'Unreadable Card' },
  ],
  'business-2': [{ id: 'core-of-business-2', user_id: null, email: null, name: 'Elsewhere' }],
}
const staffCreate = jest.fn(async () => ({ id: 'staff-created' }))
jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    SynqedError,
    SynqedClient: jest.fn().mockImplementation(({ businessId }: { businessId: string }) => ({
      staff: {
        list: async () => ({ staff: ROSTERS[businessId] ?? [], total: (ROSTERS[businessId] ?? []).length }),
        create: (...a: unknown[]) => staffCreate(...(a as [])),
        update: jest.fn(async () => ({})),
      },
    })),
  }
})

/** The profiles read: no row for any id these tests send. */
let profilesResult: { data: unknown; error: unknown } = { data: null, error: null }
const profileReads = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        profileReads()
        return profilesResult
      },
    }
    return { from: () => builder }
  },
}))

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => BIZ),
  // The facade create's roster (uncached in prod) — the cached web one below plus nothing else.
  staffListByBusinessOrThrow: jest.fn(async () => WEB_ROSTER_IDS.map((id) => ({ id, full_name: id }))),
  getBusinessId: jest.fn(async () => BIZ),
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
  // The web roster as staffListCore builds it: the profile, plus the ACTIVE
  // core-only cards (synqedStaffWithoutProfile drops is_active false), so the
  // inactive card 'core-inactive' is not on it.
  getStaffList: jest.fn(async () => WEB_ROSTER_IDS.map((id) => ({ id, full_name: id }))),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  ...jest.requireActual('@/lib/auth/require-permission'),
  capabilitiesForUser: async () => new Set(['bookings.manage']),
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
const VIEW_ALL = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
jest.mock('@/lib/auth/store-scope', () => ({
  ...jest.requireActual('@/lib/auth/store-scope'),
  resolveStoreScope: async () => VIEW_ALL,
}))
jest.mock('@/lib/customers/queries', () => ({ getCustomerWithClient: jest.fn(async () => ({ id: 'cust-1' })) }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerList: jest.fn(async () => []) }))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: null })),
  // The facade create's twin read (round 7 tests).
  orgSettingsWithClient: jest.fn(async () => ({ operating_hours: null })),
}))
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => null) }))
jest.mock('@/lib/audit', () => ({ ...jest.requireActual('@/lib/audit'), audit: jest.fn() }))

/** Core rows the write gate reads (staff.get) — by core id, with business. */
const STAFF_ROWS: Record<string, { is_active: boolean; business_id: string }> = {
  'core-only-1': { is_active: true, business_id: BIZ },
  'core-of-business-2': { is_active: true, business_id: 'business-2' },
  'core-store-2': { is_active: true, business_id: BIZ },
  'core-inactive': { is_active: false, business_id: BIZ },
  'core-stores-unreadable': { is_active: true, business_id: BIZ },
  'core-switched-off': { is_active: false, business_id: BIZ },
  'core-linked-off': { is_active: false, business_id: BIZ },
  // 'core-get-fails' has no row: staff.get rejects for it.
}
const STORE_IDS: Record<string, string[]> = {
  'core-only-1': ['store-1'],
  'core-store-2': ['store-2'],
  'core-inactive': ['store-1'],
}
const apptGet = jest.fn()
const apptCreate = jest.fn(async () => ({ id: 'appt-new' }))
const apptUpdate = jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-1' }))
const fakeClient = {
  appointments: { get: apptGet, update: apptUpdate, create: apptCreate },
  packs: {},
  staff: {
    get: jest.fn(async (id: string) => {
      const row = STAFF_ROWS[id]
      if (!row) throw new Error('Staff not found')
      return { id, ...row }
    }),
  },
  staffStores: {
    get: jest.fn(async (id: string) => {
      if (id === 'core-stores-unreadable') throw new Error('staff_stores read failed')
      return { store_ids: STORE_IDS[id] ?? [] }
    }),
  },
  storePolicies: {},
  stores: { list: jest.fn(async () => ({ stores: [{ id: 'store-1', is_primary: true }] })) },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
  getSynqedClient: jest.fn(async () => fakeClient),
}))

import { POST as assignPOST } from '@/app/api/app/v1/appointments/[id]/assign-staff/route'
import { POST as createPOST } from '@/app/api/app/v1/appointments/route'
import { assignAppointmentStaff, createAppointment } from '@/actions/appointments'
import { STAFF_NOT_ELIGIBLE, STAFF_NOT_ON_ROSTER } from '@/lib/appointments/mutations'
import ja from '../../../messages/ja.json'
import { getStaffList } from '@/lib/staff'
import { AppApiError } from '@/lib/app-api/errors'

const FAILURE_LINE: string = ja.common.somethingWentWrong
/** The PostgREST error the profiles read returns — its detail must never leave the server. */
const PROFILES_OUTAGE = { message: 'canceling statement due to statement timeout', code: '57014' }

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const post = (staffProfileId: string) =>
  assignPOST(
    new Request('https://s/api/app/v1/appointments/appt-1/assign-staff', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'k-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ staffProfileId }),
    }),
    { params: Promise.resolve({ id: 'appt-1' }) },
  )

beforeEach(() => {
  jest.clearAllMocks()
  profilesResult = { data: null, error: null }
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

describe('P1 — a core-only teammate the picker offers can be assigned', () => {
  it('facade: 200 and the core id lands on the booking; no profiles read, no core staff created', async () => {
    const res = await post('core-only-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledTimes(1)
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { staff_id: 'core-only-1' })
    expect(profileReads).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('web action: { success: true } and the core id lands on the booking', async () => {
    await expect(assignAppointmentStaff('appt-1', 'core-only-1')).resolves.toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledTimes(1)
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { staff_id: 'core-only-1' })
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

describe('P1 — an id the doors cannot resolve is refused', () => {
  it.each([
    ['neither a card of this business nor a profile of it', 'nobody-1'],
    ['a core staff id of ANOTHER business', 'core-of-business-2'],
  ])('facade: %s → 400 STAFF_NOT_ELIGIBLE, nothing written or created', async (_label, id) => {
    const res = await post(id)
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain(STAFF_NOT_ELIGIBLE)
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['neither a card of this business nor a profile of it', 'nobody-1'],
    ['a core staff id of ANOTHER business', 'core-of-business-2'],
  ])('web action: %s → { error }, nothing written or created', async (_label, id) => {
    const result = await assignAppointmentStaff('appt-1', id)
    expect(result).toHaveProperty('error')
    expect(result).not.toHaveProperty('success')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

// ⚖ Greptile pass 1 P2 — a profiles outage is upstream_unavailable (fix round 6
// F2): the facade's 502 with no detail, the web action's localized failure line;
// never the 400 an ineligible staff gets. A read that succeeded with no row stays 400.
describe('P2 — a profiles read failure is an outage, not bad input', () => {
  it('facade: profiles read error → 502 upstream_unavailable, no leak of the cause, nothing written or created', async () => {
    profilesResult = { data: null, error: PROFILES_OUTAGE }
    const res = await post('profile-unlinked')
    expect(res.status).toBe(502)
    const body = JSON.stringify(await res.json())
    expect(body).toContain('upstream_unavailable')
    expect(body).not.toContain(STAFF_NOT_ELIGIBLE)
    expect(body).not.toContain(PROFILES_OUTAGE.message)
    expect(body).not.toContain(PROFILES_OUTAGE.code)
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('web action: profiles read error → the localized failure line, never "Unknown error" or STAFF_NOT_ELIGIBLE, nothing written', async () => {
    profilesResult = { data: null, error: PROFILES_OUTAGE }
    const result = await assignAppointmentStaff('appt-1', 'profile-unlinked')
    expect(FAILURE_LINE).toBeTruthy()
    expect(result).toEqual({ error: FAILURE_LINE })
    expect(result).not.toEqual({ error: 'Unknown error' })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('facade: a null row with no error → still 400 STAFF_NOT_ELIGIBLE', async () => {
    profilesResult = { data: null, error: null }
    const res = await post('profile-unlinked')
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain(STAFF_NOT_ELIGIBLE)
    expect(apptUpdate).not.toHaveBeenCalled()
  })
})

// Fix round 6 F4 (attack read #2) — the resolver takes a core id of THIS
// business as-is; the write gate still judges that core id: store, active,
// and an unreadable store assignment fail closed. Nothing is written.
describe('F4 — a core id of this business the write gate refuses', () => {
  it.each([
    ['assigned only to store-2, on a store-1 booking', 'core-store-2'],
    ['inactive (is_active false)', 'core-inactive'],
    ['whose staffStores.get rejects', 'core-stores-unreadable'],
  ])('facade: a core-only card %s → the gate refusal { error: STAFF_NOT_ELIGIBLE }, nothing written or created', async (_label, id) => {
    // The gate's refusal rides the 200 body, the door's house shape (the 400 is
    // the resolver's unknown-id refusal only).
    const res = await post(id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: STAFF_NOT_ELIGIBLE })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
    expect(profileReads).not.toHaveBeenCalled()
  })

  it.each([
    ['assigned only to store-2, on a store-1 booking', 'core-store-2'],
    ['inactive (is_active false)', 'core-inactive'],
    ['whose staffStores.get rejects', 'core-stores-unreadable'],
  ])('web action: a core-only card %s → { error: STAFF_NOT_ELIGIBLE }, nothing written', async (_label, id) => {
    await expect(assignAppointmentStaff('appt-1', id)).resolves.toEqual({ error: STAFF_NOT_ELIGIBLE })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

// Fix round 6 F3 (attack read #4) — web create gets the facade create's roster
// gate: a card of this business that is not on the roster (an inactive one) is
// refused with the facade's own words, before the resolver; nothing written.
describe('F3 — web createAppointment: roster gate, as the facade create', () => {
  const booking = (staffProfileId: string) => ({
    staffProfileId,
    clientId: 'cust-1',
    startTime: '2026-10-06T01:00:00.000Z',
    durationMinutes: 60,
  })

  it('an inactive core-only card of this business → the facade create refusal, nothing resolved, created or written', async () => {
    await expect(createAppointment(booking('core-inactive'))).resolves.toEqual({
      error: 'staffProfileId is not a staff member of this business',
    })
    expect(apptCreate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
    expect(profileReads).not.toHaveBeenCalled()
  })

  // Fix round 6 F6 — the create catch answers a typed core failure with the
  // localized line, like every sibling write action in the file.
  it('F6: the roster read failing upstream_unavailable → the localized failure line, nothing written', async () => {
    ;(getStaffList as jest.Mock).mockRejectedValueOnce(
      new AppApiError('upstream_unavailable', 'staff profiles read failed', undefined, new Error('db down')),
    )
    await expect(createAppointment(booking('core-only-1'))).resolves.toEqual({ error: FAILURE_LINE })
    expect(apptCreate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('an active core-only card on the roster passes the gate and books under its own core id', async () => {
    const result = await createAppointment(booking('core-only-1'))
    expect(result).not.toEqual({ error: 'staffProfileId is not a staff member of this business' })
    expect(apptCreate).toHaveBeenCalledTimes(1)
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ staff_id: 'core-only-1' }))
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

// ⚖ Greptile pass 2 P1 (fix round 7) — booking CREATE gets the assign door's
// LIVE judgement: the roster gates are cached first checks, and
// createAppointmentCore reads core's staff row (active + business) after the
// id is resolved and before any write, on both doors.
describe('Round 7 — create judges the resolved core id live, on both doors', () => {
  const body = (staffProfileId: string) => ({
    staffProfileId,
    clientId: 'cust-1',
    startTime: '2026-10-06T01:00:00.000Z',
    durationMinutes: 60,
  })
  const postCreate = (staffProfileId: string) =>
    createPOST(
      new Request('https://s/api/app/v1/appointments', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer()}`,
          'idempotency-key': 'k-create',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body(staffProfileId)),
      }),
      { params: Promise.resolve({}) },
    )

  it.each([
    ['a core-only card switched off since the roster was cached', 'core-switched-off'],
    ['a profile-linked staffer whose core card is inactive (pre-existing hole)', 'profile-linked-off'],
  ])('web create: %s → { error: STAFF_NOT_ON_ROSTER }, nothing written', async (_label, id) => {
    await expect(createAppointment(body(id))).resolves.toEqual({ error: STAFF_NOT_ON_ROSTER })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['a core-only card switched off since the roster was cached', 'core-switched-off'],
    ['a profile-linked staffer whose core card is inactive (pre-existing hole)', 'profile-linked-off'],
  ])('facade create: %s → 400 STAFF_NOT_ON_ROSTER, nothing written', async (_label, id) => {
    const res = await postCreate(id)
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain(STAFF_NOT_ON_ROSTER)
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('web create: staff.get rejecting → the localized failure line (fail closed), nothing written', async () => {
    await expect(createAppointment(body('core-get-fails'))).resolves.toEqual({ error: FAILURE_LINE })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('facade create: staff.get rejecting → 502 upstream_unavailable (fail closed), nothing written', async () => {
    const res = await postCreate('core-get-fails')
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).toContain('upstream_unavailable')
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('web create: an active card passes the live check and books under its core id', async () => {
    const result = await createAppointment(body('core-only-1'))
    expect(result).not.toHaveProperty('error')
    expect(apptCreate).toHaveBeenCalledTimes(1)
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ staff_id: 'core-only-1' }))
  })

  it('facade create: an active card passes the live check and books under its core id', async () => {
    const res = await postCreate('core-only-1')
    expect(res.status).toBe(201)
    expect(await res.json()).not.toHaveProperty('error')
    expect(apptCreate).toHaveBeenCalledTimes(1)
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ staff_id: 'core-only-1' }))
  })
})
