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
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
  // Audit identity seam (resolveWebAuditContext, @/lib/audit-web) — booking
  // mutations now emit through the shared cores.
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
}))

// update()'s return rides the Appointment shape (customer_id/store_id) —
// the shared core reads the audit row's target off it directly rather than
// re-fetching the booking. title/notes are PII-bait decoys (Fable fix-round
// FIX 7b): the audit describe block's exact-toEqual detail assertions must
// fail the moment either leaks into detail.
const apptUpdate = jest.fn(async () => ({
  customer_id: 'cust-1',
  store_id: 'store-1',
  title: 'DECOY — must never reach detail',
  notes: 'DECOY — must never reach detail',
}))
// restoreAppointment reads the booking first: only a terminal row restores
// (a stale tombstone sheet must not clobber a re-activated booking).
// cancelAppointmentCore now reads the booking on EVERY path (Fable fix-round
// FIX 3) — this default stays a TERMINAL row (CANCELLED) since restore's
// happy path and the burn-path terminal-refusal test both want that; plain
// cancel tests that need a LIVE row call liveBooking() explicitly below.
// created_at (Fable fix-round FIX 1): the burn dedup window now anchors to
// min(starts_at, created_at) — set equal to starts_at here so every existing
// burn-window computation is UNCHANGED; only the dedicated regression test
// below sets them apart on purpose.
const apptGet = jest.fn(async () => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  store_id: 'store-1',
  status: 'CANCELLED',
  starts_at: '2026-07-06T03:00:00.000Z',
  created_at: '2026-07-06T03:00:00.000Z',
  title: 'DECOY — must never reach detail',
  notes: 'DECOY — must never reach detail',
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
  // The P-B 2/2 cores read packs through the WithClient twins — same spies,
  // client arg dropped, so every assertion below pins the identical flow.
  listCustomerPacksWithClient: (_synqed: unknown, id: string) => listCustomerPacks(id),
  addRedemptionWithClient: (_synqed: unknown, input: unknown) => addRedemption(input),
}))

import { cancelAppointment, restoreAppointment } from '@/actions/appointments'
import { auditLines } from './helpers/audit-lines'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  apptUpdate.mockImplementation(async () => ({
    customer_id: 'cust-1',
    store_id: 'store-1',
    title: 'DECOY — must never reach detail',
    notes: 'DECOY — must never reach detail',
  }))
  apptGet.mockImplementation(async () => ({
    id: 'appt-1',
    customer_id: 'cust-1',
    store_id: 'store-1',
    status: 'CANCELLED',
    starts_at: '2026-07-06T03:00:00.000Z',
    created_at: '2026-07-06T03:00:00.000Z',
    title: 'DECOY — must never reach detail',
    notes: 'DECOY — must never reach detail',
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

/** cancelAppointmentCore now reads the booking on EVERY path (Fable fix-round
 *  FIX 3), not just the burn path — give it a LIVE one (the default apptGet
 *  above returns CANCELLED for the restore tests). */
const liveBooking = () =>
  apptGet.mockImplementation(async () => ({
    id: 'appt-1',
    customer_id: 'cust-1',
    store_id: 'store-1',
    status: 'SCHEDULED',
    starts_at: '2026-07-06T03:00:00.000Z',
    created_at: '2026-07-06T03:00:00.000Z',
    title: 'DECOY — must never reach detail',
    notes: 'DECOY — must never reach detail',
  }))

describe('cancelAppointment', () => {
  it('requires bookings.manage and sends exactly status + acting_staff_id when staff resolves', async () => {
    liveBooking()
    const res = await cancelAppointment('appt-1')
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', {
      status: 'CANCELLED',
      acting_staff_id: 'staff-1',
    })
    expect(res).toEqual({ success: true })
  })

  it('omits acting_staff_id entirely when there is no resolvable staff identity', async () => {
    liveBooking()
    getCurrentUserStaffId.mockResolvedValueOnce(null)
    await cancelAppointment('appt-1')
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch)).toEqual(['status'])
  })

  // Updated deliberately (synqed-core #39): a plain cancel now stamps
  // acting_staff_id so status_set_by is populated — that's the point of this
  // PR. Still ticket-neutral (no burn/redemption field ever sent).
  it('never sends any ticket / redemption field — cancellation is ticket-neutral', async () => {
    liveBooking()
    await cancelAppointment('appt-1')
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch).sort()).toEqual(['acting_staff_id', 'status'])
  })

  // Taxonomy fix 2026-07-10: optional reason chips on the CANCEL side (a
  // cancel implies contact — the chips record how). Fixed vocabulary only.
  it('sends status_reason when a valid cancel reason is chosen', async () => {
    liveBooking()
    const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact' })
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', {
      status: 'CANCELLED',
      status_reason: 'cancel-same-day-contact',
      acting_staff_id: 'staff-1',
    })
    expect(res).toEqual({ success: true })
  })

  it('accepts every fixed cancel reason', async () => {
    liveBooking()
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

  // RETIRED (Fable fix-round FIX 3, 2026-07-27): "plain cancel never reads the
  // booking" is no longer the contract — see cancelAppointmentCore's doc
  // comment. Replaced by the two pinned-contract tests below: a plain cancel
  // reads the booking exactly ONCE (never twice, never zero), and an
  // already-terminal plain cancel refuses cleanly with zero audit rows.
  it('plain cancel reads the booking exactly once and never touches packs', async () => {
    liveBooking()
    await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact' })
    expect(apptGet).toHaveBeenCalledTimes(1)
    expect(listCustomerPacks).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('an already-terminal PLAIN cancel refuses with already_terminal — audit truthfulness: a row means a state change happened', async () => {
    // default apptGet is CANCELLED (terminal) — no liveBooking() here.
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact' })
      expect(res).toEqual({ error: expect.any(String), code: 'already_terminal' })
    })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  // Fable fix-round FIX 1 (money): the burn dedup window used to anchor
  // ONLY on the (mutable) starts_at — burn → restore → reschedule FORWARD →
  // re-burn would push the window past an earlier real redemption and
  // double-burn. Anchoring to min(starts_at, created_at) instead closes it:
  // created_at is immutable, so the window still reaches back to the
  // original burn even after the booking moved forward in time.
  it('a booking rescheduled FORWARD past its original burn still catches the earlier redemption (no double-burn)', async () => {
    const ORIGINAL_DATE = '2026-06-01'
    apptGet.mockResolvedValueOnce({
      id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      status: 'SCHEDULED',
      // Rescheduled forward, weeks after the original booking/burn date —
      // starts_at alone would push `since` past ORIGINAL_DATE.
      starts_at: '2026-07-20T03:00:00.000Z',
      created_at: '2026-06-01T00:00:00.000Z',
      title: 'DECOY — must never reach detail',
      notes: 'DECOY — must never reach detail',
    })
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    // The mock IS the proof: it only surfaces the old redemption when asked
    // for a window that actually reaches back far enough. A `since` computed
    // from starts_at alone ('2026-07-19') is too late and gets [] — the old
    // (buggy) window would have missed this row and double-burned.
    listRecentRedemptions.mockImplementationOnce(async (since: string) =>
      since <= ORIGINAL_DATE
        ? [{ customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: ORIGINAL_DATE }]
        : [],
    )
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
      expect(res).toEqual({ success: true, burnError: 'already_burned' })
    })
    expect(addRedemption).not.toHaveBeenCalled()
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toMatchObject({ burn_pack: true, burn_error: 'already_burned' })
  })
})

// Blind-round F4 (2026-08-08) — the cancel twin of the no-show rider at L1#6.
// With 自動消化 on, the cron may already have burned this booking; a plain
// cancel showed a clean success while a ticket was gone, and the settings copy
// promises a cancel never consumes one.
describe('cancelAppointment — 自動消化 correction (blind-round F4)', () => {
  it('tells the staff a ticket was ALREADY spent on a plain (no-burn) cancel', async () => {
    liveBooking()
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-07-06' },
    ])
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1')
      expect(res).toEqual({ success: true, burnError: 'already_burned' })
    })
    // WARN-ONLY: the cancel lands, nothing is unburned (undo is its own action).
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', expect.objectContaining({ status: 'CANCELLED' }))
    expect(addRedemption).not.toHaveBeenCalled()
    // …and the audit row stops saying burn_error:null while a ticket is spent.
    expect(lines[0].detail).toMatchObject({ burn_pack: false, burn_error: 'already_burned' })
  })

  it('stays silent when no prior burn exists — no invented warning', async () => {
    liveBooking()
    const res = await cancelAppointment('appt-1')
    expect(res).toEqual({ success: true })
  })

  it('an unreadable history invents nothing on the no-burn path (no charge either way)', async () => {
    liveBooking()
    listRecentRedemptions.mockRejectedValueOnce(new Error('core down'))
    const res = await cancelAppointment('appt-1')
    expect(res).toEqual({ success: true })
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
      store_id: 'store-1',
      status: 'IN_PROGRESS',
      starts_at: '2026-07-06T03:00:00.000Z',
      created_at: '2026-07-06T03:00:00.000Z',
      title: 'DECOY — must never reach detail',
      notes: 'DECOY — must never reach detail',
    })
    const res = await restoreAppointment('appt-1')
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: expect.any(String) })
  })
})

// Booking mutations now audit (Liam ruling 2026-07-26): exactly one row per
// mutation, emitted from the shared core, ids-only detail, targeting the
// customer. Line-shape assertions (evt/at/actor_type/break_glass) are pinned
// once in facade-audit.test.ts; these pin the booking-specific category,
// action, severity, and detail contract.
describe('cancelAppointment — audit', () => {
  it('emits exactly one booking.cancel row targeting the customer, ids-only detail, severity info for a plain cancel', async () => {
    liveBooking()
    const lines = await auditLines(async () => {
      await cancelAppointment('appt-1')
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.cancel',
      actor_id: 'auth-user-1',
      business_id: 'biz-1',
      target_type: 'customer',
      target_id: 'cust-1',
      severity: 'info',
      source: 'web',
    })
    // Exact equality (not toMatchObject/objectContaining) — a future key
    // leaking a customer name or memo text into detail must fail this test.
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      reason: null,
      burn_pack: false,
      burn_error: null,
    })
  })

  it('carries the cancel reason code in detail and bumps severity to notice on a same-day-contact cancel', async () => {
    liveBooking()
    const lines = await auditLines(async () => {
      await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact' })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      severity: 'notice',
      detail: expect.objectContaining({ reason: 'cancel-same-day-contact', burn_pack: false }),
    })
  })

  it('stays info for the other fixed reason codes (only same-day-contact is consequential)', async () => {
    liveBooking()
    for (const reason of ['cancel-advance-contact', 'cancel-salon-initiated']) {
      const lines = await auditLines(async () => {
        await cancelAppointment('appt-1', { reason })
      })
      expect(lines[0]).toMatchObject({ severity: 'info', detail: expect.objectContaining({ reason }) })
    }
  })

  it('a denied cancel emits no audit row', async () => {
    requireCapability.mockRejectedValueOnce(new Error('nope'))
    const lines = await auditLines(async () => {
      await cancelAppointment('appt-1')
    })
    expect(lines).toHaveLength(0)
  })

  it('a failed write emits no audit row', async () => {
    liveBooking()
    apptUpdate.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1')
      expect(res).toEqual({ error: 'core down' })
    })
    expect(lines).toHaveLength(0)
  })

  // FIX 7d (test armor): the invalid-reason and no-burnable-pack refusals
  // return an error BEFORE any write — pin that they also emit zero audit
  // rows (already-terminal is covered by the dedicated test above).
  it('an invalid cancel reason emits no audit row', async () => {
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1', { reason: 'because' })
      expect(res).toEqual({ error: expect.any(String) })
    })
    expect(lines).toHaveLength(0)
  })

  it('a same-day-contact burn with no burnable pack emits no audit row', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([])
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
      expect(res).toEqual({ error: expect.any(String), code: 'no_burnable_pack' })
    })
    expect(lines).toHaveLength(0)
  })

  // FIX 7a (test armor): the burn SUCCESS state was untested at the exact-
  // detail level — burn_error:null is the "ticket really was consumed" shape,
  // the positive counterpart to the burn_failed case below.
  it('a successful same-day-contact burn carries burn_error:null — the ticket really was consumed', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
      expect(res).toEqual({ success: true })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      reason: 'cancel-same-day-contact',
      burn_pack: true,
      burn_error: null,
    })
  })

  // Fable audit finding (2026-07-27): burn_pack alone is the staff's CHOICE,
  // not the outcome — a failed burn must not read as "ticket consumed".
  it('records burn_pack:true with burn_error set when the redemption fails — the ticket was NOT consumed', async () => {
    liveBooking()
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    addRedemption.mockResolvedValueOnce({ ok: false, error: 'burn_failed' })
    const lines = await auditLines(async () => {
      const res = await cancelAppointment('appt-1', { reason: 'cancel-same-day-contact', burnPack: true })
      expect(res).toEqual({ success: true, burnError: 'burn_failed' })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      reason: 'cancel-same-day-contact',
      burn_pack: true,
      burn_error: 'burn_failed',
    })
  })
})

describe('restoreAppointment — audit', () => {
  it('emits exactly one booking.restore row targeting the customer, ids-only detail', async () => {
    const lines = await auditLines(async () => {
      await restoreAppointment('appt-1')
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.restore',
      actor_id: 'auth-user-1',
      business_id: 'biz-1',
      target_type: 'customer',
      target_id: 'cust-1',
      severity: 'info',
      source: 'web',
    })
    expect(lines[0].detail).toEqual({ appointment_id: 'appt-1', customer_id: 'cust-1', store_id: 'store-1' })
  })

  it('a denied restore emits no audit row', async () => {
    requireCapability.mockRejectedValueOnce(new Error('nope'))
    const lines = await auditLines(async () => {
      await restoreAppointment('appt-1')
    })
    expect(lines).toHaveLength(0)
  })
})
