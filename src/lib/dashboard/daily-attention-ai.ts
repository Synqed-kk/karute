import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '@/lib/openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import {
  getBusinessAiPersona,
  resolvePersonaTokens,
  clinicalGuardrail,
} from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'
import { fallbackLine, type AttentionItem } from './attention'

// 要注目 one-liners: ONE model call per day per store covers every card
// (mirrors ai-brief.ts conventions: same model env, same cache table, same
// injection guards). On any failure each card falls back to its deterministic
// line — the section never renders empty or fake.

const LinesSchema = z.object({
  lines: z.array(
    z.object({
      customerId: z.string(),
      line: z
        .string()
        .describe(
          'ONE Japanese line for staff prep, max ~45 characters. Ground it ONLY in the given memo / last-visit summary / ticket state. Actionable (what to check, confirm, or offer today) — never a restatement of the badge, never medical advice.',
        ),
    }),
  ),
})

export interface AttentionInputItem extends AttentionItem {
  name: string
  /** First line of the customer's most recent AI karute summary, if any. */
  lastSummary: string | null
}

const BADGE_LABEL: Record<AttentionItem['badge'], string> = {
  lastOne: 'ticket pack: 1 session left (renewal moment)',
  packDone: 'finished their pack and came back (wants to continue)',
  first: 'first visit',
  comeback: 'returning after a long gap',
  memo: 'has a booking request memo',
}

export async function getDailyAttentionLines(params: {
  items: AttentionInputItem[]
  businessType: string | null | undefined
  businessId: string | null
  storeId: string | null
  dateYmd: string
  locale: string
}): Promise<Map<string, string>> {
  const { items, businessType, businessId, storeId, dateYmd, locale } = params
  const fallback = () => new Map(items.map((i) => [i.clientId, fallbackLine(i)]))
  if (items.length === 0) return new Map()
  if (!process.env.OPENAI_API_KEY) return fallback()
  // Unknown tenant (web's getBusinessId() failed — the facade always has a
  // real id) → NEVER touch the GLOBAL ai_cache: a shared 'unknown' bucket
  // could mix attention text across businesses on colliding inputs (Greptile
  // #571 P1). Fail closed to the deterministic fallback lines — also keeps
  // customer data away from the AI call in a degraded-auth state.
  if (!businessId) return fallback()

  // Cache per business+store+day+the exact card set (badge/memo changes
  // regenerate). businessId is load-bearing, not just a finer key: the
  // ai_cache table is GLOBAL (cacheClient() builds a businessId:'' client),
  // so without it tenancy rests on implicit cross-business UUID uniqueness
  // of storeId+customer ids — defense-in-depth, fleet P3.
  const cacheInput = {
    businessId,
    storeId: storeId ?? 'all',
    dateYmd,
    items: items.map((i) => [i.clientId, i.badge, i.memo, i.lastSummary]),
  }
  try {
    const cached = (await getCachedAI('daily_attention', cacheInput).catch(() => null)) as z.infer<
      typeof LinesSchema
    > | null
    const generate = async (): Promise<z.infer<typeof LinesSchema>> => {
      const persona = getBusinessAiPersona(businessType)
      const tok = resolvePersonaTokens(persona, locale)
      const system = `You write the morning prep list for the staff of a ${tok.businessNoun}. For EACH customer below, produce exactly one Japanese line (max ~45 chars) telling the practitioner what matters TODAY — what to check, confirm, or offer. Use only the provided facts. Vocabulary of this ${tok.businessNoun} only (e.g. ${tok.primaryFocus}).
${clinicalGuardrail(tok.clinicalPosture, locale)}

${defensivePreamble(locale)}`
      const user = items
        .map((i) =>
          [
            `customerId: ${i.clientId}`,
            `name: ${i.name}`,
            `signal: ${BADGE_LABEL[i.badge]}`,
            i.memo
              ? `booking memo:\n${wrapUntrustedContent('reservation_memo', i.memo)}`
              : 'booking memo: (none)',
            i.lastSummary
              ? `last visit summary:\n${wrapUntrustedContent('karute_summary', i.lastSummary)}`
              : 'last visit summary: (none)',
            i.remaining !== null ? `tickets remaining: ${i.remaining}/${i.size ?? '?'}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n\n---\n\n')
      const completion = await openai.chat.completions.parse({
        model: process.env.AI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: zodResponseFormat(LinesSchema, 'daily_attention'),
        temperature: 0.3,
      })
      const parsed = completion.choices[0]?.message?.parsed ?? { lines: [] }
      await setCachedAI('daily_attention', cacheInput, parsed, 1).catch(() => {})
      return parsed
    }
    const result = cached ?? (await generate())
    const byId = new Map(result.lines.map((l) => [l.customerId, l.line.trim()]))
    // Every card gets a line — AI's when usable, deterministic otherwise.
    return new Map(
      items.map((i) => {
        const line = byId.get(i.clientId)
        return [i.clientId, line && line.length > 0 ? line : fallbackLine(i)]
      }),
    )
  } catch {
    return fallback()
  }
}
