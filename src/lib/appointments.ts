import {
  formatMinuteOfDay,
  getWeekdayKey,
  normalizeOperatingHours,
  resolveDayHours,
  type DayHoursInput,
  type WeekdayKey,
} from '@/lib/operating-hours'
import { jstWallTimeToDate, ymdInJst } from '@/lib/date/jst'

// ⚖ W0.5 fix 2 — no clock offset rides in. karute is JST-only, so the hours
// judgement is too: every day, weekday and minute below is read in JST
// (src/lib/date/jst.ts), whatever the caller's device clock says.
export interface AppointmentInput {
  staffProfileId: string
  clientId: string
  startTime: string
  durationMinutes: number
  title?: string
  notes?: string
  /** Catalog menu the booking is linked to (camelCase here, menu_id at the
   *  SDK seam). Core validates ownership and snapshots the price. */
  menuId?: string | null
}

/** The store-side half of the hours question, for ONE day. Fetched by
 *  src/lib/appointments/day-hours.ts — the same inputs the 予約 screens
 *  resolve their 休 cells from, so the door and the screen can never disagree
 *  about whether a day is closed. `specialOpenDays` (⚖ W0.5) stays optional
 *  like its DayHoursInput source: absent = the store declared no 臨時営業日. */
export type BookingDayHours = Pick<
  DayHoursInput,
  'weeklyHours' | 'closedDates' | 'specialOpenDays' | 'orgSaved'
>

/**
 * The house `{ error }` shape, with the closed-day refusal's provenance riding
 * on it (⚖ ADJUDICATION-STORE-HOURS item 15: the refusal NAMES which setting
 * closed the day and where to change it). Both doors return this verbatim, and
 * the ONE dialog both doors render picks its line off `code`/`level`/`kind` —
 * the UI decides nothing, it only renders what the validator resolved.
 */
export type BookingTimeRefusal = {
  error: string
  code?: 'closed_day' | 'invalid_start' | 'outside_hours' | 'time_patch_inconsistent'
  /** 'store' = this store's own setting closed the day · 'org' = the
   *  business-wide default did. Read straight off the resolver's `source`, so
   *  the two can never drift.
   *
   *  NOTE (2026-09-16, honest ceiling): on this tip 'org' is unreachable — the
   *  business-wide blob has no way to SAY "closed" (a weekday entry only counts
   *  as saved when it parses with open < close, operating-hours.ts:93-118), so
   *  resolveDayHours' every closed answer carries source 'store'. The mapping is
   *  written off `source` rather than hardcoded to 'store' precisely so that the
   *  day the org blob learns to express a closed weekday, this door already
   *  names the right level and needs no second decision. */
  level?: 'store' | 'org'
  /** 'closed_date' = an ad-hoc 臨時休業 date · 'weekday' = the weekly hours. */
  kind?: 'weekday' | 'closed_date'
  /** Values the localised line needs. `outside_hours` names the window it
   *  judged against — the same HH:MM pair the English fallback carries, so the
   *  two can never say different times. */
  params?: { open: string; close: string }
  /** ⚖ W0.5 — the JST YYYY-MM-DD the refusal is about, set ONLY when that is
   *  not the booking's own start day: a booking that runs past midnight into a
   *  next day that is closed, or not yet open. On its own start day the
   *  booking already names the date, and every single-day refusal keeps the
   *  exact shape it always had. */
  date?: string
}

/**
 * The PURE half of the rule: everything judgeable from the input alone — no
 * store, no network, no throw.
 *
 * ⚖ R1-2 — the store-dependent half moved INSIDE the booking core, where the
 * store the row will LAND in is resolved. But both doors must still refuse
 * junk input BEFORE resolveSynqedStaffId, which CREATES a staff record on
 * miss — the invariant those call sites have always protected. So this is the
 * gate they run first, and validateAppointmentTime runs it again as its own
 * first step: one set of rules, written once, so the two can never drift.
 */
export function validateAppointmentInput(input: AppointmentInput): BookingTimeRefusal | null {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    return { error: 'Duration must be a positive number of minutes.' }
  }

  if (Number.isNaN(new Date(input.startTime).getTime())) {
    // ⚖ R1-3 — coded, so the dialog can speak Japanese for it. The facade
    // schema takes any non-empty string, so this is the only thing standing
    // between `startTime: "tomorrow"` and an Invalid Date reaching the day
    // resolution (Intl.DateTimeFormat.formatToParts throws RangeError on one).
    // A 500 on the booking write path is not a refusal.
    return { error: 'Invalid appointment start time.', code: 'invalid_start' }
  }

  return null
}

/** ONE booking's time as ONE interval — what every create and update is
 *  normalised to before it is judged. */
export type BookingInterval = { startsAt: Date; endsAt: Date }

/** The time fields a reschedule patch may carry (updateAppointmentCore). */
export type BookingTimePatch = { startsAt?: string; endsAt?: string; durationMinutes?: number }

/**
 * ⚖ W0.5 X11 — the ONE effective interval a time patch describes, before any
 * hours question is asked. Whatever the patch leaves out comes from the stored
 * row (`current`):
 *
 *   patch shape            start            end
 *   {}                     stored           stored
 *   { startsAt }           S                S + the stored length (a move)
 *   { endsAt }             stored           E   (an end-only stretch)
 *   { durationMinutes }    stored           stored start + D
 *   { startsAt, endsAt }   S                E
 *   { startsAt, D }        S                S + D
 *   { endsAt, D }          stored           E   — D must equal E − start
 *   { startsAt, endsAt, D} S                E   — D must equal E − S
 *
 * Two names for one end that disagree → `time_patch_inconsistent`; an end at
 * or before the start, a duration that is not a positive whole number of
 * minutes, or a time that does not parse → refused. Pure: no store, no throw.
 * The stored row is `null` for a caller with no row in hand — then the patch
 * must name its own start.
 *
 * The interval returned here is the one core stores: updateAppointmentCore
 * sends it WHOLE (starts_at, ends_at, duration_minutes), never only the fields
 * the patch named — core would fill the rest from the stored row (W0.5 fix 1).
 */
export function effectiveInterval(
  current: { startsAt: string; endsAt: string } | null,
  patch: BookingTimePatch,
): BookingInterval | BookingTimeRefusal {
  const d = patch.durationMinutes
  if (d !== undefined && (!Number.isInteger(d) || d <= 0)) {
    return { error: 'Duration must be a positive number of minutes.' }
  }
  const at = (iso: string | undefined): Date | null => {
    if (iso === undefined) return null
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const s = at(patch.startsAt)
  if (patch.startsAt !== undefined && !s) {
    return { error: 'Invalid appointment start time.', code: 'invalid_start' }
  }
  const e = at(patch.endsAt)
  if (patch.endsAt !== undefined && !e) return { error: 'Invalid appointment end time.' }

  const storedStart = at(current?.startsAt)
  const storedEnd = at(current?.endsAt)
  const startsAt = s ?? storedStart
  if (!startsAt) return { error: 'Invalid appointment start time.', code: 'invalid_start' }

  let endsAt: Date | null
  if (e) {
    if (d !== undefined && e.getTime() - startsAt.getTime() !== d * 60_000) {
      return {
        error: 'The end time and the duration describe different bookings.',
        code: 'time_patch_inconsistent',
      }
    }
    endsAt = e
  } else if (d !== undefined) {
    endsAt = new Date(startsAt.getTime() + d * 60_000)
  } else if (s && storedStart && storedEnd) {
    // A move keeps the booking's length — the stored interval's, which is
    // core's own truth (ends_at − starts_at), never the duration_minutes label.
    endsAt = new Date(s.getTime() + (storedEnd.getTime() - storedStart.getTime()))
  } else {
    endsAt = storedEnd
  }
  if (!endsAt) return { error: 'Invalid appointment end time.' }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { error: 'A booking must end after it starts.' }
  }
  return { startsAt, endsAt }
}

/** One calendar day of a booking's interval: the instant whose JST day it is
 *  judged on, the weekday the org blob's fallback window is read for, and the
 *  minutes of that day the booking occupies ([fromMinute, toMinute], 0–1440). */
type BookingDaySegment = {
  at: Date
  dayKey: WeekdayKey
  fromMinute: number
  toMinute: number
}

/** The minute arithmetic every day segment is cut from — ONE reading, shared
 *  by the walk and by the fetch range, so the days the door asks core about
 *  and the days it judges can never differ.
 *
 *  ⚖ W0.5 fix 2 — JST for every caller: the day, its weekday and its minutes
 *  are JST's (jst.ts), never a caller-supplied offset. The closed/special
 *  lookup keys by ymdInJst, so a walk cut on any other clock could skip the
 *  JST day a booking touches (23:30–00:30 JST on a UTC clock is one day). */
function bookingSpan(input: AppointmentInput) {
  const start = new Date(input.startTime)
  const midnight = jstWallTimeToDate(ymdInJst(start), '00:00')
  const minuteOfDay = Math.floor((start.getTime() - midnight.getTime()) / 60_000)
  const endMinute = minuteOfDay + input.durationMinutes
  // How many midnights the interval runs past: its end is exclusive, so a
  // booking ending exactly at 24:00 touches ONE day.
  const lastDayIndex = Math.max(0, Math.ceil(endMinute / 1440) - 1)
  return { start, minuteOfDay, endMinute, lastDayIndex }
}

/** The instant of the LAST calendar day a booking touches (its start day when
 *  it does not run past midnight) — the fetch's range end (day-hours.ts), cut
 *  from the same arithmetic as the walk below. Assumes the input already
 *  passed validateAppointmentInput. */
export function bookingLastDay(input: AppointmentInput): Date {
  const { start, lastDayIndex } = bookingSpan(input)
  return new Date(start.getTime() + lastDayIndex * 86_400_000)
}

/** Every calendar day the booking touches, in order, lazily — the walk stops
 *  at the first refused day, so only a store open around the clock on every
 *  day a long booking crosses ever walks it whole. */
function* bookingDaySegments(input: AppointmentInput): Generator<BookingDaySegment> {
  const { start, minuteOfDay, endMinute, lastDayIndex } = bookingSpan(input)
  for (let k = 0; k <= lastDayIndex; k++) {
    // JST has no DST, so one day is exactly 86,400,000 ms and `at` lands on
    // the next JST calendar day at the same wall time.
    const at = new Date(start.getTime() + k * 86_400_000)
    yield {
      at,
      dayKey: getWeekdayKey(at),
      fromMinute: k === 0 ? minuteOfDay : 0,
      toMinute: Math.min(endMinute - k * 1440, 1440),
    }
  }
}

export async function validateAppointmentTime(
  input: AppointmentInput,
  operatingHours: unknown,
  dayHours: BookingDayHours,
): Promise<BookingTimeRefusal | null> {
  const inputError = validateAppointmentInput(input)
  if (inputError) return inputError

  const orgHours = normalizeOperatingHours(operatingHours)

  // ⚖ W0.5 X11 — EVERY calendar day the booking touches is judged, in order.
  // A booking that runs past midnight is two day facts, and both must be open
  // with the interval inside both windows: 23:30–00:30 needs today open until
  // 24:00 AND tomorrow open from 00:00. Before this the door judged the start
  // day alone and refused every such booking against that one window —
  // whatever tomorrow said. A booking inside one day walks exactly one
  // segment, the check this function always made.
  let dayIndex = 0
  for (const day of bookingDaySegments(input)) {
    // Named only past the start day (see BookingTimeRefusal.date).
    const named: { date?: string } = dayIndex++ === 0 ? {} : { date: ymdInJst(day.at) }

    // ⚖ PKT-1c-C — the closed-day door, ONE home. Nothing refused a booking on
    // a closed day before this check existed, which is exactly why a 休 day
    // could still carry real bookings. Core's own refusal is Anthony's ticket;
    // the app closes its own door here, for BOTH doors at once, through the
    // SAME resolver the week/month cells paint 休 from.
    //
    // The DAY is resolved in JST (resolveDayHours → partsInJst / ymdInJst), like
    // every other 予約 surface — so the day the staffer sees marked 休 is
    // exactly the day refused. The open/close-minute check below reads the
    // same JST day (⚖ W0.5 fix 2: no caller offset reaches the judgement).
    //
    // This runs BEFORE the window check on purpose: a closed day has no window,
    // and 「営業時間内(00:00〜00:00)に設定してください」 would be nonsense.
    const fact = resolveDayHours({
      date: day.at,
      weeklyHours: dayHours.weeklyHours,
      closedDates: dayHours.closedDates,
      specialOpenDays: dayHours.specialOpenDays,
      orgHours,
      orgSaved: dayHours.orgSaved,
    })
    if (fact.closed) {
      return {
        // Developer-facing fallback, same register as this file's siblings.
        // What the staffer reads is the reservation.errors.closedDay* line the
        // dialog picks off the three fields below.
        error: named.date
          ? `The booking runs into ${named.date}, which is closed — pick another time.`
          : 'This day is closed — pick another day.',
        code: 'closed_day',
        level: fact.source === 'org' ? 'org' : 'store',
        // ⚖ R1-7 — read off the resolver's own answer, never re-derived. The
        // UI and the door read what the resolver resolved; asking the same
        // question twice is one precedence change away from two answers.
        kind: fact.kind ?? 'weekday',
        ...named,
      }
    }

    // ⚖ R1-4 — the window is the STORE's when the store has one. The resolver
    // above already computed it; re-asking the business-wide blob here is what
    // made the door and the week grid disagree about the same day — a store
    // open 09:00–22:00 was refused at 09:30 against a 10:00–24:00 window that
    // belongs to nobody, and accepted at 23:00, an hour after it shut.
    // `source` is the one truth: 'default' means nobody saved this day
    // anywhere, and only then does the 10:00–24:00 fallback speak. It also
    // settles the day: a store window (or a 臨時営業日's own) is resolved on
    // the segment's JST day, the same day the closed check judged.
    const hours = fact.source === 'default' ? orgHours[day.dayKey] : fact

    if (day.fromMinute < hours.openMinute || day.toMinute > hours.closeMinute) {
      const open = formatMinuteOfDay(hours.openMinute)
      const close = formatMinuteOfDay(hours.closeMinute)
      // ⚖ R1-5 — coded, so the dialog renders 「予約は営業時間内(…)に設定して
      // ください。」 instead of this developer-facing English. The JA line and
      // its {open}/{close} placeholders have sat unused in messages/ja.json
      // since they were written; nothing ever passed them a code.
      return {
        error: named.date
          ? `Appointment must be within operating hours (${open}-${close}) on ${named.date}.`
          : `Appointment must be within operating hours (${open}-${close}).`,
        code: 'outside_hours',
        params: { open, close },
        ...named,
      }
    }
  }

  return null
}
