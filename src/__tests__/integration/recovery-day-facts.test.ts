/**
 * PR-B1 D2/D4 (server side) — the recording DAY's facts.
 *
 * The re-point picker's whole anti-fraud property is that its rows come from
 * the day the AUDIO was recorded, computed on the server, under the same store
 * clamp every other recording surface applies. If this derivation drifts to
 * "today", a take from yesterday could be re-pointed at a customer who was
 * never in the salon when it was recorded — which is the misattribution the
 * day restriction exists to close.
 *
 * The 回数券 truth is DERIVED here too (packs − redemptions), and the burn
 * history is TRI-STATE: an unreadable read must come back `redeemed: null` so
 * the banner says nothing, never a calm-looking 未処理 about money (F7).
 */
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

const appointmentsList = jest.fn(async (_q: Record<string, unknown>) => ({
  appointments: [
    {
      id: 'appt-1',
      customer_id: 'cust-1',
      staff_id: 'staff-1',
      starts_at: '2026-08-18T04:00:00.000Z', // 13:00 JST
      duration_minutes: 60,
      title: 'トリートメント',
      notes: null,
      status: 'SCHEDULED',
      source: 'manual',
      created_at: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'appt-cancelled',
      customer_id: 'cust-3',
      staff_id: 'staff-1',
      starts_at: '2026-08-18T07:00:00.000Z',
      duration_minutes: 60,
      title: 'カット',
      notes: null,
      status: 'CANCELLED',
      source: 'manual',
      created_at: '2026-08-01T00:00:00.000Z',
    },
  ],
  total: 2,
}))
const listRecentRedemptions = jest.fn(
  async (_since: string): Promise<{ customer_id: string; appointment_id: string | null; redeemed_on: string }[]> => [
    { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on: '2026-08-18' },
  ],
)
const listActivePacks = jest.fn(async () => [
  { id: 'pack-1', customer_id: 'cust-1', kind: 'pack', pack_size: 6, unit_price: 10000 },
  { id: 'pack-2', customer_id: 'cust-PINNED', kind: 'pack', pack_size: 10, unit_price: 9000 },
  // Another customer's pack: never emitted — nobody in the picker can reach them.
  { id: 'pack-3', customer_id: 'cust-ELSEWHERE', kind: 'pack', pack_size: 4, unit_price: 8000 },
])
// 回数券 update 25, p2 — the per-customer REAL rows (with status/purchased_at,
// which core's bulk listActivePacks above deliberately lacks) that
// listCustomerPacksWithClient reads to compute each row's FIFO `target`.
// One pack per customer here, mirroring listActivePacks above — the
// multi-pack (otherRemaining) case gets its own dedicated test below.
const PACKS_BY_CUSTOMER: Record<string, unknown[]> = {
  'cust-1': [
    {
      id: 'pack-1',
      customer_id: 'cust-1',
      kind: 'pack',
      pack_size: 6,
      unit_price: 10000,
      status: 'active',
      purchased_at: '2026-01-01',
      purchase_round: 1,
      source: 'manual',
      notes: null,
      total_price: null,
    },
  ],
  'cust-PINNED': [
    {
      id: 'pack-2',
      customer_id: 'cust-PINNED',
      kind: 'pack',
      pack_size: 10,
      unit_price: 9000,
      status: 'active',
      purchased_at: '2026-01-02',
      purchase_round: 1,
      source: 'manual',
      notes: null,
      total_price: null,
    },
  ],
  'cust-ELSEWHERE': [
    {
      id: 'pack-3',
      customer_id: 'cust-ELSEWHERE',
      kind: 'pack',
      pack_size: 4,
      unit_price: 8000,
      status: 'active',
      purchased_at: '2026-01-03',
      purchase_round: 1,
      source: 'manual',
      notes: null,
      total_price: null,
    },
  ],
}
const REDEMPTIONS_BY_CUSTOMER: Record<string, { pack_id: string; redeemed_on: string }[]> = {
  'cust-1': [{ pack_id: 'pack-1', redeemed_on: '2026-08-18' }],
}
const listPacks = jest.fn(async (cid: string) => PACKS_BY_CUSTOMER[cid] ?? [])
const listRedemptions = jest.fn(async (cid: string) => REDEMPTIONS_BY_CUSTOMER[cid] ?? [])

jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: jest.fn(async () => ({
    customers: [
      { id: 'cust-1', name: '田中 花子', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'cust-PINNED', name: '佐藤 美咲', created_at: '2026-01-02T00:00:00.000Z' },
    ],
    total: 2,
  })),
}))

import { buildRecoveryDayFacts } from '@/lib/karute/recovery-facts'

type Client = Parameters<typeof buildRecoveryDayFacts>[0]

function client(): Client {
  return {
    appointments: { list: (q: Record<string, unknown>) => appointmentsList(q) },
    karuteRecords: { list: async () => ({ karute_records: [], total: 0 }) },
    staff: { list: async () => ({ staff: [{ id: 'staff-1', name: '原', user_id: 'staff-1' }] }) },
    customers: {},
    packs: {
      listRecentRedemptions: (s: string) => listRecentRedemptions(s),
      listActivePacks: () => listActivePacks(),
      listAllRedemptionPackIds: async () => ['pack-1'],
      listPacks: (cid: string) => listPacks(cid),
      listRedemptions: (cid: string) => listRedemptions(cid),
    },
  } as unknown as Client
}

const run = (over: Partial<Parameters<typeof buildRecoveryDayFacts>[1]> = {}) =>
  buildRecoveryDayFacts(client(), {
    dateYmd: '2026-08-18',
    statusLabel: (k) => k,
    ...over,
  })

const ORIGINAL_PACKS_CUST_1 = PACKS_BY_CUSTOMER['cust-1']
beforeEach(() => jest.clearAllMocks())
afterEach(() => {
  // The two-pack test below mutates this fixture in place — restore it so
  // test order never matters.
  PACKS_BY_CUSTOMER['cust-1'] = ORIGINAL_PACKS_CUST_1
})

describe('the day window is the RECORDING day, in JST', () => {
  it('queries that JST calendar day, not today', async () => {
    await run()
    const q = appointmentsList.mock.calls[0][0]
    expect(q.from).toBe(new Date('2026-08-18T00:00:00+09:00').toISOString())
    expect(q.to).toBe(new Date('2026-08-18T23:59:59.999+09:00').toISOString())
  })

  it('applies the caller’s store clamp', async () => {
    await run({ storeId: 'store-A' })
    expect(appointmentsList.mock.calls[0][0].store_id).toBe('store-A')
  })

  it('renders times in JST and drops terminal bookings', async () => {
    const facts = await run()
    expect(facts.bookings.map((b) => b.id)).toEqual(['appt-1'])
    expect(facts.bookings[0].start).toBe('13:00')
    expect(facts.bookings[0].customer).toBe('田中 花子')
    expect(facts.bookings[0].karute).toBe('#00001')
  })
})

describe('回数券 rows are derived, and scoped to who the picker can reach', () => {
  it('emits the FIFO burn target for a booked customer', async () => {
    const facts = await run()
    const row = facts.packs.find((p) => p.customerId === 'cust-1')
    // 6-session pack, one redemption on the ledger → 残5/6. Single pack, so
    // target mirrors the aggregate with otherRemaining 0.
    expect(row).toEqual({
      customerId: 'cust-1',
      packId: 'pack-1',
      remaining: 5,
      size: 6,
      target: { remaining: 5, size: 6, otherRemaining: 0 },
    })
  })

  it('includes the PINNED customer even with no booking that day', async () => {
    const facts = await run({ pinnedCustomerIds: ['cust-PINNED'] })
    expect(facts.packs.find((p) => p.customerId === 'cust-PINNED')).toEqual({
      customerId: 'cust-PINNED',
      packId: 'pack-2',
      remaining: 10,
      size: 10,
      target: { remaining: 10, size: 10, otherRemaining: 0 },
    })
  })

  it('never leaks a customer nobody on this list can reach', async () => {
    const facts = await run({ pinnedCustomerIds: ['cust-PINNED'] })
    expect(facts.packs.some((p) => p.customerId === 'cust-ELSEWHERE')).toBe(false)
  })

  // F-1(a): the banner sends BOTH the original binding AND the current
  // destination. A search re-point lands on a customer who is neither pinned
  // nor booked that day — with one id only, the server built no pack row for
  // them and the save silently dropped the burn question.
  it('includes EVERY id it is given, not just the first', async () => {
    const facts = await run({ pinnedCustomerIds: ['cust-PINNED', 'cust-ELSEWHERE'] })
    expect(facts.packs.map((p) => p.customerId).sort()).toEqual([
      'cust-1',
      'cust-ELSEWHERE',
      'cust-PINNED',
    ])
  })

  it('tolerates null/undefined ids in the list (unbound take, no original)', async () => {
    const facts = await run({ pinnedCustomerIds: [null, undefined, 'cust-PINNED'] })
    expect(facts.packs.some((p) => p.customerId === 'cust-PINNED')).toBe(true)
  })

  // 回数券 update 25, p2 (LENS-L1 Finding 1) — a two-pack customer's `target`
  // is the OLD (FIFO) pack's own remaining/size + otherRemaining from the
  // NEW pack, never the aggregate dressed up as one pack's before/after.
  it('a two-pack customer: target is the OLD pack`s own numbers + otherRemaining from the new pack', async () => {
    // The AGGREGATE (core's bulk listActivePacks) must carry both packs too —
    // otherwise this fixture would test a state that can't occur for real
    // (aggregate and per-customer fan-out disagreeing about pack count).
    // N3 — pack-1b listed BEFORE pack-1: core's bulk order carries no
    // purchased_at, so it must NOT be what decides the FIFO pick. Listing
    // the newer pack first here proves packId comes from the per-customer
    // REAL rows (which DO carry purchased_at) and not from this order.
    listActivePacks.mockResolvedValueOnce([
      { id: 'pack-1b', customer_id: 'cust-1', kind: 'pack', pack_size: 10, unit_price: 9900 },
      { id: 'pack-1', customer_id: 'cust-1', kind: 'pack', pack_size: 6, unit_price: 10000 },
      { id: 'pack-2', customer_id: 'cust-PINNED', kind: 'pack', pack_size: 10, unit_price: 9000 },
    ])
    PACKS_BY_CUSTOMER['cust-1'] = [
      {
        id: 'pack-1',
        customer_id: 'cust-1',
        kind: 'pack',
        pack_size: 6,
        unit_price: 10000,
        status: 'active',
        purchased_at: '2026-01-01',
        purchase_round: 1,
        source: 'manual',
        notes: null,
        total_price: null,
      },
      {
        id: 'pack-1b',
        customer_id: 'cust-1',
        kind: 'pack',
        pack_size: 10,
        unit_price: 9900,
        status: 'active',
        purchased_at: '2026-08-30',
        purchase_round: 2,
        source: 'manual',
        notes: null,
        total_price: null,
      },
    ]
    const facts = await run()
    const row = facts.packs.find((p) => p.customerId === 'cust-1')
    // Aggregate (remaining/size) is untouched — Σ across both packs: 5 + 10.
    expect(row).toEqual({
      customerId: 'cust-1',
      packId: 'pack-1',
      remaining: 15,
      size: 16,
      target: { remaining: 5, size: 6, otherRemaining: 10 },
    })
  })

  // D5: never a row with a GUESSED target — a per-customer read failure nulls
  // the whole fan-out, degrading EXACTLY like a failed listAllPackUsageWithClient
  // does today (no pack rows at all).
  it('a per-customer fan-out failure drops ALL pack rows, never a guessed target', async () => {
    listPacks.mockRejectedValueOnce(new Error('core down'))
    const facts = await run({ pinnedCustomerIds: ['cust-PINNED'] })
    expect(facts.packs).toEqual([])
    expect(facts.bookings).toHaveLength(1)
  })

  // B2's twin — recovery-facts.ts:199 carries the SAME `status === 'active'`
  // guard as record-screen.ts:514; a cancelled pack with sessions left must
  // never inflate the recovery path's otherRemaining either.
  it('a CANCELLED pack with sessions left never inflates otherRemaining (recovery-facts.ts:199)', async () => {
    listActivePacks.mockResolvedValueOnce([
      { id: 'pack-1', customer_id: 'cust-1', kind: 'pack', pack_size: 6, unit_price: 10000 },
      { id: 'pack-2', customer_id: 'cust-PINNED', kind: 'pack', pack_size: 10, unit_price: 9000 },
    ])
    PACKS_BY_CUSTOMER['cust-1'] = [
      {
        id: 'pack-1',
        customer_id: 'cust-1',
        kind: 'pack',
        pack_size: 6,
        unit_price: 10000,
        status: 'active',
        purchased_at: '2026-01-01',
        purchase_round: 1,
        source: 'manual',
        notes: null,
        total_price: null,
      },
      {
        id: 'pack-x',
        customer_id: 'cust-1',
        kind: 'pack',
        pack_size: 10,
        unit_price: 9900,
        status: 'cancelled',
        purchased_at: '2026-09-01',
        purchase_round: 2,
        source: 'manual',
        notes: null,
        total_price: null,
      },
    ]
    const facts = await run()
    const row = facts.packs.find((p) => p.customerId === 'cust-1')
    expect(row?.target).toEqual({ remaining: 5, size: 6, otherRemaining: 0 })
  })
})

describe('the burn history is TRI-STATE', () => {
  it('reports the day’s burns by appointment AND by customer', async () => {
    const facts = await run()
    expect(facts.redeemed).toEqual({
      appointmentIds: ['appt-1'],
      customerIds: ['cust-1'],
    })
  })

  it('keeps a burn on ANOTHER day out of the customer set (the walk-in key)', async () => {
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: null, redeemed_on: '2026-08-17' },
    ])
    const facts = await run()
    expect(facts.redeemed).toEqual({ appointmentIds: [], customerIds: [] })
  })

  it('reads history from ONE JST day back', async () => {
    await run()
    expect(listRecentRedemptions).toHaveBeenCalledWith('2026-08-17')
  })

  // T-8: core's redeemed_on is a CALENDAR DATE by contract, but the ledger has
  // been observed carrying a full timestamp too. Both must read the same, or a
  // burn silently drops out of the customer-day set and the banner says 未処理
  // over money that already moved.
  it.each([
    ['bare calendar date', '2026-08-18'],
    ['full ISO timestamp', '2026-08-18T04:30:00.000Z'],
    ['date + time, no zone', '2026-08-18 04:30:00'],
  ])('reads a %s redeemed_on identically', async (_label, redeemed_on) => {
    listRecentRedemptions.mockResolvedValueOnce([
      { customer_id: 'cust-1', appointment_id: 'appt-1', redeemed_on },
    ])
    const facts = await run()
    expect(facts.redeemed).toEqual({ appointmentIds: ['appt-1'], customerIds: ['cust-1'] })
  })

  it('an UNREADABLE history is null — never an empty set that reads as 未処理', async () => {
    listRecentRedemptions.mockRejectedValueOnce(new Error('core down'))
    const facts = await run()
    expect(facts.redeemed).toBeNull()
    // The bookings still render — only the money claim is withheld.
    expect(facts.bookings).toHaveLength(1)
  })

  it('an unreadable PACK aggregate costs the pill, not the screen', async () => {
    listActivePacks.mockRejectedValueOnce(new Error('core down'))
    const facts = await run()
    expect(facts.packs).toEqual([])
    expect(facts.bookings).toHaveLength(1)
  })
})

export {}
