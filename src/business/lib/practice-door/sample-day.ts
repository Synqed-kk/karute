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

/** ⚖ R4 — THE SIDE RULE (one rule, two halves; the other half is scripts/test-world/plan.ts sidesOf): on a day longer than
 *  10 h the store's staff, sorted by NAME (plain code-unit sort), alternate early (open..open+9h) and late (close−9h..close)
 *  by index parity — both sides staffed from two people on, one person = early; a day longer than 18 h adds a middle side
 *  (index % 3). The loader books a profile visit only inside its person's side, so give-way never stretches a shift.
 *  ≤ 10 h: no sides (everyone works the day). */
export function sidesOf(names: readonly string[], pair: Window): Map<string, Span> | null {
  if (pair.close - pair.open <= 10 * 60) return null
  const mid = Math.floor((pair.open + pair.close) / 2)
  const sides = [{ start: pair.open, end: pair.open + 540 }, { start: pair.close - 540, end: pair.close }, ...(pair.close - pair.open > 18 * 60 ? [{ start: mid - 270, end: mid + 270 }] : [])]
  return new Map([...names].sort().map((name, i) => [name, sides[i % sides.length]]))
}

/** One generator for all practice trades: shifts by the side rule (sidesOf), staggered breaks, one absence (two people
 *  on), and the store's two 販売可能枠 AFTER the pinned board minute (as the fixture's 16:00 / 17:30) at the store's own prices. */
export function shiftDay(type: string, people: ReadonlyArray<{ id: string; name: string }>, pair: Window, absence: FixtureAbsence | null,
  templates: readonly FixtureSellSlot[], prices: { price_low: number; price_high: number } | null = null, pin = 13 * 60 + 24, rows: readonly LiveSpan[] = []) {
  const hash = (id: string) => [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261)
  const sides = sidesOf(people.map((p) => p.name), pair)
  const rank: Record<string, number> = {} // the person's place among their side, by name — staggers the split breaks
  const byName = [...people].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const shifts: FixtureShift[] = byName.map(({ id, name }) => {
    const side = sides?.get(name) ?? { start: pair.open, end: pair.close }
    const key = `${side.start}-${side.end}`
    const r = rank[key] ?? 0
    rank[key] = r + 1
    const { start, end } = side
    let br: number
    if (sides) {
      const base = Math.floor((start + end - 60) / 120) * 60
      br = Math.min(end - 120, Math.max(start + 60, base + [0, -60, 60, -120, 120][r % 5]))
    } else {
      const lo = Math.max(start, 12 * 60), hi = Math.min(end - 60, 14 * 60)
      br = hi < lo ? Math.floor((start + end - 60) / 2) : lo + (hash(id) % (Math.floor((hi - lo) / 30) + 1)) * 30
    }
    return { staff_id: id, start, end, breaks: end - start >= 120 ? [{ start: br, end: br + 60 }] : [] }
  }).filter((s) => s.start < s.end) // ⚖ R19: the same filter as ownHours (an overnight or empty day serves no shift)
  // the absence: the opening side's person whose live rows end first (so give-way keeps it); a lone person's absence would
  // empty the store, so it needs two people on
  const lastEnd = (s: FixtureShift) => Math.max(0, ...rows.filter((r) => r.staff === s.staff_id).map((r) => r.end))
  const opening = shifts.filter((s) => s.start === pair.open)
  const early = [...(opening.length ? opening : shifts)].sort((a, b) => lastEnd(a) - lastEnd(b))[0]
  const away = absence && early && shifts.length >= 2 ? { ...absence, staff_id: early.staff_id, from: Math.max(Math.floor((early.start + early.end) / 2), lastEnd(early)) } : null
  const meetsBreak = (s: FixtureShift, t: number) => s.breaks.some((b) => b.start < t + 60 && t < b.end)
  const times = [960, 1050].map((t) => Math.min(t, pair.close - 60 - (1050 - t))).filter((t) => t > pin && t >= pair.open)
  const used = new Set<string>()
  const sellSlots = times.flatMap((t, i): FixtureSellSlot[] => {
    const template = templates[i]
    const s = shifts.find((x) => !used.has(x.staff_id) && x.start <= t && t + 60 <= x.end && !meetsBreak(x, t) && !(away && away.staff_id === x.staff_id && t + 60 > away.from))
    if (!template || typeof template.resource_id !== 'string' || !s) return []
    used.add(s.staff_id)
    return [{ ...template, ...(prices ?? {}), id: `${template.id}:${type}:${t}`, staff_id: s.staff_id, start: t, end: t + 60 }]
  })
  return { shifts, absence: away, sellSlots }
}

/** ⚖ V11-8 + V11-9 — a store's seated sample day for `dayKey`, given way person by person. A 'core' store's shifts first
 *  cover its own day (a closed weekday serves none and no absence; a shift the day leaves empty is none); then every
 *  seated person, and every roster person with a row, gives way to their rows. 'sample' stores and the all-stores view
 *  keep the sample window (V9-2). */
export function serveDay(input: {
  type?: string
  names?: readonly string[] // the roster's display names, parallel to `roster` (the side rule sorts by name)
  prices?: { price_low: number; price_high: number } | null
  pin?: number
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
  const generated = generate ? shiftDay(input.type!, input.roster.map((id, i) => ({ id, name: input.names?.[i] ?? id })), pair, input.absence, input.slotTemplates ?? input.sellSlots ?? [], input.prices ?? null, input.pin, input.rows) : null
  const seated = closed ? [] : generated?.shifts ?? (!core && !real ? input.shifts : input.shifts.map((s) => ownHours(s, input.sample, pair)).filter((s) => s.start < s.end))
  const absence = closed ? null : generated ? generated.absence : input.absence
  // ⚖ R15: a closed day keeps the slots it always had (no `[]` special case); a generated day yields to busy people and rooms
  const sellSlots = (closed || !generated ? input.sellSlots ?? [] : generated.sellSlots).filter((s) =>
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
