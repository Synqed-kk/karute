// Extended customer-profile SCREEN facade read (packet 06 §Build 2, inventory
// #4 — the highest customer-data class). Verifies the route contract on the
// full 12-read wave: capability gate, tenancy proof BEFORE the wave, the
// FAILURE CONTRACT (photos/consent/org-settings failures → 502, never an
// empty-but-200 DTO), packs staying page-parity graceful, the checked-read
// lifecycle exception, and the additive DTO (coarse packet-03 fields survive).
//
// buildCustomerProfileScreen is mocked (its verbatim derivation is exercised by
// the web page + byte-diffed in -03a); this test owns the ROUTE wiring + DTO +
// error contract. All network mocked; the Bearer verifier runs for real.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string) => k,
  getLocale: async () => 'ja',
}))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
// list-enrich imports the ESM SynqedClient class at module scope (requireActual
// below loads it) — stub the untransformed-ESM package.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

// Identity seam: membership + capability resolution keyed on the verified sub.
const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'profile-9', full_name: '田中' }]),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// Fake business-scoped synqed client (newSynqedClient/getSynqedClient).
const CUSTOMER_ROW = {
  id: 'cust-1', name: '山田 花子', furigana: 'ヤマダ ハナコ', phone: '090', email: 'h@example.com',
  notes: null, assigned_staff_id: 'profile-9', is_existing_customer: true, date_of_birth: '1990-01-01',
  gender: 'female', occupation: null, member_number: null, visit_count: 3, has_ticket_pack: false,
  last_visit_at: '2026-06-01T00:00:00Z', first_visit_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T12:00:00Z',
}
const listPhotos = jest.fn(async () => ({ photos: [] }))
const getConsent = jest.fn(async () => ({ consent: { policy_version: 'v0', granted_at: '2026-06-01' } }))
const fakeClient = { customers: { get: jest.fn(async () => CUSTOMER_ROW), listPhotos, getConsent } }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

// @synqed-kk/client ships ESM jest can't parse; the route imports SynqedError
// from it. Stub it (same pattern as appointments-store-scope.test.ts) — the
// route's instanceof checks against this same module-registry class.
jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  return { SynqedError }
})

// Tenancy proof — a cross-tenant id reads as not-found (business-scoped client).
// Throws the SDK's 404 shape: only SynqedError(404) may map to not_found;
// any other lookup failure is an outage (502), never a phantom 404.
jest.mock('@/lib/customers/queries', () => {
  const { SynqedError } = jest.requireMock('@synqed-kk/client')
  return {
    getCustomerWithClient: jest.fn(async (_c: unknown, id: string) => {
      if (id === 'cust-DOWN') throw new Error('ECONNRESET upstream')
      if (id !== 'cust-1') throw new SynqedError(404, 'not this tenant')
      return CUSTOMER_ROW
    }),
  }
})

// Wave helpers — resolve deterministically; individual tests override to throw.
jest.mock('@/lib/customers/customer-detail-cached', () => ({
  getCustomerContactForBusiness: jest.fn(async () => ({ phone: '090', email: 'h@example.com' })),
}))
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: jest.fn(async () => ({ customers: [CUSTOMER_ROW], total: 1 })),
}))
jest.mock('@/lib/karute/synqed-records', () => ({
  listSynqedKaruteRowsOrThrow: jest.fn(async () => []),
}))
jest.mock('@/lib/customers/list-enrich', () => ({
  ...jest.requireActual('@/lib/customers/list-enrich'),
  enrichCustomers: jest.fn(async () => new Map()),
}))
jest.mock('@/lib/karute/customer-memory', () => ({ getCustomerMemory: jest.fn(async () => []) }))
jest.mock('@/lib/karute/ai-passport', () => ({ getCachedPassportForBusiness: jest.fn(async () => null) }))
const orgSettingsWithClient = jest.fn(
  async (): Promise<{ ticket_packs_enabled: boolean; business_type: string } | null> => ({
    ticket_packs_enabled: true,
    business_type: 'salon',
  }),
)
jest.mock('@/actions/org-settings', () => ({ orgSettingsWithClient: () => orgSettingsWithClient() }))
const listCustomerPacksWithClient = jest.fn(async (): Promise<unknown[]> => [])
const getCustomerLifecycleCheckedWithClient = jest.fn(
  async (): Promise<{ ok: true; lifecycle: null } | { ok: false }> => ({ ok: true, lifecycle: null }),
)
jest.mock('@/lib/packs/store', () => ({
  listCustomerPacksWithClient: () => listCustomerPacksWithClient(),
  getCustomerLifecycleCheckedWithClient: () => getCustomerLifecycleCheckedWithClient(),
}))

// The verbatim derivation is exercised elsewhere; mock it to a fixed screen.
const FIXED_SCREEN = {
  customer: {
    id: 'cust-1', name: '山田 花子', initials: '山', karuteNumber: '#00001', age: 36, gender: '女性',
    joinDate: '2026年1月1日', totalKarute: 1, visitCount: 3, phone: '090', email: 'h@example.com',
    preferredStaffId: 'profile-9', preferredStaffName: null, bookingStaffName: null, status: 'on-track',
    memoryCount: 0, sessionCount: 1, photoCount: 0, lastVisitDate: '2026年6月1日', occupation: null,
    hasTicketPack: false, memberNumber: null, isBirthdayMonth: false, dateOfBirth: '1990-01-01',
    genderCode: 'female', bookingMemo: null, visitPace: null, visitPaceLastVisitDate: null,
    visitPaceLastService: null, noShowCount: 0,
  },
  sessions: [], photos: [],
  customerMemory: { customerId: 'cust-1', items: [], intake: null, lastUpdatedAt: '2026-06-01', updatedThisVisit: 0 },
  packs: [], lifecycle: null, hasNextBooking: false, ticketsEnabled: true,
  consentGranted: true, consentGrantedAtLabel: '2026年6月1日',
  assignableStaff: [{ id: 'profile-9', name: '田中' }],
}
jest.mock('@/lib/customers/profile-screen', () => ({
  buildCustomerProfileScreen: jest.fn(async () => FIXED_SCREEN),
}))

import { GET } from '@/app/api/app/v1/customers/[id]/route'

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
const auth = { authorization: `Bearer ${bearer()}` }
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (init: RequestInit = {}) => new Request('https://s/api/app/v1/customers/x', init)

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  listPhotos.mockResolvedValue({ photos: [] })
  getConsent.mockResolvedValue({ consent: { policy_version: 'v0', granted_at: '2026-06-01' } })
  orgSettingsWithClient.mockResolvedValue({ ticket_packs_enabled: true, business_type: 'salon' })
  listCustomerPacksWithClient.mockResolvedValue([])
  getCustomerLifecycleCheckedWithClient.mockResolvedValue({ ok: true, lifecycle: null })
})

describe('GET /api/app/v1/customers/[id] — full profile screen (packet 06 §Build 2)', () => {
  it('returns the additive screen DTO: coarse packet-03 fields + the full screen shape', async () => {
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    const dto = await res.json()
    // Coarse packet-03 fields SURVIVE (additive) — existing consumers keep working.
    expect(dto.id).toBe('cust-1')
    expect(dto.assignedStaffId).toBe('profile-9')
    expect(dto.version).toBe(CUSTOMER_ROW.updated_at)
    // Full screen shape.
    expect(dto.profile.karuteNumber).toBe('#00001')
    expect(Array.isArray(dto.sessions)).toBe(true)
    expect(dto.customerMemory.customerId).toBe('cust-1')
    expect(dto.ticketsEnabled).toBe(true)
    expect(dto.consentGranted).toBe(true)
    expect(dto.consentGrantedAtLabel).toBe('2026年6月1日')
    // Staff roster folded into the DTO (§Build 3 client-read trace): the thin
    // edit dialog seeds its 指名スタッフ picker from here, not a facade read.
    expect(dto.assignableStaff).toEqual([{ id: 'profile-9', name: '田中' }])
  })

  it('cross-tenant customer id → 404 not_found, BEFORE any wave read', async () => {
    const res = await GET(req({ headers: auth }), routeFor('cust-OTHER'))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('not_found')
    expect(listPhotos).not.toHaveBeenCalled()
    expect(orgSettingsWithClient).not.toHaveBeenCalled()
  })

  it('lookup outage (non-404 failure) → 502 upstream_unavailable, never a phantom 404', async () => {
    const res = await GET(req({ headers: auth }), routeFor('cust-DOWN'))
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('missing Bearer (cookie present) → 401, no downstream call', async () => {
    const res = await GET(req({ headers: { cookie: 'sb=x' } }), routeFor('cust-1'))
    expect(res.status).toBe(401)
    expect(listPhotos).not.toHaveBeenCalled()
  })

  it('missing capability → 403 forbidden, before tenancy/wave', async () => {
    capabilities.current = new Set()
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(listPhotos).not.toHaveBeenCalled()
  })

  it('photos read failure → 502, never an empty-but-200 DTO', async () => {
    listPhotos.mockRejectedValueOnce(new Error('storage down'))
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('consent read failure → 502 (page swallows to null; facade must not)', async () => {
    getConsent.mockRejectedValueOnce(new Error('consent down'))
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(502)
  })

  it('org-settings read failure → 502 (page swallows to null; facade must not)', async () => {
    orgSettingsWithClient.mockRejectedValueOnce(new Error('settings down'))
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(502)
  })

  it('packs read failure stays PAGE-PARITY graceful → still 200 (empty pack card)', async () => {
    listCustomerPacksWithClient.mockRejectedValueOnce(new Error('packs down'))
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
  })

  it('lifecycle checked-read failure is carried (ok:false) → still 200 (pace suppressed)', async () => {
    getCustomerLifecycleCheckedWithClient.mockResolvedValueOnce({ ok: false })
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
  })

  it('locale=en is accepted; an unknown locale falls back to ja', async () => {
    const en = await GET(new Request('https://s/api/app/v1/customers/x?locale=en', { headers: auth }), routeFor('cust-1'))
    expect(en.status).toBe(200)
    const bad = await GET(new Request('https://s/api/app/v1/customers/x?locale=zz', { headers: auth }), routeFor('cust-1'))
    expect(bad.status).toBe(200)
  })
})
