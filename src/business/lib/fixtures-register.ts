// 売上・レジ — PLAY-PHASE money plane (ask T-08's other half).
//
// WHAT THIS FILE MAY STATE, AND WHAT IT MAY NOT. The register knows things no
// booking row carries: which tender the money arrived on, what is still owed,
// what was reversed, what somebody counted in the drawer. Those are here.
// Everything else — who the customer is, what was booked, at what price, at
// what time, in which store — is READ from `./fixtures` and never restated, so
// this plane cannot disagree with the room next door. A booking-backed sale
// therefore carries NO total, NO customer name and NO store: it carries an
// `appointment_id` and the payment facts, and that is all.
//
// TWO AGGREGATES ALREADY EXIST AND THIS PLANE MUST AGREE WITH THEM.
// `fixtures-today.ts`'s `register` holds `refunds`, `cash_difference` and
// `terminal_held`, and 今日の運営 / 予約一覧 already read all three. So:
//   · the terminal's held transactions are NOT restated here — the pending
//     tender on a held sale is DERIVED from `register.terminal_held` (one home,
//     and the two screens count the same 1件);
//   · the reversals below sum to `register.refunds` (¥1,100), pinned;
//   · `cash_counted` minus the cash tenders below equals `register.cash_difference`
//     (¥0), pinned. Nothing here states a difference — a difference is what a
//     count and an expectation make between them.
//
// TIMES ARE JST MINUTES FROM MIDNIGHT, like every other plane, and every one of
// them sits before the pinned `boardNow` (13:24): a register showing money taken
// in the future is exactly the impossible state ⚖ 8/9 forbids.

import { STORE_A, STORE_B } from './fixtures'

/** One line of the 決済手段の台帳. `flag` is what the line MEANS:
 *  · `''`      受領済み — money in
 *  · `pending` 端末内に保持 — charged at the terminal, record not sent
 *  · `unpaid`  未収 — owed, and never counted as received
 *  · `refund`  反対仕訳 — a negative line that never rewrites the original */
export interface FixtureTender {
  label: string
  amount: number
  flag: '' | 'pending' | 'unpaid' | 'refund'
}

export interface FixtureTransaction {
  /** 取引番号 — human-shaped, stable, and the register's own (⚖ L-6). */
  id: string
  /** The booking this sale settles. `null` = 店頭販売, a sale with no booking. */
  appointment_id: string | null
  /** WHERE the money was taken. `null` on a booking-backed sale, because the
   *  booking already says which store it belongs to and a second copy is a
   *  second home (`transactionStore` reads the booking first). Only a 店頭販売
   *  carries its own. */
  store_id: string | null
  /** The person, where the register knows one. `null` = 予約なし・店頭販売 to
   *  someone the shop did not record. */
  customer_id: string | null
  /** 店頭販売 only: what was sold, and for how much. A booking-backed sale takes
   *  its line from the MENU and its total from the booking's 受付価格 — stating
   *  either here would be the second home the A8 rule forbids. */
  item: string | null
  amount: number | null
  /** JST minute the register opened the transaction. */
  at: number
  /** The tenders the register RECORDED. A held card is not here: it is derived
   *  from `register.terminal_held`, where the world already states it. */
  tenders: FixtureTender[]
  /** 監査行 — [時刻, 何が起きたか, 詳細]. Only what the register did; the
   *  booking's own 操作履歴 is merged in from `auditTrail` at read time. */
  audit: Array<[string, string, string]>
}

/** The day's transactions. Five, and every one of them is a state a real money
 *  desk has to be able to show: settled in cash, settled on a card, charged but
 *  held inside an offline terminal, part-paid with a balance owed, and refunded.
 *  The three booking-backed rows are the three bookings the world has already
 *  finished today (apt-12 / apt-22 settled, apt-25 awaiting) — no sale is
 *  invented for a treatment that has not happened. */
export const transactions: FixtureTransaction[] = [
  {
    id: 'TX-4808',
    appointment_id: 'apt-12',
    store_id: null,
    customer_id: null,
    item: null,
    amount: null,
    at: 11 * 60 + 5,
    tenders: [{ label: '現金', amount: 6600, flag: '' }],
    audit: [['11:05', '会計を記録', '現金 ¥6,600 / 受付価格どおり']],
  },
  {
    id: 'TX-4812',
    appointment_id: 'apt-22',
    store_id: null,
    customer_id: null,
    item: null,
    amount: null,
    at: 11 * 60 + 38,
    tenders: [{ label: 'カード', amount: 6600, flag: '' }],
    audit: [['11:38', '会計を記録', 'カード ¥6,600 / 端末送信済み']],
  },
  {
    // The offline-terminal case, and it states NOTHING about the terminal: the
    // pending card line is built from `register.terminal_held`, and the
    // booking's own 操作履歴 already carries 「決済端末が取引を保留」 at 12:15.
    id: 'TX-4827',
    appointment_id: 'apt-25',
    store_id: null,
    customer_id: null,
    item: null,
    amount: null,
    at: 12 * 60 + 15,
    tenders: [],
    audit: [],
  },
  {
    // 一部入金. A retail sale the customer could not finish paying for — the
    // balance is 未収 and it is the reason the closing checklist has a 未収の扱い
    // row to answer. Never counted as received (`unpaid` is excluded from every
    // received sum).
    id: 'TX-5501',
    appointment_id: null,
    store_id: STORE_A,
    customer_id: 'cus-06',
    item: 'ホームケアオイル',
    amount: 3300,
    at: 12 * 60 + 40,
    tenders: [
      { label: '現金', amount: 1700, flag: '' },
      { label: '未収', amount: 1600, flag: 'unpaid' },
    ],
    audit: [
      ['12:40', '店頭販売を記録', 'ホームケアオイル ¥3,300 / 現金 ¥1,700・残額は次回来店時'],
    ],
  },
  {
    // 返金済み. The ¥1,100 `fixtures-today`'s register aggregate already knows
    // about — the original line is KEPT and a reversal is added beside it, which
    // is the whole point of the panel footer's sentence.
    id: 'TX-5502',
    appointment_id: null,
    store_id: STORE_A,
    customer_id: 'cus-05',
    item: 'ホームケアミスト',
    amount: 1100,
    at: 13 * 60 + 5,
    tenders: [
      { label: '現金', amount: 1100, flag: '' },
      { label: '現金 返金', amount: -1100, flag: 'refund' },
    ],
    audit: [
      ['13:05', '返金を実行', '見本 あずさ / 商品違い / 現金 返金 −¥1,100'],
      ['12:52', '店頭販売を記録', 'ホームケアミスト ¥1,100 / 現金 ¥1,100'],
    ],
  },
]

/** 閉店処理 — what the day's close has recorded SO FAR. Every "is it ready"
 *  question is derived from these facts plus the ledger; nothing here stores a
 *  verdict (`closingReadiness` is the one home for all of them). */
export interface FixtureClosing {
  /** 実査額 — what somebody counted in the drawer. 期待額 is derived from the
   *  cash tenders and 差異 from the two, so no difference is stored. */
  cash_counted: number
  /** 差異理由. Empty is only legal while the difference is inside the tolerance
   *  — that rule is `closingReadiness`'s, not this file's. */
  cash_reason: string
  /** Whether the count above has been SAVED to the close, or is a draft. */
  cash_saved: boolean
  /** 未収の扱い — `null` = 未判断. The string is the decision that was recorded. */
  outstanding_decision: string | null
  /** 店舗管理者の確認 — JST minute, or `null` while the close is still waiting
   *  for it. Recorded in a SEPARATE role context (canon's own 店長確認 page),
   *  which is why this room can never set it. */
  manager_signed_at: number | null
  /** 閉店スナップショット — JST minute, or `null` while the day is open. */
  closed_at: number | null
  /** 閉店 v1 / 再開 v2 … — the version a close would be saved as. */
  close_version: number
}

/** ⚖ A CLOSE BELONGS TO ONE STORE. Each register is a physical drawer in a
 *  physical room and each store closes its own day; a single global record would
 *  have put 銀座's ¥8,300 count against 代官山's empty drawer and produced a
 *  ¥8,300 "difference" out of nothing (caught on the first render under the
 *  代官山 lens). Keyed by store, and a store with no row has simply not started
 *  its close. */
export const closing: Record<string, FixtureClosing> = {
  [STORE_A]: {
    // Equal to the cash tenders above (6,600 + 1,700 + 1,100 − 1,100 = ¥8,300),
    // which is what makes the derived difference ¥0 — the same ¥0
    // `fixtures-today`'s `register.cash_difference` states. Pinned both ways.
    cash_counted: 8300,
    cash_reason: '',
    cash_saved: true,
    outstanding_decision: null,
    manager_signed_at: null,
    closed_at: null,
    close_version: 1,
  },
  [STORE_B]: {
    // 代官山 has taken nothing today, and the honest state of a drawer nobody has
    // counted yet is exactly that — not a zero somebody signed for.
    cash_counted: 0,
    cash_reason: '',
    cash_saved: false,
    outstanding_decision: null,
    manager_signed_at: null,
    closed_at: null,
    close_version: 1,
  },
}

/** ⚠SETTINGS-BATCH — 現金差異の承認しきい値 (registry ④). The yen amount a
 *  drawer may be out by before a 店舗管理者 has to approve the difference in
 *  writing before the day can close.
 *
 *  ZERO IS THE DEFAULT FOR A TREATMENT BUSINESS, and it is a judgement about
 *  the business type rather than a constant: a salon takes tens of payments a
 *  day and a drawer that is out at all is a mistake worth a sentence. A shop
 *  running hundreds of small cash sales would set a few hundred yen. The
 *  GUARDRAIL is the mistake-proofing law's: the dial names an amount that may
 *  be waved through WITHOUT a reason, so it can never be raised to a figure
 *  that hides a whole transaction — `MAX_CASH_TOLERANCE` is the ceiling the
 *  settings control must enforce, and the room states it here so no component
 *  ever decides a store's money policy for it.
 *
 *  ⚠ RECONNECT: the 店舗設定 control ships with the settings batch and reads
 *  THIS value. Nothing in the room hardcodes a threshold. */
export const cashTolerance = 0
export const MAX_CASH_TOLERANCE = 1000
