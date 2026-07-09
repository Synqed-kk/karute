/**
 * cancelAppointment — sets a booking to CANCELLED, gated by bookings.manage,
 * and never touches tickets (a no-show penalty burn is a separate, explicit
 * flow). The durability caveat (QR re-sync forces SCHEDULED back until core
 * lets a staff terminal status win) lives in the action's doc comment; here we
 * pin the app-side contract: right capability, right status, clean denial.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
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

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: null })),
}))
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => null) }))
jest.mock('@/lib/synqed/staff-map', () => ({ resolveSynqedStaffId: jest.fn(async (id: string) => id) }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerList: jest.fn(async () => []) }))

const requireCapability = jest.fn(async (_cap: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (cap: string) => requireCapability(cap),
  can: jest.fn(async () => true),
}))

const apptUpdate = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ appointments: { update: apptUpdate } })),
}))

import { cancelAppointment, restoreAppointment } from '@/actions/appointments'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  apptUpdate.mockImplementation(async () => ({}))
})

describe('cancelAppointment', () => {
  it('requires bookings.manage and sets status CANCELLED', async () => {
    const res = await cancelAppointment('appt-1')
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { status: 'CANCELLED' })
    expect(res).toEqual({ success: true })
  })

  it('never sends any ticket / redemption field — cancellation is ticket-neutral', async () => {
    await cancelAppointment('appt-1')
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch)).toEqual(['status'])
  })

  it('denies cleanly when the capability check throws — no update, house error shape', async () => {
    requireCapability.mockRejectedValueOnce(new Error('You do not have permission to manage bookings.'))
    const res = await cancelAppointment('appt-1')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: 'You do not have permission to manage bookings.' })
  })
})

describe('restoreAppointment (undo)', () => {
  it('requires bookings.manage and sets status back to SCHEDULED', async () => {
    const res = await restoreAppointment('appt-1')
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { status: 'SCHEDULED' })
    expect(res).toEqual({ success: true })
  })

  it('denies cleanly without touching the booking', async () => {
    requireCapability.mockRejectedValueOnce(new Error('Not allowed'))
    const res = await restoreAppointment('appt-1')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: 'Not allowed' })
  })
})
