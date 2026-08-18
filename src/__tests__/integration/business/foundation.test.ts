/**
 * Business foundation (P1.5) under the PLAY-PHASE SEAL (⚖ Liam 2026-08-19).
 * The LOCK is real, the DATA is fake, and territory is sealed: no module in it
 * may import anything that can reach synqed-core, even transitively.
 * Lock: the grants table ships separately and `profiles.is_management` does
 * not exist yet, so "missing table / missing column" is the LIVE state every
 * admission read must deny on; admission itself needs BOTH a grant row and the
 * 経営メンバー flag. Door: the lens is required, it drops another store's rows
 * AND storeless bookings, a 全店舗 menu survives the clamp, and no territory
 * file names a client path.
 * Unit-level: no live DB, no network — the data reads hit in-territory fixtures.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { hasBusinessAdminGrant, isManagementMember } from '@/business/lib/grants'
import { requireBusinessAdmission } from '@/business/lib/admission'
import * as data from '@/business/lib/data'
import { STORE_A, STORE_B } from '@/business/lib/fixtures'

/** Chainable supabase stub: from(table).select().eq()…maybeSingle() → the
 *  per-table result, or `fallback` for any table not named. Every .eq() lands
 *  in `filters` so a test can prove WHICH row a read asked for. */
const filters: Array<[string, unknown]> = []
function serviceStub(fallback: unknown, byTable: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({
    select: () => chain(r),
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return chain(r)
    },
    maybeSingle: async () => r,
  })
  return { from: (table: string) => chain(table in byTable ? byTable[table] : fallback) }
}

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

/** Every failure shape both admission reads must treat as "no". */
const DENY: Array<[string, unknown]> = [
  ['relation does not exist', { data: null, error: { message: 'relation … does not exist' } }],
  ['column does not exist', { data: null, error: { message: 'column … does not exist' } }],
  ['no row', { data: null, error: null }],
]

beforeEach(() => (filters.length = 0))

describe('admission reads are fail-closed', () => {
  it('grants only on a row that is actually there, keyed by the frozen workspace id', async () => {
    service.mockReturnValue(serviceStub({ data: { workspace_id: 'business_admin' }, error: null }))
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toBe(true)
    // The registry literal is spelled here, not imported (seal) — pin it.
    expect(filters).toContainEqual(['workspace_id', 'business_admin'])
    expect(filters).toContainEqual(['business_id', 'biz-1'])
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
  /** Real grants.ts driven through the service stub; only the auth session is
   *  mocked. No capability mock exists any more — the owner-identity leg was
   *  removed with the seal (its chain reached core), so the role gate is the
   *  経営メンバー flag alone. */
  function env({ grant = true, management = false, user = { id: 'u1', email: 'o@x.jp' } as unknown }) {
    supabase.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    })
    service.mockReturnValue(
      serviceStub(NONE, {
        business_workspace_grants: grant ? GRANTED : NONE,
        profiles: { data: { customer_id: 'biz-1', is_management: management }, error: null },
      }),
    )
  }
  it('admits a 経営メンバー of a granted tenant', async () => {
    env({ grant: true, management: true })
    await expect(requireBusinessAdmission()).resolves.toMatchObject({
      userId: 'u1',
      email: 'o@x.jp',
      businessId: 'biz-1',
    })
  })
  it('denies a granted tenant when the actor is not 経営メンバー', async () => {
    env({ grant: true, management: false })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies a 経営メンバー whose tenant holds no grant', async () => {
    env({ grant: false, management: true })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies when there is no authenticated user', async () => {
    env({ grant: true, management: true, user: null })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies when the tenant cannot be resolved from the profile row', async () => {
    env({ grant: true, management: true })
    service.mockReturnValue(serviceStub(NONE)) // profiles has no customer_id
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('turns a failed read into notFound, never a raw throw', async () => {
    env({ grant: true, management: true })
    supabase.mockRejectedValueOnce(new Error('auth backend down'))
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
  it('a missing or malformed lens throws, never falls through to business-wide', async () => {
    // The capability gate on {viewAll:true} retired with the seal; the
    // REQUIRED-lens contract did not. A JS caller that drops it must fail loud.
    const reads = [data.listCustomers, data.listAppointments, data.listMenus, data.listStaff]
    for (const read of reads) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((read as any)()).rejects.toThrow('store lens is required')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((read as any)({ viewAll: false })).rejects.toThrow('store lens is required')
    }
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
  it('the sealed files import EXACTLY their inventory — any new import goes red', () => {
    // Stronger than a banned-literal list, which an UNLISTED helper reaching
    // core would walk straight past (Greptile P2 on #720): this pins the
    // COMPLETE import set per file, so any new specifier — core-reaching or
    // innocuous — fails until it is deliberately added here. Same-file regex
    // scan, no resolver needed; one regex per import form (never a combined
    // alternation — the #660 spanning-wildcard lesson) and comment lines are
    // stripped first so prose can't plant a phantom specifier.
    const FORMS = [
      /from\s*'([^'\n]+)'/g,
      /from\s*"([^"\n]+)"/g,
      /import\s*['"]([^'"\n]+)['"]/g,
      /import\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
      /require\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
    ]
    const INVENTORY: Record<string, string[]> = {
      'src/business/lib/data.ts': ['./fixtures'],
      'src/business/lib/fixtures.ts': [],
      'src/business/i18n/index.ts': ['./ja.json'],
      'src/app/[locale]/(business)/layout.tsx': ['@/business/i18n', '@/business/lib/admission'],
      'src/business/lib/admission.ts': ['./grants', '@/lib/supabase/server', 'next/navigation'],
      'src/business/lib/grants.ts': ['@/lib/supabase/service'],
    }
    for (const [file, expected] of Object.entries(INVENTORY)) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
      const found = new Set<string>()
      for (const re of FORMS) {
        re.lastIndex = 0
        for (let m = re.exec(src); m; m = re.exec(src)) found.add(m[1])
      }
      expect({ file, imports: [...found].sort() }).toEqual({ file, imports: [...expected].sort() })
    }
  })
})
