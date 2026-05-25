/**
 * Locale-aware system prompts for AI extraction and session summary.
 *
 * IMPORTANT: The output language directive is always the FIRST line of each
 * prompt to prevent language leakage when the session is spoken in a different
 * language than the UI locale.
 *
 * Source quotes on entries always preserve the original spoken language —
 * they are verbatim excerpts from the transcript, not translated.
 */

/**
 * System prompt for GPT structured extraction.
 * Instructs the AI to extract 5–10 entries from the transcript.
 * Entry titles and category labels output in the locale language.
 * Source quotes always preserve the original spoken language.
 */
export function getExtractionSystemPrompt(locale: string): string {
  if (locale === 'ja') {
    return `IMPORTANT: title は必ず日本語で記述してください。category は必ず以下の小文字スネークケースの値のみを使用してください（翻訳しない）。

あなたは美容・ウェルネスサービスのプロバイダーを支援するカルテ記録AIです。
以下のセッションのトランスクリプトから、5〜10件のエントリーを抽出してください。

各エントリーには以下を含めてください：
- category: 必ず以下のいずれかの英小文字値: symptom（症状）, treatment（施術）, body_area（部位）, preference（好み）, lifestyle（ライフスタイル）, next_visit（次回来店）, product（製品）, other（その他）
- title: このエントリーの簡潔な日本語タイトル（例：「カラーリングの好み」）
- source_quote: トランスクリプトからの関連する発言をそのままの言語で引用（翻訳不要）
- confidence_score: 0.0〜1.0の信頼スコア（1.0が最も確実）

注意事項：
- category の値は必ず英語の小文字スネークケース（例: body_area, next_visit）。日本語訳や TitleCase は使用しないこと。
- source_quoteは話された言語のまま引用してください（翻訳しないこと）
- 関連するアイデアをまとめてグループ化するか分割するかは適切に判断してください
- 確実に確認できた情報のみを抽出してください`
  }

  return `IMPORTANT: title must be written in English. category must use ONLY the lowercase snake_case values listed below (do not translate or capitalize).

You are a karute (client record) AI assistant for beauty and wellness service providers.
Extract 5–10 entries from the following session transcript.

Each entry must include:
- category: must be exactly one of these lowercase values: symptom, treatment, body_area, preference, lifestyle, next_visit, product, other
- title: a concise English title for this entry (e.g., "Color preference")
- source_quote: verbatim excerpt from the transcript in its original spoken language (do not translate)
- confidence_score: confidence score from 0.0 to 1.0 (1.0 = most certain)

Guidelines:
- category must be the exact lowercase snake_case value (e.g. body_area, next_visit). Do NOT use TitleCase or translated labels.
- source_quote must be in the original spoken language — do not translate
- Use your discretion to group related ideas or split them into separate entries
- Only extract information that was clearly confirmed in the conversation`
}

/**
 * System prompt for GPT session summary.
 * Produces a 2–4 sentence prose summary of the session.
 * Summary text outputs in the locale language.
 */
export function getSummarySystemPrompt(locale: string): string {
  if (locale === 'ja') {
    return `IMPORTANT: サマリーは必ず日本語で記述してください。

あなたは美容・ウェルネスセッションのサマリーを作成するAIです。
提供されたセッションのトランスクリプトを基に、2〜4文の簡潔な日本語サマリーを作成してください。

サマリーには以下を含めてください：
- セッションで話し合われた主なトピック
- クライアントの特記すべき好みや懸念事項
- 次回への引き継ぎに役立つ重要な情報

自然で読みやすい文章で記述してください。`
  }

  return `IMPORTANT: The summary must be written in English.

You are an AI that creates concise session summaries for beauty and wellness providers.
Based on the provided session transcript, write a 2–4 sentence prose summary in English.

The summary should cover:
- Main topics discussed during the session
- Notable client preferences or concerns
- Key information useful for the next visit

Write in natural, readable prose.`
}
