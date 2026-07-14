/**
 * redeemSessionAction precedence (feat/burn-appointment-link, CHANGE 1).
 *
 * The action resolves the customer's same-day booking ONLY when the caller left
 * appointmentId unset (the profile burn button + walk-in null). An explicitly
 * provided id — the reconcile strip's specific booking — is passed straight
 * through and NEVER overridden by the lookup.
 *
 * The store layer is mocked so we assert exactly what the action forwards to
 * addRedemption; the resolver's own behaviour is covered in
 * packs-burn-appointment-link.test.ts. Spies are `mock`-prefixed so the hoisted
 * jest.mock factory may reference them (babel-plugin-jest-hoist rule).
 */

// The action now delegates to the single-source WithClient store cores (a
// business-scoped client is threaded as the first arg). These tests assert what
// the action forwards to addRedemptionWithClient; the client arg is opaque here.
const mockAddRedemption = jest.fn(
  async (_synqed: unknown, _input: { appointmentId?: string | null }): Promise<{ ok: boolean; id?: string; error?: string }> => ({
    ok: true,
    id: 'red-1',
  }),
)
const mockFindCustomerAppointmentForDate = jest.fn(
  async (_synqed: unknown, _customerId: string, _dateYmd: string): Promise<string | null> => 'a-resolved',
)

jest.mock('@/lib/packs/store', () => ({
  addRedemptionWithClient: (synqed: unknown, input: { appointmentId?: string | null }) => mockAddRedemption(synqed, input),
  findCustomerAppointmentForDateWithClient: (synqed: unknown, customerId: string, dateYmd: string) =>
    mockFindCustomerAppointmentForDate(synqed, customerId, dateYmd),
  // untouched by these cases, but the action module imports them at load time
  listCustomerPacksWithClient: jest.fn(async () => []),
  addVisitReconcileDismissal: jest.fn(),
  addCustomerContact: jest.fn(),
  addPackAlertDismissal: jest.fn(),
  createPackWithClient: jest.fn(),
  removeRedemption: jest.fn(),
  setCustomerLifecycleWithClient: jest.fn(),
  updatePackStatus: jest.fn(),
}))

jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: async () => ({}) }))

jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

import { redeemSessionAction } from '@/actions/packs'

const lastForwardedAppointmentId = () => mockAddRedemption.mock.calls[0][1].appointmentId

beforeEach(() => {
  jest.clearAllMocks()
  mockAddRedemption.mockResolvedValue({ ok: true, id: 'red-1' })
  mockFindCustomerAppointmentForDate.mockResolvedValue('a-resolved')
})

describe('redeemSessionAction appointment precedence', () => {
  it('resolves & links the same-day booking when the caller sends no appointmentId', async () => {
    await redeemSessionAction({ packId: 'p1', customerId: 'cust-1', redeemedOn: '2026-07-05' })

    expect(mockFindCustomerAppointmentForDate).toHaveBeenCalledWith(expect.anything(), 'cust-1', '2026-07-05')
    expect(lastForwardedAppointmentId()).toBe('a-resolved')
  })

  it('does NOT override an explicitly provided appointmentId (reconcile backfill)', async () => {
    await redeemSessionAction({
      packId: 'p1',
      customerId: 'cust-1',
      redeemedOn: '2026-07-05',
      appointmentId: 'a-explicit',
      source: 'backfill',
    })

    expect(mockFindCustomerAppointmentForDate).not.toHaveBeenCalled()
    expect(lastForwardedAppointmentId()).toBe('a-explicit')
  })

  it('keeps null when the resolver finds no booking (walk-in)', async () => {
    mockFindCustomerAppointmentForDate.mockResolvedValueOnce(null)

    await redeemSessionAction({ packId: 'p1', customerId: 'cust-1', redeemedOn: '2026-07-05' })

    expect(lastForwardedAppointmentId()).toBeNull()
  })

  it('respects an explicit null (RecordPageView walk-in signal) — resolver never runs', async () => {
    await redeemSessionAction({
      packId: 'p1',
      customerId: 'cust-1',
      redeemedOn: '2026-07-05',
      appointmentId: null,
    })

    expect(mockFindCustomerAppointmentForDate).not.toHaveBeenCalled()
    expect(lastForwardedAppointmentId()).toBeNull()
  })

  it('surfaces the below_zero discriminator from the store unchanged', async () => {
    mockAddRedemption.mockResolvedValueOnce({ ok: false, error: 'below_zero' })

    const res = await redeemSessionAction({ packId: 'p1', customerId: 'cust-1' })

    expect(res).toEqual({ ok: false, error: 'below_zero' })
  })
})
