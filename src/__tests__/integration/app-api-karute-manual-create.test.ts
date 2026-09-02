// PHONEWIRE-2A — the ＋新規カルテ manual-create facade door, end-to-end. Until
// this route shipped the karute tree had `route.ts` (save), `window` and
// `reveal` but no MANUAL create door, so the phone's createManualKaruteRecord
// port was a soft stub that answered every tap with an inline error.
//
// What this file pins: the unauthenticated probe, the Idempotency-Key
// requirement, the records.write gate, the other-staff records.delete
// escalation, the tenancy proof, the audit row, the 502 mapping for a core
// write failure — and the ⚖ STORE ISOLATION assertions: the store comes from
// the BEARER clamp, a body cannot carry one, and the payload core receives is
// an EXPLICIT field list (the mutation-load-bearing guard).
//
// Harness shape follows app-api-karute-save.test.ts (the sibling next door);
// the REAL createManualKaruteRecordWithClient runs, all network mocked.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

const audit = jest.fn()
// Spread the REAL module so FACADE_AUDIT_MAP stays live inside logFacadeAudit
// — a bare { audit } factory makes the map lookup throw-and-swallow, and the
// emitted-row assertion below could never see the real rule.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = {
  fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })),
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['records.write', 'stores.viewAll']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中' }] as Array<{ id: string; full_name: string }> }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const customersGet = jest.fn(async (id: string) => {
  if (id !== 'cust-1') throw Object.assign(new Error('x'), { status: id === 'cust-boom' ? 500 : 404 })
  return { id, name: 'Y' }
})
const create = jest.fn(async (_payload: unknown) => ({ id: 'kar-new' }))
const staffStoresGet = jest.fn(async () => ({ store_ids: ['store-a', 'store-b'] }))
const storesGet = jest.fn(async (_id: string) => ({ id: 'store-a' }))
const newSynqedClient = jest.fn((_businessId: string) => ({
  customers: { get: customersGet },
  karuteRecords: { create },
  staffStores: { get: staffStoresGet },
  stores: { get: storesGet },
}))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
  getSynqedClient: async () => newSynqedClient('business-1'),
}))

import { POST, OPTIONS } from '@/app/api/app/v1/karute/manual/route'

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

const BODY = {
  customerId: 'cust-1',
  staffId: 'auth-user-1',
  sessionDate: '2026-08-30',
  durationMinutes: 60,
  service: 'カット',
}
const post = (body: unknown, headers: Record<string, string> = { ...auth, ...idem, ...json }) =>
  new Request('https://s/api/app/v1/karute/manual', { method: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.write', 'stores.viewAll'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中' }]
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
})

describe('POST /api/app/v1/karute/manual (＋新規カルテ)', () => {
  it('UNAUTHENTICATED → 401, no core write', async () => {
    const res = await POST(post(BODY, { ...idem, ...json }), route)
    expect(res.status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })

  it('requires an Idempotency-Key → 400, no core write (a retry must not mint a second カルテ)', async () => {
    const res = await POST(post(BODY, { ...auth, ...json }), route)
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('missing records.write → 403, no core write', async () => {
    capabilities.current = new Set(['stores.viewAll'])
    const res = await POST(post(BODY), route)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  it('a REVOKED user → 401 revoked, no core write', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'token revoked' } })
    const res = await POST(post(BODY), route)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('revoked')
    expect(create).not.toHaveBeenCalled()
  })

  it('REJECTS a non-JSON body → 400, no core write', async () => {
    const res = await POST(
      new Request('https://s/api/app/v1/karute/manual', {
        method: 'POST',
        headers: { ...auth, ...idem, ...json },
        body: 'not json',
      }),
      route,
    )
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('REJECTS a wrong-typed field at the door (zod) → 400, no core write', async () => {
    const res = await POST(post({ ...BODY, durationMinutes: '60' }), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
    expect(create).not.toHaveBeenCalled()
  })

  // ── Tenancy ───────────────────────────────────────────────────────────────
  it('a cross-tenant / unknown customerId → 404 BEFORE any write', async () => {
    const res = await POST(post({ ...BODY, customerId: 'cust-other-tenant' }), route)
    expect(res.status).toBe(404)
    expect(create).not.toHaveBeenCalled()
  })

  it('an UPSTREAM failure proving the customer → 502, no write', async () => {
    const res = await POST(post({ ...BODY, customerId: 'cust-boom' }), route)
    expect(res.status).toBe(502)
    expect(create).not.toHaveBeenCalled()
  })

  // ── Staff attribution + the supervisory escalation ────────────────────────
  it('assigning to YOURSELF is always fine', async () => {
    const res = await POST(post(BODY), route)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'kar-new' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ staff_id: 'auth-user-1' }))
  })

  it('ANOTHER staff WITHOUT records.delete → 403, no core write', async () => {
    roster.current = [
      { id: 'auth-user-1', full_name: '田中' },
      { id: 'staff-2', full_name: '佐藤' },
    ]
    const res = await POST(post({ ...BODY, staffId: 'staff-2' }), route)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  it('ANOTHER staff WITH records.delete → allowed, filed under that staff', async () => {
    capabilities.current = new Set(['records.write', 'records.delete', 'stores.viewAll'])
    roster.current = [
      { id: 'auth-user-1', full_name: '田中' },
      { id: 'staff-2', full_name: '佐藤' },
    ]
    const res = await POST(post({ ...BODY, staffId: 'staff-2' }), route)
    expect(res.status).toBe(201)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ staff_id: 'staff-2' }))
  })

  it('an unresolvable SELF staff id fails closed → 403, no core write', async () => {
    roster.current = [{ id: 'someone-else', full_name: '別人' }]
    const res = await POST(post(BODY), route)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  // ── ⚖ STORE ISOLATION LAW ────────────────────────────────────────────────
  it('takes the store from the BEARER clamp, not from anything the client sent', async () => {
    // A store-scoped staff (no viewAll): the clamp resolves their assignment.
    capabilities.current = new Set(['records.write'])
    const res = await POST(post(BODY), route)
    expect(res.status).toBe(201)
    expect(staffStoresGet).toHaveBeenCalledWith('auth-user-1')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-a' }))
    // and the client itself is built from the token's business alone.
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('a store-id HEADER outside the caller assignment → 403, no core write', async () => {
    capabilities.current = new Set(['records.write'])
    const res = await POST(post(BODY, { ...auth, ...idem, ...json, 'store-id': 'store-zzz' }), route)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  it('a body carrying a store key is REJECTED at the door → 400, no core write', async () => {
    for (const smuggled of [{ storeId: 'store-evil' }, { store_id: 'store-evil' }]) {
      jest.clearAllMocks()
      const res = await POST(post({ ...BODY, ...smuggled }), route)
      expect(res.status).toBe(400)
      expect(create).not.toHaveBeenCalled()
    }
  })

  it('sends core an EXPLICIT payload — no client-shaped keys ride through', async () => {
    // The load-bearing store-isolation guard (see the shared body's own note):
    // exact equality, so replacing the explicit field list with a `...input`
    // spread turns this red — a spread would leak customerId/staffId/
    // sessionDate/durationMinutes/service through verbatim.
    await POST(post(BODY), route)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toEqual({
      customer_id: 'cust-1',
      store_id: null, // viewAll + no store-id header = unclamped within the tenant
      staff_id: 'auth-user-1',
      status: 'DRAFT',
      transcript: null,
      ai_summary: null,
      entries: [],
      service: 'カット',
      duration_minutes: 60,
      session_date: '2026-08-30',
    })
  })

  it("normalises the dialog's own 'unset' values to null, exactly as web does", async () => {
    await POST(post({ ...BODY, service: '', durationMinutes: 0, sessionDate: '' }), route)
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({ service: null, duration_minutes: null, session_date: null }),
    )
  })

  // ── Audit + failure mapping ──────────────────────────────────────────────
  it('emits the karute.manual_create audit row targeting the new record', async () => {
    await POST(post(BODY), route)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.manual_create',
        targetType: 'karute',
        targetId: 'kar-new',
      }),
    )
  })

  it('a core write failure → 502 (never a 400), and no audit row', async () => {
    create.mockRejectedValueOnce(new Error('core exploded'))
    const res = await POST(post(BODY), route)
    expect(res.status).toBe(502)
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS for a shell origin, no auth required', async () => {
    const res = await OPTIONS(
      new Request('https://s/api/app/v1/karute/manual', {
        method: 'OPTIONS',
        headers: { origin: 'capacitor://localhost' },
      }),
      route,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
  })
})
