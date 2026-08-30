// カルテ — PLAY-PHASE record plane (the computer door onto the phone app's own
// records: one truth, two doors).
//
// WHAT THIS FILE MAY STATE, AND WHAT IT MAY NOT. A karute record knows things no
// booking row carries: what was written down in the session, what the AI made of
// it, which photos were taken, what message was drafted, whether the session was
// recorded, how it ended, and — when it was thrown away — who threw it away and
// why. Those are here. Everything else — WHO the customer is, WHEN the session
// happened, in WHICH store, with WHICH staff member, under WHICH menu — is READ
// from `./fixtures` through the booking this record joins, and never restated.
// A record therefore carries an `appointment_id` and NOTHING that the booking
// already answers: no customer name, no date, no store, no staff, no service.
//
// ⚠ THIS IS THE W7 BREACH CLASS, PINNED. The rejected W7 candidate
// (BLOCKER-2026-08-17-W7-RECORDING-KARUTE.md) deleted two canonical fixture
// assertions to make its own plane fit. This plane ADDS assertions and replaces
// none: `src/business/lib/fixtures.ts` is read-only from here, and the room's
// suite proves every record resolves against a booking that already existed.
//
// ⚖ THE DISCARD DOCTRINE IS DATA, NOT DISPLAY (Liam 8/20, amended 8/25).
// A discarded record is KEPT IN FULL — the row exists for everyone, grayed, and
// the written reason attaches to it. So `discarded` is a fact this plane holds,
// with the reason as free text, exactly as the phone's own discard row does.
// Who may READ that content is a permission question, answered in `karute.ts`
// and enforced BEFORE the props are serialized — never by hiding a string the
// browser was handed anyway.
//
// TIMES ARE JST MINUTES FROM MIDNIGHT on the record's own session day, like
// every other plane. Nothing here is an absolute date (⚖ L-6): the booking owns
// the calendar, and a record cannot drift away from the session it describes.

/** The eight session categories, and they are the PHONE'S — `SessionCategory`
 *  in `src/components/karute/redesign/detail/CurrentSessionCard.tsx`. Business
 *  is the second door onto one record, so the drawers a staff member writes into
 *  on the phone are the drawers the computer reads back. */
export type KaruteCategory =
  | 'concern'
  | 'condition'
  | 'lifestyle'
  | 'treatment'
  | 'preference'
  | 'product'
  | 'next'
  | 'note'

/** One written line of the session. `author` is the phone's own provenance
 *  (`EntryAuthor`): 'staff' is what the 手書き chip means, and a staff-authored
 *  line is the one thing 再生成 must never overwrite. */
export interface FixtureKaruteEntry {
  category: KaruteCategory
  text: string
  author: 'ai' | 'staff'
}

/** 写真記録 — a caption and the drawer it belongs in, and NOTHING ELSE. There is
 *  no url, no id, no bytes: this room renders captions and counts, and the
 *  viewer/compare surface is registry ③. A field for an image the room cannot
 *  show would be a contract invented ahead of its capability. */
export interface FixtureKarutePhoto {
  category: 'ビフォー' | 'アフター' | '参考' | '経過'
  caption: string
}

/** One row of 編集履歴. `minute` is JST minutes from midnight ON THE SESSION DAY
 *  — the label is composed from the booking's own date, so an edit can never
 *  claim a day the session did not happen on. */
export interface FixtureKaruteEdit {
  minute: number
  /** WHO — by roster id, never by name. The person who edits a summary need not
   *  be the person who gave the treatment, so this is a fact the record has to
   *  hold; their NAME is the roster's to state, exactly as the record's 担当
   *  resolves through the booking. */
  by_staff_id: string
  note: string
}

/** ⚖ THE DISCARD ROW (Liam 8/17 vocabulary ruling + 8/20 retention ruling).
 *  A REQUIRED written reason, free text, no menu and no pre-select: discarding
 *  is abnormal by definition, so the staffer says why in their own words. Kept
 *  forever beside the record it explains. */
export interface FixtureKaruteDiscard {
  minute: number
  /** WHO — by roster id, for the same reason the edit row carries one. */
  by_staff_id: string
  reason: string
}

export interface FixtureKaruteRecord {
  /** カルテ番号 — human-shaped, stable, and the record's own (⚖ L-6). */
  id: string
  /** THE JOIN. Date, store, customer, staff and menu all resolve through this
   *  one id; the record states none of them. */
  appointment_id: string
  entries: FixtureKaruteEntry[]
  /** 詳細記録, as the AI wrote it. `null` = the AI has not produced one yet,
   *  which is what AI補完待ち MEANS — never an empty string standing in for it. */
  summary_ai: string | null
  /** The human overlay, when somebody rewrote it. `null` = untouched, and that
   *  is the whole of what the amber pencil reads (`summary_edited` on the
   *  phone's own DTO). */
  summary_edited: string | null
  /** 編集履歴 — newest first, and empty is the honest state of a summary nobody
   *  has touched. */
  summary_edits: FixtureKaruteEdit[]
  /** The AI summary's own state: 'confirmed' = 確認済み, 'draft' = 下書き.
   *  Meaningless while `summary_ai` is null, and `karute.ts` is the one place
   *  that decides what the pair MEANS. */
  summary_state: 'confirmed' | 'draft' | null
  photos: FixtureKarutePhoto[]
  /** AI提案メッセージ — the LINE draft. `null` = none was produced. */
  ai_message: string | null
  /** 録音 — `null` = this session was never recorded, which is why the room can
   *  say 「この記録に紐づく録音はありません」 rather than guessing. `consent` is the
   *  同意確認済 badge. The TRANSCRIPT is deliberately absent from this plane:
   *  ⚖ D3 (Liam 8/30) makes transcript visibility a per-business setting
   *  (dial #16 文字起こしの公開範囲), server-enforced at the data door, and v1
   *  ships no transcript door in either mode — so the room holds no transcript
   *  text to leak in the first place (registry ⑤). */
  recording: { consent: boolean } | null
  /** セッションの結果 — the phone's own `Outcome` vocabulary
   *  (`src/lib/karute/outcome-types.ts`). `null` = 結果 未記録. */
  outcome: {
    status: 'success' | 'no_deal' | 'pending' | 'revisit'
    /** Only 不成約 carries one (the phone's own rule); `null` otherwise. */
    reason: 'budget' | 'considering' | 'mismatch' | 'follow_up' | 'other' | null
  } | null
  /** 回数券を消化 — a fact the record holds, and the ONLY thing that makes the
   *  ticket line render (⚖ TYPE TIER 1: data presence, never a business-type
   *  branch). A record with no ticket burn simply has no ticket row. */
  ticket_redeemed: boolean
  /** ⚖ 破棄. `null` = an ordinary record. */
  discarded: FixtureKaruteDiscard | null
}

/** THE RECORDS. Thirteen, one per completed session the world already holds —
 *  ten in 銀座, three in 代官山 — and no record exists for a session that has not
 *  happened (⚖ 8/9: a karute for a treatment nobody performed is an impossible
 *  state). Between them they carry every state a records desk has to be able to
 *  show: AI要約済, 下書き, AI補完待ち, 仮カルテ (nothing written yet), a summary a
 *  human rewrote, a session with no recording at all, a session with no photos,
 *  a 回数券 burn, all four session outcomes, and one 破棄済み record.
 *
 *  ⚠ THREE CUSTOMERS DELIBERATELY HAVE NO RECORD AT ALL — cus-03, cus-10 and
 *  cus-11. They are what proves the ⚖ 7a rule: a page for RECORDS shows records,
 *  so none of the three may ever appear as a row; they surface only as the
 *  search's own quiet reveal line, and only under a lens that can see them. */
export const records: FixtureKaruteRecord[] = [
  {
    // TODAY, 銀座 — the fullest record in the world, and the one the detail
    // screen is measured on: eight written categories, a confirmed summary,
    // before/after photos, a drafted message, a recorded session with consent.
    id: 'K-0001',
    appointment_id: 'apt-12',
    entries: [
      { category: 'concern', text: 'デスクワークが続くと肩が張りやすい、と伺いました。', author: 'staff' },
      { category: 'condition', text: '施術前は右肩の可動域がやや狭め。施術後は左右差が軽くなりました。', author: 'ai' },
      { category: 'lifestyle', text: '座り仕事が中心。休憩中のストレッチはまだ習慣になっていないとのこと。', author: 'ai' },
      { category: 'treatment', text: '肩から背中の張りを中心に、可動域を確かめながら圧を調整しました。', author: 'ai' },
      { category: 'preference', text: '圧はやや強めがお好み。強すぎると翌日に張り返すため中程度で調整。', author: 'staff' },
      { category: 'product', text: '本日の販売はなし。乾燥が気になるとのことで、次回ホームケアオイルをご案内予定。', author: 'ai' },
      { category: 'next', text: '次回は小顔調整との組み合わせをご提案する予定です。', author: 'staff' },
      { category: 'note', text: '施術中に「肩が軽くなった」とお声がけいただきました。', author: 'ai' },
    ],
    summary_ai: '肩から背中の張りに対応。施術後は「肩が軽くなった」とのお言葉。次回は小顔調整との組み合わせをご提案。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'confirmed',
    photos: [
      { category: 'ビフォー', caption: '施術前・肩まわり' },
      { category: 'アフター', caption: '施術後・肩まわり' },
    ],
    ai_message:
      '本日はご来店いただきありがとうございました。肩から背中の張りが施術後に軽くなったとのことで安心いたしました。次回は小顔調整との組み合わせもおすすめです。またのご来店をお待ちしております。',
    recording: { consent: true },
    outcome: { status: 'revisit', reason: null },
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // TODAY, 銀座 — the summary the AI has written but nobody has confirmed.
    // No photos: a session where the phone was never opened for the camera.
    id: 'K-0002',
    appointment_id: 'apt-22',
    entries: [
      { category: 'concern', text: '腰まわりの重さが気になる、とのご相談。', author: 'staff' },
      { category: 'treatment', text: '骨盤まわりを中心に、左右のバランスを見ながら施術しました。', author: 'ai' },
      { category: 'next', text: '2週間後の再来をご提案しました。', author: 'ai' },
    ],
    summary_ai: '腰まわりの重さに対応。骨盤まわりのバランスを整え、2週間後の再来をご提案。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'draft',
    photos: [],
    ai_message: '本日はありがとうございました。腰まわりの重さが少しでも軽くなっていれば幸いです。2週間後を目安にまたお待ちしております。',
    recording: { consent: true },
    outcome: { status: 'success', reason: null },
    ticket_redeemed: false,
  discarded: null,
  },
  {
    // TODAY, 銀座 — written up, but the AI has not produced a summary yet.
    // This is AI補完待ち, and the 回数券 burn rides on it (cus-04 holds a pack).
    id: 'K-0003',
    appointment_id: 'apt-25',
    entries: [
      { category: 'concern', text: '首から肩にかけて重さを感じる、と伺いました。', author: 'staff' },
      { category: 'condition', text: '首の可動域を確認。左に回しづらさがありました。', author: 'ai' },
      { category: 'treatment', text: '首まわりをゆるめてから、肩の可動域を広げる流れで施術しました。', author: 'ai' },
    ],
    summary_ai: null,
    summary_edited: null,
    summary_edits: [],
    summary_state: null,
    photos: [{ category: '参考', caption: '姿勢の確認・正面' }],
    ai_message: null,
    recording: { consent: true },
    outcome: { status: 'pending', reason: null },
    ticket_redeemed: true,
    discarded: null,
  },
  {
    // 昨日, 銀座 — an ordinary confirmed record, no recording at all. The room
    // has to be able to say 「録音はありません」 without inventing one.
    id: 'K-0004',
    appointment_id: 'apt-07',
    entries: [
      { category: 'condition', text: '骨盤の傾きを確認。前回より安定していました。', author: 'ai' },
      { category: 'treatment', text: '骨盤まわりを中心に90分。ストレッチも組み合わせました。', author: 'ai' },
      { category: 'note', text: '施術後、立ち上がりが楽になったとのお声。', author: 'staff' },
    ],
    summary_ai: '骨盤の傾きは前回より安定。90分の施術とストレッチで、立ち上がりが楽になったとのお声。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'confirmed',
    photos: [],
    ai_message: null,
    recording: null,
    outcome: { status: 'revisit', reason: null },
    ticket_redeemed: true,
    discarded: null,
  },
  {
    // ⚖ THE DISCARDED RECORD, 銀座, 2日前. A staffer opened a record against the
    // wrong booking, wrote it up, recorded an outcome and burned a ticket on it
    // — and THEN noticed, and said why in their own words.
    //
    // ⚠ IT CARRIES AN OUTCOME AND A TICKET BURN ON PURPOSE. A discarded record
    // with nothing on it cannot prove ⚖ R2 (a discarded row feeds NOTHING):
    // the guard in `karute.ts` would have nothing to strip, and the pin that
    // says 「its outcome is null」 would be true because the FIXTURE is empty
    // rather than because the rule works. The mutation battery found exactly
    // that hole (M12 survived its first run). This is the mistake case R2 was
    // written for, so this is what the fixture holds.
    //
    // The row STAYS — grayed, in the list, for everyone including the recorder
    // (⚖ 8/20 ①) — and its content is a 店舗管理者 read (⚖ 8/20 ②).
    id: 'K-0005',
    appointment_id: 'apt-10',
    entries: [{ category: 'note', text: '別のお客様の内容を書き始めてしまいました。', author: 'staff' }],
    summary_ai: null,
    summary_edited: null,
    summary_edits: [],
    summary_state: null,
    photos: [],
    ai_message: null,
    recording: { consent: true },
    outcome: { status: 'no_deal', reason: 'considering' },
    ticket_redeemed: true,
    discarded: {
      minute: 12 * 60 + 20,
      by_staff_id: 'p-01',
      reason: '別のお客様の予約に紐づけて作成してしまったため。正しいカルテは同じ日に作成し直しました。',
    },
  },
  {
    // 1週間前, 銀座 — 不成約 with a reason, and a 参考 photo.
    id: 'K-0006',
    appointment_id: 'apt-01',
    entries: [
      { category: 'concern', text: '肩こりが慢性的に続いている、とのご相談。', author: 'staff' },
      { category: 'treatment', text: '肩甲骨まわりを中心に60分の施術を行いました。', author: 'ai' },
      { category: 'product', text: '回数券のご案内をしましたが、今回は見送りとのことでした。', author: 'staff' },
    ],
    summary_ai: '慢性的な肩こりに対応。肩甲骨まわりを中心に施術。回数券のご案内は今回見送り。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'confirmed',
    photos: [{ category: '参考', caption: '肩の高さの左右差' }],
    ai_message: 'ご来店ありがとうございました。肩まわりの張りが戻りやすい時期ですので、ご無理のない範囲でお過ごしください。',
    recording: { consent: true },
    outcome: { status: 'no_deal', reason: 'budget' },
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 8日前, 銀座 — 仮カルテ: the record was created and nothing was ever written
    // into it. Zero entries is the state, not an error, and the list says so.
    id: 'K-0007',
    appointment_id: 'apt-04',
    entries: [],
    summary_ai: null,
    summary_edited: null,
    summary_edits: [],
    summary_state: null,
    photos: [],
    ai_message: null,
    recording: null,
    outcome: { status: 'pending', reason: null },
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 2週間前, 銀座 — the summary a human rewrote. The overlay is what the page
    // shows; the AI's own text stays underneath it, and the 編集履歴 says who
    // changed it and when.
    id: 'K-0008',
    appointment_id: 'apt-05',
    entries: [
      { category: 'concern', text: '同伴のご家族の施術について、事前にご相談をいただきました。', author: 'staff' },
      { category: 'treatment', text: '骨盤ケア90分。強さを都度確認しながら進めました。', author: 'ai' },
      { category: 'preference', text: '会話は控えめがお好み、とのことです。', author: 'staff' },
    ],
    summary_ai: '骨盤ケア90分を実施。強さを確認しながら施術しました。',
    summary_edited: '骨盤ケア90分を実施。強さを都度確認しながら施術。会話は控えめをご希望のため、次回も同じ進め方で。',
    summary_edits: [
      { minute: 17 * 60 + 40, by_staff_id: 'p-06', note: 'AIの要約に、次回の進め方を追記しました。' },
    ],
    summary_state: 'confirmed',
    photos: [],
    ai_message: null,
    recording: { consent: true },
    outcome: { status: 'revisit', reason: null },
    ticket_redeemed: true,
    discarded: null,
  },
  {
    // 3週間前, 銀座 — 下書き. The 全店舗メニュー session.
    id: 'K-0009',
    appointment_id: 'apt-08',
    entries: [{ category: 'treatment', text: '短時間のメニューで、首まわりを中心にほぐしました。', author: 'ai' }],
    summary_ai: '短時間メニューで首まわりを中心に施術。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'draft',
    photos: [],
    ai_message: null,
    recording: null,
    outcome: null,
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 22日前, 銀座 — the oldest 銀座 record, and the one that falls on the far
    // side of a month boundary for roughly a third of the year: the 今月 count
    // has to be a JST CALENDAR question, not a 30-day window.
    id: 'K-0010',
    appointment_id: 'apt-02',
    entries: [
      { category: 'concern', text: '長時間の立ち仕事で脚が重い、とのこと。', author: 'staff' },
      { category: 'treatment', text: '30分のストレッチメニューで、脚のむくみを中心に施術しました。', author: 'ai' },
    ],
    summary_ai: '立ち仕事による脚の重さに対応。30分のストレッチで、むくみを中心に施術。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'confirmed',
    photos: [],
    ai_message: null,
    recording: { consent: false },
    outcome: { status: 'revisit', reason: null },
    ticket_redeemed: false,
    discarded: null,
  },

  // ── 代官山. Three records the 銀座 lens must never see, and three the 代官山
  //    lens must see WITHOUT any of 銀座's (⚖ the 8/17 store-isolation law,
  //    proven both directions and with a leaves-nothing-behind pin on the
  //    serialized props). ──────────────────────────────────────────────────
  {
    id: 'K-0011',
    appointment_id: 'apt-03',
    entries: [
      { category: 'concern', text: '目の疲れが抜けない、とのご相談。', author: 'staff' },
      { category: 'treatment', text: 'ヘッドケア45分。頭皮から首の付け根までゆるめました。', author: 'ai' },
    ],
    summary_ai: '目の疲れに対応。ヘッドケア45分で頭皮から首の付け根までを施術。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'confirmed',
    photos: [],
    ai_message: '本日はありがとうございました。目の疲れが続くようでしたら、次回もお気軽にご相談ください。',
    recording: { consent: true },
    outcome: { status: 'success', reason: null },
    ticket_redeemed: true,
    discarded: null,
  },
  {
    id: 'K-0012',
    appointment_id: 'apt-11',
    entries: [{ category: 'condition', text: '肩の高さに左右差がありました。', author: 'ai' }],
    summary_ai: null,
    summary_edited: null,
    summary_edits: [],
    summary_state: null,
    photos: [],
    ai_message: null,
    recording: { consent: true },
    outcome: { status: 'pending', reason: null },
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 60日前 — outside 今月 under every calendar, which is what makes the
    // difference between 今月 and 全件 provable rather than coincidental.
    id: 'K-0013',
    appointment_id: 'apt-06',
    entries: [
      { category: 'treatment', text: '深層ケア120分。全身をゆっくり進めました。', author: 'ai' },
      { category: 'next', text: '次回は同じメニューでのご予約をご希望です。', author: 'staff' },
    ],
    summary_ai: '深層ケア120分を実施。次回も同じメニューでのご予約をご希望。',
    summary_edited: null,
    summary_edits: [],
    summary_state: 'confirmed',
    photos: [],
    ai_message: null,
    recording: null,
    outcome: { status: 'revisit', reason: null },
    ticket_redeemed: false,
    discarded: null,
  },
]

/** ⚠SETTINGS-BATCH — 文字起こしの公開範囲 (dial #16, DIAL-HOME-MAP (b3);
 *  ⚖ Liam 8/30 D3). A business chooses whether a staff member's recording
 *  transcript is private to them or readable by their managers. DEFAULT PRIVATE,
 *  and at reconnect the choice is enforced SERVER-SIDE at the data door — never
 *  by a client-side branch over a transcript the browser was already handed.
 *
 *  THE ROOM READS THIS AND STILL OPENS NO DOOR (v1, both modes): the record
 *  plane holds no transcript at all, so there is nothing here for a mis-set dial
 *  to leak. What the value buys today is the room's HONESTY — the notice says
 *  the viewing rule follows the store's setting rather than claiming a rule this
 *  room does not enforce (registry ⑤).
 *
 *  ⚠ RECONNECT: the 店舗設定 control ships with the settings batch and reads
 *  THIS value; the core contract ask is parked on the Anthony build-order queue.
 *  Nothing in the room hardcodes a transcript rule. */
export const transcriptVisibility: 'private' | 'managers' = 'private'
