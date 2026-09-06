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
import { fakeCreateSignedUploadUrl, OBJECT_NOT_FOUND } from './helpers/storage-fakes'
const can = jest.fn(async (_c: string) => true)
const requireCapability = jest.fn(async (_c: string) => {})
const getMyCapabilities = jest.fn(async () => new Set<string>(['records.write']))
jest.mock('@/lib/auth/require-permission', () => ({
  can: (c: string) => can(c),
  requireCapability: (c: string) => requireCapability(c),
  getMyCapabilities: () => getMyCapabilities(),
}))
const resolveStoreScope = jest.fn(async () => ({ storeId: 'store-9' as string | null }))
// ③ …and the ACT REACH it now does resolve, but ONLY when the caller holds the
// owner's pair. Default null = unrestricted (`stores.viewAll` or floating
// staff) — the shape every case below already assumed.
const viewerScopeForActs = jest.fn(async (): Promise<readonly string[] | null> => null)
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScope(),
  viewerScopeForActs: () => viewerScopeForActs(),
}))
// A jest.fn, not a bare async literal: the capability gate must run BEFORE the
// tenant fence, and "the fence never asked who the caller is" is the only
// evidence of that ordering (storage-not-reached also holds if the gate is last).
const getBusinessId = jest.fn(async () => 'biz-1')
const getCurrentUserStaffId = jest.fn(async (): Promise<string | null> => 'staff-1')
const getCurrentAccessToken = jest.fn(async () => 'web-cookie-token')
jest.mock('@/lib/staff', () => ({
  getBusinessId: () => getBusinessId(),
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
  getCurrentAccessToken: () => getCurrentAccessToken(),
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
  /** ③ The store the device was in. Null is the PRODUCTION shape for every row
   *  minted before ③ and can never be filled afterwards, so it is the default;
   *  only the store-leg cases set it. */
  store_id: string | null
}
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const row = (over: Partial<Row> = {}): Row => ({
  id: SESSION,
  business_id: 'biz-1',
  staff_id: 'staff-1',
  status: 'RECORDING',
  audio_storage_path: null,
  duration_seconds: null,
  store_id: null,
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
const notFoundError = { ...OBJECT_NOT_FOUND }
const info = jest.fn(
  async (
    _key: string,
  ): Promise<{
    data: { size?: number } | null
    // `status` matters: storage saying "no such object" and storage failing to
    // ANSWER are different facts, and only the first frees the key.
    error: { message: string; status?: number; statusCode?: string } | null
  }> => ({ data: null, error: notFoundError }),
)
/** What the fake bucket HOLDS — the store `info` above answers for, and the
 *  one thing a non-upsert sign may never be given (helpers/storage-fakes.ts). */
const held = new Set<string>()
const uploadUrl = (p: string) => `https://proj.supabase.co/upload/${p}?token=t`
const createSignedUploadUrl = jest.fn(fakeCreateSignedUploadUrl(held, uploadUrl))
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

import {
  mintRecordingUploadUrl,
  mintRecordingReadUrl,
  mintRecordingSegmentUrls,
} from '@/actions/recording-upload'
import { startRecordingSession } from '@/actions/recordings'
import {
  parseRecordingKey,
  isOwnRecordingKey,
  isOwnAudioKey,
  isStagedKeyFor,
  looksLikeRecordingKey,
  parseSegmentFolder,
  composeTakeKey,
  composeSegmentKey,
  composeStagedKey,
  composeRescueKey,
  composeTakeKeyFromExt,
  composeRescueKeyFromExt,
  extFromMime,
  MIME_TO_EXT,
} from '@/lib/recording/key-grammar'
import { AUDITED_CORES } from '@/lib/audit-policy'
import type { MintTakeUrlInput, MintTakeUrlResult } from '@/lib/recording/mint-take-url'

/** The SIGNED success arm. The door's success side is two arms since fix round
 *  2 — the other is "the object is already there, here is its size", which
 *  signs nothing — so this extracts by `url`, the field only the signed one
 *  has. (`{ path: string }` would match both, and every `.url` read below would
 *  stop compiling for the right reason.) */
type MintedUrl = Extract<MintTakeUrlResult, { url: string }>
/** …and its twin: the arm that says the key is already taken. */
type MintedExisting = Extract<MintTakeUrlResult, { existingSize: number | null }>

/** The mint answers with a result UNION now (fix round 4). Every test that is
 *  about a SUCCESSFUL mint says so here, so a refusal can never read as a pass
 *  with undefined fields — and since fix round 2 that includes the OTHER
 *  success arm: a caller expecting a signed url must not silently pass on the
 *  answer that signs nothing. */
async function mintOk(input?: MintTakeUrlInput): Promise<MintedUrl> {
  const res = await mintRecordingUploadUrl(input)
  if ('error' in res) throw new Error(`expected a minted url, got ${res.error}`)
  if (!('url' in res)) throw new Error('expected a SIGNED url, got the already-there answer')
  return res
}

/** …and its twin, for the tests that are about the already-there answer. */
async function mintExisting(input?: MintTakeUrlInput): Promise<MintedExisting> {
  const res = await mintRecordingUploadUrl(input)
  if ('error' in res) throw new Error(`expected an existing-copy answer, got ${res.error}`)
  if (!('existingSize' in res)) throw new Error('expected the already-there answer, got a signed url')
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
/** A second uuid, so the two halves of a STAGED key can never be confused for
 *  each other in an assertion. It is SESSION's value — the row fixture's id. */
const SESSION_UUID = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
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
  // ⚖ …and its own RESCUE (Liam 2026-09-06, "b"). The assembler's side copy is
  // this tenant's object and parses as one, and no CLIENT-NAMED door may accept
  // it: the only paths that reach a `rsc/` key are server-derived.
  ['this business’s own rescue', `rsc/app_biz-1_${UUID}.webm`],
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
  viewerScopeForActs.mockImplementation(async () => null)
  getBusinessId.mockImplementation(async () => 'biz-1')
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  info.mockImplementation(async (key: string) =>
    held.has(key)
      ? { data: { size: 2048 }, error: null }
      : { data: null, error: { ...OBJECT_NOT_FOUND } },
  )
  held.clear()
  get.mockResolvedValue(row())
  create.mockResolvedValue(row({ id: 'sess-new' }))
  update.mockImplementation(async (id: string) => row({ id }))
  createSignedUploadUrl.mockImplementation(fakeCreateSignedUploadUrl(held, uploadUrl))
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

  // HOTFIX 2026-09-05: this retry now takes the ALREADY-THERE arm. The object
  // is at this row's own reserved key, and a non-upsert sign would be refused
  // by storage — so the door answers the size instead of a URL. Everything the
  // case was named for is unchanged: nothing written, nothing audited, the
  // claim still reported. (The signed retry — the PUT that never landed — is
  // the case below, and the whole-arm proof is mint-take-already-there.test.ts.)
  it('a RETRY of the same take writes nothing and audits nothing — still reports the claim', async () => {
    get.mockResolvedValue(row({ audio_storage_path: OWN, status: 'UPLOADING' }))
    // The PUT landed last time; storage says the object is there.
    info.mockResolvedValue({ data: { size: 2048 }, error: null })
    held.add(OWN)
    const res = await mintExisting(named)
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
    // The object has NOT landed yet, so this retry still SIGNS — which is what
    // opens the plan-to-commit window this case is about (hotfix 2026-09-05: a
    // retry whose object IS there takes the already-there exit before signing).
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
    // Same as the case above: the object is not there yet, so this retry signs
    // and reaches the commit whose re-read is what this case is about.
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

  it('lets the OWNER’S HAND (both keys) reserve on a colleague’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'business.manage', 'recordings.viewAll']))
    const res = await mintOk(named)
    expect(res.recordingSessionId).toBe(SESSION)
    expect(update).toHaveBeenCalled()
  })

  // ── ⚖ THE STORE LEG (slice three ③) ─────────────────────────────────────
  // The owner's hand now stops at the stores that person can see. The ONLY
  // person this changes is a CLAMPED pair-holder — a branch manager the owner
  // hand-granted both keys — and only on a colleague's row that carries a
  // store, which means a row minted since ③.
  describe('a clamped pair-holder', () => {
    const bothKeys = () =>
      getMyCapabilities.mockResolvedValue(
        new Set(['records.write', 'business.manage', 'recordings.viewAll']),
      )

    it('is refused a colleague’s take STAMPED with another store — nothing bound', async () => {
      bothKeys()
      viewerScopeForActs.mockResolvedValue(['store-a'])
      get.mockResolvedValue(row({ staff_id: 'staff-2', store_id: 'store-9' }))
      await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'forbidden' })
      expectNoBinding()
    })

    it('…and still reserves on a colleague’s PRE-③ row, which carries no store', async () => {
      bothKeys()
      viewerScopeForActs.mockResolvedValue(['store-a'])
      get.mockResolvedValue(row({ staff_id: 'staff-2', store_id: null }))
      const res = await mintOk(named)
      expect(res.recordingSessionId).toBe(SESSION)
      expect(update).toHaveBeenCalled()
    })

    it('…and on a row stamped with a store she IS assigned to', async () => {
      bothKeys()
      viewerScopeForActs.mockResolvedValue(['store-a'])
      get.mockResolvedValue(row({ staff_id: 'staff-2', store_id: 'store-a' }))
      const res = await mintOk(named)
      expect(res.recordingSessionId).toBe(SESSION)
    })

    it('a DEGRADED scope ([]) fails closed on a STAMPED row', async () => {
      bothKeys()
      viewerScopeForActs.mockResolvedValue([])
      get.mockResolvedValue(row({ staff_id: 'staff-2', store_id: 'store-9' }))
      await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'forbidden' })
      expectNoBinding()
    })

    it('the RECORDER never pays for it — her own take, and the scope is never read', async () => {
      viewerScopeForActs.mockResolvedValue([])
      get.mockResolvedValue(row({ staff_id: 'staff-1', store_id: 'store-9' }))
      const res = await mintOk(named)
      expect(res.recordingSessionId).toBe(SESSION)
      expect(viewerScopeForActs).not.toHaveBeenCalled()
    })
  })

  // ⚖ THE NAMED GRANTEE TWIN (9/3 council; Greptile #848 point 1). The grant is
  // a READ grant: a person the owner ticked for 全スタッフの録音 may HEAR and
  // READ a colleague's recording, and reserving a take on that colleague's
  // session is an ACT. Refused exactly like any other non-owner — same error,
  // nothing bound.
  it('…but a NAMED GRANTEE (recordings.viewAll alone) is refused — the grant is read-only', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'recordings.viewAll']))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'forbidden' })
    expectNoBinding()
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

// ⚖ A STAGED COPY IS NAMED FOR ITS SESSION (capture pipeline PR4 fix round 7).
// The discard's word-collection stages the blob of a take that can never be
// sealed under a finalized key, and that copy is the only object in this bucket
// with no row of its own. Before this round it was also ANONYMOUS, so the
// transcribe door had nothing to check a claim against: any records.write
// holder could name a COLLEAGUE'S finished take and have its words written onto
// an unrelated discarded session. The key now carries the session, and this is
// where that binding is made.
describe('mintRecordingUploadUrl({ stagedFor }) — the staged copy names its session', () => {
  it('composes a staged key for the caller’s own session, and reserves NOTHING', async () => {
    const res = await mintOk({ stagedFor: SESSION })
    expect(parseRecordingKey(res.path, 'biz-1')).toEqual({
      kind: 'staged',
      recordingSessionId: SESSION,
      ext: 'webm',
    })
    expect(isStagedKeyFor(res.path, 'biz-1', SESSION)).toBe(true)
    // The reply names the row it is bound to — the client sends it back as the
    // claim, and the server checks the key against it.
    expect(res.recordingSessionId).toBe(SESSION)
    expect(createSignedUploadUrl).toHaveBeenCalledWith(res.path)
    // ROW-LESS BY DESIGN: the row is READ to prove the caller may record onto
    // it, and nothing else happens — no reservation, no status, no audit row.
    expect(get).toHaveBeenCalledWith(SESSION)
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
    // ⚖ …BUT THE KEY IS PROBED (fix round 2). "A staged key is a fresh uuid
    // nobody can have" stopped being true the moment packet B made the slot the
    // TAKE: the key is composable in advance, so the door has to look before it
    // signs. One `info()` read, the same probe the take mint's own fence uses.
    expect(info).toHaveBeenCalledWith(res.path)
  })

  it('refuses a COLLEAGUE’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    await expect(mintRecordingUploadUrl({ stagedFor: SESSION })).resolves.toEqual({
      error: 'forbidden',
    })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // ⚖ AND VIEW-ALL DOES NOT REACH THIS DOOR (slice five fix round 4, G2). This
  // case used to assert the OPPOSITE — "an owner may stage on one, exactly as
  // they may reserve" — on the symmetry with the take mint. The symmetry is
  // false: reserving a colleague's take is a designed owner act, but STAGING is
  // something the recorder's own device does (the discard word-collection reads
  // the owner-gated take store; nothing else in the app stages at all). So
  // view-all bought no legitimate reach and did buy a lever: the staged key is
  // deterministic and immutable, so an owner could mint a colleague's key
  // first, PUT anything, and that colleague's device would meet a size mismatch
  // for ever — its discard's words never landing, its device copy never
  // releasable.
  it('…and NOT even with the OWNER’S OWN KEYS — staging is the recorder’s alone', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'business.manage', 'recordings.viewAll']))
    await expect(mintRecordingUploadUrl({ stagedFor: SESSION })).resolves.toEqual({
      error: 'forbidden',
    })
    // Nothing probed and nothing signed: the refusal lands before the key is
    // even composed, so the door is not an existence oracle over it either.
    expect(info).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // ⚠ THE HALF THE OWN-STAFF RULE DOES NOT COVER (③ fix round 1, L2 F3). The
  // line below the shared predicate refuses a colleague, so a mutant that
  // DELETED assertRecorderOwnsRow here would still refuse one — and silently
  // take the ROW-LEVEL TENANT fence with it. Belt (the client is already
  // business-scoped), but the take mint has this pin and its two siblings did
  // not.
  it('refuses a session row belonging to another business — the tenant half, not the staff half', async () => {
    get.mockResolvedValue(row({ business_id: 'biz-2', staff_id: 'staff-1' }))
    await expect(mintRecordingUploadUrl({ stagedFor: SESSION })).resolves.toEqual({
      error: 'forbidden',
    })
    expect(info).not.toHaveBeenCalled()
    expectNoBinding()
  })

  it('…while the take mint KEEPS its owner reach — the two doors differ on purpose', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2', audio_storage_path: null }))
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'business.manage', 'recordings.viewAll']))
    const res = await mintOk(NAMED)
    expect(res.path).toBe(OWN)
  })

  it('a session core does not know is not_found — nothing is signed for it', async () => {
    get.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    await expect(mintRecordingUploadUrl({ stagedFor: SESSION })).resolves.toEqual({
      error: 'not_found',
    })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('no acting staff identity: forbidden, and core is never even asked', async () => {
    getCurrentUserStaffId.mockResolvedValue(null)
    await expect(mintRecordingUploadUrl({ stagedFor: SESSION })).resolves.toEqual({
      error: 'forbidden',
    })
    expect(get).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('a take id and a stagedFor together are bad_input — one act, never two', async () => {
    // The schema's own rule, cashed at the first line of the shared core: a
    // staged copy is not a take, so a body claiming to be both is refused
    // before anything is read.
    await expect(
      mintRecordingUploadUrl({ ...NAMED, stagedFor: SESSION }),
    ).resolves.toEqual({ error: 'bad_input' })
    expect(get).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('a session id that is not a uuid never reaches core', async () => {
    await expect(mintRecordingUploadUrl({ stagedFor: 'sess-1' })).resolves.toEqual({
      error: 'bad_input',
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('a storage failure answers upstream, never a half-made URL', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null as never, error: { message: 'boom' } })
    await expect(mintRecordingUploadUrl({ stagedFor: SESSION })).resolves.toEqual({
      error: 'upstream',
    })
  })

  // ⚖ AND IT NAMES ITS TAKE (slice five packet B, D10). A staged copy is the
  // only object in this bucket with no row of its own, and until this round its
  // uuid slot was a fresh SERVER uuid — unique, and nameless: nothing outside
  // the device that PUT it could say which object was a given take's copy. With
  // the take in the slot the whole key is composable from the core row alone
  // (session = the row id, take + ext = the row's own reserved pointer), which
  // is the identity D10 buys with no new registry, message key or audit action.
  describe('…and the uuid slot is the TAKE', () => {
    it('the slot IS the take id — and the copy is still a well-formed staged key', async () => {
      const res = await mintOk({ stagedFor: SESSION, stagedTake: UUID })
      expect(res.path).toBe(`stg/biz-1_${SESSION}_${UUID}.webm`)
      expect(parseRecordingKey(res.path, 'biz-1')).toEqual({
        kind: 'staged',
        recordingSessionId: SESSION,
        ext: 'webm',
      })
      expect(isStagedKeyFor(res.path, 'biz-1', SESSION)).toBe(true)
    })

    // The WHOLE point: two stagings of one take compose ONE key, so the second
    // PUT meets the first copy and storage refuses it (409 = already there,
    // ⚖ V2.1) instead of minting a second object nothing can find.
    it('twice for the same take is the SAME key — the copy is immutable, like a take', async () => {
      const a = await mintOk({ stagedFor: SESSION, stagedTake: UUID })
      const b = await mintOk({ stagedFor: SESSION, stagedTake: UUID })
      expect(a.path).toBe(b.path)
    })

    // The no_uuid cohort — a device whose browser has no crypto.randomUUID, so
    // it never named its take. The server names the slot exactly as it did
    // before this round, and that copy stays unfindable: the named ceiling.
    it('no stagedTake keeps the server’s own random slot — two mints differ', async () => {
      const a = await mintOk({ stagedFor: SESSION })
      const b = await mintOk({ stagedFor: SESSION })
      expect(a.path).not.toBe(b.path)
      expect(isStagedKeyFor(a.path, 'biz-1', SESSION)).toBe(true)
    })

    it('the container is the TAKE’s — an iOS copy is .mp4, PUT as audio/mp4', async () => {
      const res = await mintOk({
        stagedFor: SESSION,
        stagedTake: UUID,
        mimeType: 'audio/mp4',
      })
      expect(res.path).toBe(`stg/biz-1_${SESSION}_${UUID}.mp4`)
      expect(res.contentType).toBe('audio/mp4')
    })

    // ⚖ THE no_uuid COHORT CAN STAGE AGAIN (slice five fix round 3, F3). Typing
    // the field `.uuid()` refused the ONE cohort composeStagedKey's random-slot
    // fallback exists for: a browser with no crypto.randomUUID names its take
    // `${Date.now()}-…`, so the mint 400'd before the server could fall back.
    // Such a take is born `no_uuid` — TERMINAL, so unsecurable from birth,
    // which is EXACTLY the cohort the discard sweep stages — and its words were
    // therefore never collectable at all, on every mount, for its seven days.
    // The field is a bounded string now; the server decides the shape.
    it('a stagedTake that is not a uuid still stages — the server names the slot', async () => {
      const res = await mintOk({ stagedFor: SESSION, stagedTake: `${Date.now()}-k3n9x` })
      expect(isStagedKeyFor(res.path, 'biz-1', SESSION)).toBe(true)
      // A FRESH uuid, not the composed id — the copy is unfindable, which is
      // D10's named ceiling for this cohort, and unfindable beats uncollected.
      expect(res.path).toMatch(
        new RegExp(`^stg/biz-1_${SESSION}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webm$`),
      )
    })

    // ⚖ THE ROW NAMES THE SLOT, NOT THE CALLER (slice five fix round 3, F4).
    // The staged branch fenced the SESSION and nothing else, so `stagedTake`
    // went into the key on a shape check alone: a recordings.viewAll holder
    // could read a colleague's row, learn both halves of the identity D10 made
    // composable, and PUT bytes at that take's staged key before the device
    // ever staged it. No audio is lost (the size fence refuses those bytes) —
    // but the key is immutable, so the take could never be staged, its
    // discard's words never collected, and it never became releasable. The row
    // already knows the answer: its own reserved pointer.
    describe('…and when the ROW already names a take, that take is the slot', () => {
      /** A second take id that is a uuid by BOTH readings — zod's strict
       *  version/variant check and the key grammar's plain hex. `OTHER_UUID`
       *  above is only the latter (its version nibble is `c`), so using it here
       *  would have made these cases pass on the base for the wrong reason. */
      const SECOND_TAKE = '1b2c3d4e-5f60-4a71-8b9c-0d1e2f3a4b5c'

      it('a stagedTake disagreeing with the row’s own pointer is bad_input', async () => {
        get.mockResolvedValue(row({ audio_storage_path: OWN }))
        await expect(
          mintRecordingUploadUrl({ stagedFor: SESSION, stagedTake: SECOND_TAKE }),
        ).resolves.toEqual({ error: 'bad_input' })
        expect(createSignedUploadUrl).not.toHaveBeenCalled()
      })

      it('a stagedTake that AGREES with it composes that take’s key', async () => {
        get.mockResolvedValue(row({ audio_storage_path: OWN }))
        const res = await mintOk({ stagedFor: SESSION, stagedTake: UUID })
        expect(res.path).toBe(`stg/biz-1_${SESSION}_${UUID}.webm`)
      })

      it('…and so does sending no stagedTake at all — the reservation is the truth', async () => {
        get.mockResolvedValue(row({ audio_storage_path: OWN }))
        const res = await mintOk({ stagedFor: SESSION })
        expect(res.path).toBe(`stg/biz-1_${SESSION}_${UUID}.webm`)
      })

      // A row whose pointer is not a TAKE has nothing to outrank the caller
      // with — a legacy unbound row, or the row of a no_uuid take that could
      // never reserve one. The client's slot stands, exactly as it did before
      // this round (green on the base too: this half is a pin, not a fix).
      it('a row with no take pointer leaves the caller’s uuid slot standing', async () => {
        get.mockResolvedValue(row({ audio_storage_path: null }))
        const res = await mintOk({ stagedFor: SESSION, stagedTake: SECOND_TAKE })
        expect(res.path).toBe(`stg/biz-1_${SESSION}_${SECOND_TAKE}.webm`)
      })
    })

    it('a stagedTake with NO stagedFor names an act this door does not have', async () => {
      await expect(mintRecordingUploadUrl({ stagedTake: UUID })).resolves.toEqual({
        error: 'bad_input',
      })
      expect(get).not.toHaveBeenCalled()
      expect(createSignedUploadUrl).not.toHaveBeenCalled()
    })

    // The pair rule widened by exactly one clause, so the shapes either side of
    // it have to stay where they were: a bare mimeType still names nothing.
    it('a bare mimeType is still refused — it belongs to a takeId or a stagedFor', async () => {
      await expect(mintRecordingUploadUrl({ mimeType: 'audio/mp4' })).resolves.toEqual({
        error: 'bad_input',
      })
    })

    it('…and stagedFor + takeId is still one act pretending to be two', async () => {
      await expect(
        mintRecordingUploadUrl({ ...NAMED, stagedFor: SESSION, stagedTake: UUID }),
      ).resolves.toEqual({ error: 'bad_input' })
      expect(get).not.toHaveBeenCalled()
    })
  })

  // ⚖ THE DOOR ANSWERS EXISTENCE, AND SIGNS NOTHING OVER IT (fix round 2). The
  // three pieces packet B shipped made one hole together: the key is composable
  // in advance, a PUT meeting an object was read as SUCCESS, and D11 then let
  // the device release its own audio. So a records.write holder could put any
  // bytes at their OWN discarded session's staged key first and have the device
  // adopt them — erasing a recording through a staffer action, which ⚖ 9/3
  // forbids outright. The fix is here: the object is looked up BEFORE the sign,
  // and the caller is told its SIZE instead of being handed a way to write.
  describe('…and an object already at that key is answered, never signed over', () => {
    it('an existing object: NO signing call, and the size comes back', async () => {
      info.mockResolvedValue({ data: { size: 4096 }, error: null })
      const res = await mintExisting({ stagedFor: SESSION, stagedTake: UUID })
      expect(res.path).toBe(`stg/biz-1_${SESSION}_${UUID}.webm`)
      expect(res.existingSize).toBe(4096)
      expect(res.recordingSessionId).toBe(SESSION)
      expect(res.contentType).toBe('audio/webm')
      // Nothing to write with — not an empty string, ABSENT.
      expect('url' in res).toBe(false)
      expect('token' in res).toBe(false)
      expect(createSignedUploadUrl).not.toHaveBeenCalled()
      expectNoBinding()
    })

    it('storage answering without a size says so — null, never a guess', async () => {
      info.mockResolvedValue({ data: {}, error: null })
      const res = await mintExisting({ stagedFor: SESSION, stagedTake: UUID })
      expect(res.existingSize).toBeNull()
      expect(createSignedUploadUrl).not.toHaveBeenCalled()
    })

    it('an absent object is signed exactly as before', async () => {
      const res = await mintOk({ stagedFor: SESSION, stagedTake: UUID })
      expect(res.url).toBeTruthy()
      expect(createSignedUploadUrl).toHaveBeenCalledWith(res.path)
    })

    // Storage failing to ANSWER is not "the key is free": signing over it is
    // exactly the act that could hand a caller somebody else's key.
    it('storage that does not answer is upstream — retryable, and nothing signed', async () => {
      info.mockResolvedValue({ data: null, error: { message: 'boom', status: 500 } })
      await expect(
        mintRecordingUploadUrl({ stagedFor: SESSION, stagedTake: UUID }),
      ).resolves.toEqual({ error: 'upstream' })
      expect(createSignedUploadUrl).not.toHaveBeenCalled()
    })

    // The fences still come FIRST: an unauthorized caller never learns whether
    // a key exists, exactly as the take mint's own ordering guarantees.
    it('a COLLEAGUE’s session is refused before the bucket is touched', async () => {
      get.mockResolvedValue(row({ staff_id: 'staff-2' }))
      info.mockResolvedValue({ data: { size: 4096 }, error: null })
      await expect(
        mintRecordingUploadUrl({ stagedFor: SESSION, stagedTake: UUID }),
      ).resolves.toEqual({ error: 'forbidden' })
      expect(info).not.toHaveBeenCalled()
      expect(createSignedUploadUrl).not.toHaveBeenCalled()
    })
  })
})

// The composed key for a take that was finalized before the key was stamped —
// a pure composition, and the ONE door that answers it (fix round 7, J2).
// ⚖ THE THIRD ACT (slice five packet C, C2). Segments are the bytes that reach
// the server WHILE the recording is running. This door signs keys under a take's
// own folder and does nothing else: no reservation, no core write, no audit row
// — and the fence that stands in for the reservation it does not make is the
// row's OWN pointer, which must already be this take's key.
describe('mintRecordingSegmentUrls — the segment door reserves NOTHING and fences on the pointer', () => {
  const SEGS = { ...NAMED, seqs: [0, 1, 2] }
  const segKey = (seq: number, ext = 'webm') =>
    `seg/app_biz-1_${UUID}/${String(seq).padStart(6, '0')}.${ext}`

  /** The state the segment door needs: the row has ALREADY reserved this take's
   *  key (which is what startRecordingSession's born-reserved create does, and
   *  what the whole-take mint meets as "already ours"). */
  const reserved = () => get.mockResolvedValue(row({ audio_storage_path: OWN }))

  async function segmentsOk(input: MintTakeUrlInput = SEGS) {
    const res = await mintRecordingSegmentUrls(input)
    if ('error' in res) throw new Error(`expected minted segments, got ${res.error}`)
    return res
  }

  it('signs one key per seq, under this take’s folder, in the order asked', async () => {
    reserved()
    const res = await segmentsOk()
    expect(res.recordingSessionId).toBe(SESSION)
    expect(res.segments.map((s) => s.seq)).toEqual([0, 1, 2])
    expect(res.segments.map((s) => s.path)).toEqual([segKey(0), segKey(1), segKey(2)])
    for (const s of res.segments) {
      expect(s.contentType).toBe('audio/webm')
      expect('url' in s && s.url).toBe(`https://proj.supabase.co/upload/${s.path}?token=t`)
    }
    // Signed with NO options, exactly as the take mint signs (fix round 3): a
    // segment key is immutable evidence too, so upsert here would let one
    // caller overwrite a fragment somebody else recorded.
    expect(createSignedUploadUrl.mock.calls).toEqual([[segKey(0)], [segKey(1)], [segKey(2)]])
  })

  // The whole shape of this door in one assertion: it can only ADD objects.
  it('reserves nothing, writes nothing, audits nothing', async () => {
    reserved()
    await segmentsOk()
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
    expect(removeObj).not.toHaveBeenCalled()
  })

  it('the container decides the extension AND the content type, on every seq', async () => {
    // The fence compares against the key composed from THIS body's container,
    // so an mp4 take is fenced on its own `.mp4` pointer — which is exactly the
    // key startRecordingSession reserved for it.
    get.mockResolvedValue(row({ audio_storage_path: `app_biz-1_${UUID}.mp4` }))
    const res = await segmentsOk({ ...SEGS, mimeType: 'audio/mp4;codecs=mp4a.40.2' })
    expect(res.segments.map((s) => s.path)).toEqual([segKey(0, 'mp4'), segKey(1, 'mp4'), segKey(2, 'mp4')])
    expect(res.segments.every((s) => s.contentType === 'audio/mp4')).toBe(true)
  })

  // ⚖ THE FENCE. A row bound to ANOTHER take is not this take's row, and
  // signing segments under this take's folder against it would put one take's
  // fragments where another's belong.
  it('a row pointing at ANOTHER take → not_reserved, and nothing is signed', async () => {
    get.mockResolvedValue(row({ audio_storage_path: OTHER_KEY }))
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'not_reserved' })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  // …and an UNBOUND row is the whole-take mint's job at stop, never this one's:
  // this door must not be the thing that binds a take.
  it('a row that has reserved NOTHING → not_reserved too', async () => {
    get.mockResolvedValue(row({ audio_storage_path: null }))
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'not_reserved' })
    expectNoBinding()
  })

  it('another staffer’s session → forbidden, before the pointer is even read', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2', audio_storage_path: OWN }))
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'forbidden' })
    expectNoBinding()
  })

  // ⚖ AND NOT EVEN WITH recordings.viewAll — SENDING SEGMENTS IS THE RECORDER'S
  // ALONE (fix round 1, K1: the staged door's own line, for the staged door's
  // own reason). Owner reach is right on the TAKE mint — reserving a
  // colleague's take is a designed act there, and finalize re-proves ownership
  // and byte length behind it — and buys this door nothing: the pump runs on
  // the recording device, off the owner-gated take store, and is the only
  // caller. What it bought instead was a lever. A segment key is composable in
  // advance, and both halves of it (the take id, the container) are readable
  // off the colleague's own row by exactly this capability, so an owner could
  // mint a seq the device had not reached yet and PUT anything into it: the key
  // is immutable, so the real device could never write that seq; its next pump
  // would meet a length that is not its own and go terminally quiet for the
  // rest of the take; and the folder an assembler will one day build from would
  // hold bytes nobody recorded. The take is never lost by it — the whole-take
  // secure at stop is independent — but the new guarantee is.
  it('…and NOT even with the OWNER’S OWN KEYS — the segments are the recorder’s alone', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2', audio_storage_path: OWN }))
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'business.manage', 'recordings.viewAll']))
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'forbidden' })
    // Nothing probed and nothing signed: the refusal lands before a single key
    // is asked about, so the door is not an existence oracle over the folder
    // either. (The take mint KEEPS its owner reach — pinned by its own case,
    // "…while the take mint KEEPS its owner reach", above.)
    expect(info).not.toHaveBeenCalled()
    expectNoBinding()
  })

  // ⚠ THE HALF THE OWN-STAFF RULE DOES NOT COVER (③ fix round 1, L2 F3) — the
  // staged door's twin, for the same reason: delete assertRecorderOwnsRow here
  // and the line below it still refuses a colleague, so nothing would notice
  // that the ROW-LEVEL TENANT fence went with it.
  it('refuses a session row belonging to another business — the tenant half, not the staff half', async () => {
    get.mockResolvedValue(row({ business_id: 'biz-2', staff_id: 'staff-1', audio_storage_path: OWN }))
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'forbidden' })
    expect(info).not.toHaveBeenCalled()
    expectNoBinding()
  })

  // ③ FIX ROUND 1 (L2 F1/F2): this door resolves NO store reach, even for a
  // pair-holder. It cannot use one — the own-staff rule two lines below the
  // shared predicate refuses every non-own row regardless — and reading it
  // would be a core round trip per segment batch on the live-recording hot
  // path. Put the resolve back and this goes red.
  it('never reads the act scope — not even for the owner’s hand, on the recording hot path', async () => {
    reserved()
    getMyCapabilities.mockResolvedValue(
      new Set(['records.write', 'business.manage', 'recordings.viewAll']),
    )
    await segmentsOk()
    expect(viewerScopeForActs).not.toHaveBeenCalled()
  })

  it('…while the recorder themselves is unchanged — same capability, own row', async () => {
    reserved()
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'recordings.viewAll']))
    const res = await segmentsOk()
    expect(res.segments.map((s) => s.path)).toEqual([segKey(0), segKey(1), segKey(2)])
  })

  it('no acting staff identity → forbidden, and core is never read', async () => {
    getCurrentUserStaffId.mockResolvedValue(null)
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'forbidden' })
    expect(get).not.toHaveBeenCalled()
    expectNoBinding()
  })

  it('a session id core does not know → not_found', async () => {
    get.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'not_found' })
    expectNoBinding()
  })

  it('core failing to answer → upstream, retryable, nothing signed', async () => {
    get.mockRejectedValue(new Error('socket'))
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'upstream' })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('gates on records.write before anything — a denial settles, never throws', async () => {
    can.mockResolvedValue(false)
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'forbidden' })
    expect(get).not.toHaveBeenCalled()
  })

  it.each([
    ['61 seqs — past the batch cap', { ...NAMED, seqs: Array.from({ length: 61 }, (_, i) => i) }],
    ['a duplicate seq', { ...NAMED, seqs: [0, 1, 1] }],
    ['an empty list', { ...NAMED, seqs: [] }],
    ['a seq past the six-digit pad', { ...NAMED, seqs: [1_000_000] }],
    ['a negative seq', { ...NAMED, seqs: [-1] }],
    ['a fractional seq', { ...NAMED, seqs: [1.5] }],
    ['seqs with no takeId', { recordingSessionId: SESSION, seqs: [0] }],
    ['seqs beside a stagedFor', { stagedFor: SESSION, seqs: [0] }],
    ['seqs with no session to fence against', { takeId: UUID, mimeType: 'audio/webm', seqs: [0] }],
    ['no seqs at all — this is not this act', NAMED],
  ])('refuses %s — bad_input, and core is never read', async (_label, input) => {
    await expect(mintRecordingSegmentUrls(input as MintTakeUrlInput)).resolves.toEqual({
      error: 'bad_input',
    })
    expect(get).not.toHaveBeenCalled()
    expectNoBinding()
  })

  it.each([
    ['a container this server will not store', { ...SEGS, mimeType: 'audio/mpeg' }, 'bad_mime'],
    ['an uppercase take uuid', { ...SEGS, takeId: UUID.toUpperCase() }, 'bad_take_id'],
  ])('%s → %s, split exactly as the take mint splits them', async (_l, input, code) => {
    reserved()
    await expect(mintRecordingSegmentUrls(input as MintTakeUrlInput)).resolves.toEqual({
      error: code,
    })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('a signing failure answers upstream, never a half-made batch', async () => {
    reserved()
    createSignedUploadUrl.mockResolvedValue({ data: null as never, error: { message: 'boom' } })
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'upstream' })
  })

  // ⚖ AND A KEY THAT IS COMPOSABLE IN ADVANCE IS NEVER SIGNED OVER (the R2 rule
  // packet B's fix round 2 gave the staged path, on this path too — and here it
  // matters more, because the assembler will one day build a take out of these
  // objects).
  it('an object already at a seq comes back as a SIZE, never a URL', async () => {
    reserved()
    info.mockImplementation(async (key: string) =>
      key === segKey(1)
        ? { data: { size: 4096 }, error: null }
        : { data: null, error: notFoundError },
    )
    const res = await segmentsOk()
    expect(res.segments[1]).toEqual({
      seq: 1,
      path: segKey(1),
      contentType: 'audio/webm',
      existingSize: 4096,
    })
    expect('url' in res.segments[1]).toBe(false)
    // Nothing was signed for THAT key — the answer hands out no way to write it.
    expect(createSignedUploadUrl.mock.calls).toEqual([[segKey(0)], [segKey(2)]])
    // …and the other two are ordinary signed arms, so one occupied key never
    // costs the batch.
    expect('url' in res.segments[0]).toBe(true)
    expect('url' in res.segments[2]).toBe(true)
  })

  it('storage answering without a size says so — null, never a guess', async () => {
    reserved()
    info.mockResolvedValue({ data: {}, error: null })
    const res = await segmentsOk()
    expect(res.segments.every((s) => 'existingSize' in s && s.existingSize === null)).toBe(true)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('storage that does not ANSWER is upstream — retryable, and nothing signed', async () => {
    reserved()
    info.mockResolvedValue({ data: null, error: { message: 'gateway', status: 500 } })
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'upstream' })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // ⚖ AND THE BATCH HAS TO FIT THE DOOR (fix round 2, M2). One seq is two
  // storage calls; sixty of them one after another is up to 120 round trips,
  // which at ordinary latency outlives the CALLER's 30 s door — so the answer
  // is thrown away, no prefix advances, and the pump asks for the same sixty
  // again for as long as the latency lasts. In waves the same work is ~8 waves
  // of two calls. The wave size is what this pins: more than one at a time, and
  // never so many that one client's catch-up opens sixty sockets to storage.
  it('probes and signs in BOUNDED PARALLEL, and the answer stays in seq order', async () => {
    reserved()
    const all = Array.from({ length: 60 }, (_, i) => i)
    let live = 0
    let peak = 0
    info.mockImplementation(async () => {
      live++
      peak = Math.max(peak, live)
      // A real tick, so overlap is observable at all: an instantly-resolved
      // probe never has two in flight, whatever the door does.
      await new Promise((r) => setTimeout(r, 0))
      live--
      return { data: null, error: notFoundError }
    })

    const res = await segmentsOk({ ...NAMED, seqs: all })

    expect(res.segments.map((s) => s.seq)).toEqual(all)
    expect(res.segments.map((s) => s.path)).toEqual(all.map((seq) => segKey(seq)))
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
  })

  // …and a wave that runs beside a refusal changes nothing about the refusal:
  // the first seq IN ORDER that could not be probed ends the whole call, and
  // the others only ever read and signed — this door writes nothing.
  it('one probe that does not answer ends the batch — upstream, never a half-made one', async () => {
    reserved()
    info.mockImplementation(async (key: string) =>
      key === segKey(2)
        ? { data: null, error: { message: 'gateway', status: 500 } }
        : { data: null, error: notFoundError },
    )
    await expect(mintRecordingSegmentUrls(SEGS)).resolves.toEqual({ error: 'upstream' })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('the probe is asked for the composed key itself, once per seq', async () => {
    reserved()
    await segmentsOk()
    expect(info.mock.calls).toEqual([[segKey(0)], [segKey(1)], [segKey(2)]])
  })
})

describe('recordingFinalizedKey — the backfill door', () => {
  it('composes the SAME key the mint reserved, with no DB and no storage', async () => {
    const { recordingFinalizedKey } = await import('@/actions/recording-upload')
    await expect(recordingFinalizedKey({ takeId: UUID, mimeType: 'audio/webm' })).resolves.toBe(
      OWN,
    )
    expect(get).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('the container decides the extension — an iOS take is .mp4, never .webm', async () => {
    const { recordingFinalizedKey } = await import('@/actions/recording-upload')
    await expect(recordingFinalizedKey({ takeId: UUID, mimeType: 'audio/mp4' })).resolves.toBe(
      `app_biz-1_${UUID}.mp4`,
    )
  })

  it('null — never a throw — for a denial, a bad take id or a container we do not store', async () => {
    const { recordingFinalizedKey } = await import('@/actions/recording-upload')
    await expect(
      recordingFinalizedKey({ takeId: 'not-a-uuid', mimeType: 'audio/webm' }),
    ).resolves.toBeNull()
    await expect(
      recordingFinalizedKey({ takeId: UUID, mimeType: 'audio/mpeg' }),
    ).resolves.toBeNull()
  })

  it('gates on records.write before it asks who the caller is', async () => {
    const { recordingFinalizedKey } = await import('@/actions/recording-upload')
    can.mockResolvedValue(false)
    await expect(recordingFinalizedKey({ takeId: UUID, mimeType: 'audio/webm' })).resolves.toBeNull()
    expect(can).toHaveBeenCalledWith('records.write')
    // The composition's first act is asking for the tenant — never asked = never ran.
    expect(getBusinessId).not.toHaveBeenCalled()
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

// ⚖ THE FOURTH KIND — THE RESCUE (Liam 2026-09-06, "b"). The nightly assembler
// used to rebuild a dead device's take under that take's OWN key, so a phone
// that was merely PAUSED for two days came back to an occupied key and a
// terminal size_mismatch. The rebuild now lands BESIDE the take: same body, one
// prefix further left. What this block owns is that the shape is the take's
// exactly (never a second regex), that it belongs to nobody else, and that
// widening the GRAMMAR widened no ROW-POINTER fence.
describe('composeRescueKey — the side key beside the take', () => {
  const MIMES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg', 'audio/wav']

  it.each(MIMES)('%s composes a key that parses as kind rescue', (mimeType) => {
    const composed = composeRescueKey('biz-1', UUID, mimeType)!
    expect(composed).not.toBeNull()
    expect(parseRecordingKey(composed.key, 'biz-1')).toEqual({
      kind: 'rescue',
      takeId: UUID,
      ext: composed.ext,
    })
    // …and belongs to NOBODY else: the tenant is inside the body, not the prefix.
    expect(parseRecordingKey(composed.key, 'biz-2')).toBeNull()
  })

  it('is `rsc/` + the take key, byte for byte — one body, two kinds', () => {
    const take = composeTakeKey('biz-1', UUID, 'audio/mp4')!
    const rescue = composeRescueKey('biz-1', UUID, 'audio/mp4')!
    expect(rescue.key).toBe(`rsc/${take.key}`)
    expect(rescue).toMatchObject({ ext: take.ext, contentType: take.contentType })
    // One folder level, exactly like `stg/` — never a deeper tree.
    expect(rescue.key.split('/')).toHaveLength(2)
  })

  it('round-trips: compose → parse → the same take id and ext', () => {
    const rescue = composeRescueKey('biz-1', UUID, 'audio/ogg')!
    expect(parseRecordingKey(rescue.key, 'biz-1')).toEqual({
      kind: 'rescue',
      takeId: UUID,
      ext: 'ogg',
    })
  })

  it.each([
    ['a non-uuid take', 'take-1', 'audio/webm'],
    ['an uppercase uuid take', UUID.toUpperCase(), 'audio/webm'],
    ['a string-shaped non-string take', IMPOSTOR, 'audio/webm'],
    ['a container outside the closed map', UUID, 'audio/mpeg'],
    ['a prototype member as the container', UUID, 'constructor'],
    ['no container at all', UUID, null],
  ])('refuses %s — null, never a composed key', (_label, takeId, mimeType) => {
    expect(composeRescueKey('biz-1', takeId, mimeType)).toBeNull()
  })

  it.each([
    ['`rsc/` wrapping a SEGMENT shape', `rsc/seg/app_biz-1_${UUID}/000000.webm`],
    ['`rsc/` wrapping a STAGED shape', `rsc/stg/biz-1_${SESSION_UUID}_${UUID}.webm`],
    ['a rescue with a slash in the stem', `rsc/app_biz-1_${UUID}/x.webm`],
    ['a rescue of another tenant', `rsc/app_biz-2_${UUID}.webm`],
    ['a rescue with no unique part', 'rsc/app_biz-1_.webm'],
    ['a doubled rescue prefix', `rsc/rsc/app_biz-1_${UUID}.webm`],
  ])('%s does not parse for biz-1', (_label, key) => {
    expect(parseRecordingKey(key, 'biz-1')).toBeNull()
  })

  // ⚖ WIDENING THE GRAMMAR WIDENED NO ROW-POINTER FENCE. isOwnRecordingKey is
  // what serverHoldsTakeRow, the take mint and finalize all mean, and a row's
  // pointer is always the phone's own key — the assembler never writes core, so
  // a `rsc/` pointer cannot exist. Pinned anyway.
  it('isOwnRecordingKey REFUSES a rescue key, for its own tenant and any other', () => {
    const rescue = composeRescueKey('biz-1', UUID, 'audio/webm')!
    expect(isOwnRecordingKey(rescue.key, 'biz-1')).toBe(false)
    expect(isOwnRecordingKey(rescue.key, 'biz-2')).toBe(false)
    expect(isStagedKeyFor(rescue.key, 'biz-1', SESSION_UUID)).toBe(false)
  })
})

// ⚖ TWO PREDICATES, AND WHICH DOOR MAY USE WHICH (ADDENDUM 9.1). The row-
// POINTER fence stays 'take' alone at every surface a CLIENT names a path at;
// isOwnAudioKey is for a SERVER-DERIVED audio path only — the transcription
// worker's payload re-check and the discard door's karute audio path, the two
// places that read AUDIO rather than a pointer. Without it a rescued take could
// never be transcribed and a karute made from one could never be discarded.
describe('isOwnAudioKey — take OR rescue, and nothing else', () => {
  const rescue = () => composeRescueKey('biz-1', UUID, 'audio/webm')!.key
  const take = () => composeTakeKey('biz-1', UUID, 'audio/webm')!.key

  it.each([
    ['this tenant’s take', () => take(), true],
    ['this tenant’s rescue', () => rescue(), true],
    ['this tenant’s segment', () => composeSegmentKey('biz-1', UUID, 0, 'audio/webm')!.key, false],
    ['this tenant’s staged copy', () => composeStagedKey('biz-1', SESSION_UUID, 'audio/webm')!.key, false],
    ['another tenant’s take', () => composeTakeKey('biz-2', UUID, 'audio/webm')!.key, false],
    ['another tenant’s rescue', () => composeRescueKey('biz-2', UUID, 'audio/webm')!.key, false],
    ['a string-shaped non-string', () => IMPOSTOR, false],
  ])('%s', (_label, key, expected) => {
    expect(isOwnAudioKey(key(), 'biz-1')).toBe(expected)
  })

  // The two predicates differ in EXACTLY one place, and this is it.
  it('is isOwnRecordingKey plus the rescue kind — no other difference', () => {
    for (const key of [
      take(),
      rescue(),
      composeSegmentKey('biz-1', UUID, 0, 'audio/webm')!.key,
      composeStagedKey('biz-1', SESSION_UUID, 'audio/webm')!.key,
      composeTakeKey('biz-2', UUID, 'audio/webm')!.key,
      'nonsense',
    ]) {
      expect(isOwnAudioKey(key, 'biz-1')).toBe(
        isOwnRecordingKey(key, 'biz-1') || key === rescue(),
      )
    }
  })
})

// ⚖ ADDENDUM 9.2 M2 — ONE ext→key SPELLING. The assembler reads a CONTAINER off
// a folder's leaf names (an extension), not a MIME, so `audio/<ext>` is how it
// re-enters the closed map. That inverse is a COINCIDENCE of MIME_TO_EXT, and
// this is where it is pinned: the day a member's MIME is not `audio/<ext>`
// exactly, this table fails and the two wrappers below are what change.
describe('composeTakeKeyFromExt / composeRescueKeyFromExt — the ext round trip', () => {
  // THE MAP ITSELF is the table (fix round 8). Both halves used to be typed-out
  // copies of today's four members, so the very drift the docblock promises to
  // catch — a member whose MIME is not `audio/<ext>` — added itself to the map
  // and left every pin green.
  it.each(Object.entries(MIME_TO_EXT))(
    '`%s` is exactly `audio/` + its own extension (%s)',
    (mimeType, ext) => {
      expect(mimeType).toBe(`audio/${ext}`)
      expect(extFromMime(mimeType)).toBe(ext)
    },
  )

  it('every container IN THE MAP round-trips through both wrappers, never null', () => {
    for (const [mimeType, ext] of Object.entries(MIME_TO_EXT)) {
      const take = composeTakeKey('biz-1', UUID, mimeType)!
      expect(take.ext).toBe(ext)
      expect(composeTakeKeyFromExt('biz-1', UUID, ext)).toEqual(take)
      expect(composeRescueKeyFromExt('biz-1', UUID, ext)).toEqual(
        composeRescueKey('biz-1', UUID, mimeType),
      )
    }
  })

  it.each([
    ['an unknown container', 'mpeg'],
    ['a prototype member', 'constructor'],
    ['an empty extension', ''],
  ])('refuses %s — null from both wrappers', (_label, ext) => {
    expect(composeTakeKeyFromExt('biz-1', UUID, ext)).toBeNull()
    expect(composeRescueKeyFromExt('biz-1', UUID, ext)).toBeNull()
  })
})

// ⚖ THE THIRD COMPOSER (slice five packet C, C1). A segment is a ~5 s slice of a
// take that is still being recorded, and its key hangs under that take's own
// folder — so the pad, the bounds and the self-parse are what keep a thousand
// of them ordered, tenant-scoped, and refused by every fence that means a WHOLE
// take.
describe('composeSegmentKey — the segment shape, as a table', () => {
  const MIMES = [
    ['audio/webm', 'webm'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'mp4'],
    ['audio/ogg', 'ogg'],
    ['audio/wav', 'wav'],
  ] as const

  it.each(MIMES)('%s composes a key that parses as kind segment', (mimeType, ext) => {
    const composed = composeSegmentKey('biz-1', UUID, 7, mimeType)!
    expect(composed).toMatchObject({ ext, contentType: mimeType.split(';')[0], seq: 7 })
    expect(composed.key).toBe(`seg/app_biz-1_${UUID}/000007.${ext}`)
    expect(parseRecordingKey(composed.key, 'biz-1')).toEqual({
      kind: 'segment',
      takeId: UUID,
      seq: 7,
      ext,
    })
  })

  // LEXICAL ORDER IS NUMERIC ORDER — the property a storage listing of the
  // folder rests on, and the only thing the six-digit pad exists for.
  it.each([
    [0, '000000'],
    [7, '000007'],
    [42, '000042'],
    [999, '000999'],
    [1_000, '001000'],
    [999_999, '999999'],
  ])('pads seq %i to %s, and parses back to the same number', (seq, stem) => {
    const composed = composeSegmentKey('biz-1', UUID, seq, 'audio/webm')!
    expect(composed.key).toBe(`seg/app_biz-1_${UUID}/${stem}.webm`)
    expect(parseRecordingKey(composed.key, 'biz-1')).toMatchObject({ seq })
  })

  it('a sorted listing of composed keys IS capture order', () => {
    const keys = [3, 11, 2, 1_000, 0].map(
      (seq) => composeSegmentKey('biz-1', UUID, seq, 'audio/webm')!.key,
    )
    expect([...keys].sort()).toEqual(
      [0, 2, 3, 11, 1_000].map((seq) => composeSegmentKey('biz-1', UUID, seq, 'audio/webm')!.key),
    )
  })

  it.each([
    ['a non-uuid take', 'take-1', 0, 'audio/webm'],
    ['an uppercase uuid take', UUID.toUpperCase(), 0, 'audio/webm'],
    ['a string-shaped non-string take', IMPOSTOR, 0, 'audio/webm'],
    ['a negative seq', UUID, -1, 'audio/webm'],
    ['a seq past the six-digit pad', UUID, 1_000_000, 'audio/webm'],
    ['a fractional seq', UUID, 1.5, 'audio/webm'],
    ['NaN', UUID, Number.NaN, 'audio/webm'],
    ['Infinity', UUID, Number.POSITIVE_INFINITY, 'audio/webm'],
    ['a string-shaped seq', UUID, '7', 'audio/webm'],
    ['a container outside the closed map', UUID, 0, 'audio/mpeg'],
    ['a prototype member as the container', UUID, 0, 'constructor'],
    ['no container at all', UUID, 0, null],
  ])('refuses %s — null, never a composed key', (_label, takeId, seq, mimeType) => {
    expect(composeSegmentKey('biz-1', takeId, seq, mimeType)).toBeNull()
  })

  it('a composed segment key belongs to NOBODY else, and is not a take anywhere', () => {
    const composed = composeSegmentKey('biz-1', UUID, 3, 'audio/mp4')!
    expect(parseRecordingKey(composed.key, 'other-biz')).toBeNull()
    // ⚖ EVERY TAKE FENCE REFUSES A SEGMENT. Widening the grammar must not widen
    // a single fence: these keys are this tenant's, they parse, and no door
    // that means a whole take may accept one.
    expect(isOwnRecordingKey(composed.key, 'biz-1')).toBe(false)
    expect(isOwnRecordingKey(composed.key, 'other-biz')).toBe(false)
    expect(isStagedKeyFor(composed.key, 'biz-1', SESSION_UUID)).toBe(false)
  })

  it('the folder is exactly the take key’s stem — one folder per take', () => {
    const take = composeTakeKey('biz-1', UUID, 'audio/mp4')!
    const seg = composeSegmentKey('biz-1', UUID, 0, 'audio/mp4')!
    expect(seg.key).toBe(`seg/${take.key.slice(0, -'.mp4'.length)}/000000.mp4`)
    // Nested on purpose: /api/cleanup lists the bucket ROOT non-recursively, so
    // a thousand flat segment names per take would land in front of every sweep.
    expect(seg.key.split('/')).toHaveLength(3)
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
    expect(Object.keys(mod).sort()).toEqual([
      'mintRecordingReadUrl',
      // Slice five packet C: the SEGMENT mint. It reserves nothing, writes
      // nothing and audits nothing — and like every door in this file it can
      // only ADD an object to the bucket, never take one away.
      'mintRecordingSegmentUrls',
      'mintRecordingUploadUrl',
      // Fix round 7: a PURE composition (no DB, no storage) for a take
      // finalized before the key was stamped. It reads nothing and writes
      // nothing — the opposite of a delete door.
      'recordingFinalizedKey',
    ])
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

  // ⚖ THE THIRD SHAPE (PR4 fix round 7): a STAGED copy, named for the SESSION
  // its words are owed to rather than for a take. It is the only object in this
  // bucket with no row of its own, and the session in its key is the identity
  // that lets the discard door check a claim instead of trusting it.
  it.each(EXTS)('reads a staged copy as kind staged (.%s)', (ext) => {
    expect(parseRecordingKey(`stg/biz-1_${SESSION_UUID}_${UUID}.${ext}`, 'biz-1')).toEqual({
      kind: 'staged',
      recordingSessionId: SESSION_UUID,
      ext,
    })
  })

  it.each([
    ['another business’s staged copy', `stg/biz-2_${SESSION_UUID}_${UUID}.webm`],
    ['a prefix-lookalike', `stg/biz-10_${SESSION_UUID}_${UUID}.webm`],
    ['an app_ body inside stg/', `stg/app_biz-1_${SESSION_UUID}_${UUID}.webm`],
    ['only one id', `stg/biz-1_${UUID}.webm`],
    ['a nested staged key', `stg/biz-1_${SESSION_UUID}/${UUID}.webm`],
    ['an uppercase session id', `stg/biz-1_${SESSION_UUID.toUpperCase()}_${UUID}.webm`],
    ['an extension outside the closed set', `stg/biz-1_${SESSION_UUID}_${UUID}.exe`],
  ])('refuses %s', (_label, key) => {
    expect(parseRecordingKey(key, 'biz-1')).toBeNull()
  })

  it('composeStagedKey composes exactly what isStagedKeyFor accepts — and nothing wider', () => {
    const composed = composeStagedKey('biz-1', SESSION_UUID, 'audio/webm')
    expect(composed).not.toBeNull()
    expect(parseRecordingKey(composed!.key, 'biz-1')).toEqual({
      kind: 'staged',
      recordingSessionId: SESSION_UUID,
      ext: 'webm',
    })
    expect(isStagedKeyFor(composed!.key, 'biz-1', SESSION_UUID)).toBe(true)
    // …for THIS business and THIS session only. Both halves are the fence.
    expect(isStagedKeyFor(composed!.key, 'other-biz', SESSION_UUID)).toBe(false)
    expect(isStagedKeyFor(composed!.key, 'biz-1', UUID)).toBe(false)
    // A staged copy is not a take, so no fence that means a whole take accepts it.
    expect(isOwnRecordingKey(composed!.key, 'biz-1')).toBe(false)
    // …and a take is not a staged copy either.
    expect(isStagedKeyFor(`app_biz-1_${UUID}.webm`, 'biz-1', SESSION_UUID)).toBe(false)
    // With no slot named, every staging gets its own object — the uuid is the
    // server's. That is the no_uuid cohort's behaviour, and D10's ceiling.
    expect(composeStagedKey('biz-1', SESSION_UUID, 'audio/webm')!.key).not.toBe(composed!.key)
  })

  // ⚖ THE SLOT IS THE TAKE (slice five packet B, D10).
  it('composeStagedKey puts the TAKE in the slot when it is given one', () => {
    const composed = composeStagedKey('biz-1', SESSION_UUID, 'audio/webm', UUID)!
    expect(composed.key).toBe(`stg/biz-1_${SESSION_UUID}_${UUID}.webm`)
    // Composable from the core row ALONE: session = the row id, take + ext =
    // the row's own reserved pointer `app_<biz>_<take>.<ext>`.
    expect(composed.key).toBe(
      `stg/biz-1_${SESSION_UUID}_${composeTakeKey('biz-1', UUID, 'audio/webm')!.key.slice(
        'app_biz-1_'.length,
      )}`,
    )
    expect(isStagedKeyFor(composed.key, 'biz-1', SESSION_UUID)).toBe(true)
    // …and it is STABLE, which is the property the 409-is-success rule needs.
    expect(composeStagedKey('biz-1', SESSION_UUID, 'audio/webm', UUID)!.key).toBe(composed.key)
  })

  it.each([
    ['a non-uuid slot', 'take-1'],
    ['an uppercase uuid', UUID.toUpperCase()],
    ['a path-shaped slot', `../${UUID}`],
    ['a non-string slot', 42],
    ['null', null],
  ])('falls back to the server’s own uuid on %s — never into the key', (_label, slot) => {
    const composed = composeStagedKey('biz-1', SESSION_UUID, 'audio/webm', slot)!
    // The slot the key actually carries: everything after the session id, minus
    // the extension. It is a fresh server uuid, and NOT what the caller sent.
    const carried = composed.key.slice(`stg/biz-1_${SESSION_UUID}_`.length, -'.webm'.length)
    expect(carried).not.toBe(String(slot))
    expect(carried).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(isStagedKeyFor(composed.key, 'biz-1', SESSION_UUID)).toBe(true)
  })

  it('composeStagedKey refuses a session id that is not a uuid, and a container it cannot store', () => {
    expect(composeStagedKey('biz-1', 'sess-1', 'audio/webm')).toBeNull()
    expect(composeStagedKey('biz-1', SESSION_UUID.toUpperCase(), 'audio/webm')).toBeNull()
    expect(composeStagedKey('biz-1', SESSION_UUID, 'audio/mpeg')).toBeNull()
    expect(composeStagedKey('biz-1', { startsWith: () => true }, 'audio/webm')).toBeNull()
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
    // …and it sees the STAGED shape too (fix round 7) — cleanup is report-only,
    // but a key it cannot read at all would be reported as an orphan of nobody.
    expect(looksLikeRecordingKey(`stg/biz-1_${SESSION_UUID}_${UUID}.webm`)).toBe(true)
    expect(looksLikeRecordingKey(`stg/other-biz_${SESSION_UUID}_${UUID}.webm`)).toBe(true)
    expect(looksLikeRecordingKey(`stg/biz-1_${UUID}.webm`)).toBe(false)
    expect(looksLikeRecordingKey(`stg/a/b_${SESSION_UUID}_${UUID}.webm`)).toBe(false)
  })

  // ⚖ THE FOLDER NAME, TENANT-BLIND (build 23 slice ③, the assembler). The
  // nightly job walks `seg/` with no tenant context, so it has to read the
  // business back out of a FOLDER name — and then ask the one parser, exactly
  // as looksLikeRecordingKey does for a key.
  describe('parseSegmentFolder — the assembler reads the tenant off the folder', () => {
    it('reads the businessId and the take out of a real folder name', () => {
      expect(parseSegmentFolder(`app_biz-1_${UUID}`)).toEqual({
        businessId: 'biz-1',
        takeId: UUID,
      })
      // Tenant-blind on purpose: ANY businessId shape it can read back out
      // counts, exactly like looksLikeRecordingKey — the walk has no tenant
      // to compare against.
      expect(parseSegmentFolder(`app_other-biz_${UUID}`)).toEqual({
        businessId: 'other-biz',
        takeId: UUID,
      })
    })

    it.each([
      ['an uppercase uuid', `app_biz-1_${UUID.toUpperCase()}`],
      ['a businessId carrying a path separator', `app_a/b_${UUID}`],
      ['a traversal body', `app_../../evil_${UUID}`],
      ['no app_ prefix', `biz-1_${UUID}`],
      ['the seg/ prefix included', `seg/app_biz-1_${UUID}`],
      ['a ROOT take name (it carries an extension)', `app_biz-1_${UUID}.webm`],
      ['an empty businessId', `app__${UUID}`],
      ['a truncated uuid', `app_biz-1_${UUID.slice(0, 20)}`],
      ['a leaf, not a folder', `app_biz-1_${UUID}/000000.webm`],
    ])('refuses %s', (_label, name) => {
      expect(parseSegmentFolder(name)).toBeNull()
    })

    it('refuses a string-shaped non-string before it calls a method on it', () => {
      expect(parseSegmentFolder(IMPOSTOR)).toBeNull()
    })

    it('what it reads back is what the ONE parser reads out of that folder’s own leaf', () => {
      const parsed = parseSegmentFolder(`app_biz-1_${UUID}`)!
      expect(parseRecordingKey(`seg/app_biz-1_${UUID}/000003.mp4`, parsed.businessId)).toEqual({
        kind: 'segment',
        takeId: parsed.takeId,
        seq: 3,
        ext: 'mp4',
      })
    })
  })
})
