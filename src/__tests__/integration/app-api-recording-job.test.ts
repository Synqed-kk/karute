// Recording job facade twins (packet 22 B2): enqueue + status poll. Mirrors
// app-api-recording-consent.test.ts's harness (same recording-flow-batch
// pattern) — capability + Idempotency-Key + the #452 fail-closed staff
// posture + the revocation registration. All network mocked; the Bearer
// verifier runs for real.
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
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] as Array<{ id: string; full_name: string; display_role: string }> }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
// Deterministic: the profile→synqed-staff translation is pre-existing, tested
// elsewhere — pin only that this route CALLS it and uses its result.
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: jest.fn(async (id: string) => `synqed-${id}`),
}))

// synqed client — recordingJobs (enqueue/status) + stores/staffStores (the
// clamp, unlensed by default: floating staff, no store-id header sent).
const jobsEnqueue = jest.fn(
  async (_input: unknown): Promise<{ id: string; status: string }> => ({
    id: 'job-1',
    status: 'QUEUED',
  }),
)
const getByRecordingSession = jest.fn(
  async (
    _sessionId: string,
  ): Promise<{
    status: string
    karute_record_id: string | null
    attempts: number
    max_attempts: number
    last_error: string | null
  }> => ({
    status: 'DONE',
    karute_record_id: 'record-1',
    attempts: 1,
    max_attempts: 3,
    last_error: null,
  }),
)
const storesGet = jest.fn(async () => ({ id: 'store-1' }))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] }))
// Reads the 'revisit' eligibility guard makes. Defaults = a brand-new
// prospect (no signal anywhere), so a test must opt IN to being returning.
const customerGet = jest.fn(async () => ({
  is_existing_customer: false,
  visit_count: 0,
  has_ticket_pack: false,
}))
const listPacks = jest.fn(async (): Promise<Array<{ status: string; kind: string }>> => [])
type KaruteRow = { id: string; recording_session_id: string | null }
const listKaruteRecords = jest.fn(async (): Promise<{ karute_records: KaruteRow[] }> => ({
  karute_records: [],
}))
const fakeClient = {
  recordingJobs: { enqueue: jobsEnqueue, getByRecordingSession },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
  customers: { get: customerGet },
  packs: { listPacks },
  karuteRecords: { list: listKaruteRecords },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST as jobPOST } from '@/app/api/app/v1/recordings/job/route'
import { GET as jobGET } from '@/app/api/app/v1/recordings/job/[sessionId]/route'
import { REVOCATION_SENSITIVE_ENDPOINTS } from '@/lib/auth/revocation'
import { conformingKey, refusedKeys } from './helpers/recording-key-fixtures'

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
const authOnly = { authorization: `Bearer ${bearer()}` }
const auth = { ...authOnly, 'content-type': 'application/json' }
const noRoute = { params: Promise.resolve({}) }
const sessionRoute = (sessionId = 'sess-1') => ({ params: Promise.resolve({ sessionId }) })
const jreq = (method: string, headers: Record<string, string>, body?: unknown) =>
  new Request('https://s/x', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })

// audioPath MUST be EXACTLY a key minted for this caller — the upload-url facade
// only ever mints `app_${businessId}_<uuid>.webm` (businessId here = 'business-1').
const OWN_KEY = conformingKey('business-1')
const validBody = { recordingSessionId: 'sess-1', customerId: 'cust-1', audioPath: OWN_KEY }

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view', 'records.write'])
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  jobsEnqueue.mockResolvedValue({ id: 'job-1', status: 'QUEUED' })
  getByRecordingSession.mockResolvedValue({
    status: 'DONE',
    karute_record_id: 'record-1',
    attempts: 1,
    max_attempts: 3,
    last_error: null,
  })
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  customerGet.mockResolvedValue({
    is_existing_customer: false,
    visit_count: 0,
    has_ticket_pack: false,
  })
  listPacks.mockResolvedValue([])
  listKaruteRecords.mockResolvedValue({ karute_records: [] })
})

describe('POST recordings/job (enqueue)', () => {
  it('happy → 200 {ok,jobId,status}; staff_id is the RESOLVED synqed id, not the raw profile id', async () => {
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, jobId: 'job-1', status: 'QUEUED' })
    const [call] = jobsEnqueue.mock.calls[0] as [{ recording_session_id: string; payload: Record<string, unknown> }]
    expect(call.recording_session_id).toBe('sess-1')
    expect(call.payload).toMatchObject({
      customer_id: 'cust-1',
      audio_path: OWN_KEY,
      staff_id: 'synqed-auth-user-1',
    })
  })

  // One row per grammar class (helpers/recording-key-fixtures). Half carry this
  // caller's OWN prefix — the bare `startsWith` this gate used to be took every
  // one of those straight to the worker's service-role mint and delete.
  it.each(refusedKeys('business-1'))(
    'refuses %s → 404, no enqueue (the service-role read/delete gate)',
    async (_label, audioPath) => {
      const res = await jobPOST(
        jreq('POST', { ...auth, ...idem }, { ...validBody, audioPath }),
        noRoute,
      )
      expect(res.status).toBe(404)
      expect(jobsEnqueue).not.toHaveBeenCalled()
    },
  )

  it('a non-string audioPath is refused by the schema, before the fence → 400', async () => {
    // The grammar's typeof guard is proved on the server-action arm
    // (recording-jobs-tenant-key.test.ts), where the argument is raw JSON. Here
    // zod's `z.string()` meets a non-string first — what matters is it never
    // becomes an enqueue either way.
    const res = await jobPOST(
      jreq('POST', { ...auth, ...idem }, { ...validBody, audioPath: 12345 }),
      noRoute,
    )
    expect(res.status).toBe(400)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('outcome rides the payload untouched', async () => {
    await jobPOST(
      jreq('POST', { ...auth, ...idem }, { ...validBody, outcome: { status: 'success', isFirstVisit: true } }),
      noRoute,
    )
    const [call] = jobsEnqueue.mock.calls[0] as [{ payload: Record<string, unknown> }]
    expect(call.payload.outcome).toEqual({ status: 'success', isFirstVisit: true })
  })

  it('missing Idempotency-Key → 400, no enqueue', async () => {
    const res = await jobPOST(jreq('POST', auth, validBody), noRoute)
    expect(res.status).toBe(400)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no enqueue', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(403)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('invalid body (missing required field) → 400', async () => {
    const res = await jobPOST(
      jreq('POST', { ...auth, ...idem }, { customerId: 'cust-1', audioPath: 'x.webm' }),
      noRoute,
    )
    expect(res.status).toBe(400)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('unresolvable selfStaffId → 403, no enqueue (#452 posture)', async () => {
    roster.current = [{ id: 'someone-else', full_name: 'x', display_role: 'practitioner' }]
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(403)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('revoked staffer → 401 via server round-trip (no fast-path)', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(401)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('missing Bearer → 401', async () => {
    const res = await jobPOST(jreq('POST', { ...idem, 'content-type': 'application/json' }, validBody), noRoute)
    expect(res.status).toBe(401)
  })

  it('core enqueue failure → 502, never a silent drop', async () => {
    jobsEnqueue.mockRejectedValueOnce(new Error('core down'))
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(502)
  })

  it("'recordings.job.enqueue' is registered revocation-sensitive (a just-terminated staffer must re-verify)", () => {
    expect(REVOCATION_SENSITIVE_ENDPOINTS.has('recordings.job.enqueue')).toBe(true)
  })
})

describe('GET recordings/job/[sessionId] (status)', () => {
  it('happy → 200 with the RecordingJobStatusView shape', async () => {
    const res = await jobGET(new Request('https://s/x', { headers: authOnly }), sessionRoute())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'DONE',
      karuteRecordId: 'record-1',
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
    })
  })

  it('FAILED status carries lastError', async () => {
    getByRecordingSession.mockResolvedValueOnce({
      status: 'FAILED',
      karute_record_id: null,
      attempts: 3,
      max_attempts: 3,
      last_error: 'EMPTY_TRANSCRIPT',
    })
    const res = await jobGET(new Request('https://s/x', { headers: authOnly }), sessionRoute())
    expect((await res.json()).lastError).toBe('EMPTY_TRANSCRIPT')
  })

  it('job not found (SynqedError 404) → 404 — the ONLY absence signal the client may fall back on', async () => {
    getByRecordingSession.mockRejectedValueOnce(Object.assign(new Error('Job not found'), { status: 404 }))
    const res = await jobGET(new Request('https://s/x', { headers: authOnly }), sessionRoute())
    expect(res.status).toBe(404)
  })

  it('core trouble (SynqedError 500) → upstream error, NEVER 404 (a blip must not read as job absence)', async () => {
    getByRecordingSession.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    const res = await jobGET(new Request('https://s/x', { headers: authOnly }), sessionRoute())
    expect(res.status).not.toBe(404)
    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  it('statusless throw (network/timeout inside the facade) → upstream error, NEVER 404', async () => {
    getByRecordingSession.mockRejectedValueOnce(new Error('socket hang up'))
    const res = await jobGET(new Request('https://s/x', { headers: authOnly }), sessionRoute())
    expect(res.status).not.toBe(404)
  })

  it('missing capability → 403', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await jobGET(new Request('https://s/x', { headers: authOnly }), sessionRoute())
    expect(res.status).toBe(403)
  })

  it('missing Bearer → 401', async () => {
    const res = await jobGET(new Request('https://s/x'), sessionRoute())
    expect(res.status).toBe(401)
  })
})

// Enqueue-time eligibility, NOT worker-time: processJob writes the outcome
// only after Deepgram + OpenAI have run, so a rejection there would re-spend
// both on every retry. Rejecting before the job row exists is free.
describe("POST recordings/job — 'revisit' eligibility is checked BEFORE any AI spend", () => {
  const withOutcome = (status: string) => ({
    ...validBody,
    outcome: { status, isFirstVisit: false },
  })

  it('returning customer → enqueued normally, outcome rides the payload', async () => {
    customerGet.mockResolvedValue({
      is_existing_customer: true,
      visit_count: 6,
      has_ticket_pack: false,
    })
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, withOutcome('revisit')), noRoute)
    expect(res.status).toBe(200)
    const [call] = jobsEnqueue.mock.calls[0] as [{ payload: { outcome?: { status: string } } }]
    expect(call.payload.outcome).toMatchObject({ status: 'revisit' })
  })

  it('first-visit prospect → 400 and NO job is queued (no AI is ever paid for)', async () => {
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, withOutcome('revisit')), noRoute)
    expect(res.status).toBe(400)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('UNKNOWN → a RETRYABLE upstream error, never a 400 (nothing persisted, our fault)', async () => {
    customerGet.mockRejectedValue(new Error('core down'))
    listPacks.mockRejectedValue(new Error('core down'))
    listKaruteRecords.mockRejectedValue(new Error('core down'))
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, withOutcome('revisit')), noRoute)
    expect(res.status).not.toBe(400)
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('a transient read failure RECOVERED by the retry → enqueued normally', async () => {
    listKaruteRecords
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({ karute_records: [{ id: 'k-old', recording_session_id: 'sess-earlier' }] })
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, withOutcome('revisit')), noRoute)
    expect(res.status).toBe(200)
    expect(jobsEnqueue).toHaveBeenCalledTimes(1)
  })

  it.each(['success', 'no_deal', 'pending'])(
    '%s enqueues untouched — the guard costs it zero reads',
    async (status) => {
      const res = await jobPOST(jreq('POST', { ...auth, ...idem }, withOutcome(status)), noRoute)
      expect(res.status).toBe(200)
      expect(jobsEnqueue).toHaveBeenCalledTimes(1)
      expect(customerGet).not.toHaveBeenCalled()
      expect(listPacks).not.toHaveBeenCalled()
      expect(listKaruteRecords).not.toHaveBeenCalled()
    },
  )

  it('no outcome at all → enqueues, no guard reads', async () => {
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, validBody), noRoute)
    expect(res.status).toBe(200)
    expect(customerGet).not.toHaveBeenCalled()
  })
})

// A RETAKE reuses the recording session and converges on take-1's record, so
// take-1 must not make take-2's enqueue look like a returning customer.
describe('POST recordings/job — a retake is not its own proof of prior history', () => {
  const withRevisit = { ...validBody, outcome: { status: 'revisit', isFirstVisit: false } }

  it("the only karute on file is take-1 of THIS recording session → 400, no enqueue", async () => {
    listKaruteRecords.mockResolvedValue({
      karute_records: [{ id: 'k-take1', recording_session_id: 'sess-1' }],
    })
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, withRevisit), noRoute)
    expect(res.status).toBe(400)
    expect(jobsEnqueue).not.toHaveBeenCalled()
  })

  it('a karute from a DIFFERENT session → enqueued (real prior history counts)', async () => {
    listKaruteRecords.mockResolvedValue({
      karute_records: [{ id: 'k-old', recording_session_id: 'sess-earlier' }],
    })
    const res = await jobPOST(jreq('POST', { ...auth, ...idem }, withRevisit), noRoute)
    expect(res.status).toBe(200)
    expect(jobsEnqueue).toHaveBeenCalledTimes(1)
  })
})
