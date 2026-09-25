/**
 * Every permission-gate catch in src/actions answers the FAILURE LINE on a
 * typed synqed-core failure (Round 3 leg 7, 2026-09-25, D-S27-1/2).
 *
 * The gate (requireCapability → can → getMyCapabilities) reads the roster
 * first, so a synqed-core roster OUTAGE (upstream_unavailable, 502 class) or a
 * synqed-core client DEFECT (internal, 500 class) reaches each site's catch —
 * which printed the internal English sentence ('synqed-core roster fetch
 * failed' · 'synqed-core client unavailable'). Both now answer the ja line
 * common.somethingWentWrong. A real denial and a removed membership keep
 * today's answers byte-for-byte (values taken from origin/main 0af372326).
 *
 * Four probes per site, all through the REAL gate (lesson 83/87: a pin under a
 * mocked gate proves nothing). Only the SOURCES the real roster chain reads
 * are mocked — the same seam as server-action-outage-refuse.test.ts:
 *   (a) listAllCoreStaff rejects      → staff.ts throws upstream_unavailable
 *   (b) SDK client construction fails → staff.ts throws internal
 *   (c) off the roster                → an EMPTY capability set → the gate's plain-Error denial
 *   (d) membership row absent         → staff.ts throws membership_inactive
 * The action body after the gate is never reached: the gate throws first.
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
let rosterRead: { data: unknown; error: unknown } = ROSTER_OK
let membershipRead: { data: unknown; error: unknown } = MEMBER_OK
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike', 'not', 'in']) chain[m] = () => chain
    chain.single = async () => membershipRead // businessIdForUser
    chain.order = async () => rosterRead // staffListCore's profiles read
    // capabilitiesForUser: the caller is the owner.
    chain.maybeSingle = async () => ({
      data: { display_role: 'owner', permission_role: 'owner', permissions: null },
      error: null,
    })
    return { from: () => chain }
  },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { AppApiError } from '@/lib/app-api/errors'
import { STAFF_CREATE_FAILED } from '@/lib/auth/store-gate'
import { listAllCoreStaff } from '@/lib/synqed/staff-pager'
import { deleteCustomerPhoto, searchCustomersCompanyWide } from '@/actions/customers'
import { getStaffPermissions, setStaffPermissions } from '@/actions/permissions'
import {
  cancelAppointment,
  deleteAppointment,
  markNoShowAppointment,
  restoreAppointment,
  updateAppointment,
} from '@/actions/appointments'
import { regenerateKarute, regenerateKaruteEntries, updateKaruteSummary } from '@/actions/regenerate-karute'
import { uploadStaffAvatar } from '@/actions/staff'
import { createInvite, revokeInvite } from '@/actions/invites'
import { upsertOrgSettings } from '@/actions/org-settings'
import {
  createManualKaruteRecord,
  deleteKaruteRecord,
  listEntryEditHistory,
  listReassignCustomerOptions,
  loadKaruteWindow,
  reassignKaruteCustomer,
  revealNoKaruteCustomer,
  saveKaruteRecord,
  saveKaruteRecordInline,
  updateKaruteDetailEntry,
  updateKaruteDetailSummary,
} from '@/actions/karute'

const JA = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'ja.json'), 'utf8'))
const FAILURE_LINE: string = JA.common.somethingWentWrong
const DENIAL = 'You do not have permission to perform this action.'
const MEMBERSHIP = 'No active business membership for this user'

type Probe = 'a' | 'b' | 'c' | 'd'
const PROBE_CODE = { a: 'upstream_unavailable', b: 'internal', c: undefined, d: 'membership_inactive' } as const
const PROBE_LOG = {
  a: { errName: 'AppApiError', errStatus: 502, errMessage: 'synqed-core roster fetch failed' },
  b: { errName: 'AppApiError', errStatus: 500, errMessage: 'synqed-core client unavailable' },
}

interface Site {
  fn: string
  /** The site's log tag: its (a)/(b) line starts `${tag} pre-core read failed (${code}):`. */
  tag: string
  call: () => Promise<unknown>
  /** The site's own result shape around the error string. */
  wrap?: (error: string, code?: string) => unknown
  /** The site carries `code` beside the message (karute save). */
  carriesCode?: boolean
  /** Per-site answers that differ from the defaults. */
  expected?: Partial<Record<Probe, string>>
  /** Per-site (a)/(b) log line prefix (createInvite keeps its own). */
  outageLog?: string
}

const karute = (fn: string, call: () => Promise<unknown>, extra: Partial<Site> = {}): Site => ({
  fn,
  tag: '[karute]',
  call,
  ...extra,
})
const withCode = (error: string, code?: string) => (code ? { error, code } : { error })

// The 27 sites of the S27 census table (D), in the packet's order.
const SITES: Site[] = [
  {
    fn: 'deleteCustomerPhoto',
    tag: '[customers]',
    call: () => deleteCustomerPhoto('cust-1', 'photo-1'),
    wrap: (error) => ({ success: false, error }),
  },
  { fn: 'searchCustomersCompanyWide', tag: '[customers]', call: () => searchCustomersCompanyWide('yamada') },
  { fn: 'getStaffPermissions', tag: '[permissions]', call: () => getStaffPermissions('staff-T') },
  { fn: 'setStaffPermissions', tag: '[permissions]', call: () => setStaffPermissions('staff-T', 'practitioner', []) },
  { fn: 'deleteAppointment', tag: '[appointments]', call: () => deleteAppointment('appt-1') },
  { fn: 'updateAppointment', tag: '[appointments]', call: () => updateAppointment('appt-1', {}) },
  { fn: 'cancelAppointment', tag: '[appointments]', call: () => cancelAppointment('appt-1') },
  { fn: 'restoreAppointment', tag: '[appointments]', call: () => restoreAppointment('appt-1') },
  {
    fn: 'markNoShowAppointment',
    tag: '[appointments]',
    call: () => markNoShowAppointment('appt-1', { burnPack: false }),
  },
  { fn: 'regenerateKaruteEntries', tag: '[regenerate]', call: () => regenerateKaruteEntries('karute-1', []) },
  { fn: 'updateKaruteSummary', tag: '[regenerate]', call: () => updateKaruteSummary('karute-1', 'summary') },
  { fn: 'regenerateKarute', tag: '[regenerate]', call: () => regenerateKarute('karute-1') },
  { fn: 'uploadStaffAvatar', tag: '[staff]', call: () => uploadStaffAvatar('staff-T', new FormData()) },
  { fn: 'revokeInvite', tag: '[invites]', call: () => revokeInvite('invite-1') },
  {
    // D-S27-7: the answer is a machine code the dialog translates, not a line.
    fn: 'createInvite',
    tag: '[createInvite]',
    call: () => createInvite({ email: 'new@example.jp', role: 'STYLIST', name: 'New' }),
    expected: { a: STAFF_CREATE_FAILED, b: STAFF_CREATE_FAILED },
    outageLog: '[createInvite] pre-core read failed (permission gate / business):',
  },
  {
    // D-S27-4/5: the denial sentence stays; any other throw keeps 'Unknown error'.
    fn: 'upsertOrgSettings',
    tag: '[org-settings]',
    call: () => upsertOrgSettings({}),
    expected: { c: 'You do not have permission to change settings.', d: 'Unknown error' },
  },
  karute('saveKaruteRecord', () => saveKaruteRecord({} as Parameters<typeof saveKaruteRecord>[0]), {
    wrap: withCode,
    carriesCode: true,
  }),
  karute('saveKaruteRecordInline', () => saveKaruteRecordInline({} as Parameters<typeof saveKaruteRecordInline>[0]), {
    wrap: withCode,
    carriesCode: true,
  }),
  karute('deleteKaruteRecord', () => deleteKaruteRecord('karute-1')),
  karute('reassignKaruteCustomer', () => reassignKaruteCustomer('karute-1', 'cust-2', { confirmed: true })),
  karute('listReassignCustomerOptions', () => listReassignCustomerOptions('karute-1')),
  karute('createManualKaruteRecord', () =>
    createManualKaruteRecord({
      customerId: 'cust-1',
      staffId: 'actor-1',
      sessionDate: '2026-09-25',
      durationMinutes: 30,
      service: 'cut',
    }),
  ),
  karute('updateKaruteDetailEntry', () => updateKaruteDetailEntry('karute-1', 'entry-1', { expectedVersion: 1 })),
  karute('updateKaruteDetailSummary', () => updateKaruteDetailSummary('karute-1', { content: 'summary' })),
  karute('listEntryEditHistory', () => listEntryEditHistory('karute-1')),
  karute('revealNoKaruteCustomer', () => revealNoKaruteCustomer('yamada')),
  karute('loadKaruteWindow', () => loadKaruteWindow({})),
]

const coreRoster = listAllCoreStaff as unknown as jest.Mock
const ENV_KEYS = ['SYNQED_CORE_URL', 'SYNQED_CORE_API_KEY'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
beforeAll(() => {
  // The synqed-core half of the roster read runs only with core env present.
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
  mockSdk.constructError = null
  coreRoster.mockImplementation(async () => [])
})
afterEach(() => consoleError.mockRestore())

function arm(probe: Probe) {
  if (probe === 'a') coreRoster.mockImplementation(async () => Promise.reject(new TypeError('fetch failed')))
  if (probe === 'b') mockSdk.constructError = new Error('bad client config')
  if (probe === 'c') rosterRead = { data: [], error: null }
  if (probe === 'd') membershipRead = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
}

const logsStartingWith = (prefix: string) => consoleError.mock.calls.filter((c) => String(c[0]).startsWith(prefix))

describe('THE FAILURE LINE is the ja common.somethingWentWrong', () => {
  it('reads エラーが発生しました。', () => {
    expect(FAILURE_LINE).toBe('エラーが発生しました。')
  })
})

describe('the four probes throw exactly what the packet names, through the REAL chain', () => {
  it('(a) → AppApiError upstream_unavailable "synqed-core roster fetch failed"', async () => {
    arm('a')
    await expect(getMyCapabilities()).rejects.toMatchObject({
      name: 'AppApiError',
      code: 'upstream_unavailable',
      message: 'synqed-core roster fetch failed',
    })
  })
  it('(b) → AppApiError internal "synqed-core client unavailable"', async () => {
    arm('b')
    await expect(getMyCapabilities()).rejects.toMatchObject({
      name: 'AppApiError',
      code: 'internal',
      message: 'synqed-core client unavailable',
    })
  })
  it('(c) → an EMPTY capability set; the real gate throws its plain-Error denial', async () => {
    arm('c')
    expect((await getMyCapabilities()).size).toBe(0)
    const err = await requireCapability('records.write').then(() => 'resolved', (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(AppApiError)
    expect((err as Error).message).toBe(DENIAL)
  })
  it('(d) → AppApiError membership_inactive, today\'s message', async () => {
    arm('d')
    await expect(getMyCapabilities()).rejects.toMatchObject({
      name: 'AppApiError',
      code: 'membership_inactive',
      message: MEMBERSHIP,
    })
  })
})

describe.each(SITES)('$fn — a gate catch through the REAL gate', (site) => {
  const expectedError = (probe: Probe): string =>
    site.expected?.[probe] ?? { a: FAILURE_LINE, b: FAILURE_LINE, c: DENIAL, d: MEMBERSHIP }[probe]
  const expectedResult = (probe: Probe) => {
    const code = site.carriesCode ? PROBE_CODE[probe] : undefined
    return (site.wrap ?? ((error: string) => ({ error })))(expectedError(probe), code)
  }
  const outageLog = (probe: 'a' | 'b') => site.outageLog ?? `${site.tag} pre-core read failed (${PROBE_CODE[probe]}):`

  it.each(['a', 'b'] as const)(
    '(%s) typed synqed-core failure → the failure line, one bounded log carrying the code',
    async (probe) => {
      arm(probe)
      const res = await site.call()
      expect(res).toEqual(expectedResult(probe))
      const lines = logsStartingWith(outageLog(probe))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toHaveLength(2)
      expect(lines[0][1]).toEqual(PROBE_LOG[probe])
    },
  )

  it('(c) empty capability set → today\'s denial, byte-for-byte', async () => {
    arm('c')
    expect(await site.call()).toEqual(expectedResult('c'))
    expect(logsStartingWith(`${site.tag} pre-core read failed`)).toHaveLength(0)
  })

  it('(d) membership_inactive → today\'s answer, byte-for-byte', async () => {
    arm('d')
    expect(await site.call()).toEqual(expectedResult('d'))
    expect(logsStartingWith(`${site.tag} pre-core read failed`)).toHaveLength(0)
  })
})
