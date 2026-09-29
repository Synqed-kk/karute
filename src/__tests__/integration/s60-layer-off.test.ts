/**
 * S60 PR-A — THE LAYER-OFF MATRIX (frozen R11 + T6, REV 2.3 A5 + A6).
 *
 * `RECORDING_SWITCHES.finalizeProbe` OFF must be pre-PR-A behaviour exactly:
 * the ORIGINAL pre-CG4 mocks (finalize: a bucket that answers `info` and
 * nothing else, no fetch stub; the meter: the spend-wall's pre-S60 bucket and
 * fetch) pass the ORIGINAL assertions unchanged, and every storage call PR-A
 * added is counted at ZERO — `createSignedUrl`, the `mrk/` upload, the ranged
 * probe GET — at finalize, at the mint and at the meter (both arms). A build-32
 * body carrying `partial`/`diag` under OFF is accepted and changes nothing a
 * storage server or a phone can see (both doors).
 *
 * ON, the cost T7 states is MEASURED here: finalize goes from 1 storage
 * round-trip to exactly 3 — info, one sign, one ranged GET. And the A6 mutant
 * killers that no other file owns: the meter writes ZERO marks (M-A7), and an
 * MP4 head under a `.webm` key is readable through finalize AND the meter —
 * the verdict is never keyed on the extension (M-A8).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-local.supabase.co'
process.env.SPEAKER_ID_MODE = 'off'
process.env.DEEPGRAM_API_KEY ??= 'test-deepgram-key'

jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (e: unknown) => auditFn(e),
}))

// A getter, not a value (the s60-a2 idiom): modules that read the registry at
// load time run before this file's own consts are initialised.
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

// ── THE PROVIDER — the meter's money, counted ──────────────────────────────
const mockDeepgram = {
  url: jest.fn(async (..._a: unknown[]) => ({
    transcript: 'こんにちは',
    durationSec: 5400,
    requestId: 'dg-1',
    confidence: 0.9,
    words: [],
    paragraphs: [],
  })),
  buffer: jest.fn(async (..._a: unknown[]) => ({
    transcript: 'こんにちは',
    durationSec: 5400,
    requestId: 'dg-1',
    confidence: 0.9,
    words: [],
    paragraphs: [],
  })),
}
jest.mock('@/lib/deepgram', () => ({
  ...jest.requireActual('@/lib/deepgram'),
  transcribeUrlWithDeepgram: (...a: unknown[]) => mockDeepgram.url(...a),
  transcribeWithDeepgram: (...a: unknown[]) => mockDeepgram.buffer(...a),
}))

// ── THE BUCKET — one shape per door, every method call counted ─────────────
/** Every storage method call, in order, as `[method, key]`. */
const mockStorageCalls: Array<[string, string]> = []
/** A method the door's ORIGINAL mock never had, reached anyway. */
const mockStray: string[] = []
/** The methods the bucket answers right now — the door's original shape. */
const mockBucket: { shape: readonly string[] } = { shape: [] }
const mockMarks = new Set<string>()
const mockHeld = new Map<string, number>()
const mockAnswer = async (method: string, key: string, body?: unknown, opts?: { upsert?: boolean }) => {
  switch (method) {
    case 'info':
      return mockHeld.has(key)
        ? { data: { size: mockHeld.get(key) }, error: null }
        : { data: null, error: { message: 'Object not found', status: 404, statusCode: '404' } }
    case 'createSignedUrl':
      return { data: { signedUrl: `https://proj.supabase.co/sign/${key}` }, error: null }
    case 'createSignedUploadUrl':
      return { data: { path: key, signedUrl: `https://proj.supabase.co/upload/${key}`, token: 'tok-1' }, error: null }
    case 'download':
      return { data: null, error: { status: 400, statusCode: '404', message: 'Object not found' } }
    case 'upload':
      void body
      if (mockMarks.has(key) && !opts?.upsert) {
        return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
      }
      mockMarks.add(key)
      return { data: { path: key }, error: null }
    default:
      throw new Error(`unexpected storage method ${method}`)
  }
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: (_b: string) =>
        new Proxy(
          {},
          {
            get: (_t, prop) => {
              if (typeof prop !== 'string' || prop === 'then') return undefined
              // The original mock did not HAVE this method: calling it is the
              // TypeError the original suite would have thrown.
              if (!mockBucket.shape.includes(prop)) {
                mockStray.push(prop)
                return undefined
              }
              return (key: string, body?: unknown, opts?: { upsert?: boolean }) => {
                mockStorageCalls.push([prop, key])
                return mockAnswer(prop, key, body, opts)
              }
            },
          },
        ),
    },
  }),
}))

import { finalizeTakeWithClient, type FinalizeTakeActor } from '@/lib/recording/finalize-take'
import { mintTakeUploadUrl, type MintTakeActor } from '@/lib/recording/mint-take-url'
import { runMeteredTranscription } from '@/lib/ai/transcribe'
import { composeStagedKey } from '@/lib/recording/key-grammar'
import type { SynqedClient } from '@synqed-kk/client'
import { HEADERLESS_HEAD, WEBM_HEAD } from './helpers/container-head-fetch'
import { conformingKey, TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const KEY = `app_${BIZ}_${TAKE}.webm`
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
/** An ISO-BMFF head (`ftyp` at 4, brand `isom`) — what Safari's recorder writes. */
const MP4_HEAD = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0])
const DIAG = {
  arm: 'stored',
  seq_min: 0,
  seq_max: 41,
  seq_count: 40,
  seq0_present: true,
  blob_bytes: 1024,
  first_byte: 26,
  store_error_count: 1,
  pump_stop_code: 'track_ended',
  hidden_count: 2,
  freeze_count: 0,
  session_null_count: 0,
} as const
/** The original shapes, door by door (the pre-CG4 mocks). */
const FINALIZE_ORIGINAL = ['info'] as const
const MINT_ORIGINAL = ['info', 'createSignedUploadUrl'] as const
const METER_ORIGINAL = ['createSignedUrl', 'download', 'upload', 'info'] as const
/** The ON shape: finalize's bucket gains the sign and the mark. */
const FINALIZE_ON = ['info', 'createSignedUrl', 'upload'] as const

// ── FETCH — the stored head, the reserve's HEAD, and nothing else ──────────
const headOf: { current: Uint8Array } = { current: WEBM_HEAD }
const rangeOf = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Range
const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
  if (rangeOf(init)) return new Response(headOf.current.slice(), { status: 206 })
  if (init?.method === 'HEAD') return { headers: new Headers({ 'content-length': '32400000' }) } as Response
  throw new Error('layer-off: no other fetch is expected')
})
const originalFetch = global.fetch
const probeGets = () => fetchMock.mock.calls.filter(([, init]) => rangeOf(init)).length
const calls = (method: string) => mockStorageCalls.filter(([m]) => m === method).length
const markUploads = () => mockStorageCalls.filter(([m, k]) => m === 'upload' && k.startsWith('mrk/')).length

/** The zero PR-A owes under OFF: no sign, no mark, no probe GET, no stray method. */
function expectZeroAdded(): void {
  expect(calls('createSignedUrl')).toBe(0)
  expect(markUploads()).toBe(0)
  expect(probeGets()).toBe(0)
  expect(mockStray).toEqual([])
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  mockSwitches.finalizeProbe = true
  mockStorageCalls.length = 0
  mockStray.length = 0
  mockMarks.clear()
  mockHeld.clear()
  headOf.current = WEBM_HEAD
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

// ── FINALIZE ───────────────────────────────────────────────────────────────
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
  audio_storage_path: KEY,
  duration_seconds: null,
  store_id: null,
  ...over,
})
const get = jest.fn(async (_id: string): Promise<Row> => row())
const create = jest.fn(async (_input: unknown): Promise<Row> => row({ id: 'sess-new' }))
const update = jest.fn(async (id: string, _input: unknown): Promise<Row> => row({ id }))
const synqed = { recordings: { get, create, update } } as never
const actor: FinalizeTakeActor = {
  staffId: 'staff-1',
  businessId: BIZ,
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  source: 'web',
}
const input = {
  takeId: TAKE,
  mimeType: 'audio/webm',
  durationSeconds: 42.7,
  byteLength: 1024,
  recordingSessionId: SESSION,
}
const finalize = (extra: Record<string, unknown> = {}) =>
  finalizeTakeWithClient(synqed, actor, { ...input, ...extra } as never)

/** The ORIGINAL happy-path assertions (recording-finalize-take.test.ts at BASE), unchanged. */
async function expectOriginalFinalize(res: unknown): Promise<void> {
  expect(res).toEqual({ ok: true, recordingSessionId: SESSION })
  expect(mockStorageCalls[0]).toEqual(['info', KEY])
  expect(update).toHaveBeenCalledWith(SESSION, { duration_seconds: 42, status: 'UPLOADING' })
  expect(create).not.toHaveBeenCalled()
  expect(auditFn).toHaveBeenCalledTimes(1)
  const [event] = auditFn.mock.calls[0] as [Record<string, unknown>]
  expect(event).toMatchObject({
    category: 'recording',
    action: 'recording.capture_finalized',
    actorId: 'staff-1',
    businessId: BIZ,
    targetType: 'recording',
    targetId: SESSION,
    severity: 'notice',
    source: 'web',
  })
  expect(event.detail).toEqual({
    recording_session_id: SESSION,
    take_id: TAKE,
    bytes: 1024,
    duration_seconds: 42,
    ext: 'webm',
    customer_id: 'cust-1',
    staff_id: 'staff-1',
    size_verified: true,
  })
}

describe('layer-off — finalize, the ORIGINAL mocks (a bucket with `info` only, no fetch stub)', () => {
  beforeEach(() => {
    mockSwitches.finalizeProbe = false
    mockBucket.shape = FINALIZE_ORIGINAL
    mockHeld.set(KEY, 1024)
    get.mockResolvedValue(row())
  })

  it('a readable take: the original assertions pass; one storage call (info); zero sign, mark, probe GET', async () => {
    await expectOriginalFinalize(await finalize())
    expect(mockStorageCalls).toEqual([['info', KEY]])
    expectZeroAdded()
  })

  it('a HEADERLESS take: still today\'s answer byte for byte — OFF never looks at the bytes', async () => {
    headOf.current = HEADERLESS_HEAD
    await expectOriginalFinalize(await finalize())
    expect(mockStorageCalls).toEqual([['info', KEY]])
    expectZeroAdded()
  })

  it('a build-32 body (partial + diag) under OFF: the build-31 answer and detail, the same one storage call', async () => {
    await expectOriginalFinalize(await finalize({ partial: true, diag: DIAG }))
    expect(mockStorageCalls).toEqual([['info', KEY]])
    expectZeroAdded()
  })
})

describe('layer-on — finalize, T7 measured: 1 → 3 storage round-trips', () => {
  beforeEach(() => {
    mockBucket.shape = FINALIZE_ON
    mockHeld.set(KEY, 1024)
    get.mockResolvedValue(row())
  })

  it('a readable take: exactly info + one sign + one ranged GET, then the original answer', async () => {
    await expectOriginalFinalize(await finalize())
    expect(mockStorageCalls).toEqual([
      ['info', KEY],
      ['createSignedUrl', KEY],
    ])
    expect(probeGets()).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(markUploads()).toBe(0)
  })

  it('M-A8 — an MP4 head under a .webm key is READABLE: the original answer, no mark (never keyed on the extension)', async () => {
    headOf.current = MP4_HEAD
    await expectOriginalFinalize(await finalize())
    expect(probeGets()).toBe(1)
    expect(markUploads()).toBe(0)
  })
})

// ── THE MINT (the second door for partial/diag) ────────────────────────────
const mintActor = (): MintTakeActor => ({
  staffId: 'staff-1',
  businessId: BIZ,
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  bindIdentity: async () => null,
  source: 'facade',
})
const mint = (body: Record<string, unknown>) => mintTakeUploadUrl(synqed, mintActor(), body)
const STAGED_BODY = { stagedFor: SESSION, stagedTake: TAKE, mimeType: 'audio/webm' }
const methods = () => mockStorageCalls.map(([m]) => m)

describe('layer-off — the mint door, a build-32 body under OFF (REV 2.3 A5)', () => {
  beforeEach(() => {
    mockSwitches.finalizeProbe = false
    mockBucket.shape = MINT_ORIGINAL
    get.mockResolvedValue(row())
  })

  it('staged door: the same answer and the SAME storage calls as the build-31 body; zero added', async () => {
    const plain = await mint(STAGED_BODY)
    const plainCalls = [...mockStorageCalls]
    mockStorageCalls.length = 0
    const withFields = await mint({ ...STAGED_BODY, partial: true, diag: DIAG })
    expect(withFields).toEqual(plain)
    expect(plain).toHaveProperty('path', composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)!.key)
    expect(mockStorageCalls).toEqual(plainCalls)
    expect(plainCalls.some(([, k]) => k === composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)!.key)).toBe(true)
    expect(calls('upload')).toBe(0)
    expectZeroAdded()
  })

  it('server-named door: the same answer shape and the same storage methods as the build-31 body; zero added', async () => {
    const plain = (await mint({ attachOutcome: 'no_session' })) as Record<string, unknown>
    const plainMethods = methods()
    mockStorageCalls.length = 0
    const withFields = (await mint({ attachOutcome: 'no_session', partial: true, diag: DIAG })) as Record<
      string,
      unknown
    >
    const normal = (r: Record<string, unknown>) => ({ ...r, path: 'P', url: 'U' })
    expect(normal(withFields)).toEqual(normal(plain))
    expect(plain).toHaveProperty('path')
    expect(methods()).toEqual(plainMethods)
    expect(calls('upload')).toBe(0)
    expectZeroAdded()
  })
})

// ── THE METER ──────────────────────────────────────────────────────────────
const consume = jest.fn(async (_route: string) => ({
  allowed: true,
  reason: 'ok',
  cap: 100,
  used: 1,
  remaining: 99,
  costCap: 3000,
  costUsed: 10,
  resetAt: '2026-09-09T00:00:00.000Z',
}))
const recordUsage = jest.fn(async (..._a: unknown[]) => {})
const meterClient = { aiRateLimit: { consume, recordUsage } } as unknown as Pick<SynqedClient, 'aiRateLimit'>
const meterCall = (audio: { url: string } | { buffer: Buffer; mimeType: string }, audioKey: string | null = null) =>
  runMeteredTranscription(
    { synqed: meterClient, businessId: BIZ, door: 'app', audioKey },
    { audio, locale: 'ja', diarize: true, reference: null, mode: 'off', businessType: null },
  )
const bufferOf = (head: Uint8Array) => Buffer.concat([Buffer.from(head), Buffer.alloc(3_000)])
/** The pre-PR-A answer, recorded ON with a readable audio on the same arm. */
async function readableAnswer(audio: { url: string } | { buffer: Buffer; mimeType: string }): Promise<string> {
  mockSwitches.finalizeProbe = true
  headOf.current = WEBM_HEAD
  const on = await meterCall(audio)
  jest.clearAllMocks()
  mockStorageCalls.length = 0
  return JSON.stringify(on)
}

describe('layer-off — the meter, the ORIGINAL spend-wall bucket and fetch, both arms', () => {
  beforeEach(() => {
    mockBucket.shape = METER_ORIGINAL
  })

  it('URL arm, a headerless object: paid for exactly as before — the answer byte-identical; zero sign, mark, probe GET', async () => {
    const before = await readableAnswer({ url: 'https://x/audio' })
    mockSwitches.finalizeProbe = false
    headOf.current = HEADERLESS_HEAD

    const off = await meterCall({ url: 'https://x/audio' })

    expect(JSON.stringify(off)).toBe(before)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalled()
    expect(mockDeepgram.url).toHaveBeenCalledTimes(1)
    // The reserve's own HEAD is the one fetch — it predates PR-A.
    expect(fetchMock.mock.calls.map(([, i]) => (i as RequestInit | undefined)?.method)).toEqual(['HEAD'])
    expectZeroAdded()
    expect(calls('upload')).toBe(0)
  })

  it('buffer arm, headerless bytes: paid for exactly as before — the answer byte-identical; zero fetch, zero storage', async () => {
    const audio = { buffer: bufferOf(HEADERLESS_HEAD), mimeType: 'audio/webm' }
    const before = await readableAnswer({ buffer: bufferOf(WEBM_HEAD), mimeType: 'audio/webm' })
    mockSwitches.finalizeProbe = false

    const off = await meterCall(audio)

    expect(JSON.stringify(off)).toBe(before)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(mockDeepgram.buffer).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockStorageCalls).toEqual([])
    expectZeroAdded()
  })
})

describe('layer-on — the meter writes NO mark (M-A7) and never reads the extension (M-A8)', () => {
  beforeEach(() => {
    mockBucket.shape = METER_ORIGINAL
  })

  it('M-A7 — URL arm, a headerless object under an owned take key: refused with ZERO uploads of any kind', async () => {
    headOf.current = HEADERLESS_HEAD
    const err = await meterCall({ url: 'https://x/audio.webm' }, conformingKey(BIZ)).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('audio_unreadable')
    expect(calls('upload')).toBe(0)
    expect(markUploads()).toBe(0)
    expect(consume).not.toHaveBeenCalled()
  })

  it('M-A7 — buffer arm, headerless bytes under an owned take key: refused with ZERO uploads of any kind', async () => {
    const audio = { buffer: bufferOf(HEADERLESS_HEAD), mimeType: 'audio/webm' }
    const err = await meterCall(audio, conformingKey(BIZ)).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('audio_unreadable')
    expect(calls('upload')).toBe(0)
    expect(consume).not.toHaveBeenCalled()
  })

  it('M-A8 — URL arm, MP4 bytes under a .webm key: readable, consumed once, transcribed once', async () => {
    headOf.current = MP4_HEAD
    await meterCall({ url: 'https://x/audio.webm' })
    expect(probeGets()).toBe(1)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(mockDeepgram.url).toHaveBeenCalledTimes(1)
  })

  it('M-A8 — buffer arm, MP4 bytes declared audio/webm: readable, consumed once, transcribed once', async () => {
    await meterCall({ buffer: bufferOf(MP4_HEAD), mimeType: 'audio/webm' })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(mockDeepgram.buffer).toHaveBeenCalledTimes(1)
  })
})
