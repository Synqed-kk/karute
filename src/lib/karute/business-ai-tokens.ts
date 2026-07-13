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
  /** The word this business uses for "what we did today" — drives the
   *  treatment-entry title prefix (「施術：」→「トレーニング：」 etc.) and the
   *  UI prefix strip (CurrentSessionCard). Optional: falls back to the
   *  neutral 'other' persona's noun. */
  serviceNounJa?: string
  serviceNounEn?: string
  /** Per-category enrichment appended to the NEUTRAL category definitions in
   *  the JA extraction prompt (v3.3 de-bodywork). The neutral core carries the
   *  semantics of the 8 DB enum values; these notes carry THIS business's
   *  domain specifics (what もみ返し means to a massage studio). JA only until
   *  the EN prompt re-author (PR 2 of the v3 plan). */
  categoryNotesJa?: Partial<
    Record<'symptom' | 'body_area' | 'treatment' | 'preference' | 'next_visit', string>
  >
}

export interface PassportFieldDef {
  key: string
  label: string
  hint?: string
}

const PERSONAS: Record<string, BusinessAiPersona> = {
  esthetic_salon: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: 'エステティシャン', roleEn: 'aesthetician',
    businessNounJa: 'エステサロン', businessNounEn: 'esthetic salon',
    primaryFocusJa: '肌コンディション・ボディトリートメント・季節別のスキンケア戦略',
    primaryFocusEn: 'skin condition, body treatment, and seasonal skincare strategy',
    seasonalRelevance: 'high', clinicalPosture: 'service',
    typicalConcernsJa: ['花粉季の頬の乾燥', 'UVダメージの回復', '生理周期によるホルモン的な変化'],
    typicalConcernsEn: ['cheek dryness in pollen season', 'UV damage recovery', 'menstrual-cycle hormonal patterns'],
    captureChecklistJa: [
      '肌・ボディの主訴：乾燥・くすみ・毛穴・たるみ・ニキビ・シミ・むくみ・セルライトなど、どこが・いつから・きっかけ（季節・生理周期・ストレス）。期間は必ず数字で記録',
      'アレルギー・肌トラブル歴・禁忌：化粧品かぶれ、金属アレルギー、アトピー・敏感肌、皮膚科治療中（レチノール・ピーリング使用など）、妊娠中 — 機器・薬剤の選択に直結するため最優先で記録',
      '施術者の所見と実施内容：水分量・皮脂量・キメ・ハリ・血色・角質肥厚・むくみ等の観察（測定機器の数値が出たら必ず記録）と、コース名・使用機器（ハイフ・ラジオ波・キャビテーション・フォトなど）・出力レベル・部位・使用した化粧品/美容液の製品名',
      '施術中の反応と快適さの好み：赤み・ヒリつき・熱感の有無、「スッキリした」「明るくなった」などの実感（ニュアンスごと記録）と、機器の出力・熱さの耐性、ボディの圧の強さ、苦手な香り・タオルの温度',
      'ホームケア指導：勧めたスキンケア手順・製品名・使用頻度、UV対策の指示',
      '生活習慣：睡眠・食事・水分摂取・飲酒喫煙・ストレス・生理周期など肌に影響するもの',
      '美容目標・個人メモ：結婚式・撮影・旅行などの目標日と目指す変化（サイズダウン・美白など、日付と数字で）、仕事・家族・趣味・予定など次回の会話に活きる話題',
      '次回・プラン：次回予約、施術者がお客様に約束した内容、推奨来店周期、今後のケア計画、コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief skin/body concern: dryness, dullness, pores, sagging, breakouts, pigmentation, puffiness, cellulite — where, since when, and the trigger (season, menstrual cycle, stress). Always record durations as numbers',
      'Allergies, reaction history, contraindications: cosmetic reactions, metal allergy, atopic/sensitive skin, current dermatology treatment (retinol, peels), pregnancy — top priority; drives machine and product choices',
      "Practitioner's findings and treatment performed: hydration, sebum, texture, firmness, circulation, congestion, puffiness (always include device readings whenever measured), plus course name, machines used (HIFU, radiofrequency, cavitation, photofacial), output levels, areas treated, product/serum names",
      'Reaction during treatment and comfort preferences: redness, stinging, heat sensitivity, and felt results ("so refreshed", "brighter" — with nuance), plus machine-intensity and heat tolerance, body-treatment pressure, disliked scents, towel temperature',
      'Homecare instructions: recommended routine, product names, frequency, sun-protection advice',
      'Lifestyle: sleep, diet, hydration, alcohol/smoking, stress, menstrual cycle — anything that shows up in the skin',
      "Beauty goals & personal notes: wedding, photoshoot, or trip dates and target changes (measurements, brightening — dates and numbers), plus work, family, hobbies, and plans for next visit's conversation",
      'Next visit and plan: booking, promises the practitioner made, recommended visit rhythm, treatment roadmap, course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: 'お悩み', def: 'お客様の肌・ボディの悩みや目標（部位・いつから・きっかけ。目標に期限がある場合は期限も）' },
      { label: '注意', def: '安全・接客上の注意（化粧品かぶれ・金属アレルギー・アトピー/敏感肌・皮膚科治療中・妊娠中・苦手な香りや圧など）' },
      { label: '肌状態', def: '本日の肌・ボディの状態、施術者の所見（水分量・皮脂量・ハリ等）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施したコース・使用機器・出力・部位・製品名と、それへのお客様の反応（赤み・ヒリつき・実感等。「いつもの」等の指定はその表現のまま書く）' },
      { label: 'ホームケア', def: '指導したスキンケア手順・製品名・使用頻度、UV対策の指示' },
      { label: '生活', def: '生活習慣や、家族・趣味・イベント予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：施術者またはお客様が次回に向けて口にした確認事項／施術者が約束した内容／保留になった提案／継続・更新に関わる意向／コースの残回数／推奨来店周期。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Concerns', def: "the customer's skin/body concerns and goals (area, since when, trigger; include deadlines on goals)" },
      { label: 'Cautions', def: 'safety and service cautions (cosmetic reactions, metal allergy, atopic/sensitive skin, current dermatology treatment, pregnancy, disliked scents or pressure)' },
      { label: 'Skin condition', def: "today's skin/body condition and the practitioner's findings (hydration, sebum, firmness, etc.); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "today's course, machine, output level, area, and products used, and the customer's reaction (redness, stinging, felt results; keep 'the usual'-style requests verbatim)" },
      { label: 'Homecare', def: 'recommended skincare routine, product names, frequency, sun-protection advice' },
      { label: 'Life', def: 'lifestyle and personal topics (family, hobbies, upcoming events) useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises made / deferred proposals / renewal intent / course balance / recommended cadence. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「二の腕：半年前からむくみとハリのなさが気になり、運動不足で悪化」',
      '（treatment）：「ホームケア指導：保湿クリームを入浴後に朝晩2プッシュ、UVは2時間おきに塗り直し」',
    ],
    goodExamplesEn: [
      '(symptom): "Upper arms: puffiness and loss of firmness bothering her for about 6 months, worse with less exercise"',
      '(treatment): "Homecare coaching: apply moisturizing cream morning and night after bathing, 2 pumps; reapply sunscreen every 2 hours"',
    ],
    passportFieldsJa: [
      { key: 'skin_type', label: '肌質', hint: '普段の肌質（乾燥・脂性・混合・敏感など）。今日の肌の状態ではなく、継続的な体質として当てはまるもの' },
      { key: 'allergy_reaction', label: 'アレルギー', hint: '特定の成分・薬剤へのアレルギーや肌トラブルの既往（パッチテスト結果・過去の赤み・かぶれなど）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態と肌への影響（外回り・デスクワーク・マスク着用など）' },
      { key: 'chief_concern', label: '主な悩み', hint: '慢性的・繰り返し話題になる肌の悩みや目標（今日だけの症状ではない）' },
      { key: 'maintenance_pref', label: 'メンテナンス希望', hint: '本人が話した希望来店ペース（月1など）' },
    ],
    passportFieldsEn: [
      { key: 'skin_type', label: 'Skin type', hint: "their everyday skin type (dry, oily, combination, sensitive) — constitution, not just today's condition" },
      { key: 'allergy_reaction', label: 'Allergies', hint: 'known allergies or reactions to specific ingredients/products (patch-test results, past redness or breakouts)' },
      { key: 'occupation', label: 'Occupation', hint: 'work and how it affects the skin (outdoor exposure, desk work, mask-wearing, etc.)' },
      { key: 'chief_concern', label: 'Chief concern', hint: "chronic, recurring skin concerns or goals — not just today's symptom" },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence they said they want' },
    ],
  },
  hair_salon: {
    serviceNounJa: '施術', serviceNounEn: 'service',
    roleJa: 'スタイリスト', roleEn: 'stylist',
    businessNounJa: '美容室', businessNounEn: 'hair salon',
    primaryFocusJa: '髪のコンディション・スタイリング・再来サイクル',
    primaryFocusEn: 'hair condition, styling, and rebooking rhythm',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['カラーの色持ち', '熱によるダメージ', '季節による頭皮の変化'],
    typicalConcernsEn: ['color fading between visits', 'damage from heat styling', 'scalp sensitivity changes with season'],
    captureChecklistJa: [
      '本日のオーダー：カットの長さ（何cm切る・どこまで）・レイヤー・前髪・見せてもらった参考写真の特徴。数字は必ず記録',
      'アレルギー・頭皮の敏感性：ジアミンアレルギー、カラー剤でしみる・かゆみ、頭皮の傷や湿疹、妊娠中 — 薬剤選択の安全に直結するため最優先で記録',
      'カラー・パーマの処方と髪・頭皮の状態：薬剤の色番号/レベル・配合・オキシ濃度・放置時間・根元と毛先の塗り分け、パーマのロッド/薬剤設定（次回の再現に必須）、ダメージレベル・クセ・毛量・白髪の量と分布・頭皮の乾燥/脂性、ブリーチ・縮毛矯正の履歴',
      '前回からの持ちと仕上がりへの反応：カラーの色落ち傾向（「3週間で黄ばむ」など数字で）、パーマの取れ具合、スタイルの再現しやすさ、気に入った点・気になった点（「もう少し短くてもよかった」など）— ニュアンスごと記録',
      'スタイリング習慣と好み：朝のセット時間、アイロン/コテの使用、結ぶ頻度、分け目、職場の髪色規定',
      'ホームケア：勧めたシャンプー/トリートメント/オイルの製品名、洗い方・乾かし方の指導',
      'ライフスタイル・個人メモ・イベント予定：仕事・家族・週末の過ごし方・趣味、結婚式・成人式・旅行・撮影などの日付（日付は数字で記録）',
      '次回・プラン：次回予約、リタッチ/メンテの推奨周期（「6週間後」など）、次回やりたいこと（「次はパーマ」など）、施術者が約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      "Today's order: cut length (how many cm off, to where), layers, fringe, key features of any reference photo shown. Always record the numbers",
      'Allergies and scalp sensitivity: dye (PPD) allergy, stinging or itching from color, scalp cuts or eczema, pregnancy — top priority; drives safe product choice',
      'Color/perm formula and hair/scalp condition: shade number/level, mix ratio, developer strength, processing time, root vs ends application, perm rod and solution settings (essential to reproduce next time), damage level, natural texture/wave, density, grey distribution, dry/oily scalp, bleach and straightening history',
      'Retention since last visit and reaction to the result: color fade pattern ("goes brassy in 3 weeks" — with numbers), perm relaxation, how easily they can reproduce the style at home, what they loved or would tweak ("could have gone shorter") — capture the nuance',
      'Styling habits and preferences: morning styling time, iron/curler use, how often hair is tied up, parting, workplace color rules',
      'Homecare: recommended shampoo/treatment/oil product names, washing and drying instructions',
      'Lifestyle, personal notes & upcoming events: work, family, weekend life, hobbies, and wedding/ceremony/trip/photoshoot dates (record dates as numbers)',
      'Next visit and plan: booking, recommended retouch/maintenance cycle ("6 weeks"), what they want next ("perm next time"), promises the stylist made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '要望', def: '本日のオーダー（カット長・レイヤー・前髪など数字で）と、髪型・カラーに関する目標や希望' },
      { label: '注意', def: '安全・接客上の注意（ジアミンアレルギー、カラー剤でのしみ・かゆみ、頭皮の傷や湿疹、妊娠中など）' },
      { label: '髪・頭皮', def: '髪・頭皮の状態（ダメージレベル・クセ・毛量・白髪・頭皮の乾燥/脂性）と前回からの色落ち・パーマの取れ具合。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施したカット・カラー/パーマの処方（色番号・オキシ濃度・放置時間・ロッド設定など）と、仕上がりへのお客様の反応（気に入った点・気になった点。「いつもの」等の指定はその表現のまま書く）' },
      { label: 'ホームケア', def: '指導したシャンプー/トリートメント/オイルの製品名、洗い方・乾かし方' },
      { label: '生活', def: '仕事・家族・週末の過ごし方・趣味や、結婚式・旅行などのイベント予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／スタイリストが約束した内容／保留になった提案（「次はパーマ」等）／継続・更新に関わる意向／回数券・コースの残回数／推奨リタッチ周期。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Request', def: "today's order (cut length, layers, fringe — as numbers) and any hairstyle/color goals" },
      { label: 'Cautions', def: 'safety and service cautions (PPD dye allergy, stinging/itching from color, scalp cuts or eczema, pregnancy)' },
      { label: 'Hair/scalp', def: "hair and scalp condition (damage level, texture, density, grey, dry/oily scalp) and how the last color/perm held up; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Service', def: "today's cut and color/perm formula performed (shade, developer strength, processing time, rod settings) and the customer's reaction to the result (keep 'the usual'-style requests verbatim)" },
      { label: 'Homecare', def: 'recommended shampoo/treatment/oil product names, washing and drying instructions' },
      { label: 'Life', def: 'work, family, weekend life, hobbies, and upcoming events (wedding, trips) useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the stylist made / deferred proposals ("perm next time") / renewal intent / ticket or course balance / recommended retouch cycle. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（preference）：「分け目は7:3、根元のボリュームのなさを数年前から気にしており、朝のアイロンは前髪のみ」',
      '（treatment）：「カラー処方：8レベルのアッシュブラウン、オキシ3%、放置25分、根元のみリタッチ」',
    ],
    goodExamplesEn: [
      '(preference): "Parts hair 7:3, has been self-conscious about root volume for a few years, only irons the fringe in the morning"',
      '(treatment): "Color formula: level 8 ash brown, 3% developer, 25-min processing, root retouch only"',
    ],
    passportFieldsJa: [
      { key: 'style_pref', label: 'スタイル・カラー', hint: '本人が普段指定するカット・カラー・パーマの好み（レングス・色味・仕上がりイメージ、「いつもの」の内容）' },
      { key: 'allergy_reaction', label: 'アレルギー', hint: 'カラー剤・パーマ剤など施術で使う薬剤へのアレルギーやかぶれの既往（パッチテスト結果を含む）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態と、髪型・カラーへの制約（規定のある職場・汗をかく環境など）' },
      { key: 'chief_concern', label: '髪・頭皮の悩み', hint: '慢性的・繰り返し話題になる髪や頭皮の悩み（今日だけの症状ではない）' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望来店周期（リタッチ・カットの間隔など）' },
    ],
    passportFieldsEn: [
      { key: 'style_pref', label: 'Style & color', hint: 'their usual cut/color/perm request (length, tone, finish) — what "the usual" means for them' },
      { key: 'allergy_reaction', label: 'Allergies', hint: 'allergies or reactions to dye, perm solution, or other chemicals used in service (patch-test results)' },
      { key: 'occupation', label: 'Occupation', hint: 'work and any style/color restrictions it creates (workplace dress code, sweat-heavy environment, etc.)' },
      { key: 'chief_concern', label: 'Hair & scalp concern', hint: "chronic hair or scalp concerns — not just today's symptom" },
      { key: 'maintenance_pref', label: 'Visit cadence', hint: 'the rebooking rhythm they said they want (retouch/cut interval)' },
    ],
  },
  nail_salon: {
    serviceNounJa: '施術', serviceNounEn: 'service',
    roleJa: 'ネイリスト', roleEn: 'nail technician',
    businessNounJa: 'ネイルサロン', businessNounEn: 'nail salon',
    primaryFocusJa: '爪のケア・デザインの好み・爪の健康履歴',
    primaryFocusEn: 'nail care, design preferences, and nail-health history',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['爪の割れ・欠け', '甘皮部分の浮き', 'ライフスタイル（PC作業・育児・スポーツ）の影響'],
    typicalConcernsEn: ['brittleness or splitting', 'lift at the cuticle', 'lifestyle impact (typing, childcare, sports)'],
    captureChecklistJa: [
      '本日のオーダー・デザイン：カラー番号/ブランド、デザイン内容（ワンカラー・フレンチ・グラデ・アートの詳細）、長さと形（スクエア/オーバルなど）、参考画像の特徴',
      'アレルギー・爪トラブル歴：ジェル（HEMA）アレルギー、アセトンでしみる、施術後のかゆみ・赤み、グリーンネイルの既往 — 施術可否に直結するため最優先で記録',
      '爪と甘皮の状態、前回からの持ち：薄爪・二枚爪・割れ/欠け・深爪・反り爪・ささくれ・甘皮の状態、地爪の伸び方と、何週間持ったか・どの指が浮いた（リフト）/欠けたか・原因の推測（数字と指の名前で記録）',
      '実施した施術：オフの方法（フィルイン/アセトン）、ベース/トップの製品、長さ出しの有無、ケア内容、アートの詳細',
      '仕上がりへの反応と施術の快適さの好み：形・長さ・色の満足度、微調整の要望（「次は1mm短く」など）、マシンの熱さ、苦手な工程、会話したいか静かに過ごしたいか',
      '手の使い方・生活・個人メモ：仕事の制約（PC作業・水仕事・医療職の長さ/色規定）、家事・育児・スポーツ、家族・趣味の話題（持ちと長さ設計に直結）',
      'ホームケア指導：キューティクルオイルの頻度、水仕事の手袋、自分で剥がさない/削らない指導',
      '次回・プラン：次回予約、推奨周期（3〜4週など）、次回のデザイン案・イベント予定（結婚式・旅行のブライダルネイルは日付を数字で）・季節デザインの話、施術者が約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      "Today's order and design: color number/brand, design details (one-color, French, gradient, art specifics), length and shape (square/oval etc.), reference-image features",
      'Allergies and nail-trouble history: gel (HEMA) allergy, acetone stinging, post-appointment itching or redness, past greenies (pseudomonas) — top priority; decides what can safely be applied',
      'Nail/cuticle condition and retention since last set: thin or peeling nails, splits/chips, bitten-down nails, curved growth, hangnails, cuticle state, natural growth pattern, plus how many weeks the last set lasted, which fingers lifted or chipped, and the likely cause — with numbers and finger names',
      'Work performed: removal method (fill vs acetone soak-off), base/top products, extensions if any, prep and cuticle care, art details',
      'Reaction to the result and comfort preferences: satisfaction with shape, length, and color, fine-tune requests ("1mm shorter next time"), e-file heat, steps they dislike, chat vs quiet during the appointment',
      'Hands at work, lifestyle & personal notes: job constraints (typing, wet work, healthcare length/color rules), housework, childcare, sports, family/hobby topics — drives durability and length choices',
      'Homecare instructions: cuticle-oil frequency, gloves for wet work, no peeling or filing at home',
      'Next visit and plan: booking, recommended cycle (3–4 weeks), next design ideas and upcoming events (wedding/trip bridal nails with the date in numbers), seasonal art talk, promises made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: 'オーダー', def: '本日のオーダー・デザイン内容（カラー・形・長さ・アート）と、爪に関する好みや目標' },
      { label: '注意', def: '安全・接客上の注意（ジェル（HEMA）アレルギー、アセトンでのしみ、施術後のかゆみ・赤み、グリーンネイルの既往）' },
      { label: '爪の状態', def: '爪・甘皮の状態（薄爪・二枚爪・反り爪など）と前回からの持ち（何週間持ったか・浮いた/欠けた指）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施した内容（オフの方法・ベース/トップ製品・長さ出し・アート）と、仕上がりへのお客様の反応（「いつもの」等の指定はその表現のまま書く）' },
      { label: 'ホームケア', def: '指導したキューティクルオイルの頻度、水仕事の手袋、自分で剥がさない/削らない指導' },
      { label: '生活', def: '仕事の制約（PC作業・水仕事など）、家事・育児・スポーツや、家族・趣味・イベント予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／ネイリストが約束した内容／保留になったデザイン案／継続・更新に関わる意向／回数券・コースの残回数／推奨来店周期。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Order', def: "today's order and design (color, shape, length, art) and any nail preferences or goals" },
      { label: 'Cautions', def: 'safety and service cautions (gel/HEMA allergy, acetone stinging, post-appointment itching or redness, past greenies)' },
      { label: 'Nail condition', def: "nail and cuticle condition (thin, peeling, curved growth, etc.) and retention since the last set (how many weeks, which fingers lifted or chipped); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Service', def: "what was done today (removal method, base/top products, extensions, art) and the customer's reaction to the result (keep 'the usual'-style requests verbatim)" },
      { label: 'Homecare', def: 'recommended cuticle-oil frequency, gloves for wet work, no peeling or filing at home' },
      { label: 'Life', def: 'job constraints (typing, wet work), housework/childcare/sports, and family/hobby/upcoming-event topics useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the technician made / deferred design ideas / renewal intent / ticket or course balance / recommended cycle. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（preference）：「次回は長さを1mm短く、グラデーションは苦手なのでワンカラーを希望」',
      '（treatment）：「ジェルオフ後にベースを塗布、アーモンド形に整え、ミラーパウダーで仕上げ」',
    ],
    goodExamplesEn: [
      '(preference): "Wants 1mm shorter next time, prefers one-color over gradient"',
      '(treatment): "Soaked off old gel, applied base, shaped to almond, finished with mirror powder"',
    ],
    passportFieldsJa: [
      { key: 'style_pref', label: 'デザインの好み', hint: '本人が普段指定するデザイン・形・長さ・色の好み（「いつもの」の内容）' },
      { key: 'allergy_reaction', label: 'アレルギー', hint: 'ジェル・アクリル・除光液など施術で使う薬剤へのアレルギーやかぶれの既往' },
      { key: 'occupation', label: '職業', hint: '仕事内容と爪への影響（PC作業・水仕事・力仕事など、持ちや強度に関わるもの）' },
      { key: 'chief_concern', label: '爪の悩み', hint: '慢性的な爪の悩みや体質（割れやすい・薄い・甘皮トラブルなど。今日だけの状態ではない）' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望来店周期（3週間ごとなど）' },
    ],
    passportFieldsEn: [
      { key: 'style_pref', label: 'Design preference', hint: 'their usual shape, length, and color/design request — what "the usual" means for them' },
      { key: 'allergy_reaction', label: 'Allergies', hint: 'allergies or reactions to gel, acrylic, remover, or other products used in service' },
      { key: 'occupation', label: 'Occupation', hint: 'work and how it affects the nails (typing, wet work, manual labor) — anything affecting durability' },
      { key: 'chief_concern', label: 'Nail concern', hint: "chronic nail issues or traits (brittle, thin, cuticle trouble) — not just today's condition" },
      { key: 'maintenance_pref', label: 'Visit cadence', hint: 'the rebooking rhythm they said they want (e.g., every 3 weeks)' },
    ],
  },
  eyelash_salon: {
    serviceNounJa: '施術', serviceNounEn: 'service',
    roleJa: 'アイリスト', roleEn: 'eyelash technician',
    businessNounJa: 'まつげサロン', businessNounEn: 'eyelash salon',
    primaryFocusJa: 'まつげの健康・カールの持ち・リピートサイクル',
    primaryFocusEn: 'lash health, curl retention, and repeat cycle',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['持ちの低下', 'グルーへの感度', '自まつげの弱り'],
    typicalConcernsEn: ['retention dropping mid-cycle', 'sensitivity to glue', 'natural lash thinning'],
    captureChecklistJa: [
      '本日のオーダー・デザイン：エクステの本数・長さ（mm）・カール（J/C/D）・太さ、またはまつげパーマ/パリジェンヌの種類、参考イメージ — 数値は必ず記録',
      'グルー・薬剤への反応歴：グルーアレルギー、施術中のしみ/赤み/腫れ、テープかぶれ、目の疾患・眼科通院、コンタクト使用 — 施術可否に直結するため最優先で記録',
      '自まつげの状態と前回からの持ち（リテンション）：量・太さ・強さ・抜けやすさ・生え癖・下がりまつげ、まぶたの形（一重/奥二重）と、何週間持ったか・残り本数・取れやすい箇所・原因の推測（こすった・うつ伏せ寝・クレンジング）— 数字で記録',
      '実施した施術：実際に装着した本数・長さ・カール・太さ・使用グルー。パーマならロッドと薬剤の設定',
      '施術中・仕上がりへの反応と快適さの好み：しみたか・怖がったか、仕上がりの満足度、次回への要望（「もう少し長く」など）、テープの位置、ライトのまぶしさ、会話か静かに寝たいか',
      '目元の生活習慣・個人メモ：クレンジングの種類（マツエクOKか）、ビューラー/マスカラの習慣、うつ伏せ寝、花粉症で目をこするか、仕事・家族の話題（持ちに直結）',
      'ホームケア指導：目元の洗い方・乾かし方、コーティング剤、触らない/こすらない指導',
      '次回・プラン：リペア/付け替えの推奨周期（3週など）、次回予約、次回のデザイン変更案、イベント・旅行の予定（プール・温泉は持ちに影響 — 日付を数字で）、施術者が約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      "Today's order and design: extension count, length (mm), curl (J/C/D), thickness — or lash lift/Parisienne type; reference image. Always record the numbers",
      'Reaction history to glue and products: glue allergy, stinging/redness/swelling during application, tape irritation, eye conditions or ophthalmology visits, contact lenses — top priority; decides whether and how to proceed',
      'Natural lash condition and retention since last visit: density, thickness, strength, shedding tendency, growth direction, downward-pointing lashes, eyelid shape (monolid/hidden crease), plus how many weeks it lasted, lashes remaining, where they shed first, and likely cause (rubbing, sleeping face-down, cleanser) — record with numbers',
      'Work performed: actual count, lengths, curls, and thickness applied, glue used; for lifts, rod and solution settings',
      'Reaction during/after and comfort preferences: any stinging or nervousness, satisfaction with the result, next-time requests ("a bit longer"), tape placement, light sensitivity, chat vs quiet nap during the appointment',
      'Eye-area habits & personal notes: cleanser type (extension-safe or not), curler/mascara use, sleeping face-down, eye-rubbing from hay fever, work/family topics — all drive retention',
      'Homecare instructions: how to wash and dry the lash line, coating serum, no touching or rubbing',
      'Next visit and plan: recommended refill/redo cycle (e.g. 3 weeks), booking, design changes for next time, events and trips (pools and hot springs affect retention — record dates in numbers), promises made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: 'オーダー', def: '本日のオーダー・デザイン（本数・長さ・カール・太さ、参考イメージ）と、まつげに関する好みや目標' },
      { label: '注意', def: '安全・接客上の注意（グルーアレルギー、施術中のしみ/赤み/腫れ、テープかぶれ、目の疾患・眼科通院、コンタクト使用）' },
      { label: 'まつげの状態', def: '自まつげの状態（量・太さ・生え癖・下がりまつげ等）と前回からの持ち（リテンション。何週間持ったか・取れやすい箇所）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施した本数・長さ・カール・太さ・使用グルー（パーマならロッド・薬剤設定）と、仕上がりへのお客様の反応（「いつもの」等の指定はその表現のまま書く）' },
      { label: 'ホームケア', def: '指導した洗い方・乾かし方、コーティング剤、触らない/こすらない指導' },
      { label: '生活', def: 'クレンジングの種類やビューラー/マスカラの習慣、目をこする癖、仕事・家族・イベント予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／アイリストが約束した内容／保留になったデザイン案／継続・更新に関わる意向／回数券・コースの残回数／推奨リペア周期。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Order', def: "today's order and design (count, length, curl, thickness, reference image) and any lash preferences or goals" },
      { label: 'Cautions', def: 'safety and service cautions (glue allergy, stinging/redness/swelling during application, tape irritation, eye conditions or ophthalmology visits, contact lenses)' },
      { label: 'Lash condition', def: "natural lash condition (density, growth direction, downward-pointing lashes, etc.) and retention since last visit (how many weeks, where they shed first); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Service', def: "count, length, curl, and thickness applied today, glue used (rod/solution settings for lifts), and the customer's reaction to the result (keep 'the usual'-style requests verbatim)" },
      { label: 'Homecare', def: 'recommended washing/drying method, coating serum, no touching or rubbing' },
      { label: 'Life', def: 'cleanser type, curler/mascara habits, eye-rubbing tendency, work/family/upcoming-event topics useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the technician made / deferred design ideas / renewal intent / ticket or course balance / recommended refill cycle. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（preference）：「下がりまつげが気になるのでカールはCで長さは9mmを希望」',
      '（treatment）：「120本装着、カールC、太さ0.15mm、グルーは低刺激タイプを使用」',
    ],
    goodExamplesEn: [
      '(preference): "Self-conscious about downward-pointing lashes, wants C curl at 9mm"',
      '(treatment): "Applied 120 extensions, C curl, 0.15mm thickness, used low-irritation glue"',
    ],
    passportFieldsJa: [
      { key: 'style_pref', label: 'デザインの好み', hint: '本人が普段指定するカール・ボリューム・長さの好み（「いつもの」の内容）' },
      { key: 'allergy_reaction', label: 'アレルギー', hint: 'グルー（接着剤）など施術で使う薬剤へのアレルギー・かぶれの既往（施術可否に関わる最優先事項）' },
      { key: 'occupation', label: '職業', hint: '仕事内容や生活スタイルとまつげへの影響（水仕事・汗をかく環境・メイクの濃さなど）' },
      { key: 'chief_concern', label: 'まつげの悩み', hint: '自まつげの慢性的な状態（弱り・抜けやすさ）や持ちに関する悩み（今日だけの状態ではない）' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望来店周期（3週間ごとなど）' },
    ],
    passportFieldsEn: [
      { key: 'style_pref', label: 'Design preference', hint: 'their usual curl, volume, and length request — what "the usual" means for them' },
      { key: 'allergy_reaction', label: 'Allergies', hint: 'allergy or sensitivity to lash glue or other products used in service — top priority, affects whether service can proceed' },
      { key: 'occupation', label: 'Occupation', hint: 'work or lifestyle factors affecting the lashes (wet environments, sweating, heavy makeup)' },
      { key: 'chief_concern', label: 'Lash concern', hint: "chronic natural-lash condition (thinning, shedding) or retention issues — not just today's state" },
      { key: 'maintenance_pref', label: 'Visit cadence', hint: 'the rebooking rhythm they said they want (e.g., every 3 weeks)' },
    ],
  },
  massage: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: 'マッサージセラピスト', roleEn: 'massage therapist',
    businessNounJa: 'マッサージ店', businessNounEn: 'massage studio',
    primaryFocusJa: '筋肉の緊張パターンとリラクゼーション効果',
    primaryFocusEn: 'muscle tension patterns and relaxation outcomes',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['慢性的な肩の張り', 'デスクワークによる腰の疲労', '施術後の睡眠の質'],
    typicalConcernsEn: ['chronic shoulder tension', 'lower-back fatigue from desk work', 'sleep quality after sessions'],
    captureChecklistJa: [
      '主訴：どこが凝っている・張っている・痛いか、いつから、きっかけ（デスクワーク・運転・スポーツ・睡眠）。期間（「半年」「1年近く」など）は必ず数字で記録',
      '既往歴・禁忌：過去のケガ・手術・ヘルニア・高血圧・妊娠・服薬など、避けるべき部位や強さの制限 — 施術の安全に直結するため最優先で記録',
      'セラピストの所見と実施した施術：触診で見つけたコリ・張り・左右差・むくみ・冷え・呼吸の浅さと、コースと時間（全身60分など）・重点部位・手技（指圧・オイル・リンパ・ヘッド・ストレッチ）・使用オイル',
      '施術への反応：楽になった箇所、「ここが効いた」、途中で眠ったか、施術後の体の変化 — ニュアンスごと記録',
      '圧の好みと環境の好み：全体の強さの好み、部位ごとの圧（「肩は強め・ふくらはぎは弱め」）、痛がった/くすぐったがった箇所、もみ返しの既往、会話したいか静かに過ごしたいか、部屋の温度・音楽、苦手な体勢（うつ伏せが苦しいなど）',
      'セルフケア指導：教えたストレッチ・温め方・姿勢や休息のアドバイス（秒数・回数・頻度も記録）',
      '生活習慣・個人メモ：仕事（デスクワーク/立ち仕事の時間）、睡眠の質、運動、入浴習慣など疲労の原因になるものと、家族・趣味・予定など次回の会話に活きる話題',
      '次回・プラン：次回予約、推奨来店頻度、次回に重点したい部位、セラピストが約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief complaint: where it\'s stiff, tight, or painful, since when, and the trigger (desk work, driving, sport, sleep). Always record durations as numbers ("6 months", "almost a year")',
      'History and contraindications: past injuries, surgeries, herniated discs, high blood pressure, pregnancy, medications — areas to avoid or limit pressure on; top priority for safety',
      "Therapist's findings and treatment given: knots, tightness, left-right imbalance, swelling, coldness, shallow breathing found on palpation, plus course and duration (e.g. 60-min full body), focus areas, techniques (shiatsu, oil, lymphatic, head, stretching), oil used",
      'Response to treatment: what released, "that spot really worked", whether they fell asleep, how the body felt afterward — capture the nuance',
      'Pressure and environment preferences: overall strength preference, per-area pressure ("firm on shoulders, light on calves"), spots that hurt or tickled, history of post-massage soreness, chat vs quiet, room temperature, music, positions they find uncomfortable (e.g. face-down)',
      'Self-care taught: stretches, heat routines, posture and rest advice — with seconds, reps, and frequency',
      'Lifestyle & personal notes: work (hours at a desk / on their feet), sleep quality, exercise, bathing habits — the sources of their fatigue, plus family, hobbies, and plans useful next visit',
      'Next visit and plan: booking, recommended frequency, areas to focus on next time, promises the therapist made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: 'お客様の訴え（凝り・張り・痛みの部位・いつから・きっかけ）' },
      { label: '注意', def: '安全・接客上の注意（既往歴・手術歴・ヘルニア・高血圧・妊娠・服薬・避けるべき部位や強さの制限）' },
      { label: '所見', def: 'セラピストが触診で見つけたコリ・張り・左右差・むくみ・冷えなどの所見。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施したコース・時間・重点部位・手技・使用オイルと、お客様の反応（楽になった箇所・「ここが効いた」等。「いつもの」等の指定はその表現のまま書く）' },
      { label: 'セルフケア', def: '指導したストレッチ・温め方・姿勢や休息のアドバイス（秒数・回数・頻度）' },
      { label: '生活', def: '仕事・睡眠・運動などの生活習慣や、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／セラピストが約束した内容／保留になった提案／継続・更新に関わる意向／回数券の残回数／推奨来店頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Concerns', def: "the customer's complaint (where it's stiff/tight/painful, since when, trigger)" },
      { label: 'Cautions', def: 'safety and service cautions (injury/surgery history, herniated discs, high blood pressure, pregnancy, medications, areas or pressure to avoid)' },
      { label: 'Findings', def: "the therapist's palpation findings (knots, tightness, left-right imbalance, swelling, coldness); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "today's course, duration, focus areas, techniques, and oil used, and the customer's reaction (what released, \"that spot really worked\"; keep 'the usual'-style requests verbatim)" },
      { label: 'Self-care', def: 'stretches, heat routines, posture and rest advice taught (seconds, reps, frequency)' },
      { label: 'Life', def: 'lifestyle (work, sleep, exercise) and personal topics (family, hobbies, plans) useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the therapist made / deferred proposals / renewal intent / ticket balance / recommended frequency. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「右肩甲骨まわり：2ヶ月前から張りを感じ、長時間の運転後に悪化」',
      '（treatment）：「セルフケア指導：入浴後に肩甲骨ストレッチ20秒×3回、朝晩」',
    ],
    goodExamplesEn: [
      '(symptom): "Around the right shoulder blade: tightness for ~2 months, worse after long drives"',
      '(treatment): "Self-care coaching: shoulder-blade stretch 20 seconds x 3 reps, morning and night after bathing"',
    ],
    passportFieldsJa: [
      { key: 'pressure_pref', label: '圧・部位の好み', hint: '本人が話した圧の強さの好み（強め・弱めなど）と、重点的に施術してほしい部位' },
      { key: 'body_caution', label: '注意事項', hint: '過去のケガ・手術・妊娠・体調など、圧のかけ方や避けるべき部位に関わる情報（継続的に配慮が必要なもの）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態と、それによる体への負担（デスクワーク・立ち仕事など）' },
      { key: 'chief_concern', label: '主な悩み', hint: '慢性的・繰り返し話題になる体の張りや悩み（今日だけの症状ではない）' },
      { key: 'maintenance_pref', label: 'メンテナンス希望', hint: '本人が話した希望来店ペース（月1など）' },
    ],
    passportFieldsEn: [
      { key: 'pressure_pref', label: 'Pressure preference', hint: 'the pressure strength they said they like (firm, gentle, etc.) and which areas they want focused on' },
      { key: 'body_caution', label: 'Body cautions', hint: "past injuries, surgery, pregnancy, or conditions affecting pressure or areas to avoid — ongoing, not just today's state" },
      { key: 'occupation', label: 'Occupation', hint: 'work and the physical strain it causes (desk work, standing, etc.)' },
      { key: 'chief_concern', label: 'Chief concern', hint: "chronic tension or concerns that come up repeatedly — not just today's symptom" },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence they said they want' },
    ],
  },
  chiropractic: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: 'カイロプラクター', roleEn: 'chiropractor',
    businessNounJa: '整体院', businessNounEn: 'chiropractic clinic',
    primaryFocusJa: '背骨のアライメント・姿勢バランス・動作の回復',
    primaryFocusEn: 'spinal alignment, postural balance, and movement recovery',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['PC作業による頚椎のゆがみ', '骨盤の回旋パターン', '一時的なこわばり vs 構造的な変化'],
    typicalConcernsEn: ['cervical misalignment from screen time', 'pelvic rotation patterns', 'recurring stiffness vs. structural changes'],
    captureChecklistJa: [
      '主訴：どこが・いつから・きっかけ・どんな動作や時間帯で痛むか。期間は数字で記録（「半年」→「約6ヶ月」）。前回からの改善/悪化/不変や頻度の変化が分かる場合も数字で記載（「頭痛が週3→1」等）',
      '既往歴・外傷・手術歴・体内金属：過去のケガ・手術・プレート/ピン等の体内金属・ヘルニア等の診断歴・可動制限 — 施術の安全に直結するため最優先',
      '検査所見と実施した施術：姿勢分析（猫背・ストレートネック・骨盤の傾き/回旋・左右差）・可動域テスト・触診での筋緊張と関節の動き、どの部位に何を行ったか（矯正/アジャスト・骨盤矯正・モビリゼーション・筋膜リリース・牽引など）',
      '施術への反応と刺激の好み：矯正音への反応・怖がり、楽になった/響いた等の感想、ボキボキ系の可否、強さの好み、痛がった箇所、もみ返しの傾向',
      'セルフケア・エクササイズ指導：教えた体操・ストレッチのフォーム要点（秒数・回数・姿勢）、お客様の自己流の誤りを正した内容',
      '生活・姿勢習慣と個人メモ：デスクワーク時間・スマホ姿勢・枕/マットレス・足組み/カバンの持ち方など原因になる習慣。仕事・家族・趣味・予定など次回の会話に活きる話題',
      '次回・プラン：予約日時、推奨来院頻度、施術計画（集中期→維持期の移行目安）、施術者がお客様に約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief complaint: where, since when, what triggered it, which movements or times of day hurt. Convert durations to figures ("half a year" → "~6 months"). Also note improvement/worsening/unchanged or frequency change vs last time when the conversation shows it (e.g. "headaches 3x/week → 1x")',
      'History, injuries, surgeries, implanted metal: past injuries, operations, implanted metal (plates, pins), disc-herniation or other diagnoses, movement restrictions — top priority, directly affects treatment safety',
      'Examination findings and treatment performed: posture analysis (rounded shoulders, forward-head posture, pelvic tilt/rotation, left-right imbalance), range-of-motion tests, palpated muscle tension and joint movement; what was done where (adjustment, pelvic correction, mobilization, myofascial release, traction)',
      'Response to treatment and stimulus preferences: reaction to the cracking/cavitation, nervousness, relief or referred sensation; OK with audible adjustments or not, strength preference, spots that hurt or rang, tendency to post-treatment soreness',
      "Self-care and exercises taught: form keys for prescribed stretches/exercises (seconds, reps, position), corrections made to the client's own faulty technique",
      'Daily and postural habits, and personal notes: desk hours, phone posture, pillow and mattress, leg-crossing, bag-carrying habits driving the problem; work, family, hobbies, plans useful next visit',
      'Next visit and plan: booking, recommended visit frequency, care plan (shift from corrective to maintenance phase), promises the practitioner made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: 'お客様の訴え（部位・いつから・きっかけ・悪化する動作や時間帯）' },
      { label: '注意', def: '安全上の注意（既往歴・手術歴・体内金属・ヘルニア等の診断歴・可動制限・矯正音や施術への不安・もみ返しの傾向）' },
      { label: '状態', def: '本日の所見（姿勢分析・可動域テスト・触診での筋緊張・左右差）と原因の見立て。前回からの変化が会話から分かる場合に限り改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施した施術（矯正/アジャスト・骨盤矯正・モビリゼーション・筋膜リリース・牽引等）と、それへのお客様の反応（矯正音への反応・楽になった/響いた等。「いつもの」等の指定はその表現のまま書く）' },
      { label: 'セルフケア', def: '指導した体操・ストレッチ（フォームの要点・秒数/回数・姿勢・正した誤り）' },
      { label: '生活', def: 'デスクワーク・スマホ姿勢・枕/マットレスなど原因になる生活習慣、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／施術者が約束した内容（重点部位の変更等）／保留になった提案／継続・更新に関わるお客様の意向／回数券の残回数／推奨来院頻度／集中期から維持期への移行目安。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Concerns', def: "the customer's complaint (area, since when, trigger, and which movements or times of day worsen it)" },
      { label: 'Cautions', def: 'safety cautions (injury/surgery history, implanted metal, disc-herniation or other diagnoses, movement restrictions, fear of adjustments or the cracking sound, soreness tendency)' },
      { label: 'Condition', def: "today's findings (posture analysis, range-of-motion tests, palpated muscle tension, left-right imbalance) and the practitioner's assessment; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "what was done today (adjustment, pelvic correction, mobilization, myofascial release, traction) and the customer's response (reaction to the cracking/cavitation, relief or referred sensation; keep 'the usual'-style requests verbatim)" },
      { label: 'Self-care', def: 'homework taught (stretches/exercises, form keys — seconds, reps, position — and corrected mistakes)' },
      { label: 'Life', def: 'desk hours, phone posture, pillow/mattress, leg-crossing, and bag-carrying habits driving the problem; family, hobbies, and plans useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the practitioner made (e.g. shifting focus areas) / deferred proposals / renewal or continuation intent / ticket balance / recommended visit frequency / criteria for shifting from the corrective to maintenance phase. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「右腰：2ヶ月前から前屈時に痛み、長時間の運転後に悪化」',
      '（treatment）：「セルフケア指導：骨盤前傾ストレッチを1日3回×30秒、反動をつけずに行う」',
    ],
    goodExamplesEn: [
      '(symptom): "Right lower back: pain on forward bending since ~2 months ago, worse after long drives"',
      '(treatment): "Self-care coaching: pelvic-tilt stretch, 3x/day × 30 seconds, no bouncing"',
    ],
    passportFieldsJa: [
      { key: 'contraindications', label: '既往歴・注意', hint: '外傷・手術歴・体内の金属・可動制限・服薬・アレルギーなど施術安全に関わるお客様本人の情報' },
      { key: 'chief_concern', label: '主な悩み', hint: '慢性的・繰り返し話題になる悩み（今日だけの症状ではない）' },
      { key: 'constitution', label: '姿勢の癖', hint: '繰り返し確認される姿勢・骨格の傾向（猫背・反り腰・デスクワークによる張りなど）' },
      { key: 'intensity_pref', label: '強さの好み', hint: '施術の強め/弱めの好み、痛がった・響いた部位、もみ返しの傾向' },
      { key: 'maintenance_pref', label: 'メンテナンス希望', hint: '本人が話した希望来店ペース（週1・月1など）' },
    ],
    passportFieldsEn: [
      { key: 'contraindications', label: 'History & cautions', hint: "injuries, surgeries, implanted metal, movement limits, medication, allergies — the customer's own facts, never staff talk" },
      { key: 'chief_concern', label: 'Chief concern', hint: "chronic, recurring concerns — not just today's symptom" },
      { key: 'constitution', label: 'Postural tendency', hint: 'recurring postural or structural pattern (rounded back, pelvic tilt, desk-work tension) seen across visits' },
      { key: 'intensity_pref', label: 'Pressure preference', hint: 'strong/gentle adjustment preference, spots that hurt or responded, tendency toward soreness after' },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence they said they want' },
    ],
  },
  beauty_chiropractic: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
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
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: '鍼灸師', roleEn: 'acupuncturist',
    businessNounJa: '鍼灸院', businessNounEn: 'acupuncture clinic',
    primaryFocusJa: '経絡のバランス・症状の緩和・体質的傾向',
    primaryFocusEn: 'meridian balance, symptom relief, and constitutional patterns',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['繰り返す頭痛のパターン', '冷え・のぼせのバランス', '生理・消化の不調'],
    typicalConcernsEn: ['recurring headache patterns', 'cold/heat imbalance in extremities', 'menstrual or digestive irregularities'],
    captureChecklistJa: [
      '主訴：症状（痛み・頭痛・不眠・胃腸・生理不順など）、いつから・きっかけ・悪化のタイミング。期間は必ず数字で記録。前回施術後どのくらい楽だったか（「3日は楽だった」等）や症状の頻度の変化が分かれば併せて記載',
      '既往歴・禁忌：手術歴、ペースメーカー（電気鍼の禁忌）、妊娠（禁鍼穴あり）、抗凝固薬などの服薬、金属アレルギー、過去の鍼あたり — 施術の安全に直結するため最優先',
      '東洋医学的所見と実施した施術：舌診（舌質・舌苔）・脈診・腹診の所見、冷え/のぼせ、証・体質の見立て。使用した経穴（ツボ名）、鍼の本数と置鍼時間、灸・電気鍼（パルス）・吸い玉の有無、部位',
      '施術への反応と刺激量の好み：響き（得気）の感じ方、痛がった/怖がった箇所、施術後のだるさ・めまいの有無、響きの好き嫌い、灸の熱さの耐性、細い鍼の希望 — 次回の刺激量設定に必須',
      '体質のサイン：睡眠・食欲・便通・生理周期（周期・痛み）・冷える部位・汗のかき方など問診で出た体質情報',
      '生活習慣と個人メモ：仕事・ストレス・食事・飲酒・カフェイン・入浴など症状に影響するもの。仕事・家族・趣味・予定など次回の会話に活きる話題',
      '次回・プラン：次回予約、推奨来院ペース、治療方針（「まず5回集中」等回数の目安を数字で）、施術者がお客様に約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief complaint: the symptom (pain, headaches, insomnia, digestion, menstrual irregularity), since when, trigger, and what makes it worse. Always record durations as numbers. Also note how long relief lasted after the previous session ("good for 3 days") or symptom-frequency changes when known',
      'History and contraindications: surgeries, pacemaker (rules out electroacupuncture), pregnancy (forbidden points), blood thinners and other medications, metal allergy, past adverse reactions to needling — top priority for safety',
      'East Asian medicine findings and treatment given: tongue (body and coating), pulse, abdominal palpation, cold/heat pattern, constitutional assessment. Points used (by name), number of needles and retention time, moxibustion/electroacupuncture/cupping if any, areas treated',
      'Response to needling and stimulation preferences: how they experience de-qi (the "hibiki" sensation), points that hurt or scared them, post-treatment heaviness or dizziness, enjoys or dislikes the sensation, moxa heat tolerance, requests for thinner needles — essential for setting the next session\'s stimulation level',
      'Constitutional signs: sleep, appetite, bowel habits, menstrual cycle (length, pain), which body parts run cold, sweating pattern',
      'Lifestyle and personal notes: work, stress, diet, alcohol, caffeine, bathing — anything feeding the symptom; work, family, hobbies, plans useful next visit',
      'Next visit and plan: booking, recommended treatment pace, course plan ("5 intensive sessions first" — with numbers), promises the practitioner made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: 'お客様の訴え・症状（部位/症状名・いつから・きっかけ・悪化するタイミング）' },
      { label: '注意', def: '安全上の注意（手術歴・ペースメーカー・妊娠・抗凝固薬等の服薬・金属アレルギー・過去の鍼あたり・鍼への不安）' },
      { label: '所見', def: '東洋医学的所見（舌診・脈診・腹診、冷え/のぼせ、証・体質の見立て）と原因の見立て。前回からの変化が会話から分かる場合に限り改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施した施術（使用した経穴・鍼の本数と置鍼時間・灸/電気鍼/吸い玉の有無）と、それへの反応（響きの感じ方・痛がった箇所・施術後のだるさ/めまい。「いつもの」等の指定はその表現のまま書く）' },
      { label: '養生指導', def: '指導した養生・セルフケア（内容・頻度・正した誤り）' },
      { label: '生活', def: '仕事・ストレス・食事・飲酒・カフェイン・入浴などの生活習慣、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／施術者が約束した内容／保留になった提案／継続・更新に関わるお客様の意向／回数券の残回数／推奨来院ペース／治療方針（集中期の回数目安等）。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Concerns', def: "the customer's complaint/symptom (area or symptom name, since when, trigger, what worsens it)" },
      { label: 'Cautions', def: 'safety cautions (surgeries, pacemaker, pregnancy, blood thinners and other medications, metal allergy, past adverse reactions to needling, fear of needles)' },
      { label: 'Findings', def: "East Asian medicine findings (tongue, pulse, abdominal palpation, cold/heat pattern, constitutional assessment) and the practitioner's read of the cause; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "what was done today (points used, needle count and retention time, moxibustion/electroacupuncture/cupping if any) and the response (de-qi sensation, points that hurt, post-treatment heaviness/dizziness; keep 'the usual'-style requests verbatim)" },
      { label: 'Self-care', def: 'home guidance taught (content, frequency, corrected mistakes)' },
      { label: 'Life', def: 'lifestyle (work, stress, diet, alcohol, caffeine, bathing) and personal topics (family, hobbies, plans) useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the practitioner made / deferred proposals / renewal or continuation intent / ticket balance / recommended pace / treatment-course plan (e.g. intensive session count). Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「慢性的な頭痛：3ヶ月前から週2〜3回、冷えると悪化」',
      '（treatment）：「百会・合谷に置鍼15分、灸を足三里に3壮追加、施術後にだるさなし」',
    ],
    goodExamplesEn: [
      '(symptom): "Chronic headaches: 2–3x/week for ~3 months, worse when cold"',
      '(treatment): "Needled Baihui and Hegu for 15 min, added 3 moxa cones at Zusanli, no heaviness afterward"',
    ],
    passportFieldsJa: [
      { key: 'contraindications', label: '既往歴・禁忌', hint: '出血傾向・ペースメーカー・妊娠・金属アレルギー・服薬など施術安全に関わる患者様本人の情報' },
      { key: 'chief_concern', label: '主な症状', hint: '慢性的・繰り返し出現する症状のパターン（今日だけの症状ではない）' },
      { key: 'constitution', label: '体質', hint: '東洋医学的な体質傾向（冷え性・のぼせ・気虚など）、繰り返し確認されるもの' },
      { key: 'intensity_pref', label: '刺激の好み', hint: '鍼の強さ・響きへの好み、苦手な部位、過去の副反応' },
      { key: 'maintenance_pref', label: '通院ペース希望', hint: '本人が話した希望通院ペース（週1・月1など）' },
    ],
    passportFieldsEn: [
      { key: 'contraindications', label: 'History & contraindications', hint: "bleeding disorders, pacemaker, pregnancy, metal allergy, medication — the patient's own facts, never staff talk" },
      { key: 'chief_concern', label: 'Chief concern', hint: "chronic, recurring symptom pattern — not just today's presentation" },
      { key: 'constitution', label: 'Constitution', hint: 'TCM constitutional pattern (cold-type, heat-prone, qi-deficient, etc.) confirmed across visits' },
      { key: 'intensity_pref', label: 'Stimulation preference', hint: 'preferred needle intensity/sensation, spots to avoid, past adverse reactions' },
      { key: 'maintenance_pref', label: 'Visit cadence preference', hint: 'the visit cadence they said they want' },
    ],
  },
  osteopathy: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: '柔道整復師', roleEn: 'osteopath (judo therapist)',
    businessNounJa: '整骨院', businessNounEn: 'osteopathic clinic',
    primaryFocusJa: '筋骨格系の回復・外傷のリハビリ・急性期のケア',
    primaryFocusEn: 'musculoskeletal recovery, injury rehabilitation, and acute care',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['外傷後の可動域の回復', '慢性的な代償パターン', '競技・日常活動への復帰タイミング'],
    typicalConcernsEn: ['post-injury range-of-motion recovery', 'chronic strain compensation patterns', 'return-to-activity timing'],
    captureChecklistJa: [
      '主訴・受傷機転：何をしていて・いつ・どのように痛めたか（捻挫・打撲・肉離れ・ぎっくり腰など）。受傷日と経過日数は必ず数字で記録',
      '既往歴・手術歴：過去の骨折・脱臼・手術、体内の金属、持病 — 施術の禁忌判断に直結するため最優先',
      '検査・評価と実施した施術：腫脹・熱感・内出血・圧痛点・可動域・筋力・歩行/動作の異常、徒手検査の結果。実施した手技（整復・固定・テーピング・包帯）や物理療法（電療・超音波・アイシング・温熱）と部位',
      '施術への反応と刺激の注意点：施術直後の痛みの変化（「10→6」等の数値）、可動域の変化、腫れの引き具合、痛がった箇所、圧や電気の強さの耐性、固定の窮屈さ',
      '日常生活の指導と負荷要因：安静度・荷重/使用の制限・アイシング/温めの指示・自宅でのテーピング・やってはいけない動作。仕事内容（立ち仕事・重量物）・スポーツ種目と練習頻度・通勤手段など患部への負荷',
      '復帰目標と個人メモ：競技復帰・大会・仕事復帰の目標日（数字で記録）。家族・趣味・部活やチームの話など次回の会話と信頼関係に活きる話題',
      '次回・プラン：通院頻度（急性期は高頻度→漸減）、次回予約、固定除去やリハビリ移行の目安、施術者が約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief complaint and mechanism of injury: what they were doing, when, and how it happened (sprain, contusion, muscle tear, acute low-back). Always record the injury date and days elapsed as numbers',
      'History and surgeries: past fractures, dislocations, operations, implanted metal, underlying conditions — top priority; determines what treatment is safe',
      'Examination and treatment performed: swelling, heat, bruising, tender points, range of motion, strength, gait/movement abnormalities, orthopedic test results. Manual work (reduction, immobilization, taping, bandaging) and physical modalities (e-stim, ultrasound, icing, heat), by area',
      'Response to treatment and stimulus cautions: pain change right after treatment ("10 → 6" — in numbers), range-of-motion change, how the swelling is settling, spots that hurt, tolerance for pressure and e-stim intensity, how the strapping feels',
      'Daily-life instructions and load factors: rest level, weight-bearing or usage limits, ice vs heat orders, self-taping at home, movements to avoid; job demands (standing, heavy lifting), sport and training frequency, commute — everything loading the injured area',
      "Return goals and personal notes: target dates for returning to sport, competition, or work (record as numbers); family, hobbies, team or club talk — fuel for next visit's conversation and trust",
      'Next visit and plan: visit frequency (frequent in the acute phase, then tapering), next booking, when to remove immobilization and shift to rehab, promises the practitioner made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: '受傷機転（何をしていて・いつ・どのように痛めたか）と受傷日・経過日数（保険上重要なため数字で必ず記録）' },
      { label: '注意', def: '安全上の注意（骨折・脱臼・手術歴・体内金属・持病）' },
      { label: '所見', def: '本日の評価（腫脹・熱感・内出血・圧痛点・可動域・筋力・歩行/動作の異常、徒手検査の結果）と原因の見立て。前回からの変化が会話から分かる場合に限り改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施した施術（整復・固定・テーピング・包帯・電療・超音波・アイシング・温熱等）と部位、施術直後の痛みの変化（数値）や可動域・腫れの変化（「いつもの」等の指定はその表現のまま書く）' },
      { label: '生活指導', def: '安静度・荷重/使用の制限・アイシング/温めの指示・やってはいけない動作、仕事/スポーツ/通勤など患部への負荷、復帰目標日（数字で）、家族・趣味・チームの話など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／固定除去やリハビリ移行の目安／施術者が約束した内容／継続・更新に関わるお客様の意向／回数券の残回数／推奨通院頻度（急性期は高頻度→漸減）。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Complaint', def: 'the mechanism of injury (what they were doing, when, how it happened) and the injury date/days elapsed (insurance-relevant — always record as numbers)' },
      { label: 'Cautions', def: 'safety cautions (fractures, dislocations, surgeries, implanted metal, underlying conditions)' },
      { label: 'Findings', def: "today's exam (swelling, heat, bruising, tender points, range of motion, strength, gait/movement abnormalities, orthopedic test results) and the practitioner's assessment; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "what was done today (reduction, immobilization, taping, bandaging, e-stim, ultrasound, icing, heat) and area; pain change right after treatment (in numbers) or range-of-motion/swelling change (keep 'the usual'-style requests verbatim)" },
      { label: 'Guidance', def: 'rest level, weight-bearing/usage limits, ice/heat orders, movements to avoid; job/sport/commute load on the injured area; return-to-activity target date (as numbers); family, hobbies, team talk useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / when to remove immobilization or shift to rehab / promises the practitioner made / renewal or continuation intent / ticket balance / recommended visit frequency (frequent in acute phase, then tapering). Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「右足関節：3日前にバスケ中に捻挫、腫脹と圧痛あり」',
      '（treatment）：「テーピング固定＋アイシング指導、1回15分×1日3回」',
    ],
    goodExamplesEn: [
      '(symptom): "Right ankle: sprained playing basketball 3 days ago, swelling and tenderness present"',
      '(treatment): "Applied taping, instructed icing 15 min × 3/day"',
    ],
    passportFieldsJa: [
      { key: 'contraindications', label: '既往歴・注意', hint: '骨折歴・手術歴・体内の金属・可動制限・服薬など施術安全に関わる患者様本人の情報' },
      { key: 'chief_concern', label: '主な症状', hint: '慢性的に繰り返す患部や代償動作のパターン（今回の急性症状も含む）' },
      { key: 'constitution', label: '代償の癖', hint: '繰り返し確認される代償動作・可動域の傾向（特定の関節を庇う癖など）' },
      { key: 'intensity_pref', label: '強さの好み', hint: '手技・可動域訓練の強め/弱めの好み、痛がった部位、施術後の反応' },
      { key: 'maintenance_pref', label: '通院ペース希望', hint: '本人が話した希望通院ペース（週1・月2など）' },
    ],
    passportFieldsEn: [
      { key: 'contraindications', label: 'History & cautions', hint: "fracture/surgery history, implanted hardware, movement limits, medication — the patient's own facts, never staff talk" },
      { key: 'chief_concern', label: 'Chief concern', hint: "chronic recurring problem area or compensation pattern, including this episode's acute injury" },
      { key: 'constitution', label: 'Compensation pattern', hint: 'recurring compensation movement or ROM tendency (favoring a joint, etc.) seen across visits' },
      { key: 'intensity_pref', label: 'Pressure preference', hint: 'preferred manual-therapy/mobilization intensity, spots that hurt, typical post-treatment response' },
      { key: 'maintenance_pref', label: 'Visit cadence preference', hint: 'the visit cadence they said they want' },
    ],
  },
  yoga_studio: {
    serviceNounJa: 'レッスン', serviceNounEn: 'session',
    roleJa: 'ヨガインストラクター', roleEn: 'yoga instructor',
    businessNounJa: 'ヨガスタジオ', businessNounEn: 'yoga studio',
    primaryFocusJa: '姿勢・柔軟性・呼吸法・練習の進歩',
    primaryFocusEn: 'posture, flexibility, breathwork, and practice progression',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['前屈を制限するハムストリングの硬さ', '逆転系ポーズへの不安', '呼吸と動きの連動'],
    typicalConcernsEn: ['hamstring tightness limiting forward folds', 'inversion anxiety', 'breath-movement coordination'],
    captureChecklistJa: [
      '目的・悩み：ヨガを始めた/通う理由（柔軟性・肩こり・ストレス・睡眠・産後ケアなど）といつから気になっているか。期間（「半年」「1年」など）は必ず数字で記録',
      '体の制限・既往歴：ケガ・手術歴・椎間板ヘルニア・高血圧・妊娠中/産後など、逆転系や深い前屈などの禁忌ポーズの判断に直結する情報 — 最優先で記録',
      '本日の練習内容と所見：行ったアーサナ・シークエンス（ポーズ名で）、使ったプロップス（ブロック・ベルト・ボルスター）、伝えた軽減法（膝を曲げる等）。加えて、前屈での骨盤の後傾・ハムストリングや股関節の硬さ・左右差・肩が上がる癖・呼吸と動きの連動の乱れなど、インストラクターが練習中に見た体の癖',
      'ポーズへの反応と好み：初めてできたポーズ、気持ちよかった/つらかったポーズ、ふらつき・めまいの訴え（本人の言葉のニュアンスごと）。加えてハンズオンアジャストの可否、強度・ペースの好み、痛みが出た/避けたいポーズ',
      '呼吸・瞑想の指導と自宅練習：指導した呼吸法（腹式・ウジャイ等）と呼吸が浅い/止めてしまう等の気づき。宿題にしたポーズ・呼吸法は回数・秒数・頻度まで数字で記録（「寝る前に前屈30秒×3」等）',
      '生活習慣と個人メモ：デスクワーク時間・睡眠・運動習慣・ストレスなど柔軟性や姿勢に影響するもの。加えて仕事・家族・趣味・予定など次回クラス前の声かけに活きる話題',
      '次回・プラン：次回のクラス予約、推奨頻度、次に取り組むポーズやクラスレベル、インストラクターが約束した内容、回数券・月謝コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      "Why they practice: what brought them to yoga (flexibility, stiff shoulders, stress, sleep, postnatal care) and how long it's bothered them. Always record durations as numbers (\"6 months\", \"a year\")",
      'Physical limits & history: injuries, surgeries, disc problems, high blood pressure, pregnancy/postpartum — decides which poses are off-limits (inversions, deep folds) — top priority',
      "Today's practice & observations: asanas/sequence taught (by pose name), props used (blocks, straps, bolster), modifications given (bend the knees, etc.). Plus what the instructor noticed during practice: pelvis tucking in forward folds, tight hamstrings/hips, left-right differences, shoulders creeping up, breath disconnecting from movement",
      'Pose reactions & preferences: a pose achieved for the first time, poses that felt great or brutal, dizziness or wobbling (keep their own words). Plus: OK with hands-on adjustments or not, preferred pace/intensity, poses that caused pain or should be avoided',
      'Breath/meditation coaching & home practice: breathing techniques taught (belly breathing, ujjayi) and habits noticed (shallow breathing, breath-holding). Homework assigned — poses/breathwork with reps, hold times, and frequency in numbers ("forward fold 30s × 3 before bed")',
      'Lifestyle & personal notes: desk hours, sleep, exercise habits, stress — shaping flexibility and posture. Plus work, family, hobbies, plans — fuel for the pre-class chat',
      'Next visit & plan: next class booked, recommended frequency, the next pose or class level to work toward, promises the instructor made, ticket/monthly-pass balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '目的', def: '生徒の目的・悩み・目標（体の悩み・きっかけ。目標に期限がある場合は期限も）' },
      { label: '注意', def: '安全上の注意（既往歴・手術歴・椎間板ヘルニア・高血圧・妊娠中/産後など、禁忌ポーズの判断に関わる情報）' },
      { label: '状態', def: '本日の体の状態、インストラクターの所見（硬さ・左右差・呼吸との連動など）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '練習内容', def: '本日行ったアーサナ・シークエンス、使用したプロップス、軽減法、ポーズへの反応（初めてできた・つらかった等）' },
      { label: 'セルフケア', def: '指導した呼吸法・宿題にしたポーズ（秒数・回数・頻度）' },
      { label: '生活', def: '生活習慣や、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること（宿題にした呼吸法やポーズの実施状況など）／インストラクターがお客様に約束した内容／保留になった提案／回数券・月謝コースの残回数や継続の意向／推奨頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Goals', def: "the student's goals and concerns (body issue, since when, trigger; include deadlines on goals)" },
      { label: 'Cautions', def: 'safety cautions (injuries, surgeries, disc problems, high blood pressure, pregnancy/postpartum — decides which poses are off-limits)' },
      { label: 'Condition', def: "today's body state and the instructor's observations (tightness, imbalance, breath-movement disconnect); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Practice', def: 'asanas/sequence practiced today, props used, and how poses landed (first-time achievements, adjustment and intensity preferences)' },
      { label: 'Self-care', def: 'breathing/meditation techniques taught and home practice assigned (poses/breathwork with reps, hold times, frequency)' },
      { label: 'Life', def: 'lifestyle and personal topics (family, hobbies, plans) useful for the next class' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time (homework follow-up) / promises the instructor made / deferred proposals / ticket or course balance and renewal intent / recommended frequency. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「ハムストリング：3ヶ月前から前屈時に硬さを感じ、デスクワーク後に悪化」',
      '（treatment）：「呼吸指導：ウジャイ呼吸を6呼吸×3セット、吸う時間より吐く時間を長く」',
    ],
    goodExamplesEn: [
      '(symptom): "Hamstrings: tightness in forward folds for about 3 months, worse after desk work"',
      '(treatment): "Breath coaching: ujjayi breath, 6 breaths × 3 sets, exhale longer than inhale"',
    ],
    passportFieldsJa: [
      { key: 'injury_accommodation', label: 'ケガ・制限', hint: '既往のケガ・手術・持病でポーズ調整が必要なもの（ヘルニア・妊娠・膝の手術歴など）。今日だけの筋肉痛は含めない' },
      { key: 'practice_goal', label: '練習目標', hint: '本人が話した練習の目標。数字にできる場合は数字で（開脚180度、瞑想の習慣化など）。その日のストレッチ目標ではない' },
      { key: 'practice_level', label: '経験レベル', hint: 'ヨガの経験レベル（初心者・中級・上級）と継続期間' },
      { key: 'practice_constraint', label: '練習の制約', hint: '好みのクラス形式・時間帯・環境、ケガ以外の理由で避けたいポーズ（例：逆転系への不安）など継続的な希望' },
      { key: 'occupation', label: '職業', hint: '柔軟性や姿勢に影響する仕事内容（デスクワーク・立ち仕事など）' },
    ],
    passportFieldsEn: [
      { key: 'injury_accommodation', label: 'Injury or restriction', hint: 'chronic injury, surgery, or condition needing pose modification (e.g., disc herniation, pregnancy, knee surgery) — not a same-day ache' },
      { key: 'practice_goal', label: 'Practice goal', hint: 'the practice goal they stated, with a number when possible (e.g., full split, daily meditation habit) — a durable goal, not a one-time stretch target' },
      { key: 'practice_level', label: 'Experience level', hint: 'overall yoga experience (beginner, intermediate, advanced) and how long they have practiced' },
      { key: 'practice_constraint', label: 'Practice constraints', hint: 'standing preferences on class style, time slot, or environment — including poses avoided for reasons other than injury (e.g., inversion anxiety)' },
      { key: 'occupation', label: 'Occupation', hint: 'work that affects flexibility or posture (desk work, standing work, etc.)' },
    ],
  },
  pilates_studio: {
    serviceNounJa: 'レッスン', serviceNounEn: 'session',
    roleJa: 'ピラティスインストラクター', roleEn: 'pilates instructor',
    businessNounJa: 'ピラティススタジオ', businessNounEn: 'pilates studio',
    primaryFocusJa: 'コアの安定性・アライメント・コントロールされた動きを通じたボディアウェアネス',
    primaryFocusEn: 'core stability, alignment, and body awareness through controlled movement',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['フットワーク中の骨盤の安定', 'プランクでの肩の使い方', 'リフォーマーから日常姿勢への応用'],
    typicalConcernsEn: ['pelvic stability during footwork', 'shoulder engagement in plank', 'carry-over from reformer to daily posture'],
    captureChecklistJa: [
      '目的・悩み：ピラティスを始めた/通う理由（姿勢改善・腰痛・産後の骨盤・体幹強化・ボディライン）といつからか。期間は必ず数字で記録',
      '既往歴・体の制限：椎間板ヘルニア・骨粗しょう症（屈曲系エクササイズの禁忌）・妊娠中/産後・手術歴・関節の問題など、エクササイズ選択の安全に直結する情報 — 最優先で記録',
      '本日のエクササイズと所見：使った機種（マット/リフォーマー/キャデラック等）・エクササイズ名（フットワーク・ハンドレッド・ロールアップ等）・スプリングの重さ・回数。加えて骨盤の安定性・肋骨の開き・腹筋系での首の力み・左右差・呼吸パターン（胸式/腹式）・代償動作の所見と、前回からの変化（腰痛の頻度・立ち姿勢・ウエストのフィット感の変化など、改善/悪化/不変で）',
      'エクササイズへの反応と注意点：狙った筋肉に入った/代償が出た、「初めてお腹で支える感覚がわかった」等の気づき。加えて首や腰に痛みが出た動き・避けるべきエクササイズ・スプリングの重さやペースの好み',
      '自宅エクササイズ・日常姿勢の指導：宿題（種目・回数・頻度）と、日常での意識づけ（座り方・呼吸・引き上げのキュー）',
      '生活習慣と個人メモ：デスクワーク・抱っこや育児・運動習慣・睡眠など姿勢や体幹に影響するもの。加えて仕事・家族・趣味・予定など次回の会話に活きる話題',
      '次回・プラン：次回予約、推奨頻度、次に進むエクササイズ・負荷アップの計画、インストラクターが約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Why they come: goals (better posture, low-back pain, postpartum pelvis, core strength, body line) and how long the issue has existed — durations as numbers',
      'History & contraindications: disc herniation, osteoporosis (no loaded flexion), pregnancy/postpartum, surgeries, joint problems — drives safe exercise selection — top priority',
      "Today's session & observations: apparatus used (mat, reformer, Cadillac), exercises by name (footwork, hundred, roll-up), spring settings and reps. Plus the instructor's observations — pelvic stability, rib flare, neck gripping in ab work, left-right imbalance, breathing pattern (chest vs belly), compensation habits — and change since last session (less back pain, standing taller, how the waistband fits — improved/worse/unchanged)",
      'Response & cautions: whether the target muscle fired or compensation took over, breakthroughs ("first time I felt my abs actually support me"). Plus movements that flared the neck or lower back, exercises to avoid, spring-load and pacing preferences',
      'Homework & daily-posture cues: assigned exercises (name, reps, frequency) and everyday cues taught (how to sit, breathing, lengthening cues)',
      "Lifestyle & personal notes: desk hours, carrying kids, exercise habits, sleep — shaping posture and core function. Plus work, family, hobbies, plans — fuel for next session's conversation",
      'Next visit & plan: next booking, recommended frequency, which exercises or resistance to progress to, promises the instructor made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '目的', def: '生徒の目的・悩み・目標（部位・きっかけ。目標に期限がある場合は期限も）' },
      { label: '注意', def: '安全上の注意（椎間板ヘルニア・骨粗しょう症・妊娠中/産後・手術歴・関節の問題など、エクササイズ選択に関わる情報）' },
      { label: '状態', def: '本日の体の状態、インストラクターの所見（骨盤の安定性・代償動作・呼吸パターンなど）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: 'エクササイズ', def: '本日実施したエクササイズ（機種・種目・スプリング・回数）とお客様の反応' },
      { label: 'セルフケア', def: '指導した宿題エクササイズ（種目・回数・頻度）と日常での姿勢キュー' },
      { label: '生活', def: '生活習慣や、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること（宿題のエクササイズの実施状況や体の変化など）／インストラクターがお客様に約束した内容／保留になった提案／回数券・コースの残回数や継続の意向／推奨頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Goals', def: "the student's goals and concerns (posture, pain, core, body line — since when; include deadlines)" },
      { label: 'Cautions', def: 'safety cautions (disc herniation, osteoporosis, pregnancy/postpartum, surgeries, joint problems — decides safe exercise selection)' },
      { label: 'Condition', def: "today's body state and the instructor's observations (pelvic stability, compensation, breathing pattern); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Exercises', def: 'apparatus and exercises performed today (name, spring settings, reps) and how they landed (target muscle engaged or compensation)' },
      { label: 'Self-care', def: 'homework exercises assigned (name, reps, frequency) and daily-posture cues taught' },
      { label: 'Life', def: 'lifestyle and personal topics (family, hobbies, plans) useful next session' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the instructor made / deferred proposals / ticket or course balance and renewal intent / recommended frequency. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「腰部：産後3ヶ月ほど前から反り腰による張りを感じ、抱っこ後に悪化」',
      '（treatment）：「エクササイズ指導：リフォーマーのフットワーク、スプリング2本×10回×3セット、骨盤を動かさない意識で」',
    ],
    goodExamplesEn: [
      '(symptom): "Lower back: tightness from anterior pelvic tilt since giving birth about 3 months ago, worse after carrying the baby"',
      '(treatment): "Exercise coaching: reformer footwork, 2 springs × 10 reps × 3 sets, cueing to keep the pelvis still"',
    ],
    passportFieldsJa: [
      { key: 'injury_accommodation', label: 'ケガ・制限', hint: '手術歴・産後・慢性的な症状など種目調整が必要な既往（産後の腹直筋離開、膝靭帯再建術後など）。当日だけの筋肉痛は含めない' },
      { key: 'practice_goal', label: '練習目標', hint: '本人が話した継続的な目標。数字や期限がある場合は含める（◯ヶ月後に競技復帰、姿勢改善など）' },
      { key: 'practice_level', label: '経験レベル', hint: 'マシン（リフォーマー等）とマットそれぞれの経験・慣れ具合' },
      { key: 'practice_constraint', label: '練習の制約', hint: '器具の好み（リフォーマー・マット等）やクラス形式・時間帯など継続的な希望' },
      { key: 'referral_source', label: '紹介元', hint: '医師・理学療法士からの紹介の場合はその理由（産後・術後リハビリなど）。通常の紹介・検索も含む' },
    ],
    passportFieldsEn: [
      { key: 'injury_accommodation', label: 'Injury or restriction', hint: 'post-surgical status, postpartum condition, or chronic issue needing exercise modification (e.g., diastasis recti postpartum, ACL reconstruction) — not a same-day ache' },
      { key: 'practice_goal', label: 'Practice goal', hint: 'the durable goal they stated, with a number or deadline when given (e.g., return to sport in 3 months, posture correction)' },
      { key: 'practice_level', label: 'Experience level', hint: 'comfort and experience with apparatus (reformer, etc.) versus mat work' },
      { key: 'practice_constraint', label: 'Practice constraints', hint: 'standing preferences on equipment (reformer versus mat), class style, or time slot' },
      { key: 'referral_source', label: 'Referral source', hint: 'physician or physical-therapist referral and the reason (postpartum, post-surgical rehab, etc.), or the usual referral or search source' },
    ],
  },
  personal_gym: {
    serviceNounJa: 'トレーニング', serviceNounEn: 'training',
    roleJa: 'パーソナルトレーナー', roleEn: 'personal trainer',
    businessNounJa: 'パーソナルジム', businessNounEn: 'personal training gym',
    primaryFocusJa: '筋力の進捗・コンディショニング・体組成の目標',
    primaryFocusEn: 'strength progression, conditioning, and body-composition goals',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['スクワットの深さの制限', 'オーバーヘッド動作を妨げる肩の可動域', 'セッション間の減量の継続'],
    typicalConcernsEn: ['squat depth limitation', 'shoulder mobility restricting overhead work', 'weight-cut adherence between sessions'],
    captureChecklistJa: [
      '目標と数値：減量/増量/ボディメイクの目標（目標体重・体脂肪率・大会や結婚式などの期限）— 数字と期日を必ず記録',
      '既往歴・痛み：過去のケガ・手術・関節の痛み、種目中に出た痛み（「ベンチプレスで手首が痛い」等）— メニュー設計の安全に直結するため最優先で記録',
      '本日の計測とトレーニング内容：体重・体脂肪率・周囲径など測った数値と前回からの増減。種目×重量×回数×セット（「スクワット80kg×8回×3セット」）。自己ベスト更新は必ず記録',
      'フォームの所見とトレーニングへの反応：しゃがみの深さ・膝の内側への倒れ・可動域の制限・左右差などトレーナーが見つけた課題。加えてきつさ（RPE・限界感）、効いた部位、前回の筋肉痛の出方と回復具合',
      '食事・睡眠・生活：たんぱく質量・実際の食事内容・飲酒・チートの有無（守れた/守れなかったも含めて具体的に）。加えて睡眠時間・仕事のスケジュール・歩数・ストレスなど回復と継続に影響するもの',
      'モチベーションと宿題：やる気・停滞感・不安の発言（次回の声かけとメニュー調整の材料としてニュアンスごと）。加えて自主トレ・有酸素の指示（種目・時間・頻度）と食事の改善指示',
      '次回・プラン：次回予約、次のフェーズ（増量期/減量期・重量アップの計画）、トレーナーが約束した内容、契約・パッケージの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Goals with numbers: cut/bulk/recomp targets (goal weight, body-fat %, deadline events like a competition or wedding) — always record the numbers and dates',
      'Injury history & pain: past injuries and surgeries, joint pain, anything that hurt during a lift ("wrist pain on bench press") — drives safe programming — top priority',
      "Today's measurements & training: body weight, body-fat %, girth measurements with the change vs last time. Exercise × load × reps × sets (\"squat 80kg × 8 × 3\"). Always record new PRs",
      'Form observations & response to training: squat depth, knees caving in, mobility restrictions, side-to-side differences the trainer spotted. Plus how hard it felt (RPE, near-failure), where they felt it working, and soreness/recovery from the last session',
      'Diet, sleep & life load: what they actually ate — protein, alcohol, cheat meals — adherence wins and slips, in concrete terms. Plus sleep hours, work schedule, step count, stress affecting recovery and adherence',
      'Motivation & homework: fired up, plateaued, or discouraged — their own words as material for coaching. Plus assigned solo workouts/cardio (exercise, duration, frequency) and diet instructions',
      'Next visit & plan: next session, the next phase (bulk/cut, load-progression plan), promises the trainer made, contract/package balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '目標', def: 'お客様の減量/増量/ボディメイクの目標（目標体重・体脂肪率・期限）' },
      { label: '注意', def: '既往歴・関節の痛み・種目中に出た痛みなど、メニュー設計の安全に関わる情報' },
      { label: '計測', def: '本日測った体重・体脂肪率・周囲径などの数値と前回からの増減' },
      { label: 'トレーニング', def: '本日実施したトレーニング内容（種目×重量×回数×セット、自己ベスト更新）とフォームの所見、きつさ・効いた部位への反応' },
      { label: '食事', def: '実際の食事内容・たんぱく質量・飲酒・チートの有無と、守れた/守れなかったの評価' },
      { label: '生活', def: '睡眠時間・仕事のスケジュール・歩数・ストレスなど回復と継続に影響するもの' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること（食事や自主トレの実施状況など）／トレーナーがお客様に約束した内容（メニュー変更・期限延長など）／保留になった提案／契約回数・パッケージの残回数や継続の意向／次のフェーズ（増量期/減量期）の計画。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Goals', def: 'cut/bulk/recomp targets (goal weight, body-fat %, deadline events) with numbers and dates' },
      { label: 'Cautions', def: 'injury history, joint pain, or pain that came up during a lift — drives safe programming' },
      { label: 'Measurements', def: "today's weight, body-fat %, and girth measurements with the change vs last time" },
      { label: 'Training', def: 'exercises performed today (load × reps × sets, new PRs) and form observations from the trainer' },
      { label: 'Diet', def: 'what they actually ate (protein, alcohol, cheat meals) and how well they followed the plan' },
      { label: 'Life', def: 'sleep hours, work schedule, steps, and stress affecting recovery and adherence' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: the next phase (bulk/cut, load progression) / promises the trainer made (menu changes, deadline extensions) / deferred proposals / package or contract balance and renewal intent / motivation notes. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「右膝：2ヶ月前にスクワットを再開してから違和感があり、深くしゃがむと痛む」',
      '（treatment）：「トレーニング：スクワット70kg×8回×3セット、深さを膝の高さまでに調整」',
    ],
    goodExamplesEn: [
      '(symptom): "Right knee: discomfort since resuming squats about 2 months ago, hurts on deep flexion"',
      '(treatment): "Training: squat 70kg × 8 reps × 3 sets, depth capped at knee height"',
    ],
    passportFieldsJa: [
      { key: 'injury_accommodation', label: 'ケガ・制限', hint: '既往のケガ・手術や可動域の慢性的な制限（肩腱板断裂、腰椎ヘルニア、肩の可動域制限など）。当日の筋肉痛・張りは含めない' },
      { key: 'training_goal', label: 'トレーニング目標', hint: '本人が話した数値目標（体重-◯kg、スクワット◯kg、体脂肪率◯%など）。期限があれば期限も' },
      { key: 'training_level', label: 'レベル', hint: 'トレーニング歴と現在のレベル（種目の重量・回数など分かる場合はその基準値）' },
      { key: 'training_constraint', label: '制約', hint: '器具の好みや、ケガ以外の理由で避けたいトレーニング内容など継続的な制約' },
      { key: 'diet_constraint', label: '食事の傾向', hint: '体組成目標に関わる食事の傾向・制約（ベジタリアン、断食時間帯、アレルギーなど）' },
    ],
    passportFieldsEn: [
      { key: 'injury_accommodation', label: 'Injury or restriction', hint: 'chronic injury, surgery, or a lasting mobility restriction (e.g., rotator cuff tear, lumbar disc herniation, limited shoulder overhead mobility) — not same-day soreness' },
      { key: 'training_goal', label: 'Training goal', hint: 'the numeric goal they stated (e.g., -10kg, squat 100kg, 20% body fat), including the deadline when given' },
      { key: 'training_level', label: 'Level', hint: 'training age and current level — benchmark weights or reps when stated' },
      { key: 'training_constraint', label: 'Constraints', hint: 'standing preferences on equipment, or training elements they prefer to skip for non-injury reasons' },
      { key: 'diet_constraint', label: 'Diet pattern', hint: 'dietary pattern or constraint relevant to body-composition goals (vegetarian, fasting window, allergies)' },
    ],
  },
  dental_clinic: {
    serviceNounJa: '処置', serviceNounEn: 'procedure',
    roleJa: '歯科医', roleEn: 'dentist',
    businessNounJa: '歯科医院', businessNounEn: 'dental clinic',
    primaryFocusJa: '口腔健康・治療履歴・治療計画・審美',
    primaryFocusEn: 'oral health, dental history, treatment planning, and aesthetics',
    seasonalRelevance: 'low', clinicalPosture: 'clinical',
    typicalConcernsJa: ['特定の歯の繰り返し発生するう蝕', '歯ぎしりの兆候', '特定処置への不安のパターン'],
    typicalConcernsEn: ['recurring decay in specific tooth positions', 'bruxism signs', 'anxiety patterns for specific procedures'],
    captureChecklistJa: [
      '主訴：どの歯が・どんな症状か（冷たいものがしみる・噛むと痛い・詰め物が取れた）・いつから。歯の位置は歯式（「右下6番」等）で必ず記録',
      '全身既往・服薬・アレルギー：抗凝固薬などの服用薬、麻酔・ラテックス・金属アレルギー、糖尿病・高血圧・妊娠 — 処置の安全に直結するため最優先で記録',
      '口腔内所見：う蝕・歯周ポケットの深さ（mm）・出血・動揺・歯ぎしり/食いしばりの痕跡 — 歯番と数値で記録',
      '本日の処置と麻酔・処置中の反応：どの歯に何をしたか（充填・根管治療・スケーリング・印象採得・抜歯など）と使用材料（CR・インレー等）、麻酔の使用有無と効き具合、気分不良・嘔吐反射・処置中の痛みの訴え',
      '不安・苦手ポイント：音・振動・注射など怖がったものと、その言い方 — 次回の配慮のためニュアンスごと記録',
      'ホームケア指導：ブラッシング指導の内容、フロス・歯間ブラシの指示、処置後の注意（「2時間は食事を控える」等）',
      '生活習慣：喫煙・甘い飲み物・間食・就寝時の歯ぎしり・仕事中の食いしばりなど、口腔に影響するもの',
      '次回・プラン：次回予約の日時と予定処置（「次回：左上5番の充填」）、治療全体の残りステップ、保険/自費の選択（クラウンの材質等）や提示した金額・患者の意向',
    ],
    captureChecklistEn: [
      'Chief complaint: which tooth, what symptom (sensitivity to cold, pain on biting, a lost filling), since when. Always record tooth positions in dental notation ("lower right 6")',
      'Medical history, meds & allergies: blood thinners and other medications, anesthetic/latex/metal allergies, diabetes, hypertension, pregnancy — top priority, this gates every procedure',
      'Oral findings: caries, pocket depths in mm, bleeding, tooth mobility, wear facets from grinding/clenching — recorded by tooth number and measurement',
      "Today's procedure & anesthesia/reaction: which tooth and what was done (filling, root canal, scaling, impression, extraction) plus materials used (composite, inlay, etc.); whether anesthetic was used and how it took, faintness, gag reflex, pain reported during treatment",
      'Anxiety triggers: what scared them — the drill sound, vibration, needles — and how they said it, so the next visit can be handled gently',
      'Homecare instructions: brushing guidance given, floss/interdental brush advice, post-op rules ("no eating for 2 hours")',
      'Habits & lifestyle: smoking, sugary drinks, snacking, night grinding, daytime clenching at work — anything affecting oral health',
      'Next visit & plan: date and planned procedure ("next: filling on upper left 5"), the remaining steps in the overall plan, plus insurance vs. private options discussed (crown material choices) and quotes given',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: '患者様の訴え・症状（どの歯か歯式で・いつから・きっかけ・どんな時に痛むか）' },
      { label: '注意', def: '安全上の注意（既往歴・手術歴・服薬中の薬・アレルギー・麻酔や薬剤への反応・糖尿病/高血圧/妊娠など処置の可否に関わる情報）' },
      { label: '所見', def: '本日の口腔内所見（う蝕・歯周ポケットの深さ・出血・動揺・歯ぎしりの痕跡など、歯番と数値で）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '処置', def: '本日実施した処置（部位・内容・使用材料）と麻酔の有無・効き具合、処置中の患者様の反応（気分不良・痛みの訴えなど）' },
      { label: 'ホームケア', def: '指導したブラッシング・フロス・歯間ブラシの要点、処置後の注意事項（食事制限の時間など）' },
      { label: '生活', def: '口腔の健康に影響する生活習慣（喫煙・甘い飲食物・歯ぎしり・食いしばり）や、次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時と予定処置、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／医師が患者様に伝えた治療計画の次のステップ／保険・自費の選択や提示した金額と患者様の意向／治療全体の残りステップ。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Complaint', def: "the patient's complaint and symptoms (which tooth by dental notation, since when, trigger, when it hurts)" },
      { label: 'Cautions', def: 'safety cautions (history, surgeries, current medications, allergies, anesthetic/drug reactions, diabetes/hypertension/pregnancy — anything gating the procedure)' },
      { label: 'Findings', def: "today's oral findings (caries, pocket depths, bleeding, mobility, wear facets from grinding) by tooth number and measurement; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Procedure', def: "today's procedure (site, work done, materials used), anesthesia used and how it took, and the patient's in-chair reaction (faintness, pain reported)" },
      { label: 'Homecare', def: 'brushing/floss/interdental-brush guidance given, and post-op instructions (e.g. eating restriction window)' },
      { label: 'Life', def: 'lifestyle affecting oral health (smoking, sugary food/drink, grinding, clenching) and personal topics useful next visit' },
      { label: 'Next', def: 'booking date/time and planned procedure, or "no booking". Then, ONLY what the conversation supports: things to check next time / next steps in the treatment plan the dentist shared / insurance vs. private options and quotes discussed / remaining steps in the overall plan. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「右下6番：3週間前から冷たい物がしみる、噛むと軽い痛み」',
      '（treatment）：「右下6番にCR充填、麻酔なしで実施、処置後2時間は飲食を控えるよう指導」',
    ],
    goodExamplesEn: [
      '(symptom): "Lower right 6: sensitive to cold for ~3 weeks, mild pain on biting"',
      '(treatment): "Composite filling on lower right 6 without anesthesia; advised no eating/drinking for 2 hours after"',
    ],
    passportFieldsJa: [
      { key: 'allergies_meds', label: 'アレルギー・薬', hint: '麻酔・薬剤・ラテックスへのアレルギーと服用中の薬（抗凝固薬など）' },
      { key: 'medical_history', label: '既往歴', hint: '糖尿病・高血圧・妊娠など治療に関わる持病・手術歴' },
      { key: 'treatment_stage', label: '治療計画', hint: '現在進行中の治療の段階（次回の予定処置・保険/自費の選択など）' },
      { key: 'chief_concern', label: '主な悩み', hint: '特定の歯に繰り返し起こるう蝕・歯ぎしりの傾向（今日だけの症状ではない）' },
      { key: 'anxiety_notes', label: '不安・苦手', hint: '音・振動・注射など苦手なものと、配慮してほしい点' },
    ],
    passportFieldsEn: [
      { key: 'allergies_meds', label: 'Allergies & meds', hint: 'anesthetic, drug, or latex allergies, and current medications (e.g. blood thinners)' },
      { key: 'medical_history', label: 'Medical history', hint: 'standing conditions affecting treatment — diabetes, hypertension, pregnancy, past surgeries' },
      { key: 'treatment_stage', label: 'Treatment plan', hint: 'where they are in an active treatment plan (next step, insurance vs. private choice)' },
      { key: 'chief_concern', label: 'Chief concern', hint: "a recurring dental issue — decay-prone teeth, bruxism — not just today's symptom" },
      { key: 'anxiety_notes', label: 'Anxiety triggers', hint: 'what they find hard to handle (drill sound, needles) and how to help' },
    ],
  },
  medical_clinic: {
    serviceNounJa: '処置', serviceNounEn: 'procedure',
    roleJa: '医師', roleEn: 'physician',
    businessNounJa: '医療クリニック', businessNounEn: 'medical clinic',
    primaryFocusJa: '医学的評価・治療反応・長期的な健康管理',
    primaryFocusEn: 'medical assessment, treatment response, and longitudinal health',
    seasonalRelevance: 'medium', clinicalPosture: 'clinical',
    typicalConcernsJa: ['服薬アドヒアランスと副作用', '慢性疾患の安定性', '季節による疾患の悪化'],
    typicalConcernsEn: ['medication adherence and side effects', 'chronic condition stability', 'seasonal condition exacerbations'],
    captureChecklistJa: [
      '主訴：症状・部位・いつから・きっかけ・程度（「発熱38.2度」「3日前から」など）— 発症時期と経過は必ず数字で記録',
      '既往歴・服薬・アレルギー：現在の服用薬（薬剤名・用量）、既往症・手術歴、薬剤アレルギー、必要に応じ家族歴 — 診療の安全に直結するため最優先で記録',
      '本日の所見・検査と伝えた評価：バイタル（血圧・体温・体重）、診察所見、実施/依頼した検査と説明した結果の数値、医師が患者に伝えた見立て・病名・経過の見通し',
      '本日の治療・処方と服薬状況：処方薬（薬剤名・用量・日数）、注射・処置、変更した薬とその理由、前回処方の服薬アドヒアランス（飲めた/飲み忘れ）と患者が訴えた副作用',
      '患者の反応・不安：治療への質問・心配ごと・理解度 — 次回の説明に活きるためニュアンスごと記録',
      '生活習慣：喫煙・飲酒・食事・運動・睡眠・仕事の状況など、疾患管理に関わるもの',
      '次回・プラン：再診日・再検査の予定、紹介の有無、治療方針の次のステップ。加えて、悪化時にすぐ受診すべき症状（レッドフラグ）として伝えた内容',
    ],
    captureChecklistEn: [
      'Chief complaint: symptoms, location, onset, trigger, severity ("fever 38.2°C", "started 3 days ago") — always record onset and course as numbers',
      'History, meds & allergies: current medications with doses, past conditions and surgeries, drug allergies, family history where relevant — top priority for safe care',
      "Today's findings, tests & assessment shared: vitals (BP, temperature, weight), exam findings, tests run or ordered with the values explained, and what the doctor told the patient it is and the expected course",
      "Today's treatment/prescriptions & adherence: drugs prescribed (name, dose, days' supply), injections/procedures, any medication changed and why, whether previous prescriptions were taken as directed, and any side effects reported",
      "Patient's reaction & concerns: questions, worries, how well they understood — in their own words, to shape next visit's explanation",
      'Lifestyle: smoking, alcohol, diet, exercise, sleep, work situation — whatever bears on managing the condition',
      'Next visit & plan: follow-up date, repeat tests scheduled, any referral, next step of the treatment plan; plus the red-flag symptoms they were told to return immediately for',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: '患者の症状・部位・いつから・きっかけ・程度（数値化できるものは数字で）' },
      { label: '注意', def: '安全上の注意（既往歴・手術歴・現在の服薬・薬剤アレルギー・家族歴など診療上配慮すべき情報）' },
      { label: '所見', def: '本日のバイタル・診察所見・実施/依頼した検査とその数値、医師が患者に伝えた見立てや病名・経過の見通し。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '治療', def: '本日の処方・注射・処置（薬剤名・用量・日数）と、前回処方の服薬状況（飲めた/飲み忘れ）・患者が訴えた副作用' },
      { label: '生活', def: '疾患管理に関わる生活習慣（喫煙・飲酒・食事・運動・睡眠・仕事）' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：再検査の予定／紹介の有無／治療方針の次のステップ／悪化時にすぐ受診すべき症状（レッドフラグ）として伝えた内容。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Complaint', def: "the patient's symptoms, location, onset, trigger, and severity (numeric where possible)" },
      { label: 'Cautions', def: 'safety cautions (history, surgeries, current medications, drug allergies, family history) relevant to care' },
      { label: 'Findings', def: "today's vitals, exam findings, tests run or ordered with values, and the assessment/diagnosis the doctor shared with the patient; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "today's prescriptions, injections, or procedures (drug name, dose, days' supply), plus adherence to the previous prescription and any side effects reported" },
      { label: 'Life', def: 'lifestyle factors relevant to managing the condition (smoking, alcohol, diet, exercise, sleep, work)' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: repeat tests scheduled / any referral / next step of the treatment plan / red-flag symptoms the patient was told to return immediately for. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「発熱38.2度：3日前から、咳を伴い夜間に悪化」',
      '（treatment）：「抗生剤（アモキシシリン）500mg×3/日を5日分処方」',
    ],
    goodExamplesEn: [
      '(symptom): "Fever 38.2°C for 3 days, with cough, worse at night"',
      '(treatment): "Prescribed amoxicillin 500mg × 3/day for 5 days"',
    ],
    passportFieldsJa: [
      { key: 'allergies_meds', label: 'アレルギー・薬', hint: '薬剤アレルギーと服用中の薬（薬剤名・用量）。変更があれば最新のもの' },
      { key: 'medical_history', label: '既往歴', hint: '既往症・手術歴・家族歴など、現在の症状ではなく継続的な病歴' },
      { key: 'treatment_stage', label: '治療方針', hint: '慢性疾患の管理方針と経過観察の段階（例：降圧薬を調整中）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態（夜勤・デスクワークなど疾患管理に関わるもの）' },
      { key: 'anxiety_notes', label: '不安・理解度', hint: '治療方針への不安・質問の傾向、説明時に配慮したい点' },
    ],
    passportFieldsEn: [
      { key: 'allergies_meds', label: 'Allergies & meds', hint: 'drug allergies and current medications (name, dose) — keep the latest if changed' },
      { key: 'medical_history', label: 'Medical history', hint: "past conditions, surgeries, family history — standing history, not today's symptom" },
      { key: 'treatment_stage', label: 'Care plan', hint: 'the direction of ongoing chronic-condition management (e.g. titrating blood-pressure meds)' },
      { key: 'occupation', label: 'Occupation', hint: 'work and schedule (shift work, desk job) that bears on managing their condition' },
      { key: 'anxiety_notes', label: 'Anxiety & understanding', hint: 'their tendency to worry or ask questions about care — how to explain things well' },
    ],
  },
  dermatology: {
    serviceNounJa: '処置', serviceNounEn: 'procedure',
    roleJa: '皮膚科医', roleEn: 'dermatologist',
    businessNounJa: '皮膚科クリニック', businessNounEn: 'dermatology clinic',
    primaryFocusJa: '皮膚の健康・臨床的な皮膚疾患・治療反応の追跡',
    primaryFocusEn: 'skin health, clinical skin conditions, and treatment response tracking',
    seasonalRelevance: 'high', clinicalPosture: 'clinical',
    typicalConcernsJa: ['アトピー性皮膚炎の季節的悪化', 'ニキビ治療への反応', '紫外線ダメージの進行'],
    typicalConcernsEn: ['atopic dermatitis seasonal flares', 'acne treatment response', 'sun-damage progression'],
    captureChecklistJa: [
      '主訴：どこの皮膚に・どんな症状か（かゆみ・湿疹・ニキビ・乾燥）・いつから・悪化のきっかけ（季節・汗・化粧品）。期間は必ず数字で記録',
      '既往歴・アレルギー：アトピー素因、薬剤/化粧品へのかぶれ歴、過去の皮膚治療歴、服用中の薬 — 処方の安全に直結するため最優先で記録',
      '皮疹の所見とかゆみの影響：部位・性状（紅斑・丘疹・乾燥・掻き壊し）・範囲、かゆみの程度と夜間のかゆみで眠れているか（患者の言葉ごと記録）。前回からの改善/悪化は会話から分かる場合のみ明記',
      '本日の処置・処方と外用の実施状況：処置（液体窒素等）と処方薬（ステロイドはランク・薬剤名・剤形・塗る回数まで）、前回処方の塗り方（量・頻度・部位）が守れていたか、自己判断での中止・減量がなかったか',
      'スキンケア指導：塗る順番・量（FTU）・洗い方・保湿・日焼け止めなど伝えた内容',
      '悪化因子と生活習慣：仕事（水仕事・手洗いの頻度）・汗・化粧品/整髪料・食事・ストレスなど皮膚に影響するもの',
      '美容面の関心：跡・色素沈着・シミなど、患者が気にしている見た目の悩み',
      '次回・プラン：再診の時期、薬を減らす/やめる条件、悪化したら早めに来る目安',
    ],
    captureChecklistEn: [
      'Chief complaint: where on the skin, what it looks and feels like (itch, eczema, acne, dryness), since when, and what worsens it (season, sweat, cosmetics) — durations as numbers',
      'History & allergies: atopic background, reactions to drugs or cosmetics, past skin treatments, current medications — top priority for safe prescribing',
      "Lesion findings & itch impact: site, appearance (redness, papules, dryness, scratch damage), extent, itch severity and whether nighttime itching disturbs sleep (keep the patient's own words); state better/worse vs last visit ONLY when the conversation shows it",
      "Today's treatment/prescriptions & topical adherence: procedures (cryotherapy, etc.) and prescriptions down to steroid potency class, drug name, vehicle, and application frequency; how last visit's prescription was actually applied (amount, frequency, site) and any self-directed stopping or tapering",
      'Skincare instructions: application order and amount (FTU), washing routine, moisturizer, and sunscreen guidance given',
      'Triggers & lifestyle: job factors (wet work, frequent handwashing), sweat, cosmetics and hair products, diet, stress — anything driving flares',
      'Cosmetic concerns: scarring, pigmentation, dark spots — the appearance issues the patient cares about',
      'Next visit & plan: follow-up timing, the conditions for tapering or stopping medication, and when to come back sooner',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: '患者様の訴え・悩み（部位・症状・いつから・きっかけ）。跡や色素沈着など見た目に関する悩みが会話に出た場合はここに含める' },
      { label: '注意', def: 'アトピー素因・薬剤/化粧品へのかぶれ歴・過去の皮膚治療歴・服用中の薬など処方の安全に関わる情報' },
      { label: '所見', def: '本日の皮疹所見（部位・性状・範囲）とかゆみの程度・夜間の睡眠への影響。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '処置', def: '本日実施した処置と処方（ステロイドのランク・薬剤名・剤形・塗る回数を含む）、前回処方の外用実施状況（守れていたか・自己判断の中止/減量の有無）' },
      { label: 'スキンケア', def: '指導した外用の塗り方（順番・量・FTU）・洗い方・保湿・日焼け止め' },
      { label: '生活', def: '悪化因子となる生活習慣（水仕事・汗・化粧品/整髪料・食事・ストレス）' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：再診で確認すること／薬を減らす・やめる条件／悪化時に早めに受診する目安。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Complaint', def: "the patient's complaint (site, symptom, since when, trigger); include appearance concerns like scarring or pigmentation here when mentioned" },
      { label: 'Cautions', def: 'atopic background, drug/cosmetic reaction history, past skin treatments, current medications — safety information for prescribing' },
      { label: 'Findings', def: "today's lesion findings (site, appearance, extent) and itch severity/nighttime sleep impact; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "today's procedure and prescription (steroid potency class, drug name, vehicle, application frequency), and adherence to the last prescription (followed as directed, any self-directed stopping/tapering)" },
      { label: 'Skincare', def: 'topical application guidance given (order, amount/FTU), washing routine, moisturizer, sunscreen' },
      { label: 'Life', def: 'lifestyle triggers (wet work, sweat, cosmetics/hair products, diet, stress)' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check at follow-up / conditions for tapering or stopping medication / when to come back sooner. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「頬：2週間前から赤みとかゆみ、汗をかくと悪化」',
      '（treatment）：「ステロイド外用（ミディアムクラス）を1日2回、頬に塗布するよう処方」',
    ],
    goodExamplesEn: [
      '(symptom): "Cheeks: redness and itching for ~2 weeks, worse with sweating"',
      '(treatment): "Prescribed medium-potency topical steroid, applied twice daily to the cheeks"',
    ],
    passportFieldsJa: [
      { key: 'allergies_meds', label: 'アレルギー・薬', hint: '薬剤・化粧品へのかぶれ歴と、現在服用中の薬' },
      { key: 'medical_history', label: '既往歴', hint: 'アトピー素因の有無と過去に受けた皮膚治療歴（他院を含む）' },
      { key: 'chief_concern', label: '主な悩み', hint: '季節・汗・化粧品など繰り返し悪化を招く要因（今日限りの症状ではない）' },
      { key: 'treatment_stage', label: '治療経過', hint: '現在の外用薬治療の段階（ステロイドのランク・漸減の目安など）' },
      { key: 'anxiety_notes', label: '心理的配慮', hint: '見た目の悩みへの繊細さや、注射・液体窒素など苦手な処置' },
    ],
    passportFieldsEn: [
      { key: 'allergies_meds', label: 'Allergies & meds', hint: 'reactions to drugs or cosmetics, and current medications' },
      { key: 'medical_history', label: 'Medical history', hint: 'atopic predisposition and past skin treatments (including other clinics)' },
      { key: 'chief_concern', label: 'Chief concern', hint: "recurring flare triggers — season, sweat, cosmetics — not just today's flare" },
      { key: 'treatment_stage', label: 'Treatment course', hint: 'current topical/systemic treatment stage (steroid potency, tapering plan)' },
      { key: 'anxiety_notes', label: 'Sensitivities', hint: 'sensitivity about their appearance, or dislike of specific procedures (injections, cryotherapy)' },
    ],
  },
  cosmetic_surgery: {
    serviceNounJa: '施術', serviceNounEn: 'procedure',
    roleJa: '美容外科医', roleEn: 'cosmetic surgeon',
    businessNounJa: '美容クリニック', businessNounEn: 'cosmetic surgery clinic',
    primaryFocusJa: '美容医療処置・回復の経過・審美的な結果',
    primaryFocusEn: 'cosmetic medical procedures, recovery tracking, and aesthetic outcomes',
    seasonalRelevance: 'medium', clinicalPosture: 'clinical',
    typicalConcernsJa: ['処置後の回復のマイルストーン', '期待 vs 実際の結果の追跡', '活動再開のタイミング'],
    typicalConcernsEn: ['post-procedure recovery milestones', 'expected-vs-actual outcome tracking', 'return-to-activity timeline'],
    captureChecklistJa: [
      '希望と動機：どこをどう変えたいか（目・鼻・輪郭・シワ等）、理想のイメージ、期限のあるイベント（結婚式・撮影）— 期日は必ず記録',
      '既往歴・施術歴・安全情報：麻酔・薬剤アレルギー、服用薬、ケロイド体質、喫煙、妊娠、過去の美容施術（他院含む）は何を・いつ・どこに（ヒアルロン酸・ボトックス・糸は製剤名と時期まで）— 施術可否の判断に直結するため最優先で記録',
      '医師の評価：診察での所見、できること/できないことの説明、提案した術式・デザイン',
      '本日の施術と反応：実施した処置（部位・製剤名・注入量「ほうれい線にヒアルロン酸1cc」・麻酔の種類）、施術中の痛みの訴え・気分不良（迷走神経反射）、直後の仕上がりへの反応',
      'ダウンタイムとアフターケア指導：腫れ・内出血の見通しと、禁止事項の期間（飲酒・運動・入浴・メイクは何日目から）',
      '期待値のすり合わせ：患者の期待と現実的な仕上がりの説明、前回施術への満足度・修正の希望',
      '個人メモ：仕事（ダウンタイムを取れるか）・イベント予定・家族など、次回の会話に活きる話題',
      '次回・プランと費用：抜糸・経過診察の日時、次に予定/検討している施術、提示した見積り・キャンペーン・支払い方法',
    ],
    captureChecklistEn: [
      "Desired change & motivation: what they want changed (eyes, nose, contour, wrinkles), the look they're after, and hard deadlines (wedding, photo shoot) — always record the dates",
      'History, prior procedures & safety: anesthetic/drug allergies, current medications, keloid tendency, smoking, pregnancy; past cosmetic work including at other clinics — what, when, and where (filler/botox/threads down to product name and date) — top priority, this gates whether procedures can be done',
      "Doctor's assessment: exam findings, what is and isn't achievable, and the technique/design proposed",
      "Today's procedure & reaction: exactly what was done (site, product and volume, e.g. 1cc hyaluronic acid to the nasolabial folds; anesthesia type), pain reported or faintness (vasovagal response) during the procedure, and their reaction to the immediate result",
      'Downtime & aftercare instructions: expected swelling/bruising, and the day counts on restrictions (alcohol, exercise, bathing, makeup from day X)',
      "Expectation alignment: the patient's expectations vs. the realistic outcome explained, plus satisfaction with prior procedures and any touch-up wishes",
      "Personal notes: their job (can they hide downtime?), upcoming events, family — fuel for next visit's conversation",
      'Next visit, plan & cost: suture-removal/follow-up dates, the next procedure planned or under consideration, quotes given, campaigns, and payment options',
    ],
    summaryLabelsJa: [
      { label: '希望', def: '患者様の希望・動機（どこをどう変えたいか、理想のイメージ、期限のあるイベント）' },
      { label: '注意', def: '安全上の注意（麻酔・薬剤アレルギー・服用薬・ケロイド体質・喫煙・妊娠・過去の美容施術歴）' },
      { label: '評価', def: '医師の診察所見、できること/できないことの説明、提案した術式・デザイン' },
      { label: '施術', def: '本日実施した施術（部位・製剤名・注入量・麻酔の種類）と、患者様の施術中の反応（痛み・気分不良）、直後の仕上がりへの反応' },
      { label: 'ダウンタイム', def: '腫れ・内出血の見通しと、禁止事項の期間（飲酒・運動・入浴・メイクは何日目から）' },
      { label: '期待値', def: '患者様の期待と現実的な仕上がりの説明、前回施術への満足度・修正の希望。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：抜糸・経過診察の予定／次に予定・検討している施術／提示した見積りやキャンペーン・支払い方法。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Motivation', def: "the patient's desired change and motivation (what they want changed, the look they're after, deadline events)" },
      { label: 'Cautions', def: 'safety cautions (anesthetic/drug allergies, current medications, keloid tendency, smoking, pregnancy, past cosmetic procedure history)' },
      { label: 'Assessment', def: "the doctor's exam findings, what is and isn't achievable, and the technique/design proposed" },
      { label: 'Procedure', def: "today's procedure (site, product, volume, anesthesia type), the patient's in-procedure reaction (pain, faintness), and their reaction to the immediate result" },
      { label: 'Downtime', def: 'expected swelling/bruising, and the day counts on restrictions (alcohol, exercise, bathing, makeup)' },
      { label: 'Expectations', def: "the patient's expectations vs. the realistic outcome explained, satisfaction with prior procedures, and touch-up wishes; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: suture-removal/follow-up plans / next procedure planned or under consideration / quotes, campaigns, or payment options discussed. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「ほうれい線：半年前から気になり始め、写真撮影の予定で相談」',
      '（treatment）：「ほうれい線にヒアルロン酸1cc注入、局所麻酔クリーム使用」',
    ],
    goodExamplesEn: [
      '(symptom): "Nasolabial folds: bothering her for ~6 months, consulting ahead of a photo shoot"',
      '(treatment): "1cc hyaluronic acid filler injected into the nasolabial folds, using topical anesthetic cream"',
    ],
    passportFieldsJa: [
      { key: 'allergies_meds', label: 'アレルギー・薬', hint: '麻酔・薬剤アレルギーと服用中の薬。喫煙・妊娠など施術可否に関わる情報' },
      { key: 'medical_history', label: '既往歴・施術歴', hint: '過去の美容施術歴（他院含む・製剤名や時期）とケロイド体質' },
      { key: 'treatment_goal', label: '希望・目標', hint: 'どこをどう変えたいか、理想のイメージ、期限のあるイベント（日付で記録）' },
      { key: 'treatment_stage', label: '施術計画', hint: '施術計画の進捗（次の施術予定、シリーズ物の残り回数など）' },
      { key: 'anxiety_notes', label: '不安・体質', hint: '麻酔や注射への不安、気分不良（迷走神経反射）の傾向' },
    ],
    passportFieldsEn: [
      { key: 'allergies_meds', label: 'Allergies & meds', hint: 'anesthetic/drug allergies, current meds, smoking or pregnancy — gates what can be done' },
      { key: 'medical_history', label: 'Medical & procedure history', hint: 'past cosmetic procedures anywhere (product, volume, date) and keloid tendency' },
      { key: 'treatment_goal', label: 'Goals & motivation', hint: 'what they want changed, the look they want, and any deadline event (record the date)' },
      { key: 'treatment_stage', label: 'Procedure plan', hint: 'progress through a procedure plan (next step, sessions remaining in a series)' },
      { key: 'anxiety_notes', label: 'Anxiety & sensitivity', hint: 'anxiety around anesthesia/needles, or a tendency toward faintness (vasovagal)' },
    ],
  },
  physical_therapy: {
    serviceNounJa: 'リハビリ', serviceNounEn: 'therapy',
    roleJa: '理学療法士', roleEn: 'physical therapist',
    businessNounJa: '理学療法室', businessNounEn: 'physical therapy clinic',
    primaryFocusJa: 'リハビリの進捗・機能的動作・活動復帰',
    primaryFocusEn: 'rehabilitation progression, functional movement, and return-to-activity',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['可動域のマイルストーン', '疼痛と動作の相関追跡', '自主トレの継続'],
    typicalConcernsEn: ['range-of-motion milestones', 'pain-movement correlation tracking', 'home-exercise adherence'],
    captureChecklistJa: [
      '現在の症状：痛みの部位・程度（10段階で数値化）・どの動作/時間帯で痛むか・受傷/術後からの経過。期間・日数は必ず数字で記録',
      '既往歴と医師の指示：術式と手術日・受傷機転・荷重制限や禁忌動作などドクターの指示 — リハビリの安全の枠組みそのものなので最優先',
      '本日の評価と介入：関節可動域は角度で（「膝屈曲120度」）、筋力（MMT）、腫れ、歩行の観察（前回との比較も数字で明記）。実施した徒手療法・物理療法（温熱・電気等）・運動療法（種目×回数×セット）と、施術中/後の痛みの変化・その場で改善した動き・翌日に残った痛みの報告',
      '自主トレ指導と実施状況：処方したホームエクササイズ（種目・回数・頻度）と守るべきルール（「痛みが翌日残るならやり過ぎ」等）。前回の宿題ができたか、できなかった理由（時間・痛み・忘れ）',
      '機能目標と進捗：復帰したい動作（階段・正座・ランニング・仕事動作・競技復帰）と、そこまでの現在地',
      '生活・仕事の負荷と伝えた制限：仕事内容（立ち仕事・重量物）・通勤・家庭環境・スポーツなど回復を助ける/妨げるもの。避けるべき動作・荷重のルール・装具の使用など伝えた制限',
      '次回・プラン：次回予約と、次の段階に進む基準（「屈曲130度になったらジョグ開始」等）、施術者が約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Current status: pain location and score (0–10), which movements or times of day hurt, and time since injury/surgery. Durations in numbers',
      "History and physician's orders: surgical procedure and date, mechanism of injury, weight-bearing limits and prohibited movements from the doctor — top priority, this bounds the entire program",
      "Today's evaluation and intervention: joint range of motion in degrees ('knee flexion 120°'), strength (MMT grades), swelling, gait observations (with change vs. last session, in numbers). Manual therapy, modalities (heat, e-stim), and therapeutic exercise performed (exercise × reps × sets), plus pain change during/after and any next-day soreness reported",
      "Home exercise program and adherence: prescribed exercises (name, reps, frequency) and the rules given ('if pain lingers into the next day, you overdid it'). Whether they did last time's homework, and what got in the way (time, pain, forgetting)",
      'Functional goals and progress: the activity they want back (stairs, kneeling, running, job tasks, return to sport) and how close they are',
      'Life/work load and restrictions given: job demands (standing, lifting), commute, home setup, sport — what helps or hinders recovery; movements to avoid, weight-bearing rules, brace/orthosis use',
      'Next visit and plan: next appointment and the criteria to progress ("start jogging at 130° flexion"), promises the practitioner made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '症状', def: 'お客様の訴え（痛みの部位・程度（10段階）・悪化する動作/時間帯・受傷/術後からの経過）' },
      { label: '注意', def: 'ドクターの指示・安全上の注意（術式と手術日・受傷機転・荷重制限や禁忌動作）' },
      { label: '評価', def: '本日の客観的評価（可動域は角度・筋力はMMT・腫れ・歩行観察）と原因の見立て。前回からの変化が数字で分かる場合に限り改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '介入', def: '本日実施した徒手療法・物理療法・運動療法（種目×回数×セット）と、それへの反応（施術中/後の痛みの変化・その場で改善した動き・翌日の痛み。「いつもの」等の指定はその表現のまま書く）' },
      { label: '自主トレ', def: '処方したホームエクササイズ（種目・回数・頻度・ルール）と、前回の宿題の実施状況（できたか・できなかった理由）' },
      { label: '目標', def: '復帰したい機能的動作（階段・正座・ランニング・仕事動作・競技復帰）と、そこまでの現在地' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次の段階に進む基準（「屈曲130度でジョグ開始」等）／次回確認すること／施術者が約束した内容／継続・更新に関わるお客様の意向／回数券の残回数／推奨通院頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Status', def: "the customer's complaint (pain location and score 0–10, movements/times that worsen it, time since injury/surgery)" },
      { label: 'Cautions', def: "physician's orders and safety notes (surgical procedure and date, mechanism of injury, weight-bearing limits, prohibited movements)" },
      { label: 'Evaluation', def: "today's objective measures (range of motion in degrees, strength via MMT, swelling, gait) and the assessment; state improved/worse/unchanged ONLY when the conversation shows a numeric change vs last time" },
      { label: 'Intervention', def: "today's manual therapy, modalities, and therapeutic exercise (exercise × reps × sets), and the response (pain change during/after, movements that improved on the spot, next-day soreness; keep 'the usual'-style requests verbatim)" },
      { label: 'Home program', def: "prescribed exercises (name, reps, frequency, rules) and adherence to last time's homework (done or not, and why)" },
      { label: 'Goals', def: 'the functional activity they want back (stairs, kneeling, running, job tasks, return to sport) and how close they are' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: the criteria to progress ("start jogging at 130° flexion") / things to check next time / promises the practitioner made / renewal or continuation intent / ticket balance / recommended visit frequency. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「左膝：術後6週、階段の下りで痛みあり（10段階で4）」',
      '（treatment）：「自主トレ指導：椅子からのスクワット10回×3セットを1日2回」',
    ],
    goodExamplesEn: [
      '(symptom): "Left knee: 6 weeks post-op, pain going down stairs (4/10)"',
      '(treatment): "Home exercise: chair squats, 10 reps × 3 sets, twice daily"',
    ],
    passportFieldsJa: [
      { key: 'contraindications', label: '既往歴・注意', hint: '手術歴（人工関節等）・体内の金属・骨折歴・服薬・禁忌動作など施術安全に関わる患者様本人の情報' },
      { key: 'chief_concern', label: '主な症状', hint: '慢性的に繰り返す痛みや機能制限のパターン（リハビリの発端となった症状を含む）' },
      { key: 'constitution', label: '動きの癖', hint: '繰り返し確認される可動域・筋力の傾向（特定方向の硬さ・弱さなど）' },
      { key: 'intensity_pref', label: '負荷の好み', hint: '運動負荷・徒手療法の強め/弱めの好み、痛みが出る動き、無理をしやすい傾向' },
      { key: 'maintenance_pref', label: '通院ペース希望', hint: '本人が話した希望通院ペース（週1・月2など）' },
    ],
    passportFieldsEn: [
      { key: 'contraindications', label: 'History & cautions', hint: "surgical history (joint replacement, etc.), implanted hardware, fracture history, medication, movement precautions — the patient's own facts, never staff talk" },
      { key: 'chief_concern', label: 'Chief concern', hint: 'chronic pain or functional-limitation pattern, including the condition that started this course of rehab' },
      { key: 'constitution', label: 'Movement tendency', hint: 'recurring range-of-motion or strength tendency (stiffness/weakness in a specific direction) seen across visits' },
      { key: 'intensity_pref', label: 'Load preference', hint: 'preferred exercise/manual-therapy intensity, movements that trigger pain, tendency to overdo it' },
      { key: 'maintenance_pref', label: 'Visit cadence preference', hint: 'the visit cadence they said they want' },
    ],
  },
  foot_care: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: 'フットケアセラピスト', roleEn: 'foot care therapist',
    businessNounJa: 'フットケアサロン', businessNounEn: 'foot care studio',
    primaryFocusJa: '足の健康・リフレクソロジーの効果・歩行に関わる悩み',
    primaryFocusEn: 'foot health, reflexology outcomes, and gait-related concerns',
    seasonalRelevance: 'low', clinicalPosture: 'wellness',
    typicalConcernsJa: ['立ち仕事による足裏の疲労', 'タコ・爪のトラブルのサイクル', 'アーチサポートの効果'],
    typicalConcernsEn: ['plantar fatigue from standing work', 'callus/nail issues cycle', 'arch support effectiveness'],
    captureChecklistJa: [
      '主訴：どちらの足のどこ（足裏・かかと・指・爪）が、いつから、どんな時に痛む/気になるか。期間・頻度（「半年前から」「週3回」等）は必ず数字で記録',
      '安全に関わる既往・体質：糖尿病・血行障害・感覚の低下・血液をサラサラにする薬・皮膚疾患や水虫の既往 — 角質ケア・爪ケアの安全に直結するため最優先',
      '施術者の所見と靴・歩き方：角質の厚さ、タコ・ウオノメの位置と大きさ、巻き爪/肥厚爪の状態、むくみ・冷え・アーチの崩れ・左右差。普段履く靴（ヒール・安全靴・サイズ感）、立ち仕事の時間、歩き方や重心の癖',
      '実施したケアとお客様の反応：角質除去・爪のカットや補正・リフレクソロジーで重点的に流した反射区・フットバスなど何をどこに行ったか。痛かった/くすぐったかった/「足が軽くなった」等の反応 — 響いた反射区や感想の言葉はニュアンスごと記録',
      '圧・刺激の好みとホームケア指導：強め/弱めの好み、痛がった箇所、触れられたくない部位。やすり・保湿クリームの使い方と頻度、正しい爪の切り方（スクエアカット等）、インソールや靴の提案',
      '生活習慣と個人メモ：立ち仕事・運動・入浴など足に影響するもの。仕事・家族・趣味・予定など次回の会話と信頼関係に活きる話題',
      '次回・プラン：次回予約の日時、角質やタコが戻る周期を踏まえた推奨来店頻度、今後のケア方針、施術者が約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief concern: which foot and where (sole, heel, toes, nails), since when, and when it hurts or bothers them. Always record durations and frequency in numbers ("for 6 months", "3x a week")',
      "Safety-critical history: diabetes, poor circulation, reduced sensation, blood-thinning medication, past skin conditions or athlete's foot — top priority, it directly governs how safely callus and nail work can be done",
      'Practitioner findings and footwear/gait: callus thickness, corn/callus locations and size, ingrown or thickened nails, swelling, cold feet, fallen arches, left-right differences; usual shoes (heels, safety boots, fit), hours standing at work, walking or weight-bearing habits',
      "Care performed and customer's reaction: callus removal, nail trimming or correction, reflexology zones worked, foot bath — what was done and where. Pain, ticklishness, 'my feet feel lighter' — record tender reflex zones and their exact words with nuance",
      'Pressure preferences and homecare coaching: strong vs gentle, spots that hurt, areas they do not want touched; how and how often to use a foot file or moisturizer, correct nail-cutting technique (square cut etc.), insole or footwear suggestions',
      'Lifestyle and personal notes: standing work, exercise, bathing — anything affecting the feet; work, family, hobbies, plans useful next visit',
      'Next visit and plan: booked date/time, recommended return cycle based on how fast their callus rebuilds, ongoing care direction, promises the practitioner made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: 'お客様の訴え（どちらの足のどこが・いつから・どんな時に痛む/気になるか）' },
      { label: '注意', def: '安全上の注意（糖尿病・血行障害・感覚の低下・血液をサラサラにする薬・皮膚疾患や水虫の既往）' },
      { label: '状態', def: '本日の所見（角質の厚さ・タコ/ウオノメ・巻き爪/肥厚爪・むくみ・冷え・アーチの崩れ・左右差、靴と歩き方）と原因の見立て。前回からの変化が会話から分かる場合に限り改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施したケア（角質除去・爪のカットや補正・反射区・フットバス等）と、それへのお客様の反応（痛かった/くすぐったかった/「足が軽くなった」等。「いつもの」等の指定はその表現のまま書く）' },
      { label: 'セルフケア', def: '指導したホームケア（やすり・保湿クリームの使い方と頻度、正しい爪の切り方、インソール/靴の提案）' },
      { label: '生活', def: '立ち仕事・運動・入浴など足に影響する生活習慣、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／施術者が約束した内容／保留になった提案／継続・更新に関わるお客様の意向／回数券の残回数／角質やタコが戻る周期を踏まえた推奨来店頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Concerns', def: "the customer's complaint (which foot and where, since when, when it hurts or bothers them)" },
      { label: 'Cautions', def: "safety cautions (diabetes, poor circulation, reduced sensation, blood-thinning medication, past skin conditions or athlete's foot)" },
      { label: 'Condition', def: "today's findings (callus thickness, corn/callus, ingrown or thickened nails, swelling, cold feet, fallen arches, left-right differences, footwear and gait) and the assessment; state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "today's care performed (callus removal, nail trimming or correction, reflexology zones, foot bath) and the customer's reaction (pain, ticklishness, 'feet feel lighter'; keep 'the usual'-style requests verbatim)" },
      { label: 'Self-care', def: 'homecare coaching given (foot file/moisturizer use and frequency, correct nail-cutting technique, insole/footwear suggestions)' },
      { label: 'Life', def: 'lifestyle affecting the feet (standing work, exercise, bathing) and personal topics (family, hobbies, plans) useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the practitioner made / deferred proposals / renewal or continuation intent / ticket balance / recommended return cycle based on callus regrowth. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「右足裏：3ヶ月前から立ち仕事後にタコが痛む」',
      '（treatment）：「かかとの角質除去とスクエアカット実施、保湿クリームを毎晩1回塗布するよう指導」',
    ],
    goodExamplesEn: [
      '(symptom): "Right sole: callus pain after standing work, for ~3 months"',
      '(treatment): "Removed heel callus and did a square nail cut, advised moisturizer nightly"',
    ],
    passportFieldsJa: [
      { key: 'contraindications', label: '既往歴・注意', hint: '糖尿病・血流障害・水虫等の皮膚疾患・服薬（血液をサラサラにする薬等）など施術安全に関わるお客様本人の情報' },
      { key: 'chief_concern', label: '主な悩み', hint: '慢性的・繰り返し話題になる足のトラブル（巻き爪・タコ・魚の目・外反母趾など）' },
      { key: 'constitution', label: '足の特徴', hint: '繰り返し確認される足の特徴（扁平足・甲高・立ち仕事による足裏疲労など）' },
      { key: 'intensity_pref', label: '強さの好み', hint: 'リフレクソロジーの強め/弱めの好み、痛がった部位、くすぐったがりなどの反応' },
      { key: 'maintenance_pref', label: 'メンテナンス希望', hint: '本人が話した希望来店ペース（月1・隔月など）' },
    ],
    passportFieldsEn: [
      { key: 'contraindications', label: 'History & cautions', hint: "diabetes, circulation issues, skin conditions (athlete's foot, etc.), medication (blood thinners, etc.) — the customer's own facts, never staff talk" },
      { key: 'chief_concern', label: 'Chief concern', hint: "chronic, recurring foot trouble (ingrown nails, calluses, corns, bunions, etc.) — not just today's symptom" },
      { key: 'constitution', label: 'Foot tendency', hint: 'recurring foot characteristic or strain pattern (flat feet, high arch, plantar fatigue from standing work, etc.)' },
      { key: 'intensity_pref', label: 'Pressure preference', hint: 'strong/gentle reflexology preference, spots that hurt, ticklishness or other reaction tendency' },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence they said they want' },
    ],
  },
  relaxation: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: 'リラクゼーションセラピスト', roleEn: 'relaxation therapist',
    businessNounJa: 'リラクゼーションサロン', businessNounEn: 'relaxation salon',
    primaryFocusJa: 'ストレス緩和・全身リラクゼーション・お客様の心地よさ',
    primaryFocusEn: 'stress relief, full-body relaxation, and customer comfort',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['仕事由来のストレスパターン', '施術を重ねた睡眠の改善', '好みの圧・音楽'],
    typicalConcernsEn: ['workplace stress patterns', 'sleep improvement session-over-session', 'preferred pressure and music'],
    captureChecklistJa: [
      '主訴：どこが疲れている・張っている（肩・腰・首・目・脚など）、いつから、思い当たる原因。期間・頻度は必ず数字で記録',
      '安全に関わる申告：ケガ・手術歴・妊娠中/その可能性・持病（高血圧など）・もみ返しの経験 — 避けるべき部位と強さの判断に直結するため最優先で記録',
      'セラピストの所見と本日の施術：コリ・張りの強い部位・左右差・冷え・むくみ（医療的な診断ではなく手で感じた体感として）、実施したコース名・時間（60分全身・足つぼ等）・重点的にほぐした部位・オイルの有無',
      '施術への反応と圧の好み：気持ちよくて眠った・楽になった部位・痛かった箇所（「そこそこ！」等の言葉はニュアンスごと記録）、全体の強さ・部位ごとの好み（首は弱め等）、もみ返しやすさ',
      '過ごし方の好み：会話したい派か静かに休みたい派か、うつ伏せの苦手さ、室温・音楽・照明の好み',
      '生活とストレス・個人メモ：眠りの質・寝つき、仕事や生活のストレス源、疲れがたまる曜日やタイミング、家族・趣味・予定など次回の会話と信頼関係に活きる話題',
      'セルフケアの提案：入浴・ストレッチ・水分補給など伝えたアドバイス',
      '次回・プラン：次回予約の日時、疲れがたまる周期を踏まえた推奨来店頻度、次回試したいコース、セラピストが約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief complaint: where they feel tired or tight (shoulders, lower back, neck, eyes, legs), since when, and what they think caused it. Always record durations and frequency in numbers',
      'Safety disclosures: injuries, past surgery, pregnancy (current or possible), conditions like high blood pressure, history of post-massage soreness — top priority, it decides which areas and pressure levels to avoid',
      "Therapist's read and today's treatment: where tension is worst, left-right differences, coldness, puffiness (as felt through the hands, not a medical diagnosis); course name and length (60-min full body, foot pressure-point course etc.), areas focused on, oil or dry",
      'Reaction to treatment and pressure preferences: fell asleep, which areas felt lighter, spots that hurt (capture their exact words, e.g. "right there!", with nuance); overall strength, per-area preferences (lighter on the neck etc.), tendency toward next-day soreness',
      'Session-style preferences: chatty vs quiet, discomfort lying face-down, room temperature / music / lighting likes',
      "Life, stress & personal notes: sleep quality and how easily they fall asleep, what drives their stress at work or home, when in the week fatigue peaks, plus family/hobbies/plans that fuel next visit's conversation and trust",
      'Self-care suggestions given: baths, stretches, hydration — whatever was advised',
      'Next visit and plan: booked date/time, recommended visit rhythm based on how fast their fatigue builds, course to try next time, promises the therapist made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: 'ご要望', def: 'お客様の疲れ・張りの訴えと来店目的（部位・いつから・きっかけ）' },
      { label: '注意', def: '安全上の注意（ケガ・手術歴・妊娠中/その可能性・持病・もみ返しの経験・痛がった箇所・圧の注意）' },
      { label: '状態', def: '本日セラピストが手で感じ取った体の状態（コリ・張り・左右差・冷え・むくみ）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '本日実施したコース・時間・重点部位・オイルの有無と、お客様の反応（「いつもの」等の指定はその表現のまま書く）' },
      { label: 'セルフケア', def: '提案した入浴・ストレッチ・水分補給などのアドバイス' },
      { label: '生活', def: '睡眠・ストレス源・疲れがたまる曜日や、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／セラピストがお客様に約束した内容／保留になった提案／継続・来店頻度に関わるお客様の意向や事情／回数券の残回数／推奨来店頻度／次回試したいコース。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Requests', def: "the customer's fatigue/tightness complaints and reason for visiting (area, since when, trigger)" },
      { label: 'Cautions', def: 'safety cautions (injuries, surgery history, pregnancy or possible pregnancy, conditions, history of post-massage soreness, spots that hurt, pressure cautions)' },
      { label: 'Condition', def: "today's body state as felt through the therapist's hands (tension, tightness, left-right imbalance, coldness, puffiness); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "today's course, length, focus areas, and oil or dry, plus the customer's reaction (keep 'the usual'-style requests verbatim)" },
      { label: 'Self-care', def: 'advice given (baths, stretches, hydration)' },
      { label: 'Life', def: 'sleep, stress sources, when fatigue peaks in the week, plus family/hobbies/plans useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the therapist made / deferred proposals / attendance intent or constraints / ticket balance / recommended cadence / course to try next time. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「首・肩：2週間前からデスクワーク後に張りが強く、夕方に頭が重い」',
      '（treatment）：「セルフケア指導：入浴後に首を左右各10秒×3回ストレッチ、白湯を1日1L」',
    ],
    goodExamplesEn: [
      '(symptom): "Neck/shoulders: tightness worse after desk work for the past 2 weeks, head feels heavy by evening"',
      '(treatment): "Self-care coaching: neck stretch 10 sec each side × 3 reps after bathing, 1L warm water daily"',
    ],
    passportFieldsJa: [
      { key: 'pressure_pref', label: '圧の強さ', hint: '本人が話した圧の強さの好み（強め/弱め）と苦手な部位。その日だけの体調ではなく普段からの好み' },
      { key: 'session_style_pref', label: '施術中の希望', hint: '会話量・音楽・室温など、本人が話した施術中の環境の好み（毎回変わらないもの）' },
      { key: 'chief_concern', label: 'ストレス傾向', hint: '仕事・生活面で繰り返し話題になるストレスの原因や、慢性的に張りやすい部位（一時的な疲れではなく継続的な傾向）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態と、それが体に与える影響（デスクワーク・立ち仕事など）' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望来店ペース（週1・月1など）' },
    ],
    passportFieldsEn: [
      { key: 'pressure_pref', label: 'Pressure preference', hint: "the customer's standing pressure preference (firm/light) and areas to avoid — a usual preference, not just today's request" },
      { key: 'session_style_pref', label: 'Session style', hint: "conversation level, music, room temperature — the customer's stated preference for the session atmosphere, not a one-off request" },
      { key: 'chief_concern', label: 'Stress pattern', hint: "recurring stress sources or chronically tense areas the customer mentions repeatedly — a standing pattern, not one day's fatigue" },
      { key: 'occupation', label: 'Occupation', hint: 'work and how it affects the body (desk work, standing, shift work, etc.)' },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence they said they want (e.g., weekly, monthly)' },
    ],
  },
  aroma: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: 'アロマセラピスト', roleEn: 'aromatherapist',
    businessNounJa: 'アロマサロン', businessNounEn: 'aromatherapy salon',
    primaryFocusJa: '香りの好みとウェルネスへの反応パターン',
    primaryFocusEn: 'scent-profile preferences and wellness response patterns',
    seasonalRelevance: 'medium', clinicalPosture: 'wellness',
    typicalConcernsJa: ['香りへの感度の変化', 'セッションごとのストレス反応の変化', '施術後の睡眠の質'],
    typicalConcernsEn: ['scent sensitivity changes', 'stress-response patterns session-over-session', 'sleep quality after sessions'],
    captureChecklistJa: [
      '主訴・目的：疲労・ストレス・眠りの浅さ・冷え・PMSなど、何を求めて来たか、いつから。期間は必ず数字で記録',
      '安全に関わる体質：アレルギー・肌の敏感さ・妊娠中/授乳中（禁忌精油の判断に必須）・持病・服薬・過去に精油で肌トラブルが出た経験 — 最優先で記録',
      '香りの好みと使用したブレンド：選香で好んだ/苦手と言った香り・かいだ瞬間の反応、実施した精油名の組み合わせ（例：ラベンダー×ベルガモット）・キャリアオイル・希釈濃度 — 名前と数字を必ず記録',
      'セラピストの所見と実施したトリートメント：体の張り・冷え・むくみ・肌の状態（乾燥・オイルのなじみ方）、コース・時間・重点部位・圧',
      '施術への反応と圧・環境の好み：リラックスの深さ（眠った等）・楽になった部位・痛かった/くすぐったかった箇所（言葉はニュアンスごと記録）、圧の強さ、室温・音楽・会話量の好み',
      '睡眠・ストレスの変化：前回の施術後の眠りの質、ストレス反応の変化',
      'ホームケア：提案した芳香浴・バスソルト・購入した精油、伝えた禁忌説明（柑橘系精油の後の紫外線注意など）',
      '次回・プラン：次回予約の日時、次回のブレンド方針、推奨来店頻度、セラピストが約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief concern and goal: fatigue, stress, light sleep, cold sensitivity, PMS etc. — what they came for and since when. Durations always in numbers',
      'Safety-critical profile: allergies, skin sensitivity, pregnancy/breastfeeding (essential for contraindicated-oil decisions), conditions, medications, past skin reactions to essential oils — top priority',
      'Scent preferences and blend used: which scents they liked or rejected during selection, their reaction on the first smell; the exact blend applied (e.g. lavender × bergamot), carrier oil, dilution — always record names and numbers',
      "Therapist's findings and treatment performed: body tension, coldness, puffiness, skin condition (dryness, how the oil absorbed); course, length, focus areas, pressure",
      'Reaction to treatment and pressure/environment preferences: depth of relaxation (fell asleep etc.), areas that eased, spots that hurt or tickled (record their words with nuance); pressure strength, room temperature, music, how much conversation they want',
      'Sleep and stress changes: how they slept after the last session, shifts in their stress response',
      'Home care: room diffusion or bath salts suggested, oils purchased, contraindication guidance given (e.g. avoid sun exposure after citrus oils)',
      'Next visit and plan: booked date/time, blend direction for next time, recommended visit rhythm, promises the therapist made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: 'お客様の来店目的・悩み（疲労・ストレス・眠りの浅さ・冷え・PMS等。いつから、期限がある場合はそれも）' },
      { label: '注意', def: '安全・接客上の注意（アレルギー・肌の敏感さ・妊娠中/授乳中・持病・服用中の薬・過去の精油での肌トラブル）' },
      { label: '状態', def: '本日のセラピストの所見（体の張り・冷え・むくみ・肌の状態）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '施術', def: '使用した精油・ブレンド（名前・キャリアオイル・希釈濃度）と選香時の香りの好み、実施したトリートメント（コース・時間・重点部位・圧）、お客様の反応（リラックスの深さ・楽になった部位・痛かった/くすぐったかった箇所）' },
      { label: 'ホームケア', def: '提案した芳香浴・バスソルト・購入した精油、伝えた禁忌説明（柑橘系精油の後の紫外線注意など）' },
      { label: '生活', def: '前回施術後の眠りの質・ストレス反応の変化など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回のブレンド方針／セラピストが約束した内容／保留になった提案／継続・来店頻度に関わるお客様の意向／回数券の残回数／推奨来店頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Concerns', def: "the customer's reason for visiting (fatigue, stress, light sleep, cold sensitivity, PMS etc.); since when, and any deadline" },
      { label: 'Cautions', def: 'safety and service cautions (allergies, skin sensitivity, pregnancy/breastfeeding, conditions, medications, past skin reactions to essential oils)' },
      { label: 'Condition', def: "today's therapist findings (body tension, coldness, puffiness, skin condition); state improved/worse/unchanged ONLY when the conversation shows the change vs last time" },
      { label: 'Treatment', def: "oils and blend used (names, carrier oil, dilution) plus scent preferences shown during selection, the treatment given (course, length, focus areas, pressure), and the customer's reaction (depth of relaxation, areas eased, spots that hurt or tickled)" },
      { label: 'Home care', def: 'room diffusion or bath salts suggested, oils purchased, contraindication guidance given (e.g. avoid sun exposure after citrus oils)' },
      { label: 'Life', def: "sleep quality and stress-response changes since the last session — useful for next visit's conversation" },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: blend direction for next time / promises the therapist made / deferred proposals / renewal or attendance intent / ticket balance / recommended cadence. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「冷え性：2年前の出産後から悪化、特に足先が冷えて眠りが浅い」',
      '（treatment）：「ラベンダー×スイートオレンジをホホバオイルで3%希釈、全身60分・脚は強めに実施」',
    ],
    goodExamplesEn: [
      '(symptom): "Cold sensitivity: worse since giving birth 2 years ago, cold feet especially, disturbs sleep"',
      '(treatment): "Lavender × sweet orange in jojoba carrier, 3% dilution, 60-min full body, firmer pressure on legs"',
    ],
    passportFieldsJa: [
      { key: 'scent_pref', label: '香りの好み', hint: '本人が好む香りの系統（柑橘系・フローラル系など）と苦手な香りや肌反応。気分ではなく普段からの好み' },
      { key: 'session_style_pref', label: '施術中の希望', hint: '会話量・音楽・部屋の明るさなど、本人が話した施術中の環境の好み（毎回変わらないもの）' },
      { key: 'chief_concern', label: '心身の不調', hint: '繰り返し話題になる心身の不調やストレスの原因（一時的な体調ではなく継続的な傾向）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態と、それが心身に与える影響' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望来店ペース（週1・月1など）' },
    ],
    passportFieldsEn: [
      { key: 'scent_pref', label: 'Scent preference', hint: "scent families the customer prefers (citrus, floral, woody, etc.) and any disliked scents or skin reactions — a standing preference, not today's mood" },
      { key: 'session_style_pref', label: 'Session style', hint: "conversation level, music, lighting — the customer's stated preference for the session atmosphere, not a one-off request" },
      { key: 'chief_concern', label: 'Wellness concern', hint: 'the recurring physical or emotional concern the customer mentions repeatedly — a standing pattern, not a one-off complaint' },
      { key: 'occupation', label: 'Occupation', hint: "work and how it affects the customer's stress or wellbeing" },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence they said they want (e.g., weekly, monthly)' },
    ],
  },
  wellness_clinic: {
    serviceNounJa: '施術', serviceNounEn: 'treatment',
    roleJa: 'ウェルネス専門家', roleEn: 'wellness practitioner',
    businessNounJa: 'ウェルネスクリニック', businessNounEn: 'wellness clinic',
    primaryFocusJa: 'ホリスティック健康・予防ウェルネス・統合的なプロトコル',
    primaryFocusEn: 'holistic health, preventive wellness, and integrative protocols',
    seasonalRelevance: 'medium', clinicalPosture: 'wellness',
    typicalConcernsJa: ['生活習慣由来の疲労パターン', '予防指標のトレンド', '目標に対する栄養コンプライアンス'],
    typicalConcernsEn: ['lifestyle-driven fatigue patterns', 'preventive markers trending', 'nutrition-adherence alignment with goals'],
    captureChecklistJa: [
      '主訴・目標：疲労・体重・睡眠・健診数値の改善など、何をどうしたいか。目標値と期限（「3ヶ月で−5kg」等）は必ず数字で記録',
      '安全に関わる既往：持病・服薬中の薬・使用中のサプリメント・アレルギー — 提案するプロトコルとの相互作用に直結するため最優先で記録',
      '測定値・専門家の評価：会話に出た体重・体脂肪率・血圧・健診の数値などはすべて数字のまま記録し、生活習慣のどこがボトルネックか、前回からの改善/悪化/停滞の判断も記録',
      '本日行ったこと：カウンセリング・施術・検査・プログラムの調整内容',
      '食事・運動習慣：食事内容・間食・飲酒・カフェイン、運動の種類・頻度・継続状況（「週3回」など数字で）、指導への実践度（守れた/守れなかった、その理由）',
      '睡眠とストレス：睡眠時間・質・ストレス源 — 時間は数字で記録',
      '出した指導・プロトコルとお客様の反応：食事の置き換え・歩数目標・サプリの用量など数値まで具体的に、前向きか停滞気味か・続かない理由・本人の言葉',
      '次回・プラン：次回予約の日時、再評価のタイミング、次に見直す指標、専門家が約束した内容、コース・プログラムの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Chief concern and goal: fatigue, weight, sleep, improving health-check numbers — what they want to change. Always record targets and deadlines in numbers (e.g. "−5 kg in 3 months")',
      'Safety-critical history: conditions, current medications, supplements in use, allergies — top priority, it drives the interaction check for any protocol you propose',
      "Measurements and practitioner's assessment: every number mentioned — weight, body fat, blood pressure, health-check results — recorded as numbers; plus which lifestyle habit is the bottleneck and whether they're improved / worse / plateaued since last visit",
      'What was done today: counseling, treatments, tests, program adjustments',
      "Nutrition and exercise habits: meals, snacking, alcohol, caffeine; exercise type, frequency, consistency (e.g. '3× a week'); how well they followed the plan (kept it / didn't, and why)",
      'Sleep and stress: hours, quality, stress sources — hours in numbers',
      "Protocol given and customer's reaction: meal swaps, step targets, supplement doses — specific down to the numbers; energized or stalling, what blocks adherence, their own words",
      'Next visit and plan: booked date/time, when to re-assess, which marker to review next, promises the practitioner made, course/program balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '目標', def: 'お客様の目標（疲労・体重・睡眠・健診数値の改善など）と目標値・期限（「3ヶ月で−5kg」等は数字で）' },
      { label: '注意', def: '安全上の注意（持病・服薬中の薬・使用中のサプリメント・アレルギー — 提案するプロトコルとの相互作用に関わる）' },
      { label: '指標', def: '会話に出た測定値（体重・体脂肪率・血圧・健診数値など）を数字のまま記録し、専門家の見立て（生活習慣のボトルネック）を明記。前回からの変化が会話から分かる場合に限り、改善／悪化／停滞を明記する（分からない場合は変化について何も書かない）' },
      { label: '実施内容', def: '本日行ったカウンセリング・施術・検査・プログラム調整の内容' },
      { label: 'プロトコル', def: '出した指導・プロトコル（食事の置き換え・歩数目標・サプリの用量など数値まで）と、それへのお客様の反応・モチベーション（前向き/停滞、続かない理由、本人の言葉）' },
      { label: '生活', def: '食事内容・間食・飲酒・カフェイン、運動の種類・頻度・継続状況、睡眠時間・質・ストレス源（時間は数字で）、指導への実践度（守れた/守れなかった、その理由）' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回確認すること／専門家がお客様に約束した内容／保留になった提案／継続・プログラム更新に関わるお客様の意向／コース・プログラムの残回数／再評価のタイミング／次に見直す指標。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Goals', def: "the customer's goals (fatigue, weight, sleep, health-check improvement) with target values and deadlines (e.g. '−5 kg in 3 months')" },
      { label: 'Cautions', def: 'safety cautions (conditions, current medications, supplements in use, allergies — relevant to protocol interactions)' },
      { label: 'Markers', def: "measurements mentioned (weight, body fat, blood pressure, health-check results) recorded as numbers, plus the practitioner's assessment (the lifestyle bottleneck); state improved/worse/plateaued ONLY when the conversation shows the change vs last time" },
      { label: 'Session', def: 'what was done today: counseling, treatments, tests, program adjustments' },
      { label: 'Protocol', def: "protocol given (meal swaps, step targets, supplement doses — down to the numbers) and the customer's reaction/motivation (energized or stalling, what blocks adherence, their own words)" },
      { label: 'Lifestyle', def: "meals, snacking, alcohol, caffeine; exercise type, frequency, consistency; sleep hours/quality, stress sources (hours as numbers); how well they followed the plan (kept it / didn't, and why)" },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises the practitioner made / deferred proposals / renewal or program intent / course or program balance / re-assessment timing / marker to review next. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「体重：半年前から3kg増加、夜間の間食が習慣化」',
      '（treatment）：「朝食を高たんぱくに置き換え、ウォーキング1日8000歩を提案、次回まで4週間」',
    ],
    goodExamplesEn: [
      '(symptom): "Weight: up 3kg over the past 6 months, nighttime snacking has become a habit"',
      '(treatment): "Recommended swapping breakfast for a high-protein option and 8,000 steps/day walking, reassess in 4 weeks"',
    ],
    passportFieldsJa: [
      { key: 'wellness_goal', label: 'ウェルネス目標', hint: '本人が話した目標を具体的な数値で（目標体重○kg、達成時期、睡眠時間○時間など）。世間話ではなく本人が定めた目標に限る' },
      { key: 'protocol_stage', label: 'プログラム段階', hint: '現在取り組んでいるプログラム・プロトコルの段階（例:「腸活プログラム3週目」「メンテナンス期」）。最新のセッションの内容で更新する' },
      { key: 'chief_concern', label: '根本の不調', hint: 'プログラムのきっかけとなった、繰り返し話題になる不調や体質（今日だけの症状ではない）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態と、それが生活リズムや疲労に与える影響' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望来店・確認ペース（週1・月1など）' },
    ],
    passportFieldsEn: [
      { key: 'wellness_goal', label: 'Wellness goal', hint: "the customer's stated goal in concrete figures where mentioned (target weight in kg, target date, sleep-hours goal, etc.) — a goal they set, not small talk" },
      { key: 'protocol_stage', label: 'Protocol stage', hint: 'which stage or phase of their wellness protocol/program they are in now (e.g., "week 3 of gut-reset program," "maintenance phase") — use the most recent session' },
      { key: 'chief_concern', label: 'Underlying concern', hint: 'the recurring health concern or constitutional pattern that motivated the program — chronic, not a one-day symptom' },
      { key: 'occupation', label: 'Occupation', hint: "work and how it affects the customer's routine or fatigue pattern" },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit or check-in cadence they said they want' },
    ],
  },
  mental_health: {
    serviceNounJa: 'セッション', serviceNounEn: 'session',
    roleJa: 'カウンセラー', roleEn: 'counselor',
    businessNounJa: 'カウンセリングルーム', businessNounEn: 'counseling practice',
    primaryFocusJa: '情緒的ウェルビーイング・メンタルヘルスの進捗・治療同盟',
    primaryFocusEn: 'emotional wellbeing, mental health progress, and therapeutic alliance',
    seasonalRelevance: 'low', clinicalPosture: 'clinical',
    typicalConcernsJa: ['セッション間の気分の変化', '対処スキルの有効性', '治療目標の進捗'],
    typicalConcernsEn: ['mood tracking across sessions', 'coping-strategy effectiveness', 'therapeutic-goal progression'],
    captureChecklistJa: [
      '主訴・本日の話題：何に悩んでいるか、いつから、きっかけとなった出来事。仕事・家庭・人間関係で起きた具体的な出来事（誰との間で・何があったか）を含む。期間は必ず数字で記録',
      '安全・医療情報：服薬状況（薬名・用量・変更）・並行して通院中の医療機関。自傷や希死念慮を示唆する発言は解釈を加えずそのまま記録し、最優先で扱う',
      '前回からの変化：気分の推移・睡眠・食欲・生活リズム（「眠れない日が週3日」等、頻度は数字で）',
      'カウンセラーの所見と本人の言葉：表情・声のトーン・話し方・面接中の様子（防衛的/開放的など）の変化、気づき・キーフレーズ（「初めて人に話せた」等）はそのまま引用で記録',
      'セッションで行ったこと：扱ったテーマと用いたアプローチ（傾聴・認知の整理・リフレーミング等）',
      '対処法の実践と次回までの課題：前回の課題や対処スキルを使えたか・その効果・妨げになったもの、出したホームワーク（記録をつける・行動実験など）を具体的に',
      '生活と支え：睡眠・運動・飲酒、支えになっている人・活動・居場所',
      '次回・プラン：次回予約の日時、次回扱う予定のテーマ',
    ],
    captureChecklistEn: [
      "Presenting issue and today's topic: what they're struggling with, since when, and the triggering event; include concrete events at work, at home, or in relationships (with whom, what happened). Durations in numbers",
      "Safety and medical info: medication status (names, doses, changes), other providers they're seeing. Any statement suggesting self-harm or suicidal ideation must be recorded verbatim, without interpretation, and treated as top priority",
      'Change since last session: mood trajectory, sleep, appetite, daily rhythm (frequencies as numbers, e.g. 3 nights a week)',
      "Counselor's observations and client's own words: shifts in expression, tone of voice, way of speaking, in-session presentation (guarded vs open); insights and key phrases quoted verbatim (kept in the client's own words)",
      'Session work: themes covered and approach used (active listening, cognitive restructuring, reframing etc.)',
      "Coping practice and homework: whether they used last session's strategies, how well they worked, what got in the way; homework assigned for before next session (mood log, behavioral experiment etc.) — specific",
      'Life and supports: sleep, exercise, alcohol; the people, activities, and places holding them up',
      'Next session and plan: booked date/time, themes planned for next time',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: '本日の相談内容・出来事（悩みの内容、いつから、きっかけ、仕事・家庭・人間関係で起きた具体的な出来事）' },
      { label: '注意', def: '安全・医療上の注意（服薬状況・変更、並行して通院中の医療機関）。自傷や希死念慮を示唆する発言は解釈を加えずそのまま記録し、最優先で扱う' },
      { label: '所見', def: 'カウンセラーが観察した様子（表情・声のトーン・話し方・面接中の防衛的/開放的な様子）と、本人の気づき・キーフレーズ（そのまま引用）。前回からの気分・睡眠・食欲・生活リズムの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: 'セッション', def: '本日扱ったテーマと用いたアプローチ（傾聴・認知の整理・リフレーミング等）' },
      { label: '対処・宿題', def: '前回の課題や対処スキルを使えたか・その効果・妨げになったもの、本日出したホームワーク（記録をつける・行動実験など）の具体的な内容' },
      { label: '生活', def: '睡眠・運動・飲酒などの生活習慣と、支えになっている人・活動・居場所' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回扱う予定のテーマ／次回までに様子を見ること。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Presenting issue', def: "today's topic and events (what they're struggling with, since when, trigger, concrete events at work/home/relationships)" },
      { label: 'Cautions', def: "safety and medical notes (medication status and changes, other providers they're seeing). Any statement suggesting self-harm or suicidal ideation must be recorded verbatim, without interpretation, and treated as top priority" },
      { label: 'Observations', def: "the counselor's observations (expression, tone, way of speaking, guarded vs. open presentation) and the client's own insights/key phrases, kept in their own words; state improved/worse/unchanged in mood, sleep, appetite, or daily rhythm ONLY when the conversation shows the change vs last session" },
      { label: 'Session work', def: 'themes covered today and the approach used (active listening, cognitive restructuring, reframing etc.)' },
      { label: 'Coping & homework', def: "whether they used last session's coping strategies, how well they worked, what got in the way, and the specific homework assigned today (mood log, behavioral experiment etc.)" },
      { label: 'Life', def: 'lifestyle factors (sleep, exercise, alcohol) and the people, activities, and places holding them up' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: themes planned for next session / things to watch before then. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「不眠：2週間前から悪化、仕事のプロジェクト締切と重なる」',
      '（treatment）：「呼吸法（4-7-8呼吸）を就寝前に3セット練習するようホームワークとして提示」',
    ],
    goodExamplesEn: [
      '(symptom): "Insomnia: worsening for ~2 weeks, coinciding with a work project deadline"',
      '(treatment): "Assigned 4-7-8 breathing practice, 3 sets before bed, as homework"',
    ],
    passportFieldsJa: [
      { key: 'care_team', label: '服薬・通院先', hint: '並行して通院中の医療機関と服薬状況（薬名・処方医）。診断名は書かない' },
      { key: 'chief_concern', label: '取り組みテーマ', hint: '複数回のセッションで繰り返し出るテーマ（診断名ではなく本人の言葉で）' },
      { key: 'stressors', label: 'ストレス要因', hint: '繰り返し語られる負荷の背景（仕事・家庭・人間関係など）' },
      { key: 'supports', label: '支え・つながり', hint: '本人を支える人・活動・居場所（継続的な支えのみ）' },
      { key: 'coping_pattern', label: '有効な対処法', hint: 'これまで効果があった・なかった対処法やアプローチ' },
    ],
    passportFieldsEn: [
      { key: 'care_team', label: 'Care team & meds', hint: 'other providers seen concurrently and medication status (name, prescriber) — never a diagnosis' },
      { key: 'chief_concern', label: 'Focus area', hint: 'the theme that keeps coming up across sessions, in their own words — not a diagnostic label' },
      { key: 'stressors', label: 'Stressors', hint: 'recurring situations behind their distress (work, family, relationships)' },
      { key: 'supports', label: 'Supports', hint: 'the people, activities, or places that hold them up — ongoing ones only' },
      { key: 'coping_pattern', label: 'Coping patterns', hint: 'which coping strategies have worked or not worked for them over time' },
    ],
  },
  veterinary: {
    serviceNounJa: '処置', serviceNounEn: 'procedure',
    roleJa: '獣医師', roleEn: 'veterinarian',
    businessNounJa: '動物病院', businessNounEn: 'veterinary clinic',
    primaryFocusJa: '動物の健康・種/品種別のケア・予防医療',
    primaryFocusEn: 'animal health, species/breed-specific care, and preventive medicine',
    seasonalRelevance: 'medium', clinicalPosture: 'clinical',
    typicalConcernsJa: ['ワクチン・予防薬スケジュールの遵守', '品種特異的疾患のモニタリング', '食事・体重管理の進捗'],
    typicalConcernsEn: ['vaccination/parasite schedule adherence', 'breed-predisposed condition monitoring', 'diet/weight-management progress'],
    captureChecklistJa: [
      '主訴：どんな症状（食欲不振・嘔吐・下痢・跛行・かゆみ等）がいつから。頻度・回数（「嘔吐2回/日」等）は必ず数字で記録',
      '動物の基本情報と安全に関わる病歴：体重（必ずkgの数値で）・年齢・避妊去勢の有無、既往歴・慢性疾患・服薬中の薬・過去の麻酔や薬への副反応・薬/食物アレルギー — 最優先で記録',
      '予防歴：ワクチン・フィラリア・ノミダニ予防の実施状況と次回の時期',
      '診察所見と検査結果：体温・心音・触診・体格（BCS）・皮膚被毛や目耳の状態などの観察と評価、血液検査・レントゲン・エコー等実施した検査の数値・所見',
      '本日の処置・治療：注射・処置・処方 — 薬品名・用量・投与日数を必ず記録',
      '飼い主への指示：投薬のやり方・食事制限・安静の程度・自宅で観察すべきポイント',
      '食事・生活環境と性格・扱いの注意：フードの種類と量・おやつ・運動量・室内/屋外・多頭飼い、診察台で暴れる・咬む可能性・口輪やタオルが必要・キャリー嫌い等',
      '次回・プラン：再診日、抜糸や再検査の予定、次回ワクチンの時期',
    ],
    captureChecklistEn: [
      'Presenting complaint: which signs (poor appetite, vomiting, diarrhea, limping, itching etc.) and since when. Frequency and counts (e.g. "vomited 2× a day") always in numbers',
      'Patient basics and safety-critical history: weight (always as a number in kg), age, spay/neuter status; prior conditions, chronic disease, current medications, past reactions to anesthesia or drugs, drug/food allergies — top priority',
      'Preventive care status: vaccines, heartworm, flea/tick prevention — done or due, and when the next one falls',
      'Exam findings and test results: temperature, heart sounds, palpation, body condition score, skin/coat/eyes/ears observations and assessment; bloodwork, X-ray, ultrasound etc. — what was run and the resulting numbers and findings',
      "Today's treatment: injections, procedures, prescriptions — always record drug names, doses, and days of administration",
      'Owner instructions: how to give the meds, diet restrictions, rest level, what to watch for at home',
      'Diet, living situation, and temperament notes: food brand and amount, treats, exercise, indoor/outdoor, other pets in the home; struggles on the exam table, may bite, needs a muzzle or towel wrap, hates the carrier',
      'Next visit and plan: recheck date, suture removal or repeat tests, next vaccine due',
    ],
    summaryLabelsJa: [
      { label: '主訴', def: '飼い主が伝えた症状（食欲不振・嘔吐・下痢・跛行・かゆみ等）、いつから、頻度・回数（「嘔吐2回/日」等は数字で）' },
      { label: '注意', def: '安全に関わる情報（既往歴・慢性疾患・服薬中の薬・過去の麻酔や薬への副反応・薬/食物アレルギー）' },
      { label: '所見', def: '本日の診察・検査所見（体温・心音・触診・体格（BCS）・皮膚被毛や目耳の状態、血液検査・レントゲン・エコー等の数値と評価）、体重（kg数値）、ワクチン・フィラリア・ノミダニ予防の実施状況、性格・扱いの注意（暴れる・咬む可能性・口輪が必要等）。前回からの体重・体調の変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '処置', def: '本日実施した注射・処置・処方（薬品名・用量・投与日数）' },
      { label: '飼い主指示', def: '投薬のやり方・食事制限・安静の程度・自宅で観察すべきポイントとして飼い主に伝えた内容' },
      { label: '生活', def: 'フードの種類と量・おやつ・運動量・室内/屋外・多頭飼いなど、動物の生活環境' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：再診・抜糸・再検査の予定／次回ワクチンの時期／獣医師が飼い主に約束した内容／保留になった提案。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Presenting complaint', def: 'signs the owner reported (poor appetite, vomiting, diarrhea, limping, itching etc.), since when, and frequency/counts (e.g. "2× a day") as numbers' },
      { label: 'Cautions', def: 'safety-critical history (prior conditions, chronic disease, current medications, past reactions to anesthesia or drugs, drug/food allergies)' },
      { label: 'Findings', def: "today's exam and test findings (temperature, heart sounds, palpation, body condition score, skin/coat/eyes/ears, bloodwork/X-ray/ultrasound values and assessment), weight (in kg), vaccine/heartworm/flea-tick prevention status, and temperament/handling notes (struggles, may bite, needs a muzzle); state improved/worse/unchanged ONLY when the conversation shows the change in weight or condition vs last time" },
      { label: 'Treatment', def: "today's injections, procedures, and prescriptions (drug names, doses, days of administration)" },
      { label: 'Owner instructions', def: 'how to give the meds, diet restrictions, rest level, and what to watch for at home, as communicated to the owner' },
      { label: 'Home life', def: "the animal's living situation — food brand and amount, treats, exercise, indoor/outdoor, other pets in the home" },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: recheck / suture-removal / repeat-test plans / next vaccine due / promises the vet made / deferred proposals. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「体重4.2kg、嘔吐が3日前から1日2回、食欲不振」',
      '（treatment）：「セファレキシン1回250mgを1日2回、5日分処方」',
    ],
    goodExamplesEn: [
      '(symptom): "Weight 4.2kg, vomiting 2x/day for the past 3 days, poor appetite"',
      '(treatment): "Prescribed cephalexin 250mg twice daily for 5 days"',
    ],
    passportFieldsJa: [
      { key: 'species_breed', label: '種類・品種', hint: 'ペットの種類と品種（例:「犬・トイプードル」）。飼い主ではなく動物本体の情報' },
      { key: 'age_weight', label: '年齢・体重', hint: 'ペットの年齢（歳・ヶ月を数字で）と体重（kg）。会話に出た最新の数値を採用' },
      { key: 'temperament', label: '性格・注意点', hint: 'ペットの性格や取扱い上の注意（人見知り・噛み癖・保定の工夫など）。その日だけの様子ではなく普段の傾向' },
      { key: 'chief_concern', label: '持病・体質', hint: 'ペットの慢性的な持病や体質（今日だけの症状ではなく継続している既往）' },
      { key: 'maintenance_pref', label: '通院ペース', hint: '飼い主が話した通院・ワクチン接種の希望ペース' },
    ],
    passportFieldsEn: [
      { key: 'species_breed', label: 'Species / breed', hint: "the pet's species and breed (e.g., \"dog, toy poodle\") — about the animal, never the owner" },
      { key: 'age_weight', label: 'Age / weight', hint: "the pet's age (years/months, as digits) and weight (kg) — use the most recently stated figures" },
      { key: 'temperament', label: 'Temperament', hint: "the pet's temperament and handling notes (nervous around strangers, biting tendency, restraint tips) — a standing trait, not just today's mood" },
      { key: 'chief_concern', label: 'Chronic condition', hint: "the pet's chronic condition or constitutional tendency — ongoing, not today's symptom" },
      { key: 'maintenance_pref', label: 'Checkup cadence', hint: 'the checkup or vaccination cadence the owner has stated they want' },
    ],
  },
  pet_grooming: {
    serviceNounJa: 'トリミング', serviceNounEn: 'grooming',
    roleJa: 'トリマー', roleEn: 'pet groomer',
    businessNounJa: 'ペットグルーミングサロン', businessNounEn: 'pet grooming salon',
    primaryFocusJa: 'ペットの被毛コンディション・犬種/猫種別のケア・グルーミングスケジュール',
    primaryFocusEn: 'pet coat condition, breed-specific care, and grooming schedule',
    seasonalRelevance: 'medium', clinicalPosture: 'service',
    typicalConcernsJa: ['季節ごとの抜け毛パターン', '特定の製品による皮膚の刺激', '特定のツールへの慣れ具合'],
    typicalConcernsEn: ['shedding patterns by season', 'skin irritation from specific products', 'behavioral comfort with specific tools'],
    captureChecklistJa: [
      '本日のオーダー：依頼されたカットスタイル — バリカンの◯mm・ハサミ仕上げ・顔/足/尻尾/耳の形の指定を具体的に記録',
      '安全に関わる体質と被毛・皮膚の状態：皮膚疾患・アレルギー・施術の負担に関わる持病（心臓・てんかん・高齢など）・過去のシャンプーや製品でのトラブル — 最優先で記録。毛玉やもつれの程度と場所、換毛の状態、皮膚の赤み・フケ・べたつきも記録',
      '施術中に見つけたこと：しこり・耳の汚れや臭い・ノミダニ・爪の伸びすぎ・肛門腺のたまり等 — 飼い主に伝えた内容ごと記録',
      '実施した内容：シャンプー（使用した製品名）・カット・爪切り・耳掃除・肛門腺絞り・歯みがき等',
      '施術中の様子・扱いの注意と仕上がりへの反応：ドライヤー嫌い・足先を触ると嫌がる/咬む・台の上で震える・おやつで落ち着く等、飼い主が気に入った点・次回変えたい点、ペットの帰り際の様子',
      '自宅ケア指導：ブラッシングの頻度と道具、シャンプーの間隔、もつれやすい部位のケア',
      '生活情報と飼い主との会話：散歩・食事・室内/屋外・多頭飼い・最近の様子の変化、家族・旅行の予定など次回の会話と信頼関係に活きる話題',
      '次回・プラン：次回予約の日時、被毛の伸びを踏まえた推奨周期（「◯週間ごと」）、次回のスタイル相談、トリマーが約束した内容、回数券の残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      "Today's order: the requested style — clipper length in mm, scissor finish, face/feet/tail/ear shape specifics, recorded exactly",
      'Safety-critical health notes and coat/skin condition: skin conditions, allergies, issues that affect grooming stress (heart condition, epilepsy, senior age), past reactions to shampoos or products — top priority; also record matting severity and locations, shedding state, skin redness, dandruff, oiliness',
      'Found during grooming: lumps, dirty or smelly ears, fleas/ticks, overgrown nails, full anal glands — recorded together with what was reported to the owner',
      'Work performed: shampoo (product name used), cut, nail trim, ear cleaning, anal gland expression, teeth brushing',
      'Behavior/handling notes and reaction to the result: hates the dryer, nips when paws are touched, trembles on the table, settles with treats; what the owner liked, what to change next time, how the pet seemed leaving',
      'Home-care coaching: brushing frequency and tools, bath interval, care for mat-prone spots',
      "Life details and owner conversation: walks, food, indoor/outdoor, other pets, recent changes in behavior; family, travel plans — anything that fuels next visit's conversation and trust",
      'Next visit and plan: booked date/time, recommended cycle based on coat growth (e.g. "every 6 weeks"), style ideas for next time, promises the groomer made, ticket balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: 'オーダー', def: '依頼されたカットスタイル（バリカンの◯mm・ハサミ仕上げ・顔/足/尻尾/耳の形の指定など）' },
      { label: '注意', def: '安全に関わる情報（皮膚疾患・アレルギー・施術の負担に関わる持病（心臓・てんかん・高齢など）・過去のシャンプーや製品でのトラブル）' },
      { label: '被毛', def: '被毛と皮膚の状態（毛玉やもつれの程度と場所、換毛の状態、皮膚の赤み・フケ・べたつき）と、施術中に見つけたこと（しこり・耳の汚れや臭い・ノミダニ・爪の伸びすぎ・肛門腺のたまり等、飼い主に伝えた内容ごと）。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: 'トリミング', def: '実施した内容（シャンプーの製品名・カット・爪切り・耳掃除・肛門腺絞り・歯みがき等）、施術中の様子・扱いの注意（ドライヤー嫌い・足先を触ると嫌がる/咬む・台の上で震える・おやつで落ち着く等）、仕上がりへの反応（飼い主が気に入った点・次回変えたい点、ペットの帰り際の様子）' },
      { label: '自宅ケア', def: 'ブラッシングの頻度と道具、シャンプーの間隔、もつれやすい部位のケアなど飼い主に伝えた指導' },
      { label: '生活', def: '散歩・食事・室内/屋外・多頭飼い・最近の様子の変化と、家族・旅行の予定など飼い主との会話で次回に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：被毛の伸びを踏まえた推奨来店周期／トリマーが飼い主に約束した内容／保留になった提案／回数券の残回数や継続の意向／次回のスタイル相談。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Order', def: 'the requested style (clipper length in mm, scissor finish, face/feet/tail/ear shape specifics)' },
      { label: 'Cautions', def: 'safety-critical info (skin conditions, allergies, issues that affect grooming stress — heart condition, epilepsy, senior age — past reactions to shampoos or products)' },
      { label: 'Coat', def: 'coat and skin condition (matting severity and location, shedding state, skin redness, dandruff, oiliness) and what was found during grooming (lumps, dirty or smelly ears, fleas/ticks, overgrown nails, full anal glands — together with what was reported to the owner); state improved/worse/unchanged ONLY when the conversation shows the change vs last time' },
      { label: 'Grooming', def: 'work performed (shampoo product name, cut, nail trim, ear cleaning, anal gland expression, teeth brushing), behavior and handling notes during the session (hates the dryer, nips when paws are touched, trembles, settles with treats), and reaction to the result (what the owner liked, what to change next time, how the pet seemed leaving)' },
      { label: 'Home care', def: 'brushing frequency and tools, bath interval, care for mat-prone spots — instructions given to the owner' },
      { label: 'Life', def: 'walks, food, indoor/outdoor, other pets, recent changes in behavior, plus family/travel topics from owner conversation useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: recommended cycle based on coat growth / promises the groomer made / deferred proposals / ticket balance and renewal intent / style ideas for next time. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「右耳：2週間前から赤みとかゆみがあり、後ろ足で掻く仕草が増えた」',
      '（treatment）：「もつれの強い後ろ足周りをスリッカーで丁寧に解いてからバリカン3mmでカット」',
    ],
    goodExamplesEn: [
      '(symptom): "Right ear: redness and itching for the past 2 weeks, scratching more with the hind paw"',
      '(treatment): "Carefully worked out heavy matting around the hind legs with a slicker brush before a 3mm clipper cut"',
    ],
    passportFieldsJa: [
      { key: 'species_breed', label: '種類・品種', hint: 'ペットの種類と品種（例:「犬・トイプードル」）。飼い主ではなく動物本体の情報' },
      { key: 'temperament', label: '性格・注意点', hint: 'ペットの性格や、バリカン・ドライヤーなど特定の道具への慣れ具合。その日だけの様子ではなく普段の傾向' },
      { key: 'chief_concern', label: '肌・毛の注意', hint: 'ペットの、特定のシャンプーや製品による皮膚トラブル、繰り返す毛玉など継続的な注意点（今日だけの症状ではない）' },
      { key: 'coat_type', label: '被毛タイプ', hint: 'ペットの被毛の質・タイプ（巻き毛・ダブルコートなど）。カットのたびに変わらない性質' },
      { key: 'style_pref', label: '希望スタイル', hint: '飼い主が話した希望のカット・長さ・スタイル（「いつもの」等はその表現のまま）' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '飼い主が話した希望来店ペース（例: 6週間ごと）' },
    ],
    passportFieldsEn: [
      { key: 'species_breed', label: 'Species / breed', hint: "the pet's species and breed (e.g., \"dog, toy poodle\") — about the animal, never the owner" },
      { key: 'temperament', label: 'Temperament', hint: "the pet's temperament and comfort with specific tools (clippers, dryer, nail trim) — a standing trait, not just today's mood" },
      { key: 'chief_concern', label: 'Skin / coat caution', hint: "the pet's standing skin/coat cautions (irritation from a specific shampoo, recurring matting, etc.) — not a one-time issue" },
      { key: 'coat_type', label: 'Coat type', hint: "the pet's coat texture/type (curly, double coat, wire-haired, etc.) — a fixed trait, not this visit's length" },
      { key: 'style_pref', label: 'Style preference', hint: "the owner's standing preference for cut, length, or style (keep \"the usual\"-style requests verbatim)" },
      { key: 'maintenance_pref', label: 'Maintenance preference', hint: 'the visit cadence the owner said they want (e.g., every 6 weeks)' },
    ],
  },
  training_school: {
    serviceNounJa: 'レッスン', serviceNounEn: 'lesson',
    roleJa: '講師', roleEn: 'instructor',
    businessNounJa: 'スクール', businessNounEn: 'training school',
    primaryFocusJa: 'スキルの発達・生徒の進捗・学習成果',
    primaryFocusEn: 'skill development, student progression, and learning outcomes',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['スキルレベルのマイルストーン達成', 'セッション間のエンゲージメント', '自主練習の継続性'],
    typicalConcernsEn: ['skill-level milestone progression', 'engagement patterns between sessions', 'home-practice consistency'],
    captureChecklistJa: [
      '本日のレッスン内容：扱った教材・単元・課題曲 — ページや番号まで具体的に記録',
      '上達・つまずきと講師の評価：前回からの上達・合格した課題・クリアしたレベル、苦手な部分や繰り返すミス・理解が浅い概念（どこで・どう詰まるか具体的に）。加えて講師が見立てた現在のレベルと、伸びている点・次に伸ばすべき点',
      '目標と日程：検定・試験・発表会・大会など — 目標は必ず日付とセットで記録',
      '宿題の実施状況と次の宿題：前回の宿題をやってきたか、練習時間・頻度（「週3回30分」等、数字で）。加えて次回までに出す宿題の範囲・回数・時間を具体的に記録',
      '学び方の個性とモチベーション：褒めると伸びる・理屈から入りたい・緊張しやすい等、指導の仕方に関わる特性。加えてやる気の状態と本人の言葉（「楽しい」「やめたくなった」等はそのまま記録）',
      '生活背景：学校・部活・仕事など練習時間に影響するもの、次回の会話に活きる話題',
      '次回・プラン：次回レッスンの日時・扱う予定の内容、保護者への連絡事項、講師が約束した内容、月謝・回数券の残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      "Today's lesson content: materials, unit, assigned piece — down to page and exercise numbers",
      "Progress, sticking points & instructor's assessment: progress since last lesson, passed assignments, levels cleared; weak spots, repeated mistakes, concepts not yet solid (exactly where and how they get stuck). Plus the instructor's read on current level and what to develop next",
      'Goals and dates: certification tests, exams, recitals, competitions — always record the goal together with its date',
      'Homework follow-through & next assignment: whether the previous homework was completed, and practice time/frequency in numbers ("30 min, 3× a week"). Plus the scope, reps, and time set for the next lesson',
      'Learning style & motivation: thrives on praise, wants the theory first, gets nervous easily — anything shaping how to teach them. Plus current drive and their own words ("this is fun" / "I almost quit") recorded verbatim',
      'Life context: school, club activities, work — affecting practice time; plus conversation topics useful next lesson',
      'Next lesson and plan: date/time, planned content, anything to relay to parents, promises the instructor made, tuition/ticket balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: 'レッスン', def: '本日扱った教材・単元・課題（ページや番号）' },
      { label: '進捗', def: '前回からの上達・合格した課題・クリアしたレベル、苦手な部分や繰り返すミス・理解が浅い概念（どこで・どう詰まるか）。講師の見立て（伸びている点・次に伸ばすべき点）も含む' },
      { label: '目標', def: '検定・試験・発表会・大会などの目標と日付' },
      { label: '宿題', def: '前回の宿題の実施状況（練習時間・頻度）と、次回までに出した宿題（範囲・回数・時間）' },
      { label: '様子', def: '指導の仕方に関わる特性（褒めると伸びる・理屈から入りたい・緊張しやすい等）とやる気の状態・本人の言葉（「楽しい」「やめたくなった」等はそのまま引用）' },
      { label: '生活', def: '学校・部活・仕事など練習時間に影響するもの、次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：次回扱う予定の内容／保護者への連絡事項／講師が生徒に約束した内容／保留になった提案／回数券・月謝コースの残回数や継続の意向。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Lesson', def: 'materials, unit, or assigned piece covered today (page/exercise numbers)' },
      { label: 'Progress', def: "progress since last lesson, passed assignments, and sticking points (repeated mistakes, unclear concepts); includes the instructor's assessment of what's growing and what to develop next" },
      { label: 'Goals', def: 'certification tests, exams, recitals, or competitions with their dates' },
      { label: 'Homework', def: 'whether the previous homework was done (practice time/frequency) and the homework assigned for next time (scope, reps, time)' },
      { label: 'Engagement', def: 'learning-style traits (thrives on praise, wants theory first, gets nervous) and current motivation in their own words' },
      { label: 'Life', def: 'school, club activities, or work affecting practice time, and conversation topics useful next lesson' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: content planned for next lesson / anything to relay to parents / promises the instructor made / deferred proposals / tuition or ticket balance and renewal intent. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「英検3級の長文読解：2ヶ月前から時間内に解き終わらず、模試のたびに苦手意識が強まっている」',
      '（treatment）：「宿題：文法ドリルP32〜35を週3回・1回15分で音読も加える」',
    ],
    goodExamplesEn: [
      '(symptom): "Eiken Grade 3 reading comprehension: not finishing within the time limit for about 2 months, growing more discouraged with each practice test"',
      '(treatment): "Homework: grammar drill pages 32-35, 3× a week, 15 min each, plus reading aloud"',
    ],
    passportFieldsJa: [
      { key: 'student_level', label: 'レベル', hint: '現在の習熟度（検定級・学年・経験年数など具体的な基準で）' },
      { key: 'learning_goal', label: '学習目標', hint: '本人（または保護者）が話した目標。期限や数字があれば含める（検定合格・大会出場など）' },
      { key: 'guardian_context', label: '保護者との関わり', hint: '未成年の場合、保護者が学習面について伝えてきた意向や関わり方。保護者自身の近況ではなく生徒の学びに関する内容に限る' },
      { key: 'learning_style', label: '学び方の特徴', hint: '本人に合う教え方の傾向（集中が続く時間、得意な学び方、配慮が必要な点など）' },
      { key: 'practice_habit', label: '自主練習の傾向', hint: '授業外での練習・復習への取り組み方や継続性' },
    ],
    passportFieldsEn: [
      { key: 'student_level', label: 'Level', hint: 'current proficiency stated concretely (exam grade, school year, years of experience)' },
      { key: 'learning_goal', label: 'Learning goal', hint: 'the goal the student or guardian stated, with a deadline or number when given (an exam, a competition, a specific skill)' },
      { key: 'guardian_context', label: 'Guardian context', hint: 'for minors: what the guardian said about their own involvement or preferences in how the student learns — never news about the guardian, only the student' },
      { key: 'learning_style', label: 'Learning style', hint: 'how this student learns best or needs to be taught (attention span, explanation style, standing accommodations)' },
      { key: 'practice_habit', label: 'Practice habit', hint: 'how consistently the student practices or reviews outside class' },
    ],
  },
  other: {
    serviceNounJa: '実施内容', serviceNounEn: 'service',
    roleJa: '担当者', roleEn: 'specialist',
    businessNounJa: '施設', businessNounEn: 'practice',
    primaryFocusJa: 'お客様のケア成果とサービスの進行',
    primaryFocusEn: 'customer care outcomes and service progression',
    seasonalRelevance: 'low', clinicalPosture: 'service',
    typicalConcernsJa: ['目標達成への進捗', 'セッションごとの満足度', 'お客様の好みの継続性'],
    typicalConcernsEn: ['progression toward stated goals', 'session-over-session comfort', 'continuity of preferences'],
    captureChecklistJa: [
      '来店・相談の目的：何を求めて来たか、いつからの悩み/要望か。期間・数値は必ず数字で記録',
      '安全・配慮事項：アレルギー・体質・健康上の申告など、サービス提供時に配慮が必要なこと — 最優先で記録',
      '担当者が確認したことと本日提供した内容：お客様の状態の観察・評価、前回からの変化（改善/悪化/不変/新規）。実施したサービス・使用した物・所要時間を具体的に',
      'お客様の反応と好み：満足した点・不満だった点・印象的な一言（そのまま引用）。加えてサービスの受け方・接客・環境に関する好み、嫌がったこと、迷い・他店との比較など継続に関わる気持ち',
      '伝えた提案・アドバイス：次回までにやること・使うもの — 内容と数字まで具体的に',
      '生活背景と個人メモ：仕事・家族・生活パターンなどサービスに影響するもの。加えて趣味・予定など次回の会話と信頼関係に活きる話題',
      '次回・プラン：次回予約の日時、推奨頻度、今後の方針、次回確認すること、スタッフがお客様に約束した内容、回数券・コースの残回数（category は product）と継続の意向（category は next_visit）',
    ],
    captureChecklistEn: [
      'Purpose of the visit: what they came for and how long the concern or request has existed. Durations and figures always recorded as numbers',
      'Safety and care notes: allergies, sensitivities, health disclosures — anything the service must accommodate — top priority',
      "Staff observations & what was provided today: the customer's state as assessed today, change since last visit (improved/worse/unchanged/new). Plus services performed, items used, time taken — specific",
      "Customer's reaction & preferences: what pleased or disappointed them; memorable remarks quoted verbatim. Plus how they like the service, interaction, and environment — anything they disliked, and hesitation or comparisons with other providers — feelings that bear on coming back",
      'Advice given: what to do or use before the next visit — specific down to the numbers',
      'Life context & personal notes: work, family, routines affecting the service. Plus hobbies, plans, conversation topics that build rapport next time',
      'Next visit and plan: booked date/time, recommended frequency, direction going forward, things to check next time, promises staff made, ticket/course balance (category: product) and renewal intent (category: next_visit)',
    ],
    summaryLabelsJa: [
      { label: '相談内容', def: 'お客様の要望・悩み・目標（いつから・きっかけ。期限がある場合は期限も）' },
      { label: '注意', def: '安全・接客上の注意（アレルギー・体質・健康上の申告・過去のトラブルや悪い経験・服用中の薬・嫌がったこと）' },
      { label: '状態', def: '本日のお客様の状態、担当者の観察と見立て。前回からの変化が会話から分かる場合に限り、改善／悪化／不変を明記する（分からない場合は変化について何も書かない）' },
      { label: '本日の内容', def: '本日提供したサービス・使用した物と、それへのお客様の反応（「いつもの」等の指定はその表現のまま書く）' },
      { label: 'アドバイス', def: '伝えた提案・ケア・使い方の指導（内容・回数・手順）と、それへのお客様の反応' },
      { label: '生活・会話', def: '生活習慣や、家族・趣味・予定など次回の会話に活きる話題' },
      { label: '次回', def: '予約があれば日時、なければ「予約なし」と書く。加えて、本日の会話に根拠があるものだけを書く：担当者またはお客様が次回に向けて口にした「次回確認すること」／担当者がお客様に約束した内容／保留になった提案／継続・利用に関わるお客様の意向や事情／回数券やコースの残回数／推奨頻度。情報が多ければ行を分ける' },
      { label: 'メモ', def: '上記のどのラベルにも当てはまらないが次回の担当者に重要な事実（該当がある場合のみ。なければこの行自体を出力しない）' },
    ],
    summaryLabelsEn: [
      { label: 'Requests', def: "the customer's requests, concerns, and goals (since when, trigger; include deadlines)" },
      { label: 'Cautions', def: 'safety and service cautions (allergies, constitution, health disclosures, past trouble or bad experiences, medication, things they disliked)' },
      { label: 'Condition', def: "today's condition and the staff member's observations and assessment; state improved/worse/unchanged ONLY when the conversation shows the change vs last time (say nothing about change otherwise)" },
      { label: "Today's session", def: "what was provided and used today, and the customer's reaction (keep 'the usual'-style requests verbatim)" },
      { label: 'Advice', def: "care, products, or usage advice given (content, reps, steps) and the customer's reaction" },
      { label: 'Life & conversation', def: 'lifestyle and personal topics (family, hobbies, plans) useful next visit' },
      { label: 'Next', def: 'booking date/time, or "no booking". Then, ONLY what the conversation supports: things to check next time / promises staff made / deferred proposals / renewal or usage intent / ticket or course balance / recommended cadence. Split lines when rich' },
      { label: 'Note', def: 'important facts that fit no label above (only when present — otherwise omit this line entirely)' },
    ],
    goodExamplesJa: [
      '（symptom）：「仕上がりへの不満：2ヶ月前の利用開始から物足りなさを感じ、来店のたびに他社と比較していた」',
      '（treatment）：「アドバイス：セルフケア用品を週2回・少量ずつ試すよう提案、次回来店時に効果を確認」',
    ],
    goodExamplesEn: [
      '(symptom): "Dissatisfaction with results: feeling underwhelmed for about 2 months, comparing notes with a competitor at each visit"',
      '(treatment): "Advice: suggested trying the home-care product twice a week in small amounts, to check the effect next visit"',
    ],
    passportFieldsJa: [
      { key: 'chief_concern', label: '主な要望', hint: '継続的・繰り返し話題になる要望や悩み（今日だけの依頼ではない）' },
      { key: 'service_preference', label: '対応の希望', hint: '接客・進行方法についての継続的な希望や注意点（伝え方・環境・避けてほしいことなど）' },
      { key: 'occupation', label: '職業', hint: '仕事内容・勤務形態。利用目的に関わる場合はその関連も' },
      { key: 'maintenance_pref', label: '来店ペース希望', hint: '本人が話した希望来店ペース（週1・月1など）' },
      { key: 'referral_source', label: '来店きっかけ', hint: '紹介・検索・看板・SNSなど、最初に来店した理由' },
    ],
    passportFieldsEn: [
      { key: 'chief_concern', label: 'Chief concern', hint: 'recurring or chronic concerns — never a one-off, today-only request' },
      { key: 'service_preference', label: 'Service preferences', hint: 'standing preferences on how they like to be served — communication style, environment, things to avoid' },
      { key: 'occupation', label: 'Occupation', hint: 'work and schedule — include how it relates to why or when they use this business, if mentioned' },
      { key: 'maintenance_pref', label: 'Visit cadence preference', hint: 'the visit cadence they said they want' },
      { key: 'referral_source', label: 'How they found us', hint: 'referral, search, signage, SNS — why they first came' },
    ],
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
  serviceNoun: string
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
    serviceNoun:
      (ja ? persona.serviceNounJa : persona.serviceNounEn) ??
      (ja ? (DEFAULT_PERSONA.serviceNounJa ?? '実施内容') : (DEFAULT_PERSONA.serviceNounEn ?? 'service')),
  }
}

/** Every distinct JA service noun across the personas — the UI strips these
 *  as treatment-title kind prefixes (CurrentSessionCard) so the strip list
 *  can never drift from what the extraction prompt mandates. */
export const ALL_SERVICE_NOUNS_JA: string[] = [
  ...new Set(Object.values(PERSONAS).map((p) => p.serviceNounJa ?? '実施内容')),
]

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
  /** This business's word for "what we did today" (title prefix). */
  serviceNoun: string
  /** Per-category domain notes appended to the neutral category defs (JA
   *  extraction prompt). Empty object when the type has none authored. */
  categoryNotes: Partial<
    Record<'symptom' | 'body_area' | 'treatment' | 'preference' | 'next_visit', string>
  >
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
  const serviceNoun =
    (ja ? persona.serviceNounJa : persona.serviceNounEn) ??
    (ja ? (DEFAULT_PERSONA.serviceNounJa ?? '実施内容') : (DEFAULT_PERSONA.serviceNounEn ?? 'service'))
  // JA-only until the EN prompt re-author (the legacy EN prompt has no
  // category-def block to enrich).
  const categoryNotes = (ja ? persona.categoryNotesJa : undefined) ?? {}
  return { checklist, summaryLabels, goodExamples, serviceNoun, categoryNotes }
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
