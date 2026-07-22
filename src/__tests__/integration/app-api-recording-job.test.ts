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
const fakeClient = {
  recordingJobs: { enqueue: jobsEnqueue, getByRecordingSession },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST as jobPOST } from '@/app/api/app/v1/recordings/job/route'
import { GET as jobGET } from '@/app/api/app/v1/recordings/job/[sessionId]/route'
import { REVOCATION_SENSITIVE_ENDPOINTS } from '@/lib/auth/revocation'

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

const validBody = { recordingSessionId: 'sess-1', customerId: 'cust-1', audioPath: 'rec_1.webm' }

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
      audio_path: 'rec_1.webm',
      staff_id: 'synqed-auth-user-1',
    })
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

  it('job not found → 404', async () => {
    getByRecordingSession.mockRejectedValueOnce(new Error('not found'))
    const res = await jobGET(new Request('https://s/x', { headers: authOnly }), sessionRoute())
    expect(res.status).toBe(404)
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
