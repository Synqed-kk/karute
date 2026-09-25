// The practice-door id registry (DESIGN-PRACTICE-DOOR.md §4): fixture id ⇄ live
// core uuid, read from the GENERATED map, plus the per-store sample policy.
// "Store sample policy (declared by explicit uuid, never by position or count)".
//
// ⚖ PR-3 §v4 V4-2 (Liam 9/25: PRACTICE MODE = EVERYTHING FILLED IN) — every
// practice store resolves to a fixture plane WITH dials: no store is empty, no
// store shows a card. ONE policy form: the plane is always a fixture store's
// (`fixtureStoreId`: its dials + words), and `business_type` — when present —
// is the store's own 業種, kept while it borrows the plane. A store not named
// below takes STORE_A's plane (this resolver is reached only under the door).

import { STORE_A, STORE_B } from '../fixtures'
import type { BusinessProfileKey } from '../fixtures-settings'
import { PRACTICE_REGISTRY } from './registry.generated'

export type StoreSamplePolicy =
  | { kind: 'twin'; fixtureStoreId: string; business_type?: BusinessProfileKey }
  /** REAL mode only (a real business, a plane core does not serve yet → 準備中):
   *  never answered for a practice store. No real-mode resolver is built yet. */
  | { kind: 'none' }

// Full uuids: the practice business's seven stores (BASELINE-DEV-SALON.json,
// 2026-09-24T14:59Z). STORE_C (テスト渋谷店) has no dials, so no store points at it.
export const STORE_SAMPLE_POLICY: Record<string, StoreSamplePolicy> = {
  // テスト東京店 · テスト横浜店 — the exact twins.
  'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f': { kind: 'twin', fixtureStoreId: STORE_A },
  '8ac43a4b-7763-4a10-9f73-a662085460af': { kind: 'twin', fixtureStoreId: STORE_B },
  // La Estro Test Store — keeps its 業種, borrows 東京's plane.
  '8696b856-11ab-4879-9290-bef40b03ea66': { kind: 'twin', fixtureStoreId: STORE_A, business_type: 'esthetic_salon' },
  // Dev Salon · Dev 銀座.
  '5a171878-4faa-4512-ba07-17ca4e20ab9e': { kind: 'twin', fixtureStoreId: STORE_A },
  'a1a26517-33c0-4e73-9ea2-e56e98d99c6f': { kind: 'twin', fixtureStoreId: STORE_A },
  // テスト恵比寿ジム · テスト自由が丘店 — their own 業種 on 東京's plane.
  'c33e4c43-bc3b-4470-ac22-aa60fecdabe3': { kind: 'twin', fixtureStoreId: STORE_A, business_type: 'personal_gym' },
  '0e8fd5dd-8da6-48c4-9ad2-2ab305aa907c': { kind: 'twin', fixtureStoreId: STORE_A, business_type: 'hair_salon' },
}

/** The fallback plane for a practice store the table does not name (⚠2: never `none`). */
export const FALLBACK_POLICY: StoreSamplePolicy = { kind: 'twin', fixtureStoreId: STORE_A }

export function samplePolicyFor(storeUuid: string): StoreSamplePolicy {
  return Object.prototype.hasOwnProperty.call(STORE_SAMPLE_POLICY, storeUuid)
    ? STORE_SAMPLE_POLICY[storeUuid]
    : FALLBACK_POLICY
}

type Kind = keyof typeof PRACTICE_REGISTRY.twins
const KINDS = Object.keys(PRACTICE_REGISTRY.twins) as Kind[]

// Built once. Maps, not object lookups, so a key like 'toString' is never a hit.
const FORWARD = new Map(KINDS.map((k) => [k, new Map<string, string>(Object.entries(PRACTICE_REGISTRY.twins[k]))]))
const INVERSE = new Map(KINDS.map((k) => [k, new Map<string, string>(Object.entries(PRACTICE_REGISTRY.twins[k]).map(([f, u]) => [u, f]))]))

export function liveIdOf(kind: Kind, fixtureId: string): string | null {
  return FORWARD.get(kind)?.get(fixtureId) ?? null
}

export function fixtureIdOf(kind: Kind, uuid: string): string | null {
  return INVERSE.get(kind)?.get(uuid) ?? null
}
