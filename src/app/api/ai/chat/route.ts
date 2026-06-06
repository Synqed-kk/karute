import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getSynqedClient } from '@/lib/synqed/client'
import { getRecentKaruteForAI } from '@/lib/karute/ai-context'
import { getOrgSettings } from '@/actions/org-settings'
import { getBusinessProfile } from '@/lib/welcome/business-types'
import { personaSystemFragment } from '@/lib/karute/business-ai-tokens'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'

export const maxDuration = 60

export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('chat')
  if (limited) return limited
  try {
    const { message, locale, history } = await request.json()

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

    // Reads from synqed-core org settings (a JSON blob). The previous
    // `from('organization_settings')` query targeted a table that doesn't
    // exist in karute's Supabase — it was silently 500-ing and falling back
    // to "salon/clinic".
    const orgSettings = await getOrgSettings()
    const businessProfile = orgSettings?.business_type
      ? getBusinessProfile(orgSettings.business_type)
      : null
    const businessType = businessProfile?.label || 'salon/clinic'

    const langInstruction = locale === 'ja' ? 'Respond in Japanese.' : 'Respond in English.'

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `${personaSystemFragment(orgSettings?.business_type, locale)}

You are a helpful AI assistant for a ${businessType} business. You have access to the business's karute (client records) and customer data. Help staff with questions about customers, treatments, scheduling advice, and business insights.

${langInstruction}

${defensivePreamble(locale)}

Recent karute records:
${karuteContext ? wrapUntrustedContent('karute_records', karuteContext) : 'No records yet.'}

Customer list: ${customerNames ? wrapUntrustedContent('customer_names', customerNames) : 'No customers yet.'}

Keep responses concise and actionable. Use the data to give specific, personalized answers.`,
      },
      ...(history ?? []).map((h: { role: string; content: string }) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ]

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 500,
    })

    const reply = completion.choices[0]?.message?.content ?? ''
    if (completion.usage) {
      void reportAiUsage('chat', completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0)
    }
    return NextResponse.json({ reply })
  } catch (error) {
    console.error('[/api/ai/chat]', error)
    return NextResponse.json({ reply: 'Sorry, something went wrong.', error: 'Failed' }, { status: 500 })
  }
}
