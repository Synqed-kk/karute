import 'server-only'
import { after } from 'next/server'
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

/**
 * Cache keys whose deferred fill is already scheduled on THIS instance, so a
 * burst of cold-cache dashboard loads schedules one model call, not one each.
 *
 * ponytail: per-instance, not global — two serverless instances can still
 * duplicate a single fill, exactly as the pre-existing inline path already
 * could. Bounded regardless: entries are removed when the fill settles, and a
 * key only lives as long as one generation. Upgrade path if duplicate fills
 * ever cost real money: a short-lived sentinel row in ai_cache.
 */
const inFlightFills = new Set<string>()

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
  /**
   * WEB opt-in: never block the response on the model call. On an ai_cache HIT
   * this changes nothing. On a MISS it returns the deterministic fallback lines
   * immediately and generates AFTER the response is sent (Next's `after()`), so
   * the cache is warm for the next load instead of the first viewer of the day
   * per store eating multiple seconds of OpenAI latency inside the render path
   * (dashboard render blocks on this — 2026-07-30 speed pass).
   *
   * Default false: the facade screen route keeps generating inline, because the
   * native shell has no second render to pick up a late fill — it asks once and
   * paints what it gets.
   */
  cacheOnly?: boolean
}): Promise<Map<string, string>> {
  const { items, businessType, businessId, storeId, dateYmd, locale, cacheOnly } = params
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
    // Cache miss on the web path: hand the model call to `after()` so it runs
    // once the response is already on its way, and serve the deterministic
    // lines now. Same idiom as the durable audit write (lib/audit.ts). If
    // `after()` is unavailable (called outside a request scope), fall through
    // to the inline generate rather than silently never filling the cache.
    if (!cached && cacheOnly) {
      const fillKey = JSON.stringify(cacheInput)
      // One in-flight fill per cache key. A cold cache is exactly the moment
      // several staff open the dashboard at once (the morning), and each miss
      // would otherwise schedule its own model call for the identical key.
      if (inFlightFills.has(fillKey)) return fallback()
      try {
        after(() =>
          generate()
            .catch((err) => {
              // Never silent: a swallowed failure here leaves the cache cold,
              // so every later load pays the miss again and nothing says why.
              console.warn(
                '[dashboard] deferred 要注目 line fill failed — ai_cache stays cold:',
                err,
              )
            })
            .finally(() => inFlightFills.delete(fillKey)),
        )
        // Registered only once after() accepted the work, so a throw below
        // can't leave a key stuck marked as in-flight.
        inFlightFills.add(fillKey)
        return fallback()
      } catch {
        /* no request scope — generate inline below */
      }
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
