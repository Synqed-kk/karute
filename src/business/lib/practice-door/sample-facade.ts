// The sample facade (DESIGN-PRACTICE-DOOR.md §4): rewrites a fixture plane's ids
// to their live twins by EXACT match, typed by field — never by substring, regex,
// position or count. Unknown ids and every field not named in FIELD_KIND
// (member_number, duplicate_of, free text) pass through untouched.

import { businessStrings } from '@/business/i18n'
import { operator } from '../fixtures'
import { defaultKindOf } from '../fixtures-today'
import { storeDials, type StoreDials } from '../fixtures-settings'
import type { WordOverride } from '../resource-words'
import type { SampleMark } from '../settings'
import { fixtureIdOf, liveIdOf, samplePolicyFor } from './registry'
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
  /** `marked` = the door is ON, so what this plane shows sits beside live rows
   *  and must say it is sample (PR-3's 「サンプル」 mark). OFF it is false on
   *  every call: `state: 'sample'` alone is also the OFF answer, never the signal. */
  | {
      state: 'sample'
      words: WordOverride | null
      dials: StoreDials | null
      marked: boolean
      /** ⚖ PR-3 §v3 V3-4 — this store's planes, one state each (the plane
       *  table below). OFF: every plane `'live'` for marking purposes (no mark
       *  anywhere). `marked === some plane is 'sample'`. */
      planes: Readonly<Record<PlaneKey, PlaneState>>
    }
  | { state: 'no-sample-policy'; storeId: string; words: null; dials: null }

/** ⚖ PR-3 — THE ONE READ of 「is the practice door ON for this store」 off a
 *  `storeSample` answer: `marked`, or the no-sample-policy state (which exists
 *  only under the switch). Never `state === 'sample'` — that is also OFF. */
export const isMarked = (s: StoreSample): boolean => s.state === 'no-sample-policy' || s.marked

/** The per-store SAMPLE words + dials the three bypass sites read (today/page,
 *  settings-props, store-policy-props). OFF: exactly the two calls those sites
 *  made — including defaultKindOf's throw on an unknown id (OFF is
 *  byte-identical, not "improved"). ON: by the store's sample policy; a live
 *  uuid never throws. */
export function storeSample(storeId: string): StoreSample {
  if (practiceTenant() === null) return { state: 'sample', words: defaultKindOf(storeId).words, dials: storeDials[storeId] ?? null, marked: false, planes: ALL_LIVE }
  const policy = samplePolicyFor(storeId)
  if (policy.kind === 'twin') {
    const planes = planesOf(storeId)
    return { state: 'sample', words: defaultKindOf(policy.fixtureStoreId).words, dials: storeDials[policy.fixtureStoreId] ?? null, marked: anySample(planes), planes }
  }
  // `none` is REAL mode's (a practice store always resolves to a twin, V4-2).
  return { state: 'no-sample-policy', storeId, words: null, dials: null }
}

// ── ⚖ PR-3 §v3 V3-4 — THE PLANE TABLE, keyed per store AND per plane ─────────
//
// ONE home for 「is this part of this store still the built-in sample」. A plane
// is one SAMPLE row family of CONTRACT-MAP (the suite pins every key to its
// row by name); a block or a board region names the plane it shows and the
// mark follows the table — no site decides for itself. Today every plane of
// the practice business is `'sample'` (that IS the map's truth); as the test
// world lands a plane live in core, its one line in STORE_PLANE_OVERRIDES
// (per store) — or PRACTICE_PLANES (every store) — flips it and every mark of
// that plane disappears on its own.

export type PlaneKey =
  // 今日の運営 — the board and its events
  | 'operatingHours' | 'shifts' | 'absence' | 'sellSlots' | 'decisions' | 'recoverySteps'
  // 設定 — 店舗運営
  | 'storeProfile' | 'closures' | 'opsConfig' | 'bookingGuard' | 'menuVisible' | 'tickets'
  | 'staffActive' | 'businessType' | 'pay' | 'cashTolerance' | 'winBack' | 'company'
  // 設定 — 料金・ポイント / Karute / Reserve
  | 'dynamicPricing' | 'points' | 'salesTarget' | 'ai' | 'aiProfile' | 'recordingPolicy' | 'voice'
  | 'coaching' | 'sync' | 'bookingPolicy' | 'priceLock' | 'notify'
  // 設定 — 組織・管理
  | 'staffSettings' | 'rolePolicy' | 'connectors' | 'export' | 'auditLog' | 'language'
  | 'bookingColors' | 'colorTokens' | 'billing'

export type PlaneState = 'sample' | 'live'

const PLANE_KEYS: readonly PlaneKey[] = [
  'operatingHours', 'shifts', 'absence', 'sellSlots', 'decisions', 'recoverySteps',
  'storeProfile', 'closures', 'opsConfig', 'bookingGuard', 'menuVisible', 'tickets',
  'staffActive', 'businessType', 'pay', 'cashTolerance', 'winBack', 'company',
  'dynamicPricing', 'points', 'salesTarget', 'ai', 'aiProfile', 'recordingPolicy', 'voice',
  'coaching', 'sync', 'bookingPolicy', 'priceLock', 'notify',
  'staffSettings', 'rolePolicy', 'connectors', 'export', 'auditLog', 'language',
  'bookingColors', 'colorTokens', 'billing',
]
const every = (state: PlaneState) => Object.fromEntries(PLANE_KEYS.map((k) => [k, state])) as Record<PlaneKey, PlaneState>

/** The practice business's planes. Every one is SAMPLE today (CONTRACT-MAP). */
export const PRACTICE_PLANES: Readonly<Record<PlaneKey, PlaneState>> = every('sample')
/** The later one-line flip, per live store × plane — here and nowhere else. */
export const STORE_PLANE_OVERRIDES: Record<string, Partial<Record<PlaneKey, PlaneState>>> = {}
const ALL_LIVE: Readonly<Record<PlaneKey, PlaneState>> = every('live')

/** A store's planes under the door: the practice table, then its overrides. */
export function planesOf(storeId: string): Readonly<Record<PlaneKey, PlaneState>> {
  const own = Object.prototype.hasOwnProperty.call(STORE_PLANE_OVERRIDES, storeId) ? STORE_PLANE_OVERRIDES[storeId] : {}
  return { ...PRACTICE_PLANES, ...own }
}
const anySample = (planes: Readonly<Record<PlaneKey, PlaneState>>) => Object.values(planes).some((s) => s === 'sample')

/** Each plane's CONTRACT-MAP row, by the row's own name — the citation the
 *  table stands on. Every key must name a row the map marks SAMPLE; the two in
 *  `PLANE_MAP_SAYS_LIVE` are rows the map already calls LIVE (a core field
 *  exists) while Business still reads the fixture — sample ON SCREEN until the
 *  read is connected. The lane's harness reads the map itself against this. */
export const PLANE_ROW: Readonly<Record<PlaneKey, string>> = {
  operatingHours: 'operatingHours.open', shifts: 'FixtureShift.staff_id', absence: 'FixtureAbsence.staff_id',
  sellSlots: 'FixtureSellSlot.id', decisions: 'FixtureDecision.id', recoverySteps: 'recoverySteps',
  storeProfile: 'profile.photo', closures: 'closures[].dayOffset', opsConfig: 'opsConfig.bookingStepMin',
  bookingGuard: 'overridePolicy.lockedOut', menuVisible: 'menuVisible[menuId]', tickets: 'tickets[].name',
  staffActive: 'staffActive[staffId]', businessType: 'FixtureStore.business_type', pay: 'payCash',
  cashTolerance: 'cashTolerance', winBack: 'winBackDays', company: 'companyName',
  dynamicPricing: 'dynamicPricing', points: 'pointsEnabled', salesTarget: 'target',
  ai: 'aiSummaryLength', aiProfile: 'businessProfile', recordingPolicy: 'recordingConsentRequired',
  voice: 'voiceStatus', coaching: 'coachingEnabled', sync: 'syncIntervalMin',
  bookingPolicy: 'bookingOpenDays', priceLock: 'priceLockDuringRecalc', notify: 'notify[event].app',
  staffSettings: '.caps', rolePolicy: 'overridePolicy.roles', connectors: 'connectors[id]',
  export: 'exportScopes', auditLog: 'auditLog[].dayOffset', language: 'uiLanguage',
  bookingColors: 'bookingColors[category]', colorTokens: 'colorTokens[token]', billing: 'cardLast4',
}
export const PLANE_MAP_SAYS_LIVE: readonly PlaneKey[] = ['closures', 'bookingPolicy']

const PART = businessStrings.sampleMark.part
/** The words a part-form mark names its planes by (V3-3): the native-pass
 *  labels (`sampleMark.part`), and — where a mixed block's sample field has no
 *  label there — that field's OWN on-screen name, verbatim from the block that
 *  prints it (settings-props.ts; the suite pins each one to its source line).
 *  A plane with no entry here cannot be named in the part form (a type error). */
export const PLANE_LABEL = {
  staffActive: [PART.staffActive],
  staffSettings: [PART.staffSettings],
  operatingHours: [PART.operatingHours],
  shifts: [PART.shiftsAbsence],
  absence: [PART.shiftsAbsence],
  sellSlots: [PART.sellSlots],
  bookingGuard: [PART.bookingGuard],
  // 店舗情報's row titles: 住所 · 電話番号 · 店舗写真 (the store's name is its live row).
  storeProfile: ['住所', '電話番号', '店舗写真'],
  // カテゴリーとメニュー's own fact line: 「いまある内容の表示・非表示はここで切り替えられます。」
  menuVisible: ['表示・非表示'],
  // 回数券の整合 — the rows ARE the store's 回数券 (the 最低価格 beside each is the live menu's).
  tickets: ['回数券'],
} as const satisfies Partial<Record<PlaneKey, readonly string[]>>
export type LabeledPlaneKey = keyof typeof PLANE_LABEL

/** ⚖ PR-3 §v3 — THE ONE READ of a mark. `undefined` (no mark) when the door is
 *  OFF, when no store is in view (a storeless 設定, F-6), or when every named
 *  plane is live in every store in view; a plane counts as sample if it is
 *  sample in ANY store in view (a business-wide board shows several). */
function markOf(storeIds: readonly string[], planes: readonly PlaneKey[]): PlaneKey[] {
  if (practiceTenant() === null || storeIds.length === 0) return []
  const tables = storeIds.map(planesOf)
  return planes.filter((k) => tables.some((t) => t[k] === 'sample'))
}
const inView = (storeIds: string | readonly string[] | null): readonly string[] =>
  storeIds === null ? [] : typeof storeIds === 'string' ? [storeIds] : storeIds

/** Whole form: every value the region shows comes from these planes. */
export function sampleWhole(storeIds: string | readonly string[] | null, ...planes: [PlaneKey, ...PlaneKey[]]): SampleMark | undefined {
  return markOf(inView(storeIds), planes).length > 0 ? { form: 'whole' } : undefined
}

/** Part form: live rows + these sample planes; names only the planes still sample. */
export function samplePart(storeIds: string | readonly string[] | null, ...planes: [LabeledPlaneKey, ...LabeledPlaneKey[]]): SampleMark | undefined {
  const still = markOf(inView(storeIds), planes) as LabeledPlaneKey[]
  const labels = [...new Set(still.flatMap((k): readonly string[] => PLANE_LABEL[k]))]
  return labels.length > 0 ? { form: 'part', labels } : undefined
}

/** ⚖ PR-3 §v4 V4-3 — who the sample history credits (「最終変更: {name}・…」):
 *  the fixture plane's own operator, the person its 監査ログ names — never the
 *  real signed-in person, whose name would sign invented changes. OFF this is
 *  the name the door's OFF operator already carries (the same fixture row). */
export const historyOperatorName = (): string => operator.name

/** The REVERSE of `sampleFor` — the one place a LIVE id is turned into its
 *  FIXTURE twin, used only to attach a SAMPLE plane's rows to a live row: the
 *  admitted person (their takes, their カルテ scope), and 設定's store, roster
 *  and menus (PR-2b). OFF: the id is already a fixture id
 *  and passes through unchanged. ON: the twin, or null when there is none — no
 *  twin, no sample attached (honest), never a borrowed person. */
export function sampleSelfId(kind: TwinKind, liveId: string | null): string | null {
  if (practiceTenant() === null) return liveId
  return liveId === null ? null : fixtureIdOf(kind, liveId)
}

/** The switch-aware door for a room's OWN sample plane (DESIGN §0/§4): OFF the
 *  plane itself, same reference — byte-identical; ON `sampleFor` rewrites its
 *  typed ids to the live twins, so the plane joins the LIVE rows it sits beside.
 *  `sampleFor` stays the pure rewrite the door itself uses. */
export function attachSample<T>(plane: T, ownKind: TwinKind | null): T {
  return practiceTenant() === null ? plane : sampleFor(plane, ownKind)
}
