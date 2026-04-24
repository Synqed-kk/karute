/**
 * Post-migration staff + staff-pin actions. Mocks @synqed-kk/client and verifies:
 *   - createStaff / updateStaff pass the right fields through
 *   - deleteStaff surfaces server 400 messages as user errors
 *   - deleteStaff auto-switches active_staff_id cookie when needed
 *   - uploadStaffAvatar forwards the File
 *   - PIN round-trip: set → hasPin true → verify valid → remove → hasPin false
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

const cookieStore = { set: jest.fn() }
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => cookieStore),
}))

const getActiveStaffId = jest.fn(async () => 'staff-1')
jest.mock('@/lib/staff', () => ({
  getTenantId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getActiveStaffId: () => getActiveStaffId(),
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
    getActiveStaffId.mockResolvedValue('staff-1')
  })

  it('createStaff passes name + email through', async () => {
    staff.create.mockResolvedValue({ id: 'staff-2' })

    await createStaff({ name: 'Ada', email: 'ada@example.com', position: '', phone: '' })

    expect(staff.create).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
    })
  })

  it('updateStaff passes name + email', async () => {
    staff.update.mockResolvedValue({ id: 'staff-1' })

    await updateStaff('staff-1', { name: 'Ada Lovelace', email: 'ada@ex.com', position: '', phone: '' })

    expect(staff.update).toHaveBeenCalledWith('staff-1', {
      name: 'Ada Lovelace',
      email: 'ada@ex.com',
    })
  })

  it('deleteStaff surfaces server 400 messages as user errors', async () => {
    staff.delete.mockRejectedValue(new SynqedError(400, 'Cannot delete the last staff member.'))

    await expect(deleteStaff('staff-1')).rejects.toThrow('Cannot delete the last staff member.')
  })

  it('deleteStaff auto-switches active staff cookie on self-delete', async () => {
    staff.delete.mockResolvedValue(undefined)
    // Active staff matches the one being deleted
    getActiveStaffId.mockResolvedValueOnce('staff-1')
    staff.list.mockResolvedValue({ staff: [{ id: 'staff-2', name: 'Other' }] })

    await deleteStaff('staff-1')

    expect(cookieStore.set).toHaveBeenCalledWith(
      'active_staff_id',
      'staff-2',
      expect.objectContaining({ path: '/' }),
    )
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
