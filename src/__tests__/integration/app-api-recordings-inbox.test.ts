// 録音履歴 facade GET (Build F1). The construction contract this route exists
// to keep: the staff scope comes from the AUTHENTICATED actor and from nowhere
// else, a store the caller may not see is refused before any read, and the
// karute join must survive the two write paths stamping DIFFERENT staff ids on
// the record. Harness mirrors app-api-recording-job.test.ts — all network
// mocked, the Bearer verifier runs for real.
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
const roster = {
  current: [
    { id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' },
    { id: 'auth-user-2', full_name: '原', display_role: 'practitioner' },
  ] as Array<{ id: string; full_name: string; display_role: string }>,
}
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

type RecordingRow = {
  id: string
  customer_id: string | null
  staff_id: string
  duration_seconds: number | null
  created_at: string
}
type KaruteRow = { id: string; recording_session_id: string | null; staff_id: string }

const recordingRows = { current: [] as RecordingRow[] }
const karuteRows = { current: [] as KaruteRow[] }

const listRecordings = jest.fn(async (opts: Record<string, unknown>) => {
  // The route is expected to scope by staff_id server-side; honour it here so a
  // test can prove which id was actually sent.
  const rows = recordingRows.current.filter(
    (r) => !opts.staff_id || r.staff_id === opts.staff_id,
  )
  return { recordings: rows, total: rows.length, page: 1, page_size: 500 }
})
const listKarute = jest.fn(async () => ({
  karute_records: karuteRows.current,
  total: karuteRows.current.length,
  page: 1,
  page_size: 500,
}))
const getByRecordingSession = jest.fn(async (_id: string) => {
  throw Object.assign(new Error('not found'), { status: 404 })
})
const storesGet = jest.fn(async (id: string) => ({ id }))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))

const fakeClient = {
  recordings: { list: listRecordings },
  karuteRecords: { list: listKarute },
  recordingJobs: { getByRecordingSession },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { GET } from '@/app/api/app/v1/recordings/inbox/route'
import { FACADE_AUDIT_MAP } from '@/lib/audit'

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
const noRoute = { params: Promise.resolve({}) }
const req = (url = 'https://s/api/app/v1/recordings/inbox', headers: Record<string, string> = {}) =>
  new Request(url, { method: 'GET', headers: { authorization: `Bearer ${bearer()}`, ...headers } })

const nowIso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString()

/** First argument of a recorded SDK list call, as a plain bag. */
const listOpts = (call: unknown): Record<string, unknown> =>
  ((call as unknown[])[0] as Record<string, unknown> | undefined) ?? {}

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view', 'records.write'])
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  storesGet.mockImplementation(async (id: string) => ({ id }))
  getByRecordingSession.mockImplementation(async () => {
    throw Object.assign(new Error('not found'), { status: 404 })
  })
  recordingRows.current = [
    { id: 'sess-mine', customer_id: 'cust-1', staff_id: 'auth-user-1', duration_seconds: 1380, created_at: nowIso(90) },
    { id: 'sess-theirs', customer_id: 'cust-9', staff_id: 'auth-user-2', duration_seconds: 600, created_at: nowIso(80) },
  ]
  karuteRows.current = []
})

describe('GET recordings/inbox — actor-derived scoping', () => {
  it('lists ONLY the authenticated actor’s own sessions', async () => {
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Array<{ recordingSessionId: string }> }
    expect(body.sessions.map((s) => s.recordingSessionId)).toEqual(['sess-mine'])
    expect(listOpts(listRecordings.mock.calls[0])).toMatchObject({ staff_id: 'auth-user-1' })
  })

  it('NEGATIVE: a supplied staff_id is ignored — the read still uses the actor’s id', async () => {
    // The whole point of the contract: no query string, header, or body can
    // widen the scope. A caller asking for someone else's recordings gets
    // their own.
    const res = await GET(
      req('https://s/api/app/v1/recordings/inbox?staff_id=auth-user-2', { 'staff-id': 'auth-user-2' }),
      noRoute,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Array<{ recordingSessionId: string }> }
    expect(body.sessions.map((s) => s.recordingSessionId)).toEqual(['sess-mine'])
    for (const call of listRecordings.mock.calls) {
      expect(listOpts(call).staff_id).toBe('auth-user-1')
    }
  })

  it('a caller with no staff row gets an empty list, never the whole salon', async () => {
    roster.current = [{ id: 'someone-else', full_name: 'x', display_role: 'owner' }]
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessions: [] })
    expect(listRecordings).not.toHaveBeenCalled()
    roster.current = [
      { id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' },
      { id: 'auth-user-2', full_name: '原', display_role: 'practitioner' },
    ]
  })

  it('without records.write → 403, no read', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(403)
    expect(listRecordings).not.toHaveBeenCalled()
  })
})

describe('GET recordings/inbox — store isolation', () => {
  it('a store-id the caller may not see is refused BEFORE any read', async () => {
    // A branch-restricted staffer pinned to store-1 asking for store-2.
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req(undefined, { 'store-id': 'store-2' }), noRoute)
    expect(res.status).toBe(403)
    expect(listRecordings).not.toHaveBeenCalled()
    expect(listKarute).not.toHaveBeenCalled()
  })

  it('a store-id from another business is refused BEFORE any read', async () => {
    storesGet.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    const res = await GET(req(undefined, { 'store-id': 'store-other-tenant' }), noRoute)
    expect(res.status).toBe(403)
    expect(listRecordings).not.toHaveBeenCalled()
  })
})

describe('GET recordings/inbox — the join', () => {
  it('joins a karute record by recording_session_id', async () => {
    karuteRows.current = [
      { id: 'rec-1', recording_session_id: 'sess-mine', staff_id: 'auth-user-1' },
    ]
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as { sessions: Array<{ karuteRecordId: string | null }> }
    expect(body.sessions[0].karuteRecordId).toBe('rec-1')
  })

  it('joins a record the WORKER wrote, whose staff_id is the synqed id, not the profile id', async () => {
    // enqueueRecordingJob resolves profile → synqed staff id and the worker
    // writes THAT onto the karute record, while the interactive save writes the
    // profile id. Filtering the karute list by either would make the other
    // path's records invisible and render a saved session as 失敗.
    karuteRows.current = [
      { id: 'rec-1', recording_session_id: 'sess-mine', staff_id: 'synqed-auth-user-1' },
    ]
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as { sessions: Array<{ karuteRecordId: string | null }> }
    expect(body.sessions[0].karuteRecordId).toBe('rec-1')
    // …and the karute list is deliberately NOT staff-filtered.
    expect(listOpts(listKarute.mock.calls[0]).staff_id).toBeUndefined()
  })

  it('probes job status ONLY for record-less sessions', async () => {
    recordingRows.current = [
      { id: 'sess-a', customer_id: 'c1', staff_id: 'auth-user-1', duration_seconds: null, created_at: nowIso(200) },
      { id: 'sess-b', customer_id: 'c2', staff_id: 'auth-user-1', duration_seconds: null, created_at: nowIso(300) },
    ]
    karuteRows.current = [{ id: 'rec-a', recording_session_id: 'sess-a', staff_id: 'auth-user-1' }]
    getByRecordingSession.mockResolvedValue({
      status: 'FAILED',
      karute_record_id: null,
      attempts: 3,
      max_attempts: 3,
      last_error: 'EMPTY_TRANSCRIPT',
    } as never)
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as {
      sessions: Array<{ recordingSessionId: string; jobStatus: string | null; jobLastError: string | null }>
    }
    expect(getByRecordingSession).toHaveBeenCalledTimes(1)
    expect(getByRecordingSession).toHaveBeenCalledWith('sess-b')
    const byId = Object.fromEntries(body.sessions.map((s) => [s.recordingSessionId, s]))
    expect(byId['sess-a'].jobStatus).toBeNull()
    expect(byId['sess-b']).toMatchObject({ jobStatus: 'FAILED', jobLastError: 'EMPTY_TRANSCRIPT' })
  })

  it('a 404 from the job probe is an answer, not a failure — the row still ships', async () => {
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Array<{ jobStatus: string | null }> }
    expect(body.sessions[0].jobStatus).toBeNull()
  })

  it('lastError is carried ONLY on FAILED (a DONE job leaks no error text)', async () => {
    getByRecordingSession.mockResolvedValue({
      status: 'DONE',
      karute_record_id: null,
      attempts: 1,
      max_attempts: 3,
      last_error: 'stale text from an earlier attempt',
    } as never)
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as { sessions: Array<{ jobLastError: string | null }> }
    expect(body.sessions[0].jobLastError).toBeNull()
  })

  it('the DTO carries metadata only — no transcript, summary or audio path', async () => {
    karuteRows.current = [{ id: 'rec-1', recording_session_id: 'sess-mine', staff_id: 'auth-user-1' }]
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as { sessions: Array<Record<string, unknown>> }
    expect(Object.keys(body.sessions[0]).sort()).toEqual([
      'createdAt',
      'customerId',
      'durationSeconds',
      'jobLastError',
      'jobStatus',
      'karuteRecordId',
      'recordingSessionId',
    ])
  })

  it('a 7-day window is asked of BOTH lists', async () => {
    await GET(req(), noRoute)
    const from = String(listOpts(listRecordings.mock.calls[0]).from)
    expect(listOpts(listKarute.mock.calls[0]).from).toBe(from)
    const days = (Date.now() - Date.parse(from)) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('an upstream failure is a 502, never a silent empty list', async () => {
    listRecordings.mockRejectedValue(new Error('core down'))
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(502)
  })
})

describe('GET recordings/inbox — audit registration', () => {
  it('is a wayfinding skip like every other list GET', () => {
    expect(FACADE_AUDIT_MAP['recordings.inbox']).toEqual({
      kind: 'skip',
      category: 'recording',
      action: '',
    })
  })
})
