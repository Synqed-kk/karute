export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface DailyOperatingHours {
  openMinute: number
  closeMinute: number
}

export type OperatingHours = Record<WeekdayKey, DailyOperatingHours>

export const WEEKDAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const JS_DAY_TO_KEY: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const DEFAULT_DAILY_OPERATING_HOURS: DailyOperatingHours = {
  openMinute: 10 * 60,
  closeMinute: 24 * 60,
}

export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  mon: { ...DEFAULT_DAILY_OPERATING_HOURS },
  tue: { ...DEFAULT_DAILY_OPERATING_HOURS },
  wed: { ...DEFAULT_DAILY_OPERATING_HOURS },
  thu: { ...DEFAULT_DAILY_OPERATING_HOURS },
  fri: { ...DEFAULT_DAILY_OPERATING_HOURS },
  sat: { ...DEFAULT_DAILY_OPERATING_HOURS },
  sun: { ...DEFAULT_DAILY_OPERATING_HOURS },
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export function getWeekdayKey(date: Date): WeekdayKey {
  return JS_DAY_TO_KEY[date.getDay()] ?? 'mon'
}

export function formatMinuteOfDay(minute: number): string {
  if (minute === 24 * 60) return '24:00'
  const clamped = Math.max(0, Math.min(24 * 60 - 1, minute))
  const hour = Math.floor(clamped / 60)
  const min = clamped % 60
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function validateDailyOperatingHours(dayHours: DailyOperatingHours): string | null {
  if (!Number.isInteger(dayHours.openMinute) || !Number.isInteger(dayHours.closeMinute)) {
    return 'Open and close times must be valid times.'
  }

  if (dayHours.openMinute < 0 || dayHours.openMinute > 24 * 60) {
    return 'Open time must be between 00:00 and 24:00.'
  }

  if (dayHours.closeMinute < 0 || dayHours.closeMinute > 24 * 60) {
    return 'Close time must be between 00:00 and 24:00.'
  }

  if (dayHours.openMinute >= dayHours.closeMinute) {
    return 'Open time must be earlier than close time.'
  }

  return null
}

export function validateOperatingHours(hours: OperatingHours): Partial<Record<WeekdayKey, string>> {
  const errors: Partial<Record<WeekdayKey, string>> = {}

  for (const key of WEEKDAY_KEYS) {
    const error = validateDailyOperatingHours(hours[key])
    if (error) errors[key] = error
  }

  return errors
}

function normalizeDailyHours(value: unknown): DailyOperatingHours {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_DAILY_OPERATING_HOURS }
  }

  const candidate = value as { openMinute?: unknown; closeMinute?: unknown }
  const openMinute = isFiniteNumber(candidate.openMinute) ? Math.round(candidate.openMinute) : NaN
  const closeMinute = isFiniteNumber(candidate.closeMinute) ? Math.round(candidate.closeMinute) : NaN

  if (!Number.isInteger(openMinute) || !Number.isInteger(closeMinute)) {
    return { ...DEFAULT_DAILY_OPERATING_HOURS }
  }

  const normalized: DailyOperatingHours = { openMinute, closeMinute }
  if (validateDailyOperatingHours(normalized)) {
    return { ...DEFAULT_DAILY_OPERATING_HOURS }
  }

  return normalized
}

export function normalizeOperatingHours(value: unknown): OperatingHours {
  const source = value && typeof value === 'object' ? (value as Partial<Record<WeekdayKey, unknown>>) : {}

  return {
    mon: normalizeDailyHours(source.mon),
    tue: normalizeDailyHours(source.tue),
    wed: normalizeDailyHours(source.wed),
    thu: normalizeDailyHours(source.thu),
    fri: normalizeDailyHours(source.fri),
    sat: normalizeDailyHours(source.sat),
    sun: normalizeDailyHours(source.sun),
  }
}

export function getOperatingHoursForDate(hours: OperatingHours | null | undefined, date: Date): DailyOperatingHours {
  const normalized = normalizeOperatingHours(hours)
  return normalized[getWeekdayKey(date)]
}

export function utcToLocalDayAndMinute(date: Date, tzOffsetMinutes: number): {
  dayKey: WeekdayKey
  minuteOfDay: number
} {
  // timezoneOffset follows Date#getTimezoneOffset semantics (UTC - local).
  // local time is therefore UTC - offset.
  const localDate = new Date(date.getTime() - tzOffsetMinutes * 60_000)

  return {
    dayKey: JS_DAY_TO_KEY[localDate.getUTCDay()] ?? 'mon',
    minuteOfDay: localDate.getUTCHours() * 60 + localDate.getUTCMinutes(),
  }
}
