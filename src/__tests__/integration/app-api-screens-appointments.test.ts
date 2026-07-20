// Appointments (予約) screen facade GET (design-parity P-B). Pins: missing
// capability → 403 with no synqed reads · store-id outside a clamped staff's
// assignment → 403 · the happy day DTO round-trip runs the REAL
// buildAppointmentsScreen (tombstone rows kept, karute number + pack pill +
// no-show count folded in, store staff lens applied) · ?staff=self filters to
// the viewer's rows · ?view=week projects weekData from the range read ·
// a failed pack-usage read degrades to pill-less rows (page parity) · a
// failed day-appointments read is a 502, NEVER a silently-empty agenda (the
// deliberate delta from the web action's legacy catch→[]).
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
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [
    {
      id: 'auth-user-1',
      full_name: 'Mika Tanaka',
      display_role: 'STYLIST',
      position: '店長',
      email: 'mika@example.com',
      avatar_url: null,
      has_pin: false,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'profile-2',
      full_name: 'Yuko Sato',
      display_role: 'STYLIST',
      position: null,
      email: 'yuko@example.com',
      avatar_url: null,
      has_pin: false,
      created_at: '2026-01-02T00:00:00.000Z',
    },
  ]),
}))
const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: jest.fn(async () => [
    {
      id: 'cust-1',
      name: '田中',
      isExistingCustomer: true,
      created_at: '2026-01-05T00:00:00.000Z',
      visitCount: 12,
      hasTicketPack: true,
      karute_number: 139,
    },
    {
      id: 'cust-2',
      name: '佐藤',
      isExistingCustomer: false,
      created_at: '2026-02-01T00:00:00.000Z',
      visitCount: 0,
      hasTicketPack: false,
      karute_number: null,
    },
  ]),
}))

jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: jest.fn(async () => ({
    ticket_packs_enabled: true,
    operating_hours: null,
  })),
}))

const enrichCustomers = jest.fn(
  async (..._a: unknown[]) =>
    new Map([
      [
        'cust-2',
        {
          totalKarute: 0,
          lastVisitIso: null,
          pastAppointmentCount: 0,
          lastVisitService: null,
          bookingStaffId: null,
          nextAppointmentIso: null,
          firstVisitIso: null,
          datedVisitCount: 0,
          noShowCount: 2,
        },
      ],
    ]),
)
// Full mock (no requireActual): the route + builder only reach this module
// for enrichCustomers — the derivation itself uses status-signals directly.
jest.mock('@/lib/customers/list-enrich', () => ({
  enrichCustomers: (...a: unknown[]) => enrichCustomers(...a),
}))

const listAllPackUsageWithClient = jest.fn(
  async (..._a: unknown[]) =>
    new Map([
      [
        'cust-1',
        { remaining: 3, size: 10, unconsumed: 21000, hasActivePack: true, firstPackId: 'pack-1' },
      ],
    ]),
)
jest.mock('@/lib/packs/store', () => ({
  listAllPackUsageWithClient: (...a: unknown[]) => listAllPackUsageWithClient(...a),
}))

// Business-scoped synqed client — day + range appointment reads, the store
// clamp's assignment lookup, and the by-date helper's karute/staff joins.
const inMs = (min: number) => new Date(Date.now() + min * 60_000).toISOString()
const dayRows = [
  // Active booking for the ticket-pack regular, assigned to the viewer.
  {
    id: 'appt-1',
    staff_id: 'staff-core-1',
    customer_id: 'cust-1',
    starts_at: inMs(60),
    duration_minutes: 60,
    title: 'カット',
    notes: null,
    created_at: inMs(-600),
    status: 'SCHEDULED',
    source: 'MANUAL',
  },
  // Cancelled tombstone for the never-visited customer, other staff.
  {
    id: 'appt-2',
    staff_id: 'staff-core-2',
    customer_id: 'cust-2',
    starts_at: inMs(120),
    duration_minutes: 30,
    title: null,
    notes: null,
    created_at: inMs(-600),
    status: 'CANCELLED',
    status_reason: 'advance_contact',
    source: 'MANUAL',
  },
]
const listAppointments = jest.fn(async () => ({ appointments: dayRows }))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  stores: {
    list: jest.fn(async () => ({
      stores: [
        { id: 'store-A', name: 'La Estro 代官山', is_primary: true, active: true },
        { id: 'store-B', name: 'La Estro 銀座', is_primary: false, active: true },
      ],
    })),
    get: jest.fn(async () => ({})),
  },
  staffStores: { get: staffStoresGet },
  appointments: { list: listAppointments },
  karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) },
  staff: {
    list: jest.fn(async () => ({
      staff: [
        { id: 'staff-core-1', user_id: 'auth-user-1', name: 'Mika Tanaka' },
        { id: 'staff-core-2', user_id: 'profile-2', name: 'Yuko Sato' },
      ],
    })),
  },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { GET } from '@/app/api/app/v1/screens/appointments/route'
import { AppointmentsScreenDTO } from '@/lib/app-api/appointments-screen-dto'

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
const route = { params: Promise.resolve({}) }
const req = (
  headers: Record<string, string> = {},
  url = 'https://s/api/app/v1/screens/appointments',
) => new Request(url, { headers: { ...auth, ...headers } })

async function dtoOf(res: Response) {
  const body = await res.json()
  return AppointmentsScreenDTO.parse(body.data ?? body)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  listAppointments.mockResolvedValue({ appointments: dayRows })
})

describe('GET /api/app/v1/screens/appointments', () => {
  it('missing capability → 403 with no synqed reads', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(listAppointments).not.toHaveBeenCalled()
  })

  it('store-id outside a clamped assignment → 403 store_forbidden', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await GET(req({ 'store-id': 'store-B' }), route)
    expect(res.status).toBe(403)
  })

  it('happy day view: real derivation — tombstone kept, karute number, pack pill, no-show count', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.view).toBe('day')
    expect(dto.authProfileId).toBe('auth-user-1')
    expect(dto.activeStaffId).toBe('auth-user-1')
    expect(dto.staff.map((s) => s.id)).toEqual(['auth-user-1', 'profile-2'])
    expect(dto.customers).toEqual([
      { id: 'cust-1', name: '田中' },
      { id: 'cust-2', name: '佐藤' },
    ])

    expect(dto.reservationViews).toHaveLength(2)
    const active = dto.reservationViews.find((r) => r.id === 'appt-1')!
    // Real chart number from the cached list + the 残3/10 ledger pill.
    expect(active.karuteNumber).toBe('#00139')
    expect(active.pack).toEqual({ remaining: 3, size: 10 })
    expect(active.isCancelled).toBe(false)
    expect(active.staffName).toBe('Mika Tanaka')
    // staff_profile_id resolved from core user_id — the self filter keys on it.
    expect(active.staffId).toBe('auth-user-1')

    const tombstone = dto.reservationViews.find((r) => r.id === 'appt-2')!
    expect(tombstone.isCancelled).toBe(true)
    expect(tombstone.statusReason).toBe('advance_contact')
    // Prior no-show total rides the enrichment read (repeat chip source).
    expect(tombstone.noShowCount).toBe(2)
    // Enrichment says never-visited → genuine 新規 flag on the row.
    expect(tombstone.isFirstTimeVisit).toBe(true)

    expect(dto.weekData).toBeNull()
    expect(dto.monthData).toBeNull()
  })

  it('?staff=self returns only the viewer\'s rows', async () => {
    const res = await GET(
      req({}, 'https://s/api/app/v1/screens/appointments?staff=self'),
      route,
    )
    const dto = await dtoOf(res)
    expect(dto.staffFilter).toBe('self')
    expect(dto.reservationViews.map((r) => r.id)).toEqual(['appt-1'])
  })

  it('?view=week projects weekData from the range read (terminal rows dropped)', async () => {
    // No ?date= — the week window anchors on today, so the now+60min mock
    // booking is always inside it regardless of when the suite runs.
    const res = await GET(
      req({}, 'https://s/api/app/v1/screens/appointments?view=week'),
      route,
    )
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.view).toBe('week')
    expect(dto.weekData).toHaveLength(7)
    expect(dto.weekStartIso).not.toBeNull()
    expect(dto.monthData).toBeNull()
    // Day read + range read — the by-date helper and the range twin each list
    // once (the range twin drops the CANCELLED row before bucketing).
    expect(listAppointments).toHaveBeenCalledTimes(2)
    const totalRangeBookings = dto.weekData!.reduce((n, d) => n + d.count, 0)
    expect(totalRangeBookings).toBe(1)
  })

  it('a failed pack-usage read degrades to pill-less rows, not an error', async () => {
    listAllPackUsageWithClient.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.reservationViews.find((r) => r.id === 'appt-1')!.pack).toBeNull()
  })

  it('a failed day-appointments read → 502, never a silently-empty agenda', async () => {
    listAppointments.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
  })
})
