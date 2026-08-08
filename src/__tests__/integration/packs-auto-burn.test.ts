/**
 * 自動消化 (packet 11) — the money path. Every branch of autoBurnForBusiness
 * gets a check: it burns exactly one ticket on a completed booking, and it
 * burns NOTHING on any other shape. Cancel-neutrality (PRs #438-#440) is
 * regression-tested explicitly.
 *
 * orgSettingsWithClient runs FOR REAL against a fake orgSettings.get() so the
 * "absent key = manual" default is proven by the normalizer, not by the mock.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn(async () => 'biz-1') }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(),
  newSynqedClient: jest.fn(),
}))

const listCustomerPacks = jest.fn(async (_id: string): Promise<unknown[]> => [])
const addRedemption = jest.fn(
  async (_input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ({
    ok: true,
    id: 'redemption-1',
  }),
)
jest.mock('@/lib/packs/store', () => ({
  listCustomerPacksWithClient: (_s: unknown, id: string) => listCustomerPacks(id),
  addRedemptionWithClient: (_s: unknown, input: unknown) => addRedemption(input),
}))

import { autoBurnForBusiness } from '@/lib/packs/auto-burn'

const DATE = '2026-07-06'
// 12:00 JST on DATE — comfortably inside the day window either side of midnight.
const STARTS_AT = '2026-07-06T03:00:00.000Z'

const BURNABLE_PACK = {
  id: 'pack-1',
  kind: 'pack',
  status: 'active',
  remaining: 3,
  purchased_at: '2026-01-01',
}

type Appt = { id: string; customer_id: string; status: string; starts_at: string }
const appt = (over: Partial<Appt> = {}): Appt => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  status: 'SCHEDULED',
  starts_at: STARTS_AT,
  ...over,
})

const orgSettingsGet = jest.fn(async (): Promise<unknown> => ({
  business_id: 'biz-1',
  name: 'Salon',
  settings: { pack_burn_mode: 'auto' },
}))
const apptList = jest.fn(async (_o: unknown): Promise<{ appointments: Appt[] }> => ({
  appointments: [appt()],
}))
const listRecentRedemptions = jest.fn(
  async (
    _since: string,
  ): Promise<Array<{ customer_id: string; appointment_id: string | null; redeemed_on: string }>> =>
    [],
)

const client = () =>
  ({
    orgSettings: { get: orgSettingsGet },
    appointments: { list: apptList },
    packs: { listRecentRedemptions },
  }) as unknown as Parameters<typeof autoBurnForBusiness>[0]

const run = () => autoBurnForBusiness(client(), 'biz-1', DATE)

beforeEach(() => {
  jest.clearAllMocks()
  orgSettingsGet.mockImplementation(async () => ({
    business_id: 'biz-1',
    name: 'Salon',
    settings: { pack_burn_mode: 'auto' },
  }))
  apptList.mockImplementation(async () => ({ appointments: [appt()] }))
  listRecentRedemptions.mockImplementation(async () => [])
  listCustomerPacks.mockImplementation(async () => [BURNABLE_PACK])
  addRedemption.mockImplementation(async () => ({ ok: true, id: 'redemption-1' }))
})

describe('自動消化 — the mode gate', () => {
  it('an ABSENT pack_burn_mode reads as manual: nothing is even looked at', async () => {
    orgSettingsGet.mockImplementation(async () => ({
      business_id: 'biz-1',
      name: 'Salon',
      settings: {},
    }))
    const s = await run()
    expect(s.mode).toBe('manual')
    expect(apptList).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it("mode 'manual' leaves today's behavior completely untouched", async () => {
    orgSettingsGet.mockImplementation(async () => ({
      business_id: 'biz-1',
      name: 'Salon',
      settings: { pack_burn_mode: 'manual' },
    }))
    const s = await run()
    expect(s.mode).toBe('manual')
    expect(addRedemption).not.toHaveBeenCalled()
  })

  it('an UNREADABLE settings row never burns — a business whose mode we cannot read is not charged', async () => {
    orgSettingsGet.mockRejectedValue(new Error('core down'))
    const s = await run()
    expect(s.mode).toBe('unavailable')
    expect(apptList).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
  })
})

describe('自動消化 — the burn', () => {
  it('burns exactly ONE ticket on a completed booking, dated + attributed + source auto', async () => {
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(addRedemption).toHaveBeenCalledWith({
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: DATE,
      appointmentId: 'appt-1',
      source: 'auto',
      // A completed visit IS a visit — unlike the no-show burn.
      countsAsVisit: true,
    })
    expect(s).toMatchObject({ mode: 'auto', candidates: 1, burned: 1 })
  })
})

describe('自動消化 — cancel-neutrality (PRs #438-#440 contract)', () => {
  it('NEVER burns on CANCELLED', async () => {
    apptList.mockImplementation(async () => ({ appointments: [appt({ status: 'CANCELLED' })] }))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.candidates).toBe(0)
    expect(s.burned).toBe(0)
  })

  it('NEVER burns on NO_SHOW (that flow owns its own guarded burn)', async () => {
    apptList.mockImplementation(async () => ({ appointments: [appt({ status: 'NO_SHOW' })] }))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.candidates).toBe(0)
  })

  it('burns the completed booking and leaves the cancelled one alone in the same day', async () => {
    apptList.mockImplementation(async () => ({
      appointments: [
        appt({ id: 'appt-cancelled', customer_id: 'cust-2', status: 'CANCELLED' }),
        appt(),
      ],
    }))
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(addRedemption).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appt-1' }))
    expect(s.burned).toBe(1)
  })
})

describe('自動消化 — guard 1 (one appointment burns ONE ticket EVER)', () => {
  it('skips a booking that already has a redemption — reruns are idempotent', async () => {
    listRecentRedemptions.mockImplementation(async () => [
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: DATE },
    ])
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.skippedAlreadyBurned).toBe(1)
  })
})

describe('自動消化 — guard 2 (one customer-day burns ONE ticket EVER)', () => {
  it('skips when a staff MANUAL burn already covers this customer-date (no appointment_id on it)', async () => {
    listRecentRedemptions.mockImplementation(async () => [
      { customer_id: 'cust-1', appointment_id: null, redeemed_on: DATE },
    ])
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.skippedSameDay).toBe(1)
  })

  it('a redemption on a DIFFERENT date does not block the burn', async () => {
    listRecentRedemptions.mockImplementation(async () => [
      { customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-07-05' },
    ])
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(s.burned).toBe(1)
  })

  it('two bookings for ONE customer on ONE day burn exactly ONE ticket (same-run window)', async () => {
    apptList.mockImplementation(async () => ({
      appointments: [appt({ id: 'appt-1' }), appt({ id: 'appt-2' })],
    }))
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(s).toMatchObject({ candidates: 2, burned: 1, skippedSameDay: 1 })
  })
})

describe('自動消化 — fail closed', () => {
  it('an ERRORED burn-history read skips the whole day and REPORTS it, never burns past it', async () => {
    listRecentRedemptions.mockRejectedValue(new Error('core down'))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.skippedUnknown).toBe(1)
  })

  it('an ERRORED pack read is skippedUnknown, NOT skippedNoPack — different facts', async () => {
    listCustomerPacks.mockRejectedValue(new Error('core down'))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.skippedUnknown).toBe(1)
    expect(s.skippedNoPack).toBe(0)
  })

  it('an ERRORED appointment list burns nothing and reports the error', async () => {
    apptList.mockRejectedValue(new Error('core down'))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.errors).toBe(1)
  })
})

describe('自動消化 — no-op shapes', () => {
  it('サブスク / 単発 / exhausted packs are a no-op, never an error', async () => {
    listCustomerPacks.mockImplementation(async () => [
      { ...BURNABLE_PACK, id: 'sub', kind: 'subscription' },
      { ...BURNABLE_PACK, id: 'single', kind: 'single' },
      { ...BURNABLE_PACK, id: 'spent', remaining: 0 },
      { ...BURNABLE_PACK, id: 'closed', status: 'exhausted' },
    ])
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.skippedNoPack).toBe(1)
    expect(s.errors).toBe(0)
  })

  it('a customer with zero packs is a no-op', async () => {
    listCustomerPacks.mockImplementation(async () => [])
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.skippedNoPack).toBe(1)
  })

  it("the DB below-zero refusal surfaces in the report, it isn't swallowed", async () => {
    addRedemption.mockImplementation(async () => ({ ok: false, error: 'below_zero' }))
    const s = await run()
    expect(s.belowZero).toBe(1)
    expect(s.burned).toBe(0)
    expect(s.errors).toBe(0)
  })
})
