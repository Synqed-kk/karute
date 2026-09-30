// The karute SAVE (packet 08 Decision 3 — the headline: consent gate fail-closed
// + recorder-first attribution + the recording_session_id dedupe) and the pack-
// redemption UNDO. The REAL createOrUpdateKaruteRecord runs (so the dedupe is
// exercised end-to-end) + the REAL consent gate (isConsentCurrent); all network
// mocked; memory ingest stubbed (best-effort, tested elsewhere).
import { createHmac } from 'node:crypto'
import { RECORDING_CONSENT_POLICY_VERSION, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'
import { UNASSIGNED_STORE_DENIAL } from '@/lib/auth/store-gate'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'

// Inject the resolved scope only: the route's stamp helper and write lock
// remain real, so neither can hide a missing guard in the other.
jest.mock('@/lib/app-api/store-clamp', () => {
  const actual = jest.requireActual('@/lib/app-api/store-clamp')
  return { ...actual, resolveStoreForRequest: jest.fn(actual.resolveStoreForRequest) }
})

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
// `serviceOverride` = the removed-staff helper's in-memory profiles table,
// installed only while it runs the REAL roster read (helpers/removed-staff.ts);
// otherwise the real module, exactly as before.
const serviceOverride = { current: null as unknown }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: (...a: unknown[]) =>
    serviceOverride.current ?? jest.requireActual('@/lib/supabase/service').createServiceClient(...a),
}))
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
const existingBySession = {
  current: null as null | { id: string; transcript: string; store_id?: string | null; entries?: Array<{ id: string }> },
}
// The caller's OWN store assignment — what resolveWriteStoreScope reads for the
// converge branch's store lock. `[]` is core's answer for floating staff (and
// the default here), so every pre-existing case keeps its old unclamped shape.
const assignedStores = { current: [] as string[] }
const staffStoresGet = jest.fn(async () => ({ store_ids: assignedStores.current }))
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
    get: jest.fn(async () => ({ staff_id: 'appt-staff', store_id: null as string | null, title: null as string | null })),
  },
  karuteOutcomes: { upsert: outcomeUpsert, get: outcomeGet },
  packs: { removeRedemption, listPacks },
  staffStores: { get: staffStoresGet },
  stores: { get: jest.fn(async (id: string) => ({ id })) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST as savePOST, OPTIONS as saveOPTIONS } from '@/app/api/app/v1/karute/route'
import { rosterOf, removedRow, unplaceableRow, seamOver, BUSINESS } from './helpers/removed-staff'
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
  assignedStores.current = []
  outcomeGet.mockResolvedValue(null)
  listPacks.mockResolvedValue([])
  listKaruteRecords.mockResolvedValue({ karute_records: [] })
  // The T1/T2 oracle pins queue appointment reads they prove are NEVER made;
  // clearAllMocks keeps that queue, and a leftover 404 now drops the next
  // test's link — so every test starts from the default booking read.
  fakeClient.appointments.get.mockReset()
  fakeClient.appointments.get.mockImplementation(async () => ({ staff_id: 'appt-staff', store_id: null, title: null }))
})

describe('POST /api/app/v1/karute (save)', () => {
  it('degraded scope + appointment refuses before create, without an audit row', async () => {
    const degraded = { storeId: null, allowedStoreIds: null, degraded: true }
    jest.mocked(resolveStoreForRequest).mockResolvedValueOnce(degraded)

    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-1' }), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden', message: STORE_SCOPE_UNVERIFIED })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(fakeClient.appointments.get).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('unassigned scope + NULL-store appointment refuses before create', async () => {
    jest.mocked(resolveStoreForRequest).mockResolvedValueOnce({ storeId: null, allowedStoreIds: [] })
    fakeClient.appointments.get.mockResolvedValue({ staff_id: 'appt-staff', store_id: null, title: null })

    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-1' }), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden', message: UNASSIGNED_STORE_DENIAL })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(fakeClient.appointments.get).not.toHaveBeenCalled()
  })

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

  // ⚖ FRESH-EYES-P1B F1 — THE WIRING, not the core. store-write-locks.test.ts
  // calls createOrUpdateKaruteRecord directly with a scope it chooses, so it
  // proves the lock and says nothing about what THIS door hands it. A required
  // parameter stops a caller OMITTING a scope; it cannot stop one handing over a
  // permissive one, and that is exactly the shape nothing caught: with
  // `{ viewAll: true, allowedStoreIds: null }` in place of `lockScope` the whole
  // suite stayed green while a 代官山 staffer on the phone overwrote a 銀座 karute
  // through the converge branch.
  it('a clamped Bearer caller + an existing record in ANOTHER store → 404, nothing written', async () => {
    capabilities.current = new Set(['records.write']) // no stores.viewAll — the clamp reads the assignment
    assignedStores.current = ['store-daikanyama']
    existingBySession.current = { id: 'kar-existing', transcript: 'old', store_id: 'store-ginza' }
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1' }), noRoute)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatchObject({
      code: 'not_found',
      message: 'karute not found in this business',
    })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('the same clamped caller converges normally on a record in their OWN store', async () => {
    capabilities.current = new Set(['records.write'])
    assignedStores.current = ['store-ginza']
    existingBySession.current = { id: 'kar-existing', transcript: 'old', store_id: 'store-ginza' }
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1' }), noRoute)
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })
  // E-1 (PR-B1 fix round 1): the dedupe UPDATE must carry the CUSTOMER, not
  // only the appointment. The recovery banner's 保存先を変更 can re-point a
  // take whose earlier partial save already landed a record under this
  // recording_session_id; without customer_id the record stayed filed on the
  // OLD customer while appointment_id moved to the NEW one's booking — a
  // mis-attributed karute, reported to the staffer as a success.
  it('a dedupe UPDATE carries the re-pointed customer, not just the appointment', async () => {
    // The existing record is filed under a DIFFERENT customer than the save is
    // for — exactly the post-re-point shape.
    existingBySession.current = { id: 'kar-existing', transcript: 'old' }
    const res = await savePOST(
      post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1', appointmentId: 'appt-new' }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    // BOTH move together. Before the fix only appointment_id was sent, so the
    // karute kept the old customer while pointing at the new one's booking.
    expect((update.mock.calls[0] as unknown[])[1]).toMatchObject({
      customer_id: 'cust-1',
      appointment_id: 'appt-new',
    })
  })
  it('unresolvable attribution (not on roster, no appointment) → 403, no write', async () => {
    roster.current = []
    const res = await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  // ⚖ 2026-09-19 fold — Greptile finding 1: the existence-oracle close. An
  // unplaceable Bearer caller must get the SAME answer whatever ids they send,
  // and no consent/appointment read may run for them before that answer.
  it('unplaceable Bearer caller + a NON-EXISTENT appointmentId → 403 store_forbidden, STORE_SCOPE_UNVERIFIED, before any read (T1)', async () => {
    roster.current = []
    fakeClient.appointments.get.mockRejectedValueOnce(Object.assign(new Error('no such appointment'), { status: 404 }))

    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-missing' }), noRoute)

    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden', message: STORE_SCOPE_UNVERIFIED })
    expect(fakeClient.appointments.get).not.toHaveBeenCalled()
    expect(getConsent).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  // A REMOVED staffer whose token is still alive: their profile carries the
  // name the removal leaves (`_system_removed_…`), so the REAL identity seam
  // (businessIdForUser) refuses them FIRST — membership_inactive, before the
  // capabilities, the roster placement gate or any read.
  it('a REMOVED staffer (real identity seam over a _system_removed_ profile) → 403 membership_inactive from the SEAM, before the placement gate and any read', async () => {
    const { businessIdForUser } = jest.requireMock('@/lib/staff') as { businessIdForUser: jest.Mock }
    const { staffListByBusinessOrThrow } = jest.requireMock('@/lib/staff') as { staffListByBusinessOrThrow: jest.Mock }
    businessIdForUser.mockImplementationOnce(
      seamOver([removedRow('auth-user-1', '田中')], (c) => (serviceOverride.current = c)),
    )
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-1' }), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'membership_inactive' })
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
    expect(staffStoresGet).not.toHaveBeenCalled()
    expect(fakeClient.appointments.get).not.toHaveBeenCalled()
    expect(getConsent).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  // The DOOR layer alone (seam mocked): a null-name profile the seam lets
  // through is dropped by the REAL roster read, core answers
  // `{ store_ids: [] }` — the door refuses before any read, never reading
  // them as floating.
  it('an UNPLACEABLE staffer (real roster read over a null-name profile — door layer alone) → 403 store_forbidden STORE_SCOPE_UNVERIFIED, before any read', async () => {
    roster.current = (await rosterOf(
      [unplaceableRow('auth-user-1'), { id: 'colleague-1', full_name: '佐藤', customer_id: BUSINESS }],
      (c) => (serviceOverride.current = c),
    )) as typeof roster.current
    expect(roster.current.map((s) => s.id)).toEqual(['colleague-1'])
    assignedStores.current = []
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-1' }), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden', message: STORE_SCOPE_UNVERIFIED })
    expect(fakeClient.appointments.get).not.toHaveBeenCalled()
    expect(getConsent).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('the SAME unplaceable caller + an EXISTING appointmentId (with a staff_id) → the BYTE-IDENTICAL refusal, no existence oracle (T2/T3)', async () => {
    roster.current = []
    fakeClient.appointments.get.mockRejectedValueOnce(Object.assign(new Error('no such appointment'), { status: 404 }))
    const missingRes = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-missing' }), noRoute)
    const missingBody = await missingRes.json()

    roster.current = []
    fakeClient.appointments.get.mockResolvedValueOnce({ staff_id: 'appt-staff', store_id: null, title: null })
    const existingRes = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId: 'ap-exists' }), noRoute)
    const existingBody = await existingRes.json()

    // T2: byte-identical status + body whether the sent appointmentId exists or not.
    expect(existingRes.status).toBe(missingRes.status)
    expect(existingBody).toEqual(missingBody)
    expect(existingRes.status).toBe(403)
    expect(existingBody.error).toMatchObject({ code: 'store_forbidden', message: STORE_SCOPE_UNVERIFIED })
    // T3: neither call ever read the appointment or the customer's consent, and nothing was written.
    expect(fakeClient.appointments.get).not.toHaveBeenCalled()
    expect(getConsent).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
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

  // PR B2 §3: recording_session_id + appointment_id let the per-recording
  // thread page (PR D) join a karute back to its recording/appointment.
  it('detail carries recording_session_id + appointment_id when the save has them', async () => {
    await savePOST(
      post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rs-1', appointmentId: 'ap-1' }),
      noRoute,
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          recording_session_id: 'rs-1',
          appointment_id: 'ap-1',
        }),
      }),
    )
  })

  it('detail carries null (never undefined) when the save has neither', async () => {
    await savePOST(post({ ...auth, ...idem }, validSave), noRoute)
    const [call] = audit.mock.calls[0] as [{ detail: Record<string, unknown> }]
    expect(call.detail).toHaveProperty('recording_session_id', null)
    expect(call.detail).toHaveProperty('appointment_id', null)
  })
})

describe('POST /api/app/v1/karute (save) — a booking that cannot be used never loses the karute', () => {
  // ⚖ 9/12 matrix: the three degraded arms are mutually exclusive outcomes of ONE read, so the matrix = each arm alone + the all-OK case unchanged.
  const ginzaClamp = () =>
    jest.mocked(resolveStoreForRequest).mockResolvedValueOnce({ storeId: 'store-ginza', allowedStoreIds: ['store-ginza'] })
  const notFound = () => Object.assign(new Error('no such appointment'), { status: 404 })
  const blip = () => Object.assign(new Error('upstream'), { status: 503 })
  // SF-5 (S67 fix round 2, commit 15): the reply names the record's EFFECTIVE booking id beside appointment_link.
  type SaveReply = { outcome: { written: boolean; reason?: string }; appointment_id: string | null; appointment_link: string | null }
  const saveWith = async (appointmentId: string, reply: SaveReply) => {
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, appointmentId }), noRoute)
    expect(res.status).toBe(200)
    // S2 (PR-O commit 2, RULING-S67-PRO-STOP1 R-O1): the save now answers with the answer's and the booking's fate — still an exact pin.
    expect(await res.json()).toEqual({ id: 'kar-new', ...reply })
    expect(audit).toHaveBeenCalledTimes(1)
    return audit.mock.calls[0][0] as { action: string; severity?: string; detail: Record<string, unknown> }
  }

  it('booking in scope → the booking\'s store, link and menu kept, a normal audit row', async () => {
    ginzaClamp()
    fakeClient.appointments.get.mockResolvedValueOnce({ staff_id: 'x', store_id: 'store-ginza', title: 'VIP施術' })
    const row = await saveWith('ap-g', { outcome: { written: false, reason: 'not_sent' }, appointment_id: 'ap-g', appointment_link: null })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-ginza', appointment_id: 'ap-g', service: 'VIP施術' }))
    expect(row.severity).toBeUndefined()
    expect(row.detail).toHaveProperty('appointment_link', null)
  })

  it('booking not found → 200, saved in the caller\'s store, link dropped, one read, notice row', async () => {
    ginzaClamp()
    fakeClient.appointments.get.mockRejectedValueOnce(notFound())
    const row = await saveWith('ap-gone', { outcome: { written: false, reason: 'not_sent' }, appointment_id: null, appointment_link: 'appointment_not_found' })
    expect(fakeClient.appointments.get).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-ginza', appointment_id: null, service: null }))
    expect(row).toMatchObject({ action: 'karute.save', severity: 'notice', detail: { appointment_link: 'appointment_not_found' } })
  })

  it('booking in another store → 200 (no refusal), saved in the caller\'s store, link and menu dropped, notice row', async () => {
    ginzaClamp()
    fakeClient.appointments.get.mockResolvedValueOnce({ staff_id: 'x', store_id: 'store-daikanyama', title: '代官山の施術' })
    const row = await saveWith('ap-x', { outcome: { written: false, reason: 'not_sent' }, appointment_id: null, appointment_link: 'appointment_out_of_scope' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-ginza', appointment_id: null, service: null }))
    expect(row).toMatchObject({ severity: 'notice', detail: { appointment_link: 'appointment_out_of_scope' } })
  })

  it('a blip then a good read → a normal save with the booking\'s store, link and menu', async () => {
    ginzaClamp()
    fakeClient.appointments.get
      .mockRejectedValueOnce(blip())
      .mockResolvedValueOnce({ staff_id: 'x', store_id: 'store-ginza', title: 'VIP施術' })
    const row = await saveWith('ap-g', { outcome: { written: false, reason: 'not_sent' }, appointment_id: 'ap-g', appointment_link: null })
    expect(fakeClient.appointments.get).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-ginza', appointment_id: 'ap-g', service: 'VIP施術' }))
    expect(row.severity).toBeUndefined()
    expect(row.detail).toHaveProperty('appointment_link', null)
  })

  it('booking unreadable twice → 200, saved in the caller\'s store, link KEPT, no menu, notice row', async () => {
    ginzaClamp()
    fakeClient.appointments.get.mockRejectedValueOnce(blip()).mockRejectedValueOnce(blip())
    const row = await saveWith('ap-g', { outcome: { written: false, reason: 'not_sent' }, appointment_id: 'ap-g', appointment_link: 'appointment_unreadable' })
    expect(fakeClient.appointments.get).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-ginza', appointment_id: 'ap-g', service: null }))
    expect(row).toMatchObject({ severity: 'notice', detail: { appointment_link: 'appointment_unreadable' } })
  })
  it('a booking with no store keeps today\'s behaviour (link and menu kept, store null), a normal audit row', async () => {
    // Pins the `apptStore &&` guard on the facade door (web twin in karute-store-stamp.test.ts).
    ginzaClamp()
    fakeClient.appointments.get.mockResolvedValueOnce({ staff_id: 'x', store_id: null, title: 'ストア無し施術' })
    const row = await saveWith('ap-n', { outcome: { written: false, reason: 'not_sent' }, appointment_id: 'ap-n', appointment_link: null })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: null, appointment_id: 'ap-n', service: 'ストア無し施術' }))
    expect(row.severity).toBeUndefined()
    expect(row.detail).toHaveProperty('appointment_link', null)
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

// S4 (PR-O commit 1, O1/V4): the facade converge never clears a booking link.
// The existing-record fixture is widened per case with `as never` (its declared
// type predates the link fields) — no shared fixture changes.
describe('POST /api/app/v1/karute (save) — S4 the converge never clears a booking link', () => {
  const converge = async (existing: Record<string, unknown>, body: Record<string, unknown> = {}) => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', ...existing } as never
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1', ...body }), noRoute)
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    return (update.mock.calls[0] as unknown[])[1] as Record<string, unknown>
  }

  it('S4-facade: a second save with no booking, same customer, keeps the first save\'s link', async () => {
    const sent = await converge({ customer_id: 'cust-1', appointment_id: 'appt-first' })
    // A2 (S69 fix round 4, commit 24; licensed class): the key is OMITTED —
    // core leaves a missing field untouched, so the link the row holds NOW
    // stays (sending the snapshot back would clobber an interleaved link).
    expect(sent).toMatchObject({ customer_id: 'cust-1' })
    expect(sent).not.toHaveProperty('appointment_id')
  })

  it('A2-facade: a save that names a booking sends the key with the given id', async () => {
    const sent = await converge({ customer_id: 'cust-1', appointment_id: 'appt-first' }, { appointmentId: 'ap-1' })
    expect(sent).toMatchObject({ appointment_id: 'ap-1' })
  })

  it('A2-facade: the update RETURNS a different link (an interleaved save) → the row and the reply carry the returned id', async () => {
    update.mockResolvedValueOnce({ id: 'kar-existing', appointment_id: 'appt-interleaved' } as never)
    existingBySession.current = { id: 'kar-existing', transcript: 'old', customer_id: 'cust-1', appointment_id: 'appt-first' } as never
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1' }), noRoute)
    expect(res.status).toBe(200)
    expect((update.mock.calls[0] as unknown[])[1]).not.toHaveProperty('appointment_id')
    const rows = audit.mock.calls.filter((c) => (c[0] as { action: string }).action === 'karute.save')
    expect((rows[0][0] as { detail: Record<string, unknown> }).detail).toMatchObject({ appointment_id: 'appt-interleaved', appointment_link: 'kept' })
    expect((await res.json()).appointment_id).toBe('appt-interleaved')
  })

  it('S4-facade: a re-point to another customer with no booking moves both — the old booking never rides along (E-1)', async () => {
    const sent = await converge({ customer_id: 'cust-OTHER', appointment_id: 'appt-first' })
    expect(sent).toMatchObject({ customer_id: 'cust-1', appointment_id: null })
  })
})

// S2 + S5 (PR-O commit 2, RULING-S67-PRO-STOP1 R-O2): the save answers with the
// answer's fate, and the ONE karute.save row carries it as outcome_link — the
// outcome write runs first (deferred emit), so the row is emitted exactly once
// and still emitted when the write fails.
describe('POST /api/app/v1/karute (save) — S2/S5 the save answers with the answer\'s fate', () => {
  let warn: jest.SpyInstance
  let error: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    error = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    error.mockRestore()
  })
  const save = async (body: Record<string, unknown> = {}) => {
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, ...body }), noRoute)
    expect(res.status).toBe(200)
    const saveRows = audit.mock.calls.filter((c) => (c[0] as { action: string }).action === 'karute.save')
    expect(saveRows).toHaveLength(1)
    return { reply: await res.json(), row: saveRows[0][0] as { detail: Record<string, unknown> } }
  }

  it('S2/S5-facade written: the answer lands, THEN the one row says written', async () => {
    const { reply, row } = await save({ outcome: { status: 'success' } })
    expect(reply).toEqual({ id: 'kar-new', outcome: { written: true }, appointment_id: null, appointment_link: null })
    expect(row.detail.outcome_link).toBe('written')
    expect(outcomeUpsert.mock.invocationCallOrder[0]).toBeLessThan(audit.mock.invocationCallOrder[0])
  })

  it('S2/S5-facade kept: a converge with no answer keeps the answer already on record', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old' }
    outcomeGet.mockResolvedValueOnce({ outcome: 'success' })
    const { reply, row } = await save({ recordingSessionId: 'rec-1' })
    // S7 (commit 4): a session save with no booking now asks the auto-link — this harness has no session read, so the
    // read fails → 'skipped:read_failed' (S-3, S68 fix round 3: a failed read is never the word 'none').
    expect(reply).toEqual({ id: 'kar-existing', outcome: { written: false, reason: 'kept' }, appointment_id: null, appointment_link: 'skipped:read_failed' })
    expect(row.detail.outcome_link).toBe('kept')
    expect(outcomeUpsert).not.toHaveBeenCalled()
  })

  // SF-3(a) (S68 fix round 3, commit 23 — the r3 NIT: no test pinned it): the
  // answer belongs to the VISIT. A converge that re-points the record to
  // another customer (保存先を変更, E-1) with no answer in the body keeps the
  // decided answer already on the record; with an answer in the body the new
  // answer is written under the NEW customer.
  it('SF-3(a): a re-point to another customer with NO answer in the body keeps the decided answer → kept', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', customer_id: 'cust-OTHER' } as never
    outcomeGet.mockResolvedValueOnce({ outcome: 'success' })
    const { reply, row } = await save({ recordingSessionId: 'rec-1' })
    expect((update.mock.calls[0] as unknown[])[1]).toMatchObject({ customer_id: 'cust-1' })
    expect(reply.outcome).toEqual({ written: false, reason: 'kept' })
    expect(row.detail).toMatchObject({ outcome_link: 'kept', customer_id: 'cust-1' })
    expect(outcomeUpsert).not.toHaveBeenCalled()
  })
  it('SF-3(a): a re-point to another customer WITH an answer in the body writes it under the new customer → written', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old', customer_id: 'cust-OTHER' } as never
    const { reply, row } = await save({ recordingSessionId: 'rec-1', outcome: { status: 'no_deal' } })
    expect((update.mock.calls[0] as unknown[])[1]).toMatchObject({ customer_id: 'cust-1' })
    expect(outcomeUpsert).toHaveBeenCalledTimes(1)
    expect(outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({ karute_record_id: 'kar-existing', customer_id: 'cust-1', outcome: 'no_deal' }))
    expect(reply.outcome).toEqual({ written: true })
    expect(row.detail).toMatchObject({ outcome_link: 'written', customer_id: 'cust-1' })
  })

  // S67 fix round 2, commit 13 (SF-3(b); the attack's M1): a 保留 placeholder
  // is not a decided answer (isDecidedOutcome, the worker's own rule).
  it('SF-3 M1: a converge with no answer over a 保留 placeholder is never kept → skipped:not_sent', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old' }
    outcomeGet.mockResolvedValueOnce({ outcome: 'pending' })
    const { reply, row } = await save({ recordingSessionId: 'rec-1' })
    expect(reply.outcome).toEqual({ written: false, reason: 'not_sent' })
    expect(row.detail.outcome_link).toBe('skipped:not_sent')
    expect(outcomeUpsert).not.toHaveBeenCalled()
  })
  it('SF-3 M1: a new answer over a 保留 placeholder replaces it → written', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old' }
    outcomeGet.mockResolvedValue({ outcome: 'pending' })
    const { reply, row } = await save({ recordingSessionId: 'rec-1', outcome: { status: 'success' } })
    expect(reply.outcome).toEqual({ written: true })
    expect(row.detail.outcome_link).toBe('written')
    expect(outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })
  it('SF-3: a converge with no answer over a DECIDED answer (no_deal) → kept', async () => {
    existingBySession.current = { id: 'kar-existing', transcript: 'old' }
    outcomeGet.mockResolvedValueOnce({ outcome: 'no_deal' })
    const { reply, row } = await save({ recordingSessionId: 'rec-1' })
    expect(reply.outcome).toEqual({ written: false, reason: 'kept' })
    expect(row.detail.outcome_link).toBe('kept')
    expect(outcomeUpsert).not.toHaveBeenCalled()
  })

  it('S2/S5-facade skipped:not_sent: an old client sends no answer and no reason', async () => {
    const { reply, row } = await save()
    expect(reply).toEqual({ id: 'kar-new', outcome: { written: false, reason: 'not_sent' }, appointment_id: null, appointment_link: null })
    expect(row.detail.outcome_link).toBe('skipped:not_sent')
    expect(outcomeGet).not.toHaveBeenCalled()
  })

  it('S2/S5-facade skipped:<client reason>: the client says why no answer rides the save', async () => {
    const { reply, row } = await save({ outcomeMissing: 'never_asked' })
    expect(reply).toEqual({ id: 'kar-new', outcome: { written: false, reason: 'never_asked' }, appointment_id: null, appointment_link: null })
    expect(row.detail.outcome_link).toBe('skipped:never_asked')
  })

  it('S2/S5-facade skipped:not_returning: the revisit guard refuses 既存のお客様 — saved, the refusal is said', async () => {
    const { reply, row } = await save({ outcome: { status: 'revisit', isFirstVisit: false } })
    expect(reply).toEqual({ id: 'kar-new', outcome: { written: false, reason: 'not_returning' }, appointment_id: null, appointment_link: null })
    expect(row.detail.outcome_link).toBe('skipped:not_returning')
    expect(outcomeUpsert).not.toHaveBeenCalled()
  })

  it('S2/S5-facade failed (the write errors): saved, one row with failed:<ref>, never the technical cause', async () => {
    outcomeUpsert.mockRejectedValueOnce(new Error('core down at 10.0.0.7'))
    const { reply, row } = await save({ outcome: { status: 'success' } })
    expect(reply).toEqual({ id: 'kar-new', outcome: { written: false, reason: 'write_failed' }, appointment_id: null, appointment_link: null })
    expect(row.detail.outcome_link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(JSON.stringify(reply)).not.toContain('core down')
  })

  it('S2/S5-facade failed (the write THROWS): the row is still emitted exactly once, the save still answers 200', async () => {
    // A real throw out of setKaruteOutcomeWithClient: the revisit guard's
    // customer read throws SYNCHRONOUSLY (the route's own tenancy read, the
    // first customers.get call, stays healthy).
    customersGet
      .mockImplementationOnce(async (id: string) => ({ id, name: 'Y' }))
      .mockImplementationOnce(() => { throw new Error('sync boom') })
    const { reply, row } = await save({ outcome: { status: 'revisit', isFirstVisit: false } })
    expect(customersGet).toHaveBeenCalledTimes(2)
    expect(reply).toEqual({ id: 'kar-new', outcome: { written: false, reason: 'write_failed' }, appointment_id: null, appointment_link: null })
    expect(row.detail.outcome_link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(outcomeUpsert).not.toHaveBeenCalled()
  })

  // R-O9 (ii): ONE reference joins the server log line and the audit row —
  // the ref is generated once per failed write (outcome-fate.ts failed()).
  const loggedRefs = () =>
    error.mock.calls
      .map((c) => { try { return JSON.parse(String(c[0])) as { evt?: string; ref?: string } } catch { return null } })
      .filter((line) => line?.evt === 'outcome_write_failed')
      .map((line) => line?.ref)

  it('one reference joins the log line and the audit row (the write errors)', async () => {
    outcomeUpsert.mockRejectedValueOnce(new Error('core down at 10.0.0.7'))
    const { row } = await save({ outcome: { status: 'success' } })
    const link = String(row.detail.outcome_link)
    expect(link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(loggedRefs()).toEqual([link.slice('failed:'.length)])
  })

  it('one reference joins the log line and the audit row (the write THROWS)', async () => {
    customersGet
      .mockImplementationOnce(async (id: string) => ({ id, name: 'Y' }))
      .mockImplementationOnce(() => { throw new Error('sync boom') })
    const { row } = await save({ outcome: { status: 'revisit', isFirstVisit: false } })
    const link = String(row.detail.outcome_link)
    expect(link).toMatch(/^failed:[0-9a-f]{8}$/)
    expect(loggedRefs()).toEqual([link.slice('failed:'.length)])
  })
})

// S7 (PR-O commit 4): the facade save links the ONE unambiguous booking of the
// session's day when the save names none — through resolveAutoAppointmentLink,
// the function the worker shares. The reply and the one karute.save row carry
// the SAME appointment_link value (R-O9 (i): one vocabulary).
describe('POST /api/app/v1/karute (save) — S7 the unambiguous booking is linked at save', () => {
  const client = fakeClient as unknown as Record<string, Record<string, unknown>>
  const appt = (id: string, startsAt: string, endsAt: string) => ({
    id, customer_id: 'cust-1', store_id: 'store-ginza', starts_at: startsAt, ends_at: endsAt,
    duration_minutes: 60, status: 'SCHEDULED', cancelled_at: null,
  })
  const attach = (appts: object[]) => {
    jest.mocked(resolveStoreForRequest).mockResolvedValueOnce({ storeId: 'store-ginza', allowedStoreIds: ['store-ginza'] })
    client.recordings = { get: jest.fn(async () => ({ id: 'rec-1', created_at: '2026-09-29T07:44:39Z' })) }
    client.appointments.list = jest.fn(async () => ({ appointments: appts }))
  }
  afterEach(() => {
    delete client.recordings
    delete client.appointments.list
  })
  const save = async (body: Record<string, unknown> = {}) => {
    const res = await savePOST(post({ ...auth, ...idem }, { ...validSave, recordingSessionId: 'rec-1', ...body }), noRoute)
    expect(res.status).toBe(200)
    const rows = audit.mock.calls.filter((c) => (c[0] as { action: string }).action === 'karute.save')
    expect(rows).toHaveLength(1)
    return { reply: await res.json(), row: rows[0][0] as { severity?: string; detail: Record<string, unknown> } }
  }

  it('S7-facade: one booking in its window → the record is created ON it; reply and row say auto_linked', async () => {
    attach([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')])
    const { reply, row } = await save()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: 'appt-1' }))
    expect(reply.appointment_link).toBe('auto_linked')
    expect(row.detail).toMatchObject({ appointment_link: 'auto_linked', appointment_id: 'appt-1' })
    expect(row.severity).toBeUndefined()
  })
  it('S7-facade: two bookings that day → no link; reply and row say ambiguous', async () => {
    attach([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z'), appt('appt-2', '2026-09-29T10:00:00Z', '2026-09-29T11:00:00Z')])
    const { reply, row } = await save()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: null }))
    expect(reply.appointment_link).toBe('ambiguous')
    expect(row.detail).toMatchObject({ appointment_link: 'ambiguous', appointment_id: null })
  })
  // S-3 (S68 fix round 3): a failed read → skipped:read_failed on the reply
  // AND the row, no link, the save goes on.
  it('S-3 F: the day\'s bookings cannot be read → saved with no link; reply and row say skipped:read_failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    attach([])
    client.appointments.list = jest.fn(async () => { throw new Error('core down') })
    const { reply, row } = await save()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: null }))
    expect(reply.appointment_link).toBe('skipped:read_failed')
    expect(reply.appointment_id).toBeNull()
    expect(row.detail).toMatchObject({ appointment_link: 'skipped:read_failed', appointment_id: null })
    warn.mockRestore()
  })
  it('S-3 F: the session row cannot be read → saved with no link; reply and row say skipped:read_failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    attach([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')])
    client.recordings = { get: jest.fn(async () => { throw new Error('core down') }) }
    const { reply, row } = await save()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: null }))
    expect(client.appointments.list).not.toHaveBeenCalled()
    expect(reply.appointment_link).toBe('skipped:read_failed')
    expect(row.detail).toMatchObject({ appointment_link: 'skipped:read_failed', appointment_id: null })
    warn.mockRestore()
  })
  it('S7-facade: a save that NAMES a booking never runs the auto-link', async () => {
    attach([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')])
    fakeClient.appointments.get.mockResolvedValueOnce({ staff_id: 'x', store_id: 'store-ginza', title: 't' })
    const { reply } = await save({ appointmentId: 'ap-given' })
    expect(client.appointments.list).not.toHaveBeenCalled()
    expect(reply.appointment_link).toBeNull()
  })
  it('S7-facade: a converge whose record keeps its link never re-points it', async () => {
    attach([appt('appt-other', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')])
    existingBySession.current = { id: 'kar-existing', transcript: 'old', customer_id: 'cust-1', appointment_id: 'appt-first' } as never
    await save()
    // A2 (S69 commit 24; licensed class): no link change → the key is omitted, the link stays.
    expect((update.mock.calls[0] as unknown[])[1]).not.toHaveProperty('appointment_id')
    expect(client.appointments.list).not.toHaveBeenCalled()
  })
  // S67 fix round 2, commit 12 (SF-2; the attack's F-2): the auto-linked
  // booking's menu fills the new karute through the ONE fill the worker shares.
  it('SF-2 F-2: a create auto-linked to a booking titled カット stamps that menu (the same as the worker)', async () => {
    attach([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')])
    fakeClient.appointments.get.mockResolvedValueOnce({ staff_id: 'x', store_id: 'store-ginza', title: 'カット' })
    await save()
    expect(fakeClient.appointments.get).toHaveBeenCalledWith('appt-1')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: 'appt-1', service: 'カット' }))
  })
  // S67 fix round 2, commit 11 (SF-1; the attack's F-1 / F-1b): on a converge
  // the auto-link searches the KARUTE's own store, never the request's.
  const inStore = (id: string, storeId: string) => ({ ...appt(id, '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z'), store_id: storeId })
  const convergeInOtherStore = () => {
    existingBySession.current = {
      id: 'kar-existing', transcript: 'old', store_id: 'store-daikanyama', customer_id: 'cust-1', appointment_id: null,
    } as never
  }
  it('SF-1 F-1: a converge onto a store-A karute from a store-B request never links the store-B booking', async () => {
    attach([inStore('appt-store-B', 'store-ginza')])
    convergeInOtherStore()
    const { reply, row } = await save()
    expect(client.appointments.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-daikanyama' }))
    // A2 (S69 commit 24; licensed class): same customer, no booking, no hit → the key is omitted.
    expect((update.mock.calls[0] as unknown[])[1]).not.toHaveProperty('appointment_id')
    expect(reply.appointment_link).toBe('none')
    expect(row.detail).toMatchObject({ appointment_link: 'none', appointment_id: null })
  })
  it("SF-1 F-1b: the same converge finds the karute's OWN store-A booking", async () => {
    attach([inStore('appt-store-A', 'store-daikanyama')])
    convergeInOtherStore()
    const { reply, row } = await save()
    expect((update.mock.calls[0] as unknown[])[1]).toMatchObject({ appointment_id: 'appt-store-A' })
    expect(reply.appointment_link).toBe('auto_linked')
    expect(row.detail).toMatchObject({ appointment_link: 'auto_linked', appointment_id: 'appt-store-A' })
  })
  // S67 fix round 2, commit 15 (SF-5; the attack's F-6): the row and the reply
  // tell the record's EFFECTIVE link; `kept` when an existing link stayed;
  // null = the booking was given by the payload.
  it('SF-5 F-6: a kept-link converge → row and reply say kept + the record\'s link, never null / none', async () => {
    attach([appt('appt-other', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')])
    existingBySession.current = { id: 'kar-existing', transcript: 'old', customer_id: 'cust-1', appointment_id: 'appt-first' } as never
    const { reply, row } = await save()
    expect(row.detail).toMatchObject({ appointment_link: 'kept', appointment_id: 'appt-first' })
    expect(reply).toMatchObject({ appointment_link: 'kept', appointment_id: 'appt-first' })
  })
  it('SF-5: a payload-named booking → appointment_link null + the named id, in the row and the reply', async () => {
    attach([appt('appt-1', '2026-09-29T07:30:00Z', '2026-09-29T08:30:00Z')])
    fakeClient.appointments.get.mockResolvedValueOnce({ staff_id: 'x', store_id: 'store-ginza', title: 't' })
    const { reply, row } = await save({ appointmentId: 'ap-given' })
    expect(row.detail).toMatchObject({ appointment_link: null, appointment_id: 'ap-given' })
    expect(reply).toMatchObject({ appointment_link: null, appointment_id: 'ap-given' })
  })
})
