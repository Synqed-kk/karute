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

const lookupSynqedStaffId = jest.fn(
  async (_id: string): Promise<string | null> => 'synqed-resolved',
)
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupSynqedStaffId: (id: string) => lookupSynqedStaffId(id),
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
let profileRow: { id: string } | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({
      data: profileRow,
    })
    return { from: () => builder }
  },
}))

import { deleteStaff } from '@/actions/staff'

beforeEach(() => {
  jest.clearAllMocks()
  profileRow = null
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

export {}
