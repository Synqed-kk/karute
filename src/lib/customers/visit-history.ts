import 'server-only'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import {
  qrLogin,
  qrGetCustomersServerSide,
  qrGetCustomerReservationsByCustomerId,
  mapVisit,
} from '@/lib/quickreserve'

// Live QuickReserve visit + payment history for one customer.
//
// The deep crawl (api/sync/quickreserve-deep) writes this to synqed
// `customer_visits`, but the synqed SDK exposes no READ for it — so the app
// can't surface it. This module reads the same data straight from QuickReserve
// (the exact calls the crawl uses), so the customer page shows REAL reservation
// + spend history without waiting on a synqed read endpoint.
//
// Two cached layers keep QR load sane:
//  • a name→QR-id index built once per 6h (one paginated sweep, shared by every
//    customer), and
//  • the per-customer history itself, cached 30m.
// Both invalidate on the 'customer-visits' tag.

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

export type VisitHistoryReason = 'ok' | 'not-configured' | 'not-found' | 'error'

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

function emptyHistory(reason: VisitHistoryReason): CustomerVisitHistory {
  return { available: reason === 'ok', reason, visits: [], summary: EMPTY_SUMMARY }
}

interface QrConfig {
  username: string
  password: string
  storeSlug: string
  storeId: number
}

async function loadQrConfig(): Promise<QrConfig | null> {
  const supabase = createServiceClient()
  const { data: config } = await supabase
    .from('sync_config')
    .select('*')
    .eq('provider', 'quickreserve')
    .single()
  if (!config?.username || !config?.password_encrypted) return null
  return {
    username: config.username,
    password: config.password_encrypted,
    storeSlug: config.base_url || 'la-estro',
    storeId: config.store_id || 222,
  }
}

/** Collapse whitespace + trim so synqed names (synced FROM QR) match QR rows. */
function normName(name: string): string {
  return name.replace(/[\s　]+/g, '').trim()
}

interface QrIndexEntry {
  id: number
  membershipId: string | null
}

// name → candidate QR customers (≥1 when 同姓同名). Built once per 6h.
const cachedIndex = unstable_cache(
  async (): Promise<Record<string, QrIndexEntry[]>> => {
    const config = await loadQrConfig()
    if (!config) return {}
    const session = await qrLogin(config.username, config.password)
    const index: Record<string, QrIndexEntry[]> = {}
    let total = Infinity
    for (let page = 0; page < 100; page++) {
      const { count, rows } = await qrGetCustomersServerSide(
        session,
        config.storeSlug,
        config.storeId,
        page,
      )
      total = count
      if (rows.length === 0) break
      for (const row of rows) {
        if (!row?.name || row.id == null) continue
        const key = normName(String(row.name))
        ;(index[key] ??= []).push({
          id: Number(row.id),
          membershipId: row.membership_id ? String(row.membership_id) : null,
        })
      }
      if ((page + 1) * 100 >= total) break
    }
    return index
  },
  ['qr-customer-index-v1'],
  { revalidate: 21_600, tags: ['customer-visits'] },
)

function resolveQrId(
  index: Record<string, QrIndexEntry[]>,
  name: string,
  memberNumber: string | null,
): number | null {
  const candidates = index[normName(name)]
  if (!candidates || candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].id
  // 同姓同名 — disambiguate on the QR membership id we already store.
  if (memberNumber) {
    const match = candidates.find((c) => c.membershipId === memberNumber)
    if (match) return match.id
  }
  return candidates[0].id
}

function aggregate(visits: CustomerVisit[]): VisitHistorySummary {
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

const cachedHistory = unstable_cache(
  async (
    name: string,
    memberNumber: string | null,
  ): Promise<CustomerVisitHistory> => {
    const config = await loadQrConfig()
    if (!config) return emptyHistory('not-configured')

    const index = await cachedIndex()
    const qrId = resolveQrId(index, name, memberNumber)
    if (qrId == null) return emptyHistory('not-found')

    const session = await qrLogin(config.username, config.password)
    const raw = await qrGetCustomerReservationsByCustomerId(
      session,
      config.storeSlug,
      config.storeId,
      qrId,
    )

    const visits: CustomerVisit[] = raw
      .map((r) => {
        const v = mapVisit(r)
        return {
          qrReservationId: v.qr_reservation_id,
          date: v.used_at,
          courseName: v.course_name,
          staffName: v.staff_name,
          status: v.status as VisitStatus,
          salesAmount: v.sales_amount,
          note: v.treatment_comment,
        }
      })
      // Most recent first for the timeline.
      .sort((a, b) => b.date.localeCompare(a.date))

    return { available: true, reason: 'ok', visits, summary: aggregate(visits) }
  },
  ['customer-visit-history-v1'],
  { revalidate: 1_800, tags: ['customer-visits'] },
)

/**
 * Real reservation + payment history for a customer, live from QuickReserve.
 * Resilient: returns an empty/reason-tagged result instead of throwing so the
 * UI can render a clean state. `name` + `memberNumber` come from the synqed
 * customer (memberNumber disambiguates 同姓同名).
 */
export async function getCustomerVisitHistory(
  name: string,
  memberNumber: string | null,
): Promise<CustomerVisitHistory> {
  try {
    return await cachedHistory(name, memberNumber)
  } catch (err) {
    console.error('[visit-history] fetch failed:', err)
    return emptyHistory('error')
  }
}
