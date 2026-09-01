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
}

const NO_ACCESS: CoachingAccess = { viewTeam: false }
const ACCESS_BY_ROLE: Record<string, CoachingAccess> = {
  オーナー: { viewTeam: true },
  店舗管理者: { viewTeam: true },
  スタッフ: { viewTeam: false },
}

/** FAIL-CLOSED on this table's OWN rows (the room-4 F-M1 lesson): a role named
 *  `constructor` must not resolve through the prototype chain. */
export function accessFor(role: string): CoachingAccess {
  return Object.hasOwn(ACCESS_BY_ROLE, role) ? ACCESS_BY_ROLE[role] : NO_ACCESS
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
  focus: Array<{ category: string; label: string; description: string; confidence: 'established' | 'early_signal'; priority: 'high' | 'medium' | 'low' }>
  /** contract.ts:176-183 TeamPattern. */
  learnFromTop: Array<{ id: string; behavior: string; adoptionNote: string }>
}

/** The staff member's own run, or the fact that there is not one. `none` is the
 *  state for a person the plane holds nothing for at all — distinct from
 *  `insufficient_data`, which is a RUN that honestly reported too little. */
export type SelfState = { kind: 'ready'; view: SelfView } | { kind: 'none' }

export function buildSelfView(input: {
  /** The VIEWER's own staff id. This is a lookup, not a filter. */
  selfId: string
  rows: FixtureCoachingStaff[]
  patterns: Array<{ id: string; categoryKey: string; behavior: string; adoptionNote: string }>
}): SelfState {
  const { selfId, rows, patterns } = input
  // ⚖ THE SELF READ IS A LOOKUP BY ID. Nothing else in `rows` is touched, so a
  // colleague's numbers cannot reach this model even by accident.
  const mine = rows.find((r) => r.staffId === selfId)
  if (!mine) return { kind: 'none' }

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
        })),
      focus: mine.focus.focus_recommendations.map((f) => ({
        category: f.category,
        label: f.label,
        description: f.description,
        confidence: f.confidence,
        priority: f.priority,
      })),
      learnFromTop: patterns.map((p) => ({ id: p.id, behavior: p.behavior, adoptionNote: p.adoptionNote })),
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
export const STATUS_TITLE: Record<SelfView['status'], string> = {
  findings: '気づき',
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
 *  COUNTER follows it, which is what this pattern asks for. */
const L2_QUANTITY = /[0-9０-９]|[一二三四五六七八九十百千]\s*[割分回件名人倍点％%]|半[分数]/

/** True when `text` must NOT be printed to an owner. `names` is the roster this
 *  board is being built for — the ONLY name list this room has, and the one the
 *  module names first. */
export function summaryLeaks(text: string, names: string[]): boolean {
  if (L2_QUANTITY.test(text)) return true
  return names.some((n) => text.includes(n))
}

/** Every form of every roster name this room can check against: the full name
 *  as stated, and each of its parts, because a leak is far likelier to say
 *  「あずさ さんは」 than to print a full name. One character is not a name. */
function rosterNeedles(roster: Array<{ name: string }>): string[] {
  const out = new Set<string>()
  for (const m of roster) for (const part of [m.name, ...m.name.split(/\s+/)]) if (part.length >= 2) out.add(part)
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
 *  `focusAreas` is staff-focus.ts:191's `layer2_summary.focus_areas` — the ONE
 *  per-staff sentence an owner may read, written so 「a stranger could read it
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

export function buildTriage(input: {
  /** The store's roster, in the order the world returns it. */
  roster: Array<{ id: string; name: string }>
  rows: FixtureCoachingStaff[]
  floor: number
  /** The CATEGORY KEYS this store's anonymised top-performer patterns cover
   *  (contract.ts:176-183 TeamPattern). Keys only — no id, no name, nothing
   *  that could say WHO — because all this board needs to know is whether the
   *  third help action has anybody behind it. */
  patternCategories?: string[]
}): TriageView {
  const { roster, rows, floor, patternCategories = [] } = input
  const byStaff = new Map(rows.map((r) => [r.staffId, r]))
  const needles = rosterNeedles(roster)
  const out: TriageRow[] = roster.map((member) => {
    const row = byStaff.get(member.id)
    // staff-focus.ts:238 — the run itself is skipped below its own bar; the
    // store's floor sits above it, and either one means no band.
    const generated = Boolean(row) && sessionsOf(row!) >= FOCUS_MIN_SESSIONS
    const band = generated ? bandOf(row!.history, sessionsOf(row!), floor) : null
    const needsSupport = band === 'needs-support'
    const focusOne = row?.focus.focus_recommendations[0]
    const moduleId = focusOne?.module_id ?? null
    // ⚠ THE FOCUS AREAS RIDE ONLY WHEN A BAND DOES. A summary_text under a
    // 「まだ判断できません」 row would be the board saying something specific
    // about a person it just said it could not judge.
    const areas =
      band === null
        ? []
        : row!.focus.focus_areas.map((f) => ({
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
      maturity: maturityOf(row ? sessionsOf(row) : 0),
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
    sharingAdoption: {
      granted: roster.filter((m) => byStaff.get(m.id)?.grant === 'granted').length,
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
