/** ⚖ S120 G2 — THE LONGER RECORDING WINS (Greptile 4232349578 on #1088). Two invocations,
 *  ONE take, NO stored bytes, each holding its own in-memory blob: both reach
 *  ensureAudioOnServer's secureBlob branch and the first seals the take's write-once key.
 *  A run whose audio is provably LONGER than that sealed object (the length its finalize
 *  re-proved) sends its own bytes — one more payment, never the shorter words — and its
 *  再試行s replay that answer. Equal or shorter → the sealed key, nothing paid again.
 *  Real ai-pipeline + secure-take + take-store over an IDB shim (as ai-pipeline-two-tabs-one-payer).
 *  Server doors are a MODEL: per-take key, create-only PUT (409 if present), finalize re-proves byteLength. */
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { awaitTakeSecured: async () => {} } }))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'auth-user-1' } } }, error: null }) } }),
}))
type IdbRow = Record<string, unknown>
const idbStores = new Map<string, { keyPath: string | string[]; data: Map<string, IdbRow> }>()
const idbKey = (keyPath: string | string[], row: IdbRow) => JSON.stringify(Array.isArray(keyPath) ? keyPath.map((p) => row[p]) : row[keyPath])
function idbRequest<T>(exec: () => T) {
  const r: { result?: T; error?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = { onsuccess: null, onerror: null }
  queueMicrotask(() => { try { r.result = exec(); r.onsuccess?.() } catch (e) { r.error = e; r.onerror?.() } })
  return r
}
const idbDb = {
  objectStoreNames: { contains: (n: string) => idbStores.has(n) },
  createObjectStore: (n: string, opts: { keyPath: string | string[] }) => idbStores.set(n, { keyPath: opts.keyPath, data: new Map() }),
  transaction: () => ({
    objectStore: (n: string) => {
      const s = idbStores.get(n)!
      return {
        get: (k: unknown) => idbRequest(() => s.data.get(JSON.stringify(k))),
        getAll: () => idbRequest(() => [...s.data.values()]),
        put: (row: IdbRow) => idbRequest(() => void s.data.set(idbKey(s.keyPath, row), row)),
        add: (row: IdbRow) => idbRequest(() => {
          if (s.data.has(idbKey(s.keyPath, row))) throw Object.assign(new Error('exists'), { name: 'ConstraintError' })
          s.data.set(idbKey(s.keyPath, row), row)
        }),
      }
    },
  }),
}
;(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () => {
    const r: { result: typeof idbDb; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: idbDb }
    queueMicrotask(() => { r.onupgradeneeded?.(); r.onsuccess?.() })
    return r
  },
}
const objects = new Map<string, string>() // storage: key -> bytes (text). Never deleted.
let mints = 0
let postMs = 0
const takeKey = (takeId: string) => `app_biz-1_take-${takeId}.webm`
const unbound = (n: number) => `app_biz-1_server-named-${n}.webm`
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    refusesMissingKeyWith404: false,
    finalizedKey: async () => null,
    startSession: async () => null,
    mintTakeUrl: async (takeId: string) => {
      const path = takeKey(takeId)
      return objects.has(path) ? { path, contentType: 'audio/webm' } : { url: `https://store.test/put/${path}`, path, contentType: 'audio/webm' }
    },
    finalizeTake: async (i: { takeId: string; byteLength: number }) => {
      const o = objects.get(takeKey(i.takeId))
      if (o === undefined) return { error: 'missing' }
      return o.length === i.byteLength ? { ok: true as const } : { error: 'size_mismatch' }
    },
    prepareTranscription: async (blob: Blob, finalizedPath: string | null) => {
      if (finalizedPath) return { body: { path: finalizedPath }, path: finalizedPath, recordingSessionId: null }
      const path = unbound(++mints)
      objects.set(path, await blob.text())
      return { body: { path }, path, recordingSessionId: null }
    },
  }),
}))
const posted: string[] = []
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string, init?: { body?: string }) => {
      if (url.endsWith('/transcribe')) {
        const key = String((JSON.parse(init?.body ?? '{}') as { path?: string }).path)
        await tick(postMs)
        posted.push(key)
        return { ok: true, json: async () => ({ transcript: `words-of[${objects.get(key) ?? 'NO-OBJECT'}]` }) } as unknown as Response
      }
      return { ok: true, json: async () => (url.endsWith('/extract') ? { entries: [] } : { summary: 's' }) } as unknown as Response
    },
  }),
}))
// The finalized-key PUT (secureBlob uses global fetch): create-only, lands after a short delay.
;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: { body: Blob }) => {
  const key = String(url).split('/put/')[1]
  await tick(5)
  if (objects.has(key)) return new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate' }), { status: 409 })
  objects.set(key, await init.body.text())
  return new Response('', { status: 200 })
}

import { runAIPipeline } from '@/lib/ai-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { createTake, readTakeSecureMeta } from '@/lib/karute/take-store'
let runtime2: typeof runAIPipeline
// A second runtime (another tab): its own module instances over the same IDB and storage.
jest.isolateModules(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  runtime2 = (require('@/lib/ai-pipeline') as { runAIPipeline: typeof runAIPipeline }).runAIPipeline
})

const TAKE = '5e7c1a2b-9d3f-4b6a-8c1e-2f3a4b5c6d7e'
const blob = (t: string) => new Blob([t], { type: 'audio/webm' })
/** The run context global-pipeline hands every attempt of one chain: the pin and the paid answer, kept across 再試行. */
type Ctx = {
  durationSeconds: number
  fallbackPin?: unknown
  onFallbackPinned?: (p: unknown) => void
  paidFallback?: unknown
  onFallbackPaid?: (a: unknown) => void
}
const mkCtx = (paidSlot = false): Ctx => {
  const c: Ctx = { durationSeconds: 42 }
  c.onFallbackPinned = (p) => { c.fallbackPin = p }
  if (paidSlot) c.onFallbackPaid = (a) => { c.paidFallback = a }
  return c
}
const go = (fn: typeof runAIPipeline, t: string, ctx: Ctx = mkCtx()) =>
  fn(blob(t), TAKE, 'ja', () => {}, ctx as never).then((r) => r.transcript, (e: unknown) => `ERR ${String(e)}`)
const replaced: Array<{ restore(): void }> = []
const sw = (k: string, v: boolean) => { if (k in RECORDING_SWITCHES) replaced.push(jest.replaceProperty(RECORDING_SWITCHES as unknown as Record<string, boolean>, k, v)) }
async function freshTake() {
  for (const s of idbStores.values()) s.data.clear()
  objects.clear(); posted.length = 0; mints = 0
  // A take row with its session, NO segments: the store holds no bytes for it (persistence failed open).
  await createTake({ takeId: TAKE, target: { customerId: 'cust-1', customerName: 'T', karuteNumber: null, appointmentId: null }, recordingSessionId: 'rs_take', mimeType: 'audio/webm', startedAt: Date.now() - 42_000 })
}
const payerKeys = () => new Set(posted).size
const boundTo = async () => (await readTakeSecureMeta(TAKE))?.finalizedPath ?? null
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  sw('transcribePaidOnce', true); sw('bindUnboundUploads', false)
})
afterEach(() => { while (replaced.length) replaced.pop()!.restore(); jest.restoreAllMocks() })

for (const delay of [0, 50]) describe(`S120 G2 — sealed length, longer wins (transcribe POST ${delay} ms)`, () => {
  beforeEach(() => { postMs = delay })
  it('PIN-1 two runtimes, SHORT seals first: the LONG run gets the LONG words, both objects kept; PIN-2 its 再試行 re-presents its own key', async () => {
    await freshTake(); const ctxL = mkCtx()
    const [s, l] = await Promise.all([go(runAIPipeline, 'AAAA'), go(runtime2, 'AAAAtail', ctxL)])
    expect(s).toBe('words-of[AAAA]')
    expect(l).toBe('words-of[AAAAtail]')
    expect(await boundTo()).toBe(takeKey(TAKE)) // the take stays bound to its sealed key (immutable)
    expect(objects.get(takeKey(TAKE))).toBe('AAAA')
    const before = payerKeys(); const m0 = mints
    const again = await go(runtime2, 'AAAAtail', ctxL)
    expect(again).toBe('words-of[AAAAtail]')
    expect(mints).toBe(m0)
    expect(payerKeys()).toBe(before)
    expect(payerKeys()).toBe(2)
  })
  it('PIN-3 control: identical bytes in two runtimes -> one payer key, the sealed key', async () => {
    await freshTake()
    const [a, b] = await Promise.all([go(runAIPipeline, 'AAAAtail'), go(runtime2, 'AAAAtail')])
    expect([a, b]).toEqual(['words-of[AAAAtail]', 'words-of[AAAAtail]'])
    expect(payerKeys()).toBe(1)
    expect(new Set(posted)).toEqual(new Set([takeKey(TAKE)]))
  })
  it('PIN-4 SHORT run after a LONG seal still sends the sealed LONG key (longer wins, no second payment)', async () => {
    await freshTake()
    const [l, s] = await Promise.all([go(runAIPipeline, 'AAAAtail'), go(runtime2, 'AAAA')])
    expect(l).toBe('words-of[AAAAtail]')
    expect(s).toBe('words-of[AAAAtail]')
    expect(payerKeys()).toBe(1)
  })
  it('PIN-5 a mismatch costs AT MOST ONE extra payment: then 3 再試行 (global-pipeline\'s chain context) pay nothing and each gets the LONGER words', async () => {
    await freshTake(); const ctxL = mkCtx(true)
    const [s, l] = await Promise.all([go(runAIPipeline, 'AAAA'), go(runtime2, 'AAAAtail', ctxL)])
    expect([s, l]).toEqual(['words-of[AAAA]', 'words-of[AAAAtail]'])
    expect(payerKeys()).toBe(2) // the sealed SHORT key + exactly one extra, for the LONG bytes
    const posts0 = posted.length; const m0 = mints
    for (let i = 0; i < 3; i++) expect(await go(runtime2, 'AAAAtail', ctxL)).toBe('words-of[AAAAtail]')
    expect(posted.length).toBe(posts0) // replayed from the chain's paid slot: no POST at all
    expect(mints).toBe(m0)
    expect(payerKeys()).toBe(2)
  })
  it('PIN-6 …and with the pin alone (the paid answer lost): 3 再試行 re-present the LONG key — no new mint, no new payer key', async () => {
    await freshTake(); const ctxL = mkCtx()
    await Promise.all([go(runAIPipeline, 'AAAA'), go(runtime2, 'AAAAtail', ctxL)])
    const m0 = mints
    for (let i = 0; i < 3; i++) expect(await go(runtime2, 'AAAAtail', ctxL)).toBe('words-of[AAAAtail]')
    expect(mints).toBe(m0)
    expect(payerKeys()).toBe(2)
  })
  it('PIN-7 sequential, SHORT then LONG in one runtime: the LONG run pays once for its own bytes, the take stays sealed SHORT', async () => {
    await freshTake()
    const s = await go(runAIPipeline, 'AAAA'); const l = await go(runAIPipeline, 'AAAAtail')
    expect([s, l]).toEqual(['words-of[AAAA]', 'words-of[AAAAtail]'])
    expect(payerKeys()).toBe(2)
    expect(await boundTo()).toBe(takeKey(TAKE))
  })
  it('PIN-8 a legacy take sealed with NO recorded length behaves exactly as before: the sealed key, one payer', async () => {
    await freshTake()
    await go(runAIPipeline, 'AAAA')
    const row = [...idbStores.get('takes')!.data.values()][0] as Record<string, unknown>
    delete row.finalizedBytes
    const l = await go(runAIPipeline, 'AAAAtail')
    expect(l).toBe('words-of[AAAA]')
    expect(payerKeys()).toBe(1)
  })
})
