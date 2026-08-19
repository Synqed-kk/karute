// The fixture clock. PLAY-PHASE fixtures are dated RELATIVE to whoever is
// looking (⚖ L-6, transplant batch 1): the previous fixed calendar died on
// 2026-08-23 and emptied every 次回予約 column on the day after. A demo board
// that goes blank because a date passed is a defect class, not a chore, so
// there are no absolute dates left in the fixture set — every one is derived
// from ONE anchor, "today in JST".
//
// JST is UTC+9 with no daylight saving, so a whole day is exactly 86_400_000ms
// from JST midnight and the arithmetic below needs no calendar library.
//
// This module imports nothing (play-phase seal) and reads the clock only
// through the `now` argument, which every caller may pin — that is how the
// test suite fakes a date, and how the +30-days assertion proves the fixture
// set survives real time passing.

const DAY_MS = 86_400_000
const JST_OFFSET_MS = 9 * 3_600_000

/** UTC instant of JST-midnight on the day `now` falls in. */
export function jstMidnight(now: Date = new Date()): number {
  return Math.floor((now.getTime() + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS
}

/**
 * ISO instant for `dayOffset` days from today at `hour`:`minute` JST.
 * `jstSlot(0, 10)` = today 10:00 JST · `jstSlot(-7, 15, 30)` = a week ago 15:30 JST.
 */
export function jstSlot(dayOffset: number, hour: number, minute = 0, now: Date = new Date()): string {
  return new Date(
    jstMidnight(now) + dayOffset * DAY_MS + hour * 3_600_000 + minute * 60_000,
  ).toISOString()
}

/** JST day index of an instant — how many whole JST days since the epoch.
 *  The join key for "is this row on the day the board is showing": comparing
 *  day indices cannot drift the way comparing formatted date strings can. */
export function jstDayKey(iso: string | Date): number {
  return Math.floor(((typeof iso === 'string' ? new Date(iso) : iso).getTime() + JST_OFFSET_MS) / DAY_MS)
}

/** Minutes since JST midnight — the board's own coordinate. The timeline is a
 *  minute axis, so every lane element (booking, shift, break, cleanup) is
 *  placed from this one number and nothing on the board parses a time string. */
export function jstMinuteOfDay(iso: string | Date): number {
  const t = (typeof iso === 'string' ? new Date(iso) : iso).getTime() + JST_OFFSET_MS
  return Math.floor((t - Math.floor(t / DAY_MS) * DAY_MS) / 60_000)
}

/** Same slot, `minutes` later — the ends_at half of a booking. */
export function jstSlotEnd(
  dayOffset: number,
  hour: number,
  minute: number,
  minutes: number,
  now: Date = new Date(),
): string {
  return new Date(new Date(jstSlot(dayOffset, hour, minute, now)).getTime() + minutes * 60_000).toISOString()
}
