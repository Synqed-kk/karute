/**
 * #1088 (S115, Opus S1 + Sonnet S1) — TWO TABS ON ONE TAKE, THE FIRST ADOPTS ITS
 * MINTED SESSION: ONE PAYER, AND THE SECOND RUN'S POST NAMES THE FIRST'S KEY.
 *
 * The real ai-pipeline + secure-take + take-store (the store's own
 * pinTakeFallback is the code under test — take-store.ts's finalized-key guard),
 * against a minimal in-memory IndexedDB shim (recording-adopted-row-retry-o3's).
 * Only the port, the network and the recorder are faked.
 *
 * Why this is not in ai-pipeline-fallback-paid-once: that file fakes the whole
 * take-store, so its pinTakeFallback stand-in is the same before and after the
 * fix and a test there cannot fail without it. And on Node 24 jest has Node's
 * own Web Locks (`navigator.locks`): withTranscribeLock (ai-pipeline.ts) then
 * makes the two runs take turns — the second replays the first's stamp and
 * never mints — which is the browser's behaviour WITH the lock. The race only
 * exists where the API is absent ("the run proceeds unlocked"), so the race
 * case below runs with a navigator that has no `locks`; the locked case runs
 * with a stand-in lock, so both cases mean the same on Node 20 (no navigator).
 * Every id is invented; nothing leaves jest.
 */
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { awaitTakeSecured: async () => {} } }))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'auth-user-1' } } }, error: null }) },
  }),
}))

type IdbRow = Record<string, unknown>
const idbStores = new Map<string, { keyPath: string | string[]; data: Map<string, IdbRow> }>()
const idbKey = (keyPath: string | string[], row: IdbRow) =>
  JSON.stringify(Array.isArray(keyPath) ? keyPath.map((p) => row[p]) : row[keyPath])
function idbRequest<T>(exec: () => T) {
  const r: { result?: T; error?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
    onsuccess: null,
    onerror: null,
  }
  queueMicrotask(() => {
    try {
      r.result = exec()
      r.onsuccess?.()
    } catch (e) {
      r.error = e
      r.onerror?.()
    }
  })
  return r
}
const idbDb = {
  objectStoreNames: { contains: (n: string) => idbStores.has(n) },
  createObjectStore: (n: string, opts: { keyPath: string | string[] }) =>
    idbStores.set(n, { keyPath: opts.keyPath, data: new Map() }),
  transaction: () => ({
    objectStore: (n: string) => {
      const s = idbStores.get(n)!
      return {
        get: (k: unknown) => idbRequest(() => s.data.get(JSON.stringify(k))),
        getAll: () => idbRequest(() => [...s.data.values()]),
        put: (row: IdbRow) => idbRequest(() => void s.data.set(idbKey(s.keyPath, row), row)),
        add: (row: IdbRow) =>
          idbRequest(() => {
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
    queueMicrotask(() => {
      r.onupgradeneeded?.()
      r.onsuccess?.()
    })
    return r
  },
}

// The port: no session door answer (the start-time mint failed), so the attach
// finds no row and the run takes the unbound door as 'no_session'; with the
// switch ON every unbound mint makes a NEW key and a row (mint-take-url.ts's ON
// arm), handed over after the PUT as the real ports do (onUploaded).
let mints = 0
const unbound = (n: number) => `app_biz-1_server-named-${n}.webm`
type OnUploaded = (row: string, path: string) => Promise<void>
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    refusesMissingKeyWith404: false,
    finalizedKey: async () => null,
    startSession: async () => null,
    mintTakeUrl: async () => ({ error: 'upstream' }),
    finalizeTake: async () => ({ ok: true as const }),
    prepareTranscription: async (
      _blob: Blob,
      finalizedPath: string | null,
      opts?: { attachOutcome?: string; takeRow?: string },
      onUploaded?: OnUploaded,
    ) => {
      if (finalizedPath) {
        const row = opts?.takeRow ?? null
        return { body: row ? { path: finalizedPath, recordingSessionId: row } : { path: finalizedPath }, path: finalizedPath, recordingSessionId: null }
      }
      const n = ++mints
      const path = unbound(n)
      const row = opts?.attachOutcome === 'no_session' ? `rs_minted_${n}` : null
      if (row) await onUploaded?.(row, path)
      return { body: row ? { path, recordingSessionId: row } : { path }, path, recordingSessionId: row }
    },
  }),
}))

// The doors. The server memo is per key (the lease + trc/<key> memo of #1088):
// the first POST naming a key pays, a later one for the SAME key replays it. A
// POST naming another key pays again — the double charge this pins against.
const transcribeBodies: Array<{ path?: string }> = []
const paidKeys: string[] = []
const memo = new Map<string, unknown>()
let firstPostGate: Promise<void> | null = null
let onSecondPost: (() => void) | null = null
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string, init?: { body?: string }) => {
      if (url.endsWith('/transcribe')) {
        const body = JSON.parse(init?.body ?? '{}') as { path?: string }
        transcribeBodies.push(body)
        const key = String(body.path)
        let answer = memo.get(key)
        if (answer === undefined) {
          paidKeys.push(key)
          answer = { transcript: `answer-${paidKeys.length}` }
          memo.set(key, answer)
        }
        // The first POST is held in flight until the second arrives (or a short
        // real timeout): the first tab has not stamped its answer yet.
        if (transcribeBodies.length === 1 && firstPostGate) await firstPostGate
        if (transcribeBodies.length === 2) onSecondPost?.()
        return { ok: true, json: async () => answer } as unknown as Response
      }
      const body = url.endsWith('/extract') ? { entries: [] } : { summary: 'まとめ' }
      return { ok: true, json: async () => body } as unknown as Response
    },
  }),
}))

import { runAIPipeline } from '@/lib/ai-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { appendTakeSegment, createTake, readTakeSecureMeta } from '@/lib/karute/take-store'

const TAKE = '5e7c1a2b-9d3f-4b6a-8c1e-2f3a4b5c6d7e'
const bytes = () => new Blob(['two tabs, one take: the same recorded bytes'], { type: 'audio/webm' })
const tab = () => runAIPipeline(bytes(), TAKE, 'ja', () => {}, { durationSeconds: 42 })
const outcome = (p: Promise<unknown>) => p.then(() => 'ok' as const, (e: unknown) => e)

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const setNavigator = (value: unknown) =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
/** A stand-in for the browser's cross-tab lock: one holder per name, the rest queue. */
function standInLocks() {
  const chains = new Map<string, Promise<unknown>>()
  return {
    request: (name: string, fn: () => Promise<unknown>) => {
      const run = (chains.get(name) ?? Promise.resolve()).then(fn, fn)
      chains.set(name, run.catch(() => {}))
      return run
    },
  }
}

const replaced: Array<{ restore(): void }> = []
beforeEach(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  for (const s of idbStores.values()) s.data.clear()
  mints = 0
  transcribeBodies.length = 0
  paidKeys.length = 0
  memo.clear()
  let release: () => void = () => {}
  firstPostGate = new Promise<void>((r) => (release = r))
  onSecondPost = release
  setTimeout(release, 200)
  replaced.push(
    jest.replaceProperty(RECORDING_SWITCHES as { bindUnboundUploads: boolean }, 'bindUnboundUploads', true),
    jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', true),
  )
  // The take at stop: no row on it (the start-time mint failed), whole on disk.
  expect(
    await createTake({
      takeId: TAKE,
      target: { customerId: 'cust-1', customerName: '田中', karuteNumber: null, appointmentId: null },
      recordingSessionId: null,
      mimeType: 'audio/webm',
      startedAt: Date.now() - 42_000,
    }),
  ).toBe(true)
  expect(await appendTakeSegment(TAKE, 0, bytes(), 42_000)).toBe(true)
})
afterEach(() => {
  while (replaced.length) replaced.pop()!.restore()
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
  else delete (globalThis as { navigator?: unknown }).navigator
  jest.restoreAllMocks()
})

describe('#1088 S115 — two tabs on one take, the first adopts its minted session', () => {
  it('no Web Locks (the run proceeds unlocked): both runs mint, ONE payer, and every POST names the take’s finalized key', async () => {
    setNavigator({}) // a browser without navigator.locks
    const [a, b] = await Promise.all([outcome(tab()), outcome(tab())])
    expect([a, b]).toEqual(['ok', 'ok'])
    // The race was reached: both runs read "no key", both minted (else this case proves nothing).
    expect(mints).toBe(2)
    const meta = await readTakeSecureMeta(TAKE)
    expect(meta?.finalizedPath).toMatch(/^app_biz-1_server-named-[12]\.webm$/)
    // ⚖ ONE PAYER: the run whose pin was refused re-sends the adopted key, which the server already holds.
    expect(paidKeys).toEqual([meta?.finalizedPath])
    expect(transcribeBodies.map((body) => body.path)).toEqual([meta?.finalizedPath, meta?.finalizedPath])
  })

  it('with the browser’s lock (Node 24 jest has one too): the runs take turns, the second replays — one mint, one POST', async () => {
    setNavigator({ locks: standInLocks() })
    const [a, b] = await Promise.all([outcome(tab()), outcome(tab())])
    expect([a, b]).toEqual(['ok', 'ok'])
    expect(mints).toBe(1)
    const meta = await readTakeSecureMeta(TAKE)
    expect(paidKeys).toEqual([meta?.finalizedPath])
    expect(transcribeBodies).toHaveLength(1)
  })
})
