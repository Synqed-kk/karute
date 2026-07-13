// ─────────────────────────────────────────────────────────────────────────
// Coaching conversation-skill categories — resolved per business type
// ─────────────────────────────────────────────────────────────────────────
// The scoring rubric (category-scoring.ts) grades a session on these. They are
// CONVERSATION-SKILL categories — how the session was run — NOT the entry-content
// categories used elsewhere in the app (施術/相談/体調/商品提案/次回). Different axis.
//
// The design that keeps sessions comparable across 26 wildly different businesses:
// four STABLE KEYS whose anchor bands are universal (defined once, in the rubric
// prompt, keyed by these keys), while only the LABEL + DEFINITION swap per
// business bucket. So "58 vs top 86" means the same thing whether it's a hair
// salon or a dental clinic — the yardstick is identical, only the words change.
// A counselling session simply marks the sales-shaped categories not-applicable
// rather than being scored on a metric that doesn't fit.
//
// Mirrors the resolveCaptureTokens pattern (authored buckets + generic fallback
// + a budget cap) but lives here, not in business-ai-tokens.ts, because these are
// coaching-specific — the token file stays focused on capture/persona/passport.

export type CoachingCategoryKey =
  | 'questioning_depth'
  | 'acknowledgment'
  | 'value_presentation'
  | 'next_step'

export interface CoachingCategory {
  key: CoachingCategoryKey
  labelJa: string
  labelEn: string
  defJa: string
  defEn: string
}

/** Cap on categories fed to the scorer — protects the instruction budget and
 *  keeps every session comparable. Mirrors CHECKLIST_BUDGET. Set above the
 *  current four so a business type can add one or two of its own later without a
 *  code change here. */
export const COACHING_CATEGORY_BUDGET = 6

// ── The four buckets ─────────────────────────────────────────────────────────
// Same four keys in each, so the anchors line up; labels + defs are native to
// the bucket. Order is fixed (scored in this order everywhere).

/** Service / wellness — most of the 26 (salons, massage, chiro, relaxation …). */
const GENERIC: CoachingCategory[] = [
  {
    key: 'questioning_depth',
    labelJa: '質問の深さ',
    labelEn: 'Questioning depth',
    defJa: 'お客様の要望や悩みの根本・程度まで、どれだけ踏み込んで聞けたか',
    defEn: "how far the staff dug into the root or severity of the customer's request/concern",
  },
  {
    key: 'acknowledgment',
    labelJa: '受けとめ',
    labelEn: 'Acknowledgment',
    defJa: 'お客様の言葉や気持ちを、どれだけ具体的に受けとめ会話に反映したか',
    defEn: "how specifically the staff acknowledged the customer's words/feelings and carried them forward",
  },
  {
    key: 'value_presentation',
    labelJa: '価格提示',
    labelEn: 'Value presentation',
    defJa: '価格や提案を、そのお客様が求める価値に結びつけて伝えられたか',
    defEn: "whether price/proposals were tied to the value THIS customer said they wanted",
  },
  {
    key: 'next_step',
    labelJa: 'クロージング',
    labelEn: 'Closing',
    defJa: '次の一歩（予約・継続・提案）を具体的に決め、返事まで得られたか',
    defEn: 'whether a concrete next step (booking/renewal/proposal) was set and a response obtained',
  },
]

/** Clinical — dental / medical / dermatology / cosmetic surgery / veterinary.
 *  Value + next-step reframe to consent + plan-agreement, never a retail push. */
const CLINICAL: CoachingCategory[] = [
  {
    key: 'questioning_depth',
    labelJa: '問診の深さ',
    labelEn: 'Assessment depth',
    defJa: '症状・経緯・背景を、どれだけ丁寧に聞き取れたか',
    defEn: 'how thoroughly symptoms, history, and context were taken',
  },
  {
    key: 'acknowledgment',
    labelJa: '受けとめ',
    labelEn: 'Acknowledgment',
    defJa: '患者の不安や疑問を、どれだけ受けとめ応えられたか',
    defEn: "how well the patient's worries/questions were acknowledged and answered",
  },
  {
    key: 'value_presentation',
    labelJa: '説明と同意',
    labelEn: 'Explanation & consent',
    defJa: '治療内容・費用・選択肢を、患者が納得して選べるだけ説明できたか（販売ではなく同意）',
    defEn: 'whether the plan, cost, and options were explained enough for real informed consent (consent, not a sale)',
  },
  {
    key: 'next_step',
    labelJa: '治療計画の合意',
    labelEn: 'Treatment-plan agreement',
    defJa: '次回・治療計画について具体的な合意や予約を得られたか（物販の押し売りにしない）',
    defEn: 'whether concrete agreement/booking on the next visit or treatment plan was reached (never an upsell)',
  },
]

/** Instruction / fitness — yoga / pilates / personal gym / training school.
 *  Questioning reframes to assessment; next-step to a concrete practice plan. */
const INSTRUCTION: CoachingCategory[] = [
  {
    key: 'questioning_depth',
    labelJa: '評価の深さ',
    labelEn: 'Assessment depth',
    defJa: '相手の目標・体の状態・動きを、どれだけ的確に評価できたか',
    defEn: "how accurately the member's goals, condition, and movement were assessed",
  },
  {
    key: 'acknowledgment',
    labelJa: '受けとめ',
    labelEn: 'Acknowledgment',
    defJa: '相手の目標や不安を、どれだけ受けとめ指導に反映したか',
    defEn: "how well the member's goals/worries were acknowledged and reflected in coaching",
  },
  {
    key: 'value_presentation',
    labelJa: '提案の説明',
    labelEn: 'Plan rationale',
    defJa: '次のプランやコースを、相手の目標に結びつけて説明できたか',
    defEn: "whether the next plan/course was explained in terms of the member's goals",
  },
  {
    key: 'next_step',
    labelJa: '次回プラン',
    labelEn: 'Next practice plan',
    defJa: '具体的な次回の練習・通いプランを決められたか',
    defEn: 'whether a concrete next practice / attendance plan was set',
  },
]

/** Counselling — mental_health. Sales-shaped categories are usually not
 *  applicable, or reframe to continuity-of-care; NEVER scored as a sales metric. */
const COUNSELING: CoachingCategory[] = [
  {
    key: 'questioning_depth',
    labelJa: '傾聴の深さ',
    labelEn: 'Depth of listening',
    defJa: 'どれだけ深く相手の話を聴き、掘り下げられたか',
    defEn: 'how deeply the client was listened to and drawn out',
  },
  {
    key: 'acknowledgment',
    labelJa: '受けとめ',
    labelEn: 'Acknowledgment',
    defJa: '相手の感情を、どれだけ的確に受けとめ返せたか',
    defEn: "how accurately the client's feelings were acknowledged and reflected back",
  },
  {
    key: 'value_presentation',
    labelJa: '継続の説明',
    labelEn: 'Continuity framing',
    defJa: '継続の意義を押し付けずに伝えられたか（多くの場合、該当なし）',
    defEn: 'whether the value of continuing was conveyed without pressure (often not applicable)',
  },
  {
    key: 'next_step',
    labelJa: '次回の継続',
    labelEn: 'Continuity of care',
    defJa: '次回来談の合意（営業的クロージングとしては評価しない）',
    defEn: 'agreement on a next session (never scored as a sales close)',
  },
]

/** Only the exceptions are listed; everything else resolves to GENERIC. Keys are
 *  the real business_type values from business-ai-tokens.ts PERSONAS. */
const BY_TYPE: Record<string, CoachingCategory[]> = {
  dental_clinic: CLINICAL,
  medical_clinic: CLINICAL,
  dermatology: CLINICAL,
  cosmetic_surgery: CLINICAL,
  veterinary: CLINICAL,
  yoga_studio: INSTRUCTION,
  pilates_studio: INSTRUCTION,
  personal_gym: INSTRUCTION,
  training_school: INSTRUCTION,
  mental_health: COUNSELING,
}

/** A category resolved to one locale, ready to render into the rubric prompt. */
export interface ResolvedCoachingCategory {
  key: CoachingCategoryKey
  label: string
  def: string
}

/** Resolve the scoring categories for a business type + locale. Unknown/`other`
 *  types fall back to GENERIC — never an empty or broken list. Capped at
 *  COACHING_CATEGORY_BUDGET. */
export function resolveCoachingCategories(
  businessType: string | null | undefined,
  locale: string,
): ResolvedCoachingCategory[] {
  const set = (businessType && BY_TYPE[businessType]) || GENERIC
  const ja = locale === 'ja'
  return set.slice(0, COACHING_CATEGORY_BUDGET).map((c) => ({
    key: c.key,
    label: ja ? c.labelJa : c.labelEn,
    def: ja ? c.defJa : c.defEn,
  }))
}
