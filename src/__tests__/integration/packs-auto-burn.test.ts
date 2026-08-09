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
import { orgSettingsWithClient, writeOrgSettingsBlobWithClient } from '@/actions/org-settings'
import { ymdInJst } from '@/lib/date/jst'
import { auditLines } from './helpers/audit-lines'

const DATE = '2026-07-06'
// 12:00 JST on DATE — comfortably inside the day window either side of midnight.
const STARTS_AT = '2026-07-06T03:00:00.000Z'
// 13:00 JST — the session's END, which is what the 2h grace is measured from.
const ENDS_AT = '2026-07-06T04:00:00.000Z'

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
  /** The grace is measured from the END of the session, not its start. */
  ends_at: string
  /** Only used where the fallback is under test — core normally sends ends_at. */
  duration_minutes?: number | null
  // Kept on the fixture because core sends it; the burn-history window no
  // longer reads it (round 2 G4 bounded the floor at date−1), and the window
  // tests below set it far back on purpose to prove exactly that.
  created_at: string
}
const appt = (over: Partial<Appt> = {}): Appt => ({
  id: 'appt-1',
  customer_id: 'cust-1',
  status: 'SCHEDULED',
  starts_at: STARTS_AT,
  ends_at: ENDS_AT,
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
    // Round 2 G9: its OWN mode word. 'packs_disabled' and 'manual' are two
    // different owner decisions and a money report must not spell them the same.
    expect(s.mode).toBe('packs_disabled')
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

// Round 2 G4 (partially reverting F6a): the floor is BOUNDED at date−1 again.
// The wide floor let one far-in-advance booking drag an unbounded, unpaginated
// core read 16× a day — a chronic timeout there is silent under-burn, a bigger
// money hole than the reschedule case it covered. That case is now covered by
// the DB's appointment-scoped unique index (F6b's 23505 classification).
describe('自動消化 — the burn-history window', () => {
  it('is BOUNDED at date−1 — one read, one day, no matter how far ahead a booking was made', async () => {
    apptList.mockImplementation(async () =>
      page([
        appt({ id: 'appt-2', customer_id: 'cust-2' }),
        appt({ created_at: '2026-06-01T00:00:00.000Z' }),
      ]),
    )
    await run()
    expect(listRecentRedemptions).toHaveBeenCalledTimes(1)
    expect(listRecentRedemptions).toHaveBeenCalledWith('2026-07-05')
  })

  it('the long-booked visit already burned under an earlier date lands on the DB backstop, NOT on errors', async () => {
    apptList.mockImplementation(async () =>
      page([appt({ created_at: '2026-06-01T00:00:00.000Z' })]),
    )
    // Its burn sits outside the bounded window, so guard 1's read misses it…
    listRecentRedemptions.mockImplementation(async () => [])
    // …and the appointment-scoped partial unique index is what refuses.
    addRedemption.mockImplementation(async () => ({ ok: false, error: 'already_redeemed' }))
    const s = await run()
    expect(s).toMatchObject({ candidates: 1, skippedAlreadyBurned: 1, burned: 0, errors: 0 })
  })
})

// Blind-round F2 + F5. The window catches a missed/failed run up; the marker
// stops a second pass over a SETTLED day whose burns a staffer has since UNDONE
// (a soft-removed redemption is invisible to both guards AND to the DB index).
describe('自動消化 — the scan window + the per-business marker', () => {
  // 11:00 JST on 2026-07-07 → the window is 07-04, 07-05, 07-06 and TODAY 07-07.
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

  it('with NO marker the first run takes ONLY today, and SEEDS the marker to yesterday', async () => {
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(dates(out)).toEqual(['2026-07-07'])
    // The seed is what keeps the next day's settle pass able to reach today —
    // without it "today only" repeats forever and every evening booking whose
    // grace expires after the last intraday tick is lost. It is NOT a claim
    // that 07-06 burned: 07-06 was never in `pending`, which is the
    // no-retro-charge rule.
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-06' },
    })
  })

  it('a missed run catches up: every day after the marker, OLDEST first, today last', async () => {
    marked('2026-07-04')
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(dates(out)).toEqual(['2026-07-05', '2026-07-06', '2026-07-07'])
    // 07-06 is the newest SETTLED day — today cannot mark itself done.
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-06' },
    })
  })

  it('a SETTLED day the marker already cleared is NEVER reprocessed — an undone burn stays undone', async () => {
    marked('2026-07-06')
    const out = await autoBurnRecentDays(client(), 'biz-1')
    // Only today is left; 07-04..07-06 are settled and stay untouched.
    expect(dates(out)).toEqual(['2026-07-07'])
    expect(apptList).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-07-06T15:00:00.000Z' }),
    )
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })

  it('?force=1 reprocesses the whole window — the deliberate backfill lever', async () => {
    marked('2026-07-06')
    const out = await autoBurnRecentDays(client(), 'biz-1', true)
    expect(dates(out)).toEqual(['2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07'])
  })

  it('a day we could NOT read stalls the marker — tomorrow retries it, later days still burn', async () => {
    marked('2026-07-04')
    listRecentRedemptions.mockRejectedValueOnce(new Error('core down'))
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.skippedUnknown)).toEqual([1, 0, 0])
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

// Liam's ruling 2026-08-08: a ticket burns ~2h AFTER the session ends, same
// day. The grace is not a delay for its own sake — it is the room a last-minute
// cancellation has to reach Karute through core's 15-minute crawl (~8 passes)
// before the money moves.
describe('自動消化 — the 2-hour grace after the session ENDS', () => {
  // 15:00 JST on DATE → the burn cutoff is 13:00 JST (2026-07-06T04:00Z).
  const NOW = Date.parse('2026-07-06T06:00:00.000Z')
  const endedAt = (iso: string) =>
    apptList.mockImplementation(async () => page([appt({ ends_at: iso })]))

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('a session that ended 2h01m ago BURNS', async () => {
    endedAt('2026-07-06T03:59:00.000Z')
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(s).toMatchObject({ candidates: 1, burned: 1, skippedTooSoon: 0 })
  })

  it('a session that ended 1h59m ago is NOT burned — it is waiting, not skipped', async () => {
    endedAt('2026-07-06T04:01:00.000Z')
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    // Reported, not silent: an intraday run over a busy salon must not read
    // like "nothing to burn" (the F7 lesson).
    expect(s).toMatchObject({ candidates: 0, burned: 0, skippedTooSoon: 1 })
  })

  it('…and the NEXT hourly pass burns it — the grace delays a burn, never drops it', async () => {
    endedAt('2026-07-06T04:01:00.000Z')
    expect((await run()).burned).toBe(0)
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 3_600_000) // one hourly tick later
    expect((await run()).burned).toBe(1)
    expect(addRedemption).toHaveBeenCalledTimes(1)
  })

  it('a booking CANCELLED during the grace never burns at all', async () => {
    apptList.mockImplementation(async () =>
      page([appt({ status: 'CANCELLED', ends_at: '2026-07-06T03:00:00.000Z' })]),
    )
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    // Terminal is checked BEFORE the cutoff: not burnable and not waiting.
    expect(s).toMatchObject({ candidates: 0, burned: 0, skippedTooSoon: 0 })
  })

  it('falls back to starts_at + duration_minutes when core sent no end', async () => {
    // Start 12:00 JST. +61 min ends at 13:01 — one minute short of the cutoff.
    apptList.mockImplementation(async () => page([appt({ ends_at: '', duration_minutes: 61 })]))
    expect((await run()).skippedTooSoon).toBe(1)
    apptList.mockImplementation(async () => page([appt({ ends_at: '', duration_minutes: 59 })]))
    expect((await run()).burned).toBe(1)
  })

  it('a booking whose times are BOTH unreadable never burns — fail closed', async () => {
    apptList.mockImplementation(async () => page([appt({ starts_at: 'nonsense', ends_at: '' })]))
    const s = await run()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(s).toMatchObject({ candidates: 0, burned: 0 })
  })
})

// The case Liam's ruling names explicitly: a session ending 22:30 JST is still
// inside its grace when the LAST intraday tick (23:00 JST) runs, so the 08:30
// settle pass the next morning is what burns it — and what settles the day.
describe('自動消化 — the hourly sweep and the morning settle pass', () => {
  const LATE = appt({
    starts_at: '2026-07-06T12:30:00.000Z', // 21:30 JST
    ends_at: '2026-07-06T13:30:00.000Z', // 22:30 JST
    created_at: '2026-07-06T12:30:00.000Z',
  })
  const TICK_2300_JST = Date.parse('2026-07-06T14:00:00.000Z')
  const SETTLE_0830_JST = Date.parse('2026-07-06T23:30:00.000Z') // 08:30 JST on 07-07

  beforeEach(() => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-05' }),
    )
    // Date-aware, so a two-day pass cannot double-count one booking.
    apptList.mockImplementation(async (o) =>
      page(ymdInJst(new Date((o as { from: string }).from)) === DATE ? [LATE] : []),
    )
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('the 23:00 JST tick leaves a 22:30 session alone, and never settles today', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(TICK_2300_JST)
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.date)).toEqual([DATE])
    expect(addRedemption).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ burned: 0, skippedTooSoon: 1 })
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })

  it('the next morning 08:30 pass burns it AND advances the marker to that day', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(SETTLE_0830_JST)
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.date)).toEqual([DATE, '2026-07-07'])
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(addRedemption).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'appt-1', redeemedOn: DATE }),
    )
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: expect.objectContaining({ auto_burn_last_processed: DATE }),
    })
  })
})

// The marker deliberately stands still all day, so guards 1+2 — not the
// schedule — are what stop the next hourly tick charging the same visit twice.
describe('自動消化 — an intraday rerun is idempotent', () => {
  const TICK_1600_JST = Date.parse('2026-07-06T07:00:00.000Z')

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(TICK_1600_JST)
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-05' }),
    )
    // The two mocks stop lying to each other: what pass 1 burns is what pass 2
    // reads back. Without that, "idempotent" would only be the mock's opinion.
    const ledger: Array<{
      customer_id: string
      appointment_id: string | null
      redeemed_on: string
    }> = []
    addRedemption.mockImplementation(async (input) => {
      const i = input as { customerId: string; appointmentId: string; redeemedOn: string }
      ledger.push({
        customer_id: i.customerId,
        appointment_id: i.appointmentId,
        redeemed_on: i.redeemedOn,
      })
      return { ok: true, id: `redemption-${ledger.length}` }
    })
    listRecentRedemptions.mockImplementation(async () => ledger)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('two consecutive passes over today burn exactly ONE ticket', async () => {
    const first = await autoBurnRecentDays(client(), 'biz-1')
    const second = await autoBurnRecentDays(client(), 'biz-1')
    expect(first[0]).toMatchObject({ date: DATE, burned: 1 })
    expect(second[0]).toMatchObject({ date: DATE, burned: 0, skippedAlreadyBurned: 1 })
    expect(addRedemption).toHaveBeenCalledTimes(1)
    // Neither pass settled the day — that stays the 08:30 pass's job.
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })
})

// ── ROUND 2 (blind round on 072fadf0) ────────────────────────────────────────

// G1 (P1). The marker read used to .catch(() => undefined), so "core is down"
// and "this business has never been processed" were the SAME value. That fails
// OPEN: the run processes today only, fabricates a yesterday seed, and
// OVERWRITES a real marker that still had catch-up days behind it — those days
// are then gone forever, with nothing in the report to say so.
describe('自動消化 — an UNREADABLE marker is not an absent marker', () => {
  const NOW = Date.parse('2026-07-07T02:00:00.000Z') // 11:00 JST on 07-07

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('processes NOTHING, writes NOTHING, and says marker-unreadable', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    orgSettingsGet.mockRejectedValue(new Error('core down'))
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out).toEqual([expect.objectContaining({ mode: 'unavailable', date: '2026-07-07' })])
    expect(apptList).not.toHaveBeenCalled()
    expect(addRedemption).not.toHaveBeenCalled()
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).toContain('marker UNREADABLE')
  })

  it('…and the next healthy run resumes the FULL catch-up from the real marker', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    orgSettingsGet.mockRejectedValue(new Error('core down'))
    expect((await autoBurnRecentDays(client(), 'biz-1'))[0].mode).toBe('unavailable')

    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-04' }),
    )
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.date)).toEqual(['2026-07-05', '2026-07-06', '2026-07-07'])
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: expect.objectContaining({ auto_burn_last_processed: '2026-07-06' }),
    })
  })
})

// G2 (P1). "Never throws" was a contract this function could not keep: a
// malformed starts_at with a readable ends_at clears the grace cutoff, reaches
// the loop, and ymdInJst throws on it (Intl rejects an Invalid Date). One bad
// row took the whole business down — and the marker froze on that date, so it
// stayed down, run after run.
describe('自動消化 — one malformed row never wedges the business', () => {
  const BAD = appt({ id: 'appt-bad', customer_id: 'cust-bad', starts_at: 'nonsense' })

  it('the bad candidate lands in errors and its siblings still burn', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    apptList.mockImplementation(async () => page([BAD, appt()]))
    const s = await run()
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(addRedemption).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appt-1' }))
    expect(s).toMatchObject({ candidates: 2, burned: 1, errors: 1 })
  })

  it('the run RESOLVES — errors>0 stalls the marker, so the next pass retries the day', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-07T02:00:00.000Z'))
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-05' }),
    )
    apptList.mockImplementation(async (o) =>
      ymdInJst(new Date((o as { from: string }).from)) === DATE ? page([BAD]) : page([]),
    )
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.date)).toEqual([DATE, '2026-07-07'])
    expect(out[0].errors).toBe(1)
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
    jest.restoreAllMocks()
  })
})

// G3 (P2) + G6 (P2). Two silent marker states: an outage longer than the
// LOOKBACK window (the mark JUMPS the days it can no longer reach) and a
// garbled/future marker (`pending` empty FOREVER — fail-closed, but reading
// exactly like a quiet day).
describe('自動消化 — the marker states that used to be silent', () => {
  const NOW = Date.parse('2026-07-07T02:00:00.000Z')
  let warn: jest.SpyInstance

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })
  const said = () => warn.mock.calls.flat().join(' ')

  it('a marker older than the window REPORTS the days it is jumping over', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-01' }),
    )
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.date)).toEqual(['2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07'])
    expect(said()).toContain('catch-up GAP')
  })

  it('a contiguous marker reports NO gap', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-03' }),
    )
    await autoBurnRecentDays(client(), 'biz-1')
    expect(said()).not.toContain('catch-up GAP')
  })

  // The FORMAT check is its own layer, upstream in normalizeOrgSettings, so it
  // has to be pinned upstream too: end to end the future-clamp below happens to
  // catch the same values, which would leave the regex untested.
  it('a GARBLED marker never leaves the normalizer — absent for EVERY reader, not just the cron', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026/07/06' }),
    )
    const s = await orgSettingsWithClient(client())
    expect(s?.auto_burn_last_processed).toBeUndefined()
  })

  it('a GARBLED marker reads as absent — today only, reseeded, never an empty pending list', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: 'corrupt' }),
    )
    const out = await autoBurnRecentDays(client(), 'biz-1')
    // The bug: 'corrupt' sorts above every date, so `pending` was [] forever.
    expect(out.map((s) => s.date)).toEqual(['2026-07-07'])
    expect(out[0].burned).toBe(1)
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: expect.objectContaining({ auto_burn_last_processed: '2026-07-06' }),
    })
  })

  it('a FUTURE marker is treated as unset, loudly, and the day is reseeded sanely', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2027-01-01' }),
    )
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.date)).toEqual(['2026-07-07'])
    expect(said()).toContain('marker is in the FUTURE')
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: expect.objectContaining({ auto_burn_last_processed: '2026-07-06' }),
    })
  })
})

// G7 (P2). The stall rule has three disjuncts and only one of them was tested.
// A day that stalls must hold the marker back WITHOUT stopping the later days
// from burning.
describe('自動消化 — every stall disjunct holds the marker back', () => {
  const NOW = Date.parse('2026-07-07T02:00:00.000Z')

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-04' }),
    )
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("an UNAVAILABLE day (settings unreadable mid-window) stalls it — later days still burn", async () => {
    // Call 1 is the marker read; call 2 is 07-05's own settings read.
    let n = 0
    orgSettingsGet.mockImplementation(async () => {
      n += 1
      if (n === 2) throw new Error('core down')
      return settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-04' })
    })
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.mode)).toEqual(['unavailable', 'auto', 'auto'])
    expect(out[1].burned).toBe(1)
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })

  it('an ERRORED day stalls it — later days still burn', async () => {
    apptList.mockRejectedValueOnce(new Error('core down'))
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.errors)).toEqual([1, 0, 0])
    expect(out[1].burned).toBe(1)
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })
})

// G7 (P2), second half: the audit row itself was completely untested. A ticket
// that moves with no staff touching anything has to be as disputable after the
// fact as a staff burn.
describe('自動消化 — the audit row', () => {
  it('emits ONE customer.pack_redeem, actor system, carrying the correlation ids', async () => {
    const lines = await auditLines(async () => {
      expect((await run()).burned).toBe(1)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'customer',
      action: 'customer.pack_redeem',
      actor_id: null,
      actor_type: 'system',
      business_id: 'biz-1',
      target_type: 'customer',
      target_id: 'cust-1',
      severity: 'notice',
      source: 'system',
      detail: {
        appointment_id: 'appt-1',
        pack_id: 'pack-1',
        redemption_id: 'redemption-1',
        redeemed_on: DATE,
        source: 'auto',
      },
    })
  })

  it('emits NOTHING when the guards skip the burn', async () => {
    listRecentRedemptions.mockImplementation(async () => [
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: DATE },
    ])
    const lines = await auditLines(async () => {
      expect((await run()).skippedAlreadyBurned).toBe(1)
    })
    expect(lines).toHaveLength(0)
  })
})

// G9 (P3). A business that is not in auto mode has nothing to settle, so it
// must not collect a marker every night — and the day it flips on must still
// read as a genuine first run.
describe('自動消化 — a non-auto business earns no marker', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-07T02:00:00.000Z'))
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("mode 'manual' writes no marker at all", async () => {
    orgSettingsGet.mockImplementation(async () => settingsRow({ pack_burn_mode: 'manual' }))
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.mode)).toEqual(['manual'])
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })

  it('packs disabled writes no marker either', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', ticket_packs_enabled: false }),
    )
    const out = await autoBurnRecentDays(client(), 'biz-1')
    expect(out.map((s) => s.mode)).toEqual(['packs_disabled'])
    expect(orgSettingsUpsert).not.toHaveBeenCalled()
  })
})

// G11 (P3). The 40-page cap is the money cron's "stop rather than spin" rule
// for a core that keeps reporting more than it sends.
describe('自動消化 — the pagination cap terminates', () => {
  it('stops at 40 pages when `total` never gets covered', async () => {
    apptList.mockImplementation(async (o) => {
      const n = (o as { page: number }).page
      return page([appt({ id: `appt-${n}` })], 999_999)
    })
    const s = await run()
    expect(apptList).toHaveBeenCalledTimes(40)
    // One customer across all 40 → guard 2 still holds inside the same run.
    expect(s).toMatchObject({ candidates: 40, burned: 1, skippedSameDay: 39 })
  })
})

// G5 (P2). 自動消化 OFF→ON is a FORWARD-GOING decision, and the settings write
// is the one place the transition is visible. Without the seed the first sweep
// after a mid-day flip retro-charges every booking that already ended today —
// the opposite of what the hint copy promises.
describe('自動消化 — flipping the switch ON seeds the marker', () => {
  const writeClient = () =>
    ({ orgSettings: { get: orgSettingsGet, upsert: orgSettingsUpsert } }) as unknown as Parameters<
      typeof writeOrgSettingsBlobWithClient
    >[0]

  it('OFF→ON settles TODAY, so burning starts with tomorrow, not this morning', async () => {
    orgSettingsGet.mockImplementation(async () => settingsRow({ pack_burn_mode: 'manual' }))
    await expect(
      writeOrgSettingsBlobWithClient(writeClient(), { pack_burn_mode: 'auto' }),
    ).resolves.toEqual({ success: true })
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', auto_burn_last_processed: ymdInJst() },
    })
  })

  // Both switches gate the cron, so both gate the seed: 回数券 coming back on
  // after a break must not let the catch-up window reach into the days it was
  // off (the mode stays 'auto' in the merged blob the whole time).
  it('回数券 OFF→ON seeds too, even though the mode never moved', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', ticket_packs_enabled: false }),
    )
    await writeOrgSettingsBlobWithClient(writeClient(), {
      ticket_packs_enabled: true,
      pack_burn_mode: 'auto',
    })
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: expect.objectContaining({ auto_burn_last_processed: ymdInJst() }),
    })
  })

  it('turning 回数券 OFF seeds nothing — it is not a transition ON', async () => {
    orgSettingsGet.mockImplementation(async () => settingsRow({ pack_burn_mode: 'auto' }))
    await writeOrgSettingsBlobWithClient(writeClient(), { ticket_packs_enabled: false })
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', ticket_packs_enabled: false },
    })
  })

  it("the cron's OWN marker write passes through untouched", async () => {
    orgSettingsGet.mockImplementation(async () => settingsRow({ pack_burn_mode: 'auto' }))
    await writeOrgSettingsBlobWithClient(writeClient(), {
      auto_burn_last_processed: '2026-07-06',
    })
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-06' },
    })
  })

  it('an ALREADY-auto save leaves the marker alone — a re-save must not stall a catch-up', async () => {
    orgSettingsGet.mockImplementation(async () =>
      settingsRow({ pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-04' }),
    )
    await writeOrgSettingsBlobWithClient(writeClient(), { pack_burn_mode: 'auto' })
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'auto', auto_burn_last_processed: '2026-07-04' },
    })
  })

  it('an UNRELATED settings save never touches the marker', async () => {
    orgSettingsGet.mockImplementation(async () => settingsRow({ pack_burn_mode: 'manual' }))
    await writeOrgSettingsBlobWithClient(writeClient(), { staff_can_customize_packs: false })
    expect(orgSettingsUpsert).toHaveBeenCalledWith({
      settings: { pack_burn_mode: 'manual', staff_can_customize_packs: false },
    })
  })
})
