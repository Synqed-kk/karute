// お店ページ — the 16-switch model + the CORE-47 wire codec (pure; no UI, no I/O).
// Record shape = DECISIONS-S49 R86 + DECISIONS-S51 R121: internal CapKeys are lowercase; the WIRE (serializeRecord /
// parseRecord) is CORE-47's owner record with UPPER-case snake keys (CHECKIN_QR …). `business_type` = the Karute type
// key (one of the 26, BUSINESS_TYPE_KEYS; R140/R142, S52 B5); the five families are an INTERNAL grouping only (R143).
// Until CORE-47 the record lives in
// core org settings under ONE FLAT KEY PER STORE (core's PUT /v1/org-settings is a shallow merge — a nested map of
// stores would let one store's save overwrite another's).
import { CHIP, HONEST, REG, type CapKey, type CapRow, type Family, type NeedKey } from './copy'

export type { CapKey, Family, NeedKey } from './copy'

export const STORE_CAPABILITIES_KEY_PREFIX = 'reserve_store_capabilities:'
export const storeCapabilitiesKeyFor = (storeId: string): string => `${STORE_CAPABILITIES_KEY_PREFIX}${storeId}`

export const CAP_KEYS: readonly CapKey[] = REG.map((r) => r.key)
export const FAMILIES: readonly Family[] = ['SALON', 'GYM', 'CLINIC', 'RETAIL', 'GENERIC']

/** Karute's 26 business-type keys, in businessProfiles order (src/business/lib/fixtures-settings.ts:498-525, R142).
 *  Pinned here as literals; the test twins them against businessProfiles so the two can never drift. */
const TYPE_KEY_LIST = Object.freeze([
  'esthetic_salon', 'hair_salon', 'nail_salon', 'eyelash_salon', 'massage', 'chiropractic', 'beauty_chiropractic',
  'acupuncture', 'osteopathy', 'yoga_studio', 'pilates_studio', 'personal_gym', 'dental_clinic', 'medical_clinic',
  'dermatology', 'cosmetic_surgery', 'physical_therapy', 'foot_care', 'relaxation', 'aroma', 'wellness_clinic',
  'mental_health', 'veterinary', 'pet_grooming', 'training_school', 'other',
] as const)
export type BusinessTypeKey = (typeof TYPE_KEY_LIST)[number]
export const BUSINESS_TYPE_KEYS: readonly BusinessTypeKey[] = TYPE_KEY_LIST
const TYPE_KEY_SET: ReadonlySet<string> = new Set(TYPE_KEY_LIST)
const isTypeKey = (raw: unknown): raw is BusinessTypeKey => typeof raw === 'string' && TYPE_KEY_SET.has(raw)
/** R145: a known type key maps to itself; null, '', a legacy family name (SALON …) or anything else → 'other'. */
export const typeKeyOf = (raw: unknown): BusinessTypeKey => (isTypeKey(raw) ? raw : 'other')

export type Source = 'TYPE_DEFAULT' | 'OWNER'
export interface SwitchState {
  readonly on: boolean
  readonly source: Source
  readonly changed_at?: string
  readonly changed_by?: string
}
export interface CapRecord {
  readonly v: 1
  readonly business_type: BusinessTypeKey
  readonly switches: Readonly<Record<CapKey, SwitchState>>
}
/** A count the page could not read is UNKNOWN (undefined), never 0 (R92 / R101). */
export type Counts = Readonly<Partial<Record<NeedKey, number | undefined>>>

const rowOf = (key: CapKey): CapRow => REG.find((r) => r.key === key) as CapRow

/** The keys each of the 26 types turns ON; every other key is OFF. The ONE truth is L53/TYPE-SETS-S53.md
 *  (R140 RULED, R143); every set obeys the parent rule (a sub only with its parent). Frozen arrays (attack S53
 *  NIT 5): the model reads THESE, so nothing a caller does at runtime can change a default. */
const setOf = (...keys: CapKey[]): readonly CapKey[] => Object.freeze(keys)
const TYPE_ON: Readonly<Record<BusinessTypeKey, readonly CapKey[]>> = Object.freeze({
  esthetic_salon: setOf('checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake', 'shop'),
  hair_salon: setOf('checkin_qr', 'homecare', 'photo_proof', 'posts', 'read_points', 'shop', 'intake'),
  nail_salon: setOf('checkin_qr', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'),
  eyelash_salon: setOf('checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'),
  massage: setOf('checkin_qr', 'packs', 'homecare', 'posts', 'read_points', 'intake'),
  beauty_chiropractic: setOf('checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'),
  foot_care: setOf('checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'),
  relaxation: setOf('checkin_qr', 'packs', 'posts', 'read_points', 'intake'),
  aroma: setOf('checkin_qr', 'packs', 'homecare', 'posts', 'read_points', 'intake', 'shop'),
  pet_grooming: setOf('checkin_qr', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'),
  yoga_studio: setOf('checkin_qr', 'packs', 'classes', 'waitlist', 'homecare', 'posts', 'read_points', 'reactions', 'rental'),
  pilates_studio: setOf('checkin_qr', 'packs', 'classes', 'waitlist', 'homecare', 'photo_proof', 'posts', 'read_points', 'reactions', 'rental'),
  personal_gym: setOf('checkin_qr', 'packs', 'homecare', 'photo_proof', 'video_proof', 'posts', 'read_points', 'reactions', 'shop'),
  training_school: setOf('checkin_qr', 'packs', 'classes', 'waitlist', 'homecare', 'posts', 'read_points', 'reactions'),
  chiropractic: setOf('checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'posts', 'read_points'),
  acupuncture: setOf('checkin_qr', 'packs', 'intake', 'homecare', 'posts'),
  osteopathy: setOf('checkin_qr', 'intake', 'homecare', 'photo_proof', 'posts'),
  dental_clinic: setOf('checkin_qr', 'intake', 'homecare', 'posts'),
  medical_clinic: setOf('checkin_qr', 'intake', 'posts'),
  dermatology: setOf('checkin_qr', 'intake', 'homecare', 'photo_proof', 'posts', 'shop'),
  cosmetic_surgery: setOf('checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'posts', 'read_points', 'shop'),
  physical_therapy: setOf('checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'video_proof', 'posts'),
  wellness_clinic: setOf('checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'posts', 'read_points', 'shop'),
  mental_health: setOf('checkin_qr', 'packs', 'intake', 'homecare', 'posts'),
  veterinary: setOf('checkin_qr', 'intake', 'homecare', 'posts', 'read_points', 'shop'),
  other: setOf('checkin_qr'),
})
/** The public view of the same sets: a frozen record of ReadonlySets built once from the frozen arrays above. A Set
 *  cannot be frozen at runtime, so the model never reads these — defaultOn reads the frozen array. */
const publicSets = (): Record<BusinessTypeKey, ReadonlySet<CapKey>> => {
  const out = {} as Record<BusinessTypeKey, ReadonlySet<CapKey>>
  for (const t of TYPE_KEY_LIST) out[t] = new Set<CapKey>(TYPE_ON[t])
  return out
}
export const TYPE_DEFAULTS: Readonly<Record<BusinessTypeKey, ReadonlySet<CapKey>>> = Object.freeze(publicSets())
const defaultOn = (typeKey: BusinessTypeKey, k: CapKey): boolean => TYPE_ON[typeKey].includes(k)

const build = (typeKey: BusinessTypeKey, state: (k: CapKey) => SwitchState): CapRecord => ({
  v: 1,
  business_type: typeKey,
  switches: Object.fromEntries(CAP_KEYS.map((k) => [k, state(k)])) as Record<CapKey, SwitchState>,
})

/** A store with no record yet: every switch at the type's default, source TYPE_DEFAULT. R155: the type is read
 *  through typeKeyOf here too (unknown / empty / junk → 'other', never a throw), as resetDiff, applyReset and stampSave do. */
export const seedRecord = (typeKey: BusinessTypeKey): CapRecord => {
  const t = typeKeyOf(typeKey)
  return build(t, (k) => ({ on: defaultOn(t, k), source: 'TYPE_DEFAULT' }))
}

// The INTERNAL grouping of the 26 types into families (R143, ruled). None maps to RETAIL.
const FAMILY_OF: Readonly<Record<BusinessTypeKey, Family>> = {
  esthetic_salon: 'SALON', hair_salon: 'SALON', nail_salon: 'SALON', eyelash_salon: 'SALON', massage: 'SALON',
  beauty_chiropractic: 'SALON', foot_care: 'SALON', relaxation: 'SALON', aroma: 'SALON', pet_grooming: 'SALON',
  yoga_studio: 'GYM', pilates_studio: 'GYM', personal_gym: 'GYM', training_school: 'GYM',
  chiropractic: 'CLINIC', acupuncture: 'CLINIC', osteopathy: 'CLINIC', dental_clinic: 'CLINIC',
  medical_clinic: 'CLINIC', dermatology: 'CLINIC', cosmetic_surgery: 'CLINIC', physical_therapy: 'CLINIC',
  wellness_clinic: 'CLINIC', mental_health: 'CLINIC', veterinary: 'CLINIC',
  other: 'GENERIC',
}
/** The internal family of a type; anything typeKeyOf maps to 'other' → GENERIC. */
export const familyOf = (typeKey: unknown): Family => FAMILY_OF[typeKeyOf(typeKey)]

const isOn = (rec: CapRecord, k: CapKey): boolean => rec.switches[k].on
/** Attack S52-1: the ONE reader of a count. Anything but a finite number >= 0 (null from a failed Supabase count,
 *  NaN, a negative, a string, Infinity) is UNKNOWN — every count reader below goes through here. R92 / R101: an
 *  UNKNOWN count is not 0 — no 準備が必要 or number claim, the OFF ask fires, ready() is false. Practice mode never
 *  meets it (R91 fills every Dev Salon store). */
const countOf = (counts: Counts, need: NeedKey): number | undefined => {
  const n: unknown = counts[need]
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/** mock ready() :1564-1569 — ON and (no count needed, or its count is known and > 0). Subs answer by their own switch. */
export function ready(key: CapKey, rec: CapRecord, counts: Counts): boolean {
  const need = rowOf(key).need
  return isOn(rec, key) && (!need || (countOf(counts, need) ?? 0) > 0)
}
/** mock pending() — ON and the count it needs is KNOWN to be 0 (an unknown count is not pending). */
export function pending(key: CapKey, rec: CapRecord, counts: Counts): boolean {
  const need = rowOf(key).need
  return !!need && isOn(rec, key) && countOf(counts, need) === 0
}

export type ChipState = 'off' | 'need' | 'on'
/** statusChip (:1637-1645); sub rows carry no chip → null. WAITLIST copies the mock (E3, D-PHONE): ON = 'on';
 *  honestLines explains when nothing is on screen. An ON row whose count is UNKNOWN → null (R101: no chip claims
 *  準備が必要, a number, or お客様に表示中 while ready() is false). */
export function chipState(key: CapKey, rec: CapRecord, counts: Counts): ChipState | null {
  const r = rowOf(key)
  if (r.parent) return null
  if (!isOn(rec, key)) return 'off'
  if (r.need && countOf(counts, r.need) === undefined) return null
  return pending(key, rec, counts) ? 'need' : 'on'
}
export function chipText(key: CapKey, rec: CapRecord, counts: Counts): string | null {
  const s = chipState(key, rec, counts)
  return s === null ? null : s === 'need' ? CHIP.need(rowOf(key).needJa as string) : CHIP[s]
}

/** Spec D2: only a row with an off sentence AND a live count asks before turning OFF; turning ON never asks.
 *  An UNKNOWN count asks (R92, safe side). */
export const asksBeforeOff = (key: CapKey, rec: CapRecord, counts: Counts): boolean => {
  const r = rowOf(key)
  if (!isOn(rec, key) || !r.off || !r.need) return false
  const n = countOf(counts, r.need)
  return n === undefined || n > 0
}

/** Spec D12 (this section's part): switch keys whose on differs + 1 when the 業種 differs. */
export const changeCount = (draft: CapRecord, saved: CapRecord): number =>
  CAP_KEYS.filter((k) => draft.switches[k].on !== saved.switches[k].on).length +
  (draft.business_type === saved.business_type ? 0 : 1)

export interface ResetDiff {
  readonly flips: readonly { key: CapKey; from: boolean; to: boolean }[]
  readonly keeps: readonly CapKey[]
  readonly none: boolean
}
/** 戻す's preview (D-RESET): OWNER keys are kept. A TYPE_DEFAULT key flips when its DRAFT value (unsaved flips
 *  included) differs from the default of the draft's own business_type (R144 — no separate type argument; R155 —
 *  read through typeKeyOf, so a junk type resets to 'other'). */
export function resetDiff(draft: CapRecord): ResetDiff {
  const flips: { key: CapKey; from: boolean; to: boolean }[] = []
  const keeps: CapKey[] = []
  const t = typeKeyOf(draft.business_type)
  for (const k of CAP_KEYS) {
    const s = draft.switches[k]
    const want = defaultOn(t, k)
    if (s.source === 'OWNER') keeps.push(k)
    else if (s.on !== want) flips.push({ key: k, from: s.on, to: want })
  }
  return { flips, keeps, none: flips.length === 0 }
}
/** 戻す (D-RESET): flips the TYPE_DEFAULT keys only; they keep source TYPE_DEFAULT. The 業種 itself is untouched.
 *  R134 / R144: the target type is the record's OWN business_type — never a separate argument — so a reset can never
 *  aim at a type the record (and stampSave, which reads the same field) does not carry. Set business_type first
 *  (the type pick, D7), then reset. */
export function applyReset(record: CapRecord): CapRecord {
  const to = new Map(resetDiff(record).flips.map((f) => [f.key, f.to]))
  return build(typeKeyOf(record.business_type), (k) => (to.has(k) ? { on: to.get(k) as boolean, source: 'TYPE_DEFAULT' } : record.switches[k]))
}

/** What a successful save writes (R89 — the SERVER alone decides source; the draft's source/changed_at/changed_by
 *  are ignored). Unchanged keys keep their saved stamps exactly. A changed key stays TYPE_DEFAULT only when its SAVED
 *  source is TYPE_DEFAULT, the client lists it in resetKeys (keys 戻す flipped since the last save), and its new value
 *  equals the draft type's default; every other changed key becomes OWNER + changed_at + changed_by. An OWNER key
 *  never returns to TYPE_DEFAULT. Call only with what core accepted (D-SAVE). */
export function stampSave(
  saved: CapRecord, draft: CapRecord, resetKeys: readonly CapKey[], now: Date, actingStaffId: string,
): CapRecord {
  const at = now.toISOString()
  const t = typeKeyOf(draft.business_type) // R155: a junk type stamps as 'other' and the record it returns says so
  return build(t, (k) => {
    const on = draft.switches[k].on
    const was = saved.switches[k]
    if (on === was.on) return was
    if (was.source === 'TYPE_DEFAULT' && resetKeys.includes(k) && on === defaultOn(t, k)) return { on, source: 'TYPE_DEFAULT' }
    return { on, source: 'OWNER', changed_at: at, changed_by: actingStaffId }
  })
}

/** renderHonest (:1947-1958): one line per pending parent row, then the WAITLIST line. R108: the WAITLIST line
 *  asserts 「no full lesson」, so it never shows while the classes count is UNKNOWN (R101: no claim from unknown data). */
export function honestLines(rec: CapRecord, counts: Counts): string[] {
  const out = REG.filter((r) => pending(r.key, rec, counts)).map((r) => HONEST.pending(r.ja, r.needJa as string))
  const classesKnown = countOf(counts, 'classes') !== undefined
  if (classesKnown && isOn(rec, 'waitlist') && !ready('classes', rec, counts)) out.push(HONEST.waitlist)
  return out
}

/** What Reserve may show: ON keys in registry order, a sub only while its parent is ON (CORE-47 public GET). */
export const publicProjection = (storeId: string, rec: CapRecord): { store_id: string; on: CapKey[] } => ({
  store_id: storeId,
  on: CAP_KEYS.filter((k) => {
    const parent = rowOf(k).parent
    return isOn(rec, k) && (!parent || isOn(rec, parent))
  }),
})

const plainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** R121 — the WIRE key of an internal key: CORE-47's owner-record spelling = the internal key upper-cased. */
export type WireKey = Uppercase<CapKey>
export const wireKeyOf = (key: CapKey): WireKey => key.toUpperCase() as WireKey
const INTERNAL_OF: ReadonlyMap<string, CapKey> = new Map(CAP_KEYS.map((k) => [wireKeyOf(k), k]))
/** The inverse: a known UPPER wire key → its internal key; anything else (the old lowercase spelling included) → null. */
export const internalKeyOf = (wireKey: string): CapKey | null => INTERNAL_OF.get(wireKey) ?? null

/** One switch on the wire (CORE-47 owner record): the internal `changed_by` travels as `changed_by_staff_id`. */
export interface WireSwitch {
  readonly on: boolean
  readonly source: Source
  readonly changed_at?: string
  readonly changed_by_staff_id?: string
}
/** The stored value (R121): `v` and `business_type` (the Karute type key, S52 B5) are Business-owned extras; `switches` = CORE-47's owner record. */
export interface WireRecord {
  readonly v: 1
  readonly business_type: BusinessTypeKey
  readonly switches: Readonly<Record<WireKey, WireSwitch>>
}

/** Attack S52-5: length caps on the free-text stamps, counted in UTF-16 code units (String.length — an emoji is
 *  2), not characters. Over a cap = a malformed switch = the whole record absent (defensive-parse rule), so
 *  recordHash never walks an oversized string. */
const MAX_CHANGED_AT = 64
const MAX_CHANGED_BY = 128
function parseSwitch(v: unknown): SwitchState | null {
  if (!plainObject(v) || typeof v.on !== 'boolean') return null
  if (v.source !== 'TYPE_DEFAULT' && v.source !== 'OWNER') return null
  if (v.changed_at !== undefined && (typeof v.changed_at !== 'string' || v.changed_at.length > MAX_CHANGED_AT)) return null
  const by = v.changed_by_staff_id
  if (by !== undefined && (typeof by !== 'string' || by.length > MAX_CHANGED_BY)) return null
  return {
    on: v.on,
    source: v.source,
    ...(v.changed_at !== undefined ? { changed_at: v.changed_at as string } : {}),
    ...(by !== undefined ? { changed_by: by as string } : {}),
  }
}
const toWire = (s: SwitchState): WireSwitch => ({
  on: s.on,
  source: s.source,
  ...(s.changed_at !== undefined ? { changed_at: s.changed_at } : {}),
  ...(s.changed_by !== undefined ? { changed_by_staff_id: s.changed_by } : {}),
})
/** Defensive read (core does no schema check): switch keys are read through internalKeyOf — unknown keys (the old
 *  lowercase spelling included) and the old `changed_by` field are ignored; a known key that is missing = OFF /
 *  TYPE_DEFAULT; NO known key at all = absent (R124); any wrong type on a known switch = absent (null); a business_type
 *  outside the 26 type keys (a legacy family name such as 'SALON' included, S52 B10) = absent. */
export function parseRecord(raw: unknown): CapRecord | null {
  if (!plainObject(raw) || raw.v !== 1 || !isTypeKey(raw.business_type)) return null
  const sw = raw.switches
  if (!plainObject(sw)) return null
  const read: Partial<Record<CapKey, SwitchState>> = {}
  for (const [wk, v] of Object.entries(sw)) {
    const k = internalKeyOf(wk)
    if (k === null) continue
    const s = parseSwitch(v)
    if (!s) return null
    read[k] = s
  }
  if (Object.keys(read).length === 0) return null
  return build(raw.business_type, (k) => read[k] ?? { on: false, source: 'TYPE_DEFAULT' })
}
/** The wire value written under storeCapabilitiesKeyFor(storeId): all 16 UPPER keys, registry order (R121). */
export const serializeRecord = (rec: CapRecord): WireRecord => ({
  v: 1,
  business_type: rec.business_type,
  switches: Object.fromEntries(CAP_KEYS.map((k) => [wireKeyOf(k), toWire(rec.switches[k])])) as Record<WireKey, WireSwitch>,
})

const canonical = (v: unknown): string =>
  plainObject(v)
    ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
    : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : JSON.stringify(v)
/** R96 / R102: a pure, synchronous fingerprint of the saved record the page loaded (the save's `based_on`) —
 *  canonical sorted-key JSON of serializeRecord through cyrb53 (fixed, non-crypto; identical in node and the
 *  browser). null → the fixed hash of `null`. Staleness detection only, never security. */
export function recordHash(record: CapRecord | null): string {
  const text = record === null ? 'null' : canonical(serializeRecord(record))
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}
