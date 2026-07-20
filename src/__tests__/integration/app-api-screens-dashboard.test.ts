// Dashboard screen facade GET (design-parity Gap B-1 PR 2). Pins: missing
// capability → 403 with no synqed client/reads · the BINDING CONTRACT (PR
// #570's Greptile threads) — ONE newSynqedClient call, and businessId/synqed
// reaching getDashboardDataFor/getPackAlertsWithClient/
// loadUnprocessedVisitsWithClient are the SAME values ctx.identity resolved
// · store-id outside a clamped staff's assignment → 403 · a failed pack-read
// degrades to EMPTY pack surfaces (never business-wide, never a 502 that
// kills the rest of the dashboard) · a failed load-bearing read (dashboard
// data) → 502 · canDismissAlerts mirrors ctx.identity.capabilities directly
// (no extra async call) · the happy-path DTO round-trips through the real
// buildDashboardScreen.
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
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'STYLIST' },
  ]),
}))
const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: jest.fn(async () => []),
}))
// @synqed-kk/client is ESM-only — list-enrich.ts VALUE-imports SynqedClient
// (for typing an internal cache key), which jest's CJS transform can't parse.
// Mock at the seam, same fix dashboard-screen.test.ts (PR 1) uses.
jest.mock('@/lib/customers/list-enrich', () => ({
  enrichCustomers: jest.fn(async () => new Map()),
}))
// daily-attention-ai.ts pulls the openai SDK + AI-cache chain — irrelevant to
// this route's own logic and mocked the same way PR 1's buildDashboardScreen
// suite does.
jest.mock('@/lib/dashboard/daily-attention-ai', () => ({
  getDailyAttentionLines: jest.fn(async () => new Map()),
}))
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: jest.fn(async () => ({
    ticket_packs_enabled: true,
    setup_completed_at: '2026-01-01T00:00:00.000Z',
  })),
}))

const getDashboardDataFor = jest.fn(async (..._a: unknown[]) => ({
  weeklyKaruteCount: 0,
  monthlyKaruteCount: 0,
  weekKaruteCount: 0,
  todayAppointments: [] as unknown[],
  tomorrowAppointments: [] as unknown[],
  recentKarute: [] as unknown[],
}))
jest.mock('@/lib/dashboard/cached', () => ({
  getDashboardDataFor: (...a: unknown[]) => getDashboardDataFor(...a),
}))

const emptyPackAlerts = () => ({
  contact: [],
  low: [],
  inProgress: [],
  totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
  monthly: { contacted: 0, rebooked: 0 },
})
const getPackAlertsWithClient = jest.fn(async (..._a: unknown[]) => emptyPackAlerts())
jest.mock('@/lib/packs/alerts', () => ({
  emptyPackAlerts: () => emptyPackAlerts(),
  getPackAlertsWithClient: (...a: unknown[]) => getPackAlertsWithClient(...a),
}))

const loadUnprocessedVisitsWithClient = jest.fn(async (..._a: unknown[]) => ({
  entries: [] as unknown[],
  truncated: 0,
}))
jest.mock('@/lib/packs/reconcile', () => ({
  loadUnprocessedVisitsWithClient: (...a: unknown[]) => loadUnprocessedVisitsWithClient(...a),
}))

const listAllPackUsageWithClient = jest.fn(async (..._a: unknown[]) => new Map())
jest.mock('@/lib/packs/store', () => ({
  listAllPackUsageWithClient: (...a: unknown[]) => listAllPackUsageWithClient(...a),
}))

const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const storesGet = jest.fn(async () => ({}))
const fakeClient = {
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
  karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) },
  packs: { listRecentRedemptions: jest.fn(async () => []) },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET } from '@/app/api/app/v1/screens/dashboard/route'
import { DashboardScreenDTO } from '@/lib/app-api/dashboard-screen-dto'

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
  url = 'https://s/api/app/v1/screens/dashboard',
) => new Request(url, { headers: { ...auth, ...headers } })

async function dtoOf(res: Response) {
  const body = await res.json()
  return DashboardScreenDTO.parse(body.data ?? body)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  storesGet.mockResolvedValue({})
  getDashboardDataFor.mockResolvedValue({
    weeklyKaruteCount: 0,
    monthlyKaruteCount: 0,
    weekKaruteCount: 0,
    todayAppointments: [],
    tomorrowAppointments: [],
    recentKarute: [],
  })
  getPackAlertsWithClient.mockResolvedValue(emptyPackAlerts())
  loadUnprocessedVisitsWithClient.mockResolvedValue({ entries: [], truncated: 0 })
  listAllPackUsageWithClient.mockResolvedValue(new Map())
})

describe('GET /api/app/v1/screens/dashboard', () => {
  it('missing capability → 403, no synqed client, no reads', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(newSynqedClient).not.toHaveBeenCalled()
    expect(getDashboardDataFor).not.toHaveBeenCalled()
  })

  it('store-id outside a clamped assignment → 403 store_forbidden', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await GET(req({ 'store-id': 'store-B' }), route)
    expect(res.status).toBe(403)
    expect(getDashboardDataFor).not.toHaveBeenCalled()
  })

  it('happy path → 200, real buildDashboardScreen DTO round-trip', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.isOwner).toBe(false)
    expect(dto.totalToday).toBe(0)
    expect(dto.ticketsEnabled).toBe(true)
    expect(dto.onboardingComplete).toBe(true)
  })

  it('canDismissAlerts mirrors ctx.identity.capabilities directly (alerts.manage present)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'alerts.manage']))
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.canDismissAlerts).toBe(true)
  })

  it('canDismissAlerts false without alerts.manage', async () => {
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.canDismissAlerts).toBe(false)
  })

  describe('binding contract (PR #570 Greptile threads)', () => {
    it('ONE newSynqedClient call — the SAME instance reaches every WithClient twin', async () => {
      const res = await GET(req(), route)
      expect(res.status).toBe(200)
      expect(newSynqedClient).toHaveBeenCalledTimes(1)
      expect(newSynqedClient).toHaveBeenCalledWith('business-1')
      // Every twin receives the EXACT client instance newSynqedClient returned
      // — proves no second client was constructed anywhere downstream.
      expect(getPackAlertsWithClient.mock.calls[0][0]).toBe(fakeClient)
      expect(loadUnprocessedVisitsWithClient.mock.calls[0][0]).toBe(fakeClient)
      expect(listAllPackUsageWithClient.mock.calls[0][0]).toBe(fakeClient)
    })

    it('the SAME businessId (ctx.identity.businessId) reaches getDashboardDataFor + every pack twin', async () => {
      const res = await GET(req(), route)
      expect(res.status).toBe(200)
      expect(getDashboardDataFor).toHaveBeenCalledWith('business-1', null)
      expect(getPackAlertsWithClient).toHaveBeenCalledWith(
        fakeClient,
        'business-1',
        undefined,
        null,
      )
      expect(loadUnprocessedVisitsWithClient).toHaveBeenCalledWith(fakeClient, 'business-1', null)
    })

    it('the SAME clamped storeId (never a second store source) reaches every pack twin', async () => {
      staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
      const res = await GET(req({ 'store-id': 'store-A' }), route)
      expect(res.status).toBe(200)
      expect(getDashboardDataFor).toHaveBeenCalledWith('business-1', 'store-A')
      expect(getPackAlertsWithClient).toHaveBeenCalledWith(
        fakeClient,
        'business-1',
        undefined,
        'store-A',
      )
      expect(loadUnprocessedVisitsWithClient).toHaveBeenCalledWith(
        fakeClient,
        'business-1',
        'store-A',
      )
    })
  })

  describe('pack-surface fail-closed (page parity)', () => {
    it('a failed pack-alerts read degrades to EMPTY, not a 502, not business-wide', async () => {
      staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
      getPackAlertsWithClient.mockRejectedValueOnce(new Error('core down'))
      const res = await GET(req({ 'store-id': 'store-A' }), route)
      expect(res.status).toBe(200)
      const dto = await dtoOf(res)
      expect(dto.packAlerts).toEqual(emptyPackAlerts())
      // The clamped store — never a business-wide retry/fallback — reached
      // the failed call.
      expect(getPackAlertsWithClient).toHaveBeenCalledWith(
        fakeClient,
        'business-1',
        undefined,
        'store-A',
      )
    })

    it('a failed reconcile read degrades to EMPTY entries, not a 502', async () => {
      loadUnprocessedVisitsWithClient.mockRejectedValueOnce(new Error('core down'))
      const res = await GET(req(), route)
      expect(res.status).toBe(200)
      const dto = await dtoOf(res)
      expect(dto.reconcile).toEqual({ entries: [], truncated: 0 })
    })

    it('a failed packUsage read degrades to an empty ledger, not a 502', async () => {
      listAllPackUsageWithClient.mockRejectedValueOnce(new Error('core down'))
      const res = await GET(req(), route)
      expect(res.status).toBe(200)
    })
  })

  it('a failed load-bearing read (dashboard data) → 502, never a silently-empty dashboard', async () => {
    getDashboardDataFor.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
  })

  it('a failed load-bearing read (staff roster) → 502', async () => {
    const { staffListByBusinessOrThrow } = jest.requireMock('@/lib/staff') as {
      staffListByBusinessOrThrow: jest.Mock
    }
    staffListByBusinessOrThrow.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
  })
})
