/**
 * Post-migration staff + staff-pin actions. Mocks @synqed-kk/client and verifies:
 *   - createStaff / updateStaff pass the right fields through
 *   - deleteStaff surfaces server 400 messages as user errors
 *   - uploadStaffAvatar forwards the File
 *   - PIN round-trip: set → hasPin true → verify valid → remove → hasPin false
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn() }))

const getCurrentUserStaffId = jest.fn(async () => 'staff-1')
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
}))

jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  return { SynqedError }
})

const staff = {
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  list: jest.fn(),
  setPin: jest.fn(),
  removePin: jest.fn(),
  verifyPin: jest.fn(),
  hasPin: jest.fn(),
  uploadAvatar: jest.fn(),
}

jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ staff })),
}))

// Configurable Supabase service-client mock. updateStaff now branches on
// whether the id is a profile-backed staff (→ Supabase profiles update) or a
// synqed-only staff (→ synqed client). Tests set these to drive each branch.
let profileLookupResult: { data: unknown; error: unknown } = { data: null, error: null }
let profileUpdateResult: { error: unknown } = { error: null }
const supabaseChain: Record<string, unknown> = {
  select: jest.fn(() => supabaseChain),
  update: jest.fn(() => supabaseChain),
  eq: jest.fn(() => supabaseChain),
  maybeSingle: jest.fn(async () => profileLookupResult),
  // Thenable so `await ...update().eq().eq()` resolves to profileUpdateResult.
  then: (resolve: (v: unknown) => void) => resolve(profileUpdateResult),
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: jest.fn(() => supabaseChain) })),
}))

import { createStaff, updateStaff, deleteStaff, uploadStaffAvatar } from '@/actions/staff'
import {
  setStaffPin,
  removeStaffPin,
  verifyStaffPin,
  hasStaffPin,
} from '@/actions/staff-pin'
import { SynqedError } from '@synqed-kk/client'

describe('Migrated staff actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getCurrentUserStaffId.mockResolvedValue('staff-1')
    profileLookupResult = { data: null, error: null }
    profileUpdateResult = { error: null }
  })

  it('createStaff passes name + email + user_id through', async () => {
    staff.create.mockResolvedValue({ id: 'staff-2' })

    await createStaff({ name: 'Ada', email: 'ada@example.com', position: '', phone: '' })

    // user_id is best-effort: createStaff looks up an existing auth profile by
    // email so synqed.staff is seeded with the link from day one. When no
    // matching profile exists the field is null and the resolver self-heals
    // later in src/lib/synqed/staff-map.ts.
    expect(staff.create).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      user_id: null,
    })
  })

  it('updateStaff on a profile-backed staff updates the profile row, not synqed', async () => {
    // The roster shows profile-backed staff (owner + signed-up teammates)
    // keyed by profiles.id. Editing must hit Supabase profiles — passing the
    // profiles.id to synqed.staff.update is what caused the 500.
    profileLookupResult = { data: { id: 'profile-1' }, error: null }

    await updateStaff('profile-1', { name: 'Liam', email: 'liam@karute.test', position: '', phone: '' })

    expect(supabaseChain.update).toHaveBeenCalledWith({ full_name: 'Liam', position: null })
    expect(staff.update).not.toHaveBeenCalled()
  })

  it('updateStaff on a synqed-only staff (no profile) routes to the synqed client', async () => {
    // Owner-created teammates who haven't signed up have no profile row yet;
    // their id is a synqed staff id, so the synqed client is correct.
    profileLookupResult = { data: null, error: null }
    staff.update.mockResolvedValue({ id: 'synqed-staff-9' })

    await updateStaff('synqed-staff-9', { name: 'Ada Lovelace', email: 'ada@ex.com', position: '', phone: '' })

    expect(staff.update).toHaveBeenCalledWith('synqed-staff-9', {
      name: 'Ada Lovelace',
      email: 'ada@ex.com',
    })
    expect(supabaseChain.update).not.toHaveBeenCalled()
  })

  it('deleteStaff surfaces server 400 messages as user errors', async () => {
    staff.delete.mockRejectedValue(new SynqedError(400, 'Cannot delete the last staff member.'))

    await expect(deleteStaff('staff-1')).rejects.toThrow('Cannot delete the last staff member.')
  })

  it('uploadStaffAvatar forwards the File and returns the url', async () => {
    staff.uploadAvatar.mockResolvedValue({ avatar_url: 'https://cdn/avatar.png' })
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' })
    const formData = new FormData()
    formData.append('file', file)

    const result = await uploadStaffAvatar('staff-1', formData)

    expect(result).toEqual({ url: 'https://cdn/avatar.png' })
    expect(staff.uploadAvatar).toHaveBeenCalledWith('staff-1', expect.any(File))
  })

  describe('PIN round-trip', () => {
    it('set → hasPin true → verify valid → remove → hasPin false', async () => {
      staff.setPin.mockResolvedValue(undefined)
      staff.hasPin.mockResolvedValueOnce({ has_pin: true }).mockResolvedValueOnce({ has_pin: false })
      staff.verifyPin.mockResolvedValue({ valid: true })
      staff.removePin.mockResolvedValue(undefined)

      const setResult = await setStaffPin('staff-1', '4321')
      expect(setResult).toEqual({})
      expect(staff.setPin).toHaveBeenCalledWith('staff-1', '4321')

      expect(await hasStaffPin('staff-1')).toBe(true)

      expect(await verifyStaffPin('staff-1', '4321')).toEqual({ valid: true })

      const removeResult = await removeStaffPin('staff-1')
      expect(removeResult).toEqual({})

      expect(await hasStaffPin('staff-1')).toBe(false)
    })

    it('setStaffPin rejects non-4-digit PINs without touching the client', async () => {
      const result = await setStaffPin('staff-1', '12')
      expect(result).toEqual({ error: 'PIN must be exactly 4 digits' })
      expect(staff.setPin).not.toHaveBeenCalled()
    })

    it('verifyStaffPin maps no_pin → noPin', async () => {
      staff.verifyPin.mockResolvedValue({ valid: true, no_pin: true })
      expect(await verifyStaffPin('staff-1', '0000')).toEqual({ valid: true, noPin: true })
    })
  })
})
