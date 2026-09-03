/**
 * Web recording upload actions (hotfix 2026-08-25). Three things only this file
 * can prove, all of them the reason the actions exist at all:
 *   1. the minted key carries THIS caller's tenant prefix and the .webm suffix
 *      the pipeline/cleanup/worker all assume;
 *   2. the tenant fence — a path belonging to another business is refused
 *      BEFORE the service-role client (which has no RLS) ever touches it;
 *   3. removeRecordingObject never throws, whatever goes wrong.
 */
const requireCapability = jest.fn(async (_c: string) => {})
const getMyCapabilities = jest.fn(async () => new Set<string>(['records.write']))
jest.mock('@/lib/auth/require-permission', () => ({
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
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({ recordings: { get, create, update } }),
  getSynqedClient: jest.fn(),
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

import {
  mintRecordingUploadUrl,
  mintRecordingReadUrl,
  removeRecordingObject,
} from '@/actions/recording-upload'
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
  // removeRecordingObject warns on every refusal by design — keep the run readable.
  jest.spyOn(console, 'warn').mockImplementation(() => {})
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

  it('gates on records.write BEFORE minting anything', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(mintRecordingUploadUrl()).rejects.toThrow('forbidden')
    expect(requireCapability).toHaveBeenCalledWith('records.write')
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
    const res = await mintOk({ takeId: UUID, mimeType: 'audio/webm' })
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
    const res = await mintOk({ takeId: UUID, mimeType: 'audio/webm' })
    expect(res.path).toBe(OWN)
  })

  it.each([
    ['audio/webm;codecs=opus', 'webm', 'audio/webm'],
    ['audio/mp4', 'mp4', 'audio/mp4'],
    ['AUDIO/MP4; codecs="mp4a.40.2"', 'mp4', 'audio/mp4'],
    ['audio/ogg', 'ogg', 'audio/ogg'],
    ['audio/wav', 'wav', 'audio/wav'],
  ])('%s → .%s, contentType %s', async (mimeType, ext, contentType) => {
    const res = await mintOk({ takeId: UUID, mimeType })
    expect(res.path).toBe(`app_biz-1_${UUID}.${ext}`)
    expect(res.contentType).toBe(contentType)
  })

  it.each([
    ['a container we do not store', 'audio/aac'],
    ['a video container', 'video/mp4'],
    ['an empty mime', ''],
  ])('refuses %s — bad_mime, nothing is signed and nothing is bound', async (_label, mimeType) => {
    await expect(mintRecordingUploadUrl({ takeId: UUID, mimeType })).resolves.toEqual({
      error: 'bad_mime',
    })
    expectNoBinding()
  })

  it.each([
    ['a traversal body', '../../x'],
    ['an uppercase uuid', UUID.toUpperCase()],
    ['a separator', `${UUID}/000000`],
    ['an extension smuggled into the id', `${UUID}.webm`],
    ['a non-uuid body', 'stolen'],
  ])('refuses %s as a take id — bad_take_id, nothing is signed or bound', async (_label, takeId) => {
    await expect(
      mintRecordingUploadUrl({ takeId: takeId as string, mimeType: 'audio/webm' }),
    ).resolves.toEqual({ error: 'bad_take_id' })
    expectNoBinding()
  })

  // H1 (round 5): these fail the SHAPE zod checks (not a string at all), so
  // the first-line schema parse refuses them as bad_input before composeTakeKey
  // ever runs — one fence earlier than the semantic bad_mime/bad_take_id checks.
  it.each([
    ['a non-string mime', { takeId: UUID, mimeType: 12345 as unknown as string }],
    ['a string-shaped non-string take id', { takeId: IMPOSTOR, mimeType: 'audio/webm' }],
  ])('refuses %s — bad_input, before composeTakeKey runs', async (_label, input) => {
    await expect(mintRecordingUploadUrl(input)).resolves.toEqual({ error: 'bad_input' })
    expectNoBinding()
  })

  it('gates on records.write BEFORE it looks at any client input', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(mintRecordingUploadUrl({ takeId: UUID, mimeType: 'audio/webm' })).rejects.toThrow(
      'forbidden',
    )
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
    await mintOk({ takeId: UUID, mimeType: 'audio/mp4' })
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
      recording_session_id: 'sess-new',
      reserved: true,
    })
    expect(JSON.stringify(event.detail)).not.toContain(OWN)
  })

  it('files NOTHING when the server names the take — old behaviour unchanged', async () => {
    await mintOk()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('files nothing when the named take is REFUSED — no row for a key never signed', async () => {
    await expect(mintRecordingUploadUrl({ takeId: 'stolen' })).resolves.toEqual({
      error: 'bad_take_id',
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
    await expect(mintRecordingUploadUrl({ takeId: UUID })).resolves.toEqual({ error: 'upstream' })
    expect(create).not.toHaveBeenCalled()
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
  const named = { takeId: UUID, mimeType: 'audio/webm' }

  it('signs, then reserves — the URL is withheld until the reservation lands', async () => {
    const res = await mintOk({ ...named, recordingSessionId: SESSION })
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
    const res = await mintOk({ ...named, recordingSessionId: SESSION })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(res.recordingSessionId).toBe(SESSION)
    // Fix round 6 (I3): nothing was written, so nothing is audited — the
    // 'reserved: false' row for a call that changed nothing is gone.
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('with NO session the mint creates the row, with the caller’s staff and store', async () => {
    const res = await mintOk(named)
    expect(create).toHaveBeenCalledWith({
      staff_id: 'staff-1',
      store_id: 'store-9',
      customer_id: null,
      audio_storage_path: OWN,
      status: 'UPLOADING',
    })
    expect(res.recordingSessionId).toBe('sess-new')
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
  it('a core 409 racing to CREATE the row — reserved_elsewhere, the already-signed URL discarded', async () => {
    create.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'reserved_elsewhere' })
    expect(createSignedUploadUrl).toHaveBeenCalled()
  })

  it('a core 409 racing to UPDATE the row — reserved_elsewhere, the already-signed URL discarded', async () => {
    update.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
    await expect(
      mintRecordingUploadUrl({ ...named, recordingSessionId: SESSION }),
    ).resolves.toEqual({ error: 'reserved_elsewhere' })
    expect(createSignedUploadUrl).toHaveBeenCalled()
  })

  it('refuses another staffer’s session — forbidden, nothing bound', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    await expect(
      mintRecordingUploadUrl({ ...named, recordingSessionId: SESSION }),
    ).resolves.toEqual({ error: 'forbidden' })
    expectNoBinding()
  })

  it('refuses another business’s session — forbidden, nothing bound', async () => {
    get.mockResolvedValue(row({ business_id: 'biz-2' }))
    await expect(
      mintRecordingUploadUrl({ ...named, recordingSessionId: SESSION }),
    ).resolves.toEqual({ error: 'forbidden' })
    expectNoBinding()
  })

  it('lets an owner (recordings.viewAll) reserve on a colleague’s session', async () => {
    get.mockResolvedValue(row({ staff_id: 'staff-2' }))
    getMyCapabilities.mockResolvedValue(new Set(['records.write', 'recordings.viewAll']))
    const res = await mintOk({ ...named, recordingSessionId: SESSION })
    expect(res.recordingSessionId).toBe(SESSION)
    expect(update).toHaveBeenCalled()
  })

  it('refuses a row already bound to a DIFFERENT take — reserved_elsewhere', async () => {
    get.mockResolvedValue(row({ audio_storage_path: `app_biz-1_${OTHER_UUID}.webm` }))
    await expect(
      mintRecordingUploadUrl({ ...named, recordingSessionId: SESSION }),
    ).resolves.toEqual({ error: 'reserved_elsewhere' })
    expectNoBinding()
  })

  it.each([
    ['no session at all', undefined],
    ['a session whose row reserved nothing', SESSION],
  ])(
    'refuses a key whose object ALREADY EXISTS (%s) — exists, nothing bound',
    async (_label, recordingSessionId) => {
      info.mockResolvedValue({ data: { size: 4096 }, error: null })
      await expect(mintRecordingUploadUrl({ ...named, recordingSessionId })).resolves.toEqual({
        error: 'exists',
      })
      expectNoBinding()
    },
  )

  it('fails CLOSED when storage cannot say whether the object exists', async () => {
    info.mockResolvedValue({ data: null, error: { message: 'boom', status: 500 } })
    await expect(mintRecordingUploadUrl(named)).resolves.toEqual({ error: 'upstream' })
    expectNoBinding()
  })

  it('refuses a session id core does not know — never binds a replacement', async () => {
    get.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    await expect(
      mintRecordingUploadUrl({ ...named, recordingSessionId: SESSION }),
    ).resolves.toEqual({ error: 'not_found' })
    expectNoBinding()
  })

  it('an unreadable session row is upstream — nothing bound, nothing signed', async () => {
    get.mockRejectedValue(Object.assign(new Error('core down'), { status: 503 }))
    await expect(
      mintRecordingUploadUrl({ ...named, recordingSessionId: SESSION }),
    ).resolves.toEqual({ error: 'upstream' })
    expectNoBinding()
  })

  it.each(['PROCESSING', 'COMPLETED', 'FAILED'])(
    'reserves on a %s row with the POINTER ONLY — the job keeps its status',
    async (status) => {
      get.mockResolvedValue(row({ status }))
      await mintOk({ ...named, recordingSessionId: SESSION })
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

describe('removeRecordingObject — same fence, and it never throws', () => {
  it('deletes a path under the caller’s own prefix', async () => {
    await expect(removeRecordingObject(OWN)).resolves.toEqual({ ok: true })
    expect(removeObj).toHaveBeenCalledWith([OWN])
  })

  it.each(REFUSED)('refuses %s — nothing is deleted', async (_label, path) => {
    await expect(removeRecordingObject(path)).resolves.toEqual({ error: 'failed' })
    expect(removeObj).not.toHaveBeenCalled()
  })

  it('refuses a string-shaped non-string before it calls a method on it', async () => {
    await expect(removeRecordingObject(IMPOSTOR)).resolves.toEqual({ error: 'failed' })
    expect(removeObj).not.toHaveBeenCalled()
  })

  it('a denied capability returns the error arm, never a throw into the recording UX', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(removeRecordingObject(OWN)).resolves.toEqual({
      error: 'failed',
    })
    // The fence's first act is asking who the caller is — never asked = never ran.
    expect(getBusinessId).not.toHaveBeenCalled()
    expect(removeObj).not.toHaveBeenCalled()
  })

  it('a storage error returns the error arm', async () => {
    removeObj.mockResolvedValue({ error: { message: 'gone' } })
    await expect(removeRecordingObject(OWN)).resolves.toEqual({ error: 'gone' })
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
