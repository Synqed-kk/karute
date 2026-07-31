// Facade twin of POST /api/ai/chat (design-parity F-9b). Thin caller of the
// runKaruteChat core. Bearer identity + the explicit store-id header clamp
// replace the cookie route's getUser + resolveStoreScope; same #347 semantics —
// only a RESTRICTED staff's context is clamped, viewAll (even store-pinned)
// stays business-wide. NO plan gate — parity with the web route (chat is
// rate-limited but not an entitlement-gated feature). Clamp runs BEFORE the
// rate-limit consume so a store_forbidden request never burns quota (F-A1
// spirit). Capability = the shared Ask-AI rule (permissions.ts, H0) — the
// context carries customer names; POST → revocation-sensitive (ai.chat).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { ASK_AI_REQUIRED_CAPABILITIES } from '@/lib/auth/permissions'
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
  // Same effective rule as the web page + legacy cookie route (H0).
  for (const capability of ASK_AI_REQUIRED_CAPABILITIES) {
    ensureCapability(ctx.identity.capabilities, capability)
  }

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
  // 監査ログ Wave W2 (Option A, Liam 7/28): the generic hook emits
  // ai.consult_session on this 2xx — these two seams only ENRICH that one
  // emit (additive-only contract). first_turn marks the session row ("ONE
  // row per session" canon: the first exchange IS the session); the clamped
  // store rides as the row's store lens, unset = business-wide as before.
  // Both fields derive from the CLIENT-supplied history, post-capHistory —
  // display color, never authority: a session-count consumer must re-derive
  // from row sequence, not trust the flag.
  ctx.auditDetail = { first_turn: history.length === 0, history_len: history.length }
  if (scopedStoreId) ctx.auditStoreId = scopedStoreId
  // context_label omitted when absent (JSON.stringify drops undefined) — same
  // no-hint body as the web route.
  return ok(ctx, { reply, context_label: contextLabel })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
