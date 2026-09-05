// 設定 — THE SETTINGS PLANE, AND IT IS ADD-ONLY.
//
// This file states a value ONLY when no other plane in this world states it
// already. Every dial the rooms have shipped keeps its existing home and the
// 設定 room READS it there:
//
//   · スキマガード / 厳しさ            → fixtures-today `storeBookingPolicy.gapGuardMode`
//   · 「置けない」場所への上書き権限    → fixtures-today `storeBookingPolicy.overridePolicy`
//   · 確保枠を戻せる役職 / 会員ランク   → fixtures-today `storeBookingPolicy`
//   · 予約の移動単位 / ブロックの刻み   → fixtures-today `opsConfig`
//   · 販売可能な最小の長さ             → fixtures-today `opsConfig.minSellableMin`
//   · Reserveの受付の刻み・スキマ枠     → fixtures-today `opsConfig`
//   · 新規のお客様の所要時間           → fixtures-today `storeBookingPolicy`
//   · 部屋クラス / 部屋の割り当て       → fixtures-today `resources` / `opsConfig.roomPolicy`
//   · 営業時間 / 定休日                → fixtures-today `operatingHours` / `closedWeekday`
//   · 現金差異の承認しきい値           → fixtures-register `cashTolerance`
//   · 人件費を見られる役職             → fixtures-shifts `shiftsPolicy.laborCostRoles`
//   · 売上分析の閲覧権限 / 月間売上目標 → fixtures-analytics `analyticsPolicy` / `salesTargets`
//   · メニュー・所要時間・定価         → fixtures `menus`
//   · スタッフ名簿・店舗の割り当て      → fixtures `staff` / `staffAssignments`
//   · 事業体名 / 店舗の一覧            → fixtures `business` / `stores`
//   · Reserve同期の最終同期            → fixtures `reserveSync`
//
// ⚠ THAT RULE IS THE WHOLE POINT OF THE ROOM. A settings page that carried its
// own copy of a store's dial would be the second home the ⚖ one-truth law
// forbids, and the copy would be the one the reader believes — a page that says
// 「15分」 while the board snaps to 30 is worse than a page that says nothing.
// The suite pins the rule both ways: nothing below re-states a world value, and
// every store dial the screen renders traces to a plane read.
//
// WHAT IS BELOW, THEREFORE, IS ONLY THE SETTINGS THE PRODUCT HAS NOWHERE ELSE TO
// PUT — the ones canon's nineteen pages edit and no shipped room owns.
//
// NO ABSOLUTE DATES AND NO CLOCK (⚖ L-6 and the plane law): a date is a DAY
// OFFSET and the props file formats it against the render's own now.
//
// ⚠ THE TWO STORES DIFFER ON PURPOSE. A demo world where both stores hold
// identical settings cannot show the reader that these are PER-STORE values, and
// it would let a store-clamp defect pass every screenshot (⚖ 8/17's own test
// shape). 代官山 runs a longer win-back cycle, has coaching switched off, takes
// QR payments, and runs its own quiet hours.

import { STORE_A, STORE_B } from './fixtures'

/** 文字起こしの公開範囲. ⚖ Liam 8/30 D3: per-business, and the SAFE default is
 *  private — 「If they are private, only the staff can see it」. Enforcement is
 *  at the data door; the 録音 room states the same fact in words and decides
 *  nothing itself. */
export type TranscriptVisibility = 'staff-only' | 'managers-too'

/** コーチングの共有の方針. `manager-grant` = a staff member may grant their
 *  manager the deeper view, one person at a time; `peer` additionally opens the
 *  double-consent peer share. Neither is ON for anybody by default — the grant
 *  is always the staff member's own (room 8's anti-coercion wall). */
export type CoachingSharingMode = 'manager-grant' | 'peer'

export interface StoreProfile {
  /** ⚠ NOT THE STORE NAME. `fixtures.stores[].name` is the one home for that;
   *  a second copy here is exactly the disease this file exists to avoid. */
  address: string
  phone: string
  /** canon's 店舗写真 row: 未設定 until a store uploads one. */
  photo: string | null
}

/** 臨時休業・特別営業. `dayOffset` is days from the render's own today, so the
 *  demo is populated on any real date and no absolute date lives in a plane. */
/** ⚖ S17 · C2 — 臨時休業 ONLY. `kind` is gone with 特別営業, which core has no
 *  field for at all (registry ⑨ `special_open_days`, on the Anthony column
 *  list). A closure is a DATE and a REASON, which is exactly `StoreClosedDay`. */
export interface StoreClosure {
  dayOffset: number
  note: string
}

export interface TicketPack {
  name: string
  /** 単価 — what one visit costs inside the pack. */
  unitPrice: number
  /** The menu the pack is measured against. */
  menuId: string
}

export interface WalletPack {
  price: number
  points: number
}

export interface StaffSettings {
  /** canon's preset key (`PRESET_GRANTS` in lib/settings.ts). */
  preset: string
  /** Per-account overrides on top of the preset — canon's own model. */
  caps: string[]
  pin: boolean
  /** 音声同意: whether this person has registered their own voice. */
  voice: boolean
}

/** ⚖ S17 · C8 — the nine categories the audit writers ACTUALLY emit, in
 *  `AUDIT_CATEGORIES`' own order, each with what it means in plain Japanese.
 *
 *  ⚠ `billing` IS DECLARED AND NEVER WRITTEN, so it is not here. The reason it
 *  can be left out with certainty rather than guessed at: every direct
 *  `audit()` / `auditWeb()` call site passes a literal, and the ONE indirection
 *  — `audit({ category: rule.category })` at `src/lib/app-api/handler.ts:220` —
 *  reads `FACADE_AUDIT_MAP` (`src/lib/audit.ts:357`), whose every row assigns a
 *  literal typed `AuditCategory`, and whose only `billing` row is
 *  `'entitlement.read': { kind: 'skip', … }` which `logFacadeAudit` returns on
 *  before it writes (`handler.ts:193`). Offering a tenth filter that can never
 *  match a row would be a dead lever with a label. */
export const AUDIT_CATEGORIES = [
  { token: 'auth', label: 'ログイン・暗証番号' },
  { token: 'customer', label: '顧客' },
  { token: 'karute', label: 'カルテ' },
  { token: 'recording', label: '録音' },
  { token: 'ai', label: 'AI' },
  { token: 'privacy', label: '同意・音声の登録' },
  { token: 'settings', label: '設定' },
  { token: 'staff', label: 'スタッフ' },
  { token: 'booking', label: '予約' },
] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]['token']

export interface AuditEntry {
  dayOffset: number
  at: string
  who: string
  /** ⚖ S17 · C8 — THE PRODUCT'S OWN CATEGORIES, not this room's invention.
   *  `src/lib/audit.ts:20-31` on `origin/main` declares ten
   *  (`AUDIT_CATEGORIES`), of which NINE are ever emitted — `billing` appears
   *  only as a `kind: 'skip'` row in `FACADE_AUDIT_MAP` and is returned before
   *  it can reach `audit()` (`src/lib/app-api/handler.ts:193`). The first cut
   *  invented five of its own (pricing / reserve / permissions / store / other),
   *  so a manager filtering this log by 「権限」 was filtering by a word the
   *  writers never write. */
  category: AuditCategory
  what: string
  subject: string
  before: string
  after: string
}

export interface StoreDials {
  profile: StoreProfile
  closures: StoreClosure[]
  /** Which menus are on sale in Reserve, keyed by the menu id `fixtures.menus`
   *  owns. The menu's NAME, DURATION and PRICE are read from there. */
  menuVisible: Record<string, boolean>
  tickets: TicketPack[]
  /** 稼働, keyed by the roster id `fixtures.staff` owns. */
  staffActive: Record<string, boolean>
  staffSettings: Record<string, StaffSettings>
  /** レジで使える支払い方法. */
  payCash: boolean
  payCard: boolean
  payQr: boolean
  /** 事業体 — the contracting entity behind `fixtures.business`. */
  companyName: string
  representative: string
  companyForm: string
  /** 動的価格. ⚠ FALSE HERE IS THE TRUTH, NOT A PREFERENCE: no store-wide master
   *  exists in the product yet. 今日の運営's 販売可能枠の表示 is a PER-VIEWER
   *  display choice and the discount depth is derived from the price list.
   *  GUARDRAIL: the curve's depth is capped by `CURVE_MAX_DIP` in
   *  canon-logic/pricing.ts so a store cannot discount past its own floor. */
  dynamicPricing: boolean
  /** 価格の見せ方 — 割引型 or 加算型. The real price is identical either way. */
  priceFraming: 'discount' | 'markup'
  /** ポイント制（前払）. */
  pointsEnabled: boolean
  walletPacks: WalletPack[]
  /** AI設定. */
  aiSummaryLength: 'short' | 'standard' | 'detailed'
  /** ⚖ S17 · C4 — KARUTE-OWNED. Karute calls this ボイススタイル and stores it as
   *  `ai_voice_style`, a THREE-value enum: `src/actions/org-settings.ts:22`
   *  `export type AIVoiceStyle = 'formal' | 'polite' | 'friendly'`, mirrored in
   *  its own DTO at `src/lib/app-api/settings-screen-dto.ts:118`. The first cut
   *  offered two of the three, so フォーマル was a setting the product has and
   *  this page could not reach. */
  aiVoiceStyle: 'formal' | 'polite' | 'friendly'
  aiLanguage: string
  aiOutcomes: string[]
  aiAggressiveness: 'light' | 'standard' | 'active'
  aiCategories: Record<string, boolean>
  /** 業種プロファイル — the 26-vertical profile the product's vocabulary rides.
   *  Changed by support, never self-served, which canon states and this room
   *  carries as a locked control. */
  businessProfile: string
  /** 録音設定. */
  recordingConsentRequired: boolean
  retentionClass: 'no-duty' | 'statutory'
  /** 文字起こしの公開範囲. DEFAULT = private. GUARDRAIL: staff always see the
   *  store's current mode before they record, and a change is 監査-logged. */
  transcriptVisibility: TranscriptVisibility
  /** ⚖ S17 · C4 — KARUTE-OWNED, and it is a STATE rather than a boolean:
   *  `src/actions/org-settings.ts:35-44` `VoiceEnrollment { consent_at;
   *  sample_path; ref_path?; status: 'saved' | 'revoked'; revoked_at? }`, held
   *  per staff at `:76` `voice_enrollments: Record<string, VoiceEnrollment>`
   *  (mirrored in the DTO at `src/lib/app-api/settings-screen-dto.ts:95,126`).
   *  `revoked` is not the same as 「never registered」 — the consent and its
   *  withdrawal are both on the record — so the room carries the word, not a
   *  flag that throws the difference away. */
  voiceStatus: 'saved' | 'revoked'
  /** コーチング — `org_settings.coaching_enabled`, per store. */
  coachingEnabled: boolean
  coachingSharing: CoachingSharingMode
  /** GUARDRAIL: `clampCoachingRetention` holds it inside 3…36 months. */
  coachingRetentionMonths: number
  /** GUARDRAIL: `clampCoachingFloor` holds it inside 10…60. */
  coachingSampleFloor: number
  coachingCadence: 'daily' | 'weekly' | 'biweekly'
  /** 予約同期. */
  syncIntervalMin: number
  /** ⚖ S17 · C4 — HOURS, as `SyncConfig.business_hours_start` /
   *  `business_hours_end` hold them (@synqed-kk/client@1.34.0
   *  dist/types.d.ts:633-634 — plain `number`). The first cut held 「08:00」
   *  strings, which let the room offer a half-hour the wire cannot keep. */
  syncStartHour: number
  syncEndHour: number
  syncConflict: 'latest' | 'reserve' | 'manual'
  /** Reserve 受付 — ⚖ S17 · C6, MIRRORED FIELD FOR FIELD FROM THE ACCEPTANCE
   *  FAMILY so the reconnect is one line per value rather than a translation
   *  layer. Every name below is the wire's own name in this file's casing, and
   *  every unit is the wire's own unit:
   *    @synqed-kk/client@1.34.0 dist/types.d.ts:1051-1066 `StoreBookingPolicy`
   *      booking_open_days: number            ← days
   *      cutoff_minutes: number               ← MINUTES (not hours)
   *      cancel_free_until_hours: number      ← hours
   *      cancel_late_pct: number              ← percent
   *      no_show_pct: number                  ← percent
   *    …:1067-1078 `SetStoreBookingPolicyInput` takes the same five, optional.
   *  ⚠ `cutoffMinutes` IS THE ONE THAT MOVED. The first cut held HOURS and the
   *  select offered 1/2/3/6 時間前; the wire stores minutes, so a room holding
   *  hours has to multiply somewhere, and 「somewhere」 is where a factor of 60
   *  goes missing. The value is minutes end to end; only the LABEL says 時間前. */
  bookingOpenDays: number
  cutoffMinutes: number
  cancelFreeUntilHours: number
  cancelLatePct: number
  noShowPct: number
  priceLockDuringRecalc: boolean
  /** 通知 — event → channel. */
  notify: Record<string, { app: boolean; mail: boolean }>
  guardAlert: boolean
  quietStart: string
  quietEnd: string
  /** 外部連携 — connector id → 未接続 / リクエスト送信済み. */
  connectors: Record<string, 'off' | 'pending'>
  /** データ入出力. */
  exportScopes: string[]
  exportFormat: 'csv' | 'json'
  lastExport: string
  /** 監査ログ. */
  auditLog: AuditEntry[]
  /** 言語・表示. ⚖ Liam 8/31, ALL SYNQED products: every product follows the
   *  phone and is changeable in settings. Business is a RETROFIT round; this
   *  room ships the lever and the retrofit follows. */
  uiLanguage: string
  karuteLanguage: string
  /** 予約の色分け — booking category → palette key. */
  bookingColors: Record<string, string>
  /** 色・テーマ — the family's own token names → this store's hex. */
  colorTokens: Record<string, string>
  /** 再来促しの日数しきい値. ⚖ Liam 8/23: one value, two doors. MIRRORED BY
   *  SHAPE from the phone's own constant — `REENGAGE_NUDGE_MIN_DAYS`
   *  (src/lib/karute/ai-reengagement.ts) — with a cite rather than an import,
   *  because Business territory may not import phone runtime.
   *  GUARDRAIL: `clampWinBackDays` holds it inside 14…365.
   *  業種: ruled type-dependent by Liam (a 整体 cycle is not a hair cycle). */
  winBackDays: number
  /** 契約・請求 — ⚖ S17 · C11 RETIRED FROM THE STORE. `Entitlement` is
   *  `{ business_id; tier; is_unlimited }` (@synqed-kk/client@1.34.0
   *  dist/types.d.ts:250-254) — ONE ROW PER BUSINESS, and a TIER rather than a
   *  pair of per-product switches. The first cut offered two per-store switches
   *  that could turn a product on for 銀座 and off for 代官山, which the
   *  entitlement model cannot express at all. See `entitlement` below. */
  cardLast4: string
  cardExpiry: string
}

/** ⚠ ONE HOME AT MERGE — READ THIS BEFORE RESOLVING A CONFLICT.
 *  `coachingEnabled` and `coachingSampleFloor` are the same two facts room 8's
 *  branch states as `fixtures-coaching.coachingStores` and `coaching.FLOOR_DEFAULT`.
 *  Room 8 is NOT on this room's base (both branch from `ab8fec28`), so this plane
 *  states them for the room that owns their controls. Whichever branch lands
 *  SECOND deletes its own copy and reads the other's — the 設定 room reads room
 *  8's list, or room 8 reads this one. Two copies must not survive a merge. */
const ginza: StoreDials = {
  profile: { address: '東京都中央区銀座見本1-2-3 3F', phone: '03-0000-0001', photo: null },
  closures: [
    { dayOffset: 8, note: '設備メンテナンスのため' },
    // ⚠ THIS ROW'S REASON HAD TO CHANGE WITH C2. It used to be a 特別営業 entry
    // (`kind: 'extra'`, 「10:00〜22:00（通常より延長）」); under a block that is now
    // 臨時休業 ONLY, an extended-hours note reads as a closure whose reason is
    // 「we were open longer」 — a sentence about the opposite of what the row
    // says. ⚖ demo data is product truth: a store closes for a staff day, so
    // that is what the row says.
    { dayOffset: 15, note: '全スタッフ研修のため' },
  ],
  menuVisible: { 'menu-01': true, 'menu-02': true, 'menu-03': false, 'menu-06': true },
  tickets: [
    { name: 'テスト整体60分 回数券（10回）', unitPrice: 6300, menuId: 'menu-01' },
    { name: 'テストストレッチ30分 回数券（5回）', unitPrice: 4500, menuId: 'menu-03' },
  ],
  staffActive: { 'p-01': true, 'p-04': true, 'p-05': true, 'p-06': true, 'p-09': false, 'c-03': true },
  staffSettings: {
    'p-06': { preset: 'manager', caps: [], pin: true, voice: true },
    'p-01': { preset: 'practitioner', caps: [], pin: true, voice: true },
    'p-04': { preset: 'practitioner', caps: [], pin: true, voice: true },
    'p-05': { preset: 'senior', caps: [], pin: true, voice: false },
    'p-09': { preset: 'frontdesk', caps: [], pin: false, voice: false },
    'c-03': { preset: 'practitioner', caps: [], pin: true, voice: true },
  },
  payCash: true,
  payCard: true,
  payQr: false,
  companyName: '見本サンプル整体 合同会社',
  representative: '見本 あずさ',
  companyForm: '法人（合同会社）・設立 2019年4月',
  dynamicPricing: false,
  priceFraming: 'discount',
  pointsEnabled: false,
  walletPacks: [
    { price: 10000, points: 10000 },
    { price: 20000, points: 21000 },
  ],
  aiSummaryLength: 'standard',
  aiVoiceStyle: 'polite',
  aiLanguage: 'ja',
  aiOutcomes: ['改善', '維持', '経過観察', '未評価'],
  aiAggressiveness: 'standard',
  aiCategories: { followup: true, staffing: true, waitlist: true, vip: false },
  businessProfile: 'beauty_chiropractic',
  recordingConsentRequired: true,
  retentionClass: 'no-duty',
  transcriptVisibility: 'staff-only',
  voiceStatus: 'saved',
  coachingEnabled: true,
  coachingSharing: 'manager-grant',
  coachingRetentionMonths: 12,
  coachingSampleFloor: 20,
  coachingCadence: 'weekly',
  syncIntervalMin: 15,
  syncStartHour: 8,
  syncEndHour: 22,
  syncConflict: 'latest',
  bookingOpenDays: 30,
  cutoffMinutes: 120,
  cancelFreeUntilHours: 24,
  cancelLatePct: 50,
  noShowPct: 100,
  priceLockDuringRecalc: false,
  notify: {
    'new-booking': { app: true, mail: false },
    changed: { app: true, mail: false },
    cancelled: { app: true, mail: true },
  },
  guardAlert: true,
  quietStart: '21:00',
  quietEnd: '09:00',
  connectors: { calendar: 'off', accounting: 'off', messaging: 'off', 'booking-site': 'off' },
  exportScopes: [],
  exportFormat: 'csv',
  lastExport: 'まだ書き出していません',
  auditLog: [
    { dayOffset: 0, at: '12:10', who: '見本 あずさ', category: 'settings', what: '価格帯の変更', subject: 'テスト整体 60分・最低価格', before: '¥6,180', after: '¥6,270' },
    { dayOffset: 0, at: '09:12', who: '見本 あずさ', category: 'settings', what: '営業時間の変更', subject: '定休日', before: '火曜', after: '月曜' },
    { dayOffset: 1, at: '10:00', who: '見本 あずさ', category: 'staff', what: 'スタッフの稼働状態を変更', subject: '見本 みらい', before: '稼働', after: '休止' },
    { dayOffset: 1, at: '09:52', who: 'システム', category: 'settings', what: '表示の自動切替', subject: 'テスト骨盤ケア 90分・比較表示', before: '割引表示', after: '価格のみ表示（基準取引不足のため）' },
    { dayOffset: 2, at: '11:20', who: '見本 あずさ', category: 'settings', what: '受付ウィンドウの変更', subject: '何日先まで予約可', before: '21日', after: '30日' },
    { dayOffset: 3, at: '18:22', who: '見本 あずさ', category: 'staff', what: '権限の変更', subject: '見本 ごろう', before: '施術スタッフ', after: '主任' },
    { dayOffset: 4, at: '10:12', who: '見本 あずさ', category: 'settings', what: '支払い方法の変更', subject: 'カード決済', before: 'オフ', after: 'オン' },
    { dayOffset: 6, at: '14:05', who: '見本 あずさ', category: 'settings', what: 'キャンセル規定の変更', subject: '当日キャンセル料', before: '30%', after: '50%' },
    { dayOffset: 11, at: '10:00', who: '見本 あずさ', category: 'settings', what: 'お知らせ設定の変更', subject: '表示の健全性のお知らせ', before: 'オフ', after: 'オン' },
    { dayOffset: 16, at: '21:15', who: '見本 あずさ', category: 'settings', what: '静かな時間の設定', subject: '静かな時間', before: '未設定', after: '21:00〜9:00' },
    { dayOffset: 34, at: '09:40', who: '見本 あずさ', category: 'settings', what: '会社名の表記を修正', subject: '会社名', before: '表記ゆれあり', after: '見本サンプル整体 合同会社' },
    // ⚖ DEMO DATA IS PRODUCT TRUTH. A store's audit log after a month is not
    // twelve settings changes: the writers also record customer edits, recording
    // lifecycle and consent (`src/actions/customers.ts:218`,
    // `src/lib/recording/finalize-take.ts:359`, `src/actions/voice.ts:126`), so
    // the log shows them and the 種類 filter has something to do.
    { dayOffset: 0, at: '15:40', who: '見本 はなこ', category: 'recording', what: '録音の保存が完了', subject: '見本 あかり 様 10:00', before: '送信中', after: '保存済み' },
    { dayOffset: 2, at: '16:02', who: '見本 しろう', category: 'customer', what: 'お客様情報の変更', subject: '見本 かえで 様・連絡先', before: '未登録', after: '登録済み' },
    { dayOffset: 8, at: '19:30', who: '見本 ごろう', category: 'privacy', what: '自分の声の登録', subject: '見本 ごろう', before: '未登録', after: '登録済み' },
  ],
  uiLanguage: 'ja',
  karuteLanguage: 'ja',
  bookingColors: { new: 'blue', repeat: 'teal', renewal: 'purple', pack: 'pink', vip: 'navy' },
  colorTokens: {
    '--commit-bg': '#2563eb',
    '--select-bg': '#eef2ff',
    '--orange': '#b45309',
    '--green-dark': '#166534',
    '--red-dark': '#b91c1c',
    '--yellow': '#a16207',
    '--beige-dark': '#8a6a4f',
    '--guard-dark': '#6d28d9',
  },
  winBackDays: 61,
  cardLast4: '4242',
  cardExpiry: '2028/06',
}

const daikanyama: StoreDials = {
  ...ginza,
  profile: { address: '東京都渋谷区代官山見本4-5-6 1F', phone: '03-0000-0002', photo: null },
  closures: [{ dayOffset: 5, note: '内装工事のため' }],
  menuVisible: { 'menu-04': true, 'menu-05': true, 'menu-06': false },
  tickets: [{ name: 'テストヘッドケア45分 回数券（10回）', unitPrice: 5800, menuId: 'menu-05' }],
  staffActive: { 'p-02': true, 'p-05': true, 'c-03': true },
  staffSettings: {
    'p-02': { preset: 'manager', caps: [], pin: true, voice: false },
    'p-05': { preset: 'senior', caps: [], pin: true, voice: false },
    'c-03': { preset: 'practitioner', caps: [], pin: true, voice: true },
  },
  payQr: true,
  dynamicPricing: true,
  pointsEnabled: true,
  coachingEnabled: false,
  coachingCadence: 'biweekly',
  syncIntervalMin: 30,
  bookingOpenDays: 45,
  cutoffMinutes: 180,
  cancelFreeUntilHours: 48,
  quietStart: '22:00',
  quietEnd: '08:00',
  connectors: { calendar: 'pending', accounting: 'off', messaging: 'off', 'booking-site': 'off' },
  auditLog: [
    { dayOffset: 1, at: '11:00', who: '見本 たろう', category: 'settings', what: '営業時間の変更', subject: '定休日', before: '月曜', after: '月曜（変更なし）' },
    { dayOffset: 5, at: '16:45', who: '見本 たろう', category: 'settings', what: '受付ウィンドウの変更', subject: '何日先まで予約可', before: '30日', after: '45日' },
    { dayOffset: 12, at: '09:30', who: '見本 たろう', category: 'settings', what: '動的価格の切り替え', subject: '動的価格', before: '使わない', after: '使う' },
  ],
  winBackDays: 90,
  voiceStatus: 'revoked',
}

export const storeDials: Record<string, StoreDials> = {
  [STORE_A]: ginza,
  [STORE_B]: daikanyama,
}

/** 外部連携 — the categories, stated as GENERAL names rather than vendors, so
 *  the page never claims an integration that does not exist (canon's own honest
 *  law on that page). Business-wide, not per store. */
export const connectorCatalog: ReadonlyArray<{ id: string; name: string; note: string }> = [
  { id: 'calendar', name: '外部カレンダー', note: '予約の予定を外部カレンダーアプリと同期します。' },
  { id: 'accounting', name: '会計ソフト連携', note: '売上データを会計ソフトへ書き出します。' },
  { id: 'messaging', name: 'メッセージ配信', note: '予約確認・リマインドを外部のメッセージサービスへ送ります。' },
  { id: 'booking-site', name: '外部予約サイト連携', note: '他の予約サイトからの予約を取り込みます。' },
]

/** 予約の色分け — the palette a store may pick from. The STATUS colours
 *  (確定・要対応・停止) are deliberately NOT here: they are the family's own
 *  safety rule and no store may repaint them. */
export const bookingPalette: ReadonlyArray<{ value: string; label: string; hex: string }> = [
  { value: 'blue', label: '青', hex: '#3b6fd4' },
  { value: 'teal', label: '青緑', hex: '#2b8a8a' },
  { value: 'purple', label: '紫', hex: '#7a5bd4' },
  { value: 'pink', label: '桃', hex: '#c25a8f' },
  { value: 'navy', label: '紺', hex: '#3f4a7d' },
  { value: 'brown', label: '茶', hex: '#8a6a4f' },
  { value: 'gray', label: '灰', hex: '#8a8a93' },
]

/** 色・テーマ — what each editable token PAINTS, in the reader's own words.
 *  The token's machine name never reaches the screen (⚖ plain names). */
export const colorTokenMeaning: Record<string, string> = {
  '--commit-bg': '確定・保存ボタンの色',
  '--select-bg': '選択中の行の色',
  '--orange': '注意のしるしの色',
  '--green-dark': '完了のしるしの色',
  '--red-dark': '取り消し・削除のしるしの色',
  '--yellow': '保留・仮押さえの色',
  '--beige-dark': '準備・清掃の色',
  '--guard-dark': 'スキマガードのしるしの色',
}

/** 業種プロファイル — ⚖ S17 · C4. KARUTE-OWNED, SO KARUTE'S SPELLING WINS.
 *
 *  THE CONTRACT: `src/lib/welcome/business-types.ts:71-98` on `origin/main` —
 *  `export const BUSINESS_TYPES: BusinessType[]`, 26 entries of
 *  `{ value; label; labelJa }`. Every `value` and every `labelJa` below is that
 *  list, byte for byte, in its own order.
 *
 *  ⚠ THE LABELS WERE THIS ROOM'S OWN AND THEY WERE WRONG. The first cut wrote a
 *  reasonable-sounding Japanese name for each vertical — 「美容室（ヘアサロン）」,
 *  「マッサージ」, 「接骨院・整骨院」, 「歯科医院」 — against Karute's own
 *  「ヘアサロン」, 「リラクゼーション・マッサージ」, 「整骨院」, 「歯科クリニック」.
 *  Eleven of the twenty-six differed. A settings page naming a business type
 *  differently from the app that acts on it is two names for one thing, and the
 *  operator cannot tell which one the product believes.
 *
 *  ⚠ COPIED, NOT IMPORTED, and that is the fence rather than laziness: Business
 *  territory may not import `src/lib/**` (the import-isolation gate). So the
 *  list is mirrored BY SHAPE with its cite, and `settings.test.ts` READS
 *  Karute's file off disk and asserts equality — a drift on either side goes red
 *  the same day it lands.
 *
 *  ⚠ AND KARUTE WRITES IT IN TWO PLACES, which is Karute's truth and not ours to
 *  quietly pick between: `completeOnboarding` puts it in the business's own
 *  org-settings blob (`src/actions/org-settings.ts:294` → `:363-366`
 *  `orgSettings.upsert({ settings })`), and the store add/edit dialog puts it on
 *  the STORE (`src/actions/stores.ts:330,405` → `synqed.stores.create/update`,
 *  core's `stores.business_type` column). The row is per-store here, says so, and
 *  names the other home in its own 詳しく rather than pretending there is one. */
export const businessProfiles: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'esthetic_salon', label: 'エステサロン' },
  { value: 'hair_salon', label: 'ヘアサロン' },
  { value: 'nail_salon', label: 'ネイルサロン' },
  { value: 'eyelash_salon', label: 'まつげサロン' },
  { value: 'massage', label: 'リラクゼーション・マッサージ' },
  { value: 'chiropractic', label: '整体院' },
  { value: 'beauty_chiropractic', label: '美容整体' },
  { value: 'acupuncture', label: '鍼灸院' },
  { value: 'osteopathy', label: '整骨院' },
  { value: 'yoga_studio', label: 'ヨガスタジオ' },
  { value: 'pilates_studio', label: 'ピラティススタジオ' },
  { value: 'personal_gym', label: 'パーソナルジム' },
  { value: 'dental_clinic', label: '歯科クリニック' },
  { value: 'medical_clinic', label: '医療クリニック' },
  { value: 'dermatology', label: '皮膚科クリニック' },
  { value: 'cosmetic_surgery', label: '美容外科クリニック' },
  { value: 'physical_therapy', label: '理学療法' },
  { value: 'foot_care', label: 'フットケア・リフレクソロジー' },
  { value: 'relaxation', label: 'リラクゼーションサロン' },
  { value: 'aroma', label: 'アロマセラピーサロン' },
  { value: 'wellness_clinic', label: 'ウェルネスクリニック' },
  { value: 'mental_health', label: 'メンタルヘルス・カウンセリング' },
  { value: 'veterinary', label: '動物病院' },
  { value: 'pet_grooming', label: 'トリミングサロン' },
  { value: 'training_school', label: 'スクール・レッスン' },
  { value: 'other', label: 'その他' },
]

// ══ ⚖ S17 · C7 — THE PERMISSION RULEBOOK, BY SHAPE ══════════════════════════
//
// `PermissionClient.rulebook()` is documented 「One source for both apps' toggle
// UIs」 (@synqed-kk/client dist/permissions.d.ts:10). Until the reconnect PR
// calls it, the room carries KARUTE'S REAL LIST — mirrored by shape, with its
// cite, and pinned by a suite that reads Karute's own file off disk so a drift
// on either side goes red.
//
// ⚠ WHAT THE FIRST CUT HAD, AND WHY IT WAS WRONG. It carried EIGHT capabilities
// — canon's staff MOCK's `CAP_ORDER`, a developer artefact — as though those
// were the product's permissions. The real list is EIGHTEEN
// (`src/lib/auth/permissions.ts:14-46`), and the ten it was missing are not
// obscure: 監査ログの閲覧, 予約同期の状態, カルテの削除, カルテの付け替え, ほかの
// スタッフの録音の閲覧, 全店舗の閲覧, メニューの管理, アラートの操作, 予約の管理,
// 事業の管理. A manager reading this page would have concluded those permissions
// do not exist. A settings page that under-reports the permission model is worse
// than one that says nothing, because it is believed.
//
// ⚠ AND `business.manage` IS REAL AND GRANTABLE — capability #2, owner-only BY
// DEFAULT rather than by nature (`permissions.ts:16`, excluded from the manager
// preset at `:76`, and NOT stripped for non-owners by `effectiveCapabilities()`
// at `:124-146`, unlike `recordings.viewAll` which IS). The first cut said it
// 「is not a store's to grant」 and left it out of the grid on that reasoning.
// It is in the grid now, and the 事業構成 boundary sentence says how it is
// handed out.

/** ⚠ D-NUMBERED: THE PACKET SAID NINE ROLES INCLUDING `custom`; THERE ARE SIX,
 *  and there is no `PermissionRoleKey` symbol anywhere on `origin/main`. The
 *  type is `PermissionRole` (`src/lib/auth/permissions.ts:59`) over
 *  `PERMISSION_ROLES` (`:51-58`). Verified by reading the file, not by trusting
 *  the brief — the whole point of pinning a contract is that the pin is read
 *  from the source. */
export interface Rulebook {
  /** All 18, in Karute's own source order, each with what it DOES in plain
   *  Japanese (⚖ 「plain names, never codes」 — the reader never sees a token). */
  capabilities: ReadonlyArray<{ token: string; label: string }>
  /** The 6 role presets, in Karute's own order, `custom` last. */
  roles: ReadonlyArray<{ key: string; label: string }>
  /** Karute's `ROLE_PRESETS` — what each role is seeded with. */
  grants: Readonly<Record<string, readonly string[]>>
  /** This demo world's role WORDS → the preset they map to. An unknown role
   *  holds NOTHING, never a default grant. */
  roleKeyOf: Readonly<Record<string, string>>
}

/** `src/lib/auth/permissions.ts:14-46` (CAPABILITIES) · `:51-58`
 *  (PERMISSION_ROLES) · `:64-90` (ROLE_PRESETS), all on `origin/main`. */
export const rulebook: Rulebook = {
  capabilities: [
    { token: 'billing.manage', label: '契約・請求の管理' },
    { token: 'business.manage', label: '事業の管理（削除・譲渡）' },
    { token: 'staff.invite', label: 'スタッフの招待' },
    { token: 'staff.manage', label: 'スタッフの管理（役職の変更・削除）' },
    { token: 'settings.manage', label: '設定の変更' },
    { token: 'menus.manage', label: 'メニューの管理' },
    { token: 'audit.view', label: '監査ログの閲覧' },
    { token: 'sync.view', label: '予約同期の状態の閲覧' },
    { token: 'data.export', label: 'データの書き出し・取り込み' },
    { token: 'records.delete', label: 'カルテ・顧客の削除' },
    { token: 'records.reassign', label: 'カルテの付け替え' },
    { token: 'records.write', label: 'カルテの記録' },
    { token: 'recordings.viewAll', label: '全スタッフの録音の閲覧' },
    { token: 'analytics.viewAll', label: '売上分析の閲覧（店舗全体）' },
    { token: 'stores.viewAll', label: '全店舗の閲覧' },
    { token: 'alerts.manage', label: '離客・回数券のお知らせの操作' },
    { token: 'customers.view', label: '顧客の閲覧' },
    { token: 'bookings.manage', label: '予約の管理' },
  ],
  roles: [
    { key: 'owner', label: 'オーナー' },
    { key: 'manager', label: '店舗管理者' },
    { key: 'senior', label: '主任' },
    { key: 'practitioner', label: '施術スタッフ' },
    { key: 'frontdesk', label: '受付' },
    // ⚠ `custom` STARTS EMPTY, and that is Karute's own comment: 「a blank
    // canvas — toggle up exactly what this business needs」 (`permissions.ts:88`).
    { key: 'custom', label: 'カスタム' },
  ],
  grants: {
    // owner: ALL (`permissions.ts:66`).
    owner: [
      'billing.manage', 'business.manage', 'staff.invite', 'staff.manage', 'settings.manage',
      'menus.manage', 'audit.view', 'sync.view', 'data.export', 'records.delete',
      'records.reassign', 'records.write', 'recordings.viewAll', 'analytics.viewAll',
      'stores.viewAll', 'alerts.manage', 'customers.view', 'bookings.manage',
    ],
    // manager: ALL minus billing.manage · business.manage · recordings.viewAll ·
    // audit.view · sync.view (`permissions.ts:73-81`).
    manager: [
      'staff.invite', 'staff.manage', 'settings.manage', 'menus.manage', 'data.export',
      'records.delete', 'records.reassign', 'records.write', 'analytics.viewAll',
      'stores.viewAll', 'alerts.manage', 'customers.view', 'bookings.manage',
    ],
    senior: [
      'records.write', 'records.delete', 'records.reassign', 'data.export',
      'analytics.viewAll', 'stores.viewAll', 'customers.view', 'bookings.manage', 'menus.manage',
    ],
    practitioner: ['records.write', 'customers.view', 'bookings.manage'],
    frontdesk: ['customers.view', 'bookings.manage'],
    custom: [],
  },
  roleKeyOf: {
    オーナー: 'owner',
    店舗管理者: 'manager',
    スタッフ: 'practitioner',
  },
}

/** ⚖ S17 · C11 — THE ENTITLEMENT IS THE BUSINESS'S, AND IT IS READ-ONLY HERE.
 *  `Entitlement { business_id; tier; is_unlimited }`
 *  (@synqed-kk/client@1.34.0 dist/types.d.ts:250-254); it is written by the
 *  billing seam (Stripe), never by a settings screen, which is why the room
 *  STATES the plan and offers the door to the place that changes it. Canon's own
 *  ruling is that billing is Web限定 and gated on `billing.manage`. */
export const entitlement: { tier: string; isUnlimited: boolean; tierLabel: string } = {
  tier: 'standard',
  isUnlimited: false,
  tierLabel: 'スタンダード',
}

/** 契約・請求 — the monthly price of each product, business-wide. */
export const planPricing = { karute: 5800, reserve: 3000 }
