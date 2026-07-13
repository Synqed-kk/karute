// Batches the per-customer enrichments that the redesigned list page needs:
// last-visit date + total karute count, both grouped by client_id in a single
// service-role read so we don't N+1.
//
// Fields the list still stubs (no producer in karute today):
//   - aiPredict.{label,when} — needs the rebooking-window model
//   - status enum — we derive a best-guess from cadence (see derive)

import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { jstDaysBetween } from '@/lib/date/jst'
import type { CustomerListRow, CustomerStatusKey } from '@/components/customers/redesign/types'

export interface CustomerEnrichment {
  totalKarute: number
  lastVisitIso: string | null
  /** Count of appointments that have already STARTED before now (= "they've
   *  been here before"). Drives the 新規 (new) badge on the reservation
   *  agenda — a customer with 0 past appointments is genuinely first-time
   *  even if karute records are also 0. Previously the agenda used
   *  `totalKarute === 0` and rendered every untouched customer as 新規. */
  pastAppointmentCount: number
  /** Title (treatment/course) of the customer's most recent PAST appointment
   *  — i.e. what they last came in for. Sourced from `appointment.title`
   *  (the QR sync writes the QuickReserve course name there). Null when the
   *  customer has no past appointment or it carried no title. */
  lastVisitService: string | null
  /** Profile id of the staff on the customer's most relevant booking (nearest
   *  upcoming, else most recent past). Shown as 担当 when the customer has no
   *  指名 (assigned_staff_id) — which QR-synced customers never do. Null when
   *  the customer has no booking in the fetched list. */
  bookingStaffId: string | null
  /** Start of the customer's NEAREST UPCOMING booking, null when none — the
   *  次回予約 あり/なし signal. Feeds the pack alert rule (tickets left + no
   *  next booking + N days absent → contact). */
  nextAppointmentIso: string | null
  /** EARLIEST reconciled visit (MIN of karute session_date + past-appointment
   *  start_time). The twin of lastVisitIso — together they bound the visiting
   *  PERIOD, so 来店ペース can compute an interval from the dated series the
   *  system already has, instead of the customer.first_visit_at scalar that QR
   *  sync never persists (NULL for ~70-80% of customers). */
  firstVisitIso: string | null
  /** How many visits we actually have DATES for (karute records + past
   *  appointments). The HONEST denominator for the average interval — the
   *  lifetime visit_count may include undated visits, so dividing the dated
   *  span by it would understate the gap. */
  datedVisitCount: number
  /** Count of NO_SHOW appointments — excluded from every visit count above
   *  (a no-show never happened). Drives the repeat-no-show chip (>= 2) on
   *  the list + profile; see isRepeatNoShow. */
  noShowCount: number
}

// ─── Cached enrichment (one aggregate call) ──────────────────────────────────
// The per-customer list badges are now computed by a SINGLE server-side SQL
// aggregation in synqed-core (GET /v1/customers/enrichment): last visit, visit
// counts, next booking, 担当 — grouped by customer for the whole business. This
// replaces the old whole-tenant crawl (downloading karute + appointments + staff
// page by page, up to 5,000 rows each, then bucketing in JS), which was the
// wall-clock floor on the customer list / profile / 予約 / dashboard / notifs.
//
// Cached per tenant (60s) + the same tags the mutations fire ('dashboard',
// 'staff-list'); a CUSTOMER create doesn't bust it (a new customer has no rows,
// and missing ids default to EMPTY below). Empty map on missing SYNQED env,
// exactly as before. Note: the now()-based past/future split is now computed
// server-side per fetch and shares the 60s cache window — a negligible boundary
// staleness (bookings are hours/days apart), same TTL the source data had.
// Returns ENTRIES (not a Map): unstable_cache JSON-serializes its value, and a
// Map round-trips to {} on a cache HIT — so `all.get` would throw
// "d.get is not a function" and 500 the 顧客 list. An array of [id, value]
// survives serialization; enrichCustomers rebuilds the Map below.
const enrichmentByBusiness = unstable_cache(
  async (businessId: string): Promise<Array<[string, CustomerEnrichment]>> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return []
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    const rows = await synqed.customers.enrichment()
    return rows.map((r) => {
      // SDK-skew: synqed-core #39 (merged, live in prod) added no_show_count
      // to the row; the installed @synqed-kk/client 1.11.0 CustomerEnrichment
      // type hasn't caught up. The client returns the parsed API response
      // verbatim, so the field is present at runtime — read it structurally
      // (same pattern as the karute_number cast in customers/identity.ts).
      const raw = r as typeof r & { no_show_count?: number }
      return [
        r.customer_id,
        {
          totalKarute: r.total_karute,
          lastVisitIso: r.last_visit,
          pastAppointmentCount: r.past_appointment_count,
          lastVisitService: r.last_visit_service,
          bookingStaffId: r.booking_staff_id,
          nextAppointmentIso: r.next_appointment,
          firstVisitIso: r.first_visit,
          datedVisitCount: r.dated_visit_count,
          noShowCount: raw.no_show_count ?? 0,
        },
      ]
    })
  },
  // v3 → v4: cached row shape gained noShowCount — bump so stale cached rows
  // (without the field) can't linger and under-report repeat no-shows.
  ['customer-enrichment-v4'],
  { revalidate: 60, tags: ['dashboard', 'staff-list'] },
)

const EMPTY_ENRICHMENT: CustomerEnrichment = {
  totalKarute: 0,
  lastVisitIso: null,
  pastAppointmentCount: 0,
  lastVisitService: null,
  bookingStaffId: null,
  nextAppointmentIso: null,
  firstVisitIso: null,
  datedVisitCount: 0,
  noShowCount: 0,
}

export async function enrichCustomers(
  businessId: string,
  customerIds: string[],
): Promise<Map<string, CustomerEnrichment>> {
  const map = new Map<string, CustomerEnrichment>()
  if (customerIds.length === 0) return map

  // One cached aggregate read for the whole business (see enrichmentByBusiness).
  // Every requested id gets an entry — EMPTY for customers with no karute /
  // appointment history — matching the old per-id bucketing's behaviour.
  // Rebuild the Map from cached entries (the cache stores a serializable array;
  // see enrichmentByBusiness).
  const all = new Map(await enrichmentByBusiness(businessId))
  for (const id of customerIds) {
    map.set(id, all.get(id) ?? EMPTY_ENRICHMENT)
  }

  return map
}

/** Effective last visit — ONE rule, every surface (list adapter + dashboard
 *  alert loader must both call this; the customers/[id] profile reads
 *  customer.last_visit_at directly, which this rule converges with):
 *  synced visit rows (karute/appointments) beat the customer-record field
 *  (deep crawl / sheet import), which beats nothing. Without the fallback,
 *  imported customers have no 前回/（N日前）and — worse — the 離客 alert math
 *  (daysSinceLastVisit) can never fire for them. */
export function effectiveLastVisitIso(
  enrichedIso: string | null | undefined,
  customerLastVisitAt: string | null | undefined,
): string | null {
  return enrichedIso ?? customerLastVisitAt ?? null
}

/** Twin of effectiveLastVisitIso for the FIRST visit: the reconciled earliest
 *  karute/appointment date beats the customer.first_visit_at scalar (which QR
 *  sync never persists). When BOTH dates resolve, 来店ペース can show a real
 *  interval; this is the field fix that recovers cadence for the ~80% of
 *  customers whose QR date scalars are NULL but who have dated visit history. */
export function effectiveFirstVisitIso(
  enrichedIso: string | null | undefined,
  customerFirstVisitAt: string | null | undefined,
): string | null {
  return enrichedIso ?? customerFirstVisitAt ?? null
}

/** Compact date for the mobile card rails — current-year dates drop the year
 *  (「前回 6/2」), prior years keep it (2025/12/24). JST-pinned. */
export function formatCompactDate(
  iso: string | null,
  locale: string,
  now: Date = new Date(),
  opts?: { withWeekday?: boolean },
): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const jstYear = (x: Date) =>
    x.toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric' })
  const sameYear = jstYear(d) === jstYear(now)
  const base = d.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  if (!opts?.withWeekday) return base
  const wd = d.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  })
  return locale === 'ja' ? `${base}(${wd})` : `${base} (${wd})`
}

// ─── SINGLE SOURCE OF TRUTH for customer status ──────────────────────────────
// One chopstick through the apple: a customer's status is decided in ONE place
// and that value is shown on EVERY surface (list, profile, recording target, 予約
// agenda). No page re-derives it from its own partial inputs — that's what made
// the badge disagree across pages (新規 on the list, 継続中 on the profile).

/** Every signal of prior history. Gathered the SAME way on each surface so the
 *  result is identical for a given customer everywhere. */
export interface CustomerStatusSignals {
  joinDateIso: string | null
  lastVisitIso: string | null
  /** QuickReserve "returning customer" flag. */
  isExistingCustomer?: boolean
  /** QR lifetime visit count (visits_number_cache). */
  visitCount?: number
  /** Recorded karute sessions in this system. */
  karuteCount?: number
  /** Past appointments on file. */
  pastAppointmentCount?: number
  /** Holds a 回数券 / multi-session pass → definitively a returning customer. */
  hasTicketPack?: boolean
  /** Upcoming booking on file → the customer is ALREADY coming back, so the
   *  chase states (要フォロー/休眠) are moot: a follow-up queue containing
   *  people who already booked wastes staff calls (Liam; Kitano's sheet keys
   *  every chase list on 次回予約なし). Self-healing: a no-show stops being
   *  "upcoming" and the customer re-enters the queue automatically. Matches
   *  resolvePackAlert, which has required hasNextBooking=false from day one. */
  hasUpcomingBooking?: boolean
  /** customer_lifecycle.status — a staff DECISION that outranks cadence math.
   *  卒業 (graduated) / 離客 (lost) customers must never fake-render as 休眠/
   *  要フォロー: that red would poison the 200-row scan with known-closed
   *  cases (the Kitano sheet tracks 卒業/離客 as its first two columns). */
  lifecycleStatus?: 'active' | 'graduated' | 'lost'
}

/** Has this customer been here before (i.e. NOT 新規)? ANY signal counts. The
 *  badge AND the recording/agenda "first visit" checks both call this, so they
 *  can never disagree. (QR regulars like a 6回券 holder with 0 recordings but
 *  visit_count 5 are correctly returning — the bug was surfaces ignoring those.) */
export function isReturningCustomer(s: CustomerStatusSignals): boolean {
  return (
    (s.isExistingCustomer ?? false) ||
    (s.visitCount ?? 0) > 0 ||
    (s.karuteCount ?? 0) > 0 ||
    (s.pastAppointmentCount ?? 0) > 0 ||
    (s.hasTicketPack ?? false)
  )
}

/** The 来店 count shown to staff — the strongest evidence of visits we have,
 *  consistent on every surface. */
export function customerVisitCount(s: CustomerStatusSignals): number {
  return Math.max(
    s.visitCount ?? 0,
    s.karuteCount ?? 0,
    s.pastAppointmentCount ?? 0,
  )
}

/** THE status-badge resolver. Every surface MUST call this (not the raw rules)
 *  so the badge is computed once and rendered identically everywhere. */
export function resolveCustomerStatus(s: CustomerStatusSignals): CustomerStatusKey {
  // Staff decisions first: 卒業/離客 are terminal states — no cadence rule may
  // override them (a graduated customer 200 days out is NOT 休眠).
  if (s.lifecycleStatus === 'graduated') return 'graduated'
  if (s.lifecycleStatus === 'lost') return 'lost'
  const now = Date.now()
  if (!isReturningCustomer(s)) {
    if (s.joinDateIso && now - new Date(s.joinDateIso).getTime() < 30 * 86_400_000)
      return 'new'
    if (!s.lastVisitIso) return 'new'
  }
  // Returning but no dated visit yet → on-track (not new, not dormant).
  if (!s.lastVisitIso) return 'on-track'
  // A booked customer is never a chase target — see hasUpcomingBooking doc.
  if (s.hasUpcomingBooking) return 'on-track'
  // JST calendar days — the SAME rule the ago-string uses (jstDaysBetween),
  // so 「90日前」 and the 休眠 chip can never disagree around midnight.
  const daysSince = jstDaysBetween(s.lastVisitIso, new Date(now))
  // >= : the label says 休眠（90日以上） — 以上 is inclusive, so exactly-90 is
  // dormant, not 要フォロー. One source; every surface inherits.
  if (daysSince >= 90) return 'dormant'
  if (daysSince > 60) return 'needs-followup'
  return 'on-track'
}

/** @deprecated Thin shim → resolveCustomerStatus. Prefer the resolver (it takes
 *  the full signal set) so no caller can pass a partial signal again. Kept for
 *  existing callers + tests. */
export function deriveStatus(
  joinDateIso: string | null,
  lastVisitIso: string | null,
  isExistingCustomer = false,
  priorVisitCount = 0,
): CustomerStatusKey {
  return resolveCustomerStatus({
    joinDateIso,
    lastVisitIso,
    isExistingCustomer,
    karuteCount: priorVisitCount,
  })
}

/**
 * Locale-aware date formatter.
 *
 * - `ja` → `2026年5月24日` (long month so the kanji 月 separator
 *   appears between numerics rather than `2026/5/24` which reads
 *   weak in JP UX)
 * - everything else (en) → `May 24, 2026`
 *
 * Internal mapping handles the next-intl locale code (`ja` / `en`)
 * → BCP-47 (`ja-JP` / `en-US`) so callers can pass the locale
 * straight from `getLocale()`.
 */
export function formatJoinDate(iso: string | null, locale = 'en'): string {
  if (!iso) return '—'
  const tag = locale === 'ja' ? 'ja-JP' : 'en-US'
  return new Intl.DateTimeFormat(tag, {
    year: 'numeric',
    month: locale === 'ja' ? 'long' : 'short',
    day: 'numeric',
  }).format(new Date(iso))
}

/**
 * Strings the formatter needs for the "X ago" relative label, fed
 * in from the caller (server component) which has access to
 * `getTranslations`. Keeps the formatter itself synchronous +
 * dependency-free; testable without next-intl plumbing.
 */
export interface LastVisitStrings {
  noVisits: string
  today: string
  oneDayAgo: string
  daysAgo: (n: number) => string
  monthsAgo: (n: number) => string
  /** Optional — falls back to monthsAgo for callers that predate the tier. */
  yearsAgo?: (n: number) => string
}

export function formatLastVisit(
  iso: string | null,
  locale = 'en',
  strings?: LastVisitStrings,
): { date: string; ago: string } {
  // Backward-compat fallback (English) if no strings injected. Real
  // callers should pass `strings` so JP locale gets JP relative
  // labels.
  const s: LastVisitStrings = strings ?? {
    noVisits: 'No visits',
    today: 'Today',
    oneDayAgo: '1 day ago',
    daysAgo: (n) => `${n} days ago`,
    monthsAgo: (n) => `${n} mo ago`,
    yearsAgo: (n) => `${n}y ago`,
  }
  if (!iso) return { date: '—', ago: s.noVisits }
  const date = formatJoinDate(iso, locale)
  // JST calendar days — same rule as the status/alert thresholds (jstDaysBetween)
  const days = jstDaysBetween(iso)
  const ago =
    days === 0
      ? s.today
      : days === 1
        ? s.oneDayAgo
        : days < 30
          ? s.daysAgo(days)
          : days < 365 || !s.yearsAgo
            ? s.monthsAgo(Math.floor(days / 30))
            : s.yearsAgo(Math.floor(days / 365))
  return { date, ago }
}

// Default AI-predict stub. Hardcoded "Soon" timing — replace with the
// rebooking-window model output when it lands.
export function defaultAiPredict(status: CustomerStatusKey): CustomerListRow['aiPredict'] {
  if (status === 'dormant') return { label: 'Reach out', when: 'This week' }
  if (status === 'needs-followup') return { label: 'Follow up', when: 'Soon' }
  return { label: 'Recommend', when: '—' }
}
