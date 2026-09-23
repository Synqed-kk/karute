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
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import {
  effectiveLastVisitIso,
  enrichCustomers,
} from '@/lib/customers/list-enrich'
import { resolveCustomerStatus } from '@/lib/customers/status-signals'
import { SynqedClient } from '@synqed-kk/client'
import { ymdInJst } from '@/lib/date/jst'
import { isTerminalStatus } from '@/lib/appointments/status'
import {
  assembleNotificationFeed,
  NEW_BOOKING_LOOKBACK_MS,
  type FeedDraftRecord,
  type FeedRecordingFailure,
  type FeedRecentBooking,
  type FeedTodayAppointment,
} from './derive-core'
import type { NotificationItem } from './types'
import { INBOX_WINDOW_MS } from '@/lib/recordings/inbox'

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
 * @param storeId    the viewer's CLAMPED store lens (resolveStoreScope().storeId,
 *                   threaded from the layout). Every store-scoped read below must
 *                   pass it — a branch-restricted staff's bell must never show
 *                   another store's bookings/drafts/counts (#465 family).
 *                   null = no store filter (business has no stores / lookup failed).
 */
export async function buildNotificationFeed(
  businessId: string,
  locale = 'ja',
  storeId: string | null = null,
  // Callers that already hold today's appointment rows (the chrome facade
  // route fetches them for the next-customer pick) inject the mapped digest
  // input so the feed doesn't re-read the same day from core (Greptile #562).
  deps: {
    todayAppointments?: FeedTodayAppointment[]
    /** canReadAuditLog(viewer caps) — the 監査ログ rule. Only then is the
     *  recording-failure source read at all; default false = never. */
    viewerCanViewAudit?: boolean
  } = {},
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
    // The 監査ログ tab — same access rule as this source (canReadAuditLog),
    // and where these audit rows are listed. No `target` (a customer id there).
    recording: `${lp}/settings?tab=audit`,
  }

  // Fan out the five independent reads. Each is individually guarded so a
  // single failure degrades that ONE source to empty rather than the feed.
  // All four SDK-backed sources are cached 60s/business (like loadChaseAndSync)
  // so seeding the feed on every (app) page doesn't re-fetch per navigation.
  const [todayAppointments, recentBookings, drafts, chaseAndSync, recordingFailures] =
    await Promise.all([
      deps.todayAppointments ?? loadTodayAppointments(businessId),
      loadRecentBookings(businessId, storeId),
      loadDraftKarute(businessId, storeId),
      loadChaseAndSync(businessId, storeId),
      // The gate sits BEFORE the cache: a viewer without the flag never
      // reaches getCachedRecordingFailures, so its business-wide entry can
      // only ever be served to someone who may open the 監査ログ.
      deps.viewerCanViewAudit ? loadRecordingFailures(businessId) : [],
    ])

  return assembleNotificationFeed({
    now,
    hrefs,
    todayAppointments,
    recentBookings,
    drafts,
    chase: chaseAndSync.chase,
    syncPendingCount: chaseAndSync.syncPendingCount,
    recordingFailures,
    recordingHref: hrefs.recording,
  })
}

// ─────────────────────────────────────────────────────────────
// Source loaders — each maps live rows to the pure assembler's input
// shapes. All swallow errors to [] / zeros (the feed is best-effort).
// ─────────────────────────────────────────────────────────────

/** 本日のご予約 digest — JST-day appointment rows, terminal statuses dropped,
 *  joined to the cached customer list for the 新規/既存 split (the QR
 *  `is_existing_customer` flag). businessId-explicit like its sibling
 *  loaders — this was the ONE cookie-bound source, which made the whole feed
 *  unusable on the Bearer (facade) path. Reads appointments DIRECTLY (one
 *  list call): the digest needs only counts + the first-timer flag, so the
 *  full agenda assembly (karute links, staff mapping) would be pure
 *  over-fetch here (Greptile #562). */
async function loadTodayAppointments(
  businessId: string,
): Promise<FeedTodayAppointment[]> {
  try {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return []
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    const dateStr = ymdInJst(now())
    const [list, customers] = await Promise.all([
      synqed.appointments.list({
        from: new Date(`${dateStr}T00:00:00+09:00`).toISOString(),
        to: new Date(`${dateStr}T23:59:59.999+09:00`).toISOString(),
        page_size: PAGE_SIZE,
      }),
      getCachedCustomerListFor(businessId),
    ])
    const existingById = new Map(
      customers.map((c) => [c.id, c.isExistingCustomer]),
    )
    return list.appointments
      .filter((a) => !isTerminalStatus(a.status))
      .map((a) => ({ isExistingCustomer: a.customer_id ? existingById.get(a.customer_id) : undefined }))
  } catch {
    return []
  }
}

/** 新規予約 (badge driver) — recent FUTURE bookings. We over-fetch the recent
 *  window then let the pure assembler apply the created-recently AND
 *  starts_at >= now rules (the future filter is the re-sync false-fire guard).
 *  Customer names come from the cached list (no per-row .get).
 *
 *  Cached 60s/business (businessId-explicit client + getCachedCustomerListFor —
 *  no auth read inside) because the feed seeds on EVERY (app) page; without this
 *  it re-fetched per navigation. Busted by the 'customers' tag. The window uses
 *  the cache body's own clock; a ≤60s drift is harmless because the pure
 *  assembler re-applies the precise starts_at >= now / recency rules with the
 *  request's real now. */
const getCachedRecentBookings = unstable_cache(
  // storeId is a cache-key ARG on purpose (Next keys on function args) — one
  // store's cached feed must never serve another store for the 60s window.
  async (businessId: string, storeId: string | null): Promise<FeedRecentBooking[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return []
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    const now = new Date()
    const fromIso = new Date(now.getTime() - 60_000).toISOString() // tiny pad
    const toIso = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString()
    const [list, customers] = await Promise.all([
      synqed.appointments.list({
        from: fromIso,
        to: toIso,
        page_size: PAGE_SIZE,
        store_id: storeId ?? undefined,
      }),
      // Name LOOKUP only (never listed) — stays business-wide so a booking by a
      // not-yet-store-pinned customer still resolves its name.
      getCachedCustomerListFor(businessId),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    const cutoff = now.getTime() - NEW_BOOKING_LOOKBACK_MS
    return list.appointments
      // A cancelled or no-show booking is not a new booking.
      .filter((a) => !isTerminalStatus(a.status))
      // Cheap pre-filter on the recency window (the assembler re-checks both
      // recency AND future, but trimming here keeps the mapped array small).
      .filter((a) => new Date(a.created_at).getTime() >= cutoff)
      .map((a) => ({
        id: a.id,
        customerName: (a.customer_id && nameById.get(a.customer_id)) ?? 'お客様',
        createdAt: a.created_at,
        startsAt: a.starts_at,
      }))
  },
  ['notif-recent-bookings-v2'],
  { revalidate: 60, tags: ['customers'] },
)

async function loadRecentBookings(
  businessId: string,
  storeId: string | null,
): Promise<FeedRecentBooking[]> {
  try {
    return await getCachedRecentBookings(businessId, storeId)
  } catch {
    return []
  }
}

/** 未保存カルテ — DRAFT karute records. The status filter is server-side; the
 *  dedupe-by-customer + > 1 day age gate run in the pure assembler (so they're
 *  unit-tested). Paginate to completion within the safety cap.
 *
 *  Cached 60s/business (businessId-explicit client, no auth read inside) — this
 *  is the heaviest source (up to 25 paginated reads), and the feed seeds on
 *  every (app) page, so without the cache it re-paginated per navigation. Busted
 *  by the 'customers' tag. */
const getCachedDraftKarute = unstable_cache(
  // storeId is a cache-key ARG on purpose — see getCachedRecentBookings.
  async (businessId: string, storeId: string | null): Promise<FeedDraftRecord[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return []
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    const out: FeedDraftRecord[] = []
    const MAX_PAGES = 25 // 25 × 200 = 5,000 rows — runaway guard
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await synqed.karuteRecords.list({
        status: 'DRAFT',
        page,
        page_size: PAGE_SIZE,
        store_id: storeId ?? undefined,
      })
      for (const r of res.karute_records) {
        out.push({ customerId: r.customer_id ?? null, createdAt: r.created_at })
      }
      if (res.karute_records.length < PAGE_SIZE) break
    }
    return out
  },
  ['notif-draft-karute-v2'],
  { revalidate: 60, tags: ['customers'] },
)

async function loadDraftKarute(
  businessId: string,
  storeId: string | null,
): Promise<FeedDraftRecord[]> {
  try {
    return await getCachedDraftKarute(businessId, storeId)
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
  // storeId is a cache-key ARG on purpose — see getCachedRecentBookings. The
  // roll-up counts over the STORE-scoped list, matching what the viewer's own
  // 顧客 page shows (a Ginza-clamped staff must not see Daikanyama's 休眠 count).
  async (
    businessId: string,
    storeId: string | null,
  ): Promise<{
    chase: { needsFollowup: number; dormant: number }
    syncPendingCount: number
  }> => {
    const empty = {
      chase: { needsFollowup: 0, dormant: 0 },
      syncPendingCount: 0,
    }
    const customers = await getCachedCustomerListFor(
      businessId,
      storeId ?? undefined,
    )
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
  ['notif-chase-sync-v2'],
  { revalidate: 60, tags: ['customers'] },
)

/** Thin caller wrapper — the heavy work is the cached helper above; this just
 *  degrades to empty if even the cache read throws (best-effort feed). */
async function loadChaseAndSync(
  businessId: string,
  storeId: string | null,
): Promise<{
  chase: { needsFollowup: number; dormant: number }
  syncPendingCount: number
}> {
  try {
    return await getCachedChaseSync(businessId, storeId)
  } catch {
    return { chase: { needsFollowup: 0, dormant: 0 }, syncPendingCount: 0 }
  }
}

/** カルテ未作成の録音 — `recording`-category audit rows in the 録音履歴's own
 *  window (core has no action filter, so page and keep the two actions), plus
 *  one recordings.get per failed recording for its date. Business-wide on
 *  purpose: only reached for canReadAuditLog viewers, who all hold
 *  stores.viewAll. Cached 60s/business like its siblings — no auth read inside.
 *  Reads the SDK directly, like the audit-watch cron: no privacy.audit_log.view
 *  receipt (that belongs to opening the 監査ログ page). */
const RECORDING_AUDIT_MAX_PAGES = 10 // ponytail: 2,000 rows/7 days; raise if a salon outgrows it
const RECORDING_DATE_READS = 20 // ponytail: beyond this the body shows the row's time
const getCachedRecordingFailures = unstable_cache(
  async (businessId: string): Promise<FeedRecordingFailure[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return []
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    const now = Date.now()
    const from = new Date(now - INBOX_WINDOW_MS).toISOString()
    const to = new Date(now).toISOString()
    const rows: FeedRecordingFailure[] = []
    for (let page = 1; page <= RECORDING_AUDIT_MAX_PAGES; page++) {
      const res = await synqed.audit.list({ category: 'recording', from, to, page, page_size: PAGE_SIZE })
      for (const e of res.events) {
        if (
          e.target_id &&
          (e.action === 'recording.transcribe_failed' || e.action === 'recording.karute_missing')
        ) {
          const reason = (e.detail as { reason?: unknown } | null)?.reason
          rows.push({ action: e.action, targetId: e.target_id, at: e.at, reason, recordedAt: null })
        }
      }
      if (res.events.length === 0 || page * PAGE_SIZE >= res.total) break
    }
    const targets = [...new Set(rows.map((r) => r.targetId))].slice(0, RECORDING_DATE_READS)
    const recordedAt = new Map(
      await Promise.all(
        targets.map(async (id) => {
          const rec = await synqed.recordings.get(id).catch(() => null)
          return [id, rec?.created_at ?? null] as const
        }),
      ),
    )
    return rows.map((r) => ({ ...r, recordedAt: recordedAt.get(r.targetId) ?? null }))
  },
  ['notif-recording-failures-v1'],
  { revalidate: 60 },
)

async function loadRecordingFailures(businessId: string): Promise<FeedRecordingFailure[]> {
  try {
    return await getCachedRecordingFailures(businessId)
  } catch {
    return []
  }
}

// Tiny indirection so loadTodayAppointments reads "now()" lazily without
// threading the Date through (the agenda loader takes a JST day string, which
// only depends on the wall clock, not the captured-now instant the badge math
// needs). Kept local + obvious.
function now(): Date {
  return new Date()
}
