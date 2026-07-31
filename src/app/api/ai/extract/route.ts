import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { featureAllowed } from '@/lib/subscription/feature-gate'
import { runKaruteExtraction } from '@/lib/ai/karute-extract'
import { auditWeb } from '@/lib/audit-web'

export const maxDuration = 120

export async function POST(request: Request) {
  // Explicit fail-fast auth guard (defense-in-depth). Anon already fails closed
  // downstream via getBusinessId(), but reject before any rate-limit/data work.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limited = await enforceAiRateLimit('extract')
  if (limited) {
    // Rewrapped (not returned directly) so the CP7 audit-writer walker sees a
    // literal 4xx exit — status is always 429 here (enforceAiRateLimit's only
    // truthy return); body + headers (incl. Retry-After) preserved as-is. The
    // .catch guards a parse failure on the limiter's own body from escaping
    // this route's error envelope.
    return NextResponse.json(await limited.json().catch(() => ({ error: 'rate_limited' })), {
      status: 429,
      headers: limited.headers,
    })
  }
  // Plan gate (P4): AI karute generation is a paid capability. Inert until
  // billing arms (KARUTE_BILLING_ENFORCEMENT) — see feature-gate.ts.
  if (!(await featureAllowed('aiKaruteGeneration'))) {
    return NextResponse.json(
      { error: 'PLAN_LOCKED', feature: 'aiKaruteGeneration' },
      { status: 403 },
    )
  }
  try {
    const body = await request.json()
    const { transcript, locale, customerName, sessionDate } = body

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    }

    // Business type from synqed-core → extraction tuned per business (整体 vs gym
    // vs dental). Best-effort: falls back to the neutral persona on failure. The
    // LLM call itself lives in the shared core (packet 07 §Build 1(ii)).
    const orgSettings = await getOrgSettings().catch(() => null)
    const { result, usage } = await runKaruteExtraction({
      transcript,
      locale: locale ?? 'en',
      customerName: typeof customerName === 'string' ? customerName : null,
      sessionDate: typeof sessionDate === 'string' ? sessionDate : null,
      businessType: orgSettings?.business_type,
    })
    if (usage) void reportAiUsage('extract', usage.tokensIn, usage.tokensOut)
    // 監査ログ Wave W1 (§3.1 ai.* baseline): logged AFTER extraction succeeds,
    // before the response — ids-only, no transcript/entry content.
    await auditWeb({ category: 'ai', action: 'ai.memory_extract', requestId: crypto.randomUUID() })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/ai/extract]', message)
    return NextResponse.json(
      { error: 'Extraction failed', detail: message },
      { status: 500 },
    )
  }
}
