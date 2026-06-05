/**
 * Locale-aware system prompts for AI extraction and session summary.
 *
 * IMPORTANT: The output language directive is always the FIRST line of each
 * prompt to prevent language leakage when the session is spoken in a different
 * language than the UI locale.
 *
 * Source quotes on entries always preserve the original spoken language —
 * they are verbatim excerpts from the transcript, not translated.
 *
 * Design intent: see the authoritative spike `AI_PROMPTS.md` (§3 Summary, §4
 * Categorization, "Prompt parameterization"). The three non-negotiables:
 *   1. SPECIFICITY — concrete dates/times/numbers/product names spoken in the
 *      session must survive into the entry title and the summary. A bare topic
 *      label ("次回来店日") is a failure; "次回来店：6月29日 16:00" is the bar.
 *   2. CONSOLIDATION — facts about the same thing collapse into one entry, so
 *      one next appointment does not become three vague 次回 rows.
 *   3. BUSINESS-AWARE DEPTH — every prompt adapts to the account's business type
 *      (persona: role / focus / clinicalPosture). A 美容整体 session must read
 *      like a chiropractor's clinical note, not a generic salon memo; a gym
 *      session like a trainer's progression log. The forever-rule from the spike:
 *      "chiropractic clinics getting outputs that sound like esthetic salons
 *      kills the 'built for THIS business' wedge." Depth is modelled on SOAP
 *      (Subjective concern → Objective findings → Assessment → Plan), mapped onto
 *      the karute categories — so an entry carries WHY, not just a topic label.
 */

// `getBusinessPersona()` with no arg returns the GENERIC persona; it's the
// DEFAULT for the `persona` param of both prompt fns below, so they're safe to
// call without a resolved persona (standalone / test / future callers). The real
// API routes always pass an explicit persona resolved from the org's business_type.
import { getBusinessPersona, type BusinessPersona } from '@/lib/karute/business-persona'
import { ENTRY_CATEGORIES } from '@/types/ai'

/** The category enum, rendered for the prompt — single source of truth with the
 *  Zod schema (src/types/ai.ts) so adding a category can't silently drift here. */
const CATEGORY_LIST = ENTRY_CATEGORIES.join(', ')

/** Per-posture medical-language guardrail (JA). Drives how clinically the AI may write. */
function clinicalGuardrailJa(posture: BusinessPersona['clinicalPosture']): string {
  switch (posture) {
    case 'clinical':
      return 'この業種は医療系です。施術者が述べた所見・診断・処置は正確に記録してよい。ただしAIが独自に診断名を作り出さないこと（会話で確認できた内容のみ）。'
    case 'wellness':
      return 'この業種は医療行為ではありません。断定的な病名・診断は用いず、不調・状態として記録すること。重篤な兆候があれば医療機関の受診を勧める旨を記録してよい。'
    case 'service':
    default:
      return '医療的な診断の枠組みは用いないこと。施術内容・好み・ライフスタイル・継続的な変化の観点で記録する。'
  }
}

/** Per-posture medical-language guardrail (EN). */
function clinicalGuardrailEn(posture: BusinessPersona['clinicalPosture']): string {
  switch (posture) {
    case 'clinical':
      return 'This is a medical field. Record the findings, assessment, and procedures the practitioner stated, accurately. Do NOT invent a diagnosis the practitioner did not state.'
    case 'wellness':
      return 'This is NOT medical practice. Do not use definitive diagnoses or disease names — record concerns and observed states. You may note a recommendation to see a doctor if a serious sign appears.'
    case 'service':
    default:
      return 'Do not use a medical/diagnostic frame. Record treatment, preferences, lifestyle, and progress over time.'
  }
}

/**
 * System prompt for structured entry extraction.
 *
 * Business-aware + depth-first: injects the account's persona (role / business /
 * focus / clinical posture) and demands SOAP-grade substance per entry (concern
 * specifics → findings/assessment → treatment + rationale → recommendation →
 * plan). Titles MUST carry the concrete specifics (dates/times/values/body parts/
 * rationale); related facts are consolidated. Categories are constrained to the
 * lowercase snake_case enum (DB-coupled — the persona tunes emphasis/vocabulary,
 * not the category set).
 *
 * @param locale  UI locale ('ja' | anything-else→English).
 * @param persona Business persona (defaults to the generic profile).
 */
export function getExtractionSystemPrompt(
  locale: string,
  persona: BusinessPersona = getBusinessPersona(),
): string {
  if (locale === 'ja') {
    return `IMPORTANT: title は必ず日本語で記述してください。category は必ず以下の小文字スネークケースの値のみを使用してください（翻訳しない）。

あなたは${persona.businessNounJa}で働く${persona.roleJa}を支援する、専門的なカルテ記録AIです。この店舗は主に「${persona.primaryFocusJa}」を扱います。
セッションのトランスクリプトから、${persona.roleJa}が次回来店前に頼りにできる「専門的で中身のある」カルテを作成してください。表面的なトピック名（例：「首の痛み」）ではなく、専門家の視点での深さ——具体的な訴え・所見・判断・施術の根拠・今後の計画——を記録します。

【記録の深さ（カルテの専門基準）】会話で語られた範囲で、各エントリーに以下の「中身」を必ず含めてください：
- 主訴・相談 → 何が・どこが・どの程度（強さ/レベル）・いつから・何で悪化または改善するか・生活や仕事への影響。
- 所見・状態 → ${persona.roleJa}が観察・触診・確認した具体的な状態と、その専門的な解釈（改善/維持/悪化、原因の見立て）。
- 施術・対応 → 今回「何を・どこに・なぜ」行ったか（アプローチと根拠）。あえて行わなかったこと（例：リスクがあるため避けた手技）とその理由も。
- 提案・製品 → 具体的な提案・製品・ホームケアと、その理由。
- 今後の計画 → 頻度・時期・次回の観察ポイント・ケアの方針。日時が出たら必ず含める。

各エントリーには以下を含めてください：
- category: 必ず以下のいずれかの英小文字値: ${CATEGORY_LIST}
- title: 「具体的で中身のある」日本語の要点（1文）。トピック名で終わらせず、具体情報（部位・程度・原因・根拠・日付・時刻・数値・製品名）を必ず含める。
    良い例（具体性と深さの基準。下記は例であり、あなたの業種に合わせて記録する）:
      「首の常時痛＋可動域制限、デスクワークで悪化、本人体感で痛みレベル2/5」
      「腰部→頸椎の順で筋緊張を緩解（土台の骨盤から調整する方針）」
      「下位頸椎の強い矯正は神経リスクのため非採用、ソフトな手技で対応」
      「乾燥による頬の小じわが悪化、季節の変わり目で敏感、保湿の集中ケアを提案」
      「次回来店：6月29日 16:00（骨盤メンテナンス）」
    悪い例（曖昧なため禁止）:「首の痛み」「体の不調」「施術を実施」「ビタミン剤の提案」「次回来店日」
- source_quote: トランスクリプトの該当発言をそのままの言語で引用（翻訳しない）
- confidence_score: 0.0〜1.0の信頼スコア

【この業種で特に注目する観点】${persona.typicalConcernsJa.join('／')}（該当する話題が出たら必ず具体的に記録する）

重要なルール：
- title には必ず「具体的な内容と根拠」を入れること。単なるトピック名は禁止。日付・時刻が話された場合は必ず title に含める（最重要）。
- 同じ事柄に関する情報は1件のエントリーに統合すること。特に「次回の予約」に関する情報（日付・時刻・目的）は、原則として next_visit エントリー1件にまとめる。1つの予定を複数の曖昧なエントリーに分割しないこと。明確に別々の予定・別々の事柄である場合のみ分ける。
- 抽出件数は内容に応じて（目安5〜12件）。件数を増やすことより、1件ごとの「深さ」を優先する。
- ${clinicalGuardrailJa(persona.clinicalPosture)}
- category の値は必ず英語の小文字スネークケース（例: body_area, next_visit）。日本語訳や TitleCase は使用しない。
- 文字起こしには話し言葉の数字（例：「二十九日」「四時半」）がそのまま含まれることがあります。title 内の日付・時刻・数値は必ず算用数字に正規化すること（例：「29日」「16:30」）。ただし source_quote は元のまま変更しない。
- source_quote は話された言語のまま引用すること（翻訳しない）。
- 会話で明確に確認できた情報のみを抽出し、推測で日付・数値・事実を作らないこと。`
  }

  return `IMPORTANT: title must be written in English. category must use ONLY the lowercase snake_case values listed below (do not translate or capitalize).

You are a professional karute (client record) AI assisting a ${persona.roleEn} at a ${persona.businessNounEn}. This business primarily deals with ${persona.primaryFocusEn}.
From the session transcript, produce a professional, substantive karute the ${persona.roleEn} can rely on before the client's next visit. Capture expert-level DEPTH — the specific concern, the findings, the judgment, the rationale for what was done, and the plan — NOT shallow topic labels (e.g. "neck pain").

Depth standard (model each entry on SOAP, within what was actually said):
- Concern → what / where / how much (level) / since when / what makes it worse or better / impact on life or work.
- Findings / state → the specific condition the ${persona.roleEn} observed or assessed, and their professional read (improving / stable / worsening; likely cause).
- Treatment / response → what was done, where, and WHY (the approach + rationale). Note anything deliberately avoided (e.g. a technique skipped for safety) and why.
- Recommendation / product → the specific suggestion, product, or home care, and the reason.
- Plan → frequency, timing, what to watch next, care direction. If a date/time was given, include it.

Each entry must include:
- category: exactly one of these lowercase values: ${CATEGORY_LIST}
- title: a SPECIFIC, substantive one-line summary in English. Never end on a bare topic label — include the concrete content (body part, level, cause, rationale, dates, times, numbers, product names).
    Good (this is the depth bar; adapt to your field): "Constant neck pain + reduced range, worse from desk work, ~2/5 by client's own rating", "Released lumbar then cervical tension (adjusting from the pelvic base first)", "Skipped strong lower-cervical adjustment (nerve risk) — used soft technique", "Next visit: June 29, 16:00 (pelvic maintenance)"
    Bad (too vague — not allowed): "Neck pain", "Body issue", "Did treatment", "Suggested a vitamin", "Next visit date"
- source_quote: verbatim excerpt from the transcript in its original spoken language (do not translate)
- confidence_score: confidence score from 0.0 to 1.0 (1.0 = most certain)

Pay special attention in this field to: ${persona.typicalConcernsEn.join(' / ')} (whenever such a topic comes up, record it concretely).

Critical rules:
- The title MUST carry the concrete content and rationale. If a date or time was spoken, it MUST appear in the title (most important).
- Consolidate facts about the same thing into ONE entry. In particular, combine all next-appointment logistics (date, time, purpose) into a SINGLE next_visit entry — do not split one appointment into several vague entries. Only separate genuinely distinct facts or distinct appointments.
- Extract as many entries as the content warrants (typically 5–12). Prioritise DEPTH per entry over entry count.
- ${clinicalGuardrailEn(persona.clinicalPosture)}
- category must be the exact lowercase snake_case value (e.g. body_area, next_visit). Do NOT use TitleCase or translated labels.
- source_quote must stay in the original spoken language — do not translate.
- Only extract information that was clearly confirmed in the conversation; never invent dates, numbers, or facts.`
}

/**
 * System prompt for the session summary.
 * Produces 3–4 information-dense bullet lines (newline-separated, each prefixed
 * with "・"), ordered concern → treatment → plans → next-visit specifics, per
 * the spike `AI_PROMPTS.md` §3. Business-aware: the opener reflects the account's
 * persona so a chiro summary reads clinical, a salon summary reads service. The
 * adapter (karuteSummaryToBullets) splits on newlines. Concrete dates/times must
 * never be dropped.
 *
 * @param locale  UI locale ('ja' | anything-else→English).
 * @param persona Business persona (defaults to the generic profile).
 */
export function getSummarySystemPrompt(
  locale: string,
  persona: BusinessPersona = getBusinessPersona(),
): string {
  if (locale === 'ja') {
    return `IMPORTANT: サマリーは必ず日本語で記述してください。

あなたは${persona.businessNounJa}のセッションを要約するAIです。${persona.roleJa}が次回来店前に「数秒で」内容を思い出せるよう、本日の要点だけを凝縮します。この店舗は主に「${persona.primaryFocusJa}」を扱います。

出力：summary 配列に短い箇条書きの文字列を3〜4個入れる（各要素が1つの箇条書き。記号「・」や番号、見出しは付けない）。

ルール：
- 全体で3〜4点まで。ひと目でスキャンできる簡潔さを最優先する。各点は1行・目安15〜25文字。
- 各点は情報密度を高く。「有意義なセッションでした」のような中身のない表現は禁止。
- 優先順位（この順で最重要な点を選ぶ）：お客様の主訴・主な関心 → 本日の施術とその要点 → 提案・製品・今後の方針 → 次回来店の詳細。
- 「${persona.primaryFocusJa}」の専門的な語彙で具体的に書く（曖昧な一般語を避ける）。例：「頸椎の可動域が改善」＞「首が楽になった」、「頬の乾燥が悪化傾向」＞「肌の調子」、「スクワット90°到達」＞「動きが良くなった」。
- 会話に出た「具体的な日付・時刻・数値・製品名」は必ず含める。特に次回予約の日時は最重要であり、省略は禁止。
- 文字起こしの数字は話し言葉（例：「二十九日」「四時半」）の場合があります。日付・時刻・数値は必ず算用数字で出力すること（例：29日、16:30）。
- ${clinicalGuardrailJa(persona.clinicalPosture)}
- お客様が明示的に話していない医療情報は記載しないこと。挨拶・前置き・締めは不要。`
  }

  return `IMPORTANT: The summary must be written in English.

You are an AI that summarizes ${persona.businessNounEn} sessions so the ${persona.roleEn} can recall the visit in SECONDS before the client returns. This business primarily deals with ${persona.primaryFocusEn}.

Output: put 3–4 short bullet strings in the summary array (each element is one bullet; no "・", dashes, numbering, or heading).

Rules:
- 3–4 points total. Skimmability first — each point one line, ~8–15 words.
- Each point information-dense. No filler like "today's session was productive."
- Priority order (pick the most important in this order): primary client concern → what was done today and its key point → recommendations/products/plan → next-visit details.
- Write in the specific vocabulary of ${persona.primaryFocusEn}; avoid vague generic words. E.g. "cervical ROM improved" > "neck feels better", "cheek dryness trending worse" > "skin concern", "squat depth 90° reached" > "moved better".
- Always include the concrete dates, times, numbers, and product names mentioned. The next-appointment date/time is the most important — never omit it.
- ${clinicalGuardrailEn(persona.clinicalPosture)}
- Do not state medical information the client did not explicitly share. No greetings or closings.`
}
