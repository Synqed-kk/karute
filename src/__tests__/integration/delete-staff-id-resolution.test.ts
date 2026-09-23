/**
 * Coverage for deleteStaff's id-namespace handling (fix/staff-delete-id-mismatch).
 *
 * The roster lists profile-backed staff keyed by profiles.id, but
 * synqed.staff.delete's keyspace is the synqed staff.id. Passing a profiles.id
 * straight through 404'd ("Staff not found") and rethrew into a Server
 * Components crash on /settings. This suite proves deleteStaff now:
 *   - translates a profiles.id → synqed staff.id via the staff-map's PURE
 *     lookup (not resolveSynqedStaffId, whose create-on-miss leg is for the
 *     booking flow) before deleting,
 *   - treats a null lookup (profile with no synqed record) as already-gone:
 *     no delete call, no create, clean success,
 *   - passes a synqed-only id (no matching profile row) through unchanged,
 *   - preserves the 400 guard (last-member / attributed-records) as a RETURNED
 *     { error } message the client toasts (no longer thrown — a thrown Server
 *     Action message is stripped to a digest in production),
 *   - treats a 404 as already-gone (revalidate + resolve, never crash),
 *   - turns other SDK errors into the generic translated fallback (never raw),
 *   - denies without staff.manage as a clean { error }, never touching core.
 *
 * Collaborators are mocked directly (mirrors save-flow-staff-attribution's
 * "mock the deps, drive the action" style) so the test pins deleteStaff's own
 * branching rather than the lookup internals (covered by synqed-staff-map).
 */
// @synqed-kk/client ships as ESM and jest doesn't transform node_modules, so
// (like every other suite that touches it) we mock the specifier. A minimal
// SynqedError stand-in with the real (status, message) shape is enough — the
// action imports SynqedError from this same specifier, so `instanceof` and
// `.status` line up on both sides. Defined inside the factory (jest hoists
// mocks above imports); the test re-imports it below. (No SynqedClient needed:
// the action's client comes from the mocked @/lib/synqed/client.)
jest.mock('@synqed-kk/client', () => ({
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  },
}))
import { SynqedError } from '@synqed-kk/client'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// Action error strings are translated via getTranslations; the mock echoes the
// key so assertions read 'noPermission' / 'somethingWentWrong'.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

const requireCapability = jest.fn(async (_cap: string) => {})
const can = jest.fn(async (_cap: string) => true)
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (cap: string) => requireCapability(cap),
  can: (cap: string) => can(cap),
}))

// deleteStaff now consults the store clamp; the real store-scope module reaches
// unstable_cache at load. These tests are about id resolution, not scope — a
// viewAll-equivalent pass keeps them on their original path. The clamp's own
// coverage lives in staff-actions-store-scope.test.ts.
jest.mock('@/lib/auth/store-scope', () => ({
  staffWriteInScope: jest.fn(async () => true),
  // ⚖ Liam 2026-09-16: createStaff resolves the CREATOR's own stores so the
  // new card can only be placed inside them. Unclamped here — this suite is
  // about the error contract, not the store rule.
  resolveStoreScope: jest.fn(async () => ({
    storeId: null,
    viewAll: true,
    allowedStoreIds: null,
    degraded: false,
  })),
}))

const lookupSynqedStaffId = jest.fn(
  async (_id: string): Promise<string | null> => 'synqed-resolved',
)
jest.mock('@/lib/synqed/staff-map', () => ({
  // deleteStaffCore resolves via the business-explicit twin now (Bearer-safe,
  // PR #583); the spy keeps its single-arg call surface so every pin below
  // stays byte-identical — the tenant arg is asserted once, here.
  lookupSynqedStaffIdForBusiness: (id: string, businessId: string) => {
    expect(businessId).toBe('biz-1')
    return lookupSynqedStaffId(id)
  },
}))

const staffDelete = jest.fn(async (_id: string) => {})
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ staff: { delete: staffDelete } })),
}))

const getBusinessId = jest.fn(async () => 'biz-1')
jest.mock('@/lib/staff', () => ({
  getBusinessId: () => getBusinessId(),
}))

// profileRow === null models a synqed-only id (owner-created teammate not yet
// signed up); a row models a profile-backed staff (the crash case).
let profileRow: { id: string; full_name?: string | null } | null = null
// The removal's two neutralising moves (name → `_system_removed_…`, account
// banned): every profiles update is recorded with the .eq() scope it carried;
// either move can be made to fail on its own (the 9/12 layer matrix).
let profileUpdates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
let profileUpdateError: { message: string } | null = null
const updateUserById = jest.fn(
  async (_id: string, _attrs: Record<string, unknown>): Promise<{ error: unknown }> => ({ error: null }),
)
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({
      data: profileRow,
    })
    ;(builder as { update: unknown }).update = (patch: Record<string, unknown>) => {
      const rec = { patch, eq: [] as Array<[string, unknown]> }
      profileUpdates.push(rec)
      const chain: Record<string, unknown> = {}
      chain.eq = (c: string, v: unknown) => {
        rec.eq.push([c, v])
        return chain
      }
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: profileUpdateError })
      return chain
    }
    return {
      from: () => builder,
      auth: { admin: { updateUserById: (id: string, a: Record<string, unknown>) => updateUserById(id, a) } },
    }
  },
}))

import { deleteStaff } from '@/actions/staff'
import { auditLines } from './helpers/audit-lines'

beforeEach(() => {
  jest.clearAllMocks()
  profileRow = null
  profileUpdates = []
  profileUpdateError = null
  updateUserById.mockImplementation(async () => ({ error: null }))
  requireCapability.mockImplementation(async () => {})
  can.mockImplementation(async () => true)
  lookupSynqedStaffId.mockImplementation(async () => 'synqed-resolved')
  staffDelete.mockImplementation(async () => {})
})

describe('deleteStaff — id resolution', () => {
  it('translates a profiles.id to the synqed staff id before deleting', async () => {
    profileRow = { id: 'profile-1' }
    await deleteStaff('profile-1')
    expect(lookupSynqedStaffId).toHaveBeenCalledWith('profile-1')
    expect(staffDelete).toHaveBeenCalledWith('synqed-resolved')
  })

  it('passes a synqed-only id (no profile row) straight through', async () => {
    profileRow = null
    await deleteStaff('synqed-abc')
    expect(lookupSynqedStaffId).not.toHaveBeenCalled()
    expect(staffDelete).toHaveBeenCalledWith('synqed-abc')
  })

  it('treats a null lookup (profile with no synqed record) as already-gone: no delete, no crash', async () => {
    const { revalidatePath, updateTag } = jest.requireMock('next/cache')
    profileRow = { id: 'profile-unlinked' }
    lookupSynqedStaffId.mockResolvedValue(null)
    await expect(deleteStaff('profile-unlinked')).resolves.toBeUndefined()
    expect(staffDelete).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
    expect(updateTag).toHaveBeenCalledWith('staff-list')
  })
})

describe('deleteStaff — error handling', () => {
  it('RETURNS a 400 guard message (last-member / attributed-records) for the toast', async () => {
    staffDelete.mockRejectedValue(
      new SynqedError(400, 'Cannot delete the last staff member.'),
    )
    await expect(deleteStaff('synqed-abc')).resolves.toEqual({
      error: 'Cannot delete the last staff member.',
    })
  })

  it('treats a 404 as already-gone: clean success, roster revalidated', async () => {
    const { revalidatePath, updateTag } = jest.requireMock('next/cache')
    staffDelete.mockRejectedValue(new SynqedError(404, 'Staff not found'))
    await expect(deleteStaff('synqed-abc')).resolves.toBeUndefined()
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
    expect(updateTag).toHaveBeenCalledWith('staff-list')
  })

  it('turns other SDK errors (e.g. 500) into the generic translated fallback — never raw', async () => {
    staffDelete.mockRejectedValue(new SynqedError(500, 'Internal error'))
    await expect(deleteStaff('synqed-abc')).resolves.toEqual({
      error: 'somethingWentWrong',
    })
  })
})

describe('deleteStaff — authorization', () => {
  it('denies without staff.manage as a clean { error }, never touching core', async () => {
    can.mockResolvedValue(false)
    await expect(deleteStaff('synqed-abc')).resolves.toEqual({
      error: 'noPermission',
    })
    expect(staffDelete).not.toHaveBeenCalled()
  })
})

describe('deleteStaff — a removed person stops being recognised (reversible)', () => {
  const removeRow = async (id: string) => {
    let result: unknown
    const lines = await auditLines(async () => {
      result = await deleteStaff(id)
    })
    return { result, lines }
  }

  it('profile-backed: core delete → name gains _system_removed_ (scoped by id AND business) → account banned → audit flags', async () => {
    profileRow = { id: 'profile-1', full_name: '田中' }
    const { result, lines } = await removeRow('profile-1')
    expect(result).toBeUndefined()
    expect(staffDelete).toHaveBeenCalledWith('synqed-resolved')
    expect(profileUpdates).toEqual([
      {
        patch: { full_name: '_system_removed_田中' },
        eq: [
          ['id', 'profile-1'],
          ['customer_id', 'biz-1'],
        ],
      },
    ])
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(updateUserById).toHaveBeenCalledWith('profile-1', { ban_duration: '876000h' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.remove',
      target_id: 'profile-1',
      detail: { synqed_staff_id: 'synqed-resolved', profile_neutralised: true, account_banned: true },
    })
  })

  it('ban ALONE fails (name move on): removal still succeeds, name still neutralised, account_banned:false, one console.error', async () => {
    profileRow = { id: 'profile-1', full_name: '田中' }
    updateUserById.mockRejectedValueOnce(new Error('auth down'))
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { result, lines } = await removeRow('profile-1')
      expect(result).toBeUndefined()
      expect(profileUpdates).toHaveLength(1)
      expect(profileUpdates[0].patch).toEqual({ full_name: '_system_removed_田中' })
      expect(lines[0]).toMatchObject({ detail: { profile_neutralised: true, account_banned: false } })
      expect(err).toHaveBeenCalledTimes(1)
    } finally {
      err.mockRestore()
    }
  })

  it('a ban answered as { error } counts as not banned too', async () => {
    profileRow = { id: 'profile-1', full_name: '田中' }
    updateUserById.mockResolvedValueOnce({ error: { message: 'nope' } })
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { lines } = await removeRow('profile-1')
      expect(lines[0]).toMatchObject({ detail: { profile_neutralised: true, account_banned: false } })
    } finally {
      err.mockRestore()
    }
  })

  it('name move ALONE fails (ban on): removal still succeeds, account still banned, profile_neutralised:false', async () => {
    profileRow = { id: 'profile-1', full_name: '田中' }
    profileUpdateError = { message: 'db down' }
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { result, lines } = await removeRow('profile-1')
      expect(result).toBeUndefined()
      expect(updateUserById).toHaveBeenCalledWith('profile-1', { ban_duration: '876000h' })
      expect(lines[0]).toMatchObject({ detail: { profile_neutralised: false, account_banned: true } })
      expect(err).toHaveBeenCalledTimes(1)
    } finally {
      err.mockRestore()
    }
  })

  it('profile-less id (pure synqed id): no profiles update, no ban, both flags false', async () => {
    profileRow = null
    const { result, lines } = await removeRow('synqed-abc')
    expect(result).toBeUndefined()
    expect(profileUpdates).toHaveLength(0)
    expect(updateUserById).not.toHaveBeenCalled()
    expect(lines[0]).toMatchObject({
      detail: { synqed_staff_id: 'synqed-abc', profile_neutralised: false, account_banned: false },
    })
  })

  it('the 400 guard: message returned, NO profile update, NO ban, NO audit', async () => {
    profileRow = { id: 'profile-1', full_name: '田中' }
    staffDelete.mockRejectedValue(new SynqedError(400, 'Cannot delete the last staff member.'))
    const { result, lines } = await removeRow('profile-1')
    expect(result).toEqual({ error: 'Cannot delete the last staff member.' })
    expect(profileUpdates).toHaveLength(0)
    expect(updateUserById).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('idempotent: an already-_system_ name is not double-prefixed (the ban is still asserted)', async () => {
    profileRow = { id: 'profile-1', full_name: '_system_removed_田中' }
    const { result, lines } = await removeRow('profile-1')
    expect(result).toBeUndefined()
    expect(profileUpdates).toHaveLength(0)
    expect(updateUserById).toHaveBeenCalledWith('profile-1', { ban_duration: '876000h' })
    expect(lines[0]).toMatchObject({ detail: { profile_neutralised: true, account_banned: true } })
  })
})

export {}
