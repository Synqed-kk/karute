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

const audit = jest.fn()
// Spread the REAL module so FACADE_AUDIT_MAP stays live inside logFacadeAudit —
// a bare { audit } factory makes the map lookup throw-and-swallow, and the
// exactly-once pin below could never catch a re-added 'karute.save' map row
// double-logging (the exact regression the map's own comment warns against).
// Only the emitter is stubbed.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

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
const existingBySession = { current: null as null | { id: string; transcript: string; entries?: Array<{ id: string }> } }
const getByRecordingSession = jest.fn(async () => { if (existingBySession.current) return existingBySession.current; throw Object.assign(new Error('none'), { status: 404 }) })
const create = jest.fn(async () => ({ id: 'kar-new' }))
const update = jest.fn(async () => ({ id: 'kar-existing' }))
const outcomeUpsert = jest.fn(async (_row: { outcome: string }) => ({}))
const outcomeGet = jest.fn(async (): Promise<{ outcome: string } | null> => null)
const removeRedemption = jest.fn(async () => ({ ok: true }))
// Reads the 'revisit' eligibility guard makes. Defaults = a brand-new prospect
// with no history anywhere, so a test must opt IN to being a returning customer.
const listPacks = jest.fn(async (): Promise<Array<{ status: string; kind: string }>> => [])
const listKaruteRecords = jest.fn(
  async (): Promise<{ karute_records: Array<{ id: string; recording_session_id: string | null }> }> => ({
    karute_records: [],
  }),
)
const fakeClient = {
  customers: { get: customersGet, getConsent },
  karuteRecords: { getByRecordingSession, create, update, list: listKaruteRecords },
  appointments: {
    get: jest.fn(async () => ({ staff_id: 'appt-staff', store_id: null, title: null as string | null })),
  },
  karuteOutcomes: { upsert: outcomeUpsert, get: outcomeGet },
  packs: { removeRedemption, listPacks },
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
  outcomeGet.mockResolvedValue(null)
  listPacks.mockResolvedValue([])
  listKaruteRecords.mockResolvedValue({ karute_records: [] })
})

describe('POST /api/app/v1/karute (save)', () => {
  it('happy → 200 { id }, record created', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('kar-new')
    expect(create).toHaveBeenCalled()
  })
  it('appointment-linked save copies the booked menu + recording minutes (7/29 field report)', async () => {
    fakeClient.appointments.get.mockResolvedValueOnce({
      staff_id: 'appt-staff',
      store_id: null,
      title: 'VIP施術',
    })
    const res = await savePOST(
      post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-1', duration: 3070 }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'VIP施術', duration_minutes: 51 }),
    )
  })
  it('no booking on the save → service null, minutes still from the take', async () => {
    const res = await savePOST(
      post({ ...auth, ...idem }, { ...validSave, duration: 125 }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ service: null, duration_minutes: 2 }),
    )
  })
  it('negative/NaN duration from the client never persists (Greptile P1 on #646)', async () => {
    const res = await savePOST(
      post({ ...auth, ...idem }, { ...validSave, duration: -300 }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ duration_minutes: null }),
    )
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

describe('POST /api/app/v1/karute (save) — isManual provenance round-trips (edit-layer Wave 1 fix round)', () => {
  it('entry.isManual: true → forwarded as is_manual: true to the core create call', async () => {
    const res = await savePOST(
      post({ ...auth, ...idem }, {
        ...validSave,
        entries: [{ category: 'symptom', content: 'staff-added', confidenceScore: 1, isManual: true }],
      }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ content: 'staff-added', is_manual: true })],
      }),
    )
  })

  it('entry.isManual omitted → defaults to is_manual: false (untouched AI entry)', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ content: 'c', is_manual: false })],
      }),
    )
  })

  // The schema default is load-bearing for old thin clients in the field: a
  // legacy body carries NO entriesMode, and 'replace' (converge-on-staff) is
  // the long-standing behavior it must keep. This is the only test that reaches
  // the omission branch through SaveKaruteSchema, so a default flip goes RED
  // here and nowhere else (mutation round M7).
  it('legacy body (no entriesMode) + collision on a record WITH entries → default replace still sends entries', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', entries: [{ id: 'e1' }] }
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1' }), noRoute)
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      'kar-existing',
      expect.objectContaining({ entries: expect.any(Array) }),
    )
  })

  it('entriesMode fill-if-empty + collision on a record WITH entries → update omits entries (autosave cannot clobber)', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', entries: [{ id: 'e1' }] }
    const res = await savePOST(
      post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1', entriesMode: 'fill-if-empty' }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      'kar-existing',
      expect.not.objectContaining({ entries: expect.anything() }),
    )
  })
})

describe('POST /api/app/v1/karute (save) — karute.save choke-point audit (packet 30 §3)', () => {
  it('emits karute.save exactly once, facade identity, source facade', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(200)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.save',
        actorId: 'auth-user-1',
        actorType: 'staff',
        businessId: 'business-1',
        targetType: 'karute',
        targetId: 'kar-new',
        source: 'facade',
        detail: expect.objectContaining({ customer_id: 'cust-1' }),
      }),
    )
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

// The karute is persisted BEFORE the outcome label is written, so a label
// problem must never surface as a failure response for a save that durably
// succeeded (Greptile #689 r2). The worker has the same shape.
describe('POST /api/app/v1/karute — an ineligible revisit never fails a persisted save', () => {
  const withRevisit = { ...validSave, outcome: { status: 'revisit', isFirstVisit: false } }
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  it('ineligible revisit → SUCCESS, karute persisted, NO outcome row, warn logged', async () => {
    const res = await savePOST(post({ ...auth, ...idem }, withRevisit), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('kar-new')
    expect(create).toHaveBeenCalled()
    expect(outcomeUpsert).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('revisit rejected server-side'),
      expect.objectContaining({ karuteRecordId: 'kar-new' }),
    )
  })

  it('UNVERIFIABLE eligibility → the label IS written (fail-open) with a loud warn', async () => {
    // Post-persist fail-open: the karute is already durable, an attacker cannot
    // induce core read failures on demand, and the dialog's gate is itself
    // server-derived — so silently losing an HONEST label is the worse harm.
    // NOT customersGet — the route itself reads the customer earlier, so
    // failing that is a different (502) path. This mocks exactly the two
    // guard-only reads: one healthy read with no true signal + two failures
    // is precisely the 'unknown' shape.
    listPacks.mockRejectedValue(new Error('core down'))
    listKaruteRecords.mockRejectedValue(new Error('core down'))
    const res = await savePOST(post({ ...auth, ...idem }, withRevisit), noRoute)
    expect(res.status).toBe(200)
    expect(outcomeUpsert).toHaveBeenCalledTimes(1)
    expect(outcomeUpsert.mock.calls[0][0]).toMatchObject({ outcome: 'revisit' })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('eligibility unverifiable after retry'),
      expect.objectContaining({ karuteRecordId: 'kar-new' }),
    )
  })

  it('ELIGIBLE revisit → success AND the outcome row is written (regression)', async () => {
    listKaruteRecords.mockResolvedValue({
      karute_records: [{ id: 'kar-old', recording_session_id: 'sess-earlier' }],
    })
    const res = await savePOST(post({ ...auth, ...idem }, withRevisit), noRoute)
    expect(res.status).toBe(200)
    expect(outcomeUpsert).toHaveBeenCalledTimes(1)
    expect(outcomeUpsert.mock.calls[0][0]).toMatchObject({ outcome: 'revisit' })
    expect(warn).not.toHaveBeenCalled()
  })
})
