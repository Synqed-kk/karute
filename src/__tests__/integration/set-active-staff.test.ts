jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/staff', () => ({
  getStaffList: jest.fn(async () => []),
}))

const cookieSet = jest.fn()
const cookieDelete = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: jest.fn(), set: cookieSet, delete: cookieDelete })),
}))

const verifyStaffPin = jest.fn()
jest.mock('@/actions/staff-pin', () => ({ verifyStaffPin: (...a: unknown[]) => verifyStaffPin(...a) }))

import { setActiveStaff, clearActiveStaff } from '@/actions/active-staff'

beforeEach(() => jest.clearAllMocks())

describe('setActiveStaff', () => {
  it('sets the cookie when the PIN is valid', async () => {
    verifyStaffPin.mockResolvedValue({ valid: true })
    const result = await setActiveStaff('staff-a', '1234')
    expect(result).toEqual({ ok: true })
    expect(cookieSet).toHaveBeenCalledWith(
      'active_staff_id',
      'staff-a',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      }),
    )
  })

  it('does NOT set the cookie when the PIN is invalid', async () => {
    verifyStaffPin.mockResolvedValue({ valid: false })
    const result = await setActiveStaff('staff-a', '0000')
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/incorrect pin/i) })
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it('surfaces the verifier error message when present', async () => {
    verifyStaffPin.mockResolvedValue({ valid: false, error: 'Staff not found' })
    const result = await setActiveStaff('ghost', '0000')
    expect(result).toEqual({ ok: false, error: 'Staff not found' })
    expect(cookieSet).not.toHaveBeenCalled()
  })
})

describe('clearActiveStaff', () => {
  it('deletes the cookie', async () => {
    await clearActiveStaff()
    expect(cookieDelete).toHaveBeenCalledWith('active_staff_id')
  })
})
