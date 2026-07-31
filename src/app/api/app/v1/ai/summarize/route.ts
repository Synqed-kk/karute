// Facade twin of POST /api/ai/summarize (packet 08 Decision 2, leg 3). Thin
// caller of the batch-4 runKaruteSummary core. Plan gate (aiKaruteGeneration)
// BEFORE the rate-limit consume (F-A1). WithClient rate-limit + usage accounting.
// Capability records.write; POST → revocation-sensitive (ai.summarize).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { enforceAiRateLimitWithClient, reportAiUsageWithClient } from '@/lib/ai-rate-limit'
import { featureAllowedForBusiness } from '@/lib/subscription/feature-gate'
import { runKaruteSummary } from '@/lib/ai/karute-summarize'
import { AiComputeSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

export const POST = facadeHandler('ai.summarize', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = AiComputeSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  if (!(await featureAllowedForBusiness(ctx.identity.businessId, 'aiKaruteGeneration'))) {
    throw new AppApiError('forbidden', 'aiKaruteGeneration plan required')
  }
  await enforceAiRateLimitWithClient(synqed, 'summarize')

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const { result, usage } = await runKaruteSummary({
    transcript: parsed.data.transcript,
    locale: parsed.data.locale ?? 'en',
    customerName: parsed.data.customerName ?? null,
    sessionDate: parsed.data.sessionDate ?? null,
    businessType: orgSettings?.business_type,
  })
  if (usage) void reportAiUsageWithClient(synqed, 'summarize', usage.tokensIn, usage.tokensOut)
  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
