/**
 * Coverage for deleteStaff's id-namespace handling (fix/staff-delete-id-mismatch).
 *
 * The roster lists profile-backed staff keyed by profiles.id, but
 * synqed.staff.delete's keyspace is the synqed staff.id. Passing a profiles.id
 * straight through 404'd ("Staff not found") and rethrew into a Server
 * Components crash on /settings. This suite proves deleteStaff now:
 *   - resolves a profiles.id → synqed staff.id (via the shared resolver) before
 *     deleting,
 *   - passes a synqed-only id (no matching profile row) through unchanged,
 *   - preserves the 400 guard (last-member / attributed-records) as a thrown
 *     message the client toasts,
 *   - treats a 404 as already-gone (revalidate + resolve, never crash),
 *   - rethrows other SDK errors untouched,
 *   - still enforces requireCapability('staff.manage').
 *
 * Collaborators are mocked directly (mirrors save-flow-staff-attribution's
 * "mock the deps, drive the action" style) so the test pins deleteStaff's own
 * branching rather than the resolver internals (covered by synqed-staff-map).
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

const requireCapability = jest.fn(async (_cap: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (cap: string) => requireCapability(cap),
}))

const resolveSynqedStaffId = jest.fn(async (_id: string) => 'synqed-resolved')
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: (id: string) => resolveSynqedStaffId(id),
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
  resolveSynqedStaffId.mockImplementation(async () => 'synqed-resolved')
  staffDelete.mockImplementation(async () => {})
})

describe('deleteStaff — id resolution', () => {
  it('resolves a profiles.id to the synqed staff id before deleting', async () => {
    profileRow = { id: 'profile-1' }
    await deleteStaff('profile-1')
    expect(resolveSynqedStaffId).toHaveBeenCalledWith('profile-1')
    expect(staffDelete).toHaveBeenCalledWith('synqed-resolved')
  })

  it('passes a synqed-only id (no profile row) straight through', async () => {
    profileRow = null
    await deleteStaff('synqed-abc')
    expect(resolveSynqedStaffId).not.toHaveBeenCalled()
    expect(staffDelete).toHaveBeenCalledWith('synqed-abc')
  })
})

describe('deleteStaff — error handling', () => {
  it('rethrows a 400 guard as a plain Error message the client toasts', async () => {
    staffDelete.mockRejectedValue(
      new SynqedError(400, 'Cannot delete the last staff member.'),
    )
    await expect(deleteStaff('synqed-abc')).rejects.toThrow(
      'Cannot delete the last staff member.',
    )
  })

  it('treats a 404 as already-gone: no throw, roster revalidated', async () => {
    const { revalidatePath, updateTag } = jest.requireMock('next/cache')
    staffDelete.mockRejectedValue(new SynqedError(404, 'Staff not found'))
    await expect(deleteStaff('synqed-abc')).resolves.toBeUndefined()
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(updateTag).toHaveBeenCalledWith('staff-list')
  })

  it('rethrows other SDK errors (e.g. 500) untouched', async () => {
    const boom = new SynqedError(500, 'Internal error')
    staffDelete.mockRejectedValue(boom)
    await expect(deleteStaff('synqed-abc')).rejects.toBe(boom)
  })
})

describe('deleteStaff — authorization', () => {
  it('enforces the staff.manage capability and never deletes when it throws', async () => {
    requireCapability.mockRejectedValue(
      new Error('You do not have permission to perform this action.'),
    )
    await expect(deleteStaff('synqed-abc')).rejects.toThrow(/permission/)
    expect(staffDelete).not.toHaveBeenCalled()
  })
})

export {}
