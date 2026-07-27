import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { runKaruteSuggestions } from '@/lib/ai/karute-suggestions'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  // Explicit fail-fast auth guard (defense-in-depth). Anon already fails closed
  // downstream via getBusinessId(), but reject before any rate-limit/data work.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limited = await enforceAiRateLimit('suggestions')
  if (limited) return limited
  try {
    const { transcript, summary, entries, locale } = await request.json()

    if (!transcript && !summary) {
      return NextResponse.json({ suggestions: [] })
    }

    // Business type from synqed-core (was reading a non-existent Supabase table).
    // The LLM call itself lives in the shared core (packet 08 §Build 1(iii)).
    const orgSettings = await getOrgSettings().catch(() => null)

    // Key carries the FULL transcript (getCachedAI hashes the input — the old
    // 500-char slice only created prefix collisions) + businessType: the prompt
    // is persona-specific, so one persona must never serve another's cache.
    // Mirrors the facade twin's key exactly.
    const cacheInput = {
      transcript,
      summary,
      entries,
      locale,
      businessType: orgSettings?.business_type ?? null,
    }

    // Check cache
    const cached = await getCachedAI('suggestions', cacheInput)
    if (cached) {
      return NextResponse.json(cached)
    }
    const { result, usage } = await runKaruteSuggestions({
      transcript,
      summary,
      entries,
      locale,
      businessType: orgSettings?.business_type,
    })
    if (usage) void reportAiUsage('suggestions', usage.tokensIn, usage.tokensOut)

    // Cache for 7 days
    await setCachedAI('suggestions', cacheInput, result)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/ai/suggestions]', error)
    return NextResponse.json({ suggestions: [], error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
