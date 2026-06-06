import type { Appointment } from '@synqed-kk/client'
import type { MonthGridCell, WeekDayCardData, MonthDensityBucket } from '@synqed-kk/ui'
import { partsInJst, ymdInJst } from '@/lib/date/jst'

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
): WeekDayCardData[] {
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

  const days: WeekDayCardData[] = []
  const cursor = new Date(weekStart)
  while (cursor <= weekEnd) {
    const key = isoDay(cursor)
    const dayAppts = (buckets.get(key) ?? []).slice().sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at),
    )

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

    const cp = partsInJst(cursor)
    days.push({
      dateNumber: cp.day,
      monthNumber: cp.month,
      weekdayLabel: weekdayFmt.format(cursor),
      isToday: sameYMD(cursor, today),
      count: dayAppts.length,
      bookedMinutes,
      availableMinutes: businessHoursMinutes * Math.max(1, staffOnDay),
      newCustomerCount: dayAppts.filter((a) => newCustomerIds.has(a.customer_id))
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
): MonthGridCell[] {
  const buckets = new Map<string, number>()
  for (const a of appointments) {
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

  const cells: MonthGridCell[] = []
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
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}
