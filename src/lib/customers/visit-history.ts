import 'server-only'

// Customer reservation + payment history — DATA CONTRACT.
//
// STATUS: the UI is built and held in a "pending" state. The live path is
// blocked: QuickReserve's `get-customer-reservations-by-customer-id` endpoint
// is version-locked (returns 400 "管理画面の新しいバージョンが利用可能です" — the
// console must be on the current version), and it's the SAME endpoint the deep
// crawl uses, so that path is blocked too. The durable fix is owned by the
// sync pipeline (Anthony): backfill via the WORKING `get-reservations-by-date`
// endpoint into a persistent, readable store, then expose a read.
// Full plan + this contract: docs/quickreserve-visit-history-spec.md
//
// When the read lands, swap the stub in getCustomerVisitHistory for the real
// fetch and run the raw rows through summarizeVisits() — the UI needs no change.

export type VisitStatus = 'settled' | 'booked' | 'cancelled'

export interface CustomerVisit {
  qrReservationId: number
  /** ISO datetime of the reservation start. */
  date: string
  courseName: string | null
  staffName: string | null
  status: VisitStatus
  /** Yen. 0 when no settled bill. */
  salesAmount: number
  note: string | null
}

export interface VisitHistorySummary {
  /** Settled (attended + billed) visits. */
  totalVisits: number
  totalSpend: number
  avgSpend: number
  firstVisit: string | null
  lastVisit: string | null
  cancelledCount: number
  /** Mean days between settled visits — the customer's cadence. */
  avgIntervalDays: number | null
}

export type VisitHistoryReason =
  | 'ok'
  /** Pipeline not wired yet — the UI shows the held "coming soon" state. */
  | 'pending'
  | 'error'

export interface CustomerVisitHistory {
  available: boolean
  reason: VisitHistoryReason
  visits: CustomerVisit[]
  summary: VisitHistorySummary
}

const EMPTY_SUMMARY: VisitHistorySummary = {
  totalVisits: 0,
  totalSpend: 0,
  avgSpend: 0,
  firstVisit: null,
  lastVisit: null,
  cancelledCount: 0,
  avgIntervalDays: null,
}

/**
 * Roll raw visits into the summary band the UI renders. Exported so the wiring
 * (once the backend read exists) can transform raw rows → CustomerVisitHistory
 * with zero UI change. Visits are expected most-recent-first for display.
 */
export function summarizeVisits(visits: CustomerVisit[]): VisitHistorySummary {
  const settled = visits
    .filter((v) => v.status === 'settled')
    .sort((a, b) => a.date.localeCompare(b.date))
  const totalSpend = settled.reduce((s, v) => s + v.salesAmount, 0)
  const totalVisits = settled.length
  const first = settled[0]?.date ?? null
  const last = settled[settled.length - 1]?.date ?? null
  let avgIntervalDays: number | null = null
  if (settled.length >= 2 && first && last) {
    const spanDays =
      (new Date(last).getTime() - new Date(first).getTime()) / 86_400_000
    avgIntervalDays = Math.round(spanDays / (settled.length - 1))
  }
  return {
    totalVisits,
    totalSpend,
    avgSpend: totalVisits ? Math.round(totalSpend / totalVisits) : 0,
    firstVisit: first,
    lastVisit: last,
    cancelledCount: visits.filter((v) => v.status === 'cancelled').length,
    avgIntervalDays,
  }
}

/**
 * Returns a customer's visit + payment history.
 *
 * HELD: returns `pending` until the backend read lands (see the spec). To go
 * live, replace the body with the read + `summarizeVisits(visits)`:
 *   const visits = await <read>(customerId)   // CustomerVisit[]
 *   return { available: true, reason: 'ok', visits, summary: summarizeVisits(visits) }
 */
export async function getCustomerVisitHistory(
  _name: string,
  _memberNumber: string | null,
): Promise<CustomerVisitHistory> {
  return { available: false, reason: 'pending', visits: [], summary: EMPTY_SUMMARY }
}
