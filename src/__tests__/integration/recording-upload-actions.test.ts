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
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (c: string) => requireCapability(c),
}))
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
      from: (_bucket: string) => ({ createSignedUploadUrl, createSignedUrl, remove: removeObj }),
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

// A real lowercase uuid, so a fixture only ever fails the ONE clause it targets —
// a placeholder body would be refused by the uuid clause and silently mask the rest.
const UUID = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const OWN = `app_biz-1_${UUID}.webm`

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
  getBusinessId.mockImplementation(async () => 'biz-1')
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
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
    const res = await mintRecordingUploadUrl()
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
    const [a, b] = await Promise.all([mintRecordingUploadUrl(), mintRecordingUploadUrl()])
    expect(a.path).not.toBe(b.path)
  })

  it('gates on records.write BEFORE minting anything', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(mintRecordingUploadUrl()).rejects.toThrow('forbidden')
    expect(requireCapability).toHaveBeenCalledWith('records.write')
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('a storage failure surfaces instead of returning a half-made URL', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null as never, error: { message: 'boom' } })
    await expect(mintRecordingUploadUrl()).rejects.toThrow('could not mint an upload URL')
  })
})

// The mint now accepts a CLIENT-NAMED take (capture pipeline PR2). Everything
// below is the fence that makes accepting it safe.
describe('mintRecordingUploadUrl(input) — the client names the take, the server fences it', () => {
  it('absent input is byte-identical to before: server uuid, .webm', async () => {
    getBusinessId.mockResolvedValue(BIZ_UUID)
    const res = await mintRecordingUploadUrl()
    expect(res.path).toMatch(new RegExp(`^app_${BIZ_UUID}_[0-9a-f-]{36}\\.webm$`))
    expect(res.contentType).toBe('audio/webm')
  })

  it('a named take composes the SAME key the grammar accepts, and signs it WITHOUT upsert', async () => {
    const res = await mintRecordingUploadUrl({ takeId: UUID, mimeType: 'audio/webm' })
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
    const res = await mintRecordingUploadUrl({ takeId: UUID, mimeType: 'audio/webm' })
    expect(res.path).toBe(OWN)
  })

  it.each([
    ['audio/webm;codecs=opus', 'webm', 'audio/webm'],
    ['audio/mp4', 'mp4', 'audio/mp4'],
    ['AUDIO/MP4; codecs="mp4a.40.2"', 'mp4', 'audio/mp4'],
    ['audio/ogg', 'ogg', 'audio/ogg'],
    ['audio/wav', 'wav', 'audio/wav'],
  ])('%s → .%s, contentType %s', async (mimeType, ext, contentType) => {
    const res = await mintRecordingUploadUrl({ takeId: UUID, mimeType })
    expect(res.path).toBe(`app_biz-1_${UUID}.${ext}`)
    expect(res.contentType).toBe(contentType)
  })

  it.each([
    ['a container we do not store', 'audio/aac'],
    ['a video container', 'video/mp4'],
    ['an empty mime', ''],
    ['a non-string mime', 12345 as unknown as string],
  ])('refuses %s — nothing is signed', async (_label, mimeType) => {
    await expect(mintRecordingUploadUrl({ takeId: UUID, mimeType })).rejects.toThrow(
      'could not mint an upload URL',
    )
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it.each([
    ['a traversal body', '../../x'],
    ['an uppercase uuid', UUID.toUpperCase()],
    ['a separator', `${UUID}/000000`],
    ['an extension smuggled into the id', `${UUID}.webm`],
    ['a non-uuid body', 'stolen'],
    ['a string-shaped non-string', IMPOSTOR],
  ])('refuses %s as a take id — nothing is signed', async (_label, takeId) => {
    await expect(
      mintRecordingUploadUrl({ takeId: takeId as string, mimeType: 'audio/webm' }),
    ).rejects.toThrow('could not mint an upload URL')
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('gates on records.write BEFORE it looks at any client input', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(mintRecordingUploadUrl({ takeId: UUID, mimeType: 'audio/webm' })).rejects.toThrow(
      'forbidden',
    )
    expect(getBusinessId).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

// Fix round 2, B4 (detail shape re-cut in fix round 3). A key the DEVICE named
// is a name the caller may not own — storage now refuses the overwrite, and this
// row is who reached for the name. A server-named uuid claims nothing and files
// nothing, exactly as before.
describe('mintRecordingUploadUrl — the client-named take leaves ONE audit row', () => {
  it('files one ids-only row for a named take', async () => {
    await mintRecordingUploadUrl({ takeId: UUID, mimeType: 'audio/mp4' })
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
    expect(event.detail).toEqual({ take_id: UUID, ext: 'mp4' })
    expect(JSON.stringify(event.detail)).not.toContain(OWN)
  })

  it('files NOTHING when the server names the take — old behaviour unchanged', async () => {
    await mintRecordingUploadUrl()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('files nothing when the named take is REFUSED — no row for a key never signed', async () => {
    await expect(mintRecordingUploadUrl({ takeId: 'stolen' })).rejects.toThrow()
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('files nothing when storage refuses to sign', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null as never, error: { message: 'boom' } })
    await expect(mintRecordingUploadUrl({ takeId: UUID })).rejects.toThrow()
    expect(auditFn).not.toHaveBeenCalled()
  })

  // The emitter is a PRIVATE auditLockout-pattern helper, so CP7's
  // registry-reality cross-check (exported symbols only) can never require the
  // registration — this pin is what goes red if the entry is dropped.
  it('is registered in AUDITED_CORES as the file’s writer', () => {
    expect(AUDITED_CORES).toContainEqual(
      expect.objectContaining({
        file: 'src/lib/recording/mint-take-url.ts',
        symbols: ['auditTakeNamed'],
      }),
    )
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
