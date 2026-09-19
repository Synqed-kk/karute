import { weekStartFor, weekendTone } from '@/lib/date/week-start'

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
    expect(weekStartFor('en')).toBe(first === undefined ? 1 : first % 7)
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

  it('the legacy CLDR fallback agrees with Intl for ja', () => {
    const intlJa = weekStartFor('ja')
    const Locale = Intl.Locale
    const spy = jest.spyOn(Intl, 'Locale').mockImplementation((locale) => ({
      language: new Locale(locale).language,
    }) as Intl.Locale)
    try {
      expect(weekStartFor('ja')).toBe(0)
      expect(weekStartFor('ja')).toBe(intlJa)
      expect(weekStartFor('en')).toBe(1)
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
