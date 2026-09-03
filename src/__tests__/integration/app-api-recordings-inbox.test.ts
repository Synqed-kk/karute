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
// SDK shape (recording-discards.d.ts's RecordingDiscardEvent) isn't a public
// export of @synqed-kk/client — inbox-read.ts only reads recording_session_id
// off it, but the mock still needs the full row shape to type-check.
type DiscardEventRow = {
  id: string
  recording_session_id: string
  source: 'STAFF' | 'SYSTEM'
  discarded_by: string | null
  reason: string | null
  created_at: string
}

const recordingRows = { current: [] as RecordingRow[] }
const karuteRows = { current: [] as KaruteRow[] }

const listRecordingsImpl = async (opts: Record<string, unknown>) => {
  // The route is expected to scope by staff_id server-side; honour it here so a
  // test can prove which id was actually sent.
  const rows = recordingRows.current.filter(
    (r) => !opts.staff_id || r.staff_id === opts.staff_id,
  )
  return { recordings: rows, total: rows.length, page: 1, page_size: 500 }
}
const listKaruteImpl = async () => ({
  karute_records: karuteRows.current,
  total: karuteRows.current.length,
  page: 1,
  page_size: 500,
})
const listRecordings = jest.fn(listRecordingsImpl)
const listKarute = jest.fn(listKaruteImpl)
const getByRecordingSession = jest.fn(async (_id: string) => {
  throw Object.assign(new Error('not found'), { status: 404 })
})
const storesGet = jest.fn(async (id: string) => ({ id }))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))

const recordingsGet = jest.fn(async (id: string) => ({
  id,
  staff_id: 'auth-user-1',
  customer_id: 'cust-1',
  audio_storage_path: null,
  // ⚖ capture pipeline PR4 fix round 1: the cleanup keeps any row whose status
  // has left RECORDING — something happened to that take after the row was
  // minted, and this is not the place to decide it did not.
  status: 'RECORDING',
}))
const recordingsDelete = jest.fn(async (_id: string) => {})
/** The cleanup's provenance probe. Default = 404: no karute for this session,
 *  so it really is an orphan. */
const karuteNotFound = () => Object.assign(new Error('no record'), { status: 404 })
const getKaruteByRecordingSession = jest.fn(async (_id: string): Promise<unknown> => {
  throw karuteNotFound()
})
const fakeClient = {
  recordings: { list: listRecordings, get: recordingsGet, delete: recordingsDelete },
  karuteRecords: { list: listKarute, getByRecordingSession: getKaruteByRecordingSession },
  recordingJobs: { getByRecordingSession },
  // P5-A item A2-3: the inbox read now also asks the discard ledger which
  // sessions a staff member deliberately threw away. Empty here — these suites
  // are about the customer-name fill / the facade envelope, not discards.
  recordingDiscards: {
    list: jest.fn(
      async (): Promise<{
        events: DiscardEventRow[]
        total: number
        page: number
        page_size: number
      }> => ({ events: [], total: 0, page: 1, page_size: 200 }),
    ),
  },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

// The shared read's server-side name fill (⚖ 2026-08-17) resolves through this
// business-wide list, used strictly as a .get(id) lookup. Only the READ is
// faked — the fill itself runs for real inside readRecordingsInbox.
const getCachedCustomerListFor = jest.fn(async (..._a: unknown[]) => [
  { id: 'cust-1', name: '山田 花子' },
  { id: 'cust-other-branch', name: '代官山 太郎' },
])
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: (...a: unknown[]) => getCachedCustomerListFor(...a),
}))

import { GET } from '@/app/api/app/v1/recordings/inbox/route'
import { DELETE as SESSION_DELETE } from '@/app/api/app/v1/recordings/session/[id]/route'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import { RecordingsInboxDTO } from '@/lib/app-api/recordings-inbox-dto'

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
  // clearAllMocks clears CALLS, not implementations: a test that installs a
  // mockRejectedValue would otherwise poison every test after it.
  listRecordings.mockImplementation(listRecordingsImpl)
  listKarute.mockImplementation(listKaruteImpl)
  recordingsGet.mockImplementation(async (id: string) => ({
    id,
    staff_id: 'auth-user-1',
    customer_id: 'cust-1',
    audio_storage_path: null,
    status: 'RECORDING',
  }))
  recordingsDelete.mockImplementation(async () => {})
  getKaruteByRecordingSession.mockImplementation(async () => {
    throw karuteNotFound()
  })
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
  getCachedCustomerListFor.mockImplementation(async () => [
    { id: 'cust-1', name: '山田 花子' },
    { id: 'cust-other-branch', name: '代官山 太郎' },
  ])
})

// ⚖ Liam 2026-08-17. These rows are STAFF-scoped; the record screen's customer
// array is STORE-scoped (screens/record/route.ts), so a clamped staffer's own
// recording of an out-of-store customer has an id that array cannot resolve.
// The name is filled inside the shared read and now rides the DTO, so the
// phone renders it instead of 不明 at the next bake.
describe('GET recordings/inbox — server-side customer name fill', () => {
  it('ships the name for a customer outside the caller’s store lens', async () => {
    recordingRows.current = [
      {
        id: 'sess-out',
        customer_id: 'cust-other-branch',
        staff_id: 'auth-user-1',
        duration_seconds: 300,
        created_at: nowIso(30),
      },
    ]
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sessions: Array<{ recordingSessionId: string; customerName?: string | null }>
    }
    expect(body.sessions[0].customerName).toBe('代官山 太郎')
    // Business-wide list, keyed by the VERIFIED token identity — never a header.
    expect(getCachedCustomerListFor).toHaveBeenCalledWith('business-1')
  })

  // The fill's own edge cases (unresolvable id, no-id skip) live with the
  // shared read in recordings-inbox-name-fill.test.ts. What only THIS level can
  // prove is that a degraded fill is still a 200 — the route's failure contract.
  it('a failed list read degrades to no name, never a failed inbox', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    getCachedCustomerListFor.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Array<{ customerName?: string | null }> }
    expect(body.sessions[0].customerName).toBeUndefined()
    expect(warn.mock.calls[0][0]).toEqual(
      expect.stringContaining('[recordings-inbox] customer name fill degraded'),
    )
    warn.mockRestore()
  })

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
    // customerName joined the allowlist with the ⚖ 2026-08-17 server-side fill.
    // Same tier as the customerId already here — WHO the session is about, not
    // WHAT was said; the privacy line this guard defends is transcript /
    // summary / audio path, and none of them moved.
    expect(Object.keys(body.sessions[0]).sort()).toEqual([
      'createdAt',
      'customerId',
      'customerName',
      'discardedByStaff',
      'durationSeconds',
      'jobLastError',
      'jobProbeFailed',
      'jobStatus',
      'karuteRecordId',
      'recordingSessionId',
    ])
  })

  it('page_size stays <= 200 on BOTH lists — core REJECTS above it (400)', async () => {
    // Fix round 2, caught on the live preview: core validates page_size with
    // z.coerce...max(200) on the recording AND karute list routes — it 400s
    // rather than clamping, so a 500 here blanked the whole inbox. NOT a
    // constant comparison: read the value the SDK actually received, so a
    // revert to 500 (or a "paginateDedupe says 500 is fine" edit) fails here.
    await GET(req(), noRoute)
    for (const call of [...listRecordings.mock.calls, ...listKarute.mock.calls]) {
      const size = listOpts(call).page_size
      expect(typeof size).toBe('number')
      expect(size as number).toBeLessThanOrEqual(200)
      expect(size as number).toBeGreaterThanOrEqual(1)
    }
    expect(listRecordings).toHaveBeenCalled()
    expect(listKarute).toHaveBeenCalled()
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

// Field bug 2026-08-30: zod object schemas strip unknown keys, so the
// discard ledger flag the shared reader computes (inbox-read.ts:189) was
// silently dropped at this facade door — a discarded take masqueraded as a
// failed one on phones while the web arm (no DTO in between) rendered it
// correctly. These pin the fix at the layer that actually broke: the facade
// response, not the shared reader or the fold (both already correct).
describe('GET recordings/inbox — discardedByStaff reaches the facade payload', () => {
  it('a session the ledger marked discarded carries discardedByStaff: true through the facade DTO', async () => {
    const discardsList = fakeClient.recordingDiscards.list
    discardsList.mockResolvedValueOnce({
      events: [
        {
          id: 'discard-1',
          recording_session_id: 'sess-mine',
          source: 'STAFF',
          discarded_by: 'auth-user-1',
          reason: 'wrong customer',
          created_at: nowIso(60),
        },
      ],
      total: 1,
      page: 1,
      page_size: 200,
    })
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sessions: Array<{ recordingSessionId: string; discardedByStaff?: boolean }>
    }
    const row = body.sessions.find((s) => s.recordingSessionId === 'sess-mine')
    expect(row?.discardedByStaff).toBe(true)
  })

  it('the DTO layer never invents a false — a session the input omits the key for stays undefined', () => {
    // Unit-level on the schema itself: the fold already treats absence as
    // "not discarded" (inbox.ts's `if (s.discardedByStaff)` truthy check), so
    // the DTO's only job is honesty about what it was actually given, never a
    // `.default(false)` that would paper over a caller that omitted the field.
    const parsed = RecordingsInboxDTO.parse({
      sessions: [
        {
          recordingSessionId: 'sess-x',
          customerId: null,
          createdAt: nowIso(1),
          durationSeconds: null,
          karuteRecordId: null,
          jobStatus: null,
          jobProbeFailed: false,
          jobLastError: null,
        },
      ],
    })
    expect(parsed.sessions[0].discardedByStaff).toBeUndefined()
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

describe('GET recordings/inbox — a failed probe is not an absent job (FX-1)', () => {
  it('404 → jobStatus null, jobProbeFailed FALSE (a real answer)', async () => {
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as {
      sessions: Array<{ jobStatus: string | null; jobProbeFailed: boolean }>
    }
    expect(body.sessions[0]).toMatchObject({ jobStatus: null, jobProbeFailed: false })
  })

  it.each([500, 503, 429])('a %d probe → jobProbeFailed TRUE, never a silent null', async (status) => {
    getByRecordingSession.mockRejectedValue(Object.assign(new Error('boom'), { status }))
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200) // the row still ships; only its job state is unknown
    const body = (await res.json()) as { sessions: Array<{ jobProbeFailed: boolean }> }
    expect(body.sessions[0].jobProbeFailed).toBe(true)
  })

  it('a transport reject with no status at all is also NOT read as "no job"', async () => {
    getByRecordingSession.mockRejectedValue(new Error('network down'))
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as { sessions: Array<{ jobProbeFailed: boolean }> }
    expect(body.sessions[0].jobProbeFailed).toBe(true)
  })

  it('an unrecognised status string rides the wire intact (phones bake this DTO)', async () => {
    getByRecordingSession.mockResolvedValue({
      status: 'RETRY_SCHEDULED',
      karute_record_id: null,
      attempts: 1,
      max_attempts: 3,
      last_error: null,
    } as never)
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: Array<{ jobStatus: string | null }> }
    expect(body.sessions[0].jobStatus).toBe('RETRY_SCHEDULED')
  })
})

describe('GET recordings/inbox — the N+1 stays bounded (FX-6b)', () => {
  it('a pathological residue probes exactly MAX_JOB_PROBES times, never once more', async () => {
    recordingRows.current = Array.from({ length: 140 }, (_, i) => ({
      id: `sess-${i}`,
      customer_id: 'c1',
      staff_id: 'auth-user-1',
      duration_seconds: null,
      created_at: nowIso(i + 1),
    }))
    karuteRows.current = []
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(200)
    expect(getByRecordingSession).toHaveBeenCalledTimes(100)
    // …and every row still ships — the cap costs job DETAIL, never the row.
    const body = (await res.json()) as { sessions: unknown[] }
    expect(body.sessions).toHaveLength(140)
  })
})

describe('GET recordings/inbox — a foreign record can never become a row (FX-7c)', () => {
  it('a karute record for someone else’s session is joined to nothing', async () => {
    // The karute list is deliberately not staff-filtered (the worker and the
    // web save stamp different ids). This is the belt: the ONLY thing that can
    // put a row on screen is a session in the actor's own set.
    karuteRows.current = [
      { id: 'rec-mine', recording_session_id: 'sess-mine', staff_id: 'auth-user-1' },
      { id: 'rec-theirs', recording_session_id: 'sess-theirs', staff_id: 'auth-user-2' },
      { id: 'rec-unknown', recording_session_id: 'sess-never-seen', staff_id: 'auth-user-2' },
    ]
    const res = await GET(req(), noRoute)
    const body = (await res.json()) as {
      sessions: Array<{ recordingSessionId: string; karuteRecordId: string | null }>
    }
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0]).toMatchObject({
      recordingSessionId: 'sess-mine',
      karuteRecordId: 'rec-mine',
    })
    expect(JSON.stringify(body)).not.toContain('rec-theirs')
    expect(JSON.stringify(body)).not.toContain('rec-unknown')
  })
})

describe('GET recordings/inbox — roster failure taxonomy (FX-7b)', () => {
  it('a transient roster failure is 502 upstream_unavailable, not a bare 500', async () => {
    const staff = jest.requireMock('@/lib/staff') as {
      staffListByBusinessOrThrow: jest.Mock
    }
    staff.staffListByBusinessOrThrow.mockRejectedValueOnce(new Error('core timeout'))
    const res = await GET(req(), noRoute)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('upstream_unavailable')
  })
})

describe('DELETE recordings/session/[id] — the discard cleanup twin', () => {
  const idem = { 'idempotency-key': 'k1' }
  const delReq = (headers: Record<string, string> = {}) =>
    new Request('https://s/api/app/v1/recordings/session/sess-1', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${bearer()}`, ...headers },
    })
  const route = (id = 'sess-1') => ({ params: Promise.resolve({ id }) })

  it('deletes the caller’s OWN session row', async () => {
    const res = await SESSION_DELETE(delReq(idem), route())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(recordingsDelete).toHaveBeenCalledWith('sess-1')
  })

  it('leaves ANOTHER staffer’s session untouched (core’s DELETE is business-scoped)', async () => {
    recordingsGet.mockResolvedValue({
      id: 'sess-1',
      staff_id: 'auth-user-2',
      customer_id: 'cust-9',
      audio_storage_path: null,
      status: 'RECORDING',
    })
    const res = await SESSION_DELETE(delReq(idem), route())
    expect(await res.json()).toEqual({ error: 'not_owned' })
    expect(recordingsDelete).not.toHaveBeenCalled()
  })

  it('refuses a session that already has a karute record (provenance gate)', async () => {
    // Both doors share the choke point, so the gate is live here too.
    getKaruteByRecordingSession.mockResolvedValue({ id: 'rec-1' })
    const res = await SESSION_DELETE(delReq(idem), route())
    expect(await res.json()).toEqual({ error: 'has_record' })
    expect(recordingsDelete).not.toHaveBeenCalled()
  })

  it('requires records.write', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await SESSION_DELETE(delReq(idem), route())
    expect(res.status).toBe(403)
    expect(recordingsDelete).not.toHaveBeenCalled()
  })

  it('requires an Idempotency-Key (it undoes an effectful mint)', async () => {
    const res = await SESSION_DELETE(delReq(), route())
    expect(res.status).toBe(400)
    expect(recordingsDelete).not.toHaveBeenCalled()
  })

  it('is registered revocation-sensitive and audit-skipped to the shared core', async () => {
    const { REVOCATION_SENSITIVE_ENDPOINTS } = await import('@/lib/auth/revocation')
    expect([...REVOCATION_SENSITIVE_ENDPOINTS]).toContain('recordings.session.delete')
    expect(FACADE_AUDIT_MAP['recordings.session.delete']).toMatchObject({
      kind: 'skip',
      coveredBy: 'src/lib/recording/session-cleanup.ts#deleteRecordingSessionWithClient',
    })
  })
})
