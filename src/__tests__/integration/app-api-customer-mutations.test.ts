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
const listPhotos = jest.fn(async () => ({ photos: [] as unknown[] }))
const deletePhoto = jest.fn(async () => undefined)
const fakeClient = { customers: { revokeConsent, uploadPhoto, listPhotos, deletePhoto } }
// Relearn transcript read — spied so the owner-gate tests can distinguish
// "gate refused before any read" from "read ran, nothing to relearn".
jest.mock('@/lib/karute/synqed-records', () => ({
  ...jest.requireActual('@/lib/karute/synqed-records'),
  listSynqedKaruteRows: jest.fn(async () => []),
}))
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
const orgSettingsRead = jest.fn(async (): Promise<{ business_type: string } | null> => ({ business_type: 'salon' }))
jest.mock('@/actions/org-settings', () => ({ orgSettingsWithClient: () => orgSettingsRead() }))

import { POST as consentRevoke, OPTIONS as consentOptions } from '@/app/api/app/v1/customers/[id]/consent/revoke/route'
import { GET as photoList, POST as photoUpload, OPTIONS as photoOptions } from '@/app/api/app/v1/customers/[id]/photos/route'
import { DELETE as photoDelete, OPTIONS as photoDeleteOptions } from '@/app/api/app/v1/customers/[id]/photos/[photoId]/route'
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
const route = (p: Record<string, string>): { params: Promise<{ id: string; itemId: string }> } => ({
  params: Promise.resolve(p as { id: string; itemId: string }),
})
const jsonReq = (body: unknown, headers: Record<string, string> = auth) =>
  new Request('https://s/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  // mockReset (not just clearAllMocks' clear) — a mockResolvedValueOnce queued
  // by a test whose CORRECT code path never reaches listPhotos (e.g. the
  // cross-tenant DELETE test, where tenancy proof throws first) would
  // otherwise sit queued and leak into whichever LATER test calls listPhotos
  // first, silently swapping its intended mock value.
  listPhotos.mockReset().mockResolvedValue({ photos: [] })
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
function photoReq(file: File | null, headers = auth, fields: Record<string, string> = {}) {
  const fd = new FormData()
  if (file) fd.append('file', file)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return new Request('https://s/x', { method: 'POST', headers, body: fd })
}
// Real container bytes — the route now sniffs magic numbers (declared MIME is
// caller-controlled). 16 bytes of PNG signature + IHDR intro is enough.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
const getReq = () => new Request('https://s/x', { method: 'GET', headers: auth })
const deleteReq = () => new Request('https://s/x', { method: 'DELETE', headers: auth })
const photoRoute = (p: { id: string; photoId: string }): { params: Promise<{ id: string; photoId: string }> } => ({
  params: Promise.resolve(p),
})

describe('POST photos', () => {
  it('happy path: uploads a valid image', async () => {
    const res = await photoUpload(photoReq(new File([PNG_BYTES], 'a.png', { type: 'image/png' })), route({ id: 'cust-1' }))
    expect(res.status).toBe(201)
    expect(uploadPhoto).toHaveBeenCalled()
  })
  it('wrong content-type → 400, no upload', async () => {
    const res = await photoUpload(photoReq(new File(['x'], 'a.pdf', { type: 'application/pdf' })), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
  it('oversize → 400, no upload', async () => {
    const big = new File([(() => { const b = new Uint8Array(51 * 1024 * 1024); b.set(PNG_BYTES); return b })()], 'big.png', { type: 'image/png' })
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
    const res = await photoUpload(photoReq(new File([PNG_BYTES], 'a.png', { type: 'image/png' })), route({ id: 'cust-x' }))
    expect(res.status).toBe(404)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
  it('spoofed MIME (image/* declared, non-image bytes) → 400, no upload', async () => {
    const res = await photoUpload(photoReq(new File(['%PDF-1.4 not an image'], 'a.png', { type: 'image/png' })), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
  // packet 2026-08-09 PR 9a §③/§B — recording_session_id + taken_with_consent
  // forward from the form; captured_by_staff_id is SERVER-RESOLVED via
  // resolveSelfStaffId (this suite's Bearer sub is 'auth-user-1', on
  // staffRoster.current by default) — NEVER read from client input.
  it('forwards recording_session_id / taken_with_consent=true; captured_by_staff_id is server-resolved', async () => {
    const png = new File([PNG_BYTES], 'a.png', { type: 'image/png' })
    const res = await photoUpload(
      photoReq(png, auth, {
        recording_session_id: 'sess-1',
        taken_with_consent: 'true',
      }),
      route({ id: 'cust-1' }),
    )
    expect(res.status).toBe(201)
    // expect.any(File): the File crosses a Request→FormData round-trip in the
    // route handler, which reconstructs it with a freshly-stamped
    // lastModified — exact object/deep equality on it is not guaranteed.
    expect(uploadPhoto).toHaveBeenCalledWith(
      'cust-1',
      expect.any(File),
      expect.objectContaining({
        recording_session_id: 'sess-1',
        captured_by_staff_id: 'auth-user-1',
        taken_with_consent: true,
      }),
    )
  })
  // Anti-spoof pin: a client can't smuggle someone else's staff id through
  // the form — the route ignores it and uses only the server-resolved identity.
  it('captured_by_staff_id from the form is IGNORED — server resolution wins (anti-spoof)', async () => {
    const png = new File([PNG_BYTES], 'a.png', { type: 'image/png' })
    await photoUpload(photoReq(png, auth, { captured_by_staff_id: 'intruder' }), route({ id: 'cust-1' }))
    expect(uploadPhoto).toHaveBeenCalledWith(
      'cust-1',
      expect.any(File),
      expect.objectContaining({ captured_by_staff_id: 'auth-user-1' }),
    )
  })
  it('unresolvable staff id (caller not on the roster) → captured_by_staff_id undefined, upload still succeeds', async () => {
    staffRoster.current = []
    const png = new File([PNG_BYTES], 'a.png', { type: 'image/png' })
    const res = await photoUpload(photoReq(png), route({ id: 'cust-1' }))
    expect(res.status).toBe(201)
    const options = (uploadPhoto as jest.Mock).mock.calls[0][2] as { captured_by_staff_id?: string }
    expect(options.captured_by_staff_id).toBeUndefined()
  })
  it('taken_with_consent="false" → forwarded as boolean false, not dropped', async () => {
    const png = new File([PNG_BYTES], 'a.png', { type: 'image/png' })
    await photoUpload(photoReq(png, auth, { taken_with_consent: 'false' }), route({ id: 'cust-1' }))
    expect(uploadPhoto).toHaveBeenCalledWith(
      'cust-1',
      expect.any(File),
      expect.objectContaining({ taken_with_consent: false }),
    )
  })
  // packet §C — '' is not a session; the shared parsePhotoUploadFields helper
  // normalizes it to undefined so it never fakes a real recording_session_id.
  it('recording_session_id="" is treated as absent → undefined, not forwarded as ""', async () => {
    const png = new File([PNG_BYTES], 'a.png', { type: 'image/png' })
    await photoUpload(photoReq(png, auth, { recording_session_id: '' }), route({ id: 'cust-1' }))
    const options = (uploadPhoto as jest.Mock).mock.calls[0][2] as { recording_session_id?: string }
    expect(options.recording_session_id).toBeUndefined()
  })
  // Tier pin: upload is gated customers.view (NOT the destructive tier the
  // sibling DELETE moved to). Same shape as the DELETE denial test — the gate
  // is the FIRST thing in the handler, so the tenancy read never runs either.
  it('missing capability → 403, no tenancy read, no upload', async () => {
    capabilities.current = new Set()
    const { getCustomerWithClient } = jest.requireMock('@/lib/customers/queries') as {
      getCustomerWithClient: jest.Mock
    }
    const res = await photoUpload(photoReq(new File([PNG_BYTES], 'a.png', { type: 'image/png' })), route({ id: 'cust-1' }))
    expect(res.status).toBe(403)
    expect(getCustomerWithClient).not.toHaveBeenCalled()
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
  it('linkage fields absent → recording_session_id/taken_with_consent stay undefined (never default consent to true)', async () => {
    const png = new File([PNG_BYTES], 'a.png', { type: 'image/png' })
    await photoUpload(photoReq(png), route({ id: 'cust-1' }))
    const options = (uploadPhoto as jest.Mock).mock.calls[0][2] as {
      recording_session_id?: string
      taken_with_consent?: boolean
    }
    expect(options.recording_session_id).toBeUndefined()
    expect(options.taken_with_consent).toBeUndefined()
  })
})

// ── photos GET (aggregate, packet PR 9b device-wiring delta) ────────────────
describe('GET photos', () => {
  it('the customer AGGREGATE reaches the response unfiltered — a mixed-session list, all rows pass through', async () => {
    // Structure rule (Liam 8/9): this route is the presentation/compare feed —
    // it must NEVER apply scopeKarutePhotos. Mixed session ids + a null-session
    // photo, all three must survive untouched (same pin shape as 9a §F).
    listPhotos.mockResolvedValueOnce({
      photos: [
        { id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null, recording_session_id: 'sess-1' },
        { id: 'p2', signed_url: 'https://x/p2', category: 'after', caption: null, recording_session_id: 'sess-2' },
        { id: 'p3', signed_url: 'https://x/p3', category: 'reference', caption: null, recording_session_id: null },
      ],
    })
    const res = await photoList(getReq(), route({ id: 'cust-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.photos.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('cross-tenant customer id → 404, no read', async () => {
    const res = await photoList(getReq(), route({ id: 'cust-x' }))
    expect(res.status).toBe(404)
    expect(listPhotos).not.toHaveBeenCalled()
  })

  // Tier pin: the aggregate feed is gated customers.view — nothing pinned it
  // before, so a silent regate would have gone unnoticed.
  it('missing capability → 403, no tenancy read, no read', async () => {
    capabilities.current = new Set()
    const { getCustomerWithClient } = jest.requireMock('@/lib/customers/queries') as {
      getCustomerWithClient: jest.Mock
    }
    const res = await photoList(getReq(), route({ id: 'cust-1' }))
    expect(res.status).toBe(403)
    expect(getCustomerWithClient).not.toHaveBeenCalled()
    expect(listPhotos).not.toHaveBeenCalled()
  })
})

// ── photos DELETE /[photoId] (packet PR 9b device-wiring delta) ─────────────
describe('DELETE photos/[photoId]', () => {
  // Liam ruling 8/9: photo delete sits in the DESTRUCTIVE tier (records.delete,
  // owner/manager/senior), not customers.view. The harness default is
  // customers.view alone, so every non-denial case here grants it explicitly.
  beforeEach(() => {
    capabilities.current = new Set(['customers.view', 'records.delete'])
  })

  it('customers.view alone → 403, no tenancy read, no delete (records.delete is the tier)', async () => {
    capabilities.current = new Set(['customers.view'])
    // Ownership stub primed: if the gate ever ran AFTER the proofs this would
    // still 403, so also assert the tenancy read never happened — the gate is
    // the FIRST thing in the handler.
    const { getCustomerWithClient } = jest.requireMock('@/lib/customers/queries') as {
      getCustomerWithClient: jest.Mock
    }
    listPhotos.mockResolvedValueOnce({ photos: [{ id: 'photo-1' }] })
    const res = await photoDelete(deleteReq(), photoRoute({ id: 'cust-1', photoId: 'photo-1' }))
    expect(res.status).toBe(403)
    expect(getCustomerWithClient).not.toHaveBeenCalled()
    expect(listPhotos).not.toHaveBeenCalled()
    expect(deletePhoto).not.toHaveBeenCalled()
  })

  it('happy path: deletes the photo (ownership proven — photoId is in this customer\'s list)', async () => {
    listPhotos.mockResolvedValueOnce({ photos: [{ id: 'photo-1' }] })
    const res = await photoDelete(deleteReq(), photoRoute({ id: 'cust-1', photoId: 'photo-1' }))
    expect(res.status).toBe(200)
    expect(deletePhoto).toHaveBeenCalledWith('cust-1', 'photo-1')
  })

  it('cross-tenant customer id → 404, no delete', async () => {
    // Isolates the TENANCY check specifically: listPhotos is stubbed to
    // contain the requested photoId, so if tenancy proof were ever skipped
    // the ownership proof right after it would PASS — the 404 here can only
    // come from proveCustomerInBusiness (mutation red-run anchor).
    listPhotos.mockResolvedValueOnce({ photos: [{ id: 'photo-1' }] })
    const res = await photoDelete(deleteReq(), photoRoute({ id: 'cust-x', photoId: 'photo-1' }))
    expect(res.status).toBe(404)
    expect(deletePhoto).not.toHaveBeenCalled()
  })

  // §12 (blind round): ownership proof — provePhotoForCustomer. A photoId
  // that belongs to a DIFFERENT customer (or doesn't exist) must 404 BEFORE
  // any delete call, exactly like provePackForCustomer's pattern.
  it("another customer's photoId → 404, deletePhoto NEVER called", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [{ id: 'someone-elses-photo' }] })
    const res = await photoDelete(deleteReq(), photoRoute({ id: 'cust-1', photoId: 'photo-1' }))
    expect(res.status).toBe(404)
    expect(deletePhoto).not.toHaveBeenCalled()
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
  // Param-binding pin (Greptile #633 r1 refutation; UPDATED 2026-08-29 —
  // sentinel-poison root-cause fix): the [id] segment is decorative (the web
  // action signatures carry only itemId, so thin/ports/actions.vite.ts fills
  // it with a sentinel) and is deliberately WRONG here ('cus-77') to prove
  // the hook no longer trusts it. proveMemoryItemInBusiness already resolved
  // item-1's REAL owning customer (cust-1, per the tenancy oracle above) and
  // the route hands that to ctx.auditTargetId — the row targets THAT id,
  // never the route segment and never the item id.
  it('audit row targets the REAL owning customer id, never the decorative [id] segment or the memory item id', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const res = await memoryPatch(jsonReq({ pinned: true }), route({ id: 'cus-77', itemId: 'item-1' }))
      expect(res.status).toBe(200)
      const rows = logSpy.mock.calls
        .map(([l]) => {
          try {
            return JSON.parse(String(l))
          } catch {
            return null
          }
        })
        .filter((o): o is Record<string, unknown> => !!o && o.evt === 'audit')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        action: 'customer.memory_update',
        target_type: 'customer',
        target_id: 'cust-1',
      })
      expect(rows[0].target_id).not.toBe('item-1')
      expect(rows[0].target_id).not.toBe('cus-77')
    } finally {
      logSpy.mockRestore()
    }
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
  it('missing and cross-tenant 404s are INDISTINGUISHABLE (no existence oracle)', async () => {
    const missing = (await (await memoryPatch(jsonReq({ pinned: true }), route({ id: '-', itemId: 'item-missing' }))).json()).error
    const foreign = (await (await memoryPatch(jsonReq({ pinned: true }), route({ id: '-', itemId: 'item-other' }))).json()).error
    expect({ code: missing.code, message: missing.message }).toEqual({ code: foreign.code, message: foreign.message })
  })
  it('delete → 200', async () => {
    const res = await memoryDelete(new Request('https://s/x', { method: 'DELETE', headers: auth }), route({ id: '-', itemId: 'item-1' }))
    expect(res.status).toBe(200)
    expect(softDeleteMemoryItem).toHaveBeenCalledWith('item-1')
  })
  it('delete audit row also targets the REAL owning customer id, never the decorative [id] segment', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const res = await memoryDelete(new Request('https://s/x', { method: 'DELETE', headers: auth }), route({ id: 'cus-77', itemId: 'item-1' }))
      expect(res.status).toBe(200)
      const rows = logSpy.mock.calls
        .map(([l]) => {
          try {
            return JSON.parse(String(l))
          } catch {
            return null
          }
        })
        .filter((o): o is Record<string, unknown> => !!o && o.evt === 'audit')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        action: 'customer.memory_delete',
        target_type: 'customer',
        target_id: 'cust-1',
      })
    } finally {
      logSpy.mockRestore()
    }
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
  it('org-settings OUTAGE → 502 per the failure contract, never a false 400 (review F3)', async () => {
    orgSettingsRead.mockRejectedValueOnce(new Error('core down'))
    const res = await passportUpsert(jsonReq({ fieldKey: 'goal_focus', value: 'v' }), route({ id: 'cust-1' }))
    expect(res.status).toBe(502)
    expect(upsertPassportField).not.toHaveBeenCalled()
  })
  it('unconfigured salon (null settings row) still resolves the default field set', async () => {
    orgSettingsRead.mockResolvedValueOnce(null)
    const res = await passportUpsert(jsonReq({ fieldKey: 'goal_focus', value: 'v' }), route({ id: 'cust-1' }))
    expect(res.status).toBe(200)
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
  it('dev-tool gate (7/16 ruling): customers.view alone → refused BEFORE any transcript read', async () => {
    const { listSynqedKaruteRows } = jest.requireMock('@/lib/karute/synqed-records') as {
      listSynqedKaruteRows: jest.Mock
    }
    // default capabilities = {customers.view} only
    const res = await memoryRelearn(
      new Request('https://s/x', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'k-gate' } }),
      route({ id: 'cust-1' }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
    expect(listSynqedKaruteRows).not.toHaveBeenCalled()
  })
  // ⚖ THE PAIR, AS A PAIR (fix round 4). The two cases around this one are
  // "neither key" and "both keys" — neither separates the pair from the named
  // grant alone, so mutating the route to `.has('recordings.viewAll')` left the
  // whole file green (blind round 2, L2 F5).
  it('dev-tool gate: recordings.viewAll ALONE → refused BEFORE any transcript read', async () => {
    const { listSynqedKaruteRows } = jest.requireMock('@/lib/karute/synqed-records') as {
      listSynqedKaruteRows: jest.Mock
    }
    capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
    const res = await memoryRelearn(
      new Request('https://s/x', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'k-grantee' } }),
      route({ id: 'cust-1' }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
    expect(listSynqedKaruteRows).not.toHaveBeenCalled()
  })

  it('dev-tool gate: business.manage + recordings.viewAll passes the gate (read runs)', async () => {
    const { listSynqedKaruteRows } = jest.requireMock('@/lib/karute/synqed-records') as {
      listSynqedKaruteRows: jest.Mock
    }
    capabilities.current = new Set(['customers.view', 'business.manage', 'recordings.viewAll'])
    const res = await memoryRelearn(
      new Request('https://s/x', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'k-owner' } }),
      route({ id: 'cust-1' }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false) // empty rows — but the read RAN
    expect(listSynqedKaruteRows).toHaveBeenCalled()
  })
})

// ── OPTIONS preflight (shell origin) on every new route ──────────────────────
describe('OPTIONS preflight — shell-origin CORS, no auth', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers differ in Params generic; any sidesteps the variance
  const handlers: Array<[string, (req: Request, r: any) => Promise<Response>]> = [
    ['consent/revoke', consentOptions],
    ['photos', photoOptions],
    ['photos/[photoId]', photoDeleteOptions],
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

// ── F8 over-cap direct rejection (batch-4 schemas — packet 08 §Build 3 hygiene) ─
// Send an over-cap payload to each batch-4 F8 schema and assert the validation
// error (400) + no write. The batch-4 review noted these caps were structurally
// present but never directly rejection-tested; this closes that gap.
describe('F8 over-cap rejection (batch-4 schemas)', () => {
  const over = (n: number) => 'x'.repeat(n)
  it('AddMemory label > 100 → 400, no write', async () => {
    const res = await memoryAdd(jsonReq({ category: 'goal', label: over(101) }), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(addStaffMemoryItem).not.toHaveBeenCalled()
  })
  it('AddMemory detail > 4000 → 400, no write', async () => {
    const res = await memoryAdd(jsonReq({ category: 'goal', label: 'ok', detail: over(4001) }), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(addStaffMemoryItem).not.toHaveBeenCalled()
  })
  it('PatchMemory label > 100 → 400, no write', async () => {
    const res = await memoryPatch(jsonReq({ label: over(101) }), route({ id: '-', itemId: 'item-1' }))
    expect(res.status).toBe(400)
    expect(updateMemoryItem).not.toHaveBeenCalled()
  })
  it('Passport value > 4000 → 400, no write', async () => {
    const res = await passportUpsert(jsonReq({ fieldKey: 'goal_focus', value: over(4001) }), route({ id: 'cust-1' }))
    expect(res.status).toBe(400)
    expect(upsertPassportField).not.toHaveBeenCalled()
  })
})
