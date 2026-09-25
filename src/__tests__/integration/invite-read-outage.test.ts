/**
 * A THROWN roster / permission read is an OUTAGE — not "off the roster", not
 * "no permission" (Round 3 leg 5, 2026-09-25, D-S23-1).
 *
 * createInvite used to swallow getCurrentUserStaffId() to null and
 * getMyCapabilities() to the empty set. So a permission-read outage answered
 * INVITE_ROLE_EXCEEDS_CALLER (「権限がありません」), and a roster-read outage
 * reached the core with invitedBy: null — the invited_by: null write was only
 * unreachable in production because both reads share one memoised promise.
 * Now one try covers both: a throw answers the dialog's existing
 * STAFF_CREATE_FAILED line before the core runs; a RESOLVED null stays the
 * core's own empty-set refusal.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {},
}))
// The gate is a no-op for P1–P4; P5–P8 hand requireCapability back to the
// REAL one, whose internal can → getMyCapabilities chain reads the profile
// through the service mock below (the throw happens inside the gate).
jest.mock('@/lib/auth/require-permission', () => ({
  ...jest.requireActual<typeof import('@/lib/auth/require-permission')>('@/lib/auth/require-permission'),
  can: jest.fn(async () => true),
  requireCapability: jest.fn(async () => {}),
  getMyCapabilities: jest.fn(),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ viewAll: true, degraded: false, allowedStoreIds: null })),
  staffWriteInScope: jest.fn(async () => true),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'actor-1'),
  getCurrentUserStaffId: jest.fn(),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn(), auditDurable: jest.fn(async () => true) }))
jest.mock('@/lib/audit-web', () => ({
  auditWeb: jest.fn(async () => {}),
  resolveWebActorId: jest.fn(async () => 'actor-1'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'actor-1', businessId: 'biz-1' })),
}))
jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowed: jest.fn(async () => ({ allowed: true })),
}))
// The gate's profile read (P5–P8 only; null = the core's empty member lookup).
let gateProfileRead: { data: unknown; error: unknown } | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike']) chain[m] = () => chain
    ;(chain as { maybeSingle: unknown }).maybeSingle = async () => gateProfileRead ?? { data: null }
    return { from: () => chain }
  },
}))
// The REAL core, wrapped so a pin can see whether (and with what) it ran.
jest.mock('@/lib/invites/invites.core', () => {
  const actual = jest.requireActual<typeof import('@/lib/invites/invites.core')>('@/lib/invites/invites.core')
  return { ...actual, createInviteCore: jest.fn(actual.createInviteCore) }
})

const GINZA = '11111111-1111-4111-8111-111111111111'
const invitesCreate = jest.fn(async () => ({ id: 'inv-new' }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    staff: {
      create: jest.fn(async () => ({ id: 'staff-new' })),
      delete: jest.fn(async () => ({})),
      get: jest.fn(async () => ({ id: 'staff-new', email: null, user_id: null })),
      update: jest.fn(async () => ({})),
      list: jest.fn(async () => ({ staff: [], total: 0 })),
    },
    staffStores: { set: jest.fn(async () => ({})), get: jest.fn(async () => ({ store_ids: [] })) },
    stores: { list: jest.fn(async () => ({ stores: [{ id: GINZA, is_primary: true }] })) },
    invites: { create: invitesCreate, list: jest.fn(async () => ({ invites: [] })) },
  })),
  newSynqedClient: jest.fn(() => ({})),
}))

import { createInvite } from '@/actions/invites'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { createInviteCore } from '@/lib/invites/invites.core'
import { AppApiError } from '@/lib/app-api/errors'

const staffId = getCurrentUserStaffId as unknown as jest.Mock
const myCaps = getMyCapabilities as unknown as jest.Mock
const core = createInviteCore as unknown as jest.Mock
const gate = requireCapability as unknown as jest.Mock
const businessId = getBusinessId as unknown as jest.Mock
const realRequireCapability = jest.requireActual<typeof import('@/lib/auth/require-permission')>(
  '@/lib/auth/require-permission',
).requireCapability

// Every capability a STYLIST invite seeds (hold what you grant).
const FULL = new Set(['staff.manage', 'records.write', 'customers.view', 'customers.manage', 'bookings.manage'])
const INVITE = { email: 'secret-invitee@test.com', role: 'STYLIST' as const, name: '新人', storeIds: [GINZA] }

let consoleError: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  staffId.mockResolvedValue('actor-1')
  myCaps.mockResolvedValue(FULL)
  gateProfileRead = null
  gate.mockImplementation(async () => {})
  businessId.mockResolvedValue('biz-1')
})
afterEach(() => consoleError.mockRestore())

const OUTAGE_LOG = '[createInvite] pre-core read failed'
const outageLogs = () => consoleError.mock.calls.filter((c) => String(c[0]).startsWith(OUTAGE_LOG))

function expectOutageAnswer(res: unknown) {
  expect(res).toEqual({ error: 'STAFF_CREATE_FAILED' })
  expect(core).not.toHaveBeenCalled()
  expect(invitesCreate).not.toHaveBeenCalled()
  expect(consoleError).toHaveBeenCalledTimes(1)
  expect(outageLogs()).toHaveLength(1)
  // Bounded one-line description (describeUnknownThrow), never the raw error.
  expect(outageLogs()[0][1]).not.toBeInstanceOf(Error)
  // ids only: the invitee's email never reaches the log.
  for (const arg of consoleError.mock.calls[0]) {
    expect(String(arg)).not.toContain(INVITE.email)
    expect(JSON.stringify(arg) ?? '').not.toContain(INVITE.email)
  }
}

describe('createInvite — a thrown pre-core read is an outage (D-S23-1)', () => {
  it('P1 roster read throws → STAFF_CREATE_FAILED, core never runs', async () => {
    staffId.mockRejectedValue(new Error('core down'))
    expectOutageAnswer(await createInvite(INVITE))
  })

  it('P2 permission read throws → STAFF_CREATE_FAILED, never 「権限がありません」', async () => {
    myCaps.mockRejectedValue(new Error('core down'))
    expectOutageAnswer(await createInvite(INVITE))
  })

  it("P3 a RESOLVED null invitedBy is not an outage — the core's own refusal", async () => {
    staffId.mockResolvedValue(null)
    myCaps.mockResolvedValue(new Set()) // what the real read returns off the roster
    const res = await createInvite(INVITE)
    expect(res).toEqual({ error: 'INVITE_ROLE_EXCEEDS_CALLER' })
    expect(core).toHaveBeenCalledTimes(1)
    expect(core.mock.calls[0][3]).toBeNull()
    expect(invitesCreate).not.toHaveBeenCalled()
    expect(outageLogs()).toHaveLength(0)
  })

  it('P4 happy path unchanged', async () => {
    const res = await createInvite(INVITE)
    expect(res).toEqual({ token: expect.any(String) })
    expect(core).toHaveBeenCalledTimes(1)
    expect(core.mock.calls[0][3]).toBe('actor-1')
    expect(core.mock.calls[0][2]).toEqual(expect.objectContaining({ callerCapabilities: FULL }))
    expect(invitesCreate).toHaveBeenCalledTimes(1)
    // The core's own fixture-path notes may log; the outage line must not.
    expect(outageLogs()).toHaveLength(0)
  })
})

// Greptile P1 on #1040: requireInviteBusiness() runs FIRST and rides the same
// memoised roster/permission read, so a real outage surfaces at the gate —
// never reaching the try above. The gate here is the REAL requireCapability.
describe('createInvite — an outage at the permission gate is an outage too (fold G1)', () => {
  const OWNER_ROW = { data: { display_role: 'owner', permission_role: 'owner', permissions: null }, error: null }
  beforeEach(() => gate.mockImplementation(realRequireCapability))

  it('P5 the gate\'s permission read fails → STAFF_CREATE_FAILED, core never runs', async () => {
    gateProfileRead = { data: null, error: { code: '08006', message: 'connection failure' } }
    expectOutageAnswer(await createInvite(INVITE))
    expect(myCaps).not.toHaveBeenCalled() // refused at the gate, before the try
  })

  it('P6 a real denial keeps today\'s answer, byte-identical', async () => {
    // senior: sees every store (no assignment read) but holds no staff.invite.
    gateProfileRead = { data: { display_role: 'STYLIST', permission_role: 'senior', permissions: null }, error: null }
    const res = await createInvite(INVITE)
    expect(res).toEqual({ error: 'You do not have permission to perform this action.' })
    expect(core).not.toHaveBeenCalled()
    expect(outageLogs()).toHaveLength(0)
  })

  it('P7 the business read fails (upstream_unavailable) → STAFF_CREATE_FAILED, core never runs', async () => {
    gateProfileRead = OWNER_ROW
    businessId.mockRejectedValue(new AppApiError('upstream_unavailable', 'Business membership lookup failed'))
    expectOutageAnswer(await createInvite(INVITE))
  })

  it('P8 a removed membership keeps today\'s answer', async () => {
    gateProfileRead = OWNER_ROW
    businessId.mockRejectedValue(new AppApiError('membership_inactive', 'No active business membership for this user'))
    const res = await createInvite(INVITE)
    expect(res).toEqual({ error: 'No active business membership for this user' })
    expect(core).not.toHaveBeenCalled()
    expect(outageLogs()).toHaveLength(0)
  })
})
