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

import { autoBurnForBusiness, autoBurnRecentDays } from '@/lib/packs/auto-burn'

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

type Appt = {
  id: string
  customer_id: string
  status: string
  starts_at: string
  // The burn-history window anchors on min(starts_at, created_at) — equal by
  // default so every existing expectation is unchanged; the widening test
  // below sets them apart on purpose.
  created_at: string
}
const appt = (over: Partial<Appt> = {}): Appt => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  status: 'SCHEDULED',
  starts_at: STARTS_AT,
  created_at: STARTS_AT,
  ...over,
})

/** core's ListAppointmentsResponse shape. `total` drives the pagination loop,
 *  so it defaults to "this is the whole result". */
const page = (appointments: Appt[], total = appointments.length) => ({ appointments, total })

const settingsRow = (settings: Record<string, unknown>) => ({
  business_id: 'biz-1',
  name: 'Salon',
  settings,
})

const orgSettingsGet = jest.fn(async (): Promise<unknown> =>
  settingsRow({ pack_burn_mode: 'auto' }),
)
const orgSettingsUpsert = jest.fn(async (_input: unknown): Promise<unknown> => ({}))
const apptList = jest.fn(
  async (_o: unknown): Promise<{ appointments: Appt[]; total: number }> => page([appt()]),
)
const listRecentRedemptions = jest.fn(
  async (
    _since: string,
  ): Promise<Array<{ customer_id: string; appointment_id: string | null; redeemed_on: string }>> =>
    [],
)

const client = () =>
  ({
    orgSettings: { get: orgSettingsGet, upsert: orgSettingsUpsert },
    appointments: { list: apptList },
    packs: { listRecentRedemptions },
  }) as unknown as Parameters<typeof autoBurnForBusiness>[0]

const run = () => autoBurnForBusiness(client(), 'biz-1', DATE)

beforeEach(() => {
  jest.clearAllMocks()
  orgSettingsGet.mockImplementation(async () => settingsRow({ pack_burn_mode: 'auto' }))
  orgSettingsUpsert.mockImplementation(async () => ({}))
  apptList.mockImplementation(async () => page([appt()]))
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

  // Blind-round F3: settings writes MERGE, so pack_burn_mode:'auto' survives in
  // the blob after an owner turns 回数券 off. The master switch has to outrank
  // it or the cron keeps charging against a feature that is entirely hidden.
  it('the 回数券 master switch OUTRANKS the mode — packs OFF burns nothing', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', ticket_packs_enabled: false }),
    )
    const s = await run()
    expect(s.mode).toBe('manual')
    expect(apptList).not.toHaveBeenCalled()
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
    apptList.mockImplementation(async () => page([appt({ status: 'CANCELLED' })]))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.candidates).toBe(0)
    expect(s.burned).toBe(0)
  })

  it('NEVER burns on NO_SHOW (that flow owns its own guarded burn)', async () => {
    apptList.mockImplementation(async () => page([appt({ status: 'NO_SHOW' })]))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.candidates).toBe(0)
  })

  it('burns the completed booking and leaves the cancelled one alone in the same day', async () => {
    apptList.mockImplementation(async () =>
      page([appt({ id: 'appt-cancelled', customer_id: 'cust-2', status: 'CANCELLED' }), appt()]),
    )
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
    apptList.mockImplementation(async () => page([appt({ id: 'appt-1' }), appt({ id: 'appt-2' })]))
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

  // Blind-round F6: the appointment-scoped unique index firing means guard 1
  // was RIGHT, just a hair late (stale history read / concurrent write). A
  // money report that files that under `errors` cries wolf every time the
  // safety net works.
  it("the DB's duplicate-redemption refusal is an idempotent SKIP, not an error", async () => {
    addRedemption.mockImplementation(async () => ({ ok: false, error: 'already_redeemed' }))
    const s = await run()
    expect(s.skippedAlreadyBurned).toBe(1)
    expect(s.burned).toBe(0)
    expect(s.errors).toBe(0)
  })
})

// Blind-round F8: the loop is serial over a whole salon-day, so ONE unlucky
// customer must never cost the rest of the day its burns.
describe('自動消化 — one candidate never aborts the batch', () => {
  it('a below-zero refusal on the first booking still burns the second', async () => {
    apptList.mockImplementation(async () =>
      page([appt(), appt({ id: 'appt-2', customer_id: 'cust-2' })]),
    )
    addRedemption.mockImplementationOnce(async () => ({ ok: false, error: 'below_zero' }))
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(2)
    expect(addRedemption).toHaveBeenLastCalledWith(
      expect.objectContaining({ appointmentId: 'appt-2', customerId: 'cust-2' }),
    )
    expect(s).toMatchObject({ candidates: 2, belowZero: 1, burned: 1, errors: 0 })
  })

  it('an unreadable pack list on the first booking still burns the second', async () => {
    apptList.mockImplementation(async () =>
      page([appt(), appt({ id: 'appt-2', customer_id: 'cust-2' })]),
    )
    listCustomerPacks.mockRejectedValueOnce(new Error('core down'))
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(s).toMatchObject({ candidates: 2, skippedUnknown: 1, burned: 1 })
  })
})

// Blind-round F7: one page of 500 silently dropped every booking past the
// 500th — a truncated read reads as "nothing left to burn", the quietest
// possible money bug.
describe('自動消化 — pagination', () => {
  it('keeps fetching until `total` is covered', async () => {
    apptList.mockImplementation(async (o) => {
      const n = (o as { page: number }).page
      return page([appt({ id: `appt-${n}`, customer_id: `cust-${n}` })], 3)
    })
    const s = await run()
    expect(apptList).toHaveBeenCalledTimes(3)
    expect(s).toMatchObject({ candidates: 3, burned: 3 })
  })

  it('an EMPTY page stops the loop even when `total` disagrees — a money cron must not spin', async () => {
    apptList.mockImplementation(async (o) =>
      (o as { page: number }).page === 1 ? page([appt()], 999) : page([], 999),
    )
    const s = await run()
    expect(apptList).toHaveBeenCalledTimes(2)
    expect(s).toMatchObject({ candidates: 1, burned: 1 })
  })
})

// Blind-round F6: the history floor was date−1, narrower than the burn guard's
// own min(starts_at, created_at)−1 rule (mutations.ts burnWindowSince) — a
// booking made long before its slot could reach the DB index instead of the
// in-app guard.
describe('自動消化 — the burn-history window', () => {
  it('reaches back to CREATION, so a long-booked visit still finds its own earlier burn', async () => {
    apptList.mockImplementation(async () =>
      page([appt({ created_at: '2026-06-01T00:00:00.000Z' })]),
    )
    // The mock IS the proof: the old redemption only surfaces for a window that
    // actually reaches back to creation. A floor of DATE−1 ('2026-07-05') gets
    // [] — the narrow window would have missed it and burned a second ticket.
    listRecentRedemptions.mockImplementation(async (since) =>
      since <= '2026-06-01'
        ? [{ customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-06-01' }]
        : [],
    )
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s.skippedAlreadyBurned).toBe(1)
  })

  it('ONE wide read serves the whole day — the floor is the earliest anchor of ANY candidate', async () => {
    apptList.mockImplementation(async () =>
      page([
        appt({ id: 'appt-2', customer_id: 'cust-2' }),
        appt({ created_at: '2026-06-01T00:00:00.000Z' }),
      ]),
    )
    await run()
    expect(listRecentRedemptions).toHaveBeenCalledTimes(1)
    expect(listRecentRedemptions).toHaveBeenCalledWith('2026-05-31')
  })
})

// Blind-round F2 + F5. The window catches a missed/failed run up; the marker
// stops a second pass over a day whose burns a staffer has since UNDONE (a
// soft-removed redemption is invisible to both guards AND to the DB index).
describe('自動消化 — the lookback window + the per-business marker', () => {
  // 11:00 JST on 2026-07-07 → the window is 07-04, 07-05, 07-06 (yesterday).
  const NOW = Date.parse('2026-07-07T02:00:00.000Z')
  const marked = (date?: string) =>
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({
        pack_burn_mode: 'auto',
        ...(date ? { auto_burn_last_processed: date } : {}),
      }),
    )
  const dates = (out: Awaited<ReturnType<typeof autoBurnRecentDays>>) => out.map((s) => s.date)

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('with NO marker the first run takes ONLY the newest day — turning 自動消化 on never retro-charges', async () => {
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(dates(out)).toEqual(['2026-07-06'])
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-06' },
    })
  })

  it('a missed run catches up: every day after the marker, OLDEST first', async () => {
    marked('2026-07-04')
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(dates(out)).toEqual(['2026-07-05', '2026-07-06'])
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-06' },
    })
  })

  it('a day the marker already cleared is NEVER reprocessed — an undone burn stays undone', async () => {
    marked('2026-07-06')
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out).toEqual([])
    expect(apptList).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })

  it('?force=1 reprocesses the whole window — the deliberate backfill lever', async () => {
    marked('2026-07-06')
    const out = await autoBurnRecentDays(client(), 'biz-1', true)
    expect(dates(out)).toEqual(['2026-07-04', '2026-07-05', '2026-07-06'])
  })

  it('a day we could NOT read stalls the marker — tomorrow retries it, later days still burn', async () => {
    marked('2026-07-04')
    listRecentRedemptions.mockRejectedValueOnce(new Error('core down'))
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.skippedUnknown)).toEqual([1, 0])
    expect(out[1].burned).toBe(1)
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })

  it('a FAILED marker write is logged, never thrown — the burns already landed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    orgSettingsUpsert.mockRejectedValue(new Error('core down'))
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out[0].burned).toBe(1)
    expect(warn).toHaveBeenCalled()
  })
})
