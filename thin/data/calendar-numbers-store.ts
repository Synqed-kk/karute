// The calendar's NUMBERS, kept across app launches — and nothing else.
//
// WHY IT EXISTS (MEASURE-CALENDAR-SPEED-2026-09-16 §1): the first read after
// the app has been idle is the slowest thing on this screen — 2.2 s measured
// cold. Everything the pop-down calendar draws is counts and density, so those
// can be written down on the device and painted immediately, with the real read
// landing behind them exactly as it does today.
//
// ⚖ NAMES NEVER GO IN HERE. Only `monthData` is persisted: id, date, in-month,
// today, count, density, 休 and the capacity numbers — the wire shape the month
// GRID is drawn from. `reservationViews` (a customer's name beside their time),
// `customers` and `menus` are never written, and `assertNoNames` below REFUSES
// the write if a future field ever arrives carrying one. The test is a second
// wall, not the only one.
//
// Plain namespaced `localStorage` with a version key and a cap, because no
// shared utility fits: `src/lib/auth/mobile/secure-storage.ts` is for SECRETS
// (a token, the Keychain door) and these are not secrets; the shape used here
// is thin/chrome/store-pref.ts's, which is this bundle's own precedent for a
// small durable preference — one key, one JSON object, every read and write in
// a try/catch, and a corrupt or absent value read as ABSENT rather than thrown.

import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'

const KEY = 'karute-calendar-numbers'
const VERSION = 1
/** A month is ~42 cells of small numbers (~6 KB). The cap is the wall against
 *  a future field quietly making this big, never a working limit. */
const CAP_BYTES = 200_000
/** One month at a time. The panel opens on the month the page is on; an older
 *  month's counts are re-read the moment it is swiped to. */
const MAX_ENTRIES = 2

interface Blob {
  v: number
  entries: Record<string, { at: number; monthData: MonthCellDTOType[] }>
}

/** Any key that could carry a person's name, in any spelling this wire has
 *  used. A cell that has one is not a number and is not written down. */
const NAME_LIKE = /name|customer|client|title|memo|note|phone|email/i

function hasNames(cells: readonly MonthCellDTOType[]): boolean {
  return cells.some((cell) => Object.keys(cell).some((k) => NAME_LIKE.test(k)))
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
 * Write down a month read's cells under the SAME path the screen cache keys it
 * by, so the reader below and the in-session cache agree about what "this
 * month" means. A read that carries no month, or a switch that is off, writes
 * nothing.
 */
export function rememberMonthNumbers(path: string, monthData: MonthCellDTOType[] | null): void {
  if (!BOOKING_SWITCHES.persistCalendarNumbers) return
  if (!monthData || monthData.length === 0) return
  if (hasNames(monthData)) return
  try {
    const blob = read()
    blob.entries[path] = { at: Date.now(), monthData }
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
export function readMonthNumbers(path: string): MonthCellDTOType[] | null {
  if (!BOOKING_SWITCHES.persistCalendarNumbers) return null
  const entry = read().entries[path]
  return entry?.monthData ?? null
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
