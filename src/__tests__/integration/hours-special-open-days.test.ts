/**
 * ⚖ W0.5 (PR A) — 臨時営業日: the resolver learns `special_open_days`.
 *
 * Core has carried `StoreBookingPolicy.special_open_days` since CORE-10
 * (9/14), and its own requireStoreOpen lets a special entry override BOTH a
 * 定休日 and a 臨時休業 row for that date. The app's resolver never read it, so
 * the 予約 screens painted 休 on — and the booking door refused — a day the
 * store had explicitly opened and core itself accepts.
 *
 * Pinned here (PKT-S25-W05-HOURS-PR-A):
 *   P1 — the precedence: special > closed date > weekly > org > default;
 *   P5 — the window wrapper carries the map;
 *   P6 — a malformed special day is ignored with ONE log line, never a throw,
 *        and never opens a closed day;
 *   + the map is keyed by the JST calendar day, never the UTC one;
 *   + where facts become capacity, 'special' narrows to 'store', so the wire's
 *     three-value hoursSource enum (baked into the thin bundle) never sees it.
 *
 * Pinned to TZ=UTC to mirror the deploy runtime.
 */
process.env.TZ = 'UTC'

import type { WeeklyHours } from '@synqed-kk/client'
import {
  jstWindowDays,
  resolveDayHours,
  resolveWindowHours,
  specialOpenDaysByDate,
  type DayHoursInput,
} from '@/lib/operating-hours'
import { appointmentsToMonthFacts, capacityRowFields } from '@/lib/adapters/reservation'
import { WeekDayCardDataDTO } from '@/lib/app-api/appointments-screen-dto'

/** 2026-09-15 is a TUESDAY in JST, 9/16 a WEDNESDAY, 9/17 a THURSDAY. */
const TUE = new Date('2026-09-15T12:00:00+09:00')
const WED = new Date('2026-09-16T12:00:00+09:00')

/** Open 10:00–19:00 every day but WEDNESDAY — the store's 定休日. */
const STORE_WEEK: WeeklyHours = {
  mon: { open: '10:00', close: '19:00' },
  tue: { open: '10:00', close: '19:00' },
  wed: null,
  thu: { open: '10:00', close: '19:00' },
  fri: { open: '10:00', close: '19:00' },
  sat: { open: '10:00', close: '19:00' },
  sun: { open: '10:00', close: '19:00' },
}

const NO_CLOSURES = new Set<string>()
const NOTHING_SAVED = new Set<never>()

function input(over: Partial<DayHoursInput>): DayHoursInput {
  return {
    date: TUE,
    weeklyHours: STORE_WEEK,
    closedDates: NO_CLOSURES,
    orgHours: null,
    orgSaved: NOTHING_SAVED,
    ...over,
  }
}

let errorSpy: jest.SpyInstance
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('P1 — a 臨時営業日 outranks a 臨時休業 date (core’s order, ⚖ G17)', () => {
  it('a special-open date on a closed date → open, on the special day’s OWN window', () => {
    const fact = resolveDayHours(
      input({
        closedDates: new Set(['2026-09-15']),
        specialOpenDays: new Map([['2026-09-15', { open: '10:00', close: '15:00' }]]),
      }),
    )
    expect(fact).toEqual({
      minutes: 300,
      openMinute: 600,
      closeMinute: 900,
      saved: true,
      source: 'special',
      closed: false,
    })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('the SAME date without the special entry → still the closed date', () => {
    const fact = resolveDayHours(input({ closedDates: new Set(['2026-09-15']) }))
    expect(fact).toMatchObject({ closed: true, kind: 'closed_date', source: 'store' })
  })

  it('a special-open date on the store’s weekly 定休日 → open', () => {
    const special = resolveDayHours(
      input({
        date: WED,
        specialOpenDays: new Map([['2026-09-16', { open: '12:00', close: '18:00' }]]),
      }),
    )
    expect(special).toMatchObject({
      closed: false,
      source: 'special',
      openMinute: 720,
      closeMinute: 1080,
      minutes: 360,
    })

    // …and without it, that Wednesday is the 定休日 it always was.
    expect(resolveDayHours(input({ date: WED }))).toMatchObject({ closed: true, kind: 'weekday' })
  })

  it('on an OPEN weekday the special day’s window replaces the weekly one', () => {
    const fact = resolveDayHours(
      input({ specialOpenDays: new Map([['2026-09-15', { open: '08:30', close: '21:00' }]]) }),
    )
    expect(fact).toMatchObject({ source: 'special', openMinute: 510, closeMinute: 1260 })
  })

  it('a store with NO weekly hours at all still honours its special day', () => {
    const fact = resolveDayHours(
      input({
        weeklyHours: null,
        specialOpenDays: new Map([['2026-09-15', { open: '10:00', close: '15:00' }]]),
      }),
    )
    expect(fact).toMatchObject({ source: 'special', saved: true, closed: false })
  })

  it('a special entry for ANOTHER date changes nothing about this one', () => {
    const fact = resolveDayHours(
      input({
        closedDates: new Set(['2026-09-15']),
        specialOpenDays: new Map([['2026-09-16', { open: '10:00', close: '15:00' }]]),
      }),
    )
    expect(fact).toMatchObject({ closed: true, kind: 'closed_date' })
  })

  it('absent specialOpenDays = the store declared none (every pre-W0.5 caller)', () => {
    const withEmpty = resolveDayHours(input({ specialOpenDays: new Map() }))
    const without = resolveDayHours(input({}))
    expect(withEmpty).toEqual(without)
    expect(without).toMatchObject({ source: 'store', openMinute: 600, closeMinute: 1140 })
  })

  it('saved and source stay ONE fact on the special path: saved === (source !== "default")', () => {
    const fact = resolveDayHours(
      input({ specialOpenDays: new Map([['2026-09-15', { open: '10:00', close: '15:00' }]]) }),
    )
    expect(fact.saved).toBe(fact.source !== 'default')
  })
})

describe('the map is keyed by the JST calendar day, never the UTC one', () => {
  const MAP = new Map([['2026-09-15', { open: '00:00', close: '24:00' }]])

  it('00:30 JST on 9/15 (UTC still 9/14) finds the 9/15 entry', () => {
    const fact = resolveDayHours(
      input({ date: new Date('2026-09-14T15:30:00.000Z'), specialOpenDays: MAP }),
    )
    expect(fact.source).toBe('special')
  })

  it('23:59 JST on 9/15 (UTC 14:59, same date) finds it; 00:00 JST 9/16 does not', () => {
    expect(
      resolveDayHours(input({ date: new Date('2026-09-15T14:59:00.000Z'), specialOpenDays: MAP }))
        .source,
    ).toBe('special')
    // 9/15T15:00Z is 9/16 00:00 JST — the store's Wednesday 定休日, no special.
    expect(
      resolveDayHours(input({ date: new Date('2026-09-15T15:00:00.000Z'), specialOpenDays: MAP })),
    ).toMatchObject({ closed: true, kind: 'weekday' })
  })
})

describe('P5 — the window wrapper carries the map', () => {
  it('three days: a weekly day, a special day on the 定休日, a 臨時休業 date', () => {
    const span = jstWindowDays('2026-09-14T15:00:00Z', '2026-09-17T14:59:59.999Z')
    const facts = resolveWindowHours(span.days, {
      weeklyHours: STORE_WEEK,
      closedDates: new Set(['2026-09-17']),
      specialOpenDays: new Map([['2026-09-16', { open: '12:00', close: '18:00' }]]),
      orgHours: null,
      orgSaved: NOTHING_SAVED,
    })
    expect([...facts.keys()]).toEqual(['2026-09-15', '2026-09-16', '2026-09-17'])
    expect(facts.get('2026-09-15')).toMatchObject({ source: 'store', closed: false, minutes: 540 })
    expect(facts.get('2026-09-16')).toMatchObject({
      source: 'special',
      closed: false,
      openMinute: 720,
      closeMinute: 1080,
    })
    expect(facts.get('2026-09-17')).toMatchObject({ closed: true, kind: 'closed_date' })
  })
})

describe('P6 — a malformed special day is IGNORED: one log line, no throw, the chain decides', () => {
  it.each([
    ['close ≤ open', { open: '15:00', close: '10:00' }],
    ['close = open', { open: '10:00', close: '10:00' }],
    ['not HH:MM', { open: 'ten', close: '15:00' }],
    ['hour past 24', { open: '10:00', close: '25:00' }],
    ['missing close', { open: '10:00' } as { open: string; close: string }],
  ])('%s on a 臨時休業 date → stays CLOSED (never opens), logged once', (_label, window) => {
    let fact: ReturnType<typeof resolveDayHours> | undefined
    expect(() => {
      fact = resolveDayHours(
        input({
          closedDates: new Set(['2026-09-15']),
          specialOpenDays: new Map([['2026-09-15', window]]),
        }),
      )
    }).not.toThrow()
    expect(fact).toMatchObject({ closed: true, kind: 'closed_date' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // The DATE, so the one entry can be found — never the policy body.
    expect(String(errorSpy.mock.calls[0][0])).toContain('2026-09-15')
    expect(String(errorSpy.mock.calls[0][0])).not.toContain(String(window.open))
  })

  it('on the weekly 定休日 → stays the 定休日, logged once', () => {
    const fact = resolveDayHours(
      input({
        date: WED,
        specialOpenDays: new Map([['2026-09-16', { open: '18:00', close: '12:00' }]]),
      }),
    )
    expect(fact).toMatchObject({ closed: true, kind: 'weekday' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('on an open weekday → the weekly window, as if there were no special day', () => {
    const fact = resolveDayHours(
      input({ specialOpenDays: new Map([['2026-09-15', { open: '18:00', close: '12:00' }]]) }),
    )
    expect(fact).toEqual(resolveDayHours(input({})))
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('a well-formed special day logs nothing', () => {
    resolveDayHours(
      input({ specialOpenDays: new Map([['2026-09-15', { open: '10:00', close: '15:00' }]]) }),
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('specialOpenDaysByDate — the wire array → the resolver’s map', () => {
  it('keys each entry by its date string, exactly as core stores it', () => {
    const map = specialOpenDaysByDate([
      { date: '2026-09-16', open: '12:00', close: '18:00' },
      { date: '2026-09-20', open: '09:00', close: '13:00' },
    ])
    expect([...map.entries()]).toEqual([
      ['2026-09-16', { open: '12:00', close: '18:00' }],
      ['2026-09-20', { open: '09:00', close: '13:00' }],
    ])
  })

  it('null / undefined / not-an-array → an empty map (the store declared none)', () => {
    expect(specialOpenDaysByDate(null).size).toBe(0)
    expect(specialOpenDaysByDate(undefined).size).toBe(0)
    expect(specialOpenDaysByDate({} as never).size).toBe(0)
  })

  it('skips entries that are not objects with a string date; the first entry for a date wins', () => {
    const map = specialOpenDaysByDate([
      null,
      'x',
      { open: '10:00', close: '11:00' },
      { date: '2026-09-16', open: '12:00', close: '18:00' },
      { date: '2026-09-16', open: '07:00', close: '08:00' },
    ] as never)
    expect([...map.entries()]).toEqual([['2026-09-16', { open: '12:00', close: '18:00' }]])
  })
})

describe('capacity sees a special day as the STORE’s own hours — the wire enum never sees "special"', () => {
  it('hoursSource narrows to "store" and 空き rides it; the DTO still parses', () => {
    const facts = resolveWindowHours([WED], {
      weeklyHours: STORE_WEEK,
      closedDates: NO_CLOSURES,
      specialOpenDays: new Map([['2026-09-16', { open: '12:00', close: '18:00' }]]),
      orgHours: null,
      orgSaved: NOTHING_SAVED,
    })
    const capacity = appointmentsToMonthFacts(
      [],
      new Date('2026-09-16T00:00:00+09:00'),
      new Date('2026-09-16T00:00:00+09:00'),
      { hoursFacts: facts, rosterHeadcount: 1, soloMode: true },
    ).get('2026-09-16')

    expect(capacity).toMatchObject({
      hoursSource: 'store',
      capacityMinutes: 360,
      availableMinutes: 360,
      reason: null,
    })

    const row = capacityRowFields(capacity)
    expect(row.hoursSource).toBe('store')
    // The same schema the thin bundle parses from its baked copy.
    expect(() =>
      WeekDayCardDataDTO.parse({
        ...row,
        dateNumber: 16,
        monthNumber: 9,
        weekdayLabel: '水',
        count: 0,
        bookedMinutes: 0,
        availableMinutes: 360,
        newCustomerCount: 0,
        remindersPending: 0,
        consentPending: 0,
        unconfirmed: 0,
        visibleBookings: [],
        hiddenCount: 0,
      }),
    ).not.toThrow()
  })
})
