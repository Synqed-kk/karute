// The ONE week fixture behind the S8 layer matrix and the ALL-OFF snapshot
// proof (PKT-1c-B). Deliberately written so it type-checks BOTH at the base
// SHA (where DayHoursFact has no `source`) and after S1 adds it: the hours
// helper returns an inferred object, never a fresh literal annotated as
// DayHoursFact, so the extra key is not excess-checked at the base.
//
// `saved` is DERIVED from `source` here, exactly as S1's invariant states
// (saved === source !== 'default'), which is what makes the base capture and
// the post-S1 run the same inputs rather than two similar ones.
//
// A SOLO store, Mon 2026-09-14 - Sun 2026-09-20 JST, seven days chosen so each
// arm of the old five-conjunct rule and each arm of the module's precedence
// order is exercised once.

import type { Appointment } from '@synqed-kk/client'
import type { DayHoursFact } from '@/lib/operating-hours'

export const WEEK_START = new Date('2026-09-14T00:00:00+09:00')
export const WEEK_END = new Date('2026-09-20T23:59:59+09:00')
export const TODAY = new Date('2026-09-14T05:00:00+09:00')
/** The week-average denominator the non-defensible days fall back to. */
export const FALLBACK = 480

export const YMD = {
  mon: '2026-09-14',
  tue: '2026-09-15',
  wed: '2026-09-16',
  thu: '2026-09-17',
  fri: '2026-09-18',
  sat: '2026-09-19',
  sun: '2026-09-20',
} as const

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'x',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    store_id: null,
    starts_at: '2026-09-14T01:00:00Z',
    ends_at: '2026-09-14T02:00:00Z',
    duration_minutes: 60,
    occupied_until: null,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

// JST = UTC+9, no DST: 10:00 JST is 01:00Z the same calendar day.
export const APPTS: Appointment[] = [
  // Mon - one ordinary in-hours booking, 10:00-11:00 JST.
  appt({ id: 'mon-1', starts_at: '2026-09-14T01:00:00Z', ends_at: '2026-09-14T02:00:00Z' }),
  // Tue - 21:00-22:00 JST, an hour PAST the 20:00 close. (T1)
  appt({ id: 'tue-1', starts_at: '2026-09-15T12:00:00Z', ends_at: '2026-09-15T13:00:00Z' }),
  // Wed - booked to the minute: 10:00-20:00 JST fills the whole window. (T2)
  appt({
    id: 'wed-1',
    starts_at: '2026-09-16T01:00:00Z',
    ends_at: '2026-09-16T11:00:00Z',
    duration_minutes: 600,
  }),
  // Thu - two rows on ONE staffer that overlap: 10:00-12:00 and 11:00-13:00.
  appt({ id: 'thu-1', starts_at: '2026-09-17T01:00:00Z', ends_at: '2026-09-17T03:00:00Z', duration_minutes: 120 }),
  appt({ id: 'thu-2', starts_at: '2026-09-17T02:00:00Z', ends_at: '2026-09-17T04:00:00Z', duration_minutes: 120 }),
  // Fri - two DIFFERENT staffers, no overlap: 10:00-11:00 and 13:00-14:00.
  appt({ id: 'fri-1', staff_id: 'sA', starts_at: '2026-09-18T01:00:00Z', ends_at: '2026-09-18T02:00:00Z' }),
  appt({ id: 'fri-2', staff_id: 'sB', starts_at: '2026-09-18T04:00:00Z', ends_at: '2026-09-18T05:00:00Z' }),
  // Sat - a booking on a CLOSED day, 10:00-11:00 JST.
  appt({ id: 'sat-1', starts_at: '2026-09-19T01:00:00Z', ends_at: '2026-09-19T02:00:00Z' }),
  // Sun - one in-hours booking on a day whose hours were never saved.
  appt({ id: 'sun-1', starts_at: '2026-09-20T01:00:00Z', ends_at: '2026-09-20T02:00:00Z' }),
]

type HoursSpec = {
  openMinute: number
  closeMinute: number
  source: 'store' | 'org' | 'default'
  closed?: boolean
}

function hoursFact(spec: HoursSpec) {
  // No annotation on purpose - see the header note.
  return {
    minutes: spec.closed ? 0 : Math.max(0, spec.closeMinute - spec.openMinute),
    openMinute: spec.closed ? 0 : spec.openMinute,
    closeMinute: spec.closed ? 0 : spec.closeMinute,
    saved: spec.source !== 'default',
    closed: spec.closed === true,
    source: spec.source,
  }
}

/** 10:00-20:00 on the five trading days, a 定休日 Saturday, an unsaved Sunday. */
export function hoursFacts(): ReadonlyMap<string, DayHoursFact> {
  const facts = new Map<string, DayHoursFact>()
  const open: HoursSpec = { openMinute: 600, closeMinute: 1200, source: 'store' }
  facts.set(YMD.mon, hoursFact(open))
  facts.set(YMD.tue, hoursFact(open))
  facts.set(YMD.wed, hoursFact(open))
  facts.set(YMD.thu, hoursFact(open))
  facts.set(YMD.fri, hoursFact(open))
  facts.set(YMD.sat, hoursFact({ openMinute: 0, closeMinute: 0, source: 'store', closed: true }))
  facts.set(YMD.sun, hoursFact({ openMinute: 600, closeMinute: 1200, source: 'default' }))
  return facts
}

/** The keys that existed on main's WeekDayRowData - the ONLY ones the ALL-OFF
 *  snapshot diff compares. Everything this packet adds is additive and has no
 *  counterpart at the base SHA, so it cannot appear in that diff. */
export const BASE_ROW_KEYS = [
  'dateNumber',
  'monthNumber',
  'weekdayLabel',
  'isToday',
  'count',
  'bookedMinutes',
  'availableMinutes',
  'dateIso',
  'capacityDefensible',
  'hoursSaved',
  'closed',
  'cancelledCount',
  'noShowDayCount',
  'returningCount',
  'newCustomerCount',
  'remindersPending',
  'consentPending',
  'unconfirmed',
  'visibleBookings',
  'hiddenCount',
] as const

export function baseShape(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of BASE_ROW_KEYS) out[k] = row[k]
  return out
}
