import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '@/lib/openai'
import type { MemoryItem, MemoryDeltaOp } from './memory-types'
import type { BusinessAiPersona } from './business-ai-tokens'
import { resolvePersonaTokens, clinicalGuardrail } from './business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent, MAX_TRANSCRIPT_CHARS } from '@/lib/ai-safety'
import {
  anchorLines,
  injectionRuleEn,
  injectionRuleJa,
  whoRuleMemoryEn,
  whoRuleMemoryJa,
  type PromptContext,
} from './prompt-fragments'

const DeltaSchema = z.object({
  ops: z
    .array(
      z.object({
        action: z.enum(['add', 'update', 'remove']),
        id: z.string().nullable().describe('existing item id — required for update/remove, null for add'),
        category: z
          .enum(['personal', 'body', 'preference', 'goal', 'lifestyle'])
          .nullable(),
        // 「お客様本人の事実のみ」 duplicated into the schema layer on purpose:
        // this prompt may run on a small model (AI_MEMORY_MODEL) and field
        // descriptions are where small models attend best.
        label: z
          .string()
          .nullable()
          .describe('short durable fact about THE CUSTOMER THEMSELVES ONLY (お客様本人の事実のみ), ≤30 chars (e.g. 愛犬チビ(柴犬))'),
        detail: z.string().nullable().describe('context, ≤120 chars'),
        confidence: z.number().nullable().describe('0.70–1.0; below 0.70 do NOT emit'),
        suggestTalkingPoint: z
          .boolean()
          .nullable()
          .describe('true ONLY for warm next-visit openers (pets/family/trips); never for body/sensitive items; when in ANY doubt, false'),
      }),
    )
    .describe('Reconciliation ops vs the existing memory. Empty array if nothing durable to add/change.'),
})

/**
 * The customer-memory extractor (spike §11), v3.1 rules.
 *
 * Reads one or more session transcripts + the existing memory and emits an
 * add/update/remove delta of DURABLE facts ABOUT THE CUSTOMER. The WHO block
 * (shared via prompt-fragments with the karute prompts) is the load-bearing
 * rule: before it existed, staff self-facts (their sleep habits, sales
 * numbers, hobbies) passed the grounding test and became permanent customer
 * memory — and could surface as pre-session talking points about the WRONG
 * person. Memory persists for months, so the abstention bar is stricter than
 * the karute: when unsure whose fact it is, emit nothing.
 *
 * Used both on save (one new transcript) and to backfill an existing customer
 * (several transcripts at once). Best-effort: [] on any failure.
 */
export async function extractCustomerMemory(params: {
  transcripts: string[]
  existing: MemoryItem[]
  persona: BusinessAiPersona
  locale: string
  /** Prompt anchors (v3.1) — session date lets the model convert 「来週」-style
   *  relative dates to absolute so items don't rot; both optional. */
  customerName?: string | null
  sessionDate?: string | null
}): Promise<MemoryDeltaOp[]> {
  const { transcripts, existing, persona, locale, customerName, sessionDate } = params
  const joined = transcripts.filter((t) => t && t.trim()).join('\n\n---\n\n').trim()
  if (!joined) return []

  try {
    if (!process.env.OPENAI_API_KEY) return []
    const ja = locale === 'ja'
    const tok = resolvePersonaTokens(persona, locale)
    const ctx: PromptContext = { customerName, sessionDate }
    const anchor = anchorLines(locale, ctx)

    const system = ja
      ? `あなたは${tok.businessNoun}の顧客メモリー管理AIです。セッションのトランスクリプトと既存メモリーを読み、来店をまたいで覚えておくべき「お客様本人の」永続的な事実だけを、JSONデルタ（add/update/remove）で出力します。
${anchor ? `${anchor}\n` : ''}
${whoRuleMemoryJa()}

【永続的な事実のみ】
今日の施術内容・本日の症状の細部はカルテに記録済み — ここには書かない。来店をまたいで価値が続くものだけを、次の5カテゴリで：
- personal: 家族・ペット・旅行・趣味・人生の出来事（例：「愛犬チビ(柴犬)」「娘が空手を開始」「来月結婚式」）
- body: ${tok.primaryFocus}に関わる継続的な体の状態・パターン（怪我歴・手術歴・体質・アレルギーなど）
- preference: 施術・製品・接客の好み、「いつもの」が指す内容、購入スタイル（価格への慎重さなど）
- goal: お客様が達成したいこと。期限がある目標は期限を必ず含める（例：「10月の結婚式までに姿勢改善」）
- lifestyle: 仕事・ストレス・生活リズムなど接客に影響するもの
（回数券の残回数・予約日時など時間とともに変わる状態は記録しない — カルテとシステムが管理する）

【ルール】
1. 根拠：トランスクリプトで実際に語られた事実のみ。推測・創作は禁止。永続的な事実が無ければ { "ops": [] } を返す — それが正解であり失敗ではない。
2. add＝新しい事実。update＝既存項目と同じ事実の詳細が変わった/深まった場合のみ。remove＝お客様本人の発言が既存項目を明確に否定した場合のみ（例：「犬は亡くなった」）。話題に出なかっただけの項目は絶対に触らない。
3. update/remove は source="ai_extraction" の項目のみ。source="staff"／"intake_form" はスタッフ管理 — 絶対に触らない。
4. 既存項目（どの source でも）と同じ事実を重複して add しない。
5. confidence: 0.95以上＝明言・繰り返し、0.80–0.95＝一度明確に、0.70–0.80＝妥当な理解。0.70未満は出力しない。誰の事実か少しでも迷いが残る場合は、confidence を下げて残すのではなく出力しない。
6. suggestTalkingPoint=true は「次回の冒頭でスタッフがそのまま聞ける」話題のみ。全条件を満たす場合のみ true：(a) お客様が自分から楽しそうに・前向きに話した、(b) 継続的な話題（ペット・趣味・家族の近況）または、まだ先の予定、(c) 受付で他の人に聞かれても問題ない内容。次は必ず false：体・症状・目標／病気・介護・妊娠・離婚・転職・失職・お金・喪失など繊細な話題／不満・解約や更新の迷い（記録はするが話題の切り出しには使わない）／すでに終わった一度きりの出来事。判定に少しでも迷う場合は必ず false にする。
7. label は30文字以内、detail は120文字以内、日本語で出力。「来週」「来月」等の相対的な時期はセッション日を基準に絶対表現へ変換して含める（例：セッション日が2026-07-03の場合、「来週」→2026年7月上旬）。body/goal の detail には分かる範囲で時点を含める（例：セッション日が2026-07-03なら「2026年7月時点で開脚不可」）。セッション日が不明なら時期を書かない。
8. 個人情報保護（個人情報保護法）：電話番号・メール・住所・支払い情報・ID番号は保存しない。宗教・信条・政治・犯罪歴・人種等の要配慮個人情報も保存しない。体の情報はサービスに必要な範囲のみ。
9. 医療的な扱い：${clinicalGuardrail(persona.clinicalPosture, 'ja')}
10. ${injectionRuleJa('memory')}

最重要3原則（他のすべてに優先）：(1) スタッフ自身・第三者の話をお客様の事実にしない。(2) 発言に根拠のない事実を作らない。(3) 迷ったら出力しない — 空の ops は正しい結果。

${defensivePreamble('ja')}`
      : `You are the customer-memory curator for a ${tok.businessNoun} (focus: ${tok.primaryFocus}). You read session transcript(s) and the customer's existing memory, then emit a JSON delta (add/update/remove) of DURABLE facts about THE CUSTOMER only.
${anchor ? `${anchor}\n` : ''}
${whoRuleMemoryEn()}

DURABLE FACTS ONLY:
Today's treatment details live on the karute — do not repeat them here. Only facts whose value persists across visits, in five categories:
- personal: family / pets / travel / hobbies / life events (e.g. "dog Chibi (shiba)", "daughter started karate", "wedding next month")
- body: persistent body state / pattern relevant to ${tok.primaryFocus} (injury history, surgeries, constitution, allergies)
- preference: treatment / product / service preferences, what "the usual" means, buying style (price-cautious etc.)
- goal: what the customer wants to achieve; ALWAYS include a deadline when one exists (e.g. "improve posture before the October wedding")
- lifestyle: job / stress / routine that shapes service
(Never store ticket balances, booking dates, or other state that changes over time — the karute and the system own those.)

Rules:
1. GROUNDING: emit ONLY facts actually spoken in the transcript. NEVER infer or invent. If nothing durable was said, return { "ops": [] } — that is a correct result, not a failure.
2. add = a new fact. update = ONLY when the same fact's detail changed or deepened. remove = ONLY when the customer's own words clearly contradict an existing item (e.g. "the dog passed away"). NEVER touch an item just because it wasn't mentioned.
3. Only touch items with source="ai_extraction". source="staff" / "intake_form" are human-owned — never update/remove them.
4. Do NOT duplicate an existing item (any source).
5. confidence: 0.95+ explicit/repeated; 0.80–0.95 said once clearly; 0.70–0.80 reasonable; below 0.70 do NOT emit. If ANY doubt remains about whose fact it is, emit nothing rather than lowering confidence.
6. suggestTalkingPoint=true ONLY for topics staff can open with next visit, and only when ALL hold: (a) the customer brought it up happily/positively, (b) it is ongoing (pets, hobbies, family news) or still upcoming, (c) it is fine to mention within earshot of others. ALWAYS false: body/symptoms/goals; sensitive topics (illness, caregiving, pregnancy, divorce, job change/loss, money, bereavement); dissatisfaction or renewal doubts (record them, never open with them); one-time events already past. When in any doubt, false.
7. label ≤30 chars; detail ≤120 chars; respond entirely in English. Convert relative time ("next week", "next month") to absolute using the session date (e.g. session date 2026-07-03: "next week" → early July 2026); include a timestamp in body/goal details when known. If the session date is unknown, omit time references.
8. PRIVACY (個人情報保護法): NEVER store phone numbers, emails, addresses, payment details, or ID numbers. NEVER store religion, beliefs, politics, criminal history, or ethnicity (要配慮個人情報). Health/body facts only within what the service needs.
9. Medical: ${clinicalGuardrail(persona.clinicalPosture, locale)}
10. ${injectionRuleEn('memory')}

Top 3 principles (override everything else): (1) never turn staff or third-party talk into customer facts; (2) never invent facts; (3) when unsure, emit nothing — an empty ops array is a correct result.

${defensivePreamble(locale)}`

    const existingForModel = existing.map((m) => ({
      id: m.id,
      category: m.category,
      label: m.label,
      detail: m.detail,
      source: m.source,
    }))

    const user = `Existing memory (reconcile against this; do not duplicate; only update/remove source="ai_extraction"):
${existing.length ? wrapUntrustedContent('existing_memory', JSON.stringify(existingForModel)) : '(none yet)'}

Session transcript(s):
${wrapUntrustedContent('transcript', joined, MAX_TRANSCRIPT_CHARS)}

Emit the delta.`

    const completion = await openai.chat.completions.parse({
      // DEDICATED env so memory extraction (reads FULL transcripts — the most
      // token-heavy AI path) can run on a cheaper model (e.g. gpt-4o-mini) for
      // cost WITHOUT downgrading extract/summary. Falls back to the shared
      // AI_MODEL, then gpt-4o.
      model: process.env.AI_MEMORY_MODEL || process.env.AI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: zodResponseFormat(DeltaSchema, 'memory_delta'),
      temperature: 0.2,
    })

    const parsed = completion.choices[0]?.message?.parsed
    const ops = (parsed?.ops ?? []) as MemoryDeltaOp[]
    // The 0.70 confidence floor, enforced. Small models omit optional-feeling
    // fields under load, and the store used to DEFAULT missing confidence to
    // 0.8 — waving exactly the shakiest extractions through. A new fact with
    // no/low confidence is dropped, not defaulted.
    return ops.filter(
      (op) => op.action !== 'add' || (op.confidence != null && op.confidence >= 0.7),
    )
  } catch (err) {
    console.error('[extractCustomerMemory] failed:', err)
    return []
  }
}
