// 録音 — the room's derivations. Every judgement this page shows is made here
// ONCE and rendered wherever it is needed, so a chip and the count that includes
// it can never disagree (⚖ A8: more than one home for one verdict is the
// disease, not the symptom).
//
// PURE, AND THAT IS THE POINT. Nothing here reads the clock, touches data or
// knows React: the room's server assembly hands these functions the rows the
// store-clamped fixture door returned, and the room's SCREEN calls the same
// predicates on the client so the demo machine and the counts narrow by exactly
// the rules the props were computed with.
//
// ⚖ ONE TRUTH, TWO DOORS. A recording session is the phone app's session. The
// six inbox states and their precedence, the consent contract, the
// written-reason discard, the accidental-tap floor and the three transcript
// absence states are the phone's own contract — quoted here by SHAPE rather than
// imported, because Business territory may not reach into `src/lib/recording/*`,
// `src/lib/recordings/*` or `src/lib/karute/*` runtime (packet §3). Each
// mirrored shape names the file:line it mirrors.

import { jstDayKey } from './clock'
import { type FixtureAppointment, type FixtureCustomer, type FixtureMenu, type FixtureStaff, type FixtureStaffCard } from './fixtures'
import { type FixtureKaruteRecord } from './fixtures-karute'
import {
  BELOW_FLOOR_SEC,
  CONSENT_POLICY_VERSION,
  type FixtureConsentGrant,
  type FixtureTake,
  type FixtureTranscriptSegment,
} from './fixtures-recording'

// ── who may see what ────────────────────────────────────────────────────────

/** What a role may do in this room. THREE questions, and they are different:
 *  reading the store's takes rather than only one's own, opening the 破棄の記録
 *  review at all, and reading what a discarded take actually contained.
 *
 *  ⚠ THE SCOPE IS NOT A FILTER, IT IS A READ. `storeWide` decides which takes
 *  ENTER the model, so a staff member's props do not contain a colleague's
 *  session with a flag on it — they contain no colleague sessions at all. That
 *  is what makes the role split provable ABOVE serialization (packet §2e-3). */
export interface RecordingAccess {
  /** 録音履歴 = the store's takes (manager) rather than 自分の録音 (staff). */
  storeWide: boolean
  /** The 破棄の記録 screen exists for this reader (`staff.manage` today;
   *  `integrity.view` family at spec time — registry ⑤). */
  discardReview: boolean
}

const NO_ACCESS: RecordingAccess = { storeWide: false, discardReview: false }

const ACCESS_BY_ROLE: Record<string, RecordingAccess> = {
  オーナー: { storeWide: true, discardReview: true },
  店舗管理者: { storeWide: true, discardReview: true },
  スタッフ: { storeWide: false, discardReview: false },
}

/** FAIL-CLOSED, and on this table's OWN rows only. `Object.hasOwn` rather than a
 *  bare index: a role named `constructor` or `__proto__` resolves through the
 *  prototype chain, `?? NO_ACCESS` never fires, and every flag reads `undefined`
 *  — falsy by luck rather than by rule (the room-4 F-M1 lesson, carried). */
export function accessFor(role: string): RecordingAccess {
  return Object.hasOwn(ACCESS_BY_ROLE, role) ? ACCESS_BY_ROLE[role] : NO_ACCESS
}

/** What the page says out loud about what this reader can and cannot see. One
 *  sentence per real rule, never a generic 「権限がありません」.
 *
 *  ⚖ Liam 8/30 D3 — THE TRANSCRIPT LINE IS THE SAME FOR EVERYONE, and it says
 *  what is TRUE: whether a manager may read a staff member's transcript is a
 *  per-business setting (dial #16 文字起こしの公開範囲), enforced at the data
 *  door, and this room opens no SAVED-take transcript door in either mode. The
 *  room must never print 「管理者も文字起こしは見られません」 — that would be this
 *  page inventing a rule the business is the one who decides. The sentence is
 *  VERBATIM the カルテ room's (`karute.ts` permissionNotice), because ⚖ A8 wants
 *  one wording for one rule across the family. */
export const TRANSCRIPT_POLICY_LINE = '文字起こしの閲覧は店舗の設定に従います（未接続）。'

export function permissionNotice(access: RecordingAccess): string[] {
  const lines = [`${TRANSCRIPT_POLICY_LINE}保存された録音の文字起こしは、この画面では表示しません。`]
  lines.push(
    access.storeWide
      ? '録音履歴にはこの店舗の録音が並びます。破棄された録音の理由と文字起こしは「破棄の記録」で確認できます。'
      : '録音履歴には自分が録音したものだけが並びます。ほかのスタッフの録音は表示されません。',
  )
  return lines
}

// ── ⚖ W7-1 · THE CONSENT FLOOR, AND IT HAS EXACTLY ONE PREDICATE ────────────

/** THREE states, and each one is a different sentence to a customer:
 *  · current — granted under the pinned policy version; the gate opens
 *  · stale   — granted under an OLDER version; they consented to something else,
 *              so the gate CLOSES and the staffer asks again
 *  · absent  — no grant at all; the gate closes and the read-aloud flow is the
 *              only way through
 *
 *  Mirrors `customers.getConsent` + the policy pin the shipped record page gates
 *  on (RecordPageView's consent gate, §2b-5). */
export type ConsentState = 'current' | 'stale' | 'absent'

export interface ConsentFacts {
  state: ConsentState
  /** The version the grant was made under — `null` when there is no grant. */
  grantedVersion: string | null
  /** Days ago it was taken, for the honest 「取得日」 line. `null` when absent. */
  grantedDaysAgo: number | null
}

/** THE ONE PLACE a customer's recording consent is judged. */
export function consentOf(customerId: string | null, grants: FixtureConsentGrant[]): ConsentFacts {
  if (customerId === null) return { state: 'absent', grantedVersion: null, grantedDaysAgo: null }
  const grant = grants.find((g) => g.customer_id === customerId)
  if (!grant) return { state: 'absent', grantedVersion: null, grantedDaysAgo: null }
  return {
    state: grant.policy_version === CONSENT_POLICY_VERSION ? 'current' : 'stale',
    grantedVersion: grant.policy_version,
    grantedDaysAgo: grant.granted_days_ago,
  }
}

/**
 * ⚖ W7-1 — CONSENT FAILS CLOSED IN EVERY MODE, AND THIS IS THE WHOLE GATE.
 *
 * The start gate is the bound customer's CURRENT consent AND NOTHING ELSE. This
 * function takes one argument on purpose: there is no mode, no flag and no
 * optional field for a caller to hand it, so no mode, flag or optional field can
 * waive the floor. A future prerequisite may only be ADDED as an `&&` at the
 * call site — it can never turn a closed gate into an open one, because this
 * function is the only thing that ever returns `true`.
 *
 * The W7 candidate's defect was the opposite shape: a permissive flag read
 * ALONGSIDE the consent, so one truthy field opened a gate the consent had
 * closed. The battery plants exactly that (`consent waived` · `stale-version
 * consent passing`) and both must go red.
 */
export function canStartRecording(consent: ConsentFacts): boolean {
  return consent.state === 'current'
}

/** What the gate says when it is closed, in the customer's own case. `null` when
 *  it is open — a page that explains a gate nobody is standing at is noise. */
export function consentGateNote(consent: ConsentFacts, customerName: string): string | null {
  if (consent.state === 'current') return null
  if (consent.state === 'stale') {
    return `${customerName}様の録音同意は、いまの説明文とは違う内容で取得されたものです。もう一度お読みして同意をいただくまで、録音を開始できません。`
  }
  return `${customerName}様の録音同意がまだ取得されていません。同意をいただくまで、録音を開始できません。`
}

/** The 同意状況 pill's own words and tone. Three states, three sentences — the
 *  受信トレイ consent lesson, carried: 「—」 is not 「同意なし」 and neither is
 *  「古い同意」. */
export const CONSENT_LABEL: Record<ConsentState, string> = {
  current: '同意あり',
  stale: '同意の記録が古い',
  absent: '同意なし',
}

export const CONSENT_TONE: Record<ConsentState, string> = {
  current: 'is-true',
  stale: 'is-stale',
  absent: 'is-false',
}

/** The 同意状況 panel's evidence line — what the record actually says. */
export function consentProofLine(consent: ConsentFacts): string {
  if (consent.state === 'current') {
    return `この録音セッションには同意取得の記録があります（${consent.grantedDaysAgo}日前・口頭での確認）。`
  }
  if (consent.state === 'stale') {
    return `同意の記録はありますが、いまの説明文（${CONSENT_POLICY_VERSION}）より前のものです（${consent.grantedVersion}・${consent.grantedDaysAgo}日前）。`
  }
  return 'この録音セッションの同意はまだ取得されていません。'
}

/** ⚖ CANON'S OWN DISCLAIMER, kept verbatim-in-meaning (fable-record-session
 *  .html:450): the LINE/SMS/メール tags are the customer profile's CONTACT
 *  permissions and are NOT recording consent. Two different questions that look
 *  alike is exactly how a staffer talks themselves into starting a take. */
export const CONTACT_TAGS_DISCLAIMER =
  '上のタグは顧客プロフィールの「同意・連絡」（連絡してよい手段の記録）です。録音の同意はこの画面で別に確認します。'

/** ⚖ THE CURRENT v2 SCRIPT, VERBATIM from the shipped phone
 *  (`messages/ja.json` recording.consentScript — it includes the photo clause
 *  canon's older copy predates). One wording for one flow across two doors. */
export function consentScript(customerName: string): string {
  return `${customerName}様、本日の施術内容を正確に記録し、カルテ作成と品質向上に役立てるため、施術中の会話の録音と経過写真の撮影・保存をさせていただいてもよろしいでしょうか？録音データと写真はカルテ作成とサービス改善のみに使用されます。`
}

/** recording.consentDialogInstructions, verbatim. */
export const CONSENT_INSTRUCTIONS =
  '以下の内容をお客様にお読みください。口頭で同意を得た場合のみ「同意を取得しました」をタップしてください。'

// ── the recorder's own state machine (canon §2a) ────────────────────────────

/** Canon's five (fable-record-session.html:665). The shipped phone collapses
 *  recording+paused into one visual phase because a thumb has no room for two;
 *  a DESK does, and 一時停止中 is a state a receptionist genuinely stands in, so
 *  the computer door keeps canon's five and the phone's meaning (a stop NEVER
 *  auto-saves — the staffer resolves the take). */
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped' | 'committed'

export const RECORDER_LABEL: Record<RecorderState, string> = {
  idle: '待機中',
  recording: '録音中',
  paused: '一時停止中',
  stopped: '停止',
  committed: '反映済み',
}

export const RECORDER_TONE: Record<RecorderState, string> = {
  idle: '',
  recording: 'is-recording',
  paused: 'is-paused',
  stopped: 'is-stopped',
  committed: 'is-committed',
}

/** mm:ss, canon's own `fmtTime` (:668) — and the phone's `formatElapsed`
 *  (RecordButtonCard.tsx:31), which is the same function under another name. */
export function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

/**
 * The waveform's bar heights — PURE, DETERMINISTIC, and never a clock or a
 * random.
 *
 * The phone's live bars come from real microphone samples
 * (`useWaveformBars`); this room records nothing, so its bars are a function of
 * the elapsed second and the bar index. Deterministic matters twice: the SSR
 * and the hydrated render must agree (a random here is a hydration mismatch),
 * and the probe has to be able to assert the same picture twice.
 *
 * Values are 0–1, exactly the range the phone's `scaleY` clamp expects
 * (RecordButtonCard.tsx:126) — and `scaleY` is the ONLY thing they are ever
 * spent on, because a composite-only property never lays out.
 */
export function waveformBars(count: number, tick: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    // A cheap integer hash: no Math.random, no Date, same answer everywhere.
    const n = Math.sin((i + 1) * 12.9898 + tick * 4.1414) * 43758.5453
    const frac = n - Math.floor(n)
    return 0.18 + frac * 0.82
  })
}

// ── ⚖ THE SIX TAKE STATES, WITH DISCARDED FIRST (§2b-4) ─────────────────────

/** The phone's own vocabulary and its own precedence
 *  (`src/lib/recordings/inbox.ts` InboxState). 破棄済み is listed first because
 *  it is DECIDED first: a deliberate discard is a decision a human already made
 *  and explained, and nothing a job probe or a local take says can outrank it. */
export type TakeState = 'discarded' | 'saved' | 'awaiting-check' | 'processing' | 'failed' | 'recoverable'

/** recording.inbox.state.* — the phone's words, verbatim. */
export const TAKE_STATE_LABEL: Record<TakeState, string> = {
  discarded: '破棄済み',
  saved: '保存済み',
  'awaiting-check': '確認待ち',
  processing: '処理中',
  failed: '失敗',
  recoverable: '復元可能',
}

/**
 * State → its chip class. R13 washes, never solid fills on a non-pressable
 * (RecordingsInboxCard.tsx CHIP_CLASS, carried).
 *
 * ⚠ 破棄済み IS THE QUIETEST CHIP ON THE CARD, deliberately (⚖ 8/20 doctrine,
 * A2-3): a discard is a finished, explained decision — not a failure and not an
 * alarm — so it gets no red, no amber and no accent. A staffer must never
 * hesitate to throw away a genuinely bad take to protect the colour of a row.
 */
export const TAKE_STATE_CHIP: Record<TakeState, string> = {
  discarded: 'rc-chip is-discarded',
  saved: 'rc-chip is-saved',
  'awaiting-check': 'rc-chip is-awaiting',
  processing: 'rc-chip is-processing',
  failed: 'rc-chip is-failed',
  recoverable: 'rc-chip is-recoverable',
}

/** The sub-line under a row. One reason, one string, no free text — the phone's
 *  own `InboxReason` set and its own words (recording.inbox.reason.*, plus the
 *  ONE error core names, whose wording is shared with the pipeline card so a
 *  single failure reads the same on every surface). */
export type TakeReason =
  | 'transcribing'
  | 'unsettled'
  | 'autoSaved'
  | 'emptyTranscript'
  | 'genericFailure'
  | 'localAudio'
  | null

export const TAKE_REASON_LINE: Record<Exclude<TakeReason, null>, string> = {
  transcribing: 'サーバーで文字起こし中',
  unsettled: 'まだ結果が届いていません',
  // ⚠ 確認待ち'S OWN SENTENCE, and it is NOT 「まだ結果が届いていません」. That
  // one is 処理中's — a row that is showing a カルテ id while saying the result
  // has not arrived contradicts itself two cells apart. The phone's word for
  // this state (recording.inbox.reason.autoSaved) says what actually happened:
  // the save landed by itself and nobody has confirmed it.
  autoSaved: 'この録音は自動で保存されました（まだ確認されていません）',
  emptyTranscript: '音声が認識できませんでした。録音に音声が入っているかご確認のうえ、もう一度お試しください。',
  genericFailure: 'この録音は保存されませんでした',
  localAudio: 'この端末に音声が残っています（未保存）',
}

/**
 * THE ONE PLACE a take's state is decided, and DISCARDED IS CHECKED FIRST.
 *
 * Structural, not a convention: placing the discard test above everything else
 * is what makes a discarded session resurfacing as a green 保存済み — or as an
 * actionable 復元可能 offering to save audio the staffer threw away —
 * IMPOSSIBLE rather than merely unlikely (`inbox.ts`'s own G9 argument). The
 * evidence underneath stays TRUE (this room never erases evidence either); the
 * state is what suppresses the affordance.
 */
export function takeStateOf(input: {
  discarded: boolean
  hasRecord: boolean
  settled: boolean
  job: FixtureTake['job']
  /** ⚠ WHAT FAILED, as core reported it — the ONLY thing the 失敗 sentence is
   *  allowed to read. `local_audio` says whether the DEVICE still holds the
   *  audio, which is a different question and answers 復元可能, never 「what went
   *  wrong」: deriving the sentence from it told a staffer their microphone
   *  picked up nothing for an infrastructure failure. */
  jobError: FixtureTake['job_error']
  localAudio: boolean
}): { state: TakeState; reason: TakeReason } {
  if (input.discarded) return { state: 'discarded', reason: null }
  if (input.hasRecord) {
    return input.settled ? { state: 'saved', reason: null } : { state: 'awaiting-check', reason: 'autoSaved' }
  }
  if (input.job === 'queued' || input.job === 'running') return { state: 'processing', reason: 'transcribing' }
  if (input.job === 'failed') {
    // The phone's own mapping (`lib/recordings/inbox.ts` FAILED branch): the ONE
    // code core names gets the pipeline's own sentence, and everything else gets
    // the generic one. ⚖ 8/26 (a) gates on this code EXACTLY.
    return {
      state: 'failed',
      reason: input.jobError === 'empty-transcript' ? 'emptyTranscript' : 'genericFailure',
    }
  }
  if (input.localAudio) return { state: 'recoverable', reason: 'localAudio' }
  return { state: 'processing', reason: 'unsettled' }
}

/**
 * ⚖ R2 — A DISCARDED TAKE FEEDS NOTHING, AND THIS IS THE STRUCTURAL GATE.
 *
 * ONE predicate, called by every consumer that counts, totals or offers an
 * action, so a future consumer cannot forget the rule: the discard is checked
 * where the affordance is decided rather than at each call site.
 */
export function feedsCounts(state: TakeState): boolean {
  return state !== 'discarded'
}

/** ⚖ 8/26 (b) — the accidental-tap floor, DERIVED from the stamped duration
 *  exactly as the server derives `below_floor`, never stored twice. `false` for
 *  an unstamped take: an unknown length is not a claim that it was short. */
export function isBelowFloor(durationSeconds: number | null): boolean {
  return durationSeconds !== null && durationSeconds < BELOW_FLOOR_SEC
}

export { BELOW_FLOOR_SEC }

// ── ⚖ #799 · THE TWO-SPACE STAFF-ID BRIDGE ──────────────────────────────────

/**
 * A staff CARD id → the name the world states for it, bridging BOTH keys.
 *
 * The shipped ledger stores `discarded_by` = a staff CARD id, and a roster mixes
 * card ids with profile ids — so naming a discarder is a real join with three
 * tiers and an honest floor:
 *   1. the card's `user_id` → that profile's name
 *   2. the card's `email` → the profile with the same email
 *   3. the card id itself standing in the profile list (the world's own `c-03`
 *      case: a person whose only id IS a card id) — ⚖ #799's 「the card's own
 *      name before 担当者不明」
 *   4. 担当者不明 — a DEPARTED staffer whose card resolves to nothing. The row
 *      still renders: who left is not a reason to lose the record of what they
 *      did.
 *
 * ⚠ LA-1 — ONE TIER OF THE SHIPPED READ IS MISSING HERE, AND IT IS MISSING
 * LEGITIMATELY. The phone's manager screen tries the CARD'S OWN `name` before
 * falling through to 担当者不明, so a departed staffer whose card still carries
 * the name they were hired under is named rather than anonymised. This room's
 * `FixtureStaffCard` has no `name` field — adding one would be a WORLD edit, and
 * the plane is ADD-only against `./fixtures` (packet §2e-4) — so the tier cannot
 * be expressed here at all. It is recorded rather than silently dropped:
 * registry ③ carries it, so the reconnect restores the phone's real tier ORDER
 * (user_id → email → card id → **card.name** → 担当者不明) instead of inheriting
 * this room's four.
 */
export function staffNameOfCard(
  cardId: string,
  cards: FixtureStaffCard[],
  roster: FixtureStaff[],
): string {
  const card = cards.find((c) => c.id === cardId)
  if (card?.user_id) {
    const byUser = roster.find((s) => s.id === card.user_id)
    if (byUser) return byUser.full_name
  }
  if (card?.email) {
    const byEmail = roster.find((s) => s.email !== null && s.email === card.email)
    if (byEmail) return byEmail.full_name
  }
  const asProfile = roster.find((s) => s.id === cardId)
  if (asProfile) return asProfile.full_name
  return '担当者不明'
}

/** The reverse direction, for the SCOPE: which card is the signed-in staffer?
 *  `operator.staff_id` is a PROFILE id, and a take is recorded by a CARD, so the
 *  self-scope needs the same bridge read the other way — or a staff member's own
 *  録音履歴 would be empty for the most ordinary reason there is. */
export function cardIdOfStaff(
  staffId: string | null,
  cards: FixtureStaffCard[],
  roster: FixtureStaff[],
): string | null {
  if (staffId === null) return null
  const byUser = cards.find((c) => c.user_id === staffId)
  if (byUser) return byUser.id
  const profile = roster.find((s) => s.id === staffId)
  if (profile?.email) {
    const byEmail = cards.find((c) => c.email !== null && c.email === profile.email)
    if (byEmail) return byEmail.id
  }
  // A profile whose id IS a card id (the `c-03` shape) is its own card.
  return cards.some((c) => c.id === staffId) ? staffId : null
}

// ── the model ───────────────────────────────────────────────────────────────

export interface TakeModel {
  id: string
  /** The take's store, resolved through its booking or stated by an unbound
   *  take. Carried so the isolation pin can be made on the MODEL rather than on
   *  a rendered string. */
  storeId: string | null
  /** `null` for an unbound (walk-in) take — the phone's own case. */
  appointmentId: string | null
  customerId: string | null
  /** `null` for an unbound take, which the room names 顧客未設定 rather than
   *  inventing a person. */
  customerName: string | null
  /** The staff CARD that recorded it, and the name that card resolves to. */
  byCardId: string
  byName: string
  /** JST day index (jstDayKey) of the session — the sort axis and the window
   *  walk's, compared on the client and never formatted there. */
  dayKey: number
  startedMinute: number
  durationSeconds: number | null
  belowFloor: boolean
  state: TakeState
  reason: TakeReason
  /** The カルテ this session produced, read through the SHARED booking rather
   *  than restated by the take. `null` = no record — which is what makes
   *  処理中/失敗/復元可能 possible at all. */
  karuteRecordId: string | null
  ticketRedeemed: boolean
  /** ⚖ 破棄. The row's own facts stay for every reader who can see the row at
   *  all; the REASON and the TRANSCRIPT are the 破棄の記録 screen's, gated by
   *  `discardReview` ABOVE serialization. */
  discarded: {
    minute: number
    byCardId: string
    byName: string
    reason: string | null
    transcript: FixtureTranscriptSegment[] | null
  } | null
}

export interface BuildTakesInput {
  takes: FixtureTake[]
  /** ⚠ THE CLAMP. Only bookings the lens returned — a take whose booking is not
   *  in this list is not this store's take and never becomes a row. */
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  staff: FixtureStaff[]
  staffCards: FixtureStaffCard[]
  records: FixtureKaruteRecord[]
  /** The resolved single-store lens, or `null` for the storeless one. An
   *  UNBOUND take has no booking to be clamped through, so it is clamped by its
   *  own `store_id` against this. */
  storeId: string | null
  /** jstDayKey of today, for an unbound take's own day offset. */
  todayKey: number
  access: RecordingAccess
  /** The signed-in staffer's CARD id. Non-null narrows the model to their OWN
   *  takes — a READ, not a filter (see `RecordingAccess`). */
  selfCardId: string | null
}

/**
 * Every take the lens — and the reader — can see, newest first.
 *
 * ⚠ THE JOIN IS THE GATE. A bound take resolves only through a booking the
 * store-clamped door returned, so another store's takes are not filtered out of
 * the output — they never enter it, and nothing about them (a customer's name, a
 * staffer's name, a reason, a transcript) exists anywhere in what this function
 * returns. That is what makes the leaves-nothing-behind pin provable on the
 * serialized props rather than on the pixels.
 *
 * ⚠ AND THE SCOPE IS THE SAME KIND OF GATE. A staff reader's model contains
 * their own takes and no others, so 「a colleague's row with the content
 * hidden」 is not a state this room can be in.
 *
 * ⚠ THE DISCARD REDACTION HAPPENS HERE TOO, for the same reason: a reader
 * without `discardReview` is not handed the reason and the transcript and told
 * not to look at them. The row keeps its census facts — the day, the staffer,
 * the duration, the 破棄済み chip — and carries nothing else.
 */
export function buildTakes(input: BuildTakesInput): TakeModel[] {
  const { takes, appointments, customers, staff, staffCards, records, storeId, todayKey, access, selfCardId } = input
  const bookingById = new Map(appointments.map((a) => [a.id, a]))
  const customerById = new Map(customers.map((c) => [c.id, c]))
  // A booking has at most one カルテ, so the record for a session is the record
  // for its booking. Read, never restated (packet §2e-4's one-home rule).
  const recordByAppointment = new Map(records.map((r) => [r.appointment_id, r.id]))

  const models: TakeModel[] = []
  for (const take of takes) {
    // ⚠ THE SCOPE READ, FIRST. A staff reader never even resolves a colleague's
    // booking, so nothing about it can leak through a later branch.
    if (!access.storeWide && take.by_staff_card_id !== selfCardId) continue

    let takeStoreId: string | null
    let dayKey: number
    let customerId: string | null = null
    let customerName: string | null = null
    let karuteRecordId: string | null = null

    if (take.appointment_id !== null) {
      const booking = bookingById.get(take.appointment_id)
      if (!booking) continue
      takeStoreId = booking.store_id
      dayKey = jstDayKey(booking.starts_at)
      customerId = booking.customer_id
      customerName = customerById.get(booking.customer_id)?.name ?? null
      karuteRecordId = recordByAppointment.get(booking.id) ?? null
    } else {
      // An unbound take carries its own store, and the clamp applies to it
      // directly — a storeless take belongs to no store and is hidden under a
      // clamped lens (hide, never show-and-refuse).
      if (storeId !== null && take.store_id !== storeId) continue
      if (storeId === null && take.store_id === null) continue
      takeStoreId = take.store_id
      dayKey = todayKey + (take.day_offset ?? 0)
    }

    const readable = take.discarded === null || access.discardReview
    const { state, reason } = takeStateOf({
      discarded: take.discarded !== null,
      hasRecord: karuteRecordId !== null,
      settled: take.settled,
      job: take.job,
      jobError: take.job_error,
      localAudio: take.local_audio,
    })

    models.push({
      id: take.id,
      storeId: takeStoreId,
      appointmentId: take.appointment_id,
      customerId,
      customerName,
      byCardId: take.by_staff_card_id,
      byName: staffNameOfCard(take.by_staff_card_id, staffCards, staff),
      dayKey,
      startedMinute: take.started_minute,
      durationSeconds: take.duration_seconds,
      belowFloor: isBelowFloor(take.duration_seconds),
      state,
      reason,
      karuteRecordId,
      // ⚖ R2 — a discarded take feeds no NUMBER, and the ticket burn is a
      // number's input. It is withheld from the model's counting field and
      // carried on the discard row instead (⚖ 8/20 (b): money never
      // auto-reverses, so the manager who owns the correction is still told).
      ticketRedeemed: take.discarded ? false : take.ticket_redeemed,
      discarded: take.discarded
        ? {
            minute: take.discarded.minute,
            byCardId: take.discarded.by_staff_card_id,
            byName: staffNameOfCard(take.discarded.by_staff_card_id, staffCards, staff),
            reason: readable ? take.discarded.reason : null,
            transcript: readable ? take.discarded.transcript : null,
          }
        : null,
    })
  }

  return models.sort((a, b) => b.dayKey - a.dayKey || b.startedMinute - a.startedMinute || a.id.localeCompare(b.id))
}

// ── ⚖ THE WINDOWED WALK (ANY-ROSTER-SIZE on the take dimension) ─────────────

/** The same 14-day span the カルテ room walks (`karute.ts` WINDOW_DAYS), for the
 *  same reason: a recordings desk does not page — it shows the recent stretch
 *  and walks backwards on request, because 「先週ぶん」 is a question a shop asks
 *  and 「3ページ目」 is not. */
export const WINDOW_DAYS = 7

/** Rows within `steps` windows of the newest one, plus how many are still behind
 *  the walk. Rows must arrive NEWEST FIRST.
 *
 *  A STEP THAT REVEALS NOTHING IS NOT A STEP: the walk keeps extending until the
 *  span either gains a row or reaches the oldest take there is, so a quiet
 *  fortnight does not read as a broken button. */
export function windowTakes<T extends { dayKey: number }>(
  rows: T[],
  steps: number,
): { visible: T[]; hidden: number } {
  if (rows.length === 0) return { visible: [], hidden: 0 }
  const newest = rows[0].dayKey
  const oldest = rows[rows.length - 1].dayKey
  let step = Math.max(1, Math.floor(steps))
  let cutoff = newest - step * WINDOW_DAYS + 1
  let visible = rows.filter((r) => r.dayKey >= cutoff)
  let before = rows.filter((r) => r.dayKey >= cutoff + WINDOW_DAYS).length
  while (visible.length === before && cutoff > oldest) {
    step += 1
    before = visible.length
    cutoff = newest - step * WINDOW_DAYS + 1
    visible = rows.filter((r) => r.dayKey >= cutoff)
  }
  return { visible, hidden: rows.length - visible.length }
}

// ── ⚖ 8/25 RULING B · THE COUNTS, BOTH WAYS, AS LABELLED PLAIN FACTS ────────

/** ⚖ #799 — the shipped ledger read paginates at 200 and flags truncation. The
 *  room mirrors the cap so the honesty copy has something real to be honest
 *  ABOUT: past it, the counts say out loud that older records are not in them. */
export const LEDGER_PAGE_SIZE = 200

export interface DiscardCounts {
  /** 今月の破棄 — a CALENDAR month in JST, never a 30-day window. */
  thisMonth: number
  /** 記録されている破棄 全n件 — everything the read returned. */
  total: number
  /** スタッフ別（今月）, heaviest first. ⚠ NO SORT CONTROL and no colour: a
   *  ranking control would turn this into a leaderboard, which is the one thing
   *  ⚖ ruling B says it must never be. */
  byStaff: Array<{ cardId: string; name: string; thisMonth: number }>
  /** The read hit its cap — the copy says the older records are missing. */
  truncated: boolean
}

/**
 * ⚖ 8/25 RULING B — every count is a LABELLED PLAIN FACT in neutral type. No
 * red, no threshold, no grade, no badge. A discard count must never be the thing
 * that makes a staff member hesitate to discard a recording they should discard.
 */
export function discardCounts(
  models: TakeModel[],
  year: number,
  month: number,
  pageSize: number = LEDGER_PAGE_SIZE,
): DiscardCounts {
  const all = models.filter((m) => m.discarded !== null)
  // The cap bites on the READ, newest first, exactly as the paginated core read
  // does — so `truncated` means 「older rows are not in these numbers」 rather
  // than 「some rows are missing from somewhere」.
  const read = all.slice(0, pageSize)
  const inMonth = read.filter((m) => inJstMonth(m.dayKey, year, month))
  const byCard = new Map<string, { name: string; n: number }>()
  for (const m of inMonth) {
    const key = m.discarded!.byCardId
    const seen = byCard.get(key) ?? { name: m.discarded!.byName, n: 0 }
    byCard.set(key, { name: seen.name, n: seen.n + 1 })
  }
  return {
    thisMonth: inMonth.length,
    total: read.length,
    byStaff: [...byCard.entries()]
      .map(([cardId, v]) => ({ cardId, name: v.name, thisMonth: v.n }))
      .sort((a, b) => b.thisMonth - a.thisMonth || a.name.localeCompare(b.name)),
    truncated: all.length > read.length,
  }
}

/** `jstDayKey` counts whole JST days, so `dayKey * DAY` READ IN UTC is that JST
 *  day at 00:00 — the getUTC* reads below are therefore JST calendar values by
 *  construction, and the server's own timezone cannot shift a take into the
 *  neighbouring month (the カルテ room's `monthCensus` trick, carried). */
function inJstMonth(dayKey: number, year: number, month: number): boolean {
  const d = new Date(dayKey * 86_400_000)
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month
}

/**
 * ⚖ 8/25 RULING B, STAFF HALF — 自分が今月破棄した録音 {n}件.
 *
 * UNGATED self-knowledge: a staff member may always know what THEY discarded.
 * `null` renders NOTHING — never 0 — because a zero we cannot stand behind is a
 * claim, and the phone's own card obeys the same rule
 * (RecordingsInboxCard `myDiscardsThisMonth`).
 */
export function ownDiscardsThisMonth(
  models: TakeModel[],
  selfCardId: string | null,
  year: number,
  month: number,
): number | null {
  if (selfCardId === null) return null
  return models.filter(
    (m) => m.discarded !== null && m.discarded.byCardId === selfCardId && inJstMonth(m.dayKey, year, month),
  ).length
}

// ── ⚖ 8/25 RULING A · THE THREE HONEST ABSENCE STATES ───────────────────────

/** VERBATIM from the shipped manager screen (`messages/ja.json`
 *  settings.discardReasons.transcript*): three answers, no invention, and a
 *  FAILED READ is none of the three — 「we could not look」 is not an answer
 *  about the words. This room reads a fixture plane and therefore cannot fail,
 *  so the fourth state is argued rather than rendered (build report R6 note). */
export type TranscriptAbsence = 'belowFloor' | 'none'

export const TRANSCRIPT_ABSENCE_LINE: Record<TranscriptAbsence, string> = {
  belowFloor: `録音が${BELOW_FLOOR_SEC}秒未満のため、文字起こしは行っていません。`,
  none: 'この録音の文字起こしはありません。',
}

// ── ⚖ Liam 8/31 · THE LONG-RECORDING LAW, AS A DERIVATION ───────────────────

/** How often the reading panel puts a marker down. Five minutes is the
 *  approved mock's own interval. */
export const TRANSCRIPT_DIVIDER_SEC = 5 * 60

/**
 * One row of the reading panel: either a segment's words with the moment they
 * were said, or a quiet interval marker.
 *
 * ⚠ THE MARKERS ARE DERIVED FROM `start_time`, NEVER FROM LINE COUNT. A panel
 * that put a 「5分」 rule after every seventh line would be printing a clock it
 * does not have — and a 47-minute take with eight lines in it would read as
 * eight minutes long.
 */
export type TranscriptEntry =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'line'; key: string; at: string; text: string }

export function transcriptEntries(segments: FixtureTranscriptSegment[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  let bucket = 0
  segments.forEach((s, i) => {
    const b = Math.floor(Math.max(0, s.start_time) / TRANSCRIPT_DIVIDER_SEC)
    // ONE marker for the interval the words actually land in — never a run of
    // markers for the empty intervals between two far-apart segments, which
    // would be the panel narrating silence it cannot hear.
    if (b > bucket) {
      const minutes = (b * TRANSCRIPT_DIVIDER_SEC) / 60
      out.push({ kind: 'divider', key: `d-${b}`, label: `${minutes}分` })
      bucket = b
    }
    out.push({ kind: 'line', key: `l-${i}`, at: fmtElapsed(s.start_time), text: s.text })
  })
  return out
}

/** The read-failure line, carried so the room's copy census can prove it exists
 *  as a DISTINCT string rather than being folded into 「ありません」 — the
 *  distinction the shipped screen makes and the reconnect will need (⚖ #798). */
export const TRANSCRIPT_FAILED_LINE = '文字起こしを読み込めませんでした。'

/** Which absence it is, decided ONCE from the take's own facts. Under the floor
 *  NOTHING was ever transcribed (the ⚖ spend gate) — a fact about what was DONE,
 *  not about what survived — and everything else is a plain 「ありません」. */
export function transcriptAbsenceOf(model: TakeModel): TranscriptAbsence {
  return model.belowFloor ? 'belowFloor' : 'none'
}

// ── the 破棄の記録 review's own rows ─────────────────────────────────────────

export interface DiscardLedgerRow {
  takeId: string
  /** ⚖ THE ROW IS CUSTOMER-LED (the approved 8/31 mock). `null` = an unbound
   *  take, which the room names 顧客未選択 rather than inventing a person. */
  customerName: string | null
  byCardId: string
  byName: string
  /** The written reason — ALWAYS visible on the row, never truncated. */
  reason: string
  transcript: FixtureTranscriptSegment[] | null
  absence: TranscriptAbsence
  durationSeconds: number | null
  belowFloor: boolean
  dayKey: number
  /** The JST minute the RECORDING started — the mock's 録音日時. */
  startedMinute: number
  /** The JST minute of the DISCARD — the mock's 破棄. */
  minute: number
  ticketRedeemed: boolean
}

/**
 * The manager's review rows, newest first.
 *
 * ⚠ IT REFUSES TO BUILD A ROW WITHOUT ITS REASON. A discard with no reason is
 * not a shape this product has (W7-2: every human discard path — below-floor
 * included — goes through the SAME required written-reason dialog), so a
 * reason-less row here would be the ledger inventing a state. The room's suite
 * plants one and asserts it never renders.
 */
export function discardLedger(
  models: TakeModel[],
  ticketOf: (model: TakeModel) => boolean,
  pageSize: number = LEDGER_PAGE_SIZE,
): DiscardLedgerRow[] {
  return models
    .filter((m) => m.discarded !== null && m.discarded.reason !== null && m.discarded.reason.trim() !== '')
    .slice(0, pageSize)
    .map((m) => ({
      takeId: m.id,
      customerName: m.customerName,
      byCardId: m.discarded!.byCardId,
      byName: m.discarded!.byName,
      reason: m.discarded!.reason!,
      transcript: m.discarded!.transcript,
      absence: transcriptAbsenceOf(m),
      durationSeconds: m.durationSeconds,
      belowFloor: m.belowFloor,
      dayKey: m.dayKey,
      startedMinute: m.startedMinute,
      minute: m.discarded!.minute,
      ticketRedeemed: ticketOf(m),
    }))
}

// ── the two derived labels a duration owes a reader ─────────────────────────

/**
 * ⚖ SELF-EXPLAINING NUMBERS (Liam 8/25) — a length says WHAT it measures, and
 * it says it EXACTLY.
 *
 * ONE HOME for both surfaces (the 録音履歴 row and the 破棄の記録 screen), and it
 * exists because the two of them used to round: `Math.round(sec / 60)分` reads a
 * 15分40秒 take as 「16分」 and — the sharp end — an 11-second take as 「1分」,
 * five times its real length, in exactly the band where a manager is judging
 * whether a written reason fits the recording it explains. Minutes and seconds
 * cannot be wrong about either.
 *
 * The trailing 秒 is dropped on a whole minute (「46分」, not 「46分0秒」): a zero
 * that carries no information is noise, and 46分 is not a rounding.
 */
export function durationText(seconds: number | null): string | null {
  if (seconds === null) return null
  if (seconds < 60) return `${seconds}秒`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m}分` : `${m}分${s}秒`
}

/** The 録音履歴 row's own label — the length, named, with 10秒未満 beside it as a
 *  PLAIN FACT (⚖ W7-2), never a warning and never a pre-selected excuse. */
export function takeDurationLabel(seconds: number | null, belowFloor: boolean): string {
  const text = durationText(seconds)
  if (text === null) return '長さ 記録なし'
  return belowFloor ? `長さ ${text}（${BELOW_FLOOR_SEC}秒未満）` : `長さ ${text}`
}

// ── the tour card's room-local placement correction ─────────────────────────

interface Box { left: number; top: number; width: number; height: number }

/**
 * ⚠ ROOM-LOCAL CORRECTION to the SHARED engine's documented LAST RESORT — the
 * same one the カルテ room carries (`karute.ts` keepCardOffHeading), and
 * DUPLICATED rather than imported ON PURPOSE.
 *
 * `spotCardAt` (`@/business/lib/guide`) places the tour card below the target,
 * else above it, else BESIDE it — and when a region has no free side at all its
 * last resort puts the card on top of the thing it is explaining. Two of this
 * room's sections are full-width and taller than a phone viewport (録音履歴 and
 * the 破棄の記録 list), so the last resort is reachable here exactly as it is
 * there.
 *
 * THE ENGINE IS ONE SHARED HOME AND IS FROZEN FOR THIS ROOM (packet §3), so the
 * correction lives room-side — the register room's D-M2 precedent. Importing
 * the カルテ room's copy would make a records room a dependency of a recording
 * room for a placement tweak; the queued ENGINE fix is where the two become one
 * again, and both copies name it so neither is forgotten.
 *
 * The card keeps the x the engine chose and only its TOP moves, to whichever
 * viewport edge is farther from the target's heading zone. A card that does not
 * sit over the heading is returned untouched, so every ordinary step still gets
 * exactly the engine's answer.
 */
export function keepCardOffHeading(
  at: { top: number; left: number },
  card: { width: number; height: number },
  target: Box,
  viewport: { width: number; height: number },
  /** A section's heading lives in its first rows; 64px covers this room's own
   *  `.rc-sec-title` line plus its margin at every band. */
  headingZone = 64,
): { top: number; left: number } {
  const zoneTop = target.top
  const zoneBottom = target.top + Math.min(headingZone, target.height)
  const overlapsX = at.left < target.left + target.width && at.left + card.width > target.left
  const overlapsHeading = at.top < zoneBottom && at.top + card.height > zoneTop
  if (!overlapsX || !overlapsHeading) return at
  const zoneMid = (zoneTop + zoneBottom) / 2
  const room = { top: zoneMid, bottom: viewport.height - zoneMid }
  const top = room.bottom >= room.top ? viewport.height - card.height - 10 : 10
  return { top: Math.max(10, top), left: at.left }
}

// ── the picker (canon §2a) ──────────────────────────────────────────────────

export interface PickerOption {
  appointmentId: string
  customerId: string
  customerName: string
  staffName: string
  menuName: string
  startsAt: string
  startedMinute: number
  consent: ConsentState
}

/**
 * Canon's own candidate rule (fable-record-session.html:581): TODAY's bookings
 * with an assigned staffer that are not a no-show, time-sorted.
 *
 * ⚠ THE 来店なし EXCLUSION IS A DATA-TRUTH RULE, not a tidy-up: a session nobody
 * attended cannot be recorded, so offering it would put an impossible state on
 * the picker (⚖ 8/9). `board_state === 'noshow'` is the world's own way of
 * saying it — the same field the day board reads.
 */
export function pickerOptions(input: {
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  menus: FixtureMenu[]
  staff: FixtureStaff[]
  grants: FixtureConsentGrant[]
  todayKey: number
  minuteOf: (iso: string) => number
}): PickerOption[] {
  const customerById = new Map(input.customers.map((c) => [c.id, c]))
  const menuById = new Map(input.menus.map((m) => [m.id, m]))
  const staffById = new Map(input.staff.map((s) => [s.id, s]))
  return input.appointments
    .filter((a) => jstDayKey(a.starts_at) === input.todayKey)
    .filter((a) => a.staff_id !== null)
    .filter((a) => a.status !== 'cancelled' && a.board_state !== 'noshow')
    .filter((a) => customerById.has(a.customer_id))
    .map((a) => {
      const customer = customerById.get(a.customer_id)!
      return {
        appointmentId: a.id,
        customerId: customer.id,
        customerName: customer.name,
        staffName: staffById.get(a.staff_id ?? '')?.full_name ?? '担当なし',
        menuName: menuById.get(a.menu_id ?? '')?.name ?? 'メニュー未記録',
        startsAt: a.starts_at,
        startedMinute: input.minuteOf(a.starts_at),
        consent: consentOf(customer.id, input.grants).state,
      }
    })
    .sort((a, b) => a.startedMinute - b.startedMinute || a.appointmentId.localeCompare(b.appointmentId))
}
