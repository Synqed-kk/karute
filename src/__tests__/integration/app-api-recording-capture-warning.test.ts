// Facade door for the warning fact (recording hole PR-7, fix round 1 — Greptile
// P2): POST /api/app/v1/recordings/capture-warning. Same harness as
// app-api-recording-finalize.test.ts (all network mocked, the Bearer verifier
// runs for real). What this file owns is the DOOR contract — the capability,
// the roster gate, zod, and the one status mapping (a foreign session is a real
// 403, every other settled answer a 200 body) — never the shared body's logic,
// which recording-capture-warning.test.ts proves.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['records.write']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// The choke point's ONE emit, observed; the facade hook's own machinery
// (FACADE_AUDIT_MAP, logFacadeAudit) stays real.
const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (e: unknown) => auditFn(e),
}))

const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const ROW = {
  id: SESSION,
  business_id: 'business-1',
  staff_id: 'auth-user-1',
  status: 'UPLOADING',
  audio_storage_path: `app_business-1_${TAKE}.mp4`,
  duration_seconds: null,
  store_id: null,
}
const recordingsGet = jest.fn(async (_id: string) => ROW)
const fakeClient = { recordings: { get: recordingsGet } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST } from '@/app/api/app/v1/recordings/capture-warning/route'

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
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }
const noRoute = { params: Promise.resolve({}) }
const jreq = (headers: Record<string, string>, body?: unknown) =>
  new Request('https://s/x', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const warningBody = {
  recordingSessionId: SESSION,
  takeId: TAKE,
  reason: 'device',
  warnedAt: '2026-09-24T05:12:30.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  capabilities.current = new Set(['records.write'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  recordingsGet.mockResolvedValue(ROW)
})

describe('POST recordings/capture-warning', () => {
  it('own session → 200 {ok:true}, and ONE capture_warned row from the facade', async () => {
    const res = await POST(jreq(auth, warningBody), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(recordingsGet).toHaveBeenCalledWith(SESSION)
    expect(auditFn).toHaveBeenCalledTimes(1)
    expect(auditFn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.capture_warned',
        actorId: 'auth-user-1',
        businessId: 'business-1',
        targetId: SESSION,
        source: 'facade',
        detail: { reason: 'device', warned_at: warningBody.warnedAt, take_id: TAKE },
      }),
    )
  })

  it('missing records.write → 403, core never asked, no row', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await POST(jreq(auth, warningBody), noRoute)
    expect(res.status).toBe(403)
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('a caller who is not on this roster → 403, core never asked, no row (#566)', async () => {
    roster.current = [{ id: 'someone-else', full_name: 'x', display_role: 'practitioner' }]
    const res = await POST(jreq(auth, warningBody), noRoute)
    expect(res.status).toBe(403)
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it.each([
    ['another staffer’s session', { ...ROW, staff_id: 'staff-2' }],
    ['another tenant’s session', { ...ROW, business_id: 'business-2' }],
  ])('%s → a real 403, not a 2xx nobody logs; no row', async (_label, row) => {
    recordingsGet.mockResolvedValue(row)
    const res = await POST(jreq(auth, warningBody), noRoute)
    expect(res.status).toBe(403)
    expect(auditFn).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown reason', { ...warningBody, reason: 'network' }],
    ['a missing warnedAt', { recordingSessionId: SESSION, takeId: TAKE, reason: 'device' }],
    ['an unknown key (strict)', { ...warningBody, staffId: 'staff-9' }],
    ['a malformed JSON body', '{not json'],
  ])('%s → 400, core never asked, no row', async (_label, body) => {
    const res = await POST(jreq(auth, body), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('missing Bearer → 401, nothing written', async () => {
    const res = await POST(jreq({ 'content-type': 'application/json' }, warningBody), noRoute)
    expect(res.status).toBe(401)
    expect(auditFn).not.toHaveBeenCalled()
  })
})
