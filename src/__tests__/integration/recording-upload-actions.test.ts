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
jest.mock('@/lib/staff', () => ({ getBusinessId: async () => 'biz-1' }))

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
]

beforeEach(() => {
  jest.clearAllMocks()
  // removeRecordingObject warns on every refusal by design — keep the run readable.
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  requireCapability.mockImplementation(async () => {})
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
    const res = await mintRecordingUploadUrl()
    expect(res.path).toMatch(
      /^app_biz-1_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webm$/,
    )
    // Flat key — /api/cleanup lists the bucket ROOT non-recursively.
    expect(res.path).not.toContain('/')
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

  it('gates on records.write before the fence even runs', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(mintRecordingReadUrl(OWN)).rejects.toThrow('forbidden')
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

  it('a denied capability returns the error arm, never a throw into the recording UX', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(removeRecordingObject(OWN)).resolves.toEqual({
      error: 'failed',
    })
    expect(removeObj).not.toHaveBeenCalled()
  })

  it('a storage error returns the error arm', async () => {
    removeObj.mockResolvedValue({ error: { message: 'gone' } })
    await expect(removeRecordingObject(OWN)).resolves.toEqual({ error: 'gone' })
  })
})
