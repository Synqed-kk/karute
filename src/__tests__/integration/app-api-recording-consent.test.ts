// Recording-flow WRITES batch 5 (packet 08 §Build 3): consent read/grant, the
// recording-session mint, the signed-upload-url mint. Verifies capability +
// Idempotency-Key + revocation (server round-trip, no fast-path) + the #452
// fail-closed staff posture + policy_version SERVER-pinning + the tenant-prefixed
// storage path. All network mocked; the Bearer verifier runs for real.
import { createHmac } from 'node:crypto'
import { fakeCreateSignedUploadUrl, OBJECT_NOT_FOUND } from './helpers/storage-fakes'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view', 'records.write']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] as Array<{ id: string; full_name: string; display_role: string }> }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// synqed client — customers (get/getConsent/grantConsent), appointments, recordings.
const grantConsent = jest.fn(async () => ({ id: 'consent-1' }))
const recordingsCreate = jest.fn(async (_input: unknown) => ({ id: 'rec-1' }))
const customersGet = jest.fn(async (id: string) => { if (id !== 'cust-1') throw Object.assign(new Error('x'), { status: 404 }); return { id, name: 'Y' } })
const getConsent = jest.fn(async () => ({ consent: { granted_at: '2026-05-01T00:00:00Z' } }))
// ③ The session mint now stamps the caller's store, so its route runs the
// store clamp first (recordings/session/route.ts). Floating staff (an empty
// assignment) = unrestricted within the tenant, which is what every case in
// this file is about: the clamp passes and the mint's own contract is the
// subject. `stores.get` answers the tenancy probe for a supplied store-id.
// ⚖ amendment 10: an unrestricted caller who sent no `store-id` now falls back
// to the business's PRIMARY store, so `stores.list` is part of this route's
// contract too.
type FakeStore = { id: string; is_primary: boolean }
const staffStoresGet = jest.fn(async (_id: string) => ({ store_ids: [] as string[] }))
const storesGet = jest.fn(async (id: string) => ({ id }))
const storesList = jest.fn(async () => ({
  stores: [
    { id: 'store-second', is_primary: false },
    { id: 'store-primary', is_primary: true },
  ] as FakeStore[],
}))
const fakeClient = {
  customers: { get: customersGet, getConsent, grantConsent },
  appointments: { get: jest.fn(async () => ({ staff_id: 'appt-staff' })) },
  recordings: { create: recordingsCreate },
  staffStores: { get: staffStoresGet },
  stores: { get: storesGet, list: storesList },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

// Service-role storage (upload-url). `info` is the session mint's own exists
// fence too (fix round 11) — default not-found, the key is free.
/** What the fake bucket HOLDS — a non-upsert sign is a CREATE and storage
 *  refuses one for a key already there (helpers/storage-fakes.ts). */
const held = new Set<string>()
const createSignedUploadUrl = jest.fn(fakeCreateSignedUploadUrl(held, () => 'https://x/upload'))
const info = jest.fn(async (_key: string) => ({ data: null as { size?: number } | null, error: { ...OBJECT_NOT_FOUND } as { message: string; status?: number; statusCode?: string } | null }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ storage: { from: () => ({ createSignedUploadUrl, info }) } }) }))

import { GET as consentGET } from '@/app/api/app/v1/customers/[id]/consent/route'
import { POST as grantPOST } from '@/app/api/app/v1/customers/[id]/consent/grant/route'
import { POST as mintPOST } from '@/app/api/app/v1/recordings/session/route'
import { POST as uploadPOST } from '@/app/api/app/v1/recordings/upload-url/route'

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
const idem = { 'idempotency-key': 'k1' }
const authOnly = { authorization: `Bearer ${bearer()}` }
const auth = { ...authOnly, 'content-type': 'application/json' }
const route = (id = 'cust-1') => ({ params: Promise.resolve({ id }) })
const noRoute = { params: Promise.resolve({}) }
const jreq = (headers: Record<string, string>, body?: unknown) =>
  new Request('https://s/x', { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks() // reset call counts (keeps the jest.fn implementations)
  held.clear()
  capabilities.current = new Set(['customers.view', 'records.write'])
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  staffStoresGet.mockImplementation(async () => ({ store_ids: [] }))
  storesGet.mockImplementation(async (id: string) => ({ id }))
  storesList.mockImplementation(async () => ({
    stores: [
      { id: 'store-second', is_primary: false },
      { id: 'store-primary', is_primary: true },
    ],
  }))
})

describe('GET consent', () => {
  it('happy → 200 with consent', async () => {
    const res = await consentGET(new Request('https://s/x', { headers: authOnly }), route())
    expect(res.status).toBe(200)
    expect((await res.json()).consent).toBeTruthy()
  })
  it('cross-tenant → 404', async () => {
    const res = await consentGET(new Request('https://s/x', { headers: authOnly }), route('cust-x'))
    expect(res.status).toBe(404)
  })
  it('genuine upstream getConsent failure → 502', async () => {
    getConsent.mockImplementationOnce(async () => { throw new Error('down') })
    const res = await consentGET(new Request('https://s/x', { headers: authOnly }), route())
    expect(res.status).toBe(502)
  })
  it('missing Bearer → 401', async () => {
    const res = await consentGET(new Request('https://s/x'), route())
    expect(res.status).toBe(401)
  })
})

describe('POST consent grant', () => {
  it('happy → 200; policy_version SERVER-pinned (client cannot supply it)', async () => {
    const res = await grantPOST(jreq({ ...auth, ...idem }, { method: 'WRITTEN', policy_version: 'HACKED' }), route())
    // .strict() rejects the extra policy_version key → 400 (never forwarded).
    expect(res.status).toBe(400)
  })
  it('happy → 200; grant core pins the SERVER policy version', async () => {
    const res = await grantPOST(jreq({ ...auth, ...idem }, { method: 'WRITTEN' }), route())
    expect(res.status).toBe(200)
    const payload = (grantConsent.mock.calls.at(-1) as unknown[])[1] as { policy_version: string; method: string }
    expect(payload.method).toBe('WRITTEN')
    expect(payload.policy_version).toBeTruthy()
  })
  it('missing Idempotency-Key → 400 before any write', async () => {
    const res = await grantPOST(jreq(auth, { method: 'VERBAL' }), route())
    expect(res.status).toBe(400)
    expect(grantConsent).not.toHaveBeenCalled()
  })
  it('unresolvable selfStaffId → 403, no write (#452)', async () => {
    roster.current = [{ id: 'someone-else', full_name: 'x', display_role: 'practitioner' }]
    const res = await grantPOST(jreq({ ...auth, ...idem }, { method: 'VERBAL' }), route())
    expect(res.status).toBe(403)
    expect(grantConsent).not.toHaveBeenCalled()
  })
  it('missing capability → 403', async () => {
    capabilities.current = new Set(['bookings.manage'])
    const res = await grantPOST(jreq({ ...auth, ...idem }, { method: 'VERBAL' }), route())
    expect(res.status).toBe(403)
  })
  it('invalid method enum → 400', async () => {
    const res = await grantPOST(jreq({ ...auth, ...idem }, { method: 'SMOKE' }), route())
    expect(res.status).toBe(400)
  })
  it('cross-tenant → 404 before write', async () => {
    const res = await grantPOST(jreq({ ...auth, ...idem }, { method: 'VERBAL' }), route('cust-x'))
    expect(res.status).toBe(404)
  })
  it('revoked staffer → 401 via server round-trip (no fast-path)', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await grantPOST(jreq({ ...auth, ...idem }, { method: 'VERBAL' }), route())
    expect(res.status).toBe(401)
    expect(grantConsent).not.toHaveBeenCalled()
  })
})

// ── ⚖ THE STORE THE DEVICE IS IN (slice three ③, amendment 10) ─────────────
// The row now carries the store the caller is working in — the Bearer twin of
// the web action's active store, resolved by the same clamp the job route uses.
// The clamp runs BEFORE the fail-open try: a store this caller may not use is a
// 403, never a 200 {id:null} that would let the take be captured against it.
// ⚖ AMENDMENT 10: and a NEW row is never born store-less either — an
// unrestricted caller who sent no header gets the business's PRIMARY store (the
// same store the shell seeds its own lens to), and a lookup that cannot answer
// is the same fail-closed 403.
describe('POST recordings/session mint — the store rides along', () => {
  const idem = { 'idempotency-key': 'idem-1' }

  it('sends the CLAMP’s store — the `store-id` header, proven to be the caller’s', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    const res = await mintPOST(
      jreq({ ...auth, ...idem, 'store-id': 'store-a' }, { customerId: 'cust-1' }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-a' }),
    )
  })

  it('an UNRESTRICTED caller’s header wins too — no primary lookup happens', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await mintPOST(
      jreq({ ...auth, ...idem, 'store-id': 'store-a' }, { customerId: 'cust-1' }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-a' }),
    )
    expect(storesList).not.toHaveBeenCalled()
  })

  it('falls back to the caller’s first assigned store when no header is sent', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a', 'store-b'] })
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(200)
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-a' }),
    )
    // A clamped caller can never reach the primary-store fallback: the clamp
    // already answered `requested ?? assigned[0]`. Pinned so the fallback can
    // never quietly become a second lens for staff who already have one.
    expect(storesList).not.toHaveBeenCalled()
  })

  it('an UNRESTRICTED caller with no header gets the PRIMARY store (⚖ amendment 10)', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(200)
    // `is_primary` decides — NOT the list order (the primary is second here).
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-primary' }),
    )
  })

  it('…and the FIRST store when the business marks none primary', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockResolvedValue({
      stores: [
        { id: 'store-second', is_primary: false },
        { id: 'store-third', is_primary: false },
      ],
    })
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(200)
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-second' }),
    )
  })

  it('a store lookup that cannot ANSWER → 403, and NO row is created', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockRejectedValue(new Error('core down'))
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('a business with ZERO stores → 403, and NO row is created (never a null stamp)', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockResolvedValue({ stores: [] })
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('a store-id OUTSIDE the caller’s assignment → 403, and NO row is created', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    const res = await mintPOST(
      jreq({ ...auth, ...idem, 'store-id': 'store-9' }, { customerId: 'cust-1' }),
      noRoute,
    )
    expect(res.status).toBe(403)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('a store-id from ANOTHER TENANT → 403, and NO row is created', async () => {
    storesGet.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    const res = await mintPOST(
      jreq({ ...auth, ...idem, 'store-id': 'store-x' }, { customerId: 'cust-1' }),
      noRoute,
    )
    expect(res.status).toBe(403)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('an UNREADABLE assignment fails closed → 403, and NO row is created', async () => {
    staffStoresGet.mockRejectedValue(new Error('core down'))
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(403)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
})

describe('POST recordings/session mint', () => {
  it('happy → {id}', async () => {
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('rec-1')
  })
  it('missing Idempotency-Key → 400', async () => {
    const res = await mintPOST(jreq(auth, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(400)
  })
  it('empty body → 200 walk-in mint (absent body stays valid)', async () => {
    const res = await mintPOST(jreq({ ...auth, ...idem }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('rec-1')
  })
  it('malformed non-empty body → 400, no mint (not a silent walk-in)', async () => {
    const res = await mintPOST(
      new Request('https://s/x', { method: 'POST', headers: { ...auth, ...idem }, body: '{"customerId": "cust-1"' }),
      noRoute
    )
    expect(res.status).toBe(400)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
  it('SDK create failure → fail-OPEN 200 {id:null}, mirrors the web action', async () => {
    recordingsCreate.mockRejectedValueOnce(new Error('transient synqed outage'))
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBeNull()
  })
  it('unresolvable staff + no appointment → fail-OPEN {id:null} (never blocks capture)', async () => {
    roster.current = []
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBeNull()
  })
  it('missing capability → 403', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await mintPOST(jreq({ ...auth, ...idem }, {}), noRoute)
    expect(res.status).toBe(403)
  })
  it('revoked → 401 (server round-trip)', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await mintPOST(jreq({ ...auth, ...idem }, {}), noRoute)
    expect(res.status).toBe(401)
  })

  // ── BORN RESERVED (fix round 10) ──────────────────────────────────────────
  const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
  it('a named take → the row is CREATED carrying its key, prefixed with the BEARER’s tenant', async () => {
    const res = await mintPOST(
      jreq({ ...auth, ...idem }, { customerId: 'cust-1', takeId: TAKE, mimeType: 'audio/mp4' }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(recordingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ audio_storage_path: `app_business-1_${TAKE}.mp4`, status: 'UPLOADING' }),
    )
  })
  it('an absent take still mints the walk-in row — no key, no status', async () => {
    await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1' }), noRoute)
    const [payload] = recordingsCreate.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(payload).sort()).toEqual([
      'appointment_id',
      'customer_id',
      'staff_id',
      'store_id',
    ])
  })
  // A refused take is the ONE thing this door does not fail open on: a 200
  // {id:null} would tell the caller "carry on" about a key it has to fix.
  it.each([
    ['a take id with no container', { takeId: TAKE }],
    ['a container with no take id', { mimeType: 'audio/webm' }],
    ['an uppercase take id', { takeId: TAKE.toUpperCase(), mimeType: 'audio/webm' }],
    ['a container we do not store', { takeId: TAKE, mimeType: 'audio/aiff' }],
    ['the prototype key "constructor"', { takeId: TAKE, mimeType: 'constructor' }],
    ['the prototype key "__proto__"', { takeId: TAKE, mimeType: '__proto__' }],
  ])('%s → 400, and no row is created', async (_label, body) => {
    const res = await mintPOST(jreq({ ...auth, ...idem }, { customerId: 'cust-1', ...body }), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
  it('an unknown field is still refused — .strict() has not been widened', async () => {
    const res = await mintPOST(
      jreq({ ...auth, ...idem }, { takeId: TAKE, mimeType: 'audio/webm', storeId: 'store-9' }),
      noRoute,
    )
    expect(res.status).toBe(400)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
})

describe('POST recordings/upload-url', () => {
  it('happy → {path,url,token}; path carries the tenant prefix', async () => {
    const res = await uploadPOST(jreq({ ...authOnly }), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toMatch(/^app_business-1_/)
    expect(body.path.endsWith('.webm')).toBe(true)
    expect(body.url).toBe('https://x/upload')
    expect(body.token).toBe('tok-1')
  })
  it('missing capability → 403, no mint', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await uploadPOST(jreq({ ...authOnly }), noRoute)
    expect(res.status).toBe(403)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })
  it('revoked → 401 (server round-trip; no fast-path on a POST)', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await uploadPOST(jreq({ ...authOnly }), noRoute)
    expect(res.status).toBe(401)
  })
})
