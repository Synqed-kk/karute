// Facade twin of POST /api/ai/chat (design-parity F-9b). Thin caller of the
// runKaruteChat core. Bearer identity + the explicit store-id header clamp
// replace the cookie route's getUser + resolveStoreScope; same #347 semantics —
// only a RESTRICTED staff's context is clamped, viewAll (even store-pinned)
// stays business-wide. NO plan gate — parity with the web route (chat is
// rate-limited but not an entitlement-gated feature). Clamp runs BEFORE the
// rate-limit consume so a store_forbidden request never burns quota (F-A1
// spirit). Capability customers.view (the context carries customer names);
// POST → revocation-sensitive (ai.chat).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { enforceAiRateLimitWithClient, reportAiUsageWithClient } from '@/lib/ai-rate-limit'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { runKaruteChat, parseContextHint, capHistory } from '@/lib/ai/karute-chat'
import { ChatSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'
export const maxDuration = 60

export const POST = facadeHandler('ai.chat', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = ChatSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }
  const { message } = parsed.data
  const locale = parsed.data.locale === 'en' ? 'en' : 'ja'
  const history = capHistory(parsed.data.history ?? [])
  const contextHint = parseContextHint(parsed.data.context_hint)

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const scopedStoreId =
    clamp.allowedStoreIds !== null ? (clamp.storeId ?? undefined) : undefined

  await enforceAiRateLimitWithClient(synqed, 'chat')

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const { reply, contextLabel, usage } = await runKaruteChat({
    synqed,
    message,
    history,
    locale,
    contextHint,
    scopedStoreId,
    businessType: orgSettings?.business_type ?? null,
    contextDeps: { synqed, customers: () => getCachedCustomerListFor(businessId) },
  })
  if (usage) void reportAiUsageWithClient(synqed, 'chat', usage.tokensIn, usage.tokensOut)
  // context_label omitted when absent (JSON.stringify drops undefined) — same
  // no-hint body as the web route.
  return ok(ctx, { reply, context_label: contextLabel })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
