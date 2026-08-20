/**
 * PR-B1 D5 + D7 — the recovery burn's walk-in guard and its audit tag.
 *
 * ONE BOOKING = MAX ONE BURN (⚖ 8/21 R-B6) holds at the STORAGE layer, but only
 * for a BOOKED burn: the DB's partial unique index is on
 * pack_redemptions(appointment_id), and a NULL appointment_id sits outside it
 * (the in-code note at RecordPageView:396-399). The recovery banner can re-offer
 * the same unbooked visit — a second crash re-shows it, two takes of one walk-in
 * both save — so the customer+JST-day check the auto-burn cron runs as guard 2
 * runs here too, check-then-write, and ONLY on the recovery path (the normal
 * stop flow is deliberately untouched).
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

  it('fails CLOSED when the burn history cannot be read', async () => {
    ledgerThrows = true
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: null,
      recovery: true,
    })
    expect(res).toEqual({ ok: false, error: 'already_redeemed' })
    expect(addRedemptionWithClient).not.toHaveBeenCalled()
  })

  it('does NOT fire for a BOOKED recovery burn — the DB index owns that case', async () => {
    ledger = [{ customer_id: 'cust-1', appointment_id: null, redeemed_on: `${DAY}T00:00:00Z` }]
    const res = await redeemSessionActionWithClient(fakeClient, 'staff-1', {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DAY,
      appointmentId: 'appt-1',
      recovery: true,
    })
    expect(res.ok).toBe(true)
    expect(listRecentRedemptions).not.toHaveBeenCalled()
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
