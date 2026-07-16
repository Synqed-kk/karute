import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getRecentKaruteForAI } from '@/lib/karute/ai-context'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getOrgSettings } from '@/actions/org-settings'
import { getBusinessProfile } from '@/lib/welcome/business-types'
import { personaSystemFragment } from '@/lib/karute/business-ai-tokens'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'

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
  const limited = await enforceAiRateLimit('insights')
  if (limited) return limited
  try {
    const { locale } = await request.json()

    // Store scope (#347 semantics): clamp a branch-restricted staff's insights
    // to their assigned store. Filter ONLY when allowedStoreIds is non-null;
    // viewAll + floating staff = null = no filter (behavior unchanged).
    const scope = await resolveStoreScope()
    const scopedStoreId =
      scope.allowedStoreIds !== null ? (scope.storeId ?? undefined) : undefined

    // Recent karute from synqed-core — the Supabase mirror is empty
    // post-migration, so this route returned NO insights until now.
    const records = await getRecentKaruteForAI(10, scopedStoreId)

    if (records.length === 0) {
      return NextResponse.json({ insights: [] })
    }

    // synqed-core org settings (the previous `from('organization_settings')`
    // hit a Supabase table that doesn't exist — it silently 500'd to the default).
    // Resolved BEFORE the cache key: business type reshapes the persona/prompt, so
    // it must participate in the key (a type change now invalidates cached insights).
    const orgSettings = await getOrgSettings()
    const businessProfile = orgSettings?.business_type
      ? getBusinessProfile(orgSettings.business_type)
      : null
    const businessType = businessProfile?.label || 'salon/clinic'

    // Cache key mirrors what the prompt consumes (names, dates, effective
    // summaries, entries, business type) so a regenerated/edited summary or entry
    // rebuilds instead of serving a stale insight for the 1-day TTL.
    const cacheInput = {
      ids: records.map((r) => r.id),
      recs: records.map((r) => ({
        name: r.customerName,
        d: r.createdAt,
        s: r.summary,
        e: r.entries.map((e) => ({ c: e.category, t: e.content })),
      })),
      bt: orgSettings?.business_type ?? null,
      locale,
    }
    const cached = await getCachedAI('insights', cacheInput)
    if (cached) {
      return NextResponse.json(cached)
    }

    const context = records
      .map((r) => {
        const entries = r.entries
          .map((e) => `[${e.category}] ${e.content}`)
          .join('\n')
        return `Customer: ${r.customerName}\nDate: ${r.createdAt}\nSummary: ${r.summary ?? ''}\nEntries:\n${entries}`
      })
      .join('\n\n---\n\n')

    const langInstruction = locale === 'ja'
      ? 'Respond entirely in Japanese.'
      : 'Respond entirely in English.'

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: personaSystemFragment(orgSettings?.business_type, locale) + '\n\n' + getSystemPrompt(businessType) + '\n\n' + langInstruction + '\n\n' + defensivePreamble(locale) },
        { role: 'user', content: `Analyze these recent karute records and generate insights:\n\n${wrapUntrustedContent('karute_records', context)}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    })

    const content = completion.choices[0]?.message?.content
    if (completion.usage) {
      void reportAiUsage('insights', completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0)
    }
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
