// PLAY-PHASE fixtures for 予約一覧 — the exception-desk facts the booking
// calendar cannot express on its own.
//
// ONE FIXTURE WORLD. Every row on the 予約 list IS an appointment from
// `./fixtures` — the same rows the Today board paints and the 顧客 screen reads
// for 次回予約. Nothing about a booking (customer, time, staff, bed, price,
// source, settlement, board state) is restated here; this plane adds only what
// core has no field for and keys it to the SAME appointment id, exactly as
// `./fixtures-today` does for the board.
//
// WHAT IS HERE vs WHAT IS DERIVED — the split matters, because a fact stored in
// two places is a contradiction waiting to happen:
//
//   stored here    pending (ask C-1) · deadline (C-2) · flags (C-5) ·
//                  根拠 (C-10) · 操作履歴 (C-6/M-51)
//   derived        the 7 lifecycle words (from status + board_state +
//                  settlement + `pending`) · 期限超過 · 担当変更あり (from the
//                  booking's own `reassigned_from`) · 精算期限 (= 閉店) ·
//                  受付元ラベル (from the booking's `source`) · 価格条件 (from
//                  the customer) · 勤務時間 warnings + 空き枠候補 (from the
//                  shift / sell-slot planes `./fixtures-today` already carries)
//
// DEADLINES ARE JST MINUTES FROM MIDNIGHT, like every other time in
// `./fixtures-today`, and they are read against the SAME pinned `boardNow`
// (13:24). A deadline stored as "overdue" would be a second copy of a fact the
// clock already knows; here 期限超過 is only ever `deadline < boardNow`.

/** The per-booking exception record. Absent = a booking with nothing pending:
 *  no deadline, no flags, no queue card. */
export interface FixtureReservation {
  appointment_id: string
  /** Ask C-1 — a request awaiting a human yes/no, which core cannot express
   *  (its AppointmentStatus has no PENDING). The booking's `board_state` is
   *  null for the same reason: an unaccepted request holds no floor. */
  pending: boolean
  /** Ask C-2 — 回答期限 / 対応期限, JST minutes from midnight. `null` = no
   *  deadline, so the row never reaches the 要対応 queue. The 精算期限 is NOT
   *  here: it is 閉店 (`operatingHours.close`), derived. */
  deadline: number | null
  /** Ask C-5 — the stored half of 状態フラグ. 期限超過 and 担当変更あり are
   *  derived and must never appear in this array. */
  flags: string[]
  /** Ask C-10 — the 根拠 sentence under 価格の証拠. A booking without one gets a
   *  sentence derived from its own provenance rather than an invented story. */
  proof: string
}

export const NEEDS_STAFF = '担当変更が必要（安全な候補なし）'
export const WANTS_CHANGE = '変更希望あり'

export const reservations: FixtureReservation[] = [
  {
    // The Reserve request. 14:00 deadline = 36 minutes after the pinned 13:24.
    appointment_id: 'apt-30',
    pending: true,
    deadline: 14 * 60,
    flags: [],
    proof: 'Reserveから届いた新規リクエストです。受付枠・担当資格・設備・受付価格・通知先を確認してから確定します。',
  },
  {
    // The overdue one. 12:30 is behind 13:24, so the row carries 期限超過 —
    // derived from the clock, never stored as a flag.
    appointment_id: 'apt-31',
    pending: false,
    deadline: 12 * 60 + 30,
    flags: [WANTS_CHANGE],
    proof: 'お客様から日時変更のご希望です。受付価格は変更せず、空き枠候補から選び直します。',
  },
  {
    // 担当不在. Same booking, same 16:30 deadline and same 「安全な候補なし」
    // finding as the board's 担当不在 decision card (fixtures-today.ts
    // dec-absence) — one exception, two desks.
    appointment_id: 'apt-27',
    pending: false,
    deadline: 16 * 60 + 30,
    flags: [NEEDS_STAFF],
    proof: '担当者が勤務不可となり、同じ資格を持つ空き枠が見つかりません。受付価格は保持したまま移せる先を探しています。',
  },
  {
    // The 仮押さえ. 13:45 is the board's 担当変更 decision deadline
    // (dec-recovery) to the minute; the suite pins the two together.
    appointment_id: 'apt-26',
    pending: false,
    deadline: 13 * 60 + 45,
    flags: [],
    proof: '担当者の勤務不可により別の担当へ仮押さえ済みです。お客様の同意までは仮押さえのまま、受付価格も変えていません。',
  },
  {
    // 確認SMS未達 — the board's dec-sms card, as a row flag. No deadline, so it
    // is a flag on the list and not a queue card: the remaining work is a
    // message, and messages are 受信トレイ's.
    appointment_id: 'apt-28',
    pending: false,
    deadline: null,
    flags: ['確認SMS未達'],
    proof: '確認SMSが1回目未達、2回目は送信済みです。電話番号は登録済みで、返信期限はありません。',
  },
  {
    appointment_id: 'apt-25',
    pending: false,
    deadline: null,
    flags: [],
    proof: '施術は終了しています。レジ取引が未作成のため、閉店処理を止めています。',
  },
  {
    appointment_id: 'apt-23',
    pending: false,
    deadline: null,
    flags: [],
    proof: '開始15分後まで待機し、電話1回に応答がありませんでした。請求は発生せず、外部予約元へ反映済みです。',
  },
  {
    appointment_id: 'apt-32',
    pending: false,
    deadline: null,
    flags: [],
    proof: '外部予約元が正本です。SYNQEDからは日時・担当・受付価格を変更しません。',
  },
]

/** 操作履歴 (M-51 / ask C-6). `[HH:MM, 何をしたか, 詳細]`, newest first — the
 *  shape `audit.list()` returns once the owner-only read opens to 店舗管理者.
 *  A booking nobody has touched is ABSENT here and the inspector says so; an
 *  invented 「作成しました」 row would be the untrue-affirmative defect class. */
export const auditTrail: Record<string, Array<[string, string, string]>> = {
  'apt-30': [
    ['13:06', '空き枠を仮確認', '見本 しろう / ベッド2 — 確定はしていません'],
    ['13:05', 'Reserveからリクエストを受信', '見本 かえる / 受付価格 ¥6,600 / 回答期限 14:00'],
  ],
  'apt-31': [
    ['12:30', '回答期限を超過', '自動辞退はしていません。予約は残っています'],
    ['11:48', '変更希望を受信', 'お客様希望 / 日時の変更'],
  ],
  'apt-27': [
    ['13:03', '安全な担当変更候補を検索', '同じ資格を持つ空き枠は該当なし'],
    ['13:02', '担当者が勤務不可', '見本 はなこ / 体調不良のため早退'],
  ],
  'apt-26': [
    ['13:02', '担当を仮押さえ', '見本 はなこ → 見本 しろう / 受付価格を保持'],
  ],
  'apt-25': [
    ['12:15', '決済端末が取引を保留', 'カード T-02 / C-8821'],
    ['12:00', '施術終了を記録', '見本 ごろう'],
  ],
  'apt-23': [
    ['11:45', '来店なしとして記録', '外部予約元へ反映済み / 請求なし'],
  ],
  'apt-32': [
    ['09:12', '外部予約元から取込', '日時・担当・受付価格は外部予約元が正本'],
  ],
}
