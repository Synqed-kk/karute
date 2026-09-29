/**
 * S60 A2 — finalize refuses a take whose stored bytes are no recording.
 *
 * The head probe (container-sniff.ts#probeObjectHead) runs only for a row this
 * call is about to finalize — never on COMPLETED, `already` or a superseded
 * row — through ONE short-lived signed URL. `unreadable` → `unreadable_object`,
 * no duration, one create-only `refused` mark, and ONE recording.finalize_refused
 * row filed only by the call whose mark was created. `unknown` → today's
 * retryable `failed`, nothing written. Switch OFF → no sign, no fetch, no mark,
 * the answer byte-identical to a readable take's.
 */

const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

// A getter, not a value: modules that read the registry at load time (the
// mint, via assembler.ts) run before this file's own consts are initialised.
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

/** The fake bucket's `mrk/` objects: a second create of one key is storage's 409. */
const marks = new Set<string>()
const info = jest.fn(async (_key: string) => ({
  data: { size: 1024 } as { size?: number } | null,
  error: null as { message: string; status?: number } | null,
}))
const createSignedUrl = jest.fn(async (key: string, _ttl: number) => ({
  data: { signedUrl: `https://proj.supabase.co/sign/${key}` } as { signedUrl: string } | null,
  error: null as { message: string } | null,
}))
const upload = jest.fn(async (key: string, _body: string, _opts: unknown) => {
  if (marks.has(key)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
  marks.add(key)
  return { data: { path: key }, error: null }
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ info, createSignedUrl, upload }) } }),
}))

import { finalizeTakeWithClient, FINALIZE_PROBE_URL_TTL_S, type FinalizeTakeActor } from '@/lib/recording/finalize-take'
import { HEADERLESS_HEAD, rangedHeadFetch, WEBM_HEAD } from './helpers/container-head-fetch'
import { TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const KEY = `app_${BIZ}_${TAKE}.webm`
const OLD_KEY = `app_${BIZ}_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webm`
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'

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
const actor: FinalizeTakeActor = {
  staffId: 'staff-1',
  businessId: BIZ,
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  source: 'facade',
}
const input = {
  takeId: TAKE,
  mimeType: 'audio/webm',
  durationSeconds: 42.7,
  byteLength: 1024,
  recordingSessionId: SESSION,
}

const fetchMock = jest.fn()
const originalFetch = global.fetch
const finalize = () => finalizeTakeWithClient(synqed, actor, input)
const actions = () => auditFn.mock.calls.map(([e]) => (e as { action: string }).action)

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  mockSwitches.finalizeProbe = true
  marks.clear()
  get.mockResolvedValue(row())
  info.mockResolvedValue({ data: { size: 1024 }, error: null })
  fetchMock.mockImplementation(rangedHeadFetch(206, WEBM_HEAD))
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

describe('a headerless object is refused', () => {
  beforeEach(() => fetchMock.mockImplementation(rangedHeadFetch(206, HEADERLESS_HEAD)))

  it('answers unreadable_object, stamps no duration, files ONE refusal row with numbers and flags only', async () => {
    await expect(finalize()).resolves.toEqual({ error: 'unreadable_object' })
    expect(update).not.toHaveBeenCalled()
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, FINALIZE_PROBE_URL_TTL_S)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toMatch(/^mrk\//)
    expect(upload.mock.calls[0][0]).toContain(KEY)
    expect(upload.mock.calls[0][2]).toEqual(expect.objectContaining({ upsert: false }))
    expect(JSON.parse(upload.mock.calls[0][1])).toEqual(
      expect.objectContaining({ kind: 'refused', bytes: 1024, first_byte: 0 }),
    )

    expect(actions()).toEqual(['recording.finalize_refused'])
    const event = auditFn.mock.calls[0][0] as { detail: Record<string, unknown>; targetId: string }
    expect(event.targetId).toBe(SESSION)
    expect(event.detail).toEqual({
      reason: 'unreadable_object',
      bytes: 1024,
      first_byte: 0,
      ebml_at_0: false,
      ftyp_at_4: false,
    })
    for (const v of Object.values(event.detail)) {
      expect(['string', 'number', 'boolean']).toContain(typeof v)
    }
  })

  it('a repeat answers the same code and files ZERO rows — the mark already stands', async () => {
    await finalize()
    auditFn.mockClear()
    upload.mockClear()
    await expect(finalize()).resolves.toEqual({ error: 'unreadable_object' })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(auditFn).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  // S63 FIX-3 / Greptile thread 1: a mark that did not land answers retryable failed
  it('a mark write that errors answers retryable failed, files no row, stamps nothing, and says so once', async () => {
    upload.mockResolvedValueOnce({ data: null, error: { statusCode: '500', message: 'boom' } })
    await expect(finalize()).resolves.toEqual({ error: 'failed' })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(auditFn).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    const lines = (console.warn as jest.Mock).mock.calls.filter(([tag]) => tag === '[finalize-take] mark not landed')
    expect(lines).toEqual([
      ['[finalize-take] mark not landed', { recordingSessionId: SESSION, kind: 'refused', answer: 'error' }],
    ])
    expect(JSON.stringify(lines)).not.toContain(KEY)
    expect(JSON.stringify(lines)).not.toContain(TAKE)
  })

  it('a mark create that lands files ONE row; an existing mark files none — and neither logs a not-landed line', async () => {
    await expect(finalize()).resolves.toEqual({ error: 'unreadable_object' })
    expect(actions()).toEqual(['recording.finalize_refused'])
    auditFn.mockClear()
    await expect(finalize()).resolves.toEqual({ error: 'unreadable_object' })
    expect(auditFn).not.toHaveBeenCalled()
    const lines = (console.warn as jest.Mock).mock.calls.filter(([tag]) => tag === '[finalize-take] mark not landed')
    expect(lines).toEqual([])
  })
})

describe('a partial mark that did not land never changes the answer (S63 FIX-3, Greptile thread 3)', () => {
  const partialInput = { ...input, partial: true }
  const finalizePartial = () => finalizeTakeWithClient(synqed, actor, partialInput)
  const notLanded = () =>
    (console.warn as jest.Mock).mock.calls.filter(([tag]) => tag === '[finalize-take] mark not landed')

  it('landed → ok, one partial mark, no not-landed line', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
    await expect(finalizePartial()).resolves.toEqual({ ok: true, recordingSessionId: SESSION })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(JSON.parse(upload.mock.calls[0][1])).toEqual(expect.objectContaining({ kind: 'partial' }))
    expect(notLanded()).toEqual([])
  })

  it('not landed → the answer, the update and the audit identical to the landed case; exactly one line, kind partial', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
    const landed = await finalizePartial()
    const landedUpdate = update.mock.calls
    const landedAudit = auditFn.mock.calls
    jest.clearAllMocks()
    marks.clear()
    upload.mockResolvedValueOnce({ data: null, error: { statusCode: '500', message: 'boom' } })
    const failed = await finalizePartial()
    expect(JSON.stringify(failed)).toBe(JSON.stringify(landed))
    expect(update.mock.calls).toEqual(landedUpdate)
    expect(auditFn.mock.calls).toEqual(landedAudit)
    expect(notLanded()).toEqual([
      ['[finalize-take] mark not landed', { recordingSessionId: SESSION, kind: 'partial', answer: 'error' }],
    ])
    expect(JSON.stringify(notLanded())).not.toContain(KEY)
  })
})

describe('the probe never runs where the answer is already settled', () => {
  it.each([
    ['already (finalized, object proven)', row({ duration_seconds: 30 }), { ok: true, recordingSessionId: SESSION, already: true }],
    ['COMPLETED', row({ status: 'COMPLETED', duration_seconds: 30 }), { ok: true, recordingSessionId: SESSION, already: true }],
    ['superseded', row({ status: 'PROCESSING', audio_storage_path: OLD_KEY, duration_seconds: 30 }), { error: 'superseded' }],
  ])('%s → unchanged answer, zero probe calls', async (_label, r, answer) => {
    fetchMock.mockImplementation(rangedHeadFetch(206, HEADERLESS_HEAD))
    get.mockResolvedValue(r)
    await expect(finalize()).resolves.toEqual(answer)
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    expect(actions()).not.toContain('recording.finalize_refused')
  })
})

describe('an unknown probe is today’s retryable failed — never a refusal', () => {
  it.each([
    ['416', () => fetchMock.mockImplementation(rangedHeadFetch(416, new Uint8Array(0))), 'http_416', null],
    ['timeout', () => fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })), 'timeout', null],
    ['a head shorter than 12 bytes', () => fetchMock.mockImplementation(rangedHeadFetch(206, new Uint8Array(5))), 'short_head', 5],
    ['signing answers an error', () => createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'x' } }), 'sign_failed', null],
    ['signing throws', () => createSignedUrl.mockRejectedValueOnce(new Error('sign down')), 'sign_failed', null],
  ])('%s → failed, no mark, no row, no duration', async (_label, arrange, reason, bytesRead) => {
    arrange()
    await expect(finalize()).resolves.toEqual({ error: 'failed' })
    expect(upload).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    // S4 — the fail-closed path is observable: exactly ONE structured line,
    // codes and numbers only (never the key, never the URL).
    const lines = (console.warn as jest.Mock).mock.calls.filter(([tag]) => tag === '[finalize-take] probe unknown')
    expect(lines).toEqual([['[finalize-take] probe unknown', { recordingSessionId: SESSION, reason, bytesRead }]])
    expect(JSON.stringify(lines)).not.toContain(KEY)
  })
})

describe('a readable take finalizes exactly as before', () => {
  it('stamps the duration and files capture_finalized once', async () => {
    await expect(finalize()).resolves.toEqual({ ok: true, recordingSessionId: SESSION })
    expect(update).toHaveBeenCalledWith(SESSION, { duration_seconds: 42, status: 'UPLOADING' })
    expect(actions()).toEqual(['recording.capture_finalized'])
    expect(upload).not.toHaveBeenCalled()
  })

  it('switch OFF → zero sign, zero probe fetch, zero mark; the answer is byte-identical to the readable ON case', async () => {
    const on = await finalize()
    const onUpdate = update.mock.calls
    const onAudit = auditFn.mock.calls
    jest.clearAllMocks()
    mockSwitches.finalizeProbe = false
    fetchMock.mockImplementation(rangedHeadFetch(206, HEADERLESS_HEAD))
    const off = await finalize()
    expect(JSON.stringify(off)).toBe(JSON.stringify(on))
    expect(update.mock.calls).toEqual(onUpdate)
    expect(auditFn.mock.calls).toEqual(onAudit)
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledTimes(1)
  })
})
