// The sample facade (DESIGN-PRACTICE-DOOR.md §4): rewrites a fixture plane's ids
// to their live twins by EXACT match, typed by field — never by substring, regex,
// position or count. Unknown ids and every field not named in FIELD_KIND
// (member_number, duplicate_of, free text) pass through untouched.

import { defaultKindOf } from '../fixtures-today'
import { storeDials, type StoreDials } from '../fixtures-settings'
import type { WordOverride } from '../resource-words'
import { liveIdOf, samplePolicyFor } from './registry'
import { practiceTenant } from './switch'

export type TwinKind = 'stores' | 'staff' | 'menus' | 'customers' | 'appointments'

const FIELD_KIND: Record<string, TwinKind> = {
  store_id: 'stores',
  staff_id: 'staff',
  by_staff_id: 'staff',
  reassigned_from: 'staff',
  owner_staff_id: 'staff',
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
      // A plane never carries these; a core JSON row that does is refused, not merged onto the prototype.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`sample facade: refused key "${key}"`)
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESERVED = ['__proto__', 'constructor', 'prototype']

/** `sampleFor`, then the §4 rule: a row whose store resolves to NO live store
 *  (a fixture store id with no twin — STORE_C) is dropped, never borrowed.
 *  Rows with no store (null/undefined) are kept. */
export function sampleRows<T extends { store_id?: string | null }>(rows: T[], ownKind: TwinKind | null): T[] {
  return sampleFor(rows, ownKind).filter(
    (r) => typeof r.store_id !== 'string' || liveIdOf('stores', r.store_id) !== null || UUID.test(r.store_id),
  )
}

/** A record keyed by fixture id → the same values keyed by the live twin. A key
 *  with no twin is DROPPED: a fixture person with no live twin cannot stand on
 *  a live board. */
export function sampleKeys<V>(kind: TwinKind, record: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [key, value] of Object.entries(record)) {
    if (RESERVED.includes(key)) throw new Error(`sample facade: refused key "${key}"`)
    const live = liveIdOf(kind, key)
    if (live !== null) out[live] = value
  }
  return out
}

export type StoreSample =
  | { state: 'sample'; words: WordOverride | null; dials: StoreDials | null }
  | { state: 'no-sample-policy'; storeId: string; words: null; dials: null }

/** The per-store SAMPLE words + dials the three bypass sites read (today/page,
 *  settings-props, store-policy-props). OFF: exactly the two calls those sites
 *  made — including defaultKindOf's throw on an unknown id (OFF is
 *  byte-identical, not "improved"). ON: by the store's sample policy; a live
 *  uuid never throws. */
export function storeSample(storeId: string): StoreSample {
  if (practiceTenant() === null) return { state: 'sample', words: defaultKindOf(storeId).words, dials: storeDials[storeId] ?? null }
  const policy = samplePolicyFor(storeId)
  if (policy.kind === 'twin') {
    return { state: 'sample', words: defaultKindOf(policy.fixtureStoreId).words, dials: storeDials[policy.fixtureStoreId] ?? null }
  }
  if (policy.kind === 'named') return { state: 'sample', words: null, dials: null }
  return { state: 'no-sample-policy', storeId, words: null, dials: null }
}
