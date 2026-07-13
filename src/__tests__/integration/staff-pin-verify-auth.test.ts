/**
 * verifyStaffPin authorization gate (packet 03 ROUTE-TO-BUILDER 4). The throttle
 * previously fell back to a shared 'anon' actor bucket for an unauthenticated
 * caller, so one unauthenticated caller could exhaust another's attempt budget
 * for the same staffId. verifyStaffPin is only reachable AFTER login (profile
 * switch on a shared, signed-in device), so it now refuses an unauthenticated
 * caller outright (like setPin/removePin) and the throttle only ever keys a real
 * actor id.
 */
const getCurrentUserStaffId = jest.fn<Promise<string | null>, []>()
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: () => getCurrentUserStaffId() }))

const verifyPin = jest.fn(async () => ({ valid: true, no_pin: false }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ staff: { verifyPin } })),
}))

const checkPinThrottle = jest.fn(() => ({ allowed: true }))
const recordPinFailure = jest.fn()
const recordPinSuccess = jest.fn()
jest.mock('@/lib/auth/pin-throttle', () => ({
  checkPinThrottle: (...a: unknown[]) => checkPinThrottle(...(a as [])),
  recordPinFailure: (...a: unknown[]) => recordPinFailure(...(a as [])),
  recordPinSuccess: (...a: unknown[]) => recordPinSuccess(...(a as [])),
}))

jest.mock('next/cache', () => ({ updateTag: jest.fn() }))

import { verifyStaffPin } from '@/actions/staff-pin'

beforeEach(() => jest.clearAllMocks())

describe('verifyStaffPin — authorization gate', () => {
  it('unauthenticated caller: refused WITHOUT touching the throttle or core (no shared bucket)', async () => {
    getCurrentUserStaffId.mockResolvedValue(null)
    await expect(verifyStaffPin('target-staff', '1234')).resolves.toEqual({
      valid: false,
      error: 'Not authorized to verify a PIN',
    })
    expect(checkPinThrottle).not.toHaveBeenCalled()
    expect(verifyPin).not.toHaveBeenCalled()
  })

  it('authenticated caller: throttle is keyed by the real actor id, then verifies', async () => {
    getCurrentUserStaffId.mockResolvedValue('actor-1')
    await expect(verifyStaffPin('target-staff', '1234')).resolves.toEqual({ valid: true })
    expect(checkPinThrottle).toHaveBeenCalledWith('actor-1', 'target-staff')
    expect(verifyPin).toHaveBeenCalledWith('target-staff', '1234')
    expect(recordPinSuccess).toHaveBeenCalledWith('actor-1', 'target-staff')
  })
})

export {}
