// ─────────────────────────────────────────────────────────────────────────────
// Business-type persona — the per-vertical vocabulary every karute AI prompt
// injects. Ported from the spike's `src/mock/business-type-profiles.ts`
// (the `promptPersona` contract in AI_PROMPTS.md → "Prompt parameterization").
//
// WHY: the extraction prompt was generic ("beauty/wellness provider"), so a 美容整体
// session collapsed to topic labels ("首の痛み"). The spike's forever-rule: every
// prompt adapts to business type, or "chiropractic clinics get outputs that sound
// like esthetic salons — which kills the 'built for THIS salon' wedge." This is
// the compact subset the EXTRACTION prompt needs (role / focus / clinicalPosture /
// typical concerns). Account `business_type` (org-settings) selects the persona.
//
// clinicalPosture drives the medical-language guardrail:
//   clinical  — dental/medical/dermatology: "not a doctor, never diagnose".
//   wellness  — chiro/PT/acupuncture/massage: soft clinical care, gentle referrals.
//   service   — hair/nail/esthetic/yoga/gym: no medical framing; lifestyle + progression.
// ─────────────────────────────────────────────────────────────────────────────

export type ClinicalPosture = 'clinical' | 'wellness' | 'service'

export interface BusinessPersona {
  roleJa: string
  roleEn: string
  businessNounJa: string
  businessNounEn: string
  /** One phrase: what the business primarily deals with. Drives analytic focus. */
  primaryFocusJa: string
  primaryFocusEn: string
  clinicalPosture: ClinicalPosture
  /** 2–3 concrete, industry-typical concerns. Used as examples (not made-up ones). */
  typicalConcernsJa: string[]
  typicalConcernsEn: string[]
}

const GENERIC: BusinessPersona = {
  roleJa: 'スタッフ',
  roleEn: 'practitioner',
  businessNounJa: 'サロン・店舗',
  businessNounEn: 'salon / clinic',
  primaryFocusJa: 'お客様のケアと施術、継続的な変化',
  primaryFocusEn: 'client care, treatment, and progress over time',
  clinicalPosture: 'service',
  typicalConcernsJa: ['お客様の主な悩み', '今回の対応と反応', '次回への引き継ぎ事項'],
  typicalConcernsEn: ['the client\'s main concern', 'what was done and the response', 'what to carry into the next visit'],
}

// Keyed by the `business_type` values in src/lib/welcome/business-types.ts.
const PERSONAS: Record<string, BusinessPersona> = {
  beauty_chiropractic: {
    roleJa: '整体師', roleEn: 'beauty-chiropractor',
    businessNounJa: '美容整体院', businessNounEn: 'beauty-chiropractic clinic',
    primaryFocusJa: '骨盤・姿勢の歪み、小顔、自律神経、身体の動作回復',
    primaryFocusEn: 'pelvic/postural alignment, facial balance, autonomic regulation, movement recovery',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['頸椎・肩こり・腰の不調', '姿勢の歪み・骨盤バランス', '自律神経の乱れ・小顔/むくみ'],
    typicalConcernsEn: ['cervical / shoulder / lumbar issues', 'postural distortion + pelvic balance', 'autonomic imbalance, facial swelling'],
  },
  chiropractic: {
    roleJa: '整体師', roleEn: 'chiropractor',
    businessNounJa: '整体院', businessNounEn: 'chiropractic clinic',
    primaryFocusJa: '背骨のアライメント・姿勢・関節可動域・痛みの根本改善',
    primaryFocusEn: 'spinal alignment, posture, joint range of motion, root-cause pain relief',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['腰痛・首の痛み', '姿勢・可動域の制限', '慢性的なこり・しびれ'],
    typicalConcernsEn: ['low-back / neck pain', 'posture + restricted range of motion', 'chronic stiffness / numbness'],
  },
  osteopathy: {
    roleJa: 'オステオパス', roleEn: 'osteopath',
    businessNounJa: 'オステオパシー院', businessNounEn: 'osteopathy clinic',
    primaryFocusJa: '骨格・筋膜・全身のバランス調整',
    primaryFocusEn: 'skeletal, fascial, and whole-body balance',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['慢性的な痛み', '姿勢・体の歪み', '可動域の制限'],
    typicalConcernsEn: ['chronic pain', 'posture / body distortion', 'restricted range of motion'],
  },
  acupuncture: {
    roleJa: '鍼灸師', roleEn: 'acupuncturist',
    businessNounJa: '鍼灸院', businessNounEn: 'acupuncture clinic',
    primaryFocusJa: '経絡・自律神経・慢性症状・冷え/めぐり',
    primaryFocusEn: 'meridians, autonomic balance, chronic symptoms, circulation',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['慢性的な痛み', '自律神経の乱れ', '冷え・むくみ・睡眠'],
    typicalConcernsEn: ['chronic pain', 'autonomic imbalance', 'cold sensitivity / swelling / sleep'],
  },
  massage: {
    roleJa: 'セラピスト', roleEn: 'massage therapist',
    businessNounJa: 'マッサージ店', businessNounEn: 'massage practice',
    primaryFocusJa: '筋肉の緊張・血流・疲労回復・リラクゼーション',
    primaryFocusEn: 'muscle tension, circulation, fatigue recovery, relaxation',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['肩こり・腰の張り', '疲労・むくみ', '睡眠の質'],
    typicalConcernsEn: ['shoulder / lumbar tightness', 'fatigue + swelling', 'sleep quality'],
  },
  physical_therapy: {
    roleJa: '理学療法士', roleEn: 'physical therapist',
    businessNounJa: 'リハビリ施設', businessNounEn: 'physical-therapy clinic',
    primaryFocusJa: '機能回復・運動療法・可動域・痛みの管理',
    primaryFocusEn: 'functional recovery, exercise therapy, range of motion, pain management',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['可動域の制限', '痛み・代償動作', '機能回復の進捗'],
    typicalConcernsEn: ['restricted range of motion', 'pain / compensatory movement', 'functional-recovery progress'],
  },
  esthetic_salon: {
    roleJa: 'エステティシャン', roleEn: 'aesthetician',
    businessNounJa: 'エステサロン', businessNounEn: 'esthetic salon',
    primaryFocusJa: '肌の状態・ボディケア・季節性の肌トラブル・製品の相性',
    primaryFocusEn: 'skin condition, body care, seasonal skin issues, product fit',
    clinicalPosture: 'service',
    typicalConcernsJa: ['肌の乾燥・敏感', '季節の肌荒れ（花粉・乾燥）', 'たるみ・むくみ'],
    typicalConcernsEn: ['skin dryness / sensitivity', 'seasonal flare-ups (pollen / dryness)', 'sagging / swelling'],
  },
  hair_salon: {
    roleJa: 'スタイリスト', roleEn: 'stylist',
    businessNounJa: '美容室', businessNounEn: 'hair salon',
    primaryFocusJa: '髪のコンディション・スタイリング・再来サイクル',
    primaryFocusEn: 'hair condition, styling, and rebooking rhythm',
    clinicalPosture: 'service',
    typicalConcernsJa: ['カラーの色持ち', '熱・薬剤によるダメージ', '頭皮・くせの季節変化'],
    typicalConcernsEn: ['color fade between visits', 'heat / chemical damage', 'seasonal scalp & frizz changes'],
  },
  nail_salon: {
    roleJa: 'ネイリスト', roleEn: 'nail technician',
    businessNounJa: 'ネイルサロン', businessNounEn: 'nail salon',
    primaryFocusJa: '爪のケア・デザインの好み・爪の健康履歴',
    primaryFocusEn: 'nail care, design preferences, nail-health history',
    clinicalPosture: 'service',
    typicalConcernsJa: ['爪の割れ・欠け', '甘皮の浮き', '生活習慣の影響（家事・PC等）'],
    typicalConcernsEn: ['brittleness / splitting', 'lift at the cuticle', 'lifestyle impact (typing, chores)'],
  },
  eyelash_salon: {
    roleJa: 'アイリスト', roleEn: 'eyelash technician',
    businessNounJa: 'まつげサロン', businessNounEn: 'eyelash salon',
    primaryFocusJa: 'まつげの健康・カールの持ち・リピートサイクル',
    primaryFocusEn: 'lash health, curl retention, repeat cycle',
    clinicalPosture: 'service',
    typicalConcernsJa: ['まつげの傷み・抜け', '持ちの良さ', '目元の敏感・しみる'],
    typicalConcernsEn: ['lash damage / shedding', 'retention', 'eye-area sensitivity'],
  },
  yoga_studio: {
    roleJa: 'ヨガインストラクター', roleEn: 'yoga instructor',
    businessNounJa: 'ヨガスタジオ', businessNounEn: 'yoga studio',
    primaryFocusJa: '柔軟性・姿勢・呼吸・心身のバランス',
    primaryFocusEn: 'flexibility, posture, breath, mind-body balance',
    clinicalPosture: 'service',
    typicalConcernsJa: ['柔軟性・可動域', '姿勢の改善', 'ストレス・呼吸の浅さ'],
    typicalConcernsEn: ['flexibility / mobility', 'posture improvement', 'stress / shallow breathing'],
  },
  pilates_studio: {
    roleJa: 'ピラティスインストラクター', roleEn: 'pilates instructor',
    businessNounJa: 'ピラティススタジオ', businessNounEn: 'pilates studio',
    primaryFocusJa: '体幹・姿勢・コアの安定・動作の質',
    primaryFocusEn: 'core strength, posture, stability, movement quality',
    clinicalPosture: 'service',
    typicalConcernsJa: ['体幹の弱さ', '姿勢・骨盤の傾き', '腰部の安定・動作の癖'],
    typicalConcernsEn: ['weak core', 'posture / pelvic tilt', 'lumbar stability & movement habits'],
  },
  personal_gym: {
    roleJa: 'パーソナルトレーナー', roleEn: 'personal trainer',
    businessNounJa: 'パーソナルジム', businessNounEn: 'personal gym',
    primaryFocusJa: '筋力・体組成・トレーニング進捗・フォーム',
    primaryFocusEn: 'strength, body composition, training progression, form',
    clinicalPosture: 'service',
    typicalConcernsJa: ['スクワットの深さ/フォーム', '体重・体組成の変化', '可動域・ケガ予防'],
    typicalConcernsEn: ['squat depth / form', 'weight & body-composition change', 'mobility / injury prevention'],
  },
  relaxation: {
    roleJa: 'セラピスト', roleEn: 'therapist',
    businessNounJa: 'リラクゼーションサロン', businessNounEn: 'relaxation salon',
    primaryFocusJa: '疲労回復・肩こり・リラクゼーション',
    primaryFocusEn: 'fatigue recovery, tension relief, relaxation',
    clinicalPosture: 'service',
    typicalConcernsJa: ['疲労・だるさ', '肩こり・首こり', 'ストレス・睡眠'],
    typicalConcernsEn: ['fatigue', 'shoulder / neck tension', 'stress / sleep'],
  },
  dental_clinic: {
    roleJa: '歯科医', roleEn: 'dentist',
    businessNounJa: '歯科医院', businessNounEn: 'dental clinic',
    primaryFocusJa: '口腔の健康・審美・予防',
    primaryFocusEn: 'oral health, aesthetics, prevention',
    clinicalPosture: 'clinical',
    typicalConcernsJa: ['虫歯・歯周の状態', 'かみ合わせ・歯ぎしり', 'ホワイトニング・審美希望'],
    typicalConcernsEn: ['caries / periodontal status', 'occlusion / bruxism', 'whitening / aesthetic goals'],
  },
  dermatology: {
    roleJa: '皮膚科医', roleEn: 'dermatologist',
    businessNounJa: '皮膚科', businessNounEn: 'dermatology clinic',
    primaryFocusJa: '皮膚疾患・肌の健康・経過観察',
    primaryFocusEn: 'skin conditions, skin health, follow-up monitoring',
    clinicalPosture: 'clinical',
    typicalConcernsJa: ['湿疹・ニキビ等の症状', '乾燥・敏感', '治療の経過'],
    typicalConcernsEn: ['eczema / acne symptoms', 'dryness / sensitivity', 'treatment progress'],
  },
  cosmetic_surgery: {
    roleJa: '医師', roleEn: 'cosmetic surgeon',
    businessNounJa: '美容外科クリニック', businessNounEn: 'cosmetic-surgery clinic',
    primaryFocusJa: '美容施術・術後経過・審美的な希望',
    primaryFocusEn: 'aesthetic procedures, post-op recovery, aesthetic goals',
    clinicalPosture: 'clinical',
    typicalConcernsJa: ['施術の希望・対象部位', '術後の経過・ダウンタイム', 'リスク説明・同意'],
    typicalConcernsEn: ['desired procedure / target area', 'post-op course / downtime', 'risk disclosure / consent'],
  },
  medical_clinic: {
    roleJa: '医師', roleEn: 'physician',
    businessNounJa: 'クリニック', businessNounEn: 'medical clinic',
    primaryFocusJa: '診察・症状・検査・治療方針',
    primaryFocusEn: 'consultation, symptoms, tests, treatment plan',
    clinicalPosture: 'clinical',
    typicalConcernsJa: ['症状・経過', '検査・所見', '処方・治療方針'],
    typicalConcernsEn: ['symptoms / course', 'tests / findings', 'prescription / treatment plan'],
  },
  wellness_clinic: {
    roleJa: 'スタッフ', roleEn: 'wellness practitioner',
    businessNounJa: 'ウェルネスクリニック', businessNounEn: 'wellness clinic',
    primaryFocusJa: '健康管理・予防・生活習慣の改善',
    primaryFocusEn: 'health management, prevention, lifestyle improvement',
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['体調・生活習慣', '検査数値の変化', '予防・改善プラン'],
    typicalConcernsEn: ['condition / lifestyle', 'change in measured values', 'prevention / improvement plan'],
  },
  mental_health: {
    roleJa: 'カウンセラー', roleEn: 'counselor',
    businessNounJa: 'カウンセリングルーム', businessNounEn: 'counseling practice',
    primaryFocusJa: '心の状態・ストレス・継続的な支援',
    primaryFocusEn: 'mental state, stress, ongoing support',
    // 'wellness', not 'clinical': a counselor is NOT a licensed psychiatrist
    // (that vertical is medical_clinic). The wellness guardrail records state +
    // refers out for serious signs, instead of writing diagnoses — the safer,
    // less liability-exposed default for sensitive counseling notes (APPI 要配慮).
    clinicalPosture: 'wellness',
    typicalConcernsJa: ['気分・ストレスの状態', '睡眠・生活リズム', '継続的な変化・目標'],
    typicalConcernsEn: ['mood / stress state', 'sleep / daily rhythm', 'ongoing change / goals'],
  },
  aroma: {
    roleJa: 'セラピスト', roleEn: 'aromatherapist',
    businessNounJa: 'アロマセラピーサロン', businessNounEn: 'aromatherapy salon',
    primaryFocusJa: 'リラクゼーション・自律神経・香りの好み',
    primaryFocusEn: 'relaxation, autonomic balance, scent preferences',
    clinicalPosture: 'service',
    typicalConcernsJa: ['疲労・ストレス', '睡眠・自律神経', '香り・オイルの好み'],
    typicalConcernsEn: ['fatigue / stress', 'sleep / autonomic balance', 'scent & oil preferences'],
  },
  foot_care: {
    roleJa: 'フットケアセラピスト', roleEn: 'foot-care therapist',
    businessNounJa: 'フットケアサロン', businessNounEn: 'foot-care salon',
    primaryFocusJa: '足・爪・角質・むくみのケア',
    primaryFocusEn: 'foot, nail, callus, and swelling care',
    clinicalPosture: 'service',
    typicalConcernsJa: ['角質・タコ・魚の目', '爪のトラブル（巻き爪等）', 'むくみ・冷え'],
    typicalConcernsEn: ['calluses / corns', 'nail issues (ingrown, etc.)', 'swelling / cold feet'],
  },
  pet_grooming: {
    roleJa: 'トリマー', roleEn: 'pet groomer',
    businessNounJa: 'ペットサロン', businessNounEn: 'pet-grooming salon',
    primaryFocusJa: 'ペットの被毛・皮膚・施術中の様子',
    primaryFocusEn: 'the pet\'s coat, skin, and behavior during grooming',
    clinicalPosture: 'service',
    typicalConcernsJa: ['被毛の状態・もつれ', '皮膚・肉球のトラブル', '性格・施術中の様子'],
    typicalConcernsEn: ['coat condition / matting', 'skin / paw-pad issues', 'temperament during grooming'],
  },
  veterinary: {
    roleJa: '獣医師', roleEn: 'veterinarian',
    businessNounJa: '動物病院', businessNounEn: 'veterinary clinic',
    primaryFocusJa: '動物の診察・症状・検査・治療',
    primaryFocusEn: 'animal consultation, symptoms, tests, treatment',
    clinicalPosture: 'clinical',
    typicalConcernsJa: ['症状・経過', '検査・所見', '処方・治療方針'],
    typicalConcernsEn: ['symptoms / course', 'tests / findings', 'prescription / treatment plan'],
  },
  training_school: {
    roleJa: '講師', roleEn: 'instructor',
    businessNounJa: 'スクール', businessNounEn: 'training school',
    primaryFocusJa: '受講者の習熟・進捗・課題',
    primaryFocusEn: 'learner mastery, progress, and challenges',
    clinicalPosture: 'service',
    typicalConcernsJa: ['習熟度・理解', 'つまずき・課題', '次回までの目標・宿題'],
    typicalConcernsEn: ['mastery / understanding', 'sticking points', 'goals / homework before next session'],
  },
}

/** Resolve the persona for an account's business_type. Unknown / unset → generic
 *  (still demands depth; just without vertical-specific vocabulary). */
export function getBusinessPersona(businessType?: string | null): BusinessPersona {
  if (!businessType) return GENERIC
  return PERSONAS[businessType] ?? GENERIC
}
