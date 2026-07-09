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
  listCustomerPacks.mockImplementation(async () => [])
  addRedemption.mockImplementation(async () => ({ ok: true, id: 'redemption-1' }))
  listRecentRedemptions.mockImplementation(async () => [])
})

const BURNABLE_PACK = {
  id: 'pack-1',
  kind: 'pack',
  status: 'active',
  remaining: 3,
  purchased_at: '2026-01-01',
}

/** The burn path reads the booking first — give it a LIVE one (the default
 *  apptGet above returns CANCELLED for the restore tests). */
const liveBooking = () =>
  apptGet.mockImplementation(async () => ({
    id: 'appt-1',
    customer_id: 'cust-1',
    status: 'SCHEDULED',
    starts_at: '2026-07-06T03:00:00.000Z',
  }))

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
  // PR. Still ticket-neutral (no burn/redemption field ever sent).
  it('never sends any ticket / redemption field — cancellation is ticket-neutral', async () => {
    await cancelAppointment('appt-1')
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch).sort()).toEqual(['acting_staff_id', 'status'])
  })

  // Taxonomy fix 2026-07-10: optional reason chips on the CANCEL side (a
  // cancel implies contact — the chips record how). Fixed vocabulary only.
  it('sends status_reason when a valid cancel reason is chosen', async () => {
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact' })
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', {
      status: 'CANCELLED',
      status_reason: 'cancel-same-day-contact',
      acting_staff_id: 'staff-1',
    })
    expect(res).toEqual({ success: true })
  })

  it('accepts every fixed cancel reason', async () => {
    for (const reason of ['cancel-advance-contact', 'cancel-same-day-contact', 'cancel-salon-initiated']) {
      const res = await cancelAppointment('appt-1', { reason })
      expect(res).toEqual({ success: true })
    }
    expect(apptUpdate).toHaveBeenCalledTimes(3)
  })

  it('rejects a reason outside the fixed codes — the audit trail is not a free-text field', async () => {
    const res = await cancelAppointment('appt-1', { reason: 'because' })
    expect(res).toEqual({ error: expect.any(String) })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('legacy no-show chip codes are NOT valid cancel reasons', async () => {
    const res = await cancelAppointment('appt-1', { reason: 'same-day-contacted' })
    expect(res).toEqual({ error: expect.any(String) })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('denies cleanly when the capability check throws — no update, house error shape', async () => {
    requireCapability.mockRejectedValueOnce(new Error('You do not have permission to manage bookings.'))
    const res = await cancelAppointment('appt-1')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: 'You do not have permission to manage bookings.' })
  })
})

// Burn-on-cancel (Liam 2026-07-10): staff MAY consume a ticket on a
// SAME-DAY-CONTACT cancel. Same guarded machinery as the no-show burn
// (executeGuardedBurn is shared), so the money rules are pinned here too.
describe('cancelAppointment — burn on same-day-contact', () => {
  it('burn REQUIRES the same-day reason — any other pairing is refused before any write', async () => {
    for (const reason of [undefined, 'cancel-advance-contact', 'cancel-salon-initiated']) {
      const res = await cancelAppointment('appt-1', { reason, burnPack: true })
      expect(res).toEqual({ error: expect.any(String) })
    }
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('burns the FIFO-picked pack with counts_as_visit:false and this appointment_id', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
    expect(apptUpdate).toHaveBeenCalledWith(
      'appt-1',
      expect.objectContaining({ status: 'CANCELLED', status_reason: 'cancel-same-day-contact' }),
    )
    expect(addRedemption).toHaveBeenCalledWith(
      expect.objectContaining({
        packId: 'pack-1',
        customerId: 'cust-1',
        appointmentId: 'appt-1',
        countsAsVisit: false,
        redeemedOn: '2026-07-06',
      }),
    )
    expect(res).toEqual({ success: true })
  })

  it('errors when the customer has no burnable pack — does not silently skip the burn', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([])
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
    expect(res).toEqual({ error: expect.any(String), code: 'no_burnable_pack' })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('refuses an already-terminal booking on the burn path — a stale sheet must not double-burn', async () => {
    // default apptGet is CANCELLED
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
    expect(res).toEqual({ error: expect.any(String), code: 'already_terminal' })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('cancels BEFORE burning — a failed burn can never strand a spent ticket', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
    expect(apptUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      addRedemption.mock.invocationCallOrder[0],
    )
  })

  it('reports a below_zero burn failure as partial success — cancel recorded, ticket not consumed', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    addRedemption.mockResolvedValueOnce({ ok: false, error: 'below_zero' })
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', expect.objectContaining({ status: 'CANCELLED' }))
    expect(res).toEqual({ success: true, burnError: 'below_zero' })
  })

  it('one appointment burns ONE ticket ever — cancel after an earlier no-show burn must not re-burn', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-07-06' },
    ])
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
    expect(addRedemption).not.toHaveBeenCalled()
    expect(res).toEqual({ success: true, burnError: 'already_burned' })
  })

  it('an ERRORED burn-history read fails CLOSED — no burn, partial outcome reported', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    listRecentRedemptions.mockRejectedValueOnce(new Error('core down'))
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
    expect(addRedemption).not.toHaveBeenCalled()
    expect(res).toEqual({ success: true, burnError: 'burn_failed' })
  })

  it('plain cancel (no burnPack) never reads the booking or touches packs — unchanged contract', async () => {
    await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact' })
    expect(apptGet).not.toHaveBeenCalled()
    expect(listCustomerPacks).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
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
