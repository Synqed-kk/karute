// Customer-profile facade slice, end-to-end (packet 03 vertical slice). Negative
// tests: wrong-tenant → 404, strict-schema rejects an unknown key, If-Match
// conflict → 409, plus the happy GET/PATCH DTO round-trip and the OPTIONS
// preflight. All network mocked; the Bearer verifier runs for real against the
// test-env HS256 secret.
import { createHmac } from 'node:crypto'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn() }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view'])),
}))

// Fake business-scoped synqed client — newSynqedClient/getSynqedClient both
// return it. A get for an unknown id rejects (business-scoped → cross-tenant
// reads as not-found).
const CUSTOMER_ROW = {
  id: 'cust-1', name: '山田 花子', furigana: 'ヤマダ ハナコ', phone: '090', email: 'h@example.com',
  notes: null, assigned_staff_id: 'profile-9', date_of_birth: '1990-01-01', gender: 'female',
  occupation: null, member_number: null, visit_count: 3, has_ticket_pack: false,
  last_visit_at: '2026-06-01T00:00:00Z', first_visit_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T12:00:00Z',
}
const update = jest.fn(async () => ({}))
const fakeClient = {
  customers: {
    get: jest.fn(async (id: string) => {
      if (id !== 'cust-1') throw new Error('404 not this tenant')
      return CUSTOMER_ROW
    }),
    getConsent: jest.fn(async () => ({ consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION } })),
    update,
  },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

import { GET, PATCH, OPTIONS } from '@/app/api/app/v1/customers/[id]/route'

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

beforeEach(() => jest.clearAllMocks())

describe('GET /api/app/v1/customers/[id]', () => {
  it('returns the validated profile DTO for a customer in the caller tenant', async () => {
    const res = await GET(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.id).toBe('cust-1')
    expect(dto.assignedStaffId).toBe('profile-9') // distinct id namespace, named
    expect(dto.consentGranted).toBe(true)
    expect(dto.version).toBe(CUSTOMER_ROW.updated_at)
  })

  it('rejects a customer from ANOTHER tenant → 404 (wrong-tenant)', async () => {
    const res = await GET(req({ headers: auth }), routeFor('cust-OTHER'))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('not_found')
  })

  it('rejects a missing Bearer token → 401', async () => {
    const res = await GET(req({ headers: {} }), routeFor('cust-1'))
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/app/v1/customers/[id]', () => {
  it('applies a whitelisted partial update and returns the fresh DTO', async () => {
    const res = await PATCH(req({ method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ notes: 'VIP' }) }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('cust-1', { notes: 'VIP' })
  })

  it('REJECTS an unknown key (strict schema) → 400, no core write', async () => {
    const res = await PATCH(req({ method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ visit_count: 999, business_id: 'other' }) }), routeFor('cust-1'))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
    expect(update).not.toHaveBeenCalled()
  })

  it('honors If-Match — a stale version → 409 conflict, no write', async () => {
    const res = await PATCH(req({ method: 'PATCH', headers: { ...auth, 'content-type': 'application/json', 'if-match': 'STALE-VERSION' }, body: JSON.stringify({ notes: 'x' }) }), routeFor('cust-1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('conflict')
    expect(update).not.toHaveBeenCalled()
  })

  it('If-Match with the current version proceeds', async () => {
    const res = await PATCH(req({ method: 'PATCH', headers: { ...auth, 'content-type': 'application/json', 'if-match': CUSTOMER_ROW.updated_at }, body: JSON.stringify({ notes: 'x' }) }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalled()
  })
})

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS for a shell origin, no auth required', async () => {
    const res = await OPTIONS(req({ method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), routeFor('cust-1'))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })
})
