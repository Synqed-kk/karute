// The practice-door id registry (DESIGN-PRACTICE-DOOR.md §4): fixture id ⇄ live
// core uuid, read from the GENERATED map, plus the per-store sample policy.
// "Store sample policy (declared by explicit uuid, never by position or count)" —
// every uuid not named below gets { kind: 'none' }: a lookup, never a throw.

import { STORE_A, STORE_B } from '../fixtures'
import type { BusinessProfileKey } from '../fixtures-settings'
import { PRACTICE_REGISTRY } from './registry.generated'

export type StoreSamplePolicy =
  | { kind: 'twin'; fixtureStoreId: string }
  | { kind: 'named'; business_type: BusinessProfileKey; words: null; dials: null }
  | { kind: 'none' }

export const STORE_SAMPLE_POLICY: Record<string, StoreSamplePolicy> = {
  'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f': { kind: 'twin', fixtureStoreId: STORE_A },
  '8ac43a4b-7763-4a10-9f73-a662085460af': { kind: 'twin', fixtureStoreId: STORE_B },
  '8696b856-11ab-4879-9290-bef40b03ea66': { kind: 'named', business_type: 'esthetic_salon', words: null, dials: null },
}

export function samplePolicyFor(storeUuid: string): StoreSamplePolicy {
  return Object.prototype.hasOwnProperty.call(STORE_SAMPLE_POLICY, storeUuid)
    ? STORE_SAMPLE_POLICY[storeUuid]
    : { kind: 'none' }
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
