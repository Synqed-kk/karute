// Facade twins for the capture pipeline's two doors: the fenced upload-url
// mint and the finalize write. Same harness as app-api-recording-job.test.ts
// (all network mocked, the Bearer verifier runs for real). What this file owns
// is the DOOR contract — auth, zod, the roster gate, the status mapping and
// the audit-map registration — never the shared body's logic, which is proved
// in recording-finalize-take.test.ts.
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

const createSignedUploadUrl = jest.fn(async (p: string) => ({
  data: { path: p, signedUrl: `https://proj.supabase.co/upload/${p}`, token: 'tok-1' },
  error: null as { message: string } | null,
}))
const info = jest.fn(async (_key: string) => ({
  data: { size: 1024 } as { size?: number } | null,
  error: null as { message: string } | null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ createSignedUploadUrl, info }) } }),
}))

// A real uuid: the finalize schema demands one for the session id (fix round 2).
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
type Row = { id: string; business_id: string; staff_id: string; status: string; audio_storage_path: string | null }
const ROW: Row = { id: SESSION, business_id: 'business-1', staff_id: 'auth-user-1', status: 'RECORDING', audio_storage_path: null }
const recordingsGet = jest.fn(async (_id: string): Promise<Row> => ROW)
const recordingsUpdate = jest.fn(async (id: string, _i: unknown): Promise<Row> => ({ ...ROW, id }))
const recordingsCreate = jest.fn(async (_i: unknown): Promise<Row> => ({ ...ROW, id: 'sess-new' }))
const fakeClient = {
  recordings: { get: recordingsGet, update: recordingsUpdate, create: recordingsCreate },
  stores: { get: jest.fn(async () => ({ id: 'store-1' })) },
  staffStores: { get: jest.fn(async () => ({ store_ids: [] })) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST as mintPOST } from '@/app/api/app/v1/recordings/upload-url/route'
import { POST as finalizePOST } from '@/app/api/app/v1/recordings/finalize/route'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import { REVOCATION_SENSITIVE_ENDPOINTS } from '@/lib/auth/revocation'
import { TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

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
  new Request('https://s/x', { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })

const KEY = `app_business-1_${TAKE}.mp4`
const finalizeBody = { takeId: TAKE, mimeType: 'audio/mp4', durationSeconds: 12.9, byteLength: 1024 }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  capabilities.current = new Set(['records.write'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  info.mockResolvedValue({ data: { size: 1024 }, error: null })
  recordingsGet.mockResolvedValue(ROW)
  createSignedUploadUrl.mockImplementation(async (p: string) => ({
    data: { path: p, signedUrl: `https://proj.supabase.co/upload/${p}`, token: 'tok-1' },
    error: null,
  }))
})

describe('POST recordings/upload-url — the fenced mint', () => {
  it('no body → the server names the take, exactly as before', async () => {
    const res = await mintPOST(jreq(auth), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toMatch(/^app_business-1_[0-9a-f-]{36}\.webm$/)
    expect(body.contentType).toBe('audio/webm')
  })

  it('a named take + container composes the tenant-prefixed key', async () => {
    const res = await mintPOST(jreq(auth, { takeId: TAKE, mimeType: 'audio/mp4' }), noRoute)
    expect(await res.json()).toMatchObject({ path: KEY, contentType: 'audio/mp4' })
    // Signed with NO options (fix round 3): the facade door mints the same way
    // the web door does, so neither can hand out a URL that overwrites a
    // finalized take. Exact arity is the pin against upsert returning.
    expect(createSignedUploadUrl).toHaveBeenCalledWith(KEY)
  })

  it.each([
    ['a foreign key smuggled as a take id', { takeId: `../app_business-2_${TAKE}`, mimeType: 'audio/webm' }],
    ['a container we do not store', { takeId: TAKE, mimeType: 'audio/aac' }],
    ['an unknown key (strict schema)', { takeId: TAKE, path: 'x.webm' }],
    ['a non-string take id', { takeId: 7 }],
  ])('refuses %s → 400, nothing signed', async (_label, body) => {
    const res = await mintPOST(jreq(auth, body), noRoute)
    expect(res.status).toBe(400)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // Fix round 2, B7 — the route's own stated invariant: a caller that TRIED to
  // name a take and sent garbage must be told, never silently handed a
  // server-named key it will not recognize when it finalizes.
  it('a MALFORMED JSON body → 400, and nothing is signed', async () => {
    const res = await mintPOST(
      new Request('https://s/x', { method: 'POST', headers: auth, body: '{"takeId":' }),
      noRoute,
    )
    expect(res.status).toBe(400)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('an EMPTY body string still mints the default, server-named take', async () => {
    const res = await mintPOST(
      new Request('https://s/x', { method: 'POST', headers: auth, body: '' }),
      noRoute,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).path).toMatch(/^app_business-1_[0-9a-f-]{36}\.webm$/)
  })

  it('missing Bearer → 401', async () => {
    const res = await mintPOST(jreq({ 'content-type': 'application/json' }), noRoute)
    expect(res.status).toBe(401)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

describe('POST recordings/finalize', () => {
  it('happy → 200, and the shared body wrote the pointer', async () => {
    const res = await finalizePOST(jreq(auth, { ...finalizeBody, recordingSessionId: SESSION }), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, recordingSessionId: SESSION })
    expect(info).toHaveBeenCalledWith(KEY)
    expect(recordingsUpdate).toHaveBeenCalledWith(SESSION, {
      audio_storage_path: KEY,
      duration_seconds: 12,
      status: 'UPLOADING',
    })
  })

  it('missing Bearer → 401, nothing written', async () => {
    const res = await finalizePOST(jreq({ 'content-type': 'application/json' }, finalizeBody), noRoute)
    expect(res.status).toBe(401)
    expect(recordingsUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing required field', { takeId: TAKE, mimeType: 'audio/mp4' }],
    ['a storage path smuggled in (strict)', { ...finalizeBody, audioPath: 'app_business-1_x.webm' }],
    ['a negative byte length', { ...finalizeBody, byteLength: -1 }],
  ])('zod refuses %s → 400', async (_label, body) => {
    const res = await finalizePOST(jreq(auth, body), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsUpdate).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('missing capability → 403', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await finalizePOST(jreq(auth, finalizeBody), noRoute)
    expect(res.status).toBe(403)
  })

  it('a caller who is not on this roster → 403, nothing minted (#566)', async () => {
    roster.current = [{ id: 'someone-else', full_name: 'x', display_role: 'practitioner' }]
    const res = await finalizePOST(jreq(auth, finalizeBody), noRoute)
    expect(res.status).toBe(403)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('another staffer’s session → a real 403, not a 2xx nobody logs', async () => {
    recordingsGet.mockResolvedValue({ ...ROW, staff_id: 'staff-2' })
    const res = await finalizePOST(jreq(auth, { ...finalizeBody, recordingSessionId: SESSION }), noRoute)
    expect(res.status).toBe(403)
    expect(recordingsUpdate).not.toHaveBeenCalled()
  })

  it('a missing object rides out in the 2xx body — the drain retries it', async () => {
    info.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await finalizePOST(jreq(auth, finalizeBody), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'object_missing' })
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('is registered in FACADE_AUDIT_MAP as a skip citing the shared choke point', () => {
    // The taxonomy suites demand the row; this pins WHY it is a skip.
    expect(FACADE_AUDIT_MAP['recordings.finalize']).toEqual({
      kind: 'skip',
      category: 'recording',
      action: '',
      coveredBy: 'src/lib/recording/finalize-take.ts#finalizeTakeWithClient',
    })
  })

  it('is revocation-sensitive — a just-terminated staffer must re-verify', () => {
    expect(REVOCATION_SENSITIVE_ENDPOINTS.has('recordings.finalize')).toBe(true)
  })
})
