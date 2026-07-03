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

/** One labeled section of the AI session summary (「・主訴：…」). */
export interface SummaryLabel {
  label: string
  def: string
}

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
  /** The extraction "hunt list": what the AI must actively listen for at this
   *  business (会話に出た場合のみ — never a padding mandate). Optional: types
   *  without an authored list fall back to GENERIC_CHECKLIST_JA/EN. */
  captureChecklistJa?: string[]
  captureChecklistEn?: string[]
  /** The summary's labeled sections, in skim order (safety second). Optional:
   *  falls back to GENERIC_SUMMARY_LABELS_JA/EN. */
  summaryLabelsJa?: SummaryLabel[]
  summaryLabelsEn?: SummaryLabel[]
  /** 1-2 business-flavored good-title examples for the extraction prompt.
   *  MUST be synthetic facts that appear in no real session (echo risk). */
  goodExamplesJa?: string[]
  goodExamplesEn?: string[]
  /** Customer-passport fields (the profile's これまで box): the identity facts
   *  a practitioner at THIS business wants pinned at the top of the profile.
   *  key is the stable machine id (staff overrides store against it); label is
   *  what renders; hint steers the extractor. Optional — falls back to
   *  GENERIC_PASSPORT_FIELDS. */
  passportFieldsJa?: PassportFieldDef[]
  passportFieldsEn?: PassportFieldDef[]
}

export interface PassportFieldDef {
  key: string
  label: string
  hint?: string
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
    captureChecklistJa: [
      '主訴・訴え：どこが・いつから・きっかけ・どんな時に痛むか。期間（「半年」→「約6ヶ月」のように）も数字に直して必ず含める',
      '既往歴・外傷・手術歴・服薬：過去のケガ・手術・体内の金属（プレート等）・可動制限・服用中の薬・アレルギー — 施術の安全に直結するため最優先',
      '圧・刺激の好みと注意点：強め/弱めの好み、痛がった箇所・響いた箇所、もみ返しの傾向、過去の施術での悪化経験・施術への不安',
      'セルフケア指導：教えたストレッチ・エクササイズ、フォームの要点（秒数・回数・姿勢）、お客様の自己流の誤りを正した内容',
      '生活習慣：仕事時間・睡眠・運動習慣・食事・飲酒など体に影響するもの',
      '美容面の目標・個人メモ：姿勢美・小顔・骨盤などの関心と期限のある目標、家族・趣味・予定の話題、呼ばれたい名前・会話量・快適さの好み',
      '次回・プラン：予約日時、推奨来店頻度、次回確認すること、施術者がお客様に約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      "Chief complaints: where, since when, what triggered it, when it hurts. Convert durations to figures (\"half a year\" → \"~6 months\") and always include them",
      'History & safety: past injuries, surgeries, implanted metal (plates etc.), movement restrictions, current medication, allergies — top priority, directly affects treatment safety',
      'Pressure preferences & cautions: strong/gentle preference, spots that hurt or rang, tendency to post-massage soreness, bad past-treatment experiences or fear of adjustments',
      "Self-care coaching: stretches/exercises taught, form key points (seconds, reps, posture), corrections made to the customer's own routine",
      'Lifestyle: work hours, sleep, exercise habits, diet, alcohol — anything that affects the body',
      "Aesthetic goals & personal notes: posture/facial/pelvic goals with deadlines, family/hobby/plans topics, preferred name, conversation-volume and comfort preferences",
      'Next & plan: booking date/time, recommended cadence, things to check next time, promises the practitioner made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: 'お客様の訴え・悩み・目標（部位・いつから・きっかけ。目標に期限がある場合は期限も）' },
      { label: '注意', def: '安全・接客上の注意（既往歴・手術歴・体内金属・アレルギー・服用中の薬・痛がった箇所・圧の注意・もみ返しの傾向・施術への不安）' },
      { label: '状態', def: '本日の体の状態、施術者の所見と原因の見立て。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施した施術と、それへのお客様の反応。施術前後で変化を確認した場合はその結果も明記（「いつもの」等の指定はその表現のまま書く）' },
      { label: 'セルフケア', def: '指導した自宅ケア（内容・フォームの要点・秒数/回数・正した誤り）' },
      { label: '生活', def: '生活習慣や、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：施術者またはお客様が次回に向けて口にした・宿題にした「次回確認すること」（セルフケアの実施状況・経過を見る症状など）／施術者がお客様に約束した内容（重点部位の変更・期限延長など）／保留になった提案／継続・更新に関わるお客様の意向や事情／回数券の残回数／推奨来店頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Concerns', def: "the customer's complaints, worries, and goals (area, since when, trigger; include deadlines on goals)" },
      { label: 'Cautions', def: 'safety and service cautions (injury/surgery history, implanted metal, allergies, medication, spots that hurt, pressure cautions, soreness tendency, treatment anxiety)' },
      { label: 'Condition', def: "today's body state and the practitioner's findings and assessment; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "what was done today and how the customer responded; include before/after re-test results when checked (keep 'the usual'-style requests verbatim)" },
      { label: 'Self-care', def: 'homework taught (content, form key points, seconds/reps, corrected mistakes)' },
      { label: 'Life', def: 'lifestyle and personal topics (family, hobbies, plans) useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time (homework follow-up, symptoms to track) / promises the practitioner made / deferred proposals / renewal intent or attendance constraints / ticket balance / recommended cadence. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「左肩：3ヶ月前から挙上時に痛み、デスクワーク後に悪化」',
      '（treatment）：「セルフケア指導：入浴後に肩甲骨回し10回×2セット、反動をつけない」',
    ],
    goodExamplesEn: [
      '(symptom): "Left shoulder: pain on raising since ~3 months ago, worse after desk work"',
      '(treatment): "Self-care coaching: shoulder-blade circles 10 reps × 2 sets after bathing, no bouncing"',
    ],
    passportFieldsJa: [
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態・体への影響（デスクワーク・立ち仕事など）' },
      { key: 'referral_source', label: '来店きっかけ', hint: '紹介・検索・看板・SNSなど、最初に来店した理由' },
      { key: 'maintenance_pref', label: 'メンテナンス希望', hint: '本人が話した希望来店ペース（週1・月1など）' },
      { key: 'chief_concern', label: '主な悩み', hint: '慢性的・繰り返し話題になる悩みや体質（今日だけの症状ではない）' },
    ],
    passportFieldsEn: [
      { key: 'occupation', label: 'Occupation', hint: 'work and how it affects the body (desk work, standing, etc.)' },
      { key: 'referral_source', label: 'How they found us', hint: 'referral, search, signage, SNS — why they first came' },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence they said they want' },
      { key: 'chief_concern', label: 'Chief concern', hint: 'chronic, recurring concerns — not just today\'s symptom' },
    ],
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

// ---------------------------------------------------------------------------
// Capture tokens (v3.1 prompt system) — per-business hunt list, summary label
// set, and title exemplars. Authored types define their own; everything else
// runs on these generic fallbacks (real definitions, not empty slots) until
// authored to the same standard.
// ---------------------------------------------------------------------------

const GENERIC_CHECKLIST_JA: string[] = [
  '相談内容・要望：何を求めて来店したか、いつから・きっかけ。期間や数値は数字に直して必ず含める',
  '安全に関わる情報：アレルギー・過去のトラブル・体質・服用中の薬など、対応の安全に関わる履歴 — 最優先',
  '好みと注意点：強さ・仕上がり・接客の好み、嫌がったこと・過去の悪い経験',
  'すすめたケア・宿題：教えたセルフケアや使い方の要点（回数・頻度・手順）、正した誤り',
  '生活習慣：仕事・睡眠・生活リズムなど、状態や来店周期に影響するもの',
  '個人メモ：家族・趣味・予定の話題、呼ばれたい名前・会話量の好みなど次回の会話に活きるもの',
  '次回・プラン：予約日時、推奨来店周期、次回確認すること、スタッフがお客様に約束した内容、回数券・コースの残回数と継続の意向',
  '継続のサイン：満足・不満・迷い・他店との比較など、また来てもらえるかに関わるお客様の気持ち',
]

const GENERIC_CHECKLIST_EN: string[] = [
  'Requests & concerns: what the customer came for, since when, what triggered it. Convert durations/amounts to figures',
  'Safety-relevant history: allergies, past reactions or trouble, constitution, current medication — top priority',
  'Preferences & cautions: intensity/finish/service preferences, things they disliked, bad past experiences',
  'Care advice & homework: self-care or usage taught (reps, frequency, steps), corrected mistakes',
  'Lifestyle: work, sleep, routine — anything affecting their condition or visit cadence',
  'Personal notes: family/hobby/plans topics, preferred name, conversation-volume preference — anything useful next visit',
  'Next & plan: booking, recommended cadence, things to check next time, promises staff made, ticket/course balance and renewal intent',
  "Retention signals: satisfaction, dissatisfaction, hesitation, competitor comparisons — the customer's feelings about coming back",
]

const GENERIC_SUMMARY_LABELS_JA: SummaryLabel[] = [
  { label: '相談内容', def: 'お客様の要望・悩み・目標（いつから・きっかけ。期限がある場合は期限も）' },
  { label: '注意', def: '安全・接客上の注意（アレルギー・過去のトラブル・服用中の薬・嫌がったこと）' },
  { label: '状態', def: '本日の状態と担当者の所見・見立て。前回からの変化が会話から分かる場合に限り明記' },
  { label: '本日の内容', def: '本日実施した内容と、それへのお客様の反応（「いつもの」等の指定はその表現のまま書く）' },
  { label: 'アドバイス', def: 'すすめたケア・製品・宿題（内容・回数・手順。お客様の反応も）' },
  { label: '生活・会話', def: '生活習慣や、家族・趣味・予定など次回の会話に活きる話題' },
  { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／スタッフがお客様に約束した内容／保留になった提案／継続・更新に関わるお客様の意向／回数券の残回数／推奨来店周期。情報が多ければ行を分ける' },
  { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
]

const GENERIC_SUMMARY_LABELS_EN: SummaryLabel[] = [
  { label: 'Requests', def: "the customer's requests, concerns, and goals (since when, trigger; include deadlines)" },
  { label: 'Cautions', def: 'safety and service cautions (allergies, past trouble, medication, things they disliked)' },
  { label: 'Condition', def: "today's condition and the staff member's observations; state change vs last time ONLY when the conversation shows it" },
  { label: "Today's session", def: "what was done today and the customer's reaction (keep 'the usual'-style requests verbatim)" },
  { label: 'Advice', def: 'care, products, or homework recommended (content, reps, steps; include the customer\'s reaction)' },
  { label: 'Life & conversation', def: 'lifestyle and personal topics (family, hobbies, plans) useful next visit' },
  { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises staff made / deferred proposals / renewal intent / ticket balance / recommended cadence. Split lines when rich' },
  { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
]

const GENERIC_PASSPORT_FIELDS_JA: PassportFieldDef[] = [
  { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態' },
  { key: 'referral_source', label: '来店きっかけ', hint: '紹介・検索・SNSなど、最初に来た理由' },
  { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望ペース' },
  { key: 'chief_concern', label: '主な要望', hint: '継続的・繰り返し出てくる要望や悩み' },
]

const GENERIC_PASSPORT_FIELDS_EN: PassportFieldDef[] = [
  { key: 'occupation', label: 'Occupation', hint: 'work and routine' },
  { key: 'referral_source', label: 'How they found us', hint: 'referral, search, SNS — why they first came' },
  { key: 'maintenance_pref', label: 'Visit cadence preference', hint: 'the cadence they said they want' },
  { key: 'chief_concern', label: 'Main request', hint: 'recurring requests or concerns' },
]

/** Passport field definitions for a business type + locale (generic fallback
 *  for unauthored types — real definitions, never empty slots). */
export function resolvePassportFields(
  businessType: string | null | undefined,
  locale: string,
): PassportFieldDef[] {
  const persona = getBusinessAiPersona(businessType)
  const ja = locale === 'ja'
  return (
    (ja ? persona.passportFieldsJa : persona.passportFieldsEn) ??
    (ja ? GENERIC_PASSPORT_FIELDS_JA : GENERIC_PASSPORT_FIELDS_EN)
  )
}

export interface CaptureTokens {
  checklist: string[]
  summaryLabels: SummaryLabel[]
  goodExamples: string[]
}

/** Max checklist items fed to the prompt — protects the model's instruction
 *  budget from future per-org additions (overrides layer). */
const CHECKLIST_BUDGET = 10

/**
 * Resolve the capture tokens for a business type + locale, falling back to the
 * generic set. `overrides` is the future per-org/per-store tuning layer
 * (org_settings JSON) — merged here as data so owner customization never
 * requires a prompt rewrite. Unused today (always undefined).
 */
export function resolveCaptureTokens(
  businessType: string | null | undefined,
  locale: string,
  overrides?: { checklistExtra?: string[] },
): CaptureTokens {
  const persona = getBusinessAiPersona(businessType)
  const ja = locale === 'ja'
  const checklist = [
    ...((ja ? persona.captureChecklistJa : persona.captureChecklistEn) ??
      (ja ? GENERIC_CHECKLIST_JA : GENERIC_CHECKLIST_EN)),
    ...(overrides?.checklistExtra ?? []),
  ].slice(0, CHECKLIST_BUDGET)
  const summaryLabels =
    (ja ? persona.summaryLabelsJa : persona.summaryLabelsEn) ??
    (ja ? GENERIC_SUMMARY_LABELS_JA : GENERIC_SUMMARY_LABELS_EN)
  const goodExamples = (ja ? persona.goodExamplesJa : persona.goodExamplesEn) ?? []
  return { checklist, summaryLabels, goodExamples }
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
