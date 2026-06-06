import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings } from '@/actions/org-settings'
import { personaSystemFragment } from '@/lib/karute/business-ai-tokens'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const limited = await enforceAiRateLimit('advice')
  if (limited) return limited
  try {
    const { summary, entries, locale } = await request.json()

    if (!summary && (!entries || entries.length === 0)) {
      return NextResponse.json({ advice: '' })
    }

    const cacheInput = { summary, entries, locale }

    // Check cache first
    const cached = await getCachedAI('advice', cacheInput)
    if (cached) {
      return NextResponse.json(cached)
    }

    const langInstruction = locale === 'ja'
      ? 'Respond entirely in Japanese.'
      : 'Respond entirely in English.'

    // Business type from synqed-core (was reading a non-existent Supabase table).
    const orgSettings = await getOrgSettings().catch(() => null)

    const context = [
      summary ? `Session Summary: ${wrapUntrustedContent('summary', summary)}` : '',
      entries?.length > 0
        ? `Entries:\n${wrapUntrustedContent('entries', entries.map((e: { category: string; title: string }) => `- [${e.category}] ${e.title}`).join('\n'))}`
        : '',
    ].filter(Boolean).join('\n\n')

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `${personaSystemFragment(orgSettings?.business_type, locale)}\n\nBased on the karute session data, generate practical advice for the next visit. Keep it to 2-3 sentences, focusing on what the staff should follow up on, check, or suggest to the customer. ${langInstruction}\n\n${defensivePreamble(locale)}`,
        },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      max_tokens: 300,
    })

    const advice = completion.choices[0]?.message?.content ?? ''
    if (completion.usage) {
      void reportAiUsage('advice', completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0)
    }
    const result = { advice }

    // Cache for 7 days
    await setCachedAI('advice', cacheInput, result)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/ai/advice]', error)
    return NextResponse.json({ advice: '', error: 'Failed to generate advice' }, { status: 500 })
  }
}
