// The karute SAVE (packet 08 Decision 3 — the headline: consent gate fail-closed
// + recorder-first attribution + the recording_session_id dedupe) and the pack-
// redemption UNDO. The REAL createOrUpdateKaruteRecord runs (so the dedupe is
// exercised end-to-end) + the REAL consent gate (isConsentCurrent); all network
// mocked; memory ingest stubbed (best-effort, tested elsewhere).
import { createHmac } from 'node:crypto'
import { RECORDING_CONSENT_POLICY_VERSION, CONSENT_REQUIRED_ERROR } from '@/lib/consent'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))
jest.mock('@/lib/karute/memory-ingest', () => ({ ingestSessionMemory: jest.fn(async () => {}) }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }) }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['records.write', 'stores.viewAll']) }
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

const consentRow = { current: { policy_version: RECORDING_CONSENT_POLICY_VERSION } as { policy_version: string } | null }
const consentThrows = { current: false }
const customersGet = jest.fn(async (id: string) => { if (id !== 'cust-1') throw Object.assign(new Error('x'), { status: id === 'cust-boom' ? 500 : 404 }); return { id, name: 'Y' } })
const getConsent = jest.fn(async () => { if (consentThrows.current) throw new Error('consent down'); return { consent: consentRow.current } })
const existingBySession = { current: null as null | { id: string; transcript: string; entries?: unknown[] } }
const getByRecordingSession = jest.fn(async () => { if (existingBySession.current) return existingBySession.current; throw Object.assign(new Error('none'), { status: 404 }) })
const create = jest.fn(async () => ({ id: 'kar-new' }))
const update = jest.fn(async () => ({ id: 'kar-existing' }))
const outcomeUpsert = jest.fn(async () => ({}))
const removeRedemption = jest.fn(async () => ({ ok: true }))
const fakeClient = {
  customers: { get: customersGet, getConsent },
  karuteRecords: { getByRecordingSession, create, update },
  appointments: { get: jest.fn(async () => ({ staff_id: 'appt-staff', store_id: null })) },
  karuteOutcomes: { upsert: outcomeUpsert },
  packs: { removeRedemption },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST as savePOST, OPTIONS as saveOPTIONS } from '@/app/api/app/v1/karute/route'
import { POST as undoPOST } from '@/app/api/app/v1/packs/redemptions/[id]/undo/route'

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
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }
const noRoute = { params: Promise.resolve({}) }
const undoRoute = (id = 'red-1') => ({ params: Promise.resolve({ id }) })
const validSave = { customerId: 'cust-1', transcript: 't', summary: 's', entries: [{ category: 'symptom', content: 'c', confidenceScore: 0.9 }] }
const post = (headers: Record<string, string>, body: unknown) => new Request('https://s/x', { method: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.write', 'stores.viewAll'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  consentRow.current = { policy_version: RECORDING_CONSENT_POLICY_VERSION }
  consentThrows.current = false
  existingBySession.current = null
})

describe('POST /api/app/v1/karute (save)', () => {
  it('happy → 200 { id }, record created', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('kar-new')
    expect(create).toHaveBeenCalled()
  })
  it('entries carry isManual through to core (human preserved, AI defaults false)', async () => {
    const body = { ...validSave, entries: [
      { category: 'other', content: 'hand', confidenceScore: null, isManual: true },
      { category: 'symptom', content: 'ai', confidenceScore: 0.9 },
    ] }
    const res = await savePOST(post({ ...auth, ...idem }, body), noRoute)
    expect(res.status).toBe(200)
    const arg = (create as jest.Mock).mock.calls[0][0]
    expect(arg.entries[0]).toMatchObject({ content: 'hand', is_manual: true, confidence: null })
    expect(arg.entries[1]).toMatchObject({ content: 'ai', is_manual: false })
  })
  it('absent isManual defaults to AI (is_manual: false) — old clients unaffected', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(200)
    expect((create as jest.Mock).mock.calls[0][0].entries[0].is_manual).toBe(false)
  })
  it('JSON null isManual / null confidence tolerated → is_manual false, confidence null', async () => {
    const body = { ...validSave, entries: [{ category: 'symptom', content: 'c', confidenceScore: null, isManual: null }] }
    const res = await savePOST(post({ ...auth, ...idem }, body), noRoute)
    expect(res.status).toBe(200)
    const e0 = (create as jest.Mock).mock.calls[0][0].entries[0]
    expect(e0.is_manual).toBe(false)
    expect(e0.confidence).toBeNull()
  })
  it('consent MISSING → CONSENT_REQUIRED (403), no write', async () => {
    consentRow.current = null
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error.message).toBe(CONSENT_REQUIRED_ERROR)
    expect(create).not.toHaveBeenCalled()
  })
  it('consent STALE (old policy) → CONSENT_REQUIRED (403), no write', async () => {
    consentRow.current = { policy_version: 'v0-old' }
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })
  it('consent UNREADABLE (getConsent throws) → REJECTED (403), no write', async () => {
    consentThrows.current = true
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })
  it('cross-tenant customerId → 404 before consent/write', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, customerId: 'cust-x' }), noRoute)
    expect(res.status).toBe(404)
    expect(getConsent).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
  it('genuine upstream customer read → 502', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, customerId: 'cust-boom' }), noRoute)
    expect(res.status).toBe(502)
  })
  it('missing Idempotency-Key → 400 before any write', async () => {
    const res = await savePOST(post(auth, validSave), noRoute)
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
  it('over-cap transcript → 400 validation, no write', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, transcript: 'x'.repeat(500_001) }), noRoute)
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
  it('duplicate recording_session_id → dedupe (UPDATE, no second create)', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old' }
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1' }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('kar-existing')
    expect(update).toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  // Retry-merge (change #2): core's update() full-replaces entries, so a stale
  // retry must not erase or demote human rows. Existing entries are read
  // (include_entries) and merged before the replace.
  const humanEntry = (over: Record<string, unknown> = {}) => ({
    id: `e-${Math.random().toString(36).slice(2)}`, karute_record_id: 'kar-existing',
    category: 'OTHER', content: 'human note', original_quote: null, confidence: 0,
    tags: [] as string[], sort_order: 0, is_manual: true, created_at: '', updated_at: '', ...over,
  })
  const mergedEntries = () =>
    (update as jest.Mock).mock.calls[0][1].entries as Array<Record<string, unknown>>
  const retry = (entries: unknown[]) =>
    savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1', entries }), noRoute)

  it('retry merge (a): a human row absent from the payload survives with its metadata', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', entries: [humanEntry({ content: 'kept by staff', tags: ['t1'], sort_order: 5 })] }
    const res = await retry([{ category: 'symptom', content: 'ai only', confidenceScore: 0.9 }])
    expect(res.status).toBe(200)
    const survivor = mergedEntries().find((e) => e.content === 'kept by staff')
    expect(survivor).toMatchObject({ is_manual: true, tags: ['t1'], sort_order: 5 })
    expect(mergedEntries().some((e) => e.content === 'ai only')).toBe(true)
  })
  it('retry merge (b): a same-text AI payload row never demotes the human row', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', entries: [humanEntry({ content: 'shared text' })] }
    const res = await retry([{ category: 'other', content: 'shared text', confidenceScore: 0.9 }])
    expect(res.status).toBe(200)
    expect(mergedEntries().filter((e) => e.content === 'shared text' && e.is_manual === true)).toHaveLength(1)
    expect(mergedEntries().filter((e) => e.content === 'shared text' && !e.is_manual)).toHaveLength(1)
  })
  it('retry merge (c): duplicate human rows both survive (occurrence-aware)', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', entries: [humanEntry({ content: 'dup', sort_order: 1 }), humanEntry({ content: 'dup', sort_order: 2 })] }
    const res = await retry([{ category: 'other', content: 'dup', confidenceScore: null, isManual: true }])
    expect(res.status).toBe(200)
    expect(mergedEntries().filter((e) => e.content === 'dup' && e.is_manual === true)).toHaveLength(2)
  })
  it('retry merge (d): a human row present in the payload is not duplicated and keeps metadata', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', entries: [humanEntry({ content: 'kept', tags: ['keepme'], sort_order: 7 })] }
    // the form re-sends it as human but omits tags/sort_order
    const res = await retry([{ category: 'other', content: 'kept', confidenceScore: null, isManual: true }])
    expect(res.status).toBe(200)
    const kept = mergedEntries().filter((e) => e.content === 'kept')
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ is_manual: true, tags: ['keepme'], sort_order: 7 })
  })
  it('unresolvable attribution (not on roster, no appointment) → 403, no write', async () => {
    roster.current = []
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })
  it('missing capability → 403', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(403)
  })
  it('revoked staffer → 401 via server round-trip, no write', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })
  it('OPTIONS → 204 shell-origin CORS', async () => {
    const res = await saveOPTIONS(new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), noRoute)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })
})

describe('POST /api/app/v1/packs/redemptions/[id]/undo', () => {
  // Undo mirrors the batch-3 redeem route: customers.view (pack-mutation class),
  // NOT records.write — redeem/undo stay symmetric, and the dashboard reconcile
  // surfaces that call undoRedemptionAction aren't records.write territory.
  beforeEach(() => {
    capabilities.current = new Set(['customers.view'])
  })
  it('happy → { ok:true }', async () => {
    const res = await undoPOST(new Request('https://s/x', { method: 'POST', headers: { ...auth, ...idem } }), undoRoute())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
  it('already-undone / no-op → { ok:false } (web-tolerant semantics)', async () => {
    removeRedemption.mockResolvedValueOnce({ ok: false })
    const res = await undoPOST(new Request('https://s/x', { method: 'POST', headers: { ...auth, ...idem } }), undoRoute())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
  })
  it('cross-tenant redemption (404) → not_found', async () => {
    removeRedemption.mockImplementationOnce(async () => { throw Object.assign(new Error('nope'), { status: 404 }) })
    const res = await undoPOST(new Request('https://s/x', { method: 'POST', headers: { ...auth, ...idem } }), undoRoute('red-x'))
    expect(res.status).toBe(404)
  })
  it('missing Idempotency-Key → 400', async () => {
    const res = await undoPOST(new Request('https://s/x', { method: 'POST', headers: auth }), undoRoute())
    expect(res.status).toBe(400)
  })
  it('missing capability → 403 (records.write alone is NOT enough — the mirror is customers.view)', async () => {
    capabilities.current = new Set(['records.write', 'stores.viewAll'])
    const res = await undoPOST(new Request('https://s/x', { method: 'POST', headers: { ...auth, ...idem } }), undoRoute())
    expect(res.status).toBe(403)
  })
  it('revoked → 401', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await undoPOST(new Request('https://s/x', { method: 'POST', headers: { ...auth, ...idem } }), undoRoute())
    expect(res.status).toBe(401)
  })
})
