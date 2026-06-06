// Business-type AI persona tokens — ported VERBATIM from the design spike
// (synqed-karute-design-spike/src/mock/business-type-profiles.ts,
// interface ProfilePromptPersona). These are what make every AI surface adapt
// per business type: a 整体 brief talks 姿勢・骨盤, a gym brief talks 可動域・体組成,
// a dental brief talks う蝕・歯ぎしり. Karute's existing getBusinessProfile is a
// thin stub (label + counts only) — these are the rich tokens the AI needs.
//
// Coverage: the common types + La Estro's (esthetic / beauty-chiropractic).
// Anything not listed falls back to DEFAULT_PERSONA (a neutral wellness posture)
// so the brief never breaks — additional types can be filled in over time.

export type ClinicalPosture = 'clinical' | 'wellness' | 'service'

export interface BusinessAiPersona {
  roleJa: string
  roleEn: string
  businessNounJa: string
  businessNounEn: string
  primaryFocusJa: string
  primaryFocusEn: string
  seasonalRelevance: 'high' | 'medium' | 'low'
  clinicalPosture: ClinicalPosture
  typicalConcernsJa: string[]
  typicalConcernsEn: string[]
}

const PERSONAS: Record<string, BusinessAiPersona> = {
  esthetic_salon: {
    roleJa: 'エステティシャン',
    roleEn: 'aesthetician',
    businessNounJa: 'エステサロン',
    businessNounEn: 'esthetic salon',
    primaryFocusJa: '肌コンディション・ボディトリートメント・季節別のスキンケア戦略',
    primaryFocusEn: 'skin condition, body treatment, and seasonal skincare strategy',
    seasonalRelevance: 'high',
    clinicalPosture: 'service',
    typicalConcernsJa: ['花粉季の頬の乾燥', 'UVダメージの回復', '生理周期によるホルモン的な変化'],
    typicalConcernsEn: ['cheek dryness in pollen season', 'UV damage recovery', 'menstrual-cycle hormonal patterns'],
  },
  beauty_chiropractic: {
    roleJa: '美容整体師',
    roleEn: 'beauty-chiropractic therapist',
    businessNounJa: '美容整体院',
    businessNounEn: 'beauty-chiropractic studio',
    primaryFocusJa: '体のアライメントと美容的な変化（小顔・姿勢美・骨盤矯正）',
    primaryFocusEn: 'body alignment and aesthetic outcomes (小顔 / 姿勢美 / 骨盤)',
    seasonalRelevance: 'medium',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['顔の左右差の追跡', 'シルエットに表れる骨盤のゆがみ', '維持を阻む姿勢習慣'],
    typicalConcernsEn: ['facial asymmetry tracking', 'pelvic misalignment visible in silhouette', 'posture habits that block maintenance'],
  },
  chiropractic: {
    roleJa: 'カイロプラクター',
    roleEn: 'chiropractor',
    businessNounJa: '整体院',
    businessNounEn: 'chiropractic clinic',
    primaryFocusJa: '背骨のアライメント・姿勢バランス・動作の回復',
    primaryFocusEn: 'spinal alignment, postural balance, and movement recovery',
    seasonalRelevance: 'low',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['PC作業による頚椎のゆがみ', '骨盤の回旋パターン', '一時的なこわばり vs 構造的な変化'],
    typicalConcernsEn: ['cervical misalignment from screen time', 'pelvic rotation patterns', 'recurring stiffness vs. structural changes'],
  },
  massage: {
    roleJa: 'マッサージセラピスト',
    roleEn: 'massage therapist',
    businessNounJa: 'マッサージ店',
    businessNounEn: 'massage studio',
    primaryFocusJa: '筋肉の緊張パターンとリラクゼーション効果',
    primaryFocusEn: 'muscle tension patterns and relaxation outcomes',
    seasonalRelevance: 'low',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['慢性的な肩の張り', 'デスクワークによる腰の疲労', '施術後の睡眠の質'],
    typicalConcernsEn: ['chronic shoulder tension', 'lower-back fatigue from desk work', 'sleep quality after sessions'],
  },
  personal_gym: {
    roleJa: 'パーソナルトレーナー',
    roleEn: 'personal trainer',
    businessNounJa: 'パーソナルジム',
    businessNounEn: 'personal training gym',
    primaryFocusJa: '筋力の進捗・コンディショニング・体組成の目標',
    primaryFocusEn: 'strength progression, conditioning, and body-composition goals',
    seasonalRelevance: 'low',
    clinicalPosture: 'service',
    typicalConcernsJa: ['スクワットの深さの制限', 'オーバーヘッド動作を妨げる肩の可動域', 'セッション間の減量の継続'],
    typicalConcernsEn: ['squat depth limitation', 'shoulder mobility restricting overhead work', 'weight-cut adherence between sessions'],
  },
  dental_clinic: {
    roleJa: '歯科医',
    roleEn: 'dentist',
    businessNounJa: '歯科医院',
    businessNounEn: 'dental clinic',
    primaryFocusJa: '口腔健康・治療履歴・治療計画・審美',
    primaryFocusEn: 'oral health, dental history, treatment planning, and aesthetics',
    seasonalRelevance: 'low',
    clinicalPosture: 'clinical',
    typicalConcernsJa: ['特定の歯の繰り返し発生するう蝕', '歯ぎしりの兆候', '特定処置への不安のパターン'],
    typicalConcernsEn: ['recurring decay in specific tooth positions', 'bruxism signs', 'anxiety patterns for specific procedures'],
  },
  medical_clinic: {
    roleJa: '医師',
    roleEn: 'physician',
    businessNounJa: '医療クリニック',
    businessNounEn: 'medical clinic',
    primaryFocusJa: '医学的評価・治療反応・長期的な健康管理',
    primaryFocusEn: 'medical assessment, treatment response, and longitudinal health',
    seasonalRelevance: 'medium',
    clinicalPosture: 'clinical',
    typicalConcernsJa: ['服薬アドヒアランスと副作用', '慢性疾患の安定性', '季節による疾患の悪化'],
    typicalConcernsEn: ['medication adherence and side effects', 'chronic condition stability', 'seasonal condition exacerbations'],
  },
  hair_salon: {
    roleJa: 'スタイリスト',
    roleEn: 'stylist',
    businessNounJa: '美容室',
    businessNounEn: 'hair salon',
    primaryFocusJa: '髪のコンディション・スタイリング・再来サイクル',
    primaryFocusEn: 'hair condition, styling, and rebooking rhythm',
    seasonalRelevance: 'medium',
    clinicalPosture: 'service',
    typicalConcernsJa: ['カラーの色持ち', '熱によるダメージ', '季節による頭皮の変化'],
    typicalConcernsEn: ['color fading between visits', 'damage from heat styling', 'scalp sensitivity changes with season'],
  },
  nail_salon: {
    roleJa: 'ネイリスト',
    roleEn: 'nail technician',
    businessNounJa: 'ネイルサロン',
    businessNounEn: 'nail salon',
    primaryFocusJa: '爪のケア・デザインの好み・爪の健康履歴',
    primaryFocusEn: 'nail care, design preferences, and nail-health history',
    seasonalRelevance: 'medium',
    clinicalPosture: 'service',
    typicalConcernsJa: ['爪の割れ・欠け', '甘皮部分の浮き', 'ライフスタイル（PC作業・育児・スポーツ）の影響'],
    typicalConcernsEn: ['brittleness or splitting', 'lift at the cuticle', 'lifestyle impact (typing, childcare, sports)'],
  },
}

// Neutral wellness fallback — used for any business type not yet profiled, so the
// brief always renders (never breaks on an unknown type).
const DEFAULT_PERSONA: BusinessAiPersona = {
  roleJa: '担当者',
  roleEn: 'staff member',
  businessNounJa: '店舗',
  businessNounEn: 'business',
  primaryFocusJa: 'お客様の状態・ご要望・経過',
  primaryFocusEn: "the customer's condition, goals, and progress",
  seasonalRelevance: 'medium',
  clinicalPosture: 'wellness',
  typicalConcernsJa: [],
  typicalConcernsEn: [],
}

export function getBusinessAiPersona(
  businessType: string | null | undefined,
): BusinessAiPersona {
  if (!businessType) return DEFAULT_PERSONA
  return PERSONAS[businessType] ?? DEFAULT_PERSONA
}

/** Locale-resolved tokens ready to inject into a prompt template. */
export function resolvePersonaTokens(
  persona: BusinessAiPersona,
  locale: string,
): {
  role: string
  businessNoun: string
  primaryFocus: string
  clinicalPosture: ClinicalPosture
  seasonalRelevance: string
  typicalConcerns: string
} {
  const ja = locale === 'ja'
  const concerns = ja ? persona.typicalConcernsJa : persona.typicalConcernsEn
  return {
    role: ja ? persona.roleJa : persona.roleEn,
    businessNoun: ja ? persona.businessNounJa : persona.businessNounEn,
    primaryFocus: ja ? persona.primaryFocusJa : persona.primaryFocusEn,
    clinicalPosture: persona.clinicalPosture,
    seasonalRelevance: persona.seasonalRelevance,
    typicalConcerns: concerns.join(ja ? '、' : ', '),
  }
}

/** One-line guardrail copy keyed to the clinical posture (mirrors the spike). */
export function clinicalGuardrail(
  posture: ClinicalPosture,
  locale: string,
): string {
  const ja = locale === 'ja'
  switch (posture) {
    case 'clinical':
      return ja
        ? '医療的表現は可。ただし診断的判断は担当者に委ねること。'
        : 'Clinical language is OK, but defer diagnostic interpretation to the practitioner.'
    case 'wellness':
      return ja
        ? 'ウェルネスの言葉で。医療的な診断・断定は避けること。'
        : 'Use wellness language; avoid medical diagnosis or definitive medical claims.'
    case 'service':
      return ja
        ? '医療的な表現は使わず、サービス・美容の言葉で。'
        : 'No medical framing; use service / aesthetic vocabulary only.'
  }
}
