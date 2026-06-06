// Business-type AI persona tokens — ported VERBATIM from the design spike
// (synqed-karute-design-spike/src/mock/business-type-profiles.ts, the
// ProfilePromptPersona of each profile). These are what make every AI surface
// adapt per business type: a 整体 brief talks 姿勢・骨盤, a gym 可動域/体組成, a
// dental clinic う蝕/歯ぎしり, a pet groomer 被毛/犬種. Karute's getBusinessProfile
// is a thin stub (label + counts); these are the rich tokens the AI needs.
//
// FULL COVERAGE: every value in BUSINESS_TYPES (src/lib/welcome/business-types.ts)
// has a persona here. Unknown types fall back to the neutral 'other' persona.

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
    roleJa: 'エステティシャン', roleEn: 'aesthetician',
    businessNounJa: 'エステサロン', businessNounEn: 'esthetic salon',
    primaryFocusJa: '肌コンディション・ボディトリートメント・季節別のスキンケア戦略',
    primaryFocusEn: 'skin condition, body treatment, and seasonal skincare strategy',
    seasonalRelevance: 'high', clinicalPosture: 'service',
    typicalConcernsJa: ['花粉季の頬の乾燥', 'UVダメージの回復', '生理周期によるホルモン的な変化'],
    typicalConcernsEn: ['cheek dryness in pollen season', 'UV damage recovery', 'menstrual-cycle hormonal patterns'],
  },
  hair_salon: {
    roleJa: 'スタイリスト', roleEn: 'stylist',
    businessNounJa: '美容室', businessNounEn: 'hair salon',
    primaryFocusJa: '髪のコンディション・スタイリング・再来サイクル',
    primaryFocusEn: 'hair condition, styling, and rebooking rhythm',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['カラーの色持ち', '熱によるダメージ', '季節による頭皮の変化'],
    typicalConcernsEn: ['color fading between visits', 'damage from heat styling', 'scalp sensitivity changes with season'],
  },
  nail_salon: {
    roleJa: 'ネイリスト', roleEn: 'nail technician',
    businessNounJa: 'ネイルサロン', businessNounEn: 'nail salon',
    primaryFocusJa: '爪のケア・デザインの好み・爪の健康履歴',
    primaryFocusEn: 'nail care, design preferences, and nail-health history',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['爪の割れ・欠け', '甘皮部分の浮き', 'ライフスタイル（PC作業・育児・スポーツ）の影響'],
    typicalConcernsEn: ['brittleness or splitting', 'lift at the cuticle', 'lifestyle impact (typing, childcare, sports)'],
  },
  eyelash_salon: {
    roleJa: 'アイリスト', roleEn: 'eyelash technician',
    businessNounJa: 'まつげサロン', businessNounEn: 'eyelash salon',
    primaryFocusJa: 'まつげの健康・カールの持ち・リピートサイクル',
    primaryFocusEn: 'lash health, curl retention, and repeat cycle',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['持ちの低下', 'グルーへの感度', '自まつげの弱り'],
    typicalConcernsEn: ['retention dropping mid-cycle', 'sensitivity to glue', 'natural lash thinning'],
  },
  massage: {
    roleJa: 'マッサージセラピスト', roleEn: 'massage therapist',
    businessNounJa: 'マッサージ店', businessNounEn: 'massage studio',
    primaryFocusJa: '筋肉の緊張パターンとリラクゼーション効果',
    primaryFocusEn: 'muscle tension patterns and relaxation outcomes',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['慢性的な肩の張り', 'デスクワークによる腰の疲労', '施術後の睡眠の質'],
    typicalConcernsEn: ['chronic shoulder tension', 'lower-back fatigue from desk work', 'sleep quality after sessions'],
  },
  chiropractic: {
    roleJa: 'カイロプラクター', roleEn: 'chiropractor',
    businessNounJa: '整体院', businessNounEn: 'chiropractic clinic',
    primaryFocusJa: '背骨のアライメント・姿勢バランス・動作の回復',
    primaryFocusEn: 'spinal alignment, postural balance, and movement recovery',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['PC作業による頚椎のゆがみ', '骨盤の回旋パターン', '一時的なこわばり vs 構造的な変化'],
    typicalConcernsEn: ['cervical misalignment from screen time', 'pelvic rotation patterns', 'recurring stiffness vs. structural changes'],
  },
  beauty_chiropractic: {
    roleJa: '美容整体師', roleEn: 'beauty-chiropractic therapist',
    businessNounJa: '美容整体院', businessNounEn: 'beauty-chiropractic studio',
    primaryFocusJa: '体のアライメントと美容的な変化（小顔・姿勢美・骨盤矯正）',
    primaryFocusEn: 'body alignment and aesthetic outcomes (小顔 / 姿勢美 / 骨盤)',
    seasonalRelevance: 'medium', clinicalPosture: 'wellness',
    typicalConcernsJa: ['顔の左右差の追跡', 'シルエットに表れる骨盤のゆがみ', '維持を阻む姿勢習慣'],
    typicalConcernsEn: ['facial asymmetry tracking', 'pelvic misalignment visible in silhouette', 'posture habits that block maintenance'],
  },
  acupuncture: {
    roleJa: '鍼灸師', roleEn: 'acupuncturist',
    businessNounJa: '鍼灸院', businessNounEn: 'acupuncture clinic',
    primaryFocusJa: '経絡のバランス・症状の緩和・体質的傾向',
    primaryFocusEn: 'meridian balance, symptom relief, and constitutional patterns',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['繰り返す頭痛のパターン', '冷え・のぼせのバランス', '生理・消化の不調'],
    typicalConcernsEn: ['recurring headache patterns', 'cold/heat imbalance in extremities', 'menstrual or digestive irregularities'],
  },
  osteopathy: {
    roleJa: '柔道整復師', roleEn: 'osteopath (judo therapist)',
    businessNounJa: '整骨院', businessNounEn: 'osteopathic clinic',
    primaryFocusJa: '筋骨格系の回復・外傷のリハビリ・急性期のケア',
    primaryFocusEn: 'musculoskeletal recovery, injury rehabilitation, and acute care',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['外傷後の可動域の回復', '慢性的な代償パターン', '競技・日常活動への復帰タイミング'],
    typicalConcernsEn: ['post-injury range-of-motion recovery', 'chronic strain compensation patterns', 'return-to-activity timing'],
  },
  yoga_studio: {
    roleJa: 'ヨガインストラクター', roleEn: 'yoga instructor',
    businessNounJa: 'ヨガスタジオ', businessNounEn: 'yoga studio',
    primaryFocusJa: '姿勢・柔軟性・呼吸法・練習の進歩',
    primaryFocusEn: 'posture, flexibility, breathwork, and practice progression',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['前屈を制限するハムストリングの硬さ', '逆転系ポーズへの不安', '呼吸と動きの連動'],
    typicalConcernsEn: ['hamstring tightness limiting forward folds', 'inversion anxiety', 'breath-movement coordination'],
  },
  pilates_studio: {
    roleJa: 'ピラティスインストラクター', roleEn: 'pilates instructor',
    businessNounJa: 'ピラティススタジオ', businessNounEn: 'pilates studio',
    primaryFocusJa: 'コアの安定性・アライメント・コントロールされた動きを通じたボディアウェアネス',
    primaryFocusEn: 'core stability, alignment, and body awareness through controlled movement',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['フットワーク中の骨盤の安定', 'プランクでの肩の使い方', 'リフォーマーから日常姿勢への応用'],
    typicalConcernsEn: ['pelvic stability during footwork', 'shoulder engagement in plank', 'carry-over from reformer to daily posture'],
  },
  personal_gym: {
    roleJa: 'パーソナルトレーナー', roleEn: 'personal trainer',
    businessNounJa: 'パーソナルジム', businessNounEn: 'personal training gym',
    primaryFocusJa: '筋力の進捗・コンディショニング・体組成の目標',
    primaryFocusEn: 'strength progression, conditioning, and body-composition goals',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['スクワットの深さの制限', 'オーバーヘッド動作を妨げる肩の可動域', 'セッション間の減量の継続'],
    typicalConcernsEn: ['squat depth limitation', 'shoulder mobility restricting overhead work', 'weight-cut adherence between sessions'],
  },
  dental_clinic: {
    roleJa: '歯科医', roleEn: 'dentist',
    businessNounJa: '歯科医院', businessNounEn: 'dental clinic',
    primaryFocusJa: '口腔健康・治療履歴・治療計画・審美',
    primaryFocusEn: 'oral health, dental history, treatment planning, and aesthetics',
    seasonalRelevance: 'low', clinicalPosture: 'clinical',
    typicalConcernsJa: ['特定の歯の繰り返し発生するう蝕', '歯ぎしりの兆候', '特定処置への不安のパターン'],
    typicalConcernsEn: ['recurring decay in specific tooth positions', 'bruxism signs', 'anxiety patterns for specific procedures'],
  },
  medical_clinic: {
    roleJa: '医師', roleEn: 'physician',
    businessNounJa: '医療クリニック', businessNounEn: 'medical clinic',
    primaryFocusJa: '医学的評価・治療反応・長期的な健康管理',
    primaryFocusEn: 'medical assessment, treatment response, and longitudinal health',
    seasonalRelevance: 'medium', clinicalPosture: 'clinical',
    typicalConcernsJa: ['服薬アドヒアランスと副作用', '慢性疾患の安定性', '季節による疾患の悪化'],
    typicalConcernsEn: ['medication adherence and side effects', 'chronic condition stability', 'seasonal condition exacerbations'],
  },
  dermatology: {
    roleJa: '皮膚科医', roleEn: 'dermatologist',
    businessNounJa: '皮膚科クリニック', businessNounEn: 'dermatology clinic',
    primaryFocusJa: '皮膚の健康・臨床的な皮膚疾患・治療反応の追跡',
    primaryFocusEn: 'skin health, clinical skin conditions, and treatment response tracking',
    seasonalRelevance: 'high', clinicalPosture: 'clinical',
    typicalConcernsJa: ['アトピー性皮膚炎の季節的悪化', 'ニキビ治療への反応', '紫外線ダメージの進行'],
    typicalConcernsEn: ['atopic dermatitis seasonal flares', 'acne treatment response', 'sun-damage progression'],
  },
  cosmetic_surgery: {
    roleJa: '美容外科医', roleEn: 'cosmetic surgeon',
    businessNounJa: '美容クリニック', businessNounEn: 'cosmetic surgery clinic',
    primaryFocusJa: '美容医療処置・回復の経過・審美的な結果',
    primaryFocusEn: 'cosmetic medical procedures, recovery tracking, and aesthetic outcomes',
    seasonalRelevance: 'medium', clinicalPosture: 'clinical',
    typicalConcernsJa: ['処置後の回復のマイルストーン', '期待 vs 実際の結果の追跡', '活動再開のタイミング'],
    typicalConcernsEn: ['post-procedure recovery milestones', 'expected-vs-actual outcome tracking', 'return-to-activity timeline'],
  },
  physical_therapy: {
    roleJa: '理学療法士', roleEn: 'physical therapist',
    businessNounJa: '理学療法室', businessNounEn: 'physical therapy clinic',
    primaryFocusJa: 'リハビリの進捗・機能的動作・活動復帰',
    primaryFocusEn: 'rehabilitation progression, functional movement, and return-to-activity',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['可動域のマイルストーン', '疼痛と動作の相関追跡', '自主トレの継続'],
    typicalConcernsEn: ['range-of-motion milestones', 'pain-movement correlation tracking', 'home-exercise adherence'],
  },
  foot_care: {
    roleJa: 'フットケアセラピスト', roleEn: 'foot care therapist',
    businessNounJa: 'フットケアサロン', businessNounEn: 'foot care studio',
    primaryFocusJa: '足の健康・リフレクソロジーの効果・歩行に関わる悩み',
    primaryFocusEn: 'foot health, reflexology outcomes, and gait-related concerns',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['立ち仕事による足裏の疲労', 'タコ・爪のトラブルのサイクル', 'アーチサポートの効果'],
    typicalConcernsEn: ['plantar fatigue from standing work', 'callus/nail issues cycle', 'arch support effectiveness'],
  },
  relaxation: {
    roleJa: 'リラクゼーションセラピスト', roleEn: 'relaxation therapist',
    businessNounJa: 'リラクゼーションサロン', businessNounEn: 'relaxation salon',
    primaryFocusJa: 'ストレス緩和・全身リラクゼーション・お客様の心地よさ',
    primaryFocusEn: 'stress relief, full-body relaxation, and customer comfort',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['仕事由来のストレスパターン', '施術を重ねた睡眠の改善', '好みの圧・音楽'],
    typicalConcernsEn: ['workplace stress patterns', 'sleep improvement session-over-session', 'preferred pressure and music'],
  },
  aroma: {
    roleJa: 'アロマセラピスト', roleEn: 'aromatherapist',
    businessNounJa: 'アロマサロン', businessNounEn: 'aromatherapy salon',
    primaryFocusJa: '香りの好みとウェルネスへの反応パターン',
    primaryFocusEn: 'scent-profile preferences and wellness response patterns',
    seasonalRelevance: 'medium', clinicalPosture: 'wellness',
    typicalConcernsJa: ['香りへの感度の変化', 'セッションごとのストレス反応の変化', '施術後の睡眠の質'],
    typicalConcernsEn: ['scent sensitivity changes', 'stress-response patterns session-over-session', 'sleep quality after sessions'],
  },
  wellness_clinic: {
    roleJa: 'ウェルネス専門家', roleEn: 'wellness practitioner',
    businessNounJa: 'ウェルネスクリニック', businessNounEn: 'wellness clinic',
    primaryFocusJa: 'ホリスティック健康・予防ウェルネス・統合的なプロトコル',
    primaryFocusEn: 'holistic health, preventive wellness, and integrative protocols',
    seasonalRelevance: 'medium', clinicalPosture: 'wellness',
    typicalConcernsJa: ['生活習慣由来の疲労パターン', '予防指標のトレンド', '目標に対する栄養コンプライアンス'],
    typicalConcernsEn: ['lifestyle-driven fatigue patterns', 'preventive markers trending', 'nutrition-adherence alignment with goals'],
  },
  mental_health: {
    roleJa: 'カウンセラー', roleEn: 'counselor',
    businessNounJa: 'カウンセリングルーム', businessNounEn: 'counseling practice',
    primaryFocusJa: '情緒的ウェルビーイング・メンタルヘルスの進捗・治療同盟',
    primaryFocusEn: 'emotional wellbeing, mental health progress, and therapeutic alliance',
    seasonalRelevance: 'low', clinicalPosture: 'clinical',
    typicalConcernsJa: ['セッション間の気分の変化', '対処スキルの有効性', '治療目標の進捗'],
    typicalConcernsEn: ['mood tracking across sessions', 'coping-strategy effectiveness', 'therapeutic-goal progression'],
  },
  veterinary: {
    roleJa: '獣医師', roleEn: 'veterinarian',
    businessNounJa: '動物病院', businessNounEn: 'veterinary clinic',
    primaryFocusJa: '動物の健康・種/品種別のケア・予防医療',
    primaryFocusEn: 'animal health, species/breed-specific care, and preventive medicine',
    seasonalRelevance: 'medium', clinicalPosture: 'clinical',
    typicalConcernsJa: ['ワクチン・予防薬スケジュールの遵守', '品種特異的疾患のモニタリング', '食事・体重管理の進捗'],
    typicalConcernsEn: ['vaccination/parasite schedule adherence', 'breed-predisposed condition monitoring', 'diet/weight-management progress'],
  },
  pet_grooming: {
    roleJa: 'トリマー', roleEn: 'pet groomer',
    businessNounJa: 'ペットグルーミングサロン', businessNounEn: 'pet grooming salon',
    primaryFocusJa: 'ペットの被毛コンディション・犬種/猫種別のケア・グルーミングスケジュール',
    primaryFocusEn: 'pet coat condition, breed-specific care, and grooming schedule',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['季節ごとの抜け毛パターン', '特定の製品による皮膚の刺激', '特定のツールへの慣れ具合'],
    typicalConcernsEn: ['shedding patterns by season', 'skin irritation from specific products', 'behavioral comfort with specific tools'],
  },
  training_school: {
    roleJa: '講師', roleEn: 'instructor',
    businessNounJa: 'スクール', businessNounEn: 'training school',
    primaryFocusJa: 'スキルの発達・生徒の進捗・学習成果',
    primaryFocusEn: 'skill development, student progression, and learning outcomes',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['スキルレベルのマイルストーン達成', 'セッション間のエンゲージメント', '自主練習の継続性'],
    typicalConcernsEn: ['skill-level milestone progression', 'engagement patterns between sessions', 'home-practice consistency'],
  },
  other: {
    roleJa: '担当者', roleEn: 'specialist',
    businessNounJa: '施設', businessNounEn: 'practice',
    primaryFocusJa: 'お客様のケア成果とサービスの進行',
    primaryFocusEn: 'customer care outcomes and service progression',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['目標達成への進捗', 'セッションごとの満足度', 'お客様の好みの継続性'],
    typicalConcernsEn: ['progression toward stated goals', 'session-over-session comfort', 'continuity of preferences'],
  },
}

// Unknown / unset business type → the neutral 'other' persona (never esthetic-leaks).
const DEFAULT_PERSONA: BusinessAiPersona = PERSONAS.other

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

/**
 * A ready-to-prepend system-prompt fragment that pins ANY AI surface to this
 * business's persona + vocabulary. Use it everywhere an LLM generates
 * business-flavored text (insights, chat, advice, suggestions, …) so a gym never
 * gets hairdresser vocabulary. Resolves to the neutral persona for unknown types.
 */
export function personaSystemFragment(
  businessType: string | null | undefined,
  locale: string,
): string {
  const tok = resolvePersonaTokens(getBusinessAiPersona(businessType), locale)
  if (locale === 'ja') {
    return `あなたは${tok.businessNoun}の${tok.role}を支援するAIです。主に「${tok.primaryFocus}」に注目し、この業種の語彙だけを使うこと（他業種の言葉「施術」等を当てはめない）。${
      tok.typicalConcerns ? `よくある関心: ${tok.typicalConcerns}。` : ''
    }${clinicalGuardrail(tok.clinicalPosture, locale)}`
  }
  return `You assist the ${tok.role} at a ${tok.businessNoun}. Focus on ${tok.primaryFocus}, and use ONLY this business's vocabulary (never borrow another industry's terms).${
    tok.typicalConcerns ? ` Common concerns: ${tok.typicalConcerns}.` : ''
  } ${clinicalGuardrail(tok.clinicalPosture, locale)}`
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
