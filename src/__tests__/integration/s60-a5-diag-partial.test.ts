/**
 * S60 A5 + A4b (REV 2.3 A1 + A5) — `partial` and `diag` on both strict schemas.
 *
 * Build 32 may add two OPTIONAL fields; build 31 sends neither and must see
 * nothing change. `diag` is numbers, flags and one short code — bounded, strict,
 * no free text. `partial: true` writes ONE create-only `partial` mark: at the
 * mint for the server-named door (on its own key, after signing) and for the
 * STAGED door (on the STAGED key it composed for that copy — PR-K A1; none
 * when the slot's uuid is the random fallback), and on finalize's fresh path.
 * The switch `finalizeProbe` OFF gates every mark: the fields are accepted,
 * folded into the log line only, and nothing is written.
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

/** The fake bucket: `held` answers `info` (object there), `marks` are the `mrk/` creates. */
const held = new Map<string, number>()
const marks = new Set<string>()
const info = jest.fn(async (key: string) =>
  held.has(key)
    ? { data: { size: held.get(key) } as { size?: number } | null, error: null }
    : { data: null, error: { ...OBJECT_NOT_FOUND } as { message: string; status?: number } | null },
)
const createSignedUrl = jest.fn(async (key: string, _ttl: number) => ({
  data: { signedUrl: `https://proj.supabase.co/sign/${key}` } as { signedUrl: string } | null,
  error: null as { message: string } | null,
}))
const createSignedUploadUrl = jest.fn(async (path: string) => ({
  data: { path, signedUrl: `https://proj.supabase.co/upload/${path}`, token: 'tok-1' } as {
    path: string
    signedUrl: string
    token: string
  } | null,
  error: null as { message: string; statusCode?: string } | null,
}))
const upload = jest.fn(async (key: string, _body: string, _opts: unknown) => {
  if (marks.has(key)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
  marks.add(key)
  return { data: { path: key }, error: null }
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: { from: (_b: string) => ({ info, createSignedUrl, createSignedUploadUrl, upload }) },
  }),
}))

import { OBJECT_NOT_FOUND } from './helpers/storage-fakes'
import {
  DIAG_CODE_MAX_CHARS,
  DIAG_MAX_BLOB_BYTES,
  DIAG_MAX_BYTE_VALUE,
  FinalizeTakeSchema,
  MAX_TAKE_BYTES,
  UploadUrlMintSchema,
} from '@/lib/app-api/record-schemas'
import { finalizeTakeWithClient, type FinalizeTakeActor } from '@/lib/recording/finalize-take'
import { mintTakeUploadUrl, type MintTakeActor } from '@/lib/recording/mint-take-url'
import { composeMarkKey, composeStagedKey } from '@/lib/recording/key-grammar'
import { rangedHeadFetch, WEBM_HEAD } from './helpers/container-head-fetch'
import { TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const KEY = `app_${BIZ}_${TAKE}.webm`
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const SERVER_KEY = new RegExp(`^app_${BIZ}_([0-9a-f-]{36})\\.webm$`)
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
const FLAT_DIAG = Object.fromEntries(Object.entries(DIAG).map(([k, v]) => [`diag_${k}`, v]))
const markKey = (takeKey: string) => composeMarkKey(BIZ, takeKey, 'partial')!.key
const markBodies = () => upload.mock.calls.map(([, body]) => JSON.parse(body) as { kind: string })

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
const update = jest.fn(async (id: string, _input: unknown): Promise<Row> => row({ id }))
const synqed = { recordings: { get, update } } as never

const fetchMock = jest.fn()
const originalFetch = global.fetch
let infoLog: jest.SpyInstance
const logged = (tag: string) =>
  infoLog.mock.calls.filter(([t]) => t === tag).map(([, fields]) => fields as Record<string, unknown>)

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  infoLog = jest.spyOn(console, 'info').mockImplementation(() => {})
  mockSwitches.finalizeProbe = true
  held.clear()
  marks.clear()
  get.mockResolvedValue(row())
  fetchMock.mockImplementation(rangedHeadFetch(206, WEBM_HEAD))
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

// ── The schemas ────────────────────────────────────────────────────────────
const FINALIZE_BODY = {
  takeId: TAKE,
  mimeType: 'audio/webm',
  durationSeconds: 42.7,
  byteLength: 1024,
  recordingSessionId: SESSION,
}
const finalizeParses = (diag: unknown) => FinalizeTakeSchema.safeParse({ ...FINALIZE_BODY, diag }).success
const mintParses = (diag: unknown) => UploadUrlMintSchema.safeParse({ diag }).success

describe('diag validation — numbers, flags and one short code, nothing else', () => {
  it('accepts a full valid diag (and partial) on both schemas', () => {
    expect(FinalizeTakeSchema.safeParse({ ...FINALIZE_BODY, partial: true, diag: DIAG }).success).toBe(true)
    expect(UploadUrlMintSchema.safeParse({ partial: true, diag: DIAG }).success).toBe(true)
    expect(UploadUrlMintSchema.safeParse({ stagedFor: SESSION, stagedTake: TAKE, partial: true, diag: DIAG }).success).toBe(true)
  })

  it('rejects a string in a numeric field', () => {
    expect(finalizeParses({ ...DIAG, seq_count: '40' })).toBe(false)
    expect(mintParses({ ...DIAG, blob_bytes: '1024' })).toBe(false)
  })

  it('rejects an out-of-bound int — above the named ceiling, negative, fractional', () => {
    expect(finalizeParses({ ...DIAG, first_byte: DIAG_MAX_BYTE_VALUE + 1 })).toBe(false)
    expect(mintParses({ ...DIAG, seq_min: -1 })).toBe(false)
    expect(mintParses({ ...DIAG, hidden_count: 1.5 })).toBe(false)
  })

  it('reads ONE take-byte ceiling — the diag may not report a blob larger than a take may be', () => {
    expect(DIAG_MAX_BLOB_BYTES).toBe(MAX_TAKE_BYTES)
  })

  it('rejects an unknown key (strict)', () => {
    expect(finalizeParses({ ...DIAG, note: 'x' })).toBe(false)
    expect(mintParses({ ...DIAG, userAgent: 'Mozilla' })).toBe(false)
  })

  it('rejects free text in pump_stop_code', () => {
    expect(finalizeParses({ ...DIAG, pump_stop_code: 'Stopped by user!' })).toBe(false)
    expect(mintParses({ ...DIAG, pump_stop_code: 'a'.repeat(DIAG_CODE_MAX_CHARS + 1) })).toBe(false)
    expect(mintParses({ ...DIAG, pump_stop_code: '' })).toBe(false)
  })

  it('a build-31 body parses to exactly what it did — no partial, no diag key appears', () => {
    const f = FinalizeTakeSchema.safeParse(FINALIZE_BODY)
    expect(f.success && f.data).toEqual(FINALIZE_BODY)
    const m = UploadUrlMintSchema.safeParse({ attachOutcome: 'no_session' })
    expect(m.success && m.data).toEqual({ attachOutcome: 'no_session' })
  })
})

// ── The mint ───────────────────────────────────────────────────────────────
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
const stagedKey = () => composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)!.key

describe('the mint refine — partial/diag ride only on a server-named or a staged body', () => {
  it('a client-named write-once body with partial is refused, before any storage call', async () => {
    const body = { takeId: TAKE, mimeType: 'audio/webm', recordingSessionId: SESSION, partial: true }
    expect(UploadUrlMintSchema.safeParse(body).success).toBe(false)
    expect(UploadUrlMintSchema.safeParse({ takeId: TAKE, mimeType: 'audio/webm', recordingSessionId: SESSION, seqs: [0], diag: DIAG }).success).toBe(false)
    await expect(mint(body)).resolves.toEqual({ error: 'bad_input' })
    expect(info).not.toHaveBeenCalled()
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('the server-named door', () => {
  it('partial:true → ONE partial mark on the signed key, after signing; diag folded into the count line', async () => {
    const res = (await mint({ attachOutcome: 'no_session', partial: true, diag: DIAG })) as { path: string }
    expect(res.path).toMatch(SERVER_KEY)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(markKey(res.path))
    expect(markBodies()).toEqual([expect.objectContaining({ kind: 'partial', bytes: 1024, first_byte: 26 })])
    expect(upload.mock.invocationCallOrder[0]).toBeGreaterThan(createSignedUploadUrl.mock.invocationCallOrder[0])
    expect(logged('[mint-take-url] unbound upload')).toEqual([
      expect.objectContaining({ partial: true, mark: 'created', ...FLAT_DIAG }),
    ])
  })

  it('signing fails → no mark at all', async () => {
    createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: 'boom', statusCode: '500' } })
    await expect(mint({ attachOutcome: 'no_session', partial: true })).resolves.toEqual({ error: 'upstream' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('a build-31 body → the same answer shape and the same four-key count line, no mark', async () => {
    const res = await mint({ attachOutcome: 'no_session' })
    expect(Object.keys(res).sort()).toEqual(['contentType', 'path', 'recordingSessionId', 'token', 'url'])
    expect(upload).not.toHaveBeenCalled()
    expect(logged('[mint-take-url] unbound upload')).toEqual([
      { businessId: BIZ, attachOutcome: 'no_session', switchOn: false, bound: false },
    ])
  })
})

// PR-K K5: RULING A1 — the staged mark lives on the STAGED key, row pointer or not.
describe('the staged door (PR-K A1) — the mark lands on the STAGED key', () => {
  // PR-K K5: RULING A1 — the staged mark lives on the STAGED key, row pointer or not.
  it('the actual staged body with partial:true → exactly one partial mark on the staged key, after signing', async () => {
    const res = await mint({ ...STAGED_BODY, partial: true, diag: DIAG })
    expect(res).toEqual(expect.objectContaining({ path: stagedKey(), recordingSessionId: SESSION }))
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledTimes(1)
    // PR-K K5: RULING A1 — the staged mark lives on the STAGED key, row pointer or not.
    expect(upload.mock.calls[0][0]).toBe(markKey(stagedKey()))
    expect(markBodies()).toEqual([expect.objectContaining({ kind: 'partial' })])
    expect(upload.mock.invocationCallOrder[0]).toBeGreaterThan(createSignedUploadUrl.mock.invocationCallOrder[0])
    expect(logged('[mint-take-url] staged upload')).toEqual([
      // PR-K K4/K5: the slot union is 'staged' | 'random_fallback'; 'take' is gone.
      expect.objectContaining({ slot: 'staged', partial: true, mark: 'created', ...FLAT_DIAG }),
    ])
  })

  // PR-K K5: RULING A1 — the staged mark lives on the STAGED key, row pointer or not.
  it('the row outranks the hint: no stagedTake, the row pointer names the take → the mark is on that take\'s staged copy', async () => {
    await mint({ stagedFor: SESSION, mimeType: 'audio/webm', partial: true })
    // PR-K K5: RULING A1 — the staged mark lives on the STAGED key, row pointer or not.
    expect(upload.mock.calls.map(([k]) => k)).toEqual([markKey(stagedKey())])
  })

  // PR-K K5: RULING A1 — the staged mark lives on the STAGED key, row pointer or not.
  it('the existing-object sub-branch → nothing signed, still exactly one partial mark on the staged key', async () => {
    held.set(stagedKey(), 900)
    const res = await mint({ ...STAGED_BODY, partial: true })
    expect(res).toEqual(expect.objectContaining({ path: stagedKey(), existingSize: 900 }))
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    // PR-K K5: RULING A1 — the staged mark lives on the STAGED key, row pointer or not.
    expect(upload.mock.calls.map(([k]) => k)).toEqual([markKey(stagedKey())])
  })

  it('signing fails → no mark', async () => {
    createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: 'boom', statusCode: '500' } })
    await expect(mint({ ...STAGED_BODY, partial: true })).resolves.toEqual({ error: 'upstream' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('the random-fallback slot (no row pointer, no usable hint) → NO mark, and the line says so', async () => {
    get.mockResolvedValue(row({ audio_storage_path: null }))
    for (const body of [
      { stagedFor: SESSION, mimeType: 'audio/webm', partial: true },
      { stagedFor: SESSION, stagedTake: 'not-a-uuid', mimeType: 'audio/webm', partial: true },
    ]) {
      const res = (await mint(body)) as { path: string }
      expect(res.path).toBeDefined()
    }
    expect(upload).not.toHaveBeenCalled()
    expect(logged('[mint-take-url] staged upload')).toEqual([
      expect.objectContaining({ slot: 'random_fallback', mark: 'no_take_key' }),
      expect.objectContaining({ slot: 'random_fallback', mark: 'no_take_key' }),
    ])
  })

  it('a build-31 staged body → no mark and no new log line', async () => {
    await mint(STAGED_BODY)
    expect(upload).not.toHaveBeenCalled()
    expect(logged('[mint-take-url] staged upload')).toEqual([])
  })
})

describe('switch OFF (REV 2.3 A5) — accepted, logged, zero added storage calls, answers unchanged', () => {
  beforeEach(() => {
    mockSwitches.finalizeProbe = false
  })

  it('staged door: the answer equals the build-31 answer; no mark; the fields reach the log line', async () => {
    const plain = await mint(STAGED_BODY)
    const calls = { info: info.mock.calls.length, sign: createSignedUploadUrl.mock.calls.length }
    const withFields = await mint({ ...STAGED_BODY, partial: true, diag: DIAG })
    expect(withFields).toEqual(plain)
    expect(info.mock.calls.length).toBe(calls.info * 2)
    expect(createSignedUploadUrl.mock.calls.length).toBe(calls.sign * 2)
    expect(upload).not.toHaveBeenCalled()
    expect(logged('[mint-take-url] staged upload')).toEqual([
      expect.objectContaining({ partial: true, mark: 'switch_off', ...FLAT_DIAG }),
    ])
  })

  it('server-named door: same answer shape, one sign each, no mark; the fields reach the count line', async () => {
    const plain = (await mint({ attachOutcome: 'no_session' })) as Record<string, unknown>
    const withFields = (await mint({ attachOutcome: 'no_session', partial: true, diag: DIAG })) as Record<string, unknown>
    const normal = (r: Record<string, unknown>) => ({ ...r, path: 'P', url: 'U' })
    expect(normal(withFields)).toEqual(normal(plain))
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(2)
    expect(upload).not.toHaveBeenCalled()
    expect(logged('[mint-take-url] unbound upload')[1]).toEqual(
      expect.objectContaining({ partial: true, mark: 'switch_off', ...FLAT_DIAG }),
    )
  })
})

// ── Finalize ───────────────────────────────────────────────────────────────
const finActor: FinalizeTakeActor = {
  staffId: 'staff-1',
  businessId: BIZ,
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  source: 'facade',
}
const finalize = (extra: Record<string, unknown> = {}) =>
  finalizeTakeWithClient(synqed, finActor, { ...FINALIZE_BODY, ...extra } as never)
const finalizedDetail = () => {
  const events = auditFn.mock.calls.map(([e]) => e as { action: string; detail: Record<string, unknown> })
  expect(events.map((e) => e.action)).toEqual(['recording.capture_finalized'])
  return events[0].detail
}
const BUILD_31_DETAIL = {
  recording_session_id: SESSION,
  take_id: TAKE,
  bytes: 1024,
  duration_seconds: 42,
  ext: 'webm',
  customer_id: 'cust-1',
  staff_id: 'staff-1',
  size_verified: true,
}

describe('finalize — the fresh path', () => {
  beforeEach(() => {
    held.set(KEY, 1024)
  })

  it('partial:true + diag → one partial mark, flat diag_* keys in the finalized detail, one log line', async () => {
    await expect(finalize({ partial: true, diag: DIAG })).resolves.toEqual({ ok: true, recordingSessionId: SESSION })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(markKey(KEY))
    expect(markBodies()).toEqual([expect.objectContaining({ kind: 'partial', bytes: 1024, first_byte: 26 })])
    const detail = finalizedDetail()
    expect(detail).toEqual({ ...BUILD_31_DETAIL, ...FLAT_DIAG })
    expect(detail).not.toHaveProperty('diag')
    expect(Object.values(detail).every((v) => v === null || typeof v !== 'object')).toBe(true)
    expect(logged('[finalize-take] take diag')).toEqual([
      expect.objectContaining({ takeId: TAKE, partial: true, mark: 'created', switchOn: true, ...FLAT_DIAG }),
    ])
  })

  it('a build-31 body → the detail it always had, no mark, no log line', async () => {
    await expect(finalize()).resolves.toEqual({ ok: true, recordingSessionId: SESSION })
    expect(finalizedDetail()).toEqual(BUILD_31_DETAIL)
    expect(upload).not.toHaveBeenCalled()
    expect(logged('[finalize-take] take diag')).toEqual([])
  })

  it('switch OFF + partial + diag → no sign, no fetch, no mark, the build-31 answer and detail; the log line only', async () => {
    mockSwitches.finalizeProbe = false
    await expect(finalize({ partial: true, diag: DIAG })).resolves.toEqual({ ok: true, recordingSessionId: SESSION })
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    expect(finalizedDetail()).toEqual(BUILD_31_DETAIL)
    expect(logged('[finalize-take] take diag')).toEqual([
      expect.objectContaining({ partial: true, mark: null, switchOn: false, ...FLAT_DIAG }),
    ])
  })
})
