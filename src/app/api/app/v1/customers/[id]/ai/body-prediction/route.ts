// AI体調予測 facade read (packet 07 Decision 1) — the web page's Suspense-streamed
// AIBodyPredictionSlot as a resource-scoped GET the thin screen fetches on mount.
// Proves customer → business FIRST (status-aware: cross-tenant/missing → 404 BEFORE
// any LLM/cache call; genuine upstream → 502), fetches the customer's 8 recent
// records on the business-scoped client, and runs the SAME generator core as web
// with identity-threaded org-settings. Returns { prediction: BodyPrediction|null }
// — a null payload is the CONTRACTUAL best-effort miss (web parity: generators are
// null-on-failure by design), NOT a 502. No extra rate limit — the ai_cache
// bounds cost, but note it is CONTENT-keyed (edit-layer Wave 1): an edit or
// regen busts it immediately, so the bound is one recompute per content
// change, not per day. Budget wiring for edit-triggered rebuilds is the
// Wave-2 item (EDIT-LAYER-DESIGN §6).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'
import { getCustomerKaruteRecordsWithClient } from '@/actions/karute'
import { getBodyPredictionWithClient } from '@/lib/karute/ai-body-prediction'

export const runtime = 'nodejs'

type Params = { id: string }

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler<Params>('customer.ai.bodyPrediction', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  // Tenancy proof — must-502 side (cross-tenant → 404, upstream → 502).
  await readCustomerRaw(synqed, id)

  // 8 sessions ≈ 2 months of rhythm (page parity). Best-effort []-on-failure feeds
  // the generator, which is null-on-any-failure by contract.
  const records = await getCustomerKaruteRecordsWithClient(synqed, id, 8)
  const prediction = await getBodyPredictionWithClient(synqed, {
    customerId: id,
    records,
    locale: readLocale(ctx),
  })
  return ok(ctx, { prediction })
})

export const OPTIONS = GET
