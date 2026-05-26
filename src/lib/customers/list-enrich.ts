// Batches the per-customer enrichments that the redesigned list page needs:
// last-visit date + total karute count, both grouped by client_id in a single
// service-role read so we don't N+1.
//
// Fields the list still stubs (no producer in karute today):
//   - aiPredict.{label,when} — needs the rebooking-window model
//   - visitsDone / visitsTotal — needs a "course" concept the data model doesn't have
//   - status enum — we derive a best-guess from cadence (see derive)

import { createServiceClient } from '@/lib/supabase/service'
import { getSynqedClient } from '@/lib/synqed/client'
import type { CustomerListRow, CustomerStatusKey } from '@/components/customers/redesign/types'

export interface CustomerEnrichment {
  totalKarute: number
  lastVisitIso: string | null
  visitsDone: number
  /** Count of appointments that have already STARTED before now (= "they've
   *  been here before"). Drives the 新規 (new) badge on the reservation
   *  agenda — a customer with 0 past appointments is genuinely first-time
   *  even if karute records are also 0. Previously the agenda used
   *  `totalKarute === 0` and rendered every untouched customer as 新規. */
  pastAppointmentCount: number
}

export async function enrichCustomers(
  businessId: string,
  customerIds: string[],
): Promise<Map<string, CustomerEnrichment>> {
  const map = new Map<string, CustomerEnrichment>()
  if (customerIds.length === 0) return map

  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = service as any

  // Karute comes from synqed-core (the source of truth), bucketed by the
  // person (synqed `customer_id`). The appointment last-visit fallback still
  // reads Supabase directly — TODO: that table has the same legacy-drift issue
  // as karute did; route it through synqed-core too.
  const idSet = new Set(customerIds)
  const [karuteRes, apptRes] = await Promise.all([
    getSynqedClient().then((c) => c.karuteRecords.list({ page_size: 500 })),
    sb
      .from('appointments')
      .select('client_id, start_time')
      .in('client_id', customerIds),
  ])

  type KaruteRow = { client_id: string; session_date: string | null; created_at: string }
  type ApptRow = { client_id: string; start_time: string }

  const karuteByClient = new Map<string, KaruteRow[]>()
  for (const r of karuteRes.karute_records) {
    if (!r.customer_id || !idSet.has(r.customer_id)) continue
    const arr = karuteByClient.get(r.customer_id) ?? []
    arr.push({ client_id: r.customer_id, session_date: r.created_at, created_at: r.created_at })
    karuteByClient.set(r.customer_id, arr)
  }

  const apptByClient = new Map<string, ApptRow[]>()
  for (const a of (apptRes.data ?? []) as ApptRow[]) {
    const arr = apptByClient.get(a.client_id) ?? []
    arr.push(a)
    apptByClient.set(a.client_id, arr)
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
    // Fall back to appointment last-time if no karute yet.
    if (!lastVisitIso) {
      for (const a of appts) {
        if (!lastVisitIso || a.start_time > lastVisitIso) lastVisitIso = a.start_time
      }
    }
    // Count appointments that started before now ("they've been here before").
    let pastAppointmentCount = 0
    for (const a of appts) {
      if (a.start_time < nowIso) pastAppointmentCount += 1
    }
    map.set(id, {
      totalKarute: karute.length,
      lastVisitIso,
      visitsDone: karute.length,
      pastAppointmentCount,
    })
  }

  return map
}

export function deriveStatus(
  joinDateIso: string | null,
  lastVisitIso: string | null,
): CustomerStatusKey {
  const now = Date.now()
  if (joinDateIso) {
    const ageMs = now - new Date(joinDateIso).getTime()
    if (ageMs < 30 * 24 * 60 * 60 * 1000) return 'new'
  }
  if (!lastVisitIso) return 'new'
  const daysSince = Math.floor((now - new Date(lastVisitIso).getTime()) / 86_400_000)
  if (daysSince > 90) return 'dormant'
  if (daysSince > 60) return 'needs-followup'
  return 'on-track'
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
  }
  if (!iso) return { date: '—', ago: s.noVisits }
  const dt = new Date(iso)
  const date = formatJoinDate(iso, locale)
  const days = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86_400_000))
  const ago =
    days === 0
      ? s.today
      : days === 1
        ? s.oneDayAgo
        : days < 30
          ? s.daysAgo(days)
          : s.monthsAgo(Math.floor(days / 30))
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
