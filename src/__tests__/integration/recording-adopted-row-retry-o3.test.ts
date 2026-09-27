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

import { POST as mintPOST } from '@/app/api/app/v1/recordings/upload-url/route'
import { POST as jobPOST } from '@/app/api/app/v1/recordings/job/route'
import { processRecordingJobs } from '@/lib/jobs/process-recording'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

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
