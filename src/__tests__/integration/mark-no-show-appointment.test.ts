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
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
  // Audit identity seam (resolveWebAuditContext, @/lib/audit-web) — booking
  // mutations now emit through the shared cores.
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
}))

const apptUpdate = jest.fn(async () => ({}))
// created_at (Fable fix-round FIX 1): the burn dedup window now anchors to
// min(starts_at, created_at) — set equal to starts_at here so every existing
// burn-window computation is unchanged. title/notes are PII-bait decoys
// (FIX 7b): the audit describe block's exact-toEqual detail assertions must
// fail the moment either leaks into detail.
const apptGet = jest.fn(async () => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  store_id: 'store-1',
  status: 'SCHEDULED',
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

import { markNoShowAppointment, getBurnablePackSummary } from '@/actions/appointments'
import { auditLines } from './helpers/audit-lines'

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
    store_id: 'store-1',
    status: 'SCHEDULED',
    starts_at: '2026-07-06T03:00:00.000Z',
    created_at: '2026-07-06T03:00:00.000Z',
    title: 'DECOY — must never reach detail',
    notes: 'DECOY — must never reach detail',
  }))
  listCustomerPacks.mockImplementation(async () => [])
  addRedemption.mockImplementation(async () => ({ ok: true, id: 'redemption-1' }))
  listRecentRedemptions.mockImplementation(async () => [])
})

describe('markNoShowAppointment — no-burn path', () => {
  it('requires bookings.manage and sends exactly status + the FIXED reason + acting_staff_id', async () => {
    // Taxonomy fix 2026-07-10: 無断 = no contact by definition — the reason is
    // stamped server-side, never caller input (the old chips are legacy-only).
    const res = await markNoShowAppointment('appt-1', { burnPack: false })
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
    await markNoShowAppointment('appt-1', { burnPack: false })
    const [, patch] = apptUpdate.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(patch).sort()).toEqual(['status', 'status_reason'])
  })

  it('never calls the pack machinery when burnPack is false', async () => {
    await markNoShowAppointment('appt-1', { burnPack: false })
    expect(listCustomerPacks).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('denies cleanly when the capability check throws — no update, house error shape', async () => {
    requireCapability.mockRejectedValueOnce(new Error('You do not have permission to manage bookings.'))
    const res = await markNoShowAppointment('appt-1', { burnPack: false })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(res).toEqual({ error: 'You do not have permission to manage bookings.' })
  })
})

describe('markNoShowAppointment — 自動消化 correction (packet 11 rider L1#6)', () => {
  // With auto mode on, the cron may already have burned a ticket for this
  // booking (counts_as_visit:true) before staff correct it to NO_SHOW.
  it('tells the staff a ticket was ALREADY spent when they chose not to burn', async () => {
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-07-06' },
    ])
    const res = await markNoShowAppointment('appt-1', { burnPack: false })
    // The correction still lands — only the ticket story is completed.
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', expect.objectContaining({ status: 'NO_SHOW' }))
    expect(addRedemption).not.toHaveBeenCalled()
    expect(res).toEqual({ success: true, burnError: 'already_burned' })
  })

  it('stays silent when no prior burn exists — no invented warning', async () => {
    const res = await markNoShowAppointment('appt-1', { burnPack: false })
    expect(res).toEqual({ success: true })
  })

  it('an unreadable history invents nothing on the no-burn path (no charge either way)', async () => {
    listRecentRedemptions.mockRejectedValueOnce(new Error('core down'))
    const res = await markNoShowAppointment('appt-1', { burnPack: false })
    expect(addRedemption).not.toHaveBeenCalled()
    expect(res).toEqual({ success: true })
  })

  it('never double-charges when the staff DO choose to burn a already-auto-burned booking', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-07-06' },
    ])
    const res = await markNoShowAppointment('appt-1', { burnPack: true })
    expect(addRedemption).not.toHaveBeenCalled()
    expect(res).toEqual({ success: true, burnError: 'already_burned' })
  })
})

describe('markNoShowAppointment — burn path', () => {
  it('burns the FIFO-picked pack with counts_as_visit:false and this appointment_id', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    const res = await markNoShowAppointment('appt-1', { burnPack: true })
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
    const res = await markNoShowAppointment('appt-1', { burnPack: true })
    expect(res).toEqual({ error: expect.any(String), code: 'no_burnable_pack' })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('marks the status BEFORE burning — a failed burn can never strand a spent ticket', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    await markNoShowAppointment('appt-1', { burnPack: true })
    const updateOrder = apptUpdate.mock.invocationCallOrder[0]
    const burnOrder = addRedemption.mock.invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(burnOrder)
  })

  it('reports a below_zero burn failure as partial success — no-show recorded, ticket not consumed', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    addRedemption.mockResolvedValueOnce({ ok: false, error: 'below_zero' })
    const res = await markNoShowAppointment('appt-1', { burnPack: true })
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', expect.objectContaining({ status: 'NO_SHOW' }))
    expect(res).toEqual({ success: true, burnError: 'below_zero' })
  })

  it('refuses an already-terminal booking — a double-open race must not double-burn', async () => {
    apptGet.mockResolvedValueOnce({
      id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      status: 'NO_SHOW',
      starts_at: '2026-07-06T03:00:00.000Z',
      created_at: '2026-07-06T03:00:00.000Z',
      title: 'DECOY — must never reach detail',
      notes: 'DECOY — must never reach detail',
    })
    const res = await markNoShowAppointment('appt-1', { burnPack: true })
    expect(res).toEqual({ error: expect.any(String), code: 'already_terminal' })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('one appointment burns ONE ticket ever — a restore → re-mark cycle must not double-burn', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    // An earlier no-show already burned a redemption linked to this booking.
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-07-06' },
    ])
    const res = await markNoShowAppointment('appt-1', { burnPack: true })
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
    const res = await markNoShowAppointment('appt-1', { burnPack: true })
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

// Booking mutations now audit (Liam ruling 2026-07-26): exactly one row per
// mutation, ids-only detail, targeting the customer. Line-shape assertions
// (evt/at/actor_type/break_glass) are pinned once in facade-audit.test.ts;
// this pins the no-show-specific category, action, severity, and detail.
describe('markNoShowAppointment — audit', () => {
  it('emits exactly one booking.no_show row at severity notice, ids-only detail', async () => {
    const lines = await auditLines(async () => {
      await markNoShowAppointment('appt-1', { burnPack: false })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.no_show',
      actor_id: 'auth-user-1',
      business_id: 'biz-1',
      target_type: 'customer',
      target_id: 'cust-1',
      severity: 'notice',
      source: 'web',
    })
    // Exact equality (not toMatchObject/objectContaining) — a future key
    // leaking a customer name or memo text into detail must fail this test.
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      burn_pack: false,
      burn_error: null,
    })
  })

  it('burn_pack:true rides the detail flag on the burn path, burn_error:null when the ticket really was consumed', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    const lines = await auditLines(async () => {
      await markNoShowAppointment('appt-1', { burnPack: true })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      burn_pack: true,
      burn_error: null,
    })
  })

  // Fable audit finding (2026-07-27): burn_pack alone is the staff's CHOICE,
  // not the outcome — a failed burn must not read as "ticket consumed".
  it('records burn_pack:true with burn_error set when the redemption fails — the ticket was NOT consumed', async () => {
    listCustomerPacks.mockResolvedValueOnce([BURNABLE_PACK])
    addRedemption.mockResolvedValueOnce({ ok: false, error: 'burn_failed' })
    const lines = await auditLines(async () => {
      const res = await markNoShowAppointment('appt-1', { burnPack: true })
      expect(res).toEqual({ success: true, burnError: 'burn_failed' })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      burn_pack: true,
      burn_error: 'burn_failed',
    })
  })

  it('a denied mark emits no audit row', async () => {
    requireCapability.mockRejectedValueOnce(new Error('nope'))
    const lines = await auditLines(async () => {
      await markNoShowAppointment('appt-1', { burnPack: false })
    })
    expect(lines).toHaveLength(0)
  })

  it('an already-terminal booking emits no audit row', async () => {
    apptGet.mockResolvedValueOnce({
      id: 'appt-1',
      customer_id: 'cust-1',
      store_id: 'store-1',
      status: 'NO_SHOW',
      starts_at: '2026-07-06T03:00:00.000Z',
      created_at: '2026-07-06T03:00:00.000Z',
      title: 'DECOY — must never reach detail',
      notes: 'DECOY — must never reach detail',
    })
    const lines = await auditLines(async () => {
      await markNoShowAppointment('appt-1', { burnPack: false })
    })
    expect(lines).toHaveLength(0)
  })

  it('a failed write emits no audit row', async () => {
    apptUpdate.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const res = await markNoShowAppointment('appt-1', { burnPack: false })
      expect(res).toEqual({ error: 'core down' })
    })
    expect(lines).toHaveLength(0)
  })
})
