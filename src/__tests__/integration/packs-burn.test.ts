/**
 * 今月消化 money math (lib/packs/burn) — the strip's 案A stat. Every case here
 * is a false-number hazard: month windows, the same-period clamp, the JST
 * date line, and the unpriced-row honesty gate.
 */
import {
  burnDeltaPct,
  burnFetchSinceYmd,
  monthlyBurnByCustomer,
  type BurnRedemption,
} from '@/lib/packs/burn'

const r = (customer_id: string, redeemed_on: string, unit_price: number | null = 8000): BurnRedemption => ({
  customer_id,
  redeemed_on,
  unit_price,
})

// Midday JST — no date-line ambiguity unless a test wants it.
const jst = (ymdHm: string) => new Date(`${ymdHm}:00+09:00`)

describe('monthlyBurnByCustomer — month windows', () => {
  const now = jst('2026-07-17T12:00')

  it('buckets this-month rows into mtd and prev-month same-window rows into prev', () => {
    const { byCustomer, unpricedCustomers } = monthlyBurnByCustomer(
      [r('a', '2026-07-01'), r('a', '2026-07-17'), r('a', '2026-06-05', 6000)],
      now,
    )
    expect(unpricedCustomers).toEqual([])
    expect(byCustomer['a']).toEqual({ mtd: 16000, prev: 6000 })
  })

  it('SAME-PERIOD rule: prev-month days past today\'s day-of-month are excluded', () => {
    // 6/18–6/30 would inflate prev vs a 17-day mtd — part-month vs full-month
    // always reads as a crash.
    const { byCustomer } = monthlyBurnByCustomer(
      [r('a', '2026-06-17'), r('a', '2026-06-18'), r('a', '2026-06-30')],
      now,
    )
    expect(byCustomer['a']).toEqual({ mtd: 0, prev: 8000 })
  })

  it('rows before the previous month are ignored', () => {
    const { byCustomer } = monthlyBurnByCustomer([r('a', '2026-05-31')], now)
    expect(byCustomer['a']).toBeUndefined()
  })

  it('keeps customers separate', () => {
    const { byCustomer } = monthlyBurnByCustomer(
      [r('a', '2026-07-02', 5000), r('b', '2026-07-03', 7000)],
      now,
    )
    expect(byCustomer['a']).toEqual({ mtd: 5000, prev: 0 })
    expect(byCustomer['b']).toEqual({ mtd: 7000, prev: 0 })
  })

  it('clamps the prev window to shorter months (3/31 → 2/28)', () => {
    const { byCustomer } = monthlyBurnByCustomer(
      [r('a', '2026-02-28'), r('a', '2026-03-15')],
      jst('2026-03-31T12:00'),
    )
    expect(byCustomer['a']).toEqual({ mtd: 8000, prev: 8000 })
  })

  it('January compares against last December', () => {
    const { byCustomer } = monthlyBurnByCustomer(
      [r('a', '2025-12-03'), r('a', '2026-01-04')],
      jst('2026-01-05T12:00'),
    )
    expect(byCustomer['a']).toEqual({ mtd: 8000, prev: 8000 })
  })

  it('uses the JST calendar day: UTC still in last month, JST already rolled over', () => {
    // 2026-08-01 00:30 JST = 2026-07-31 15:30 UTC. The month is August in
    // the business's world, so 7/31 is a PREV-window row, not mtd.
    const { byCustomer } = monthlyBurnByCustomer(
      [r('a', '2026-07-31'), r('a', '2026-08-01')],
      jst('2026-08-01T00:30'),
    )
    expect(byCustomer['a']).toEqual({ mtd: 8000, prev: 0 })
    // ...and 7/31 falls OUT of prev (same-period window is 7/1..7/1).
  })
})

describe('monthlyBurnByCustomer — honesty gate', () => {
  const now = jst('2026-07-17T12:00')

  it('an unpriced IN-WINDOW row marks that CUSTOMER unpriceable (view hides, no undercount)', () => {
    const { unpricedCustomers, byCustomer } = monthlyBurnByCustomer(
      [r('a', '2026-07-02'), r('b', '2026-07-03', null)],
      now,
    )
    expect(unpricedCustomers).toEqual(['b'])
    // a's sum stays exact — b's problem must not blank other customers.
    expect(byCustomer['a']).toEqual({ mtd: 8000, prev: 0 })
  })

  it('an unpriced OUT-of-window row is irrelevant', () => {
    const { unpricedCustomers } = monthlyBurnByCustomer(
      [r('a', '2026-07-02'), r('b', '2026-06-25', null)],
      now,
    )
    expect(unpricedCustomers).toEqual([])
  })
})

describe('burnDeltaPct', () => {
  it('rounds the % change vs the prev window', () => {
    expect(burnDeltaPct(112_000, 100_000)).toBe(12)
    expect(burnDeltaPct(88_000, 100_000)).toBe(-12)
    expect(burnDeltaPct(100_000, 100_000)).toBe(0)
  })

  it('null when there is no prev-window burn (a % of zero is meaningless)', () => {
    expect(burnDeltaPct(50_000, 0)).toBeNull()
  })
})

describe('burnFetchSinceYmd', () => {
  it('first day of the previous JST month', () => {
    expect(burnFetchSinceYmd(jst('2026-07-17T12:00'))).toBe('2026-06-01')
    expect(burnFetchSinceYmd(jst('2026-01-05T12:00'))).toBe('2025-12-01')
  })
})
