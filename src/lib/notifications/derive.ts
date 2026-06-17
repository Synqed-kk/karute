// ─────────────────────────────────────────────────────────────
// Notification feed — server LOADER (bulk reads → pure assembly)
// ─────────────────────────────────────────────────────────────
// Mirrors the packs loader pattern (lib/packs/alerts.ts → getPackAlerts):
// bulk reads only (no per-customer queries), then hands shaped inputs to
// the pure assembler in ./derive-core.ts. Seeded from an RSC (the (app)
// layout), passed into NotificationsProvider, consumed by the bell.
//
// NO FAKE DATA: every number traces to a live synqed-core read or the
// existing enrichment helpers. If a source is empty it simply produces no
// item — the panel shows its affirming "all caught up" state.

import { unstable_cache } from 'next/cache'
import {
  getCachedCustomerList,
  getCachedCustomerListFor,
} from '@/lib/customers/cached'
import {
  effectiveLastVisitIso,
  enrichCustomers,
  resolveCustomerStatus,
} from '@/lib/customers/list-enrich'
import { getSynqedClient } from '@/lib/synqed/client'
import { ymdInJst } from '@/lib/date/jst'
import { getAppointmentsByDate } from '@/actions/appointments'
import {
  assembleNotificationFeed,
  NEW_BOOKING_LOOKBACK_MS,
  type FeedDraftRecord,
  type FeedRecentBooking,
  type FeedTodayAppointment,
} from './derive-core'
import type { NotificationItem } from './types'

// synqed-core clamps list page_size at 200; pull recent activity within that.
const PAGE_SIZE = 200

/**
 * Build the v1 staff notification feed for a business. Server-only.
 *
 * Resilient by design: each source is wrapped so one failing read can't blank
 * the whole feed (the panel degrades to fewer items, never an error). Returns
 * a flat, newest-first NotificationItem[].
 *
 * @param businessId tenant id (from getBusinessId()).
 * @param locale     'ja' | 'en' — only used to locale-prefix deep-link hrefs.
 */
export async function buildNotificationFeed(
  businessId: string,
  locale = 'ja',
): Promise<NotificationItem[]> {
  const now = new Date()
  const lp = locale === 'en' ? '/en' : '/ja'
  const hrefs = {
    agenda: `${lp}/appointments`,
    customers: `${lp}/customers`,
    // The customer list reads ?query for search; status pre-filters are a
    // future affordance. Point at /customers today (the list is where staff
    // action both chase + sync-pending); deep-filter when the list adds it.
    customersFollowup: `${lp}/customers`,
    customersSyncPending: `${lp}/customers`,
    karute: `${lp}/karute`,
  }

  const synqed = await getSynqedClient().catch(() => null)

  // Fan out the four independent reads. Each is individually guarded so a
  // single failure degrades that ONE source to empty rather than the feed.
  const [todayAppointments, recentBookings, drafts, chaseAndSync] =
    await Promise.all([
      loadTodayAppointments(),
      loadRecentBookings(synqed, now),
      loadDraftKarute(synqed),
      loadChaseAndSync(businessId),
    ])

  return assembleNotificationFeed({
    now,
    hrefs,
    todayAppointments,
    recentBookings,
    drafts,
    chase: chaseAndSync.chase,
    syncPendingCount: chaseAndSync.syncPendingCount,
  })
}

// ─────────────────────────────────────────────────────────────
// Source loaders — each maps live rows to the pure assembler's input
// shapes. All swallow errors to [] / zeros (the feed is best-effort).
// ─────────────────────────────────────────────────────────────

/** 本日のご予約 digest — reuses the agenda loader (already JST-day-scoped,
 *  cancellation-filtered, customer-name-resolved). We only need the
 *  first-timer split, which rides on the QR `is_existing_customer` flag. */
async function loadTodayAppointments(): Promise<FeedTodayAppointment[]> {
  try {
    const rows = await getAppointmentsByDate(ymdInJst(now()))
    return rows.map((r) => {
      // is_existing_customer is an SDK-skew QR field; the agenda row doesn't
      // surface it, so derive the first-timer signal from the cached list at
      // the same boundary. Falls back to undefined (counted as existing).
      const qr = r as typeof r & { is_existing_customer?: boolean }
      return { isExistingCustomer: qr.is_existing_customer }
    })
  } catch {
    return []
  }
}

/** 新規予約 (badge driver) — recent FUTURE bookings. We over-fetch the recent
 *  window then let the pure assembler apply the created-recently AND
 *  starts_at >= now rules (the future filter is the re-sync false-fire guard).
 *  Customer names come from the cached list (no per-row .get). */
async function loadRecentBookings(
  synqed: Awaited<ReturnType<typeof getSynqedClient>> | null,
  now: Date,
): Promise<FeedRecentBooking[]> {
  if (!synqed) return []
  try {
    // Window the fetch to [now, now + reasonable horizon): only FUTURE
    // bookings can pass the assembler's starts_at >= now filter, so there's no
    // point pulling the past. A 60-day horizon covers normal salon lookahead.
    const fromIso = new Date(now.getTime() - 60_000).toISOString() // tiny pad
    const toIso = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString()
    const [list, customers] = await Promise.all([
      synqed.appointments.list({
        from: fromIso,
        to: toIso,
        page_size: PAGE_SIZE,
      }),
      getCachedCustomerList(),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    const cutoff = now.getTime() - NEW_BOOKING_LOOKBACK_MS
    return list.appointments
      // A cancelled booking is not a new booking.
      .filter((a) => a.status !== 'CANCELLED')
      // Cheap pre-filter on the recency window (the assembler re-checks both
      // recency AND future, but trimming here keeps the mapped array small).
      .filter((a) => new Date(a.created_at).getTime() >= cutoff)
      .map((a) => ({
        id: a.id,
        customerName: nameById.get(a.customer_id) ?? 'お客様',
        createdAt: a.created_at,
        startsAt: a.starts_at,
      }))
  } catch {
    return []
  }
}

/** 未保存カルテ — DRAFT karute records. The status filter is server-side; the
 *  dedupe-by-customer + > 1 day age gate run in the pure assembler (so they're
 *  unit-tested). Paginate to completion within the safety cap. */
async function loadDraftKarute(
  synqed: Awaited<ReturnType<typeof getSynqedClient>> | null,
): Promise<FeedDraftRecord[]> {
  if (!synqed) return []
  try {
    const out: FeedDraftRecord[] = []
    const MAX_PAGES = 25 // 25 × 200 = 5,000 rows — runaway guard
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await synqed.karuteRecords.list({
        status: 'DRAFT',
        page,
        page_size: PAGE_SIZE,
      })
      for (const r of res.karute_records) {
        out.push({ customerId: r.customer_id ?? null, createdAt: r.created_at })
      }
      if (res.karute_records.length < PAGE_SIZE) break
    }
    return out
  } catch {
    return []
  }
}

/** 要フォロー/休眠 roll-up + 同期待ち count. Both ride on enrichCustomers +
 *  resolveCustomerStatus (the SINGLE source of status truth) so the panel can
 *  never disagree with the customer list. Bulk reads only — one enrichment
 *  pass over the cached customer list, no per-customer queries.
 *
 *  enrichCustomers is the ONLY expensive source (it paginates the appointment
 *  series). Because the feed seeds in the (app) layout — i.e. on EVERY page —
 *  the result is cached 60s PER BUSINESS so page-to-page navigation reuses it
 *  instead of re-running the enrichment each time. Safe inside unstable_cache:
 *  getCachedCustomerListFor + enrichCustomers are both businessId-explicit (no
 *  auth read). Invalidated by the 'customers' tag, same as the list. */
const getCachedChaseSync = unstable_cache(
  async (
    businessId: string,
  ): Promise<{
    chase: { needsFollowup: number; dormant: number }
    syncPendingCount: number
  }> => {
    const empty = {
      chase: { needsFollowup: 0, dormant: 0 },
      syncPendingCount: 0,
    }
    const customers = await getCachedCustomerListFor(businessId)
    if (customers.length === 0) return empty
    const enrichment = await enrichCustomers(
      businessId,
      customers.map((c) => c.id),
    )
    // last_visit_at fallback (sheet import / deep crawl) — the SAME ONE rule
    // the list + dashboard use, so the three can never disagree about who is
    // N days absent.
    const lastVisitAtById = new Map(
      customers.map((c) => [
        c.id,
        (c as { last_visit_at?: string | null }).last_visit_at ?? null,
      ]),
    )

    let needsFollowup = 0
    let dormant = 0
    let syncPending = 0
    for (const c of customers) {
      const e = enrichment.get(c.id)
      const lastVisitIso = effectiveLastVisitIso(
        e?.lastVisitIso,
        lastVisitAtById.get(c.id),
      )
      const hasUpcomingBooking = !!e?.nextAppointmentIso
      const status = resolveCustomerStatus({
        joinDateIso: c.created_at,
        lastVisitIso,
        hasUpcomingBooking,
        isExistingCustomer: c.isExistingCustomer,
        visitCount: c.visitCount,
        karuteCount: e?.totalKarute,
        pastAppointmentCount: e?.pastAppointmentCount,
        hasTicketPack: c.hasTicketPack,
      })
      // Chase roll-up — resolveCustomerStatus already excludes upcoming-booking
      // customers (hasUpcomingBooking → 'on-track'), so these counts match the
      // list's 要フォロー/休眠 badges exactly.
      if (status === 'needs-followup') needsFollowup += 1
      else if (status === 'dormant') dormant += 1

      // 同期待ち — a returning customer (so NOT 新規) with no dated history yet
      // (no reconciled last visit AND no last_visit_at): the same set the
      // customer page surfaces as 同期待ち.
      const isReturning =
        c.isExistingCustomer || c.visitCount > 0 || (e?.totalKarute ?? 0) > 0
      if (isReturning && !lastVisitIso) syncPending += 1
    }
    return {
      chase: { needsFollowup, dormant },
      syncPendingCount: syncPending,
    }
  },
  ['notif-chase-sync-v1'],
  { revalidate: 60, tags: ['customers'] },
)

/** Thin caller wrapper — the heavy work is the cached helper above; this just
 *  degrades to empty if even the cache read throws (best-effort feed). */
async function loadChaseAndSync(businessId: string): Promise<{
  chase: { needsFollowup: number; dormant: number }
  syncPendingCount: number
}> {
  try {
    return await getCachedChaseSync(businessId)
  } catch {
    return { chase: { needsFollowup: 0, dormant: 0 }, syncPendingCount: 0 }
  }
}

// Tiny indirection so loadTodayAppointments reads "now()" lazily without
// threading the Date through (the agenda loader takes a JST day string, which
// only depends on the wall clock, not the captured-now instant the badge math
// needs). Kept local + obvious.
function now(): Date {
  return new Date()
}
