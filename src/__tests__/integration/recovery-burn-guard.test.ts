/**
 * PR-B1 D5 + D7 — the recovery burn's walk-in guard and its audit tag.
 *
 * ONE BOOKING = MAX ONE BURN (⚖ 8/21 R-B6) holds at the STORAGE layer, but only
 * for a BOOKED burn: the DB's partial unique index is on
 * pack_redemptions(appointment_id), and a NULL appointment_id sits outside it.
 * The recovery banner can re-offer the same unbooked visit — a second crash
 * re-shows it, two takes of one walk-in both save — so the customer+JST-day
 * check the auto-burn cron runs as guard 2 runs here too, check-then-write.
 *
 * ⚖ 8/21 EVE (PR-B2): that customer-day check is now BOOKING-KEYED — it runs
 * only when the RESOLVED appointment is null (a true walk-in burn). A booked
 * recovery burn is guarded by the index alone, so a customer's second same-day
 * BOOKING takes its own ticket. Still scoped to the recovery path; the normal
 * stop flow is deliberately untouched.
 *
 * D7: the burn is tagged recovery-resolved at the audit layer — the redemption
 * `source` column has no 'recovery' value and the set the DB accepts is not
 * visible from this repo, so a client-side shadow ledger is never the answer.
 */
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

const mockAuditWeb = jest.fn(async (_e: Record<string, unknown>) => {})
jest.mock('@/lib/audit-web', () => ({
  auditWeb: (e: Record<string, unknown>) => mockAuditWeb(e),
}))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn(async () => 'staff-1') }))
jest.mock('@/lib/auth/require-permission', () => ({ requireCapability: jest.fn(async () => {}) }))

const addRedemptionWithClient = jest.fn(async () => ({ ok: true, id: 'red-1' }) as
  | { ok: true; id: string }
  | { ok: false; error: string })
const findCustomerAppointmentForDateWithClient = jest.fn(
  async (): Promise<string | null> => null,
)
jest.mock('@/lib/packs/store', () => ({
  addRedemptionWithClient: (...a: unknown[]) => addRedemptionWithClient(...(a as [])),
  findCustomerAppointmentForDateWithClient: (...a: unknown[]) =>
    findCustomerAppointmentForDateWithClient(...(a as [])),
  listCustomerPacksWithClient: jest.fn(async () => []),
  createPackWithClient: jest.fn(async () => ({ ok: true, id: 'p' })),
  addVisitReconcileDismissalWithClient: jest.fn(),
  addCustomerContactWithClient: jest.fn(),
  addPackAlertDismissalWithClient: jest.fn(),
  removeRedemption: jest.fn(),
  setCustomerLifecycleWithClient: jest.fn(),
  updatePackStatus: jest.fn(),
}))

type Redemption = { customer_id: string; appointment_id: string | null; redeemed_on: string }
let ledger: Redemption[] = []
let ledgerThrows = false
const listRecentRedemptions = jest.fn(async (_since: string) => {
  if (ledgerThrows) throw new Error('core down')
  return ledger
})
const fakeClient = {
  packs: { listRecentRedemptions: (s: string) => listRecentRedemptions(s) },
  appointments: {},
} as unknown as Parameters<typeof redeemSessionActionWithClient>[0]

jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: async () => fakeClient,
  newSynqedClient: () => fakeClient,
}))

import { redeemSessionAction, redeemSessionActionWithClient } from '@/actions/packs'

const DAY = '2026-08-18'

beforeEach(() => {
  jest.clearAllMocks()
  ledger = []
  ledgerThrows = false
  addRedemptionWithClient.mockResolvedValue({ ok: true, id: 'red-1' })
  findCustomerAppointmentForDateWithClient.mockResolvedValue(null)
})

describe('D5 — unbooked recovery burn, same-customer/same-day guard', () => {
  it('blocks a SECOND unbooked burn for the same customer on the same JST day', async () => {
    ledger = [{ customer_id: 'cust-1', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` }]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
      recovery: true,
    })
    expect(res).toEqual({ ok: false, error: 'already_redeemed' })
    // The whole point: no write was attempted.
    expect(addRedemptionWithClient).not.toHaveBeenCalled()
  })

  it('lets the FIRST unbooked burn through', async () => {
    ledger = []
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
      recovery: true,
    })
    expect(res.ok).toBe(true)
    expect(addRedemptionWithClient).toHaveBeenCalledTimes(1)
  })

  it('ignores another customer, and another day, on the same ledger', async () => {
    ledger = [
      { customer_id: 'cust-OTHER', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` },
      { customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-08-17T00:00:00Z' },
    ]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
      recovery: true,
    })
    expect(res.ok).toBe(true)
  })

  it('reads history from ONE JST day back — never relying on an inclusive `since`', async () => {
    await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
      recovery: true,
    })
    expect(listRecentRedemptions).toHaveBeenCalledWith('2026-08-17')
  })

  // F-3: fail-closed, but SAY WHICH. Reporting an unreadable history as
  // 'already_redeemed' told the staffer the ticket had been used and let the
  // client certify the answer — so a transient blip cost the burn permanently,
  // with nothing on screen to suggest anything had gone wrong.
  it('fails CLOSED with its OWN discriminator when the history cannot be read', async () => {
    ledgerThrows = true
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
      recovery: true,
    })
    expect(res).toEqual({ ok: false, error: 'guard_unavailable' })
    // Fail-closed is unchanged: nothing burned.
    expect(addRedemptionWithClient).not.toHaveBeenCalled()
  })

  it('a PROVABLE hit still reports already_redeemed — the two are distinguishable', async () => {
    ledger = [{ customer_id: 'cust-1', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` }]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
      recovery: true,
    })
    expect(res).toEqual({ ok: false, error: 'already_redeemed' })
  })

  // ⚖ 8/21 EVE — this assertion was INVERTED by the booking-keyed ruling. It
  // used to pin "a prior walk-in burn blocks a booked one", which under the
  // ruling is over-blocking: the booking is where money happens, so a burn
  // that carries a booking answers only to that booking's own index row. The
  // accepted residual is named in the guard's F-10 ceiling — a mis-keyed
  // NULL-appointment row for the same visit is a reconcile (F7) job, not a
  // reason to refuse a booked customer's ticket.
  it('does NOT fire for a BOOKED recovery burn — the booking takes its own ticket', async () => {
    ledger = [{ customer_id: 'cust-1', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` }]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: 'appt-1',
      recovery: true,
    })
    expect(res.ok).toBe(true)
    expect(addRedemptionWithClient).toHaveBeenCalledTimes(1)
    // The customer-day history is not even READ for a booked burn.
    expect(listRecentRedemptions).not.toHaveBeenCalled()
  })

  // THE ruled case (⚖ 8/21 EVE, Liam's own salons' convention): a double visit
  // is booked as TWO bookings, and each one takes its own ticket.
  it('a SECOND same-day BOOKING burns its own ticket', async () => {
    ledger = [
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: `${DAY}T00:00:00Z` },
    ]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: 'appt-2',
      recovery: true,
    })
    expect(res.ok).toBe(true)
    expect(addRedemptionWithClient).toHaveBeenCalledTimes(1)
  })

  // ONE BOOKING = MAX ONE BURN still holds — it just holds at the DB index
  // now, not at this guard. addRedemptionWithClient maps 23505/P2002 on
  // pack_redemptions_active_appointment_unique to 'already_redeemed'.
  it('a booked burn the index already holds still reports already_redeemed', async () => {
    addRedemptionWithClient.mockResolvedValueOnce({ ok: false, error: 'already_redeemed' })
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: 'appt-1',
      recovery: true,
    })
    expect(res).toEqual({ ok: false, error: 'already_redeemed' })
  })

  // The guard keys on the RESOLVED appointment, never the raw input: a
  // recovery burn that simply omits the id is still BOOKED once the server
  // finds the customer's booking for that day. Keying on input.appointmentId
  // would have run the walk-in guard over a booked visit.
  it('an OMITTED appointment id that the server resolves counts as booked', async () => {
    findCustomerAppointmentForDateWithClient.mockResolvedValue('appt-9')
    ledger = [{ customer_id: 'cust-1', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` }]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      recovery: true,
    })
    expect(res.ok).toBe(true)
    expect(listRecentRedemptions).not.toHaveBeenCalled()
  })

  it('a booked recovery burn with a CLEAN ledger still goes through', async () => {
    ledger = [{ customer_id: 'cust-OTHER', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` }]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: 'appt-1',
      recovery: true,
    })
    expect(res.ok).toBe(true)
    expect(addRedemptionWithClient).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire on the NORMAL stop flow (recovery flag absent) — scope guard', async () => {
    ledger = [{ customer_id: 'cust-1', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` }]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
    })
    expect(res.ok).toBe(true)
    expect(listRecentRedemptions).not.toHaveBeenCalled()
  })
})

describe('D7 — recovery-resolved tagging (audit layer)', () => {
  it('tags a successful recovery burn, with the resolved_via marker', async () => {
    const res = await redeemSessionAction({
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: 'appt-1',
      recovery: true,
    })
    expect(res.ok).toBe(true)
    expect(mockAuditWeb).toHaveBeenCalledTimes(1)
    expect(mockAuditWeb.mock.calls[0][0]).toMatchObject({
      action: 'customer.pack_redeem',
      targetId: 'cust-1',
      detail: expect.objectContaining({ resolved_via: 'recovery', redeemed_on: DAY }),
    })
  })

  it('emits nothing for a normal burn, and nothing for a FAILED recovery burn', async () => {
    await redeemSessionAction({ packId: 'pack-1', customerId: 'cust-1', appointmentId: 'appt-1' })
    expect(mockAuditWeb).not.toHaveBeenCalled()

    addRedemptionWithClient.mockResolvedValueOnce({ ok: false, error: 'below_zero' })
    await redeemSessionAction({
      packId: 'pack-1',
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      recovery: true,
    })
    expect(mockAuditWeb).not.toHaveBeenCalled()
  })
})

export {}
