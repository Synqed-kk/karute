// PLAY-PHASE sample data for SYNQED Business (⚖ Liam 2026-08-19: Business runs
// on FAKE data until he orders the real connection). Everything here is
// obviously invented — テスト/見本 names, .invalid emails, made-up ids. No
// client, no network, no DB: this module is the only thing data.ts reads.
//
// Types are declared locally on purpose: importing the SDK's row types would
// put its package back in the Business graph, which is exactly what the ruling
// forbids. Same field names, narrowed to what the reads return.
//
// TWO RULES THIS FILE OBEYS, both of them Liam's:
//
// 1. RELATIVE DATES (⚖ L-6). Every date comes from ./clock, anchored on "today
//    in JST". The old fixed calendar expired on 2026-08-23; a demo that empties
//    itself because a date passed is a defect class, so absolute dates are gone.
//    `appointments()` is a FUNCTION, not a const, because a module-level const
//    would freeze the calendar at import time — including in jest, where the
//    fake clock is installed after the import.
//
// 2. NO IMPOSSIBLE STATES (⚖ 8/9, demo-data-product-truth). Bookings sit inside
//    10:00–19:00 JST, no staff is double-booked, no staff works a store they
//    are not assigned to, a 確認済み badge only appears where merge_status says
//    so, and the money/history a customer shows is DERIVED from these bookings
//    (data.ts) rather than stored twice — two copies of one fact is how a
//    contradiction gets in.

import { jstSlot, jstSlotEnd } from './clock'

export const STORE_A = 'store-test-ginza'
export const STORE_B = 'store-test-daikanyama'

export interface FixtureStore { id: string; name: string }
export const stores: FixtureStore[] = [
  { id: STORE_A, name: 'テスト銀座店' },
  { id: STORE_B, name: 'テスト代官山店' },
]

/** The business the shell names. One tenant, two stores. */
export const business = { name: '見本サンプル整体', storeCount: stores.length }

/** The signed-in operator the sidebar card shows (play phase: fixed persona). */
export const operator = { name: '見本 あずさ', mark: '見本', role: '店舗管理者' }

/** Reserve同期 in the topbar. Stored as an OFFSET, never a clock time: a fixed
 *  「13:24」 claims a sync from the future to anyone looking in the morning. */
export const reserveSync = { minutes_ago: 12 }

/** 本人関係 (D8 / CM-8). Only DEVIATIONS are listed — a customer who is their
 *  own サービス対象 / 保護者 / 支払者 carries an empty array, and the screen
 *  renders the 顧客 line alone (⚖ cut #7: never the exploded five-party box). */
export interface FixtureParty { role: 'サービス対象' | '保護者' | '支払者'; name: string; note: string }

/** Per-channel contact consent (D12 / CM-2). `null` = nothing recorded at all,
 *  which renders 「—」 and never a fabricated 「同意なし」. */
export interface FixtureConsent { line: boolean; sms: boolean; email: boolean }

export interface FixtureCustomer {
  id: string
  /** 顧客番号 — the cross-store join key (contract R1 / D1). */
  member_number: string
  name: string
  furigana: string | null
  /** person-mark initials, pre-split so the screen invents no name parsing. */
  mark: string
  phone: string | null
  email: string | null
  /** 登録元 (D6 / N5 / CM-7). */
  source: string
  /** 本人確認 (D7 / CM-4). null = 未確認. */
  identity_check: string | null
  /** 回数券 残数 (R3 / D10). null = 回数券なし. */
  ticket_balance: number | null
  /** 預かり残高 (R3 / S4 / D10 / CM-1). null = no wallet record → 「—」. */
  wallet_balance: number | null
  /** 重複候補 lifecycle (R4 / S5 / A1 / D9 / CM-5 + CM-6). */
  merge_status: 'open' | 'pending' | 'none'
  /** The other half of the duplicate pair, by member_number. */
  duplicate_of: string | null
  consent: FixtureConsent | null
  /** LINE 連携確認 (D12 second half / CM-3). */
  line_linked: boolean
  party: FixtureParty[]
  /** T1 — a person who exists only in the booking/register record, with no CRM
   *  profile. Renders the reduced 「サンプル簡易表示」 row. */
  thin: boolean
  /** T2 — the 正本 lives at an external booking source, so SYNQED cannot edit
   *  them and must not guess their money or consent. */
  external_owner: boolean
  /** T3 — メモ / 編集できない理由. */
  note: string | null
}

export interface FixtureAppointment {
  id: string
  store_id: string | null
  customer_id: string
  staff_id: string | null
  menu_id: string | null
  starts_at: string
  ends_at: string
  /** 受付価格 (D11) — the price agreed when the booking was taken. */
  booked_price: number | null
  status: 'booked' | 'done' | 'cancelled'
}

export interface FixtureMenu { id: string; store_id: string | null; name: string; price: number; duration_minutes: number }
export interface FixtureStaff { id: string; full_name: string; email: string | null }
/** The card/link shape listStaff's clamp resolves against: a real roster mixes
 *  profile ids with synqed card ids, so the fixture keeps that shape honest. */
export interface FixtureStaffCard { id: string; user_id: string | null; email: string | null }

/** Customers are business-wide — real ones carry no store_id either (CM-9), so
 *  none is stored here. A customer's store affiliation is DERIVED from where
 *  they have bookings, exactly as core derives it; a customer with no bookings
 *  belongs to no store, which is the CM-9 case cus-10 exists to show.
 *
 *  cus-01 / cus-09 are the duplicate PAIR (same phone, both `open`); cus-04 is
 *  the 統合確認中 case; cus-02 is the null-wallet case that must render 「—」
 *  and never ¥0. */
export const customers: FixtureCustomer[] = [
  {
    id: 'cus-01', member_number: 'C-3001', name: '見本 あかり', furigana: 'ミホン アカリ', mark: '見本',
    phone: '090-0000-0001', email: 'akari@sample.invalid', source: '店頭登録',
    identity_check: '2回目来店時に確認 / 見本 あずさ',
    ticket_balance: 4, wallet_balance: 12000,
    merge_status: 'open', duplicate_of: 'C-3009',
    consent: { line: true, sms: true, email: false }, line_linked: true,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-02', member_number: 'C-3002', name: '見本 いつき', furigana: 'ミホン イツキ', mark: '見本',
    phone: '090-0000-0002', email: 'itsuki@sample.invalid', source: 'Reserve本人登録',
    identity_check: null,
    ticket_balance: null, wallet_balance: null,
    merge_status: 'none', duplicate_of: null,
    consent: { line: false, sms: true, email: true }, line_linked: false,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-03', member_number: 'C-3003', name: '見本 うみ', furigana: 'ミホン ウミ', mark: '見本',
    phone: null, email: null, source: '電話予約',
    identity_check: null,
    ticket_balance: null, wallet_balance: 3000,
    merge_status: 'none', duplicate_of: null,
    consent: { line: false, sms: false, email: false }, line_linked: false,
    party: [
      { role: '保護者', name: '見本 みなと', note: '来店予約と連絡はすべて保護者が担当' },
      { role: '支払者', name: '見本 みなと', note: '会計も保護者が行う' },
    ],
    thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-04', member_number: 'C-3004', name: 'テスト えいた', furigana: 'テスト エイタ', mark: 'テスト',
    phone: '090-0000-0004', email: 'eita@sample.invalid', source: '旧CSV移行',
    identity_check: '移行時に電話で確認 / 見本 たろう',
    ticket_balance: 12, wallet_balance: 0,
    merge_status: 'pending', duplicate_of: 'C-3010',
    consent: { line: true, sms: false, email: false }, line_linked: false,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-05', member_number: 'C-3005', name: 'テスト おとは', furigana: 'テスト オトハ', mark: 'テスト',
    phone: '090-0000-0005', email: null, source: '店頭登録',
    identity_check: null,
    ticket_balance: null, wallet_balance: null,
    merge_status: 'none', duplicate_of: null,
    consent: null, line_linked: false,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-06', member_number: 'C-3006', name: '見本 かえる', furigana: 'ミホン カエル', mark: '見本',
    phone: '090-0000-0006', email: 'kaeru@sample.invalid', source: 'Reserve本人登録',
    identity_check: '本人確認済み / 見本 あずさ',
    ticket_balance: 2, wallet_balance: 5500,
    merge_status: 'none', duplicate_of: null,
    consent: { line: true, sms: true, email: true }, line_linked: true,
    party: [{ role: 'サービス対象', name: '見本 かえるの家族', note: '施術を受けるのは同伴のご家族' }],
    thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-07', member_number: 'C-3007', name: '見本 きり', furigana: 'ミホン キリ', mark: '見本',
    phone: null, email: 'kiri@sample.invalid', source: '電話予約',
    identity_check: null,
    ticket_balance: null, wallet_balance: null,
    merge_status: 'none', duplicate_of: null,
    consent: { line: false, sms: false, email: true }, line_linked: false,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-08', member_number: 'C-3008', name: 'テスト くらら', furigana: 'テスト クララ', mark: 'テスト',
    phone: '090-0000-0008', email: 'kurara@sample.invalid', source: '店頭登録',
    identity_check: '本人確認済み / 見本 たろう',
    ticket_balance: 8, wallet_balance: 21000,
    merge_status: 'none', duplicate_of: null,
    consent: { line: true, sms: true, email: false }, line_linked: true,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    id: 'cus-09', member_number: 'C-3009', name: '見本 あかり', furigana: 'ミホン アカリ', mark: '見本',
    phone: '090-0000-0001', email: null, source: '旧CSV移行',
    identity_check: null,
    ticket_balance: null, wallet_balance: null,
    merge_status: 'open', duplicate_of: 'C-3001',
    consent: null, line_linked: false,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    // CM-9 in one row: never booked anywhere, so no store owns them and every
    // clamped viewer would lose them at reconnect. Visible here, flagged there.
    id: 'cus-10', member_number: 'C-3010', name: 'テスト かなで', furigana: 'テスト カナデ', mark: 'テスト',
    phone: '090-0000-0010', email: 'kanade@sample.invalid', source: '店頭登録',
    identity_check: null,
    ticket_balance: null, wallet_balance: null,
    merge_status: 'none', duplicate_of: null,
    consent: { line: false, sms: false, email: false }, line_linked: false,
    party: [], thin: false, external_owner: false, note: null,
  },
  {
    // T1–T4: bookings exist, a CRM profile never did. thin-01's 正本 is an
    // external booking source, so its money and consent stay null — 「—」, not
    // a guess.
    id: 'thin-01', member_number: 'C-3801', name: '見本 そら', furigana: null, mark: '見本',
    phone: null, email: null, source: '外部予約元',
    identity_check: null,
    ticket_balance: null, wallet_balance: null,
    merge_status: 'none', duplicate_of: null,
    consent: null, line_linked: false,
    party: [], thin: true, external_owner: true,
    note: '本人情報の正本は外部予約元にあります。SYNQEDからは編集できません。',
  },
  {
    id: 'thin-02', member_number: 'C-3802', name: 'テスト なぎ', furigana: null, mark: 'テスト',
    phone: null, email: null, source: '予約・レジ記録のみ',
    identity_check: null,
    ticket_balance: null, wallet_balance: null,
    merge_status: 'none', duplicate_of: null,
    consent: { line: false, sms: true, email: false }, line_linked: false,
    party: [], thin: true, external_owner: false,
    note: '予約時に口頭で伺った内容のみ。本人プロフィールは未登録です。',
  },
]

/** menu-06 has no store_id: a 全店舗 item, visible in every store. */
export const menus: FixtureMenu[] = [
  { id: 'menu-01', store_id: STORE_A, name: 'テスト整体 60分', price: 6600, duration_minutes: 60 },
  { id: 'menu-02', store_id: STORE_A, name: 'テスト骨盤ケア 90分', price: 12100, duration_minutes: 90 },
  { id: 'menu-03', store_id: STORE_A, name: 'テストストレッチ 30分', price: 4400, duration_minutes: 30 },
  { id: 'menu-04', store_id: STORE_B, name: 'テスト深層ケア 120分', price: 14300, duration_minutes: 120 },
  { id: 'menu-05', store_id: STORE_B, name: 'テストヘッドケア 45分', price: 5500, duration_minutes: 45 },
  { id: 'menu-06', store_id: null, name: '見本 全店舗メニュー', price: 3300, duration_minutes: 20 },
]

/** p-09 has no card at all (a profile that was never linked) — the UNKNOWN
 *  case a clamped lens must exclude. */
export const staff: FixtureStaff[] = [
  { id: 'p-01', full_name: '見本 はなこ', email: 'hanako@test.invalid' },
  { id: 'p-02', full_name: '見本 たろう', email: 'taro@test.invalid' },
  { id: 'c-03', full_name: 'テスト さぶろう', email: null },
  { id: 'p-04', full_name: '見本 しろう', email: 'shiro@test.invalid' },
  { id: 'p-05', full_name: '見本 ごろう', email: 'goro@test.invalid' },
  { id: 'p-09', full_name: '見本 みらい', email: 'mirai@test.invalid' },
]

/** c-04 carries NO email, so only the user_id tier can link it to p-04. */
export const staffCards: FixtureStaffCard[] = [
  { id: 'c-01', user_id: null, email: 'hanako@test.invalid' },
  { id: 'c-02', user_id: 'p-02', email: 'taro@test.invalid' },
  { id: 'c-03', user_id: null, email: null },
  { id: 'c-04', user_id: 'p-04', email: null },
  { id: 'c-05', user_id: 'p-05', email: 'goro@test.invalid' },
]

/** Card → stores. An absent card (c-03) is floating: works in every store. */
export const staffAssignments: Record<string, string[]> = {
  'c-01': [STORE_A],
  'c-02': [STORE_B],
  'c-04': [STORE_A],
  'c-05': [STORE_A, STORE_B],
}

/**
 * The booking calendar — RELATIVE, so it is populated on any real date.
 *
 * A function, not a const: a const would bake the calendar at import time,
 * which is before jest installs its fake clock and before a long-lived server
 * process crosses midnight. Every call re-derives from the clock, so the
 * +30-days test sees a board that is still full.
 *
 * Invariants held by hand and asserted in the suite: every slot sits inside
 * 10:00–19:00 JST, no staff member holds two bookings at once, and every
 * staff/store pair matches `staffAssignments` (a floating card works anywhere).
 * apt-09 is deliberately STORELESS — the pre-repair-import shape a clamped
 * lens must hide.
 *
 * ponytail: recomputed per call rather than memoised; the set is a dozen rows
 * and a cache would only reintroduce the frozen-calendar bug it replaced.
 */
export function appointments(now: Date = new Date()): FixtureAppointment[] {
  const slot = (
    id: string,
    customer_id: string,
    store_id: string | null,
    staff_id: string | null,
    menu_id: string | null,
    day: number,
    hour: number,
    minute: number,
    minutes: number,
    booked_price: number | null,
    status: FixtureAppointment['status'],
  ): FixtureAppointment => ({
    id,
    store_id,
    customer_id,
    staff_id,
    menu_id,
    starts_at: jstSlot(day, hour, minute, now),
    ends_at: jstSlotEnd(day, hour, minute, minutes, now),
    booked_price,
    status,
  })

  return [
    // ── past (drives 最終来店 / 来店履歴 / 累計支払) ───────────────────────
    slot('apt-01', 'cus-01', STORE_A, 'p-01', 'menu-01', -7, 10, 0, 60, 6600, 'done'),
    slot('apt-02', 'cus-02', STORE_A, 'p-04', 'menu-03', -22, 11, 0, 30, 4400, 'done'),
    slot('apt-03', 'cus-04', STORE_B, 'p-05', 'menu-05', -3, 13, 0, 45, 5500, 'done'),
    slot('apt-04', 'cus-05', STORE_A, 'p-04', 'menu-01', -8, 15, 0, 60, 6600, 'done'),
    slot('apt-05', 'cus-06', STORE_A, 'c-03', 'menu-02', -14, 16, 0, 90, 12100, 'done'),
    slot('apt-06', 'cus-07', STORE_B, 'p-02', 'menu-04', -60, 14, 0, 120, 14300, 'done'),
    slot('apt-07', 'cus-08', STORE_A, 'p-01', 'menu-02', -1, 11, 0, 90, 12100, 'done'),
    slot('apt-08', 'cus-09', STORE_A, 'p-04', 'menu-06', -21, 17, 0, 20, 3300, 'done'),
    slot('apt-10', 'thin-01', STORE_A, 'p-01', 'menu-03', -2, 10, 0, 30, 4400, 'done'),
    slot('apt-11', 'thin-02', STORE_B, 'p-02', 'menu-05', -5, 12, 0, 45, 5500, 'done'),

    // ── today (in-hours, no overlap) ──────────────────────────────────────
    slot('apt-12', 'cus-02', STORE_A, 'p-04', 'menu-01', 0, 10, 0, 60, 6600, 'booked'),
    slot('apt-13', 'cus-03', STORE_B, 'p-02', 'menu-05', 0, 11, 0, 45, 5500, 'booked'),
    slot('apt-14', 'cus-06', STORE_A, 'c-03', 'menu-02', 0, 13, 0, 90, 12100, 'booked'),

    // ── ahead (drives 次回予約) ───────────────────────────────────────────
    slot('apt-15', 'cus-01', STORE_A, 'p-01', 'menu-01', 1, 10, 0, 60, 6600, 'booked'),
    slot('apt-16', 'cus-04', STORE_B, 'p-05', 'menu-04', 2, 14, 0, 120, 14300, 'booked'),
    slot('apt-17', 'cus-08', STORE_A, 'p-01', 'menu-02', 3, 11, 30, 90, 12100, 'booked'),
    slot('apt-18', 'cus-09', STORE_A, 'p-04', 'menu-03', 4, 16, 0, 30, 4400, 'booked'),
    slot('apt-19', 'cus-07', STORE_B, 'p-02', 'menu-04', 5, 15, 0, 120, 14300, 'booked'),
    slot('apt-20', 'thin-01', STORE_A, 'p-01', 'menu-01', 6, 13, 0, 60, 6600, 'booked'),
    // A cancelled booking is not a 次回予約 — cus-05 must show なし.
    slot('apt-21', 'cus-05', STORE_B, 'p-02', 'menu-05', 2, 10, 0, 45, 5500, 'cancelled'),
    // Storeless: hidden from a clamped lens, visible under viewAll. It keeps a
    // 全店舗 menu (visible in every store) but no price — the pre-repair-import
    // shape, where the store and the agreed price were both lost.
    slot('apt-09', 'cus-07', null, null, 'menu-06', 1, 16, 0, 20, null, 'booked'),
  ]
}
