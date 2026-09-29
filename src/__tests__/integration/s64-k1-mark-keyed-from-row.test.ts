/**
 * PR-K commit 1 — 「a mark names an object the server named」 (PACKET-S64-PRK,
 * RULINGS A1–A6 + S66 K1–K5).
 *
 * The staged door's `partial` mark lands on the STAGED key the door composed
 * for THAT copy — the row's session, the slot's uuid, the container declared
 * for the copy — in both sub-branches, row pointer or not; finalize's marks
 * stay on the take key. Two homes, by door, never a shared key:
 *   (a) row pointer app_<biz>_<u>.mp4, staged body with NO mimeType → ONE mark
 *       on the staged key, ZERO under mrk/app_ (closes (k): no take key is
 *       recomposed from the request's container)
 *   (b) no row pointer, a FOREIGN valid hint → ONE mark on
 *       mrk/stg/<biz>_<own session>_<foreign>.<ext>.partial.json, ZERO under
 *       mrk/app_ (closes S1: the mark carries the row's session)
 *   (c) random-fallback slot → no mark, slot 'random_fallback'
 *   (d) the existing-object sub-branch → the same key rule
 *   (e) finalizeProbe OFF → no mark, no extra storage call, the same answer
 *   (f) readStagedMarks — ONE bounded listing — returns the staged mark
 *   (g) the parser refuses mrk/ on a segment, rescue, transcript or mark key
 *   (g') a mark result never carries a top-level takeId (N1)
 */

const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

// A getter, not a value: modules that read the registry at load time run
// before this file's own consts are initialised (the s60-a2 idiom).
const mockSwitches = { finalizeProbe: true }
jest.mock('@/lib/recording/recording-switches', () => ({
  RECORDING_SWITCHES: {
    bindUnboundUploads: false,
    captureWarningNotice: true,
    get finalizeProbe() {
      return mockSwitches.finalizeProbe
    },
  },
}))

/** The fake bucket: `held` answers `info` (object there), `marks` are the creates. */
const held = new Map<string, number>()
const marks = new Map<string, string>()
const info = jest.fn(async (key: string) =>
  held.has(key)
    ? { data: { size: held.get(key) } as { size?: number } | null, error: null }
    : { data: null, error: { ...OBJECT_NOT_FOUND } as { message: string; status?: number } | null },
)
const createSignedUploadUrl = jest.fn(async (path: string) => ({
  data: { path, signedUrl: `https://proj.supabase.co/upload/${path}`, token: 'tok-1' } as {
    path: string
    signedUrl: string
    token: string
  } | null,
  error: null as { message: string; statusCode?: string } | null,
}))
const upload = jest.fn(async (key: string, body: string, _opts: unknown) => {
  if (marks.has(key)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
  marks.set(key, body)
  return { data: { path: key }, error: null }
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: { from: (_b: string) => ({ info, createSignedUploadUrl, upload }) },
  }),
}))

import { OBJECT_NOT_FOUND } from './helpers/storage-fakes'
import { mintTakeUploadUrl, type MintTakeActor } from '@/lib/recording/mint-take-url'
import {
  composeMarkKey,
  composeRescueKey,
  composeSegmentKey,
  composeStagedKey,
  composeTakeKey,
  composeTranscriptKey,
  isOwnAudioKey,
  isOwnRecordingKey,
  isStagedKeyFor,
  MARK_KINDS,
  MARK_PREFIX,
  parseRecordingKey,
} from '@/lib/recording/key-grammar'
import { markStagedCopy, markTake, readStagedMarks, readTakeMarks } from '@/lib/recording/take-mark'

const BIZ = 'fb44dd68-0000-4000-8000-000000000001'
const OTHER_BIZ = 'fb44dd68-0000-4000-8000-000000000002'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const OTHER_SESSION = '8d2e1b3c-5e4f-4a67-8b8c-9dae0f1a2b3c'
const OWN_TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const FOREIGN_TAKE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const MP4_POINTER = `app_${BIZ}_${OWN_TAKE}.mp4`

type Row = {
  id: string
  business_id: string
  staff_id: string
  customer_id: string | null
  status: string
  audio_storage_path: string | null
  duration_seconds: number | null
  store_id: string | null
}
const row = (over: Partial<Row> = {}): Row => ({
  id: SESSION,
  business_id: BIZ,
  staff_id: 'staff-1',
  customer_id: 'cust-1',
  status: 'UPLOADING',
  audio_storage_path: MP4_POINTER,
  duration_seconds: null,
  store_id: null,
  ...over,
})
const get = jest.fn(async (_id: string): Promise<Row> => row())
const synqed = { recordings: { get, update: jest.fn() } } as never
const actor = (): MintTakeActor => ({
  staffId: 'staff-1',
  businessId: BIZ,
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  bindIdentity: async () => null,
  source: 'facade',
})
const mint = (body: Record<string, unknown>) => mintTakeUploadUrl(synqed, actor(), body)
const staged = (session: string, uuid: string, mime = 'audio/webm') => composeStagedKey(BIZ, session, mime, uuid)!.key
const partialMark = (key: string) => composeMarkKey(BIZ, key, 'partial')!.key
const uploadedKeys = () => upload.mock.calls.map(([k]) => k)
let infoLog: jest.SpyInstance
const stagedLines = () =>
  infoLog.mock.calls.filter(([t]) => t === '[mint-take-url] staged upload').map(([, f]) => f as Record<string, unknown>)

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  infoLog = jest.spyOn(console, 'info').mockImplementation(() => {})
  mockSwitches.finalizeProbe = true
  held.clear()
  marks.clear()
  get.mockResolvedValue(row())
})

describe('the staged door marks the STAGED key it composed (A1)', () => {
  it('(a) row pointer .mp4, staged body with NO mimeType → exactly one mark on the staged key, none under mrk/app_', async () => {
    const res = (await mint({ stagedFor: SESSION, partial: true })) as { path: string }
    // The copy's own container is the door's default (no mimeType declared) —
    // the mark names THAT object, never a take key rebuilt from the request.
    const copy = staged(SESSION, OWN_TAKE, 'audio/webm')
    expect(res.path).toBe(copy)
    expect(uploadedKeys()).toEqual([`${MARK_PREFIX}${copy}.partial.json`])
    expect(uploadedKeys().filter((k) => k.startsWith(`${MARK_PREFIX}app_`))).toEqual([])
    expect(stagedLines()).toEqual([expect.objectContaining({ slot: 'staged', mark: 'created' })])
  })

  it('(b) no row pointer, a FOREIGN valid hint → one mark carrying the row\'s OWN session, none under mrk/app_', async () => {
    get.mockResolvedValue(row({ audio_storage_path: null }))
    const res = (await mint({ stagedFor: SESSION, stagedTake: FOREIGN_TAKE, mimeType: 'audio/mp4', partial: true })) as {
      path: string
    }
    expect(res.path).toBe(staged(SESSION, FOREIGN_TAKE, 'audio/mp4'))
    expect(uploadedKeys()).toEqual([`${MARK_PREFIX}stg/${BIZ}_${SESSION}_${FOREIGN_TAKE}.mp4.partial.json`])
    expect(uploadedKeys().filter((k) => k.startsWith(`${MARK_PREFIX}app_`))).toEqual([])
    const parsed = parseRecordingKey(uploadedKeys()[0], BIZ)
    expect(parsed).toEqual({
      kind: 'mark',
      target: { kind: 'staged', sessionId: SESSION, uuid: FOREIGN_TAKE, ext: 'mp4' },
      mark: 'partial',
    })
  })

  it('(c) the random-fallback slot → NO mark, slot random_fallback', async () => {
    get.mockResolvedValue(row({ audio_storage_path: null }))
    for (const body of [
      { stagedFor: SESSION, mimeType: 'audio/webm', partial: true },
      { stagedFor: SESSION, stagedTake: 'NOT-A-UUID', mimeType: 'audio/webm', partial: true },
      { stagedFor: SESSION, stagedTake: FOREIGN_TAKE.toUpperCase(), mimeType: 'audio/webm', partial: true },
    ]) {
      const res = (await mint(body)) as { path: string }
      expect(isStagedKeyFor(res.path, BIZ, SESSION)).toBe(true)
    }
    expect(upload).not.toHaveBeenCalled()
    expect(stagedLines()).toEqual([
      expect.objectContaining({ slot: 'random_fallback', mark: 'no_take_key' }),
      expect.objectContaining({ slot: 'random_fallback', mark: 'no_take_key' }),
      expect.objectContaining({ slot: 'random_fallback', mark: 'no_take_key' }),
    ])
  })

  it('(d) the existing-object sub-branch → nothing signed, the same staged-key rule (pointer and foreign hint)', async () => {
    const withPointer = staged(SESSION, OWN_TAKE)
    held.set(withPointer, 900)
    await expect(mint({ stagedFor: SESSION, stagedTake: OWN_TAKE, mimeType: 'audio/webm', partial: true })).resolves.toEqual(
      expect.objectContaining({ path: withPointer, existingSize: 900 }),
    )
    get.mockResolvedValue(row({ audio_storage_path: null }))
    const foreign = staged(SESSION, FOREIGN_TAKE)
    held.set(foreign, 700)
    await expect(mint({ stagedFor: SESSION, stagedTake: FOREIGN_TAKE, mimeType: 'audio/webm', partial: true })).resolves.toEqual(
      expect.objectContaining({ path: foreign, existingSize: 700 }),
    )
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    expect(uploadedKeys()).toEqual([partialMark(withPointer), partialMark(foreign)])
  })

  it('(e) finalizeProbe OFF → no mark, no extra storage call, the build-31 answer byte-identical', async () => {
    mockSwitches.finalizeProbe = false
    const body = { stagedFor: SESSION, stagedTake: OWN_TAKE, mimeType: 'audio/webm' }
    const plain = await mint(body)
    const calls = { info: info.mock.calls.length, sign: createSignedUploadUrl.mock.calls.length }
    const withPartial = await mint({ ...body, partial: true })
    expect(JSON.stringify(withPartial)).toBe(JSON.stringify(plain))
    expect(info.mock.calls.length).toBe(calls.info * 2)
    expect(createSignedUploadUrl.mock.calls.length).toBe(calls.sign * 2)
    expect(upload).not.toHaveBeenCalled()
    expect(stagedLines()).toEqual([expect.objectContaining({ slot: 'staged', mark: 'switch_off' })])
  })

  it('the server-named door still marks its OWN take key through markTake', async () => {
    const res = (await mint({ attachOutcome: 'no_session', partial: true })) as { path: string }
    expect(isOwnRecordingKey(res.path, BIZ)).toBe(true)
    expect(uploadedKeys()).toEqual([composeMarkKey(BIZ, res.path, 'partial')!.key])
  })
})

/** A storage fake with the three calls take-mark.ts makes, over one Map. */
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
  // Deliberately OVER-broad, like a pattern match can be: every name in the
  // folder comes back, so the reader's own parse fence is what is tested.
  const list = jest.fn(async (folder: string, _opts: unknown) => ({
    data: [...objects.keys()]
      .filter((k) => k.startsWith(`${folder}/`))
      .map((k) => ({ name: k.slice(folder.length + 1) })),
    error: null,
  }))
  const client = { storage: { from: () => ({ upload, download, list }) } } as unknown as Parameters<typeof markTake>[0]
  return { client, objects, upload, download, list }
}
const FACTS = { bytes: 1024, first_byte: 26 }

describe('two homes, by door — the writers and the readers (A3, A4)', () => {
  const takeKey = composeTakeKey(BIZ, OWN_TAKE, 'audio/webm')!.key
  const copy = composeStagedKey(BIZ, SESSION, 'audio/webm', OWN_TAKE)!.key

  it('markTake refuses a staged key; markStagedCopy refuses a take key — no storage call either way', async () => {
    const b = bucket()
    await expect(markTake(b.client, BIZ, copy, 'partial', FACTS)).resolves.toBe('error')
    await expect(markStagedCopy(b.client, BIZ, takeKey, FACTS)).resolves.toBe('error')
    await expect(markStagedCopy(b.client, OTHER_BIZ, copy, FACTS)).resolves.toBe('error')
    expect(b.upload).not.toHaveBeenCalled()
  })

  it('markStagedCopy: created, then exists; the five-key body; create-only', async () => {
    const b = bucket()
    await expect(markStagedCopy(b.client, BIZ, copy, FACTS)).resolves.toBe('created')
    await expect(markStagedCopy(b.client, BIZ, copy, FACTS)).resolves.toBe('exists')
    const [key, body, opts] = b.upload.mock.calls[0] as [string, string, unknown]
    expect(key).toBe(`${MARK_PREFIX}${copy}.partial.json`)
    expect(opts).toEqual({ upsert: false, contentType: 'application/json' })
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['at', 'bytes', 'first_byte', 'kind', 'v'])
  })

  it('(f) readStagedMarks: ONE bounded listing under mrk/stg/ for ONE session returns the staged mark; readTakeMarks does not', async () => {
    const b = bucket()
    await markStagedCopy(b.client, BIZ, copy, FACTS)
    // Decoys the over-broad listing hands back: another session's copy, and junk.
    await markStagedCopy(b.client, BIZ, composeStagedKey(BIZ, OTHER_SESSION, 'audio/webm', OWN_TAKE)!.key, FACTS)
    b.objects.set(`${MARK_PREFIX}stg/not-a-mark.json`, '{}')
    const found = await readStagedMarks(b.client, BIZ, SESSION)
    expect(found).toEqual([expect.objectContaining({ v: 1, kind: 'partial', bytes: 1024, first_byte: 26 })])
    expect(b.list).toHaveBeenCalledTimes(1)
    const [folder, opts] = b.list.mock.calls[0] as [string, { search: string; limit: number }]
    expect(folder).toBe(`${MARK_PREFIX}stg`)
    expect(opts).toEqual(expect.objectContaining({ search: `${BIZ}_${SESSION}_`, limit: expect.any(Number) }))
    expect(b.download.mock.calls.map(([k]) => k)).toEqual([`${MARK_PREFIX}${copy}.partial.json`])
    b.download.mockClear()
    await expect(readTakeMarks(b.client, BIZ, copy)).resolves.toEqual([])
    expect(b.download).not.toHaveBeenCalled()
  })

  it('readStagedMarks never throws: a failing or throwing listing answers []', async () => {
    const b = bucket()
    b.list.mockResolvedValueOnce({ data: null as never, error: { status: 500 } as never })
    await expect(readStagedMarks(b.client, BIZ, SESSION)).resolves.toEqual([])
    b.list.mockRejectedValueOnce(new Error('network'))
    await expect(readStagedMarks(b.client, BIZ, SESSION)).resolves.toEqual([])
  })
})

describe('the mrk/ grammar carries a take OR a staged key in ONE branch (A2)', () => {
  const takeKey = composeTakeKey(BIZ, OWN_TAKE, 'audio/webm')!.key
  const copy = composeStagedKey(BIZ, SESSION, 'audio/ogg', FOREIGN_TAKE)!.key

  it.each(MARK_KINDS)('a staged key round-trips compose → parse for %s', (mark) => {
    const key = composeMarkKey(BIZ, copy, mark)!.key
    expect(key).toBe(`${MARK_PREFIX}${copy}.${mark}.json`)
    expect(parseRecordingKey(key, BIZ)).toEqual({
      kind: 'mark',
      target: { kind: 'staged', sessionId: SESSION, uuid: FOREIGN_TAKE, ext: 'ogg' },
      mark,
    })
    expect(parseRecordingKey(key, OTHER_BIZ)).toBeNull()
    expect(isOwnRecordingKey(key, BIZ)).toBe(false)
    expect(isOwnAudioKey(key, BIZ)).toBe(false)
    expect(isStagedKeyFor(key, BIZ, SESSION)).toBe(false)
  })

  it('(g) mrk/ on a segment, rescue, transcript or mark key neither parses nor composes', () => {
    const inner = [
      composeSegmentKey(BIZ, OWN_TAKE, 0, 'audio/webm')!.key,
      composeRescueKey(BIZ, OWN_TAKE, 'audio/webm')!.key,
      composeTranscriptKey(BIZ, takeKey, 'ja')!.key,
      composeMarkKey(BIZ, copy, 'partial')!.key,
    ]
    for (const k of inner) {
      expect(parseRecordingKey(`${MARK_PREFIX}${k}.partial.json`, BIZ)).toBeNull()
      expect(composeMarkKey(BIZ, k, 'partial')).toBeNull()
    }
  })

  it("(g') a mark result carries no top-level takeId — staged or take target (N1)", () => {
    const stagedMark = parseRecordingKey(composeMarkKey(BIZ, copy, 'partial')!.key, BIZ)!
    const takeMark = parseRecordingKey(composeMarkKey(BIZ, takeKey, 'refused')!.key, BIZ)!
    expect('takeId' in stagedMark).toBe(false)
    expect('takeId' in takeMark).toBe(false)
    expect('takeKey' in takeMark).toBe(false)
  })

  it('composeStagedKey answers the uuid its slot holds — the hint, or the random fallback (A6)', () => {
    expect(composeStagedKey(BIZ, SESSION, 'audio/webm', FOREIGN_TAKE)!.uuid).toBe(FOREIGN_TAKE)
    const fallback = composeStagedKey(BIZ, SESSION, 'audio/webm', 'nope')!
    expect(fallback.uuid).not.toBe('nope')
    expect(fallback.key.endsWith(`_${fallback.uuid}.webm`)).toBe(true)
  })
})
