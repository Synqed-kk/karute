// Chrome screen facade GET (design-parity Gap A). Pins: missing capability →
// 403 with no synqed call · store-id outside a clamped staff's assignment →
// 403 (tenancy-then-assignment, same clamp as every screen) · the switcher
// only shows a clamped staff their own stores + defaults activeStoreId to the
// first assignment · the happy DTO round-trip picks the in-session customer
// for the mic label · notification hrefs are served shell-shaped (locale
// prefix stripped) · a failed appointments read degrades to nextCustomer:null
// (chrome is best-effort like the web layout's seeding, never a 502 for one
// source).
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
}))
const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

// Feed is derive's own tested territory — here it just needs to flow through,
// with a /ja-prefixed href to pin the shell-shaping.
jest.mock('@/lib/notifications/derive', () => ({
  buildNotificationFeed: jest.fn(async () => [
    {
      id: 'n1',
      category: 'booking',
      titleJa: '新規予約',
      titleEn: 'New booking',
      bodyJa: '',
      bodyEn: '',
      createdAt: '2026-07-20T00:00:00.000Z',
      readAt: null,
      href: '/ja/appointments',
    },
    {
      id: 'n2',
      category: 'system',
      titleJa: 'お知らせ',
      titleEn: 'Notice',
      bodyJa: '',
      bodyEn: '',
      createdAt: '2026-07-20T00:00:00.000Z',
      readAt: null,
      href: null,
    },
  ]),
}))

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: jest.fn(async () => [
    { id: 'cust-1', name: '田中', isExistingCustomer: true },
  ]),
}))

// Business-scoped synqed client — stores + the by-date appointment assembly.
const inMs = (min: number) => new Date(Date.now() + min * 60_000).toISOString()
const listAppointments = jest.fn(async () => ({
  appointments: [
    // In-session: started 10 min ago, 60 min long, unrecorded — must win over
    // the upcoming one for the mic label.
    {
      id: 'appt-1',
      staff_id: 'staff-core-1',
      customer_id: 'cust-1',
      starts_at: inMs(-10),
      duration_minutes: 60,
      title: null,
      notes: null,
      created_at: inMs(-120),
      status: 'CONFIRMED',
      source: 'MANUAL',
    },
    {
      id: 'appt-2',
      staff_id: 'staff-core-1',
      customer_id: 'cust-1',
      starts_at: inMs(90),
      duration_minutes: 60,
      title: null,
      notes: null,
      created_at: inMs(-120),
      status: 'CONFIRMED',
      source: 'MANUAL',
    },
  ],
}))
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
      staff: [{ id: 'staff-core-1', user_id: 'auth-user-1', name: 'Mika' }],
    })),
  },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { GET } from '@/app/api/app/v1/screens/chrome/route'
import { newSynqedClient } from '@/lib/synqed/client'
import { buildNotificationFeed } from '@/lib/notifications/derive'
import { ChromeScreenDTO } from '@/lib/app-api/chrome-dto'

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
const req = (headers: Record<string, string> = {}, url = 'https://s/api/app/v1/screens/chrome') =>
  new Request(url, { headers: { ...auth, ...headers } })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  // ⚖ Liam 2026-09-16 (fold round 2): the front gate now reads the unassigned
  // verdict ITSELF, so a caller with no assignment in this MULTI-store fixture
  // is refused before the handler runs. The suite is about the screen, so the
  // default caller is ASSIGNED; the tests that want another shape ask for it.
  staffStoresGet.mockResolvedValue({ store_ids: ['store-A', 'store-B'] })
})

describe('GET /api/app/v1/screens/chrome', () => {
  it('missing capability → 403 with no synqed reads', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    // ⚖ Liam 2026-09-16: a caller with ZERO capabilities is the shape the
    // unassigned gate has to inspect, so it counts the business's stores at
    // the identity seam. That is auth work — the handler still never runs, so
    // no SCREEN data is read.
    expect(listAppointments).not.toHaveBeenCalled()
  })

  it('happy path: valid DTO, in-session mic target, shell-shaped hrefs', async () => {
    // ⚖ Liam 2026-09-16: this fixture's business has TWO stores, so a
    // deliberate empty assignment is now UNASSIGNED, not floating — that shape
    // never reaches a handler any more (facadeHandler refuses it). The chrome
    // itself is what this test is about, so the caller is assigned to both.
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A', 'store-B'] })
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    const dto = ChromeScreenDTO.parse(body.data ?? body)
    expect(dto.staffId).toBe('auth-user-1')
    // In-session appointment wins over the later one; name joined from the
    // cached list.
    expect(dto.nextCustomer).toMatchObject({
      customerId: 'cust-1',
      customerName: '田中',
      reason: 'in-session',
    })
    expect(dto.notifications.map((n) => n.href)).toEqual(['/appointments', null])
    expect(dto.stores).toHaveLength(2)
    // Clamped to both stores with no store-id header → the clamp's own default,
    // the first assigned store.
    expect(dto.activeStoreId).toBe('store-A')
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('clamped staff: switcher shows only assigned stores, activeStoreId defaults to the assignment', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-B'] })
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    const dto = ChromeScreenDTO.parse(body.data ?? body)
    expect(dto.stores.map((s) => s.id)).toEqual(['store-B'])
    expect(dto.activeStoreId).toBe('store-B')
  })

  it('store-id outside a clamped assignment → 403 store_forbidden', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await GET(req({ 'store-id': 'store-B' }), route)
    expect(res.status).toBe(403)
  })

  it('locale=en flows to the feed builder, with the day digest INJECTED (single day-read per request)', async () => {
    await GET(req({}, 'https://s/api/app/v1/screens/chrome?locale=en'), route)
    expect(buildNotificationFeed).toHaveBeenCalledWith(
      'business-1',
      'en',
      // The caller is assigned to 代官山 now (see the beforeEach), so the feed
      // is lensed rather than business-wide — which is the rule, not a change
      // of subject: the digest injection below is what this test pins.
      'store-A',
      // The injected digest — mapped from the route's own appointments fetch,
      // so the feed builder never re-reads the same day (Greptile #562).
      {
        todayAppointments: [{ isExistingCustomer: true }, { isExistingCustomer: true }],
        // customers.view only — not the 監査ログ pair, so no recording failures.
        viewerCanViewAudit: false,
      },
    )
    expect(listAppointments).toHaveBeenCalledTimes(1)
  })

  it('the 監査ログ pair (audit.view AND stores.viewAll) turns the recording-failure source on', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'audit.view', 'stores.viewAll']))
    await GET(req({}), route)
    expect(buildNotificationFeed).toHaveBeenCalledWith(
      'business-1',
      'ja',
      null, // stores.viewAll — no store lens
      expect.objectContaining({ viewerCanViewAudit: true }),
    )
  })

  it('a failed appointments read degrades to nextCustomer:null, not a 502', async () => {
    listAppointments.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    const dto = ChromeScreenDTO.parse(body.data ?? body)
    expect(dto.nextCustomer).toBeNull()
    expect(dto.notifications).toHaveLength(2)
  })
})
