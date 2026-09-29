/**
 * PR-K commit 2 — 「the refused mark carries the partial flag」 (N-3; RULING A5,
 * S66 K6). A take the phone said was not whole (`partial: true`) and whose
 * bytes are no recording is refused ONCE with ONE `refused` mark whose body
 * carries `partial: true` — six keys; every other body keeps its five
 * (s60-a4's pin stands). `partial` is written only when true and OMITTED
 * otherwise; readMarkBody reads a missing field as `partial: null`. The
 * `partial` mark block on the fresh path is unchanged.
 */

const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

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

/** The fake bucket's `mrk/` objects, kept with their bodies. */
const stored = new Map<string, string>()
const info = jest.fn(async (_key: string) => ({
  data: { size: 1024 } as { size?: number } | null,
  error: null as { message: string; status?: number } | null,
}))
const createSignedUrl = jest.fn(async (key: string, _ttl: number) => ({
  data: { signedUrl: `https://proj.supabase.co/sign/${key}` } as { signedUrl: string } | null,
  error: null as { message: string } | null,
}))
const upload = jest.fn(async (key: string, body: string, _opts: unknown) => {
  if (stored.has(key)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
  stored.set(key, body)
  return { data: { path: key }, error: null }
})
const download = jest.fn(async (key: string) =>
  stored.has(key)
    ? { data: { text: async () => stored.get(key)! }, error: null }
    : { data: null, error: { status: 404, statusCode: '404', message: 'Object not found' } },
)
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ info, createSignedUrl, upload, download }) } }),
}))

import { finalizeTakeWithClient, type FinalizeTakeActor } from '@/lib/recording/finalize-take'
import { composeMarkKey } from '@/lib/recording/key-grammar'
import { readTakeMarks } from '@/lib/recording/take-mark'
import { createServiceClient } from '@/lib/supabase/service'
import { HEADERLESS_HEAD, rangedHeadFetch, WEBM_HEAD } from './helpers/container-head-fetch'
import { TAKE_UUID_FIXTURE as TAKE } from './helpers/recording-key-fixtures'

const BIZ = 'biz-1'
const KEY = `app_${BIZ}_${TAKE}.webm`
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const REFUSED = composeMarkKey(BIZ, KEY, 'refused')!.key
const PARTIAL = composeMarkKey(BIZ, KEY, 'partial')!.key

const row = () => ({
  id: SESSION,
  business_id: BIZ,
  staff_id: 'staff-1',
  customer_id: 'cust-1',
  status: 'UPLOADING',
  audio_storage_path: KEY,
  duration_seconds: null,
  store_id: null,
})
const get = jest.fn(async (_id: string) => row())
const update = jest.fn(async (id: string, _input: unknown) => ({ ...row(), id }))
const synqed = { recordings: { get, update } } as never
const actor: FinalizeTakeActor = {
  staffId: 'staff-1',
  businessId: BIZ,
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  source: 'facade',
}
const BODY = { takeId: TAKE, mimeType: 'audio/webm', durationSeconds: 42.7, byteLength: 1024, recordingSessionId: SESSION }
const finalize = (extra: Record<string, unknown> = {}) => finalizeTakeWithClient(synqed, actor, { ...BODY, ...extra } as never)
const actions = () => auditFn.mock.calls.map(([e]) => (e as { action: string }).action)
const bodyAt = (key: string) => JSON.parse(stored.get(key)!) as Record<string, unknown>
const markClient = () => createServiceClient() as unknown as Parameters<typeof readTakeMarks>[0]

const fetchMock = jest.fn()
const originalFetch = global.fetch
beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  mockSwitches.finalizeProbe = true
  stored.clear()
  fetchMock.mockImplementation(rangedHeadFetch(206, HEADERLESS_HEAD))
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

describe('an unreadable take the phone said was partial', () => {
  it('ONE refused mark whose SIX-key body says partial:true, plus ONE partial mark, ONE audit row then none, unreadable_object both times', async () => {
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    // Changed in fix round 1, Greptile #1099 thread 3 (PRRT_kwDOSCB5RM6nQm0W): a partial:true body also gets the create-only partial mark (refused created then exists; partial created then exists).
    expect([...stored.keys()]).toEqual([REFUSED, PARTIAL])
    expect(stored.has(PARTIAL)).toBe(true)
    const body = bodyAt(REFUSED)
    expect(Object.keys(body).sort()).toEqual(['at', 'bytes', 'first_byte', 'kind', 'partial', 'v'])
    expect(body).toEqual(expect.objectContaining({ v: 1, kind: 'refused', bytes: 1024, first_byte: 0, partial: true }))
    expect(actions()).toEqual(['recording.finalize_refused'])
    expect(update).not.toHaveBeenCalled()
  })

  it('reads back as partial:true', async () => {
    await finalize({ partial: true })
    const marks = await readTakeMarks(markClient(), BIZ, KEY)
    // Changed in fix round 1, Greptile #1099 thread 3 (PRRT_kwDOSCB5RM6nQm0W): the refused mark (first by `at`, MARK_KINDS on a tie) plus the partial mark.
    expect(marks).toEqual([
      expect.objectContaining({ kind: 'refused', partial: true }),
      expect.objectContaining({ kind: 'partial' }),
    ])
  })
})

describe('an unreadable take without the flag', () => {
  it('the five-key body it always had — the key omitted, never partial:null — and it reads back partial:null', async () => {
    await expect(finalize()).resolves.toEqual({ error: 'unreadable_object' })
    const body = bodyAt(REFUSED)
    expect(Object.keys(body).sort()).toEqual(['at', 'bytes', 'first_byte', 'kind', 'v'])
    expect('partial' in body).toBe(false)
    await expect(readTakeMarks(markClient(), BIZ, KEY)).resolves.toEqual([
      expect.objectContaining({ kind: 'refused', partial: null }),
    ])
  })

  it('partial:false is no flag either — five keys', async () => {
    await finalize({ partial: false })
    expect('partial' in bodyAt(REFUSED)).toBe(false)
  })
})

describe('an old body and a readable take', () => {
  it('a body written before PR-K (no partial field) reads back partial:null; a non-true value reads null too', async () => {
    stored.set(REFUSED, JSON.stringify({ v: 1, kind: 'refused', at: '2026-09-29T10:00:00.000Z', bytes: 14, first_byte: 0 }))
    stored.set(PARTIAL, JSON.stringify({ v: 1, kind: 'partial', at: '2026-09-29T11:00:00.000Z', bytes: 9, first_byte: 26, partial: 'yes' }))
    await expect(readTakeMarks(markClient(), BIZ, KEY)).resolves.toEqual([
      { v: 1, kind: 'refused', at: '2026-09-29T10:00:00.000Z', bytes: 14, first_byte: 0, partial: null },
      { v: 1, kind: 'partial', at: '2026-09-29T11:00:00.000Z', bytes: 9, first_byte: 26, partial: null },
    ])
  })

  it('a READABLE take with partial:true → the partial mark as today (five keys), no refused mark', async () => {
    fetchMock.mockImplementation(rangedHeadFetch(206, WEBM_HEAD))
    await expect(finalize({ partial: true })).resolves.toEqual({ ok: true, recordingSessionId: SESSION })
    expect([...stored.keys()]).toEqual([PARTIAL])
    expect(Object.keys(bodyAt(PARTIAL)).sort()).toEqual(['at', 'bytes', 'first_byte', 'kind', 'v'])
    expect(actions()).toEqual(['recording.capture_finalized'])
  })
})

describe('a later partial claim is never lost (Greptile #1099 thread 3 (PRRT_kwDOSCB5RM6nQm0W), fix round 1 commit 6)', () => {
  it('no partial → refused only; retry partial:true → refused exists + partial created; third → both exists; ONE audit row', async () => {
    const answersOf = async () =>
      Promise.all(upload.mock.results.map(async (r, i) => [upload.mock.calls[i][0], (await r.value).error ? 'exists' : 'created'] as const))

    await expect(finalize()).resolves.toEqual({ error: 'unreadable_object' })
    expect(await answersOf()).toEqual([[REFUSED, 'created']])
    expect('partial' in bodyAt(REFUSED)).toBe(false)
    expect(stored.has(PARTIAL)).toBe(false)
    expect(actions()).toEqual(['recording.finalize_refused'])

    upload.mockClear()
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    expect(await answersOf()).toEqual([
      [REFUSED, 'exists'],
      [PARTIAL, 'created'],
    ])
    expect('partial' in bodyAt(REFUSED)).toBe(false)
    expect(bodyAt(PARTIAL)).toEqual(expect.objectContaining({ v: 1, kind: 'partial', bytes: 1024, first_byte: 0 }))
    expect(actions()).toEqual(['recording.finalize_refused'])

    upload.mockClear()
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    expect(await answersOf()).toEqual([
      [REFUSED, 'exists'],
      [PARTIAL, 'exists'],
    ])
    expect([...stored.keys()]).toEqual([REFUSED, PARTIAL])
    expect(actions()).toEqual(['recording.finalize_refused'])
    expect(update).not.toHaveBeenCalled()
  })
})

describe('the refusal is audited before the partial flag (fix round 1 commit 7, fresh-round S1/S2)', () => {
  const FAIL = { data: null, error: { statusCode: '500', message: 'boom' } }
  const failOn = (bad: string) => {
    const real = upload.getMockImplementation()!
    upload.mockImplementation(async (key: string, body: string, opts: unknown) =>
      key === bad ? FAIL : real(key, body, opts),
    )
  }
  const notLanded = () =>
    (console.warn as jest.Mock).mock.calls.filter(([t]) => t === '[finalize-take] mark not landed').map(([, f]) => f)
  let realUpload: Parameters<typeof upload.mockImplementation>[0]
  beforeAll(() => {
    realUpload = upload.getMockImplementation()!
  })
  afterEach(() => {
    upload.mockImplementation(realUpload)
  })

  it('(a) refused created, the partial write fails → the audit row is still filed, the answer unchanged, ONE not-landed line', async () => {
    failOn(PARTIAL)
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    expect(actions()).toEqual(['recording.finalize_refused'])
    expect([...stored.keys()]).toEqual([REFUSED])
    expect(notLanded()).toEqual([{ recordingSessionId: SESSION, kind: 'partial', answer: 'error' }])
  })

  it('(b) refused exists, the partial write fails → no audit row, the answer unchanged', async () => {
    stored.set(REFUSED, JSON.stringify({ v: 1, kind: 'refused', at: '2026-09-29T10:00:00.000Z', bytes: 1024, first_byte: 0 }))
    failOn(PARTIAL)
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    expect(actions()).toEqual([])
    expect(upload.mock.calls.map(([k]) => k)).toEqual([REFUSED, PARTIAL])
    expect(notLanded()).toEqual([{ recordingSessionId: SESSION, kind: 'partial', answer: 'error' }])
  })

  it('(c) refused answers error → no partial attempt: upload called ONCE, failed, no audit row', async () => {
    failOn(REFUSED)
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'failed' })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(REFUSED)
    expect(actions()).toEqual([])
    expect(stored.size).toBe(0)
  })

  it('(d) the order: refused upload → the audit emit → the partial upload', async () => {
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    expect(upload.mock.calls.map(([k]) => k)).toEqual([REFUSED, PARTIAL])
    const [refusedAt, partialAt] = upload.mock.invocationCallOrder
    const [auditAt] = auditFn.mock.invocationCallOrder
    expect(auditFn).toHaveBeenCalledTimes(1)
    expect(refusedAt).toBeLessThan(auditAt)
    expect(auditAt).toBeLessThan(partialAt)
  })
})
