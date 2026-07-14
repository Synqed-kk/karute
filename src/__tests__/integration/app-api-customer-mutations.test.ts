// Customer-profile MUTATION facade — packet 06 §Build 4 + §Build 7 negatives.
// The highest customer-data class: memory / photos / consent writes. Verifies
// the server-verify path (every write is revocation-sensitive → a getUser
// round-trip runs), tenancy proof BEFORE any write (cross-tenant customer/item
// id → 404), capability gate, the #452 fail-closed consent posture, the photo
// trust boundary (content-type + size), the PATCH allowlist, the passport key
// allowlist, and the Idempotency-Key requirement on relearn. Writes are mocked
// at the store boundary so the REAL route→WithClient-core→guard path runs.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

// Revocation round-trip: every write here is revocation-sensitive, so getUser
// MUST confirm the user. `revoked` flips it to null (server-side revoked).
const revoked = { current: false }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => (revoked.current ? { data: { user: null }, error: null } : { data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view']) }
const staffRoster = { current: [{ id: 'auth-user-1', full_name: '田中' }] as { id: string; full_name: string }[] }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => staffRoster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// Business-scoped synqed client — customer writes go through here.
const revokeConsent = jest.fn(async () => undefined)
const uploadPhoto = jest.fn(async () => ({ id: 'photo-1' }))
const fakeClient = { customers: { revokeConsent, uploadPhoto } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

// Tenancy oracle: cust-1 belongs to this business; anything else 404s.
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async (_c: unknown, id: string) => {
    if (id !== 'cust-1') throw new Error('404 cross-tenant')
    return { id, name: '山田', notes: null }
  }),
}))

// Memory store — item-1 belongs to cust-1; item-other belongs to a cross-tenant
// customer; item-missing → null. Writes succeed.
const addStaffMemoryItem = jest.fn(async () => ({ ok: true }))
const updateMemoryItem = jest.fn(async () => ({ ok: true }))
const setMemoryItemPinned = jest.fn(async () => ({ ok: true }))
const softDeleteMemoryItem = jest.fn(async () => ({ ok: true }))
const upsertPassportField = jest.fn(async () => ({ ok: true }))
jest.mock('@/lib/karute/customer-memory', () => ({
  getMemoryItemCustomerId: jest.fn(async (id: string) =>
    id === 'item-1' ? 'cust-1' : id === 'item-other' ? 'cust-other' : null,
  ),
  addStaffMemoryItem: (...a: unknown[]) => addStaffMemoryItem(...(a as [])),
  updateMemoryItem: (...a: unknown[]) => updateMemoryItem(...(a as [])),
  setMemoryItemPinned: (...a: unknown[]) => setMemoryItemPinned(...(a as [])),
  softDeleteMemoryItem: (...a: unknown[]) => softDeleteMemoryItem(...(a as [])),
  upsertPassportField: (...a: unknown[]) => upsertPassportField(...(a as [])),
  restoreMemoryItems: jest.fn(async () => ({ ok: true })),
  softDeleteAiExtractionItems: jest.fn(async () => ({ ok: true, ids: [] })),
}))
jest.mock('@/lib/karute/business-ai-tokens', () => ({
  resolvePassportFields: () => [{ key: 'goal_focus' }, { key: 'lifestyle_note' }],
}))
jest.mock('@/actions/org-settings', () => ({ orgSettingsWithClient: async () => ({ business_type: 'salon' }) }))

import { POST as consentRevoke, OPTIONS as consentOptions } from '@/app/api/app/v1/customers/[id]/consent/revoke/route'
import { POST as photoUpload, OPTIONS as photoOptions } from '@/app/api/app/v1/customers/[id]/photos/route'
import { POST as memoryAdd, OPTIONS as memoryOptions } from '@/app/api/app/v1/customers/[id]/memory/route'
import { PATCH as memoryPatch, DELETE as memoryDelete, OPTIONS as itemOptions } from '@/app/api/app/v1/customers/[id]/memory/[itemId]/route'
import { POST as passportUpsert, OPTIONS as passportOptions } from '@/app/api/app/v1/customers/[id]/passport/route'
import { POST as memoryRelearn, OPTIONS as relearnOptions } from '@/app/api/app/v1/customers/[id]/memory/relearn/route'

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
const route = (p: Record<string, string>) => ({ params: Promise.resolve(p) })
const jsonReq = (body: unknown, headers: Record<string, string> = auth) =>
  new Request('https://s/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  staffRoster.current = [{ id: 'auth-user-1', full_name: '田中' }]
  revoked.current = false
})

// ── consent revoke ───────────────────────────────────────────────────────────
describe('POST consent/revoke', () => {
  it('happy path: revokes with the resolved self staff id', async () => {
    const res = await consentRevoke(new Request('https://s/x', { method: 'POST', headers: auth }), route({ id: 'cust-1' }))
    expect(res.status).toBe(200)
    expect(revokeConsent).toHaveBeenCalledWith('cust-1', 'auth-user-1')
  })
  it('cross-tenant customer id → 404, no write', async () => {
    const res = await consentRevoke(new Request('https://s/x', { method: 'POST', headers: auth }), route({ id: 'cust-x' }))
    expect(res.status).toBe(404)
    expect(revokeConsent).not.toHaveBeenCalled()
  })
  it('unresolvable staff id → fails closed (403), no write', async () => {
    staffRoster.current = [] // caller not on the roster
    const res = await consentRevoke(new Request('https://s/x', { method: 'POST', headers: auth }), route({ id: 'cust-1' }))
    expect(res.status).toBe(403)
    expect(revokeConsent).not.toHaveBeenCalled()
  })
  it('missing capability → 403, no write', async () => {
    capabilities.current = new Set()
    const res = await consentRevoke(new Request('https://s/x', { method: 'POST', headers: auth }), route({ id: 'cust-1' }))
    expect(res.status).toBe(403)
    expect(revokeConsent).not.toHaveBeenCalled()
  })
  it('missing Bearer → 401, no downstream call', async () => {
    const res = await consentRevoke(new Request('https://s/x', { method: 'POST' }), route({ id: 'cust-1' }))
    expect(res.status).toBe(401)
    expect(revokeConsent).not.toHaveBeenCalled()
  })
  it('revoked staffer (getUser null) → 401 via the server round-trip, no write', async () => {
    revoked.current = true
    const res = await consentRevoke(new Request('https://s/x', { method: 'POST', headers: auth }), route({ id: 'cust-1' }))
    expect(res.status).toBe(401)
    expect(revokeConsent).not.toHaveBeenCalled()
  })
})

// ── photos (trust boundary) ──────────────────────────────────────────────────
function photoReq(file: File | null, headers = auth) {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request('https://s/x', { method: 'POST', headers, body: fd })
}
describe('POST photos', () => {
  it('happy path: uploads a valid image', async () => {
    const res = await photoUpload(photoReq(new File(['x'], 'a.png', { type: 'image/png' })), route({ id: 'cust-1' }))
    expect(res.status).toBe(201)
    expect(uploadPhoto).toHaveBeenCalled()
  })
  it('wrong content-type → 400, no upload', async () => {
    const res = await photoUpload(photoReq(new File(['x'], 'a.pdf', { type: 'application/pdf' })), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
  it('oversize → 400, no upload', async () => {
    const big = new File([new Uint8Array(51 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    const res = await photoUpload(photoReq(big), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
  it('missing file → 400', async () => {
    const res = await photoUpload(photoReq(null), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
  it('cross-tenant customer id → 404, no upload', async () => {
    const res = await photoUpload(photoReq(new File(['x'], 'a.png', { type: 'image/png' })), route({ id: 'cust-x' }))
    expect(res.status).toBe(404)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
})

// ── memory add ───────────────────────────────────────────────────────────────
describe('POST memory (add)', () => {
  it('happy path → 201', async () => {
    const res = await memoryAdd(jsonReq({ category: 'goal', label: '目標' }), route({ id: 'cust-1' }))
    expect(res.status).toBe(201)
    expect(addStaffMemoryItem).toHaveBeenCalled()
  })
  it('invalid category (strict schema) → 400, no write', async () => {
    const res = await memoryAdd(jsonReq({ category: 'nope', label: 'x' }), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(addStaffMemoryItem).not.toHaveBeenCalled()
  })
  it('cross-tenant customer id → 404, no write', async () => {
    const res = await memoryAdd(jsonReq({ category: 'goal', label: 'x' }), route({ id: 'cust-x' }))
    expect(res.status).toBe(404)
    expect(addStaffMemoryItem).not.toHaveBeenCalled()
  })
})

// ── memory update / pin / delete (item-addressed) ────────────────────────────
describe('PATCH/DELETE memory/[itemId]', () => {
  it('pin → 200', async () => {
    const res = await memoryPatch(jsonReq({ pinned: true }), route({ id: '-', itemId: 'item-1' }))
    expect(res.status).toBe(200)
    expect(setMemoryItemPinned).toHaveBeenCalledWith('item-1', true)
  })
  it('update label+detail → 200', async () => {
    const res = await memoryPatch(jsonReq({ label: 'L', detail: 'D' }), route({ id: '-', itemId: 'item-1' }))
    expect(res.status).toBe(200)
    expect(updateMemoryItem).toHaveBeenCalled()
  })
  it('un-allowlisted key → 400, no write', async () => {
    const res = await memoryPatch(jsonReq({ category: 'goal' }), route({ id: '-', itemId: 'item-1' }))
    expect(res.status).toBe(400)
    expect(updateMemoryItem).not.toHaveBeenCalled()
    expect(setMemoryItemPinned).not.toHaveBeenCalled()
  })
  it('cross-tenant item id → 404, no write', async () => {
    const res = await memoryPatch(jsonReq({ pinned: true }), route({ id: '-', itemId: 'item-other' }))
    expect(res.status).toBe(404)
    expect(setMemoryItemPinned).not.toHaveBeenCalled()
  })
  it('missing item id → 404', async () => {
    const res = await memoryPatch(jsonReq({ pinned: true }), route({ id: '-', itemId: 'item-missing' }))
    expect(res.status).toBe(404)
  })
  it('delete → 200', async () => {
    const res = await memoryDelete(new Request('https://s/x', { method: 'DELETE', headers: auth }), route({ id: '-', itemId: 'item-1' }))
    expect(res.status).toBe(200)
    expect(softDeleteMemoryItem).toHaveBeenCalledWith('item-1')
  })
  it('delete cross-tenant item id → 404, no write', async () => {
    const res = await memoryDelete(new Request('https://s/x', { method: 'DELETE', headers: auth }), route({ id: '-', itemId: 'item-other' }))
    expect(res.status).toBe(404)
    expect(softDeleteMemoryItem).not.toHaveBeenCalled()
  })
})

// ── passport ─────────────────────────────────────────────────────────────────
describe('POST passport', () => {
  it('allowlisted key → 200', async () => {
    const res = await passportUpsert(jsonReq({ fieldKey: 'goal_focus', value: 'v' }), route({ id: 'cust-1' }))
    expect(res.status).toBe(200)
    expect(upsertPassportField).toHaveBeenCalled()
  })
  it('un-allowlisted key → 400, no write', async () => {
    const res = await passportUpsert(jsonReq({ fieldKey: 'evil_key', value: 'v' }), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(upsertPassportField).not.toHaveBeenCalled()
  })
})

// ── relearn (idempotency) ────────────────────────────────────────────────────
describe('POST memory/relearn', () => {
  it('missing Idempotency-Key → 400', async () => {
    const res = await memoryRelearn(new Request('https://s/x', { method: 'POST', headers: auth }), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
  })
  it('with Idempotency-Key → 200 (no transcripts → ok:false body, not an error status)', async () => {
    const res = await memoryRelearn(
      new Request('https://s/x', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'k1' } }),
      route({ id: 'cust-1' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false) // listSynqedKaruteRows mocked empty → nothing to relearn
  })
})

// ── OPTIONS preflight (shell origin) on every new route ──────────────────────
describe('OPTIONS preflight — shell-origin CORS, no auth', () => {
  const handlers: Array<[string, (req: Request, r?: unknown) => Promise<Response>]> = [
    ['consent/revoke', consentOptions],
    ['photos', photoOptions],
    ['memory', memoryOptions],
    ['memory/[itemId]', itemOptions],
    ['passport', passportOptions],
    ['memory/relearn', relearnOptions],
  ]
  it.each(handlers)('%s → 204 with shell Allow-Origin, no downstream call', async (_name, handler) => {
    const req = new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } })
    const res = await handler(req, route({ id: 'cust-1', itemId: 'item-1' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
    expect(revokeConsent).not.toHaveBeenCalled()
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
})
