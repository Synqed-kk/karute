/**
 * Business foundation (P1.5). The LOCK is real and the DATA is fake (⚖ Liam
 * 2026-08-19). Lock: the grants table ships in a separate PR and
 * `profiles.is_management` does not exist yet, so "missing table / missing
 * column" is the LIVE state both admission reads must deny on, and admission
 * itself must deny a manager who merely holds the grantable business.manage
 * toggle. Door: the lens is required, it drops another store's rows AND
 * storeless bookings, a 全店舗 menu survives the clamp, viewAll needs the
 * capability, and the door imports no client at all.
 * Unit-level: no live DB, no network — the data reads hit in-territory fixtures.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn(async () => 'biz-1') })) // admission's only app read

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getBusinessId } from '@/lib/staff'
import { hasBusinessAdminGrant, isManagementMember } from '@/business/lib/grants'
import { requireBusinessAdmission } from '@/business/lib/admission'
import * as data from '@/business/lib/data'
import { STORE_A, STORE_B } from '@/business/lib/fixtures'

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
const caps = getMyCapabilities as jest.Mock
const businessId = getBusinessId as jest.Mock

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

describe('the fixture data door', () => {
  it('a single-store lens drops the other store AND storeless bookings', async () => {
    const got = await data.listAppointments(STORE_A)
    expect(got.length).toBeGreaterThan(0)
    expect(got.every((a) => a.store_id === STORE_A)).toBe(true)
    expect(got.map((a) => a.id)).not.toContain('apt-09') // storeless
  })
  it('viewAll keeps every store, storeless rows included', async () => {
    const ids = (await data.listAppointments({ viewAll: true })).map((a) => a.id)
    expect(ids).toContain('apt-09')
    expect(ids.length).toBeGreaterThan((await data.listAppointments(STORE_A)).length)
  })
  it('a range narrows without breaking the clamp', async () => {
    const got = await data.listAppointments(STORE_A, { from: '2026-08-20T00:00:00Z' })
    expect(got.every((a) => a.store_id === STORE_A && a.starts_at >= '2026-08-20T00:00:00Z')).toBe(true)
    expect(got.length).toBeGreaterThan(0)
  })
  it('a 全店舗 menu (no store_id) stays visible under a clamped lens', async () => {
    const ids = (await data.listMenus(STORE_A)).map((m) => m.id)
    expect(ids).toContain('menu-06') // null store_id
    expect(ids).not.toContain('menu-04') // STORE_B
  })
  it('refuses a viewAll lens from an actor without stores.viewAll', async () => {
    caps.mockResolvedValue(new Set(['customers.view']))
    await expect(data.listAppointments({ viewAll: true })).rejects.toThrow('stores.viewAll')
    await expect(data.listMenus({ viewAll: true })).rejects.toThrow('stores.viewAll')
    await expect(data.listCustomers({ viewAll: true })).rejects.toThrow('stores.viewAll')
    await expect(data.listStaff({ viewAll: true })).rejects.toThrow('stores.viewAll')
  })
  it('every read requires the store lens as its first argument', () => {
    // Function.length counts parameters BEFORE the first defaulted one: >= 1
    // proves the lens has no default and cannot be omitted.
    for (const read of [data.listCustomers, data.listAppointments, data.listMenus, data.listStaff]) {
      expect(read.length).toBeGreaterThanOrEqual(1)
    }
  })
  it('staff: a clamped lens keeps this store + floating, drops other stores and unknowns', async () => {
    // p-01 email-linked, c-03 floating, p-04 user_id-ONLY link, p-05 both
    // stores; p-02 is STORE_B and p-09 has no card at all.
    expect((await data.listStaff(STORE_A)).map((m) => m.id)).toEqual(['p-01', 'c-03', 'p-04', 'p-05'])
    expect((await data.listStaff(STORE_B)).map((m) => m.id)).toEqual(['p-02', 'c-03', 'p-05'])
  })
  it('the door imports NO client — play phase is structural, not a promise', () => {
    // Tripwire until the fence guard re-gates the whole territory: the data
    // door and its fixture module may not name any path to core or the app DB.
    for (const file of ['data.ts', 'fixtures.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/business/lib', file), 'utf8')
      for (const banned of ['@synqed-kk/client', 'getSynqedClient', 'createServiceClient', '@/lib/supabase']) {
        expect(src).not.toContain(banned)
      }
    }
  })
})
