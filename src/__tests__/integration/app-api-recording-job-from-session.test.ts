// The 保存する-from-the-server facade door (build 23 slice ③):
// POST /api/app/v1/recordings/job/from-session. Harness mirrors
// app-api-recording-job.test.ts — all network mocked, the Bearer verifier runs
// for real. What only THIS level can prove: the envelope (capability,
// Idempotency-Key, the strict schema that refuses an audioPath key outright),
// the store clamp running BEFORE the body, and the refusal mapping — the shared
// body's own rules are pinned in recording-enqueue-from-session.test.ts.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view', 'records.write']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: jest.fn(async (id: string) => `synqed-${id}`),
}))
const objectExists = jest.fn(async (_key: string): Promise<boolean | 'unknown'> => true)
jest.mock('@/lib/recording/mint-take-url', () => ({
  objectExists: (key: string) => objectExists(key),
}))

type Row = {
  id: string
  business_id: string
  staff_id: string
  /** PR-B's stamp: the store the DEVICE was in. Null on every pre-③ row, which
   *  D7 reads as open. */
  store_id: string | null
  audio_storage_path: string | null
  duration_seconds: number | null
  status: string
}
const current = { row: null as Row | null }
const recordingsGet = jest.fn(async (_id: string) => current.row)
const jobsEnqueue = jest.fn(async (_a: unknown) => ({ id: 'job-1', status: 'QUEUED' }))
/** The ledger row shape the door's fence RE-READS since fix round 2 (R1) —
 *  carried here so this transport's pins prove the answer, not the count. */
type DiscardEvent = { id: string; recording_session_id: string; source: 'STAFF' | 'SYSTEM' }
const discardEvent = (over: Partial<DiscardEvent> = {}): DiscardEvent => ({
  id: 'disc-1',
  recording_session_id: 'sess-1',
  source: 'STAFF',
  ...over,
})
const listDiscards = jest.fn(
  async (_o: unknown): Promise<{ events: DiscardEvent[] }> => ({ events: [] }),
)
const storesGet = jest.fn(async (id: string) => ({ id }))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  recordings: { get: recordingsGet },
  recordingJobs: { enqueue: jobsEnqueue },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
  customers: { get: jest.fn() },
  packs: { listPacks: jest.fn(async () => []) },
  karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) },
  recordingDiscards: { list: listDiscards },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST } from '@/app/api/app/v1/recordings/job/from-session/route'
import { REVOCATION_SENSITIVE_ENDPOINTS } from '@/lib/auth/revocation'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import { conformingKey } from './helpers/recording-key-fixtures'

const BIZ = 'business-1'
const OWN_KEY = conformingKey(BIZ)
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
const idem = { 'idempotency-key': 'k1' }
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }
const noRoute = { params: Promise.resolve({}) }
const req = (headers: Record<string, string>, body?: unknown) =>
  new Request('https://s/api/app/v1/recordings/job/from-session', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const validBody = { recordingSessionId: 'sess-1', customerId: 'cust-1' }

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CRON_SECRET
  capabilities.current = new Set(['customers.view', 'records.write'])
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  current.row = {
    id: 'sess-1',
    business_id: BIZ,
    staff_id: 'auth-user-1',
    store_id: null,
    audio_storage_path: OWN_KEY,
    duration_seconds: 1380,
    status: 'UPLOADING',
  }
  objectExists.mockResolvedValue(true)
  listDiscards.mockResolvedValue({ events: [] })
  jobsEnqueue.mockResolvedValue({ id: 'job-1', status: 'QUEUED' })
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  storesGet.mockImplementation(async (id: string) => ({ id }))
})

describe('POST recordings/job/from-session', () => {
  it('happy → 200 {ok,jobId,status}; the path comes from the ROW', async () => {
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, jobId: 'job-1', status: 'QUEUED' })
    const [call] = jobsEnqueue.mock.calls[0] as [{ payload: Record<string, unknown> }]
    expect(call.payload).toMatchObject({
      customer_id: 'cust-1',
      staff_id: 'synqed-auth-user-1',
      audio_path: OWN_KEY,
    })
  })

  it('THE SCHEMA REFUSES AN audioPath KEY — a caller cannot name an object here', async () => {
    const res = await POST(
      req({ ...auth, ...idem }, { ...validBody, audioPath: `app_other-biz_x.webm` }),
      noRoute,
    )
    expect(res.status).toBe(400)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('a missing Idempotency-Key is a 400 before anything is read', async () => {
    const res = await POST(req(auth, validBody), noRoute)
    expect(res.status).toBe(400)
    expect(recordingsGet).not.toHaveBeenCalled()
  })

  it('without records.write it is a 403', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(403)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('a body that is not JSON is a 400', async () => {
    const res = await POST(
      new Request('https://s/x', { method: 'POST', headers: { ...auth, ...idem }, body: 'nope' }),
      noRoute,
    )
    expect(res.status).toBe(400)
  })

  it('OFF the roster is a 403 — the worker cannot attribute an unrostered save', async () => {
    roster.current = []
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(403)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('a store the caller may not see is 403, BEFORE the body runs', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-mine'] })
    const res = await POST(
      req({ ...auth, ...idem, 'store-id': 'store-theirs' }, validBody),
      noRoute,
    )
    expect(res.status).toBe(403)
    expect(recordingsGet).not.toHaveBeenCalled()
  })

  it("a colleague's session without the owner's hand → 403, storage NEVER touched", async () => {
    // ⚖ R4 — the order pin on the Bearer transport: a 404-vs-403 split decided
    // after the probe would answer "is a colleague's take in the bucket".
    current.row = { ...current.row!, staff_id: 'auth-user-2' }
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(403)
    expect(objectExists).not.toHaveBeenCalled()
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  // ⚖ THE OWNER'S HAND REACHES ONLY WHERE SHE CAN SEE — on THIS transport too
  // (fix round 4, R3). The web arm has had this pin since the rebase; the
  // Bearer arm had none, so typing `allowedStoreIds: null` here to satisfy the
  // compiler would have shipped green while reading as UNCLAMPED under D7. The
  // reach comes from the staff ASSIGNMENT, never the `store-id` header — these
  // three cases send no header at all.
  const ownerHand = () =>
    new Set(['customers.view', 'records.write', 'business.manage', 'recordings.viewAll'])

  it("a colleague's row stamped in a store she cannot see → 403, storage untouched", async () => {
    capabilities.current = ownerHand()
    staffStoresGet.mockResolvedValue({ store_ids: ['store-mine'] })
    current.row = { ...current.row!, staff_id: 'auth-user-2', store_id: 'store-9' }
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(403)
    expect(objectExists).not.toHaveBeenCalled()
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it("…and the same row stamped in a store she CAN see goes through", async () => {
    capabilities.current = ownerHand()
    staffStoresGet.mockResolvedValue({ store_ids: ['store-mine'] })
    current.row = { ...current.row!, staff_id: 'auth-user-2', store_id: 'store-mine' }
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(200)
    expect(jobsEnqueue).toHaveBeenCalledTimes(1)
  })

  it('a pre-③ row with NO store stays open to the owner’s hand (D7)', async () => {
    capabilities.current = ownerHand()
    staffStoresGet.mockResolvedValue({ store_ids: ['store-mine'] })
    current.row = { ...current.row!, staff_id: 'auth-user-2', store_id: null }
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(200)
    expect(jobsEnqueue).toHaveBeenCalledTimes(1)
  })

  it('a STAFF-discarded session → 409, and nothing is queued (R9a)', async () => {
    listDiscards.mockResolvedValue({ events: [discardEvent()] })
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(409)
    expect(objectExists).not.toHaveBeenCalled()
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('⚖ R1: a discard for ANOTHER session is not this one — the save goes through', async () => {
    listDiscards.mockResolvedValue({
      events: [discardEvent({ id: 'disc-9', recording_session_id: 'sess-OTHER' })],
    })
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(200)
    expect(jobsEnqueue).toHaveBeenCalledTimes(1)
  })

  it('an unreadable discard ledger → 502, never a save', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    listDiscards.mockRejectedValue(new Error('core down'))
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(502)
    expect(jobsEnqueue).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('no object in the bucket → 404, and nothing is queued', async () => {
    objectExists.mockResolvedValue(false)
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(404)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it("storage answering 'unknown' → 502, a retryable shape", async () => {
    objectExists.mockResolvedValue('unknown')
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(502)
  })

  it('a failed enqueue → 502', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    jobsEnqueue.mockRejectedValue(new Error('core down'))
    const res = await POST(req({ ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(502)
    err.mockRestore()
  })

  it('the endpoint is revocation-sensitive and audits through the worker', () => {
    expect(REVOCATION_SENSITIVE_ENDPOINTS.has('recordings.job.enqueueFromSession')).toBe(true)
    expect(FACADE_AUDIT_MAP['recordings.job.enqueueFromSession']).toEqual({
      kind: 'skip',
      category: 'recording',
      action: '',
      coveredBy: 'src/lib/jobs/process-recording.ts#processJob',
    })
  })
})
