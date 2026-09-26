/**
 * The THROW-THROUGH gate class settles (Round 3 leg 7b, 2026-09-26, D-S28-1/3).
 *
 * Twelve web actions asked the permission gate with a bare
 * `if (!(await can(…))) return <denial>` OUTSIDE any try. can() →
 * getMyCapabilities() THROWS a typed AppApiError on a synqed-core outage
 * (upstream_unavailable, 502 class) or a client defect (internal, 500 class),
 * and getBusinessId() beneath it throws membership_inactive for a removed
 * person — so each of these actions REJECTED: the menus and booking dialogs
 * have no catch, StaffForm/StaffList toasted the raw English message. Now the
 * gate's throw SETTLES to the site's own failure shape: a typed outage/defect
 * answers the ja line (common.somethingWentWrong), anything else the site's
 * OWN existing catch expression (D-S28-1). A real denial keeps today's answer
 * byte-for-byte (D-S28-3).
 *
 * Every row drives the REAL gate (lesson 83/87: never mock can /
 * getMyCapabilities / requireCapability). Only the sources the real chain
 * reads are mocked — the seam of gate-catch-failure-line.test.ts:
 *   (a) the caller's capability row read fails → AppApiError upstream_unavailable 'Permission lookup failed'
 *   (b) SDK client construction fails           → AppApiError internal 'synqed-core client unavailable'
 *   (c) off the roster                          → an EMPTY capability set → can() resolves false
 *   (d) membership row absent                   → AppApiError membership_inactive
 * The action body after the gate is never reached.
 *
 * Each shape assertion reads the key the consumer reads ('error' in res /
 * res.success === false && res.error). The (c)/(d) values are literals, never
 * computed from the code under test.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
// The REAL ja dictionary behind getTranslations, so a pin compares the exact
// line staff will read (and a wrong namespace/key answers undefined).
jest.mock('next-intl/server', () => {
  const ja = jest.requireActual<Record<string, Record<string, unknown>>>('../../../messages/ja.json')
  return {
    getTranslations: jest.fn(async (ns: string) => (key: string) => ja[ns]?.[key]),
    getLocale: jest.fn(async () => 'ja'),
  }
})
jest.mock('@/lib/audit', () => ({ audit: jest.fn(), auditDurable: jest.fn(async () => true) }))
jest.mock('@/lib/audit-store-lock', () => ({ ensureRecordStoreInScopeAudited: jest.fn() }))
jest.mock('@/lib/audit-web', () => ({
  auditWeb: jest.fn(async () => {}),
  resolveWebActorId: jest.fn(async () => 'actor-1'),
  resolveWebBusinessId: jest.fn(async () => 'biz-1'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'actor-1', businessId: 'biz-1' })),
}))
jest.mock('@/lib/synqed/staff-pager', () => ({ listAllCoreStaff: jest.fn(async () => []) }))
// staff.ts lazily imports the ESM-only SDK; jest cannot load it, so a stub
// client stands in (probe (b) makes its construction throw).
const mockSdk = { constructError: null as Error | null }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = {}
    constructor() {
      if (mockSdk.constructError) throw mockSdk.constructError
    }
  },
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

// ── the sources the real roster chain reads ──────────────────────────────────
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: { id: 'actor-1' } } }),
    },
  }),
}))
const ROSTER_ROW = {
  id: 'actor-1', full_name: 'Owner', created_at: '2026-01-01T00:00:00Z', display_role: 'owner', position: null,
  email: null, phone: null, avatar_url: null, pin_hash: null, customer_id: 'biz-1', is_management: false,
}
const ROSTER_OK = { data: [ROSTER_ROW], error: null }
const MEMBER_OK = { data: { customer_id: 'biz-1', full_name: 'Owner' }, error: null }
const CAPS_OK = { data: { display_role: 'owner', permission_role: 'owner', permissions: null }, error: null }
let rosterRead: { data: unknown; error: unknown } = ROSTER_OK
let membershipRead: { data: unknown; error: unknown } = MEMBER_OK
let capsRead: { data: unknown; error: unknown } = CAPS_OK
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike', 'not', 'in']) chain[m] = () => chain
    chain.single = async () => membershipRead // businessIdForUser
    chain.order = async () => rosterRead // staffListCore's profiles read
    chain.maybeSingle = async () => capsRead // capabilitiesForUser: the caller's own row
    return { from: () => chain }
  },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { can, getMyCapabilities } from '@/lib/auth/require-permission'
import { listAllCoreStaff } from '@/lib/synqed/staff-pager'
import { createMenu, listMenus, reactivateMenu, retireMenu, updateMenu } from '@/actions/menus'
import { createStaff, deleteStaff, updateStaff } from '@/actions/staff'
import { createAppointment } from '@/actions/appointments'
import { createCustomer, createQuickCustomer, updateCustomer } from '@/actions/customers'

const JA = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'ja.json'), 'utf8'))
/** THE FAILURE LINE, read from the dictionary — never retyped. */
const FAILURE_LINE: string = JA.common.somethingWentWrong

// ── literals (D-S28-3 denials, D-S28-1 removed-membership answers) ──────────
const MENUS_DENIED = 'You do not have permission to manage menus.'
const BOOKINGS_DENIED = 'You do not have permission to manage bookings.'
const NO_PERMISSION_JA = 'この操作を行う権限がありません。'
const SOMETHING_WENT_WRONG_JA = 'エラーが発生しました。'
const MEMBERSHIP = 'No active business membership for this user'

const HELPER_LABEL = 'typed synqed-core failure'

type Probe = 'a' | 'b' | 'c' | 'd'
type SiteFile = 'menus' | 'staff' | 'appointments' | 'customers'

interface Site {
  fn: string
  file: SiteFile
  /** The log tag the site hands the helper. */
  tag: string
  call: () => Promise<unknown>
  /** The key the consumer reads: `'error' in res`, or `res.success === false && res.error`. */
  read: 'error' | 'success'
  /** Today's denial, byte-for-byte (D-S28-3). */
  c: string
  /** The site's own catch expression on membership_inactive (D-S28-1). */
  d: string
}

const menus = (fn: string, call: () => Promise<unknown>, d: string): Site => ({
  fn, file: 'menus', tag: '[menus]', call, read: 'error', c: MENUS_DENIED, d,
})
const staff = (fn: string, call: () => Promise<unknown>): Site => ({
  fn, file: 'staff', tag: `[${fn}]`, call, read: 'error', c: NO_PERMISSION_JA, d: SOMETHING_WENT_WRONG_JA,
})
const customers = (fn: string, call: () => Promise<unknown>): Site => ({
  fn, file: 'customers', tag: '[customers]', call, read: 'success', c: NO_PERMISSION_JA, d: SOMETHING_WENT_WRONG_JA,
})

// The 12 bare-gate sites of CONSUMER-PRINT Part 1 (mintRecordingReadUrl is out, D-S28-2).
const SITES: Site[] = [
  menus('listMenus', () => listMenus(), `Could not load menus: ${MEMBERSHIP}`),
  menus('createMenu', () => createMenu({} as Parameters<typeof createMenu>[0]), `Could not create menu: ${MEMBERSHIP}`),
  menus('updateMenu', () => updateMenu('menu-1', {} as Parameters<typeof updateMenu>[1]), `Could not update menu: ${MEMBERSHIP}`),
  menus('retireMenu', () => retireMenu('menu-1'), `Could not retire menu: ${MEMBERSHIP}`),
  menus('reactivateMenu', () => reactivateMenu('menu-1'), `Could not reactivate menu: ${MEMBERSHIP}`),
  staff('createStaff', () => createStaff({} as Parameters<typeof createStaff>[0])),
  staff('updateStaff', () => updateStaff('staff-T', {} as Parameters<typeof updateStaff>[1])),
  staff('deleteStaff', () => deleteStaff('staff-T')),
  {
    fn: 'createAppointment',
    file: 'appointments',
    tag: '[appointments]',
    call: () => createAppointment({} as Parameters<typeof createAppointment>[0]),
    read: 'error',
    c: BOOKINGS_DENIED,
    d: MEMBERSHIP,
  },
  customers('createCustomer', () => createCustomer({} as Parameters<typeof createCustomer>[0])),
  customers('createQuickCustomer', () => createQuickCustomer('山田')),
  customers('updateCustomer', () => updateCustomer('cust-1', { notes: 'memo' })),
]

const coreRoster = listAllCoreStaff as unknown as jest.Mock
const ENV_KEYS = ['SYNQED_CORE_URL', 'SYNQED_CORE_API_KEY'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
beforeAll(() => {
  // The synqed-core half of the roster read (probe (b)) runs only with core env present.
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.SYNQED_CORE_URL = 'http://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})
afterAll(() => {
  // Assigning undefined to process.env stores the STRING 'undefined' — delete instead.
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

let consoleError: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  rosterRead = ROSTER_OK
  membershipRead = MEMBER_OK
  capsRead = CAPS_OK
  mockSdk.constructError = null
  coreRoster.mockImplementation(async () => [])
})
afterEach(() => consoleError.mockRestore())

function arm(probe: Probe) {
  if (probe === 'a') capsRead = { data: null, error: { code: 'PGRST000', message: 'connection refused' } }
  if (probe === 'b') mockSdk.constructError = new Error('bad client config')
  if (probe === 'c') rosterRead = { data: [], error: null }
  if (probe === 'd') membershipRead = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
}

/** The whole settled shape, and then the one key its consumer reads. */
async function expectSettles(site: Site, expected: string) {
  const pending = site.call()
  await expect(pending).resolves.toStrictEqual(
    site.read === 'success' ? { success: false, error: expected } : { error: expected },
  )
  const res = (await pending) as Record<string, unknown>
  if (site.read === 'success') {
    expect(res.success === false && res.error).toBe(expected)
  } else {
    expect('error' in res).toBe(true)
    expect(res.error).toBe(expected)
  }
}

const helperLines = () => consoleError.mock.calls.filter((c) => String(c[0]).includes(HELPER_LABEL))

describe('the literals and the seam', () => {
  it('THE FAILURE LINE (read from ja) and the ja literals are the dictionary\'s own', () => {
    expect(FAILURE_LINE).toBe(SOMETHING_WENT_WRONG_JA)
    expect(JA.common.noPermission).toBe(NO_PERMISSION_JA)
  })
  it('(a) the REAL gate throws AppApiError upstream_unavailable "Permission lookup failed"', async () => {
    arm('a')
    await expect(getMyCapabilities()).rejects.toMatchObject({
      name: 'AppApiError',
      code: 'upstream_unavailable',
      message: 'Permission lookup failed',
    })
  })
  it('(b) the REAL gate throws AppApiError internal "synqed-core client unavailable"', async () => {
    arm('b')
    await expect(getMyCapabilities()).rejects.toMatchObject({
      name: 'AppApiError',
      code: 'internal',
      message: 'synqed-core client unavailable',
    })
  })
  it('(c) the REAL gate resolves false', async () => {
    arm('c')
    await expect(can('menus.manage')).resolves.toBe(false)
  })
  it('(d) the REAL gate throws AppApiError membership_inactive', async () => {
    arm('d')
    await expect(getMyCapabilities()).rejects.toMatchObject({
      name: 'AppApiError',
      code: 'membership_inactive',
      message: MEMBERSHIP,
    })
  })
})

describe.each(SITES)('$fn — a bare gate throw settles (through the REAL gate)', (site) => {
  it.each(['a', 'b'] as const)('(%s) typed synqed-core failure → settles to the failure line', async (probe) => {
    arm(probe)
    await expectSettles(site, FAILURE_LINE)
  })

  it('(c) gate resolves false → today\'s denial, byte-for-byte; the helper logs nothing', async () => {
    arm('c')
    await expectSettles(site, site.c)
    expect(helperLines()).toHaveLength(0)
  })

  it('(d) membership_inactive → the site\'s own catch answer, byte-for-byte; the helper logs nothing', async () => {
    arm('d')
    await expectSettles(site, site.d)
    expect(helperLines()).toHaveLength(0)
  })
})

describe.each(['menus', 'staff', 'appointments', 'customers'] as const)('%s.ts — the log line', (file) => {
  it('(e) every site logs ONE helper line: its own tag + the outage code', async () => {
    for (const site of SITES.filter((s) => s.file === file)) {
      consoleError.mockClear()
      arm('a')
      await site.call().catch(() => undefined)
      const lines = consoleError.mock.calls.filter(
        (c) => String(c[0]).startsWith(site.tag) && String(c[0]).includes(`${HELPER_LABEL} (upstream_unavailable)`),
      )
      expect({ fn: site.fn, lines: lines.length }).toEqual({ fn: site.fn, lines: 1 })
    }
  })
})
