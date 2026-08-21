// PLAY-PHASE fixtures for 今日の運営 — the board planes the booking calendar
// cannot express on its own.
//
// The Today board composites SIX data planes and core exposes THREE of them
// (contract `CONTRACT-today-board-2026-08-18.md` §0). Bookings, people and
// menus live in `./fixtures`, where the 顧客 screen already reads them. The
// other three — shifts/absence/breaks, resources (ベッド・設備), and
// register/settlement — have no core surface at all (asks T-01…T-08), so they
// live here, as their own typed rows, keyed to the SAME staff, store and
// booking ids. Nothing is duplicated: a booking's time, price and customer are
// read from `./fixtures` and never restated in this file.
//
// TIMES ARE MINUTES FROM JST MIDNIGHT. The board is a minute axis, so every
// lane element is placed from one integer and nothing on the board parses a
// clock string. Dates never appear here at all — the day comes from
// `./clock`'s anchor, so this scene is populated on any real date (⚖ L-6).
//
// THE BOARD IS A PINNED SCENE. `boardNow` is a fixture value, not the wall
// clock: a day board is only coherent from one moment (things behind the line
// are done and settled, things ahead of it are not), and a demo whose morning
// shows a 14:30 booking already settled would be exactly the impossible state
// ⚖ 8/9 forbids. Canon pins its own board the same way, at the same 13:24.

import { STORE_A, STORE_B } from './fixtures'

/** Store opening hours (ask T-18 — core has no per-store hours). Every booking
 *  in `./fixtures` sits inside this window, and the timeline is exactly it. */
export const operatingHours = { open: 10 * 60, close: 19 * 60 }

/** The moment the board is showing, JST minutes from midnight. See the header. */
export const boardNow = 13 * 60 + 24

/** 勤務 + 休憩 (ask T-01). One row per staff member, applied to every day the
 *  store is open — the sample business runs one roster, so the board is
 *  populated whichever day you land on. Breaks sit INSIDE the shift and no
 *  booking in `./fixtures` overlaps one; both are asserted, not assumed. */
export interface FixtureShift {
  staff_id: string
  start: number
  end: number
  breaks: Array<{ start: number; end: number }>
}

export const shifts: FixtureShift[] = [
  { staff_id: 'p-01', start: 10 * 60, end: 19 * 60, breaks: [{ start: 12 * 60, end: 12 * 60 + 30 }] },
  { staff_id: 'p-04', start: 10 * 60, end: 18 * 60, breaks: [{ start: 13 * 60, end: 14 * 60 }] },
  { staff_id: 'p-05', start: 10 * 60, end: 17 * 60, breaks: [{ start: 12 * 60 + 30, end: 13 * 60 + 30 }] },
  { staff_id: 'p-06', start: 10 * 60, end: 19 * 60, breaks: [{ start: 13 * 60 + 30, end: 14 * 60 }] },
  { staff_id: 'c-03', start: 11 * 60, end: 19 * 60, breaks: [{ start: 15 * 60, end: 16 * 60 }] },
  { staff_id: 'p-02', start: 10 * 60, end: 19 * 60, breaks: [{ start: 14 * 60, end: 15 * 60 }] },
  // p-09 has NO shift row on purpose: a roster member who is not working today.
  // The lane renders and says so, rather than vanishing without explanation.
]

/** 定休日 (ask T-18b — core has no closing-day model either). The weekday the
 *  store is shut, as `Date#getDay` numbers it. The month calendar reads it, and
 *  its legend says which day it is rather than leaving 定休 unexplained. */
export const closedWeekday = 1

/** 定価 per staff member (ask T-19 — core has no per-person price list). The
 *  input to the dynamic-pricing curve: a slot's 公開価格 is this figure carried
 *  through the store's 最高価格 lever and the hour curve, never a stored number
 *  per slot. p-09 is reception and takes no treatments, so it has no 定価. */
export const staffListPrice: Record<string, number> = {
  'p-01': 7000,
  'p-04': 7700,
  'p-05': 8800,
  'p-06': 7700,
  'c-03': 7000,
  'p-02': 7700,
}

/** 資格 (ask T-13). Drives the lane sub-label and the 稼働率 denominator —
 *  a receptionist with no treatment qualification is not idle capacity. */
export const staffQualifications: Record<string, string[]> = {
  'p-01': ['整体', '小顔'],
  'p-04': ['整体', '美容'],
  'p-05': ['整体'],
  'p-06': ['整体', '美容'],
  'c-03': ['整体'],
  'p-02': ['整体'],
  'p-09': ['受付', '会計'],
}

/** 勤務不可 (ask T-02) — the incident the whole 本日の運営影響 band is about.
 *  One record, and everything downstream (the wash, the shortened shift, the
 *  suppressed lane card, the 担当不在 decision) is derived from it. */
export interface FixtureAbsence {
  staff_id: string
  store_id: string
  /** JST minute from which the staff member is no longer available. */
  from: number
  reason: string
  /** 受付停止 — the first recovery step, already done at the source. */
  intake_stopped: boolean
}

export const absence: FixtureAbsence = {
  staff_id: 'p-01',
  store_id: STORE_A,
  from: 13 * 60,
  reason: '体調不良のため早退',
  intake_stopped: true,
}

/** ベッド・設備 (ask T-04). `cleanup_minutes` is the turnaround the board paints
 *  as 予約不可 after every booking on the resource — a rule, not a list of
 *  hand-placed blocks, so a bed can never be shown turning over in zero time. */
export interface FixtureResource {
  id: string
  store_id: string
  name: string
  note: string
  cleanup_minutes: number
  /** ⚠SETTINGS-BATCH — 部屋クラス (⚖ Liam 2026-08-21, flag 51). The bed's own
   *  class as DATA, because the auto-allocator has to know which rooms are
   *  interchangeable and a board component may never decide that by reading a
   *  room's display name. `note` is the sentence the operator reads; this is the
   *  fact the allocator acts on, and the two are stated side by side so they can
   *  never disagree. The 店舗設定 control ships with the settings batch. */
  room_class: RoomClass
}

/** ⚠SETTINGS-BATCH — 施術室 (interchangeable) vs 個室/VIP (reserved). */
export type RoomClass = 'standard' | 'private'

export const resources: FixtureResource[] = [
  { id: 'bed-01', store_id: STORE_A, name: 'ベッド1', note: '施術室A', cleanup_minutes: 30, room_class: 'standard' },
  { id: 'bed-02', store_id: STORE_A, name: 'ベッド2', note: '施術室A', cleanup_minutes: 30, room_class: 'standard' },
  { id: 'bed-03', store_id: STORE_A, name: 'ベッド3', note: '個室 / VIP対応', cleanup_minutes: 30, room_class: 'private' },
  { id: 'bed-04', store_id: STORE_B, name: 'ベッド1', note: '施術室B', cleanup_minutes: 30, room_class: 'standard' },
]

/** Non-booking board blocks (ask T-05): not appointments (no customer), not
 *  shifts. 休憩 is NOT here — it comes from the shift row, so a break has one
 *  home and cannot drift out of its own shift. `micro` is canon's narrow
 *  treatment for the sub-20-minute ones. */
export interface FixtureBlock {
  id: string
  store_id: string
  kind: string
  staff_id: string | null
  resource_id: string | null
  start: number
  end: number
  micro: boolean
  note: string
}

export const blocks: FixtureBlock[] = [
  { id: 'blk-01', store_id: STORE_A, kind: '準備', staff_id: 'p-04', resource_id: null, start: 14 * 60 + 15, end: 14 * 60 + 30, micro: true, note: '次の予約の準備。予約は入れられません。' },
  { id: 'blk-02', store_id: STORE_A, kind: '記録', staff_id: 'p-04', resource_id: null, start: 15 * 60 + 30, end: 15 * 60 + 45, micro: true, note: '施術記録と片付け。予約は入れられません。' },
  { id: 'blk-03', store_id: STORE_A, kind: 'レジ', staff_id: 'p-04', resource_id: null, start: 17 * 60 + 30, end: 17 * 60 + 50, micro: true, note: 'レジ締め業務。予約は入れられません。' },
  { id: 'blk-04', store_id: STORE_A, kind: '指名予約', staff_id: 'c-03', resource_id: null, start: 16 * 60 + 30, end: 17 * 60 + 30, micro: false, note: '指名のご依頼を受けるための保留枠です。' },
]

/** 販売可能枠 (asks T-06 + T-07). A real board computes these from shifts,
 *  breaks, qualifications, resources and buffers; nothing in core can, so the
 *  slots are stated here and the honesty table says so. Each one is checked
 *  against the day it belongs to: staff free, resource free, inside the shift. */
export interface FixtureSellSlot {
  id: string
  store_id: string
  staff_id: string
  resource_id: string
  start: number
  end: number
  price_low: number
  price_high: number
}

export const sellSlots: FixtureSellSlot[] = [
  { id: 'slot-01', store_id: STORE_A, staff_id: 'p-04', resource_id: 'bed-02', start: 16 * 60, end: 17 * 60, price_low: 6600, price_high: 7130 },
  { id: 'slot-02', store_id: STORE_A, staff_id: 'c-03', resource_id: 'bed-01', start: 17 * 60 + 30, end: 18 * 60 + 30, price_low: 6600, price_high: 7260 },
]

/** HQ pricing frame for the Reserve dialog (ask ② `pricing.active` — reachable,
 *  app-unbuilt; the approval step in canon's 「佐藤承認」 has no model at all). */
export const pricingRule = {
  base: 6600,
  hq_min: 6600,
  hq_max: 7260,
  version: 'HQ v12',
  /** When HQ approved this rule — canon's ルール row is version / approved-at /
   *  approver, and a row that quietly drops the timestamp cannot answer 「いつの
   *  ルールで売っているのか」. JST minute-of-day plus how many days back. */
  approved_days_ago: 18,
  approved_minute: 9 * 60,
  approved_by: '見本 たろう',
  protected: { ticket: 4, vip: 2, walkin: 3 },
}

/** スキマガード / Reserve受付 dials (canon `opsConfig`). The board never
 *  advertises a start Reserve's own rules could not take, so the customer-facing
 *  grid lives here rather than in the board's own code. */
export const opsConfig = {
  bookingStepMin: 30,
  blockStepMin: 5,
  reserveStartGridMin: 60,
  gapFillMinMin: 30,
  gapFillDiscountPct: 10,
  standardSessionMin: 60,
  /** ⚖ Liam 2026-08-21 — 販売可能な最小の長さ. Under this the board advertises
   *  nothing: the leftover stays plain track. Fragments are a salvage market,
   *  and a 20-minute orphan is not stock — it is the phone call that costs the
   *  hour. The 店舗設定 control for it ships with the settings batch. */
  minSellableMin: 30,
  /** ⚖ Liam 2026-08-20: the guard SHIPS ON in the fixture world. Canon's own
   *  copy leaves this 'off' and puts the 配置ガイド behind a page-local demo
   *  chip, which made the 表示設定 toggle a dead lever — it flipped the copy
   *  and rendered nothing. Standard is the honest default for a board whose
   *  whole subject is what can and cannot be placed. */
  gapGuardMode: 'standard' as 'off' | 'standard' | 'strict',
  newClientSessionMin: 90,
  leadTimeMin: 60,
  /** ⚠SETTINGS-BATCH — 部屋の自動割り当てポリシー (⚖ Liam 2026-08-21, flag 51:
   *  「people are chosen, rooms are solved」). The bed is re-solved at every
   *  landing, and these two dials are the only judgements in that solve. Both
   *  are Fable defaults and OVERTURNABLE: the 店舗設定 control ships with the
   *  settings batch, with per-business-type defaults and the self-harm
   *  guardrails the mistake-proofing law asks for. Stated here rather than in
   *  the allocator so no component ever hardcodes a store's room policy. */
  roomPolicy: {
    /** VIP/個室クラスの予約は個室から自動で出さない — 個室が埋まっていれば、
     *  その予約にとってはそこが満室. */
    vipStaysPrivate: true,
    /** 通常の予約が個室を取れるのは、施術室に空きがないときだけ. */
    privateIsLastResort: true,
  },
}

/** レジ (ask T-08). The aggregates the money band shows that no booking row
 *  carries: cash variance, refunds, and the transactions the terminal is still
 *  holding. Everything else in the band is summed from the bookings. */
export const register = {
  cash_difference: 0,
  /** Refund tenders, subtracted from gross to reach 純売上 (KPI K2). */
  refunds: 1100,
  /** A LIST, not one transaction: the board counts these out loud (「端末保持
   *  N件」), a register can hold more than one at a time, and — the reason it
   *  matters here — HOLDING NOTHING has to be sayable. An empty list is the
   *  normal state of a day that is not today, so the 閉店阻害 row and the
   *  照合 dialog have an honest zero to render instead of another day's
   *  ¥6,600. */
  terminal_held: [
    {
      appointment_id: 'apt-25',
      amount: 6600,
      terminal: 'カード T-02',
      idempotency_id: 'C-8821',
      at: 12 * 60 + 15,
    },
  ],
}

/** 次に決めること (ask T-15). Core has no exception model, so every card is
 *  stated here — but only its JUDGEMENT half. The customer name, time, price
 *  and staff on each card are read from the booking it points at, so a decision
 *  can never disagree with the board it sits under.
 *
 * `state` decides the counting: only `open` cards reach the badges (canon's own
 *  rule, spelled out in its 判断と閉店阻害 dialog), while `waiting` and
 *  `resolved` stay in the list as history. */
export interface FixtureDecision {
  id: string
  store_id: string
  kind: '担当変更' | 'レジ' | 'Reserve販売' | '担当不在'
  appointment_id: string | null
  sell_slot_id: string | null
  deadline: string
  deadline_tone: '' | 'overdue' | 'opportunity'
  urgent: boolean
  state: 'open' | 'waiting' | 'resolved'
  /** The staff member this decision is waiting on — drives 自分の未処理 (D2). */
  owner_staff_id: string | null
  /** Inspector status pill (G4) and its canon tone class. */
  status: string
  status_tone: '' | 'checkout' | 'public' | 'waiting' | 'done'
  /** Card sub-line (J2–J5 second row). */
  detail: string
  /** Inspector proof box (G7): the heading, then one line per check. */
  proof_title: string
  proofs: string[]
  /** お客様連絡 (asks T-10 / T-16). Three states, not two: 「まだ送っていない」
   *  and 「送ったが届かなかった」 are different problems and the ops strip counts
   *  them in different cells. */
  notification: 'sent' | 'undelivered' | 'unsent'
}

export const decisions: FixtureDecision[] = [
  {
    id: 'dec-recovery', store_id: STORE_A, kind: '担当変更',
    appointment_id: 'apt-26', sell_slot_id: null,
    deadline: '13:45まで', deadline_tone: '', urgent: true, state: 'open',
    owner_staff_id: 'p-06',
    status: '担当変更が必要', status_tone: '',
    detail: '見本 はなこ欠勤 / 見本 しろう + ベッド1が成立',
    proof_title: '見本 しろう + ベッド1が成立',
    proofs: ['整体資格が一致', '勤務18:00まで / 休憩外', 'ベッド1と清掃30分を確保', '予約時価格を保持'],
    notification: 'unsent',
  },
  {
    id: 'dec-checkout', store_id: STORE_A, kind: 'レジ',
    appointment_id: 'apt-25', sell_slot_id: null,
    deadline: '84分経過', deadline_tone: 'overdue', urgent: true, state: 'open',
    owner_staff_id: 'p-05',
    status: '精算待ち', status_tone: 'checkout',
    detail: '12:00施術終了 / 単発 / 未精算',
    proof_title: '精算前の照合',
    proofs: ['予約と施術記録が一致', '追加メニューなし', '回数券・VIPの消化なし', '決済端末は接続済み'],
    notification: 'sent',
  },
  {
    id: 'dec-capacity', store_id: STORE_A, kind: 'Reserve販売',
    appointment_id: null, sell_slot_id: 'slot-01',
    deadline: '公開可能', deadline_tone: 'opportunity', urgent: false, state: 'open',
    owner_staff_id: null,
    status: '安全に公開可能', status_tone: 'public',
    detail: '見本 しろう + ベッド2 / 新規オンライン単発',
    proof_title: '公開しても崩れないこと',
    proofs: ['勤務時間内 / 休憩外', 'ベッド2と清掃30分を確保', '既存予約の変更なし', 'HQ範囲内の価格'],
    notification: 'sent',
  },
  {
    id: 'dec-absence', store_id: STORE_A, kind: '担当不在',
    appointment_id: 'apt-27', sell_slot_id: null,
    deadline: '16:30まで', deadline_tone: '', urgent: true, state: 'open',
    owner_staff_id: null,
    status: '担当不在', status_tone: '',
    detail: '見本 はなこ欠勤 / 安全な変更候補なし',
    proof_title: '安全な担当変更候補なし',
    proofs: ['整体資格を持つ空きなし', '設備は確保できる', '価格は保持したまま移動できる', 'お客様連絡は未送信'],
    notification: 'unsent',
  },
  // History — in the 判断と閉店阻害 list, never in the badge counts.
  {
    id: 'dec-sms', store_id: STORE_A, kind: 'Reserve販売',
    appointment_id: 'apt-28', sell_slot_id: null,
    deadline: '返信待ち', deadline_tone: '', urgent: false, state: 'waiting',
    owner_staff_id: 'c-03',
    status: '返信待ち', status_tone: 'waiting',
    detail: '確認SMSが未達 / 再送済み',
    proof_title: '再送の記録',
    proofs: ['1回目 未達', '2回目 送信済み', '電話番号は登録済み', '返信期限なし'],
    notification: 'undelivered',
  },
  {
    id: 'dec-noshow', store_id: STORE_A, kind: '担当変更',
    appointment_id: 'apt-23', sell_slot_id: null,
    deadline: '完了', deadline_tone: '', urgent: false, state: 'resolved',
    owner_staff_id: 'p-04',
    status: '完了', status_tone: 'done',
    detail: '来店なしとして記録済み / 請求なし',
    proof_title: '来店なしの記録',
    proofs: ['開始15分後まで待機', '電話1回 / 応答なし', '請求は発生しない', '外部予約元へ反映済み'],
    notification: 'sent',
  },
]

/** The store's own recovery ladder for the incident band (I5). Step 1 is
 *  answered by the absence record; steps 2–4 move on the board's own actions. */
export const recoverySteps = ['受付停止', '再配置の仮押さえ', 'お客様連絡', '安全確認後に再公開'] as const
