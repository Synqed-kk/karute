export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type WeekendTone = {
  sunday: 'red' | 'muted'
  saturday: 'accent' | 'muted'
}

/** CLDR fallback for shipped locales; bare en resolves to Sunday in ICU.
 * Other locales retain the legacy Monday default. The underscore boundary
 * also accepts a malformed ja_JP tag when Intl rejects it. */
function legacyWeekStart(locale: string): WeekStart {
  return /^ja(?:\b|_)/i.test(locale) || /^en$/i.test(locale) ? 0 : 1
}

/** Intl uses ISO weekdays (Sunday = 7); calendar cells use JS weekdays. */
export function weekStartFor(locale: string): WeekStart {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay
    if (firstDay !== undefined) return (firstDay % 7) as WeekStart
  } catch {
    // Invalid tags, unavailable Intl.Locale, and throwing week-info APIs.
  }
  return legacyWeekStart(locale)
}

/** Calendar weekend colours follow the language, independently of week order. */
export function weekendTone(locale: string): WeekendTone {
  let japanese = /^ja(?:\b|_)/i.test(locale)
  try {
    japanese = new Intl.Locale(locale).language === 'ja'
  } catch {
    // Keep the raw-tag fallback on any Intl failure.
  }
  return japanese
    ? { sunday: 'red', saturday: 'accent' }
    : { sunday: 'muted', saturday: 'muted' }
}

/** IDs already represent JST calendar days; UTC arithmetic needs no timezone. */
export function weekStartOfCells(
  cells: readonly { id: string }[] | null | undefined,
  fallback: WeekStart,
): WeekStart {
  const id = cells?.[0]?.id
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(id)) return fallback
  const date = new Date(`${id}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== id) return fallback
  return date.getUTCDay() as WeekStart
}

type WeekdayLabels = [string, string, string, string, string, string, string]
const weekdayLabelCache = new Map<string, WeekdayLabels>()

/** At most seven cached orders per locale, shared by both calendar surfaces. */
export function weekdayLabelsFor(locale: string, weekStart: WeekStart): WeekdayLabels {
  const key = `${locale}:${weekStart}`
  const cached = weekdayLabelCache.get(key)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const labels = Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2024, 0, 7 + weekStart + i))),
  ) as WeekdayLabels
  weekdayLabelCache.set(key, labels)
  return labels
}
