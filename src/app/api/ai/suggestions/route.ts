import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { runKaruteSuggestions } from '@/lib/ai/karute-suggestions'
import { auditWeb } from '@/lib/audit-web'

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
  if (limited) {
    // Rewrapped (not returned directly) so the CP7 audit-writer walker sees a
    // literal 4xx exit — status is always 429 here (enforceAiRateLimit's only
    // truthy return); body + headers (incl. Retry-After) preserved as-is.
    return NextResponse.json(await limited.json(), { status: 429, headers: limited.headers })
  }
  try {
    const { transcript, summary, entries, locale } = await request.json()

    if (!transcript && !summary) {
      // 監査ログ Wave W1 (§3.1 ai.* baseline): a completed request, even with
      // nothing to suggest from — same parity rule as the facade twin, whose
      // generic hook fires unconditionally on any 2xx.
      await auditWeb({ category: 'ai', action: 'ai.suggested_message', requestId: crypto.randomUUID() })
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
      await auditWeb({ category: 'ai', action: 'ai.suggested_message', requestId: crypto.randomUUID() })
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

    await auditWeb({ category: 'ai', action: 'ai.suggested_message', requestId: crypto.randomUUID() })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/ai/suggestions]', error)
    return NextResponse.json({ suggestions: [], error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
