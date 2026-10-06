// お店ページ — PRACTICE FIXTURE (⚖ DECISIONS-S49 R91 / D-COUNTS): the 「準備が必要」 counts of a Dev Salon store
// while the practice door is ON. Business reads none of these at source yet, so every Dev Salon store carries the
// approved mock's sample set for its family (MOCK-SWITCHBOARD-v2.html STORES): GYM → STUDIO FORCE 渋谷 (:979),
// every other family → La Estro 代官山院 (:938). Never used with the door OFF or for a real business (real mode
// is DISCONNECTED: no counts at all, every count unknown — R92/R101). The input is the record's `business_type`
// (one of the 26 type keys, R142); its family comes from P1's own familyOf (R143), never a second map.
import type { NeedKey } from './copy'
import { familyOf, type BusinessTypeKey, type Counts } from './model'
import type { STORES } from '../reserve-card/store-page-sample'

type NeedCounts = Readonly<Record<NeedKey, number>>

/** mock :938 — La Estro 代官山院 (SALON). */
const LA_ESTRO: NeedCounts = { packs: 3, classes: 0, care: 2, posts: 4, questions: 3, products: 3, resources: 0 }
/** mock :979 — STUDIO FORCE 渋谷 (GYM). */
const STUDIO_FORCE: NeedCounts = { packs: 0, classes: 12, care: 1, posts: 2, questions: 0, products: 0, resources: 24 }

/** R189 — the key of the sample store (store-page-sample.ts STORES) a set of counts was computed for. */
export type SampleKey = keyof typeof STORES

/** R189 — the ONE place the sample is named: the counts AND the sample they are, from one type key. The rule is
 *  the one ReserveCardLookSection.tsx's storeViewInputs held (R171: GYM family → STUDIO FORCE `force`, every other
 *  family → La Estro `laestro`), moved here unchanged. */
export const practiceSample = (businessType: BusinessTypeKey): { sampleKey: SampleKey; counts: Counts } =>
  familyOf(businessType) === 'GYM' ? { sampleKey: 'force', counts: { ...STUDIO_FORCE } } : { sampleKey: 'laestro', counts: { ...LA_ESTRO } }

/** The shared shape's counts (R111: P1's own `Counts`, keyed by NeedKey; a key missing = unknown). */
export const practiceCounts = (businessType: BusinessTypeKey): Counts => practiceSample(businessType).counts
