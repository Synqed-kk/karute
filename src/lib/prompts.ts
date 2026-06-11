/**
 * Locale- + business-type-aware system prompts for AI extraction and session
 * summary — the SOURCE-DATA layer. Everything downstream (the karute, the
 * customer memory, the pre-session brief's trajectory) inherits their quality.
 *
 * IMPORTANT: The output language directive is always the FIRST line of each
 * prompt to prevent language leakage when the session is spoken in a different
 * language than the UI locale. Source quotes preserve the original spoken
 * language (verbatim, not translated).
 *
 * Design intent: the spike `AI_PROMPTS.md` (§3 Summary, §4 Categorization). The
 * non-negotiables:
 *   1. SPECIFICITY — concrete dates/times/numbers/product names spoken survive
 *      into the entry title + the summary. "次回来店日" is a failure; "次回来店：6月29日
 *      16:00" is the bar.
 *   2. CONSOLIDATION — facts about the SAME thing collapse into one entry; but
 *      genuinely distinct facts (肩 vs 腰) stay separate.
 *   3. STATE + CHANGE — the body's current state and direction vs last time
 *      (改善/悪化/不変/新規) is captured, so the brief's trajectory has source data.
 *
 * Category note: the entry `category` MUST be one of the 8 values in
 * ENTRY_CATEGORIES (src/types/ai.ts) — they map to the synqed/DB enum, and a 9th
 * value fails at save. Self-care advice + personal/conversation details are
 * routed into the existing categories (lifestyle/preference/treatment), never a
 * new one.
 */

import {
  getBusinessAiPersona,
  resolvePersonaTokens,
} from '@/lib/karute/business-ai-tokens'

// One business-type line injected into both prompts so extraction + summary
// catch what matters per business (整体 posture/ROM vs gym mobility vs dental),
// reusing the brief's persona tokens. Falls back to a neutral wellness persona.
function personaLine(locale: string, businessType: string | null | undefined): string {
  const tok = resolvePersonaTokens(getBusinessAiPersona(businessType), locale)
  if (locale === 'ja') {
    return `この事業は${tok.businessNoun}（主に${tok.primaryFocus}）。${
      tok.typicalConcerns ? `${tok.typicalConcerns}など、` : ''
    }この業種で重要な点を漏らさず捉えること。`
  }
  return `This business is a ${tok.businessNoun} (focus: ${tok.primaryFocus}).${
    tok.typicalConcerns ? ` Pay special attention to ${tok.typicalConcerns}.` : ''
  } Don't miss what matters for this business type.`
}

/**
 * System prompt for structured entry extraction. Extracts entries from the
 * transcript; titles carry the concrete specifics; soft signals are kept at low
 * confidence (not dropped); body state/change is captured; category constrained
 * to the lowercase snake_case enum.
 */
export function getExtractionSystemPrompt(
  locale: string,
  businessType?: string | null,
): string {
  const persona = personaLine(locale, businessType)
  if (locale === 'ja') {
    return `IMPORTANT: title は必ず日本語で記述してください。category は必ず以下の小文字スネークケースの値のみを使用してください（翻訳しない）。

あなたは美容・ウェルネスサービスのカルテ記録AIです。${persona}
以下のセッションのトランスクリプトから、有用なエントリーを抽出してください。

各エントリーには以下を含めてください：
- category: 必ず以下のいずれかの英小文字値: symptom, treatment, body_area, preference, lifestyle, next_visit, product, other
- title: このエントリーの「具体的」な日本語の要点。会話で実際に出た日付・時刻・数値・製品名などの具体情報を必ず含めること。
    良い例:「次回来店：6月29日 16:00（メンテナンス）」「右肩の張り、デスクワークが原因」「左肩こり 前回より改善」「新保湿クリームの試供品を提供」
    悪い例（曖昧なため禁止）:「次回来店日」「肩の不調」「メンテナンスの日」
- source_quote: トランスクリプトの該当発言をそのままの言語で引用（翻訳しない）
- confidence_score: 0.0〜1.0の信頼スコア

重要なルール：
- 具体性: title には必ず「具体的な内容」を入れる。日付・時刻が話された場合は必ず title に含める（最重要）。
- 体の状態と変化: 体の部位の現在の状態や前回からの変化（改善/悪化/不変/新規）が読み取れる場合は、必ず title に明示する（例:「左肩こり 前回より改善」）。状態と変化は、施した施術と同じくらい重要。
- 拾い漏らさない: 明確な事実だけでなく、軽微・示唆的な情報（弱い訴え・部分的な好み・体の反応）も拾う。施術後の反応・セルフケア助言は treatment か lifestyle、雑談・個人的な話題（ペット・家族・趣味・予定など）は lifestyle か preference として必ず拾う（黙って捨てない）。
- 話者ラベル: トランスクリプトに話者ラベル（施術者: / お客様: / （周囲の会話・不明）:）が付いている場合、抽出は「施術者」と「お客様」の発言のみから行うこと。「（周囲の会話・不明）」の行は隣の施術ベッドの別のお客様や周囲の雑談である可能性が高い — そこから症状・事実・予定を絶対に抽出しない（完全に無視する）。
- 捏造の禁止: ただし推測で事実や日付を作らない。すべてのエントリーは会話に根拠があること。確信度は confidence_score で表現する（明言は高め、示唆は低め）。
- 件数: 目安3〜8件。情報が豊富なセッションで、実際に別個の事実が多い場合は8件を超えてもよい（本当の事実を捨てない）。
- 統合: 「同一の事実」の重複のみ1件に統合する（特に次回予約の日付・時刻・目的は1件にまとめる）。異なる部位・異なる訴え（肩と腰など）は別エントリーとして保持する。
- category の値は必ず英語の小文字スネークケース（例: body_area, next_visit）。日本語訳や TitleCase は使用しない。
- 文字起こしの数字は話し言葉（例：「二十九日」「四時半」）の場合がある。title 内の日付・時刻・数値は必ず算用数字に正規化（例：「29日」「16:30」）。source_quote は元のまま。`
  }

  return `IMPORTANT: title must be written in English. category must use ONLY the lowercase snake_case values listed below (do not translate or capitalize).

You are a karute (client record) AI assistant for beauty and wellness service providers. ${persona}
Extract useful entries from the following session transcript.
If the transcript carries speaker labels (施術者:/お客様:/（周囲の会話・不明）:), extract ONLY from 施術者 (staff) and お客様 (customer) lines. NEVER extract symptoms, facts, or plans from （周囲の会話・不明） lines — they are likely a neighboring customer or ambient chatter; ignore them completely.

Each entry must include:
- category: exactly one of these lowercase values: symptom, treatment, body_area, preference, lifestyle, next_visit, product, other
- title: a SPECIFIC summary in English with the concrete details actually stated — dates, times, numbers, product names. Never a bare topic label.
    Good: "Next visit: June 29, 16:00 (maintenance)", "Right shoulder tension, worse from desk work", "Left shoulder tightness — improved since last visit", "Provided sample of new moisturizer"
    Bad (too vague — not allowed): "Next visit date", "Shoulder issue", "Maintenance day"
- source_quote: verbatim excerpt from the transcript in its original spoken language (do not translate)
- confidence_score: confidence from 0.0 to 1.0 (1.0 = most certain)

Critical rules:
- SPECIFICITY: the title MUST carry the concrete content. If a date/time was spoken, it MUST appear in the title (most important).
- STATE + CHANGE: when the transcript reveals a body area's current state or its change since last time (improving/worsening/unchanged/new), state it in the title (e.g. "Left shoulder tightness — improved vs last visit"). State and change matter as much as the action taken.
- DON'T DROP: capture not only clearly-stated facts but also softer signals (mild/implied concerns, partial preferences, body responses). Route post-treatment responses + self-care advice into treatment or lifestyle, and personal/small-talk details (pets, family, hobbies, plans) into lifestyle or preference — never silently drop them.
- NO FABRICATION: never invent facts or dates; every entry must trace to something actually said. Express certainty via confidence_score (high for explicit, low for implied).
- COUNT: aim for 3–8 entries; if a rich session genuinely has more distinct facts, exceed 8 rather than drop a real one.
- CONSOLIDATE only true duplicates of the SAME fact (combine all next-appointment logistics into ONE next_visit entry). Keep distinct body areas / distinct complaints separate (do not merge shoulder and lower back).
- category must be the exact lowercase snake_case value. Do NOT use TitleCase or translated labels.
- source_quote stays in the original spoken language; normalize spoken numbers to digits in the title only.`
}

/**
 * System prompt for the session summary. 3–4 information-dense bullets, ordered
 * concern → state/change → treatment → plans → next-visit. Concrete dates/times
 * never dropped. The state/change bullet feeds the brief's trajectory.
 */
export function getSummarySystemPrompt(
  locale: string,
  businessType?: string | null,
): string {
  const persona = personaLine(locale, businessType)
  if (locale === 'ja') {
    return `IMPORTANT: サマリーは必ず日本語で記述してください。

あなたは美容・ウェルネスのセッションを要約するAIです。${persona}スタッフが次回来店前に内容を素早く思い出せるよう、要点をまとめます。

出力形式：3〜4個の箇条書き。各箇条書きを改行で区切り、各行を「・」で始めてください（前置きや見出しは付けない）。

ルール：
- 各箇条書きは情報密度を高く。「本日は有意義なセッションでした」のような中身のない表現は禁止。
- 優先順位（この順で重要な項目を選ぶ）：お客様の主訴・主な関心 → 本日の体の状態と前回からの変化（改善/悪化/不変/新規）→ 本日実施した施術 → 提案・製品・今後のプラン → 次回来店の詳細。
- 体調・症状の変化が読み取れる場合は前回比（改善/悪化/不変/新規）を必ず記載。判断できなければ現状のみ記載し、変化は推測しない。
- 会話に出た「具体的な日付・時刻・数値・製品名」は必ずそのまま含める。特に次回予約の日時は最重要であり、省略は禁止。
- 各箇条書きは簡潔に（目安15〜30文字）。数字は算用数字で（例：29日、16:30）。
- 挨拶・前置き・締めの言葉は不要。箇条書きの本文のみを出力。
- 話者ラベルがある場合、「（周囲の会話・不明）」の行は要約に含めない（周囲の雑談・別のお客様の発言）。要約は「施術者」と「お客様」の発言のみに基づくこと。
- お客様が明示的に話していない医療情報は記載しないこと。`
  }

  return `IMPORTANT: The summary must be written in English.
If the transcript carries speaker labels, base the summary ONLY on 施術者 (staff) and お客様 (customer) lines; （周囲の会話・不明） lines are ambient chatter and must not appear in the summary.

You are an AI that creates skimmable session summaries for beauty and wellness providers, so staff can quickly recall what happened before the client's next visit. ${persona}

Output format: 3–4 bullet points. Each on its own line, starting with "・" (no preamble or heading).

Rules:
- Each bullet must be information-dense. No filler like "today's session was productive."
- Priority order: primary client concern → today's body state + change since last visit (improving/worsening/unchanged/new) → what was done this session → recommendations/products/plans → next-visit details.
- When the transcript shows a change in condition/symptoms, state the direction vs last time (improving/worsening/unchanged/new). If it can't be determined, give the current state only and do NOT guess a direction.
- Always include the concrete dates, times, numbers, and product names mentioned. The next-appointment date/time is the most important — never omit it.
- Keep each bullet short (~8–15 words). Use digits, not spoken numbers.
- No greetings or closings — output only the bullet lines.
- Do not state medical information the client did not explicitly share.`
}
