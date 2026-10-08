import type { BookedSpan, CapacityInput, DayHours } from './capacity'

export type ShiftState = 'entered' | 'partial' | 'none' | 'nobody' | 'solo' | 'off' | 'unavailable'
export type Interval = { startMs: number; endMs: number }
export interface ShiftRow extends Interval {
  staffId: string
  storeId: string
  date: string
  breaks: readonly Interval[]
  blocks: readonly Interval[]
}
export interface ShiftPerson {
  id: string
  active: boolean
  /** Empty assignments = floating. Missing createdAt uses the existing load. */
  stores: readonly { storeId: string; createdAtMs?: number }[]
}
export interface ShiftCapacityInput {
  storeId: string
  date: string
  rows: readonly ShiftRow[]
  roster: readonly ShiftPerson[] | null
  readComplete: boolean
  soloMode?: boolean
  personId?: string | null
  blocks?: readonly BookedSpan[]
}

function union(spans: readonly Interval[]): Interval[] {
  const sorted = spans.filter(s => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .map(s => ({ startMs: s.startMs, endMs: s.endMs })).sort((a, b) => a.startMs - b.startMs)
  const result: Interval[] = []
  for (const s of sorted) {
    const last = result[result.length - 1]
    if (last && s.startMs <= last.endMs) last.endMs = Math.max(last.endMs, s.endMs)
    else result.push(s)
  }
  return result
}
function subtract(spans: readonly Interval[], excluded: readonly Interval[]): Interval[] {
  let result = union(spans)
  for (const cut of union(excluded)) {
    result = result.flatMap(s => {
      if (cut.endMs <= s.startMs || cut.startMs >= s.endMs) return [s]
      return [
        { startMs: s.startMs, endMs: Math.min(s.endMs, cut.startMs) },
        { startMs: Math.max(s.startMs, cut.endMs), endMs: s.endMs },
      ].filter(i => i.endMs > i.startMs)
    })
  }
  return result
}
function minutes(spans: readonly Interval[]): number {
  return union(spans).reduce((n, s) => n + (s.endMs - s.startMs) / 60_000, 0)
}

/** Shared receivable-time rule R-B. No phone, SDK, or switch dependency. */
export function receivableIntervals(
  personId: string,
  storeId: string,
  date: string,
  rows: readonly ShiftRow[],
  hours: DayHours | null,
  blocks: readonly BookedSpan[] = [],
): Interval[] {
  if (!hours || hours.closed || hours.source === 'default') return []
  const own = rows.filter(r => r.staffId === personId && r.storeId === storeId && r.date === date)
  return subtract(own.map(r => ({ startMs: Math.max(r.startMs, hours.openMs), endMs: Math.min(r.endMs, hours.closeMs) })), [
    ...own.flatMap(r => [...r.breaks, ...r.blocks]),
    ...blocks.filter(b => b.staffId === personId),
  ])
}

/** Ruling S110-1: a solo fallback row needs an owner the data names; null =
 *  the solo claim is contradicted for this day (no fallback row). */
function resolveSoloOwner(shift: ShiftCapacityInput, eligible: readonly ShiftPerson[], assignedIds: ReadonlySet<string>): string | null {
  if (eligible.length === 1) return eligible[0].id
  if (shift.soloMode !== true) return null
  if (assignedIds.size === 1) return assignedIds.values().next().value as string
  if (eligible.length === 0 && assignedIds.size === 0) return '__solo__'
  return null
}

/** R-A–R-J totals only: capacityForDay remains the sole percentage producer. */
export function shiftTotals(input: CapacityInput, shift: ShiftCapacityInput) {
  const rows = shift.rows.filter(r => r.storeId === shift.storeId && r.date === shift.date)
  const eligible = (shift.roster ?? []).filter(p => p.active && (p.stores.length === 0 || p.stores.some(s => s.storeId === shift.storeId && (s.createdAtMs == null || s.createdAtMs < input.dayEndMs))))
  // Every assigned span of the store-day, BEFORE the personId filter below.
  const assignedIds = new Set(input.spans.filter(s => s.staffId != null && Math.min(s.endMs, input.dayEndMs) > Math.max(s.startMs, input.dayStartMs)).map(s => s.staffId as string))
  const soloOwner = resolveSoloOwner(shift, eligible, assignedIds)
  // solo claim contradicted by the roster/bookings for this day → not entered; PR-2 guess mode covers it
  const solo = soloOwner != null
  // Core has no dated removals/deactivations: a past zero-row day at a store
  // that has since shrunk to one person reads as solo (R-A known limit).
  const entered = rows.length > 0 || solo
  const booked = new Map<string, Interval[]>()
  const unassigned: Interval[] = []
  for (const s of input.spans) {
    const clipped = { startMs: Math.max(s.startMs, input.dayStartMs), endMs: Math.min(s.endMs, input.dayEndMs) }
    if (!union([clipped]).length) continue
    if (s.staffId == null) { if (!shift.personId) unassigned.push(clipped); continue }
    if (shift.personId && shift.personId !== s.staffId) continue
    booked.set(s.staffId, union([...(booked.get(s.staffId) ?? []), clipped]))
  }
  const bookedMinutes = [...booked.values()].reduce((n, s) => n + minutes(s), 0) + unassigned.reduce((n, s) => n + minutes([s]), 0)
  const empty = (state: ShiftState) => ({ bookedMinutes, capacityMinutes: null, shiftState: state, onShiftNoBooking: 0, unassignedOverflow: 0, lanes: shift.personId ? 1 : rows.length })
  // Fail closed here too, not only in the callers: no roster = no divisor.
  if (!shift.readComplete || shift.roster == null) return empty('unavailable')
  if (!entered) return empty('none')
  // An explicit solo setting supplies one lane even if the owner has no roster card.
  const effectiveRows: readonly ShiftRow[] = rows.length === 0 && soloOwner != null && input.hours
    ? [{ staffId: soloOwner, storeId: shift.storeId, date: shift.date, startMs: input.hours.openMs, endMs: input.hours.closeMs, breaks: [], blocks: [] }]
    : rows
  const ids = new Set([...effectiveRows.map(r => r.staffId), ...booked.keys()])
  if (shift.personId) {
    ids.clear()
    ids.add(shift.personId)
    if (!effectiveRows.some(r => r.staffId === shift.personId) && !booked.has(shift.personId)) return empty('off')
  }
  const receivable = new Map<string, Interval[]>()
  let onShiftNoBooking = 0
  let partial = false
  for (const id of ids) {
    const intervals = receivableIntervals(id, shift.storeId, shift.date, effectiveRows, input.hours, shift.blocks)
    receivable.set(id, intervals)
    if (!effectiveRows.some(r => r.staffId === id) && booked.has(id) && eligible.some(p => p.id === id)) partial = true
  }
  let overtime = 0
  let unassignedOverflow = 0
  for (const booking of unassigned.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    // One booking uses ONE free person: the one whose free time covers the
    // most of it, ties broken by staff id; nobody covering any of it = none.
    const fit = (id: string) => subtract(receivable.get(id) ?? [], booked.get(id) ?? [])
      .map(s => ({ startMs: Math.max(s.startMs, booking.startMs), endMs: Math.min(s.endMs, booking.endMs) }))
    let person: string | undefined
    let fitted: Interval[] = []
    for (const id of [...ids].sort()) {
      const candidate = fit(id)
      if (minutes(candidate) > minutes(fitted)) { person = id; fitted = candidate }
    }
    const overflow = minutes([booking]) - minutes(fitted)
    if (overflow > 0) unassignedOverflow++
    overtime += overflow
    if (person != null) booked.set(person, union([...(booked.get(person) ?? []), ...fitted]))
  }
  // Counted AFTER the unassigned fill: a person given one is not 予約0件.
  for (const id of ids) {
    if (rows.some(r => r.staffId === id) && minutes(receivable.get(id) ?? []) > 0 && !booked.has(id)) onShiftNoBooking++
  }
  const capacityMinutes = [...ids].reduce((n, id) => n + minutes([...(receivable.get(id) ?? []), ...(booked.get(id) ?? [])]), overtime)
  const shiftState: ShiftState = capacityMinutes === 0 ? 'nobody' : partial ? 'partial' : rows.length === 0 && solo ? 'solo' : 'entered'
  return { bookedMinutes, capacityMinutes: capacityMinutes || null, shiftState, onShiftNoBooking, unassignedOverflow, lanes: ids.size }
}
