import { ymdInJst } from '@/lib/date/jst'

// 今月消化 (this month's burned ¥) — the flow counterpart to the strip's
// 未消化 stock number. Pure math over dated redemptions; the ONE place the
// month-window rules live.
//
// Honesty rules (false numbers are a business hazard — Liam 7/17):
// - A redemption prices as its pack's unit_price. Any IN-WINDOW row without a
//   price (orphaned pack, or core hasn't shipped priced rows yet) marks that
//   CUSTOMER unpriceable; a view containing them HIDES the stat — never a
//   partial sum. Views without them stay exact, so one store's data problem
//   can't blank the whole business (fleet finding, 7/18).
// - The ▲% compares this month-to-date against the SAME day-window of the
//   previous month (1st..same day-of-month, clamped to the shorter month) —
//   comparing a part-month against a full month would always read as a crash.
// - redeemed_on is a JST business date (yyyy-mm-dd), so windows are plain
//   string comparisons — no timezone math to get wrong.

export interface BurnRedemption {
  customer_id: string
  redeemed_on: string // yyyy-mm-dd (JST business date)
  unit_price: number | null
}

export interface CustomerBurn {
  /** ¥ burned this month to date. */
  mtd: number
  /** ¥ burned in the previous month's same day-window. */
  prev: number
}

export interface MonthlyBurn {
  byCustomer: Record<string, CustomerBurn>
  /** Customers with an in-window redemption that could not be priced. Their
   *  sums are incomplete — any view showing one of them must hide the stat. */
  unpricedCustomers: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** First day of the previous JST month — the store-layer fetch cutoff. */
export function burnFetchSinceYmd(now: Date = new Date()): string {
  const [y, m] = ymdInJst(now).split('-').map(Number)
  return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`
}

/** Bucket dated redemptions into per-customer {mtd, prev} yen sums. */
export function monthlyBurnByCustomer(
  rows: readonly BurnRedemption[],
  now: Date = new Date(),
): MonthlyBurn {
  const [y, m, d] = ymdInJst(now).split('-').map(Number)
  const mtdStart = `${y}-${pad(m)}-01`
  const mtdEnd = `${y}-${pad(m)}-${pad(d)}`
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  // Date.UTC(py, pm, 0) = last day of month pm (1-12) — clamp 3/31 → 2/28.
  const daysInPrev = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  const prevStart = `${py}-${pad(pm)}-01`
  const prevEnd = `${py}-${pad(pm)}-${pad(Math.min(d, daysInPrev))}`

  const byCustomer: Record<string, CustomerBurn> = {}
  const unpriced = new Set<string>()
  for (const r of rows) {
    const inMtd = r.redeemed_on >= mtdStart && r.redeemed_on <= mtdEnd
    const inPrev = r.redeemed_on >= prevStart && r.redeemed_on <= prevEnd
    if (!inMtd && !inPrev) continue // e.g. prev-month days past the clamp
    if (r.unit_price == null) {
      unpriced.add(r.customer_id)
      continue
    }
    const cur = (byCustomer[r.customer_id] ??= { mtd: 0, prev: 0 })
    if (inMtd) cur.mtd += r.unit_price
    else cur.prev += r.unit_price
  }
  return { byCustomer, unpricedCustomers: [...unpriced] }
}

/** Rounded % change vs the previous same-period window; null when there is
 *  no previous-window burn to compare against (a % of zero is meaningless). */
export function burnDeltaPct(mtd: number, prev: number): number | null {
  if (prev <= 0) return null
  return Math.round(((mtd - prev) / prev) * 100)
}
