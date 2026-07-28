import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '@/lib/openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings, orgSettingsWithClient, type OrgSettings } from '@/actions/org-settings'
import type { SynqedClient } from '@synqed-kk/client'
import {
  getBusinessAiPersona,
  resolvePersonaTokens,
  clinicalGuardrail,
} from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'
import { KARUTE_PROMPT_VERSION, cleanNameToken } from '@/lib/karute/prompt-fragments'
import type { SuggestedMessage } from '@/components/karute/redesign/detail/AISuggestedMessageCard'
import { auditWeb } from '@/lib/audit-web'

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
interface OutreachParams {
  karuteId: string
  customerName: string
  summary: string | null
  locale: string
}

/** Web (cookie) entry — cookie org-settings + cookie feature gate. */
export async function getSuggestedFollowUp(
  params: OutreachParams,
): Promise<SuggestedMessage | null> {
  let result: SuggestedMessage | null
  try {
    result = await computeSuggestedFollowUp(
      params,
      () => getOrgSettings().catch(() => null),
      // Dynamic import keeps test import-chains light.
      async () => {
        const { featureAllowed } = await import('@/lib/subscription/feature-gate')
        return featureAllowed('aiOutreachDrafts')
      },
    )
  } catch (err) {
    // Errors are not actions (same doctrine as the /api/ai/* routes' catch
    // blocks) — nothing audits here.
    console.error('[getSuggestedFollowUp] failed:', err)
    return null
  }
  // 監査ログ Wave W1 (real-coverage-gap fix): the web twin of the facade's
  // karute.ai.suggestedMessage row (handler.ts's generic hook fires
  // unconditionally on every facade 2xx, regardless of draft content) — this
  // fires unconditionally on every non-error return of computeSuggestedFollowUp
  // (cache-hit, plan-locked/no-summary null, and a freshly generated draft all
  // count) so the web surface stops being silently unaudited.
  await auditWeb({
    category: 'ai',
    action: 'ai.suggested_message',
    targetType: 'karute',
    targetId: params.karuteId,
    requestId: crypto.randomUUID(),
  })
  return result
}

/** Facade (Bearer) entry — identity-threaded org-settings + business-scoped
 *  feature gate (packet 07 Decision 1). Same generator core, no cookie. The
 *  facade's own generic success hook (logFacadeAudit) is the ONE emitter for
 *  this path — this function stays audit-free (same Core/WithClient split
 *  convention as the rest of the codebase) to avoid double-logging. */
export async function getSuggestedFollowUpWithClient(
  synqed: Pick<SynqedClient, 'orgSettings'>,
  businessId: string,
  params: OutreachParams,
): Promise<SuggestedMessage | null> {
  try {
    return await computeSuggestedFollowUp(
      params,
      () => orgSettingsWithClient(synqed).catch(() => null),
      async () => {
        const { featureAllowedForBusiness } = await import('@/lib/subscription/feature-gate')
        return featureAllowedForBusiness(businessId, 'aiOutreachDrafts')
      },
    )
  } catch (err) {
    console.error('[getSuggestedFollowUpWithClient] failed:', err)
    return null
  }
}

async function computeSuggestedFollowUp(
  params: OutreachParams,
  resolveOrgSettings: () => Promise<OrgSettings | null>,
  checkOutreachAllowed: () => Promise<boolean>,
): Promise<SuggestedMessage | null> {
  const { karuteId, summary, locale } = params
  if (!summary?.trim()) return null
  // Same treatment as every other prompt anchor: the name is DATA — clamp and
  // strip control chars before it touches a system prompt.
  const customerName = cleanNameToken(params.customerName) || 'お客様'

  if (!process.env.OPENAI_API_KEY) return null
  // Plan gate (P4): outreach drafts are a paid capability once billing arms.
  // Locked → null, and the card keeps its 対応予定 preview (this function is
  // best-effort by contract).
  if (!(await checkOutreachAllowed())) return null
  const orgSettings = await resolveOrgSettings()
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
- 構成：(1) 本日の来店へのお礼 → (2) 本日の内容に軽く触れる（1点だけ、要約から） → (3) ${persona.clinicalPosture !== 'service' ? 'セルフケアの宿題があればやさしく一言' : '宿題やおすすめしたケアがあればやさしく一言'} → (4) ${persona.clinicalPosture !== 'service' ? '体調の変化' : '気になる変化'}があればいつでもご連絡くださいと締める。
- トーン：丁寧で温かい接客の日本語。絵文字は使わない。マークダウン・箇条書きは使わない（そのまま送れる普通の文章）。
- 長さ：120〜220文字程度。LINEで読みやすい短さ。
- 医療的な断定はしない：${clinicalGuardrail(persona.clinicalPosture, 'ja')}
- 宛名は「${customerName}様」で始める。店名・スタッフ名は書かない（送信画面で自動処理される想定はせず、単に省く）。

${defensivePreamble('ja')}`
    : `You draft the post-visit follow-up message (LINE) a ${tok.businessNoun} staff member sends to today's customer. Staff always review and edit before sending.

Rules:
- Grounded ONLY in today's karute summary. Never invent discounts, offers, prices, or booking times not present in it.
- Structure: (1) thank them for today's visit → (2) touch on ONE thing from the session → (3) gently mention any homework or recommended care → (4) close with "reach out anytime if anything changes."
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
}
