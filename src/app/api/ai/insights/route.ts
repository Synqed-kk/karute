import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'

export const maxDuration = 60

function getSystemPrompt(businessType: string) {
  return `You are an AI assistant for a ${businessType} business. Analyze customer karute records and generate actionable insights for the staff.

Generate 3-5 insights from the provided data. Each insight should have:
- type: one of NEXT_TREATMENT, FOLLOW_UP, UPSELL, TALKING_POINT, PHOTO_REQUEST, GENERAL
- title: short actionable title (in the user's language)
- body: 1-2 sentence explanation
- customerName: the customer this insight is about
- priority: 0.0-1.0 (1.0 = most important)

Return a JSON object: { "insights": [...] }`
}

export async function POST(request: Request) {
  try {
    const { locale } = await request.json()
    const supabase = await createClient()

    // Fetch recent karute records with customer names
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: records } = await (supabase as any)
      .from('karute_records')
      .select(`
        id, summary, created_at,
        customers:client_id ( name ),
        entries ( category, content )
      `)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!records || records.length === 0) {
      return NextResponse.json({ insights: [] })
    }

    // Cache key based on record IDs + locale
    const cacheInput = {
      ids: records.map((r: { id: string }) => r.id),
      locale,
    }
    const cached = await getCachedAI('insights', cacheInput)
    if (cached) {
      return NextResponse.json(cached)
    }

    const context = records.map((r: { summary: string; created_at: string; customers: { name: string } | null; entries: { category: string; content: string }[] }) => {
      const customer = r.customers as { name: string } | null
      const entries = (r.entries || []).map((e: { category: string; content: string }) => `[${e.category}] ${e.content}`).join('\n')
      return `Customer: ${customer?.name ?? 'Unknown'}\nDate: ${r.created_at}\nSummary: ${r.summary}\nEntries:\n${entries}`
    }).join('\n\n---\n\n')

    const langInstruction = locale === 'ja'
      ? 'Respond entirely in Japanese.'
      : 'Respond entirely in English.'

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
        { role: 'system', content: getSystemPrompt(businessType) + '\n\n' + langInstruction },
        { role: 'user', content: `Analyze these recent karute records and generate insights:\n\n${context}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) return NextResponse.json({ insights: [] })

    const parsed = JSON.parse(content)
    const insights = Array.isArray(parsed) ? parsed : parsed.insights ?? []
    const result = { insights }

    await setCachedAI('insights', cacheInput, result, 1) // 1 day TTL for insights

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/ai/insights]', error)
    return NextResponse.json({ insights: [], error: 'Failed to generate insights' }, { status: 500 })
  }
}
