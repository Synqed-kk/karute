/**
 * O3 (S50) — what a phone 再試行 does after it ADOPTED the row the switch-ON
 * server-named arm made (row X). The pin is the TRUE current behaviour, read
 * at the code and run end to end on the server side with X's own key:
 *
 *   phone: retry() → isServerJobEligible → runServerJob (global-pipeline.ts
 *   :727-742, :468-498) sends { recordingSessionId: X, audioPath: the take's
 *   finalizedPath } — adoptTakeSession wrote that path = X's key
 *   (take-store.ts:768-776; ensureFinalizedPath returns it, :829).
 *   door:  job/route.ts:63 isOwnRecordingKey(X key) · :112 takeKeyHolder(X key,
 *   X) — the row holds exactly that key and the caller's LOGIN id (the upload
 *   door's bindIdentity and this door both resolve it with resolveSelfStaffId)
 *   → 'own' → enqueued.
 *   worker: processJob (process-recording.ts:209-) never reads the recording
 *   row — no status check at all. It signs a read url for audio_path and
 *   transcribes whatever object sits there, so an X still UPLOADING (never
 *   finalized — mint-take-url.ts bindServerNamedTake: "this row is never
 *   finalized") is transcribed and its karute is created against X.
 *
 * CLIENT FLOW (S50 fold, Greptile #1078 P2): the last describe drives the
 * phone's OWN code — GlobalPipeline, ai-pipeline's adoption, take-store, the
 * thin port — into these same two doors, so a phone that stopped saving X or
 * stopped sending its key on 再試行 turns it red (see its own note).
 *
 * NOT covered here (not in this repo): whether CORE's recordingJobs.enqueue /
 * claim refuses a session whose row is UPLOADING — the SDK documents only
 * "idempotent: one job per recording session". Every core call is a fake.
 */
import { createHmac } from 'node:crypto'
import { fakeCreateSignedUploadUrl, OBJECT_NOT_FOUND } from './helpers/storage-fakes'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
// The worker's coreClient() needs both to construct a client — the client
// itself is the fake below; nothing is dialled.
process.env.SYNQED_CORE_URL ??= 'http://127.0.0.1:9'
process.env.SYNQED_CORE_API_KEY ??= 'dummy-not-live'

import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))

const roster = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view', 'records.write'])),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: jest.fn(async (id: string) => `card-${id}`),
}))
const audit = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...(jest.requireActual('@/lib/audit') as object),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

const runMeteredTranscription = jest.fn(async (..._a: unknown[]) => ({
  result: { transcript: 'こんにちは', paragraphs: [], words: [], confidence: 1 },
  receipt: { duration_seconds: 60, cost_cents: 1, debit_recorded: true },
}))
jest.mock('@/lib/ai/transcribe', () => ({
  speakerIdMode: () => 'off',
  loadStaffReferenceForStaff: jest.fn(async () => null),
  runMeteredTranscription: (...a: unknown[]) => runMeteredTranscription(...a),
}))
jest.mock('@/lib/ai/karute-extract', () => ({ runKaruteExtraction: jest.fn(async () => ({ result: { entries: [] } })) }))
jest.mock('@/lib/ai/karute-summarize', () => ({ runKaruteSummary: jest.fn(async () => ({ result: { summary: 'S' } })) }))
jest.mock('@/lib/diarized', () => ({ buildDiarizedTranscript: jest.fn(() => null), toSpeakerText: jest.fn(() => '') }))
jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcomeWithClient: jest.fn(async () => ({})),
  REVISIT_NOT_ELIGIBLE: 'revisit_not_eligible',
  REVISIT_CHECK_UNAVAILABLE: 'revisit_check_unavailable',
}))

// Storage: the upload door's sign + exists probe, the worker's read sign.
const held = new Set<string>()
const createSignedUploadUrl = jest.fn(fakeCreateSignedUploadUrl(held, (p: string) => `https://proj.supabase.co/upload/${p}`))
const info = jest.fn(async (_key: string) => ({ data: null, error: { ...OBJECT_NOT_FOUND } }))
const createSignedUrl = jest.fn(async (_key: string, _ttl: number) => ({ data: { signedUrl: 'https://x/audio' }, error: null }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: (_b: string) => ({ createSignedUploadUrl, info, createSignedUrl, remove: jest.fn() }) } }),
}))

// ONE core: the row table the upload door writes and the job door reads.
const X = '5b0e6f2a-9c1d-4e7f-8a2b-3c4d5e6f7a8b'
type Row = { id: string; business_id: string; staff_id: string; store_id: string | null; audio_storage_path: string | null; status: string }
const rows = new Map<string, Row>()
const recordingsCreate = jest.fn(async (input: Record<string, unknown>) => {
  rows.set(X, { id: X, business_id: 'business-1', ...(input as Omit<Row, 'id' | 'business_id'>) })
  return { id: X }
})
const recordingsGet = jest.fn(async (id: string) => {
  const row = rows.get(id)
  if (!row) throw Object.assign(new Error('not found'), { status: 404 })
  return row
})
const recordingsUpdate = jest.fn()
let enqueued: { recording_session_id: string; payload: Record<string, unknown> } | null = null
const enqueue = jest.fn(async (input: { recording_session_id: string; payload: Record<string, unknown> }) => {
  enqueued = input
  return { id: 'job-x', status: 'QUEUED' }
})
const claim = jest.fn()
const complete = jest.fn(async () => ({}))
const fail = jest.fn(async () => ({}))
const karuteRecordsCreate = jest.fn(async () => ({ id: 'record-x' }))
const fakeClient = {
  recordings: { get: recordingsGet, create: recordingsCreate, update: recordingsUpdate },
  recordingJobs: { enqueue, claim, complete, fail },
  appointments: { get: jest.fn(async () => null) },
  stores: { get: jest.fn(async () => ({ id: 'store-1' })), list: jest.fn(async () => ({ stores: [{ id: 'store-1', is_primary: true }] })) },
  staffStores: { get: jest.fn(async () => ({ store_ids: ['store-1'] })) },
  customers: { getConsent: jest.fn(async () => ({ consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION } })), get: jest.fn(async () => ({ name: 'c' })) },
  orgSettings: { get: jest.fn(async () => ({ settings: {} })) },
  karuteRecords: {
    getByRecordingSession: jest.fn(async () => {
      throw Object.assign(new Error('nf'), { status: 404 })
    }),
    create: karuteRecordsCreate,
    update: jest.fn(async () => ({ id: 'record-x' })),
  },
  karuteOutcomes: { get: jest.fn(async () => null) },
  recordingDiscards: { list: jest.fn(async () => ({ events: [] })) },
  audit: { list: jest.fn(async () => ({ events: [] })) },
  staff: { get: jest.fn(async () => ({ id: 'card-auth-user-1', user_id: 'auth-user-1' })) },
}
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => fakeClient), SynqedError: class extends Error {} }))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

// ── The PHONE half (S50 fold, Greptile #1078 P2) ──────────────────────────────
// The client-flow case at the bottom runs the REAL GlobalPipeline → ai-pipeline
// → secure-take → take-store → thin recording port against the two REAL doors
// above. Only what a phone has and jest does not is stood in for:
//  · the recorder — ai-pipeline / global-pipeline import it lazily for
//    awaitTakeSecured alone, and there is no stop leg in flight here;
//  · the signed-in session take-store's owner gate reads (currentUserId);
//  · IndexedDB — a minimal in-memory shim of exactly the surface take-store's
//    writers and readers on this path use (open/upgrade, get, getAll, put, add).
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
    // PR-B commit 7 (C1, B-S66-8): the shim reports its commit, as IndexedDB's `complete` does.
    set oncomplete(done: (() => void) | null) {
      if (done) queueMicrotask(done)
    },
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

import { POST as mintPOST } from '@/app/api/app/v1/recordings/upload-url/route'
import { POST as jobPOST } from '@/app/api/app/v1/recordings/job/route'
import { processRecordingJobs } from '@/lib/jobs/process-recording'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { globalPipeline } from '@/lib/global-pipeline'
import { getRecordingPipelinePort, setRecordingPipelinePort } from '@/lib/ports/recording-port'
import { getDataPort, setDataPort } from '@/lib/ports/data-port'
import { appendTakeSegment, createTake, readTakeSecureMeta } from '@/lib/karute/take-store'
import { viteRecordingPort } from '../../../thin/ports/recording.vite'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(sub = 'auth-user-1') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json', 'store-id': 'store-1' }
const noRoute = { params: Promise.resolve({}) }
const jreq = (headers: Record<string, string>, body: unknown) =>
  new Request('https://s/x', { method: 'POST', headers, body: JSON.stringify(body) })

let replaced: { restore(): void } | undefined
beforeEach(() => {
  jest.clearAllMocks()
  rows.clear()
  held.clear()
  enqueued = null
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  replaced = jest.replaceProperty(RECORDING_SWITCHES as { bindUnboundUploads: boolean }, 'bindUnboundUploads', true)
})
afterEach(() => replaced?.restore())

/** Step 1 — the phone's no_session fallback upload, switch ON: row X is born
 *  UPLOADING on the exact key the phone PUTs to (and then adopts). */
async function mintX(): Promise<string> {
  const res = await mintPOST(jreq({ ...auth, 'idempotency-key': 'm1' }, { stagedFor: null, attachOutcome: 'no_session', customerId: 'cust-1' }), noRoute)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { path: string; recordingSessionId: string }
  expect(body.recordingSessionId).toBe(X)
  expect(rows.get(X)).toMatchObject({ status: 'UPLOADING', audio_storage_path: body.path, staff_id: 'auth-user-1', store_id: 'store-1' })
  return body.path
}

describe('O3 — a phone 再試行 after an adopted X (switch ON): the server path TODAY', () => {
  it('the job door accepts X’s key on X (isOwnRecordingKey + takeKeyHolder "own") and enqueues against it', async () => {
    const key = await mintX()
    // Step 2 — retry() → runServerJob: { recordingSessionId: X, audioPath: finalizedPath (= X's key) }.
    const res = await jobPOST(jreq({ ...auth, 'idempotency-key': 'j1' }, { recordingSessionId: X, customerId: 'cust-1', audioPath: key }), noRoute)
    expect(res.status).toBe(200)
    expect(recordingsGet).toHaveBeenCalledWith(X)
    expect(enqueued).toMatchObject({ recording_session_id: X, payload: { audio_path: key, customer_id: 'cust-1', store_id: 'store-1' } })
  })

  it('the worker transcribes X while its row is still UPLOADING — it never reads the row, and never finalizes it', async () => {
    const key = await mintX()
    await jobPOST(jreq({ ...auth, 'idempotency-key': 'j2' }, { recordingSessionId: X, customerId: 'cust-1', audioPath: key }), noRoute)
    const readsBefore = recordingsGet.mock.calls.length
    claim
      .mockResolvedValueOnce({
        id: 'job-x',
        business_id: 'business-1',
        recording_session_id: X,
        status: 'RUNNING',
        attempts: 1,
        max_attempts: 3,
        last_error: null,
        karute_record_id: null,
        claimed_at: null,
        created_at: '',
        updated_at: '',
        payload: enqueued!.payload,
      })
      .mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    // No status gate: not one read of X's row, not one write to it.
    expect(recordingsGet.mock.calls.length).toBe(readsBefore)
    expect(recordingsUpdate).not.toHaveBeenCalled()
    expect(rows.get(X)!.status).toBe('UPLOADING')
    // It read the object at X's key and paid to transcribe it, on X.
    expect(createSignedUrl).toHaveBeenCalledWith(key, 3600)
    expect(runMeteredTranscription).toHaveBeenCalledTimes(1)
    expect(runMeteredTranscription.mock.calls[0][0]).toMatchObject({ recordingSessionId: X, audioKey: key, door: 'job' })
    // …and the karute lands, the job completes.
    expect(karuteRecordsCreate).toHaveBeenCalledTimes(1)
    expect(karuteRecordsCreate.mock.calls[0]).toEqual([expect.objectContaining({ recording_session_id: X })])
    expect(complete).toHaveBeenCalledWith('job-x', 'record-x')
    expect(fail).not.toHaveBeenCalled()
  })
})

/**
 * Greptile #1078 P2: the two cases above hand X's key to the job door
 * DIRECTLY, so a phone that stopped saving X — or stopped sending its key on
 * 再試行 — would leave them green. This one drives the phone's OWN client code,
 * end to end, against the same two real doors:
 *
 *   GlobalPipeline.start (no row: the start-time mint failed) → run() →
 *   runAIPipeline → ensureAudioOnServer → secureTake knocks on the session door
 *   (down) → the unbound door as 'no_session' → switch ON answers X →
 *   adoptMintedSession → take-store adoptTakeSession stamps X + X's key on the
 *   take, and the context is told → transcribe on X → extraction refused →
 *   'error' → retry() → isServerJobEligible (X + customer + outcome, a
 *   supportsServerJob port) → runServerJob → finalizedAudioPath reads the take's
 *   key → the thin port's enqueueJob → job door → enqueued on X.
 *
 * The port is the real thin one (thin/ports/recording.vite.ts) behind a fake
 * facade-fetch that adds the Bearer and the store lens and hands each call to
 * the route in this file; the AI doors and the storage PUT are the only fakes.
 */
describe('O3 — the phone’s OWN 再試行 after it adopted X (client flow, switch ON)', () => {
  const TAKE = '8d4c2b1a-3e5f-4a6b-9c7d-0e1f2a3b4c5d'
  const SESSION = '/api/app/v1/recordings/session'
  const UPLOAD = '/api/app/v1/recordings/upload-url'
  const JOB = '/api/app/v1/recordings/job'
  const TRANSCRIBE = '/api/app/v1/ai/transcribe'
  type Call = { path: string; method: string; body: Record<string, unknown> | null }
  const facade: Call[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  /** facade-fetch.ts's job (Bearer + store lens), then the route itself. */
  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? 'GET'
    const text = typeof init.body === 'string' ? init.body : null
    facade.push({ path, method, body: text ? (JSON.parse(text) as Record<string, unknown>) : null })
    const headers = new Headers(init.headers)
    headers.set('authorization', auth.authorization)
    headers.set('store-id', 'store-1')
    const req = () => new Request(`https://s${path}`, { method, headers, body: text })
    if (path === UPLOAD) return mintPOST(req(), noRoute)
    if (path === JOB && method === 'POST') return jobPOST(req(), noRoute)
    if (path.startsWith(`${JOB}/`)) {
      // The status door, answered from the job table above: a 404 is "no job".
      const id = decodeURIComponent(path.slice(JOB.length + 1))
      return enqueued?.recording_session_id === id
        ? json(200, { status: 'QUEUED', karuteRecordId: null, attempts: 0, maxAttempts: 3, lastError: null })
        : json(404, { error: { code: 'not_found', message: 'no job for this session' } })
    }
    // The start-time mint failed, and the session door is still down at stop.
    if (path === SESSION) return json(503, { error: { code: 'upstream_unavailable', message: 'core down' } })
    if (path === TRANSCRIBE) return json(200, { transcript: 'こんにちは', paragraphs: [], words: [], confidence: 1 })
    // The run fails AFTER transcription: the AI ceiling refuses extraction (a
    // refusal leaves on the first answer — fetchWithRetry — so no 1.5 s wait).
    if (path === '/api/app/v1/ai/extract') return json(429, { error: 'ai_limit' })
    if (path === '/api/app/v1/ai/summarize') return json(200, { summary: 'S' })
    throw new Error(`unexpected facade call ${method} ${path}`)
  }
  /** The signed-URL PUT (plain fetch on the phone). */
  const put = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== 'PUT' || !url.startsWith('https://proj.supabase.co/upload/')) throw new Error(`unexpected fetch ${url}`)
    return new Response(null, { status: 200 })
  })
  const settle = async (done: () => boolean) => {
    for (let i = 0; i < 500 && !done(); i++) await new Promise((r) => setImmediate(r))
  }

  const realFetch = global.fetch
  const priorDataPort = getDataPort()
  const priorRecordingPort = getRecordingPipelinePort()
  beforeEach(() => {
    facade.length = 0
    for (const s of idbStores.values()) s.data.clear()
    // The server path's poll sleeps 5 s before its first status read; faked so
    // it never fires — the pin is the enqueue, not the settlement.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    global.fetch = put as unknown as typeof fetch
    setDataPort({ ...priorDataPort, apiFetch })
    setRecordingPipelinePort(viteRecordingPort)
  })
  afterEach(() => {
    globalPipeline.reset()
    jest.useRealTimers()
    global.fetch = realFetch
    setDataPort(priorDataPort)
    setRecordingPipelinePort(priorRecordingPort)
  })

  it('adopts X from the no_session fallback, fails after transcription, and 再試行 hands X’s row id AND X’s key to the job door', async () => {
    // The take at stop, written by the recorder's own writers: no row on it
    // (the start-time mint failed), whole on disk, stop stamp on the tail.
    expect(
      await createTake({
        takeId: TAKE,
        target: { customerId: 'cust-1', customerName: '田中', karuteNumber: null, appointmentId: null },
        recordingSessionId: null,
        mimeType: 'audio/webm',
        startedAt: Date.now() - 42_000,
      }),
    ).toBe(true)
    expect(await appendTakeSegment(TAKE, 0, new Blob(['take bytes'], { type: 'audio/webm' }), 42_000)).toBe(true)

    globalPipeline.start(new Blob(['take bytes'], { type: 'audio/webm' }), {
      locale: 'ja',
      customers: [],
      appointmentCustomerId: 'cust-1',
      outcome: { status: 'success' },
      recordingSessionId: null,
      serverRowMissing: true,
      takeId: TAKE,
      duration: 42,
    })
    await settle(() => globalPipeline.state !== 'processing')

    // Run 1: in-tab (no row → not server-eligible), and it failed after transcription.
    expect(globalPipeline.state).toBe('error')
    expect(facade.some((c) => c.path === SESSION)).toBe(true)
    // The fallback reached the unbound door as 'no_session'; the ON arm made X on the key it signed.
    expect(facade.filter((c) => c.path === UPLOAD).map((c) => c.body)).toEqual([
      expect.objectContaining({ stagedFor: null, attachOutcome: 'no_session', customerId: 'cust-1', durationSeconds: 42 }),
    ])
    const key = rows.get(X)!.audio_storage_path!
    expect(rows.get(X)).toMatchObject({ status: 'UPLOADING', staff_id: 'auth-user-1', store_id: 'store-1' })
    expect(put).toHaveBeenCalledWith(`https://proj.supabase.co/upload/${key}`, expect.objectContaining({ method: 'PUT' }))
    expect(facade.filter((c) => c.path === TRANSCRIBE).map((c) => c.body)).toEqual([
      expect.objectContaining({ path: key, recordingSessionId: X }),
    ])

    // 再試行 — the phone's own retry.
    globalPipeline.retry()
    await settle(() => globalPipeline.serverOwned || globalPipeline.state !== 'processing')

    // ⚖ THE PIN: the phone sent X's row id AND X's key — read off the take — to the job door…
    expect(facade.filter((c) => c.path === JOB && c.method === 'POST').map((c) => c.body)).toEqual([
      expect.objectContaining({ recordingSessionId: X, audioPath: key, customerId: 'cust-1' }),
    ])
    // …which accepted it (isOwnRecordingKey + takeKeyHolder 'own') and enqueued on X.
    expect(enqueued).toMatchObject({
      recording_session_id: X,
      payload: { audio_path: key, customer_id: 'cust-1', store_id: 'store-1' },
    })
    // The server owns the run now: the phone polls it, and nothing ran in-tab a second time.
    expect(globalPipeline.serverOwned).toBe(true)
    expect(facade.filter((c) => c.path === UPLOAD)).toHaveLength(1)
    expect(facade.filter((c) => c.path === TRANSCRIBE)).toHaveLength(1)
    // What made it so — both halves of the adoption, read back through the real store.
    expect(await readTakeSecureMeta(TAKE)).toMatchObject({ recordingSessionId: X, finalizedPath: key })
    expect(globalPipeline.context?.recordingSessionId).toBe(X)
  })
})
