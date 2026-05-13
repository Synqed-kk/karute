import type { Appointment } from '@synqed-kk/client'
import type { MonthGridCell, WeekDayCardData, MonthDensityBucket } from '@synqed-kk/ui'

// ---------------------------------------------------------------------------
// Adapter: synqed-core Appointment[] -> WeekDayCardData[] / MonthGridCell[]
// Pure functions; caller owns date math and business hours lookup.
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const VISIBLE_BOOKING_LIMIT = 4

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
): WeekDayCardData[] {
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
    const unconfirmed = dayAppts.filter((a) => a.status === 'CANCELLED').length

    const visible = dayAppts.slice(0, VISIBLE_BOOKING_LIMIT).map((a) => ({
      id: a.id,
      startTime: formatTime(a.starts_at),
      shortName: a.title ?? '—',
    }))

    days.push({
      dateNumber: cursor.getDate(),
      monthNumber: cursor.getMonth() + 1,
      weekdayLabel: WEEKDAY_LABELS[cursor.getDay()],
      isToday: sameYMD(cursor, today),
      count: dayAppts.length,
      bookedMinutes,
      availableMinutes: businessHoursMinutes,
      newCustomerCount: 0,
      remindersPending: 0,
      consentPending: 0,
      unconfirmed,
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
  const monthStartDay = monthStart.getDay()
  const monStartIdx = (monthStartDay + 6) % 7
  const gridStart = new Date(monthStart)
  gridStart.setDate(gridStart.getDate() - monStartIdx)

  const monthEndDay = monthEnd.getDay()
  const monEndIdx = (monthEndDay + 6) % 7
  const trailing = 6 - monEndIdx
  const gridEnd = new Date(monthEnd)
  gridEnd.setDate(gridEnd.getDate() + trailing)

  const cells: MonthGridCell[] = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    const key = isoDay(cursor)
    const count = buckets.get(key) ?? 0
    const inMonth =
      cursor.getMonth() === monthStart.getMonth() &&
      cursor.getFullYear() === monthStart.getFullYear()
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
