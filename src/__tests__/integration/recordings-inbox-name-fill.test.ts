/**
 * 録音履歴 — the server-side customer NAME FILL, at its single source of truth
 * (⚖ Liam 2026-08-17).
 *
 * WHY IT EXISTS AT ALL: these rows are STAFF-scoped
 * (recordings.list({staff_id})) while both record screens' customer arrays are
 * STORE-scoped, so a clamped staffer's own recording of an out-of-store
 * customer has an id neither array can resolve — the row would render 不明.
 * Filling here, where the whole business is legitimately visible, is what keeps
 * the roster OFF the wire: the business-wide list is a `.get(id)` lookup, so
 * only the names these rows reference ever ship (store-scope.ts ~:288-294 — a
 * clamped client must never RECEIVE another branch's names, so
 * filter-after-ship was never an option).
 *
 * WHY IT IS TESTED HERE: the fill lives inside readRecordingsInbox precisely so
 * the cookie action and the Bearer facade route cannot disagree about a row's
 * name. Both arms now depend on this one function, so it gets its own pin
 * rather than being covered only through whichever arm someone happened to
 * test. The route-level claims (the name reaching the DTO, a degraded fill
 * still being 200) stay in app-api-recordings-inbox.test.ts; the arm-level
 * claim (businessId threaded) stays in recordings-inbox-web-action.test.ts.
 */
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))

const getCachedCustomerListFor = jest.fn(async (..._a: unknown[]) => [
  { id: 'cust-1', name: '佐藤 美咲' },
  { id: 'cust-other-branch', name: '代官山 太郎' },
])
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: (...a: unknown[]) => getCachedCustomerListFor(...a),
}))

import { readRecordingsInbox } from '@/lib/recordings/inbox-read'

const NOW = new Date('2026-08-25T04:00:00.000Z')
const iso = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString()

type Rec = { id: string; customer_id: string | null; duration_seconds: number; created_at: string }
const recordings = { current: [] as Rec[] }

// karuteRecords answers a record for every session, so nothing reaches the job
// probe — this suite is about names, and the state table is pinned next door.
const client = {
  recordings: {
    list: jest.fn(async () => ({
      recordings: recordings.current,
      total: recordings.current.length,
    })),
  },
  karuteRecords: {
    list: jest.fn(async () => ({
      karute_records: recordings.current.map((r) => ({
        id: `rec-${r.id}`,
        recording_session_id: r.id,
      })),
      total: recordings.current.length,
    })),
  },
  recordingJobs: { getByRecordingSession: jest.fn() },
} as unknown as Parameters<typeof readRecordingsInbox>[0]['synqed']

const read = () =>
  readRecordingsInbox({ synqed: client, staffId: 'staff-1', businessId: 'biz-1', now: NOW })

beforeEach(() => {
  jest.clearAllMocks()
  getCachedCustomerListFor.mockImplementation(async () => [
    { id: 'cust-1', name: '佐藤 美咲' },
    { id: 'cust-other-branch', name: '代官山 太郎' },
  ])
  recordings.current = [
    { id: 'sess-out', customer_id: 'cust-other-branch', duration_seconds: 300, created_at: iso(30) },
  ]
})

describe('readRecordingsInbox — server-side customer name fill', () => {
  it('fills the name for a customer no store-scoped array could resolve', async () => {
    const [row] = await read()
    expect(row.customerName).toBe('代官山 太郎')
    // Business-wide, keyed by tenant and nothing else.
    expect(getCachedCustomerListFor).toHaveBeenCalledWith('biz-1')
  })

  it('an unresolvable id keeps the name absent — never a wrong or invented one', async () => {
    recordings.current = [
      { id: 'sess-gone', customer_id: 'cust-gone', duration_seconds: 300, created_at: iso(30) },
    ]
    const [row] = await read()
    expect(row.customerName).toBeUndefined()
    expect(row.customerId).toBe('cust-gone')
  })

  it('a failed list read degrades to the pre-fill behaviour, loudly', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    getCachedCustomerListFor.mockRejectedValueOnce(new Error('core down'))
    const [row] = await read()
    expect(row.customerName).toBeUndefined()
    expect(warn.mock.calls[0][0]).toEqual(
      expect.stringContaining('[recordings-inbox] customer name fill degraded'),
    )
    warn.mockRestore()
  })

  // F7 — the edges never met in one batch, which is the shape a real inbox has.
  it('a MIXED batch: resolvable, unresolvable and walk-in rows in one read', async () => {
    recordings.current = [
      { id: 'sess-out', customer_id: 'cust-other-branch', duration_seconds: 300, created_at: iso(10) },
      { id: 'sess-gone', customer_id: 'cust-gone', duration_seconds: 300, created_at: iso(20) },
      { id: 'sess-walkin', customer_id: null, duration_seconds: 300, created_at: iso(30) },
      { id: 'sess-mine', customer_id: 'cust-1', duration_seconds: 300, created_at: iso(40) },
    ]
    const rows = await read()
    // Rows sort newest first, so this is the batch as the card renders it.
    expect(rows.map((r) => [r.recordingSessionId, r.customerName])).toEqual([
      ['sess-out', '代官山 太郎'],
      ['sess-gone', undefined],
      ['sess-walkin', undefined],
      ['sess-mine', '佐藤 美咲'],
    ])
    // One list read for the whole batch, not one per row.
    expect(getCachedCustomerListFor).toHaveBeenCalledTimes(1)
  })

  it('a walk-in row (no customer id) skips the read entirely', async () => {
    recordings.current = [
      { id: 'sess-walkin', customer_id: null, duration_seconds: 300, created_at: iso(30) },
    ]
    const [row] = await read()
    expect(row.customerId).toBeNull()
    expect(getCachedCustomerListFor).not.toHaveBeenCalled()
  })
})
