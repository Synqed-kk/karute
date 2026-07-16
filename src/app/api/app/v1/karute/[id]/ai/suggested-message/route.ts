// AI推奨メッセージ facade read (packet 07 Decision 1) — the web page's
// Suspense-streamed AISuggestedMessageSlot as a resource-scoped GET the thin
// screen fetches on mount. Proves karute → business FIRST (status-aware:
// cross-tenant/missing → 404 BEFORE any LLM/cache call; genuine upstream → 502),
// DERIVES customerName + summary SERVER-side from the record (never trusts
// client-supplied prompt anchors), and runs the SAME generator core as web with
// identity-threaded org-settings + a business-scoped feature gate. Returns
// { draft: SuggestedMessage|null } — a null payload is the CONTRACTUAL best-effort
// miss (feature locked, no summary, or generation failure — web parity), NOT a 502.
// No extra rate limit (the ai_cache is the cost guard, like web's streamed slot).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { effectiveSummary } from '@/lib/karute/effective-summary'
import { getSuggestedFollowUpWithClient } from '@/lib/karute/ai-outreach'

export const runtime = 'nodejs'

type Params = { id: string }

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler<Params>('karute.ai.suggestedMessage', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  // Tenancy proof — must-502 side (cross-tenant → 404, upstream → 502).
  const record = await readKaruteRaw(synqed, id)

  // Prompt anchors are DERIVED server-side from the record — never client-supplied.
  const summary = effectiveSummary(record)
  const clientId = (record.customer_id as string | null) ?? null
  const customerName = clientId
    ? await synqed.customers.get(clientId).then((c) => c.name ?? '').catch(() => '')
    : ''

  const draft = await getSuggestedFollowUpWithClient(synqed, ctx.identity.businessId, {
    karuteId: id,
    customerName,
    summary,
    locale: readLocale(ctx),
  })
  return ok(ctx, { draft })
})

export const OPTIONS = GET
