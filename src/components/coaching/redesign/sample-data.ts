// ─────────────────────────────────────────────────────────────
// Coaching sample data — the labeled プレビュー dataset
// ─────────────────────────────────────────────────────────────
// Rendered ONLY for unlimited/comped accounts (entitlement.isUnlimited —
// Liam's own account) so the finished screens are visible before the real
// data layer exists. Every real business sees the honest empty state
// instead (view={null} / roi={null}). Static display data: reads nothing,
// writes nothing, touches no DB. Source: the approved staff-view +
// owner-ROI artifacts (PR #413 / #414 previews).

import type {
  CategoryScore,
  MetricPoint,
  StaffCoachingView,
  StoreCoachingRoi,
} from '@/lib/karute/coaching/contract'

const SAMPLE_CATEGORIES: (CategoryScore & { label: string })[] = [
  { key: 'questioning_depth', label: '質問の深さ', score: 58, topBenchmark: 86, confidence: 'medium' },
  { key: 'next_step', label: 'クロージング', score: 61, topBenchmark: 86, confidence: 'medium' },
  { key: 'value_presentation', label: '価格提示', score: 54, topBenchmark: 79, confidence: 'low' },
  { key: 'acknowledgment', label: '受けとめ', score: 92, topBenchmark: 88, confidence: 'high' },
]

const SAMPLE_CLOSING_TREND: MetricPoint[] = [
  { periodStart: '2026-02-01', value: 0.48 },
  { periodStart: '2026-03-01', value: 0.51 },
  { periodStart: '2026-04-01', value: 0.54 },
  { periodStart: '2026-05-01', value: 0.56 },
  { periodStart: '2026-06-01', value: 0.59 },
  { periodStart: '2026-07-01', value: 0.62 },
]

export const SAMPLE_STAFF_VIEW: StaffCoachingView = {
  scope: 'staff-self',
  metrics: {
    closingRate: 0.62,
    rebookingRate: 0.71,
    customerSatisfaction: 4.4,
    avgRevenue: { amount: 14800, currency: 'JPY' },
    sessionsAnalyzed: 34,
  },
  progressHistory: SAMPLE_CLOSING_TREND,
  categories: SAMPLE_CATEGORIES,
  findings: [
    {
      id: 'f1',
      severity: 'priority',
      metricKey: 'closingRate',
      headline: '提案を急いでいる',
      impact:
        '12回中8回、お客様が要望を言い終える前に提案に入っています。そのうち5回が不成約でした。',
      recommendation:
        'お客様が話し終えるまで、あと一呼吸おいてから提案する。「他に気になるところは？」を一つ挟むと成約が伸びています。',
      evidence: { sessionCount: 12, affectedCount: 8, transcriptMoments: [] },
      confidenceNote: '34セッション・まだ荒削り。データが増えるほど正確になります。',
    },
    {
      id: 'f2',
      severity: 'watch',
      metricKey: 'value_presentation',
      headline: '価格の根拠が弱い',
      impact:
        '価格提示の場面7回のうち5回で、そのお客様の目的と結びつけずに金額だけをお伝えしています。',
      recommendation:
        '金額の前に「〇〇を良くするため」と、その方が言った目的に一言つなげる。',
      evidence: { sessionCount: 7, affectedCount: 5, transcriptMoments: [] },
      confidenceNote: null,
    },
    {
      id: 'f3',
      severity: 'strength',
      metricKey: 'acknowledgment',
      headline: '受けとめが安定している',
      impact:
        '11回中9回、お客様の言葉を具体的に受けとめてから次に進めています。満足度4.4を支えている強みです。',
      recommendation:
        'この受けとめを、価格提示やクロージングの場面でも同じように続ける。',
      evidence: { sessionCount: 11, affectedCount: 9, transcriptMoments: [] },
      confidenceNote: null,
    },
  ],
  focus: [
    {
      id: 'foc1',
      categoryKey: 'next_step',
      headline: '提案の前に、あと一呼吸おく',
      rationale:
        '今のあなたに一番効くのはこれ。急がず提案するだけで、先月の傾向では成約が5件増えていた計算です。',
      moduleId: 'mod-close-1',
    },
  ],
  outcomes: {
    noDealTotal: 13,
    declineReasons: [
      { reason: 'budget', count: 5 },
      { reason: 'considering', count: 4 },
      { reason: 'mismatch', count: 2 },
      { reason: 'follow_up', count: 2 },
    ],
    pendingCount: 8,
  },
  learnFromTop: [
    {
      id: 'tp1',
      categoryKey: 'questioning_depth',
      behavior:
        '「他に気になるところはありますか？」— 提案の直前にこの一言を挟んでいます。',
      adoptionNote: 'トップ層の9割が実践 ・ 匿名',
    },
    {
      id: 'tp2',
      categoryKey: 'next_step',
      behavior:
        '次回予約のとき、お客様が最初に話した目的（結婚式・旅行など）に必ず結びつけています。',
      adoptionNote: 'トップ層の8割が実践 ・ 匿名',
    },
  ],
  maturityNote: '34セッション。まだ傾向が固まりきっていません。',
}

const SAMPLE_ROI_CONTROL: MetricPoint[] = [
  { periodStart: '2026-02-01', value: 0.54 },
  { periodStart: '2026-03-01', value: 0.55 },
  { periodStart: '2026-04-01', value: 0.55 },
  { periodStart: '2026-05-01', value: 0.56 },
  { periodStart: '2026-06-01', value: 0.55 },
  { periodStart: '2026-07-01', value: 0.56 },
]

export const SAMPLE_STORE_ROI: StoreCoachingRoi = {
  scope: 'owner-aggregate',
  headline: { key: 'closingRate', liftDisplay: '+6pt', confidence: 'mature', sinceMonths: 3 },
  trend: {
    treated: SAMPLE_CLOSING_TREND,
    control: SAMPLE_ROI_CONTROL,
    coachingStartFraction: 0.37,
  },
  lifts: [
    { key: 'closingRate', liftDisplay: '+6pt', beforeDisplay: '56%', afterDisplay: '62%', confidence: 'mature' },
    { key: 'rebookingRate', liftDisplay: '+4pt', beforeDisplay: '67%', afterDisplay: '71%', confidence: 'building' },
    { key: 'avgRevenue', liftDisplay: '+¥1,200', beforeDisplay: '¥13,600', afterDisplay: '¥14,800', confidence: 'early' },
  ],
  monthlyValueEstimate: { amount: 180000, currency: 'JPY' },
}
