/**
 * ONE HOME for a 予約 day's opening hours (spec §8 HOURS).
 *
 * Precedence: an ad-hoc 臨時休業 date → the store's own weekly_hours → the
 * business-wide blob → the 10:00–24:00 default with hoursSaved false.
 *
 * ⚠ The two nulls are different nulls (mirrored from
 * src/business/lib/settings.ts:1156-1160): `weekly_hours[day] = null` says the
 * store is closed that weekday; `weekly_hours = null` says it never configured
 * hours at all. Reading the second as the first would invent 定休日 for every
 * store on the platform.
 *
 * Pinned to TZ=UTC to mirror the deploy runtime.
 */
process.env.TZ = 'UTC'

import type { WeeklyHours } from '@synqed-kk/client'
import {
  DEFAULT_DAILY_OPERATING_HOURS,
  jstWindowDays,
  resolveDayHours,
  resolveWindowHours,
  type OperatingHours,
} from '@/lib/operating-hours'
import { computeWeekRange } from '@/lib/date/calendar-range'

const TUE = new Date('2026-09-15T00:00:00+09:00')
const WED = new Date('2026-09-16T00:00:00+09:00')
const NO_CLOSURES = new Set<string>()
const NOTHING_SAVED = new Set<never>()

const STORE_OPEN_TUE: WeeklyHours = { tue: { open: '10:00', close: '20:00' } }

/** An org blob with tue saved 09:00–17:00 and nothing else. */
const ORG_HOURS = {
  mon: { ...DEFAULT_DAILY_OPERATING_HOURS },
  tue: { openMinute: 540, closeMinute: 1020 },
  wed: { ...DEFAULT_DAILY_OPERATING_HOURS },
  thu: { ...DEFAULT_DAILY_OPERATING_HOURS },
  fri: { ...DEFAULT_DAILY_OPERATING_HOURS },
  sat: { ...DEFAULT_DAILY_OPERATING_HOURS },
  sun: { ...DEFAULT_DAILY_OPERATING_HOURS },
} as OperatingHours

describe("resolveDayHours — the store's own weekly_hours", () => {
  it('a configured Tuesday: 10:00–20:00 = 600 minutes, saved, open', () => {
    expect(
      resolveDayHours({
        date: TUE,
        weeklyHours: STORE_OPEN_TUE,
        closedDates: NO_CLOSURES,
        orgHours: null,
        orgSaved: NOTHING_SAVED,
      }),
    ).toEqual({
      minutes: 600,
      openMinute: 600,
      closeMinute: 1200,
      saved: true,
      closed: false,
    })
  })

  it('an ABSENT weekday is 定休日, not "fall back to the blob" (mutant m7)', () => {
    const fact = resolveDayHours({
      date: WED,
      weeklyHours: STORE_OPEN_TUE,
      closedDates: NO_CLOSURES,
      orgHours: ORG_HOURS,
      orgSaved: new Set(['wed'] as const),
    })
    expect(fact.closed).toBe(true)
    expect(fact.minutes).toBe(0)
    expect(fact.saved).toBe(true)
  })

  it('an EXPLICIT null weekday is 定休日 too', () => {
    const fact = resolveDayHours({
      date: WED,
      weeklyHours: { ...STORE_OPEN_TUE, wed: null },
      closedDates: NO_CLOSURES,
      orgHours: ORG_HOURS,
      orgSaved: NOTHING_SAVED,
    })
    expect(fact.closed).toBe(true)
  })

  it('a Tuesday policy read from a UTC-midnight MONDAY instant is still tue', () => {
    // 2026-09-14 15:00 UTC = 2026-09-15 00:00 JST. Under getDay() this asked
    // the policy for 'mon' — an absent weekday — and rendered 休.
    const fact = resolveDayHours({
      date: new Date('2026-09-14T15:00:00Z'),
      weeklyHours: STORE_OPEN_TUE,
      closedDates: NO_CLOSURES,
      orgHours: null,
      orgSaved: NOTHING_SAVED,
    })
    expect(fact.closed).toBe(false)
    expect(fact.minutes).toBe(600)
  })

  it('a malformed HH:MM falls through to the blob, and does NOT claim saved', () => {
    const fact = resolveDayHours({
      date: TUE,
      weeklyHours: { tue: { open: 'ten', close: '20:00' } },
      closedDates: NO_CLOSURES,
      orgHours: ORG_HOURS,
      orgSaved: NOTHING_SAVED, // the blob's tue is not saved either
    })
    expect(fact.saved).toBe(false)
    expect(fact.closed).toBe(false)
    expect(fact.minutes).toBe(1020 - 540) // the blob's own window
  })

  it('open ≥ close is malformed too', () => {
    const fact = resolveDayHours({
      date: TUE,
      weeklyHours: { tue: { open: '20:00', close: '20:00' } },
      closedDates: NO_CLOSURES,
      orgHours: ORG_HOURS,
      orgSaved: NOTHING_SAVED,
    })
    expect(fact.saved).toBe(false)
  })
})

describe('resolveDayHours — weekly_hours: null means NEVER CONFIGURED', () => {
  it('falls to the org blob, saved when that day was saved', () => {
    const fact = resolveDayHours({
      date: TUE,
      weeklyHours: null,
      closedDates: NO_CLOSURES,
      orgHours: ORG_HOURS,
      orgSaved: new Set(['tue'] as const),
    })
    expect(fact).toEqual({
      minutes: 480,
      openMinute: 540,
      closeMinute: 1020,
      saved: true,
      closed: false,
    })
  })

  it('an unsaved blob day is the 10:00–24:00 default with saved: false', () => {
    const fact = resolveDayHours({
      date: WED,
      weeklyHours: null,
      closedDates: NO_CLOSURES,
      orgHours: ORG_HOURS,
      orgSaved: new Set(['tue'] as const),
    })
    expect(fact.saved).toBe(false)
    expect(fact.closed).toBe(false)
    expect(fact.openMinute).toBe(DEFAULT_DAILY_OPERATING_HOURS.openMinute)
    expect(fact.closeMinute).toBe(DEFAULT_DAILY_OPERATING_HOURS.closeMinute)
  })

  it('no store at all behaves the same as never-configured', () => {
    const noStore = resolveDayHours({
      date: TUE,
      weeklyHours: null,
      closedDates: NO_CLOSURES,
      orgHours: ORG_HOURS,
      orgSaved: new Set(['tue'] as const),
    })
    expect(noStore.minutes).toBe(480)
    expect(noStore.saved).toBe(true)
  })
})

describe('resolveDayHours — 臨時休業 outranks everything', () => {
  it('an ad-hoc closed date closes the day even where the policy says open', () => {
    const fact = resolveDayHours({
      date: TUE,
      weeklyHours: STORE_OPEN_TUE,
      closedDates: new Set(['2026-09-15']),
      orgHours: ORG_HOURS,
      orgSaved: new Set(['tue'] as const),
    })
    expect(fact.closed).toBe(true)
    expect(fact.minutes).toBe(0)
    expect(fact.saved).toBe(true)
  })
})

describe('jstWindowDays / resolveWindowHours', () => {
  it('covers every JST day of the window inclusively and names the exclusive end', () => {
    const span = jstWindowDays(
      '2026-09-14T15:00:00Z', // 9/15 00:00 JST
      '2026-09-20T14:59:59.999Z', // 9/20 23:59 JST
    )
    // 15…20 inclusive = 6 days; the closed-days read asks for [15, 21).
    expect(span.days.map((d) => d.toISOString())).toHaveLength(6)
    expect(span.fromYmd).toBe('2026-09-15')
    expect(span.toExclusiveYmd).toBe('2026-09-21')
  })

  it("a rolling week's fetch range covers exactly 7 JST days", () => {
    const { rangeFrom, rangeTo } = computeWeekRange(TUE)
    const span = jstWindowDays(rangeFrom.toISOString(), rangeTo.toISOString())
    expect(span.days).toHaveLength(7)
    expect(span.fromYmd).toBe('2026-09-15')
    expect(span.toExclusiveYmd).toBe('2026-09-22')
  })

  it('keys every day of the window by its JST YYYY-MM-DD', () => {
    const span = jstWindowDays('2026-09-14T15:00:00Z', '2026-09-16T14:59:59.999Z')
    const facts = resolveWindowHours(span.days, {
      weeklyHours: STORE_OPEN_TUE,
      closedDates: NO_CLOSURES,
      orgHours: null,
      orgSaved: NOTHING_SAVED,
    })
    expect([...facts.keys()]).toEqual(['2026-09-15', '2026-09-16'])
    expect(facts.get('2026-09-15')!.minutes).toBe(600)
    expect(facts.get('2026-09-16')!.closed).toBe(true)
  })
})
