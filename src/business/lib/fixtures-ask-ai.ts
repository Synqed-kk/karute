// AI相談 — PLAY-PHASE consultation plane (the desk's own door onto the AI: the
// suggestion feed canon designed, and the Q&A the phone app already ships).
//
// WHAT THIS FILE MAY STATE, AND WHAT IT MAY NOT — the ⚖ W7 plane law, the same
// one `fixtures-karute.ts` is pinned against. A suggestion knows one thing no
// other plane holds: that the AI would propose it, in which category, off which
// record, and where a person should go to act on it. That is here. Everything
// else — WHO the customer is, WHEN the session was, WHICH store owns it, WHICH
// staff member, WHICH menu, what the message SAID — is READ from `./fixtures`,
// `./fixtures-karute` and `./fixtures-inbox` through the id this plane joins on,
// and is never restated. So a row carries a `sourceRef` and NOTHING the world
// already answers: no names, no dates, no store, no subject line.
//
// ⚠ THE IMPORT LIST IS EMPTY, AND THAT IS THE FENCE MADE MACHINE-READABLE
// (foundation.test.ts INVENTORY). A plane that imported the world could restate
// a fact the world already states; importing nothing, it can only ADD.
//
// ⚖ AND NOTHING HERE IS A GENERATED ANSWER. The conversation below is a DESIGN
// OBJECT — the shapes the desk has to be able to render (a question, an answer
// carrying 出典, a follow-up, and one honest failure) — because the shipped
// contract keeps NO thread at all: history lives in the client's own state and
// is re-sent whole on every request, and the only server write is one audit row
// counting the exchange (`src/app/api/ai/chat/route.ts:113-119`,
// `{ first_turn, history_len }` — counts, never message text). Registry ③ carries
// the persistence question; this plane carries the rendering.
//
// ⚠ NO ANSWER TEXT HERE NAMES A PERSON. Not because names would be unsafe — the
// world holds them — but because the plane law says the world states them: the
// people an answer is ABOUT arrive as `sources`, joined back through the world by
// `ask-ai.ts` and printed as the ONE evidence grammar the feed uses (⚖ D-4).

/** Where a suggestion, a signal or an answer's 出典 row points. The four
 *  collections are the world's own: `bookings` = `fixtures.ts` appointments,
 *  `karuteRecords` = `fixtures-karute.ts` records, `inbox` =
 *  `fixtures-inbox.ts` threads, `customers` = `fixtures.ts` customers. */
export type AskAiCollection = 'bookings' | 'karuteRecords' | 'inbox' | 'customers'

export interface AskAiSourceRef {
  collection: AskAiCollection
  id: string
}

/** The four categories are the canon AI設定 room's own switches
 *  (fable-settings-ai.html § AI相談: 顧客フォロー / スタッフ配置・欠勤対応 /
 *  予約・空き待ち案内 / VIP・ロイヤルティ). The dials that turn them on live in
 *  the 設定 room, which builds LAST — registry ⑦. */
export type AskAiCategory = 'customer_follow' | 'staffing' | 'booking' | 'vip'

export interface FixtureSuggestion {
  id: string
  category: AskAiCategory
  /** ⚖ THE CARD LEADS WITH THE TO-DO (the accepted mock, S15). A staff member
   *  reading a rail of proposals is looking for WHAT TO DO and WHOSE, and the
   *  paragraph under it is the explanation they open when they want it. So a
   *  suggestion now says its job in two short lines as well as its paragraph.
   *
   *  ⚠ `{name}` IS A SLOT, NOT A NAME. The plane still states no person: the
   *  substitution happens in `ask-ai.ts` with the SAME `personOf` the 根拠 line
   *  resolves through, so a headline can never name somebody the lens cannot
   *  see — a card whose subject does not resolve is dropped before the model,
   *  exactly as it already was. */
  headline: string
  /** …and WHY, in one grey line. It restates no world fact either: no name, no
   *  date, no menu, no store — only the situation the category is about. */
  reason: string
  /** The recommendation, in the store's own words. It says what to DO — never
   *  who, when or where, which the 根拠 line answers by joining the world. */
  text: string
  sourceRef: AskAiSourceRef
  /** ⚠ A ROOM SEGMENT, NEVER A RECORD-LEVEL PARAM. Canon's `<page>?id=<id>`
   *  convention has no target at this tip: karute / reservations / customers /
   *  inbox / register accept `?store=` only. The card navigates to the REAL room
   *  carrying the CURRENT store lens; record-level anchoring is registry ⑥, a
   *  contract for the whole family rather than a param this room invents. */
  deepLink: string
}

/** 今日のヒント — the phone's own `TodaySignal` shape mirrored
 *  (`src/lib/karute/ai-signals.ts:19-31`: an id, a kind, a why-tag, the chip
 *  text and the question it carries into the chat with a context hint).
 *
 *  ⚠ THE TAG, THE TITLE AND THE PROMPT ARE NOT HERE. On the phone they are
 *  strings built from the roster at read time; on the desk they would be world
 *  facts restated in a plane, so the plane holds the KIND and the SUBJECT and
 *  `ask-ai.ts` composes all three — the same resolver machinery the 根拠 line
 *  uses, so the two can never tell one customer's story two ways. */
export interface FixtureSignal {
  id: string
  kind: 'today_roster' | 'revisit_followup' | 'waitlist_due'
  /** `null` for a signal about the whole day rather than one record. */
  subjectRef: AskAiSourceRef | null
}

/** じっくり相談 — the phone's `ConsultationQuestion`
 *  (`src/lib/welcome/business-types.ts:36-42`), business-type driven through the
 *  shipped `getConsultationQuestions` mechanism (⚖ TYPE TIER 2: the type sets
 *  DEFAULTS through a mechanism that already exists, never a new dial).
 *
 *  ⚠ MIRRORED BY SHAPE, WITH THE CITE, never imported: Business territory does
 *  not reach into the phone's runtime (packet §3). The three rows below are the
 *  `beauty_chiropractic` profile's own Japanese
 *  (`src/lib/welcome/business-types.ts:151-190`, `titleJa` / `previewJa` /
 *  `exampleJa`) — the recognition floor: a staffer who taps 「ブライダル目標の
 *  お客様」 on the phone reads the same words at the desk. */
export interface FixtureTemplate {
  id: string
  category: 'Analysis' | 'Customer' | 'Strategy'
  title: string
  preview: string
  /** What a tap FILLS the composer with. It does not send (the phone's own
   *  behaviour, `AIAssistantView.tsx:162` / `:181` — `setInput(example)`). */
  example: string
}

/** One rendered turn. `role` is the phone's pair plus the desk's own third
 *  state: ⚖ D-3 says a failure carries its OWN honest reason, so the failure is
 *  a KIND of turn here rather than an assistant bubble reading
 *  「エラーが発生しました。」 (`messages/ja.json` askAi.error — the one sentence
 *  the phone collapses every failure into). */
export interface FixtureTurn {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  /** 出典 — the world ids this answer was built from, resolved into human
   *  sentences by `ask-ai.ts` (⚖ D-4: ONE evidence grammar, feed and answers
   *  alike). Empty on a question and on a failure. */
  sources: AskAiSourceRef[]
  /** The `context_label` the shipped contract returns beside a reply when the
   *  request carried a hint (`src/lib/ai/karute-chat.ts:88-101`; omitted
   *  entirely when there was none). `null` = no hint was sent. */
  contextRef: AskAiSourceRef | null
}

/** ⚠ THE ONE WORLD-LEVEL FACT THIS PLANE STATES, ARGUED (deviation R7-1).
 *  業種 drives the prompt templates through the shipped mechanism (§2b-6) and the
 *  profileHint's unset state — and the shared world holds no business type at
 *  all (`fixtures.ts` `business` = a name and a store count). `fixtures.ts` is
 *  READ-ONLY from here (⚖ the shared-READ-lib rule: any edit is an
 *  announce-and-adjudicate, and the expected shape is zero), so the room states
 *  it in its own plane rather than reaching into the world to add it. It is the
 *  key AND the word for it, together, because they are ONE fact and a room that
 *  mirrored the type registry's twenty-row label table to translate its own key
 *  would be keeping a second copy of a list it needs one line of.
 *  `null` is the honest unset state, which the profileHint renders. */
export const businessType: { key: string; label: string } | null = {
  key: 'beauty_chiropractic',
  label: '美容整体', // src/lib/welcome/business-types.ts:78 labelJa
}

/** 美容整体's three prompt cards — the phone's `slice(0, 3)`
 *  (`src/app/[locale]/(app)/ask-ai/page.tsx:95`), same three, same words. */
export const templates: FixtureTemplate[] = [
  {
    id: 'bc-customer',
    category: 'Customer',
    title: 'ブライダル目標のお客様',
    preview: '挙式まで6ヶ月以内のお客様を残り期間順に',
    example: '挙式まで6ヶ月以内のお客様を一覧にして、残り期間に合わせた通い方の提案を作成してください',
  },
  {
    id: 'bc-analysis',
    category: 'Analysis',
    title: '集中期→メンテナンス移行率',
    preview: '集中ケアからメンテナンスへ移行したお客様の割合をスタッフ別に',
    example: '集中期からメンテナンス期への移行率をスタッフ別に集計し、差が出る要因を分析してください',
  },
  {
    id: 'bc-strategy',
    category: 'Strategy',
    title: '夏前ボディメイクコース',
    preview: '骨盤＋ボディメイクの3ヶ月コース — 週次設計と価格',
    example: '夏に向けた骨盤＋ボディメイクの3ヶ月コースを、週ごとの通院設計と価格案つきで作成してください',
  },
]

/** …AND THE THREE A SHOP GETS WHEN IT HAS CHOSEN NO 業種 (F2-4). The shipped
 *  mechanism falls back to a GENERIC trio rather than to nothing
 *  (`src/lib/welcome/business-types.ts:100-137`
 *  `GENERIC_CONSULTATION_QUESTIONS` — `titleJa` / `previewJa` / `exampleJa`
 *  verbatim, same ids), so a 業種未設定 desk that showed 美容整体's bridal
 *  prompts beside its own 「業種が未設定です」 note was the page contradicting
 *  itself in one column. Mirrored by SHAPE with the cite, never imported
 *  (packet §3). */
export const genericTemplates: FixtureTemplate[] = [
  {
    id: 'g-analysis',
    category: 'Analysis',
    title: '今週のパフォーマンス概況',
    preview: '今週のカルテ・予約・再予約の傾向まとめ',
    example: '今週のカルテ活動、上位のお客様、フォローすべき再予約の抜けをまとめてください',
  },
  {
    id: 'g-customer',
    category: 'Customer',
    title: 'フォローアップが必要なお客様',
    preview: '60日以上ご来店のないお客様は？',
    example: '60日以上予約のないお客様を一覧にして、それぞれに再来店を促すメッセージ案を提案してください',
  },
  {
    id: 'g-strategy',
    category: 'Strategy',
    title: '来月のキャンペーン案',
    preview: 'カルテの傾向とお客様層に合わせた販促案',
    example: 'お客様が求めているサービスの傾向に基づいて、来月のキャンペーン案を3つ提案してください',
  },
]

/** 今日のヒント. TWO rows reach any one store, by construction: the roster row
 *  belongs to whichever day the lens is standing on, and each store has exactly
 *  one record-backed row of its own — 銀座's 再来のご提案 and 代官山's 空き待ち
 *  期限. A store whose lens resolves neither simply shows no strip (the section
 *  drops out of the page AND out of the tour by itself). */
export const signals: FixtureSignal[] = [
  { id: 'sig-roster', kind: 'today_roster', subjectRef: null },
  { id: 'sig-revisit', kind: 'revisit_followup', subjectRef: { collection: 'karuteRecords', id: 'K-0001' } },
  { id: 'sig-waitlist', kind: 'waitlist_due', subjectRef: { collection: 'inbox', id: 'inb-wait' } },
]

/** AIが提案する次のアクション — canon's feed, sourced at real world records.
 *  Ten rows: seven resolve inside 銀座, three inside 代官山, and a lens sees only
 *  its own (a suggestion whose sourceRef does not resolve under the lens never
 *  ENTERS the model, exactly as a カルテ row does not — ⚖ the 8/17 isolation
 *  law, above serialization).
 *
 *  ⚠ NOT ONE `text` STATES A HARD FACT. The 期限 on the 空き待ち row and the
 *  「まだ承諾されていない」 on the 仮押さえ row are facts the REFERENCED RECORD
 *  carries, so the badge derives them (`urgencyOf`) and the copy never claims
 *  them — canon's own rule: urgency is never invented copy. */
export const suggestions: FixtureSuggestion[] = [
  // ── 銀座 ────────────────────────────────────────────────────────────────
  {
    // K-0001's outcome is 再来のご提案 and its 次回 drawer holds the proposal.
    id: 'sug-revisit',
    headline: '{name}様に再来のご案内',
    reason: '前回の記録に次回のご提案が残っています',
    category: 'customer_follow',
    text: '前回の記録に次回のご提案が残ったままです。再来のご案内をおすすめします。',
    sourceRef: { collection: 'karuteRecords', id: 'K-0001' },
    deepLink: 'karute',
  },
  {
    // apt-26 is the 仮押さえ the customer has not accepted — `board_state: 'hold'`.
    id: 'sug-hold',
    headline: '{name}様に返事をもらう',
    reason: '担当変更のお席が承諾待ちです',
    category: 'booking',
    text: '担当変更のお席がまだ承諾を待っています。内容をお伝えして返事をもらってください。',
    sourceRef: { collection: 'bookings', id: 'apt-26' },
    deepLink: 'today',
  },
  {
    id: 'sug-change',
    headline: '{name}様の日時変更に返事する',
    reason: '日時変更のご希望に返信がまだです',
    category: 'booking',
    text: '予約の日時変更のご希望に、まだ返信できていません。空き枠の候補を確かめてお返事してください。',
    sourceRef: { collection: 'inbox', id: 'inb-change' },
    deepLink: 'inbox',
  },
  {
    id: 'sug-absence',
    headline: '{name}様の振り替えを決める',
    reason: '担当が不在の枠が残っています',
    category: 'staffing',
    text: '担当が不在の枠が残っています。振り替え先を決めて、お客様にご連絡してください。',
    sourceRef: { collection: 'inbox', id: 'inb-absence' },
    deepLink: 'shifts',
  },
  {
    // apt-23's board_state is 'noshow' — the slot ran and nobody came, so the
    // hour is the staff member's again and nothing in the world has re-planned
    // it. ⚠ THE SEVENTH 銀座 ROW EXISTS SO THE DEMO STOPS HIDING A CONTROL
    // (F2-8): six was exactly the window, so さらに表示 — and its tour step —
    // were unreachable in the shipped demo, the same class of defect as the
    // board's own 詰め込み layer before apt-29 moved to 14:05.
    id: 'sug-noshow',
    headline: '{name}様の空き枠を組み直す',
    reason: '来店のなかった枠が空いたままです',
    category: 'staffing',
    text: '来店のなかった枠が空いたままです。担当の当日の動きを組み直せないか確認してください。',
    sourceRef: { collection: 'bookings', id: 'apt-23' },
    deepLink: 'shifts',
  },
  {
    // apt-25's settlement is 'awaiting', and its customer is the world's one VIP.
    id: 'sug-vip-settle',
    headline: '{name}様の精算を確認する',
    reason: 'VIPのお客様の会計がまだ済んでいません',
    category: 'vip',
    text: 'VIPのお客様の会計がまだ済んでいません。精算の状況をご確認ください。',
    sourceRef: { collection: 'bookings', id: 'apt-25' },
    deepLink: 'register',
  },
  {
    // K-0002's AI summary is a 下書き nobody has confirmed.
    id: 'sug-draft',
    headline: '{name}様のAI要約を確認する',
    reason: 'AIの要約がまだ確認されていません',
    category: 'customer_follow',
    text: 'AIの要約がまだ確認されていません。内容を確かめて確定してください。',
    sourceRef: { collection: 'karuteRecords', id: 'K-0002' },
    deepLink: 'karute',
  },
  // ── 代官山 ──────────────────────────────────────────────────────────────
  {
    // inb-wait is the ONE thread in the world carrying its own 期限.
    id: 'sug-waitlist',
    headline: '{name}様に空き枠をご案内する',
    reason: '空き待ちのお申し込みに枠をご提案できていません',
    category: 'booking',
    text: '空き待ちのお申し込みに、まだ枠をご提案できていません。空き枠が出たらご案内してください。',
    sourceRef: { collection: 'inbox', id: 'inb-wait' },
    deepLink: 'inbox',
  },
  {
    // K-0011 burned a 回数券 — the balance is the 顧客 room's own fact.
    id: 'sug-ticket',
    headline: '{name}様に回数券の更新をご案内',
    reason: '回数券の残りが少なくなっています',
    category: 'customer_follow',
    text: '回数券の残りが少なくなっているお客様です。次回のご来店時に更新のご案内をおすすめします。',
    sourceRef: { collection: 'karuteRecords', id: 'K-0011' },
    deepLink: 'karute',
  },
  {
    id: 'sug-vip-next',
    headline: '{name}様の申し送りを合わせる',
    reason: 'VIPのお客様の次のご予約が入っています',
    category: 'vip',
    text: 'VIPのお客様の次のご予約が入っています。担当と申し送りを合わせておいてください。',
    sourceRef: { collection: 'bookings', id: 'apt-16' },
    deepLink: 'reservations',
  },
]

/** THE DESIGNED CONVERSATION — four turns, and each one is a SHAPE the desk has
 *  to render: a question, an answer carrying 出典 rows, a follow-up, and one
 *  honest failure (⚖ D-3). It is the same conversation under every lens; what
 *  changes with the lens is the 出典 rows' own resolution, and a source that does
 *  not resolve under the lens is DROPPED rather than printed as an id.
 *
 *  ⚠ AND NO ANSWER TEXT COUNTS ITS OWN 出典. An earlier cut opened with
 *  「出典の2名は…」 — true in 銀座 and FALSE in 代官山, where one of the two
 *  customers is out of lens and its row never enters the model. A sentence that
 *  is only true under one lens is a surface lying about its own state (⚖ A10).
 *  The count is DERIVED beside the rows instead (`出典 N件`, ⚖ 8/25), so it can
 *  never disagree with what is printed under it.
 *
 *  ⚠ AND THE CLAIM IS TRUE OF EVERY ROW THAT RENDERS, UNDER EITHER LENS (F2-6,
 *  deviation R7-G1). The earlier cut promised two things of its sources — that
 *  a 次回のご提案 was still in the karute AND that no later booking had been
 *  taken — and picked rows the world does not support: cus-08 has a 銀座 booking
 *  three days out, and 代官山 holds NO row where both halves are true at once
 *  (its one record carrying a 次回 entry, K-0013, belongs to a customer with a
 *  代官山 booking five days out; its one customer with no later booking, K-0012's,
 *  has a 記入途中 record with no proposal in it). The DATA was re-picked first —
 *  the sources are now three karute records, each of them 転帰「再来のご提案」
 *  with a 次回 entry still in it, two reaching 銀座 and one 代官山 — and the
 *  sentence dropped the half the world cannot carry, keeping the booking side as
 *  a CONDITION rather than a claim about any row. */
export const conversation: FixtureTurn[] = [
  {
    id: 'turn-1',
    role: 'user',
    text: '今週、再予約のご案内をしたほうがいいお客様はどなたですか？',
    sources: [],
    contextRef: null,
  },
  {
    id: 'turn-2',
    role: 'assistant',
    text: '出典のカルテには、次回のご提案が残っています。まだご予約の入っていないお客様には、今週のうちにお声がけされることをおすすめします。ご案内の文面は、カルテに残っているご提案の言葉をそのまま使うと伝わりやすくなります。',
    sources: [
      { collection: 'karuteRecords', id: 'K-0001' },
      { collection: 'karuteRecords', id: 'K-0014' },
      { collection: 'karuteRecords', id: 'K-0013' },
    ],
    contextRef: null,
  },
  {
    id: 'turn-3',
    role: 'user',
    text: 'いま開いているお客様のカルテをもとに、短いご案内の文面を作ってください。',
    sources: [],
    // The shipped contract returns `context_label` ONLY when the request carried
    // a hint AND in-scope rows came back (`karute-chat.ts:86-92` — customerName
    // is non-null only then). cus-08 books in BOTH stores, so the label's
    // presence is decided by the RECORDS the lens can see, which is exactly the
    // rule this ref exists to prove in both directions.
    contextRef: { collection: 'customers', id: 'cus-08' },
  },
  {
    id: 'turn-4',
    role: 'error',
    text: '回答を受け取れませんでした。通信が途中で切れています。同じ質問をもう一度お送りください。',
    sources: [],
    contextRef: null,
  },
]
