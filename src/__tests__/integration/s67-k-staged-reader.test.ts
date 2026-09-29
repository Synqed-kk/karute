/**
 * S67 PR-K fix round 1 (Greptile #1099) — the staged-mark reader.
 *
 * Commit 4 「a staged mark says which copy it names」 (thread 1, attack SF1):
 * readStagedMarks answers each mark WITH the parsed staged target the ONE
 * parser produced for its name, plus the full mark key — two copies of one
 * session (webm + mp4) each marked → two entries, each naming its own copy.
 */
import { composeMarkKey, composeStagedKey, MARK_PREFIX, parseRecordingKey } from '@/lib/recording/key-grammar'
import { markStagedCopy, readStagedMarks } from '@/lib/recording/take-mark'

const BIZ = 'fb44dd68-0000-4000-8000-000000000001'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const FACTS = { bytes: 1024, first_byte: 26 }
const FOLDER = `${MARK_PREFIX}stg`

/** A fake bucket whose listing is OVER-broad (every name in the folder, like a
 *  pattern match can be) and honours `limit` / `offset` in name order. */
function bucket(initial: Record<string, string> = {}) {
  const objects = new Map(Object.entries(initial))
  const upload = jest.fn(async (key: string, body: string, _o: unknown) => {
    if (objects.has(key)) return { error: { statusCode: '409', message: 'The resource already exists' } }
    objects.set(key, body)
    return { error: null }
  })
  const download = jest.fn(async (key: string) =>
    objects.has(key)
      ? { data: { text: async () => objects.get(key)! }, error: null }
      : { data: null, error: { status: 404, statusCode: '404', message: 'Object not found' } },
  )
  const list = jest.fn(async (folder: string, opts: { limit: number; offset: number }) => ({
    data: [...objects.keys()]
      .filter((k) => k.startsWith(`${folder}/`))
      .map((k) => k.slice(folder.length + 1))
      .sort()
      .slice(opts.offset, opts.offset + opts.limit)
      .map((name) => ({ name })),
    error: null,
  }))
  const client = { storage: { from: () => ({ upload, download, list }) } } as unknown as Parameters<
    typeof readStagedMarks
  >[0]
  return { client, objects, upload, download, list }
}

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('a staged mark says which copy it names (commit 4, thread 1)', () => {
  it('two staged copies of one session (webm + mp4), each marked → two entries, each naming its own copy', async () => {
    const b = bucket()
    const webm = composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)!.key
    const mp4 = composeStagedKey(BIZ, SESSION, 'audio/mp4', TAKE)!.key
    await expect(markStagedCopy(b.client, BIZ, webm, FACTS)).resolves.toBe('created')
    await expect(markStagedCopy(b.client, BIZ, mp4, { bytes: 2048, first_byte: 0 })).resolves.toBe('created')
    const found = await readStagedMarks(b.client, BIZ, SESSION)
    expect(found).toHaveLength(2)
    const byExt = Object.fromEntries(found.map((m) => [m.target.ext, m]))
    expect(Object.keys(byExt).sort()).toEqual(['mp4', 'webm'])
    for (const [ext, copy, bytes] of [
      ['webm', webm, 1024],
      ['mp4', mp4, 2048],
    ] as const) {
      const markKey = composeMarkKey(BIZ, copy, 'partial')!.key
      expect(byExt[ext]).toEqual(
        expect.objectContaining({
          kind: 'partial',
          bytes,
          target: { sessionId: SESSION, uuid: TAKE, ext },
          key: markKey,
        }),
      )
      // The target is exactly what the ONE parser says for that key.
      const parsed = parseRecordingKey(markKey, BIZ)
      expect(parsed?.kind === 'mark' && parsed.target.kind === 'staged' ? parsed.target : null).toEqual({
        kind: 'staged',
        ...byExt[ext].target,
      })
    }
  })

  it('a mark whose name the parser rejects is still dropped — no entry, no download', async () => {
    const b = bucket()
    const webm = composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)!.key
    await markStagedCopy(b.client, BIZ, webm, FACTS)
    const good = composeMarkKey(BIZ, webm, 'partial')!.key
    const body = b.objects.get(good)!
    const bad = `${FOLDER}/${BIZ}_${SESSION}_not-a-uuid.webm.partial.json`
    expect(parseRecordingKey(bad, BIZ)).toBeNull()
    b.objects.set(bad, body)
    const found = await readStagedMarks(b.client, BIZ, SESSION)
    expect(found.map((m) => m.key)).toEqual([good])
    expect(b.download.mock.calls.map(([k]) => k)).toEqual([good])
  })
})
