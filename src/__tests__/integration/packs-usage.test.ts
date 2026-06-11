import { withUsage, type TicketPack } from '@/lib/packs/types'

// The 残回数/消化残高 math — ONE function, every surface. These cases mirror
// Kitano's sheet so the import reproduces his numbers exactly.

const pack = (over: Partial<TicketPack> = {}): TicketPack => ({
  id: 'p1',
  customer_id: 'c1',
  kind: 'pack',
  pack_size: 10,
  unit_price: 9900,
  total_price: null,
  purchase_round: 0,
  purchased_at: '2025-09-19',
  source: 'import',
  status: 'active',
  notes: null,
  ...over,
})

describe('withUsage (single source for 残回数/消化残高)', () => {
  it('sheet case: 10回券 @¥9,900, 6 consumed → 残4, ¥39,600', () => {
    const p = withUsage(pack(), 6)
    expect(p.remaining).toBe(4)
    expect(p.unconsumedValue).toBe(39_600)
  })

  it('sheet case: 3回券 @¥8,800, 1 consumed → 残2, ¥17,600 (田久美子)', () => {
    const p = withUsage(pack({ pack_size: 3, unit_price: 8800 }), 1)
    expect(p.remaining).toBe(2)
    expect(p.unconsumedValue).toBe(17_600)
  })

  it('fully consumed → 残0, ¥0', () => {
    const p = withUsage(pack({ pack_size: 3 }), 3)
    expect(p.remaining).toBe(0)
    expect(p.unconsumedValue).toBe(0)
  })

  it('over-consumed never goes negative (data-entry safety)', () => {
    const p = withUsage(pack({ pack_size: 3 }), 5)
    expect(p.remaining).toBe(0)
    expect(p.unconsumedValue).toBe(0)
  })

  it('サブスク (¥0 unit price) → value 0 regardless of remaining', () => {
    const p = withUsage(
      pack({ kind: 'subscription', pack_size: 4, unit_price: 0 }),
      1,
    )
    expect(p.remaining).toBe(3)
    expect(p.unconsumedValue).toBe(0)
  })
})

describe('FIFO redemption targeting (§7 — finish the old ticket first)', () => {
  const { pickRedemptionTarget } = jest.requireActual('@/lib/packs/resolve')
  const pack = (over = {}) => ({
    id: 'p1', kind: 'pack', status: 'active', remaining: 3,
    purchased_at: '2025-11-05', ...over,
  })
  it('targets the OLDEST active pack with sessions left', () => {
    const old = pack({ id: 'old', purchased_at: '2025-11-05', remaining: 1 })
    const fresh = pack({ id: 'new', purchased_at: '2026-06-11', remaining: 10 })
    expect(pickRedemptionTarget([fresh, old])?.id).toBe('old')
  })
  it('skips exhausted/inactive/non-pack rows', () => {
    const exhausted = pack({ id: 'x', remaining: 0 })
    const voided = pack({ id: 'v', status: 'void' })
    const sub = pack({ id: 's', kind: 'subscription' })
    const live = pack({ id: 'live', purchased_at: '2026-01-01' })
    expect(pickRedemptionTarget([exhausted, voided, sub, live])?.id).toBe('live')
  })
  it('null-purchased_at packs sort last; empty list → null', () => {
    const dated = pack({ id: 'dated' })
    const undated = pack({ id: 'undated', purchased_at: null })
    expect(pickRedemptionTarget([undated, dated])?.id).toBe('dated')
    expect(pickRedemptionTarget([])).toBeNull()
  })
})

describe('cross-pack renewal detection is customer-level (§7 regression)', () => {
  const { resolvePackAlert } = jest.requireActual('@/lib/packs/resolve')
  it('the renewal IS detected: aggregated usage treats her as a normal holder', () => {
    // usage aggregates ALL packs (remaining 0+10): she renewed, so within the
    // threshold she must be silent — the exhausted OLD pack alone must never
    // fire as if she had not renewed.
    expect(resolvePackAlert({
      hasActivePack: true, remainingTotal: 10,
      hasNextBooking: false, daysSinceLastVisit: 5,
    })).toBe(null)
  })
  it('…and a renewed-but-vanished holder still alerts (stranded sessions rule)', () => {
    expect(resolvePackAlert({
      hasActivePack: true, remainingTotal: 10,
      hasNextBooking: false, daysSinceLastVisit: 30,
    })).toBe('contact')
  })
})
