// ─────────────────────────────────────────────────────────────
// Notification feed — PURE assembly (Jest-testable, no I/O)
// ─────────────────────────────────────────────────────────────
// Mirrors the packs split (alerts-core ← alerts): the bulk reads +
// next/cache + synqed-client import chain live in ./derive.ts; the
// FILTERING RULES live here as a pure function so they can be tested
// without that chain. derive.ts fetches, shapes inputs, calls this.
//
// v1 sources (all from data verified present today — no new tables):
//   1. 本日のご予約   — today's appointment digest (system, info only)
//   2. 新規予約       — recent future bookings (booking, BADGE DRIVER)
//   3. 要フォロー/休眠 — chase roll-up, ONE item (customer_return)
//   4. 未保存カルテ   — DRAFT karute, deduped + age-gated (memory_review)
//   5. 同期待ち       — returning customers with no dated history (system)
//
// PHASE-2 (NOT built here — each is data-blocked so it can't render
// broken; listed so the next pass knows the shape):
//   • 回数券残少   — needs the ticket_packs migration (pack usage map is
//                    empty until it applies; see lib/packs/store).
//   • 卒業/離客    — needs customer_lifecycle rows (staff decisions);
//                    lifecycle map is empty until that table is seeded.
//   • 誕生日       — needs the DOB backfill (date_of_birth is NULL for
//                    ~all QR-synced customers today).
//   • 同期エラー   — needs a sync-health row/feed (no producer yet).
// When each data source lands, add a builder below + a source block.

import type { NotificationItem } from './types'

// ─────────────────────────────────────────────────────────────
// Input shapes — the minimal projections each source needs. derive.ts
// maps the synqed rows / enrichment maps down to these before calling.
// ─────────────────────────────────────────────────────────────

/** One of today's appointments (already day-filtered + cancellation-filtered
 *  by the agenda loader). */
export interface FeedTodayAppointment {
  /** false ⇒ first-timer (QR `is_existing_customer`). undefined ⇒ unknown,
   *  counted as existing (conservative — never over-reports 新規). */
  isExistingCustomer?: boolean
}

/** A recent booking candidate for the 新規予約 badge source. */
export interface FeedRecentBooking {
  id: string
  customerName: string
  /** ISO — when the booking row was created (drives the "is this new?" window
   *  AND the notification's createdAt, so the badge counts it naturally). */
  createdAt: string
  /** ISO — when the appointment STARTS. The future filter keys on this. */
  startsAt: string
}

/** Chase roll-up counts — already computed via resolveCustomerStatus over
 *  enrichCustomers (both exclude upcoming-booking customers). */
export interface FeedChaseCounts {
  needsFollowup: number
  dormant: number
}

/** A DRAFT karute record. */
export interface FeedDraftRecord {
  /** Customer the draft belongs to. null drafts can't be deduped by customer,
   *  so they're keyed by their own id (each counts once). */
  customerId: string | null
  /** ISO — used for the > 1 day age gate (a draft saved seconds ago is the
   *  staff still working, not a forgotten record). */
  createdAt: string
}

export interface AssembleFeedInputs {
  /** "now" — injected so tests are deterministic and JST math is stable. */
  now: Date
  /** Deep-link targets, locale-prefixed by the caller. */
  hrefs: {
    agenda: string
    customers: string
    customersFollowup: string
    customersSyncPending: string
    karute: string
  }
  todayAppointments: FeedTodayAppointment[]
  recentBookings: FeedRecentBooking[]
  chase: FeedChaseCounts
  drafts: FeedDraftRecord[]
  /** Count of returning customers with no dated history (same set the customer
   *  page shows 同期待ち for). Already computed by the caller. */
  syncPendingCount: number
}

// ─────────────────────────────────────────────────────────────
// Tunables (exported so tests assert against the SAME constants the
// builder uses — no magic-number drift).
// ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

/** 新規予約 window: a booking ROW created within this lookback counts as
 *  "new" (paired with the future filter below). 48h covers an overnight +
 *  a full day so nothing slips through between staff glances. */
export const NEW_BOOKING_LOOKBACK_MS = 48 * 60 * 60 * 1000

/** 未保存カルテ age gate: a draft younger than this is the staff member still
 *  mid-edit, not a forgotten record — don't nag about it. */
export const DRAFT_MIN_AGE_MS = DAY_MS

// ─────────────────────────────────────────────────────────────
// Per-source builders — each returns 0..1 items (or N for the badge-
// driver booking source). An empty source yields nothing; no fake data.
// ─────────────────────────────────────────────────────────────

/** 1. 本日のご予約 — digest. Standing/info, does NOT drive the badge. */
function buildTodayDigest(
  appts: FeedTodayAppointment[],
  now: Date,
  href: string,
): NotificationItem | null {
  const total = appts.length
  if (total === 0) return null
  // is_existing_customer === false ⇒ first-timer. undefined ⇒ treat as
  // existing (conservative; never inflates the 新規 figure).
  const newCount = appts.filter((a) => a.isExistingCustomer === false).length
  const existingCount = total - newCount
  // createdAt = start of today (JST midnight) so the digest sorts into the
  // panel's "today" group and reads as a standing morning summary.
  const startOfToday = jstStartOfTodayIso(now)
  return {
    id: 'digest-today',
    category: 'system',
    titleJa: `本日のご予約 ${total}件`,
    titleEn: `${total} appointments today`,
    bodyJa: `新規 ${newCount}名・既存 ${existingCount}名`,
    bodyEn: `${newCount} new · ${existingCount} returning`,
    createdAt: startOfToday,
    readAt: null,
    href,
  }
}

/** 2. 新規予約 — the ONLY badge driver. ONE item per recent FUTURE booking
 *  (so useUnreadCount counts them naturally). MUST filter startsAt >= now:
 *  appointments.created_at is touched by the daily re-sync (~86 rows/day), so
 *  without the future filter every re-synced past booking false-fires. */
function buildNewBookings(
  bookings: FeedRecentBooking[],
  now: Date,
  href: string,
): NotificationItem[] {
  const nowMs = now.getTime()
  const out: NotificationItem[] = []
  for (const b of bookings) {
    const createdMs = new Date(b.createdAt).getTime()
    if (Number.isNaN(createdMs)) continue
    // Recently created…
    if (nowMs - createdMs > NEW_BOOKING_LOOKBACK_MS) continue
    if (createdMs > nowMs) continue // clock-skew guard: not from the future
    // …AND still upcoming (the re-sync false-fire guard).
    const startsMs = new Date(b.startsAt).getTime()
    if (Number.isNaN(startsMs) || startsMs < nowMs) continue
    const when = formatMonthDayTime(b.startsAt)
    out.push({
      id: `booking-${b.id}`,
      category: 'booking',
      titleJa: `新規予約: ${b.customerName} ${when}`,
      titleEn: `New booking: ${b.customerName} ${when}`,
      bodyJa: '',
      bodyEn: '',
      createdAt: b.createdAt,
      readAt: null,
      href,
    })
  }
  return out
}

/** 3. 要フォロー/休眠 — chase roll-up. ONE item, never per-customer (the
 *  dormant universe is ~250; per-customer would bury everything else). */
function buildChaseRollup(
  chase: FeedChaseCounts,
  now: Date,
  href: string,
): NotificationItem | null {
  const followup = Math.round(chase.needsFollowup)
  const dormant = Math.round(chase.dormant)
  if (followup === 0 && dormant === 0) return null
  return {
    id: 'followup-rollup',
    category: 'customer_return',
    titleJa: `要フォロー ${followup}名・休眠 ${dormant}名`,
    titleEn: `${followup} to follow up · ${dormant} dormant`,
    bodyJa: '次回予約のないお客様',
    bodyEn: 'Customers with no upcoming booking',
    // Standing roll-up — anchor to start of today so it groups under "today"
    // and reads as a daily standing list rather than a point-in-time event.
    createdAt: jstStartOfTodayIso(now),
    readAt: null,
    href,
  }
}

/** 4. 未保存カルテ — DRAFT karute, DEDUPED BY customer + age-gated > 1 day.
 *  Dedupe stops one seed account's many drafts from dominating the count;
 *  the age gate ignores drafts the staff is still actively writing. */
function buildDraftKarute(
  drafts: FeedDraftRecord[],
  now: Date,
  href: string,
): NotificationItem | null {
  const nowMs = now.getTime()
  const seenCustomers = new Set<string>()
  let count = 0
  for (const d of drafts) {
    const createdMs = new Date(d.createdAt).getTime()
    if (Number.isNaN(createdMs)) continue
    if (nowMs - createdMs <= DRAFT_MIN_AGE_MS) continue // too fresh — still editing
    // Dedupe by customer. A null customer_id can't be deduped (it's its own
    // distinct unknown), so key it on a synthetic per-row token.
    const key = d.customerId ?? `__null__${count}__${createdMs}`
    if (seenCustomers.has(key)) continue
    seenCustomers.add(key)
    count += 1
  }
  if (count === 0) return null
  return {
    id: 'draft-karute-rollup',
    category: 'memory_review',
    titleJa: `未保存カルテ ${count}件`,
    titleEn: `${count} unsaved records`,
    bodyJa: '過去セッションの下書き',
    bodyEn: 'Drafts from past sessions',
    createdAt: jstStartOfTodayIso(now),
    readAt: null,
    href,
  }
}

/** 5. 同期待ち — returning customers with no dated history yet. Standing info
 *  chip; does NOT drive the badge. */
function buildSyncPending(
  count: number,
  now: Date,
  href: string,
): NotificationItem | null {
  const n = Math.round(count)
  if (n === 0) return null
  return {
    id: 'sync-pending-rollup',
    category: 'system',
    titleJa: `同期待ち ${n}名`,
    titleEn: `${n} awaiting sync`,
    bodyJa: '来店履歴の取り込み待ち',
    bodyEn: 'Visit history still importing',
    createdAt: jstStartOfTodayIso(now),
    readAt: null,
    href,
  }
}

// ─────────────────────────────────────────────────────────────
// The pure assembler — composes the five sources into a flat feed,
// newest-first. (The panel re-sorts on render too, but returning a
// sorted feed keeps the badge/most-recent logic honest.)
// ─────────────────────────────────────────────────────────────

export function assembleNotificationFeed(
  inputs: AssembleFeedInputs,
): NotificationItem[] {
  const { now, hrefs } = inputs
  const items: NotificationItem[] = []

  const digest = buildTodayDigest(inputs.todayAppointments, now, hrefs.agenda)
  if (digest) items.push(digest)

  items.push(...buildNewBookings(inputs.recentBookings, now, hrefs.agenda))

  const chase = buildChaseRollup(inputs.chase, now, hrefs.customersFollowup)
  if (chase) items.push(chase)

  const drafts = buildDraftKarute(inputs.drafts, now, hrefs.karute)
  if (drafts) items.push(drafts)

  const sync = buildSyncPending(
    inputs.syncPendingCount,
    now,
    hrefs.customersSyncPending,
  )
  if (sync) items.push(sync)

  // Newest-first by createdAt — booking events bubble above the standing
  // roll-ups (which all anchor to JST midnight), matching the panel grouping.
  items.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  return items
}

// ─────────────────────────────────────────────────────────────
// Small JST-aware formatters (kept local + dependency-free so this
// module stays pure and Jest-importable without the app's date stack).
// ─────────────────────────────────────────────────────────────

/** JST midnight of `now`, as an ISO instant. Standing roll-ups anchor here so
 *  they group under "today" in the panel. */
function jstStartOfTodayIso(now: Date): string {
  // YYYY-MM-DD in JST, then re-anchor to JST midnight (+09:00 → correct UTC).
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  return new Date(`${ymd}T00:00:00+09:00`).toISOString()
}

/** "M/D HH:mm" in JST — the compact booking timestamp staff scan against. */
function formatMonthDayTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
  })
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${date} ${time}`
}
