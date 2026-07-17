/**
 * Web-action audit writers (AUDIT-LOG-DESIGN.md; fix-plan P1 wave A part 2).
 *
 * One test per writer: each staff / invite / permissions / store-assignment
 * mutation emits exactly ONE structured audit line on SUCCESS — plus the two
 * silence contracts (a denied mutation and a failed backend emit nothing;
 * errors are not actions). The emitter line shape and console levels are
 * pinned by facade-audit.test.ts; these pin each web action's key, severity,
 * target and ids-only detail. The export-route writer is covered next to the
 * route's other contracts in export-route-rbac.test.ts.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'

jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined, set: jest.fn(), delete: jest.fn() })),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

// Identity seam: auditWeb resolves actor + business from here when the writer
// doesn't pass them explicitly.
jest.mock('@/lib/staff', () => ({
  resolveUserId: jest.fn(async () => 'user-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => 'user-1'),
  getStaffList: jest.fn(async () => [{ id: 'user-1', display_role: 'owner' }]),
}))

const can = jest.fn(async (_cap: string) => true)
const requireCapability = jest.fn(async (_cap: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  can: (cap: string) => can(cap),
  requireCapability: (cap: string) => requireCapability(cap),
  // The caller is the owner — holds every capability (no-escalation passes).
  getMyCapabilities: jest.fn(async () => {
    const real = jest.requireActual<typeof import('@/lib/auth/permissions')>(
      '@/lib/auth/permissions',
    )
    return real.effectiveCapabilities('owner', null)
  }),
}))

const staffCreate = jest.fn(async () => ({ id: 'staff-new' }))
const staffUpdate = jest.fn(async () => ({}))
const staffDelete = jest.fn(async () => {})
const invitesCreate = jest.fn(async () => ({ id: 'inv-1' }))
const invitesUpdateStatus = jest.fn(async () => ({}))
const staffStoresSet = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    staff: { create: staffCreate, update: staffUpdate, delete: staffDelete },
    invites: { create: invitesCreate, updateStatus: invitesUpdateStatus },
    staffStores: { set: staffStoresSet },
  })),
}))

jest.mock('@/lib/synqed/staff-map', () => ({
  lookupSynqedStaffId: jest.fn(async () => 'synqed-7'),
}))
jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowed: jest.fn(async () => ({ allowed: true })),
}))
jest.mock('@/lib/entitlements', () => ({
  loadEntitlement: jest.fn(async () => ({ canAddStore: true })),
}))

// acceptInvite constructs SynqedClient directly (pre-auth paths).
const publicGetByToken = jest.fn()
const linkedStaffList = jest.fn(async () => ({ staff: [] }))
const linkedStaffCreate = jest.fn(async () => ({ id: 'staff-linked' }))
const linkedStaffUpdate = jest.fn(async () => ({}))
const linkedInvitesUpdateStatus = jest.fn(async () => ({}))
jest.mock('@synqed-kk/client', () => ({
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  SynqedClient: class {
    invites = {
      getByToken: (token: string) => publicGetByToken(token),
      updateStatus: linkedInvitesUpdateStatus,
    }
    staff = { list: linkedStaffList, create: linkedStaffCreate, update: linkedStaffUpdate }
  },
}))

// Service client: select chains read `profileRow`; update chains resolve
// `{ error: updateError }` after one OR two .eq() calls (both shapes exist).
let profileRow: Record<string, unknown> | null = null
let updateError: { message: string } | null = null
const adminCreateUser = jest.fn(async () => ({
  data: { user: { id: 'user-new' } },
  error: null,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike', 'order', 'limit']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: profileRow })
    ;(builder as { update: unknown }).update = () => {
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: updateError })
      return chain
    }
    return {
      from: () => builder,
      auth: { admin: { createUser: adminCreateUser, deleteUser: jest.fn(async () => ({})) } },
    }
  },
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { signInWithPassword: jest.fn(async () => ({ error: null })) },
  })),
}))

import { createStaff, updateStaff, deleteStaff } from '@/actions/staff'
import { createInvite, revokeInvite, acceptInvite } from '@/actions/invites'
import { setStaffPermissions } from '@/actions/permissions'
import { setStaffStores } from '@/actions/stores'
import { presetCapabilities } from '@/lib/auth/permissions'
import { auditLines } from './helpers/audit-lines'

const validStaff = { name: 'New Person', position: '', email: '', phone: '' }

beforeEach(() => {
  jest.clearAllMocks()
  can.mockImplementation(async () => true)
  requireCapability.mockImplementation(async () => {})
  profileRow = null
  updateError = null
})

describe('staff lifecycle writers', () => {
  it('createStaff emits staff.add targeting the created core row', async () => {
    const lines = await auditLines(async () => {
      await expect(createStaff(validStaff)).resolves.toBeUndefined()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'staff',
      action: 'staff.add',
      actor_id: 'user-1',
      business_id: 'biz-1',
      target_type: 'staff',
      target_id: 'staff-new',
      severity: 'info',
      source: 'web',
    })
  })

  it('updateStaff emits staff.update targeting the edited staff id', async () => {
    const lines = await auditLines(async () => {
      await expect(updateStaff('staff-9', validStaff)).resolves.toBeUndefined()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.update',
      target_type: 'staff',
      target_id: 'staff-9',
      severity: 'info',
    })
  })

  it('deleteStaff emits staff.remove at notice with the resolved core id in detail', async () => {
    profileRow = { id: 'staff-9' } // profile-backed → resolves to the synqed id
    const lines = await auditLines(async () => {
      await expect(deleteStaff('staff-9')).resolves.toBeUndefined()
    })
    expect(staffDelete).toHaveBeenCalledWith('synqed-7')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.remove',
      severity: 'notice',
      target_id: 'staff-9',
      detail: { synqed_staff_id: 'synqed-7' },
    })
  })
})

describe('invite writers', () => {
  it('createInvite emits staff.invite_create with ids-only detail (never the email)', async () => {
    const lines = await auditLines(async () => {
      const res = await createInvite({ email: 'newhire@example.com', role: 'STYLIST' })
      expect(res).toHaveProperty('token')
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.invite_create',
      business_id: 'biz-1',
      target_id: null, // brand-new hire — no staff row yet
      detail: { invite_id: 'inv-1', role: 'STYLIST', reinvite: false },
    })
    expect(JSON.stringify(lines[0])).not.toContain('newhire@example.com')
  })

  it('revokeInvite emits staff.invite_revoke carrying the invite id', async () => {
    const lines = await auditLines(async () => {
      await expect(revokeInvite('inv-9')).resolves.toEqual({ ok: true })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.invite_revoke',
      detail: { invite_id: 'inv-9' },
    })
  })

  it('acceptInvite emits staff.add with the NEW account as actor and target (no session yet)', async () => {
    publicGetByToken.mockResolvedValue({
      id: 'inv-1',
      status: 'pending',
      email: 'joiner@example.com',
      role: 'STYLIST',
      business_id: 'biz-join',
      invited_staff_id: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const lines = await auditLines(async () => {
      await expect(acceptInvite('tok-abcdef1234567890', 'password123', 'Joiner', 'ja')).resolves.toBeUndefined()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.add',
      actor_id: 'user-new',
      business_id: 'biz-join',
      target_type: 'staff',
      target_id: 'user-new',
      detail: { via: 'invite', invite_id: 'inv-1', role: 'STYLIST' },
    })
    expect(JSON.stringify(lines[0])).not.toContain('joiner@example.com')
  })
})

describe('authority writers', () => {
  it('setStaffPermissions emits settings.permissions_change at notice with before/after roles', async () => {
    profileRow = { id: 'staff-9', display_role: 'stylist', permission_role: 'practitioner' }
    const lines = await auditLines(async () => {
      await expect(
        setStaffPermissions('staff-9', 'manager', presetCapabilities('manager')),
      ).resolves.toEqual({ ok: true })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'settings',
      action: 'settings.permissions_change',
      severity: 'notice',
      actor_id: 'user-1',
      business_id: 'biz-1',
      target_type: 'staff',
      target_id: 'staff-9',
      detail: { before_role: 'practitioner', after_role: 'manager', customized: false },
    })
  })

  it('setStaffStores emits settings.staff_stores_change at notice with the full assignment set', async () => {
    const lines = await auditLines(async () => {
      await expect(setStaffStores('staff-9', ['store-a', 'store-b'])).resolves.toEqual({
        ok: true,
      })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'settings.staff_stores_change',
      severity: 'notice',
      target_id: 'staff-9',
      detail: { store_ids: 'store-a,store-b', count: 2 },
    })
  })
})

describe('silence contracts — errors are not actions', () => {
  it('a DENIED mutation emits nothing', async () => {
    can.mockImplementation(async () => false)
    const lines = await auditLines(async () => {
      await expect(createStaff(validStaff)).resolves.toEqual({ error: 'noPermission' })
    })
    expect(lines).toHaveLength(0)
  })

  it('a FAILED backend write emits nothing', async () => {
    staffUpdate.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      await expect(updateStaff('staff-9', validStaff)).resolves.toEqual({
        error: 'somethingWentWrong',
      })
    })
    expect(lines).toHaveLength(0)
  })

  it('an identity-resolution failure never breaks the mutation — the line emits with null ids', async () => {
    const staffLib = jest.requireMock('@/lib/staff') as {
      resolveUserId: jest.Mock
      getBusinessId: jest.Mock
    }
    staffLib.resolveUserId.mockRejectedValueOnce(new Error('auth down'))
    staffLib.getBusinessId.mockRejectedValueOnce(new Error('auth down'))
    const lines = await auditLines(async () => {
      await expect(createStaff(validStaff)).resolves.toBeUndefined()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'staff.add', actor_id: null, business_id: null })
  })
})
