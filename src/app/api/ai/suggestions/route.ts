import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const { transcript, summary, entries, locale } = await request.json()

    if (!transcript && !summary) {
      return NextResponse.json({ suggestions: [] })
    }

    const cacheInput = { transcript: transcript?.slice(0, 500), summary, entries, locale }

    // Check cache
    const cached = await getCachedAI('suggestions', cacheInput)
    if (cached) {
      return NextResponse.json(cached)
    }

    const langInstruction = locale === 'ja'
      ? 'Respond entirely in Japanese.'
      : 'Respond entirely in English.'

    const context = [
      transcript ? `Transcript:\n${transcript.slice(0, 2000)}` : '',
      summary ? `Summary: ${summary}` : '',
      entries?.length > 0
        ? `Extracted entries:\n${entries.map((e: { category: string; title: string }) => `- [${e.category}] ${e.title}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n')

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgSettings } = await (supabase as any)
      .from('organization_settings')
      .select('business_type')
      .limit(1)
      .single()
    const businessType = orgSettings?.business_type || 'salon/clinic'

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant for a ${businessType} karute system. Based on the session transcript and extracted data, generate 3-5 short, actionable suggestions. These could be:
- Follow-up actions for the staff
- Product or treatment recommendations for the customer
- Things to note for the next visit
- Potential concerns or opportunities

Return as a JSON array of objects with "text" (the suggestion) and "type" (one of: "follow-up", "recommendation", "note", "concern").
Example: [{"text": "Schedule a follow-up in 2 weeks to check hair condition", "type": "follow-up"}]
${langInstruction}`,
        },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    try {
      const parsed = JSON.parse(raw)
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : Array.isArray(parsed) ? parsed : []
      const result = { suggestions }

      // Cache for 7 days
      await setCachedAI('suggestions', cacheInput, result)

      return NextResponse.json(result)
    } catch {
      return NextResponse.json({ suggestions: [] })
    }
  } catch (error) {
    console.error('[/api/ai/suggestions]', error)
    return NextResponse.json({ suggestions: [], error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
