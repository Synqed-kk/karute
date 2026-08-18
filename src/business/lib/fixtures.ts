// PLAY-PHASE sample data for SYNQED Business (⚖ Liam 2026-08-19: Business runs
// on FAKE data until he orders the real connection). Everything here is
// obviously invented — テスト/見本 names, .invalid emails, made-up ids. No
// client, no network, no DB: this module is the only thing data.ts reads.
//
// Types are declared locally on purpose: importing the SDK's row types would
// put its package back in the Business graph, which is exactly what the ruling
// forbids. Same field names, narrowed to what the four reads return.

export const STORE_A = 'store-test-ginza'
export const STORE_B = 'store-test-daikanyama'

export interface FixtureStore { id: string; name: string }
export const stores: FixtureStore[] = [
  { id: STORE_A, name: 'テスト銀座店' },
  { id: STORE_B, name: 'テスト代官山店' },
]

/** member_number / ticket_balance / verified back the canon 顧客一覧 columns
 *  (顧客 · 回数券・残高 · 確認); a null balance renders 「—」 like the mock. */
export interface FixtureCustomer { id: string; name: string; furigana: string | null; phone: string | null; member_number: string; visit_count: number; last_visit_at: string | null; ticket_balance: number | null; verified: boolean }
export interface FixtureAppointment { id: string; store_id: string | null; customer_id: string; staff_id: string | null; starts_at: string; ends_at: string; status: 'booked' | 'done' | 'cancelled' }
export interface FixtureMenu { id: string; store_id: string | null; name: string; price: number; duration_minutes: number }
export interface FixtureStaff { id: string; full_name: string; email: string | null }
/** The card/link shape listStaff's clamp resolves against: a real roster mixes
 *  profile ids with synqed card ids, so the fixture keeps that shape honest. */
export interface FixtureStaffCard { id: string; user_id: string | null; email: string | null }

/** Customers are business-wide — real ones carry no store_id either. */
export const customers: FixtureCustomer[] = [
  { id: 'cus-01', name: '見本 あかり', furigana: 'ミホン アカリ', phone: '090-0000-0001', member_number: 'C-3001', visit_count: 12, last_visit_at:'2026-08-10T02:00:00Z', ticket_balance: 4, verified: true },
  { id: 'cus-02', name: '見本 いつき', furigana: 'ミホン イツキ', phone: '090-0000-0002', member_number: 'C-3002', visit_count: 3, last_visit_at:'2026-07-28T05:30:00Z', ticket_balance: null, verified: false },
  { id: 'cus-03', name: '見本 うみ', furigana: 'ミホン ウミ', phone: null, member_number: 'C-3003', visit_count: 1, last_visit_at:'2026-08-01T01:00:00Z', ticket_balance: null, verified: false },
  { id: 'cus-04', name: 'テスト えいた', furigana: 'テスト エイタ', phone: '090-0000-0004', member_number: 'C-3004', visit_count: 27, last_visit_at:'2026-08-15T08:00:00Z', ticket_balance: 12, verified: true },
  { id: 'cus-05', name: 'テスト おとは', furigana: 'テスト オトハ', phone: '090-0000-0005', member_number: 'C-3005', visit_count: 0, last_visit_at:null, ticket_balance: null, verified: false },
  { id: 'cus-06', name: '見本 かえる', furigana: 'ミホン カエル', phone: '090-0000-0006', member_number: 'C-3006', visit_count: 8, last_visit_at:'2026-08-12T03:00:00Z', ticket_balance: 2, verified: true },
  { id: 'cus-07', name: '見本 きり', furigana: 'ミホン キリ', phone: null, member_number: 'C-3007', visit_count: 5, last_visit_at:'2026-06-20T06:00:00Z', ticket_balance: null, verified: true },
  { id: 'cus-08', name: 'テスト くらら', furigana: 'テスト クララ', phone: '090-0000-0008', member_number: 'C-3008', visit_count: 41, last_visit_at:'2026-08-18T09:00:00Z', ticket_balance: 8, verified: true },
]

/** apt-09 is deliberately STORELESS (the pre-repair-import shape) — hidden from
 *  a clamped lens, visible under viewAll. */
export const appointments: FixtureAppointment[] = [
  { id: 'apt-01', store_id: STORE_A, customer_id: 'cus-01', staff_id: 'p-01', starts_at: '2026-08-19T01:00:00Z', ends_at: '2026-08-19T02:00:00Z', status: 'booked' },
  { id: 'apt-02', store_id: STORE_A, customer_id: 'cus-02', staff_id: 'p-04', starts_at: '2026-08-19T02:30:00Z', ends_at: '2026-08-19T03:30:00Z', status: 'booked' },
  { id: 'apt-03', store_id: STORE_A, customer_id: 'cus-04', staff_id: 'p-05', starts_at: '2026-08-19T05:00:00Z', ends_at: '2026-08-19T06:00:00Z', status: 'done' },
  { id: 'apt-04', store_id: STORE_A, customer_id: 'cus-06', staff_id: 'c-03', starts_at: '2026-08-20T01:00:00Z', ends_at: '2026-08-20T02:00:00Z', status: 'booked' },
  { id: 'apt-05', store_id: STORE_B, customer_id: 'cus-03', staff_id: 'p-02', starts_at: '2026-08-19T01:30:00Z', ends_at: '2026-08-19T02:30:00Z', status: 'booked' },
  { id: 'apt-06', store_id: STORE_B, customer_id: 'cus-05', staff_id: 'p-02', starts_at: '2026-08-19T04:00:00Z', ends_at: '2026-08-19T05:00:00Z', status: 'cancelled' },
  { id: 'apt-07', store_id: STORE_B, customer_id: 'cus-07', staff_id: 'p-05', starts_at: '2026-08-21T03:00:00Z', ends_at: '2026-08-21T04:00:00Z', status: 'booked' },
  { id: 'apt-08', store_id: STORE_A, customer_id: 'cus-08', staff_id: 'p-01', starts_at: '2026-08-22T00:30:00Z', ends_at: '2026-08-22T01:30:00Z', status: 'booked' },
  { id: 'apt-09', store_id: null, customer_id: 'cus-07', staff_id: null, starts_at: '2026-08-19T07:00:00Z', ends_at: '2026-08-19T08:00:00Z', status: 'booked' },
  { id: 'apt-10', store_id: STORE_B, customer_id: 'cus-04', staff_id: 'p-05', starts_at: '2026-08-23T02:00:00Z', ends_at: '2026-08-23T03:00:00Z', status: 'booked' },
]

/** menu-06 has no store_id: a 全店舗 item, visible in every store. */
export const menus: FixtureMenu[] = [
  { id: 'menu-01', store_id: STORE_A, name: 'テストカット', price: 6600, duration_minutes: 60 },
  { id: 'menu-02', store_id: STORE_A, name: 'テストカラー', price: 12100, duration_minutes: 90 },
  { id: 'menu-03', store_id: STORE_A, name: 'テストトリートメント', price: 4400, duration_minutes: 30 },
  { id: 'menu-04', store_id: STORE_B, name: 'テストパーマ', price: 14300, duration_minutes: 120 },
  { id: 'menu-05', store_id: STORE_B, name: 'テストヘッドスパ', price: 5500, duration_minutes: 45 },
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
