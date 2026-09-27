/**
 * ⚖ THE SERVER-NAMED UPLOAD GETS A ROW (fix plan v3 PR-2), behind
 * RECORDING_SWITCHES.bindUnboundUploads — it ships OFF (on 2026-09-24, off
 * again 2026-09-25); both states stay pinned below.
 *
 * With the switch OFF the upload door answers exactly as it always did: a
 * server-named take is signed and bound to no row, and nothing new is read.
 * With it ON, a 'no_session' body (5C, S50: ONLY that one — a body with no
 * attachOutcome, i.e. a client older than build 29, stays unbound exactly as
 * OFF) is signed FIRST and then gets a row born reserved on
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
// Condition 5 (S50, 5A): the ON arm's bound row files ONE audit line. The
// emitter is observed through this pass-through — by default it runs the REAL
// audit() (console line + a core sink that has no env here, so it writes
// nothing), and a case may swap one call for a throw.
const auditFn = jest.fn((e: unknown) =>
  (jest.requireActual('@/lib/audit') as typeof import('@/lib/audit')).audit(e as never),
)
jest.mock('@/lib/audit', () => ({
  ...(jest.requireActual('@/lib/audit') as object),
  audit: (e: unknown) => auditFn(e),
}))

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
/** 5C (S50): only a 'no_session' body takes the ON arm — the bind machinery
 *  below is driven through it. A body with NO attachOutcome stays unbound. */
const mintNS = (body: Record<string, unknown> = {}) => mint({ attachOutcome: 'no_session', ...body })
const NS_BODY = { stagedFor: null, attachOutcome: 'no_session' }
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
    const res = await mintNS({ customerId: 'cust-1', appointmentId: 'appt-1' })
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
    // The bound line only — S33's per-upload count line is pinned on its own below.
    const bound = () => logged.mock.calls.filter((c) => c[0] === '[mint-take-url] unbound upload bound')
    try {
      // A create that settles to today's answer (storage could not say) — no line.
      info.mockImplementationOnce(async () => ({ data: null, error: { message: 'boom', status: 500 } }))
      await expect(mintNS()).resolves.toMatchObject({ recordingSessionId: null })
      expect(warned).toContain('[mint-take-url] unbound upload kept unbound: create answered upstream')
      expect(bound()).toEqual([])
      await mintNS()
      expect(bound()).toEqual([['[mint-take-url] unbound upload bound']])
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
    const res = await mintNS()
    expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
    expect(res).toMatchObject({ recordingSessionId: null })
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(warned.some((w) => w.startsWith('[mint-take-url] unbound upload kept unbound:'))).toBe(true)
  })

  it('the create throws (core down) → today’s answer', async () => {
    recordingsCreate.mockRejectedValue(new Error('core 503'))
    const res = await mintNS()
    expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
    expect(res).toMatchObject({ recordingSessionId: null })
    // The reason survives, bounded (describeUnknownThrow) — never bare.
    expect(warned).toContain('[mint-take-url] unbound upload kept unbound: session create threw: core 503')
  })

  it('the identity lookup throws → today’s answer, and the warn keeps why', async () => {
    bindIdentity.mockRejectedValue(new Error('roster down'))
    const res = await mintNS()
    expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
    expect(res).toMatchObject({ recordingSessionId: null })
    expect(recordingsCreate).not.toHaveBeenCalled()
    expect(warned).toContain('[mint-take-url] unbound upload kept unbound: identity lookup threw: roster down')
  })

  it('a 1,000-char thrown message is cut to 200 chars (+ the helper’s … marker)', async () => {
    const long = 'core down '.repeat(100)
    recordingsCreate.mockRejectedValue(new Error(long))
    await mintNS()
    const prefix = '[mint-take-url] unbound upload kept unbound: session create threw: '
    const line = warned.find((w) => w.startsWith(prefix))
    expect(line).toBeDefined()
    expect(line!.slice(prefix.length)).toBe(`${long.slice(0, 200)}…`)
  })

  it('the sign fails → an error, and nothing is looked up or created', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(mintNS()).resolves.toEqual({ error: 'upstream' })
    expect(bindIdentity).not.toHaveBeenCalled()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('the key already holds bytes (`exists`) → upstream with NO url, no row', async () => {
    info.mockImplementation(async () => ({ data: { size: 9 }, error: null }))
    const res = await mintNS()
    expect(res).toEqual({ error: 'upstream' })
    expect('url' in res).toBe(false)
    expect(recordingsCreate).not.toHaveBeenCalled()
  })
})

describe('switch ON — the phone door never refuses the unbound body', () => {
  forceSwitch(true)

  it('binds with the clamp’s store', async () => {
    const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-1' }, NS_BODY), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).recordingSessionId).toBe('sess-new')
    expect(recordingsCreate).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1', staff_id: 'auth-user-1' }))
  })

  it('no store header, floating staff → the primary store', async () => {
    staffStoresGet.mockImplementation(async () => ({ store_ids: [] }))
    const res = await mintPOST(jreq(auth, NS_BODY), noRoute)
    expect(res.status).toBe(200)
    expect(recordingsCreate).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-p' }))
  })

  it('an unrostered caller → 200 with today’s answer, not 403', async () => {
    roster.current = []
    const res = await mintPOST(jreq(auth, NS_BODY), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).recordingSessionId).toBeNull()
    expect(recordingsCreate).not.toHaveBeenCalled()
  })

  it('the clamp throws store_forbidden → 200 with today’s answer', async () => {
    storesGet.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-elsewhere' }, NS_BODY), noRoute)
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
    const res = await mintPOST(jreq(auth, NS_BODY), noRoute)
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

// ⚖ S33 — a recording that HAS a row never gets a second one. The in-tab
// fallback says why it reached this arm; 'attach_failed' stays unbound in BOTH
// switch states. ⚖ 5C (S50, Liam 2026-09-28): ONLY 'no_session' keeps the
// switch's answer — an absent field (a client older than build 29, which never
// adopts the row) stays unbound exactly as OFF. Flipped on purpose from S33's
// "an absent field creates as before".
describe('S33 attachOutcome — the ON arm creates only when no row is known', () => {
  const countLines = (spy: jest.SpyInstance) =>
    spy.mock.calls.filter((c) => c[0] === '[mint-take-url] unbound upload')

  describe('switch ON', () => {
    forceSwitch(true)

    it('t2: attach_failed → signed, unbound, NO create, no identity read', async () => {
      const res = await mint({ attachOutcome: 'attach_failed' })
      expect(res).toMatchObject({ path: expect.stringMatching(SERVER_KEY), recordingSessionId: null })
      expect(recordingsCreate).not.toHaveBeenCalled()
      expect(bindIdentity).not.toHaveBeenCalled()
    })

    it('t2 (phone door): the facade accepts the field and creates nothing', async () => {
      const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-1' }, { stagedFor: null, attachOutcome: 'attach_failed' }), noRoute)
      expect(res.status).toBe(200)
      expect((await res.json()).recordingSessionId).toBeNull()
      expect(recordingsCreate).not.toHaveBeenCalled()
    })

    it('t2b: no_session → the existing bound behaviour, unchanged', async () => {
      const res = await mint({ attachOutcome: 'no_session', customerId: 'cust-1' })
      expect(res).toMatchObject({ recordingSessionId: 'sess-new' })
      expect(recordingsCreate).toHaveBeenCalledTimes(1)
    })

    it('u1 (was t2c, flipped by 5C): field absent (a client older than build 29) → unbound as OFF: no identity read, no row, no audit', async () => {
      const spy = jest.spyOn(console, 'info').mockImplementation(() => {})
      try {
        const res = await mint({ customerId: 'cust-1', appointmentId: 'appt-1' })
        expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
        expect(res).toMatchObject({ path: expect.stringMatching(SERVER_KEY), recordingSessionId: null })
        expect(bindIdentity).not.toHaveBeenCalled()
        expect(info).not.toHaveBeenCalled()
        expect(recordingsCreate).not.toHaveBeenCalled()
        expect(auditFn).not.toHaveBeenCalled()
        // The post-flip watch still counts it — as an unbound upload.
        expect(countLines(spy)).toEqual([
          ['[mint-take-url] unbound upload', { businessId: 'business-1', attachOutcome: null, switchOn: true, bound: false }],
        ])
      } finally {
        spy.mockRestore()
      }
    })

    it('u1 (phone door): build 28’s exact body `{ stagedFor: null }` → 200, unbound, no row, no audit', async () => {
      const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-1' }, { stagedFor: null }), noRoute)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recordingSessionId).toBeNull()
      expect(body.url).toEqual(expect.any(String))
      expect(recordingsCreate).not.toHaveBeenCalled()
      expect(auditFn).not.toHaveBeenCalled()
    })

    it('t6: ONE count line per upload — businessId, outcome, switch, bound — never a customer or a key', async () => {
      const spy = jest.spyOn(console, 'info').mockImplementation(() => {})
      try {
        const bound = await mint({ attachOutcome: 'no_session', customerId: 'cust-9', appointmentId: 'appt-9' })
        const kept = await mint({ attachOutcome: 'attach_failed' })
        const lines = countLines(spy)
        expect(lines).toEqual([
          ['[mint-take-url] unbound upload', { businessId: 'business-1', attachOutcome: 'no_session', switchOn: true, bound: true }],
          ['[mint-take-url] unbound upload', { businessId: 'business-1', attachOutcome: 'attach_failed', switchOn: true, bound: false }],
        ])
        const printed = JSON.stringify(lines)
        for (const secret of ['cust-9', 'appt-9', 'sess-new', 'path' in bound ? bound.path : 'x', 'path' in kept ? kept.path : 'x'])
          expect(printed).not.toContain(secret)
      } finally {
        spy.mockRestore()
      }
    })
    it('a mint that hands out NO upload is not counted (the ON arm’s `exists`)', async () => {
      const spy = jest.spyOn(console, 'info').mockImplementation(() => {})
      try {
        info.mockImplementation(async () => ({ data: { size: 9 }, error: null }))
        await expect(mint({ attachOutcome: 'no_session' })).resolves.toEqual({ error: 'upstream' })
        expect(countLines(spy)).toEqual([])
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('switch OFF', () => {
    forceSwitch(false)

    it('t2: attach_failed → no create; the count line still fires', async () => {
      const spy = jest.spyOn(console, 'info').mockImplementation(() => {})
      try {
        await expect(mint({ attachOutcome: 'attach_failed' })).resolves.toMatchObject({ recordingSessionId: null })
        expect(recordingsCreate).not.toHaveBeenCalled()
        expect(countLines(spy)).toEqual([
          ['[mint-take-url] unbound upload', { businessId: 'business-1', attachOutcome: 'attach_failed', switchOn: false, bound: false }],
        ])
      } finally {
        spy.mockRestore()
      }
    })
  })

  it('the field rides only on a server-named body', async () => {
    await expect(mint({ takeId: TAKE, mimeType: 'audio/webm', recordingSessionId: SESSION, attachOutcome: 'attach_failed' })).resolves.toEqual({
      error: 'bad_input',
    })
    await expect(mint({ attachOutcome: 'something_else' })).resolves.toEqual({ error: 'bad_input' })
  })
})

// ⚖ S35 C1 — the row the ON arm creates is never finalized, so it is born with
// the take's length: the SAME state finalize leaves a row that had one from the
// start in (duration_seconds set, status UPLOADING). Anything but a whole,
// positive number of seconds is dropped — never refused — and the OFF arm
// creates nothing, whatever the body carries.
describe('S35 C1 — the server-made row is born with the take length', () => {
  const bornWith = (path: string, extra: Record<string, unknown> = {}) => ({
    staff_id: 'auth-user-1',
    customer_id: 'cust-1',
    appointment_id: null,
    store_id: 'store-1',
    audio_storage_path: path,
    status: 'UPLOADING',
    ...extra,
  })

  describe('switch ON', () => {
    forceSwitch(true)

    it('T1 no_session + durationSeconds 63 → the create carries duration_seconds 63, status UPLOADING', async () => {
      const res = await mint({ attachOutcome: 'no_session', customerId: 'cust-1', durationSeconds: 63 })
      if (!('url' in res)) throw new Error('expected a signed answer')
      expect(res.recordingSessionId).toBe('sess-new')
      expect(recordingsCreate).toHaveBeenCalledTimes(1)
      expect(recordingsCreate.mock.calls[0][0]).toStrictEqual(bornWith(res.path, { duration_seconds: 63 }))
    })

    it('T1 (phone door): the facade body carries it onto the create', async () => {
      const res = await mintPOST(
        jreq({ ...auth, 'store-id': 'store-1' }, { stagedFor: null, attachOutcome: 'no_session', customerId: 'cust-1', durationSeconds: 63 }),
        noRoute,
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recordingSessionId).toBe('sess-new')
      expect(recordingsCreate.mock.calls[0][0]).toStrictEqual(bornWith(body.path, { duration_seconds: 63 }))
    })

    it('T3 an old client (no field) → the create is exactly as before, no duration_seconds key', async () => {
      const res = await mint({ attachOutcome: 'no_session', customerId: 'cust-1' })
      if (!('url' in res)) throw new Error('expected a signed answer')
      expect(recordingsCreate.mock.calls[0][0]).toStrictEqual(bornWith(res.path))
    })

    it.each([
      ['0', 0],
      ['negative', -3],
      ['a fraction', 1.5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a string', '63'],
      ['null', null],
      ['past a day', 86_401],
    ])('T2/T5 web door, %s → dropped: the mint still binds, the row has no length', async (_label, durationSeconds) => {
      const res = await mint({ attachOutcome: 'no_session', customerId: 'cust-1', durationSeconds } as never)
      if (!('url' in res)) throw new Error(`expected a signed answer, got ${JSON.stringify(res)}`)
      expect(res.recordingSessionId).toBe('sess-new')
      expect(recordingsCreate.mock.calls[0][0]).toStrictEqual(bornWith(res.path))
    })

    it.each([
      ['a string', '63'],
      ['negative', -3],
      ['a fraction', 1.5],
      ['null', null],
      ['huge', 1e12],
      ['true', true],
    ])('T5 phone door, %s → 200, dropped, still bound', async (_label, durationSeconds) => {
      const res = await mintPOST(
        jreq({ ...auth, 'store-id': 'store-1' }, { stagedFor: null, attachOutcome: 'no_session', customerId: 'cust-1', durationSeconds }),
        noRoute,
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recordingSessionId).toBe('sess-new')
      expect(recordingsCreate.mock.calls[0][0]).toStrictEqual(bornWith(body.path))
    })

    it('attach_failed carrying a length still creates nothing', async () => {
      await expect(mint({ attachOutcome: 'attach_failed', durationSeconds: 63 })).resolves.toMatchObject({ recordingSessionId: null })
      expect(recordingsCreate).not.toHaveBeenCalled()
    })
  })

  describe('switch OFF', () => {
    forceSwitch(false)

    it('T6 the OFF arm reads nothing and creates nothing, whatever the body carries', async () => {
      const res = await mint({ attachOutcome: 'no_session', customerId: 'cust-1', durationSeconds: 63 })
      expect(res).toMatchObject({ path: expect.stringMatching(SERVER_KEY), recordingSessionId: null })
      expect(Object.keys(res).sort()).toEqual(TODAY_KEYS)
      expect(bindIdentity).not.toHaveBeenCalled()
      expect(recordingsCreate).not.toHaveBeenCalled()
    })
  })
})

// ⚖ CONDITION 5 (recording-switches.ts), closed by an emitter (S50, 5A). The
// ON arm's row create is its own act now: ONE ids-only row per BOUND mint,
// attributed to the roster identity the row itself carries (bindIdentity —
// NOT the actor's up-front staffId, which is null on a server-named body), in
// the store the row was made in. Nothing on any other branch.
describe('condition 5 — the ON arm’s bound row files ONE audit line', () => {
  const BOUND = 'recording.take_bound_server_named'
  const boundCalls = () =>
    auditFn.mock.calls.filter((c) => (c[0] as { action?: string }).action === BOUND) as [Record<string, unknown>][]

  describe('switch ON', () => {
    forceSwitch(true)

    it('t1: no_session → exactly ONE line: the new action, the row as target, the right business + store', async () => {
      const res = await mint({ attachOutcome: 'no_session', customerId: 'cust-1', appointmentId: 'appt-1' })
      if (!('url' in res)) throw new Error('expected a signed answer')
      const take = SERVER_KEY.exec(res.path)![1]
      expect(auditFn).toHaveBeenCalledTimes(1)
      expect(boundCalls()).toHaveLength(1)
      const [event] = boundCalls()[0]
      expect(event).toEqual({
        category: 'recording',
        action: BOUND,
        actorId: 'auth-user-1',
        actorType: 'staff',
        businessId: 'business-1',
        severity: 'info',
        targetType: 'recording',
        targetId: 'sess-new',
        storeId: 'store-1',
        detail: { take_id: take, recording_session_id: 'sess-new', attach_outcome: 'no_session', reserved: true },
        requestId: undefined,
        source: 'facade',
      })
      // ⚖ 8/17 doc law + #1072: ids and flags only — no key, no url, no token,
      // no customer, no appointment.
      const printed = JSON.stringify(event)
      for (const secret of [res.path, res.url, res.token, 'cust-1', 'appt-1']) expect(printed).not.toContain(secret)
    })

    it('t1b (flipped by 5C): an older client (field absent) → no row, so no line', async () => {
      await expect(mint()).resolves.toMatchObject({ recordingSessionId: null })
      expect(recordingsCreate).not.toHaveBeenCalled()
      expect(auditFn).not.toHaveBeenCalled()
    })

    it('t1c (phone door): the facade files it with the clamp’s store and the request id', async () => {
      const res = await mintPOST(jreq({ ...auth, 'store-id': 'store-1' }, { stagedFor: null, attachOutcome: 'no_session' }), noRoute)
      expect(res.status).toBe(200)
      expect((await res.json()).recordingSessionId).toBe('sess-new')
      expect(boundCalls()).toHaveLength(1)
      expect(boundCalls()[0][0]).toMatchObject({
        actorId: 'auth-user-1',
        businessId: 'business-1',
        storeId: 'store-1',
        targetId: 'sess-new',
        source: 'facade',
        requestId: expect.any(String),
      })
    })

    it('t3: attach_failed → no bind, no audit', async () => {
      await expect(mint({ attachOutcome: 'attach_failed' })).resolves.toMatchObject({ recordingSessionId: null })
      expect(recordingsCreate).not.toHaveBeenCalled()
      expect(auditFn).not.toHaveBeenCalled()
    })

    it('the withheld branch (`exists`) → upstream, no audit', async () => {
      info.mockImplementation(async () => ({ data: { size: 9 }, error: null }))
      await expect(mint({ attachOutcome: 'no_session' })).resolves.toEqual({ error: 'upstream' })
      expect(auditFn).not.toHaveBeenCalled()
    })

    it.each([
      ['the create throws', () => recordingsCreate.mockRejectedValueOnce(new Error('core down'))],
      ['no staff or no store', () => bindIdentity.mockResolvedValueOnce(null)],
      ['the identity lookup throws', () => bindIdentity.mockRejectedValueOnce(new Error('roster blip'))],
    ])('kept unbound (%s) → today’s answer, no audit', async (_label, arrange) => {
      arrange()
      await expect(mint({ attachOutcome: 'no_session' })).resolves.toMatchObject({ recordingSessionId: null })
      expect(auditFn).not.toHaveBeenCalled()
    })

    it('t4: the emit THROWING never fails the mint — the bound answer stands and the warn says why', async () => {
      auditFn.mockImplementationOnce(() => {
        throw new Error('sink boom')
      })
      const res = await mint({ attachOutcome: 'no_session' })
      expect(res).toMatchObject({ recordingSessionId: 'sess-new', url: expect.any(String) })
      expect(recordingsCreate).toHaveBeenCalledTimes(1)
      expect(warned.some((w) => w.includes('bound-row audit threw') && w.includes('sink boom'))).toBe(true)
    })

    it('t4b: the REAL audit() with a failing core sink never fails the mint (the shared never-throws contract)', async () => {
      const env = { url: process.env.SYNQED_CORE_URL, key: process.env.SYNQED_CORE_API_KEY }
      process.env.SYNQED_CORE_URL = 'http://127.0.0.1:9'
      process.env.SYNQED_CORE_API_KEY = 'dummy-not-live'
      try {
        // SynqedClient is a bare jest.fn() here: `.audit.log` is undefined, so the
        // sink throws inside forwardToCore — exactly where a real outage lands.
        const res = await mint({ attachOutcome: 'no_session' })
        expect(res).toMatchObject({ recordingSessionId: 'sess-new' })
        await new Promise((r) => setImmediate(r))
        expect(warned.some((w) => w.includes('audit_sink_error') && w.includes(BOUND))).toBe(true)
      } finally {
        if (env.url === undefined) delete process.env.SYNQED_CORE_URL
        else process.env.SYNQED_CORE_URL = env.url
        if (env.key === undefined) delete process.env.SYNQED_CORE_API_KEY
        else process.env.SYNQED_CORE_API_KEY = env.key
      }
    })
  })

  describe('switch OFF', () => {
    forceSwitch(false)

    it('t2: no_session → zero audit lines, zero rows', async () => {
      await expect(mint({ attachOutcome: 'no_session', customerId: 'cust-1' })).resolves.toMatchObject({ recordingSessionId: null })
      const phone = await mintPOST(jreq({ ...auth, 'store-id': 'store-1' }, { stagedFor: null, attachOutcome: 'no_session' }), noRoute)
      expect(phone.status).toBe(200)
      expect(auditFn).not.toHaveBeenCalled()
      expect(recordingsCreate).not.toHaveBeenCalled()
    })
  })
})
