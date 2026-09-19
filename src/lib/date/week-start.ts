export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type WeekendTone = {
  sunday: 'red' | 'muted'
  saturday: 'accent' | 'muted'
}

/** Intl uses ISO weekdays (Sunday = 7); calendar cells use JS weekdays. */
export function weekStartFor(locale: string): WeekStart {
  const info = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number }
    weekInfo?: { firstDay: number }
  }
  const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay
  if (firstDay !== undefined) return (firstDay % 7) as WeekStart
  // CLDR supplemental weekData: Japan starts Sunday. ponytail: legacy
  // engines without week info cover ja only; all other locales use Monday.
  return info.language === 'ja' ? 0 : 1
}

/** Calendar weekend colours follow the language, independently of week order. */
export function weekendTone(locale: string): WeekendTone {
  return new Intl.Locale(locale).language === 'ja'
    ? { sunday: 'red', saturday: 'accent' }
    : { sunday: 'muted', saturday: 'muted' }
}
