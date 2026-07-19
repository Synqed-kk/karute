import 'server-only'
import type OpenAI from 'openai'
import type { SynqedClient } from '@synqed-kk/client'
import { openai } from '@/lib/openai'
import {
  getRecentKaruteForAI,
  getCustomerKaruteForAI,
  getTodayRosterKaruteForAI,
  formatKaruteContext,
  type AiContextDeps,
} from '@/lib/karute/ai-context'
import type { ContextHint } from '@/lib/karute/ai-signals'
import { getChatSystemPrompt } from '@/lib/prompts'
import { MAX_HISTORY_CHARS } from '@/lib/ai-safety'
import type { AiUsage } from '@/lib/ai/karute-extract'

/**
 * The AI相談 chat body — previously inlined in `POST /api/ai/chat`, moved
 * (design-parity F-9b) so the legacy cookie route AND the facade twin share ONE
 * implementation. Identity-agnostic: auth, store-scope resolution, rate limit,
 * usage report and `businessType` stay with the caller (cookie reads on the web
 * route, Bearer + explicit clamp on the facade). `contextDeps` routes the karute
 * context reads through an explicit business-scoped client on the Bearer path;
 * absent → the cookie path, byte-identical to before.
 */

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

/** Validate the optional targeted-context hint (contracts #context-hint). The id
 *  is only ever used to pick WHICH customer to read within store scope — the
 *  fetch itself is clamped — so a length bound is the whole of the trust needed. */
export function parseContextHint(raw: unknown): ContextHint {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as Record<string, unknown>
  if (
    typeof h.customer_id === 'string' &&
    h.customer_id.length > 0 &&
    h.customer_id.length <= 100
  ) {
    return { customer_id: h.customer_id }
  }
  if (h.scope === 'today') return { scope: 'today' }
  return null
}

/** Keep only the newest turns that fit the history budget (trim oldest first). */
export function capHistory(history: ChatTurn[], budget = MAX_HISTORY_CHARS): ChatTurn[] {
  const kept: ChatTurn[] = []
  let used = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = history[i].content.length
    if (used + cost > budget) break
    used += cost
    kept.unshift(history[i])
  }
  return kept
}

export async function runKaruteChat(params: {
  synqed: Pick<SynqedClient, 'customers'>
  message: string
  history: ChatTurn[]
  locale: 'en' | 'ja'
  contextHint: ContextHint
  scopedStoreId: string | undefined
  businessType: string | null
  contextDeps?: AiContextDeps
}): Promise<{ reply: string; contextLabel: string | undefined; usage: AiUsage | null }> {
  const { synqed, message, history, locale, contextHint, scopedStoreId, businessType, contextDeps } = params

  // Karute context from synqed-core (the Supabase mirror is empty
  // post-migration — chat previously had NO session context). A chip can pin
  // the slice to one customer or today's roster (contracts #context-hint);
  // absent → the generic recent slice, byte-identical to pre-change.
  let karuteContext: string
  let contextLabel: string | undefined
  if (contextHint && 'customer_id' in contextHint) {
    const { customerName, rows } = await getCustomerKaruteForAI(
      contextHint.customer_id,
      10,
      scopedStoreId,
      contextDeps,
    )
    karuteContext = formatKaruteContext(rows)
    // customerName is non-null ONLY when in-scope rows exist (ai-context B1),
    // so this label can never name an out-of-scope customer.
    if (customerName) {
      contextLabel =
        locale === 'ja'
          ? `${customerName}様のカルテ${rows.length}件`
          : `${customerName}'s karute (${rows.length} record${rows.length === 1 ? '' : 's'})`
    }
  } else if (contextHint) {
    const { rosterSize, rows } = await getTodayRosterKaruteForAI(scopedStoreId, contextDeps)
    karuteContext = formatKaruteContext(rows)
    // Count = distinct today-appointment customers (roster size), not distinct
    // resolved names in the rows (which drop record-less / unknown customers).
    contextLabel =
      locale === 'ja'
        ? `本日ご来店のお客様${rosterSize}名のカルテ`
        : `Karute for ${rosterSize} customer${rosterSize === 1 ? '' : 's'} visiting today`
  } else {
    karuteContext = formatKaruteContext(
      await getRecentKaruteForAI(5, scopedStoreId, contextDeps),
    )
  }

  const customerResult = await synqed.customers.list({ page_size: 10, sort_by: 'updated_at', sort_order: 'desc', store_id: scopedStoreId })
  const customerNames = customerResult.customers.map((c) => c.name).join(', ')

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: getChatSystemPrompt({
        locale,
        businessTypeValue: businessType,
        karuteContext,
        customerNames,
        contextLabel,
      }),
    },
    ...history,
    { role: 'user', content: message },
  ]

  const completion = await openai.chat.completions.create({
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    max_tokens: 1000,
  })

  const reply = completion.choices[0]?.message?.content ?? ''
  const usage = completion.usage
    ? {
        tokensIn: completion.usage.prompt_tokens ?? 0,
        tokensOut: completion.usage.completion_tokens ?? 0,
      }
    : null
  return { reply, contextLabel, usage }
}
