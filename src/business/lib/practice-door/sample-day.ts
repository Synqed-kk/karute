// ⚖ §v11 V11-8 · V11-9 (the board fix, PR-B) — THE SAMPLE DAY GIVES WAY TO THE LIVE DAY. A sample shift, break or
// 勤務不可 is never served where it contradicts a live booking of that person on that day, on every practice store.
// Territory-local and pure: door.ts seats the fixture day exactly as before and hands each store's seated day here,
// with the live rows it already read for that day. Who received which sample pattern (the seating) is not this file's.

import { jstDayKey, jstMinuteOfDay } from '../clock'
import type { FixtureAbsence, FixtureShift, FixtureSellSlot } from '../fixtures-today'
import { usualPairOf, weekdayOfKey, type StoreHours, type Window } from './store-hours'

type Span = { start: number; end: number }
/** One live row of one person on the shown day, in JST minutes (clipped to 24:00). */
export type LiveSpan = Span & { id: string; staff: string }

/** The core statuses the board never draws — the door's OWN copy (door.ts may not import today-board.ts): a CANCELLED
 *  row carries no board_state (door.ts `toAppointment`) and `dayBookings` drops it. Pinned equal to the board's, status
 *  by status through the door, in practice-door-on.test.ts. */
export const UNDRAWN_STATUSES: readonly string[] = ['CANCELLED']
export const drawnRow = (row: { kind: string; status: string }): boolean => row.kind === 'BOOKING' && !UNDRAWN_STATUSES.includes(row.status)

/** The rows the board draws on `dayKey` (its own day rule: the start's JST day) with a person on them, as minute spans.
 *  A row that does not end after it starts is ignored; one crossing midnight is clipped to 24:00 of the shown day. */
export function liveSpans(rows: ReadonlyArray<{ id: string; kind: string; status: string; staff_id: string | null; starts_at: string; ends_at: string }>, dayKey: number): LiveSpan[] {
  return rows.flatMap((r): LiveSpan[] => {
    const ms = Date.parse(r.ends_at) - Date.parse(r.starts_at)
    if (!drawnRow(r) || r.staff_id === null || !(ms > 0) || jstDayKey(r.starts_at) !== dayKey) return []
    const start = jstMinuteOfDay(r.starts_at)
    return [{ id: r.id, staff: r.staff_id, start, end: Math.min(1440, start + Math.ceil(ms / 60_000)) }]
  })
}

const meets = (a: Span, b: Span) => a.start < b.end && b.start < a.end
/** Every hour-aligned 60-minute slot starting at or after `from` that ends by `until`. */
const hoursFrom = (from: number, until: number): number[] =>
  Array.from({ length: Math.max(0, Math.floor((until - 60 - Math.ceil(from / 60) * 60) / 60) + 1) }, (_, i) => Math.ceil(from / 60) * 60 + i * 60)

/** ⚖ V11-8 — ONE person's seated day given way to their live rows of the day, in this order (the contract):
 *  (1) SHIFT — stretched to cover every row, both ends; no shift but rows → the day's pair, stretched the same way;
 *  (2) ABSENCE — one over a row moves its `from` to the end of the person's last row, dropped once that reaches the
 *      shift's end; a row an open served decision card CARRIES and the absence hides does not move it (the fixture world
 *      hides apt-27 behind the absence on purpose, today-board.test.ts:288-299);
 *  (3) BREAK — one over a row, or outside the shift, moves to the first hour-aligned 60 minutes inside the shift that
 *      meet no row, no absence and none of the person's served sell slots (`taken`), searching from its own start, then
 *      from the shift's start; none free → dropped. */
export function giveWay(
  day: { shift: FixtureShift | null; absence: FixtureAbsence | null },
  pair: Window,
  rows: readonly LiveSpan[],
  carried: ReadonlySet<string> = new Set(),
  taken: readonly Span[] = [],
): { shift: FixtureShift | null; absence: FixtureAbsence | null } {
  const base = day.shift ?? (rows.length > 0 ? { staff_id: rows[0].staff, start: pair.open, end: pair.close, breaks: [] } : null)
  const shift = base && { ...base, start: Math.min(base.start, ...rows.map((r) => r.start)), end: Math.max(base.end, ...rows.map((r) => r.end)) }
  let absence = day.absence
  const moving = absence === null ? [] : rows.filter((r) => !(carried.has(r.id) && r.start >= absence!.from))
  if (absence !== null && moving.some((r) => r.end > absence!.from)) {
    const from = Math.max(...moving.map((r) => r.end))
    absence = shift !== null && from >= shift.end ? null : { ...absence, from }
  }
  if (shift === null) return { shift, absence }
  const off = absence === null ? [] : [{ start: absence.from, end: 1440 }]
  const breaks = shift.breaks.reduce<Span[]>((kept, br) => {
    if (br.start >= shift.start && br.end <= shift.end && !rows.some((r) => meets(r, br))) return [...kept, br]
    const clear = (h: number) => ![...rows, ...off, ...taken, ...kept].some((x) => meets(x, { start: h, end: h + 60 }))
    const h = [...hoursFrom(Math.max(br.start, shift.start), shift.end), ...hoursFrom(shift.start, shift.end)].find(clear)
    return h === undefined ? kept : [...kept, { start: h, end: h + 60 }]
  }, [])
  return { shift: { ...shift, breaks }, absence }
}

/** ⚖ V11-9 — on a 'core' store a sample shift covers the store's OWN day: an edge at the sample open moves to the day's
 *  open, one at the sample close to its close; an interior edge is kept, clamped inside the day. */
export function ownHours(shift: FixtureShift, sample: Window, day: Window): FixtureShift {
  const at = (m: number) => Math.min(day.close, Math.max(day.open, m === sample.open ? day.open : m === sample.close ? day.close : m))
  return { ...shift, start: at(shift.start), end: at(shift.end) }
}

/** One generator for all practice trades. The type selects this data path; hours determine its shifts. */
export function shiftDay(type: string, roster: readonly string[], pair: Window, absence: FixtureAbsence | null, slots: readonly FixtureSellSlot[]) {
  const hash = (id: string) => [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261)
  const split = pair.close - pair.open > 10 * 60
  const shifts: FixtureShift[] = roster.map((staff_id) => {
    const late = split && hash(staff_id) % 2 === 1
    const start = late ? pair.close - 9 * 60 : pair.open
    const end = split && !late ? pair.open + 9 * 60 : pair.close
    const lo = Math.max(start, 12 * 60), hi = Math.min(end - 60, 14 * 60)
    const br = split || hi < lo ? Math.floor((start + end - 60) / 2) : lo + hash(staff_id) % (Math.floor((hi - lo) / 30) + 1) * 30
    return { staff_id, start, end, breaks: end - start >= 60 ? [{ start: br, end: br + 60 }] : [] }
  })
  const early = shifts.find((s) => s.start === pair.open) ?? shifts[0]
  const away = absence && early ? { ...absence, staff_id: early.staff_id, from: Math.floor((early.start + early.end) / 2) } : null
  const sellSlots = [...new Set(shifts.map((s) => s.start))].flatMap((start) =>
    shifts.filter((s) => s.start === start && s.end >= start + 60).slice(0, 2).flatMap((s, i) => {
      const template = slots[i]
      return template && typeof template.resource_id === 'string' ? [{ ...template, id: start === pair.open ? template.id : `${template.id}:${type}:${start}`, staff_id: s.staff_id, start, end: start + 60 }] : []
    }),
  )
  return { shifts, absence: away, sellSlots }
}

/** ⚖ V11-8 + V11-9 — a store's seated sample day for `dayKey`, given way person by person. A 'core' store's shifts first
 *  cover its own day (a closed weekday serves none and no absence; a shift the day leaves empty is none); then every
 *  seated person, and every roster person with a row, gives way to their rows. 'sample' stores and the all-stores view
 *  keep the sample window (V9-2). */
export function serveDay(input: {
  type?: string
  fixtureTwin?: boolean
  sellSlots?: readonly FixtureSellSlot[]
  slotTemplates?: readonly FixtureSellSlot[]
  roomsBusy?: ReadonlyArray<Span & { room: string }>
  shifts: readonly FixtureShift[]
  absence: FixtureAbsence | null
  roster: readonly string[]
  rows: readonly LiveSpan[]
  carried: ReadonlySet<string>
  taken: ReadonlyArray<Span & { staff_id: string }>
  hours: StoreHours
  sample: Window
  dayKey: number
}): { shifts: FixtureShift[]; absence: FixtureAbsence | null; sellSlots?: FixtureSellSlot[] } {
  const wd = weekdayOfKey(input.dayKey)
  // ⚖ S81 R7 — the day the hours were READ for answers for itself: its 臨時休業 closes it, its 臨時営業日 opens it with its
  // own window; every other day of the range keeps its weekday's answer, exactly as before.
  const shown = input.dayKey === input.hours.shownDayKey
  const pair = (shown && input.hours.shownDayClosed === null ? input.hours.operatingHours : null) ?? input.hours.weeklyHours[wd] ?? usualPairOf(input.hours.weeklyHours) ?? input.hours.operatingHours
  const core = input.hours.hoursSource === 'core'
  // ⚖ S81 F2 — a 'sample' week with a REAL fact on the day (a 臨時休業, or a 臨時営業日's own window): the day's fact wins
  // over the sample fiction — nobody seated on the closed date, the sample shifts clipped to the special window. The sample
  // set's own 定休日 stays fiction, as before (a 'weekday' closure on a 'sample' plane is the fixture's).
  const real = !core && shown && (input.hours.shownDayClosed === 'closed_date' || (input.hours.shownDayClosed === null && (pair.open !== input.sample.open || pair.close !== input.sample.close)))
  const closed = (core || real) && (shown ? input.hours.shownDayClosed !== null : input.hours.closedWeekdays.includes(wd))
  // The 10–19 six-person twin, fixture world and all-store fallback keep their exact seated data.
  const generate = input.type && (core || real) && !(pair.open === 600 && pair.close === 1140 && (input.roster.length === 6 || (input.fixtureTwin && input.shifts.length === 6)))
  const generated = generate ? shiftDay(input.type!, input.roster, pair, input.absence, input.slotTemplates ?? input.sellSlots ?? []) : null
  const seated = closed ? [] : generated?.shifts ?? (!core && !real ? input.shifts : input.shifts.map((s) => ownHours(s, input.sample, pair)).filter((s) => s.start < s.end))
  const absence = closed ? null : generated ? generated.absence : input.absence
  const sellSlots = (closed ? [] : generated?.sellSlots ?? input.sellSlots ?? []).filter((s) =>
    !generated || (!input.rows.some((r) => r.staff === s.staff_id && meets(r, s)) && !(input.roomsBusy ?? []).some((r) => r.room === s.resource_id && meets(r, s))),
  )
  const people = [...new Set([...seated.map((s) => s.staff_id), ...input.roster.filter((id) => input.rows.some((r) => r.staff === id))])]
  const days = people.map((id) =>
    giveWay(
      { shift: seated.find((s) => s.staff_id === id) ?? null, absence: absence?.staff_id === id ? absence : null },
      pair,
      input.rows.filter((r) => r.staff === id),
      input.carried,
      (input.sellSlots ? sellSlots : input.taken).filter((t) => t.staff_id === id),
    ),
  )
  const own = absence === null ? -1 : people.indexOf(absence.staff_id)
  return { shifts: days.flatMap((d) => (d.shift ? [d.shift] : [])), absence: own < 0 ? absence : days[own].absence, ...(input.sellSlots ? { sellSlots } : {}) }
}
