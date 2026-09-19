import {
  formatMinuteOfDay,
  normalizeOperatingHours,
  resolveDayHours,
  utcToLocalDayAndMinute,
  type DayHoursInput,
} from '@/lib/operating-hours'

// karute is JST-only, and the day is already resolved in JST, so default to JST's getTimezoneOffset value.
const JST_TZ_OFFSET_MINUTES = -540

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
  code?: 'closed_day' | 'invalid_start' | 'outside_hours'
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

export async function validateAppointmentTime(
  input: AppointmentInput,
  operatingHours: unknown,
  dayHours: BookingDayHours,
): Promise<BookingTimeRefusal | null> {
  const inputError = validateAppointmentInput(input)
  if (inputError) return inputError

  const startDate = new Date(input.startTime)

  // ⚖ PKT-1c-C — the closed-day door, ONE home. Nothing refused a booking on a
  // closed day before this check existed, which is exactly why a 休 day could
  // still carry real bookings. Core's own refusal is Anthony's ticket; the app
  // closes its own door here, for BOTH doors at once, through the SAME resolver
  // the week/month cells paint 休 from.
  //
  // The DAY is resolved in JST (resolveDayHours → partsInJst / ymdInJst), like
  // every other 予約 surface — so the day the staffer sees marked 休 is exactly
  // the day refused. The open/close-minute check below keeps its own
  // client-tz-offset reading when an explicit offset is supplied.
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
      // ⚖ R1-7 — read off the resolver's own answer, never re-derived. The
      // UI and the door read what the resolver resolved; asking the same
      // question twice is one precedence change away from two answers.
      kind: fact.kind ?? 'weekday',
    }
  }

  const tzOffsetMinutes = Number.isFinite(input.tzOffsetMinutes)
    ? (input.tzOffsetMinutes as number)
    : JST_TZ_OFFSET_MINUTES
  const { dayKey, minuteOfDay } = utcToLocalDayAndMinute(startDate, tzOffsetMinutes)
  // ⚖ R1-4 — the window is the STORE's when the store has one. The resolver
  // above already computed it; re-asking the business-wide blob here is what
  // made the door and the week grid disagree about the same day — a store open
  // 09:00–22:00 was refused at 09:30 against a 10:00–24:00 window that belongs
  // to nobody, and accepted at 23:00, an hour after it shut. `source` is the
  // one truth: 'default' means nobody saved this day anywhere, and only then
  // does the 10:00–24:00 fallback speak. It also settles the day: a store
  // window is resolved on the booking's JST day, the same day the closed check
  // judged.
  const hours =
    fact.source === 'default' ? normalizeOperatingHours(operatingHours)[dayKey] : fact
  const endMinute = minuteOfDay + input.durationMinutes

  if (minuteOfDay < hours.openMinute || endMinute > hours.closeMinute) {
    const open = formatMinuteOfDay(hours.openMinute)
    const close = formatMinuteOfDay(hours.closeMinute)
    // ⚖ R1-5 — coded, so the dialog renders 「予約は営業時間内(…)に設定して
    // ください。」 instead of this developer-facing English. The JA line and
    // its {open}/{close} placeholders have sat unused in messages/ja.json
    // since they were written; nothing ever passed them a code.
    return {
      error: `Appointment must be within operating hours (${open}-${close}).`,
      code: 'outside_hours',
      params: { open, close },
    }
  }

  return null
}
