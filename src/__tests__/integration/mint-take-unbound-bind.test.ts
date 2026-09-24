/**
 * ⚖ THE SERVER-NAMED UPLOAD GETS A ROW (fix plan v3 PR-2), behind
 * RECORDING_SWITCHES.bindUnboundUploads — it ships OFF (on 2026-09-24, off
 * again 2026-09-25); both states stay pinned below.
 *
 * With the switch OFF the upload door answers exactly as it always did: a
 * server-named take is signed and bound to no row, and nothing new is read.
 * With it ON, the same arm signs FIRST and then creates a row born reserved on
 * the exact key it signed — and every failure after the sign gives today's
 * answer, so the audio still lands. Only the create's `exists` withholds the
 * link. The phone door never answers 403 on this body, whatever the roster or
 * the store clamp says.
 *
 * Same harness as app-api-recording-finalize.test.ts (the Bearer verifier runs
 * for real, every network edge is faked).
 */
import { createHmac } from 'node:crypto'
import { fakeCreateSignedUploadUrl, OBJECT_NOT_FOUND } from './helpers/storage-fakes'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['records.write']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] }
const staffListByBusinessOrThrow = jest.fn(async () => roster.current)
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: () => staffListByBusinessOrThrow(),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const held = new Set<string>()
const uploadUrl = (p: string) => `https://proj.supabase.co/upload/${p}`
const createSignedUploadUrl = jest.fn(fakeCreateSignedUploadUrl(held, uploadUrl))
const objectFree = { data: null, error: { ...OBJECT_NOT_FOUND } }
const info = jest.fn(
  async (
    _key: string,
  ): Promise<{ data: { size?: number } | null; error: { message: string; status?: number; statusCode?: string } | null }> =>
    objectFree,
)
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ createSignedUploadUrl, info }) } }),
}))

const recordingsCreate = jest.fn(async (_i: unknown): Promise<{ id: string }> => ({ id: 'sess-new' }))
const recordingsGet = jest.fn(async (_id: string): Promise<unknown> => {
  throw Object.assign(new Error('not found'), { status: 404 })
})
const recordingsUpdate = jest.fn()
const storesGet = jest.fn(async (_id: string): Promise<unknown> => ({ id: 'store-1' }))
const storesList = jest.fn(async () => ({ stores: [{ id: 'store-p', is_primary: true }] as { id: string; is_primary?: boolean }[] }))
const staffStoresGet = jest.fn(async (_id: string) => ({ store_ids: ['store-1'] as string[] }))
const fakeClient = {
  recordings: { get: recordingsGet, create: recordingsCreate, update: recordingsUpdate },
  appointments: { get: jest.fn(async () => ({ staff_id: 'auth-user-1' })) },
  karuteRecords: { getByRecordingSession: jest.fn() },
  stores: { get: storesGet, list: storesList },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST as mintPOST } from '@/app/api/app/v1/recordings/upload-url/route'
import { mintTakeUploadUrl, type MintTakeActor } from '@/lib/recording/mint-take-url'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { settleUnboundBind } from '@/lib/recording/unbound-bind'
import { composeTakeKey } from '@/lib/recording/key-grammar'
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

const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const SERVER_KEY = /^app_business-1_([0-9a-f-]{36})\.webm$/
/** Today's answer for a server-named take — the exact key set, nothing more. */
const TODAY_KEYS = ['contentType', 'path', 'recordingSessionId', 'token', 'url']

const bindIdentity = jest.fn(async (): Promise<{ staffId: string; storeId: string } | null> => ({
  staffId: 'auth-user-1',
  storeId: 'store-1',
}))
const actor = (): MintTakeActor => ({
  staffId: null,
  businessId: 'business-1',
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  bindIdentity,
  source: 'facade',
})
const mint = (body: Record<string, unknown> = {}) => mintTakeUploadUrl(fakeClient as never, actor(), body)
/** Forces the switch for one describe; restored after every case. */
const forceSwitch = (value: boolean) => {
  let replaced: { restore(): void } | undefined
  beforeEach(() => {
    replaced = jest.replaceProperty(RECORDING_SWITCHES as { bindUnboundUploads: boolean }, 'bindUnboundUploads', value)
  })
  afterEach(() => replaced?.restore())
}
const warned: string[] = []

beforeEach(() => {
  jest.clearAllMocks()
  warned.length = 0
  jest.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warned.push(String(a[0])))
  jest.spyOn(console, 'error').mockImplementation(() => {})
  capabilities.current = new Set(['records.write'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  held.clear()
  info.mockImplementation(async () => objectFree)
  createSignedUploadUrl.mockImplementation(fakeCreateSignedUploadUrl(held, uploadUrl))
  recordingsCreate.mockImplementation(async () => ({ id: 'sess-new' }))
  bindIdentity.mockImplementation(async () => ({ staffId: 'auth-user-1', storeId: 'store-1' }))
  storesGet.mockImplementation(async () => ({ id: 'store-1' }))
  storesList.mockImplementation(async () => ({ stores: [{ id: 'store-p', is_primary: true }] }))
  staffStoresGet.mockImplementation(async () => ({ store_ids: ['store-1'] }))
})

describe('settleUnboundBind — every answer of the create (fold B)', () => {
  const signed = { path: 'app_b_k.webm', url: 'https://u/k', token: 'tok', contentType: 'audio/webm' }
  const today = { ...signed, recordingSessionId: null }
  it.each([
    ['{ id } → bound', { id: 'row-1' }, { ...signed, recordingSessionId: 'row-1' }],
    ['exists → upstream, and NO url', { error: 'exists' as const }, { error: 'upstream' }],
    ['bad_input → today’s answer', { error: 'bad_input' as const }, today],
    ['upstream → today’s answer', { error: 'upstream' as const }, today],
    ['null → today’s answer', null, today],
  ])('%s', (_label, result, expected) => {
    const res = settleUnboundBind(result, signed)
    expect(res).toEqual(expected)
    // toEqual ignores an undefined `url`; the key itself must be absent.
    if ('error' in expected) expect('url' in res).toBe(false)
  })
  // The sixth row (the create THROWS) is settled in the mint — see the ON block.
})

it('ships OFF (back off 2026-09-25)', () => {
  expect(RECORDING_SWITCHES.bindUnboundUploads).toBe(false)
})

describe('switch OFF (forced) — the door answers exactly as before', () => {
  forceSwitch(false)

  it('a server-named take: no bindIdentity, no create, no extra read, today’s shape', async () => {
    const res = await mint({ customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
    expect(res).toMatchObject({ path: expect.stringMatching(SERVER_KEY), recordingSessionId: null })
    expect(bindIdentity).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('the phone door makes no roster or store read for it', async () => {
    const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-1' }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).recordingSessionId).toBeNull()
    // (staffStores is read once by the handler's own front gate — not this door.)
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
    expect(storesGet).not.toHaveBeenCalled()
    expect(staffStoresGet).toHaveBeenCalledTimes(1)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('an unrostered caller’s server-named body is still 200, never 403', async () => {
    roster.current = []
    const res = await mintPOST(jreq(auth), noRoute)
    expect(res.status).toBe(200)
  })
})

describe('switch ON — the server-named take gets a row on the key it was signed for', () => {
  forceSwitch(true)

  it('creates ONE row, born reserved on exactly the signed key, after the sign', async () => {
    const res = await mint({ customerId: 'cust-1', appointmentId: 'appt-1' })
    if (!('url' in res)) throw new Error('expected a signed answer')
    const take = SERVER_KEY.exec(res.path)![1]
    expect(res.path).toBe(composeTakeKey('business-1', take, 'audio/webm')!.key)
    expect(res.recordingSessionId).toBe('sess-new')
    expect(recordingsCreate).toHaveBeenCalledTimes(1)
    expect(recordingsCreate).toHaveBeenCalledWith({
      staff_id: 'auth-user-1',
      customer_id: 'cust-1',
      appointment_id: 'appt-1',
      store_id: 'store-1',
      audio_storage_path: res.path,
      status: 'UPLOADING',
    })
    expect(createSignedUploadUrl).toHaveBeenCalledWith(res.path)
    // Fix round 6's order: sign first, write second.
    expect(createSignedUploadUrl.mock.invocationCallOrder[0]).toBeLessThan(
      recordingsCreate.mock.invocationCallOrder[0],
    )
  })

  it('logs ONE bare line on a bind, none when kept unbound (the post-flip watch)', async () => {
    const logged = jest.spyOn(console, 'info').mockImplementation(() => {})
    try {
      // A create that settles to today's answer (storage could not say) — no line.
      info.mockImplementationOnce(async () => ({ data: null, error: { message: 'boom', status: 500 } }))
      await expect(mint()).resolves.toMatchObject({ recordingSessionId: null })
      expect(warned).toContain('[mint-take-url] unbound upload kept unbound: create answered upstream')
      expect(logged).not.toHaveBeenCalled()
      await mint()
      expect(logged.mock.calls).toEqual([['[mint-take-url] unbound upload bound']])
    } finally {
      logged.mockRestore()
    }
  })

  it.each([
    ['bindIdentity answers null', async () => null],
    [
      'bindIdentity throws',
      async () => {
        throw new Error('roster blip')
      },
    ],
  ])('%s → today’s answer, no create', async (_label, impl) => {
    bindIdentity.mockImplementation(impl)
    const res = await mint()
    expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
    expect(res).toMatchObject({ recordingSessionId: null })
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(warned.some((w) => w.startsWith('[mint-take-url] unbound upload kept unbound:'))).toBe(true)
  })

  it('the create throws (core down) → today’s answer', async () => {
    recordingsCreate.mockRejectedValue(new Error('core 503'))
    const res = await mint()
    expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
    expect(res).toMatchObject({ recordingSessionId: null })
    // The reason survives, bounded (describeUnknownThrow) — never bare.
    expect(warned).toContain('[mint-take-url] unbound upload kept unbound: session create threw: core 503')
  })

  it('the identity lookup throws → today’s answer, and the warn keeps why', async () => {
    bindIdentity.mockRejectedValue(new Error('roster down'))
    const res = await mint()
    expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
    expect(res).toMatchObject({ recordingSessionId: null })
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(warned).toContain('[mint-take-url] unbound upload kept unbound: identity lookup threw: roster down')
  })

  it('a 1,000-char thrown message is cut to 200 chars (+ the helper’s … marker)', async () => {
    const long = 'core down '.repeat(100)
    recordingsCreate.mockRejectedValue(new Error(long))
    await mint()
    const prefix = '[mint-take-url] unbound upload kept unbound: session create threw: '
    const line = warned.find((w) => w.startsWith(prefix))
    expect(line).toBeDefined()
    expect(line!.slice(prefix.length)).toBe(`${long.slice(0, 200)}…`)
  })

  it('the sign fails → an error, and nothing is looked up or created', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(mint()).resolves.toEqual({ error: 'upstream' })
    expect(bindIdentity).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('the key already holds bytes (`exists`) → upstream with NO url, no row', async () => {
    info.mockImplementation(async () => ({ data: { size: 9 }, error: null }))
    const res = await mint()
    expect(res).toEqual({ error: 'upstream' })
    expect('url' in res).toBe(false)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
})

describe('switch ON — the phone door never refuses the unbound body', () => {
  forceSwitch(true)

  it('binds with the clamp’s store', async () => {
    const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-1' }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).recordingSessionId).toBe('sess-new')
    expect(recordingsCreate).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1', staff_id: 'auth-user-1' }))
  })

  it('no store header, floating staff → the primary store', async () => {
    staffStoresGet.mockImplementation(async () => ({ store_ids: [] }))
    const res = await mintPOST(jreq(auth), noRoute)
    expect(res.status).toBe(200)
    expect(recordingsCreate).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-p' }))
  })

  it('an unrostered caller → 200 with today’s answer, not 403', async () => {
    roster.current = []
    const res = await mintPOST(jreq(auth), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).recordingSessionId).toBeNull()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('the clamp throws store_forbidden → 200 with today’s answer', async () => {
    storesGet.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-elsewhere' }), noRoute)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recordingSessionId).toBeNull()
    expect(body.url).toEqual(expect.any(String))
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  // The handler's front gate already 403s a caller it reads as unassigned
  // (handler.ts, store_unassigned), before any door runs. This is the window
  // after it: the assignment is emptied between the gate's read and the clamp's.
  it('a caller the clamp reads as reaching NO store → 200, stays unbound (never a store-less row)', async () => {
    staffStoresGet
      .mockImplementationOnce(async () => ({ store_ids: ['store-1'] }))
      .mockImplementation(async () => ({ store_ids: [] }))
    storesList.mockImplementation(async () => ({ stores: [{ id: 's1' }, { id: 's2' }] }))
    const res = await mintPOST(jreq(auth), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).recordingSessionId).toBeNull()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('a NAMED body from an unrostered caller is still 403, as today', async () => {
    roster.current = []
    const res = await mintPOST(
      jreq(auth, { takeId: TAKE, mimeType: 'audio/mp4', recordingSessionId: SESSION }),
      noRoute,
    )
    expect(res.status).toBe(403)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
})

describe('the schema — attribution rides only on a server-named take', () => {
  const named = { takeId: TAKE, mimeType: 'audio/mp4', recordingSessionId: SESSION }
  it.each([
    ['customerId with a takeId', { ...named, customerId: 'cust-1' }],
    ['appointmentId with a stagedFor', { stagedFor: SESSION, appointmentId: 'appt-1' }],
    ['customerId with seqs', { ...named, seqs: [0], customerId: 'cust-1' }],
    ['a customerId past its bound', { customerId: 'x'.repeat(201) }],
    ['a take id without a session (unchanged)', { takeId: TAKE, mimeType: 'audio/mp4' }],
    ['an EMPTY customerId with a takeId', { ...named, customerId: '' }],
    ['an EMPTY appointmentId with a stagedFor', { stagedFor: SESSION, appointmentId: '' }],
  ])('%s → 400', async (_label, body) => {
    const res = await mintPOST(jreq(auth, body), noRoute)
    expect(res.status).toBe(400)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('attribution on a server-named body is accepted', async () => {
    const res = await mintPOST(jreq(auth, { customerId: 'cust-1', appointmentId: null }), noRoute)
    expect(res.status).toBe(200)
  })

  it('null is not supplied — { customerId: null, appointmentId: null } alone is accepted', async () => {
    const res = await mintPOST(jreq(auth, { customerId: null, appointmentId: null }), noRoute)
    expect(res.status).toBe(200)
  })
})
