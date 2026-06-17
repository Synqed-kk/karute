// Batches the per-customer enrichments that the redesigned list page needs:
// last-visit date + total karute count, both grouped by client_id in a single
// service-role read so we don't N+1.
//
// Fields the list still stubs (no producer in karute today):
//   - aiPredict.{label,when} — needs the rebooking-window model
//   - status enum — we derive a best-guess from cadence (see derive)

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
}

export async function enrichCustomers(
  businessId: string,
  customerIds: string[],
): Promise<Map<string, CustomerEnrichment>> {
  const map = new Map<string, CustomerEnrichment>()
  if (customerIds.length === 0) return map

  // Both karute and appointments come from synqed-core (the source of truth),
  // bucketed by the person (synqed `customer_id`). The legacy Supabase
  // karute_records table is empty post-migration, which is why the list
  // previously showed 0 karute for everyone.
  //
  // NOTE: synqed caps list page_size at 200. For a single tenant's recent
  // activity that's enough to surface last-visit + the new-customer signal;
  // a very large tenant would need a multi-customer filter or pagination on
  // the synqed list endpoints.
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) return map
  const synqed = new SynqedClient({ baseUrl, apiKey, businessId })

  const idSet = new Set(customerIds)
  // Paginate karute + appointments FULLY. synqed caps page_size at 200, so a
  // single call undercounts any customer whose records fall outside the first
  // page — the ROOT CAUSE of the list-vs-profile badge divergence: the list saw
  // 0 karute for a customer the profile's per-customer read counts correctly, so
  // the list badged them 新規 while the profile said 継続中. (Appointments alone
  // already exceed 200, so the cap was provably hit.) Bounded by MAX_PAGES as a
  // runaway guard (25 × 200 = 5,000 rows/tenant).
  // One paginator for all three lists. Loops until a short page; if it ever hits
  // MAX_PAGES it WARNS instead of silently truncating (so a future giant tenant
  // surfaces the limit rather than quietly undercounting again — the very bug
  // this function is fixing). Staff is paginated too: an unpaginated 200-cap
  // there would leave profileByStaffId incomplete and mis-map staff names.
  const PAGE_SIZE = 200
  const MAX_PAGES = 25 // safety guard: 25 × 200 = 5,000 rows/tenant
  async function fetchAllPages<T>(
    label: string,
    pick: (res: unknown) => T[],
    fetchPage: (page: number) => Promise<unknown>,
  ): Promise<T[]> {
    const out: T[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = pick(await fetchPage(page))
      out.push(...batch)
      if (batch.length < PAGE_SIZE) return out
    }
    console.warn(
      `[enrichCustomers] ${label}: hit MAX_PAGES (${MAX_PAGES}) — results may be truncated for a very large tenant; raise the cap or add a server-side filter.`,
    )
    return out
  }
  const [karuteRecordsAll, appointmentsAll, staffAll] = await Promise.all([
    fetchAllPages(
      'karute',
      (r) => (r as Awaited<ReturnType<typeof synqed.karuteRecords.list>>).karute_records,
      (page) => synqed.karuteRecords.list({ page, page_size: PAGE_SIZE }),
    ),
    fetchAllPages(
      'appointments',
      (r) => (r as Awaited<ReturnType<typeof synqed.appointments.list>>).appointments,
      (page) => synqed.appointments.list({ page, page_size: PAGE_SIZE }),
    ),
    fetchAllPages(
      'staff',
      (r) => (r as Awaited<ReturnType<typeof synqed.staff.list>>).staff,
      (page) => synqed.staff.list({ page, page_size: PAGE_SIZE }),
    ),
  ])

  // synqed staff id → profile id (= staff.user_id). Appointments are keyed by
  // the synqed staff id, but the rest of the app keys staff off the profile id,
  // so translate at the boundary (mirrors getAppointmentsByDate). Profile-less
  // synqed staff fall back to their synqed id — same as getStaffList ids them.
  const profileByStaffId = new Map(
    staffAll
      .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
      .map((s) => [s.id, s.user_id]),
  )

  type KaruteRow = { client_id: string; session_date: string | null; created_at: string }
  type ApptRow = { client_id: string; start_time: string; title: string | null; staff_id: string | null }

  const karuteByClient = new Map<string, KaruteRow[]>()
  for (const r of karuteRecordsAll) {
    if (!r.customer_id || !idSet.has(r.customer_id)) continue
    const arr = karuteByClient.get(r.customer_id) ?? []
    arr.push({ client_id: r.customer_id, session_date: r.created_at, created_at: r.created_at })
    karuteByClient.set(r.customer_id, arr)
  }

  const apptByClient = new Map<string, ApptRow[]>()
  for (const a of appointmentsAll) {
    if (!a.customer_id || !idSet.has(a.customer_id)) continue
    // A CANCELLED booking is not a visit: exclude it so it can't inflate the
    // visit count, shrink the average interval, or fake a 次回予約あり. The QR
    // sync newly produces CANCELLED rows, which this count never saw before.
    if (a.status === 'CANCELLED') continue
    const arr = apptByClient.get(a.customer_id) ?? []
    arr.push({ client_id: a.customer_id, start_time: a.starts_at, title: a.title ?? null, staff_id: a.staff_id ?? null })
    apptByClient.set(a.customer_id, arr)
  }

  const nowIso = new Date().toISOString()
  for (const id of customerIds) {
    const karute = karuteByClient.get(id) ?? []
    const appts = apptByClient.get(id) ?? []
    let lastVisitIso: string | null = null
    for (const k of karute) {
      const dt = k.session_date ?? k.created_at
      if (!lastVisitIso || dt > lastVisitIso) lastVisitIso = dt
    }
    // Walk PAST appointments (started before now): count them ("they've been
    // here before") and track the most recent one — its title is the last
    // treatment they had. Future bookings are excluded so the QR sync's
    // lookahead window can't mislabel an upcoming booking as 前回.
    let lastApptIso: string | null = null
    let lastVisitService: string | null = null
    let pastAppointmentCount = 0
    for (const a of appts) {
      if (a.start_time >= nowIso) continue
      pastAppointmentCount += 1
      if (!lastApptIso || a.start_time > lastApptIso) {
        lastApptIso = a.start_time
        lastVisitService = a.title
      }
    }
    // Fall back to the last past appointment when there's no karute yet.
    if (!lastVisitIso) lastVisitIso = lastApptIso
    // 担当 = staff on the customer's most relevant booking: nearest upcoming,
    // else most recent past. The QR sync never sets assigned_staff_id, so the
    // booking is the only source of who's handling this customer. Translate the
    // synqed staff id → profile id (the id the app's color/name maps key on).
    let bookingStaffId: string | null = null
    let nextAppointmentIso: string | null = null
    {
      const sorted = [...appts].sort((x, y) =>
        x.start_time < y.start_time ? -1 : 1,
      )
      const upcoming = sorted.find((a) => a.start_time >= nowIso)
      nextAppointmentIso = upcoming?.start_time ?? null
      const chosen = upcoming ?? sorted[sorted.length - 1]
      if (chosen?.staff_id)
        bookingStaffId = profileByStaffId.get(chosen.staff_id) ?? chosen.staff_id
    }
    map.set(id, {
      totalKarute: karute.length,
      lastVisitIso,
      pastAppointmentCount,
      lastVisitService,
      bookingStaffId,
      nextAppointmentIso,
    })
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

/**
 * Display-only karute number for a customer.
 *
 * Real karute numbers in salon UX are short DECIMAL strings
 * (`#00120`, `#01234`) — visually scannable, no confusable letters
 * (O/0, I/1, B/8). The previous implementation took the first 5 hex
 * chars of the UUID and uppercased them (`#CBF42`, `#814F5`), which
 * looked like a debug token and didn't match the design spike.
 *
 * Derivation: take the first 6 hex chars (24 bits), parse as base-
 * 16, modulo 100_000, zero-pad to 5 digits. Deterministic so a
 * given customer always renders the same number across the app.
 *
 * ANTHONY: this is a stand-in. The real product wants a sequential
 * per-tenant `customers.karute_number` column (text, populated by a
 * trigger that does `lpad(nextval('karute_number_seq')::text, 5,
 * '0')`, with `unique (business_id, karute_number)`). When that
 * column ships, drop this helper and read the field directly.
 */
export function deriveKaruteNumber(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 6)
  const n = Number.parseInt(hex, 16)
  if (!Number.isFinite(n)) return '#00000'
  const padded = String(n % 100_000).padStart(5, '0')
  return `#${padded}`
}

// Default AI-predict stub. Hardcoded "Soon" timing — replace with the
// rebooking-window model output when it lands.
export function defaultAiPredict(status: CustomerStatusKey): CustomerListRow['aiPredict'] {
  if (status === 'dormant') return { label: 'Reach out', when: 'This week' }
  if (status === 'needs-followup') return { label: 'Follow up', when: 'Soon' }
  return { label: 'Recommend', when: '—' }
}
