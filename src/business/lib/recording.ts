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
/** ⚠ 「本日」, NOT 「0日前」 (F6-9). A grant taken this morning is zero days old,
 *  and 「0日前」 is arithmetic showing through the copy — nobody says it. ONE
 *  home, because the thin consent line, its pop-down and the review all read it. */
export function grantedWhen(daysAgo: number | null): string {
  return daysAgo === 0 ? '本日' : `${daysAgo}日前`
}

export function consentProofLine(consent: ConsentFacts): string {
  if (consent.state === 'current') {
    return `この録音セッションには同意取得の記録があります（${grantedWhen(consent.grantedDaysAgo)}・口頭での確認）。`
  }
  if (consent.state === 'stale') {
    return `同意の記録はありますが、いまの説明文（${CONSENT_POLICY_VERSION}）より前のものです（${consent.grantedVersion}・${grantedWhen(consent.grantedDaysAgo)}）。`
  }
  return 'この録音セッションの同意はまだ取得されていません。'
}

/** The thin line's SHORT evidence — the mock's `.cl-ev` (the full text lives in
 *  the pop-down, which is `consentProofLine`). */
export function consentShortLine(consent: ConsentFacts): string {
  if (consent.state === 'current') return `同意取得の記録があります（${grantedWhen(consent.grantedDaysAgo)}・口頭）`
  if (consent.state === 'stale') return `同意の記録が古い方針のものです（${grantedWhen(consent.grantedDaysAgo)}）`
  return '同意の記録がありません'
}

/** What the thin line's own button offers, per state. `null` while the gate is
 *  open — a page that offers to re-take a consent nobody needs is noise. */
export function consentActionLabel(state: ConsentState): string | null {
  if (state === 'stale') return '同意を取り直す'
  if (state === 'absent') return '同意を取得'
  return null
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

/**
 * FOUR STATES, AND THE FOURTH IS THE LAST ONE THIS ROOM CAN REACH.
 *
 * Canon draws five (fable-record-session.html:665) and the fifth is 反映済み —
 * the take has been written into a カルテ. The shipped phone collapses
 * recording+paused into one visual phase because a thumb has no room for two; a
 * DESK does, and 一時停止中 is a state a receptionist genuinely stands in, so the
 * computer door keeps canon's separation and the phone's meaning (a stop NEVER
 * auto-saves — the staffer resolves the take).
 *
 * ⚠ 反映済み IS NOT ONE OF THEM HERE, AND THAT FOLLOWS FROM ⚖ R6-D3 (deviation
 * R6-18). 「この録音を使う」's commit REFUSES in this room — a demo commit would
 * claim a カルテ change the カルテ room provably does not show — so nothing can
 * ever put the machine into 反映済み. A label and a tone for a state no reader
 * can reach is a fifth state on paper only, and a reader counting the room's
 * states would count one that does not exist. The fifth RETURNS with registry ⑦
 * (カルテ記録への反映) at reconnect, when the commit lands for real.
 */
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

export const RECORDER_LABEL: Record<RecorderState, string> = {
  idle: '待機中',
  recording: '録音中',
  paused: '一時停止中',
  stopped: '停止',
}

export const RECORDER_TONE: Record<RecorderState, string> = {
  idle: '',
  recording: 'is-recording',
  paused: 'is-paused',
  stopped: 'is-stopped',
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
/** The ONE string a card that resolves to nobody is named by. Exported because
 *  a second consumer now has to RECOGNISE it — `staffBand` groups the
 *  unresolvable entries of the counts band, and a second spelling of this word
 *  would be a second kind of unknown person. */
export const UNRESOLVED_STAFF_NAME = '担当者不明'

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
  return UNRESOLVED_STAFF_NAME
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
    /** ⚠ WHETHER A REASON WAS WRITTEN — a FACT, not the content, so it survives
     *  the redaction that empties `reason` for a reader without `discardReview`.
     *  It is what `hasWrittenReason` asks, and therefore what every count and
     *  the ledger agree on. */
    hasReason: boolean
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
      // ⚠ THROUGH `feedsCounts`, NEVER A HAND-WRITTEN `=== 'discarded'`. The
      // rule had two hand-written copies and the named gate had no consumer at
      // all, which is a gate that is true today and forgotten by the next
      // number added (B1-5).
      ticketRedeemed: feedsCounts(state) && take.ticket_redeemed,
      discarded: take.discarded
        ? {
            minute: take.discarded.minute,
            byCardId: take.discarded.by_staff_card_id,
            byName: staffNameOfCard(take.discarded.by_staff_card_id, staffCards, staff),
            // ⚠ THE FACT SURVIVES THE REDACTION, THE CONTENT DOES NOT. 「a reason
            // was written」 and 「here is what it said」 are two different
            // questions, and only the second one is gated. Read off the PLANE,
            // before `readable` — otherwise a staff reader, whose reasons are
            // redacted to `null`, would have every one of their own discards
            // judged reason-less and their own monthly count would read 0.
            hasReason: take.discarded.reason.trim() !== '',
            reason: readable ? take.discarded.reason : null,
            transcript: readable ? take.discarded.transcript : null,
          }
        : null,
    })
  }

  return models.sort((a, b) => b.dayKey - a.dayKey || b.startedMinute - a.startedMinute || a.id.localeCompare(b.id))
}

// ── ⚖ THE WINDOWED WALK (ANY-ROSTER-SIZE on the take dimension) ─────────────

/** ONE WEEK per step, for the カルテ room's own reason (`karute.ts` WINDOW_DAYS,
 *  which walks its own span the same way): a recordings desk does not page — it
 *  shows the recent stretch and walks backwards on request, because 「先週ぶん」
 *  is a question a shop asks and 「3ページ目」 is not. The 録音履歴 caption names
 *  this span out loud, because a list that opens on a window and says nothing
 *  about it reads as the whole history (B1-13). */
export const WINDOW_DAYS = 7

/** Rows within `steps` windows of the newest one, plus how many are still behind
 *  the walk. Rows must arrive NEWEST FIRST.
 *
 *  A STEP THAT REVEALS NOTHING IS NOT A STEP: the walk keeps extending until the
 *  span either gains a row or reaches the oldest take there is, so a quiet
 *  fortnight does not read as a broken button.
 *
 *  ⚠ AND IT RETURNS THE STEP IT ACTUALLY LANDED ON, WHICH IS THE WHOLE POINT.
 *  The extension above used to be thrown away: the screen counted `steps + 1`
 *  from its own state, so the next press re-derived a step the walk had already
 *  walked past, landed on the same cutoff and returned the same window. On a
 *  salon closed for a fortnight (takes on day 0, −1, −40, −41, −80) that made
 *  さらに表示 a DEAD BUTTON for four consecutive presses — the exact class this
 *  function's own comment says it prevents. The caller stores `step`, so every
 *  press starts from where the walk really is (F6-1). */
export function windowTakes<T extends { dayKey: number }>(
  rows: T[],
  steps: number,
): { visible: T[]; hidden: number; step: number } {
  const asked = Math.max(1, Math.floor(steps))
  if (rows.length === 0) return { visible: [], hidden: 0, step: asked }
  const newest = rows[0].dayKey
  const oldest = rows[rows.length - 1].dayKey
  let step = asked
  let cutoff = newest - step * WINDOW_DAYS + 1
  let visible = rows.filter((r) => r.dayKey >= cutoff)
  let before = rows.filter((r) => r.dayKey >= cutoff + WINDOW_DAYS).length
  while (visible.length === before && cutoff > oldest) {
    step += 1
    before = visible.length
    cutoff = newest - step * WINDOW_DAYS + 1
    visible = rows.filter((r) => r.dayKey >= cutoff)
  }
  return { visible, hidden: rows.length - visible.length, step }
}

// ── ⚖ 8/25 RULING B · THE COUNTS, BOTH WAYS, AS LABELLED PLAIN FACTS ────────

/** ⚖ #799 — the shipped ledger read paginates at 200 and flags truncation. The
 *  room mirrors the cap so the honesty copy has something real to be honest
 *  ABOUT: past it, the counts say out loud that older records are not in them. */
export const LEDGER_PAGE_SIZE = 200

/**
 * ⚖ A8 — ONE ROW-ELIGIBILITY PREDICATE, ASKED BY EVERY CONSUMER OF THE DISCARDS.
 *
 * A discard with no written reason is not a shape this product has: every human
 * discard path — below-floor included — goes through the SAME required
 * written-reason dialog (W7-2). `discardLedger` has always refused to build a
 * row without one; `discardCounts` filtered on `discarded !== null` alone, so a
 * reason-less row was COUNTED and never LISTED — the band said 「今月の破棄 4件」
 * over a list of two, with nothing on the page explaining the gap.
 *
 * The guard lived in one consumer instead of in one predicate, which is exactly
 * the disease `feedsCounts` exists to cure for the take states. Both counts and
 * the list now ask this one question, so a count can never exceed what the list
 * shows — by construction rather than by both filters happening to agree.
 *
 * ⚠ IT ASKS THE FACT, NEVER THE REDACTED CONTENT. `reason` is `null` for two
 * completely different reasons — nobody wrote one, or this reader may not read
 * it — and testing the content would collapse them, giving a staff reader (whose
 * own reasons are always redacted) a monthly count of 0 for discards they made
 * themselves. `hasReason` is stamped in `buildTakes` from the plane, above the
 * redaction, so the two questions stay separate.
 */
export function hasWrittenReason(model: TakeModel): boolean {
  return model.discarded !== null && model.discarded.hasReason
}

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
  const all = models.filter(hasWrittenReason)
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

/** One entry of the rendered スタッフ別 band. `people` is how many DISTINCT
 *  staff cards the entry stands for — 1 for a named person, N for the grouped
 *  unresolvable ones. */
export interface StaffBandEntry {
  /** The React key. A card id for a named person; the unknown word itself for
   *  the one grouped entry — never rendered, never a raw id on screen. */
  rowKey: string
  name: string
  thisMonth: number
  people: number
}

/**
 * ⚖ THE BAND READS HONESTLY AT SCALE WITHOUT LOSING WHAT IT COUNTS (F6-7).
 *
 * `discardCounts.byStaff` is per-CARD and stays that way — that is ⚖ #799's own
 * two-space case and L1's B1-10: two departed staffers are two different people
 * and must never share a row or a React key. But a band that PRINTS
 * 「担当者不明 3件」 twenty-five times tells the manager nothing at all: the
 * repetitions are indistinguishable to the reader by construction, because the
 * name IS the absence of a name. A shop three years old with two dozen departed
 * staff got a summary twenty-five entries tall that answered no question.
 *
 * So the band GROUPS what the reader cannot tell apart, and says how many
 * people it grouped — 「担当者不明（25名）75件」. Every card is still its own
 * entry in the model, every ledger row still names its own take, and the number
 * of distinct unknown staffers is now a stated fact instead of a row count the
 * reader has to do arithmetic on. The named half is untouched, and the
 * single-unresolvable case renders exactly as it did (「担当者不明 25件」),
 * because one person is not a group.
 *
 * Heaviest-first is kept: it is the existing law and ⚖ ruling B's 「no ranking
 * CONTROL」 is about a sort the reader can press, not about a stable order.
 */
export function staffBand(byStaff: DiscardCounts['byStaff']): StaffBandEntry[] {
  const rows: StaffBandEntry[] = []
  let unknownPeople = 0
  let unknownTotal = 0
  for (const s of byStaff) {
    if (s.name === UNRESOLVED_STAFF_NAME) {
      unknownPeople += 1
      unknownTotal += s.thisMonth
    } else {
      rows.push({ rowKey: s.cardId, name: s.name, thisMonth: s.thisMonth, people: 1 })
    }
  }
  if (unknownPeople > 0) {
    rows.push({ rowKey: UNRESOLVED_STAFF_NAME, name: UNRESOLVED_STAFF_NAME, thisMonth: unknownTotal, people: unknownPeople })
  }
  return rows.sort((a, b) => b.thisMonth - a.thisMonth || a.name.localeCompare(b.name))
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
 *
 * ⚠ AND IT READS THE SAME CAPPED LEDGER THE MANAGER'S COUNTS DO, WITH THE
 * PHONE'S OWN TRUNCATION MEANING. It used to read the whole model list
 * uncapped, so on a desk past the cap the 録音 screen said 「自分が今月破棄した
 * 録音 260件」 and the 破棄の記録 screen said 「見本 あずさ 200件」 one press
 * later — two numbers for one person's month, and only the second one admitted
 * it was capped. The phone answers this exact question by paging the ledger and
 * returning **null** the moment the read did not reach the end
 * (`myDiscardCountThisMonth`, `recording-discards.ts:349-352`: 「past the cap
 * `mine` is a FLOOR and not the count … a number we cannot back is not shown at
 * all」). Same meaning here: past the cap the own-count is not a count, so it
 * renders nothing rather than a bigger number than the band's.
 */
export function ownDiscardsThisMonth(
  models: TakeModel[],
  selfCardId: string | null,
  year: number,
  month: number,
  pageSize: number = LEDGER_PAGE_SIZE,
): number | null {
  if (selfCardId === null) return null
  const all = models.filter(hasWrittenReason)
  const read = all.slice(0, pageSize)
  if (all.length > read.length) return null
  return read.filter((m) => m.discarded!.byCardId === selfCardId && inJstMonth(m.dayKey, year, month)).length
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

// ── THE BACKDROP CLOSES ON A DECISION, NEVER ON A LEFTOVER PRESS ────────────

/**
 * How long after a dialog appears its backdrop refuses to dismiss it (F6-2).
 *
 * ⚠ MEASURED, NOT ASSUMED. The second press of a double-tap on 破棄 / この録音を
 * 使う / 同意取得フローを開始 used to close the dialog the first press had just
 * opened — 9 of 9 in the sweep's matrix, at every realistic gap. The obvious
 * cure (「close only if the press STARTED on the backdrop」) does not work, and
 * the event trace is why: the scrim mounts UNDER a pointer that is already
 * resting where the opener was, so the second press's own `pointerdown` lands
 * on the scrim, and it arrives as `detail: 1` — a fresh click sequence, not
 * something the browser calls a double-click. Both 「the press began here」 and
 * 「the browser called it a double-click」 are therefore true of the leftover
 * press and cannot separate it from a decision.
 *
 * What separates them is that a decision takes a reader time and a double-tap
 * takes none: to dismiss on purpose you must see a panel that was not there,
 * decide against it, and press. 500ms is the platform's OWN double-click
 * interval (the macOS and Windows defaults), so the window in which a second
 * press can still belong to the first gesture is covered by construction rather
 * than by a number chosen to fit the test.
 *
 * Escape, cancel and the confirm are untouched: this delays ONE exit, the one
 * that can be taken by accident.
 */
export const SCRIM_SETTLE_MS = 500

// ── ⚖ W7-2 · THE REFUSED WRITE, WHICH IS ALSO A DESIGNED STATE ──────────────

/**
 * THE DISCARD'S FAIL-CLOSED SUBMIT, in the phone's own words
 * (`messages/ja.json` recording.discardReason.submitting / .failed /
 * .takeChanged — verbatim, all three).
 *
 * ⚠ WHY A REFUSED WRITE IS A SHAPE THIS ROOM OWES A DESIGN AT ALL. The confirm
 * is the final commitment gate for the whole discard, so a write that does not
 * land must leave the staffer exactly where they were: the reason they typed
 * still in the field, the dialog still open, retry and cancel both still live,
 * and NOTHING discarded — the phone's own rule
 * (`RecordingDiscardReasonDialog.tsx:20-23`). The room's local settle always
 * succeeds, so without these the shape a reconnect lands on would be the one
 * part of the flow nobody had designed. Rendered behind `?discardFail=`, the
 * `?recovery=1` precedent: a page that always shows a failure is a page
 * claiming one that did not happen.
 *
 * `takeChanged` is a DIFFERENT sentence from `failed`, and the distinction is
 * the point: 「we could not write it」 and 「it is too late, this take has moved
 * on」 send the staffer to two different next steps.
 */
export const DISCARD_SUBMITTING_LABEL = '破棄中...'
export const DISCARD_FAILED_LINE = '破棄を記録できませんでした。もう一度お試しください。'
export const DISCARD_STALE_LINE = 'この録音はすでに文字起こしに進んでいます。破棄できませんでした。'

/** Which refusal the `?discardFail=` demo renders. `null` = the ordinary flow,
 *  which is every render the param does not name. */
export function discardFailLine(param: string | undefined): string | null {
  if (param === '1') return DISCARD_FAILED_LINE
  if (param === 'stale') return DISCARD_STALE_LINE
  return null
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
    .filter(hasWrittenReason)
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

/**
 * The 録音履歴 row's own length, with 10秒未満 beside it as a PLAIN FACT (⚖ W7-2),
 * never a warning and never a pre-selected excuse.
 *
 * ⚠ NO 「長さ」 PREFIX, AND THAT IS ⚖ SELF-EXPLAINING NUMBERS RATHER THAN AN
 * EXCEPTION TO IT. The number is named exactly ONCE on every surface it appears
 * on: at a desk the 長さ column header names it, and at card widths the row's
 * own `::before` does. Carrying the word in the string as well printed
 * 「長さ｜長さ 25分」 in the table — caught in this round's own 1280 shot.
 */
export function takeDurationLabel(seconds: number | null, belowFloor: boolean): string {
  const text = durationText(seconds)
  if (text === null) return '記録なし'
  return belowFloor ? `${text}（${BELOW_FLOOR_SEC}秒未満）` : text
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
  /** The booking's own end, so the hero chip can say 施術中 vs 終了 from ONE
   *  clock read rather than guessing a length. */
  endMinute: number
  consent: ConsentState
  /** How many times this customer has FINISHED a session at this store before
   *  today — the number 「ご来店 N回目」 counts, and today's own visit is the
   *  N+1'th, which is why it is +1 at the label (⚖ self-explaining numbers). */
  visitsBefore: number
}

/**
 * Canon's own candidate rule (fable-record-session.html:581): TODAY's bookings
 * with an assigned staffer that are not a no-show, time-sorted.
 *
 * ⚠ THE 来店なし EXCLUSION IS A DATA-TRUTH RULE, not a tidy-up: a session nobody
 * attended cannot be recorded, so offering it would put an impossible state on
 * the picker (⚖ 8/9). `board_state === 'noshow'` is the world's own way of
 * saying it — the same field the day board reads.
 *
 * ⚖ LIAM F-1 R1-3 — AND THE LIST IS STAFF-SCOPED: BOOKINGS UNDER YOUR OWN NAME.
 * `ownStaffIds` is the phone's record-own-customer law mirrored onto the desk. A
 * 店舗管理者 who also treats records HER OWN customers here; the store-wide view
 * she is entitled to is the HISTORY below, not the recorder. It is a READ, not a
 * filter over a rendered list: a colleague's booking never becomes an option, so
 * nothing about it (a customer's name, a menu, a consent state) is in the props
 * at all. `null` means「no self to scope to」 and returns the unscoped list —
 * which is the harness's world, never the page's.
 *
 * ⚠ IT IS A SET, AND IT HAS TO BE (B2-3). A booking's `staff_id` column holds
 * BOTH id spaces in this plane — `fixtures.ts` tags apt-29/apt-33/apt-35 with the
 * PROFILE id `p-06` and apt-05/apt-14 with the CARD id `c-03` — so a single-key
 * filter over a dual-space column is a silent false negative: a card-tagged
 * operator reads 「あなたの担当の予約 0件」, which looks like a quiet evening desk
 * rather than a lookup that missed. This is the room's own #799 bridge-on-read
 * law, applied to the picker exactly as it already is to the discard rows: hold
 * both of the operator's keys and accept a booking tagged with either.
 */
export function pickerOptions(input: {
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  menus: FixtureMenu[]
  staff: FixtureStaff[]
  grants: FixtureConsentGrant[]
  todayKey: number
  minuteOf: (iso: string) => number
  ownStaffIds: ReadonlySet<string> | null
}): PickerOption[] {
  const customerById = new Map(input.customers.map((c) => [c.id, c]))
  const menuById = new Map(input.menus.map((m) => [m.id, m]))
  const staffById = new Map(input.staff.map((s) => [s.id, s]))
  const visitsBefore = visitCounts(input.appointments, input.todayKey)
  return input.appointments
    .filter((a) => jstDayKey(a.starts_at) === input.todayKey)
    .filter((a) => a.staff_id !== null)
    .filter((a) => input.ownStaffIds === null || (a.staff_id !== null && input.ownStaffIds.has(a.staff_id)))
    .filter((a) => a.status !== 'cancelled' && a.board_state !== 'noshow')
    .filter((a) => customerById.has(a.customer_id))
    .map((a) => {
      const customer = customerById.get(a.customer_id)!
      const startedMinute = input.minuteOf(a.starts_at)
      return {
        appointmentId: a.id,
        customerId: customer.id,
        customerName: customer.name,
        staffName: staffById.get(a.staff_id ?? '')?.full_name ?? '担当なし',
        menuName: menuById.get(a.menu_id ?? '')?.name ?? 'メニュー未記録',
        startsAt: a.starts_at,
        startedMinute,
        // ⚠ `max`, not the raw read: `jstMinuteOfDay` is a MINUTE OF ITS DAY, so
        // a session running past midnight would end at a smaller number than it
        // started at and read as 「終了」 from the moment it began.
        endMinute: Math.max(startedMinute, input.minuteOf(a.ends_at)),
        consent: consentOf(customer.id, input.grants).state,
        visitsBefore: visitsBefore.get(customer.id) ?? 0,
      }
    })
    .sort((a, b) => a.startedMinute - b.startedMinute || a.appointmentId.localeCompare(b.appointmentId))
}

/**
 * How many FINISHED sessions each customer has at this lens, strictly before
 * today. `done` and only `done`: a cancelled booking is not a visit, a no-show
 * is not a visit, and a booking still ahead of the clock has not happened yet.
 *
 * Computed ONCE for the whole picker rather than per option — the alternative is
 * an O(bookings) scan inside an O(bookings) map, which on a 200-booking harness
 * world is 40,000 comparisons for a number that is the same every time.
 */
function visitCounts(appointments: FixtureAppointment[], todayKey: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of appointments) {
    if (a.status !== 'done') continue
    if (jstDayKey(a.starts_at) >= todayKey) continue
    out.set(a.customer_id, (out.get(a.customer_id) ?? 0) + 1)
  }
  return out
}

// ── ⚖ THE ONE CLOCK READ, SPENT ON THE HERO AND THE DEFAULT ─────────────────

/** Where a booking stands against the render's single `now`. */
export type BookingPhase = 'now' | 'upcoming' | 'past'

/** `start ≤ now < end` is 施術中; anything later is ahead; anything else is done.
 *  Half-open on purpose — at exactly the end minute the session is over, and two
 *  back-to-back bookings must never both read 施術中. */
export function bookingPhaseOf(startMinute: number, endMinute: number, nowMinute: number): BookingPhase {
  if (nowMinute < startMinute) return 'upcoming'
  return nowMinute < endMinute ? 'now' : 'past'
}

/**
 * ⚖ THE SCREEN NEVER PICKS. Which booking the cockpit opens on is decided here,
 * from the same clock read everything else on the page used:
 *   1. the one in the room now — it is what a receptionist is standing over;
 *   2. else the NEXT one — the thing about to happen;
 *   3. else the LAST of the day — an evening desk looking back at what it did.
 * `null` only when the operator has no own bookings today at all.
 */
export function defaultPick(
  options: Array<{ appointmentId: string; startedMinute: number; endMinute: number }>,
  nowMinute: number,
): string | null {
  if (options.length === 0) return null
  const inRoom = options.find((o) => bookingPhaseOf(o.startedMinute, o.endMinute, nowMinute) === 'now')
  if (inRoom) return inRoom.appointmentId
  const next = options.find((o) => o.startedMinute > nowMinute)
  if (next) return next.appointmentId
  return options[options.length - 1].appointmentId
}

/** The picker row's own status hint — 「いま施術中」 while it is happening, else
 *  what this customer's history says. ⚖ SELF-EXPLAINING NUMBERS: 「ご来店 4回目」
 *  names what it counts, and today's visit is included in the ordinal. */
export function slotHint(phase: BookingPhase, visitsBefore: number): string {
  if (phase === 'now') return 'いま施術中'
  return visitsBefore === 0 ? '初めてのご来店' : `ご来店 ${visitsBefore + 1}回目`
}

// ── ⚖ 前回までの流れ — THE BEFORE-SESSION BRIEFING (the phone's, fuller) ─────

/**
 * ONE customer's history at this lens, newest first, as the briefing needs it.
 *
 * ⚠ IT IS A JOIN, AND IT STATES NOTHING. Every field comes from a booking the
 * store-clamped door returned or from the カルテ record hanging off that booking
 * (packet §2e-4's one-home rule): the plane holds no 「last visit」 field for this
 * to disagree with, and another store's session cannot appear because its
 * booking is not in the list to join through.
 *
 * ⚠ AND THE ROW TITLE IS THE MENU NAME, because the plane has no topic titles
 * and inventing one would be this room writing content (deviation R6-24). The
 * mock's 「肩・首まわり中心」 is mock copy, not a field.
 */
export interface BriefRecordRow {
  recordId: string
  dayKey: number
  /** The menu the session was booked as — the only title the plane actually has. */
  title: string
}

export interface BriefFacts {
  /** `null` = this customer has no finished session at this store yet. */
  last: { dayKey: number; menuName: string; staffName: string; recordId: string | null } | null
  visitsBefore: number
  /** Newest first, ALL of them — the screen shows the recent few and puts the
   *  depth behind one door (v5-3 recent-first-with-doors). */
  records: BriefRecordRow[]
  /** The last record's EFFECTIVE summary (`summary_edited ?? summary_ai`) —
   *  what a staffer would actually read, never the superseded AI text under a
   *  human rewrite. `null` = no summary exists yet, which is what 初めて means
   *  and also what AI補完待ち means; the two are told apart by `last`. */
  summary: string | null
  /** The last record's own entries, in the カルテ room's category order, each
   *  carrying that room's own label — never a lead this room made up. */
  memo: Array<{ label: string; text: string }>
}

export function briefFactsOf(input: {
  customerId: string
  todayKey: number
  /** The lens's bookings — the clamp, exactly as `buildTakes` uses it. */
  appointments: FixtureAppointment[]
  menus: FixtureMenu[]
  staff: FixtureStaff[]
  records: FixtureKaruteRecord[]
  /** The カルテ room's own category order and labels, passed in rather than
   *  imported: this room does not own that vocabulary and must not fork it. */
  categoryOrder: readonly string[]
  categoryLabel: Readonly<Record<string, string>>
}): BriefFacts {
  const menuById = new Map(input.menus.map((m) => [m.id, m]))
  const staffById = new Map(input.staff.map((s) => [s.id, s]))
  const recordByAppointment = new Map(input.records.map((r) => [r.appointment_id, r]))

  const past = input.appointments
    .filter((a) => a.customer_id === input.customerId)
    .filter((a) => a.status === 'done')
    .filter((a) => jstDayKey(a.starts_at) < input.todayKey)
    .sort((a, b) => jstDayKey(b.starts_at) - jstDayKey(a.starts_at) || b.id.localeCompare(a.id))

  const rows: BriefRecordRow[] = []
  for (const a of past) {
    const record = recordByAppointment.get(a.id)
    if (!record) continue
    rows.push({
      recordId: record.id,
      dayKey: jstDayKey(a.starts_at),
      title: menuById.get(a.menu_id ?? '')?.name ?? 'メニュー未記録',
    })
  }

  const lastBooking = past[0] ?? null
  const lastRecord = lastBooking ? (recordByAppointment.get(lastBooking.id) ?? null) : null
  const summaryText = lastRecord ? (lastRecord.summary_edited ?? lastRecord.summary_ai) : null

  const memo: Array<{ label: string; text: string }> = []
  if (lastRecord) {
    for (const category of input.categoryOrder) {
      for (const e of lastRecord.entries) {
        if (e.category !== category) continue
        memo.push({ label: input.categoryLabel[category] ?? category, text: e.text })
      }
    }
  }

  return {
    last: lastBooking
      ? {
          dayKey: jstDayKey(lastBooking.starts_at),
          menuName: menuById.get(lastBooking.menu_id ?? '')?.name ?? 'メニュー未記録',
          staffName: staffById.get(lastBooking.staff_id ?? '')?.full_name ?? '担当なし',
          recordId: lastRecord?.id ?? null,
        }
      : null,
    visitsBefore: past.length,
    records: rows,
    summary: summaryText,
    memo,
  }
}

/** How many カルテ rows the briefing panel shows before the door — the mock's
 *  own `KARUTE_SHOWN`. */
export const BRIEF_RECORDS_SHOWN = 3

// ── ⚖ THE 要対応 STRIP (mock `.attn`) ───────────────────────────────────────

/**
 * ⚖ THE PILL/COUNT LAW, ON THE STRIP TOO: every pill's number is EXACTLY what
 * its filter reveals, so both are taken over the SAME set — the window the walk
 * has opened, which is the set the filter row narrows.
 *
 * ⚠ AND THE STRIP IS ABSENT WHEN THERE IS NOTHING TO DO. A 「要対応 0件」 header
 * over three empty pills is a page inventing a warning; a shop with a clean desk
 * sees no strip at all.
 */
export interface AttentionCounts {
  recoverable: number
  failed: number
  awaiting: number
  total: number
}

export function attentionCounts(rows: Array<{ state: TakeState }>): AttentionCounts {
  let recoverable = 0
  let failed = 0
  let awaiting = 0
  for (const r of rows) {
    if (r.state === 'recoverable') recoverable += 1
    else if (r.state === 'failed') failed += 1
    else if (r.state === 'awaiting-check') awaiting += 1
  }
  return { recoverable, failed, awaiting, total: recoverable + failed + awaiting }
}

/** ⚠ THE LOCAL TAKE'S OWN WINDOW, from the plane's 7-day fact and nothing else.
 *  `null` when the residue is already past it — a promise of 「あと0日」 is not a
 *  promise, and a negative one is arithmetic leaking onto the page. */
export const LOCAL_AUDIO_DAYS = 7

export function daysLeftLine(dayKey: number, todayKey: number): string | null {
  const left = LOCAL_AUDIO_DAYS - (todayKey - dayKey)
  return left > 0 ? `あと${left}日で端末から消えます` : null
}
