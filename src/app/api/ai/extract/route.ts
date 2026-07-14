import { NextResponse } from 'next/server'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { featureAllowed } from '@/lib/subscription/feature-gate'
import { runKaruteExtraction } from '@/lib/ai/karute-extract'

export const maxDuration = 120

export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('extract')
  if (limited) return limited
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
