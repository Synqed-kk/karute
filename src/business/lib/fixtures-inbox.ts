// PLAY-PHASE fixtures for 受信トレイ — the MESSAGE facts nothing else in this
// world carries.
//
// ONE FIXTURE WORLD. A thread about a booking IS a booking from `./fixtures` —
// the same rows 今日の運営 paints, 予約一覧 lists and 顧客 reads for 次回予約.
// Nothing about that booking (customer, time, staff, menu, price, source, 予約
// 番号) is restated here; this plane adds only what the message world has and
// keys it to the SAME appointment id, exactly as `./fixtures-reservations` and
// `./fixtures-today` do.
//
// ⚖ THE PLANE STATES NOTHING THE WORLD ALREADY STATES. That is one law with
// three consequences, and each is pinned (and mutated) in the suite:
//
//   · `delivery_state` / `delivery_detail` are non-null ONLY for a thread whose
//     booking has no 次に決めること card. Where a decision exists, the delivery
//     verdict IS that card's own `notification` — one verdict, two desks (A8).
//   · `source_proof` is non-null ONLY for a thread with NEITHER a decision NOR
//     a 予約一覧 exception row. Both of those already carry the 根拠 sentence.
//   · `events` carries only what the booking's own 操作履歴 (`auditTrail`) does
//     not. The 履歴 the screen renders is the two merged, newest first.
//
// CONSENT IS NEVER STORED HERE. 連絡同意 is the 顧客台帳's own field
// (`customers[].consent` + `line_linked`), which is what canon's inbox already
// does (fable-store-inbox.html:499-506 prefers the ledger over the thread's own
// snapshot). Two copies of a consent record is the one contradiction this room
// must never ship, so there is only ever one.
//
// TIMES ARE JST MINUTES FROM MIDNIGHT, like every other time in this world, and
// they are read against the SAME pinned `boardNow` (13:24) the board and 予約
// 一覧 use. ⚖ L-6: no calendar date is stored anywhere — the day comes from the
// booking, which is derived from the clock.

/** 受信トレイ's four categories — canon's own filter chips
 *  (fable-store-inbox.html:449-454). 解決済み is a STATUS, not a category, so it
 *  is not one of these. */
export type ThreadCategory = 'change' | 'noshow' | 'waitlist' | 'delivery'

export interface FixtureThread {
  id: string
  category: ThreadCategory
  /** The category's own mark and wash. Canon gives its resolved thread a 済
   *  mark; ours does not — a mark that changes with status is a second home for
   *  the status verdict, and the pill already carries it (A8). */
  mark: string
  mark_tone: 'indigo' | 'red' | 'amber'
  customer_id: string
  /** `null` = a thread with no booking behind it yet (the 空き待ち case). Its
   *  store is then the customer's own affiliation, derived from where she
   *  books — never a store_id stored on the thread. */
  appointment_id: string | null
  /** 受信時刻, JST minutes from midnight. */
  received: number
  /** 期限. Non-null ONLY for a thread with no 予約一覧 row: a booking-backed
   *  thread's deadline is that row's own `deadline`, borrowed. */
  due: number | null
  /** 受信元 — a fact about the MESSAGE, so it lives here. */
  source: string
  /** 証跡. See the plane law above. */
  source_proof: string | null
  subject: string
  preview: string
  /** 次の対応 — what the store does next, in the store's own words. */
  next: string
  /** The reply the operator would send. Kept because the room SHOWS what it
   *  would say and then refuses to send it (the fence), which is more honest
   *  than a compose box that goes nowhere. */
  reply: string
  delivery_state: 'sent' | 'undelivered' | 'unsent' | null
  delivery_detail: string | null
  /** `[HH:MM, 何が起きたか, 詳細]`, newest first — the same shape `auditTrail`
   *  returns, so the two merge without translation. */
  events: Array<[string, string, string]>
}

export const threads: FixtureThread[] = [
  {
    // 変更希望あり (apt-31), the world's one 期限超過 row. 予約一覧 holds its
    // deadline (12:30, behind the pinned 13:24) and its 根拠 sentence, so this
    // thread states neither. No 次に決めること card, so the delivery verdict IS
    // this plane's.
    id: 'inb-change',
    category: 'change',
    mark: '変',
    mark_tone: 'indigo',
    customer_id: 'cus-04',
    appointment_id: 'apt-31',
    received: 11 * 60 + 48,
    due: null,
    source: 'Reserve お客様メッセージ',
    source_proof: null,
    subject: '予約日時の変更希望',
    preview: '同じ担当のまま、もう少し遅い時間に変更したい',
    next: '空き枠の候補を確認して返信',
    reply:
      'ご連絡ありがとうございます。同じ担当で、ご希望に近い時間の空きをお調べしております。候補が出ましたらこのままご返信いたします。',
    delivery_state: 'unsent',
    // No detail: 「未送信」 already says the whole of it, and a second clause
    // repeating it only wrapped badly in the fact grid.
    delivery_detail: null,
    events: [],
  },
  {
    // 担当変更の仮押さえ (apt-26). 次に決めること dec-recovery owns both the
    // deadline (13:45, via 予約一覧's row) and the notification verdict
    // (`unsent`), so this thread states neither — one exception, two desks.
    id: 'inb-recovery',
    category: 'change',
    mark: '変',
    mark_tone: 'indigo',
    customer_id: 'cus-11',
    appointment_id: 'apt-26',
    received: 13 * 60 + 2,
    due: null,
    source: '店舗記録 / 担当変更',
    source_proof: null,
    subject: '担当変更のご相談（仮押さえ中）',
    preview: '別の担当で仮押さえ済み。お客様の同意がまだ取れていません',
    next: '仮押さえの内容を伝えて同意をもらう',
    reply:
      '本日のご予約について、担当者の都合により別の担当でお席をお取りしております。時間と料金は変わりません。このままでよろしいかご返信ください。',
    delivery_state: null,
    delivery_detail: null,
    events: [],
  },
  {
    // 担当不在で移せない (apt-27). dec-absence owns the verdict; 予約一覧 owns
    // the 16:30 deadline and the 根拠.
    id: 'inb-absence',
    category: 'change',
    mark: '変',
    mark_tone: 'indigo',
    customer_id: 'cus-07',
    appointment_id: 'apt-27',
    received: 13 * 60 + 3,
    due: null,
    source: '店舗記録 / 担当不在',
    source_proof: null,
    subject: '担当不在のご連絡と日時変更のお願い',
    preview: '同じ資格を持つ空きがなく、日時の変更をお願いする必要があります',
    next: '事情をお伝えして候補日時を送る',
    reply:
      '本日のご予約について、担当者が急遽勤務できなくなりました。同じ内容でご案内できる日時をいくつかご提案いたします。ご都合をお知らせください。',
    delivery_state: null,
    delivery_detail: null,
    events: [],
  },
  {
    // 確認SMS未達 (apt-28). 予約一覧's own comment says the remaining work here
    // is a message, and messages are 受信トレイ's — this is that thread.
    // dec-sms owns the verdict (`undelivered`) and its 再送の記録.
    //
    // ⚖ DELIBERATE, AND THE ONE PLACE THIS WORLD SHOWS A FAILED DELIVERY AGAINST
    // AN UNRECORDED CONSENT (packet §2): the message that failed is Reserve's
    // own 予約確認通知, which rides the booking channel. The STORE's follow-up is
    // what needs 連絡同意, and this customer (cus-09) has NO consent record at
    // all — so the room refuses to pick a channel and says why. That is exactly
    // the surface canon's consent warning exists to show, and it is the
    // difference between 「同意なし」 and 「未記録」 rendered honestly.
    id: 'inb-delivery',
    category: 'delivery',
    mark: '配',
    mark_tone: 'red',
    customer_id: 'cus-09',
    appointment_id: 'apt-28',
    received: 9 * 60 + 5,
    due: null,
    source: 'Reserve 自動通知',
    source_proof: null,
    subject: '予約確認SMSが届いていません',
    preview: '1回目が未達。店舗からの追加連絡には連絡同意の確認が必要です',
    next: '連絡同意を確認してから追加の連絡を行う',
    reply: '',
    delivery_state: null,
    delivery_detail: null,
    events: [
      ['09:06', '代替の連絡方法を確認', '連絡同意の記録がないため送信先を選べません'],
      ['09:05', '予約確認SMSが未達', '配信事業者から不達の通知'],
    ],
  },
  {
    // 来店なし (apt-23). dec-noshow is `resolved` and `sent`, and the booking's
    // own 操作履歴 carries the 11:45 row — so this thread is the store's record
    // of a message task that is already finished. Its status is the world's,
    // not canon's: canon's noshow thread is 期限超過 because canon's world had
    // not answered it; ours has (⚖ 8/9 — state what the data holds).
    id: 'inb-noshow',
    category: 'noshow',
    mark: '無',
    mark_tone: 'red',
    customer_id: 'thin-01',
    appointment_id: 'apt-23',
    received: 11 * 60 + 45,
    due: null,
    source: '店舗記録 / 来店確認',
    source_proof: null,
    subject: '来店がありませんでした',
    preview: '開始15分後まで待機し、電話に応答がありませんでした',
    next: '対応完了（請求なし・外部予約元へ反映済み）',
    reply: '',
    delivery_state: null,
    delivery_detail: null,
    events: [],
  },
  {
    // 空き待ち — the one thread with NO booking, which is what a 空き待ち is:
    // a request for a slot that does not exist yet. It therefore has no
    // decision, no 予約一覧 row and no store of its own, so all three of the
    // plane's own fields are stated here and its store comes from the
    // customer's affiliation (cus-03 books only at テスト代官山店).
    //
    // The contact story is the 顧客 screen's own: cus-03 has a 保護者 who takes
    // every booking and every message (fixtures.ts party rows) and all three
    // consent flags are explicitly false. No channel is available, and the room
    // says so rather than proposing one.
    id: 'inb-wait',
    category: 'waitlist',
    mark: '待',
    mark_tone: 'amber',
    customer_id: 'cus-03',
    appointment_id: null,
    received: 9 * 60 + 42,
    due: 18 * 60,
    source: '電話 / 空き待ち申込',
    source_proof:
      '保護者の見本 みなと様から電話で空き待ちを承りました。候補の枠はまだ確保していません。',
    subject: '空き待ちのお申し込み',
    preview: '空きが出たら連絡してほしい。連絡はすべて保護者へ',
    next: '空き枠が出たら回答期限つきで提案',
    reply:
      '空き待ちを承っております。ご希望の時間に空きが出ましたら、回答期限つきでお席をお取りしてご連絡いたします。',
    delivery_state: 'unsent',
    delivery_detail: '未提案 / 枠は未確保',
    events: [
      ['09:44', '対応キューへ追加', '見本 あずさ'],
      ['09:42', '空き待ちを受付', '電話 / 保護者から'],
    ],
  },
]
