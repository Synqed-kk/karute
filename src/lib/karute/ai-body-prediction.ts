import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { KaruteRecord } from '@synqed-kk/client'
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
import { KARUTE_PROMPT_VERSION } from '@/lib/karute/prompt-fragments'
import type { BodyPrediction } from '@/components/karute/redesign/detail/AIBodyPredictionCard'
import { effectiveSummary } from '@/lib/karute/effective-summary'

/** The content each cached prediction is keyed on — id + effectiveSummary per
 *  dated session, not just the latest id + count. An edit/regen must bust this
 *  cache immediately (EDIT-LAYER-DESIGN §4) instead of surviving the 1-day TTL.
 *  Exported so tests can prove an edit changes the key without mocking OpenAI. */
export function predictionCacheSessions(
  dated: KaruteRecord[],
): Array<{ id: string; s: string | null }> {
  return dated.map((r) => ({ id: r.id, s: effectiveSummary(r) }))
}

const PredictionSchema = z.object({
  headline: z
    .string()
    .describe(
      "One sentence: the customer's likely current state, grounded in the records (e.g. 「主要な悩みは緩和傾向、新しい相談は要フォロー」). Never speculative beyond the records.",
    ),
  confidence: z
    .number()
    .describe(
      'Your own calibration 20-90: how strongly the records support the headline. Few/old sessions or conflicting signals = low. Never above 90 — this is an estimate, not a measurement.',
    ),
  delta: z
    .enum(['improving', 'worsening', 'stable'])
    .nullable()
    .describe(
      'Direction vs the previous session — ONLY when two dated sessions clearly show it. Null when it cannot be read from the records.',
    ),
  recommendedWindow: z
    .string()
    .describe(
      'Recommended next-visit window in the output language (e.g. 「1〜2週間後」). Base it on the visit rhythm in the dates provided and any frequency the staff stated in the records; when neither exists, suggest the customer\'s existing rhythm.',
    ),
  recommendedReason: z
    .string()
    .nullable()
    .describe('Max ~15 chars/words: why that window (e.g. 「宿題の定着確認」). Null if nothing grounded.'),
  rationale: z
    .string()
    .describe(
      '2-3 sentences for the staff: which records support the headline and window. Cite session dates. This is what makes the confidence % judgeable.',
    ),
})

/**
 * AI体調予測 — reads the customer's session history (summaries + visit rhythm)
 * and estimates current state + a recommended next-visit window with an honest
 * confidence figure. Estimation, clearly framed as such (the card shows 信頼度
 * and the rationale for staff to judge). Needs ≥2 sessions — below that there
 * is no trajectory to read and the card keeps its 対応予定 preview. Cached 1 day
 * per (customer, latest record). Best-effort: null on any failure.
 */
interface BodyPredictionParams {
  customerId: string
  records: KaruteRecord[]
  locale: string
}

/** Web (cookie) entry — resolves org-settings via the cookie path. */
export async function getBodyPrediction(
  params: BodyPredictionParams,
): Promise<BodyPrediction | null> {
  return computeBodyPrediction(params, () => getOrgSettings().catch(() => null))
}

/** Facade (Bearer) entry — identity-threaded org-settings on the business-scoped
 *  client (packet 07 Decision 1). Same generator core, no cookie consulted. */
export async function getBodyPredictionWithClient(
  synqed: Pick<SynqedClient, 'orgSettings'>,
  params: BodyPredictionParams,
): Promise<BodyPrediction | null> {
  return computeBodyPrediction(params, () => orgSettingsWithClient(synqed).catch(() => null))
}

async function computeBodyPrediction(
  params: BodyPredictionParams,
  resolveOrgSettings: () => Promise<OrgSettings | null>,
): Promise<BodyPrediction | null> {
  const { customerId, records, locale } = params
  const dated = records.filter((r) => r.created_at)
  if (dated.length < 2) return null

  try {
    if (!process.env.OPENAI_API_KEY) return null
    const orgSettings = await resolveOrgSettings()
    const persona = getBusinessAiPersona(orgSettings?.business_type)
    const tok = resolvePersonaTokens(persona, locale)

    const cacheInput = {
      v: KARUTE_PROMPT_VERSION,
      c: customerId,
      sessions: predictionCacheSessions(dated),
      bt: orgSettings?.business_type ?? null,
      locale,
    }
    const cached = (await getCachedAI('body_prediction', cacheInput).catch(() => null)) as
      | (Omit<BodyPrediction, 'recommended' | 'recommendedSub'> & {
          recommended: string
          recommendedSub: string | null
        })
      | null
    if (cached?.headline) return cached

    // Oldest → newest, summaries only — the trajectory signal without the cost
    // of full transcripts. Dates matter: the model derives the visit rhythm.
    const history = [...dated]
      .reverse()
      .map((r) => `Session ${r.created_at?.slice(0, 10)}: ${effectiveSummary(r) ?? '(no summary)'}`)
      .join('\n\n')

    const ja = locale === 'ja'
    const system = ja
      ? `あなたは${tok.businessNoun}の${tok.role}を支援するAIです。お客様のセッション履歴（日付つき要約）を読み、現在の状態の推定と次回来店の推奨時期を出します。これは推定であり、スタッフが信頼度と根拠を見て判断します。

【ルール】
- 根拠：提供された記録だけから判断する。記録に無い症状・改善・悪化を作らない。
- delta（前回比）は、日付の異なる2セッションが明確に示す場合のみ。読み取れなければ null。
- confidence は自己申告の20〜90。記録が少ない・古い・矛盾する場合は低く。90超は禁止（測定ではなく推定のため）。
- recommendedWindow は記録内の来店リズム（日付の間隔）とスタッフが述べた推奨頻度に基づく。どちらも無ければ現状のリズムを維持する提案にする。
- rationale には根拠となるセッションの日付を必ず挙げる。
- ${clinicalGuardrail(persona.clinicalPosture, 'ja')} 診断はしない — あくまで来店計画のための推定。
- すべて日本語で出力。

${defensivePreamble('ja')}`
      : `You assist the ${tok.role} at a ${tok.businessNoun}. From the customer's dated session summaries you estimate their likely current state and a recommended next-visit window. This is an estimate — staff judge it via the confidence figure and rationale.

Rules:
- Grounded ONLY in the records provided. Never invent symptoms, improvement, or worsening.
- delta only when two dated sessions clearly show it; otherwise null.
- confidence is your self-calibration, 20-90. Sparse/old/conflicting records = low. Never above 90.
- recommendedWindow follows the visit rhythm in the dates and any staff-stated frequency; absent both, suggest keeping the current rhythm.
- rationale must cite session dates.
- ${clinicalGuardrail(persona.clinicalPosture, locale)} No diagnosis — this is visit planning.
- Respond entirely in English.

${defensivePreamble(locale)}`

    const completion = await openai.chat.completions.parse({
      model: process.env.AI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Dated session summaries (oldest → newest):\n${wrapUntrustedContent('karute_history', history, 30_000)}`,
        },
      ],
      response_format: zodResponseFormat(PredictionSchema, 'body_prediction'),
      temperature: 0.3,
    })
    const parsed = completion.choices[0]?.message?.parsed
    if (!parsed?.headline) return null

    const result: BodyPrediction = {
      headline: parsed.headline,
      // Clamp in code — the schema asks for 20-90 but the floor/ceiling must
      // not depend on model compliance.
      confidence: Math.round(Math.max(20, Math.min(90, parsed.confidence))),
      delta: parsed.delta,
      recommended: parsed.recommendedWindow,
      recommendedSub: parsed.recommendedReason,
      rationaleSummary: parsed.rationale,
    }
    await setCachedAI('body_prediction', cacheInput, result, 1).catch(() => {})
    return result
  } catch (err) {
    console.error('[getBodyPrediction] failed:', err)
    return null
  }
}
