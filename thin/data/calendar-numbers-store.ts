// Calendar-number persistence is OFF in release 28; reads and writes no-op.
// Re-enable only with (a) the server-resolved store id from the DTO in the key,
// (b) identity captured at request time and compared at settle, and (c) real
// calendar validation: valid dates, 28–42 consecutive unique days, and
// non-negative integer counts. These requirements are NOT implemented here.
// Clearing stays unconditional to remove blobs from earlier look builds.
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
// Every entry is validated on read; invalid entries vanish on the next write.
// Entries use the current user, LOCAL store preference and screen path.
// That preference is not necessarily the server-resolved lens; keep this OFF.
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
import { MonthCellDTO, type MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'

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

// This schema already ships inside AppointmentsScreenDTO. Keep its field types,
// but require stored fields: wire-skew defaults must not repair corrupt storage.
const StoredMonthCell = MonthCellDTO.pick({
  id: true, dateIso: true, inMonth: true, isToday: true, count: true,
  density: true, closed: true, newCount: true, newCountKnown: true,
}).extend({
  id: MonthCellDTO.shape.id.regex(CELL_ID),
  dateIso: MonthCellDTO.shape.dateIso.regex(ISO_DATE),
  closed: MonthCellDTO.shape.closed.removeDefault(),
  newCount: MonthCellDTO.shape.newCount.removeDefault(),
  newCountKnown: MonthCellDTO.shape.newCountKnown.removeDefault(),
})
const StoredMonth = StoredMonthCell.array().nonempty()

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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
    if (isObject(parsed) && parsed.v === VERSION && isObject(parsed.entries)) {
      const entries: Blob['entries'] = {}
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (!isObject(entry) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue
        const cells = StoredMonth.safeParse(entry.monthData)
        if (!cells.success) continue
        entries[key] = { at: entry.at, monthData: cells.data }
      }
      return { v: VERSION, entries }
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
    if (!StoredMonth.safeParse(monthData).success) return
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
