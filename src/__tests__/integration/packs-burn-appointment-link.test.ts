/**
 * Coverage for the burn→appointment link (feat/burn-appointment-link).
 *
 * CHANGE 1 — findCustomerAppointmentForDate resolves the customer's booking for
 * a JST day so a redemption links to the visit it covers; and redeemSessionAction
 * only runs that lookup when the caller left appointmentId unset (an explicit id,
 * e.g. the reconcile strip's, is never overridden).
 *
 * CHANGE 2 — the trg_pack_below_zero guard (SQLSTATE 23514) is mapped to a stable
 * 'below_zero' discriminator the burn callers turn into a Japanese message, never
 * leaking the raw Postgres/synqed error text.
 */

// --- store-layer suite: real store.ts against a mocked synqed client --------

const appointments = { list: jest.fn() }
const packs = { addRedemption: jest.fn() }

jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ appointments, packs })),
}))

import {
  addRedemption,
  findCustomerAppointmentForDate,
} from '@/lib/packs/store'

type ApptOver = Record<string, unknown>
const appt = (over: ApptOver = {}) => ({
  id: 'a1',
  customer_id: 'cust-1',
  status: 'CONFIRMED',
  starts_at: '2026-07-05T01:00:00.000Z', // 10:00 JST
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('findCustomerAppointmentForDate (CHANGE 1 resolver)', () => {
  it('links the same-day booking, filtering by customer + JST-day window', async () => {
    appointments.list.mockResolvedValue({ appointments: [appt({ id: 'a-today' })] })

    const id = await findCustomerAppointmentForDate('cust-1', '2026-07-05')

    expect(id).toBe('a-today')
    const opts = appointments.list.mock.calls[0][0]
    expect(opts.customer_id).toBe('cust-1')
    // 2026-07-05 JST midnight → the day before in UTC (15:00Z), 23:59:59.999 JST.
    expect(opts.from).toBe('2026-07-04T15:00:00.000Z')
    expect(opts.to).toBe('2026-07-05T14:59:59.999Z')
  })

  it('links deterministically among several same-day bookings (oldest, all past)', async () => {
    // Both bookings are in the past relative to now, so the pick is unambiguous
    // regardless of the closest-to-now tie-break: the day's earliest.
    appointments.list.mockResolvedValue({
      appointments: [
        appt({ id: 'later', starts_at: '2020-01-01T05:00:00.000Z' }),
        appt({ id: 'earlier', starts_at: '2020-01-01T01:00:00.000Z' }),
      ],
    })

    expect(await findCustomerAppointmentForDate('cust-1', '2020-01-01')).toBe('earlier')
  })

  it('never links a CANCELLED booking', async () => {
    appointments.list.mockResolvedValue({
      appointments: [appt({ id: 'cancelled', status: 'CANCELLED' })],
    })

    expect(await findCustomerAppointmentForDate('cust-1', '2026-07-05')).toBeNull()
  })

  it('returns null (walk-in) when the customer has no booking that day', async () => {
    appointments.list.mockResolvedValue({ appointments: [] })

    expect(await findCustomerAppointmentForDate('cust-1', '2026-07-05')).toBeNull()
  })

  it('degrades to null (keep-unlinked) when synqed is unreachable', async () => {
    appointments.list.mockRejectedValue(new Error('core down'))

    expect(await findCustomerAppointmentForDate('cust-1', '2026-07-05')).toBeNull()
  })
})

describe('addRedemption below-zero mapping (CHANGE 2)', () => {
  it("maps the guard's real raise text (verified against the prod trigger) to below_zero", async () => {
    // assert_pack_not_over_redeemed raises exactly this shape — no SQLSTATE, no
    // trigger name in the text. The matcher must fire on the raise text alone.
    packs.addRedemption.mockRejectedValue(
      new Error('pack 3f2a1c9e over-redeemed: 11 burned > pack_size 10'),
    )

    const res = await addRedemption({ packId: 'p1', customerId: 'c1', redeemedOn: '2026-07-05' })

    expect(res).toEqual({ ok: false, error: 'below_zero' })
  })

  it('also fires on Prisma-formatted relays that embed the SQLSTATE or trigger name', async () => {
    packs.addRedemption.mockRejectedValue(
      new Error('new row for relation "pack_redemptions" violates check constraint "trg_pack_below_zero" (23514)'),
    )

    const res = await addRedemption({ packId: 'p1', customerId: 'c1', redeemedOn: '2026-07-05' })

    expect(res).toEqual({ ok: false, error: 'below_zero' })
  })

  it('leaves other failures as their raw internal message (not below_zero)', async () => {
    packs.addRedemption.mockRejectedValue(new Error('some other core error'))

    const res = await addRedemption({ packId: 'p1', customerId: 'c1', redeemedOn: '2026-07-05' })

    expect(res).toEqual({ ok: false, error: 'some other core error' })
  })

  it('passes the resolved appointment id through to core on success', async () => {
    packs.addRedemption.mockResolvedValue({ id: 'red-1' })

    const res = await addRedemption({
      packId: 'p1',
      customerId: 'c1',
      redeemedOn: '2026-07-05',
      appointmentId: 'a-today',
    })

    expect(res).toEqual({ ok: true, id: 'red-1' })
    expect(packs.addRedemption.mock.calls[0][0].appointment_id).toBe('a-today')
  })
})
