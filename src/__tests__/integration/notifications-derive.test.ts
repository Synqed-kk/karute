/**
 * Coverage for the v1 notification feed assembly rules
 * (feat/notifications-live → lib/notifications/derive-core). Pure function,
 * deterministic `now` injected — mirrors the packs-alert test pattern.
 *
 * The rules that have burned us before (and are asserted here):
 *   • 新規予約 MUST filter starts_at >= now (the daily re-sync touches
 *     created_at on ~86 past rows/day — without the future filter they
 *     false-fire en masse and flood the badge).
 *   • 要フォロー/休眠 is ONE roll-up item, never per-customer (~250 dormant).
 *   • 未保存カルテ dedupes by customer + age-gates > 1 day (one seed account
 *     holds most drafts today; without both it dominates the count).
 */
import {
  assembleNotificationFeed,
  type AssembleFeedInputs,
} from '@/lib/notifications/derive-core'

const NOW = new Date('2026-06-17T12:00:00+09:00')
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString()
const hoursAhead = (h: number) =>
  new Date(NOW.getTime() + h * 3_600_000).toISOString()
const daysAgo = (d: number) => hoursAgo(d * 24)

const HREFS = {
  agenda: '/ja/appointments',
  customers: '/ja/customers',
  customersFollowup: '/ja/customers',
  customersSyncPending: '/ja/customers',
  karute: '/ja/karute',
}

function build(over: Partial<AssembleFeedInputs> = {}) {
  return assembleNotificationFeed({
    now: NOW,
    hrefs: HREFS,
    todayAppointments: [],
    recentBookings: [],
    chase: { needsFollowup: 0, dormant: 0 },
    drafts: [],
    syncPendingCount: 0,
    ...over,
  })
}

const byId = (feed: ReturnType<typeof build>, id: string) =>
  feed.find((n) => n.id === id)

describe('本日のご予約 digest (system, info — not a badge driver)', () => {
  it('counts total + first-timer split (is_existing_customer === false ⇒ new)', () => {
    const feed = build({
      todayAppointments: [
        { isExistingCustomer: false },
        { isExistingCustomer: false },
        { isExistingCustomer: true },
        { isExistingCustomer: undefined }, // unknown ⇒ counted as existing
      ],
    })
    const digest = byId(feed, 'digest-today')
    expect(digest).toBeDefined()
    expect(digest!.category).toBe('system')
    expect(digest!.titleJa).toBe('本日のご予約 4件')
    expect(digest!.bodyJa).toBe('新規 2名・既存 2名')
  })

  it('emits nothing when there are no appointments today', () => {
    expect(byId(build(), 'digest-today')).toBeUndefined()
  })
})

describe('新規予約 (booking — the ONLY badge driver)', () => {
  it('emits ONE item per recent FUTURE booking (so the badge counts naturally)', () => {
    const feed = build({
      recentBookings: [
        { id: 'a', customerName: '田中', createdAt: hoursAgo(2), startsAt: hoursAhead(48) },
        { id: 'b', customerName: '佐藤', createdAt: hoursAgo(5), startsAt: hoursAhead(72) },
      ],
    })
    const bookings = feed.filter((n) => n.category === 'booking')
    expect(bookings).toHaveLength(2)
    expect(bookings.map((n) => n.id).sort()).toEqual(['booking-a', 'booking-b'])
  })

  it('FILTERS OUT bookings whose starts_at is in the past (re-sync false-fire guard)', () => {
    const feed = build({
      recentBookings: [
        // Freshly re-synced (created 1h ago) but the appointment already
        // happened yesterday — MUST NOT fire. This is the ~86 rows/day case.
        { id: 'stale', customerName: '再同期', createdAt: hoursAgo(1), startsAt: daysAgo(1) },
        // Genuinely new future booking — SHOULD fire.
        { id: 'real', customerName: '新規', createdAt: hoursAgo(1), startsAt: hoursAhead(24) },
      ],
    })
    const bookings = feed.filter((n) => n.category === 'booking')
    expect(bookings).toHaveLength(1)
    expect(bookings[0].id).toBe('booking-real')
  })

  it('FILTERS OUT bookings created outside the recency window (old future bookings)', () => {
    const feed = build({
      recentBookings: [
        // Future appointment, but the row was created 5 days ago — not "new".
        { id: 'old', customerName: '既存', createdAt: daysAgo(5), startsAt: hoursAhead(48) },
      ],
    })
    expect(feed.filter((n) => n.category === 'booking')).toHaveLength(0)
  })

  it('uses the booking created_at as the item createdAt (so unread math keys on it)', () => {
    const created = hoursAgo(3)
    const feed = build({
      recentBookings: [
        { id: 'a', customerName: '田中', createdAt: created, startsAt: hoursAhead(48) },
      ],
    })
    expect(byId(feed, 'booking-a')!.createdAt).toBe(created)
  })
})

describe('要フォロー/休眠 roll-up (customer_return — ONE item, never per-customer)', () => {
  it('is a SINGLE item even when hundreds of customers are dormant', () => {
    const feed = build({ chase: { needsFollowup: 18, dormant: 109 } })
    const rollups = feed.filter((n) => n.category === 'customer_return')
    expect(rollups).toHaveLength(1)
    expect(rollups[0].id).toBe('followup-rollup')
    expect(rollups[0].titleJa).toBe('要フォロー 18名・休眠 109名')
  })

  it('rounds the counts', () => {
    const feed = build({ chase: { needsFollowup: 18.4, dormant: 108.6 } })
    expect(byId(feed, 'followup-rollup')!.titleJa).toBe('要フォロー 18名・休眠 109名')
  })

  it('emits nothing when both counts are zero', () => {
    expect(byId(build(), 'followup-rollup')).toBeUndefined()
  })
})

describe('未保存カルテ (memory_review — dedupe by customer + age-gate > 1 day)', () => {
  it('dedupes by customer so one account\'s many drafts count once', () => {
    const old = daysAgo(3)
    const feed = build({
      drafts: [
        { customerId: 'seed', createdAt: old },
        { customerId: 'seed', createdAt: old },
        { customerId: 'seed', createdAt: old },
        { customerId: 'other', createdAt: old },
      ],
    })
    // 4 draft rows across 2 customers → count = 2.
    expect(byId(feed, 'draft-karute-rollup')!.titleJa).toBe('未保存カルテ 2件')
  })

  it('age-gates out drafts younger than 1 day (staff still editing)', () => {
    const feed = build({
      drafts: [
        { customerId: 'a', createdAt: hoursAgo(2) }, // too fresh — excluded
        { customerId: 'b', createdAt: daysAgo(2) }, // old enough — counts
      ],
    })
    expect(byId(feed, 'draft-karute-rollup')!.titleJa).toBe('未保存カルテ 1件')
  })

  it('emits nothing when every draft is too fresh', () => {
    const feed = build({
      drafts: [{ customerId: 'a', createdAt: hoursAgo(1) }],
    })
    expect(byId(feed, 'draft-karute-rollup')).toBeUndefined()
  })

  it('counts null-customer drafts individually (cannot be deduped)', () => {
    const old = daysAgo(2)
    const feed = build({
      drafts: [
        { customerId: null, createdAt: old },
        { customerId: null, createdAt: old },
      ],
    })
    expect(byId(feed, 'draft-karute-rollup')!.titleJa).toBe('未保存カルテ 2件')
  })
})

describe('同期待ち (system — standing info, not a badge driver)', () => {
  it('renders the rounded count', () => {
    const feed = build({ syncPendingCount: 12 })
    const sync = byId(feed, 'sync-pending-rollup')
    expect(sync!.category).toBe('system')
    expect(sync!.titleJa).toBe('同期待ち 12名')
  })

  it('emits nothing when zero', () => {
    expect(byId(build(), 'sync-pending-rollup')).toBeUndefined()
  })
})

describe('feed assembly invariants', () => {
  it('every item is bilingual (titleJa/titleEn always set)', () => {
    const feed = build({
      todayAppointments: [{ isExistingCustomer: false }],
      recentBookings: [
        { id: 'a', customerName: '田中', createdAt: hoursAgo(2), startsAt: hoursAhead(48) },
      ],
      chase: { needsFollowup: 1, dormant: 2 },
      drafts: [{ customerId: 'a', createdAt: daysAgo(2) }],
      syncPendingCount: 3,
    })
    expect(feed).toHaveLength(5) // one per source
    for (const n of feed) {
      expect(n.titleJa.length).toBeGreaterThan(0)
      expect(n.titleEn.length).toBeGreaterThan(0)
      expect(n.id.length).toBeGreaterThan(0)
    }
  })

  it('is sorted newest-first by createdAt', () => {
    const feed = build({
      todayAppointments: [{ isExistingCustomer: true }], // digest at JST midnight
      recentBookings: [
        { id: 'a', customerName: '田中', createdAt: hoursAgo(1), startsAt: hoursAhead(48) },
      ],
    })
    const times = feed.map((n) => new Date(n.createdAt).getTime())
    const sorted = [...times].sort((a, b) => b - a)
    expect(times).toEqual(sorted)
    // The booking (1h ago) sorts above the digest (today's JST midnight).
    expect(feed[0].id).toBe('booking-a')
  })
})
