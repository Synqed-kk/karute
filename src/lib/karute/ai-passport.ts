import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '@/lib/openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings } from '@/actions/org-settings'
import {
  getBusinessAiPersona,
  resolvePersonaTokens,
  resolvePassportFields,
  clinicalGuardrail,
} from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent, MAX_HISTORY_CHARS } from '@/lib/ai-safety'
import {
  KARUTE_PROMPT_VERSION,
  cleanNameToken,
  whoRuleMemoryEn,
  whoRuleMemoryJa,
  injectionRuleEn,
  injectionRuleJa,
} from '@/lib/karute/prompt-fragments'

const PassportSchema = z.object({
  fields: z
    .array(
      z.object({
        key: z.string().describe('EXACTLY one of the requested field keys — never invent a key'),
        value: z
          .string()
          .nullable()
          .describe('The answer, ≤60 chars, in the output language. null when the sources never say it — NEVER guess.'),
        quote: z
          .string()
          .nullable()
          .describe('The verbatim source excerpt (≤50 chars, original language) the value came from. null only when value is null.'),
      }),
    )
    .describe('One entry PER requested key, in the requested order. Unanswerable keys keep value=null.'),
})

export interface PassportField {
  key: string
  label: string
  value: string | null
  quote: string | null
  /** 'staff' when a human override exists — the UI locks it visually. */
  source: 'ai' | 'staff'
}

export interface CustomerPassport {
  fields: Array<{ key: string; value: string | null; quote: string | null }>
}

/** Single-slot cache key per customer — overwritten on each 再学習 so the
 *  profile page is a pure cache read (an LLM call NEVER blocks page load). */
function cacheKey(customerId: string, businessType: string | null) {
  return { v: KARUTE_PROMPT_VERSION, c: customerId, bt: businessType }
}

/** Cache-only read for the profile page. Null = not generated yet (dashes). */
export async function getCachedPassport(
  customerId: string,
): Promise<CustomerPassport | null> {
  const orgSettings = await getOrgSettings().catch(() => null)
  return getCachedPassportForBusiness(customerId, orgSettings?.business_type ?? null)
}

/** Bearer/facade entry point — same cache-only read with an EXPLICIT
 *  business_type (the facade already read org-settings, so it avoids the cookie
 *  getOrgSettings the web wrapper uses; passing the same business_type keeps the
 *  cache key — and thus the resolved passport — identical to the web page). */
export async function getCachedPassportForBusiness(
  customerId: string,
  businessType: string | null,
): Promise<CustomerPassport | null> {
  try {
    const cached = (await getCachedAI(
      'customer_passport',
      cacheKey(customerId, businessType),
    ).catch(() => null)) as CustomerPassport | null
    return cached?.fields ? cached : null
  } catch {
    return null
  }
}

/**
 * The passport extractor — fills the profile's これまで box (職業・来店きっかけ・
 * メンテナンス希望・主な悩み…, field list per business type) from EVERYTHING the
 * system holds about the customer: session transcripts + the QuickReserve
 * intake memo. Grounded per field with a verbatim quote; unanswerable fields
 * stay null (the UI shows an honest dash). Runs ONLY from 再学習 — never on
 * page load. Best-effort null.
 */
export async function generateCustomerPassport(params: {
  customerId: string
  customerName: string
  transcripts: string[]
  intakeMemo: string | null
  locale: string
}): Promise<CustomerPassport | null> {
  const { customerId, transcripts, intakeMemo, locale } = params
  const joined = transcripts
    .filter((t) => t && t.trim())
    .join('\n\n---\n\n')
    .trim()
  if (!joined && !intakeMemo?.trim()) return null

  try {
    if (!process.env.OPENAI_API_KEY) return null
    const orgSettings = await getOrgSettings().catch(() => null)
    const businessType = orgSettings?.business_type ?? null
    const persona = getBusinessAiPersona(businessType)
    const tok = resolvePersonaTokens(persona, locale)
    const fields = resolvePassportFields(businessType, locale)
    if (fields.length === 0) return null
    const customerName = cleanNameToken(params.customerName) || 'お客様'

    const ja = locale === 'ja'
    const fieldList = fields
      .map((f) => `- ${f.key}: ${f.label}${f.hint ? `（${f.hint}）` : ''}`)
      .join('\n')

    const system = ja
      ? `あなたは${tok.businessNoun}の顧客プロファイル（お客様パスポート）を作るAIです。お客様「${customerName}様」のセッション記録と予約時の問診メモを読み、下記の項目に答えます。これは何ヶ月も表示され続ける基本情報 — 正確さがすべてです。

${whoRuleMemoryJa()}

【記入する項目（このkeyのみ・この順）】
${fieldList}

【ルール】
1. 根拠：各項目、記録の中で実際に語られた内容だけで答える。value には根拠となる発言の抜粋を quote に必ず添える（原文のまま・50文字以内）。
2. 分からない項目は value=null。空欄は正常な結果 — 推測・一般論・「おそらく」は絶対に書かない。
3. value は60文字以内の日本語。時期は算用数字で。
4. 複数セッションで矛盾する場合は最新の発言を採用する。
5. ${clinicalGuardrail(persona.clinicalPosture, 'ja')}
6. ${injectionRuleJa('memory')}

最重要：スタッフ自身・第三者の情報を${customerName}様の情報にしない。迷ったら null。

${defensivePreamble('ja')}`
      : `You build the customer passport (profile basics) for a ${tok.businessNoun}. Read the customer's session transcripts and booking intake memo, then answer the fields below for ${customerName}. This stays on screen for months — accuracy is everything.

${whoRuleMemoryEn()}

FIELDS (exactly these keys, this order):
${fieldList}

Rules:
1. GROUNDED: answer each field only from what the sources actually say, and attach the verbatim excerpt as quote (original language, ≤50 chars).
2. Unknown → value=null. Blank is a correct result — never guess or generalize.
3. value ≤60 chars, in English. Digits for dates/counts.
4. On conflict across sessions, the most recent statement wins.
5. ${clinicalGuardrail(persona.clinicalPosture, locale)}
6. ${injectionRuleEn('memory')}

Above all: never turn staff or third-party information into ${customerName}'s profile. When unsure, null.

${defensivePreamble(locale)}`

    const userParts = [
      intakeMemo?.trim()
        ? `Booking/intake memo (staff-typed, from the reservation system):\n${wrapUntrustedContent('intake_memo', intakeMemo)}`
        : 'Booking/intake memo: (none)',
      joined
        ? `Session transcripts (oldest → newest):\n${wrapUntrustedContent('transcripts', joined, MAX_HISTORY_CHARS)}`
        : 'Session transcripts: (none)',
    ]

    const completion = await openai.chat.completions.parse({
      // Same tier logic as memory extraction: transcript-heavy, cacheable.
      model: process.env.AI_MEMORY_MODEL || process.env.AI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userParts.join('\n\n') },
      ],
      response_format: zodResponseFormat(PassportSchema, 'customer_passport'),
      temperature: 0.2,
    })
    const parsed = completion.choices[0]?.message?.parsed
    if (!parsed?.fields) return null

    const allowed = new Set(fields.map((f) => f.key))
    const result: CustomerPassport = {
      fields: parsed.fields
        // Key allowlist + grounding enforcement in code: a value with no
        // quote is an ungrounded value — drop it rather than display it.
        .filter((f) => allowed.has(f.key))
        .map((f) => ({
          key: f.key,
          value: f.value?.trim() ? f.value.trim().slice(0, 60) : null,
          quote: f.quote?.trim() ? f.quote.trim().slice(0, 50) : null,
        }))
        .map((f) => (f.value && !f.quote ? { ...f, value: null } : f)),
    }
    await setCachedAI(
      'customer_passport',
      cacheKey(customerId, businessType),
      result,
      90,
    ).catch(() => {})
    return result
  } catch (err) {
    console.error('[generateCustomerPassport] failed:', err)
    return null
  }
}
