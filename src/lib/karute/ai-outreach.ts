import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '@/lib/openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings } from '@/actions/org-settings'
import {
  getBusinessAiPersona,
  resolvePersonaTokens,
  clinicalGuardrail,
} from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'
import { KARUTE_PROMPT_VERSION, cleanNameToken } from '@/lib/karute/prompt-fragments'
import type { SuggestedMessage } from '@/components/karute/redesign/detail/AISuggestedMessageCard'

const OutreachSchema = z.object({
  body: z
    .string()
    .describe(
      'The follow-up message text, ready to send as-is. Grounded ONLY in the karute provided.',
    ),
})

/**
 * AI推奨メッセージ — drafts the post-session follow-up shown on the karute
 * detail card. The card already carries the human loop (edit / approve-send via
 * MessageComposeDialog); this only produces the draft. Grounded in THIS
 * session's summary — never invents offers, prices, or facts. Cached per
 * (karute, summary) so the LLM runs once per record, not per view. Best-effort:
 * null on any failure → the card keeps its 対応予定 preview.
 */
export async function getSuggestedFollowUp(params: {
  karuteId: string
  customerName: string
  summary: string | null
  locale: string
}): Promise<SuggestedMessage | null> {
  const { karuteId, summary, locale } = params
  if (!summary?.trim()) return null
  // Same treatment as every other prompt anchor: the name is DATA — clamp and
  // strip control chars before it touches a system prompt.
  const customerName = cleanNameToken(params.customerName) || 'お客様'

  try {
    if (!process.env.OPENAI_API_KEY) return null
    // Plan gate (P4): outreach drafts are a paid capability once billing arms.
    // Locked → null, and the card keeps its 対応予定 preview (this function is
    // best-effort by contract). Dynamic import keeps test import-chains light.
    const { featureAllowed } = await import('@/lib/subscription/feature-gate')
    if (!(await featureAllowed('aiOutreachDrafts'))) return null
    const orgSettings = await getOrgSettings().catch(() => null)
    const persona = getBusinessAiPersona(orgSettings?.business_type)
    const tok = resolvePersonaTokens(persona, locale)

    const cacheInput = {
      v: KARUTE_PROMPT_VERSION,
      k: karuteId,
      // Full summary — the cache layer hashes the whole input, so a regenerated
      // summary always misses the old draft (a 2000-char slice could collide).
      s: summary,
      bt: orgSettings?.business_type ?? null,
      locale,
    }
    const cached = (await getCachedAI('karute_followup', cacheInput).catch(() => null)) as {
      body?: string
    } | null
    if (cached?.body) return { channel: 'LINE', body: cached.body }

    const ja = locale === 'ja'
    const system = ja
      ? `あなたは${tok.businessNoun}のスタッフに代わって、本日ご来店いただいたお客様へのフォローアップメッセージ（LINE）を下書きするAIです。スタッフが送信前に必ず確認・編集します。

【ルール】
- 根拠：本日のカルテ要約に書かれている内容だけを使う。割引・特典・価格・予約日時など、要約に無いことは一切書かない（作った事実は信頼を壊す）。
- 構成：(1) 本日の来店へのお礼 → (2) 本日の内容に軽く触れる（1点だけ、要約から） → (3) セルフケアの宿題があればやさしく一言 → (4) 体調の変化があればいつでもご連絡くださいと締める。
- トーン：丁寧で温かい接客の日本語。絵文字は使わない。マークダウン・箇条書きは使わない（そのまま送れる普通の文章）。
- 長さ：120〜220文字程度。LINEで読みやすい短さ。
- 医療的な断定はしない：${clinicalGuardrail(persona.clinicalPosture, 'ja')}
- 宛名は「${customerName}様」で始める。店名・スタッフ名は書かない（送信画面で自動処理される想定はせず、単に省く）。

${defensivePreamble('ja')}`
      : `You draft the post-visit follow-up message (LINE) a ${tok.businessNoun} staff member sends to today's customer. Staff always review and edit before sending.

Rules:
- Grounded ONLY in today's karute summary. Never invent discounts, offers, prices, or booking times not present in it.
- Structure: (1) thank them for today's visit → (2) touch on ONE thing from the session → (3) gently mention the self-care homework if any → (4) close with "reach out anytime if anything changes."
- Tone: warm, polite service language. No emoji, no markdown, no bullet points — plain sendable text.
- Length: 2-4 short sentences.
- No medical claims: ${clinicalGuardrail(persona.clinicalPosture, locale)}
- Open with "Dear ${customerName}," style addressing. Omit shop/staff names.

${defensivePreamble(locale)}`

    const completion = await openai.chat.completions.parse({
      model: process.env.AI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Today's karute summary:\n${wrapUntrustedContent('karute_summary', summary)}`,
        },
      ],
      response_format: zodResponseFormat(OutreachSchema, 'followup_draft'),
      temperature: 0.4,
    })
    const body = completion.choices[0]?.message?.parsed?.body?.trim()
    if (!body) return null
    await setCachedAI('karute_followup', cacheInput, { body }, 7).catch(() => {})
    return { channel: 'LINE', body }
  } catch (err) {
    console.error('[getSuggestedFollowUp] failed:', err)
    return null
  }
}
