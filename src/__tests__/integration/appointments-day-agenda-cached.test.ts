/**
 * Coverage for getCachedDayAgenda (src/lib/appointments/day-agenda-cached.ts) —
 * the 予約 page's WEB-ONLY 60s day-agenda cache.
 *
 * SENSITIVE tier (bookings): these tests pin the cache's safety contract, not
 * just its shape —
 *   - the cache key carries (businessId, storeId): drop either and the
 *     key-args test goes red (a shared entry across tenants/stores is the
 *     poisoning bug this guards against);
 *   - the invalidation envelope is exactly { revalidate: 60, tags:
 *     ['dashboard', 'customers', 'staff-list'] } — every web appointment/
 *     karute mutation bumps 'dashboard', so web edits repaint immediately;
 *   - auth resolves OUTSIDE the cached body (cookies() inside unstable_cache
 *     throws at runtime) — the body must use the businessId-EXPLICIT customer
 *     list variant;
 *   - the error→[] swallow lives OUTSIDE the cached body: the body REJECTS on
 *     a failed fetch, so Next never stores an empty agenda for 60s after a
 *     transient core outage.
 *
 * unstable_cache is mocked to capture (fn, keyParts, opts) and wrap fn in an
 * arg-recording spy, so key composition is asserted mechanically.
 */
process.env.SYNQED_CORE_URL = 'http://synqed.test'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const BIZ = 'biz-1'

const karuteRecords = { list: jest.fn() }
const appointments = { list: jest.fn() }
const staff = { list: jest.fn() }

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => ({ karuteRecords, appointments, staff })),
}))

// Capture the cache wiring: inner body, key parts, options, and every call's
// argument list (the cache key Next would derive). `var`, not let/const — the
// hoisted jest.mock factory runs during the static import below, before a
// let/const would initialize (TDZ).
/* eslint-disable no-var */
var cachedBody: (...args: unknown[]) => Promise<unknown>
var cacheKeyParts: string[] | undefined
var cacheOpts: { revalidate?: number; tags?: string[] } | undefined
var cacheCallArgs: unknown[][] = []
/* eslint-enable no-var */
jest.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts?: string[],
    opts?: { revalidate?: number; tags?: string[] },
  ) => {
    cachedBody = fn
    cacheKeyParts = keyParts
    cacheOpts = opts
    return (...args: unknown[]) => {
      cacheCallArgs.push(args)
      return fn(...args)
    }
  },
}))

const getBusinessIdMock = jest.fn()
jest.mock('@/lib/staff', () => ({
  getBusinessId: () => getBusinessIdMock(),
}))

const resolveStoreScopeMock = jest.fn()
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScopeMock(),
}))

const getCachedCustomerListForMock = jest.fn()
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: (businessId: string) =>
    getCachedCustomerListForMock(businessId),
}))

import { getCachedDayAgenda } from '@/lib/appointments/day-agenda-cached'

beforeEach(() => {
  jest.clearAllMocks()
  cacheCallArgs.length = 0
  getBusinessIdMock.mockResolvedValue(BIZ)
  resolveStoreScopeMock.mockResolvedValue({
    storeId: null,
    viewAll: true,
    allowedStoreIds: null,
  })
  getCachedCustomerListForMock.mockResolvedValue([{ id: 'c1', name: 'Hanako' }])
  appointments.list.mockResolvedValue({ appointments: [] })
  karuteRecords.list.mockResolvedValue({ karute_records: [] })
  staff.list.mockResolvedValue({ staff: [] })
})

describe('getCachedDayAgenda', () => {
  it('keys the cache on (businessId, storeId, dateStr) — tenancy + store in every entry', async () => {
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })

    await getCachedDayAgenda('2026-07-30')

    expect(cacheCallArgs).toEqual([[BIZ, 'store-ginza', '2026-07-30']])
  })

  it('normalizes the all-stores lens to an EXPLICIT null (constant arity — no key fork)', async () => {
    await getCachedDayAgenda('2026-07-30')

    expect(cacheCallArgs).toEqual([[BIZ, null, '2026-07-30']])
  })

  it('pins the invalidation envelope: 60s TTL + dashboard/customers/staff-list tags', () => {
    expect(cacheKeyParts).toEqual(['appointments-day-agenda-v1'])
    expect(cacheOpts).toEqual({
      revalidate: 60,
      tags: ['dashboard', 'customers', 'staff-list'],
    })
  })

  it('scopes the fetch to the RBAC-resolved store and resolves names via the businessId-explicit list', async () => {
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })
    appointments.list.mockResolvedValue({
      appointments: [
        {
          id: 'a1',
          starts_at: '2026-07-30T01:00:00Z',
          duration_minutes: 60,
          staff_id: 's1',
          title: 'Cut',
          notes: null,
          customer_id: 'c1',
          status: 'CONFIRMED',
        },
      ],
    })

    const rows = await getCachedDayAgenda('2026-07-30')

    expect(appointments.list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
    expect(karuteRecords.list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
    // No cookie-reading name source inside the cached body: the explicit
    // variant gets the businessId the wrapper resolved outside.
    expect(getCachedCustomerListForMock).toHaveBeenCalledWith(BIZ)
    expect(rows[0]).toMatchObject({ id: 'a1', customers: { name: 'Hanako' } })
  })

  it('keeps the agenda tombstone contract: terminal rows pass through', async () => {
    appointments.list.mockResolvedValue({
      appointments: [
        {
          id: 'a1',
          starts_at: '2026-07-30T01:00:00Z',
          duration_minutes: 60,
          staff_id: 's1',
          title: 'Cut',
          notes: null,
          customer_id: 'c1',
          status: 'CANCELLED',
        },
      ],
    })

    const rows = await getCachedDayAgenda('2026-07-30')

    expect(rows).toHaveLength(1)
    expect(rows[0].synqed_status).toBe('CANCELLED')
  })

  it('REJECTS inside the cached body on fetch failure — an outage is never stored as [] for 60s', async () => {
    appointments.list.mockRejectedValue(new Error('core down'))

    // The swallow must live outside the cache boundary: body rejects…
    await expect(cachedBody(BIZ, null, '2026-07-30')).rejects.toThrow('core down')
    // …and the public wrapper still honors the page's swallowed-[] contract.
    await expect(getCachedDayAgenda('2026-07-30')).resolves.toEqual([])
  })

  it('returns [] when auth resolution itself fails (same contract as getAppointmentsByDate)', async () => {
    getBusinessIdMock.mockRejectedValue(new Error('no session'))

    await expect(getCachedDayAgenda('2026-07-30')).resolves.toEqual([])
    // Nothing reached the cache — no entry to poison.
    expect(cacheCallArgs).toEqual([])
  })
})

export {}
