// Constants for the /welcome setup wizard.
//
// Source of truth: dashboard-data.js in the redesign handoff. Each business
// type ships with a tuned AI profile that's surfaced as a live preview in
// Step 1 — `priorityTopics`, `coachingFocus`, etc. are numbers shown in the
// "Included in this profile" list. Production will replace these with the
// real per-template counts; for now they're the prototype values.
//
// Localization (contracts#business-profile-locale): the registry stores paired
// En/Ja fields (house precedent: business-ai-tokens.ts `roleJa`/`roleEn`). The
// PUBLIC accessors (`getBusinessProfile`, `getConsultationQuestions`) take an
// optional `locale` (default 'en') and return the EXISTING resolved shapes
// (`BusinessProfile`, `ConsultationQuestion`) — so every caller that omits the
// arg compiles and behaves exactly as before.

export interface BusinessType {
  value: string
  label: string
  labelJa: string
}

// ── Public resolved shapes (UNCHANGED — what every caller receives) ──────────

export interface BusinessProfile {
  label: string
  tagline: string
  priorityTopics: number
  coachingFocus: number
  topPatterns: number
  consultationPrompts: number
  // Drives the 3 prompt cards on the AI Assistant page. Source of truth
  // for what "Tuned for: <type>" actually means at the AI surface.
  consultationQuestions?: ConsultationQuestion[]
}

export interface ConsultationQuestion {
  id: string
  category: 'Analysis' | 'Customer' | 'Strategy'
  title: string
  preview: string
  example: string
}

// ── Internal registry shapes (paired En/Ja — resolved by the accessors) ──────

interface ConsultationQuestionSource {
  id: string
  // Card icon map keys on this EN value — NEVER add a 4th value; only the
  // DISPLAYED label localizes (PromptTemplateCard), the field value does not.
  category: 'Analysis' | 'Customer' | 'Strategy'
  title: string
  titleJa: string
  preview: string
  previewJa: string
  example: string
  exampleJa: string
}

interface BusinessProfileSource {
  label: string
  labelJa: string
  tagline: string
  taglineJa: string
  priorityTopics: number
  coachingFocus: number
  topPatterns: number
  consultationPrompts: number
  consultationQuestions?: ConsultationQuestionSource[]
}

export const BUSINESS_TYPES: BusinessType[] = [
  { value: 'esthetic_salon', label: 'Esthetic Salon', labelJa: 'エステサロン' },
  { value: 'hair_salon', label: 'Hair Salon', labelJa: 'ヘアサロン' },
  { value: 'nail_salon', label: 'Nail Salon', labelJa: 'ネイルサロン' },
  { value: 'eyelash_salon', label: 'Eyelash Salon', labelJa: 'まつげサロン' },
  { value: 'massage', label: 'Massage', labelJa: 'リラクゼーション・マッサージ' },
  { value: 'chiropractic', label: 'Chiropractic', labelJa: '整体院' },
  { value: 'beauty_chiropractic', label: 'Beauty Chiropractic', labelJa: '美容整体' },
  { value: 'acupuncture', label: 'Acupuncture', labelJa: '鍼灸院' },
  { value: 'osteopathy', label: 'Osteopathy', labelJa: '整骨院' },
  { value: 'yoga_studio', label: 'Yoga Studio', labelJa: 'ヨガスタジオ' },
  { value: 'pilates_studio', label: 'Pilates Studio', labelJa: 'ピラティススタジオ' },
  { value: 'personal_gym', label: 'Personal Gym', labelJa: 'パーソナルジム' },
  { value: 'dental_clinic', label: 'Dental Clinic', labelJa: '歯科クリニック' },
  { value: 'medical_clinic', label: 'Medical Clinic', labelJa: '医療クリニック' },
  { value: 'dermatology', label: 'Dermatology', labelJa: '皮膚科クリニック' },
  { value: 'cosmetic_surgery', label: 'Cosmetic Surgery', labelJa: '美容外科クリニック' },
  { value: 'physical_therapy', label: 'Physical Therapy', labelJa: '理学療法' },
  { value: 'foot_care', label: 'Foot Care / Reflexology', labelJa: 'フットケア・リフレクソロジー' },
  { value: 'relaxation', label: 'Relaxation Salon', labelJa: 'リラクゼーションサロン' },
  { value: 'aroma', label: 'Aromatherapy Salon', labelJa: 'アロマセラピーサロン' },
  { value: 'wellness_clinic', label: 'Wellness Clinic', labelJa: 'ウェルネスクリニック' },
  { value: 'mental_health', label: 'Mental Health / Counseling', labelJa: 'メンタルヘルス・カウンセリング' },
  { value: 'veterinary', label: 'Veterinary Clinic', labelJa: '動物病院' },
  { value: 'pet_grooming', label: 'Pet Grooming', labelJa: 'トリミングサロン' },
  { value: 'training_school', label: 'Training / Lessons', labelJa: 'スクール・レッスン' },
  { value: 'other', label: 'Other', labelJa: 'その他' },
]

const GENERIC_CONSULTATION_QUESTIONS: ConsultationQuestionSource[] = [
  {
    id: 'g-analysis',
    category: 'Analysis',
    title: 'Weekly performance summary',
    titleJa: '今週のパフォーマンス概況',
    preview: 'Top trends in karute, bookings, and rebooking this week',
    previewJa: '今週のカルテ・予約・再予約の傾向まとめ',
    example:
      'Summarize this week\'s karute activity, top customers, and any rebooking gaps to follow up on',
    exampleJa:
      '今週のカルテ活動、上位のお客様、フォローすべき再予約の抜けをまとめてください',
  },
  {
    id: 'g-customer',
    category: 'Customer',
    title: 'Customers due for follow-up',
    titleJa: 'フォローアップが必要なお客様',
    preview: 'Who hasn\'t been in for 60+ days that we should reach out to',
    previewJa: '60日以上ご来店のないお客様は？',
    example:
      'List customers who haven\'t booked in 60+ days and suggest a re-engagement message for each',
    exampleJa:
      '60日以上予約のないお客様を一覧にして、それぞれに再来店を促すメッセージ案を提案してください',
  },
  {
    id: 'g-strategy',
    category: 'Strategy',
    title: 'Next-month campaign ideas',
    titleJa: '来月のキャンペーン案',
    preview: 'Promotions tuned to our karute patterns + customer profiles',
    previewJa: 'カルテの傾向とお客様層に合わせた販促案',
    example:
      'Suggest 3 campaign ideas for next month grounded in the kinds of services our customers are asking about',
    exampleJa:
      'お客様が求めているサービスの傾向に基づいて、来月のキャンペーン案を3つ提案してください',
  },
]

const BUSINESS_TYPE_PROFILES: Record<string, BusinessProfileSource> = {
  beauty_chiropractic: {
    label: 'Beauty Chiropractic',
    labelJa: '美容整体',
    tagline:
      'Pelvic + posture + small-face correction. AI tuned for the hybrid beauty/clinical vocabulary unique to 美容整体.',
    taglineJa:
      '骨盤・姿勢・小顔ケアに対応。美容整体ならではの美容と施術の語彙にAIを最適化しています。',
    priorityTopics: 14,
    coachingFocus: 6,
    topPatterns: 8,
    consultationPrompts: 12,
    consultationQuestions: [
      {
        id: 'bc-customer',
        category: 'Customer',
        title: 'Bridal-goal customers',
        titleJa: 'ブライダル目標のお客様',
        preview: 'Customers with weddings in the next 6 months — by remaining time',
        previewJa: '挙式まで6ヶ月以内のお客様を残り期間順に',
        example:
          'List customers with weddings in the next 6 months and draft cadence recommendations based on time remaining',
        exampleJa:
          '挙式まで6ヶ月以内のお客様を一覧にして、残り期間に合わせた通い方の提案を作成してください',
      },
      {
        id: 'bc-analysis',
        category: 'Analysis',
        title: 'Intensive → maintenance conversion',
        titleJa: '集中期→メンテナンス移行率',
        preview: '% who graduated from the intensive phase to maintenance, by staff',
        previewJa: '集中ケアからメンテナンスへ移行したお客様の割合をスタッフ別に',
        example:
          'Break down intensive→maintenance conversion by staff and analyze what drives the gap',
        exampleJa:
          '集中期からメンテナンス期への移行率をスタッフ別に集計し、差が出る要因を分析してください',
      },
      {
        id: 'bc-strategy',
        category: 'Strategy',
        title: 'Pre-summer body-shape course',
        titleJa: '夏前ボディメイクコース',
        preview: '3-month pelvic + body-shape course — weekly cadence + pricing',
        previewJa: '骨盤＋ボディメイクの3ヶ月コース — 週次設計と価格',
        example:
          'Draft a 3-month pelvic + body-shape pre-summer course with weekly cadence design and pricing',
        exampleJa:
          '夏に向けた骨盤＋ボディメイクの3ヶ月コースを、週ごとの通院設計と価格案つきで作成してください',
      },
    ],
  },
  esthetic_salon: {
    label: 'Esthetic Salon',
    labelJa: 'エステサロン',
    tagline:
      'Facial + body care. AI tuned for skin condition tracking, seasonal flare patterns, and product fit.',
    taglineJa:
      'フェイシャル・ボディケアに対応。肌状態の記録、季節ごとの肌トラブル、製品の相性にAIを最適化しています。',
    priorityTopics: 12,
    coachingFocus: 5,
    topPatterns: 7,
    consultationPrompts: 10,
    consultationQuestions: [
      {
        id: 'es-customer',
        category: 'Customer',
        title: 'Sensitive-skin alerts',
        titleJa: '敏感肌の注意が必要なお客様',
        preview: 'Customers whose recent karute flagged sensitivity or flare-ups',
        previewJa: '直近のカルテで敏感肌や肌トラブルが記録されたお客様',
        example:
          'List customers who have flagged sensitive-skin or seasonal flare-ups in recent karute and propose a product/timing adjustment for each',
        exampleJa:
          '直近のカルテで敏感肌や季節性の肌トラブルが記録されたお客様を一覧にして、それぞれに製品や施術タイミングの調整案を提案してください',
      },
      {
        id: 'es-analysis',
        category: 'Analysis',
        title: 'Course completion rate',
        titleJa: 'コース完了率',
        preview: '% who completed their 5-session course vs dropped mid-way',
        previewJa: '全5回コースを完了したお客様と途中離脱の割合',
        example:
          'Analyze 5-session course completion rate over the last 90 days and identify drop-off patterns',
        exampleJa:
          '直近90日間の全5回コースの完了率を分析し、途中離脱の傾向を明らかにしてください',
      },
      {
        id: 'es-strategy',
        category: 'Strategy',
        title: 'Seasonal flare campaign',
        titleJa: '季節性トラブル向けキャンペーン',
        preview: 'Pollen / dryness moisture-boost plan for the next 6 weeks',
        previewJa: '花粉・乾燥に向けた今後6週間の保湿強化プラン',
        example:
          'Draft a 6-week seasonal-flare moisture-boost plan targeting customers with pollen or dryness concerns',
        exampleJa:
          '花粉や乾燥の悩みがあるお客様に向けて、今後6週間の保湿強化キャンペーンを作成してください',
      },
    ],
  },
  hair_salon: {
    label: 'Hair Salon',
    labelJa: 'ヘアサロン',
    tagline:
      'Cut, color, treatment. AI tuned for style preferences, hair health, and seasonal regrowth patterns.',
    taglineJa:
      'カット・カラー・トリートメントに対応。スタイルの好み、髪の健康、季節ごとの伸び方にAIを最適化しています。',
    priorityTopics: 11,
    coachingFocus: 4,
    topPatterns: 6,
    consultationPrompts: 9,
    consultationQuestions: [
      {
        id: 'hs-customer',
        category: 'Customer',
        title: 'Color-fade follow-up',
        titleJa: 'カラー退色フォロー',
        preview: 'Customers missing rebook after their last color treatment',
        previewJa: '前回のカラー後、再予約のないお客様',
        example:
          'List customers who had a color treatment in the past 6-8 weeks but no rebook on the books, with a draft message for each',
        exampleJa:
          '6〜8週間前にカラーをされたが次の予約が入っていないお客様を一覧にして、それぞれにメッセージ案を作成してください',
      },
      {
        id: 'hs-analysis',
        category: 'Analysis',
        title: 'Retail sales stagnation',
        titleJa: '店販の伸び悩み',
        preview: 'Why product attach rate is flat — by service category and staff',
        previewJa: '店販の付帯率が伸びない要因をメニュー別・スタッフ別に',
        example:
          'Analyze why retail product attach rate has been flat and break it down by service category and staff',
        exampleJa:
          '店販商品の付帯率が伸び悩んでいる要因を分析し、メニュー別・スタッフ別に整理してください',
      },
      {
        id: 'hs-strategy',
        category: 'Strategy',
        title: 'Rainy-season humidity care',
        titleJa: '梅雨の湿気ケア',
        preview: 'June campaign for frizz-prone customers',
        previewJa: '広がり・うねりが気になるお客様向けの6月キャンペーン',
        example:
          'Draft a June humidity-care campaign targeting customers with frizz or anti-humidity concerns in recent karute',
        exampleJa:
          '直近のカルテで広がりや湿気の悩みが記録されたお客様に向けて、6月の湿気ケアキャンペーンを作成してください',
      },
    ],
  },
  massage: {
    label: 'Massage',
    labelJa: 'リラクゼーション・マッサージ',
    tagline:
      'Body tension and recovery. AI tuned for chronic pain patterns and posture / activity correlations.',
    taglineJa:
      '体のこり・疲労回復に対応。慢性的な痛みの傾向や、姿勢・活動との関係にAIを最適化しています。',
    priorityTopics: 10,
    coachingFocus: 5,
    topPatterns: 6,
    consultationPrompts: 8,
    consultationQuestions: GENERIC_CONSULTATION_QUESTIONS,
  },
  dermatology: {
    label: 'Dermatology',
    labelJa: '皮膚科クリニック',
    tagline:
      'Clinical skin care. AI tuned for diagnosis tracking, prescription history, and treatment response.',
    taglineJa:
      '臨床的なスキンケアに対応。診断の記録、処方履歴、治療への反応にAIを最適化しています。',
    priorityTopics: 16,
    coachingFocus: 7,
    topPatterns: 10,
    consultationPrompts: 14,
    consultationQuestions: GENERIC_CONSULTATION_QUESTIONS,
  },
}

const DEFAULT_PROFILE: BusinessProfileSource = {
  label: 'General',
  labelJa: '一般',
  tagline:
    'AI tuned to general consultation patterns. Pick a more specific type if your business has specialized terminology.',
  taglineJa:
    '一般的な相談内容にAIを最適化しています。専門的な用語を使う業種の場合は、より具体的な業種を選んでください。',
  priorityTopics: 8,
  coachingFocus: 3,
  topPatterns: 5,
  consultationPrompts: 6,
  consultationQuestions: GENERIC_CONSULTATION_QUESTIONS,
}

function resolveQuestion(
  q: ConsultationQuestionSource,
  locale: 'en' | 'ja',
): ConsultationQuestion {
  const ja = locale === 'ja'
  return {
    id: q.id,
    category: q.category,
    title: ja ? q.titleJa : q.title,
    preview: ja ? q.previewJa : q.preview,
    example: ja ? q.exampleJa : q.example,
  }
}

function resolveProfile(
  p: BusinessProfileSource,
  locale: 'en' | 'ja',
): BusinessProfile {
  const ja = locale === 'ja'
  return {
    label: ja ? p.labelJa : p.label,
    tagline: ja ? p.taglineJa : p.tagline,
    priorityTopics: p.priorityTopics,
    coachingFocus: p.coachingFocus,
    topPatterns: p.topPatterns,
    consultationPrompts: p.consultationPrompts,
    consultationQuestions: p.consultationQuestions?.map((q) =>
      resolveQuestion(q, locale),
    ),
  }
}

function getProfileSource(value: string | null | undefined): BusinessProfileSource {
  if (!value) return DEFAULT_PROFILE
  return BUSINESS_TYPE_PROFILES[value] ?? DEFAULT_PROFILE
}

export function getConsultationQuestions(
  businessType: string | null | undefined,
  locale: 'en' | 'ja' = 'en',
): ConsultationQuestion[] {
  const source = getProfileSource(businessType).consultationQuestions ??
    GENERIC_CONSULTATION_QUESTIONS
  return source.map((q) => resolveQuestion(q, locale))
}

export function getBusinessProfile(
  value: string | null | undefined,
  locale: 'en' | 'ja' = 'en',
): BusinessProfile {
  return resolveProfile(getProfileSource(value), locale)
}

export interface DisclosureMode {
  mode: 'A' | 'B' | 'C'
  label: string
  summary: string
  description: string
  recommendedFor: string
}

export const DISCLOSURE_MODES: DisclosureMode[] = [
  {
    mode: 'A',
    label: 'Discreet (seamless)',
    summary: 'Records automatically at session start. No customer-facing popup.',
    description:
      'The legally permitted default in Japan. Customers see no popup; APPI compliance is satisfied by the purpose-of-use disclosed in your privacy policy. Only staff see a subtle recording indicator. Requires that your privacy policy already discloses AI recording.',
    recommendedFor: 'Salons prioritizing seamless UX',
  },
  {
    mode: 'B',
    label: 'Verbal disclosure (recommended)',
    summary: 'Before the first recording with a new customer, staff mentions it verbally.',
    description:
      'Staff say something like "today\'s consultation will be AI-assisted." A suggested script appears for staff. If the customer objects, recording can be disabled for that session.',
    recommendedFor: 'Salons that value transparency',
  },
  {
    mode: 'C',
    label: 'Explicit consent (highest trust)',
    summary:
      'First visit: tablet consent screen. Subsequent visits auto-apply the stored consent.',
    description:
      'On first visit, the customer sees a tablet screen explaining AI support with accept / decline. Consent is stored on the customer record and auto-applied on future visits.',
    recommendedFor: 'Recommended for medical / clinical (dermatology, chiro, dental)',
  },
]
