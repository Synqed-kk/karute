/**
 * LAYER 4, DRIVEN AT THE REAL DOOR — fresh-eyes F1 + F2, fold round 2.
 *
 * The first round's backstop proofs drove shared helpers. These drive the
 * shipped ROUTE bodies, with the layers ABOVE them stubbed out: identity is
 * handed to `facadeHandler` directly (so the front gate never fires) and the
 * resolver is mocked to the shape an unassigned actor produces (so Layer 3 is
 * not the thing answering). What is left running is the backstop line itself —
 * which is the configuration the reviewer used to find both of these, and the
 * one the matrix's "gate OFF" column claims to cover.
 *
 * F1 — the facade notification bell. `clamp.storeId` is null for an unassigned
 * caller and derive.ts reads null as "no filter", so the bell would carry the
 * business's new bookings, draft カルテ and 要フォロー/休眠 counts — and, because
 * the feed is cached 60s per business, SEED that cache for every other
 * unassigned viewer of the same salon. The web twin had the guard; this did not.
 *
 * F2 — booking CREATE. The door hands `preferredStoreId: clamp.storeId` to
 * createAppointmentCore, whose
 * `deps.preferredStoreId ?? await defaultBookingStore(...)` then picks a store
 * FOR an unassigned actor: a WRITE into a branch they do not belong to,
 * indistinguishable on the row from a booking they were entitled to make.
 */

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

// ── the layers ABOVE the backstop, stubbed ─────────────────────────────────
const identity = {
  current: {
    authUserId: 'staff-1',
    businessId: 'business-1',
    capabilities: new Set(['customers.view', 'bookings.manage']),
    // Layer 2 explicitly OFF: on the gate branch this field exists and is what
    // facadeHandler refuses on. Held false so the door runs and the backstop
    // inside it is the only thing that can stop the read/write.
    unassigned: false,
    via: 'bearer' as const,
    email: null,
  },
}
jest.mock('@/lib/app-api/identity', () => ({
  resolveBearerIdentity: jest.fn(async () => identity.current),
}))

const clamp = {
  current: { storeId: null as string | null, allowedStoreIds: null as string[] | null },
}
jest.mock('@/lib/app-api/store-clamp', () => ({
  resolveStoreForRequest: jest.fn(async () => clamp.current),
}))

jest.mock('@/lib/audit', () => ({
  audit: jest.fn(),
  FACADE_AUDIT_MAP: new Proxy({}, { get: () => ({ kind: 'skip' }) }),
}))

// ── the things each door reads ─────────────────────────────────────────────
const buildNotificationFeed = jest.fn(async () => [])
jest.mock('@/lib/notifications/derive', () => ({
  buildNotificationFeed: (...a: unknown[]) => buildNotificationFeed(...(a as [])),
}))
const getCachedCustomerListFor = jest.fn(async () => [] as unknown[])
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: () => getCachedCustomerListFor(),
}))

// ── the READS the four Greptile findings are about ────────────────────────
const dayRead = jest.fn(async () => [] as unknown[])
const windowRead = jest.fn(async () =>
  jest.requireActual('@/lib/appointments/by-date').emptyAppointmentWindow(),
)
// Only the two READS are spied; every pure helper in the module runs for real,
// so an empty window here is the SAME shape production builds.
jest.mock('@/lib/appointments/by-date', () => {
  const actual = jest.requireActual('@/lib/appointments/by-date')
  return {
    ...actual,
    getAppointmentsByDateWithClient: () => dayRead(),
    fetchAppointmentWindow: () => windowRead(),
    fetchCoreStaffByProfileId: async () => new Map<string, string>(),
  }
})
// Honest stand-in: no rows, no label — the real picker answers the same way,
// and that is the point (the guard removes the ROWS, not the picker).
const pickNextCustomer = jest.fn((rows: unknown[]) =>
  rows.length === 0 ? null : { customerId: 'cust-1', customerName: '田中', reason: 'next' },
)
jest.mock('@/lib/appointments/next-customer', () => ({
  pickNextCustomer: (rows: unknown[]) => pickNextCustomer(rows),
}))
const listAllPackUsageWithClient = jest.fn(
  async () => new Map<string, unknown>([['cust-1', { remaining: 3 }]]),
)
jest.mock('@/lib/packs/store', () => ({
  listAllPackUsageWithClient: () => listAllPackUsageWithClient(),
}))

// The screen BUILDERS run FOR REAL — they are pure over the data the route
// gathers, so letting them run is both simpler than a shell and honest about
// what an empty read produces. Only the DTO parse is passed through: the wire
// schema is not what these tests are about.
jest.mock('@/lib/app-api/appointments-screen-dto', () => ({
  AppointmentsScreenDTO: { parse: (v: unknown) => v },
}))
jest.mock('@/lib/app-api/dashboard-screen-dto', () => ({
  DashboardScreenDTO: { parse: (v: unknown) => v },
}))
jest.mock('@/lib/app-api/chrome-dto', () => ({
  ChromeScreenDTO: { parse: (v: unknown) => v },
}))
jest.mock('@/lib/dashboard/screen', () => ({
  buildDashboardScreen: async () => ({ built: true }),
}))
jest.mock('@/lib/dashboard/cached', () => ({
  getDashboardDataFor: async () => ({}),
  emptyDashboardData: () => ({}),
}))
jest.mock('@/lib/packs/alerts', () => ({
  getPackAlertsWithClient: async () => ({}),
  emptyPackAlerts: () => ({}),
}))
jest.mock('@/lib/packs/reconcile', () => ({
  loadUnprocessedVisitsWithClient: async () => ({ entries: [], truncated: 0 }),
}))
jest.mock('@/lib/menus/cached', () => ({
  getCachedMenuOptionsFor: async () => [],
  scopeMenuOptions: () => [],
}))
jest.mock('@/lib/customers/list-enrich', () => ({ enrichCustomers: async () => new Map() }))
jest.mock('@/lib/auth/store-scope', () => {
  const actual = jest.requireActual('@/lib/auth/store-scope')
  return { ...actual, storeStaffIdSetForBusiness: async () => null }
})
jest.mock('@/lib/staff', () => ({
  staffListByBusinessOrThrow: async () => [{ id: 'profile-1', full_name: 'Mika' }],
  businessIdForUser: async () => 'business-1',
}))
// ⚠ CREATES a core staff record on a miss — which is why the booking door's
// refusal has to sit ABOVE it (Greptile on #948).
const resolveSynqedStaffIdForBusinessSpy = jest.fn(async () => 'staff-core-1')
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffIdForBusiness: () => resolveSynqedStaffIdForBusinessSpy(),
}))
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: async () => ({ operating_hours: null }),
}))
jest.mock('@/lib/appointments', () => ({ validateAppointmentTime: () => null }))

const apptCreate = jest.fn(async () => ({ id: 'appt-new' }))
const defaultBookingStore = jest.fn(async () => 'store-daikanyama')
jest.mock('@/lib/appointments/mutations', () => ({
  // The real core's own store line, kept verbatim — it IS the fallback the
  // guard exists to prevent:
  //   store_id: deps.preferredStoreId ?? await defaultBookingStore(...)
  createAppointmentCore: jest.fn(
    async (_c: unknown, _i: unknown, deps: { preferredStoreId: string | null }) => {
      const store_id = deps.preferredStoreId ?? (await defaultBookingStore())
      const row = await apptCreate()
      return { ...row, store_id }
    },
  ),
}))

// @synqed-kk/client is ESM-only; the appointments route reaches it through
// customer-facade → customers/queries at module load. Nothing here calls it.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {},
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))

const fakeClient = {
  stores: { list: async () => ({ stores: [{ id: 'store-ginza', name: '銀座', is_primary: true }] }) },
  storePolicies: {
    get: async () => ({ weekly_hours: null }),
    listClosedDays: async () => ({ closed_days: [] }),
  },
  staff: { list: async () => ({ staff: [] }) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient }))

import { GET as chromeGET } from '@/app/api/app/v1/screens/chrome/route'
import { POST as bookingPOST } from '@/app/api/app/v1/appointments/route'
import { GET as apptScreenGET } from '@/app/api/app/v1/screens/appointments/route'
import { GET as dashboardGET } from '@/app/api/app/v1/screens/dashboard/route'
import { resolveSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'

const UNASSIGNED = { storeId: null, allowedStoreIds: [] as string[] }
const ASSIGNED = { storeId: 'store-ginza', allowedStoreIds: ['store-ginza'] }
const FLOATING = { storeId: null, allowedStoreIds: null }

const route = { params: Promise.resolve({}) }
const chromeReq = () =>
  new Request('https://s/api/app/v1/screens/chrome', { headers: { authorization: 'Bearer t' } })
const bookReq = () =>
  new Request('https://s/api/app/v1/appointments', {
    method: 'POST',
    headers: {
      authorization: 'Bearer t',
      'content-type': 'application/json',
      'idempotency-key': 'idem-1',
    },
    body: JSON.stringify({
      staffProfileId: 'profile-1',
      clientId: 'cust-1',
      startTime: '2026-09-17T02:00:00.000Z',
      durationMinutes: 60,
    }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  clamp.current = { ...FLOATING }
})

describe('F1 — the facade notification bell, backstop alone', () => {
  it('an UNASSIGNED caller gets an empty bell — the feed builder is never reached', async () => {
    clamp.current = { ...UNASSIGNED }
    const res = await chromeGET(chromeReq(), route)
    expect(res.status).toBe(200)
    expect((await res.json()).notifications ?? []).toEqual([])
    // Not merely "an empty answer" — the business-wide read never happens, so
    // the 60s per-business cache is never seeded with it either.
    expect(buildNotificationFeed).not.toHaveBeenCalled()
  })

  it('an assigned caller still builds the feed, lensed to their store — unchanged', async () => {
    clamp.current = { ...ASSIGNED }
    await chromeGET(chromeReq(), route)
    expect(buildNotificationFeed).toHaveBeenCalled()
  })

  it('a floating caller still builds the feed — unchanged', async () => {
    clamp.current = { ...FLOATING }
    await chromeGET(chromeReq(), route)
    expect(buildNotificationFeed).toHaveBeenCalled()
  })
})

describe('F2 — booking CREATE refuses before core can default a store', () => {
  it('an UNASSIGNED actor is refused 403, and NO booking row is written', async () => {
    clamp.current = { ...UNASSIGNED }
    const res = await bookingPOST(bookReq(), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(apptCreate).not.toHaveBeenCalled()
    expect(defaultBookingStore).not.toHaveBeenCalled()
  })

  it('an assigned actor books into their own store — unchanged', async () => {
    clamp.current = { ...ASSIGNED }
    const res = await bookingPOST(bookReq(), route)
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ store_id: 'store-ginza' })
  })

  it('a floating actor still reaches core’s default store — the ruled fallback stands', async () => {
    clamp.current = { ...FLOATING }
    const res = await bookingPOST(bookReq(), route)
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ store_id: 'store-daikanyama' })
    expect(defaultBookingStore).toHaveBeenCalled()
  })

  it('MUTANT — without the guard the unassigned booking lands in the default store', async () => {
    // The pre-fold path, reproduced at the seam the door hands to the core:
    // `preferredStoreId: clamp.storeId` with clamp.storeId === null.
    const { createAppointmentCore } = await import('@/lib/appointments/mutations')
    const row = await createAppointmentCore({} as never, {} as never, {
      preferredStoreId: null,
    } as never)
    expect(row).toMatchObject({ store_id: 'store-daikanyama' })
    // 代官山 — written by a 銀座 hire nobody has placed yet, with nothing on the
    // row to say so. The 403 above is what stops it.
    expect(defaultBookingStore).toHaveBeenCalled()
  })
})


// ── GREPTILE #948 · the three appointment-side surfaces the census missed ───
describe('the appointments SCREEN reads nothing for an unassigned caller', () => {
  const screenReq = (qs = '') =>
    new Request(`https://s/api/app/v1/screens/appointments${qs}`, {
      headers: { authorization: 'Bearer t' },
    })

  it('the DAY read and the WEEK/MONTH windows are never issued', async () => {
    clamp.current = { ...UNASSIGNED }
    for (const view of ['', '?view=week', '?view=month']) {
      const res = await apptScreenGET(screenReq(view), route)
      expect(res.status).toBe(200)
    }
    // `clamp.storeId ?? undefined` = EVERY STORE to core. Not called at all.
    expect(dayRead).not.toHaveBeenCalled()
    expect(windowRead).not.toHaveBeenCalled()
  })

  it('an assigned caller still reads all three — unchanged', async () => {
    clamp.current = { ...ASSIGNED }
    await apptScreenGET(screenReq(), route)
    await apptScreenGET(screenReq('?view=week'), route)
    expect(dayRead).toHaveBeenCalled()
    expect(windowRead).toHaveBeenCalled()
  })

  it('MUTANT — the pre-fold lens is `undefined`, which core reads as every store', () => {
    const preFold = (UNASSIGNED.storeId ?? undefined) as string | undefined
    expect(preFold).toBeUndefined()
  })
})

describe('the DASHBOARD pack-usage map is empty for an unassigned caller', () => {
  const dashReq = () =>
    new Request('https://s/api/app/v1/screens/dashboard', {
      headers: { authorization: 'Bearer t' },
    })

  it('listAllPackUsageWithClient is never called', async () => {
    // The map has no store column, so every store-scoped surface clamps it by
    // MEMBERSHIP against a store-filtered customer list. buildDashboardScreen's
    // lens keys on `storeId`, which is null here — so 回数券 rebooks carried
    // another branch's customer names, pack counts and deep links.
    clamp.current = { ...UNASSIGNED }
    expect((await dashboardGET(dashReq(), route)).status).toBe(200)
    expect(listAllPackUsageWithClient).not.toHaveBeenCalled()
  })

  it('an assigned caller still gets the map — unchanged', async () => {
    clamp.current = { ...ASSIGNED }
    await dashboardGET(dashReq(), route)
    expect(listAllPackUsageWithClient).toHaveBeenCalled()
  })
})

describe('CHROME derives no nextCustomer for an unassigned caller', () => {
  it('the day read and the customer list are both skipped', async () => {
    // The earlier guard skipped only the FEED; this read runs before it and
    // feeds the bottom nav's label — another branch's next customer, by name.
    clamp.current = { ...UNASSIGNED }
    const res = await chromeGET(chromeReq(), route)
    expect(res.status).toBe(200)
    expect((await res.json()).nextCustomer ?? null).toBeNull()
    expect(dayRead).not.toHaveBeenCalled()
    expect(getCachedCustomerListFor).not.toHaveBeenCalled()
    // The picker still runs, on nothing — what matters is that it has nothing
    // to name, because the rows were never fetched.
    expect(pickNextCustomer).toHaveBeenCalledWith([])
  })

  it('an assigned caller still gets a label — unchanged', async () => {
    clamp.current = { ...ASSIGNED }
    await chromeGET(chromeReq(), route)
    expect(dayRead).toHaveBeenCalled()
    expect(pickNextCustomer).toHaveBeenCalled()
  })
})

describe('booking CREATE refuses BEFORE the create-on-miss staff mapper', () => {
  it('a refused booking writes nothing at all — not even a staff row', async () => {
    // resolveSynqedStaffIdForBusiness MINTS a core staff record when the
    // profile id has no mapping yet. With the refusal below it, a rejected
    // booking still wrote that row: honest about the booking, silent about the
    // side effect.
    clamp.current = { ...UNASSIGNED }
    const res = await bookingPOST(bookReq(), route)
    expect(res.status).toBe(403)
    expect(resolveSynqedStaffIdForBusinessSpy).not.toHaveBeenCalled()
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('an assigned caller still reaches the mapper — unchanged', async () => {
    clamp.current = { ...ASSIGNED }
    expect((await bookingPOST(bookReq(), route)).status).toBe(201)
    expect(resolveSynqedStaffIdForBusinessSpy).toHaveBeenCalled()
  })
})
