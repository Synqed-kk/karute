// AI再エンゲージメント facade read (§13, reengagement packet) — mirrors
// app-api-karute-ai-reads.test.ts's harness: capability gate, the
// status-aware tenancy proof BEFORE any LLM/cache call (cross-tenant → 404,
// genuine upstream → 502), the best-effort null payload as a 200 (NOT a
// 502), and that the route threads its server-derived status/visitPace/
// hasUpcomingBooking/preferredStaffName into the generator. The generator
// itself is mocked (its own null-on-exclusion/failure contract is
// ai-reengagement.test.ts's job); the Bearer verifier runs real.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'staff-assigned', full_name: '佐藤' }]),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const custGet = jest.fn(async (id: string) => {
  if (id === 'cust-upstream') throw Object.assign(new Error('boom'), { status: 500 })
  if (id !== 'cust-1') throw Object.assign(new Error('nope'), { status: 404 })
  return {
    id,
    name: '山田 花子',
    created_at: '2025-01-01T00:00:00Z',
    last_visit_at: '2026-06-01T00:00:00Z',
    first_visit_at: '2025-01-05T00:00:00Z',
    is_existing_customer: true,
    visit_count: 5,
    has_ticket_pack: false,
    assigned_staff_id: 'staff-assigned',
  }
})
const fakeClient = { customers: { get: (id: string) => custGet(id) } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient }))

const getCustomerKaruteRecordsWithClient = jest.fn(async () => [
  { id: 'k1', created_at: '2026-06-01T00:00:00Z', session_date: '2026-06-01' },
])
jest.mock('@/actions/karute', () => ({
  getCustomerKaruteRecordsWithClient: () => getCustomerKaruteRecordsWithClient(),
}))

const enrichCustomers = jest.fn(async () => new Map())
jest.mock('@/lib/customers/list-enrich', () => ({
  ...jest.requireActual('@/lib/customers/list-enrich'),
  enrichCustomers: () => enrichCustomers(),
}))

const getCustomerLifecycleCheckedWithClient = jest.fn(async () => ({ ok: true, lifecycle: null }))
jest.mock('@/lib/packs/store', () => ({
  getCustomerLifecycleCheckedWithClient: () => getCustomerLifecycleCheckedWithClient(),
}))

type ReengagementCallArgs = [unknown, string, string, string, Record<string, unknown>]
const getReengagementDraftWithClient = jest.fn<Promise<unknown>, ReengagementCallArgs>(async () => ({
  draft: 'draft body',
  reasoning: 'r',
  signals: [],
  tier: 'dormant',
}))
jest.mock('@/lib/karute/ai-reengagement', () => ({
  getReengagementDraftWithClient: (...args: ReengagementCallArgs) => getReengagementDraftWithClient(...args),
}))

import { GET as reengagement, OPTIONS as reengagementOptions } from '@/app/api/app/v1/customers/[id]/ai/reengagement/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(sub = 'auth-user-1') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (init: RequestInit = {}) => new Request('https://s/x', init)

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  getCustomerKaruteRecordsWithClient.mockResolvedValue([
    { id: 'k1', created_at: '2026-06-01T00:00:00Z', session_date: '2026-06-01' },
  ])
  enrichCustomers.mockResolvedValue(new Map())
  getCustomerLifecycleCheckedWithClient.mockResolvedValue({ ok: true, lifecycle: null })
  getReengagementDraftWithClient.mockResolvedValue({ draft: 'draft body', reasoning: 'r', signals: [], tier: 'dormant' })
})

describe('GET /customers/[id]/ai/reengagement', () => {
  it('happy path → 200 { draft }', async () => {
    const res = await reengagement(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    expect(((await res.json()).draft as { draft: string }).draft).toBe('draft body')
  })

  it('generator miss (gated/locked/failure) → 200 { draft: null } (NOT a 502)', async () => {
    getReengagementDraftWithClient.mockResolvedValueOnce(null)
    const res = await reengagement(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).draft).toBeNull()
  })

  it('cross-tenant / missing customer id → 404 BEFORE any LLM/records call', async () => {
    const res = await reengagement(req({ headers: auth }), routeFor('cust-x'))
    expect(res.status).toBe(404)
    expect(getCustomerKaruteRecordsWithClient).not.toHaveBeenCalled()
    expect(getReengagementDraftWithClient).not.toHaveBeenCalled()
  })

  it('genuine tenancy-proof upstream failure → 502 (not a false 404)', async () => {
    const res = await reengagement(req({ headers: auth }), routeFor('cust-upstream'))
    expect(res.status).toBe(502)
    expect(getReengagementDraftWithClient).not.toHaveBeenCalled()
  })

  it('missing capability → 403', async () => {
    capabilities.current = new Set()
    const res = await reengagement(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(403)
    expect(custGet).not.toHaveBeenCalled()
  })

  it('missing Bearer → 401', async () => {
    const res = await reengagement(req({ headers: { cookie: 'sb=x' } }), routeFor('cust-1'))
    expect(res.status).toBe(401)
  })

  it('OPTIONS shell origin → 204, no downstream', async () => {
    const res = await reengagementOptions(
      new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }),
      routeFor('cust-1'),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })

  it('threads server-derived status/preferredStaffName/hasUpcomingBooking into the generator call (never client-supplied)', async () => {
    enrichCustomers.mockResolvedValueOnce(
      new Map([
        [
          'cust-1',
          {
            totalKarute: 5,
            lastVisitIso: '2026-06-01T00:00:00Z',
            pastAppointmentCount: 5,
            lastVisitService: null,
            bookingStaffId: null,
            nextAppointmentIso: null,
            firstVisitIso: '2025-01-05T00:00:00Z',
            datedVisitCount: 5,
            noShowCount: 0,
          },
        ],
      ]),
    )
    const res = await reengagement(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    const [, businessId, actorId, requestId, params] = getReengagementDraftWithClient.mock.calls[0]
    expect(businessId).toBe('business-1')
    expect(params.customerId).toBe('cust-1')
    expect(params.customerName).toBe('山田 花子')
    expect(params.preferredStaffName).toBe('佐藤')
    expect(params.hasUpcomingBooking).toBe(false)
    expect(actorId).toBe('auth-user-1')
    expect(typeof requestId).toBe('string')
    expect(requestId.length).toBeGreaterThan(0)
    // Exactly ONE generator invocation per request.
    expect(getReengagementDraftWithClient).toHaveBeenCalledTimes(1)
  })

  it('an upcoming booking threads hasUpcomingBooking=true', async () => {
    enrichCustomers.mockResolvedValueOnce(
      new Map([
        [
          'cust-1',
          {
            totalKarute: 5,
            lastVisitIso: '2026-06-01T00:00:00Z',
            pastAppointmentCount: 5,
            lastVisitService: null,
            bookingStaffId: null,
            nextAppointmentIso: '2026-09-01T00:00:00Z',
            firstVisitIso: '2025-01-05T00:00:00Z',
            datedVisitCount: 5,
            noShowCount: 0,
          },
        ],
      ]),
    )
    await reengagement(req({ headers: auth }), routeFor('cust-1'))
    const [, , , , params] = getReengagementDraftWithClient.mock.calls[0]
    expect(params.hasUpcomingBooking).toBe(true)
  })
})
