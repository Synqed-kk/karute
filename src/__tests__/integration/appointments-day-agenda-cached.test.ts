/**
 * Coverage for getCachedDayAgenda (src/lib/appointments/day-agenda-cached.ts) —
 * the 予約 page's WEB-ONLY 60s day-agenda cache.
 *
 * SENSITIVE tier (bookings): these tests pin the cache's safety contract —
 *   - the cache key carries (businessId, storeId): drop either and the
 *     key-args test goes red (a shared entry across tenants/stores is the
 *     poisoning bug this guards against);
 *   - a NULL store scope never touches the cache: null can mean a DEGRADED
 *     RBAC lookup (getStaffStores swallows outages to [] → clamp dropped),
 *     and memoizing that would serve an unclamped business-wide row set to
 *     later requests for 60s (blind-round tenancy finding);
 *   - names are decorated OUTSIDE the cache from the businessId-explicit
 *     customer list — never baked into the cached body's rows;
 *   - the invalidation envelope is exactly { revalidate: 60, tags:
 *     ['dashboard', 'staff-list'] };
 *   - the error→[] swallow lives OUTSIDE the cached body: the body REJECTS on
 *     a failed fetch, so a COLD miss during an outage is never stored as an
 *     empty agenda. (Warm-stale entries are a different regime: installed
 *     Next serves last-known-good and swallows failed background refreshes —
 *     deliberate, documented in the module header, not simulatable with this
 *     passthrough mock.)
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

const A_ROW = {
  id: 'a1',
  starts_at: '2026-07-30T01:00:00Z',
  duration_minutes: 60,
  staff_id: 's1',
  title: 'Cut',
  notes: null,
  customer_id: 'c1',
  status: 'CONFIRMED',
}

beforeEach(() => {
  jest.clearAllMocks()
  cacheCallArgs.length = 0
  getBusinessIdMock.mockResolvedValue(BIZ)
  resolveStoreScopeMock.mockResolvedValue({
    storeId: 'store-ginza',
    viewAll: false,
    allowedStoreIds: ['store-ginza'],
  })
  getCachedCustomerListForMock.mockResolvedValue([{ id: 'c1', name: 'Hanako' }])
  appointments.list.mockResolvedValue({ appointments: [] })
  karuteRecords.list.mockResolvedValue({ karute_records: [] })
  staff.list.mockResolvedValue({ staff: [] })
})

describe('getCachedDayAgenda', () => {
  it('keys the cache on (businessId, storeId, dateStr) — tenancy + store in every entry', async () => {
    await getCachedDayAgenda('2026-07-30')

    expect(cacheCallArgs).toEqual([[BIZ, 'store-ginza', '2026-07-30']])
  })

  it('NEVER caches a null store scope — degraded RBAC lookups must not be memoized', async () => {
    resolveStoreScopeMock.mockResolvedValue({
      storeId: null,
      viewAll: true,
      allowedStoreIds: null,
    })
    appointments.list.mockResolvedValue({ appointments: [A_ROW] })

    const rows = await getCachedDayAgenda('2026-07-30')

    // Live fetch ran (business-wide, store_id undefined), nothing stored.
    expect(cacheCallArgs).toEqual([])
    expect(appointments.list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: undefined }),
    )
    // Decoration still applies on the bypass path.
    expect(rows[0]).toMatchObject({ id: 'a1', customers: { name: 'Hanako' } })
  })

  it('pins the invalidation envelope: 60s TTL + dashboard/staff-list tags', () => {
    expect(cacheKeyParts).toEqual(['appointments-day-agenda-v2'])
    expect(cacheOpts).toEqual({
      revalidate: 60,
      tags: ['dashboard', 'staff-list'],
    })
  })

  it('scopes the fetch to the RBAC-resolved store and decorates names OUTSIDE the cache', async () => {
    appointments.list.mockResolvedValue({ appointments: [A_ROW] })

    const rows = await getCachedDayAgenda('2026-07-30')

    expect(appointments.list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
    expect(karuteRecords.list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
    // Name source: the businessId-explicit list, resolved by the wrapper.
    expect(getCachedCustomerListForMock).toHaveBeenCalledWith(BIZ)
    expect(rows[0]).toMatchObject({ id: 'a1', customers: { name: 'Hanako' } })
  })

  it('the cached BODY never bakes names — rows leave the cache with customers: null', async () => {
    appointments.list.mockResolvedValue({ appointments: [A_ROW] })

    const raw = (await cachedBody(BIZ, 'store-ginza', '2026-07-30')) as Array<{
      customers: unknown
    }>

    expect(raw[0].customers).toBeNull()
    // The body must not reach for the customer list at all (a nested
    // unstable_cache read is bypassed by Next — it would re-pay the full
    // pagination on every regeneration).
    expect(getCachedCustomerListForMock).not.toHaveBeenCalled()
  })

  it('keeps the agenda tombstone contract: terminal rows pass through', async () => {
    appointments.list.mockResolvedValue({
      appointments: [{ ...A_ROW, status: 'CANCELLED' }],
    })

    const rows = await getCachedDayAgenda('2026-07-30')

    expect(rows).toHaveLength(1)
    expect(rows[0].synqed_status).toBe('CANCELLED')
  })

  it('REJECTS inside the cached body on fetch failure — a cold miss is never stored as []', async () => {
    appointments.list.mockRejectedValue(new Error('core down'))

    // The swallow must live outside the cache boundary: body rejects…
    await expect(cachedBody(BIZ, 'store-ginza', '2026-07-30')).rejects.toThrow(
      'core down',
    )
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
