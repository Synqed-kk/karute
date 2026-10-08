import type { BookedSpan, CapacityInput, DayHours } from './capacity'
// break-minutes.ts imports only an SDK type: no cycle back into capacity.
import { effectiveBreakMinutes } from './break-minutes'

/** 'inferred' is internal (guess mode); the wire maps it to 'entered' + shiftBasis 'inferred'. */
export type ShiftState = 'entered' | 'partial' | 'none' | 'nobody' | 'solo' | 'off' | 'unavailable' | 'inferred'
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
  /** Guess mode only: one break, a DURATION in minutes, taken off each
   *  inferred person once (resolveBreakMinutes, the per-store setting). */
  breakMinutes: number
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
  // solo claim contradicted by the roster/bookings for this day → no solo fallback row; guess mode covers it
  const solo = soloOwner != null
  // Guess mode (PR-2): no rows and no named solo owner → everyone with an
  // ASSIGNED counted booking that day works the store's hours (minus one
  // break, below). Nobody without a booking is counted (⚖ 10/6); real rows
  // win; a day whose hours describe nothing is never guessed.
  const hours = input.hours
  const guessable = input.laneKind !== 'none' && hours != null && !hours.closed && hours.source !== 'default'
    // The twin of capacity.ts hoursRunForward (a value import from there would cycle).
    && Number.isFinite(hours.openMs) && Number.isFinite(hours.closeMs) && hours.closeMs > hours.openMs
  // S111-4 + S111-8: the guessed roster = people with an assigned booking that
  // starts within the store-day and overlaps the opening hours; a tail from
  // the previous day keeps its booked minutes, never a lane. assignedIds (any
  // span on the JST day) stays the solo-rule input; an out-of-hours booking
  // never earns a lane either.
  const inHoursIds = new Set(guessable && hours
    ? input.spans.filter(s => s.staffId != null && s.startMs >= input.dayStartMs && s.startMs < input.dayEndMs && Math.min(s.endMs, hours.closeMs) > Math.max(s.startMs, hours.openMs)).map(s => s.staffId as string)
    : [])
  const inferred = rows.length === 0 && !solo && guessable && inHoursIds.size > 0
  // Core has no dated removals/deactivations: a past zero-row day at a store
  // that has since shrunk to one person reads as solo (R-A known limit).
  const entered = rows.length > 0 || solo || inferred
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
  const storeHoursRow = (staffId: string, open: DayHours): ShiftRow => ({ staffId, storeId: shift.storeId, date: shift.date, startMs: open.openMs, endMs: open.closeMs, breaks: [], blocks: [] })
  const effectiveRows: readonly ShiftRow[] = inferred && hours
    ? [...inHoursIds].sort().map(id => storeHoursRow(id, hours))
    : rows.length === 0 && soloOwner != null && input.hours
      ? [storeHoursRow(soloOwner, input.hours)]
      : rows
  const ids = new Set([...effectiveRows.map(r => r.staffId), ...booked.keys()])
  if (shift.personId) {
    ids.clear()
    ids.add(shift.personId)
    if (!effectiveRows.some(r => r.staffId === shift.personId) && !booked.has(shift.personId)) return empty('off')
    // S111-7: on a guessed day a person whose bookings all lie outside the
    // opening hours has no lane; her own view shows no figure. Her booked
    // time stays in the booked cell; the all-staff figure is unchanged.
    if (inferred && !inHoursIds.has(shift.personId)) return empty('off')
  }
  const receivable = new Map<string, Interval[]>()
  let onShiftNoBooking = 0
  let partial = false
  for (const id of ids) {
    const intervals = receivableIntervals(id, shift.storeId, shift.date, effectiveRows, input.hours, shift.blocks)
    receivable.set(id, intervals)
    // On a guessed day partial is never set: there are no rows to be partial
    // against; every figure is the guess.
    if (!inferred && !effectiveRows.some(r => r.staffId === id) && booked.has(id) && eligible.some(p => p.id === id)) partial = true
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
  const breakMinutes = inferred && hours ? effectiveBreakMinutes(shift.breakMinutes, minutes([{ startMs: hours.openMs, endMs: hours.closeMs }])) : 0
  const capacityMinutes = [...ids].reduce((n, id) => {
    const own = minutes([...(receivable.get(id) ?? []), ...(booked.get(id) ?? [])])
    // The break is a duration taken once per inferred person, never an
    // interval placed in the day (nobody knows when it is). It floors at the
    // person's booked minutes: never below what is booked, never negative.
    // breakMinutes already arrives bounded below the open minutes
    // (effectiveBreakMinutes, S111-5); the floor stays as the last guard. A person on a guessed day
    // whose bookings all lie outside the opening hours has no row and no
    // receivable time, so this is exactly her booked minutes.
    return n + (inferred ? Math.max(own - breakMinutes, minutes(booked.get(id) ?? [])) : own)
  }, overtime)
  const shiftState: ShiftState = capacityMinutes === 0 ? 'nobody' : partial ? 'partial' : inferred ? 'inferred' : rows.length === 0 && solo ? 'solo' : 'entered'
  return { bookedMinutes, capacityMinutes: capacityMinutes || null, shiftState, onShiftNoBooking, unassignedOverflow, lanes: ids.size }
}
