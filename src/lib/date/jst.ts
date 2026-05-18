// JST (Asia/Tokyo, UTC+9) date utilities.
//
// Karute is a Japan-targeted app, so every date/time the user sees or types
// should be interpreted in JST regardless of the runtime's timezone (Vercel
// is UTC; browsers vary by traveler/VPN). Storage stays UTC ISO; only the
// boundary in and out is JST.
//
// Use these helpers instead of `new Date()` / `toLocaleDateString()` / raw
// string concatenation when the value is user-facing or user-entered.

export const JST_TZ = 'Asia/Tokyo'
export const JST_OFFSET = '+09:00'

export interface JstParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  /** 0 = Sunday … 6 = Saturday, matching Date#getDay(). */
  weekday: number
}

/** Decompose a Date into JST calendar parts (year/month/day/hour/minute/weekday). */
export function partsInJst(d: Date): JstParts {
  // Intl.DateTimeFormat is the only stdlib-clean way to get calendar parts
  // for a specific timezone. The formatToParts shape is stable cross-engine.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: JST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  // hour can come back as "24" for midnight in some Node versions — normalize.
  const hourRaw = Number(pick('hour'))
  // .getDay() shape: 0=Sun..6=Sat. Pull weekday name then map back, since
  // Intl doesn't expose a numeric weekday directly via formatToParts.
  const wdName = new Intl.DateTimeFormat('en-US', {
    timeZone: JST_TZ,
    weekday: 'short',
  }).format(d)
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(pick('minute')),
    weekday: wdMap[wdName] ?? 0,
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYY-MM-DD for the JST calendar date that contains `d`. */
export function ymdInJst(d: Date = new Date()): string {
  const p = partsInJst(d)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/** HH:MM (24h) of `d` rendered in JST. */
export function hmInJst(d: Date): string {
  const p = partsInJst(d)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/**
 * Parse a "YYYY-MM-DD" + "HH:MM" pair (as the user typed it, in JST) into a
 * Date representing the same wall-clock moment. Use the returned Date's
 * .toISOString() for storage.
 */
export function jstWallTimeToDate(dateYmd: string, timeHm: string): Date {
  // Appending the offset makes the Date constructor interpret the literal
  // as JST instead of "whatever the runtime calls local". `+09:00` never
  // shifts with DST (Japan doesn't observe).
  return new Date(`${dateYmd}T${timeHm}:00${JST_OFFSET}`)
}

/**
 * Today's date in JST, returned as a Date object whose UTC value
 * corresponds to JST midnight. Suitable for calendar-cursor logic that
 * only cares about day, not hour. (.getFullYear() etc on the returned
 * Date will report whatever the runtime tz is — pair with `ymdInJst` if
 * you need parts.)
 */
export function jstStartOfToday(): Date {
  return jstWallTimeToDate(ymdInJst(), '00:00')
}

/** "right now" as a Date — alias for `new Date()`, kept for symmetry. */
export function nowUtc(): Date {
  return new Date()
}

/** Locale-formatted long date in JST (e.g., "Wed, May 19, 2026" or "2026年5月19日"). */
export function formatLongDateJst(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: JST_TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

/** Compact date in JST (e.g., "5/19 (Tue)" or "5/19(火)"). */
export function formatCompactDateJst(d: Date, locale: string): string {
  const p = partsInJst(d)
  const wd = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: JST_TZ,
    weekday: 'short',
  }).format(d)
  const sep = locale === 'ja' ? '' : ' '
  return `${p.month}/${p.day}${sep}(${wd})`
}
