// 録音 — PLAY-PHASE recording plane (the computer door onto the same recording
// sessions the phone app mints: one truth, two doors).
//
// WHAT THIS FILE MAY STATE, AND WHAT IT MAY NOT. A recording session knows
// things no booking row and no カルテ record carries: how long the audio ran,
// whether the transcription job finished, whether this device still holds the
// take, and — when a staff member threw it away — who threw it away, why, and
// what words were kept. Those are here. Everything else — WHO the customer is,
// WHEN the session happened, in WHICH store, with WHICH staff member, under
// WHICH menu — is READ from `./fixtures` through the booking a take joins, and
// never restated. WHETHER A カルテ EXISTS for a session is read from
// `./fixtures-karute` through that SAME booking, and never restated either.
//
// ⚠ THIS IS THE W7 BREACH CLASS, PINNED (packet §2e-4). The rejected W7
// candidate deleted two canonical fixture assertions to make its own plane fit.
// This plane ADDS assertions and REPLACES NONE: `./fixtures` and
// `./fixtures-karute` are read-only from here, its ONLY import is the world's
// own store constant (see below), and the room's suite proves every take
// resolves against a booking — or a store — the world already holds. A
// fixture-assertion-replaced mutation is one of the battery's own reds.
//
// ⚠ THE CONSENT FACT IS A DIFFERENT FACT FROM `fixtures-karute`'s.
// `FixtureKaruteRecord.recording.consent` is a HISTORICAL fact about a session
// that already happened — 「同意確認済」 on a finished record. The grants below
// are the per-CUSTOMER, POLICY-VERSION-PINNED current consent the SHIPPED phone
// gates a new take on (`customers.getConsent`, RecordPageView). They are not
// two spellings of one fact and neither is derived from the other; the suite
// asserts they COHERE (no record claims consent for a customer the grant plane
// says never granted any), which is the ⚖ one-home rule applied across two
// planes rather than collapsed into one.
//
// TIMES ARE JST MINUTES FROM MIDNIGHT on the take's own session day, like every
// other plane. Nothing here is an absolute date (⚖ L-6): the booking owns the
// calendar for a bound take, and an unbound one carries its own day offset, so a
// take can never drift away from the session it describes.
//
// ⚠ THE ONE IMPORT IS THE STORE ID, AND IT IS A READ RATHER THAN A RESTATEMENT
// (`fixtures-register.ts`'s own precedent). An UNBOUND take has no booking to
// read a store through, so it has to name one — and naming it by the world's own
// constant is what keeps a second spelling of 銀座 out of the codebase.

import { STORE_A } from './fixtures'

/** ⚖ THE PINNED POLICY VERSION — the shipped phone's own
 *  (`src/lib/karute/consent.ts` policy pin, read by `customers.getConsent`):
 *  a grant made under an OLDER version reads NOT CURRENT and the gate closes,
 *  which is the whole of W7-1's first half. Mirrored by VALUE here rather than
 *  imported, because Business territory may not reach into phone runtime
 *  (packet §3). */
export const CONSENT_POLICY_VERSION = 'v2-2026-08'

/** ⚖ THE ACCIDENTAL-TAP FLOOR — `src/lib/recording/discard-floor.ts:4`
 *  `BELOW_FLOOR_SEC = 10`, mirrored by value for the same territory reason.
 *  ONE home in this room: `recording.ts` reads it and nothing else states it. */
export const BELOW_FLOOR_SEC = 10

/** ⚖ THE LOCAL-AUDIO RETENTION FACT — `src/lib/karute/take-store.ts:41`
 *  `const TAKE_TTL_MS = 7 * 24 * 60 * 60 * 1000`, mirrored by VALUE for the same
 *  territory reason as the two above (Business may not reach into phone
 *  runtime). It is a POLICY FACT the page prints in two places — the 要対応
 *  pill's 「あと{n}日で端末から消えます」 and the trace row's 「端末に{n}日間だけ
 *  残ります」 — so ⚖ W7-4's one-home rule puts it HERE, on the plane, and both
 *  strings derive from it. Two app-side literals is how 7 and 7 quietly become
 *  7 and 14. */
export const LOCAL_AUDIO_DAYS = 7

/** One customer's recording consent, as the CORE row shapes it
 *  (`customers.getConsent` → `{ policy_version, granted_at, method }`).
 *  `method` is 'VERBAL' for every grant the product can capture today — the
 *  read-aloud flow is the only door — and it is carried rather than assumed so
 *  a second method arriving later is a data change, not a code change. */
export interface FixtureConsentGrant {
  customer_id: string
  /** The version the grant was made UNDER. Equal to `CONSENT_POLICY_VERSION`
   *  ⇒ current; anything else ⇒ stale, and the gate closes. */
  policy_version: string
  /** Days before today the grant was taken. Relative (⚖ L-6). */
  granted_days_ago: number
  method: 'VERBAL'
}

/** ⚖ ONE TRANSCRIPT SEGMENT, in the CONTRACT'S OWN SHAPE — the required fields
 *  of the `recordings.upsertSegments` row the shipped discard-transcript action
 *  writes (`src/actions/recording-discard-transcript.ts:200-208`:
 *  `{ segment_index, text, start_time, end_time }`, times in SECONDS from the
 *  start of the take). `segment_index` is the array position and is therefore
 *  not restated (⚖ one home per fact).
 *
 *  ⚠ THE TIMES ARE WHY THIS IS NOT A `string[]` ANY MORE. ⚖ Liam 8/31 — a long
 *  recording's transcript reads inside a BOUNDED panel with 5分-interval
 *  dividers, and a divider is only honest if it is DERIVED from when the words
 *  were actually said. A room that computed the intervals from line COUNT would
 *  be inventing a clock. */
export interface FixtureTranscriptSegment {
  /** Seconds from the start of the take. */
  start_time: number
  end_time: number
  text: string
}

/** ⚖ THE DISCARD ROW — the shipped `recordingDiscards.create` shape
 *  (`{ recording_session_id, source, discarded_by, reason }`), plus the two
 *  things the manager screen reads back off the session
 *  (`recordingDiscards.list` + `getDiscardTranscript`).
 *
 *  A REQUIRED WRITTEN REASON, FREE TEXT, NO MENU AND NO PRE-SELECT (⚖ 8/17):
 *  discarding is abnormal by definition, so the staffer says why in their own
 *  words. `below_floor` is NOT stored here — it is DERIVED from the stamped
 *  duration, exactly as the server derives it, so the two can never disagree. */
export interface FixtureTakeDiscard {
  /** JST minute of the take's own session day. */
  minute: number
  /** ⚖ #799 — WHO, BY STAFF **CARD** ID, never a profile id and never a name.
   *  The shipped ledger stores `discarded_by` = the staff CARD, and the manager
   *  screen bridges card↔profile on BOTH keys to name it. The plane mirrors
   *  that TWO-SPACE shape so the reconnect join is designed rather than
   *  guessed — including one card that resolves to nothing at all. */
  by_staff_card_id: string
  /** Free text, required, kept forever beside the session it explains. */
  reason: string
  /** ⚖ 8/25 RULING A — the transcript a manager reads the reason AGAINST.
   *  `null` = no words were ever kept, and WHY is a derived question the room
   *  answers with one of the three honest absence states: under the floor
   *  nothing was transcribed (the ⚖ spend gate), no consent means nothing was
   *  kept, and everything else is a plain 「ありません」. An EMPTY ARRAY is not
   *  used: an absence has one spelling here, and its REASON is derived from the
   *  take's own facts rather than stored twice. */
  transcript: FixtureTranscriptSegment[] | null
}

/** One recording session. */
export interface FixtureTake {
  /** The session id — human-shaped and stable (⚖ L-6). */
  id: string
  /**
   * THE JOIN, for a take made against a booking. Date, store, customer, staff
   * and menu all resolve through this one id; the take states none of them.
   *
   * ⚠ EXACTLY ONE OF `appointment_id` / `store_id` IS NON-NULL, and the suite
   * pins it. A bound take reads its store THROUGH the booking (one home); an
   * UNBOUND take — the phone's own walk-in case, where a staffer records first
   * and picks the customer at save — has no booking to read one from, so it
   * carries the store it was recorded in and nothing else. That store is also
   * the only field registry ② (the store-wide listing core does not ship yet)
   * would need, so the shape is the ask, not a guess dressed as data.
   */
  appointment_id: string | null
  store_id: string | null
  /** Day offset from today for an UNBOUND take (a bound one takes the
   *  booking's day). Relative, like every other date in the demo world. */
  day_offset: number | null
  /** JST minute of day the audio started. */
  started_minute: number
  /** ⚖ #799 again — the RECORDER, by staff CARD id. */
  by_staff_card_id: string
  /** Stamped AFTER the take settles, floored (the shipped order: duration is
   *  stamped after the receipt). `null` = never stamped, which is what an
   *  unsettled session honestly looks like. */
  duration_seconds: number | null
  /** The transcription job as core last reported it. `null` = a DEFINITIVE
   *  「no job for this session」, which is not the same as 「we could not find
   *  out」 — the room never needs the second case because a fixture plane is
   *  never a failed probe. */
  job: 'queued' | 'running' | 'done' | 'failed' | null
  /** Present only on `failed`. `'empty-transcript'` is the ONE code the ⚖ 8/26
   *  (a) pipeline-error discard exit is gated on, exactly. */
  job_error: 'empty-transcript' | 'generic' | null
  /** The device still holds this take's audio. What makes 復元可能 and 再試行
   *  possible at all — without the blob neither is offered. */
  local_audio: boolean
  /** This device saw the save land. `false` with a カルテ present is 確認待ち. */
  settled: boolean
  /** 回数券を1回消化 — a fact this session produced. Carried so ⚖ 8/20's
   *  build requirement (b) can be honoured on a DISCARDED take: money never
   *  auto-reverses, so a manager is told the burn happened even though ⚖ R2
   *  keeps the take out of every number. */
  ticket_redeemed: boolean
  /** ⚖ 破棄. `null` = an ordinary take. */
  discarded: FixtureTakeDiscard | null
}

/** THE CONSENT GRANTS. Small on purpose — the demo world is a shop, not a
 *  matrix — and between them they carry all three states the gate has to be
 *  able to close on: CURRENT (granted under the pinned version), STALE (granted
 *  under an older one, which reads NOT current and closes the gate exactly like
 *  an absent grant), and ABSENT (no row at all).
 *
 *  ⚠ 見本 かえる (cus-06) IS THE STALE CASE, and she is on the picker TWICE
 *  today (13:00 and 17:12). A stale grant is the one W7-1 failure mode a
 *  permissive flag could hide, so the room must be able to land on it by
 *  ordinary use rather than by a harness world. */
export const consentGrants: FixtureConsentGrant[] = [
  { customer_id: 'cus-02', policy_version: CONSENT_POLICY_VERSION, granted_days_ago: 3, method: 'VERBAL' },
  { customer_id: 'cus-08', policy_version: CONSENT_POLICY_VERSION, granted_days_ago: 12, method: 'VERBAL' },
  { customer_id: 'cus-04', policy_version: CONSENT_POLICY_VERSION, granted_days_ago: 1, method: 'VERBAL' },
  { customer_id: 'thin-02', policy_version: CONSENT_POLICY_VERSION, granted_days_ago: 20, method: 'VERBAL' },
  { customer_id: 'thin-01', policy_version: CONSENT_POLICY_VERSION, granted_days_ago: 9, method: 'VERBAL' },
  { customer_id: 'cus-01', policy_version: CONSENT_POLICY_VERSION, granted_days_ago: 30, method: 'VERBAL' },
  { customer_id: 'cus-05', policy_version: CONSENT_POLICY_VERSION, granted_days_ago: 44, method: 'VERBAL' },
  // ⚠ THE STALE GRANT. She DID consent — under the policy this product replaced
  // — so the honest sentence is 「同意の記録は古い方針のものです」, never
  // 「同意なし」, and the gate closes all the same (W7-1).
  { customer_id: 'cus-06', policy_version: 'v1-2026-05', granted_days_ago: 120, method: 'VERBAL' },
  // cus-03 / cus-07 / cus-09 / cus-10 / cus-11 carry NO row at all — absent, the
  // third state, and the one the read-aloud flow exists for.
]

/** THE TAKES. Twelve — ten in 銀座, two in 代官山 — and between them every
 *  state the 録音履歴 has to be able to show with the discarded-first precedence
 *  the phone seals structurally (`lib/recordings/inbox.ts`): 保存済み, 確認待ち,
 *  処理中, 失敗, 復元可能 and four different 破棄済み takes.
 *
 *  ⚠ THREE OF THE FOUR DISCARDED TAKES SIT ON A SESSION THAT ALSO HAS A カルテ,
 *  AND THAT IS THE POINT. A staffer throws away a bad recording and writes the
 *  record by hand; the session is 保存済み by the record test and 破棄済み by the
 *  ledger test, and the phone's own precedence says the discard wins —
 *  structurally, so no later branch can hand a discarded row an affordance. A
 *  plane where the two never overlap could not prove that at all. */
export const takes: FixtureTake[] = [
  {
    // TODAY 10:00, 銀座 — the ordinary finished take: transcribed, saved, and
    // the カルテ (K-0001, through apt-12) exists.
    id: 'rs-0001',
    appointment_id: 'apt-12',
    store_id: null,
    day_offset: null,
    started_minute: 10 * 60,
    by_staff_card_id: 'c-04',
    duration_seconds: 2760,
    job: 'done',
    job_error: null,
    local_audio: false,
    settled: true,
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // TODAY 10:30, 銀座 — 確認待ち: the record landed (K-0002) but THIS device
    // never settled the take, so the staffer never watched the save happen.
    id: 'rs-0002',
    appointment_id: 'apt-22',
    store_id: null,
    day_offset: null,
    started_minute: 10 * 60 + 30,
    by_staff_card_id: 'c-01',
    duration_seconds: 3120,
    job: 'done',
    job_error: null,
    local_audio: false,
    settled: false,
    ticket_redeemed: true,
    discarded: null,
  },
  {
    // 2日前, 銀座 — THE RICH DISCARD. A written reason, the words that WERE
    // kept (above the floor, so the ⚖ spend gate let the transcription run),
    // and a 回数券 burn that already happened. ⚖ R2 keeps the take out of every
    // NUMBER; ⚖ 8/20 (b) still makes the manager tell somebody about the burn.
    id: 'rs-0003',
    appointment_id: 'apt-10',
    store_id: null,
    day_offset: null,
    started_minute: 10 * 60 + 4,
    by_staff_card_id: 'c-01',
    duration_seconds: 1680,
    job: 'done',
    job_error: null,
    local_audio: false,
    settled: true,
    ticket_redeemed: true,
    discarded: {
      minute: 12 * 60 + 20,
      by_staff_card_id: 'c-01',
      reason: '別のお客様の予約を選んだまま録音を始めてしまいました。正しい予約で録り直し、そちらをカルテに使っています。',
      // ⚠ TIMED, and the times cross THREE 5分 boundaries on purpose: the
      // bounded reading panel's dividers are derived from `start_time`, so a
      // plane whose segments all sat inside one interval could not prove the
      // derivation at all.
      transcript: [
        { start_time: 12, end_time: 39, text: 'それでは本日もよろしくお願いいたします。前回から二週間ほど空きましたが、その後お変わりありませんでしたか。' },
        { start_time: 96, end_time: 130, text: 'おかげさまで、肩の張りはだいぶ楽になりました。ただ夕方になるとまた重くなってしまって。' },
        { start_time: 402, end_time: 447, text: 'では今日は肩甲骨のまわりから、ゆっくりほぐしていきますね。力加減はいかがですか。' },
        { start_time: 655, end_time: 690, text: 'ちょうどいいです。このくらいで続けていただけると助かります。' },
        { start_time: 1024, end_time: 1061, text: 'すみません、いま画面を見たら別のお客様の予約になっていました。一度止めますね。' },
      ],
    },
  },
  {
    // 14日前, 銀座 — THE BELOW-FLOOR DISCARD. Eight seconds: the accidental tap.
    // It still went through the SAME required written-reason dialog (W7-2 —
    // there is no reason-free route), and 10秒未満 is DATA the manager screen
    // renders as a plain fact, never a warning and never a pre-selected excuse.
    // Nothing was transcribed, because nothing was ever sent (the spend gate).
    id: 'rs-0004',
    appointment_id: 'apt-05',
    store_id: null,
    day_offset: null,
    started_minute: 16 * 60 + 2,
    by_staff_card_id: 'c-03',
    duration_seconds: 8,
    job: null,
    job_error: null,
    local_audio: false,
    settled: true,
    ticket_redeemed: false,
    discarded: {
      minute: 16 * 60 + 3,
      by_staff_card_id: 'c-03',
      reason: 'ポケットの中で録音ボタンに触れてしまいました。施術はまだ始まっていません。',
      transcript: null,
    },
  },
  {
    // 21日前, 銀座 — THE NO-CONSENT DISCARD (⚖ 8/20 ⑤): the event and the reason
    // are kept, and nothing else ever was. A take with no current consent
    // cannot start on THIS page — but the phone lets a walk-in start unbound and
    // asks at save, so a session that reached a discard without a consent on
    // file is a real shape, and its transcript was never written down.
    id: 'rs-0005',
    appointment_id: 'apt-08',
    store_id: null,
    day_offset: null,
    started_minute: 17 * 60 + 1,
    by_staff_card_id: 'c-03',
    duration_seconds: 940,
    job: null,
    job_error: null,
    local_audio: false,
    settled: true,
    ticket_redeemed: false,
    discarded: {
      minute: 17 * 60 + 30,
      by_staff_card_id: 'c-03',
      reason: 'お客様から録音の同意をいただけなかったため、その場で破棄しました。',
      transcript: null,
    },
  },
  {
    // 10日前, 銀座 — THE DEPARTED STAFFER. `c-08` is a staff CARD the roster no
    // longer resolves on EITHER key, so the ledger names it 担当者不明 rather
    // than dropping the row: who left is not a reason to lose the record of what
    // they did (⚖ #799's own case).
    id: 'rs-0006',
    appointment_id: 'apt-35',
    store_id: null,
    day_offset: null,
    started_minute: 11 * 60 + 2,
    by_staff_card_id: 'c-08',
    duration_seconds: 3300,
    job: 'done',
    job_error: null,
    local_audio: false,
    settled: true,
    ticket_redeemed: false,
    discarded: {
      minute: 12 * 60 + 9,
      by_staff_card_id: 'c-08',
      reason: '施術の説明が長くなり、途中から別のスタッフの会話が入ってしまったため録り直しました。',
      transcript: [
        { start_time: 20, end_time: 58, text: '本日はご予約ありがとうございます。まず気になっているところを伺わせてください。' },
      ],
    },
  },
  {
    // TODAY, 銀座 — 処理中. UNBOUND (the phone's walk-in door: record first, pick
    // the customer at save), so it carries its own store and no booking.
    id: 'rs-0007',
    appointment_id: null,
    store_id: STORE_A,
    day_offset: 0,
    started_minute: 12 * 60 + 40,
    by_staff_card_id: 'c-06',
    duration_seconds: 1500,
    job: 'running',
    job_error: null,
    local_audio: false,
    settled: false,
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 1日前, 銀座 — 失敗, and the one error core NAMES: the audio carried no
    // speech. The words for it are the pipeline's own, so one failure reads the
    // same on every surface.
    id: 'rs-0008',
    appointment_id: null,
    store_id: STORE_A,
    day_offset: -1,
    started_minute: 15 * 60 + 12,
    by_staff_card_id: 'c-06',
    duration_seconds: 620,
    job: 'failed',
    job_error: 'empty-transcript',
    local_audio: false,
    settled: false,
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 1日前, 銀座 — 復元可能: the audio is still on this device and was never
    // saved. THE ONE RECOVERY SLOT (W7-3): single-slot, take-shaped, and under
    // the accidental-tap floor, which is the ONLY case the ⚖ 8/26 (b) banner
    // discard exit exists for.
    id: 'rs-0009',
    appointment_id: null,
    store_id: STORE_A,
    day_offset: -1,
    started_minute: 18 * 60 + 5,
    by_staff_card_id: 'c-06',
    duration_seconds: 6,
    job: null,
    job_error: null,
    local_audio: true,
    settled: false,
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 3日前, 代官山 — the other store's ordinary saved take (K-0011 via apt-03).
    id: 'rs-0020',
    appointment_id: 'apt-03',
    store_id: null,
    day_offset: null,
    started_minute: 13 * 60,
    by_staff_card_id: 'c-05',
    duration_seconds: 2600,
    job: 'done',
    job_error: null,
    local_audio: false,
    settled: true,
    ticket_redeemed: false,
    discarded: null,
  },
  {
    // 5日前, 代官山 — THE OTHER STORE'S DISCARD, and its reason carries a string
    // that appears NOWHERE ELSE in the world. That is what makes the
    // leaves-nothing-behind pin a search rather than an argument: the 銀座
    // props are scanned for 「代官山側の破棄理由」 and for this staffer's name.
    id: 'rs-0021',
    appointment_id: 'apt-11',
    store_id: null,
    day_offset: null,
    started_minute: 12 * 60 + 5,
    by_staff_card_id: 'c-02',
    duration_seconds: 2100,
    job: 'done',
    job_error: null,
    local_audio: false,
    settled: true,
    ticket_redeemed: false,
    discarded: {
      minute: 13 * 60 + 15,
      by_staff_card_id: 'c-02',
      reason: '代官山側の破棄理由: 空調の音が大きく、会話がほとんど聞き取れない状態でした。',
      transcript: [
        { start_time: 31, end_time: 66, text: '代官山側の文字起こし: ええと、すみません、少し聞き取りにくいのですが。' },
      ],
    },
  },
  {
    // 2日前, 銀座 — THE OTHER 失敗, and it is here because the room's failure
    // SENTENCE is derived from `job_error` rather than from whether the audio
    // survived. `rs-0008` carries the ONE code core names
    // (`empty-transcript`); this one carries `generic` with the SAME
    // `local_audio: false`, so the two rows differ in exactly the field the
    // mapping is supposed to read and in nothing else. A plane with only the
    // first row lets a room print the right sentence by coincidence.
    id: 'rs-0010',
    appointment_id: null,
    store_id: STORE_A,
    day_offset: -2,
    started_minute: 14 * 60 + 6,
    by_staff_card_id: 'c-06',
    duration_seconds: 1180,
    job: 'failed',
    job_error: 'generic',
    local_audio: false,
    settled: false,
    ticket_redeemed: false,
    discarded: null,
  },
]
