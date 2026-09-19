// Read the real routing locale list while isolating next-intl's ESM-only wrapper.
jest.mock('next-intl/routing', () => ({ defineRouting: <T,>(config: T): T => config }))

import { routing } from '@/i18n/routing'
import { weekStartFor, weekendTone, weekStartOfCells, weekdayLabelsFor } from '@/lib/date/week-start'

describe('weekStartFor', () => {
  it.each([['ja', 0], ['en-GB', 1], ['en-US', 0]] as const)(
    '%s starts on JS weekday %i', (locale, first) => {
      expect(weekStartFor(locale)).toBe(first)
    },
  )

  it('bare en follows Intl without being corrected to Monday', () => {
    const info = new Intl.Locale('en') as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const first = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay
    expect(weekStartFor('en')).toBe(first === undefined ? 0 : first % 7)
  })

  it('prefers getWeekInfo and also supports the older weekInfo getter', () => {
    const spy = jest.spyOn(Intl, 'Locale')
    try {
      spy.mockImplementation(() => ({ language: 'ja', getWeekInfo: () => ({ firstDay: 6 }), weekInfo: { firstDay: 1 } }) as unknown as Intl.Locale)
      expect(weekStartFor('ja')).toBe(6)
      spy.mockImplementation(() => ({ language: 'ja', weekInfo: { firstDay: 7 } }) as unknown as Intl.Locale)
      expect(weekStartFor('ja')).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('legacy fallback agrees with Node Intl for every shipped routing locale', () => {
    const expected = routing.locales.map((locale) => {
      const info = new Intl.Locale(locale) as Intl.Locale & {
        getWeekInfo?: () => { firstDay: number }
        weekInfo?: { firstDay: number }
      }
      const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay
      expect(firstDay).toBeDefined()
      return [locale, firstDay! % 7] as const
    })
    const Locale = Intl.Locale
    const spy = jest.spyOn(Intl, 'Locale').mockImplementation((locale) => ({
      language: new Locale(locale).language,
    }) as Intl.Locale)
    try {
      for (const [locale, first] of expected) expect(weekStartFor(locale)).toBe(first)
    } finally {
      spy.mockRestore()
    }
  })

  it.each([['', 1], ['not_a_locale', 1], ['ja_JP', 0]] as const)(
    'malformed locale %s never throws', (locale, expected) => {
      expect(weekStartFor(locale)).toBe(expected)
      expect(weekendTone(locale)).toEqual(expected === 0
        ? { sunday: 'red', saturday: 'accent' }
        : { sunday: 'muted', saturday: 'muted' })
    },
  )

  it('falls back when Intl.Locale is absent or its week-info read throws', () => {
    const spy = jest.spyOn(Intl, 'Locale')
    try {
      spy.mockImplementation(() => { throw new TypeError('unavailable') })
      expect(weekStartFor('en')).toBe(0)
      expect(weekStartFor('ja-JP')).toBe(0)
      expect(weekendTone('ja-JP')).toEqual({ sunday: 'red', saturday: 'accent' })
      expect(weekendTone('en')).toEqual({ sunday: 'muted', saturday: 'muted' })
      spy.mockImplementation(() => ({ getWeekInfo() { throw new Error('unavailable') } }) as unknown as Intl.Locale)
      expect(weekStartFor('en')).toBe(0)
      expect(weekStartFor('fr')).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('the legacy CLDR fallback agrees with Intl for ja', () => {
    const intlJa = weekStartFor('ja')
    const Locale = Intl.Locale
    const spy = jest.spyOn(Intl, 'Locale').mockImplementation((locale) => ({
      language: new Locale(locale).language,
    }) as Intl.Locale)
    try {
      expect(weekStartFor('ja')).toBe(0)
      expect(weekStartFor('ja')).toBe(intlJa)
      expect(weekStartFor('en')).toBe(0)
      expect(weekStartFor('en-GB')).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('weekendTone', () => {
  it.each(['ja', 'ja-JP'])('colours Japanese-language weekends: %s', (locale) => {
    expect(weekendTone(locale)).toEqual({ sunday: 'red', saturday: 'accent' })
  })
  it.each(['en', 'en-US', 'en-GB', 'fr'])('mutes other languages: %s', (locale) => {
    expect(weekendTone(locale)).toEqual({ sunday: 'muted', saturday: 'muted' })
  })
})


describe('weekStartOfCells', () => {
  it.each([['2027-02-28', 0], ['2027-03-01', 1]] as const)(
    'reads the weekday of JST calendar ID %s', (id, expected) => {
      expect(weekStartOfCells([{ id }], 6)).toBe(expected)
    },
  )
  it.each([[], null, undefined, [{ id: 'x' }], [{ id: '2027-02-30' }], [{ id: '2027-13-01' }]])(
    'keeps the fallback for missing or malformed cells: %j', (cells) => {
      expect(weekStartOfCells(cells, 5)).toBe(5)
    },
  )
})

describe('weekdayLabelsFor', () => {
  it('shares the same label array per locale and start, for all seven orders', () => {
    for (const locale of routing.locales) {
      const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
      for (const start of [0, 1, 2, 3, 4, 5, 6] as const) {
        const labels = weekdayLabelsFor(locale, start)
        expect(weekdayLabelsFor(locale, start)).toBe(labels)
        expect(labels).toEqual(Array.from({ length: 7 }, (_, i) =>
          fmt.format(new Date(Date.UTC(2024, 0, 7 + start + i))),
        ))
      }
    }
  })
})
