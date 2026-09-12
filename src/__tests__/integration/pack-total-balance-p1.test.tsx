/**
 * @jest-environment jsdom
 *
 * 回数券 update 25, Layer 1, p1 — "stop asking 'did they buy?' when the
 * customer already holds another pack." The repurchase question (stop
 * dialog + pre-record banner) now fires off the customer's TOTAL usable
 * balance across active counted packs, not the FIFO target's own remaining
 * alone. The FIFO burn target itself (resolve.ts §7, pickRedemptionTarget)
 * is untouched — old 残1 + new 残10 must still burn the OLD pack silently.
 *
 * store-transfer-design.md §7.2 asserted this invariant for resolveOutcomeMode
 * six weeks before any code implemented it (LENS-L1 Finding 3) — the first
 * test below is that regression, named after the doc it closes.
 */
import { render, screen } from '@testing-library/react'
import { resolveOutcomeMode, pickRedemptionTarget } from '@/lib/packs/resolve'
import { buildRecordScreen } from '@/lib/karute/record-screen'
import { RepurchaseCueBanner } from '@/components/karute/redesign/record/RepurchaseCueBanner'
import type { TicketPack } from '@/lib/packs/types'
import type { CustomerWithStaff } from '@/lib/customers/queries'
import type { AppointmentRow } from '@/actions/appointments'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

describe('resolveOutcomeMode — total balance across active counted packs (store-transfer-design.md §7.2)', () => {
  it('old 残1 + new 残10 → auto (the 代官山 incident: the old pack finishes silently)', () => {
    expect(resolveOutcomeMode({ remaining: 1, otherRemaining: 10 })).toBe('auto')
  })
  it('old 残2 + new 残10 → auto', () => {
    expect(resolveOutcomeMode({ remaining: 2, otherRemaining: 10 })).toBe('auto')
  })
  it('old 残1 + new 残1 → repurchase (total 2, the decision point)', () => {
    expect(resolveOutcomeMode({ remaining: 1, otherRemaining: 1 })).toBe('repurchase')
  })
  it('single pack 残2, no other pack → repurchase (unchanged behavior)', () => {
    expect(resolveOutcomeMode({ remaining: 2 })).toBe('repurchase')
  })
  it('残0 everywhere → conversion', () => {
    expect(resolveOutcomeMode({ remaining: 0, otherRemaining: 0 })).toBe('conversion')
  })
  it('null → conversion', () => {
    expect(resolveOutcomeMode(null)).toBe('conversion')
  })
  it('a missing otherRemaining degrades to the single-pack read (old fixture / old server payload — honest degrade, never a lie)', () => {
    expect(resolveOutcomeMode({ remaining: 1 })).toBe('repurchase')
    expect(resolveOutcomeMode({ remaining: 10 })).toBe('auto')
  })
})

describe('pickRedemptionTarget stays FIFO — the total-balance rule never touches the burn target', () => {
  const base = { kind: 'pack', status: 'active' as const }
  it('old 残1 + new 残10 → FIFO still targets the OLD pack', () => {
    const packs = [
      { ...base, id: 'new', remaining: 10, purchased_at: '2026-08-30' },
      { ...base, id: 'old', remaining: 1, purchased_at: '2026-04-29' },
    ]
    expect(pickRedemptionTarget(packs)?.id).toBe('old')
  })
})

const CUSTOMER_ID = 'cust-1'
const walkInCustomer = { id: CUSTOMER_ID, name: 'テスト客' } as unknown as CustomerWithStaff
const booking = {
  id: 'appt-1',
  client_id: CUSTOMER_ID,
  staff_profile_id: 's1',
  start_time: '2026-09-12T02:00:00.000Z',
  duration_minutes: 60,
  title: null,
  notes: null,
  karute_record_id: null,
  customers: { name: 'テスト客' },
} as unknown as AppointmentRow

function pack(over: Partial<TicketPack> & { id: string }): TicketPack {
  return {
    customer_id: CUSTOMER_ID,
    kind: 'pack',
    pack_size: 10,
    unit_price: 9900,
    total_price: 99000,
    purchase_round: 1,
    purchased_at: '2026-01-01',
    source: 'manual',
    status: 'active',
    notes: null,
    ...over,
  }
}

// listPacks returns PackWithUsage rows — the fixture states its own 残数
// directly rather than deriving it from a redemption count.
function packWithUsage(over: Partial<TicketPack> & { id: string; remaining: number }) {
  const { remaining, ...rest } = over
  return { ...pack(rest), redeemedCount: 0, remaining, unconsumedValue: 0, lastRedeemedOn: null }
}

async function screenFor(packs: ReturnType<typeof packWithUsage>[]) {
  return buildRecordScreen({
    locale: 'ja',
    now: new Date('2026-09-12T03:00:00.000Z'),
    activeStaffId: 's1',
    staffList: [{ id: 's1', full_name: 'Staff' }],
    customers: [],
    todayAppts: [booking],
    orgSettings: null,
    statusLabel: () => '',
    deps: {
      resolveExplicitAppointment: async () => null,
      resolveWalkInCustomer: async () => walkInCustomer,
      getTargetCustomer: async () => null,
      getConsent: async () => null,
      getKaruteRecords: async () => [],
      listPacks: async () => packs,
      getLifecycle: async () => ({ ok: true as const, lifecycle: null }),
    },
  })
}

describe('record-screen.ts — targetPack.otherRemaining (the live DTO path)', () => {
  it('two-pack fixture: otherRemaining sums the OTHER active counted pack, FIFO target is the old pack', async () => {
    const oldPack = packWithUsage({ id: 'old', purchased_at: '2026-04-29', remaining: 1 })
    const newPack = packWithUsage({ id: 'new', purchased_at: '2026-08-30', remaining: 10 })
    const result = await screenFor([newPack, oldPack])
    expect(result.targetPack).toEqual({ id: 'old', remaining: 1, size: 10, otherRemaining: 10 })
  })

  it('single-pack fixture: otherRemaining is 0', async () => {
    const only = packWithUsage({ id: 'only', remaining: 2 })
    const result = await screenFor([only])
    expect(result.targetPack).toEqual({ id: 'only', remaining: 2, size: 10, otherRemaining: 0 })
  })

  // p5 (B2) — withUsage computes `remaining` regardless of status, so a
  // cancelled pack keeps a positive remaining. otherRemaining must still
  // exclude it, or a cancelled pack's leftover sessions could push the total
  // over 2 and silently suppress the repurchase question — the live shape
  // this update was written for (an old pack 残1, a new 10-pack, and a
  // cancelled round-3 pack).
  it('a CANCELLED pack with sessions left never inflates otherRemaining (the live round-3 case)', async () => {
    const oldPack = packWithUsage({ id: 'old', purchased_at: '2026-04-29', remaining: 1 })
    const cancelled = packWithUsage({
      id: 'x',
      purchased_at: '2026-09-01',
      remaining: 10,
      status: 'cancelled',
    })
    const result = await screenFor([cancelled, oldPack])
    expect(result.targetPack).toEqual({ id: 'old', remaining: 1, size: 10, otherRemaining: 0 })
  })

  // N12 — a subscription-only customer never reaches the pack-target math at
  // all: pickRedemptionTarget filters kind === 'pack', so targetPack is
  // null and resolveOutcomeMode(null) reads 'conversion', as today.
  it('subscription-only fixture: targetPack is null → conversion (N12)', async () => {
    const sub = packWithUsage({ id: 'sub', remaining: 5, kind: 'subscription' })
    const result = await screenFor([sub])
    expect(result.targetPack).toBeNull()
    expect(resolveOutcomeMode(result.targetPack)).toBe('conversion')
  })
})

describe('RepurchaseCueBanner — renders off the SAME resolver, never its own arithmetic', () => {
  it('two-pack customer (total 11) → renders nothing', () => {
    render(<RepurchaseCueBanner pack={{ remaining: 1, size: 10, otherRemaining: 10 }} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('single 残1, no other pack → renders', () => {
    render(<RepurchaseCueBanner pack={{ remaining: 1, size: 10 }} />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  // N1 — the title reads the FIFO pack's OWN remaining, never the total: two
  // packs each at 残1 (total 2, still the repurchase decision point) must
  // read 残り1回, never 残り2回.
  it("two packs each at 残1 (total 2) → title reads the FIFO pack's own 1, never the total 2", () => {
    render(<RepurchaseCueBanner pack={{ remaining: 1, size: 6, otherRemaining: 1 }} />)
    expect(screen.getByText('title:{"n":1}')).toBeInTheDocument()
  })
})
