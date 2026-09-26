/**
 * The store-list door answers "could not read" (null), never "no stores" ([])
 * on an outage (Round 3 leg 8a, 2026-09-26, D-S31-1/2/3).
 *
 * listStoresForWeb (src/actions/stores.ts) answered [] on ANY getBusinessId
 * throw and REJECTED on a thrown getSynqedClient() or core read. Its three
 * consumers turned both into "no stores": 設定 fabricated a 本店 card from the
 * salon name, the header switcher hid exactly like a one-store salon, and
 * StoresSection.refresh() died on an unhandled rejection.
 *
 * D-S31-1: the S21 listInvites shape — `null` = the list could not be read,
 * `[]` = only a real answer.
 * D-S31-2: pre-core step (getBusinessId + getSynqedClient, one try) —
 * membership_inactive and the plain Error('Not authenticated') are the
 * caller's own standing → [] byte-for-byte; every other throw → null. Core
 * step (listStoresWithClient): ANY throw → null. One bounded
 * describeUnknownThrow log line per null catch; an AppApiError's cause can
 * carry raw DB text, so every thrown value here carries RAW_DB_MARKER in its
 * cause and no logged argument may contain it.
 * D-S31-3: a zero-store list whose lazy 本店 name lookup failed is a TRUE
 * empty (the list read succeeded) → [] (row h — never "fix" it into null).
 *
 * The REAL chain runs: stores.ts → the REAL getSynqedClient body
 * (src/lib/synqed/client.ts) → the REAL listStoresWithClient
 * (src/lib/stores/stores.core.ts) → the REAL businessDisplayName. The two
 * identity reads are pass-through jest.fns around the real @/lib/staff exports
 * (lesson 104): armed per row, or left running the REAL resolveUserId /
 * getCurrentAccessToken / businessIdForUser against a stubbed Supabase session
 * and profiles row (rows c, d, a′, b′). The ESM-only SDK is a stub that records
 * each construction and carries the core endpoints this read touches.
 *
 * RED on main: a, a′, d, e, e′, f, g (with hours) and every j row; green: b,
 * b′, c, g (no hours), h, i.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined, set: jest.fn(), delete: jest.fn() })),
}))
// The ESM-only SDK: a stub base class for ActorSynqedClient. It records every
// construction (so a row can prove the REAL client build ran, or never ran)
// and carries the core endpoints the list read calls, armed per row.
const mockSdk = {
  built: [] as Array<{ config: { businessId?: string }; instance: object }>,
  api: {} as Record<string, unknown>,
}
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    constructor(config: { businessId?: string }) {
      mockSdk.built.push({ config, instance: this })
      Object.assign(this, mockSdk.api)
    }
  },
  SynqedError: class extends Error {},
}))
// The Supabase session seam under the REAL resolveUserId / getCurrentAccessToken.
const mockAuth = {
  user: { id: 'auth-user-1' } as { id: string } | null,
  session: { access_token: 'token-live' } as { access_token: string } | null,
}
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockAuth.user }, error: null }),
      getSession: async () => ({ data: { session: mockAuth.session }, error: null }),
    },
  })),
}))
// The profiles row under the REAL businessIdForUser (rows a′ / b′).
const mockProfiles = {
  answer: { data: { customer_id: 'biz-1', full_name: 'Owner' }, error: null } as {
    data: unknown
    error: unknown
  },
}
const mockProfilesFrom = jest.fn((table: string) => {
  void table
  return { select: () => ({ eq: () => ({ single: async () => mockProfiles.answer }) }) }
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: (table: string) => mockProfilesFrom(table) }),
}))
// Pass-through jest.fns around the REAL exports (lesson 104): observable, and
// armed per row. stores.ts and client.ts both read these through the registry.
jest.mock('@/lib/staff', () => {
  const actual = jest.requireActual<typeof import('@/lib/staff')>('@/lib/staff')
  return {
    ...actual,
    getBusinessId: jest.fn(() => actual.getBusinessId()),
    getCurrentAccessToken: jest.fn(() => actual.getCurrentAccessToken()),
  }
})

import { inspect } from 'node:util'
import { AppApiError } from '@/lib/app-api/errors'
import { getBusinessId, getCurrentAccessToken } from '@/lib/staff'
import { listStores, listStoresWithHours } from '@/actions/stores'

const actualStaff = jest.requireActual<typeof import('@/lib/staff')>('@/lib/staff')

const RAW_DB_MARKER = 'RAW-DB-TEXT-MARKER'
const rawCause = () => new Error(`${RAW_DB_MARKER}: relation "profiles" row 42 violates …`)

const businessRead = getBusinessId as unknown as jest.Mock
const tokenRead = getCurrentAccessToken as unknown as jest.Mock

// Core endpoints the list read touches (stores.core.ts listStoresWithClient
// and the lazy 本店 create's name lookup).
const storesList = jest.fn()
const storesCreate = jest.fn()
const staffStoresCounts = jest.fn()
const customersCountsByStore = jest.fn()
const storePoliciesList = jest.fn()
const orgSettingsGet = jest.fn()

const CORE_STORES = [
  { id: 'store-a', name: 'La Estro 代官山', address: '渋谷区1-1', phone: '03-0000-0000', is_primary: true, active: true, business_type: 'hair_salon' },
  { id: 'store-b', name: 'La Estro 銀座', address: null, phone: null, is_primary: false, active: true },
]
const WEEK = { mon: { open: '10:00', close: '19:00' } }

const DOORS = [
  { name: 'listStores', run: () => listStores(), withHours: false },
  { name: 'listStoresWithHours', run: () => listStoresWithHours(), withHours: true },
] as const

/** The mapped rows a live read answers (the REAL mapping, stores.core.ts). */
const expectedRows = (withHours: boolean) => [
  {
    id: 'store-a', name: 'La Estro 代官山', address: '渋谷区1-1', phone: '03-0000-0000',
    isPrimary: true, active: true, staffCount: 3, customerCount: 40, businessType: 'hair_salon',
    weeklyHours: withHours ? WEEK : undefined,
    weeklyHoursUnreadable: withHours ? false : undefined,
  },
  {
    id: 'store-b', name: 'La Estro 銀座', address: null, phone: null,
    isPrimary: false, active: true, staffCount: 0, customerCount: 0, businessType: null,
    weeklyHours: withHours ? null : undefined,
    weeklyHoursUnreadable: withHours ? false : undefined,
  },
]

const spies = {} as Record<'error' | 'warn' | 'log' | 'info', jest.SpyInstance>
beforeEach(() => {
  jest.clearAllMocks()
  mockSdk.built.length = 0
  mockSdk.api = {
    stores: { list: storesList, create: storesCreate },
    staffStores: { counts: staffStoresCounts },
    customers: { countsByStore: customersCountsByStore },
    storePolicies: { list: storePoliciesList },
    orgSettings: { get: orgSettingsGet },
  }
  mockAuth.user = { id: 'auth-user-1' }
  mockAuth.session = { access_token: 'token-live' }
  mockProfiles.answer = { data: { customer_id: 'biz-1', full_name: 'Owner' }, error: null }
  for (const k of ['error', 'warn', 'log', 'info'] as const) {
    spies[k] = jest.spyOn(console, k).mockImplementation(() => {})
  }
  businessRead.mockResolvedValue('biz-1')
  tokenRead.mockResolvedValue('token-1')
  storesList.mockResolvedValue({ stores: CORE_STORES })
  storesCreate.mockResolvedValue({ id: 'store-new' })
  staffStoresCounts.mockResolvedValue({ counts: { 'store-a': 3 } })
  customersCountsByStore.mockResolvedValue({ counts: { 'store-a': 40 } })
  storePoliciesList.mockResolvedValue({ policies: [{ store_id: 'store-a', weekly_hours: WEEK }] })
  orgSettingsGet.mockResolvedValue({ business_id: 'biz-1', name: 'La Estro', settings: {} })
})
afterEach(() => {
  for (const s of Object.values(spies)) s.mockRestore()
})

/** Every argument of every console call, inspected deep (Error cause + stack included). */
const everythingLogged = () =>
  Object.values(spies)
    .flatMap((s) => s.mock.calls.flat())
    .map((arg) => inspect(arg, { depth: 10 }))
    .join('\n')
const nothingLogged = () => {
  for (const s of Object.values(spies)) expect(s).not.toHaveBeenCalled()
}
/** No core endpoint was reached and the client was never built. */
const coreNeverCalled = () => {
  expect(mockSdk.built).toHaveLength(0)
  for (const f of [storesList, storesCreate, staffStoresCounts, customersCountsByStore, storePoliciesList, orgSettingsGet]) {
    expect(f).not.toHaveBeenCalled()
  }
}

/** Every throw that must answer null, with the bounded line it logs (row j). */
const NULL_ROWS = [
  {
    row: '(a) getBusinessId throws upstream_unavailable (502)',
    arm: () =>
      businessRead.mockRejectedValue(
        new AppApiError('upstream_unavailable', 'Business membership lookup failed', undefined, rawCause()),
      ),
    log: { errName: 'AppApiError', errStatus: 502, errMessage: 'Business membership lookup failed' },
    preCore: true,
    doors: ['listStores', 'listStoresWithHours'],
  },
  {
    row: '(a′) the REAL businessIdForUser: a failed profiles lookup (not PGRST116) → upstream_unavailable',
    arm: () => {
      businessRead.mockImplementation(() => actualStaff.getBusinessId())
      mockProfiles.answer = { data: null, error: { code: '08006', message: `${RAW_DB_MARKER} connection failure` } }
    },
    log: { errName: 'AppApiError', errStatus: 502, errMessage: 'Business membership lookup failed' },
    preCore: true,
    doors: ['listStores', 'listStoresWithHours'],
  },
  {
    row: '(e) getBusinessId throws internal (500)',
    arm: () =>
      businessRead.mockRejectedValue(
        new AppApiError('internal', 'synqed-core client unavailable', undefined, rawCause()),
      ),
    log: { errName: 'AppApiError', errStatus: 500, errMessage: 'synqed-core client unavailable' },
    preCore: true,
    doors: ['listStores', 'listStoresWithHours'],
  },
  {
    row: '(e′) getCurrentAccessToken throws an unknown Error (not the Not-authenticated message)',
    arm: () => tokenRead.mockRejectedValue(new Error('socket hang up', { cause: rawCause() })),
    log: { errName: 'Error', errMessage: 'socket hang up' },
    preCore: true,
    doors: ['listStores', 'listStoresWithHours'],
  },
  {
    row: '(f) stores.list() rejects',
    arm: () => storesList.mockRejectedValue(new Error('synqed-core 503 on /v1/stores', { cause: rawCause() })),
    log: { errName: 'Error', errMessage: 'synqed-core 503 on /v1/stores' },
    preCore: false,
    doors: ['listStores', 'listStoresWithHours'],
  },
  {
    row: '(g) storePolicies.list() rejects (the opt-in hours read)',
    arm: () =>
      storePoliciesList.mockRejectedValue(new Error('synqed-core 502 on /v1/store-policies', { cause: rawCause() })),
    log: { errName: 'Error', errMessage: 'synqed-core 502 on /v1/store-policies' },
    preCore: false,
    doors: ['listStoresWithHours'],
  },
] as const

describe('the literals', () => {
  it('the marker rides in the cause, where only a whole-error log would print it', () => {
    const e = new AppApiError('upstream_unavailable', 'Business membership lookup failed', undefined, rawCause())
    expect(e.message).not.toContain(RAW_DB_MARKER)
    expect(inspect(e, { depth: 10 })).toContain(RAW_DB_MARKER)
  })
})

describe.each(DOORS)('$name — the store-list door', (door) => {
  const nullRows = NULL_ROWS.filter((r) => (r.doors as readonly string[]).includes(door.name))

  it.each(nullRows)('$row → null', async (r) => {
    r.arm()
    await expect(door.run()).resolves.toBeNull()
    if (r.preCore) {
      coreNeverCalled()
    } else {
      // The client WAS built with the business the read returned — the throw
      // came from the core read itself, not the context step.
      expect(mockSdk.built).toHaveLength(1)
      expect(mockSdk.built[0].config.businessId).toBe('biz-1')
      expect(storesCreate).not.toHaveBeenCalled()
    }
  })

  it.each(nullRows)('(j) $row → exactly one bounded log line, no raw cause anywhere', async (r) => {
    r.arm()
    await door.run().catch(() => undefined)
    const lines = spies.error.mock.calls
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(2)
    expect(lines[0][0]).toBe('[stores] list read failed:')
    const logged = lines[0][1]
    expect(logged).not.toBeInstanceOf(Error)
    expect(logged).toStrictEqual(r.log)
    expect(spies.warn).not.toHaveBeenCalled()
    expect(spies.log).not.toHaveBeenCalled()
    expect(spies.info).not.toHaveBeenCalled()
    expect(everythingLogged()).not.toContain(RAW_DB_MARKER)
  })

  it('(a) order: the membership read ran once and FIRST — the token read and the client build never started', async () => {
    businessRead.mockRejectedValue(new AppApiError('upstream_unavailable', 'Business membership lookup failed'))
    await door.run().catch(() => undefined)
    expect(businessRead).toHaveBeenCalledTimes(1)
    expect(tokenRead).not.toHaveBeenCalled()
    expect(mockSdk.built).toHaveLength(0)
  })

  it('(b) getBusinessId throws membership_inactive (a removed staffer) → [] byte-for-byte, core never called, nothing logged', async () => {
    businessRead.mockRejectedValue(
      new AppApiError('membership_inactive', 'No active business membership for this user', undefined, rawCause()),
    )
    await expect(door.run()).resolves.toStrictEqual([])
    coreNeverCalled()
    expect(tokenRead).not.toHaveBeenCalled()
    nothingLogged()
  })

  it('(b′) the REAL businessIdForUser: no profiles row (PGRST116) → membership_inactive → [], core never called', async () => {
    businessRead.mockImplementation(() => actualStaff.getBusinessId())
    mockProfiles.answer = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    await expect(door.run()).resolves.toStrictEqual([])
    // The answer came from the real profiles lookup, not an earlier throw.
    expect(mockProfilesFrom).toHaveBeenCalledTimes(1)
    expect(mockProfilesFrom).toHaveBeenCalledWith('profiles')
    coreNeverCalled()
    nothingLogged()
  })

  it("(c) the REAL resolveUserId throws Error('Not authenticated') (no user) → [], core never called", async () => {
    businessRead.mockImplementation(() => actualStaff.getBusinessId())
    mockAuth.user = null
    await expect(door.run()).resolves.toStrictEqual([])
    // The throw came from resolveUserId itself: the membership lookup never ran.
    expect(mockProfilesFrom).not.toHaveBeenCalled()
    coreNeverCalled()
    nothingLogged()
  })

  it("(d) getBusinessId ok, the REAL getCurrentAccessToken throws Error('Not authenticated') (no session) → []", async () => {
    tokenRead.mockImplementation(() => actualStaff.getCurrentAccessToken())
    mockAuth.session = null
    await expect(door.run()).resolves.toStrictEqual([])
    coreNeverCalled()
    expect(tokenRead).toHaveBeenCalledTimes(1)
    nothingLogged()
  })

  it('(h) stores.list() answers [] AND the name read for the lazy 本店 throws → [] (D-S31-3: a TRUE empty, the create deferred)', async () => {
    storesList.mockResolvedValue({ stores: [] })
    orgSettingsGet.mockRejectedValue(new Error('synqed-core 503 on /v1/org-settings', { cause: rawCause() }))
    await expect(door.run()).resolves.toStrictEqual([])
    expect(storesList).toHaveBeenCalledTimes(1)
    expect(orgSettingsGet).toHaveBeenCalledTimes(1)
    // No permanent write off a failed read, and no second list.
    expect(storesCreate).not.toHaveBeenCalled()
    nothingLogged()
  })

  it('(i) a live list → the mapped rows, through the REAL client build and core', async () => {
    await expect(door.run()).resolves.toStrictEqual(expectedRows(door.withHours))
    expect(mockSdk.built).toHaveLength(1)
    expect(mockSdk.built[0].config.businessId).toBe('biz-1')
    expect(storesList).toHaveBeenCalledTimes(1)
    expect(storePoliciesList).toHaveBeenCalledTimes(door.withHours ? 1 : 0)
    expect(storesCreate).not.toHaveBeenCalled()
    // Order: membership → token → the core read.
    expect(businessRead.mock.invocationCallOrder[0]).toBeLessThan(tokenRead.mock.invocationCallOrder[0])
    expect(tokenRead.mock.invocationCallOrder[0]).toBeLessThan(storesList.mock.invocationCallOrder[0])
    nothingLogged()
  })
})

describe('(g) the hours read is opt-in', () => {
  it('storePolicies.list() rejecting leaves the plain listStores() read untouched → rows', async () => {
    storePoliciesList.mockRejectedValue(new Error('synqed-core 502 on /v1/store-policies'))
    await expect(listStores()).resolves.toStrictEqual(expectedRows(false))
    expect(storePoliciesList).not.toHaveBeenCalled()
    nothingLogged()
  })
})
