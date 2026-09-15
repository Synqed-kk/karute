/**
 * ⚖ R1-1 — ONE place that builds a fixture row's capacity fields.
 *
 * Since the metric menu reads the capacity MODEL's own numbers (`occupancyPct`,
 * `full`, `freeMinutes`) instead of dividing `bookedMinutes` by
 * `availableMinutes`, a fixture that sets only `capacityDefensible` describes a
 * day with no capacity at all. Every 予約-surface test therefore builds its
 * capacity-present rows here, deriving them exactly the way
 * `capacityForDay` does (src/lib/capacity/capacity.ts rule 7) — so no test can
 * pin a percentage the model would never emit, and the derivation lives in one
 * file rather than being re-typed in six.
 */
import type { WeekDayRowData } from '@/lib/adapters/reservation'

/** The capacity fields for a day whose capacity is `capacityMinutes` and whose
 *  booked time INSIDE the declared hours is `windowMinutes` — the only minutes
 *  the module divides.
 *
 *  `windowMinutes` is clipped to the capacity because the module's own window
 *  is: minutes are clipped to [open, close) and a day running more lanes than
 *  it has is withdrawn by the concurrency guard, so Σ inside-minutes can never
 *  exceed lanes × laneMinutes. A > 100 % row is not a state the wire carries. */
export function capacityOf(
  capacityMinutes: number,
  windowMinutes: number,
): Partial<WeekDayRowData> {
  // The module never emits a zero capacity — 'no-lanes' withdraws first.
  if (!(capacityMinutes > 0)) return {}
  const window = Math.min(Math.max(0, windowMinutes), capacityMinutes)
  const full = capacityMinutes - window < 0.5
  const occupancyPct = full ? 100 : Math.min(99, Math.round((window / capacityMinutes) * 100))
  return {
    capacityMinutes,
    lanes: 1,
    laneKind: 'staff',
    hoursSource: 'store',
    occupancyPct,
    full,
    band: occupancyPct < 35 ? 'light' : occupancyPct <= 65 ? 'medium' : 'busy',
    freeMinutes: Math.round(capacityMinutes - window),
    capacityReason: null,
  }
}

/** Every key the capacity model owns. A case that names one of them is
 *  describing a wire row itself — R1-1's whole point is that the rendered
 *  numbers come from these and not from a division — so the derivation below
 *  stands aside for it. */
export const CAPACITY_KEYS = [
  'capacityMinutes',
  'lanes',
  'laneKind',
  'hoursSource',
  'occupancyPct',
  'full',
  'band',
  'freeMinutes',
  'capacityReason',
] as const

/** `base` plus the capacity fields the adapter would have carried for its own
 *  denominator — unless the case said it has no capacity, or named a capacity
 *  field itself. */
export function withDerivedCapacity(
  base: WeekDayRowData,
  over: Partial<WeekDayRowData> = {},
): WeekDayRowData {
  if (!base.capacityDefensible || CAPACITY_KEYS.some((k) => k in over)) return base
  return { ...base, ...capacityOf(base.availableMinutes, base.bookedMinutes) }
}
