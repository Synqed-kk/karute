import type { Appointment } from '@synqed-kk/client'
import type { MonthGridCell, WeekDayCardData, MonthDensityBucket } from '@synqed-kk/ui'
import { partsInJst, ymdInJst } from '@/lib/date/jst'
import { isCountedBooking } from '@/lib/appointments/by-date'
import type { DayHoursFact } from '@/lib/operating-hours'

// ---------------------------------------------------------------------------
// Adapter: synqed-core Appointment[] -> WeekDayCardData[] / MonthGridCell[]
// Pure functions; caller owns date math and business hours lookup.
//
// All bucketing + display is JST-anchored. Runtime-local methods (getDate(),
// getHours()) drift on the Vercel UTC server — a 23:30 JST booking on
// 2026-05-19 has UTC date 2026-05-19 14:30, but is bucketed as the next day
// in JST. Going through JST helpers keeps server and client in sync.
// ---------------------------------------------------------------------------

const VISIBLE_BOOKING_LIMIT = 4

function isoDay(d: Date): string {
  return ymdInJst(d)
}

function sameYMD(a: Date, b: Date): boolean {
  return ymdInJst(a) === ymdInJst(b)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function durationMinutes(a: Appointment): number {
  if (a.duration_minutes != null) return a.duration_minutes
  const start = new Date(a.starts_at).getTime()
  const end = new Date(a.ends_at).getTime()
  return Math.max(0, Math.round((end - start) / 60000))
}

/** One week row: the package's WeekDayCardData plus the 予約 numbers' own
 *  facts. Structurally assignable to WeekDayCardData[], so the npm WeekDayCard
 *  keeps rendering these rows verbatim until the app-local seven-row component
 *  replaces it. */
export type WeekDayRowData = WeekDayCardData & {
  /** The row's JST calendar day, YYYY-MM-DD — the id every 予約 surface keys
   *  and navigates by (?date= takes this spelling). */
  dateIso: string
  /** May 稼働/空き claim a number for this day at all (the five-conjunct rule
   *  below)? False → the cell shows 未設定 or takes the next metric, and
   *  availableMinutes is the old week-average arithmetic, not a capacity. */
  capacityDefensible: boolean
  /** A human really set this day's hours (store weekly_hours, a closed date, or
   *  a saved org-blob day). */
  hoursSaved: boolean
  /** 定休日 or 臨時休業. */
  closed: boolean
  cancelledCount: number
  noShowDayCount: number
  /** PKT-2 owns the producer; 0 here so the wire shape lands one release early. */
  returningCount: number
}

/** One month cell: the package's MonthGridCell plus the one fact the 月 page's
 *  own grid needs and the package has no slot for. Structurally assignable to
 *  MonthGridCell[], so the pop-down panel keeps seeding itself from the page's
 *  cells unchanged (it renders through the package grid, which ignores the
 *  extra key). */
export type MonthCell = MonthGridCell & {
  /** 定休日 or 臨時休業 — the SAME fact the week row carries, read from the
   *  SAME hoursFacts map, so a day cannot be 休 on one surface and open on
   *  the other. */
  closed: boolean
}

/** A counted booking as the two numbers the overlap check needs. */
type BookingSpan = { start: number; end: number }

function spanOf(a: Appointment): BookingSpan {
  const start = new Date(a.starts_at).getTime()
  return { start, end: start + durationMinutes(a) * 60_000 }
}

/** Do any two of the day's counted bookings overlap? A single staffer whose
 *  bookings overlap is two chairs wearing one name, so the day's capacity is
 *  not one person's opening hours. */
function hasOverlap(spans: readonly BookingSpan[]): boolean {
  // ponytail: O(n²) over ONE day's candidates (tens at most) — a sweep line
  // here would be cleverness nobody can check at 3am.
  for (let i = 0; i < spans.length; i++) {
    const aStart = spans[i].start
    const aEnd = spans[i].end
    for (let j = i + 1; j < spans.length; j++) {
      const bStart = spans[j].start
      const bEnd = spans[j].end
      if (aStart < bEnd && bStart < aEnd) return true
    }
  }
  return false
}

/** Per-JST-day counts of a terminal partition. */
function countByDay(rows: Appointment[] | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const a of rows ?? []) {
    const key = isoDay(new Date(a.starts_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function appointmentsToWeekData(
  appointments: Appointment[],
  weekStart: Date,
  weekEnd: Date,
  businessHoursMinutes: number,
  today: Date,
  locale: string,
  // Client ids flagged new (QR `is_existing_customer === false`) — drives the
  // per-day "new customer" chip. Empty set = no new-customer highlighting.
  newCustomerIds: Set<string> = new Set(),
  /** The window's CANCELLED / NO_SHOW bookings (fetchAppointmentWindow's own
   *  partitions). Absent = the counts render 0, today's behaviour. */
  terminal?: { cancelled: Appointment[]; noShow: Appointment[] },
  /** That day's resolved hours, keyed by JST YYYY-MM-DD (resolveWindowHours).
   *  Absent = no day is defensible, so nothing claims a capacity. */
  hoursFacts?: ReadonlyMap<string, DayHoursFact>,
  /** The salon's solo_mode capability — the first conjunct. */
  soloMode?: boolean,
): WeekDayRowData[] {
  // Localized short weekday (日/月… in ja, Sun/Mon… in en). The package's
  // WeekDayCard renders this verbatim, so it has to be localized at the source.
  const weekdayFmt = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  })
  // Bucket appointments by ISO day.
  const buckets = new Map<string, Appointment[]>()
  for (const a of appointments) {
    const key = isoDay(new Date(a.starts_at))
    const arr = buckets.get(key)
    if (arr) arr.push(a)
    else buckets.set(key, [a])
  }

  const cancelledByDay = countByDay(terminal?.cancelled)
  const noShowByDay = countByDay(terminal?.noShow)

  // ⚖ Overlap is not a day-bucket question. A 23:30–00:30 booking and a
  // 00:00–01:00 booking under the same staffer genuinely collide, but they
  // bucket to different JST days by START, so the old per-bucket check never
  // compared them and BOTH days claimed a defensible single-staffer capacity.
  // The candidate set for day D is therefore every counted row of the WHOLE
  // window that actually runs inside D. Counting and bookedMinutes stay
  // start-day bucketed — that is the app's rule on every other surface.
  const spans = appointments.filter(isCountedBooking).map(spanOf)

  const days: WeekDayRowData[] = []
  const cursor = new Date(weekStart)
  while (cursor <= weekEnd) {
    const key = isoDay(cursor)
    // The caller already hands over COUNTED rows; re-applying the one predicate
    // here is the guard that keeps a second 件 definition from ever appearing
    // (a legacy caller passing a raw range gets the same truth).
    const dayAppts = (buckets.get(key) ?? [])
      .filter(isCountedBooking)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))

    const bookedMinutes = dayAppts.reduce((sum, a) => sum + durationMinutes(a), 0)
    // Capacity = open hours × the staff who actually worked that day (≥1), so
    // utilization is salon-wide and can't read >100% the way a single-chair
    // denominator did (a 6-staff day was showing "117% utilized"). Approximation:
    // a working staffer is treated as open the full business hours — refine when
    // per-staff schedules exist.
    const staffOnDay = new Set(dayAppts.map((a) => a.staff_id)).size

    const visible = dayAppts.slice(0, VISIBLE_BOOKING_LIMIT).map((a) => ({
      id: a.id,
      startTime: formatTime(a.starts_at),
      shortName: a.title ?? '—',
    }))

    // ⚖ STRESS-S F1 — capacity is NEVER derived from who got booked. All five
    // conjuncts, or the day claims nothing. (A truncated window never reaches
    // this adapter, so the fifth conjunct is guaranteed upstream.)
    const fact = hoursFacts?.get(key)
    const bookedStaff = new Set(
      dayAppts.map((a) => a.staff_id).filter((id): id is string => id != null),
    )
    // ponytail: one linear scan per day over the window's counted rows (a month
    // grid is ~45 days × a few hundred rows). Same answer as an interval tree,
    // readable at 3am.
    const dayStartMs = new Date(`${key}T00:00:00+09:00`).getTime()
    const dayEndMs = dayStartMs + 86_400_000
    // The end bound is INCLUSIVE on purpose. A row starting the instant the day
    // ends occupies none of it, so it can only ever register as an overlap
    // together with a row that runs past midnight — a genuine collision. Two
    // merely touching bookings never overlap (the check is strict on both
    // sides), so the closed bound cannot invent one.
    const overlapSpans = spans.filter((s) => s.start <= dayEndMs && dayStartMs < s.end)
    const capacityDefensible =
      soloMode === true &&
      bookedStaff.size <= 1 &&
      !hasOverlap(overlapSpans) &&
      fact != null &&
      fact.saved &&
      !fact.closed &&
      // A day booked past its own saved window is proof the denominator is
      // wrong, not proof the salon ran at 117%: unassigned rows and bookings
      // outside opening hours both land here. The day claims nothing and falls
      // back to the old arithmetic — 稼働 never renders above 100% (spec §8,
      // STRESS-S F1).
      bookedMinutes <= fact.minutes

    const cp = partsInJst(cursor)
    days.push({
      dateNumber: cp.day,
      monthNumber: cp.month,
      weekdayLabel: weekdayFmt.format(cursor),
      isToday: sameYMD(cursor, today),
      count: dayAppts.length,
      bookedMinutes,
      // Two-faced on purpose until the app-local row lands: the day's SAVED
      // minutes when the conjunction holds, else today's exact arithmetic so
      // the npm WeekDayCard renders byte-identically. capacityDefensible +
      // hoursSaved carry the truth (spec §9).
      // ⚠ The FORMULA below is unchanged byte for byte; its INPUT SET is not.
      // `dayAppts` is now the COUNTED rows, so a staffer who only holds a BLOCK
      // (「オーナー業務」) or a cancelled row that day no longer counts as
      // working and the denominator can come out LOWER than it did on main
      // (one booking + one other staffer's BLOCK: 1200 → 600). Declared, and
      // the truer number — a bed hold is not a second chair (L4-2).
      availableMinutes: capacityDefensible
        ? fact.minutes
        : businessHoursMinutes * Math.max(1, staffOnDay),
      dateIso: key,
      capacityDefensible,
      hoursSaved: fact?.saved ?? false,
      closed: fact?.closed ?? false,
      cancelledCount: cancelledByDay.get(key) ?? 0,
      noShowDayCount: noShowByDay.get(key) ?? 0,
      returningCount: 0,
      newCustomerCount: dayAppts.filter((a) => a.customer_id && newCustomerIds.has(a.customer_id))
        .length,
      remindersPending: 0,
      consentPending: 0,
      // synqed appointments have no "unconfirmed/pending" status
      // (SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED) — the old code mislabeled
      // CANCELLED as unconfirmed. Zero until a real pending state exists.
      unconfirmed: 0,
      visibleBookings: visible,
      hiddenCount: Math.max(0, dayAppts.length - VISIBLE_BOOKING_LIMIT),
    })

    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function densityFor(count: number): MonthDensityBucket {
  if (count === 0) return 'empty'
  if (count <= 2) return 'light'
  if (count <= 5) return 'medium'
  return 'busy'
}

export function appointmentsToMonthCells(
  appointments: Appointment[],
  monthStart: Date,
  monthEnd: Date,
  today: Date,
  /** That day's resolved hours, keyed by JST YYYY-MM-DD — the same map the
   *  week adapter above reads its own `closed` from (resolveWindowHours).
   *  Absent = no cell is closed, today's behaviour. */
  hoursFacts?: ReadonlyMap<string, DayHoursFact>,
): MonthCell[] {
  const buckets = new Map<string, number>()
  // Same guard as the week adapter above: ONE 件 definition, so a month cell
  // and its week row can never disagree about the same day.
  for (const a of appointments) {
    if (!isCountedBooking(a)) continue
    const key = isoDay(new Date(a.starts_at))
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  // Grid starts on Monday (matches MonthGrid default weekday labels: Mon..Sun).
  // JS Day: 0=Sun..6=Sat; convert to Mon-first index (Mon=0..Sun=6).
  // Pull weekday in JST so the leading-padding count is correct when the
  // server is UTC and monthStart is a JST midnight UTC instant.
  const monthStartParts = partsInJst(monthStart)
  const monStartIdx = (monthStartParts.weekday + 6) % 7
  const gridStart = new Date(monthStart)
  gridStart.setDate(gridStart.getDate() - monStartIdx)

  const monthEndParts = partsInJst(monthEnd)
  const monEndIdx = (monthEndParts.weekday + 6) % 7
  const trailing = 6 - monEndIdx
  const gridEnd = new Date(monthEnd)
  gridEnd.setDate(gridEnd.getDate() + trailing)

  const cells: MonthCell[] = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    const key = isoDay(cursor)
    const count = buckets.get(key) ?? 0
    const cp = partsInJst(cursor)
    const inMonth =
      cp.month === monthStartParts.month && cp.year === monthStartParts.year
    cells.push({
      id: key,
      date: new Date(cursor),
      inMonth,
      isToday: sameYMD(cursor, today),
      count: inMonth ? count : 0,
      density: inMonth ? densityFor(count) : 'empty',
      // Out-of-month cells are inert on the page grid and never render a
      // marker, so their own closed state would be a fact nothing can show.
      closed: inMonth ? (hoursFacts?.get(key)?.closed ?? false) : false,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}
