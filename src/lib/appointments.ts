import {
  formatMinuteOfDay,
  normalizeOperatingHours,
  resolveDayHours,
  utcToLocalDayAndMinute,
  type DayHoursInput,
} from '@/lib/operating-hours'
import { ymdInJst } from '@/lib/date/jst'

export interface AppointmentInput {
  staffProfileId: string
  clientId: string
  startTime: string
  durationMinutes: number
  tzOffsetMinutes?: number
  title?: string
  notes?: string
  /** Catalog menu the booking is linked to (camelCase here, menu_id at the
   *  SDK seam). Core validates ownership and snapshots the price. */
  menuId?: string | null
}

/** The store-side half of the hours question, for ONE day. Fetched by
 *  src/lib/appointments/day-hours.ts — the same four inputs the 予約 screens
 *  resolve their 休 cells from, so the door and the screen can never disagree
 *  about whether a day is closed. */
export type BookingDayHours = Pick<DayHoursInput, 'weeklyHours' | 'closedDates' | 'orgSaved'>

/**
 * The house `{ error }` shape, with the closed-day refusal's provenance riding
 * on it (⚖ ADJUDICATION-STORE-HOURS item 15: the refusal NAMES which setting
 * closed the day and where to change it). Both doors return this verbatim, and
 * the ONE dialog both doors render picks its line off `code`/`level`/`kind` —
 * the UI decides nothing, it only renders what the validator resolved.
 */
export type BookingTimeRefusal = {
  error: string
  code?: 'closed_day'
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
}

export async function validateAppointmentTime(
  input: AppointmentInput,
  operatingHours: unknown,
  dayHours: BookingDayHours,
): Promise<BookingTimeRefusal | null> {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    return { error: 'Duration must be a positive number of minutes.' }
  }

  const startDate = new Date(input.startTime)
  if (Number.isNaN(startDate.getTime())) {
    return { error: 'Invalid appointment start time.' }
  }

  // ⚖ PKT-1c-C — the closed-day door, ONE home. Nothing refused a booking on a
  // closed day before this check existed, which is exactly why a 休 day could
  // still carry real bookings. Core's own refusal is Anthony's ticket; the app
  // closes its own door here, for BOTH doors at once, through the SAME resolver
  // the week/month cells paint 休 from.
  //
  // The DAY is resolved in JST (resolveDayHours → partsInJst / ymdInJst), like
  // every other 予約 surface — so the day the staffer sees marked 休 is exactly
  // the day refused. The open/close-minute check below keeps its own
  // client-tz-offset reading, byte-identical to before.
  //
  // This runs BEFORE the window check on purpose: a closed day has no window,
  // and 「営業時間内(00:00〜00:00)に設定してください」 would be nonsense.
  const fact = resolveDayHours({
    date: startDate,
    weeklyHours: dayHours.weeklyHours,
    closedDates: dayHours.closedDates,
    orgHours: normalizeOperatingHours(operatingHours),
    orgSaved: dayHours.orgSaved,
  })
  if (fact.closed) {
    return {
      // Developer-facing fallback, same register as this file's siblings. What
      // the staffer reads is the reservation.errors.closedDay* line the dialog
      // picks off the three fields below.
      error: 'This day is closed — pick another day.',
      code: 'closed_day',
      level: fact.source === 'org' ? 'org' : 'store',
      kind: dayHours.closedDates.has(ymdInJst(startDate)) ? 'closed_date' : 'weekday',
    }
  }

  const tzOffsetMinutes = Number.isFinite(input.tzOffsetMinutes) ? (input.tzOffsetMinutes as number) : 0
  const { dayKey, minuteOfDay } = utcToLocalDayAndMinute(startDate, tzOffsetMinutes)
  const hours = normalizeOperatingHours(operatingHours)[dayKey]
  const endMinute = minuteOfDay + input.durationMinutes

  if (minuteOfDay < hours.openMinute || endMinute > hours.closeMinute) {
    return {
      error: `Appointment must be within operating hours (${formatMinuteOfDay(hours.openMinute)}-${formatMinuteOfDay(hours.closeMinute)}).`,
    }
  }

  return null
}
