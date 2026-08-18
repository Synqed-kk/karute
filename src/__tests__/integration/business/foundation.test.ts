/**
 * Business foundation (P1.5). The grants table ships in a separate PR and
 * `profiles.is_management` does not exist yet, so "missing table / missing
 * column" is the LIVE state both admission reads must deny on. On the wrapper:
 * the lens is required, it drops another store's rows AND storeless bookings
 * from the complete set, viewAll needs the capability, and the staff read
 * fails LOUD instead of falling back to the unclamped roster.
 * Unit-level: every client mocked, no live DB, no network.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  staffListByBusinessOrThrow: jest.fn(),
}))

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getBusinessId, staffListByBusinessOrThrow } from '@/lib/staff'
import { hasBusinessAdminGrant, isManagementMember } from '@/business/lib/grants'
import { requireBusinessAdmission } from '@/business/lib/admission'
import * as data from '@/business/lib/data'

const GINZA = 'store-ginza'
const DAIKANYAMA = 'store-daikanyama'

/** Chainable supabase stub: from(table).select().eq()…maybeSingle() → the
 *  per-table result, or `fallback` for any table not named. */
function serviceStub(fallback: unknown, byTable: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({
    select: () => chain(r),
    eq: () => chain(r),
    maybeSingle: async () => r,
  })
  return { from: (table: string) => chain(table in byTable ? byTable[table] : fallback) }
}

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock
const synqed = getSynqedClient as jest.Mock
const caps = getMyCapabilities as jest.Mock
const businessId = getBusinessId as jest.Mock
const roster = staffListByBusinessOrThrow as jest.Mock

/** Every failure shape both admission reads must treat as "no". */
const DENY: Array<[string, unknown]> = [
  ['relation does not exist', { data: null, error: { message: 'relation … does not exist' } }],
  ['column does not exist', { data: null, error: { message: 'column … does not exist' } }],
  ['no row', { data: null, error: null }],
]

beforeEach(() => caps.mockResolvedValue(new Set(['stores.viewAll'])))

describe('admission reads are fail-closed', () => {
  it('grants only on a row that is actually there', async () => {
    service.mockReturnValue(serviceStub({ data: { workspace_id: 'business_admin' }, error: null }))
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toBe(true)
  })
  it('reads 経営メンバー only from a true flag', async () => {
    service.mockReturnValue(serviceStub({ data: { is_management: true }, error: null }))
    await expect(isManagementMember('user-1')).resolves.toBe(true)
    service.mockReturnValue(serviceStub({ data: { is_management: false }, error: null }))
    await expect(isManagementMember('user-1')).resolves.toBe(false)
  })
  it.each(DENY)('grant denies on %s', async (_l, result) => {
    service.mockReturnValue(serviceStub(result))
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toBe(false)
  })
  it.each(DENY)('management denies on %s', async (_l, result) => {
    service.mockReturnValue(serviceStub(result))
    await expect(isManagementMember('user-1')).resolves.toBe(false)
  })
  it('both deny when the client itself throws (missing service env)', async () => {
    service.mockImplementation(() => {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
    })
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toBe(false)
    await expect(isManagementMember('user-1')).resolves.toBe(false)
  })
})

describe('requireBusinessAdmission', () => {
  const GRANTED = { data: { workspace_id: 'business_admin' }, error: null }
  const NONE = { data: null, error: null }
  /** Real grants.ts, driven through the service stub — auth + caps are mocked. */
  function env({ grant = true, management = false, capabilities = [] as string[] }) {
    supabase.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
    })
    service.mockReturnValue(
      serviceStub(NONE, {
        business_workspace_grants: grant ? GRANTED : NONE,
        profiles: { data: { is_management: management }, error: null },
      }),
    )
    caps.mockResolvedValue(new Set(capabilities))
  }
  it('denies a manager merely holding the grantable business.manage toggle', async () => {
    env({ capabilities: ['business.manage'] })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('admits owner IDENTITY (both strip-protected capabilities)', async () => {
    env({ capabilities: ['business.manage', 'recordings.viewAll'] })
    await expect(requireBusinessAdmission()).resolves.toMatchObject({
      userId: 'u1',
      businessId: 'biz-1',
    })
  })
  it('admits a 経営メンバー holding no owner capability', async () => {
    env({ management: true })
    await expect(requireBusinessAdmission()).resolves.toMatchObject({ email: 'o@x.jp' })
  })
  it('denies even the owner when the tenant holds no grant', async () => {
    env({ grant: false, capabilities: ['business.manage', 'recordings.viewAll'] })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('turns a failed read into notFound, never a raw throw', async () => {
    env({ capabilities: ['business.manage', 'recordings.viewAll'] })
    businessId.mockRejectedValueOnce(new Error('membership lookup down'))
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('the wrapper is the only data door', () => {
  // a3 = a pre-repair import with no store. The core mock IGNORES the store
  // filter and over-returns: the wrapper's own clamp is the protection.
  const ROWS = [
    { id: 'a1', store_id: GINZA },
    { id: 'a2', store_id: DAIKANYAMA },
    { id: 'a3', store_id: null },
  ]
  const core = (appointments = ROWS) => {
    const list = jest.fn(async () => ({ appointments, total: appointments.length }))
    synqed.mockResolvedValue({ appointments: { list } })
    return list
  }

  it('a single-store lens drops the other store AND storeless bookings', async () => {
    const list = core()
    const got = await data.listAppointments(GINZA)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
    expect(got.map((a) => a.id)).toEqual(['a1'])
  })
  it('viewAll keeps every store, storeless rows included', async () => {
    core()
    expect((await data.listAppointments({ viewAll: true })).map((a) => a.id)).toEqual([
      'a1', 'a2', 'a3',
    ])
  })
  it('a 全店舗 menu (no store_id) stays visible under a clamped lens', async () => {
    const menus = [{ id: 'm1', store_id: GINZA }, { id: 'm2', store_id: DAIKANYAMA }, { id: 'm3', store_id: null }]
    synqed.mockResolvedValue({ menus: { list: jest.fn(async () => ({ menus })) } })
    expect((await data.listMenus(GINZA)).map((m) => m.id)).toEqual(['m1', 'm3'])
  })
  it('refuses a viewAll lens from an actor without stores.viewAll', async () => {
    caps.mockResolvedValue(new Set(['customers.view']))
    core()
    await expect(data.listAppointments({ viewAll: true })).rejects.toThrow('stores.viewAll')
    await expect(data.listMenus({ viewAll: true })).rejects.toThrow('stores.viewAll')
  })
  it('every read requires the store lens as its first argument', () => {
    // Function.length counts parameters BEFORE the first defaulted one: >= 1
    // proves the lens has no default and cannot be omitted.
    for (const read of [data.listCustomers, data.listAppointments, data.listMenus, data.listStaff]) {
      expect(read.length).toBeGreaterThanOrEqual(1)
    }
  })
  it('staff: a failed assignment lookup THROWS, never the unclamped roster', async () => {
    roster.mockResolvedValue([{ id: 'p1', email: 'a@x.jp' }])
    synqed.mockResolvedValue({
      staff: { list: jest.fn(async () => ({ staff: [] })) },
      staffStores: { list: jest.fn(async () => { throw new Error('core unreachable') }) },
    })
    await expect(data.listStaff(GINZA)).rejects.toThrow('core unreachable')
  })
  it('staff: a clamped lens keeps this store + floating, drops other stores and unknowns', async () => {
    roster.mockResolvedValue([
      { id: 'p1', email: 'ginza@x.jp' }, // card linked by email → 銀座
      { id: 'p2', email: 'other@x.jp' }, // card linked by user_id → 代官山
      { id: 's3', email: null }, // synqed card id, no assignment rows = floating
      { id: 'p4', email: 'kana@x.jp' }, // card has NO email → only user_id can link → 銀座
      { id: 'p9', email: 'ghost@x.jp' }, // no staff card at all = UNKNOWN
    ])
    synqed.mockResolvedValue({
      staff: { list: jest.fn(async () => ({ staff: [
        { id: 'c1', user_id: null, email: 'ginza@x.jp' },
        { id: 'c2', user_id: 'p2', email: 'other@x.jp' },
        { id: 's3', user_id: null, email: null },
        { id: 'c4', user_id: 'p4', email: null },
      ] })) },
      staffStores: { list: jest.fn(async () => ({ assignments: { c1: [GINZA], c2: [DAIKANYAMA], c4: [GINZA] } })) },
    })
    expect((await data.listStaff(GINZA)).map((m) => m.id)).toEqual(['p1', 's3', 'p4'])
  })
})
