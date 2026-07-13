import { NextResponse } from 'next/server'
import type OpenAI from 'openai'
import { openai } from '@/lib/openai'
import { getSynqedClient } from '@/lib/synqed/client'
import { getRecentKaruteForAI } from '@/lib/karute/ai-context'
import { getOrgSettings } from '@/actions/org-settings'
import { getChatSystemPrompt } from '@/lib/prompts'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { MAX_HISTORY_CHARS } from '@/lib/ai-safety'

export const maxDuration = 60

type ChatTurn = { role: 'user' | 'assistant'; content: string }

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

    // Recent karute from synqed-core (the Supabase mirror is empty
    // post-migration — chat previously had NO session context).
    const records = await getRecentKaruteForAI(5)

    const synqed = await getSynqedClient()
    const customerResult = await synqed.customers.list({ page_size: 10, sort_by: 'updated_at', sort_order: 'desc' })

    const karuteContext = records
      .map((r) => {
        const entries = r.entries
          .map((e) => `[${e.category}] ${e.content}`)
          .join(', ')
        return `${r.customerName} (${r.createdAt}): ${r.summary ?? 'No summary'}. Entries: ${entries}`
      })
      .join('\n')

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
    return NextResponse.json({ reply })
  } catch (error) {
    console.error('[/api/ai/chat]', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
