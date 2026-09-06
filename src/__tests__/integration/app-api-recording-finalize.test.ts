// Facade twins for the capture pipeline's two doors: the fenced upload-url
// mint and the finalize write. Same harness as app-api-recording-job.test.ts
// (all network mocked, the Bearer verifier runs for real). What this file owns
// is the DOOR contract — auth, zod, the roster gate, the status mapping and
// the audit-map registration — never the shared body's logic, which is proved
// in recording-finalize-take.test.ts.
import { createHmac } from 'node:crypto'
import { fakeCreateSignedUploadUrl, OBJECT_NOT_FOUND } from './helpers/storage-fakes'

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

/** What the fake bucket HOLDS — a non-upsert sign is a CREATE and storage
 *  refuses one for a key already there (helpers/storage-fakes.ts). */
const held = new Set<string>()
const uploadUrl = (p: string) => `https://proj.supabase.co/upload/${p}`
const createSignedUploadUrl = jest.fn(fakeCreateSignedUploadUrl(held, uploadUrl))
const info = jest.fn(async (_key: string) => ({
  data: { size: 1024 } as { size?: number } | null,
  error: null as { message: string; status?: number; statusCode?: string } | null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ createSignedUploadUrl, info }) } }),
}))

// A real uuid: the finalize schema demands one for the session id (fix round 2).
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
type Row = {
  id: string
  business_id: string
  staff_id: string
  status: string
  audio_storage_path: string | null
  duration_seconds: number | null
}
/** The state the MINT leaves behind — see the beforeEach: the finalize door only
 *  ever meets a row that already reserved its take's key (fix round 4). */
const ROW: Row = {
  id: SESSION,
  business_id: 'business-1',
  staff_id: 'auth-user-1',
  status: 'UPLOADING',
  audio_storage_path: null,
  duration_seconds: null,
}
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
const finalizeBody = {
  takeId: TAKE,
  mimeType: 'audio/mp4',
  durationSeconds: 12.9,
  byteLength: 1024,
  recordingSessionId: SESSION,
}
/** A client-named mint body. The mint RESERVES this key before it signs, on the
 *  row the body names — REQUIRED as of fix round 7: the mint creates none. */
const mintBody = { takeId: TAKE, mimeType: 'audio/mp4', recordingSessionId: SESSION }
/** storage-js's "no such object" — a free key, which is every first mint. */
const objectFree = { data: null, error: { ...OBJECT_NOT_FOUND } }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  capabilities.current = new Set(['records.write'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  info.mockResolvedValue({ data: { size: 1024 }, error: null })
  recordingsGet.mockResolvedValue({ ...ROW, audio_storage_path: KEY })
  held.clear()
  createSignedUploadUrl.mockImplementation(fakeCreateSignedUploadUrl(held, uploadUrl))
})

describe('POST recordings/upload-url — the fenced mint', () => {
  it('no body → the server names the take, exactly as before', async () => {
    const res = await mintPOST(jreq(auth), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toMatch(/^app_business-1_[0-9a-f-]{36}\.webm$/)
    expect(body.contentType).toBe('audio/webm')
  })

  it('a named take + container composes the tenant-prefixed key, and BINDS it', async () => {
    info.mockResolvedValue(objectFree)
    recordingsGet.mockResolvedValue(ROW)
    const res = await mintPOST(jreq(auth, mintBody), noRoute)
    const body = await res.json()
    expect(body).toMatchObject({ path: KEY, contentType: 'audio/mp4' })
    // Signed with NO options (fix round 3): the facade door mints the same way
    // the web door does, so neither can hand out a URL that overwrites a
    // finalized take. Exact arity is the pin against upsert returning.
    expect(createSignedUploadUrl).toHaveBeenCalledWith(KEY)
    expect(body.recordingSessionId).toBe(SESSION)
  })

  it('reserves on the caller’s named session, and never creates one', async () => {
    info.mockResolvedValue(objectFree)
    recordingsGet.mockResolvedValue(ROW)
    const res = await mintPOST(jreq(auth, mintBody), noRoute)
    expect(res.status).toBe(200)
    expect(recordingsUpdate).toHaveBeenCalledWith(SESSION, {
      audio_storage_path: KEY,
      status: 'UPLOADING',
    })
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect((await res.json()).recordingSessionId).toBe(SESSION)
  })

  // FIX ROUND 7 (J2). The mint's row-creating branch is gone — a lost response
  // after that create left the client unable to name the row it had just made,
  // so its retry could only collide with it. startRecordingSession is the one
  // door that mints rows, and its retry is safe because it carries no key.
  it('a named take with NO recordingSessionId → 400, nothing bound', async () => {
    const res = await mintPOST(jreq(auth, { takeId: TAKE, mimeType: 'audio/mp4' }), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // ⚖ A STAGED COPY IS NAMED FOR ITS SESSION (fix round 7). The phone's
  // discard staging posts `{ stagedFor }`, and that body NAMES a session — so
  // it pays for the same roster identity a client-named take does, and the same
  // staff rule decides it. Nothing is reserved and nothing is written.
  it('a stagedFor body signs a session-named key, and binds nothing', async () => {
    recordingsGet.mockResolvedValue(ROW)
    // The key is FREE — this suite's default `info` answers "an object is
    // there", which since fix round 2 is a different, un-signed answer.
    info.mockResolvedValue({ data: null, error: { ...OBJECT_NOT_FOUND } })
    const res = await mintPOST(jreq(auth, { stagedFor: SESSION }), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toMatch(
      new RegExp(`^stg/business-1_${SESSION}_[0-9a-f-]{36}\\.webm$`),
    )
    expect(body.recordingSessionId).toBe(SESSION)
    expect(body.url).toBeTruthy()
    expect(recordingsUpdate).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
    // ⚖ …BUT THE KEY IS PROBED FIRST (fix round 2). "A fresh uuid nobody can
    // hold" stopped being true when the slot became the TAKE: the key is
    // composable in advance, so the door looks before it signs, and an object
    // already there is answered with its SIZE instead of a signed URL. One
    // `info()` read, the shared one — and here it says the key is free, so this
    // body is signed exactly as it always was.
    expect(info).toHaveBeenCalledWith(body.path)
  })

  // …and when the object IS already there the door signs NOTHING and hands back
  // the size, which is the only thing the device can check its own blob against.
  it('…and an object already at that key comes back as a SIZE, never a URL', async () => {
    recordingsGet.mockResolvedValue(ROW)
    info.mockResolvedValue({ data: { size: 4096 }, error: null })
    const res = await mintPOST(jreq(auth, { stagedFor: SESSION }), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.existingSize).toBe(4096)
    expect(body.url).toBeUndefined()
    expect(body.token).toBeUndefined()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('…on ANOTHER staffer’s session → 403, and nothing is signed', async () => {
    recordingsGet.mockResolvedValue({ ...ROW, staff_id: 'staff-2' })
    const res = await mintPOST(jreq(auth, { stagedFor: SESSION }), noRoute)
    expect(res.status).toBe(403)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // ⚖ …AND recordings.viewAll DOES NOT LIFT IT (slice five fix round 4, G2).
  // The take mint lets an owner reserve a colleague's take by design; a staged
  // copy is never anyone's but the recorder's — the discard word-collection
  // runs on the recorder's own device against the owner-gated take store. With
  // a deterministic, immutable key, owner reach here was a pre-fill lever: mint
  // the colleague's key first, PUT anything, and their device meets a size
  // mismatch for ever. The route's existing `forbidden` mapping carries it.
  it('…and the OWNER’S OWN KEYS get the SAME 403 on this door', async () => {
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    recordingsGet.mockResolvedValue({ ...ROW, staff_id: 'staff-2' })
    const res = await mintPOST(jreq(auth, { stagedFor: SESSION }), noRoute)
    expect(res.status).toBe(403)
    expect(info).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // ⚖ THE THIRD ACT, THROUGH THE REAL ROUTE (slice five packet C). A `seqs`
  // body asks the SAME door for this take's segment keys — the bytes that reach
  // the server while the recording is still running.
  it('a seqs body comes back with one signed key per seq, under the take’s folder', async () => {
    info.mockResolvedValue(objectFree)
    // The fence: the row has ALREADY reserved this take's key (which is what a
    // born-reserved create leaves behind). Without it the door signs nothing.
    recordingsGet.mockResolvedValue({ ...ROW, audio_storage_path: KEY })
    const res = await mintPOST(jreq(auth, { ...mintBody, seqs: [0, 1] }), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recordingSessionId).toBe(SESSION)
    expect(body.segments.map((s: { path: string }) => s.path)).toEqual([
      `seg/app_business-1_${TAKE}/000000.mp4`,
      `seg/app_business-1_${TAKE}/000001.mp4`,
    ])
    expect(body.segments.every((s: { url?: string }) => Boolean(s.url))).toBe(true)
    // It reserves nothing and it writes nothing — the finalize at the end of
    // the take is the audited act, not this.
    expect(recordingsUpdate).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  // ⚖ AND AN OWNER GETS THE SAME 403 ON THE SEGMENT ARM (fix round 1, K1) —
  // the staged arm's rule, one act over. A segment key is composable in advance
  // and both halves are readable off a colleague's row by exactly this
  // capability, so owner reach here was a pre-fill lever: mint a seq the device
  // has not reached, PUT anything, and that take's pump meets a length that is
  // not its own and goes terminally quiet. The pump runs on the recording
  // device alone, so nothing legitimate is lost by closing it.
  it('…and the OWNER’S OWN KEYS get a 403 on a colleague’s segments', async () => {
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    recordingsGet.mockResolvedValue({ ...ROW, staff_id: 'staff-2', audio_storage_path: KEY })
    const res = await mintPOST(jreq(auth, { ...mintBody, seqs: [0, 1] }), noRoute)
    expect(res.status).toBe(403)
    expect(info).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('…and a row that has not reserved this take’s key → 409 not_reserved', async () => {
    info.mockResolvedValue(objectFree)
    recordingsGet.mockResolvedValue({ ...ROW, audio_storage_path: null })
    const res = await mintPOST(jreq(auth, { ...mintBody, seqs: [0] }), noRoute)
    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toBe('not_reserved')
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('…and a seqs body with no takeId is a 400, before anything is read', async () => {
    const res = await mintPOST(jreq(auth, { recordingSessionId: SESSION, seqs: [0] }), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('…and a take body with NO seqs still mints the whole take, exactly as before', async () => {
    info.mockResolvedValue(objectFree)
    recordingsGet.mockResolvedValue(ROW)
    const body = await (await mintPOST(jreq(auth, mintBody), noRoute)).json()
    expect(body.path).toBe(KEY)
    expect(body.segments).toBeUndefined()
  })

  it('…and a body naming BOTH a take and a staged copy is a 400', async () => {
    const res = await mintPOST(jreq(auth, { ...mintBody, stagedFor: SESSION }), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('another staffer’s session → a real 403, and nothing is signed', async () => {
    info.mockResolvedValue(objectFree)
    recordingsGet.mockResolvedValue({ ...ROW, staff_id: 'staff-2' })
    const res = await mintPOST(jreq(auth, mintBody), noRoute)
    expect(res.status).toBe(403)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    expect(recordingsUpdate).not.toHaveBeenCalled()
  })

  it('a session id core does not know → 404, nothing bound', async () => {
    info.mockResolvedValue(objectFree)
    recordingsGet.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    const res = await mintPOST(jreq(auth, mintBody), noRoute)
    expect(res.status).toBe(404)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('an object that ALREADY EXISTS with no reservation of the caller’s → 409', async () => {
    // info's default: the bucket HAS this key. The row reserved nothing.
    recordingsGet.mockResolvedValue(ROW)
    const res = await mintPOST(jreq(auth, mintBody), noRoute)
    expect(res.status).toBe(409)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('a row already bound to a different take → 409', async () => {
    info.mockResolvedValue(objectFree)
    recordingsGet.mockResolvedValue({ ...ROW, audio_storage_path: 'app_business-1_other.mp4' })
    const res = await mintPOST(jreq(auth, mintBody), noRoute)
    expect(res.status).toBe(409)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('a caller who is not on this roster → 403, nothing signed (#566)', async () => {
    roster.current = [{ id: 'someone-else', full_name: 'x', display_role: 'practitioner' }]
    const res = await mintPOST(jreq(auth, mintBody), noRoute)
    expect(res.status).toBe(403)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // The reservation is what costs an identity. A SERVER-named take binds no row,
  // so it must not inherit the roster read or the assignment lookup — nor their
  // failure modes, on the hot record-start path every field client uses today.
  it('a server-named take asks core NOTHING — no roster, no store assignment', async () => {
    roster.current = []
    const res = await mintPOST(jreq(auth), noRoute)
    expect(res.status).toBe(200)
    expect(fakeClient.staffStores.get).not.toHaveBeenCalled()
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['a foreign key smuggled as a take id', { ...mintBody, takeId: `../app_business-2_${TAKE}` }],
    ['a container we do not store', { ...mintBody, mimeType: 'audio/aac' }],
    // Fix round 7 (J1): an Object.prototype member is not a container we store.
    // Read with `in` it was, and the composed key threw on its own grammar — a
    // 500 out of this door, from a request body.
    ['a prototype key as the container', { ...mintBody, mimeType: 'constructor' }],
    ['an unknown key (strict schema)', { ...mintBody, path: 'x.webm' }],
    ['a non-string take id', { ...mintBody, takeId: 7 }],
  ])('refuses %s → 400, nothing signed', async (_label, body) => {
    const res = await mintPOST(jreq(auth, body), noRoute)
    expect(res.status).toBe(400)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // H2 (round 5): the door's own zod has no field-pair rule, so a session id
  // with no take id passes IT clean and would reach the shared core — which is
  // the fence that must refuse it, never silently drop the id.
  it('a recordingSessionId with no takeId — 400, nothing bound', async () => {
    const res = await mintPOST(jreq(auth, { recordingSessionId: SESSION }), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsGet).not.toHaveBeenCalled()
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
  it('happy → 200, and the shared body stated the take', async () => {
    const res = await finalizePOST(jreq(auth, finalizeBody), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, recordingSessionId: SESSION })
    expect(info).toHaveBeenCalledWith(KEY)
    // The pointer was written by the MINT; finalize adds what it could not know.
    expect(recordingsUpdate).toHaveBeenCalledWith(SESSION, {
      duration_seconds: 12,
      status: 'UPLOADING',
    })
  })

  it('a key this row never reserved → not_reserved in the 2xx body, zero writes', async () => {
    recordingsGet.mockResolvedValue(ROW)
    const res = await finalizePOST(jreq(auth, finalizeBody), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'not_reserved' })
    expect(recordingsUpdate).not.toHaveBeenCalled()
  })

  it('missing Bearer → 401, nothing written', async () => {
    const res = await finalizePOST(jreq({ 'content-type': 'application/json' }, finalizeBody), noRoute)
    expect(res.status).toBe(401)
    expect(recordingsUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing required field', { takeId: TAKE, mimeType: 'audio/mp4' }],
    ['a MISSING recordingSessionId', { takeId: TAKE, mimeType: 'audio/mp4', durationSeconds: 1, byteLength: 1 }],
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
    recordingsGet.mockResolvedValue({ ...ROW, staff_id: 'staff-2', audio_storage_path: KEY })
    const res = await finalizePOST(jreq(auth, finalizeBody), noRoute)
    expect(res.status).toBe(403)
    expect(recordingsUpdate).not.toHaveBeenCalled()
  })

  it('a missing object rides out in the 2xx body — the drain retries it', async () => {
    // The production shape (hotfix 9/5): storage-api answers a missing
    // object on /object/info/… with HTTP 400 and body statusCode '404',
    // message 'Object not found' — never a plain 404 alone.
    info.mockResolvedValue({
      data: null,
      error: { ...OBJECT_NOT_FOUND },
    })
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
