// Reserve S66 (DESIGN-BUILD2 §1, §4, §9 R9) — the store's six booking rules as core holds them on its
// per-store row (StoreBookingPolicy): core's ranges, core's defaults, the combination checks and the
// fingerprint a save is based on. The writer (door-reserve-policy.ts) and the screen's limits and 初期値 labels
// all read this one file; nothing here is typed twice. Pure: no SDK, no core call.

/** The six fields Business writes, in the order the screen shows them. */
export const RESERVE_POLICY_FIELDS = [
  'booking_open_days',
  'cutoff_minutes',
  'reserve_start_grid_min',
  'cancel_free_until_hours',
  'cancel_late_pct',
  'no_show_pct',
] as const
export type ReservePolicyField = (typeof RESERVE_POLICY_FIELDS)[number]

/** Core's grid choices (core routes/store-policies.ts:62); null = core unset, Reserve steps by 30. */
export const RESERVE_GRID_CHOICES = [15, 30, 60] as const
export type ReserveGrid = (typeof RESERVE_GRID_CHOICES)[number] | null

export interface ReservePolicy {
  booking_open_days: number
  cutoff_minutes: number
  reserve_start_grid_min: ReserveGrid
  cancel_free_until_hours: number
  cancel_late_pct: number
  no_show_pct: number
}

/** Core's own ranges (core routes/store-policies.ts:68-74), integers only. */
export const RESERVE_POLICY_RANGES = {
  booking_open_days: { min: 1, max: 365 },
  cutoff_minutes: { min: 0, max: 10080 },
  cancel_free_until_hours: { min: 0, max: 720 },
  cancel_late_pct: { min: 0, max: 100 },
  no_show_pct: { min: 0, max: 100 },
} as const satisfies Record<Exclude<ReservePolicyField, 'reserve_start_grid_min'>, { min: number; max: number }>

/** Core's defaults for a store with no saved row (core store-policy.service.ts POLICY_DEFAULTS). */
export const RESERVE_POLICY_DEFAULTS: Readonly<ReservePolicy> = {
  booking_open_days: 30,
  cutoff_minutes: 0,
  reserve_start_grid_min: null,
  cancel_free_until_hours: 24,
  cancel_late_pct: 0,
  no_show_pct: 0,
}

/** The step Reserve uses when the grid is unset (core null). */
export const RESERVE_GRID_UNSET_STEP = 30

/** The six fields of any core row (or row-shaped object), nothing else. */
export function pickReservePolicy(row: ReservePolicy): ReservePolicy {
  return {
    booking_open_days: row.booking_open_days,
    cutoff_minutes: row.cutoff_minutes,
    reserve_start_grid_min: row.reserve_start_grid_min,
    cancel_free_until_hours: row.cancel_free_until_hours,
    cancel_late_pct: row.cancel_late_pct,
    no_show_pct: row.no_show_pct,
  }
}

/** Shape + core's ranges: exactly the six keys, whole numbers inside range, grid one of core's choices.
 *  null = something core would refuse (the screen's own controls can never send it). */
export function parseReservePolicy(draft: unknown): ReservePolicy | null {
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) return null
  const d = draft as Record<string, unknown>
  const keys = Object.keys(d)
  if (keys.length !== RESERVE_POLICY_FIELDS.length || !RESERVE_POLICY_FIELDS.every((k) => keys.includes(k))) return null
  const whole = (k: keyof typeof RESERVE_POLICY_RANGES): number | null => {
    const v = d[k]
    const { min, max } = RESERVE_POLICY_RANGES[k]
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
  }
  const [open, cutoff, free, late, noShow] = [whole('booking_open_days'), whole('cutoff_minutes'), whole('cancel_free_until_hours'), whole('cancel_late_pct'), whole('no_show_pct')]
  const g = d.reserve_start_grid_min
  const grid: ReserveGrid | undefined = g === null ? null : g === 15 || g === 30 || g === 60 ? g : undefined
  if (open === null || cutoff === null || free === null || late === null || noShow === null || grid === undefined) return null
  return { booking_open_days: open, cutoff_minutes: cutoff, reserve_start_grid_min: grid, cancel_free_until_hours: free, cancel_late_pct: late, no_show_pct: noShow }
}

export type ReservePolicyProblem = 'cutoffOverOpen' | 'freeOverOpen'

/** §4 combination checks — refusals, not notes. Bounded by open_days × a day; the furthest bookable
 *  day is open_days + 1 (Reserve storeRules.ts:110, :154), so this bound is the strict side. */
export function reservePolicyProblem(p: ReservePolicy): ReservePolicyProblem | null {
  if (p.cutoff_minutes > p.booking_open_days * 1440) return 'cutoffOverOpen'
  if (p.cancel_free_until_hours > p.booking_open_days * 24) return 'freeOverOpen'
  return null
}

/** §9 R5 — a NOTE, never a refusal: a booking taken after the free deadline is late from the start. */
export function lateFromBooking(p: ReservePolicy): boolean {
  return p.cutoff_minutes < p.cancel_free_until_hours * 60
}

/** §9 R9 — the fingerprint a save is based on: the six values as read, in a fixed order. Six small
 *  integers are already short and exact, so the canonical tuple itself is the fingerprint. */
export function policyHash(p: ReservePolicy): string {
  return RESERVE_POLICY_FIELDS.map((k) => String(p[k])).join('|')
}
