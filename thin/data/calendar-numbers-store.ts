// The calendar's NUMBERS, kept across app launches — and nothing else.
//
// WHY IT EXISTS (MEASURE-CALENDAR-SPEED-2026-09-16 §1): the first read after
// the app has been idle is the slowest thing on this screen — 2.2 s measured
// cold. Everything the pop-down calendar draws is counts and density, so those
// can be written down on the device and painted immediately, with the real read
// landing behind them exactly as it does today.
//
// Only the nine fields read by AppointmentsScreen.toMonthCells are persisted,
// copied explicitly. Unknown DTO fields (including nested objects) are dropped.
// The free-form strings must have the producer's date/cell-id shapes; density
// is a fixed enum. Capacity fields are not read by that mapper and stay out.
// Entries are isolated by the current user, store lens and screen path.
//
// Plain namespaced `localStorage` with a version key and a cap, because no
// shared utility fits: `src/lib/auth/mobile/secure-storage.ts` is for SECRETS
// (a token, the Keychain door) and these are not secrets; the shape used here
// is thin/chrome/store-pref.ts's, which is this bundle's own precedent for a
// small durable preference — one key, one JSON object, every read and write in
// a try/catch, and a corrupt or absent value read as ABSENT rather than thrown.

import { getCurrentSession } from '@/lib/auth/mobile/session-store'
import { getThinActiveStore } from '../chrome/store-pref'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'

const KEY = 'karute-calendar-numbers'
const VERSION = 2
/** A month is ~42 cells of small numbers (~6 KB). The cap is the wall against
 *  a future field quietly making this big, never a working limit. */
const CAP_BYTES = 200_000
/** One month at a time. The panel opens on the month the page is on; an older
 *  month's counts are re-read the moment it is swiped to. */
const MAX_ENTRIES = 2

/** Same synchronous live-or-last-known user as store-pref; no session fetch. */
function entryKey(path: string): string | null {
  const userId = getCurrentSession()?.user?.id
  if (!userId) return null
  return JSON.stringify([userId, getThinActiveStore() ?? 'all', path])
}

export type CalendarMonthCell = Pick<MonthCellDTOType,
  'id' | 'dateIso' | 'inMonth' | 'isToday' | 'count' | 'density' |
  'closed' | 'newCount' | 'newCountKnown'
>

interface Blob {
  v: number
  entries: Record<string, { at: number; monthData: CalendarMonthCell[] }>
}

const CELL_ID = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function storedCell(cell: MonthCellDTOType): CalendarMonthCell {
  return {
    id: cell.id,
    dateIso: cell.dateIso,
    inMonth: cell.inMonth,
    isToday: cell.isToday,
    count: cell.count,
    density: cell.density,
    closed: cell.closed,
    newCount: cell.newCount,
    newCountKnown: cell.newCountKnown,
  }
}

function read(): Blob {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Blob).v === VERSION &&
      typeof (parsed as Blob).entries === 'object'
    ) {
      return parsed as Blob
    }
  } catch {
    /* unavailable, blocked or corrupt — read as absent */
  }
  return { v: VERSION, entries: {} }
}

/**
 * Write down a month under its user, store lens and screen-cache path. A read that carries no month, or a switch that is off, writes
 * nothing.
 */
export function rememberMonthNumbers(path: string, monthData: MonthCellDTOType[] | null): void {
  if (!BOOKING_SWITCHES.persistCalendarNumbers) return
  if (!monthData || monthData.length === 0) return
  try {
    if (monthData.some((cell) =>
      typeof cell.id !== 'string' || !CELL_ID.test(cell.id) ||
      typeof cell.dateIso !== 'string' || !ISO_DATE.test(cell.dateIso)
    )) return
    const key = entryKey(path)
    if (key === null) return
    const blob = read()
    blob.entries[key] = { at: Date.now(), monthData: monthData.map(storedCell) }
    // Oldest out first, then the cap. Both are guards, not working limits.
    const keys = Object.keys(blob.entries).sort((a, b) => blob.entries[b].at - blob.entries[a].at)
    for (const stale of keys.slice(MAX_ENTRIES)) delete blob.entries[stale]
    let text = JSON.stringify(blob)
    while (text.length > CAP_BYTES && Object.keys(blob.entries).length > 1) {
      delete blob.entries[Object.keys(blob.entries).sort((a, b) => blob.entries[a].at - blob.entries[b].at)[0]]
      text = JSON.stringify(blob)
    }
    if (text.length > CAP_BYTES) return
    window.localStorage.setItem(KEY, text)
  } catch {
    /* storage unavailable or full — the month simply loads over the network */
  }
}

/** The cells written down for this month path, or null. Never throws. */
export function readMonthNumbers(path: string): CalendarMonthCell[] | null {
  if (!BOOKING_SWITCHES.persistCalendarNumbers) return null
  try {
    const key = entryKey(path)
    if (key === null) return null
    const entry = read().entries[key]
    return entry?.monthData ?? null
  } catch {
    return null
  }
}

/** Sign-out, or a business switch. Called from ScreenBoundary's own signed-out
 *  subscriber, beside the screen cache's wipe — one moment, one decision. */
export function clearCalendarNumbers(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* nothing persisted to clear */
  }
}
