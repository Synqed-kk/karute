// Facade twin of POST /api/ai/extract (packet 08 Decision 2, leg 3). Thin caller
// of the batch-4 runKaruteExtraction core with businessType via orgSettingsWithClient.
// PLAN GATE (aiKaruteGeneration) checked BEFORE the rate-limit consumes (the F-A1
// ordering — a locked caller never burns quota, no LLM call). WithClient rate-limit
// + usage accounting (one path, gpt-4o pricing). Capability records.write (the
// recorder's pipeline leg); POST → revocation-sensitive (ai.extract). Transcript is
// CLIENT-SUPPLIED by design (origination path — the take is born on the client).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { enforceAiRateLimitWithClient, reportAiUsageWithClient } from '@/lib/ai-rate-limit'
import { featureAllowedForBusiness } from '@/lib/subscription/feature-gate'
import { runKaruteExtraction } from '@/lib/ai/karute-extract'
import { AiComputeSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

export const POST = facadeHandler('ai.extract', async (ctx) => {
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
  // Plan gate BEFORE the rate-limit consume (F-A1 ordering).
  if (!(await featureAllowedForBusiness(ctx.identity.businessId, 'aiKaruteGeneration'))) {
    throw new AppApiError('forbidden', 'aiKaruteGeneration plan required')
  }
  await enforceAiRateLimitWithClient(synqed, 'extract')

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const { result, usage } = await runKaruteExtraction({
    transcript: parsed.data.transcript,
    locale: parsed.data.locale ?? 'en',
    customerName: parsed.data.customerName ?? null,
    sessionDate: parsed.data.sessionDate ?? null,
    businessType: orgSettings?.business_type,
  })
  if (usage) void reportAiUsageWithClient(synqed, 'extract', usage.tokensIn, usage.tokensOut)
  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
