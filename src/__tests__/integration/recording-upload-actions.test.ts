/**
 * Web recording upload actions (hotfix 2026-08-25). Three things only this file
 * can prove, all of them the reason the actions exist at all:
 *   1. the minted key carries THIS caller's tenant prefix and the .webm suffix
 *      the pipeline/cleanup/worker all assume;
 *   2. the tenant fence — a path belonging to another business is refused
 *      BEFORE the service-role client (which has no RLS) ever touches it;
 *   3. the delete action that used to sit beside them is GONE (capture
 *      pipeline PR4 — audio is never deleted).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const can = jest.fn(async (_c: string) => true)
const requireCapability = jest.fn(async (_c: string) => {})
const getMyCapabilities = jest.fn(async () => new Set<string>(['records.write']))
jest.mock('@/lib/auth/require-permission', () => ({
  can: (c: string) => can(c),
  requireCapability: (c: string) => requireCapability(c),
  getMyCapabilities: () => getMyCapabilities(),
}))
const resolveStoreScope = jest.fn(async () => ({ storeId: 'store-9' as string | null }))
jest.mock('@/lib/auth/store-scope', () => ({ resolveStoreScope: () => resolveStoreScope() }))
// A jest.fn, not a bare async literal: the capability gate must run BEFORE the
// tenant fence, and "the fence never asked who the caller is" is the only
// evidence of that ordering (storage-not-reached also holds if the gate is last).
const getBusinessId = jest.fn(async () => 'biz-1')
const getCurrentUserStaffId = jest.fn(async (): Promise<string | null> => 'staff-1')
jest.mock('@/lib/staff', () => ({
  getBusinessId: () => getBusinessId(),
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
}))
// The mint files ONE audit row for a client-named take (fix round 2, B4).
const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

// The reservation's own reads/writes (fix round 4): the mint binds the take to
// a core row before it signs anything.
type Row = {
  id: string
  business_id: string
  staff_id: string
  status: string
  audio_storage_path: string | null
  duration_seconds: number | null
}
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const row = (over: Partial<Row> = {}): Row => ({
  id: SESSION,
  business_id: 'biz-1',
  staff_id: 'staff-1',
  status: 'RECORDING',
  audio_storage_path: null,
  duration_seconds: null,
  ...over,
})
const get = jest.fn(async (_id: string): Promise<Row> => row())
const create = jest.fn(async (_input: unknown): Promise<Row> => row({ id: 'sess-new' }))
const update = jest.fn(async (id: string, _input: unknown): Promise<Row> => row({ id }))
const apptGet = jest.fn(async (_id: string) => ({ staff_id: 'staff-1' }))
const fakeClient = { recordings: { get, create, update }, appointments: { get: apptGet } }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  // Wired (fix round 10): the born-reserved proof runs the SESSION door and the
  // MINT against ONE fake core, which is the only way to show that a row this
  // app version creates is never the one the mint has to update.
  getSynqedClient: async () => fakeClient,
}))

// storage-js's single-object probe. Default: the key is FREE — the bucket has
// never held this take, which is every ordinary first mint.
const notFoundError = { message: 'Object not found', status: 404 }
const info = jest.fn(
  async (
    _key: string,
  ): Promise<{
    data: { size?: number } | null
    // `status` matters: storage saying "no such object" and storage failing to
    // ANSWER are different facts, and only the first frees the key.
    error: { message: string; status?: number } | null
  }> => ({ data: null, error: notFoundError }),
)
const createSignedUploadUrl = jest.fn(async (p: string) => ({
  data: { path: p, signedUrl: `https://proj.supabase.co/upload/${p}?token=t`, token: 'tok-1' },
  error: null as { message: string } | null,
}))
const createSignedUrl = jest.fn(async (p: string, _ttl: number) => ({
  data: { signedUrl: `https://proj.supabase.co/read/${p}?token=r` },
  error: null as { message: string } | null,
}))
const removeObj = jest.fn(async (_paths: string[]) => ({
  error: null as { message: string } | null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: (_bucket: string) => ({ createSignedUploadUrl, createSignedUrl, info, remove: removeObj }),
    },
  }),
}))

import { mintRecordingUploadUrl, mintRecordingReadUrl } from '@/actions/recording-upload'
import { startRecordingSession } from '@/actions/recordings'
import {
  parseRecordingKey,
  isOwnRecordingKey,
  looksLikeRecordingKey,
  composeTakeKey,
  extFromMime,
} from '@/lib/recording/key-grammar'
import { AUDITED_CORES } from '@/lib/audit-policy'
import type { MintTakeUrlInput, MintTakeUrlResult } from '@/lib/recording/mint-take-url'

type MintedUrl = Extract<MintTakeUrlResult, { path: string }>

/** The mint answers with a result UNION now (fix round 4). Every test that is
 *  about a SUCCESSFUL mint says so here, so a refusal can never read as a pass
 *  with undefined fields. */
async function mintOk(input?: MintTakeUrlInput): Promise<MintedUrl> {
  const res = await mintRecordingUploadUrl(input)
  if ('error' in res) throw new Error(`expected a minted url, got ${res.error}`)
  return res
}

/** Nothing was bound and nothing was claimed — the assertion every refusal owes. */
function expectNoBinding(): void {
  expect(create).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  expect(auditFn).not.toHaveBeenCalled()
  expect(createSignedUploadUrl).not.toHaveBeenCalled()
}

// A real lowercase uuid, so a fixture only ever fails the ONE clause it targets —
// a placeholder body would be refused by the uuid clause and silently mask the rest.
const UUID = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const OWN = `app_biz-1_${UUID}.webm`
// A second, DIFFERENT take of the same tenant — what a row bound elsewhere holds.
const OTHER_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const OTHER_KEY = `app_biz-1_${OTHER_UUID}.webm`
/** A CLIENT-NAMED mint body. recordingSessionId is REQUIRED as of fix round 7:
 *  this mint no longer creates rows, so a named take must say which row
 *  startRecordingSession already minted for it. */
const NAMED = { takeId: UUID, mimeType: 'audio/webm', recordingSessionId: SESSION }

// Both legs run the SAME fence, so they get the SAME table — one clause wrong per row.
const REFUSED: [string, string][] = [
  // wrong prefix (uuid + suffix conform)
  ['another business’s object', `app_biz-2_${UUID}.webm`],
  ['a legacy untenanted rec_* key', `rec_${UUID}.webm`],
  ['a prefix-lookalike', `app_biz-11_${UUID}.webm`],
  ['a traversal attempt', `../app_biz-1_${UUID}.webm`],
  // wrong suffix (prefix + uuid conform) — the grammar is case-exact
  ['a case-shifted extension', `app_biz-1_${UUID}.WEBM`],
  // wrong unique part (prefix + suffix conform): every spelling of a separator…
  ['a literal separator', 'app_biz-1_/../x.webm'],
  ['a percent-encoded separator', 'app_biz-1_%2f..%2fx.webm'],
  ['a percent-encoded separator, upper hex', 'app_biz-1_%2F..%2Fx.webm'],
  ['a double-encoded separator', 'app_biz-1_%252f..%252fx.webm'],
  ['an overlong-encoded separator', 'app_biz-1_%c0%af..%c0%afx.webm'],
  ['a backslash separator', 'app_biz-1_\\..\\x.webm'],
  ['a fullwidth separator', 'app_biz-1_／..／x.webm'],
  // …and the rest of the non-grammar bodies
  ['embedded control characters', `app_biz-1_${UUID}\x00\x0a.webm`],
  ['a fragment suffix', `app_biz-1_${UUID}.webm#frag`],
  ['a query suffix', `app_biz-1_${UUID}.webm?download=1`],
  ['no unique part at all', 'app_biz-1_.webm'],
  // Parses (it IS this tenant's), and is still refused: these actions mean a
  // whole take, and the widened grammar must not widen a single fence.
  ['this business’s own segment', `seg/app_biz-1_${UUID}/000000.webm`],
]

// Not a string, but string-SHAPED: every method the fence calls answers
// conformingly. A server action's argument is caller-supplied JSON, so the type
// annotation proves nothing at runtime — the guard must refuse this before it
// invokes a single one of these.
const IMPOSTOR = {
  startsWith: () => true,
  endsWith: () => true,
  slice: () => UUID,
} as unknown as string

// Real tenant ids are uuids, not short slugs — the mint test signs against one so
// the flat-key assertion is proved on the shape production actually composes.
const BIZ_UUID = 'c47a1f2e-6b90-4d3a-8e15-9f0c2a7d4b61'

beforeEach(() => {
  jest.clearAllMocks()
  // The mint warns on every refusal by design — keep the run readable.
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  can.mockImplementation(async () => true)
  requireCapability.mockImplementation(async () => {})
  getMyCapabilities.mockImplementation(async () => new Set(['records.write']))
  resolveStoreScope.mockImplementation(async () => ({ storeId: 'store-9' }))
  getBusinessId.mockImplementation(async () => 'biz-1')
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  info.mockResolvedValue({ data: null, error: notFoundError })
  get.mockResolvedValue(row())
  create.mockResolvedValue(row({ id: 'sess-new' }))
  update.mockImplementation(async (id: string) => row({ id }))
  createSignedUploadUrl.mockImplementation(async (p: string) => ({
    data: { path: p, signedUrl: `https://proj.supabase.co/upload/${p}?token=t`, token: 'tok-1' },
    error: null,
  }))
  createSignedUrl.mockImplementation(async (p: string, _ttl: number) => ({
    data: { signedUrl: `https://proj.supabase.co/read/${p}?token=r` },
    error: null,
  }))
  removeObj.mockImplementation(async () => ({ error: null }))
})

describe('mintRecordingUploadUrl — the key shape the whole pipeline assumes', () => {
  it('mints app_${businessId}_<uuid>.webm and hands back the signed URL + token', async () => {
    getBusinessId.mockResolvedValue(BIZ_UUID)
    const res = await mintOk()
    expect(res.path).toMatch(
      new RegExp(
        `^app_${BIZ_UUID}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webm$`,
      ),
    )
    // Flat key — /api/cleanup lists the bucket ROOT non-recursively.
    expect(res.path).not.toContain('/')
    // Fix round 3: the key is signed with NO options — no upsert. A second PUT
    // to a key that already holds bytes must be refused by storage, so the
    // exact-arity assertion is the pin that an upsert flag can never come back.
    expect(createSignedUploadUrl).toHaveBeenCalledWith(res.path)
    expect(res.url).toBe(`https://proj.supabase.co/upload/${res.path}?token=t`)
    expect(res.token).toBe('tok-1')
  })

  it('every take gets its own key (no Date.now() collision window)', async () => {
    const [a, b] = await Promise.all([mintOk(), mintOk()])
    expect(a.path).not.toBe(b.path)
  })

  // Fix round 4: a take the SERVER names is a fresh uuid nobody could have
  // claimed, so it binds to no row — core is never touched, and the client is
  // told there is no session to stamp.
  it('a server-named take reserves NOTHING — no core read, no core write', async () => {
    const res = await mintOk()
    expect(res.recordingSessionId).toBeNull()
    expect(get).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('gates on records.write BEFORE minting anything — a denial settles, never throws', async () => {
    can.mockResolvedValue(false)
    await expect(mintRecordingUploadUrl()).resolves.toEqual({ error: 'forbidden' })
    expect(can).toHaveBeenCalledWith('records.write')
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('a storage failure answers upstream instead of a half-made URL', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null as never, error: { message: 'boom' } })
    await expect(mintRecordingUploadUrl()).resolves.toEqual({ error: 'upstream' })
  })
})

// The mint now accepts a CLIENT-NAMED take (capture pipeline PR2). Everything
// below is the fence that makes accepting it safe.
describe('mintRecordingUploadUrl(input) — the client names the take, the server fences it', () => {
  it('absent input is byte-identical to before: server uuid, .webm', async () => {
    getBusinessId.mockResolvedValue(BIZ_UUID)
    const res = await mintOk()
    expect(res.path).toMatch(new RegExp(`^app_${BIZ_UUID}_[0-9a-f-]{36}\\.webm$`))
    expect(res.contentType).toBe('audio/webm')
  })

  it('a named take composes the SAME key the grammar accepts, and signs it WITHOUT upsert', async () => {
    const res = await mintOk(NAMED)
    expect(res.path).toBe(OWN)
    // The device names this key, so upsert here would let one staffer overwrite
    // another's finalized audio. A re-upload gets 409, which the client reads
    // as "already there" and finalizes.
    expect(createSignedUploadUrl).toHaveBeenCalledWith(OWN)
  })

  it('a fake returning a different path must not leak through — the fenced key wins', async () => {
    createSignedUploadUrl.mockResolvedValue({
      data: { path: 'app_other-biz_hijacked.webm', signedUrl: 'https://proj.supabase.co/upload/x', token: 'tok-1' },
      error: null,
    })
    const res = await mintOk(NAMED)
    expect(res.path).toBe(OWN)
  })

  it.each([
    ['audio/webm;codecs=opus', 'webm', 'audio/webm'],
    ['audio/mp4', 'mp4', 'audio/mp4'],
    ['AUDIO/MP4; codecs="mp4a.40.2"', 'mp4', 'audio/mp4'],
    ['audio/ogg', 'ogg', 'audio/ogg'],
    ['audio/wav', 'wav', 'audio/wav'],
  ])('%s → .%s, contentType %s', async (mimeType, ext, contentType) => {
    const res = await mintOk({ ...NAMED, mimeType })
    expect(res.path).toBe(`app_biz-1_${UUID}.${ext}`)
    expect(res.contentType).toBe(contentType)
  })

  it.each([
    ['a container we do not store', 'audio/aac'],
    ['a video container', 'video/mp4'],
  ])('refuses %s — bad_mime, nothing is signed and nothing is bound', async (_label, mimeType) => {
    await expect(mintRecordingUploadUrl({ ...NAMED, mimeType })).resolves.toEqual({
      error: 'bad_mime',
    })
    expectNoBinding()
  })

  // ⚖ PR4 RIDER — mimeType joined the FIELD-PAIR RULE. An empty container on a
  // named take is now refused one fence earlier, by the schema, as bad_input:
  // it used to reach composeTakeKey and answer bad_mime, but the real fault is
  // the half-body. Without the rule the field is simply OPTIONAL, and a phone
  // that negotiated audio/mp4 and forgot to send it would silently get a
  // `.webm` key — the wrong extension on the object the whole pipeline reads.
  it.each([
    ['an empty mime', ''],
    ['no mime at all', undefined],
  ])('refuses a named take with %s — bad_input, nothing signed or bound', async (_label, mimeType) => {
    await expect(
      mintRecordingUploadUrl({ ...NAMED, mimeType: mimeType as string }),
    ).resolves.toEqual({ error: 'bad_input' })
    expect(get).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expectNoBinding()
  })

  // FIX ROUND 7 (J1). MIME_TO_EXT used to be a plain object literal read with
  // `in`, which walks the prototype chain: every name below is an
  // Object.prototype member, so the closed-set check said yes and
  // composeTakeKey read a FUNCTION as the key's extension — the composed key
  // then failed its own grammar and THREW, out of a 'use server' export, from
  // a request body. Null prototype + Object.hasOwn: they are containers we do
  // not store, like any other.
  // `constructor` and `__proto__` are the two that BITE: normalizeAudioMime
  // lowercases before the lookup, so `toString`/`hasOwnProperty` miss the
  // prototype by their capitals and are refused by the closed set either way.
  // They are in the table anyway — the fence must not depend on casing luck.
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'refuses the prototype key %s as a container — bad_mime, never a throw',
    async (mimeType) => {
      await expect(mintRecordingUploadUrl({ ...NAMED, mimeType })).resolves.toEqual({
        error: 'bad_mime',
      })
      expect(get).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
      expectNoBinding()
    },
  )

  // FIX ROUND 8 (M2): takeId is now z.string().uuid() (like recordingSessionId
  // and finalize's own), so anything that fails zod's OWN uuid shape is
  // refused at the schema — one fence earlier than composeTakeKey ever runs.
  it.each([
    ['a traversal body', '../../x'],
    ['a separator', `${UUID}/000000`],
    ['an extension smuggled into the id', `${UUID}.webm`],
    ['a non-uuid body', 'stolen'],
  ])('refuses %s as a take id — bad_input, zod refuses the shape', async (_label, takeId) => {
    await expect(
      mintRecordingUploadUrl({ ...NAMED, takeId: takeId as string }),
    ).resolves.toEqual({ error: 'bad_input' })
    expectNoBinding()
  })

  // zod's uuid check is case-INSENSITIVE (unlike the grammar's TAKE_UUID),
  // so an uppercase uuid alone passes the schema and reaches composeTakeKey —
  // still refused there, bad_take_id, by the case-exact grammar.
  it('refuses an uppercase uuid as a take id — bad_take_id, the grammar is case-exact', async () => {
    await expect(
      mintRecordingUploadUrl({ ...NAMED, takeId: UUID.toUpperCase() }),
    ).resolves.toEqual({ error: 'bad_take_id' })
    expectNoBinding()
  })

  // H1 (round 5): these fail the SHAPE zod checks (not a string at all), so
  // the first-line schema parse refuses them as bad_input before composeTakeKey
  // ever runs — one fence earlier than the semantic bad_mime/bad_take_id checks.
  it.each([
    ['a non-string mime', { ...NAMED, mimeType: 12345 as unknown as string }],
    ['a string-shaped non-string take id', { ...NAMED, takeId: IMPOSTOR }],
  ])('refuses %s — bad_input, before composeTakeKey runs', async (_label, input) => {
    await expect(mintRecordingUploadUrl(input)).resolves.toEqual({ error: 'bad_input' })
    expectNoBinding()
  })

  it('gates on records.write BEFORE it looks at any client input', async () => {
    can.mockResolvedValue(false)
    await expect(mintRecordingUploadUrl(NAMED)).resolves.toEqual({ error: 'forbidden' })
    expect(getBusinessId).not.toHaveBeenCalled()
    expectNoBinding()
  })
})

// Fix round 2, B4 (detail shape re-cut in fix round 3). A key the DEVICE named
// is a name the caller may not own — storage now refuses the overwrite, and this
// row is who reached for the name. A server-named uuid claims nothing and files
// nothing, exactly as before.
describe('mintRecordingUploadUrl — the client-named take leaves ONE audit row', () => {
  it('files one ids-only row for a named take, carrying the row it bound', async () => {
    await mintOk({ ...NAMED, mimeType: 'audio/mp4' })
    expect(auditFn).toHaveBeenCalledTimes(1)
    const [event] = auditFn.mock.calls[0] as [Record<string, unknown>]
    expect(event).toMatchObject({
      category: 'recording',
      action: 'recording.take_named',
      actorId: 'staff-1',
      actorType: 'staff',
      businessId: 'biz-1',
      severity: 'info',
      source: 'web',
    })
    // ⚖ 8/17 doc law — ids, numbers and flags only; no key, no path, no URL.
    // No `upsert` field: the mint no longer has the flag to report.
    expect(event.detail).toEqual({
      take_id: UUID,
      ext: 'mp4',
      recording_session_id: SESSION,
      reserved: true,
    })
    expect(JSON.stringify(event.detail)).not.toContain(OWN)
  })

  it('files NOTHING when the server names the take — old behaviour unchanged', async () => {
    await mintOk()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('files nothing when the named take is REFUSED — no row for a key never signed', async () => {
    // 'stolen' fails zod's own uuid shape (fix round 8) — bad_input, one fence
    // earlier than composeTakeKey. The point this test proves is unchanged:
    // nothing is filed for a take id that never got a signed URL.
    await expect(mintRecordingUploadUrl({ ...NAMED, takeId: 'stolen' })).resolves.toEqual({
      error: 'bad_input',
    })
    expect(auditFn).not.toHaveBeenCalled()
  })

  // FIX ROUND 6 flips fix round 4 back. "Always file the claim, even on a
  // failed sign" made a transient SIGNING failure durable: the row was
  // already written, but the caller got back no session id — its retry could
  // only start a SECOND reservation, which core's own key rightly refuses
  // (409 → reserved_elsewhere, terminal), stranding the take and orphaning
  // the first row. Signing first means a failed sign writes and audits
  // NOTHING, so the caller's retry is a clean first attempt.
  it('a failed sign writes and audits NOTHING — the caller can retry clean', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null as never, error: { message: 'boom' } })
    await expect(mintRecordingUploadUrl(NAMED)).resolves.toEqual({ error: 'upstream' })
    expect(update).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  // The emitter is a PRIVATE helper, so CP7's registry-reality cross-check
  // (exported symbols only) can never require the registration — this pin is
  // what goes red if either entry is dropped. commitReservation (fix round 6
  // — the write half of the old reserveTakeForRecorder, split from the
  // read-only planReservation) is the symbol the SDK writes live in (CP3's
  // containment rule).
  it('is registered in AUDITED_CORES as the file’s writer', () => {
    expect(AUDITED_CORES).toContainEqual(
      expect.objectContaining({
        file: 'src/lib/recording/mint-take-url.ts',
        symbols: ['auditTakeNamed', 'commitReservation'],
      }),
    )
  })
})

// FIX ROUND 4 — THE RESERVATION. One audio object ↔ one recording row, bound to
// its recorder BEFORE any bytes exist. Everything here is the fence that makes
// a client-named key safe to hand a signed upload URL for.
// FIX ROUND 6 (I1) reorders the internal writes — sign first, reserve second —
// but the CALLER-VISIBLE invariant this describe block is named for is
// unchanged: the function never returns a URL before the row is reserved.
describe('mintRecordingUploadUrl — the take is bound before the caller ever gets the URL', () => {
  const named = NAMED

  it('signs, then reserves — the URL is withheld until the reservation lands', async () => {
    const res = await mintOk(named)
    expect(update).toHaveBeenCalledWith(SESSION, {
      audio_storage_path: OWN,
      status: 'UPLOADING',
    })
    expect(res.recordingSessionId).toBe(SESSION)
    expect(res.path).toBe(OWN)
    // Fix round 6 (I1): a transient SIGNING failure must not leave a written
    // row behind for the caller's retry to collide with, so signing now runs
    // BEFORE the write — the caller just never sees this URL until the write
    // (checked above) has actually landed.
    expect(createSignedUploadUrl.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    )
  })

  it('a RETRY of the same take writes nothing and audits nothing — still reports the claim', async () => {
    get.mockResolvedValue(row({ audio_storage_path: OWN, status: 'UPLOADING' }))
    // The PUT landed last time; storage says the object is there.
    info.mockResolvedValue({ data: { size: 2048 }, error: null })
    const res = await mintOk(named)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(res.recordingSessionId).toBe(SESSION)
    // Fix round 6 (I3): nothing was written, so nothing is audited — the
    // 'reserved: false' row for a call that changed nothing is gone.
    expect(auditFn).not.toHaveBeenCalled()
  })

  // FIX ROUND 7 (J2), STRUCTURAL. The mint used to CREATE the row when a
  // client-named take arrived without one. A lost response after that create
  // left the client holding no session id, so its only possible retry was a
  // second nameless mint — which core's unique key refuses (409 →
  // reserved_elsewhere, TERMINAL), stranding the take behind an orphan row it
  // could not name. Row minting has ONE home now: startRecordingSession.
  it('refuses a named take with NO session — bad_input, before any core or storage call', async () => {
    await expect(
      mintRecordingUploadUrl({ takeId: UUID, mimeType: 'audio/webm' }),
    ).resolves.toEqual({ error: 'bad_input' })
    expect(get).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expectNoBinding()
  })

  it('NEVER creates a row, on any path — one door mints, and it is not this one', async () => {
    await mintOk(named)
    await mintOk()
    expect(create).not.toHaveBeenCalled()
  })

  // H1 (round 5): the web door has no schema of its own — mintTakeUploadUrl is
  // the ONLY fence, so its first line must refuse what the facade's own parse
  // already refuses. Unparsed, this id rides into synqed.recordings.get()
  // unencoded (the SDK's `/recordings/${id}`), a request-forgery surface.
  it.each([
    ['a path-traversal recordingSessionId', '../staff'],
    ['a non-string recordingSessionId', 12345 as unknown as string],
    ['an oversized recordingSessionId', 'x'.repeat(201)],
  ])(
    'refuses %s — bad_input, before a single core or storage call',
    async (_label, recordingSessionId) => {
      await expect(
        mintRecordingUploadUrl({ ...named, recordingSessionId }),
      ).resolves.toEqual({ error: 'bad_input' })
      expect(get).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
      expectNoBinding()
    },
  )

  // H2: a session id with no take id is a row this mint would otherwise bind
  // to nothing and silently drop — never a no-op the caller cannot see.
  it('refuses a recordingSessionId with no takeId — bad_input, never silently ignored', async () => {
    await expect(
      mintRecordingUploadUrl({ recordingSessionId: SESSION }),
    ).resolves.toEqual({ error: 'bad_input' })
    expect(get).not.toHaveBeenCalled()
    expectNoBinding()
  })

  // H3: the core UNIQUE index is the belt (Anthony addendum) — two rows racing
  // to reserve the same key collapse to one winner, and the loser's 409 is a
  // real, terminal answer, never the catch-all 'upstream'. Fix round 6: this
  // race can only be discovered AT the write, which now runs after signing —
  // the sign already happened, and its URL is simply never returned.
  it('a core 409 racing to UPDATE the row — reserved_elsewhere, the already-signed URL discarded', async () => {
    update.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'reserved_elsewhere' })
    expect(createSignedUploadUrl).toHaveBeenCalled()
  })

  // ── THE ROUND-10 PROOF ────────────────────────────────────────────────────
  // The whole point of born-reserved: a row created by THIS app version already
  // holds its take's key, so the mint's UPDATE path — the last place two
  // client-named takes could race on one unbound row — is never reached at all.
  //
  // It runs BOTH doors against one fake core on purpose. Drop the reservation
  // from startRecordingSessionWithClient's create() and this test goes red: the
  // row comes back with a null pointer and the mint updates it.
  it('a session created for this take is BORN reserved — the mint writes nothing', async () => {
    // The core, honestly: create() keeps what it is given, get() returns it.
    create.mockImplementation(async (input: unknown) => row({ ...(input as object), id: SESSION }))
    get.mockImplementation(async () => create.mock.results[0].value as unknown as Row)

    const started = await startRecordingSession({
      customerId: 'cust-1',
      takeId: UUID,
      mimeType: 'audio/webm',
    })
    expect(started).toEqual({ id: SESSION })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ audio_storage_path: OWN, status: 'UPLOADING' }),
    )

    const res = await mintOk({ takeId: UUID, mimeType: 'audio/webm', recordingSessionId: SESSION })
    // ALREADY OURS: no second write to race, and no second receipt for one act.
    expect(update).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
    // …and the caller still gets everything it needs to upload.
    expect(res.path).toBe(OWN)
    expect(res.recordingSessionId).toBe(SESSION)
  })

  // The legacy path is KEPT, not deleted: rows minted before this round are
  // still unbound, and their mint must still reserve them the old way.
  it('a LEGACY unbound row still reserves through the update path', async () => {
    get.mockResolvedValue(row({ audio_storage_path: null }))
    const res = await mintOk(named)
    expect(update).toHaveBeenCalledWith(SESSION, { audio_storage_path: OWN, status: 'UPLOADING' })
    expect(res.recordingSessionId).toBe(SESSION)
    expect(auditFn).toHaveBeenCalledTimes(1)
  })

  // FIX ROUND 7 (J3). planReservation reads the row BEFORE the signing round
  // trip, and that is plenty of time for a concurrent mint on the same row to
  // reserve a different key. Writing from the stale read would silently
  // repoint the row and orphan the other take's object — so the commit
  // re-reads and re-asserts the pointer it planned against.
  it('a row repointed DURING the sign — reserved_elsewhere, nothing overwritten', async () => {
    get
      .mockResolvedValueOnce(row())
      .mockResolvedValue(row({ audio_storage_path: OTHER_KEY, status: 'UPLOADING' }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'reserved_elsewhere' })
    expect(update).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  // FIX ROUND 8 (M1). A concurrent in-flight mint of the SAME take can win the
  // write during THIS call's own signing round trip — the commit re-read then
  // finds the row already pointing at the exact key this call planned too. That
  // is not a collision, it is a duplicate mint of one take: ok, already ours,
  // nothing written twice. Only a DIFFERENT key (the test above) is a real one.
  it('a concurrent mint of the SAME take lands first — ok, already ours, nothing overwritten', async () => {
    get
      .mockResolvedValueOnce(row())
      .mockResolvedValue(row({ audio_storage_path: OWN, status: 'UPLOADING' }))
    const res = await mintOk(named)
    expect(res.recordingSessionId).toBe(SESSION)
    expect(update).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('a RETRY whose row moved on DURING the sign — reserved_elsewhere, never a false ok', async () => {
    get
      .mockResolvedValueOnce(row({ audio_storage_path: OWN, status: 'UPLOADING' }))
      .mockResolvedValue(row({ audio_storage_path: OTHER_KEY, status: 'UPLOADING' }))
    info.mockResolvedValue({ data: { size: 2048 }, error: null })
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'reserved_elsewhere' })
    expect(update).not.toHaveBeenCalled()
  })

  // FIX ROUND 9 (fresh-eyes #6, O4). A 'retry' plan means the pointer matched
  // this key AT PLAN TIME — but the signing round trip is real time, and a
  // concurrent cleanup (破棄) can CLEAR that pointer back to null before the
  // commit's re-read. Unlike the moved-on case above (a DIFFERENT key — a real
  // collision), a null pointer here is an OPEN reservation: the commit must
  // re-reserve it exactly like a fresh 'update' plan would, not refuse a take
  // whose own row is free to bind.
  it('a RETRY whose pointer was CLEARED during the sign — re-reserves rather than reserved_elsewhere', async () => {
    get
      .mockResolvedValueOnce(row({ audio_storage_path: OWN, status: 'UPLOADING' }))
      .mockResolvedValue(row({ audio_storage_path: null, status: 'RECORDING' }))
    info.mockResolvedValue({ data: { size: 2048 }, error: null })
    const res = await mintOk(named)
    expect(res.recordingSessionId).toBe(SESSION)
    expect(update).toHaveBeenCalledWith(SESSION, {
      audio_storage_path: OWN,
      status: 'UPLOADING',
    })
    expect(auditFn).toHaveBeenCalled()
  })

  it('a row DELETED during the sign — not_found, nothing written', async () => {
    get
      .mockResolvedValueOnce(row())
      .mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'not_found' })
    expect(update).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('refuses another staffer’s session — forbidden, nothing bound', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'forbidden' })
    expectNoBinding()
  })

  it('refuses another business’s session — forbidden, nothing bound', async () => {
    get.mockResolvedValue(row({ business_id: 'biz-2' }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'forbidden' })
    expectNoBinding()
  })

  it('lets an owner (recordings.viewAll) reserve on a colleague’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'recordings.viewAll']))
    const res = await mintOk(named)
    expect(res.recordingSessionId).toBe(SESSION)
    expect(update).toHaveBeenCalled()
  })

  it('refuses a row already bound to a DIFFERENT take — reserved_elsewhere', async () => {
    get.mockResolvedValue(row({ audio_storage_path: OTHER_KEY }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'reserved_elsewhere' })
    expectNoBinding()
  })

  // ⚖ PR4 RIDER — THE POINTER IS ASKED BEFORE STORAGE. `key` is composed from
  // the CLIENT's takeId, so probing it on a row that points somewhere else told
  // the caller whether an object they merely NAMED exists: an oracle over a
  // colleague's takes, reachable by anyone holding one row of their own. The
  // refusal is the same either way — `exists` and `reserved_elsewhere` are both
  // TERMINAL — so only the oracle was lost.
  it('⚖ a row bound elsewhere is refused WITHOUT asking storage — no existence oracle', async () => {
    get.mockResolvedValue(row({ audio_storage_path: OTHER_KEY }))
    // Storage would have said "yes, that object is there" — it is never asked.
    info.mockResolvedValue({ data: { size: 4096 }, error: null })
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'reserved_elsewhere' })
    expect(info).not.toHaveBeenCalled()
    expectNoBinding()
  })

  it('refuses a key whose object ALREADY EXISTS on a row that reserved nothing — exists', async () => {
    info.mockResolvedValue({ data: { size: 4096 }, error: null })
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'exists' })
    expectNoBinding()
  })

  it('fails CLOSED when storage cannot say whether the object exists', async () => {
    info.mockResolvedValue({ data: null, error: { message: 'boom', status: 500 } })
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'upstream' })
    expectNoBinding()
  })

  // ⚖ PR4 RIDER — NEVER THROWS (parity with finalizeTake). A rejected server
  // action reaches the recorder unnamed, and secureTake's catch marks the take
  // `failed`, which 要対応 reads as TERMINAL: one flaky identity read at stop
  // would strand a take whose retry would have worked. 'upstream' is this
  // union's one retryable code.
  it('⚖ an identity lookup that THROWS settles as upstream, never a rejection', async () => {
    getBusinessId.mockRejectedValue(new Error('roster read exploded'))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'upstream' })
    expectNoBinding()
  })

  it('refuses a session id core does not know — never binds a replacement', async () => {
    get.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'not_found' })
    expectNoBinding()
  })

  it('an unreadable session row is upstream — nothing bound, nothing signed', async () => {
    get.mockRejectedValue(Object.assign(new Error('core down'), { status: 503 }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'upstream' })
    expectNoBinding()
  })

  it.each(['PROCESSING', 'COMPLETED', 'FAILED'])(
    'reserves on a %s row with the POINTER ONLY — the job keeps its status',
    async (status) => {
      get.mockResolvedValue(row({ status }))
      await mintOk(named)
      expect(update).toHaveBeenCalledWith(SESSION, { audio_storage_path: OWN })
    },
  )

  it('refuses with no staff identity — nothing is attributable, nothing bound', async () => {
    getCurrentUserStaffId.mockResolvedValue(null)
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'forbidden' })
    expectNoBinding()
  })
})

// THE FENCE'S OWN PROOF: every key the composer can produce parses back as a
// TAKE of the same business. If this table ever fails, the mint is handing out
// keys the downstream fences would refuse — or worse, accept for someone else.
describe('composeTakeKey — the self-check, as a table', () => {
  const BUSINESSES = ['biz-1', BIZ_UUID, 'biz-1_with_underscores', 'biz.1-2']
  const MIMES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg', 'audio/wav']
  const rows = BUSINESSES.flatMap((b) => MIMES.map((m) => [b, m] as const))

  it.each(rows)('%s + %s composes a key that parses as kind take', (businessId, mimeType) => {
    const composed = composeTakeKey(businessId, UUID, mimeType)
    expect(composed).not.toBeNull()
    expect(parseRecordingKey(composed!.key, businessId)).toEqual({
      kind: 'take',
      takeId: UUID,
      ext: composed!.ext,
    })
    expect(isOwnRecordingKey(composed!.key, businessId)).toBe(true)
    // …and belongs to NOBODY else.
    expect(isOwnRecordingKey(composed!.key, 'other-biz')).toBe(false)
  })

  it('extFromMime is the closed map, and nothing else', () => {
    expect(extFromMime('audio/mp4')).toBe('mp4')
    expect(extFromMime('audio/mpeg')).toBeNull()
    expect(extFromMime(null)).toBeNull()
  })
})

describe('mintRecordingReadUrl — the tenant fence', () => {
  it('signs a path under the caller’s own prefix', async () => {
    await expect(mintRecordingReadUrl(OWN)).resolves.toEqual({
      url: `https://proj.supabase.co/read/${OWN}?token=r`,
    })
    expect(createSignedUrl).toHaveBeenCalledWith(OWN, 3600)
  })

  it.each(REFUSED)('refuses %s — service-role storage is never reached', async (_label, path) => {
    await expect(mintRecordingReadUrl(path)).rejects.toThrow(
      'recording not found in this business',
    )
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('refuses a string-shaped non-string before it calls a method on it', async () => {
    await expect(mintRecordingReadUrl(IMPOSTOR)).rejects.toThrow(
      'recording not found in this business',
    )
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('gates on records.write before the fence even runs', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(mintRecordingReadUrl(OWN)).rejects.toThrow('forbidden')
    // The fence's first act is asking who the caller is — never asked = never ran.
    expect(getBusinessId).not.toHaveBeenCalled()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})

// ⚖ THE DELETE ACTION IS GONE, NOT REFUSED (capture pipeline PR4). What used to
// live here was a whole suite proving removeRecordingObject's fence held —
// a client-invokable server action whose entire job was erasing a recording
// object by name. The fence is not the answer any more; not having the door is.
describe('removeRecordingObject is REMOVED', () => {
  it('the module exports no delete action', async () => {
    const mod = (await import('@/actions/recording-upload')) as Record<string, unknown>
    expect(Object.keys(mod).sort()).toEqual(['mintRecordingReadUrl', 'mintRecordingUploadUrl'])
  })

  it('and no CODE in the file reaches for a storage remove', () => {
    // Comment lines are stripped first: the header explains what was deleted
    // and why, and naming the door in prose is not the door.
    const code = readFileSync(join(process.cwd(), 'src/actions/recording-upload.ts'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    expect(code).not.toContain('.remove(')
    expect(code).not.toContain('removeRecordingObject')
  })
})

// The grammar itself (src/lib/recording/key-grammar.ts). The suites above prove
// the FENCES delegate to it; this proves what it answers — and above all that
// widening it to a second shape and four extensions widened no fence, because
// the fences ask for kind 'take' and a segment is not one.
describe('parseRecordingKey — two shapes, one grammar', () => {
  const EXTS = ['webm', 'mp4', 'ogg', 'wav'] as const

  it.each(EXTS)('reads a flat take as kind take (.%s)', (ext) => {
    expect(parseRecordingKey(`app_biz-1_${UUID}.${ext}`, 'biz-1')).toEqual({
      kind: 'take',
      takeId: UUID,
      ext,
    })
  })

  it.each(EXTS)('reads a nested segment as kind segment, seq numeric (.%s)', (ext) => {
    expect(parseRecordingKey(`seg/app_biz-1_${UUID}/000007.${ext}`, 'biz-1')).toEqual({
      kind: 'segment',
      takeId: UUID,
      seq: 7,
      ext,
    })
  })

  it.each([
    ['an unpadded seq', `seg/app_biz-1_${UUID}/7.webm`],
    ['an extension outside the closed set', `seg/app_biz-1_${UUID}/000007.exe`],
    ['another business’s segment', `seg/app_biz-2_${UUID}/000000.webm`],
    ['a doubled seg/ prefix', `seg/seg/app_biz-1_${UUID}/000000.webm`],
    ['a take folder with no seg/ prefix', `app_biz-1_${UUID}/000000.webm`],
    ['a traversal inside the take folder', `seg/app_biz-1_${UUID}/../../x.webm`],
    ['an empty extension', `app_biz-1_${UUID}.`],
    ['an uppercase uuid', `app_biz-1_${UUID.toUpperCase()}.webm`],
  ])('refuses %s', (_label, key) => {
    expect(parseRecordingKey(key, 'biz-1')).toBeNull()
  })

  it('refuses a string-shaped non-string before it calls a method on it', () => {
    expect(parseRecordingKey(IMPOSTOR, 'biz-1')).toBeNull()
  })

  it('isOwnRecordingKey means TAKE — a valid segment of this tenant’s own take is FALSE', () => {
    const segment = `seg/app_biz-1_${UUID}/000000.webm`
    expect(parseRecordingKey(segment, 'biz-1')).toMatchObject({ kind: 'segment' })
    expect(isOwnRecordingKey(segment, 'biz-1')).toBe(false)
    // The one widening that IS intended: iOS negotiates mp4, not webm.
    expect(isOwnRecordingKey(`app_biz-1_${UUID}.mp4`, 'biz-1')).toBe(true)
  })

  it('looksLikeRecordingKey reads the businessId back out of the name', () => {
    // /api/cleanup lists the bucket root with no tenant to compare against.
    expect(looksLikeRecordingKey(`app_biz-1_${UUID}.webm`)).toBe(true)
    // Tenant-blind by design: cleanup can't name the business a key belongs
    // to, so ANY businessId shape it can read back out counts — this is not
    // biz-1's bucket, and the check still says true.
    expect(looksLikeRecordingKey(`app_other-biz_${UUID}.webm`)).toBe(true)
    expect(looksLikeRecordingKey(`orphan-${UUID}.webm`)).toBe(false)
    expect(looksLikeRecordingKey('seg')).toBe(false)
    expect(looksLikeRecordingKey(IMPOSTOR)).toBe(false)
    // A derived businessId that reopens the tenant prefix (a traversal body,
    // a folder-shaped id) must not read as this shape just because the rest
    // re-parses — a real businessId never contains '/'.
    expect(looksLikeRecordingKey(`app_../../evil_${UUID}.webm`)).toBe(false)
    expect(looksLikeRecordingKey(`app_a/b_${UUID}.webm`)).toBe(false)
  })
})
