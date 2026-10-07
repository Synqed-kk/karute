/**
 * ⚖ W0.5 (PR A) fix 2 — the hours judgement runs in JST for EVERY caller, and
 * it judges EXACT instants (Greptile's two P1 findings on #1089).
 *
 * P13 — the day walk trusted the caller's clock; the closure lookup did not.
 *   The phone create route took `tzOffsetMinutes` from the client body, so
 *   23:30–00:30 JST sent with `tzOffsetMinutes: 0` was ONE UTC-calendar day:
 *   the JST D+1 was never asked, its 臨時休業 was missed, the booking accepted.
 *   FAILS on 9e19f4b96, PASSES on the fix.
 * P14 — the judge rounded, core stores exact. A legacy row stored
 *   17:30:30–17:59:30 patched { endsAt: 18:00:15 } was judged as
 *   17:30 + ceil(29.75) = 18:00 (≤ close, accepted) while core received
 *   18:00:15. FAILS on 9e19f4b96, PASSES on the fix (P14c, the create twin, too).
 *   P14d pins the exact end's own guard (added with the fix).
 * P15 — the day count uses the exact end: 24:00:00.000 touches ONE day,
 *   24:00:15 touches two.
 *
 * Pinned to TZ=UTC to mirror the deploy runtime.
 */
import { createHmac } from 'node:crypto'

process.env.TZ = 'UTC'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

// The phone door's harness, as app-api-appointments-mutations.test.ts mocks it.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {
    status = 0
  },
}))
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async () => ({ id: 'cust-1' })),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [
    { id: 'profile-1', full_name: 'Mika' },
    { id: 'auth-user-1', full_name: 'Viewer' },
  ]),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: async () => new Set(['bookings.manage']) }
})
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: jest.fn(async () => 'staff-core-1'),
  lookupSynqedStaffIdForBusiness: jest.fn(async () => 'staff-core-1'),
}))
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: jest.fn(async () => ({ operating_hours: null })),
}))

/** Tuesday runs to midnight, Wednesday opens at midnight. 2026-09-15 is a
 *  TUESDAY in JST, 2026-09-16 a WEDNESDAY. */
const OVERNIGHT = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    d === 'tue' || d === 'mon' ? { open: '10:00', close: '24:00' } : { open: '00:00', close: '24:00' },
  ]),
)
/** Open 10:00–18:00 every day. */
const CLOSES_1800 = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '10:00', close: '18:00' }]),
)

const world = { weekly: OVERNIGHT as unknown, closed: [] as string[] }
const apptCreate = jest.fn(async (input: { customer_id: string; store_id?: string | null }) => ({
  id: 'appt-new',
  customer_id: input.customer_id,
  store_id: input.store_id ?? null,
}))
const listClosedDays = jest.fn(async (_store: string, range: { from: string; to: string }) => ({
  closed_days: world.closed.filter((d) => d >= range.from && d < range.to).map((date) => ({ date })),
}))
const fakeClient = {
  appointments: { create: apptCreate },
  // createAppointmentCore's live active + business check (fix round 7).
  staff: { get: jest.fn(async (id: string) => ({ id, is_active: true, business_id: 'business-1' })) },
  packs: {},
  staffStores: { get: jest.fn(async () => ({ store_ids: ['store-A'] })) },
  storePolicies: {
    get: jest.fn(async () => ({ weekly_hours: world.weekly, special_open_days: [] })),
    listClosedDays,
  },
  stores: {
    list: jest.fn(async () => ({
      stores: [{ id: 'store-A', name: '代官山', is_primary: true, active: true }],
    })),
  },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { POST as createPOST } from '@/app/api/app/v1/appointments/route'
import { createAppointmentCore, updateAppointmentCore } from '@/lib/appointments/mutations'
import { validateAppointmentTime } from '@/lib/appointments'

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
const post = (body: unknown) =>
  new Request('https://s/api/app/v1/appointments', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer()}`,
      'idempotency-key': 'test-key-1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
const noParams = { params: Promise.resolve({}) }

/** 23:30 JST on Tuesday 2026-09-15 — the instant a client names. */
const TUE_2330_JST = '2026-09-15T14:30:00.000Z'
const UTC_CLOCK_BODY = {
  staffProfileId: 'profile-1',
  clientId: 'cust-1',
  startTime: TUE_2330_JST,
  durationMinutes: 60,
  // A client whose clock says UTC. On 9e19f4b96 this cut the day walk.
  tzOffsetMinutes: 0,
}

/** A stored row, as core's get() answers it. */
function stored(starts_at: string, ends_at: string) {
  return {
    id: 'appt-1',
    status: 'SCHEDULED',
    customer_id: 'cust-1',
    staff_id: 'staff-core-1',
    store_id: 'store-A',
    starts_at,
    ends_at,
    duration_minutes: 60,
    created_at: '2026-09-01T00:00:00.000Z',
  }
}
function updateClient(row: ReturnType<typeof stored>) {
  const update = jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-A' }))
  return {
    update,
    synqed: { ...fakeClient, appointments: { get: jest.fn(async () => row), update, create: apptCreate } },
  }
}
const ACTOR = { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' as const }
const VIEW_ALL = { viewAll: true, allowedStoreIds: null }
const HOURS = { operatingHours: null, orgSaved: [] }

let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  world.weekly = OVERNIGHT
  world.closed = []
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('ruling 1 — the judgement is JST for every caller (no client clock reaches it)', () => {
  it('P13: the phone create route, 23:30–00:30 JST sent with tzOffsetMinutes 0, a 臨時休業 on JST D+1 → refused naming D+1, nothing created', async () => {
    world.closed = ['2026-09-16']
    const res = await createPOST(post(UTC_CLOCK_BODY), noParams)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      error: 'The booking runs into 2026-09-16, which is closed — pick another time.',
      code: 'closed_day',
      level: 'store',
      kind: 'closed_date',
      date: '2026-09-16',
    })
    expect(apptCreate).not.toHaveBeenCalled()
    // The door asked core about BOTH JST days.
    expect(listClosedDays).toHaveBeenCalledWith('store-A', { from: '2026-09-15', to: '2026-09-17' })
  })

  it('P13b: the same body with D+1 open (D runs to 24:00, D+1 opens 00:00) → accepted, core gets the instants the client named', async () => {
    const res = await createPOST(post(UTC_CLOCK_BODY), noParams)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'appt-new' })
    expect(apptCreate).toHaveBeenCalledTimes(1)
    expect(apptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: '2026-09-15T14:30:00.000Z',
        ends_at: '2026-09-15T15:30:00.000Z',
        duration_minutes: 60,
      }),
    )
  })

  it('P13c: the update path judges in JST too — stored 22:00–23:00 JST moved to 23:30 in a store closing 24:00, a 臨時休業 on D+1 → refused naming D+1', async () => {
    world.closed = ['2026-09-16']
    const c = updateClient(stored('2026-09-15T13:00:00.000Z', '2026-09-15T14:00:00.000Z'))
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { startsAt: TUE_2330_JST },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toMatchObject({ code: 'closed_day', kind: 'closed_date', date: '2026-09-16' })
    expect(c.update).not.toHaveBeenCalled()
  })
})

describe('ruling 2 — the judge compares EXACT instants; the label stays the ceil', () => {
  /** 17:30:30–17:59:30 JST — a legacy row with seconds. */
  const LEGACY = stored('2026-09-15T08:30:30.000Z', '2026-09-15T08:59:30.000Z')

  it('P14: stored 17:30:30–17:59:30, close 18:00, { endsAt: 18:00:15 } → outside_hours, core never asked', async () => {
    world.weekly = CLOSES_1800
    const c = updateClient(LEGACY)
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { endsAt: '2026-09-15T09:00:15.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({
      error: 'Appointment must be within operating hours (10:00-18:00).',
      code: 'outside_hours',
      params: { open: '10:00', close: '18:00' },
    })
    expect(c.update).not.toHaveBeenCalled()
  })

  it('P14b: the same row, { endsAt: 17:59:45 } → accepted; core gets the exact pair and the ceil label (29.25 → 30)', async () => {
    world.weekly = CLOSES_1800
    const c = updateClient(LEGACY)
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { endsAt: '2026-09-15T08:59:45.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ success: true })
    expect(c.update).toHaveBeenCalledWith('appt-1', {
      starts_at: '2026-09-15T08:30:30.000Z',
      ends_at: '2026-09-15T08:59:45.000Z',
      duration_minutes: 30,
    })
  })

  it('P14c: create 17:59:30 + 1 minute in a store closing 18:00 → refused (the exact end is 18:00:30), nothing created', async () => {
    world.weekly = CLOSES_1800
    const result = await createAppointmentCore(
      fakeClient as never,
      { staffProfileId: 'staff-1', clientId: 'cust-1', startTime: '2026-09-15T08:59:30.000Z', durationMinutes: 1 },
      { synqedStaffId: 'staff-core-1', preferredStoreId: 'store-A', operatingHours: null, orgSaved: [], actor: ACTOR },
    )
    expect(result).toMatchObject({ code: 'outside_hours', params: { open: '10:00', close: '18:00' } })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('P14d: an exact end that does not parse, or is not after the start, is refused — never judged as NaN (a silent accept)', async () => {
    const at = { staffProfileId: 'staff-1', clientId: 'cust-1', startTime: '2026-09-15T08:30:00.000Z', durationMinutes: 30 }
    const day = { weeklyHours: CLOSES_1800 as never, closedDates: new Set<string>(), orgSaved: new Set<never>() }
    for (const endTime of ['later', '2026-09-15T08:30:00.000Z', '2026-09-15T08:00:00.000Z']) {
      await expect(validateAppointmentTime({ ...at, endTime }, null, day)).resolves.toEqual({
        error: 'Invalid appointment end time.',
      })
    }
    await expect(
      validateAppointmentTime({ ...at, endTime: '2026-09-15T08:59:59.999Z' }, null, day),
    ).resolves.toBeNull()
  })

  it('P15: the day count uses the exact end — 24:00:00.000 touches ONE day (a closed D+1 is not its question), 24:00:15 touches two', async () => {
    world.closed = ['2026-09-16']
    const row = stored(TUE_2330_JST, '2026-09-15T14:59:30.000Z') // 23:30–23:59:30 JST

    const atMidnight = updateClient(row)
    expect(
      await updateAppointmentCore(
        atMidnight.synqed as never,
        'appt-1',
        { endsAt: '2026-09-15T15:00:00.000Z' },
        ACTOR,
        HOURS,
        VIEW_ALL,
      ),
    ).toEqual({ success: true })
    expect(atMidnight.update).toHaveBeenCalledWith('appt-1', {
      starts_at: TUE_2330_JST,
      ends_at: '2026-09-15T15:00:00.000Z',
      duration_minutes: 30,
    })

    const pastMidnight = updateClient(row)
    expect(
      await updateAppointmentCore(
        pastMidnight.synqed as never,
        'appt-1',
        { endsAt: '2026-09-15T15:00:15.000Z' },
        ACTOR,
        HOURS,
        VIEW_ALL,
      ),
    ).toMatchObject({ code: 'closed_day', kind: 'closed_date', date: '2026-09-16' })
    expect(pastMidnight.update).not.toHaveBeenCalled()
  })
})
