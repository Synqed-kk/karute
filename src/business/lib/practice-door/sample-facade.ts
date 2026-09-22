// The sample facade (DESIGN-PRACTICE-DOOR.md §4): rewrites a fixture plane's ids
// to their live twins by EXACT match, typed by field — never by substring, regex,
// position or count. Unknown ids and every field not named in FIELD_KIND
// (member_number, duplicate_of, free text) pass through untouched.

import { liveIdOf } from './registry'

export type TwinKind = 'stores' | 'staff' | 'menus' | 'customers' | 'appointments'

const FIELD_KIND: Record<string, TwinKind> = {
  store_id: 'stores',
  staff_id: 'staff',
  by_staff_id: 'staff',
  reassigned_from: 'staff',
  menu_id: 'menus',
  customer_id: 'customers',
  appointment_id: 'appointments',
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))

/** A new plane with ids rewritten; the input is never mutated. `id` is rewritten
 *  as `ownKind` wherever it appears, when `ownKind` is given. */
export function sampleFor<T>(plane: T, ownKind: TwinKind | null): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (!isPlain(v)) return v
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(v)) {
      const kind = Object.prototype.hasOwnProperty.call(FIELD_KIND, key)
        ? FIELD_KIND[key]
        : key === 'id'
          ? ownKind
          : null
      out[key] = typeof value === 'string' && kind ? (liveIdOf(kind, value) ?? value) : walk(value)
    }
    return out
  }
  return walk(plane) as T
}

export const NO_SAMPLE_POLICY = (storeId: string) => ({ state: 'no-sample-policy' as const, storeId })
