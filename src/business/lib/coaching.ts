// コーチング — the room's derivations. PURE: no clock, no data access, no React.
// The props file hands it the world's staff and this room's fixture plane; it
// hands back two models that are already the shape each viewer is allowed to see.
//
// ⚖ THE VISIBILITY WALL IS ENFORCED ABOVE THE SERIALIZER, and that is the whole
// architecture of this file (the room-6 redaction pattern, and `contract.ts`'s
// own load-bearing idea, contract.ts:10-23). There are TWO builders and they
// return DIFFERENT TYPES:
//
//   buildSelfView → SelfView   (L1) — one person's own mirror: the metric spine,
//                                the ranked honest findings with their ONE
//                                verbatim moment, the category scores with the
//                                top benchmark, the focus recommendations.
//   buildTriage   → TriageView (L2) — the roster as BANDS. There is no field on
//                                `TriageRow` for a closing rate, a gap, a rank or
//                                a session count, so a mis-wired component cannot
//                                leak one: there is nothing to read it from.
//
// ⚖ EVERY SHAPE IS A MIRROR, WITH ITS CITE (Liam 9/1). The generators are the
// carefully built asset and nothing here is guessed — each model below names the
// prompt module or contract type it mirrors and the line it mirrors, so the real
// generation slots in at reconnect with zero reshaping. Business territory may
// not import phone runtime, so the mirror is BY SHAPE with a cite.
//
// A colleague's row never enters `SelfView` — the self read is a LOOKUP BY THE
// VIEWER'S OWN ID, not a filter over the roster (the room-6 scope law: a scope
// that filters can be un-filtered; a scope that never reads cannot).
//
// ⚖ ANTI-COERCION, STRUCTURALLY (COACHING_VISIBILITY_MODEL §3). A staff member
// who declined the depth-share and one who was never asked produce the SAME
// `TriageRow` — the grant is read exactly once, into an aggregate count, and
// never onto a row. There is no stigma marker for a mis-wiring to reveal.
//
// ⚖ NO RANK, ANYWHERE. `PerformanceBand` is a trajectory against a staff
// member's OWN baseline (staff-focus.ts:64-66 — precomputed upstream, echoed by
// the model, never recomputed by it), so two people can hold the same band and
// the board has no order to read as a league table. There is deliberately no
// comparator and no sort key over the roster in this file.

import { coachingPolicy } from './fixtures-coaching'
import type { FixtureCoachingStaff, FixtureFinding } from './fixtures-coaching'

/** ⚠ ONE HOME FOR THE SESSION COUNT. The run's own `window.sessions_reviewed`
 *  (personal-findings.ts:219) is the n behind every claim on this page — the
 *  spine's 「34回のセッションから」, the band's floor, the maturity flag and the
 *  focus run's own bar all read THIS. Stating it twice let a change to one of
 *  them move nothing, which the mutation battery caught (mutant M16). */
export function sessionsOf(row: FixtureCoachingStaff): number {
  return row.findingsRun.sessions_reviewed
}

// ── the module gate ─────────────────────────────────────────────────────────

/** ⚖ Coaching is OPT-IN PER STORE and PAYWALLED (coaching-design-principle):
 *  「off = surfaces don't render AND no generation fires」 — the switch is a real
 *  cost gate, not a UI hide. So the gate is asked BEFORE the plane is read, and
 *  a store with it off produces a model with no coaching data in it at all.
 *  Registry ⑤ is where the real switch (`org_settings.coaching_enabled`) lands. */
export function moduleOn(storeId: string | null, enabled: string[]): boolean {
  // A business-wide lens is not a store, and the module is a per-store decision:
  // there is no honest single answer for 「every store at once」, so the room
  // says so rather than picking one store's answer for all of them.
  return storeId !== null && enabled.includes(storeId)
}

// ── the two floors the GENERATORS themselves state ──────────────────────────

/** personal-findings.ts:153 — 「'insufficient_data': <6 sessions — set this,
 *  leave findings/strengths empty」. The findings run's own bar, not this room's. */
export const FINDINGS_MIN_SESSIONS = 6

/** staff-focus.ts:238 — 「If <4 sessions this month, return status 'skipped'」.
 *  The focus run's own bar. A 'skipped' staff member has no L2 summary, which is
 *  why the board can say 「まだ判断できません」 without inventing a state. */
export const FOCUS_MIN_SESSIONS = 4

/** staff-focus.ts:113-115 — 「if a category's evidence is only 30d/90d (maturity
 *  'early' / <12 sessions at 180d+), mark confidence 'early_signal'」. A thin
 *  sample does not earn 'established'. */
export const MATURITY_MIN_SESSIONS = 12

/** ⚖ AND THE PRODUCT'S OWN DIAL, ON TOP OF THEM (COACHING_VISIBILITY_MODEL §4:
 *  「A sample-size floor (the existing min-sessions setting) gates whether a
 *  staff member gets a bucket at all (else 'building data')」). The generators'
 *  bars are floors on GENERATION; this is the store's own bar on whether a band
 *  is shown to an owner at all, and it sits above both.
 *
 *  THE DEFAULT AND ITS GUARDRAIL, together, because ⚖ 8/21 says a dial never
 *  ships without both: `sampleFloor` CLAMPS whatever a store sets into 10…60, so
 *  a store cannot set it to 1 and turn a coin flip into a verdict about a
 *  person, and cannot set it to 500 and switch the board off by the back door.
 *  The dial itself is registry ⑤ (設定 room, #20–#22 candidates); the real
 *  setting's default is Anthony's to state, and this is the room's until then. */
export const FLOOR_DEFAULT = 20
export const FLOOR_MIN = 10
export const FLOOR_MAX = 60
export function sampleFloor(setting?: number): number {
  if (typeof setting !== 'number' || !Number.isFinite(setting)) return FLOOR_DEFAULT
  return Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, Math.round(setting)))
}

/** A band also needs enough HISTORY to be a trajectory rather than a snapshot
 *  (the §16 multi-horizon composite the visibility model names): a baseline plus
 *  a current period is three points, and two of them is a straight line. */
export const MIN_HISTORY = 3

// ── the trajectory band ─────────────────────────────────────────────────────

/** contract.ts:60 PerformanceBand, and staff-focus.ts:48's `Band` — the same
 *  three values, deliberately: 「bands map to contract.ts PerformanceBand
 *  exactly」 (staff-focus.ts:35). */
export type PerformanceBand = 'growing' | 'steady' | 'needs-support'

/** staff-focus.ts:67 — the maturity flag that rides beside a band. */
export type Maturity = 'established' | 'early'

/** Three percentage points. Below this, month-to-month movement in a closing
 *  rate is noise at these sample sizes, and calling noise 「成長中」 would put a
 *  person in front of their owner on a coin flip. */
const BAND_DELTA = 0.03

/** ⚖ AGAINST THEIR OWN BASELINE, NEVER AGAINST A COLLEAGUE. That single choice
 *  is what turns a leaderboard into a triage board: the top performer and the
 *  newest hire can both read 成長中, because the question is 「compared with how
 *  YOU were doing」 and nothing else. The baseline is the mean of every period
 *  BEFORE the current one, so one good month cannot carry a falling line.
 *
 *  Computed HERE and echoed by the generator, never the other way round —
 *  staff-focus.ts:64-66 is explicit that `overallBand` is precomputed upstream. */
export function bandOf(history: number[], sessions: number, floor: number): PerformanceBand | null {
  if (sessions < floor || history.length < MIN_HISTORY) return null
  const prior = history.slice(0, -1)
  const baseline = prior.reduce((a, b) => a + b, 0) / prior.length
  const delta = history[history.length - 1] - baseline
  if (delta >= BAND_DELTA) return 'growing'
  if (delta <= -BAND_DELTA) return 'needs-support'
  return 'steady'
}

/** staff-focus.ts:65-67 — 「When the staff is too new to trust a band, pass
 *  'early'」, at the module's own 12-session bar (:114). */
export function maturityOf(sessions: number): Maturity {
  return sessions >= MATURITY_MIN_SESSIONS ? 'established' : 'early'
}

export const BAND_LABEL: Record<PerformanceBand, string> = {
  growing: '成長中',
  steady: '安定',
  'needs-support': 'サポートが必要',
}

// ── the help action, paired 1:1 with every flag ─────────────────────────────

/** contract.ts:249-254 HelpAction, field for field. Never punitive, and never
 *  optional: ⚖ every needs-support flag ships paired 1:1, on the same screen,
 *  with a concrete thing the manager can DO (COACHING_VISIBILITY_MODEL §4). The
 *  pairing is a function of the band, so the two cannot come apart — there is no
 *  code path that produces a flag without one. */
export interface HelpAction {
  kind: 'assign-module' | 'manager-coaching' | 'peer-pairing'
  label: string
  /** contract.ts:253 — the target module when kind === 'assign-module'. It is
   *  the focus run's own `module_id` (staff-focus.ts:173), never invented here. */
  moduleId: string | null
}

/** ⚖ ALL THREE KINDS ARE REACHABLE. `peer-pairing` used to be a key nothing
 *  could return — a refusal sentence written for a lever no reader could ever
 *  press, counted by the census as if it were live. COACHING_VISIBILITY_MODEL
 *  §4 names three help actions and the third is 「pair with a top performer」,
 *  so the third arm exists rather than the key being deleted.
 *
 *  `peerAvailable` is a BOOLEAN, never the pattern itself: the caller asks
 *  「is anybody in this store already doing the thing this person's focus run
 *  named」, and the answer that comes back cannot say who. The pattern plane is
 *  anonymous by construction (contract.ts:176-183 has no source field) and this
 *  argument keeps it that way. */
export function helpActionFor(
  band: PerformanceBand | null,
  moduleId: string | null,
  peerAvailable = false,
): HelpAction | null {
  if (band !== 'needs-support') return null
  // A staff member whose own focus run named a module gets that named module
  // assigned; without one, a colleague already doing that exact thing is the
  // next most concrete help the design names; failing both, a person instead,
  // which is the Japan-side default (develop, don't judge).
  if (moduleId) return { kind: 'assign-module', label: '学習モジュールを割り当てる', moduleId }
  if (peerAvailable) return { kind: 'peer-pairing', label: 'ペアを組んで学ぶ', moduleId: null }
  return { kind: 'manager-coaching', label: '1対1の時間をつくる', moduleId: null }
}

/** ⚠ THE REGISTRY LINE LIVES IN THE CODE, NEVER IN THE SENTENCE A READER GETS.
 *  Each reason below used to end with a build-tracking tag — 「（登録: ①集計の
 *  実データ接続）」 — glued onto a sentence a salon manager reads, and the
 *  refused-control helper concatenates that whole sentence into the button's
 *  accessible NAME, so a screen reader voiced the ticket code as part of one
 *  unbroken utterance on every disabled control on the page. ⚖ plain names: a
 *  reader is not owed our vocabulary. The seam each lever waits on is kept
 *  HERE, beside the string it belongs to, so the sentence on the screen and the
 *  Anthony ask in build-report §9 are still the same seam:
 *
 *    assign-module    → 登録 ①集計の実データ接続
 *    manager-coaching → 登録 ①集計の実データ接続
 *    peer-pairing     → 登録 ⑦ピア共有 */
export const HELP_REFUSAL: Record<HelpAction['kind'], string> = {
  'assign-module':
    'サンプルデータのため学習モジュールを割り当てられません。割り当てはスタッフに通知が届く操作のため、実データの接続後に有効になります。',
  'manager-coaching':
    'サンプルデータのため1対1の予定をつくれません。予定の作成はスタッフの勤務に関わる操作のため、シフトの実データ接続後に有効になります。',
  'peer-pairing':
    'サンプルデータのためペアを組めません。ペア学習は両者の同意が必要な操作のため、同意の保存をつないだあとに有効になります。',
}

// ── the category token table (the 26-type law) ──────────────────────────────

/** categories.ts:20-24 — `CoachingCategoryKey`, the four stable keys every
 *  business scores on. The labels change per business; the yardstick does not
 *  (category-scoring.ts:81-84). */
export type CategoryKey = 'questioning_depth' | 'acknowledgment' | 'value_presentation' | 'next_step'

/** categories.ts:190-194 `ResolvedCoachingCategory` — a key resolved to ONE
 *  locale, {key, label, def}. The values below are the GENERIC set's own ja
 *  strings (categories.ts:47-73), which is the set `resolveCoachingCategories`
 *  returns for this fixture world's business (a service business; unknown and
 *  `other` types fall back to GENERIC too, categories.ts:203).
 *
 *  ⚠ THIS TABLE IS A MIRROR, NOT A DECISION. At reconnect the room reads
 *  `resolveCoachingCategories(businessType, locale)` and this constant goes
 *  away — a 歯科 resolves the same four keys to 主訴の掘り下げ / 説明と同意 /
 *  治療計画の合意, and NOTHING in this room changes. Registry ⑤ carries the
 *  business-type seam. */
export const CATEGORY_TOKENS: Array<{ key: CategoryKey; label: string; def: string }> = [
  { key: 'questioning_depth', label: '質問の深さ', def: 'お客様の要望や悩みの根本・程度まで、どれだけ踏み込んで聞けたか' },
  { key: 'acknowledgment', label: '受けとめ', def: 'お客様の言葉や気持ちを、どれだけ具体的に受けとめ会話に反映したか' },
  { key: 'value_presentation', label: '価格提示', def: '価格や提案を、そのお客様が求める価値に結びつけて伝えられたか' },
  { key: 'next_step', label: 'クロージング', def: '次の一歩（予約・継続・提案）を具体的に決め、返事まで得られたか' },
]

const TOKEN_BY_KEY = new Map(CATEGORY_TOKENS.map((c) => [c.key, c]))

/** ⚠ AN UNKNOWN KEY RENDERS ITS KEY, never a guessed Japanese word: a label this
 *  room invented for a category it does not know is exactly the hardcoded
 *  business-type judgement the token law exists to prevent. */
export function categoryLabel(key: string): string {
  return TOKEN_BY_KEY.get(key as CategoryKey)?.label ?? key
}

/** `outcome-types.ts:11-17` DeclineReason, mirrored by value. The words are the
 *  phone's own locale strings (messages/ja.json coaching.staff.dataView.reason.*),
 *  so the reason a staff member reads here is the reason they read on the phone. */
export const DECLINE_LABEL: Record<string, string> = {
  budget: '予算',
  considering: '検討中',
  mismatch: '店舗ミスマッチ',
  follow_up: '後日連絡予定',
  other: 'その他',
}

export function declineLabel(reason: string): string {
  return Object.hasOwn(DECLINE_LABEL, reason) ? DECLINE_LABEL[reason] : reason
}

/** personal-findings.ts:162-164 — who said the quoted line. 'unknown' is a real
 *  value the generator emits rather than a guess, so it gets a real word. */
export const SPEAKER_LABEL: Record<'staff' | 'customer' | 'unknown', string> = {
  staff: 'スタッフ',
  customer: 'お客様',
  unknown: '話者不明',
}

// ── who may read what ───────────────────────────────────────────────────────

export interface CoachingAccess {
  /** canon's `analytics.viewAll` — the gate on 全スタッフ表示, and the same
   *  capability COACHING_VISIBILITY_MODEL:22 names for the L2 layer. Without it
   *  the tab does not exist and the reader sees their own screen alone. */
  viewTeam: boolean
  /** ⚖ THE OWNER'S OWN CAPABILITY, AND IT IS A SECOND ONE ON PURPOSE.
   *  `contract.ts:281-286` calls `StoreCoachingRoi` 「L2-OWNER — the surface that
   *  sells the next business」, and a 店舗管理者 is not who that sentence is
   *  written for: whether the module pays for itself is the person-who-pays'
   *  question, and it is the one screen on this page that talks about money.
   *  Folding it into `viewTeam` would have made オーナー and 店舗管理者 render
   *  IDENTICALLY — which would also have made the three-way role preview a
   *  control with two distinct outcomes and a decorative third. */
  viewRoi: boolean
}

const NO_ACCESS: CoachingAccess = { viewTeam: false, viewRoi: false }
const ACCESS_BY_ROLE: Record<string, CoachingAccess> = {
  オーナー: { viewTeam: true, viewRoi: true },
  店舗管理者: { viewTeam: true, viewRoi: false },
  スタッフ: { viewTeam: false, viewRoi: false },
}

/** The three roles the preview walks, in the order it offers them — most
 *  capable first, so 「what does the person below me see」 reads down the pill.
 *  ⚠ DERIVED FROM THE ACCESS TABLE'S OWN KEYS rather than restated beside it:
 *  a role added to the table joins the preview by existing, and a preview
 *  offering a role the table does not know is not a value this room can build. */
export const PREVIEW_ROLES = Object.keys(ACCESS_BY_ROLE)

/** ⚖ Q6 (Liam 9/2) — the per-business VISIBILITY of the evaluation surface.
 *  Two values, and a value this union does not name is not a third option: it
 *  fails CLOSED to `'managers'`. A dial whose typo could open a screen is not a
 *  guardrail, and this one is read from a settings plane nobody has written an
 *  editor for yet — so the parse is the guardrail. */
export type EvaluationVisibility = 'managers' | 'all-staff'
export function resolveVisibility(value: unknown): EvaluationVisibility {
  return value === 'all-staff' ? 'all-staff' : 'managers'
}

/** FAIL-CLOSED on this table's OWN rows (the room-4 F-M1 lesson): a role named
 *  `constructor` must not resolve through the prototype chain.
 *
 *  ⚖ Q6 — AND THE BUSINESS'S OWN DIAL IS READ HERE, IN THE ONE PLACE 「who may
 *  see the board」 is decided. Three properties, all of them structural rather
 *  than remembered:
 *   · it only ever WIDENS `viewTeam` — the `||` cannot take a capability away,
 *     so a manager is never narrowed by a setting somebody typed;
 *   · it cannot widen `viewRoi` — the money screen is the owner's own capability
 *     and this dial has no term in it;
 *   · it cannot invent a READER — `Object.hasOwn(ACCESS_BY_ROLE, role)` still
 *     gates it, so an unknown role stays at NO_ACCESS under either value.
 *  And it never reaches L1: nothing in `buildSelfView` takes a policy at all,
 *  which is why the staff member's own transcripts, quotes and grant cannot move
 *  whatever this dial says. */
export function accessFor(role: string, policy: { evaluationVisibility?: unknown } = coachingPolicy): CoachingAccess {
  const table = Object.hasOwn(ACCESS_BY_ROLE, role) ? ACCESS_BY_ROLE[role] : NO_ACCESS
  const open = resolveVisibility(policy.evaluationVisibility) === 'all-staff'
  if (!open) return table
  return { viewTeam: table.viewTeam || Object.hasOwn(ACCESS_BY_ROLE, role), viewRoi: table.viewRoi }
}

// ── L1 — the staff member's own mirror ──────────────────────────────────────

/** personal-findings.ts:202-207 verbatim_moment, resolved for display: the
 *  date and quote are the run's own, `speakerLabel` is the enum turned into a
 *  word. ONE per finding or none — never an array. */
export interface SelfMoment {
  sessionId: string
  date: string
  quote: string
  speaker: 'staff' | 'customer' | 'unknown'
  speakerLabel: string
}

/** personal-findings.ts:231-244, resolved. `countLabel` is the run's OWN
 *  `evidence.comparison` (:196 — 「the quantified impact in words」) when it has
 *  one, and the auditable count when it does not: this room never composes a
 *  sentence the generator is responsible for. */
export interface SelfFinding {
  id: string
  severity: FixtureFinding['severity']
  category: string
  rank: number
  headline: string
  impact: string
  recommendation: string
  countLabel: string
  /** personal-findings.ts:193 — count_total MUST equal len(session_refs). This
   *  room RE-CHECKS it rather than trusting it (:26-27 names the check as the
   *  app's job), and a mismatch is surfaced, never silently rendered. */
  countChecks: boolean
  moment: SelfMoment | null
  checklistItemMatched: string | null
  confidenceNote: string | null
  /** personal-findings.ts:242-243 — the module and the top-performer pattern
   *  that FIX this finding. Both fields have been in the plane since the build
   *  round and neither reached a screen (audit #81): the room diagnosed and then
   *  pointed at nothing. Resolved here to the pattern's own behaviour sentence
   *  and the module's own title, so the loop closes inside the shapes that
   *  already exist rather than through a route this room does not have. */
  linkedModuleId: string | null
  patternBehavior: string | null
}

export interface SelfView {
  scope: 'staff-self'
  /** ⚖ THE VIEWER'S OWN GRANT, READ FROM THE PLANE.
   *  COACHING_VISIBILITY_MODEL:21 lists 「own grant/consent history」 as L1
   *  content the staff member is ENTITLED to see, and this is a lookup by the
   *  viewer's own id — their own field, so no wall is crossed. It used to be a
   *  hardcoded 「現在オフ」 on the screen, which told a staff member whose plane
   *  row says `granted` that their detail was shared with nobody, while
   *  `sharingAdoption` in the same payload counted them among the staff who
   *  had allowed it: two truths for one question inside one payload (⚖ A8),
   *  and the false one a privacy statement to the person the wall protects. */
  grant: 'granted' | 'declined' | 'none'
  /** personal-findings.ts:216-223 — the run's own window and status. */
  sessionsReviewed: number
  status: 'findings' | 'routine_excellence' | 'capture_gap' | 'insufficient_data'
  headline: string
  /** contract.ts:67-78 CoreMetrics. */
  closingRate: number
  rebookingRate: number
  customerSatisfaction: number
  avgRevenue: { amount: number; currency: string }
  /** contract.ts:162-172 OutcomesSummary. Chronic 「後で決める」 is itself a
   *  closing failure, so it rides the spine beside the four metrics rather than
   *  hiding in a footnote (Liam's own 「decide-later is a signal」 reading). */
  pendingCount: number
  noDealTotal: number
  declineReasons: Array<{ reason: string; label: string; count: number }>
  history: number[]
  /** contract.ts:83-94 CategoryScore, with the label resolved through the token
   *  table and `topBenchmark` kept — it is L1-ONLY and exists on no owner type. */
  categories: Array<{ key: string; label: string; score: number; topBenchmark: number | null; confidence: 'low' | 'medium' | 'high' }>
  findings: SelfFinding[]
  /** staff-focus.ts:163-176 FOCUS_L1. */
  focus: Array<{ category: string; label: string; description: string; confidence: 'established' | 'early_signal'; priority: 'high' | 'medium' | 'low'; moduleId: string | null }>
  /** ⚖ staff-focus.ts:200-204 `layer1_specifics.strengths` — 「detail MUST cite
   *  the evidencing metric/pattern」. L1: the plane has carried this field since
   *  the build round and the room resolved it into nothing, which is the audit's
   *  §5 rank 4 — data already in the payload, thrown away. */
  strengths: Array<{ label: string; detail: string }>
  /** contract.ts:176-183 TeamPattern. */
  learnFromTop: Array<{ id: string; behavior: string; adoptionNote: string }>
  /** coaching-consent/types.ts:9-16 — the viewer's OWN consent-to-be-coached
   *  record, read by the same lookup-by-own-id the grant uses. L1 by
   *  COACHING_VISIBILITY_MODEL:21 (「own grant/consent history」). */
  consent: { status: 'unset' | 'granted' | 'declined'; policyVersion: string | null }
}

/** The staff member's own run, or the fact that there is not one. `none` is the
 *  state for a person the plane holds nothing for at all — distinct from
 *  `insufficient_data`, which is a RUN that honestly reported too little.
 *  ⚖ R2-17 — AND BOTH BRANCHES CARRY THE VIEWER'S OWN CONSENT. Consent is the
 *  question that comes BEFORE there is anything to analyse, so a person who has
 *  never been asked must be asked on the screen that has nothing on it yet —
 *  not only on the screen that already has their numbers. One lookup, one home:
 *  the branch changes what there is to show, never who was asked.
 *  ⚖ B2-2-1 (S16F) — AND `withheld` IS THE THIRD BRANCH, because consent is not a
 *  RENDER question. `COACHING_VISIBILITY_MODEL.md:37-39`: consent to be coached
 *  「gates whether *any* L1 artifact is generated at all」. Before this round the
 *  whole L1 view was BUILT for a declined or never-asked reader and gated only in
 *  the markup, so ~4.9 KB carrying three verbatim customer quotes, three finding
 *  titles and five metric values crossed the client boundary for a reader whose
 *  own screen said 「あなたのセッションは分析されていません」. Nothing leaked — it is
 *  the reader's OWN data and no generator ran — but the one gate in this room a
 *  mis-wired component could walk past was the one gate that was not above the
 *  serializer, in a file whose header says no such gate exists. `withheld` is a
 *  state with NO view: there is nothing to walk past. */
export type SelfConsentRecord = { status: 'unset' | 'granted' | 'declined'; policyVersion: string | null }
export type SelfState =
  | { kind: 'ready'; view: SelfView }
  | { kind: 'none'; consent: SelfConsentRecord }
  | { kind: 'withheld'; consent: SelfConsentRecord }

export function buildSelfView(input: {
  /** The VIEWER's own staff id. This is a lookup, not a filter. */
  selfId: string
  rows: FixtureCoachingStaff[]
  patterns: Array<{ id: string; categoryKey: string; behavior: string; adoptionNote: string }>
  /** coaching-consent/types.ts:9-16, keyed by staff id. Absent = 'unset', which
   *  is the type's OWN default-pre-prompt value (:5-6) rather than a state this
   *  room invented for a missing row. */
  consent?: Record<string, { status: 'unset' | 'granted' | 'declined'; policyVersion: string | null }>
}): SelfState {
  const { selfId, rows, patterns, consent = {} } = input
  const own: SelfConsentRecord = consent[selfId] ?? { status: 'unset', policyVersion: null }
  // ⚖ B2-2-1 (S16F) — CONSENT IS ASKED FIRST, BEFORE THE ROW IS EVEN LOOKED UP.
  // Not 「did this reader refuse?」 but 「did this reader AGREE?」, which is the
  // same question the screen's own second fence asks: a person who has never
  // been asked has authorised nothing, so nothing may be generated FROM them —
  // and `rows` is not read at all for that person, which is what makes the
  // absence structural rather than a filter somebody could reorder.
  if (own.status !== 'granted') return { kind: 'withheld', consent: own }
  // ⚖ THE SELF READ IS A LOOKUP BY ID. Nothing else in `rows` is touched, so a
  // colleague's numbers cannot reach this model even by accident.
  const mine = rows.find((r) => r.staffId === selfId)
  if (!mine) return { kind: 'none', consent: own }

  const run = mine.findingsRun
  return {
    kind: 'ready',
    view: {
      scope: 'staff-self',
      // The viewer's OWN row, by the same lookup — never the roster's.
      grant: mine.grant,
      sessionsReviewed: run.sessions_reviewed,
      status: run.status,
      headline: run.headline,
      closingRate: mine.closingRate,
      rebookingRate: mine.rebookingRate,
      customerSatisfaction: mine.customerSatisfaction,
      avgRevenue: mine.avgRevenue,
      pendingCount: mine.outcomes.pendingCount,
      noDealTotal: mine.outcomes.noDealTotal,
      declineReasons: mine.outcomes.declineReasons.map((d) => ({ reason: d.reason, label: declineLabel(d.reason), count: d.count })),
      history: mine.history,
      categories: mine.categories.map((c) => ({
        key: c.key,
        label: categoryLabel(c.key),
        score: c.score,
        topBenchmark: c.topBenchmark,
        confidence: c.confidence,
      })),
      // ⚖ RANKED BY THE RUN'S OWN `rank` (personal-findings.ts:140-144 — 「(sessions
      // touched) × (size of the outcome gap), highest first; any safety finding
      // outranks everything」). The room does not re-rank: re-sorting by severity
      // here would silently overrule the generator's own impact ranking, which is
      // the one judgement this page exists to carry faithfully.
      findings: [...run.findings]
        .sort((a, b) => a.rank - b.rank)
        .map((f) => ({
          id: f.id,
          severity: f.severity,
          category: f.category,
          rank: f.rank,
          headline: f.headline,
          impact: f.impact,
          recommendation: f.recommendation,
          countLabel: f.evidence.comparison ?? `${f.evidence.count_total}回`,
          countChecks: f.evidence.count_total === f.evidence.session_refs.length,
          moment: f.evidence.verbatim_moment
            ? {
                sessionId: f.evidence.verbatim_moment.session_id,
                date: f.evidence.verbatim_moment.date,
                quote: f.evidence.verbatim_moment.quote,
                speaker: f.evidence.verbatim_moment.speaker,
                speakerLabel: SPEAKER_LABEL[f.evidence.verbatim_moment.speaker],
              }
            : null,
          checklistItemMatched: f.evidence.checklist_item_matched,
          confidenceNote: f.confidenceNote,
          linkedModuleId: f.linked_module_id,
          // ⚠ RESOLVED THROUGH THE PATTERN PLANE, never printed as an id: a
          // reference the reader cannot follow is worse than none. A dangling
          // id resolves to null and the line simply does not render.
          patternBehavior: patterns.find((p) => p.id === f.pattern_reference)?.behavior ?? null,
        })),
      // ⚖ THE WHOLE LIST, NOT JUST focus[0] (staff-focus.ts:199 allows ≤3). The
      // room still leads with ONE — 「一つに絞る」 is its own line — but the
      // second and third were resolved here and thrown away by the screen, which
      // is the audit's #31. They now ride as a quiet 「次に効くもの」 list.
      focus: mine.focus.focus_recommendations.map((f) => ({
        category: f.category,
        label: f.label,
        description: f.description,
        confidence: f.confidence,
        priority: f.priority,
        // staff-focus.ts:173 `module_id` — the reference that lets a focus point
        // at a real module instead of at nothing (audit #8).
        moduleId: f.module_id,
      })),
      strengths: mine.focus.strengths.map((s) => ({ label: s.label, detail: s.detail })),
      learnFromTop: patterns.map((p) => ({ id: p.id, behavior: p.behavior, adoptionNote: p.adoptionNote })),
      // ⚠ THE VIEWER'S OWN ROW, BY THE SAME LOOKUP. Nobody else's consent state
      // is read, so no colleague's decision can reach this payload — and the
      // anti-coercion rule (COACHING_VISIBILITY_MODEL:53-56) is kept by there
      // being no owner-side consumer of this map at all.
      consent: own,
    },
  }
}

/** ⚖ HONEST ABOUT THE SAMPLE, ON THE SCREEN (Liam: 「34セッション、まだ荒削り」).
 *  Below the focus run's own maturity bar the whole view carries the caveat;
 *  above it, it does not claim a maturity it has not earned either — it just
 *  stops apologising. */
export function maturityNote(sessions: number): string | null {
  return maturityOf(sessions) === 'early'
    ? `${sessions}回ぶんの分析です。まだ荒削りで、回数が増えるほど正確になります。`
    : null
}

/** personal-findings.ts:146-155 — the four statuses, each with its own honest
 *  sentence. `capture_gap` is a RECORDER problem, not a coaching one, and
 *  saying so is the point of the enum. */
/** ⚖ I-11 (S16C) — THE FOUR TITLES READ AS ONE SENTENCE: what to do (今週の練習)
 *  → why (うまくいっている理由 · 伸びしろの理由) → the numbers (あなたの成績) →
 *  how they moved (the sparkline and the 差 chips inside them). 「気づき」 has not
 *  been cut — it is the word the section's own guide, the 気づきを作り直す lever
 *  and every refusal sentence still use; what changed is the HEADING, which now
 *  says what the list is FOR rather than what it is called. */
export const STATUS_TITLE: Record<SelfView['status'], string> = {
  findings: '伸びしろの理由',
  routine_excellence: '今回は、直したほうがいいくせは見つかりませんでした',
  capture_gap: '会話の記録が足りず、分析できませんでした',
  insufficient_data: 'まだ分析できる回数に届いていません',
}

export const STATUS_BODY: Record<SelfView['status'], string | null> = {
  findings: null,
  routine_excellence:
    'データは十分にありました。そのうえで、繰り返し出ているくせは見つかっていません。無理に指摘を作らないのが、この画面の方針です。',
  capture_gap:
    '録音や記録が残っていないセッションが多く、会話の中身を見られませんでした。接客の問題ではなく、記録の残り方の問題です。',
  insufficient_data: `セッションが${FINDINGS_MIN_SESSIONS}回たまると、根拠のある気づきがここに出ます。それまでは無理に判断しません。`,
}

// ── L2 — the owner's triage board (BANDS ONLY) ──────────────────────────────

/** ⚖ THE ONE FREE STRING THAT REACHES AN OWNER IS CHECKED BEFORE IT DOES, AND
 *  THE MODULE THAT OWNS THE FIELD SAYS THE CHECK IS THIS APP'S JOB.
 *  staff-focus.ts:12-24 is unusually explicit, and says why a shape-match will
 *  not do: 「the app-side guard MUST substring/fuzzy-diff summary_text against
 *  the real strings it already has — this staff's actual customer names …, the
 *  FULL staff roster (including THIS staff member's own name) … — and reject on
 *  a hit」, because 三割 / 半分 / 二回 are quantities with no ASCII digit and a
 *  Japanese name carries no capitalisation signal. staff-focus.ts:144-145 hands
 *  the room the remedy in the same breath: 「If you can't write an L2 entry that
 *  passes every rule, OMIT it. A missing row is safe; a leaking row is not.」
 *
 *  This is the SIBLING of `countChecks` (personal-findings.ts:26-27) — the same
 *  「the app re-checks what the model promised」 duty — and like that one its
 *  failure is SAID OUT LOUD rather than swallowed: the row carries
 *  `summaryChecks`, and the props file turns a false into a sentence.
 *
 *  ⚠ A QUANTITY, NOT A BARE CHARACTER. 「一緒に」 is not a number, and two of
 *  this plane's own honest sentences carry it — a bare `[一二三…]` class would
 *  drop real rows and call it safety. A kanji numeral is a quantity only when a
 *  COUNTER follows it, which is what this pattern asks for.
 *
 *  ⚖ B2-2-3 (S16F) — AND THE COUNTER CLASS NOW COVERS THE ONES IT MISSED. Three
 *  quantities walked straight through the old class and printed to an owner:
 *    · 「三度、提案の前に確認を入れています。」  — 度 is the other counter for 「N
 *      times」, and the class carried 回 but not it;
 *    · 「二週間ほど間があいています。」          — the DURATION counters 日 / 週 /
 *      月 / 年 were absent altogether, and 「how long since」 is a quantity about
 *      a person exactly as 「how many times」 is;
 *    · 「十数回、同じ場面が出ています。」        — 数 is a numeral in this
 *      position (「十数」 = 「a dozen-odd」), so without it in the NUMERAL class
 *      the 十 was not followed by a counter and the whole phrase read as prose.
 *  Every addition is a character that only becomes a quantity WITH a numeral in
 *  front of it, so 「今度」「今週」「次の月」「毎日」 and the plane's own 「一緒に」
 *  are all still printable — the class widened, the shape did not change.
 *  ⚠ AND THE JOINER IS PART OF THE COUNTER. 「二ヶ月」 is one quantity written
 *  with a spacer between the numeral and its counter, and this room's own ROI
 *  copy says 「Nヶ月」 — a class that read the spacer as prose would let the
 *  commonest duration in the language through. */
const L2_FIGURE = /[0-9０-９]|[一二三四五六七八九十百千数][\sヶヵカか]*[割分回件名人倍点％%]|半[分数]/

/** ⚖ S16F-D5 — AND THE DURATION HALF IS THE BOARD'S ALONE, which is a sentence
 *  that had to be written the moment B2-2-3 widened the class: 度 / 日 / 週 /
 *  月 / 年 were added because 「二週間ほど間があいています」 is a quantity ABOUT A
 *  PERSON, said to an owner, exactly as 「三回」 is. That reasoning holds for the
 *  board's per-member sentence and for nothing else in this room. The pattern
 *  shelf's strings are about a CATEGORY — no member is attached to them — and a
 *  duration inside one is the technique itself (「一日のうちで、いつがいちばん気
 *  になりますか」 is the LINE a top performer says; 「次は二週間後あたりが目安で
 *  す」 is the whole rebooking pattern). Handing the shelf the board's duration
 *  class silently emptied two of its five entries and a whole shelf with them,
 *  and protected nobody. So the two questions get two names instead of one
 *  regexp doing double duty: `summaryLeaks` for the board, `patternLeaks` for
 *  the shelf, and the FIGURE half — the one that catches 「上位層8名中7名」 —
 *  is shared, because that leak is real on both. */
const L2_DURATION = /[一二三四五六七八九十百千数][\sヶヵカか]*[度日週月年]/

/** True when `text` must NOT be printed to an owner. `names` is every name this
 *  room can check against — see `nameNeedles` for which lists that is.
 *  ⚖ B2-2-2 (S16F) — THE COMMENT THAT USED TO STAND HERE WAS FALSE. It said the
 *  board's roster was 「the ONLY name list this room has, and the one the module
 *  names first」. It was neither: `listCustomers` sits in the room's own data
 *  door beside `listStaff`, customer names are the list staff-focus.ts:17-22
 *  names FIRST, and the roster the board is built from is one STORE's — so a
 *  colleague at another branch was a name this guard did not know. */
export function summaryLeaks(text: string, names: string[]): boolean {
  if (L2_FIGURE.test(text) || L2_DURATION.test(text)) return true
  return names.some((n) => text.includes(n))
}

/** ⚖ S16F-D5 — THE SHELF'S OWN GUARD. Same shape, same one-way effect (a string
 *  that fails is OMITTED, never printed), one clause fewer: a figure or a name,
 *  and not a duration. See `L2_DURATION` for why that clause belongs to the
 *  board and to no other surface. */
export function patternLeaks(text: string, names: string[]): boolean {
  if (L2_FIGURE.test(text)) return true
  return names.some((n) => text.includes(n))
}

/** Every form of every name this room can check against: the full name as
 *  stated, and each of its parts, because a leak is far likelier to say
 *  「あずさ さんは」 than to print a full name. One character is not a name. */
function nameNeedles(names: string[]): string[] {
  const out = new Set<string>()
  for (const n of names) for (const part of [n, ...n.split(/\s+/)]) if (part.length >= 2) out.add(part)
  return [...out]
}

/** contract.ts:236-245 OwnerTriageRow, plus the two fields staff-focus.ts's own
 *  L2 half carries: `status` (:183 — 「skipped = insufficient data; NOT an
 *  error」) and `maturity` (:190).
 *
 *  ⚠ READ THE FIELD LIST. A closing rate, a gap, a rank and a session count are
 *  all ABSENT, and their absence is the guarantee. The §7 KNOWN VIOLATIONS on
 *  the phone (StaffPerformanceTable / GapAnalysisList printing exact numbers and
 *  「トップ層との差 28%」 to an owner) cannot be repeated here, because there is
 *  no field for the number to travel in.
 *
 *  `focusAreas` is staff-focus.ts:191's `layer2_summary.focus_areas`, CAPPED AT
 *  ONE (⚖ B2-2-6) — the ONE per-staff sentence an owner may read, written so 「a stranger could read it
 *  aloud in the break room and this staff member would still feel fairly
 *  treated: zero embarrassment, zero number, zero name」 (:90-92). It is also
 *  what COACHING_VISIBILITY_MODEL:22 lists as L2 content (「one focus-area label,
 *  priority chip」). */
export interface TriageRow {
  staffLabel: string
  /** staff-focus.ts:183. 'skipped' = the run had too little to say. */
  status: 'generated' | 'skipped'
  /** `null` when status is 'skipped', or when the store's own floor is not met.
   *  Not a band, and not a bad band. */
  band: PerformanceBand | null
  maturity: Maturity
  /** ⚖ B2-2-6 — LENGTH 0 OR 1. An array rather than an optional because the
   *  guard can empty it, and 「omitted」 and 「never had one」 are the same shape
   *  on this board by construction (the anti-coercion rule again). */
  focusAreas: Array<{ category: string; label: string; band: PerformanceBand; priority: 'high' | 'medium' | 'low'; maturity: Maturity; summaryText: string }>
  /** ⚠ FALSE = at least one focus area was OMITTED by the L2 leak guard above.
   *  The omission is the module's own remedy; SAYING it is this room's rule
   *  (silent failure is a bug), exactly as `countChecks` says a short count. */
  summaryChecks: boolean
  needsSupport: boolean
  /** contract.ts:244 — paired 1:1 with `needsSupport`, by construction. */
  suggestedAction: HelpAction | null
}

/** contract.ts:259-265 OwnerTriageView. */
export interface TriageView {
  scope: 'owner-aggregate'
  rows: TriageRow[]
  counts: { growing: number; steady: number; needsSupport: number; building: number }
  /** contract.ts:264 — 「a count only, never a per-person flag an owner could use
   *  as pressure」. This is the only place the grant is read at all. */
  sharingAdoption: { granted: number; total: number }
}

/** ⚖ R2-17 — CONSENT GATES THE BOARD, AND IT GATES IT AT THE DERIVATION.
 *  `COACHING_VISIBILITY_MODEL.md:32-33`: consent to be coached 「gates whether
 *  ANY L1 artifact is generated at all … the manager's coaching surface simply
 *  doesn't render」. Before this round `buildTriage` mapped the ROSTER and never
 *  mentioned consent, so a staff member who declined — and whose own screen
 *  told them 「あなたのセッションは分析されていません」 — was still banded, given a
 *  focus area and paired with a help action on the manager's board. S16 widened
 *  that board's audience from 店長・オーナー to every member of staff (⚖ Q6), so
 *  the blast radius is this round's.
 *
 *  ⚠ AND THE FIX CARRIES THE ANTI-COERCION RULE (§3), the same way the share
 *  switch does: a manager may never tell a person who DECLINED from a person
 *  who has not been asked, or from a person whose sessions are simply too few.
 *  All three take the below-floor shape — `status: 'skipped'`, `band: null`, no
 *  areas, no action, and a `maturity` computed from zero — so the three are
 *  indistinguishable on the board by construction rather than by a promise. */
const isConsented = (
  consent: Record<string, { status: 'unset' | 'granted' | 'declined' }>,
  staffId: string,
): boolean => (Object.hasOwn(consent, staffId) ? consent[staffId].status : 'unset') === 'granted'

/** ⚖ I-10 (S16C) — THE TWO ADOPTION COUNTS, IN ONE PLACE. The owner's money
 *  screen answers 「is it being used」 with the same two numbers the manager's
 *  board answers 「who has opened up」 with, and two homes for one arithmetic is
 *  the ⚖ A8 disease this room has already been bitten by. `buildTriage` reads
 *  this too, so the board's aggregate and the owner's line cannot disagree.
 *
 *  ⚠ AGGREGATES ONLY, AND THAT IS STRUCTURAL: this returns three integers and no
 *  roster, so there is nothing here for a surface to walk. The anti-coercion rule
 *  is kept the same way it is kept everywhere else in this file — by there being
 *  no per-person field to read. */
export function adoptionCounts(input: {
  roster: Array<{ id: string }>
  rows: FixtureCoachingStaff[]
  consent?: Record<string, { status: 'unset' | 'granted' | 'declined' }>
}): { coaching: number; sharing: number; total: number } {
  const { roster, rows, consent = {} } = input
  const byStaff = new Map(rows.map((r) => [r.staffId, r]))
  return {
    // 「may my sessions be analysed at all」 — the consent plane's own question.
    coaching: roster.filter((m) => isConsented(consent, m.id)).length,
    // …and the DEPTH-SHARE, which is a different question and a different record.
    sharing: roster.filter((m) => byStaff.get(m.id)?.grant === 'granted').length,
    total: roster.length,
  }
}

export function buildTriage(input: {
  /** The store's roster, in the order the world returns it. */
  roster: Array<{ id: string; name: string }>
  rows: FixtureCoachingStaff[]
  floor: number
  /** coaching-consent/types.ts:9-16, keyed by staff id — the SAME plane
   *  `buildSelfView` reads. Absent = 'unset', the type's own default-pre-prompt
   *  value. A member who is not 'granted' gets no band at all (⚖ R2-17). */
  consent?: Record<string, { status: 'unset' | 'granted' | 'declined'; policyVersion: string | null }>
  /** The CATEGORY KEYS this store's anonymised top-performer patterns cover
   *  (contract.ts:176-183 TeamPattern). Keys only — no id, no name, nothing
   *  that could say WHO — because all this board needs to know is whether the
   *  third help action has anybody behind it. */
  patternCategories?: string[]
  /** ⚖ B2-2-2 (S16F) — THE OTHER TWO NEEDLE SETS THE MODULE DEMANDS, handed in
   *  because they come from the DATA DOOR and this file reads nothing.
   *  `staff-focus.ts:17-22`: the guard must diff `summary_text` against 「this
   *  staff's actual customer names for the window」 AND 「the FULL staff roster」.
   *  The board's own `roster` is one STORE's, so a colleague at another branch
   *  was a name this guard did not know; customer names it did not know at all.
   *  ⚠ THEY ARE NEEDLES, NEVER CONTENT. Nothing here is rendered, counted or
   *  returned — the only thing a name in this list can do is REMOVE a sentence,
   *  which is why crossing the store boundary to collect it is safe: the store
   *  isolation law is about what a reader can see, and this list makes a reader
   *  see strictly less. */
  extraNames?: string[]
}): TriageView {
  const { roster, rows, floor, consent = {}, patternCategories = [], extraNames = [] } = input
  const byStaff = new Map(rows.map((r) => [r.staffId, r]))
  const needles = nameNeedles([...roster.map((m) => m.name), ...extraNames])
  const out: TriageRow[] = roster.map((member) => {
    const row = byStaff.get(member.id)
    // ⚖ R2-17 — CONSENT FIRST, and it is asked of the plane rather than of the
    // row: a member with no row and a member who declined must reach the same
    // shape, so the question cannot depend on there being a row to ask about.
    const consented = isConsented(consent, member.id)
    // staff-focus.ts:238 — the run itself is skipped below its own bar; the
    // store's floor sits above it, and either one means no band.
    const generated = consented && Boolean(row) && sessionsOf(row!) >= FOCUS_MIN_SESSIONS
    const band = generated ? bandOf(row!.history, sessionsOf(row!), floor) : null
    const needsSupport = band === 'needs-support'
    const focusOne = row?.focus.focus_recommendations[0]
    const moduleId = focusOne?.module_id ?? null
    // ⚠ THE FOCUS AREAS RIDE ONLY WHEN A BAND DOES. A summary_text under a
    // 「まだ判断できません」 row would be the board saying something specific
    // about a person it just said it could not judge.
    // ⚖ B2-2-6 (S16F) — AND THERE IS EXACTLY ONE OF THEM. L2 is 「one focus-area
    // label, priority chip」 (COACHING_VISIBILITY_MODEL.md:22) and this file's own
    // words for it are 「the ONE per-staff sentence an owner may read」. The plane
    // allows up to three (staff-focus.ts:199) and the board was rendering all of
    // them — up to three category chips and three generator sentences per person,
    // which is three times the exposure the model licensed. The cap is HERE, not
    // in the screen, so the payload matches the doctrine rather than being
    // trimmed on the way out.
    // ⚠ AND IT IS CUT BEFORE THE LEAK GUARD, so a leaking top area is OMITTED
    // rather than quietly replaced by the second one: the reader of this row is
    // told a sentence was withheld, never handed a different person's priority
    // wearing the first one's place.
    const areas =
      band === null
        ? []
        : row!.focus.focus_areas.slice(0, 1).map((f) => ({
            category: f.category,
            label: categoryLabel(f.category),
            band: f.trajectory_band,
            priority: f.priority,
            maturity: f.maturity,
            summaryText: f.summary_text,
          }))
    // …and one that would print a quantity or a name does not ride at all.
    const safe = areas.filter((f) => !summaryLeaks(f.summaryText, needles))
    return {
      staffLabel: member.name,
      status: generated ? 'generated' : 'skipped',
      band,
      // ⚠ AND THE MATURITY IS COMPUTED FROM ZERO for anybody this board did not
      // band. A rich history under a declined record would otherwise put
      // 'established' on a row that says 「まだ判断できません」 — a field a future
      // surface could read as 「this person has been here a while」, which is
      // exactly the tell the anti-coercion rule forbids.
      maturity: maturityOf(consented && row ? sessionsOf(row) : 0),
      focusAreas: safe,
      summaryChecks: safe.length === areas.length,
      needsSupport,
      // ⚖ THE PAIRING IS THE FUNCTION'S RETURN, so a flag without an action is
      // not a bug this room could ship — it is a value this room cannot build.
      suggestedAction: helpActionFor(
        band,
        moduleId,
        focusOne !== undefined && patternCategories.includes(focusOne.category),
      ),
    }
  })
  return {
    scope: 'owner-aggregate',
    rows: out,
    counts: {
      growing: out.filter((r) => r.band === 'growing').length,
      steady: out.filter((r) => r.band === 'steady').length,
      needsSupport: out.filter((r) => r.band === 'needs-support').length,
      building: out.filter((r) => r.band === null).length,
    },
    // ⚖ 'declined' AND 'none' COLLAPSE HERE AND NOWHERE ELSE. The two are
    // different facts in the fixture plane and the same fact to every manager
    // and owner surface — the anti-coercion rule made structural rather than
    // promised.
    // ⚖ I-10 — and the count is `adoptionCounts`' own, so the board's aggregate
    // and the owner's 導入の状況 line are one arithmetic rather than two.
    sharingAdoption: {
      granted: adoptionCounts({ roster, rows, consent }).sharing,
      total: roster.length,
    },
  }
}

// ── the tour's one room-local helper ────────────────────────────────────────

interface Box { left: number; top: number; width: number; height: number }

/** Carried from `karute.ts:588` (room 5), which carried it from the room-3 F-K5
 *  fix: the shared engine's last-resort clamp can put the tour card over the
 *  heading of the very section it is explaining, when that section is taller
 *  than the viewport. Room-local by the packet's own instruction — `guide.ts` is
 *  frozen — and the engine fix is queued rather than made here, so the two rooms
 *  stay byte-identical until it lands in one place. */
export function keepCardOffHeading(
  at: { top: number; left: number },
  card: { width: number; height: number },
  target: Box,
  viewport: { width: number; height: number },
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

// ═══════════════════════════════════════════════════════════════════════════
// LOOK-FIX ROUND — the derivations behind the surfaces the 9/1 coverage audit
// found missing. Same laws as everything above: pure, no clock, no React, every
// shape a mirror with its cite.
// ═══════════════════════════════════════════════════════════════════════════

// ── L2-owner — the ROI screen's arithmetic (effectiveness.ts, mirrored) ──────

/** effectiveness.ts:29-30 HORIZONS + :34-39 HORIZON_WEIGHTS, and the weights are
 *  RENORMALIZED over whichever horizons a store actually has (:135-140) — 「a
 *  young tenant is scored honestly on its early signal, not a pretend-mature
 *  composite」 (:22-23). */
export const HORIZON_WEIGHTS: Record<number, number> = { 30: 0.1, 90: 0.25, 180: 0.45, 365: 0.2 }

/** effectiveness.ts:42 SHRINK_K. */
export const SHRINK_K = 12

/** ⚖ C1 — effectiveness.ts:61-63 `horizonEffect`. THE ONE SUBTRACTION THE WHOLE
 *  SCREEN RESTS ON: a module is adopted BECAUSE a store dipped, so it rebounds
 *  regardless (regression to the mean), and a good season moves everybody.
 *  Subtracting an untreated control arm cancels both, and only a lift the
 *  treated store got and the untreated ones did not survives. */
export function horizonEffect(input: { treatedDelta: number; controlDelta: number }): number {
  return input.treatedDelta - input.controlDelta
}

/** ⚖ C3 — effectiveness.ts:66-74 `shrink`. A thinly-sampled score is pulled
 *  toward the prior, so three good months cannot outrank a year of real work. */
export function shrink(rawScore: number, n: number, priorMean: number, k: number = SHRINK_K): number {
  if (n <= 0) return priorMean
  return (n * rawScore + k * priorMean) / (n + k)
}

/** effectiveness.ts:93-98 `confidenceFor` — 「confidence from which horizons
 *  MATURED, not just how many samples」. 'none' is a real value: a metric with no
 *  horizon carrying data has no lift, and the room says so rather than printing
 *  a zero. */
export type RoiConfidence = 'none' | 'early' | 'building' | 'mature'
export function confidenceFor(used: number[]): RoiConfidence {
  if (used.length === 0) return 'none'
  if (used.includes(180) || used.includes(365)) return 'mature'
  if (used.includes(90)) return 'building'
  return 'early'
}

/** effectiveness.ts:107-160 `effectivenessComposite`, mirrored: sanitize the
 *  prior, drop horizons with no data or an off-contract length, shrink each
 *  DiD effect, then combine on renormalized weights. */
export function roiComposite(
  horizons: Array<{ horizon: number; treatedDelta: number; controlDelta: number; n: number }>,
  priorMean: number,
): { composite: number | null; confidence: RoiConfidence; horizonsUsed: number[] } {
  const prior = Number.isFinite(priorMean) ? priorMean : 0
  const withData = horizons.filter((h) => h.n > 0 && Object.hasOwn(HORIZON_WEIGHTS, h.horizon))
  if (withData.length === 0) return { composite: null, confidence: 'none', horizonsUsed: [] }
  const used = withData.map((h) => h.horizon).sort((a, b) => a - b)
  const weightSum = used.reduce((s, h) => s + HORIZON_WEIGHTS[h], 0)
  const composite = withData.reduce(
    (s, h) => s + shrink(horizonEffect(h), h.n, prior) * (HORIZON_WEIGHTS[h.horizon] / weightSum),
    0,
  )
  return { composite, confidence: confidenceFor(used), horizonsUsed: used }
}

/** contract.ts:273-279 StoreMetricLift, resolved — with the raw `lift` kept
 *  beside the display so the props file formats it and nothing composes a
 *  number twice (the ⚖ A8 rule this room has already been bitten by). */
export interface RoiLift {
  key: 'closingRate' | 'rebookingRate' | 'avgRevenue' | 'satisfaction'
  unit: 'rate' | 'money' | 'score'
  /** The DiD composite, in metric units. `null` = no horizon had data. */
  lift: number | null
  before: number
  after: number
  confidence: RoiConfidence
  horizonsUsed: number[]
}

/** contract.ts:281-296 StoreCoachingRoi, resolved. STORE AGGREGATE ONLY — read
 *  the field list: there is no staff id, no name and no per-person number, so
 *  the selling screen cannot become a league table by a mis-wiring. */
export interface RoiView {
  scope: 'owner-aggregate'
  headline: RoiLift
  sinceMonths: number
  treated: number[]
  control: number[]
  coachingStartFraction: number
  lifts: RoiLift[]
  /** contract.ts:295-296 — 「Null when confidence is too low to responsibly
   *  state one」. The gate is HERE, and it is the headline's confidence: a money
   *  claim rides the number it is a translation of, never a different one. */
  monthlyValueEstimate: { amount: number; currency: string } | null
}

/** ⚖ THE MONEY LINE'S BAR, NAMED ONCE. 'mature' means a 180d or 365d horizon
 *  actually carried data — a full business cycle — which is the only state in
 *  which 「this pays for itself」 is a sentence about evidence rather than about
 *  hope. Below it the estimate is null and the line does not render. */
export const MONEY_LINE_CONFIDENCE: RoiConfidence = 'mature'

export function buildRoi(input: {
  roi?: {
    headlineKey: RoiLift['key']
    sinceMonths: number
    treated: number[]
    control: number[]
    coachingStartFraction: number
    lifts: Array<{ key: RoiLift['key']; before: number; after: number; unit: RoiLift['unit']; horizons: Array<{ horizon: 30 | 90 | 180 | 365; treatedDelta: number; controlDelta: number; n: number }> }>
    monthlyValueEstimate: { amount: number; currency: string }
    priorMean: number
  }
}): RoiView | null {
  const roi = input.roi
  if (!roi) return null
  const lifts: RoiLift[] = roi.lifts.map((l) => {
    const { composite, confidence, horizonsUsed } = roiComposite(l.horizons, roi.priorMean)
    return { key: l.key, unit: l.unit, lift: composite, before: l.before, after: l.after, confidence, horizonsUsed }
  })
  const headline = lifts.find((l) => l.key === roi.headlineKey)
  // A headline key naming a metric this store does not measure is a plane bug,
  // not a state to render around: without a hero there is no ROI screen.
  if (!headline) return null
  return {
    scope: 'owner-aggregate',
    headline,
    sinceMonths: roi.sinceMonths,
    treated: roi.treated,
    control: roi.control,
    coachingStartFraction: roi.coachingStartFraction,
    lifts,
    monthlyValueEstimate: headline.confidence === MONEY_LINE_CONFIDENCE ? roi.monthlyValueEstimate : null,
  }
}

// ── L2 — サポートエリア頻度ランキング (audit #24) ────────────────────────────

/** ⚖ PLAIN LABELLED COUNTS, AND NO LEADERBOARD GRAMMAR (⚖ 8/25 + this room's
 *  own 「順位はつけません」 line). The count is 「how many staff have this as a
 *  focus area」 — a fact about the STORE's shape, not about any person — and it
 *  says what it counts in the label the props file writes. There is no rank
 *  number, no medal, no first/second/third, and no order the reader is invited
 *  to read as a ranking of PEOPLE: two categories with the same count are
 *  ordered by the category table's own order, not by anything about staff.
 *
 *  ⚠ IT READS THE BOARD, NOT THE PLANE. `TriageRow.focusAreas` has already been
 *  through the L2 leak guard and the band gate, so an area this room could not
 *  safely print to an owner is not counted either — a count is a smaller leak
 *  than a sentence, never a safer one. */
export function focusAreaFrequency(rows: TriageRow[]): Array<{ category: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    // A staff member with the same category twice is one staff member.
    for (const key of new Set(r.focusAreas.map((f) => f.category))) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const order = CATEGORY_TOKENS.map((c) => c.key as string)
  return [...counts.entries()]
    .map(([category, count]) => ({ category, label: categoryLabel(category), count }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.category) - order.indexOf(b.category))
}

// ── the pattern library (audit #46-48) ──────────────────────────────────────

/** `pattern-categories.ts:20-26 PATTERN_CATEGORIES` — the production taxonomy's
 *  render order, and Anthony's generation prompt classifies into these same five
 *  slots (`pattern-categories.ts:5-9`). New categories are a coordinated change
 *  on both ends, which is why this list is a mirror and not a preference. */
export const PATTERN_CATEGORIES = [
  'counseling_questions',
  'conversation_flow',
  'closing',
  'rebooking',
  'objection_handling',
] as const
export type PatternCategory = (typeof PATTERN_CATEGORIES)[number]

/** ja.json `coaching.patterns.categories.*` — the phone's own shelf titles and
 *  descriptions, carried word for word rather than re-written here. */
export const PATTERN_SHELF: Record<PatternCategory, { title: string; description: string }> = {
  counseling_questions: {
    title: 'カウンセリング質問例',
    description: 'お客様のお悩みを深く理解するための質問の型。トップパフォーマーが実際に使っている言い回しです。',
  },
  conversation_flow: {
    title: '会話フロー',
    description: 'カウンセリングから提案、リブッキングまでの自然な流れを作るための構造パターン。',
  },
  closing: {
    title: 'クロージングパターン',
    description: 'お客様が前向きに決断できるタイミングと言葉の運び方。',
  },
  rebooking: {
    title: 'リブッキング会話',
    description: '次回の目的を一緒に描き、自然にご予約に繋げる会話の型。',
  },
  objection_handling: {
    title: '反対意見への対応',
    description: '「高い」「考えます」を受け止め、選択肢に変換するアプローチ。',
  },
}

/** ⚖ THE DENOMINATOR NEVER REACHES A SCREEN. `top-performer-patterns.ts:152-161`
 *  gives every pattern an evidence block with real numerators and denominators,
 *  and the plane keeps them so the mirror is honest — but 「上位層8名中7名」 in a
 *  salon with eight senior staff tells the reader exactly who the eighth is.
 *  This is the same sentence-shaped remedy `adoptionNote` already uses on the
 *  self screen (fixtures-coaching.ts:211-215), applied once, here, so the two
 *  surfaces cannot say the same evidence two different ways.
 *
 *  ⚠ THE THRESHOLDS ARE FRACTIONS OF THE GENERATOR'S OWN DENOMINATOR, so the
 *  sentence stays true whatever the store's top layer is sized at. */
export function adoptionSentence(e: { presentInTopPerformers: number; ofTopPerformers: number }): string {
  if (e.ofTopPerformers <= 0) return '上位層の記録がまだ足りません'
  const share = e.presentInTopPerformers / e.ofTopPerformers
  if (share >= 0.9) return '上位層のほぼ全員が実践しています'
  if (share >= 0.6) return '上位層の多くが実践しています'
  return '上位層の一部が実践しています'
}

export interface PatternEntry {
  title: string
  behavior: string
  /** top-performer-patterns.ts:157 — the actual LINE, paraphrased, ≤15 chars
   *  verbatim. This is what a shelf has that two loose sentences do not. */
  example: string
  transferability: string
  adoptionNote: string
  confidenceNote: string | null
}

export interface PatternShelf {
  key: PatternCategory
  title: string
  description: string
  entries: PatternEntry[]
}

/** ⚖ EVERY SHELF RENDERS, EMPTY OR NOT (`PatternCategorySection.tsx:9-18`, the
 *  phone's own deliberate choice): the reader sees the SHAPE of the library, so
 *  a month with nothing new on one shelf reads as 「nothing new here」 rather
 *  than as a library that quietly changed size.
 *
 *  ⚖ VL-3 — THE L2 LEAK GUARD COVERS THIS SHELF TOO. `summaryLeaks` was built
 *  for `TriageRow.focusAreas.summaryText` alone; `title` / `behaviorDescription`
 *  / `anonymizedExample` / `transferability` are four more generator strings
 *  reaching the same owner screen, and `top-performer-patterns.ts:157`
 *  explicitly permits 「any verbatim ≤15 chars」 — exactly the width a Japanese
 *  name rides in. Same remedy as the board: a string that fails the check is
 *  OMITTED, not printed (staff-focus.ts:144-145's own rule, applied here).
 *  ⚖ S16F-D5 — AND IT IS `patternLeaks`, NOT `summaryLeaks`. VL-3's reason for
 *  bringing the guard here was the NAME riding in a ≤15-char verbatim; the
 *  figure half comes with it because 「上位層8名中7名」 must never reach a screen
 *  (`adoptionSentence`'s own note). The board's DURATION clause does not: it
 *  reads a spoken line's 「一日のうちで」 as a quantity about somebody and drops
 *  the entry. */
export function buildPatternLibrary(
  patterns: Array<{
    category: string | null
    title: string
    behaviorDescription: string
    anonymizedExample: string
    evidence: { presentInTopPerformers: number; ofTopPerformers: number }
    transferability: string
    confidence: 'high' | 'medium' | 'low'
  }>,
  roster: Array<{ name: string }> = [],
): PatternShelf[] {
  const needles = nameNeedles(roster.map((m) => m.name))
  const safe = (p: (typeof patterns)[number]) =>
    ![p.title, p.behaviorDescription, p.anonymizedExample, p.transferability].some((s) => patternLeaks(s, needles))
  return PATTERN_CATEGORIES.map((key) => ({
    key,
    title: PATTERN_SHELF[key].title,
    description: PATTERN_SHELF[key].description,
    entries: patterns
      .filter((p) => p.category === key && safe(p))
      .map((p) => ({
        title: p.title,
        behavior: p.behaviorDescription,
        example: p.anonymizedExample,
        transferability: p.transferability,
        adoptionNote: adoptionSentence(p.evidence),
        // top-performer-patterns.ts:163 — said only when it changes how the
        // pattern should be read, exactly as a category score's is.
        confidenceNote: p.confidence === 'low' ? '見つかった回数が少なく、参考です' : null,
      })),
  }))
}

// ── the learning-module catalog (audit #49-57) ──────────────────────────────

/** learning-module.ts:152-172's `module`, resolved for display, plus the
 *  storage id (`owner-types.ts:64-65`) the references join on.
 *
 *  ⚠ NO ASSIGNMENT STATE, ANYWHERE IN THIS SHAPE. Assignment is a write that
 *  sends a staff member a notification; it stays the refused help action the
 *  board already carries (`helpActionFor` → 学習モジュールを割り当てる, registry
 *  ①). A `completionRate` here would be a progress bar over data no generator
 *  produces.
 *
 *  ⚠ AND THE PHONE'S CONSENT FILTER IS NOT PORTED.
 *  `AssignModulesCard.tsx:106` filters assignable staff by `consentGiven`;
 *  `COACHING_VISIBILITY_MODEL.md:119-122` calls that backwards — it excludes the
 *  people who most need help. There is no consent field on this shape at all. */
export interface ModuleCard {
  moduleId: string
  title: string
  description: string
  durationLabel: string
  /** learning-module.ts:163-166 `evidenceBasis` — WHY this module is believed to
   *  work, in words. A catalog that showed a title and a duration would be a
   *  list; this is the sentence that makes it a recommendation. */
  basisLabel: string
  steps: Array<{ step: number; title: string; detail: string }>
  /** True when this module is the one the viewer's own focus run named. */
  isMine: boolean
}

/** learning-module.ts:164-166 — the four `evidenceBasis` values, each with its
 *  own honest sentence. A module with several carries the FIRST in this table's
 *  order, which is strongest-evidence-first: a precedent that worked outranks
 *  「we designed this from first principles」. */
export const MODULE_BASIS: Record<string, string> = {
  resembles_high_effectiveness_precedent: '効果が確認できている既存モジュールと同じ組み立てです',
  avoids_known_ineffective_pattern: '効果が出なかったやり方を避けて組み立てています',
  no_prior_precedent_first_principles: '前例がないため、上位層のやり方から新しく組み立てています',
  early_signal_org_under_6_months: '導入から日が浅く、効果の判定はこれからです',
}
const BASIS_ORDER = [
  'resembles_high_effectiveness_precedent',
  'avoids_known_ineffective_pattern',
  'no_prior_precedent_first_principles',
  'early_signal_org_under_6_months',
]

export function buildModuleLibrary(
  modules: Array<{
    moduleId: string
    title: string
    description: string
    durationMin: number
    evidenceBasis: string[]
    outline: Array<{ step: number; title: string; detail: string }>
  }>,
  myModuleIds: Array<string | null>,
): ModuleCard[] {
  const mine = new Set(myModuleIds.filter((id): id is string => id !== null))
  const cards = modules.map((m) => {
    const basis = BASIS_ORDER.find((b) => m.evidenceBasis.includes(b))
    return {
      moduleId: m.moduleId,
      title: m.title,
      description: m.description,
      durationLabel: `${m.durationMin}分`,
      // An unknown basis renders its own honest sentence rather than a guessed
      // one — the same rule `categoryLabel` follows for an unknown key.
      basisLabel: basis ? MODULE_BASIS[basis] : '組み立ての根拠が記録されていません',
      steps: [...m.outline].sort((a, b) => a.step - b.step),
      isMine: mine.has(m.moduleId),
    }
  })
  // ⚖ I-6 (S16C) — THE READER'S OWN MODULES COME FIRST, and this is a PARTITION
  // rather than a sort: there is no comparator in this room and there is not one
  // here either. It is also not a ranking — 「yours」 and 「the rest」 are two
  // groups, not two places on a scale, and the catalog's own order survives
  // inside each of them.
  return [...cards.filter((c) => c.isMine), ...cards.filter((c) => !c.isMine)]
}

// ── コーチングを受けることへの同意 (audit #2/#3/#6) ─────────────────────────

/** ⚖ COACHING IS OPT-IN, AND THE PAGE HAS TO SAY SO (§5 rank 6). The room
 *  refuses the DEPTH-SHARE already; it never said the ANALYSIS ITSELF is the
 *  staff member's to allow, so the page read as if coaching simply happens to
 *  you. Three states, three sentences, and the decline one carries the
 *  anti-coercion line the phone's own dialog ends with
 *  (`ja.json coaching.consent.declineFootnote`). */
/** ⚠ `strip` IS THE GRANTED STATE'S ONE-LINE COMPOSITION, not a fourth state.
 *  A decision already taken is a fact to keep visible, not a card to re-read
 *  every session — so 'granted' also carries the one line the strip prints,
 *  and the full `body` stays (it rides the strip's `title` and the section's
 *  guide text, so no sentence retires without a home). 'unset' and 'declined'
 *  are still DECISIONS the reader has to make, and they keep the whole card. */
export const CONSENT_STATE: Record<'unset' | 'granted' | 'declined', { title: string; body: string; cta: string; strip?: string }> = {
  unset: {
    title: 'コーチング機能の同意が必要です',
    // ⚖ B2-2-5 (S16F) — AND IT SAYS WHAT IS NOT THERE. The declined state has
    // carried 「この画面の成績と気づきは表示されません」 since the day it was
    // written; the unset state said nothing about the page below it, so a reader
    // who had never been asked met a screen that was simply empty with no
    // sentence anywhere saying why. An absence is SAID in this room —
    // `countWarning`, `summaryWarning`, `filteredEmptyLine`, `pitchWithheld`,
    // `receiptEmpty`, `moduleEmpty` are all the same rule — and this was the one
    // state that closed quietly.
    body: 'あなたのセッションを分析して成長をサポートします。同意するまで、この画面の成績と気づきは表示されません。何が記録され、店長に何が見えて何が見えないかを確認したうえで、受けるかどうかを選んでください。同意しなくても仕事には影響しません。',
    cta: '確認する',
  },
  granted: {
    title: 'コーチング機能に同意済み',
    body: 'あなたのセッションの分析を許可しています。いつでも取り消せます。取り消しても勤務には影響しませんし、取り消したことは表示されません。',
    cta: '再確認する',
    strip: 'コーチングを受けることに同意済み ・ いつでも取り消せます',
  },
  declined: {
    title: 'コーチング機能は無効です',
    body: 'あなたのセッションは分析されていません。この画面の成績と気づきは表示されません。気が変わったらいつでも同意できます。断ったことは誰にも表示されません。',
    cta: '再確認する',
  },
}

// ── ⚖ THE ROLE PREVIEW (audit #71 — the owner's explicit ask) ───────────────

/** `coaching-dev-preview/hooks.ts:49-54 isDevPreviewEnabled`, mirrored exactly:
 *  two build-time constants, either of which opens the affordance. Both are
 *  INLINED by the bundler rather than read at runtime, so this file stays as
 *  pure as its header says — a production build with the var unset folds the
 *  whole preview to nothing and tree-shakes it out.
 *
 *  ⚠ AND THE GATE IS ASKED ON THE SERVER, WHICH IS THE POINT. On the phone the
 *  override is a client render-shell swap over data RLS already scoped
 *  (`hooks.ts:27-33`). Here the wall is built ABOVE the serializer — the team
 *  board is never CONSTRUCTED for a reader without the capability — so a preview
 *  that only swapped a shell would have to ship every persona's payload to every
 *  reader, which is precisely the thing this room is built not to do. The
 *  preview therefore re-runs the assembly AS that persona, and each persona's
 *  payload still contains only what that persona may see. */
export function isRolePreviewEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW === 'true'
  )
}

/** `coaching-dev-preview/hooks.ts:133-137 useEffectiveCoachingRole`, mirrored:
 *  the real role when the gate is off, otherwise the override when there is a
 *  legal one. FAIL-CLOSED on the value as well as on the gate — an unknown
 *  string is no override at all (`hooks.ts:88-95`), never a role this room
 *  invents, and `accessFor` would fail closed on it a second time anyway. */
export function effectiveRole(realRole: string, override?: string | null): string {
  if (!isRolePreviewEnabled()) return realRole
  if (typeof override !== 'string' || !PREVIEW_ROLES.includes(override)) return realRole
  return override
}
