import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { message, locale, history } = await request.json()
    const supabase = await createClient()

    // Fetch recent karute + customer data for context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: records } = await (supabase as any)
      .from('karute_records')
      .select('summary, created_at, customers:client_id ( name ), entries ( category, content )')
      .order('created_at', { ascending: false })
      .limit(5)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: customers } = await (supabase as any)
      .from('customers')
      .select('name')
      .order('updated_at', { ascending: false })
      .limit(10)

    const karuteContext = (records ?? []).map((r: { summary: string; created_at: string; customers: { name: string } | null; entries: { category: string; content: string }[] }) => {
      const name = (r.customers as { name: string } | null)?.name ?? 'Unknown'
      const entries = (r.entries || []).map((e: { category: string; content: string }) => `[${e.category}] ${e.content}`).join(', ')
      return `${name} (${r.created_at}): ${r.summary ?? 'No summary'}. Entries: ${entries}`
    }).join('\n')

    const customerNames = (customers ?? []).map((c: { name: string }) => c.name).join(', ')

    const langInstruction = locale === 'ja' ? 'Respond in Japanese.' : 'Respond in English.'

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are a helpful AI assistant for a salon/clinic business. You have access to the business's karute (client records) and customer data. Help staff with questions about customers, treatments, scheduling advice, and business insights.

${langInstruction}

Recent karute records:
${karuteContext || 'No records yet.'}

Customer list: ${customerNames || 'No customers yet.'}

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
    return NextResponse.json({ reply })
  } catch (error) {
    console.error('[/api/ai/chat]', error)
    return NextResponse.json({ reply: 'Sorry, something went wrong.', error: 'Failed' }, { status: 500 })
  }
}
