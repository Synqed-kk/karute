// The sample facade (DESIGN-PRACTICE-DOOR.md §4): rewrites a fixture plane's ids
// to their live twins by EXACT match, typed by field — never by substring, regex,
// position or count. Unknown ids and every field not named in FIELD_KIND
// (member_number, duplicate_of, free text) pass through untouched.

import { businessStrings } from '@/business/i18n'
import { operator, staff } from '../fixtures'
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

// ── ⚖ PR-4a §v7 V7-3 — A BORROWING STORE IS SERVED ITS BORROWED ROWS ──────────
//
// …exactly as an exact twin is served its own: store rows re-keyed to the
// borrower, person fields re-keyed onto the borrower's OWN active roster by
// position — the fixture persons in their declaration order (fixtures.ts
// `staff`) onto the roster in the door's stable order (door.ts
// `rosterOrderOf`). THE ONE HOME for it. It reads the RAW fixture rows, never
// `sampleFor` output; an exact twin (東京/横浜) goes through `sampleRows`
// untouched — the positional map never applies to it.

/** A store in view: its live uuid and its active people (id + live name), in `rosterOrderOf`'s order. */
export type RosterSeats = { store: string; roster: ReadonlyArray<{ id: string; name: string }> }

/** `identity` — one real person's row (shifts, the 勤務不可 row, a 販売可能枠): no seat
 *  drops the row, never a wrap (today-board keeps only the LAST shift per staff_id,
 *  and a wrapped slot could land on a person who is 勤務不可). `attribute` — a store
 *  row naming people (decisions): the person wraps (n mod roster size), null on an
 *  empty roster (nothing renders those fields; null owners already ship). */
export type PersonRows = 'identity' | 'attribute'

const PERSON_ORDER: readonly string[] = staff.map((p) => p.id)
/** ⚖ R9 — a fixture person's display name in a borrowed row's free text, found in ONE pass
 *  (a seated person's own name is never re-read as another fixture person's). */
const FIXTURE_NAME = new RegExp(staff.map((p) => p.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
/** A borrowed row's pointer at ANOTHER ROW OF THE SAME borrowed plane (a decision's slot):
 *  re-keyed with the row it names, so it finds the borrower's own copy. */
const ROW_REF = ['sell_slot_id']

/** The fixture store a live store BORROWS; null for an exact twin (or a store with no plane). */
function borrowedStoreOf(store: string): string | null {
  const policy = samplePolicyFor(store)
  return policy.kind === 'twin' && liveIdOf('stores', policy.fixtureStoreId) !== store ? policy.fixtureStoreId : null
}
/** ⚖ R3 — exact twins first (their rows are the originals, a borrower's are copies), each group in view order. */
const twinsFirst = (seats: readonly RosterSeats[]) =>
  [false, true].flatMap((borrows) => seats.filter((s) => (borrowedStoreOf(s.store) !== null) === borrows))

type BoardRow = { id?: string; store_id?: string | null; staff_id?: string | null }
const hasStore = (row: object) => Object.prototype.hasOwnProperty.call(row, 'store_id')

function rekeyStore<T extends BoardRow>(rows: readonly T[], { store, roster }: RosterSeats, persons: PersonRows, served?: (raw: T, row: T) => boolean): T[] {
  const borrowed = borrowedStoreOf(store)
  // An exact twin: the facade's own rewrite, then its own store's rows (a store-less shift is everyone's).
  if (borrowed === null) return sampleRows([...rows], null).filter((r) => !hasStore(r) || r.store_id === store)
  const seatOf = (fixtureId: string): { id: string; name: string } | null | undefined => {
    const n = PERSON_ORDER.indexOf(fixtureId)
    if (persons === 'identity') return roster[n] // undefined = no seat → the row drops
    return n < 0 || roster.length === 0 ? null : roster[n % roster.length]
  }
  return rows.flatMap((row): T[] => {
    if (hasStore(row) && row.store_id !== borrowed) return [] // another fixture store's row: dropped, as today
    let seated = true
    // ⚖ R9 — free text names the person SEATED at the fixture person's position (the row's own seat rule).
    const text = (t: string) =>
      t.replace(FIXTURE_NAME, (name) => {
        const seat = seatOf(PERSON_ORDER[staff.findIndex((p) => p.full_name === name)])
        if (seat === undefined) seated = false
        return seat?.name ?? name
      })
    const walk = (v: unknown, top: boolean): unknown => {
      if (typeof v === 'string') return text(v)
      if (Array.isArray(v)) return v.map((x) => walk(x, false))
      if (!isPlain(v)) return v
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(v)) {
        if (RESERVED.includes(key)) throw new Error(`sample facade: refused key "${key}"`)
        const kind = Object.prototype.hasOwnProperty.call(FIELD_KIND, key) ? FIELD_KIND[key] : null
        if (typeof value !== 'string' || !(kind || ROW_REF.includes(key) || (top && key === 'id'))) out[key] = walk(value, false)
        else if ((top && key === 'id') || ROW_REF.includes(key)) out[key] = `${value}~${store.slice(0, 8)}` // seven stores, seven keys
        else if (kind === 'stores') out[key] = store
        else if (kind === 'staff') {
          const seat = seatOf(value)
          if (seat === undefined) seated = false
          out[key] = seat?.id ?? null
        } else out[key] = null // ⚖ R4 — a booking / customer / menu is another store's record: never pointed at
      }
      return out
    }
    const rekeyed = walk(row, true) as T
    return seated && (!served || served(row, rekeyed)) ? [rekeyed] : []
  })
}

/** The rows for the stores in view: each store's own re-key, exact twins first
 *  (R3), then concatenated (viewAll = the union of every store's own board). A
 *  row that IS a person's day (a shift, the 勤務不可 row — no id of its own) is
 *  deduped by `staff_id` across the union: the first store keeps it. A row with
 *  its own id (a slot) is that store's record and is never deduped. `served`
 *  (a BORROWER's rows only) sees the raw row and its re-key and may refuse it.
 *  Pure: a function of (rows, seats), computed per request, never cached. */
export function rekeyRows<T extends BoardRow>(rows: readonly T[], seats: readonly RosterSeats[], persons: PersonRows, served?: (raw: T, row: T) => boolean): T[] {
  const all = twinsFirst(seats).flatMap((s) => rekeyStore(rows, s, persons, served))
  if (persons === 'attribute') return all
  const seen = new Set<string | null | undefined>()
  return all.filter((r) => {
    if (typeof r.id === 'string') return true
    if (seen.has(r.staff_id)) return false
    seen.add(r.staff_id)
    return true
  })
}

/** ⚖ R2 — a record keyed by FIXTURE person (資格 · 定価) for the stores in view: an
 *  exact twin's through the registry (`sampleKeys`), a borrower's onto the same
 *  seats as its identity rows (no seat → the entry drops). Twins first; the first
 *  store to key a person keeps it. */
export function rekeyKeys<V>(record: Record<string, V>, seats: readonly RosterSeats[]): Record<string, V> {
  const out: Record<string, V> = {}
  for (const { store, roster } of twinsFirst(seats)) {
    const own = borrowedStoreOf(store) === null
      ? Object.entries(sampleKeys('staff', record))
      : Object.entries(record).flatMap(([k, v]): Array<[string, V]> => (roster[PERSON_ORDER.indexOf(k)] === undefined ? [] : [[roster[PERSON_ORDER.indexOf(k)].id, v]]))
    for (const [k, v] of own) if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v
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
// mark follows the table — no site decides for itself. Every plane of the
// practice business is `'sample'` (that IS the map's truth) except the one whose
// read is connected: `bookingColors` (⚖ §v6 V6-2, #1049's 予約の色分け); as the test
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

/** The practice business's planes. Every one is SAMPLE (CONTRACT-MAP) but
 *  `bookingColors`: ⚖ §v6 V6-2 — #1049 connected its read (core's per-store
 *  予約の色分け under the door, saved by its writer), so it is LIVE here. */
export const PRACTICE_PLANES: Readonly<Record<PlaneKey, PlaneState>> = { ...every('sample'), bookingColors: 'live' }
/** The later one-line flip, per live store × plane — here and nowhere else.
 *  Flip a plane to live ONLY in the change that connects its read: the mark follows this table, the data follows the read (closures + bookingPolicy in PLANE_MAP_SAYS_LIVE are the open case, PR-4). */
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
  // ブランド・本部's own fact line: 「…本部による一括の管理は使っていません。」 (the store count before it is live).
  company: ['本部による一括の管理'],
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
