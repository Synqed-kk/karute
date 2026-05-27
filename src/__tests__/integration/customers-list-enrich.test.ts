/**
 * Unit coverage for the customer list-enrichment helpers added in
 * "PR 17 — customers list + pagination + staff filter" (replay/17).
 *
 * `enrichCustomers` does a service-role batched read (Supabase mocked here);
 * the rest are pure functions. All live in the jest suite alongside the
 * other integration tests.
 */

// Mock the service client BEFORE importing the module under test. The scenario
// object is read lazily inside the mock so individual tests can stage rows.
const scenario: {
  karute: Array<{ client_id: string; session_date: string | null; created_at: string }>
  appts: Array<{ client_id: string; start_time: string }>
} = { karute: [], appts: [] }

jest.mock('@/lib/supabase/service', () => {
  // A query builder where .select/.eq are chainable and .in resolves to the
  // staged rows. Two tables are queried (karute_records, appointments); we
  // route by the table name passed to .from().
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {}
    builder.select = jest.fn(() => builder)
    builder.eq = jest.fn(() => builder)
    builder.in = jest.fn(async () => ({
      data: table === 'karute_records' ? scenario.karute : scenario.appts,
      error: null,
    }))
    return builder
  }
  return {
    createServiceClient: jest.fn(() => ({
      from: jest.fn((table: string) => makeBuilder(table)),
    })),
  }
})

import {
  enrichCustomers,
  deriveStatus,
  formatJoinDate,
  formatLastVisit,
  deriveKaruteNumber,
  defaultAiPredict,
  type LastVisitStrings,
} from '@/lib/customers/list-enrich'

beforeEach(() => {
  scenario.karute = []
  scenario.appts = []
})

const DAY = 86_400_000

describe('enrichCustomers', () => {
  it('returns an empty map without querying when no customer ids are given', async () => {
    const map = await enrichCustomers('biz-1', [])
    expect(map.size).toBe(0)
  })

  it('counts karute per client and uses the latest session_date as last visit', async () => {
    scenario.karute = [
      { client_id: 'a', session_date: '2026-01-01T00:00:00Z', created_at: '2026-01-02T00:00:00Z' },
      { client_id: 'a', session_date: '2026-03-01T00:00:00Z', created_at: '2026-03-02T00:00:00Z' },
      { client_id: 'b', session_date: '2026-02-01T00:00:00Z', created_at: '2026-02-02T00:00:00Z' },
    ]
    const map = await enrichCustomers('biz-1', ['a', 'b'])
    expect(map.get('a')).toMatchObject({
      totalKarute: 2,
      visitsDone: 2,
      lastVisitIso: '2026-03-01T00:00:00Z',
    })
    expect(map.get('b')).toMatchObject({ totalKarute: 1, lastVisitIso: '2026-02-01T00:00:00Z' })
  })

  it('falls back to created_at when session_date is null', async () => {
    scenario.karute = [
      { client_id: 'a', session_date: null, created_at: '2026-04-01T00:00:00Z' },
    ]
    const map = await enrichCustomers('biz-1', ['a'])
    expect(map.get('a')?.lastVisitIso).toBe('2026-04-01T00:00:00Z')
  })

  it('produces a zeroed entry for every requested id even with no records', async () => {
    const map = await enrichCustomers('biz-1', ['a', 'b'])
    expect(map.size).toBe(2)
    expect(map.get('a')).toEqual({
      totalKarute: 0,
      lastVisitIso: null,
      visitsDone: 0,
      pastAppointmentCount: 0,
    })
  })

  it('falls back to appointment start_time for last visit when there is no karute', async () => {
    const past = new Date(Date.now() - 5 * DAY).toISOString()
    const older = new Date(Date.now() - 50 * DAY).toISOString()
    scenario.appts = [
      { client_id: 'a', start_time: older },
      { client_id: 'a', start_time: past },
    ]
    const map = await enrichCustomers('biz-1', ['a'])
    // Latest of the two appointment times.
    expect(map.get('a')?.lastVisitIso).toBe(past)
  })

  it('prefers karute over appointments for last-visit even when an appointment is newer', async () => {
    const newerAppt = new Date(Date.now() + 10 * DAY).toISOString()
    scenario.karute = [
      { client_id: 'a', session_date: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
    ]
    scenario.appts = [{ client_id: 'a', start_time: newerAppt }]
    const map = await enrichCustomers('biz-1', ['a'])
    expect(map.get('a')?.lastVisitIso).toBe('2026-01-01T00:00:00Z')
  })

  it('counts only appointments that started before now as past appointments', async () => {
    const past1 = new Date(Date.now() - 2 * DAY).toISOString()
    const past2 = new Date(Date.now() - 1 * DAY).toISOString()
    const future = new Date(Date.now() + 2 * DAY).toISOString()
    scenario.appts = [
      { client_id: 'a', start_time: past1 },
      { client_id: 'a', start_time: past2 },
      { client_id: 'a', start_time: future },
    ]
    const map = await enrichCustomers('biz-1', ['a'])
    expect(map.get('a')?.pastAppointmentCount).toBe(2)
  })

  it('reports zero past appointments for a genuinely first-time customer (future booking only)', async () => {
    const future = new Date(Date.now() + 3 * DAY).toISOString()
    scenario.appts = [{ client_id: 'a', start_time: future }]
    const map = await enrichCustomers('biz-1', ['a'])
    expect(map.get('a')?.pastAppointmentCount).toBe(0)
    expect(map.get('a')?.totalKarute).toBe(0)
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

  it('treats exactly 90 days as on the followup side (not dormant)', () => {
    // daysSince === 90 → not > 90, but > 60 → needs-followup
    expect(deriveStatus(iso(365 * DAY), iso(90 * DAY))).toBe('needs-followup')
  })

  it('prioritizes the recent-join "new" rule over an old last visit', () => {
    // Joined 5 days ago but last visit 200 days ago → still "new".
    expect(deriveStatus(iso(5 * DAY), iso(200 * DAY))).toBe('new')
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
