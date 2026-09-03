// PHONEWIRE-1 — the 新規顧客 create facade pair, end-to-end. Until this pair
// shipped the customers tree had `[id]/*` subroutes but NO create door, so the
// phone's createCustomer/createQuickCustomer ports were notWired stubs and
// every 新規顧客 save on a phone threw.
//
// What this file pins: the unauthenticated probe, the zod shape rejection (no
// core write), the happy path through the SHARED body, the Idempotency-Key
// requirement, the capability gate — and the ⚖ STORE ISOLATION assertion: the
// business comes from the BEARER identity alone, and a body carrying
// business_id / store_id / visit_count reaches core with those keys STRIPPED.
//
// Shape follows app-api-customer-route.test.ts (the PATCH sibling next door).
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

// customer.create / customer.quickCreate are revocation-sensitive, so both
// POSTs round-trip getUser.
const mockGetUser = jest.fn(
  async (): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }> => ({
    data: { user: { id: 'auth-user-1' } },
    error: null,
  }),
)
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: () => mockGetUser() } }),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view'])),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

const create = jest.fn(async (input: { name: string }) => ({ id: 'cust-new', name: input.name }))
const checkDuplicate = jest.fn(async () => ({ exists: false, existing_name: null }))
const newSynqedClient = jest.fn((_businessId: string) => ({ customers: { create, checkDuplicate } }))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
  getSynqedClient: async () => newSynqedClient('business-1'),
}))

import { POST, OPTIONS } from '@/app/api/app/v1/customers/route'
import { POST as QUICK_POST } from '@/app/api/app/v1/customers/quick/route'
import { capabilitiesForUser } from '@/lib/auth/require-permission'

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
const idem = { 'idempotency-key': '11111111-1111-4111-8111-111111111111' }
const json = { 'content-type': 'application/json' }
const route = { params: Promise.resolve({}) }
const post = (body: unknown, headers: Record<string, string> = { ...auth, ...idem, ...json }) =>
  new Request('https://s/api/app/v1/customers', { method: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
})

describe('POST /api/app/v1/customers (新規顧客)', () => {
  it('UNAUTHENTICATED → 401, no core write', async () => {
    const res = await POST(post({ name: '山田 花子' }, { ...idem, ...json }), route)
    expect(res.status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })

  it('creates through the shared body and answers 201 with the new id', async () => {
    const res = await POST(post({ name: '山田 花子', phone: '090-0000-0000' }), route)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'cust-new' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '山田 花子', phone: '090-0000-0000', email: null }),
    )
  })

  it('forwards the duplicate-name warning core reports', async () => {
    checkDuplicate.mockResolvedValueOnce({ exists: true, existing_name: '山田 花子' } as never)
    const res = await POST(post({ name: '山田 花子' }), route)
    expect(res.status).toBe(201)
    expect((await res.json()).duplicateWarning).toContain('山田 花子')
  })

  it('REJECTS an empty name (zod) → 400, no core write', async () => {
    const res = await POST(post({ name: '   ' }), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
    expect(create).not.toHaveBeenCalled()
  })

  it('REJECTS a non-JSON body → 400, no core write', async () => {
    const res = await POST(
      new Request('https://s/api/app/v1/customers', { method: 'POST', headers: { ...auth, ...idem, ...json }, body: 'not json' }),
      route,
    )
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('requires an Idempotency-Key → 400, no core write (a retry must not mint a second 顧客)', async () => {
    const res = await POST(post({ name: '山田 花子' }, { ...auth, ...json }), route)
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no core write', async () => {
    ;(capabilitiesForUser as jest.Mock).mockResolvedValueOnce(new Set())
    const res = await POST(post({ name: '山田 花子' }), route)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  it('a REVOKED user → 401 revoked, no core write', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'token revoked' } })
    const res = await POST(post({ name: '山田 花子' }), route)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('revoked')
    expect(create).not.toHaveBeenCalled()
  })

  // ⚖ STORE ISOLATION LAW — the two halves that matter for a CREATE.
  it('scopes the write to the BEARER business, and a body cannot widen it', async () => {
    const res = await POST(
      post({ name: '山田 花子', business_id: 'other-business', store_id: 'store-9', visit_count: 999 }),
      route,
    )
    expect(res.status).toBe(201)
    // (1) the client is built from the token's business, never a body/header.
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    // (2) z.object STRIPS: none of the three smuggled keys reaches core.
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('business_id')
    expect(payload).not.toHaveProperty('store_id')
    expect(payload).not.toHaveProperty('visit_count')
  })
})

describe('POST /api/app/v1/customers/quick (かんたん作成)', () => {
  const quick = (body: unknown, headers: Record<string, string> = { ...auth, ...idem, ...json }) =>
    new Request('https://s/api/app/v1/customers/quick', { method: 'POST', headers, body: JSON.stringify(body) })

  it('UNAUTHENTICATED → 401, no core write', async () => {
    const res = await QUICK_POST(quick({ name: '田中' }, { ...idem, ...json }), route)
    expect(res.status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })

  it('creates name-only and echoes core’s stored name back for the picker', async () => {
    const res = await QUICK_POST(quick({ name: '  田中 一郎  ' }), route)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'cust-new', name: '田中 一郎' })
    // Name-only body — quick-create runs NO duplicate check, exactly as web.
    expect(create).toHaveBeenCalledWith({ name: '田中 一郎' })
    expect(checkDuplicate).not.toHaveBeenCalled()
  })

  it('REJECTS a wrong-typed name at the door → 400, no core write', async () => {
    const res = await QUICK_POST(quick({ name: 42 }), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
    expect(create).not.toHaveBeenCalled()
  })

  it('REJECTS an empty name → 400, no core write', async () => {
    const res = await QUICK_POST(quick({ name: '   ' }), route)
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('requires an Idempotency-Key → 400, no core write', async () => {
    const res = await QUICK_POST(quick({ name: '田中' }, { ...auth, ...json }), route)
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('scopes the write to the BEARER business', async () => {
    await QUICK_POST(quick({ name: '田中' }), route)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })
})

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS for a shell origin, no auth required', async () => {
    const res = await OPTIONS(
      new Request('https://s/api/app/v1/customers', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }),
      route,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
  })
})
