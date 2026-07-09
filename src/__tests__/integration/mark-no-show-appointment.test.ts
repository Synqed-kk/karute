/**
 * markNoShowAppointment — sets a booking to NO_SHOW (synqed-core #39), gated
 * by bookings.manage, with an optional pack burn. Mirrors
 * cancel-appointment.test.ts's mocking pattern: this test pins the app-side
 * contract (right capability, right patch shape, right burn call, stable
 * error discriminators) — not core's behavior.
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
const apptGet = jest.fn(async () => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  status: 'SCHEDULED',
  starts_at: '2026-07-06T03:00:00.000Z',
}))
const listRecentRedemptions = jest.fn(
  async (_since: string): Promise<Array<{ customer_id: string; appointment_id: string | null; redeemed_on: string }>> => [],
)
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    appointments: { update: apptUpdate, get: apptGet },
    packs: { listRecentRedemptions: (since: string) => listRecentRedemptions(since) },
  })),
}))

const listCustomerPacks = jest.fn(async (_id: string): Promise<unknown[]> => [])
const addRedemption = jest.fn(
  async (_input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ({
    ok: true,
    id: 'redemption-1',
  }),
)
jest.mock('@/lib/packs/store', () => ({
  listCustomerPacks: (id: string) => listCustomerPacks(id),
  addRedemption: (input: unknown) => addRedemption(input),
}))

import { markNoShowAppointment, getBurnablePackSummary } from '@/actions/appointments'

const BURNABLE_PACK = {
  id: 'pack-1',
  kind: 'pack',
  status: 'active',
  remaining: 3,
  purchased_at: '2026-01-01',
}

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  apptUpdate.mockImplementation(async () => ({}))
  apptGet.mockImplementation(async () => ({
    id: 'appt-1',
    customer_id: 'cust-1',
    status: 'SCHEDULED',
    starts_at: '2026-07-06T03:00:00.000Z',
  }))
  listCustomerPacks.mockImplementation(async () => [])
  addRedemption.mockImplementation(async () => ({ ok: true, id: 'redemption-1' }))
  listRecentRedemptions.mockImplementation(async () => [])
})

describe('markNoShowAppointment — no-burn path', () => {
  it('requires bookings.manage and sends exactly status + status_reason + acting_staff_id', async () => {
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: false })
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', {
      status: 'NO_SHOW',
      status_reason: 'no-show-no-contact',
      acting_staff_id: 'staff-1',
    })
    expect(res).toEqual({ success: true })
  })

  it('omits acting_staff_id entirely when there is no resolvable staff identity', async () => {
    getCurrentUserStaffId.mockResolvedValueOnce(null)
    await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: false })
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch).sort()).toEqual(['status', 'status_reason'])
  })

  it('never calls the pack machinery when burnPack is false', async () => {
    await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: false })
    expect(listCustomerPacks).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('denies cleanly when the capability check throws — no update, house error shape', async () => {
    requireCapability.mockRejectedValueOnce(new Error('You do not have permission to manage bookings.'))
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: false })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: 'You do not have permission to manage bookings.' })
  })
})

describe('markNoShowAppointment — burn path', () => {
  it('burns the FIFO-picked pack with counts_as_visit:false and this appointment_id', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: true })
    expect(addRedemption).toHaveBeenCalledWith(
      expect.objectContaining({
        packId: 'pack-1',
        customerId: 'cust-1',
        appointmentId: 'appt-1',
        countsAsVisit: false,
        redeemedOn: '2026-07-06',
      }),
    )
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', expect.objectContaining({ status: 'NO_SHOW' }))
    expect(res).toEqual({ success: true })
  })

  it('errors when the customer has no burnable pack — does not silently skip the burn', async () => {
    listCustomerPacks.mockResolvedValueOnce([])
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: true })
    expect(res).toEqual({ error: expect.any(String), code: 'no_burnable_pack' })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('marks the status BEFORE burning — a failed burn can never strand a spent ticket', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: true })
    const updateOrder = apptUpdate.mock.invocationCallOrder[0]
    const burnOrder = addRedemption.mock.invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(burnOrder)
  })

  it('reports a below_zero burn failure as partial success — no-show recorded, ticket not consumed', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    addRedemption.mockResolvedValueOnce({ ok: false, error: 'below_zero' })
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: true })
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', expect.objectContaining({ status: 'NO_SHOW' }))
    expect(res).toEqual({ success: true, burnError: 'below_zero' })
  })

  it('refuses an already-terminal booking — a double-open race must not double-burn', async () => {
    apptGet.mockResolvedValueOnce({
      id: 'appt-1',
      customer_id: 'cust-1',
      status: 'NO_SHOW',
      starts_at: '2026-07-06T03:00:00.000Z',
    })
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: true })
    expect(res).toEqual({ error: expect.any(String), code: 'already_terminal' })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('rejects a reason outside the fixed codes — the audit trail is not a free-text field', async () => {
    const res = await markNoShowAppointment('appt-1', { reason: 'because', burnPack: false })
    expect(res).toEqual({ error: expect.any(String) })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('one appointment burns ONE ticket ever — a restore → re-mark cycle must not double-burn', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    // An earlier no-show already burned a redemption linked to this booking.
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-07-06' },
    ])
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: true })
    // Status IS re-marked (the booking really is a no-show again)…
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', expect.objectContaining({ status: 'NO_SHOW' }))
    // …but the ticket is NOT burned a second time, and staff hear why.
    expect(addRedemption).not.toHaveBeenCalled()
    expect(res).toEqual({ success: true, burnError: 'already_burned' })
  })

  it('a redemption on a DIFFERENT appointment does not block this burn', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-OTHER', redeemed_on: '2026-07-06' },
    ])
    const res = await markNoShowAppointment('appt-1', { reason: 'no-show-no-contact', burnPack: true })
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ success: true })
  })
})

describe('getBurnablePackSummary', () => {
  it('returns the FIFO pack id + remaining when a burnable pack exists', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    expect(await getBurnablePackSummary('cust-1')).toEqual({ packId: 'pack-1', remaining: 3 })
  })

  it('returns null when the customer has no burnable pack', async () => {
    listCustomerPacks.mockResolvedValueOnce([])
    expect(await getBurnablePackSummary('cust-1')).toBeNull()
  })

  it('is capability-gated — pack balances are not probeable without bookings.manage', async () => {
    requireCapability.mockRejectedValueOnce(new Error('no permission'))
    expect(await getBurnablePackSummary('cust-1')).toBeNull()
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(listCustomerPacks).not.toHaveBeenCalled()
  })
})
