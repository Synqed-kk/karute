/** S120 (READ-A attack A1, R-S120-10/11) — A 再試行 STARTS ONLY FROM THE ERROR STATE.
 *  retry() had no in-flight guard, so two calls before a re-render started two runs on one blob:
 *  on a take sealed SHORT both runs paid (payer keys 1 → 3 at T), and on an unsealed take the
 *  two runs locked different names (take:<id> vs the key the other just sealed) and paid twice.
 *  The guard: retry() returns unless the pipeline is in 'error', and it leaves 'error'
 *  synchronously, so a second call in the same tick finds 'processing' and does nothing.
 *  Real global-pipeline + ai-pipeline + secure-take + take-store over an IDB shim (the READ-A
 *  harness, from ai-pipeline-sealed-length-longer-wins). Server doors are a MODEL: per-take
 *  key, create-only PUT (409 if present), finalize re-proves byteLength. A browser-shaped tab
 *  lock (FIFO per name) stands in for navigator.locks on every Node. */
/** The run's first await (ai-pipeline awaitTakeSecured): failing it ends an attempt before it touches the take. */
let secureWaitFails = 0
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: {
    awaitTakeSecured: async () => {
      if (secureWaitFails > 0) {
        secureWaitFails--
        throw new Error('take not secured yet')
      }
    },
  },
}))
// runAIPipeline counted as global-pipeline calls it (the real one runs underneath).
jest.mock('@/lib/ai-pipeline', () => {
  const actual = jest.requireActual('@/lib/ai-pipeline')
  return { ...actual, runAIPipeline: jest.fn(actual.runAIPipeline) }
})
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
/** Knobs that fail ONE step of an attempt (each use counts down): the unbound mint
 *  (before any POST, so nothing is paid or pinned), the extract. */
let prepareFails = 0
let extractFails = 0
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
      if (prepareFails > 0) {
        prepareFails--
        throw new Error('mint failed')
      }
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
        await tick(0)
        posted.push(key)
        return { ok: true, json: async () => ({ transcript: `words-of[${objects.get(key) ?? 'NO-OBJECT'}]` }) } as unknown as Response
      }
      if (url.endsWith('/extract') && extractFails > 0) {
        extractFails--
        return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}), headers: new Headers() } as unknown as Response
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
import { globalPipeline } from '@/lib/global-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { createTake } from '@/lib/karute/take-store'

const TAKE = '5e7c1a2b-9d3f-4b6a-8c1e-2f3a4b5c6d7e'
const blob = (t: string) => new Blob([t], { type: 'audio/webm' })
const ctx = { locale: 'ja', customers: [], takeId: TAKE, recordingSessionId: 'rs_take', duration: 42 }
const replaced: Array<{ restore(): void }> = []
const sw = (k: string, v: boolean) => { if (k in RECORDING_SWITCHES) replaced.push(jest.replaceProperty(RECORDING_SWITCHES as unknown as Record<string, boolean>, k, v)) }
const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
/** navigator.locks as the browser has it: exclusive, FIFO per name, held until fn settles. */
function tabLocks() {
  const chains = new Map<string, Promise<unknown>>()
  return {
    request: (name: string, fn: () => Promise<unknown>) => {
      const run = (chains.get(name) ?? Promise.resolve()).then(fn, fn)
      chains.set(name, run.catch(() => {}))
      return run
    },
  }
}
async function freshTake() {
  for (const s of idbStores.values()) s.data.clear()
  objects.clear(); posted.length = 0; mints = 0
  // A take row with its session, NO segments: the store holds no bytes for it (persistence failed open).
  await createTake({ takeId: TAKE, target: { customerId: 'cust-1', customerName: 'T', karuteNumber: null, appointmentId: null }, recordingSessionId: 'rs_take', mimeType: 'audio/webm', startedAt: Date.now() - 42_000 })
}
const payerKeys = () => new Set(posted).size
const settle = async () => {
  for (let i = 0; i < 2000 && globalPipeline.state === 'processing'; i++) await tick(1)
}
/** A superseded run keeps going after the live one settles the state: give it time to POST. */
const drain = () => tick(200)
const transcriptNow = () => (globalPipeline.result as { transcript?: string } | null)?.transcript ?? null
const runs = runAIPipeline as jest.MockedFunction<typeof runAIPipeline>
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  sw('transcribePaidOnce', true); sw('bindUnboundUploads', false)
  Object.defineProperty(globalThis, 'navigator', { value: { locks: tabLocks() }, configurable: true, writable: true })
  secureWaitFails = 0; prepareFails = 0; extractFails = 0
  runs.mockClear()
})
afterEach(() => {
  globalPipeline.reset()
  while (replaced.length) replaced.pop()!.restore()
  jest.restoreAllMocks()
  if (realNav) Object.defineProperty(globalThis, 'navigator', realNav)
  else delete (globalThis as { navigator?: unknown }).navigator
})

describe('S120 A1 — a 再試行 starts only from the error state', () => {
  it('two retry() calls in the same tick start ONE run; the state leaves error before retry() returns', async () => {
    await freshTake()
    prepareFails = 1
    globalPipeline.start(blob('AAAA'), ctx)
    await settle()
    expect(globalPipeline.state).toBe('error')
    expect(runs).toHaveBeenCalledTimes(1)
    globalPipeline.retry()
    expect(globalPipeline.state).toBe('processing') // synchronous: before any await
    globalPipeline.retry() // the second tap in the same tick
    await settle()
    await drain()
    expect(runs).toHaveBeenCalledTimes(2) // start + ONE retry
    expect(globalPipeline.state).toBe('review')
    expect(payerKeys()).toBe(1)
  })

  it('retry() outside the error state does nothing (processing, review)', async () => {
    await freshTake()
    globalPipeline.start(blob('AAAA'), ctx)
    expect(globalPipeline.state).toBe('processing')
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(runs).toHaveBeenCalledTimes(1)
    expect(posted).toHaveLength(1)
  })

  it('READ-A finding 1: a take sealed SHORT, a double 再試行 → 1 extra payer, then 0 (longer words)', async () => {
    await freshTake()
    // Another run sealed the take's write-once key with the SHORT copy and paid for it.
    await runAIPipeline(blob('AAAA'), TAKE, 'ja', () => {}, { durationSeconds: 42 } as never)
    expect(payerKeys()).toBe(1)
    runs.mockClear()
    prepareFails = 1 // the long run's first attempt fails before any POST: no pin, no paid answer
    globalPipeline.start(blob('AAAAtail'), ctx)
    await settle()
    expect(globalPipeline.state).toBe('error')
    extractFails = 99 // the 再試行 pays, then fails after, so a later 再試行 can replay
    globalPipeline.retry()
    globalPipeline.retry()
    await settle()
    await drain()
    expect(globalPipeline.state).toBe('error')
    expect(payerKeys()).toBe(2) // the designed 1 extra payer (the longer copy)
    extractFails = 0
    globalPipeline.retry()
    await settle()
    expect(globalPipeline.state).toBe('review')
    expect(payerKeys()).toBe(2) // then 0
    expect(transcriptNow()).toBe('words-of[AAAAtail]')
    expect(runs).toHaveBeenCalledTimes(3)
  })

  it('READ-A finding 2: an UNSEALED take, a double 再試行 → 1 key', async () => {
    await freshTake()
    secureWaitFails = 1 // attempt 1 fails before it seals, pins or pays anything
    globalPipeline.start(blob('AAAA'), ctx)
    await settle()
    expect(globalPipeline.state).toBe('error')
    expect(objects.size).toBe(0)
    globalPipeline.retry()
    globalPipeline.retry()
    await settle()
    await drain()
    expect(globalPipeline.state).toBe('review')
    expect(payerKeys()).toBe(1)
    expect(transcriptNow()).toBe('words-of[AAAA]')
  })
})
