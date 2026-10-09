// S60 A4a — the `mrk/` grammar slot (key-grammar.ts) and the durable take mark
// (src/lib/recording/take-mark.ts). Pins:
//   - compose → parse round-trips for all four MARK_KINDS
//   - a mark key is never a take / segment / staged / rescue / transcript, and
//     neither ownership fence admits it
//   - a mark named for a rescue (or any non-take) key does not parse or compose
//   - markTake: created / exists (the duplicate shapes) / error, never throws;
//     create-only; the body is numbers and flags only
//   - readTakeMarks: four targeted downloads, no listing; latest by `at` last
import {
  composeMarkKey,
  composeRescueKey,
  composeTakeKey,
  composeTranscriptKey,
  isOwnAudioKey,
  isOwnRecordingKey,
  looksLikeRecordingKey,
  MARK_KINDS,
  MARK_PREFIX,
  parseRecordingKey,
} from '@/lib/recording/key-grammar'
import { markTake, readTakeMarks } from '@/lib/recording/take-mark'

const BIZ = 'fb44dd68-0000-4000-8000-000000000001'
const OTHER = 'fb44dd68-0000-4000-8000-000000000002'
const TAKE_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const takeKey = composeTakeKey(BIZ, TAKE_ID, 'audio/webm')!.key
const rescueKey = composeRescueKey(BIZ, TAKE_ID, 'audio/webm')!.key

describe('the mrk/ grammar slot', () => {
  it.each(MARK_KINDS)('compose → parse round-trips for %s', (mark) => {
    const composed = composeMarkKey(BIZ, takeKey, mark)
    expect(composed).not.toBeNull()
    expect(composed!.key).toBe(`${MARK_PREFIX}${takeKey}.${mark}.json`)
    // PR-K K1 (licensed): RULING A2 nests the target, and N1 needs no top-level takeId on a mark.
    expect(parseRecordingKey(composed!.key, BIZ)).toEqual({
      kind: 'mark',
      target: { kind: 'take', takeId: TAKE_ID, ext: 'webm' },
      mark,
    })
  })

  it('a mark key is never a take, segment, staged, rescue or transcript, and no fence admits it', () => {
    for (const mark of MARK_KINDS) {
      const key = composeMarkKey(BIZ, takeKey, mark)!.key
      expect(parseRecordingKey(key, BIZ)?.kind).toBe('mark')
      expect(isOwnRecordingKey(key, BIZ)).toBe(false)
      expect(isOwnAudioKey(key, BIZ)).toBe(false)
      // Another tenant never reads it at all.
      expect(parseRecordingKey(key, OTHER)).toBeNull()
    }
  })

  it('a mark on a rescue, memo or foreign key neither parses nor composes', () => {
    const memoKey = composeTranscriptKey(BIZ, takeKey, 'ja')!.key
    for (const inner of [rescueKey, memoKey, `seg/${takeKey}`, 'app_x.webm']) {
      expect(parseRecordingKey(`${MARK_PREFIX}${inner}.refused.json`, BIZ)).toBeNull()
      expect(composeMarkKey(BIZ, inner, 'refused')).toBeNull()
    }
    expect(composeMarkKey(OTHER, takeKey, 'refused')).toBeNull()
  })

  it('a kind outside the closed set, a missing suffix or a nested mark does not parse', () => {
    expect(parseRecordingKey(`${MARK_PREFIX}${takeKey}.deleted.json`, BIZ)).toBeNull()
    expect(parseRecordingKey(`${MARK_PREFIX}${takeKey}.refused`, BIZ)).toBeNull()
    expect(parseRecordingKey(`${MARK_PREFIX}${takeKey}.json`, BIZ)).toBeNull()
    const nested = composeMarkKey(BIZ, takeKey, 'refused')!.key
    expect(parseRecordingKey(`${MARK_PREFIX}${nested}.partial.json`, BIZ)).toBeNull()
    expect(composeMarkKey(BIZ, takeKey, 'ja')).toBeNull()
    expect(composeMarkKey(BIZ, takeKey, 'constructor')).toBeNull()
  })

  it('looksLikeRecordingKey treats a mark exactly as it treats a transcript memo', () => {
    const memoKey = composeTranscriptKey(BIZ, takeKey, 'ja')!.key
    const markKey = composeMarkKey(BIZ, takeKey, 'refused')!.key
    expect(looksLikeRecordingKey(markKey)).toBe(looksLikeRecordingKey(memoKey))
  })
})

type UploadResult = { error: unknown }
function storageMock(opts: {
  upload?: () => Promise<UploadResult> | UploadResult
  download?: (key: string) => Promise<{ data: { text: () => Promise<string> } | null; error: unknown }>
}) {
  const upload = jest.fn(async (..._args: unknown[]) => (opts.upload ? opts.upload() : { error: null }))
  const download = jest.fn(async (key: string) =>
    opts.download ? opts.download(key) : { data: null, error: { status: 404, statusCode: '404', message: 'Object not found' } },
  )
  const list = jest.fn()
  const from = jest.fn(() => ({ upload, download, list }))
  // The module takes Pick<SupabaseClient,'storage'>; only these members are used.
  const client = { storage: { from } } as unknown as Parameters<typeof markTake>[0]
  return { client, from, upload, download, list }
}

describe('markTake', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  it("answers 'created' on a fresh create-only upload of numbers and flags only", async () => {
    const s = storageMock({})
    await expect(markTake(s.client, BIZ, takeKey, 'refused', { bytes: 14, first_byte: 0 })).resolves.toBe('created')
    expect(s.from).toHaveBeenCalledWith('recordings')
    expect(s.upload).toHaveBeenCalledTimes(1)
    const [key, body, options] = s.upload.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(key).toBe(composeMarkKey(BIZ, takeKey, 'refused')!.key)
    expect(options).toEqual({ upsert: false, contentType: 'application/json' })
    const parsed = JSON.parse(body)
    expect(Object.keys(parsed).sort()).toEqual(['at', 'bytes', 'first_byte', 'kind', 'v'])
    expect(parsed).toMatchObject({ v: 1, kind: 'refused', bytes: 14, first_byte: 0 })
    expect(typeof parsed.at).toBe('string')
    expect(Number.isFinite(Date.parse(parsed.at))).toBe(true)
    expect(s.list).not.toHaveBeenCalled()
  })

  it.each([
    ['status 409', { status: 409 }],
    ['statusCode "409"', { statusCode: '409', message: 'x' }],
    ['the signed-upload 400 carrying Duplicate', { statusCode: '400', message: 'The resource already exists' }],
  ])("answers 'exists' on the duplicate shape (%s)", async (_label, error) => {
    const s = storageMock({ upload: () => ({ error }) })
    await expect(markTake(s.client, BIZ, takeKey, 'refused', { bytes: 1, first_byte: 0 })).resolves.toBe('exists')
  })

  it("answers 'error' on any other failure, a throw, or a key the grammar refuses — never throws", async () => {
    const failing = storageMock({ upload: () => ({ error: { status: 500, message: 'boom' } }) })
    await expect(markTake(failing.client, BIZ, takeKey, 'partial', { bytes: 1, first_byte: 0 })).resolves.toBe('error')
    const throwing = storageMock({
      upload: () => {
        throw new Error('network')
      },
    })
    await expect(markTake(throwing.client, BIZ, takeKey, 'partial', { bytes: 1, first_byte: 0 })).resolves.toBe('error')
    const refused = storageMock({})
    await expect(markTake(refused.client, BIZ, rescueKey, 'refused', { bytes: 1, first_byte: 0 })).resolves.toBe('error')
    expect(refused.upload).not.toHaveBeenCalled()
  })
})

describe('readTakeMarks', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  it('answers the latest by `at` LAST, from four targeted downloads and no listing', async () => {
    const stored: Record<string, object> = {
      [composeMarkKey(BIZ, takeKey, 'rescued')!.key]: { v: 1, kind: 'rescued', at: '2026-09-30T03:00:00.000Z', bytes: 900, first_byte: 26 },
      [composeMarkKey(BIZ, takeKey, 'refused')!.key]: { v: 1, kind: 'refused', at: '2026-09-29T10:00:00.000Z', bytes: 14, first_byte: 0 },
    }
    const s = storageMock({
      download: async (key) =>
        stored[key]
          ? { data: { text: async () => JSON.stringify(stored[key]) }, error: null }
          : { data: null, error: { status: 404, statusCode: '404', message: 'Object not found' } },
    })
    const marks = await readTakeMarks(s.client, BIZ, takeKey)
    expect(marks.map((m) => m.kind)).toEqual(['refused', 'rescued'])
    expect(marks[marks.length - 1].at).toBe('2026-09-30T03:00:00.000Z')
    expect(s.download).toHaveBeenCalledTimes(MARK_KINDS.length)
    for (const [key] of s.download.mock.calls) {
      expect(parseRecordingKey(key, BIZ)?.kind).toBe('mark')
    }
    expect(s.list).not.toHaveBeenCalled()
  })

  it('answers [] when nothing is marked, and never throws on a failing store', async () => {
    await expect(readTakeMarks(storageMock({}).client, BIZ, takeKey)).resolves.toEqual([])
    const throwing = storageMock({
      download: async () => {
        throw new Error('network')
      },
    })
    await expect(readTakeMarks(throwing.client, BIZ, takeKey)).resolves.toEqual([])
  })
})
