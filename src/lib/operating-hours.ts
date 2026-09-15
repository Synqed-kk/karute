import type { WeeklyHours } from '@synqed-kk/client'
import { partsInJst, ymdInJst } from '@/lib/date/jst'
import { jstMidnight } from '@/lib/date/calendar-range'
// Type-only, so nothing of the capacity module enters this graph at runtime.
// One spelling of provenance for the whole app: the resolver below produces it
// and the capacity module consumes it, so the two can never drift.
import type { HoursSource } from '@/lib/capacity/capacity'

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

/** The weekday of `date` IN JST. `date.getDay()` reads the RUNTIME calendar —
 *  UTC on Vercel — so a booking day that starts at 00:00 JST (15:00 UTC the
 *  day before) resolved to the PREVIOUS weekday and picked the wrong day's
 *  opening hours for every evening of the week. partsInJst().weekday is the
 *  same 0=Sun…6=Sat numbering getDay() used (see reservation.ts:137-141, which
 *  already builds the month grid's leading padding off it). */
export function getWeekdayKey(date: Date): WeekdayKey {
  return JS_DAY_TO_KEY[partsInJst(date).weekday] ?? 'mon'
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

/** ONE parse of a raw blob weekday: the day the salon actually SAVED, or null
 *  when the entry is absent / malformed / open-after-close. normalizeDailyHours
 *  defaults off it and savedWeekdays reports it, so "is this day saved?" and
 *  "what hours does this day have?" can never drift apart. */
function parseDailyHours(value: unknown): DailyOperatingHours | null {
  if (!value || typeof value !== 'object') return null

  const candidate = value as { openMinute?: unknown; closeMinute?: unknown }
  const openMinute = isFiniteNumber(candidate.openMinute) ? Math.round(candidate.openMinute) : NaN
  const closeMinute = isFiniteNumber(candidate.closeMinute) ? Math.round(candidate.closeMinute) : NaN

  if (!Number.isInteger(openMinute) || !Number.isInteger(closeMinute)) return null

  const normalized: DailyOperatingHours = { openMinute, closeMinute }
  return validateDailyOperatingHours(normalized) ? null : normalized
}

function normalizeDailyHours(value: unknown): DailyOperatingHours {
  return parseDailyHours(value) ?? { ...DEFAULT_DAILY_OPERATING_HOURS }
}

/** The weekdays whose RAW org-settings entry exists and validates — i.e. the
 *  days the salon really configured, as opposed to the ones normalizeOperatingHours
 *  silently filled with the 10:00–24:00 default. The 稼働/空き cells may only
 *  claim a capacity on a SAVED day; on a defaulted one they say 未設定. */
export function savedWeekdays(raw: unknown): WeekdayKey[] {
  const source =
    raw && typeof raw === 'object' ? (raw as Partial<Record<WeekdayKey, unknown>>) : {}
  return WEEKDAY_KEYS.filter((key) => parseDailyHours(source[key]) !== null)
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

// ── THE 予約 NUMBERS' HOURS SOURCE — one resolver, one home ─────────────────
//
// ⚠ TWO NULLS, TWO MEANINGS (mirrored from src/business/lib/settings.ts:1156-1160,
// which documents the same wire): `weekly_hours[day] = null` (or an absent day)
// says 「this store is closed on Mondays」, while `weekly_hours = null` says
// 「this store has never configured hours at all」 — confusing them either
// invents a 定休日 or throws the hours filter away entirely.
// An EMPTY object `{}` reads as the second, not the first [LEAD RULING]: a
// store must never be closed for a whole week by a save that said nothing.
// One key is enough to switch the store's own week on.
//
// Precedence, per day: an ad-hoc 臨時休業 date → the store's own weekly_hours →
// the business-wide operating_hours blob → the 10:00–24:00 default (hoursSaved
// false). Nothing else in the 予約 numbers may resolve hours.

/** What one JST day's hours actually are, and how much we may claim about them.
 *  `saved` = a human really set this day (a store weekly_hours entry, a closed
 *  date, or a saved org blob day) — the 稼働/空き conjunct. `closed` = 定休日 or
 *  臨時休業. `minutes` is 0 when closed.
 *
 *  `source` is the same fact with its PROVENANCE kept (C3 E6/E21): an org-blob
 *  day is a business-wide DEFAULT rather than a declaration about this store,
 *  and the 10:00–24:00 fallback is not a statement about the day at all. The
 *  two fields are one truth in two shapes — `saved === (source !== 'default')`
 *  always, asserted in operating-hours.test.ts so they can never drift. */
export type DayHoursFact = {
  minutes: number
  openMinute: number
  closeMinute: number
  saved: boolean
  /** 'store' = this store's own weekly_hours day or one of its closed dates ·
   *  'org' = a weekday the business saved in the org blob · 'default' = the
   *  10:00–24:00 fallback nobody set. */
  source: HoursSource
  closed: boolean
}

/** Both closed paths are the STORE speaking: an ad-hoc 臨時休業 date and a
 *  weekly_hours day the store left out (its 定休日) are equally that store's
 *  own declaration. */
const CLOSED_FACT: DayHoursFact = {
  minutes: 0,
  openMinute: 0,
  closeMinute: 0,
  saved: true,
  source: 'store',
  closed: true,
}

/** 'HH:MM' → minutes from midnight, or null when the wire value is malformed. */
function minuteOfHhmm(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 24 || minute > 59) return null
  const total = hour * 60 + minute
  return total <= 24 * 60 ? total : null
}

export interface DayHoursInput {
  date: Date
  /** The store's own weekly window (`storePolicies.get(storeId).weekly_hours`),
   *  or null when there is no store to ask / the store never configured hours.
   *  Only this field of StoreBookingPolicy is consumed — and the package barrel
   *  does not re-export StoreBookingPolicy itself, only WeeklyHours. */
  weeklyHours: WeeklyHours | null
  /** 臨時休業 dates as JST YYYY-MM-DD. */
  closedDates: ReadonlySet<string>
  orgHours: OperatingHours | null | undefined
  /** The org blob weekdays a human actually saved (savedWeekdays). */
  orgSaved: ReadonlySet<WeekdayKey>
}

export function resolveDayHours(input: DayHoursInput): DayHoursFact {
  const key = getWeekdayKey(input.date)

  if (input.closedDates.has(ymdInJst(input.date))) return { ...CLOSED_FACT }

  const weekly = input.weeklyHours
  // An object with NO keys at all is not "closed every day" — it is a store
  // that has not configured hours, so it falls through to the org blob. The
  // absent-day rule only means 定休日 once the store has said SOMETHING about
  // its week; reading `{}` literally would black out a whole store's week off
  // an empty save, silently, with hoursSaved claiming a human meant it.
  if (weekly != null && Object.keys(weekly).length > 0) {
    const day = weekly[key]
    // null OR absent = 定休日. This is the first of the two nulls above.
    if (day == null) return { ...CLOSED_FACT }
    const open = minuteOfHhmm(day.open)
    const close = minuteOfHhmm(day.close)
    if (open != null && close != null && open < close) {
      return {
        minutes: close - open,
        openMinute: open,
        closeMinute: close,
        saved: true,
        source: 'store',
        closed: false,
      }
    }
    // A malformed window vouches for nothing — fall through to the org blob and
    // let THAT decide whether the day counts as saved.
  }

  const day = getOperatingHoursForDate(input.orgHours, input.date)
  const orgSaved = input.orgSaved.has(key)
  return {
    minutes: Math.max(0, day.closeMinute - day.openMinute),
    openMinute: day.openMinute,
    closeMinute: day.closeMinute,
    saved: orgSaved,
    // The business-wide blob when a human saved that weekday, otherwise the
    // 10:00–24:00 fallback — which describes no day and may never divide one.
    source: orgSaved ? 'org' : 'default',
    closed: false,
  }
}

/** The JST calendar days a [fromIso, toIso] fetch window covers, plus the
 *  YYYY-MM-DD pair the closed-days read wants (`to` is EXCLUSIVE — the SDK's
 *  own contract, dist/store-policies.d.ts). One home so the web action and the
 *  facade route can never disagree about which days a window contains. */
export function jstWindowDays(
  fromIso: string,
  toIso: string,
): { days: Date[]; fromYmd: string; toExclusiveYmd: string } {
  const start = partsInJst(new Date(fromIso))
  const lastYmd = ymdInJst(new Date(toIso))
  const cursor = jstMidnight(start.year, start.month, start.day)
  const days: Date[] = []
  // Whole-day setDate arithmetic on a JST-midnight instant preserves the
  // time-of-day, so the JST date steps correctly under a UTC runtime
  // (calendar-range.ts's own rule). The bound is a guard, not a policy: the
  // widest window this feeds is a month grid (~45 days).
  while (days.length < 400 && ymdInJst(cursor) <= lastYmd) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  const after = days.length ? new Date(days[days.length - 1]) : new Date(cursor)
  after.setDate(after.getDate() + 1)
  return {
    days,
    fromYmd: days.length ? ymdInJst(days[0]) : lastYmd,
    toExclusiveYmd: ymdInJst(after),
  }
}

/** resolveDayHours for every day of a window, keyed by JST YYYY-MM-DD. */
export function resolveWindowHours(
  days: readonly Date[],
  ctx: Omit<DayHoursInput, 'date'>,
): Map<string, DayHoursFact> {
  const facts = new Map<string, DayHoursFact>()
  for (const date of days) facts.set(ymdInJst(date), resolveDayHours({ ...ctx, date }))
  return facts
}
