/**
 * Unit coverage for the customer list-enrichment helpers added in
 * "PR 17 — customers list + pagination + staff filter" (replay/17).
 *
 * `enrichCustomers` reads karute + appointments from synqed-core (mocked
 * here via the SynqedClient constructor); the rest are pure functions.
 * synqed karute records carry only `created_at` (no separate session_date),
 * so last-visit is the latest created_at; appointments carry `starts_at`.
 */

process.env.SYNQED_CORE_URL = 'http://synqed.test'
process.env.SYNQED_CORE_API_KEY = 'test-key'

// Staged enrichment rows, read lazily inside the mocked customers.enrichment()
// so individual tests can set them. Shape mirrors @synqed-kk/client's
// CustomerEnrichment (snake_case). The per-customer aggregation logic itself
// (last visit, visit counts, 担当, past/future split) now lives in synqed-core's
// GET /v1/customers/enrichment SQL — enrichCustomers just maps + defaults here.
type EnrichRow = {
  customer_id: string
  total_karute: number
  last_visit: string | null
  first_visit: string | null
  past_appointment_count: number
  last_visit_service: string | null
  booking_staff_id: string | null
  next_appointment: string | null
  dated_visit_count: number
  no_show_count?: number
}
let enrichmentRows: EnrichRow[] = []
const customers = { enrichment: jest.fn(async () => enrichmentRows) }

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => ({ customers })),
}))

// enrichCustomers now wraps its three source reads in unstable_cache (keyed by
// businessId). Pass it through so every case re-reads the per-test `scenario`
// fresh — without this the shared 'biz-1' key would serve the first case's rows
// to all the rest. Mirrors the sibling cache tests (dashboard-cached, booking-flow…).
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

import {
  enrichCustomers,
  deriveStatus,
  resolveCustomerStatus,
  isReturningCustomer,
  customerVisitCount,
  formatJoinDate,
  formatLastVisit,
  deriveKaruteNumber,
  defaultAiPredict,
  type LastVisitStrings,
} from '@/lib/customers/list-enrich'
import { isRepeatNoShow } from '@/components/customers/redesign/types'

beforeEach(() => {
  enrichmentRows = []
  customers.enrichment.mockClear()
})

const DAY = 86_400_000

describe('enrichCustomers', () => {
  it('returns an empty map without calling core when no ids are given', async () => {
    const map = await enrichCustomers('biz-1', [])
    expect(map.size).toBe(0)
    expect(customers.enrichment).not.toHaveBeenCalled()
  })

  it('maps the aggregated rows (snake_case → camelCase) for requested ids', async () => {
    enrichmentRows = [
      {
        customer_id: 'a',
        total_karute: 2,
        last_visit: '2026-03-02T00:00:00Z',
        first_visit: '2026-01-02T00:00:00Z',
        past_appointment_count: 3,
        last_visit_service: 'カット+カラー',
        booking_staff_id: 'staff-1',
        next_appointment: '2026-07-01T00:00:00Z',
        dated_visit_count: 5,
        no_show_count: 3,
      },
    ]
    const map = await enrichCustomers('biz-1', ['a'])
    expect(map.get('a')).toEqual({
      totalKarute: 2,
      lastVisitIso: '2026-03-02T00:00:00Z',
      firstVisitIso: '2026-01-02T00:00:00Z',
      pastAppointmentCount: 3,
      lastVisitService: 'カット+カラー',
      bookingStaffId: 'staff-1',
      nextAppointmentIso: '2026-07-01T00:00:00Z',
      datedVisitCount: 5,
      noShowCount: 3,
    })
  })

  it('defaults noShowCount to 0 when the row omits it (SDK types lag synqed-core #39)', async () => {
    enrichmentRows = [
      {
        customer_id: 'a',
        total_karute: 1,
        last_visit: null,
        first_visit: null,
        past_appointment_count: 0,
        last_visit_service: null,
        booking_staff_id: null,
        next_appointment: null,
        dated_visit_count: 0,
        // no_show_count intentionally omitted
      },
    ]
    const map = await enrichCustomers('biz-1', ['a'])
    expect(map.get('a')?.noShowCount).toBe(0)
  })

  it('returns a zeroed entry for every requested id with no core data', async () => {
    enrichmentRows = []
    const map = await enrichCustomers('biz-1', ['a', 'b'])
    expect(map.size).toBe(2)
    expect(map.get('a')).toEqual({
      totalKarute: 0,
      lastVisitIso: null,
      pastAppointmentCount: 0,
      lastVisitService: null,
      bookingStaffId: null,
      nextAppointmentIso: null,
      firstVisitIso: null,
      datedVisitCount: 0,
      noShowCount: 0,
    })
  })

  it('includes only requested ids — a core row for another customer is ignored', async () => {
    const base = {
      total_karute: 0, last_visit: null, first_visit: null, past_appointment_count: 0,
      last_visit_service: null, booking_staff_id: null, next_appointment: null, dated_visit_count: 0,
    }
    enrichmentRows = [
      { ...base, customer_id: 'a', total_karute: 1, dated_visit_count: 1 },
      { ...base, customer_id: 'z', total_karute: 9, dated_visit_count: 9 },
    ]
    const map = await enrichCustomers('biz-1', ['a'])
    expect(map.get('a')?.totalKarute).toBe(1)
    expect(map.has('z')).toBe(false)
  })
})

describe('deriveStatus', () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

  it('returns "new" when the join date is within the last 30 days', () => {
    expect(deriveStatus(iso(10 * DAY), iso(200 * DAY))).toBe('new')
  })

  it('returns "new" when there is no last visit', () => {
    expect(deriveStatus(null, null)).toBe('new')
    expect(deriveStatus(iso(365 * DAY), null)).toBe('new')
  })

  it('returns "dormant" when the last visit is more than 90 days ago', () => {
    expect(deriveStatus(iso(365 * DAY), iso(120 * DAY))).toBe('dormant')
  })

  it('returns "needs-followup" between 61 and 90 days', () => {
    expect(deriveStatus(iso(365 * DAY), iso(75 * DAY))).toBe('needs-followup')
  })

  it('returns "on-track" within 60 days', () => {
    expect(deriveStatus(iso(365 * DAY), iso(10 * DAY))).toBe('on-track')
  })

  it('treats exactly 90 days as dormant — the label says 90日以上 (inclusive)', () => {
    // daysSince === 90 → >= 90 → dormant (matches 休眠（90日以上）); 89 stays followup
    expect(deriveStatus(iso(365 * DAY), iso(90 * DAY))).toBe('dormant')
    expect(deriveStatus(iso(365 * DAY), iso(89 * DAY))).toBe('needs-followup')
  })

  it('prioritizes the recent-join "new" rule over an old last visit', () => {
    // Joined 5 days ago but last visit 200 days ago → still "new".
    expect(deriveStatus(iso(5 * DAY), iso(200 * DAY))).toBe('new')
  })

  it('a recently-joined customer WITH prior visits is NOT 新規 (the 11-visit bug)', () => {
    // Joined 5 days ago (would be "new" by join date) but has 11 prior visits —
    // a hand-added / QR-backfilled customer. visit_count overrides the join date.
    expect(deriveStatus(iso(5 * DAY), null, false, 11)).toBe('on-track')
    expect(deriveStatus(iso(5 * DAY), iso(10 * DAY), false, 11)).toBe('on-track')
    // Zero prior visits → the recent-join "new" rule still applies (unchanged).
    expect(deriveStatus(iso(5 * DAY), null, false, 0)).toBe('new')
  })
})

describe('resolveCustomerStatus / isReturningCustomer (single source of truth)', () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

  it('a QR regular (visit_count>0) recorded 0 karute is RETURNING, not 新規 — the 臼井 bug', () => {
    // 臼井: joined recently, NO karute in the new system, but visit_count 5 + a
    // 6回券. The list used to ignore visit_count + ticket pack → 新規; the profile
    // used them → 継続中. The resolver makes both agree: returning.
    const signals = {
      joinDateIso: iso(5 * DAY),
      lastVisitIso: null,
      isExistingCustomer: false,
      visitCount: 5,
      karuteCount: 0,
      hasTicketPack: true,
    }
    expect(isReturningCustomer(signals)).toBe(true)
    expect(resolveCustomerStatus(signals)).not.toBe('new')
    expect(resolveCustomerStatus(signals)).toBe('on-track')
  })

  it('the 回数券 alone makes a brand-new-looking customer returning', () => {
    expect(
      resolveCustomerStatus({
        joinDateIso: iso(2 * DAY),
        lastVisitIso: null,
        hasTicketPack: true,
      }),
    ).toBe('on-track')
  })

  it('a genuinely new customer (no signals) is still 新規', () => {
    expect(
      resolveCustomerStatus({ joinDateIso: iso(2 * DAY), lastVisitIso: null }),
    ).toBe('new')
    expect(
      isReturningCustomer({ joinDateIso: iso(2 * DAY), lastVisitIso: null }),
    ).toBe(false)
  })

  it('the SAME signals always yield the SAME status (every surface agrees)', () => {
    const s = {
      joinDateIso: iso(5 * DAY),
      lastVisitIso: iso(10 * DAY),
      visitCount: 5,
      karuteCount: 0,
    }
    // List, profile, recording, agenda all call this with the same fields →
    // identical result. No page can drift.
    expect(resolveCustomerStatus(s)).toBe(resolveCustomerStatus({ ...s }))
  })

  it('customerVisitCount returns the strongest visit evidence (max), consistently', () => {
    expect(
      customerVisitCount({
        joinDateIso: null,
        lastVisitIso: null,
        visitCount: 5,
        karuteCount: 2,
        pastAppointmentCount: 1,
      }),
    ).toBe(5)
  })

  it('deriveStatus is a thin shim over the resolver (back-compat preserved)', () => {
    // priorVisitCount maps to karuteCount; old behavior unchanged.
    expect(deriveStatus(iso(5 * DAY), null, false, 11)).toBe('on-track')
    expect(deriveStatus(iso(5 * DAY), null, false, 0)).toBe('new')
  })
})

describe('formatJoinDate', () => {
  // Use a fixed Date and compare against the same Intl formatter the helper
  // uses, so assertions stay correct regardless of the runner's timezone
  // (a UTC-midnight string would render as the previous day in -offset TZs).
  const ISO = '2026-05-24T12:00:00Z'
  const expected = (tag: string, month: 'short' | 'long') =>
    new Intl.DateTimeFormat(tag, { year: 'numeric', month, day: 'numeric' }).format(new Date(ISO))

  it('returns an em dash for null', () => {
    expect(formatJoinDate(null)).toBe('—')
  })

  it('formats English with a short month by default', () => {
    const out = formatJoinDate(ISO, 'en')
    expect(out).toBe(expected('en-US', 'short'))
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026$/) // "May 24, 2026" shape
  })

  it('formats Japanese with kanji separators and a long month', () => {
    const out = formatJoinDate(ISO, 'ja')
    expect(out).toBe(expected('ja-JP', 'long'))
    expect(out).toMatch(/年.*月.*日$/)
  })

  it('defaults unknown locales to en-US formatting', () => {
    expect(formatJoinDate(ISO, 'fr')).toBe(expected('en-US', 'short'))
  })
})

describe('formatLastVisit', () => {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()
  const jaStrings: LastVisitStrings = {
    noVisits: 'なし',
    today: '今日',
    oneDayAgo: '昨日',
    daysAgo: (n) => `${n}日前`,
    monthsAgo: (n) => `${n}ヶ月前`,
  }

  it('returns the no-visits string and em dash for null', () => {
    expect(formatLastVisit(null)).toEqual({ date: '—', ago: 'No visits' })
    expect(formatLastVisit(null, 'ja', jaStrings)).toEqual({ date: '—', ago: 'なし' })
  })

  it('uses the default English strings when none are injected', () => {
    expect(formatLastVisit(iso(0)).ago).toBe('Today')
    expect(formatLastVisit(iso(1)).ago).toBe('1 day ago')
    expect(formatLastVisit(iso(5)).ago).toBe('5 days ago')
    expect(formatLastVisit(iso(45)).ago).toBe('1 mo ago')
  })

  it('uses injected strings for the relative label', () => {
    expect(formatLastVisit(iso(0), 'ja', jaStrings).ago).toBe('今日')
    expect(formatLastVisit(iso(1), 'ja', jaStrings).ago).toBe('昨日')
    expect(formatLastVisit(iso(3), 'ja', jaStrings).ago).toBe('3日前')
    expect(formatLastVisit(iso(60), 'ja', jaStrings).ago).toBe('2ヶ月前')
  })

  it('crosses the 30-day boundary into months', () => {
    expect(formatLastVisit(iso(29)).ago).toBe('29 days ago')
    expect(formatLastVisit(iso(30)).ago).toBe('1 mo ago')
  })

  it('clamps a future date to "today" (never negative)', () => {
    const future = new Date(Date.now() + 5 * DAY).toISOString()
    expect(formatLastVisit(future).ago).toBe('Today')
  })

  it('includes the locale-formatted date alongside the relative label', () => {
    const ISO = '2026-05-24T12:00:00Z'
    const { date } = formatLastVisit(ISO, 'ja', jaStrings)
    // Same output as the standalone JP join-date formatter.
    expect(date).toBe(formatJoinDate(ISO, 'ja'))
    expect(date).toMatch(/年.*月.*日$/)
  })
})

describe('deriveKaruteNumber', () => {
  it('produces a "#" + 5-digit decimal string', () => {
    expect(deriveKaruteNumber('abcdef12-0000-0000-0000-000000000000')).toMatch(/^#\d{5}$/)
  })

  it('is deterministic for a given id', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    expect(deriveKaruteNumber(id)).toBe(deriveKaruteNumber(id))
  })

  it('zero-pads small values to 5 digits', () => {
    // First 6 hex chars "000001" → 1 → "#00001".
    expect(deriveKaruteNumber('000001ab-0000-0000-0000-000000000000')).toBe('#00001')
  })

  it('applies modulo 100000 to keep it 5 digits', () => {
    // First 6 hex chars "ffffff" = 16777215 % 100000 = 77215.
    expect(deriveKaruteNumber('ffffff00-0000-0000-0000-000000000000')).toBe('#77215')
  })

  it('strips dashes before slicing the first 6 hex chars', () => {
    // "ab-cdef" → "abcdef" so dashes inside the prefix don't poison the parse.
    expect(deriveKaruteNumber('ab-cdef-00-0000-000000000000')).toBe(
      deriveKaruteNumber('abcdef000000000000000000000000000000'),
    )
  })
})

describe('defaultAiPredict', () => {
  it('suggests reaching out this week for dormant customers', () => {
    expect(defaultAiPredict('dormant')).toEqual({ label: 'Reach out', when: 'This week' })
  })

  it('suggests a follow-up for needs-followup customers', () => {
    expect(defaultAiPredict('needs-followup')).toEqual({ label: 'Follow up', when: 'Soon' })
  })

  it('falls back to a recommendation for on-track / new', () => {
    expect(defaultAiPredict('on-track')).toEqual({ label: 'Recommend', when: '—' })
    expect(defaultAiPredict('new')).toEqual({ label: 'Recommend', when: '—' })
  })
})

describe('formatCompactDate (案A card rails)', () => {
  const { formatCompactDate } = jest.requireActual('@/lib/customers/list-enrich')
  const NOW = new Date('2026-06-11T03:00:00Z')
  it('current-year dates drop the year', () => {
    expect(formatCompactDate('2026-06-02T01:00:00Z', 'ja', NOW)).toBe('6/2')
  })
  it('prior-year dates keep the year', () => {
    expect(formatCompactDate('2025-12-24T01:00:00Z', 'ja', NOW)).toBe('2025/12/24')
  })
  it('null/invalid → null', () => {
    expect(formatCompactDate(null, 'ja', NOW)).toBe(null)
    expect(formatCompactDate('garbage', 'ja', NOW)).toBe(null)
  })
})

describe('lifecycle decisions outrank cadence (案B)', () => {
  const { resolveCustomerStatus } = jest.requireActual('@/lib/customers/list-enrich')
  const old = new Date(Date.now() - 219 * 86_400_000).toISOString()
  const join = new Date(Date.now() - 365 * 86_400_000).toISOString()
  it('卒業 + 219 days absent → graduated, NOT dormant', () => {
    expect(resolveCustomerStatus({ joinDateIso: join, lastVisitIso: old, visitCount: 4, lifecycleStatus: 'graduated' })).toBe('graduated')
  })
  it('離客 → lost regardless of cadence', () => {
    expect(resolveCustomerStatus({ joinDateIso: join, lastVisitIso: old, visitCount: 4, lifecycleStatus: 'lost' })).toBe('lost')
  })
  it('active lifecycle → cadence rules unchanged (219d → dormant)', () => {
    expect(resolveCustomerStatus({ joinDateIso: join, lastVisitIso: old, visitCount: 4, lifecycleStatus: 'active' })).toBe('dormant')
  })
})

describe('effectiveLastVisitIso — one rule for every surface', () => {
  const { effectiveLastVisitIso } = jest.requireActual('@/lib/customers/list-enrich')
  it('synced rows beat the customer-record field', () => {
    expect(effectiveLastVisitIso('2026-06-09', '2026-06-01')).toBe('2026-06-09')
  })
  it('falls back to last_visit_at (sheet import) when no synced rows', () => {
    expect(effectiveLastVisitIso(null, '2026-06-01')).toBe('2026-06-01')
  })
  it('null when neither exists', () => {
    expect(effectiveLastVisitIso(null, null)).toBe(null)
    expect(effectiveLastVisitIso(undefined, undefined)).toBe(null)
  })
})

describe('案1 day math + formats', () => {
  const { formatLastVisit, formatCompactDate } = jest.requireActual('@/lib/customers/list-enrich')
  const { jstDaysBetween } = jest.requireActual('@/lib/date/jst')
  const S = { noVisits: 'なし', today: '本日', oneDayAgo: '1日前', daysAgo: (n: number) => `${n}日前`, monthsAgo: (n: number) => `${n}ヶ月前`, yearsAgo: (n: number) => `${n}年前` }
  it('yearsAgo tier: 400 days → 1年前 (not 13ヶ月前)', () => {
    const iso = new Date(Date.now() - 400 * 86_400_000).toISOString()
    expect(formatLastVisit(iso, 'ja', S).ago).toBe('1年前')
  })
  it('monthsAgo tier unchanged: 219 days → 7ヶ月前', () => {
    const iso = new Date(Date.now() - 219 * 86_400_000).toISOString()
    expect(formatLastVisit(iso, 'ja', S).ago).toBe('7ヶ月前')
  })
  it('jstDaysBetween counts JST midnights (same-instant offset = exact days)', () => {
    const iso = new Date(Date.now() - 6 * 86_400_000).toISOString()
    expect(jstDaysBetween(iso)).toBe(6)
  })
  it('formatCompactDate withWeekday: 予約 rail form 6/15(月) style', () => {
    const NOW = new Date('2026-06-11T03:00:00Z')
    const out = formatCompactDate('2026-06-15T01:00:00Z', 'ja', NOW, { withWeekday: true })
    expect(out).toMatch(/^6\/15\(.\)$/)
  })
})

describe('isRepeatNoShow — the >= 2 threshold (a single no-show is not flagged)', () => {
  it('flags 2 and above', () => {
    expect(isRepeatNoShow(2)).toBe(true)
    expect(isRepeatNoShow(3)).toBe(true)
  })
  it('does not flag 0 or 1', () => {
    expect(isRepeatNoShow(0)).toBe(false)
    expect(isRepeatNoShow(1)).toBe(false)
  })
  it('treats missing/undefined as 0 (not flagged)', () => {
    expect(isRepeatNoShow(undefined)).toBe(false)
    expect(isRepeatNoShow(null)).toBe(false)
  })
})

describe('a future booking clears the chase states (Liam: booked ≠ follow-up)', () => {
  const { resolveCustomerStatus } = jest.requireActual('@/lib/customers/list-enrich')
  const old65 = new Date(Date.now() - 65 * 86_400_000).toISOString()
  const old200 = new Date(Date.now() - 200 * 86_400_000).toISOString()
  const join = new Date(Date.now() - 400 * 86_400_000).toISOString()
  it('65 days absent + upcoming booking → on-track (not 要フォロー)', () => {
    expect(resolveCustomerStatus({ joinDateIso: join, lastVisitIso: old65, visitCount: 9, hasUpcomingBooking: true })).toBe('on-track')
  })
  it('200 days absent + upcoming booking → on-track (not 休眠)', () => {
    expect(resolveCustomerStatus({ joinDateIso: join, lastVisitIso: old200, visitCount: 9, hasUpcomingBooking: true })).toBe('on-track')
  })
  it('no booking → cadence rules unchanged (65d → 要フォロー)', () => {
    expect(resolveCustomerStatus({ joinDateIso: join, lastVisitIso: old65, visitCount: 9, hasUpcomingBooking: false })).toBe('needs-followup')
  })
  it('lifecycle still outranks the booking (卒業 + booking → graduated)', () => {
    expect(resolveCustomerStatus({ joinDateIso: join, lastVisitIso: old200, visitCount: 9, hasUpcomingBooking: true, lifecycleStatus: 'graduated' })).toBe('graduated')
  })
})
