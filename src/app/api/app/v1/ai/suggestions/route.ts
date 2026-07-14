// Facade twin of POST /api/ai/suggestions (packet 08 Decision 1). Thin caller of
// the runKaruteSuggestions core. Plan gate (aiKaruteGeneration) → BEST-EFFORT
// empty on locked (200 {suggestions:[]}, preview semantics — never a 403 UX, the
// web card's catch→[] parity). WithClient rate-limit (its existing class) BEFORE
// the LLM but AFTER the plan gate (F-A1: locked never consumes). Cache parity
// (ai_cache is the guard). Capability customers.view (review-screen read); POST →
// revocation-sensitive (ai.suggestions).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { enforceAiRateLimitWithClient, reportAiUsageWithClient } from '@/lib/ai-rate-limit'
import { featureAllowedForBusiness } from '@/lib/subscription/feature-gate'
import { runKaruteSuggestions } from '@/lib/ai/karute-suggestions'
import { SuggestionsSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

export const POST = facadeHandler('ai.suggestions', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = SuggestionsSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }
  const { transcript, summary, entries, locale } = parsed.data

  if (!transcript && !summary) {
    return ok(ctx, { suggestions: [] })
  }

  // Plan gate → best-effort empty on locked (preview semantics; never 403 UX).
  if (!(await featureAllowedForBusiness(ctx.identity.businessId, 'aiKaruteGeneration'))) {
    return ok(ctx, { suggestions: [] })
  }

  const cacheInput = { transcript: transcript?.slice(0, 500), summary, entries, locale }
  const cached = await getCachedAI('suggestions', cacheInput)
  if (cached) return ok(ctx, cached)

  const synqed = newSynqedClient(ctx.identity.businessId)
  await enforceAiRateLimitWithClient(synqed, 'suggestions')

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const { result, usage } = await runKaruteSuggestions({
    transcript: transcript ?? undefined,
    summary: summary ?? undefined,
    entries: entries ?? undefined,
    locale: locale ?? 'ja',
    businessType: orgSettings?.business_type,
  })
  if (usage) void reportAiUsageWithClient(synqed, 'suggestions', usage.tokensIn, usage.tokensOut)
  await setCachedAI('suggestions', cacheInput, result)
  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
