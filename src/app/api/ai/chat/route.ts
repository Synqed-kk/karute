import { NextResponse } from 'next/server'
import type OpenAI from 'openai'
import { openai } from '@/lib/openai'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
import {
  getRecentKaruteForAI,
  getCustomerKaruteForAI,
  getTodayRosterKaruteForAI,
  formatKaruteContext,
} from '@/lib/karute/ai-context'
import type { ContextHint } from '@/lib/karute/ai-signals'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getOrgSettings } from '@/actions/org-settings'
import { getChatSystemPrompt } from '@/lib/prompts'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { MAX_HISTORY_CHARS } from '@/lib/ai-safety'

export const maxDuration = 60

type ChatTurn = { role: 'user' | 'assistant'; content: string }

/** Validate the optional targeted-context hint (contracts #context-hint). The id
 *  is only ever used to pick WHICH customer to read within store scope — the
 *  fetch itself is clamped — so a length bound is the whole of the trust needed. */
function parseContextHint(raw: unknown): ContextHint {
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
function capHistory(history: ChatTurn[], budget = MAX_HISTORY_CHARS): ChatTurn[] {
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

export async function POST(request: Request) {
  // Explicit fail-fast auth guard (defense-in-depth). Anon already fails closed
  // downstream via getBusinessId(), but reject before any rate-limit/data work.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limited = await enforceAiRateLimit('chat')
  if (limited) return limited
  try {
    const body = await request.json().catch(() => null)

    const message = body?.message
    if (typeof message !== 'string' || message.trim().length === 0 || message.length > 4000) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
    }

    const locale: 'en' | 'ja' = body?.locale === 'en' ? 'en' : 'ja'

    const rawHistory = Array.isArray(body?.history) ? body.history : []
    const history: ChatTurn[] = capHistory(
      rawHistory.filter(
        (h: unknown): h is ChatTurn =>
          !!h &&
          typeof (h as ChatTurn).content === 'string' &&
          ((h as ChatTurn).role === 'user' || (h as ChatTurn).role === 'assistant'),
      ),
    )

    // Store scope (#347 semantics): clamp a branch-restricted staff's AI context
    // to their assigned store. Filter ONLY when allowedStoreIds is non-null (a
    // clamped staff); viewAll + floating staff = null = no filter, so their
    // context is byte-identical to pre-change (owner sees all stores).
    const scope = await resolveStoreScope()
    const scopedStoreId =
      scope.allowedStoreIds !== null ? (scope.storeId ?? undefined) : undefined

    // Karute context from synqed-core (the Supabase mirror is empty
    // post-migration — chat previously had NO session context). A chip can pin
    // the slice to one customer or today's roster (contracts #context-hint);
    // absent → the generic recent slice, byte-identical to pre-change.
    const contextHint = parseContextHint(body?.context_hint)
    let karuteContext: string
    let contextLabel: string | undefined
    if (contextHint && 'customer_id' in contextHint) {
      const { customerName, rows } = await getCustomerKaruteForAI(
        contextHint.customer_id,
        10,
        scopedStoreId,
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
      const { rosterSize, rows } = await getTodayRosterKaruteForAI(scopedStoreId)
      karuteContext = formatKaruteContext(rows)
      // Count = distinct today-appointment customers (roster size), not distinct
      // resolved names in the rows (which drop record-less / unknown customers).
      contextLabel =
        locale === 'ja'
          ? `本日ご来店のお客様${rosterSize}名のカルテ`
          : `Karute for ${rosterSize} customer${rosterSize === 1 ? '' : 's'} visiting today`
    } else {
      karuteContext = formatKaruteContext(
        await getRecentKaruteForAI(5, scopedStoreId),
      )
    }

    const synqed = await getSynqedClient()
    const customerResult = await synqed.customers.list({ page_size: 10, sort_by: 'updated_at', sort_order: 'desc', store_id: scopedStoreId })
    const customerNames = customerResult.customers.map((c) => c.name).join(', ')

    // Reads from synqed-core org settings (a JSON blob). The builder resolves
    // the persona + business label from the raw value itself.
    const orgSettings = await getOrgSettings()

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: getChatSystemPrompt({
          locale,
          businessTypeValue: orgSettings?.business_type ?? null,
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
    if (completion.usage) {
      void reportAiUsage('chat', completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0)
    }
    // context_label is omitted from the JSON when absent (no hint) → the
    // no-hint response body stays byte-identical.
    return NextResponse.json({ reply, context_label: contextLabel })
  } catch (error) {
    console.error('[/api/ai/chat]', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
