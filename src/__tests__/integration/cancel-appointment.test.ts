/**
 * cancelAppointment — sets a booking to CANCELLED, gated by bookings.manage,
 * and never touches tickets (a no-show penalty burn is a separate, explicit
 * flow). The durability caveat (QR re-sync forces SCHEDULED back until core
 * lets a staff terminal status win) lives in the action's doc comment; here we
 * pin the app-side contract: right capability, right status, clean denial,
 * and (synqed-core #39) acting_staff_id stamped on the patch — mirrors
 * mark-no-show-appointment.test.ts's acting_staff_id coverage.
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

const getCurrentUserStaffId = jest.fn(async (): Promise<string | null> => 'staff-1')
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: () => getCurrentUserStaffId() }))

const apptUpdate = jest.fn(async () => ({}))
// restoreAppointment reads the booking first: only a terminal row restores
// (a stale tombstone sheet must not clobber a re-activated booking).
const apptGet = jest.fn(async () => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  status: 'CANCELLED',
  starts_at: '2026-07-06T03:00:00.000Z',
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ appointments: { update: apptUpdate, get: apptGet } })),
}))

import { cancelAppointment, restoreAppointment } from '@/actions/appointments'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  apptUpdate.mockImplementation(async () => ({}))
  apptGet.mockImplementation(async () => ({
    id: 'appt-1',
    customer_id: 'cust-1',
    status: 'CANCELLED',
    starts_at: '2026-07-06T03:00:00.000Z',
  }))
})

describe('cancelAppointment', () => {
  it('requires bookings.manage and sends exactly status + acting_staff_id when staff resolves', async () => {
    const res = await cancelAppointment('appt-1')
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', {
      status: 'CANCELLED',
      acting_staff_id: 'staff-1',
    })
    expect(res).toEqual({ success: true })
  })

  it('omits acting_staff_id entirely when there is no resolvable staff identity', async () => {
    getCurrentUserStaffId.mockResolvedValueOnce(null)
    await cancelAppointment('appt-1')
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch)).toEqual(['status'])
  })

  // Updated deliberately (synqed-core #39): a plain cancel now stamps
  // acting_staff_id so status_set_by is populated — that's the point of this
  // PR. No reason field on a plain cancel; still ticket-neutral (no burn/
  // redemption field ever sent).
  it('never sends any ticket / redemption field — cancellation is ticket-neutral', async () => {
    await cancelAppointment('appt-1')
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch).sort()).toEqual(['acting_staff_id', 'status'])
  })

  it('denies cleanly when the capability check throws — no update, house error shape', async () => {
    requireCapability.mockRejectedValueOnce(new Error('You do not have permission to manage bookings.'))
    const res = await cancelAppointment('appt-1')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: 'You do not have permission to manage bookings.' })
  })
})

describe('restoreAppointment (undo)', () => {
  it('requires bookings.manage and sends exactly status + acting_staff_id when staff resolves', async () => {
    const res = await restoreAppointment('appt-1')
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', {
      status: 'SCHEDULED',
      acting_staff_id: 'staff-1',
    })
    expect(res).toEqual({ success: true })
  })

  it('omits acting_staff_id entirely when there is no resolvable staff identity', async () => {
    getCurrentUserStaffId.mockResolvedValueOnce(null)
    await restoreAppointment('appt-1')
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch)).toEqual(['status'])
  })

  it('denies cleanly without touching the booking', async () => {
    requireCapability.mockRejectedValueOnce(new Error('Not allowed'))
    const res = await restoreAppointment('appt-1')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: 'Not allowed' })
  })

  it('refuses to restore a booking that is not terminal — a stale sheet must not clobber live state', async () => {
    apptGet.mockResolvedValueOnce({
      id: 'appt-1',
      customer_id: 'cust-1',
      status: 'IN_PROGRESS',
      starts_at: '2026-07-06T03:00:00.000Z',
    })
    const res = await restoreAppointment('appt-1')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: expect.any(String) })
  })
})
