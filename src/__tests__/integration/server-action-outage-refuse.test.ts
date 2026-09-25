/**
 * A roster OUTAGE answers the web action's OWN failure shape (Round 3 leg 6,
 * 2026-09-25).
 *
 * grantCustomerConsent / revokeCustomerConsent / updateKaruteOutcome /
 * setStaffPermissions read the roster chain before their try, so the typed
 * roster outage (staff.ts: AppApiError('upstream_unavailable', 'staff profiles
 * read failed')) REJECTED the action: a consent dialog, the outcome dialog or
 * the permissions sheet got nothing it could print. Now the throw logs one
 * bounded line and resolves the failure shape with common.somethingWentWrong
 * — the line the web clients already print for a transport failure — and the
 * core never runs.
 *
 * Lesson 83: the outage is thrown by PRODUCTION code. @/lib/staff is the real
 * module (getCurrentUserStaffId → getStaffList → getBusinessId →
 * resolveUserId); only the SOURCES it reads are mocked — the supabase clients.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
// ns.key, so a pin can see WHICH namespace the line came from.
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async (ns: string) => (key: string) => `${ns}.${key}`),
}))
// The gate is a pass-through for the H-4 hunk pins; P4d–P4f hand it back to
// the REAL one. getMyCapabilities stays real (it reads the real roster chain).
jest.mock('@/lib/auth/require-permission', () => ({
  ...jest.requireActual<typeof import('@/lib/auth/require-permission')>('@/lib/auth/require-permission'),
  requireCapability: jest.fn(async () => {}),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  ...jest.requireActual<typeof import('@/lib/auth/store-scope')>('@/lib/auth/store-scope'),
  resolveStoreScope: jest.fn(async () => ({ viewAll: true, degraded: false, allowedStoreIds: null })),
  staffWriteInScope: jest.fn(async () => true),
}))
jest.mock('@/lib/audit-store-lock', () => ({ ensureRecordStoreInScopeAudited: jest.fn() }))
jest.mock('@/lib/audit', () => ({ audit: jest.fn(), auditDurable: jest.fn(async () => true) }))
jest.mock('@/lib/audit-web', () => ({
  auditWeb: jest.fn(async () => {}),
  resolveWebActorId: jest.fn(async () => 'actor-1'),
  resolveWebBusinessId: jest.fn(async () => 'biz-1'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'actor-1', businessId: 'biz-1' })),
}))
jest.mock('@/lib/synqed/staff-pager', () => ({ listAllCoreStaff: jest.fn(async () => []) }))
// P4g reaches staff.ts's lazy SDK import. Jest cannot load the ESM-only SDK
// there (a SyntaxError), so a stub client stands in; the roster read itself is
// listAllCoreStaff above. P4h makes its construction throw.
const mockSdk = { constructError: null as Error | null }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = {}
    constructor() {
      if (mockSdk.constructError) throw mockSdk.constructError
    }
  },
}))
jest.mock('@/lib/karute/outcome', () => ({ setKaruteOutcome: jest.fn(async () => ({})) }))
// The REAL consent cores, wrapped so a pin can see whether they ran.
jest.mock('@/lib/customers/customers.core', () => {
  const actual = jest.requireActual<typeof import('@/lib/customers/customers.core')>('@/lib/customers/customers.core')
  return {
    ...actual,
    grantCustomerConsentWithClient: jest.fn(actual.grantCustomerConsentWithClient),
    revokeCustomerConsentWithClient: jest.fn(actual.revokeCustomerConsentWithClient),
  }
})
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
// A distinctive PostgREST message: it may reach the SOURCE's server log only.
const DB_TEXT = 'PGRST-SECRET-42 connection refused'
const ROSTER_DOWN = { data: null, error: { message: DB_TEXT, code: 'PGRST000' } }
let rosterRead: { data: unknown; error: unknown } = { data: [ROSTER_ROW], error: null }
const MEMBER_OK = { data: { customer_id: 'biz-1', full_name: 'Owner' }, error: null }
let membershipRead: { data: unknown; error: unknown } = MEMBER_OK
const OWNER_CAPS_ROW = { display_role: 'owner', permission_role: 'owner', permissions: null }
let callerCapsRow: Record<string, unknown> = OWNER_CAPS_ROW
// setStaffPermissionsCore lives in permissions.ts itself: its first read (the
// target row) and its write are how a pin sees that it ran.
const coreTargetReads = jest.fn()
const serviceUpdate = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    let cols = ''
    const chain: Record<string, unknown> = {}
    for (const m of ['eq', 'ilike', 'not', 'in']) chain[m] = () => chain
    chain.select = (c: string) => {
      cols = c
      return chain
    }
    // businessIdForUser's membership read.
    chain.single = async () => membershipRead
    // staffListCore's profiles read (the one staff.ts :92 wraps).
    chain.order = async () => rosterRead
    chain.maybeSingle = async () => {
      if (cols.startsWith('id,')) {
        coreTargetReads()
        return { data: { id: 'staff-T', display_role: 'stylist', permission_role: 'practitioner', permissions: null }, error: null }
      }
      // capabilitiesForUser: the caller (the owner unless a pin says otherwise).
      return { data: callerCapsRow, error: null }
    }
    chain.update = (v: unknown) => {
      serviceUpdate(v)
      return { eq: () => ({ eq: async () => ({ error: null }) }) }
    }
    return { from: () => chain }
  },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { grantCustomerConsent, revokeCustomerConsent } from '@/actions/customers'
import { updateKaruteOutcome } from '@/actions/karute-outcome'
import { setStaffPermissions } from '@/actions/permissions'
import { getStaffList } from '@/lib/staff'
import { presetCapabilities } from '@/lib/auth/permissions'
import { requireCapability } from '@/lib/auth/require-permission'
import { staffWriteInScope } from '@/lib/auth/store-scope'
import { getSynqedClient } from '@/lib/synqed/client'
import { listAllCoreStaff } from '@/lib/synqed/staff-pager'
import { setKaruteOutcome } from '@/lib/karute/outcome'
import { grantCustomerConsentWithClient, revokeCustomerConsentWithClient } from '@/lib/customers/customers.core'

const gate = requireCapability as unknown as jest.Mock
const synqedClient = getSynqedClient as unknown as jest.Mock
const realRequireCapability = jest.requireActual<typeof import('@/lib/auth/require-permission')>(
  '@/lib/auth/require-permission',
).requireCapability

const CUSTOMER = 'cust-MARK-1'
const KARUTE = 'karute-MARK-2'
const TARGET_STAFF = 'staff-T'
const INPUTS = [CUSTOMER, KARUTE, TARGET_STAFF]
const FAILURE_LINE = 'common.somethingWentWrong'
const ROSTER_THROW_LOG = { errName: 'AppApiError', errStatus: 502, errMessage: 'staff profiles read failed' }

const grantConsent = jest.fn(async () => ({ id: 'consent-1' }))
const revokeConsent = jest.fn(async () => undefined)
const karuteGet = jest.fn(async () => ({ id: KARUTE, store_id: null, customer_id: CUSTOMER }))

let consoleError: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  rosterRead = { data: [ROSTER_ROW], error: null }
  membershipRead = MEMBER_OK
  callerCapsRow = OWNER_CAPS_ROW
  gate.mockImplementation(async () => {})
  synqedClient.mockResolvedValue({
    customers: { grantConsent, revokeConsent },
    karuteRecords: { get: karuteGet },
  })
})
afterEach(() => consoleError.mockRestore())

const SOURCE_LOG = '[getStaffList] staff profiles read failed'
const logsStartingWith = (prefix: string) => consoleError.mock.calls.filter((c) => String(c[0]).startsWith(prefix))

/** One bounded action line (describeUnknownThrow shape, never the raw error),
 *  no input and no database text in it; nothing else logged but the source's. */
function expectOneBoundedOutageLine(prefix: string) {
  const lines = logsStartingWith(prefix)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toHaveLength(2)
  expect(lines[0][1]).not.toBeInstanceOf(Error)
  expect(lines[0][1]).toEqual(ROSTER_THROW_LOG)
  for (const arg of lines[0]) {
    for (const secret of [...INPUTS, DB_TEXT]) {
      expect(String(arg)).not.toContain(secret)
      expect(JSON.stringify(arg) ?? '').not.toContain(secret)
    }
  }
  // The rest are the SOURCE's own line (staff.ts :91), never another.
  for (const c of consoleError.mock.calls) {
    expect(String(c[0]).startsWith(prefix) || String(c[0]).startsWith(SOURCE_LOG)).toBe(true)
  }
  expect(logsStartingWith(SOURCE_LOG).length).toBeGreaterThanOrEqual(1)
}

function expectNotTheWrongLines(res: { error?: string }) {
  expect(res.error).not.toBe('staff profiles read failed')
  expect(res.error).not.toBe('karute record not found')
  expect(res.error).not.toContain(DB_TEXT)
}

describe('THE FAILURE LINE exists in both locales (the key the web clients print)', () => {
  it('common.somethingWentWrong is in ja.json and en.json', () => {
    for (const locale of ['ja', 'en']) {
      const messages = JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'))
      expect(typeof messages.common.somethingWentWrong).toBe('string')
      expect(messages.common.somethingWentWrong.length).toBeGreaterThan(0)
    }
  })
})

describe('P1 grantCustomerConsent — a roster outage resolves the failure shape', () => {
  it('P1a roster source throws → { ok: false, error: THE FAILURE LINE }, core never runs', async () => {
    rosterRead = ROSTER_DOWN
    const res = await grantCustomerConsent(CUSTOMER, { method: 'VERBAL' })
    expect(res).toEqual({ ok: false, error: FAILURE_LINE })
    expectNotTheWrongLines(res)
    expect(grantCustomerConsentWithClient).not.toHaveBeenCalled()
    expect(grantConsent).not.toHaveBeenCalled()
    expectOneBoundedOutageLine('[customers] pre-core read failed (roster)')
  })

  it('P1b happy path unchanged', async () => {
    const res = await grantCustomerConsent(CUSTOMER, { method: 'VERBAL' })
    expect(res).toEqual({ ok: true, consent: { id: 'consent-1' } })
    expect(grantCustomerConsentWithClient).toHaveBeenCalledWith(expect.anything(), CUSTOMER, 'actor-1', 'VERBAL')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('P1c a RESOLVED null staff id keeps today\'s answer (not the outage)', async () => {
    rosterRead = { data: [], error: null }
    const res = await grantCustomerConsent(CUSTOMER)
    expect(res).toEqual({ ok: false, error: 'No staff identity for the signed-in user.' })
    expect(grantCustomerConsentWithClient).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('P2 revokeCustomerConsent — a roster outage resolves the failure shape', () => {
  it('P2a roster source throws → { ok: false, error: THE FAILURE LINE }, core never runs', async () => {
    rosterRead = ROSTER_DOWN
    const res = await revokeCustomerConsent(CUSTOMER)
    expect(res).toEqual({ ok: false, error: FAILURE_LINE })
    expectNotTheWrongLines(res)
    expect(revokeCustomerConsentWithClient).not.toHaveBeenCalled()
    expect(revokeConsent).not.toHaveBeenCalled()
    expectOneBoundedOutageLine('[customers] pre-core read failed (roster)')
  })

  it('P2b happy path unchanged', async () => {
    const res = await revokeCustomerConsent(CUSTOMER)
    expect(res).toEqual({ ok: true })
    expect(revokeCustomerConsentWithClient).toHaveBeenCalledWith(expect.anything(), CUSTOMER, 'actor-1')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('P2c a RESOLVED null staff id keeps today\'s answer (not the outage)', async () => {
    rosterRead = { data: [], error: null }
    const res = await revokeCustomerConsent(CUSTOMER)
    expect(res).toEqual({ ok: false, error: 'No staff identity for the signed-in user.' })
    expect(revokeCustomerConsentWithClient).not.toHaveBeenCalled()
  })
})

describe('P3 updateKaruteOutcome — a roster outage resolves the failure shape', () => {
  const OUTCOME = { status: 'success' as const }

  it('P3a roster source throws → { error: THE FAILURE LINE }, never not-found, core never runs', async () => {
    rosterRead = ROSTER_DOWN
    const res = await updateKaruteOutcome(KARUTE, OUTCOME)
    expect(res).toEqual({ error: FAILURE_LINE })
    expectNotTheWrongLines(res)
    expect(setKaruteOutcome).not.toHaveBeenCalled()
    expect(karuteGet).not.toHaveBeenCalled() // answered before the record read
    expectOneBoundedOutageLine('[karute-outcome] pre-core read failed (roster)')
  })

  it('P3b happy path unchanged', async () => {
    const res = await updateKaruteOutcome(KARUTE, OUTCOME)
    expect(res).toEqual({})
    expect(setKaruteOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karuteRecordId: KARUTE, customerId: CUSTOMER, status: 'success', decidedBy: 'actor-1' }),
    )
    expect(consoleError).not.toHaveBeenCalled()
  })

  // Documented, not changed (the resolved-null line is queued, not this leg).
  it('P3c a RESOLVED null staff id follows today\'s path — the write runs with decidedBy: null', async () => {
    rosterRead = { data: [], error: null }
    const res = await updateKaruteOutcome(KARUTE, OUTCOME)
    expect(res).toEqual({})
    expect(setKaruteOutcome).toHaveBeenCalledWith(expect.objectContaining({ decidedBy: null }))
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('P4 setStaffPermissions — a pre-core read outage resolves the failure shape', () => {
  const ROLE = 'practitioner' as const
  const CAPS = presetCapabilities(ROLE)

  it('P4a roster source throws after the gate → { error: THE FAILURE LINE }, core never runs', async () => {
    rosterRead = ROSTER_DOWN
    const res = await setStaffPermissions(TARGET_STAFF, ROLE, CAPS)
    expect(res).toEqual({ error: FAILURE_LINE })
    expectNotTheWrongLines(res as { error?: string })
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(coreTargetReads).not.toHaveBeenCalled()
    expect(serviceUpdate).not.toHaveBeenCalled()
    expectOneBoundedOutageLine('[permissions] pre-core read failed (roster)')
  })

  it('P4b happy path unchanged', async () => {
    const res = await setStaffPermissions(TARGET_STAFF, ROLE, CAPS)
    expect(res).toEqual({ ok: true })
    expect(staffWriteInScope).toHaveBeenCalledWith({ targetStaffId: TARGET_STAFF, actorId: 'actor-1' })
    expect(coreTargetReads).toHaveBeenCalledTimes(1)
    expect(serviceUpdate).toHaveBeenCalledWith({ permission_role: ROLE, permissions: null })
    expect(consoleError).not.toHaveBeenCalled()
  })

  // D-S25-1 (fold F1): the REAL gate reads the same roster chain FIRST
  // (requireCapability → can → getMyCapabilities → getCurrentUserStaffId), so
  // an outage already down when the action starts surfaces in the gate's
  // catch. A TYPED outage there answers the failure line too.
  it('P4d REAL gate, roster source down → { error: THE FAILURE LINE } from the gate, core never runs', async () => {
    gate.mockImplementation(realRequireCapability)
    rosterRead = ROSTER_DOWN
    const res = await setStaffPermissions(TARGET_STAFF, ROLE, CAPS)
    expect(res).toEqual({ error: FAILURE_LINE })
    expectNotTheWrongLines(res as { error?: string })
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(coreTargetReads).not.toHaveBeenCalled()
    expect(serviceUpdate).not.toHaveBeenCalled()
    expectOneBoundedOutageLine('[permissions] pre-core read failed (roster)')
  })

  // D-S26-1 (fold F2): the synqed-core roster fetch sits in the same roster wave
  // (staffListCore → synqedStaffWithoutProfile), so a CORE outage must reach the
  // gate's catch as the same typed outage, never as its raw message. Seam:
  // listAllCoreStaff (mocked at the top of this file) rejects at staff.ts's
  // await; the real SDK import and client construction run.
  it('P4g REAL gate, synqed-core roster fetch fails → { error: THE FAILURE LINE } from the gate, never the raw message', async () => {
    gate.mockImplementation(realRequireCapability)
    const coreRoster = listAllCoreStaff as unknown as jest.Mock
    coreRoster.mockRejectedValueOnce(new TypeError('fetch failed'))
    const env = { url: process.env.SYNQED_CORE_URL, key: process.env.SYNQED_CORE_API_KEY }
    process.env.SYNQED_CORE_URL = 'http://core.test'
    process.env.SYNQED_CORE_API_KEY = 'test-key'
    // Assigning undefined to process.env stores the STRING 'undefined' — delete instead.
    const restoreEnv = () => {
      if (env.url === undefined) delete process.env.SYNQED_CORE_URL
      else process.env.SYNQED_CORE_URL = env.url
      if (env.key === undefined) delete process.env.SYNQED_CORE_API_KEY
      else process.env.SYNQED_CORE_API_KEY = env.key
    }
    const res = await setStaffPermissions(TARGET_STAFF, ROLE, CAPS).finally(restoreEnv)
    expect(coreRoster).toHaveBeenCalledTimes(1) // the reject came from the roster await, not the import
    expect(res).toEqual({ error: FAILURE_LINE })
    expect(JSON.stringify(res)).not.toContain('fetch failed')
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(coreTargetReads).not.toHaveBeenCalled()
    expect(serviceUpdate).not.toHaveBeenCalled()
    // The source's one bounded line (describeUnknownThrow shape: no Error, no stack)…
    const source = logsStartingWith('[getStaffList] synqed-core roster fetch failed:')
    expect(source).toHaveLength(1)
    expect(source[0]).toHaveLength(2)
    expect(source[0][1]).not.toBeInstanceOf(Error)
    expect(source[0][1]).toEqual({ errName: 'TypeError', errMessage: 'fetch failed' })
    // …and the gate catch's one typed line; nothing else logged.
    const action = logsStartingWith('[permissions] pre-core read failed (roster)')
    expect(action).toHaveLength(1)
    expect(action[0][1]).toEqual({ errName: 'AppApiError', errStatus: 502, errMessage: 'synqed-core roster fetch failed' })
    expect(consoleError).toHaveBeenCalledTimes(2)
  })

  // D-S26-3/4 (folds F3/F4): only the roster READ is an outage. A client that
  // cannot be constructed is a deployment defect: typed 'internal' (500), a
  // FIXED message, the detail on cause — never a 502, never the raw message.
  async function withBrokenClient<T>(act: () => Promise<T>): Promise<T> {
    const env = { url: process.env.SYNQED_CORE_URL, key: process.env.SYNQED_CORE_API_KEY }
    process.env.SYNQED_CORE_URL = 'http://core.test'
    process.env.SYNQED_CORE_API_KEY = 'test-key'
    mockSdk.constructError = new Error('bad client config')
    return act().finally(() => {
      mockSdk.constructError = null
      if (env.url === undefined) delete process.env.SYNQED_CORE_URL
      else process.env.SYNQED_CORE_URL = env.url
      if (env.key === undefined) delete process.env.SYNQED_CORE_API_KEY
      else process.env.SYNQED_CORE_API_KEY = env.key
    })
  }
  const CLIENT_LOG = '[getStaffList] synqed-core client unavailable:'

  it('P4h a failed SDK client construction → typed internal, fixed message, detail on cause — never an outage', async () => {
    const err = await withBrokenClient(() => getStaffList().then(() => 'resolved', (e: unknown) => e))
    expect(err).toMatchObject({
      name: 'AppApiError',
      code: 'internal',
      message: 'synqed-core client unavailable',
      cause: { message: 'bad client config' },
    })
    expect(err).not.toMatchObject({ code: 'upstream_unavailable' })
    expect(listAllCoreStaff).not.toHaveBeenCalled()
    const lines = logsStartingWith(CLIENT_LOG)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(2)
    expect(lines[0][1]).not.toBeInstanceOf(Error)
    expect(lines[0][1]).toEqual({ errName: 'Error', errMessage: 'bad client config' })
    expect(logsStartingWith('[getStaffList] synqed-core roster fetch failed:')).toHaveLength(0)
  })

  it('P4i REAL gate, SDK client construction fails → the FIXED line, never the raw detail, core never runs', async () => {
    gate.mockImplementation(realRequireCapability)
    const res = await withBrokenClient(() => setStaffPermissions(TARGET_STAFF, ROLE, CAPS))
    expect(res).toEqual({ error: 'synqed-core client unavailable' })
    expect(JSON.stringify(res)).not.toContain('bad client config')
    expect(logsStartingWith('[permissions] pre-core read failed')).toHaveLength(0)
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  // A real denial is a plain Error (require-permission.ts :120) — its answer
  // is today's, byte-for-byte (value taken from origin/main's code).
  it('P4e REAL gate, roster up, caller lacks staff.manage → today\'s denial, unchanged', async () => {
    expect(presetCapabilities('practitioner')).not.toContain('staff.manage')
    gate.mockImplementation(realRequireCapability)
    callerCapsRow = { display_role: 'stylist', permission_role: 'practitioner', permissions: null }
    const res = await setStaffPermissions(TARGET_STAFF, ROLE, CAPS)
    expect(res).toEqual({ error: 'You do not have permission to perform this action.' })
    expect(logsStartingWith('[permissions] pre-core read failed')).toHaveLength(0)
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  // P4e's denial is not an AppApiError, so this is the one that proves the
  // discriminator: a NON-outage AppApiError from the gate (a removed
  // membership, staff.ts :345) keeps today's message.
  it('P4f REAL gate, a non-outage AppApiError (membership_inactive) → today\'s message, unchanged', async () => {
    gate.mockImplementation(realRequireCapability)
    membershipRead = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    const res = await setStaffPermissions(TARGET_STAFF, ROLE, CAPS)
    expect(res).toEqual({ error: 'No active business membership for this user' })
    expect(logsStartingWith('[permissions] pre-core read failed')).toHaveLength(0)
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(serviceUpdate).not.toHaveBeenCalled()
  })
})
