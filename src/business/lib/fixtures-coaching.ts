// コーチング — the room's own fixture plane. ADD-ONLY, and that is the whole
// discipline: this file states what a COACHING RUN produced and nothing else. A
// staff member's name, their store, the roster they belong to and the day the
// world is on all come from `fixtures.ts` through the store-clamped door, so a
// row here can never contradict the world it hangs off. It joins by the world's
// own staff ids (`staff[].id` — p-01 … p-09) and states no name at all.
//
// ⚖ EVERY SHAPE BELOW IS A MIRROR OF A REAL GENERATOR OUTPUT, FIELD FOR FIELD,
// WITH ITS CITE. Liam 9/1: the coaching prompts are the carefully built asset —
// nothing here is guessed. Each interface names the module and the schema line it
// mirrors, so that at reconnect the real generation slots into this page with
// ZERO reshaping. Business territory may not import phone runtime
// (foundation.test.ts INVENTORY), so the mirror is BY SHAPE with a cite rather
// than a type import — and the room's suite pins every field name against the
// prompt file it came from, freshly, on every run.
//
//   personal-findings.ts  → the findings run  (window / status / headline / findings[])
//   staff-focus.ts        → the dual-layer focus run (layer1_specifics / layer2_summary)
//   category-scoring.ts   → per-category scores, projected through contract.ts CategoryScore
//   top-performer-patterns.ts → the team patterns, projected through contract.ts TeamPattern
//   contract.ts           → CoreMetrics · OutcomesSummary · PerformanceBand · HelpAction
//
// ⚠ NOTHING HERE IS A BUSINESS-TYPE JUDGEMENT. Category keys are
// `categories.ts`'s own four (`CoachingCategoryKey`, categories.ts:20-24); the
// WORDS come from the token table in `coaching.ts`, which mirrors
// `ResolvedCoachingCategory` (categories.ts:190-194). A 整体, a gym and a dental
// clinic read the same structure in their own vocabulary and this file does not
// change.
//
// THE DATA STATES THE PACKET ASKED FOR, and which row is which:
//   · a rich, mature run (n=34, status 'findings')            → p-06, the operator
//   · a below-floor new hire (n=5, status 'insufficient_data')→ p-09
//   · a quiet-but-good window (status 'routine_excellence')   → p-01
//   · a recorder-miss window (status 'capture_gap')           → p-05
//   · growing / steady / needs-support for the L2 board       → p-01 / p-05 / p-04
//   · the defer-heavy case (「後で決める」 as the finding)       → p-04
//   · the longest strings this room can be handed             → p-05
//   · a store where coaching was never switched on (dormant)  → テスト代官山店
//   · 25+ staff for the ANY-ROSTER-SIZE proof                 → the suite's and
//     the probe's own world, never this demo plane

import { STORE_A } from './fixtures'

/** Which stores have the coaching module switched ON. ⚖ coaching is an OPT-IN,
 *  PAYWALLED per-store module (coaching-design-principle): off = the surfaces do
 *  not render and no generation fires. テスト代官山店 is deliberately absent, so
 *  the dormant state is a state a reader can actually reach with the store
 *  switcher rather than a branch only a test ever sees. The real switch is
 *  `org_settings.coaching_enabled` — registry ⑤. */
export const coachingStores: string[] = [STORE_A]

/** ⚠SETTINGS-BATCH — コーチング評価の公開範囲 (⚖ Liam 9/2 Q6; rides the same
 *  machinery as dial #16 文字起こしの公開範囲).
 *
 *  Per-business: `'managers'` (the DEFAULT — 全スタッフ表示 is manager-only) |
 *  `'all-staff'` (the business chose open visibility).
 *
 *  GUARDRAILS, and they are the reason this is a dial rather than a role row:
 *  the dial WIDENS only the L2 band board; it never widens an L1 layer (own
 *  transcripts, quotes, grants) and it never NARROWS a manager. A value this
 *  union does not name fails CLOSED to `'managers'` (`resolveVisibility`,
 *  coaching.ts) — a mis-typed setting must not be able to open a screen.
 *
 *  ⚠ ONE HOME FOR THE DECISION, TWO READS OF THE VALUE (R2-21). The editor is
 *  registry ⑤ (設定 room); until it exists this is the room's READ-SIDE value and
 *  nothing writes it. The SCREEN never reads it. The SERVER reads it twice, and
 *  both reads go through the same helper so they cannot disagree:
 *  `accessFor(role, policy)` decides the CAPABILITY — the one and only place
 *  「who may see the board」 is settled — and `resolveVisibility(...)` is asked
 *  again in `coaching-props.ts` so the boundary sentence can say which way this
 *  business set the dial. Two reads, one helper, and only the first one can
 *  change what a reader may open. */
export const coachingPolicy = { evaluationVisibility: 'managers' as 'managers' | 'all-staff' }

// ── personal-findings.ts — the honest mirror (L1) ────────────────────────────

/** personal-findings.ts:197-199 — `evidence.session_refs[]`. The auditable list
 *  behind a count: `count_total` MUST equal its length (:193). */
export interface FixtureSessionRef {
  session_id: string
  date: string
}

/** personal-findings.ts:202-207 — `evidence.verbatim_moment`. ONE moment per
 *  finding, or null; never an array. `speaker` is 'unknown' when the source does
 *  not make it clear rather than guessing (:162-164). L1 ABSOLUTE — the
 *  customer's side of a conversation never crosses to a manager even under a
 *  grant (COACHING_VISIBILITY_MODEL §2). */
export interface FixtureVerbatimMoment {
  session_id: string
  date: string
  quote: string
  speaker: 'staff' | 'customer' | 'unknown'
}

/** personal-findings.ts:188-209 — EVIDENCE_SCHEMA, field for field.
 *  `outcome_metric` is the module's own enum (:195) — never a free-form key. */
export interface FixtureFindingEvidence {
  count_total: number
  count_outcome_aligned: number | null
  outcome_metric: '成約率' | '再来率' | '満足度' | '客単価' | 'category_score' | 'safety_checklist'
  comparison: string | null
  session_refs: FixtureSessionRef[]
  checklist_item_matched: string | null
  verbatim_moment: FixtureVerbatimMoment | null
}

/** personal-findings.ts:231-244 — one item of `findings[]`. Strengths live in
 *  the SAME ranked array (severity 'strength', :132-138) — not a separate
 *  consolation list, which is also how the phone renders them
 *  (DataDrivenStaffView.tsx:275-276). `category` is the business-native pattern
 *  name the model writes, not a fixed enum (:235). */
export interface FixtureFinding {
  id: string
  severity: 'priority' | 'watch' | 'strength'
  category: string
  rank: number
  headline: string
  impact: string
  recommendation: string
  evidence: FixtureFindingEvidence
  confidenceNote: string | null
  linked_module_id: string | null
  pattern_reference: string | null
}

/** personal-findings.ts:211-248 — the run's own envelope. ⚠ `window.date_range`
 *  is NOT stated here: the demo world is dated relative to today, so a fixed
 *  string would be a date this world is not on. The props file composes the
 *  window from the render clock and this count — one home for the number, one
 *  home for the dates. */
export interface FixtureFindingsRun {
  sessions_reviewed: number
  status: 'findings' | 'routine_excellence' | 'capture_gap' | 'insufficient_data'
  headline: string
  findings: FixtureFinding[]
}

// ── staff-focus.ts — the dual-layer focus run ────────────────────────────────

/** staff-focus.ts:163-176 — FOCUS_L1. The staff member's own view of a focus
 *  area: full detail, direct language, numbers allowed (:88-90). */
export interface FixtureFocusL1 {
  category: string
  label: string
  description: string
  confidence: 'established' | 'early_signal'
  priority: 'high' | 'medium' | 'low'
  module_id: string | null
  suggested_new_module_title: string | null
}

/** staff-focus.ts:150-161 — FOCUS_L2. The owner/manager view of the SAME focus
 *  area: 「zero embarrassment, zero number, zero name」 (:90-92). This is the
 *  only per-staff sentence the board is allowed to print. */
export interface FixtureFocusL2 {
  category: string
  trajectory_band: 'growing' | 'steady' | 'needs-support'
  priority: 'high' | 'medium' | 'low'
  maturity: 'established' | 'early'
  summary_text: string
}

/** staff-focus.ts:194-206 — `layer1_specifics`. `strengths[].detail` MUST cite
 *  the evidencing metric or pattern (:203). */
export interface FixtureStaffFocus {
  focus_recommendations: FixtureFocusL1[]
  strengths: Array<{ label: string; detail: string }>
  /** staff-focus.ts:191 — `layer2_summary.focus_areas`, ≤3. */
  focus_areas: FixtureFocusL2[]
}

// ── category-scoring.ts, projected through contract.ts CategoryScore ─────────

/** contract.ts:83-94 CategoryScore — the VIEW type, which is what a component
 *  reads (contract.ts:5-6, 「Every coaching component reads these shapes and
 *  NOTHING ELSE」). `key` is `CoachingCategoryKey` (categories.ts:20-24);
 *  `score` is category-scoring.ts:219-224's 0..100; `confidence` is its
 *  high|medium|low (:225-229) narrowed to contract.ts:55's Confidence.
 *  `topBenchmark` is L1-ONLY and exists on no owner or manager type. */
export interface FixtureCategoryScore {
  key: 'questioning_depth' | 'acknowledgment' | 'value_presentation' | 'next_step'
  score: number
  topBenchmark: number | null
  confidence: 'low' | 'medium' | 'high'
}

// ── the per-staff coaching run ───────────────────────────────────────────────

/** Everything one staff member's coaching produced in the window. The metric
 *  spine is contract.ts:67-78 CoreMetrics and contract.ts:162-172
 *  OutcomesSummary; the rest are the runs above. */
export interface FixtureCoachingStaff {
  /** `fixtures.ts` staff[].id. The join, and the only world fact stated here. */
  staffId: string
  /** ⚠ THE SESSION COUNT HAS ONE HOME, and it is the run's own
   *  `window.sessions_reviewed` (personal-findings.ts:219 · contract.ts:77
   *  CoreMetrics.sessionsAnalyzed). It used to be stated twice — here and inside
   *  `findingsRun` — and the mutation battery found it: changing one of them
   *  moved nothing, because every gate read the other. Two numbers for one fact
   *  is the ⚖ A8 disease, and this room has ONE window, so it has one number.
   *  Read it through `sessionsOf(row)`.
   *  contract.ts:69 closingRate, 0..1. */
  closingRate: number
  /** contract.ts:71 rebookingRate, 0..1. */
  rebookingRate: number
  /** contract.ts:73 customerSatisfaction, 1..5. */
  customerSatisfaction: number
  /** contract.ts:75 avgRevenue — a MoneyAmount (contract.ts:40-43), never a
   *  bare JPY number: the customer app is multi-country. */
  avgRevenue: { amount: number; currency: string }
  /** contract.ts:47-51 MetricPoint[] — monthly closing-rate points, OLDEST
   *  FIRST. `periodStart` is composed by the props file from the render clock,
   *  for the same reason `date_range` is; the VALUES are the run's own. */
  history: number[]
  categories: FixtureCategoryScore[]
  findingsRun: FixtureFindingsRun
  focus: FixtureStaffFocus
  /** contract.ts:162-172 OutcomesSummary — and contract.ts:163-167's own
   *  deliberate omission is kept: an ordinary return visit is not a sales
   *  conversation, so it is on neither side of the closing-rate formula and has
   *  no slot here. */
  outcomes: { noDealTotal: number; declineReasons: Array<{ reason: string; count: number }>; pendingCount: number }
  /** ⚖ THE GRANT LAYER (COACHING_VISIBILITY_MODEL §1/§3), and contract.ts:205-212
   *  GrantMeta is its metadata. Staff-authored, revocable, default OFF.
   *  `declined` and `none` are DIFFERENT facts here — a staff member who was
   *  asked and said no is not one who was never asked — and the room's whole
   *  anti-coercion rule is that the two are INDISTINGUISHABLE to every manager
   *  and owner surface. Storing them apart is what lets the pin prove they come
   *  out the same. */
  grant: 'granted' | 'declined' | 'none'
}

/** contract.ts:176-183 TeamPattern — an anonymised top-performer technique,
 *  win-only, never a name (§14 + the peer-sharing double-consent rule). The
 *  generator behind it is top-performer-patterns.ts:139-167; `adoptionNote` is
 *  its `evidence` block rendered as a sentence (「上位層のほとんどが実践」), which
 *  is what keeps a denominator off a staff member's screen. */
export const teamPatterns: Array<{ id: string; categoryKey: string; behavior: string; adoptionNote: string }> = [
  {
    id: 'tp-1',
    categoryKey: 'acknowledgment',
    behavior: 'お客様が話し終えて一拍おいてから、聞いた内容をそのまま言い返して確認する',
    adoptionNote: '上位層のほとんどが毎回行っています',
  },
  {
    id: 'tp-2',
    categoryKey: 'value_presentation',
    behavior: '金額を伝える前に、続けた場合に何がどう変わるかを先に具体で話す',
    adoptionNote: '上位層の多くが実践しています',
  },
]

const YEN = (amount: number) => ({ amount, currency: 'JPY' })

/** ⚠ THE AUDITABLE LIST, IN FULL. personal-findings.ts:193 —
 *  `count_total` MUST equal `len(session_refs)`, and :123-125 is explicit that a
 *  finding may only claim the number of sessions it can actually CITE. A fixture
 *  that listed three refs behind a count of nineteen would be a fixture the room
 *  must warn about — which is exactly what the room does, so the plane states
 *  every ref rather than sampling them. */
const refs = (startId: number, weekday: string[], n: number) =>
  Array.from({ length: n }, (_, i) => ({
    session_id: `ses-${String(startId + i * 3).padStart(4, '0')}`,
    date: `第${Math.floor(i / 3) + 1}週 ${weekday[i % weekday.length]}曜`,
  }))

export const coachingStaff: FixtureCoachingStaff[] = [
  // ── p-06 見本 あずさ — the operator's OWN row. The rich, mature run. ───────
  {
    staffId: 'p-06',
    closingRate: 0.52,
    rebookingRate: 0.71,
    customerSatisfaction: 4.3,
    avgRevenue: YEN(9800),
    history: [0.38, 0.41, 0.44, 0.52],
    categories: [
      { key: 'questioning_depth', score: 74, topBenchmark: 88, confidence: 'high' },
      { key: 'acknowledgment', score: 82, topBenchmark: 89, confidence: 'high' },
      { key: 'value_presentation', score: 61, topBenchmark: 84, confidence: 'medium' },
      { key: 'next_step', score: 58, topBenchmark: 86, confidence: 'high' },
    ],
    findingsRun: {
      sessions_reviewed: 34,
      status: 'findings',
      headline: '提案に入るタイミングが、いちばん成約に効いています',
      findings: [
        {
          id: 'f-06-1',
          severity: 'priority',
          category: '提案に入るタイミング',
          rank: 1,
          headline: 'お客様が話し終える前に提案を始めています',
          impact: '12回のセッションのうち8回で、お客様の話の途中で提案に入りました。そのうち5回が不成約です。',
          recommendation: 'お客様が言い終えてから一拍おき、聞いた内容を一度言い返してから提案に移ってください。',
          evidence: {
            // 8 sessions showed the pattern, out of the 12 the comparison names.
            count_total: 8,
            count_outcome_aligned: 5,
            outcome_metric: '成約率',
            comparison: '12回中8回、うち5回が不成約',
            session_refs: refs(142, ['火', '金', '水'], 8),
            checklist_item_matched: null,
            verbatim_moment: {
              session_id: 'ses-0147',
              date: '第1週 金曜',
              quote: '肩のことなんですけど、最近ちょっと——',
              speaker: 'customer',
            },
          },
          confidenceNote: null,
          linked_module_id: 'mod-ack-01',
          pattern_reference: 'tp-1',
        },
        {
          id: 'f-06-2',
          severity: 'watch',
          category: '金額の伝え方',
          rank: 2,
          headline: '金額の理由を伝えないまま提示しています',
          impact: '不成約12件のうち5件が「予算」でした。5件とも、金額の前に「続けると何が変わるか」を話していません。',
          recommendation: '金額を出す前に、続けた場合に何がどう変わるかを具体的に一つ伝えてください。',
          evidence: {
            count_total: 5,
            count_outcome_aligned: 5,
            outcome_metric: '成約率',
            comparison: '不成約12件のうち5件',
            session_refs: refs(145, ['木', '月', '金'], 5),
            checklist_item_matched: null,
            verbatim_moment: {
              session_id: 'ses-0159',
              date: '第2週 金曜',
              quote: '10回で42,000円になります',
              speaker: 'staff',
            },
          },
          confidenceNote: null,
          linked_module_id: null,
          pattern_reference: 'tp-2',
        },
        {
          id: 'f-06-3',
          severity: 'strength',
          category: '次回の目安の決め方',
          rank: 3,
          headline: '次回の目安をその場で決めています',
          impact: '再来率71%。24回のセッションのうち19回で、その場で次回の目安を決めていました。',
          recommendation: 'この進め方は続けてください。次回の目安を決めた回は、決めなかった回より再来が高く出ています。',
          evidence: {
            count_total: 19,
            count_outcome_aligned: 19,
            outcome_metric: '再来率',
            comparison: '24回中19回',
            session_refs: refs(143, ['水', '土', '木'], 19),
            checklist_item_matched: null,
            verbatim_moment: {
              session_id: 'ses-0164',
              date: '第3週 木曜',
              quote: '次は2週間後あたりが目安です',
              speaker: 'staff',
            },
          },
          confidenceNote: null,
          linked_module_id: null,
          pattern_reference: null,
        },
      ],
    },
    focus: {
      // ⚖ VL-5 — TWO ENTRIES, ON PURPOSE. staff-focus.ts:199 allows up to
      // three and the screen resolves the whole list, leading with the hero
      // and quietly listing the rest (「そのあとに効くもの」, audit #31); with
      // only ever one entry on any fixture row that list was code nobody's
      // world ever rendered. The second is `mod-value-01`'s own category, a
      // module the catalog already carries.
      focus_recommendations: [
        {
          category: 'acknowledgment',
          label: '提案の前に、聞いた内容を言い返す',
          description: '不成約が最も多く出ているのがこの場面です。ここを変えると成約率に直接効きます。',
          confidence: 'established',
          priority: 'high',
          module_id: 'mod-ack-01',
          suggested_new_module_title: null,
        },
        {
          category: 'value_presentation',
          label: '金額の前に、変わることを一つ話す',
          description: '「予算」を理由にした不成約の多くが、金額の前に価値の話をしていません。',
          confidence: 'early_signal',
          priority: 'medium',
          module_id: 'mod-value-01',
          suggested_new_module_title: null,
        },
      ],
      strengths: [
        { label: '次回の目安をその場で決める', detail: '再来率71%（24回中19回で目安を提示）' },
      ],
      focus_areas: [
        {
          category: 'acknowledgment',
          trajectory_band: 'growing',
          priority: 'high',
          maturity: 'established',
          summary_text: 'お客様の話を受けとめてから提案に移る場面を伸ばすと、さらに伸びが見込めます。',
        },
      ],
    },
    outcomes: {
      noDealTotal: 12,
      declineReasons: [
        { reason: 'budget', count: 5 },
        { reason: 'considering', count: 4 },
        { reason: 'mismatch', count: 2 },
        { reason: 'follow_up', count: 1 },
      ],
      pendingCount: 3,
    },
    grant: 'none',
  },

  // ── p-01 見本 はなこ — growing, and the 'routine_excellence' window. ───────
  // ⚠ A REAL AND DELIBERATE STATE (personal-findings.ts:148-150): plenty of
  // data, nothing recurring cleared the bar. Reported with the real numbers, as
  // a valid signal — never a consolation prize and never a stretched nitpick.
  {
    staffId: 'p-01',
    closingRate: 0.58,
    rebookingRate: 0.66,
    customerSatisfaction: 4.5,
    avgRevenue: YEN(10400),
    history: [0.39, 0.45, 0.51, 0.58],
    categories: [
      { key: 'questioning_depth', score: 81, topBenchmark: 88, confidence: 'high' },
      { key: 'acknowledgment', score: 79, topBenchmark: 89, confidence: 'high' },
      { key: 'value_presentation', score: 76, topBenchmark: 84, confidence: 'medium' },
      { key: 'next_step', score: 80, topBenchmark: 86, confidence: 'high' },
    ],
    findingsRun: {
      sessions_reviewed: 41,
      status: 'routine_excellence',
      headline: '41回のセッションを見ました。繰り返し出ているくせは見つかりませんでした。',
      findings: [],
    },
    focus: {
      focus_recommendations: [],
      strengths: [{ label: '不安をひとつずつ拾ってから提案する', detail: '成約24回のうち21回でこの順番でした' }],
      focus_areas: [
        {
          category: 'questioning_depth',
          trajectory_band: 'growing',
          priority: 'low',
          maturity: 'established',
          summary_text: '本人のこれまでと比べて、聞き取りの深さが安定して伸びています。',
        },
      ],
    },
    outcomes: {
      noDealTotal: 9,
      declineReasons: [{ reason: 'considering', count: 6 }, { reason: 'budget', count: 3 }],
      pendingCount: 1,
    },
    grant: 'granted',
  },

  // ── p-04 見本 しろう — needs support, AND the defer-heavy case. ────────────
  {
    staffId: 'p-04',
    closingRate: 0.24,
    rebookingRate: 0.48,
    customerSatisfaction: 3.9,
    avgRevenue: YEN(7200),
    history: [0.36, 0.33, 0.28, 0.24],
    categories: [
      { key: 'value_presentation', score: 46, topBenchmark: 84, confidence: 'medium' },
      { key: 'next_step', score: 41, topBenchmark: 86, confidence: 'high' },
    ],
    findingsRun: {
      sessions_reviewed: 28,
      status: 'findings',
      headline: 'クロージングの終わり方に、成約が抜けているところがあります',
      findings: [
        {
          id: 'f-04-1',
          severity: 'priority',
          category: 'クロージングの終わり方',
          rank: 1,
          headline: 'クロージングを毎回「後で決める」で終えています',
          impact:
            '28回のセッションのうち17回が「後で決める」のままで終わっています。そのうち11回はその後の連絡も記録されておらず、成約とも不成約とも判定されないまま残っています。',
          recommendation: 'その場で決められない場合は、次にいつ返事をもらうかだけを決めてから終えてください。',
          evidence: {
            count_total: 17,
            count_outcome_aligned: 11,
            outcome_metric: '成約率',
            comparison: '28回中17回、うち11回はその後の連絡なし',
            session_refs: refs(201, ['月', '火', '水'], 17),
            checklist_item_matched: null,
            verbatim_moment: {
              session_id: 'ses-0216',
              date: '第3週 水曜',
              quote: 'またお考えになってみてください',
              speaker: 'staff',
            },
          },
          confidenceNote: null,
          linked_module_id: 'mod-next-01',
          pattern_reference: null,
        },
      ],
    },
    focus: {
      focus_recommendations: [
        {
          category: 'next_step',
          label: '返事をもらう日だけを決めて終える',
          description: '保留のまま終わった回が最も多く、そこで成約が抜けています。',
          confidence: 'established',
          priority: 'high',
          module_id: 'mod-next-01',
          suggested_new_module_title: null,
        },
      ],
      strengths: [],
      focus_areas: [
        {
          category: 'next_step',
          trajectory_band: 'needs-support',
          priority: 'high',
          maturity: 'established',
          summary_text: '会話の締めくくり方を一緒に整えると、変化が出やすい時期です。',
        },
      ],
    },
    outcomes: {
      noDealTotal: 6,
      declineReasons: [{ reason: 'budget', count: 4 }, { reason: 'other', count: 2 }],
      pendingCount: 17,
    },
    grant: 'declined',
  },

  // ── p-05 見本 ごろう — steady, the 'capture_gap' window, and the LONGEST
  // STRINGS this room can meet.
  // ⚠ capture_gap IS A RECORDER PROBLEM, NOT A COACHING ONE
  // (personal-findings.ts:151-152): the window is quiet because most sessions
  // had no entries, and saying so is the state — misreading it as a good week is
  // the failure mode the status enum exists to prevent.
  {
    staffId: 'p-05',
    closingRate: 0.47,
    rebookingRate: 0.63,
    customerSatisfaction: 4.1,
    avgRevenue: YEN(8600),
    history: [0.45, 0.46, 0.47, 0.47],
    categories: [
      { key: 'questioning_depth', score: 69, topBenchmark: 88, confidence: 'low' },
      { key: 'acknowledgment', score: 71, topBenchmark: 89, confidence: 'low' },
    ],
    findingsRun: {
      sessions_reviewed: 36,
      status: 'capture_gap',
      headline: '36回のうち24回は会話の記録が残っていませんでした。分析できたのは12回ぶんです。',
      findings: [],
    },
    focus: {
      focus_recommendations: [],
      strengths: [],
      // ⚠ THE SENTENCE AGREES WITH THE BAND IT SITS BESIDE (⚖ demo data =
      // product truth). It used to read 「まだ判断材料が足りません」 under a
      // 安定 chip, so a manager's 3-second read got a verdict and 「we cannot
      // judge yet」 side by side. Both halves were true inside the model — a
      // steady closing rate can sit on thin category evidence — but the board
      // is read in three seconds, not reasoned through. What is wrong here is
      // the RECORDING, and that is what the sentence now says; the band, which
      // is computed from the closing-rate history the plane really has, stands.
      focus_areas: [
        {
          category: 'questioning_depth',
          trajectory_band: 'steady',
          priority: 'medium',
          maturity: 'early',
          summary_text:
            '録音が残っていないセッションが多く、会話の中身から見えることがまだ限られています。記録の残し方を一緒に整えるところから始めると、次の月からもっと具体的に見えるようになります。',
        },
      ],
    },
    outcomes: {
      noDealTotal: 11,
      declineReasons: [{ reason: 'considering', count: 5 }, { reason: 'mismatch', count: 4 }, { reason: 'other', count: 2 }],
      pendingCount: 4,
    },
    grant: 'none',
  },

  // ── p-09 見本 みらい — the NEW HIRE. status 'insufficient_data' (<6 sessions,
  // personal-findings.ts:153), and below the band floor, so the board says so
  // without ever saying how few.
  {
    staffId: 'p-09',
    closingRate: 0.29,
    rebookingRate: 0.43,
    customerSatisfaction: 4.0,
    avgRevenue: YEN(7800),
    history: [0.25, 0.29],
    categories: [],
    findingsRun: {
      sessions_reviewed: 5,
      status: 'insufficient_data',
      headline: 'まだ分析できる回数に届いていません。',
      findings: [],
    },
    focus: { focus_recommendations: [], strengths: [], focus_areas: [] },
    outcomes: {
      noDealTotal: 3,
      declineReasons: [{ reason: 'considering', count: 2 }, { reason: 'budget', count: 1 }],
      pendingCount: 2,
    },
    grant: 'none',
  },

  // ── p-02 見本 たろう — テスト代官山店. The store has coaching switched OFF, so
  // this row is never read: the module gate happens ABOVE the read, which is what
  // makes 「off = the surfaces do not render」 structural rather than a hidden
  // div. Kept so the gate has something real to refuse.
  {
    staffId: 'p-02',
    closingRate: 0.44,
    rebookingRate: 0.59,
    customerSatisfaction: 4.2,
    avgRevenue: YEN(8100),
    history: [0.4, 0.42, 0.44],
    categories: [{ key: 'questioning_depth', score: 66, topBenchmark: 88, confidence: 'medium' }],
    findingsRun: { sessions_reviewed: 22, status: 'routine_excellence', headline: '22回を見ました。', findings: [] },
    focus: { focus_recommendations: [], strengths: [], focus_areas: [] },
    outcomes: {
      noDealTotal: 7,
      declineReasons: [{ reason: 'budget', count: 4 }, { reason: 'considering', count: 3 }],
      pendingCount: 2,
    },
    grant: 'none',
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// LOOK-FIX ROUND — the surfaces the 9/1 coverage audit found missing, and the
// data that drives them. ADD-ONLY: not one line above this rule moved, so every
// pin the build round left standing still measures the same bytes.
//
// ⚖ THE SAME LAW AS EVERYTHING ABOVE: every shape below MIRRORS a real
// generator output or a `contract.ts` view type, FIELD FOR FIELD, with its cite.
// Nothing here is a shape this room invented.
// ═══════════════════════════════════════════════════════════════════════════

// ── contract.ts:265-296 — the store's coaching ROI (L2-owner) ────────────────

/** effectiveness.ts:47-58 `HorizonInput`, field for field.
 *
 *  ⚠ THIS PLANE STATES THE RAW MEASUREMENT, NEVER A LIFT (deviation C8L-2, and
 *  it is the load-bearing one on this screen). `contract.ts:273-279` says the
 *  displays are 「pre-formatted upstream」 — but a plane that simply stated
 *  「+6pt」 would let the CONTROL ARM be deleted with nothing on the page
 *  changing, and the control arm is the entire honesty claim: every number on
 *  the owner's screen is 「treated Δ − control Δ」 (effectiveness.ts:61-63's
 *  `horizonEffect`), empirical-Bayes-shrunk (:66-74's `shrink`) and labelled by
 *  which horizons matured (:93-98's `confidenceFor`). So the subtraction happens
 *  in `coaching.ts`, mirroring those three functions, and the screen shows a
 *  number that was ACTUALLY produced by subtracting untreated stores. */
export interface FixtureHorizonInput {
  /** effectiveness.ts:29 HORIZONS — 30/90/180/365 and nothing else. */
  horizon: 30 | 90 | 180 | 365
  /** Mean metric change for THIS store over [t, t+H], in metric units. */
  treatedDelta: number
  /** The C1 control arm: same window, stores that did NOT adopt coaching. */
  controlDelta: number
  /** Stores contributing at this horizon — drives the shrinkage confidence. */
  n: number
}

/** contract.ts:273-279 `StoreMetricLift`'s own inputs. `liftDisplay` and
 *  `confidence` are DERIVED (above); `before`/`after` are the store's measured
 *  levels and the props file formats them, because money is multi-country
 *  (contract.ts:38-43) and a rate is not a currency. */
export interface FixtureMetricLift {
  /** The key `ja.json coaching.owner.roi.metric.*` names. */
  key: 'closingRate' | 'rebookingRate' | 'avgRevenue' | 'satisfaction'
  before: number
  after: number
  /** How the props file must format this metric — never guessed from the key. */
  unit: 'rate' | 'money' | 'score'
  horizons: FixtureHorizonInput[]
}

/** contract.ts:281-296 `StoreCoachingRoi`'s own inputs.
 *  ⚠ STORE AGGREGATE ONLY (contract.ts:284-286): there is no staff id, no name
 *  and no per-person field anywhere in this shape, so the owner's selling screen
 *  cannot become a league table by accident. */
export interface FixtureStoreRoi {
  /** Which lift is the hero. Must name one of `lifts[].key`. */
  headlineKey: FixtureMetricLift['key']
  /** contract.ts:290 — months since the store switched coaching on. */
  sinceMonths: number
  /** contract.ts:291-293 — MetricPoint VALUES, oldest first. The month labels
   *  are composed by the props file from the render clock, exactly as the self
   *  trend's are: the demo world is dated relative to today. */
  treated: number[]
  control: number[]
  /** contract.ts:293 — where along the series coaching started, 0..1. */
  coachingStartFraction: number
  lifts: FixtureMetricLift[]
  /** contract.ts:295-296 — 「Null when confidence is too low to responsibly
   *  state one」. STATED here, NULLED by the model: the gate is a rule, and a
   *  rule belongs where it can be tested, not in the data it judges. */
  monthlyValueEstimate: { amount: number; currency: string }
  /** effectiveness.ts:66-74 `shrink(rawScore, n, priorMean)` — the category
   *  prior a thin sample is pulled toward. ZERO is the honest prior for a lift:
   *  「assume no effect until the data says otherwise」. */
  priorMean: number
}

/** ⚠ THE NUMBERS ARE BUILT TO EXERCISE THE MATH, NOT TO FLATTER IT. The four
 *  metrics deliberately land on THREE DIFFERENT confidence labels, because the
 *  screen's honesty depends on 「構築中」 and 「初期」 being states a reader
 *  actually meets rather than branches only a test sees:
 *    · 成約率      30/90/180 → 'mature'   (the hero, and the only one that
 *                                          unlocks the money line)
 *    · 満足度      30/90/180 → 'mature'
 *    · 再来率      30/90     → 'building'
 *    · 平均客単価  30        → 'early'
 *  And every control delta is POSITIVE: untreated stores were improving too, so
 *  a page that forgot to subtract them would print a visibly bigger number. */
export const storeRoi: Record<string, FixtureStoreRoi> = {
  [STORE_A]: {
    headlineKey: 'closingRate',
    sinceMonths: 6,
    treated: [0.36, 0.37, 0.36, 0.38, 0.37, 0.39, 0.42, 0.44, 0.45, 0.47, 0.48, 0.5],
    control: [0.36, 0.36, 0.37, 0.37, 0.38, 0.38, 0.39, 0.39, 0.39, 0.4, 0.4, 0.4],
    coachingStartFraction: 0.545,
    lifts: [
      {
        key: 'closingRate',
        before: 0.37,
        after: 0.5,
        unit: 'rate',
        horizons: [
          { horizon: 30, treatedDelta: 0.02, controlDelta: 0.005, n: 6 },
          { horizon: 90, treatedDelta: 0.05, controlDelta: 0.01, n: 14 },
          { horizon: 180, treatedDelta: 0.09, controlDelta: 0.02, n: 22 },
        ],
      },
      {
        key: 'satisfaction',
        before: 4.0,
        after: 4.3,
        unit: 'score',
        horizons: [
          { horizon: 30, treatedDelta: 0.1, controlDelta: 0.05, n: 6 },
          { horizon: 90, treatedDelta: 0.2, controlDelta: 0.08, n: 13 },
          { horizon: 180, treatedDelta: 0.3, controlDelta: 0.12, n: 20 },
        ],
      },
      {
        key: 'rebookingRate',
        before: 0.6,
        after: 0.66,
        unit: 'rate',
        horizons: [
          { horizon: 30, treatedDelta: 0.01, controlDelta: 0.004, n: 6 },
          { horizon: 90, treatedDelta: 0.03, controlDelta: 0.012, n: 12 },
        ],
      },
      {
        key: 'avgRevenue',
        before: 8600,
        after: 9200,
        unit: 'money',
        horizons: [{ horizon: 30, treatedDelta: 300, controlDelta: 120, n: 5 }],
      },
    ],
    monthlyValueEstimate: { amount: 182000, currency: 'JPY' },
    priorMean: 0,
  },
}

// ── top-performer-patterns.ts — the pattern library (L2, anonymised) ─────────

/** top-performer-patterns.ts:152-161 — the `evidence` block, field for field.
 *  ⚠ IT NEVER REACHES A SCREEN AS A FRACTION. `adoptionNote` above is this same
 *  block 「rendered as a sentence」, and that is what keeps a denominator off a
 *  staff member's screen — 「上位層8名中7名」 tells a reader in a small salon
 *  exactly who the eighth is. The model turns these counts into the same
 *  denominator-free sentence, and the plane keeps them so the mirror is real. */
export interface FixturePatternEvidence {
  presentInTopPerformers: number
  ofTopPerformers: number
  presentInMedianPerformers: number
  ofMedianPerformers: number
  sessionCount: number
}

/** top-performer-patterns.ts:139-166 — one item of `patterns[]`, field for field.
 *
 *  ⚠ THERE IS NO `sourceStaffName`, AND ITS ABSENCE IS THE GUARANTEE — the same
 *  construction `TriageRow` uses against a per-staff number.
 *  `COACHING_VISIBILITY_MODEL.md:123` flags the phone's hardcoded
 *  `showSource = role === 'owner'` (`PatternLibrary.tsx:55`) as ungated by the
 *  source's own consent, and §5 requires DOUBLE consent for attribution. A field
 *  that does not exist cannot be switched on by a role check. */
export interface FixtureTopPattern {
  /** `pattern-categories.ts:12-17` — the production taxonomy's five keys, or
   *  null when the generator could not place it (the schema allows null). */
  category: 'counseling_questions' | 'conversation_flow' | 'closing' | 'rebooking' | 'objection_handling' | null
  title: string
  behaviorDescription: string
  /** top-performer-patterns.ts:157 — 「paraphrase; any verbatim ≤15 chars, no
   *  names/dates/circumstances」. The actual LINE a top performer says, which is
   *  the whole reason a shelf beats two loose sentences. */
  anonymizedExample: string
  evidence: FixturePatternEvidence
  transferability: string
  confidence: 'high' | 'medium' | 'low'
}

/** ⚠ ONE SHELF IS DELIBERATELY EMPTY (反対意見への対応). `PatternCategorySection
 *  .tsx:9-18` renders a heading and a description even with no examples on
 *  purpose — the reader sees the SHAPE of the library rather than a library that
 *  silently has four shelves this month and five the next. A plane that filled
 *  all five would leave that state untested. */
export const patternLibrary: FixtureTopPattern[] = [
  {
    category: 'counseling_questions',
    title: 'いちばん困っている場面を、時間で聞く',
    behaviorDescription:
      '「どこがつらいですか」ではなく「一日のうちでいつがいちばんつらいですか」と、場面を時間で特定する聞き方をしています。',
    anonymizedExample: '一日のうちで、いつがいちばん気になりますか',
    evidence: { presentInTopPerformers: 7, ofTopPerformers: 8, presentInMedianPerformers: 3, ofMedianPerformers: 11, sessionCount: 96 },
    transferability: '初回カウンセリングの冒頭でそのまま使えます。業種を選びません。',
    confidence: 'high',
  },
  {
    category: 'counseling_questions',
    title: '要望の裏にある予定を聞く',
    behaviorDescription:
      '希望を聞いたあとに「そのあと何かご予定はありますか」と一言足して、来店の理由そのものを引き出しています。',
    anonymizedExample: 'そのあと、何かご予定はありますか',
    evidence: { presentInTopPerformers: 6, ofTopPerformers: 8, presentInMedianPerformers: 2, ofMedianPerformers: 11, sessionCount: 74 },
    transferability: '要望を聞いたあとの一言なので、いまの流れを変えずに足せます。',
    confidence: 'high',
  },
  {
    category: 'conversation_flow',
    title: '聞く・受けとめる・提案するの順を崩さない',
    behaviorDescription:
      'お客様が話し終えて一拍おいてから、聞いた内容をそのまま言い返し、それから提案に入る順番を毎回守っています。',
    anonymizedExample: '——ということですね。でしたら',
    evidence: { presentInTopPerformers: 8, ofTopPerformers: 8, presentInMedianPerformers: 4, ofMedianPerformers: 11, sessionCount: 118 },
    transferability: '順番だけの話なので、話す内容を変えずに今日から試せます。',
    confidence: 'high',
  },
  {
    category: 'closing',
    title: '金額の前に、変わることを一つだけ話す',
    behaviorDescription:
      '金額を伝える前に、続けた場合に何がどう変わるかを具体的に一つだけ先に話しています。二つ以上は話しません。',
    anonymizedExample: '続けると、朝の起き上がりが変わります',
    evidence: { presentInTopPerformers: 6, ofTopPerformers: 8, presentInMedianPerformers: 2, ofMedianPerformers: 11, sessionCount: 81 },
    transferability: '提示の直前に一文足すだけです。価格表を変える必要はありません。',
    confidence: 'medium',
  },
  {
    category: 'rebooking',
    title: '次回の目安を、その場で日付にして渡す',
    behaviorDescription:
      '「またお願いします」で終えず、次にいつが目安かをその場で言い切ってから見送っています。',
    anonymizedExample: '次は二週間後あたりが目安です',
    evidence: { presentInTopPerformers: 7, ofTopPerformers: 8, presentInMedianPerformers: 3, ofMedianPerformers: 11, sessionCount: 103 },
    transferability: '見送りの一言を変えるだけです。予約を取る操作は要りません。',
    confidence: 'high',
  },
]

/** top-performer-patterns.ts:168 `note` — 「small-team / empty-baseline caveat;
 *  anonymized like everything else」. */
export const patternLibraryNote: string | null =
  '在籍人数が少ない店舗では、上位層のやり方が特定の一人のやり方になりがちです。合わないと感じたものは無理に取り入れないでください。'

// ── learning-module.ts — the module catalog (L2 read) ────────────────────────

/** learning-module.ts:170-172 — one `outline[]` step, field for field. */
export interface FixtureModuleStep {
  step: number
  title: string
  detail: string
}

/** learning-module.ts:152-169 — the generated `module`, field for field, plus
 *  the ONE field the storage layer owns rather than the generator:
 *  `owner-types.ts:64-65 LearningModule.id`. The generator mints no id — the
 *  catalog does — and `personal-findings.ts:242`'s `linked_module_id` and
 *  `staff-focus.ts:173`'s `module_id` are both references to THAT id, which is
 *  what closes the loop between a finding and the module that fixes it.
 *
 *  ⚠ NO `assigned` / `assignedTo` / `completionRate` (`owner-types.ts:73-82`).
 *  Assignment state is Anthony's — it is a write with a notification attached —
 *  and the room refuses it through the help action it already has. Inventing a
 *  progress bar over data no generator produces would be the poster of a state
 *  the room-3 zero-state rebuild ended. */
export interface FixtureLearningModule {
  moduleId: string
  title: string
  description: string
  /** learning-module.ts:158 — 「intended 10-20 (runtime-checked)」. */
  durationMin: number
  generatedFromPatternIds: string[]
  resembledExemplarIds: string[]
  evidenceBasis: Array<
    | 'resembles_high_effectiveness_precedent'
    | 'avoids_known_ineffective_pattern'
    | 'no_prior_precedent_first_principles'
    | 'early_signal_org_under_6_months'
  >
  designRationale: string
  outline: FixtureModuleStep[]
}

/** ⚠ THE TWO IDS THE PLANE ALREADY POINTS AT ARE REAL HERE. `mod-ack-01` is
 *  p-06's own focus module (`focus_recommendations[0].module_id`) and the target
 *  of f-06-1's `linked_module_id`; `mod-next-01` is p-04's. Before this round
 *  both were references into nothing — the room diagnosed and then pointed at a
 *  library that did not exist (§5 rank 8). */
export const learningModules: FixtureLearningModule[] = [
  {
    moduleId: 'mod-ack-01',
    title: '提案の前に、聞いた内容を言い返す',
    description:
      'お客様が話し終えてから提案に入るまでの数秒に、聞いた内容をそのまま言い返す型を身につけます。不成約がいちばん多く出ている場面がここだからです。',
    durationMin: 12,
    generatedFromPatternIds: ['tp-1'],
    resembledExemplarIds: [],
    evidenceBasis: ['no_prior_precedent_first_principles'],
    designRationale:
      '上位層が例外なくやっている一拍と言い返しを、話す内容を変えずに順番だけで再現できるところまで分解しています。',
    outline: [
      { step: 1, title: '一拍おく', detail: 'お客様が言い終えてから、口を開くまでに一つ数えます。' },
      { step: 2, title: 'そのまま言い返す', detail: '要約せず、聞いた言葉をできるだけそのまま返します。' },
      { step: 3, title: '合っているか確かめる', detail: '「——ということですね」で止めて、返事を待ちます。' },
      { step: 4, title: 'それから提案に入る', detail: '受けとめが済んでから、はじめて提案の話をします。' },
    ],
  },
  {
    moduleId: 'mod-next-01',
    title: '返事をもらう日だけを決めて終える',
    description:
      'その場で決まらないときに、次にいつ返事をもらうかだけを決めて終える型です。保留のまま消える件数を減らすことだけを狙っています。',
    durationMin: 10,
    generatedFromPatternIds: [],
    resembledExemplarIds: ['mod-ack-01'],
    evidenceBasis: ['resembles_high_effectiveness_precedent', 'early_signal_org_under_6_months'],
    designRationale:
      '決断を迫らずに次の接点だけを固定する型なので、押し売りに感じさせずに「後で決める」の滞留を減らせます。',
    outline: [
      { step: 1, title: '決めなくていいと伝える', detail: '「今日決めなくて大丈夫です」を先に言います。' },
      { step: 2, title: '日だけを決める', detail: '「いつ頃お返事いただけますか」と、日付だけを聞きます。' },
      { step: 3, title: 'その場で書き留める', detail: '聞いた日をお客様の前で記録に残します。' },
    ],
  },
  {
    moduleId: 'mod-value-01',
    title: '金額の前に、変わることを一つ話す',
    description:
      '金額を出す前に、続けた場合に何がどう変わるかを一つだけ具体的に伝える型です。二つ以上並べると効果が落ちることも扱います。',
    durationMin: 15,
    generatedFromPatternIds: ['tp-2'],
    resembledExemplarIds: ['mod-ack-01'],
    evidenceBasis: ['resembles_high_effectiveness_precedent'],
    designRationale:
      '「予算」で終わった回のほとんどが、金額の前に価値の話をしていない回でした。順番の問題として扱っています。',
    outline: [
      { step: 1, title: '一つだけ選ぶ', detail: 'そのお客様がいちばん気にしていたことを一つ選びます。' },
      { step: 2, title: '変化を具体で言う', detail: '「〜が楽になります」ではなく、いつ・何がを言います。' },
      { step: 3, title: 'それから金額を出す', detail: '間を空けず、続けて金額を伝えます。' },
    ],
  },
]

// ── coaching-consent/types.ts — コーチングを受けることへの同意 ───────────────

/** `coaching-consent/types.ts:9-16 CoachingConsentRecord`, field for field, with
 *  its own 'unset' default-pre-prompt state (:5-6).
 *
 *  ⚠ THIS IS A DIFFERENT QUESTION FROM `grant` ABOVE, and conflating the two is
 *  the gap §5 rank 6 names. `grant` is the DEPTH-SHARE — 「may my manager see
 *  which場面 to support me in」. THIS is 「may my sessions be analysed at all」.
 *  A room that renders only the first reads as if coaching simply happens to
 *  you, which is exactly what the phone's amber banner (`CoachingPageView.tsx
 *  :78-100`) exists to prevent.
 *
 *  ⚠ `decidedAt` IS null THROUGHOUT, AND THAT IS THE PLANE BEING HONEST rather
 *  than incomplete: the demo world is dated relative to today, so a fixed ISO
 *  string would be a timestamp this world is not on — the same reason
 *  `window.date_range` and `MetricPoint.periodStart` are composed from the
 *  render clock instead of stated here. A screen cannot print a date the plane
 *  does not have, and it does not. */
export interface FixtureConsentRecord {
  status: 'unset' | 'granted' | 'declined'
  decidedAt: string | null
  policyVersion: string | null
}

/** ⚠ ALL THREE STATES ARE REACHABLE FROM THE STORE SWITCHER AND THE ROLE
 *  SWITCHER, not just from a test: p-06 (the operator's own screen), p-01, p-02,
 *  p-04 and p-05 have granted, p-09 みらい has DECLINED, and c-03 さぶろう was
 *  never asked (absent = 'unset'). A staff member reading their own screen
 *  therefore meets a real decision, and the role-preview walk still crosses
 *  granted / declined / unset.
 *
 *  ⚖ GREPTILE-1 / S16-D15 — AND EVERY ANALYSED ROW HAS A RECORD HERE, because
 *  「analysed but never asked」 is not a state this product can reach: the
 *  analysis is what the consent authorises, so it cannot precede it. (The
 *  reverse IS legal and stays pictured — p-09 declined AFTER a run, which is a
 *  withdrawal.) `coaching.test.ts`'s ⚖ GREPTILE-1 block pins the pairing. */
export const coachingConsent: Record<string, FixtureConsentRecord> = {
  'p-06': { status: 'granted', decidedAt: null, policyVersion: 'v2' },
  'p-01': { status: 'granted', decidedAt: null, policyVersion: 'v2' },
  // ⚖ R2-17 / S16-D11 — RE-STATED, because consent now gates the BOARD. A
  // member who has not granted it carries no band, no focus area and no help
  // action, whatever their history says. しろう is this demo's ONE サポートが必要
  // example and ごろう its 安定 row, so both grant; みらい is below the floor
  // anyway, which makes her the living proof that a DECLINE is invisible — her
  // row reads exactly as it did before, and exactly as さぶろう's does.
  'p-04': { status: 'granted', decidedAt: null, policyVersion: 'v2' },
  'p-05': { status: 'granted', decidedAt: null, policyVersion: 'v2' },
  'p-09': { status: 'declined', decidedAt: null, policyVersion: 'v2' },
  // p-02 たろう's store has coaching switched OFF, so he demonstrates the DORMANT
  // page rather than a consent state — but he carries an analysed row, and a row
  // is something only a granted record could have produced.
  'p-02': { status: 'granted', decidedAt: null, policyVersion: 'v2' },
  // c-03 さぶろう is ABSENT on purpose: absent = 'unset', the consent type's own
  // default-pre-prompt value, and he is the demo's never-asked reader — with no
  // analysed row either, which is what makes 「never asked」 a coherent state.
}
