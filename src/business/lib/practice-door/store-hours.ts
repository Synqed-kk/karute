// ⚖ §v11 V11-1…V11-3 + V11-7, ⚖ S81 (R4–R9) — a practice store's 営業時間 · 定休日 · 臨時休業 · 臨時営業日, through
// Karute's ONE hours resolver (`resolveDayHours`, src/lib/operating-hours.ts): 臨時営業日 → 臨時休業 → the store's own
// weekly_hours → the business-wide operating_hours blob → the 10:00–24:00 default. One resolver, one answer — this
// file only ASSEMBLES its input from the door's three reads (exactly as src/actions/appointments-window.ts does) and
// shapes its answer into the plane. ONE deliberate difference to Karute (R6, named in the PR): the board never paints the
// resolver's silent default — a day nobody set is served the store's usual pair, and a store nobody set the sample set.
// V11-2a (a malformed weekday served the store's usual window) is RETIRED (R8): the resolver sends it on to the org blob
// / default, and the plane adopts that answer.

import type { CoreReads } from './core-reach'
import { jstDayKey, jstSlot, jstYmd } from '../clock'
// ⚖ S81 R10 — the ONE outside import of this file (FILE_ALLOWED_TARGETS): a pure function module, named imports only.
import {
  normalizeOperatingHours,
  resolveDayHours,
  savedWeekdays,
  specialOpenDaysByDate,
  type DayHoursFact,
  type DayHoursInput,
  type WeekdayKey,
} from '@/lib/operating-hours'

export type WeeklyHours = Awaited<ReturnType<CoreReads['storePolicyGet']>>['weekly_hours']
export type Window = { open: number; close: number }
/** ⚖ §v11 V11-7 — THE WEEK: seven entries, 0 = 日 … 6 = 土, each window in JST minutes or null (closed). */
export type Week = Array<Window | null>
/** ⚖ S81 R7 — the SHOWN day's own closure, as the resolver names it: null = open (a 臨時営業日 on a 定休日 included). */
export type ShownDayClosed = null | 'weekday' | 'closed_date'
/** What a practice plane serves for 営業時間 · 定休日, and where it came from: the SHOWN day's pair (a closed day: the
 *  usual pair), the week, and its closed weekdays ascending ([] = open every day). `shownDayKey` + `shownDayClosed`
 *  (⚖ S81 R7) say whether the day the hours were read for is closed — a 臨時休業 date is that day's alone, never a 定休日. */
export type StoreHours = {
  operatingHours: Window
  weeklyHours: Week
  closedWeekdays: number[]
  hoursSource: 'core' | 'sample'
  shownDayKey: number
  shownDayClosed: ShownDayClosed
}
/** The door's three reads, as core answered them. */
export type HoursReads = {
  policy: Awaited<ReturnType<CoreReads['storePolicyGet']>> | null
  closedDays: Awaited<ReturnType<CoreReads['storePolicyListClosedDays']>>
  org: Awaited<ReturnType<CoreReads['orgSettingsGet']>> | null
}

/** `Date#getDay` numbering, 0 = 日 … 6 = 土 — the app's own (operating-hours.ts `JS_DAY_TO_KEY`). */
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
/** The weekday of a JST day index (whole JST days since 1970-01-01, which was a Thursday). */
export const weekdayOfKey = (dayKey: number): number => new Date(dayKey * 86_400_000).getUTCDay()

/** JST midnight of a day index, as an instant — through the board's own clock helpers, never a retyped offset. */
const dateOfKey = (dayKey: number, now: Date): Date => new Date(jstSlot(dayKey - jstDayKey(now), 0, 0, now))
/** A day index as core's JST YYYY-MM-DD (door-writes.ts `todayJst`'s spelling). */
function ymdOfKey(dayKey: number, now: Date): string {
  const { y, m, d } = jstYmd(dateOfKey(dayKey, now))
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** ⚖ S81 R4 — the 臨時休業 read for ONE day: `to` is EXCLUSIVE (the SDK's own contract, as appointments-window.ts). */
export const closedDaysRange = (dayKey: number, now: Date): { from: string; to: string } => ({ from: ymdOfKey(dayKey, now), to: ymdOfKey(dayKey + 1, now) })

/** The sample (and OFF) week: the one pair on every weekday but the closed ones — the week `weeklyHoursFrom` builds. */
export const weekFromPair = (pair: Window, closed: number[]): Week => KEYS.map((_, wd) => (closed.includes(wd) ? null : { open: pair.open, close: pair.close }))

/** 定休日 on the plane: every weekday the week leaves null, ascending; [] = open every day. */
export const closedWeekdaysOf = (week: Week): number[] => week.flatMap((d, wd) => (d === null ? [wd] : []))

/** The store's USUAL window: the most frequent (open, close) across its open weekdays; a tie → the earliest
 *  weekday's (日 = 0 first). null when no weekday opens. */
export function usualPairOf(week: Week): Window | null {
  const pairs = week.filter((d): d is Window => d !== null)
  const count = (p: Window) => pairs.filter((q) => q.open === p.open && q.close === p.close).length
  return pairs.reduce<Window | null>((best, p) => (best === null || count(p) > count(best) ? p : best), null)
}

/** The shared sample set for one day, marked 'sample' (§v9 V9-2) — its closed weekday is the shown day's 定休日. */
export function sampleHours(pair: Window, closedWeekday: number, dayKey: number): StoreHours {
  return {
    operatingHours: pair,
    weeklyHours: weekFromPair(pair, [closedWeekday]),
    closedWeekdays: [closedWeekday],
    hoursSource: 'sample',
    shownDayKey: dayKey,
    shownDayClosed: weekdayOfKey(dayKey) === closedWeekday ? 'weekday' : null,
  }
}

const windowOf = (f: DayHoursFact): Window | null => (f.closed ? null : { open: f.openMinute, close: f.closeMinute })

/** ⚖ S81 R4–R8 — one store's hours for the shown day, through the ONE resolver.
 *  The shown day: every layer (臨時営業日 · 臨時休業 · week · org · default). The week strip (R5): each weekday of the
 *  shown day's JST week through the SAME resolver with the weekly layers only, so a 臨時休業 date never reads as 定休日.
 *  R6: a day the resolver answers 'default' is never painted as 10:00–24:00 — the shown day and the week take the
 *  store's usual pair over the days somebody set; when NO weekday was set, the week is the sample set ('sample'). */
export function resolveStoreHours(reads: HoursReads, dayKey: number, now: Date, sample: StoreHours, storeId: string): StoreHours {
  const raw = reads.org === null ? null : ((reads.org.settings ?? {}) as { operating_hours?: unknown })
  // Mirrors appointments-window.ts + org-settings.ts normalizeOrgSettings: the blob normalised, its saved days from the RAW blob.
  const layers: Pick<DayHoursInput, 'weeklyHours' | 'orgHours' | 'orgSaved'> = {
    weeklyHours: reads.policy?.weekly_hours ?? null,
    orgHours: raw === null ? undefined : normalizeOperatingHours(raw.operating_hours),
    orgSaved: new Set<WeekdayKey>(raw === null ? [] : savedWeekdays(raw.operating_hours)),
  }
  const shown = resolveDayHours({
    ...layers,
    date: dateOfKey(dayKey, now),
    closedDates: new Set(reads.closedDays.closed_days.map((d) => d.date)),
    specialOpenDays: specialOpenDaysByDate(reads.policy?.special_open_days),
  })
  const first = dayKey - weekdayOfKey(dayKey)
  const facts = KEYS.map((_, wd) => resolveDayHours({ ...layers, date: dateOfKey(first + wd, now), closedDates: new Set() }))

  // ⚖ S81 R8 — a store weekday the resolver did not take (malformed) went on to the org blob / default: named, once.
  const weekly = layers.weeklyHours
  const malformed = weekly != null && Object.keys(weekly).length > 0 ? KEYS.flatMap((k, wd) => (weekly[k] != null && facts[wd].source !== 'store' ? [wd] : [])) : []
  if (malformed.length > 0) console.error('[practice hours] malformed weekday sent on to the business hours / default:', storeId, malformed.join(','))

  const set = facts.some((f) => f.source !== 'default')
  if (!set && shown.source === 'default') return sample // R6 — nobody set any hours: the sample set, as before
  const usual = usualPairOf(facts.map((f) => (f.source === 'default' ? null : windowOf(f))))
  const fill = usual ?? sample.operatingHours
  const week = set ? facts.map((f) => (f.source === 'default' && !f.closed ? fill : windowOf(f))) : sample.weeklyHours
  return {
    // A closed day draws the usual pair (as a closed weekday always has); a 'default' day the usual pair (R6).
    operatingHours: shown.closed || shown.source === 'default' ? fill : (windowOf(shown) ?? fill),
    weeklyHours: week,
    closedWeekdays: closedWeekdaysOf(week),
    hoursSource: set ? 'core' : 'sample',
    shownDayKey: dayKey,
    shownDayClosed: shown.closed ? (shown.kind ?? 'weekday') : null,
  }
}
