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

    // synqed-core org settings — fetched BEFORE the cache check because the
    // system prompt's persona is built from business_type, so it belongs in
    // the cache key (fleet round 7/25: a vertical switch must not serve
    // yesterday's persona for a day). A transient settings failure degrades
    // to the generic persona for THIS response only — served uncached (see
    // the settingsFailed guard below), so a hiccup can neither take down
    // insights nor poison the cache with a wrong-persona result for a day
    // (Greptile P1 on #613).
    let settingsFailed = false
    const orgSettings = await getOrgSettings().catch(() => {
      settingsFailed = true
      return null
    })

    // Content-keyed (EDIT-LAYER-DESIGN §4, the ai-outreach.ts pattern):
    // everything the prompt reads per record — effectiveSummary, name, date,
    // entries — plus the persona's business_type. An edited or regenerated
    // summary must bust this cache immediately instead of surviving up to the
    // 1-day TTL below. (`e` is inert today — list() never returns entries,
    // so it's always [] — kept so the key is already correct if that ever
    // changes.)
    const cacheInput = {
      rows: records.map((r) => ({
        id: r.id,
        n: r.customerName,
        d: r.createdAt,
        s: r.summary,
        e: r.entries.map((entry) => `${entry.category}:${entry.content}`),
      })),
      bt: orgSettings?.business_type ?? null,
      locale,
    }
    // A settings-failure request bypasses the cache in BOTH directions
    // (Greptile round 2 on #613): reading under the degraded bt:null key
    // could serve a previously-cached generic-persona response just as
    // wrongly as writing one would pin it.
    const cached = settingsFailed ? null : await getCachedAI('insights', cacheInput)
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

    // (orgSettings fetched above, pre-cache-check — business_type is in the key.)
    const businessProfile = orgSettings?.business_type
      ? getBusinessProfile(orgSettings.business_type)
      : null
    const businessType = businessProfile?.label || 'salon/clinic'

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

    // A settings-failure response was built with the generic persona — serve
    // it, never cache it (the bt:null key would pin wrong-persona insights
    // for a day).
    if (!settingsFailed) {
      await setCachedAI('insights', cacheInput, result, 1) // 1 day TTL for insights
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/ai/insights]', error)
    return NextResponse.json({ insights: [], error: 'Failed to generate insights' }, { status: 500 })
  }
}
