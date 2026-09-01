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
