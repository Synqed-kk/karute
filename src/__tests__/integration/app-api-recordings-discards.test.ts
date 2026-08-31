// Facade: 破棄の記録 — the manager list and the per-row transcript, the phone
// arm of listDiscardReasons()/getDiscardTranscript(). Pins: both routes share
// the SAME twins the web actions delegate to · the gate is 'staff.manage',
// checked BEFORE any core read · the client is scoped to the Bearer identity's
// businessId · a missing sessionId is refused, never guessed · core's own 404
// on the segments read is the swept-session answer `{ segments: [] }` while
// EVERY other upstream failure is an error status, never a 2xx that would
// claim the words are gone (the A2-4 honesty law) · neither read writes an
// audit row (both map rows are a deliberate 'skip', web parity).
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
// @synqed-kk/client is ESM; audit()'s durable sink lazy-imports it — mock at
// the seam, same as app-api-audit-log.test.ts.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

const mockCapabilities = jest.fn(async () => new Set(['staff.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const staffListByBusinessOrThrow = jest.fn(async () => [
  { id: 'auth-user-1', full_name: '原 奏恵', display_role: 'owner' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
  staffListByBusinessOrThrow: () => staffListByBusinessOrThrow(),
}))
// The CARD id space the ledger actually stamps — graceful by contract, so the
// twin's name join never depends on it succeeding.
const synqedStaffCardsForBusiness = jest.fn(async () => [
  { id: 'card-A', user_id: 'auth-user-1', email: null, name: '原 カナエ' },
])
jest.mock('@/lib/synqed/staff-map', () => ({
  synqedStaffCardsForBusiness: () => synqedStaffCardsForBusiness(),
}))

/** The twin derives "this month" against `new Date()`, so an ABSOLUTE fixture
 *  date makes this suite go red on the first of a month with nothing changed —
 *  the count assertions below would read a last-month row. Derived from today
 *  instead, the untouched web suite's own idiom
 *  (discard-reasons-read.test.ts), which is what lets those assertions be
 *  EXACT numbers rather than expect.any(Number). */
const now = new Date()
const CREATED_AT = new Date(now.getFullYear(), now.getMonth(), 2, 10, 0, 0).toISOString()

type LedgerPage = {
  events: {
    id: string
    recording_session_id: string
    created_at: string
    discarded_by: string
    reason: string
  }[]
  total: number
  page: number
  page_size: number
}

const ONE_ROW_PAGE: LedgerPage = {
  events: [
    {
      id: 'row-1',
      recording_session_id: 'rs-1',
      created_at: CREATED_AT,
      discarded_by: 'card-A',
      reason: 'お客様が席を外したため録り直します',
    },
  ],
  total: 1,
  page: 1,
  page_size: 200,
}
/** Reassigned by the page-cap test below; beforeEach puts it back, so the
 *  answer never leaks into a later test (clearAllMocks does not undo a
 *  mockResolvedValue). */
let listPage: LedgerPage = ONE_ROW_PAGE
const discardsList = jest.fn(async () => listPage)
const listSegments = jest.fn(async () => ({
  segments: [
    { segment_index: 1, text: 'ふたつめ' },
    { segment_index: 0, text: 'ひとつめ' },
  ],
}))
const recordingsGet = jest.fn(async () => ({ duration_seconds: 42 }))
/** Prototype methods that read `this` — a receiver-losing call in the shared
 *  twin rejects here exactly like prod (same fidelity convention as
 *  discard-reasons-read.test.ts's ThisSensitiveDiscardClient). */
class ThisSensitiveDiscardClient {
  constructor(private impl: jest.Mock) {}
  async list(q: Record<string, unknown>) {
    return this.impl(q)
  }
}
class ThisSensitiveRecordingsClient {
  constructor(
    private segments: jest.Mock,
    private get_: jest.Mock,
  ) {}
  async listSegments(id: string) {
    return this.segments(id)
  }
  async get(id: string) {
    return this.get_(id)
  }
}
const fakeClient = {
  recordingDiscards: new ThisSensitiveDiscardClient(discardsList),
  recordings: new ThisSensitiveRecordingsClient(listSegments, recordingsGet),
}
const newSynqedClient = jest.fn((businessId: string) => {
  // The fake is tenant-agnostic; the id is taken only so mock.calls can prove
  // the client was scoped to the Bearer identity's business.
  void businessId
  return fakeClient
})
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET as LIST } from '@/app/api/app/v1/recordings/discards/route'
import { GET as TRANSCRIPT } from '@/app/api/app/v1/recordings/discards/transcript/route'
import { auditLines } from './helpers/audit-lines'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const noParams = { params: Promise.resolve({}) }

const listReq = (headers: Record<string, string> = { ...auth }) =>
  new Request('https://s/api/app/v1/recordings/discards', { headers })
const transcriptReq = (query = 'sessionId=rs-1', headers: Record<string, string> = { ...auth }) =>
  new Request(`https://s/api/app/v1/recordings/discards/transcript${query ? `?${query}` : ''}`, {
    headers,
  })

/** SynqedError's HTTP status is duck-typed by the twin (an SDK VALUE import
 *  drags the ESM package into jest) — so an upstream answer is a plain error
 *  carrying a numeric `status`, exactly as the real client throws. */
const upstream = (status: number) => Object.assign(new Error(`core ${status}`), { status })

beforeEach(() => {
  jest.clearAllMocks()
  listPage = ONE_ROW_PAGE
  mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
})

describe('GET /api/app/v1/recordings/discards', () => {
  it('missing Bearer → 401, zero core reads', async () => {
    const res = await LIST(new Request('https://s/api/app/v1/recordings/discards'), noParams)
    expect(res.status).toBe(401)
    expect(discardsList).not.toHaveBeenCalled()
  })

  it('missing staff.manage → 403, zero core reads, zero audit() calls', async () => {
    mockCapabilities.mockResolvedValue(new Set(['records.write']))
    const lines = await auditLines(async () => {
      const res = await LIST(listReq(), noParams)
      expect(res.status).toBe(403)
    })
    expect(discardsList).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('constructs the synqed client scoped to the Bearer identity\'s businessId', async () => {
    const res = await LIST(listReq(), noParams)
    expect(res.status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('serves the twin\'s rows/counts/truncated, names joined through the CARD id space', async () => {
    const res = await LIST(listReq(), noParams)
    expect(res.status).toBe(200)
    expect(discardsList).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'STAFF', page: 1, page_size: 200 }),
    )
    // EXACT counts, not expect.any(Number): the fixture row is dated inside
    // the current month by construction, so 1 is the whole answer — and a
    // month floor that stopped counting would otherwise slip through as
    // "still a number".
    expect(await res.json()).toEqual({
      rows: [
        {
          id: 'row-1',
          recordingSessionId: 'rs-1',
          createdAt: CREATED_AT,
          // The recording behind the row (⚖ 8/31). Null across the board here
          // because this fixture's client serves no recordings — which is the
          // honest answer, and the one the section renders as absences.
          customerId: null,
          customerName: null,
          recordingCreatedAt: null,
          durationSeconds: null,
          storeName: null,
          staffId: 'card-A',
          staffName: '原 奏恵',
          reason: 'お客様が席を外したため録り直します',
        },
      ],
      truncated: false,
      counts: {
        thisMonth: 1,
        total: 1,
        byStaff: [{ staffId: 'card-A', staffName: '原 奏恵', thisMonth: 1 }],
      },
    })
  })

  it('past the page cap the wire SAYS the counts are floors — truncated:true, not a short number passing as a total', async () => {
    // ⚖ 8/25 reaching the phone end-to-end. Every page comes back full against
    // a total the cap can never exhaust, so the twin runs MAX_PAGES and gives
    // up honestly. Without this the passthrough could be folded to a constant
    // false and every other assertion in this file would stay green.
    listPage = {
      events: Array.from({ length: 200 }, (_, i) => ({
        id: `bulk-${i}`,
        recording_session_id: `rs-bulk-${i}`,
        created_at: CREATED_AT,
        discarded_by: 'card-A',
        reason: 'まとめて破棄した記録',
      })),
      total: 100_000,
      page: 1,
      page_size: 200,
    }

    const res = await LIST(listReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { truncated: boolean; counts: { total: number } }
    // 20 pages × 200 = the cap itself, and it stopped there rather than
    // walking a 100,000-row ledger.
    expect(discardsList).toHaveBeenCalledTimes(20)
    expect(body.truncated).toBe(true)
    expect(body.counts.total).toBe(4000)
  })

  it('a manager READ writes no audit row (map row is a deliberate skip — web parity)', async () => {
    const lines = await auditLines(async () => {
      const res = await LIST(listReq(), noParams)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(0)
  })

  it('an upstream failure is an error status, never a 2xx empty ledger', async () => {
    discardsList.mockRejectedValueOnce(new Error('core down'))
    const res = await LIST(listReq(), noParams)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: expect.objectContaining({ code: 'upstream_unavailable' }),
    })
  })
})

describe('GET /api/app/v1/recordings/discards/transcript', () => {
  it('missing Bearer → 401, zero core reads', async () => {
    const res = await TRANSCRIPT(
      new Request('https://s/api/app/v1/recordings/discards/transcript?sessionId=rs-1'),
      noParams,
    )
    expect(res.status).toBe(401)
    expect(listSegments).not.toHaveBeenCalled()
  })

  it('missing staff.manage → 403, zero core reads', async () => {
    mockCapabilities.mockResolvedValue(new Set(['records.write']))
    const res = await TRANSCRIPT(transcriptReq(), noParams)
    expect(res.status).toBe(403)
    expect(listSegments).not.toHaveBeenCalled()
  })

  it('constructs the synqed client scoped to the Bearer identity\'s businessId', async () => {
    // The list route beside this one holds the same assertion; without it here
    // a literal substituted for ctx.identity.businessId would leave the WORDS
    // door — the one that reads what a customer actually said — reachable
    // across tenants with this whole suite still green.
    const res = await TRANSCRIPT(transcriptReq(), noParams)
    expect(res.status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('serves the twin\'s segments in index order with the duration', async () => {
    const res = await TRANSCRIPT(transcriptReq(), noParams)
    expect(res.status).toBe(200)
    expect(listSegments).toHaveBeenCalledWith('rs-1')
    // A segment with NO usable clock still serves, with startTime null. These
    // fixture segments carry no `start_time`, and that is the point: the route
    // must answer 200 with the words. Trusting the field cost a 500 here — the
    // phone being told we could not look at a transcript we were holding — so
    // the twin normalises the VALUE while the DTO stays strict on the KEY.
    expect(await res.json()).toEqual({
      segments: [
        { text: 'ひとつめ', startTime: null },
        { text: 'ふたつめ', startTime: null },
      ],
      durationSeconds: 42,
    })
  })

  it.each([['', 'absent'], ['sessionId=', 'blank'], ['sessionId=%20%20', 'whitespace-only']])(
    'a %s (%s) sessionId is refused as validation, never guessed',
    async (query) => {
      const res = await TRANSCRIPT(transcriptReq(query), noParams)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: expect.objectContaining({ code: 'validation' }) })
      expect(listSegments).not.toHaveBeenCalled()
    },
  )

  it('core\'s own 404 IS an answer — the swept session row reads as no words', async () => {
    listSegments.mockRejectedValueOnce(upstream(404))
    const res = await TRANSCRIPT(transcriptReq(), noParams)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ segments: [], durationSeconds: 42 })
  })

  // THE honesty law (A2-4): a read that FAILED must never be reported as an
  // absence of words on the one screen whose job is checking a staffer's claim.
  it.each([[500], [502], [429]])(
    'a core %d is an ERROR status, never a 2xx with empty segments',
    async (status) => {
      listSegments.mockRejectedValueOnce(upstream(status))
      const res = await TRANSCRIPT(transcriptReq(), noParams)
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({
        error: expect.objectContaining({ code: 'upstream_unavailable' }),
      })
    },
  )

  it('a status-less transport failure is an error too — no numeric status is not a 404', async () => {
    listSegments.mockRejectedValueOnce(new TypeError('fetch failed'))
    const res = await TRANSCRIPT(transcriptReq(), noParams)
    expect(res.status).toBe(502)
  })

  it('the duration read stays best-effort — a failed metadata read costs the below-floor distinction, never the words', async () => {
    recordingsGet.mockRejectedValueOnce(upstream(500))
    const res = await TRANSCRIPT(transcriptReq(), noParams)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      segments: [
        { text: 'ひとつめ', startTime: null },
        { text: 'ふたつめ', startTime: null },
      ],
      durationSeconds: null,
    })
  })

  it('a per-row READ writes no audit row (deliberate skip — web parity)', async () => {
    const lines = await auditLines(async () => {
      const res = await TRANSCRIPT(transcriptReq(), noParams)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(0)
  })
})
