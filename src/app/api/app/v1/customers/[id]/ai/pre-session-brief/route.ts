// AI pre-session brief facade read (packet 08 Decision 1) — the web page's
// Suspense-streamed brief as a resource-scoped GET the thin screen fetches on
// mount. Proves customer → business FIRST (status-aware: cross-tenant/missing →
// 404, genuine upstream → 502 — the must-502 tenancy side). Re-derives EVERYTHING
// server-side: the client sends only ids (customerId path + optional
// appointmentId), NEVER prompt anchors — the karute history, the customer name /
// visit count, and the reservation memo (appointment notes → customer notes) are
// all read here. Calls the ai-brief core with identity-threaded org-settings /
// persona / memory / backfill (Decision 1). Plan gate (aiKaruteGeneration) → null
// brief on locked (200, preview — best-effort UI, never 403 UX). The generator
// itself stays null-on-failure (exact web fallback parity). Capability
// customers.view; GET → fast-path (not revocation-sensitive).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'
import { getCustomerKaruteRecordsWithClient } from '@/actions/karute'
import { getAiPreSessionBriefWithClient } from '@/lib/karute/ai-brief'
import { featureAllowedForBusiness } from '@/lib/subscription/feature-gate'
import { memoContent } from '@/lib/sync/qr-notes'

export const runtime = 'nodejs'

type Params = { id: string }

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler<Params>('customer.ai.preSessionBrief', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  const url = new URL(ctx.req.url)
  const appointmentId = url.searchParams.get('appointmentId')
  const locale = readLocale(ctx)
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Tenancy proof FIRST — cross-tenant/missing → 404, genuine upstream → 502.
  const customer = (await readCustomerRaw(synqed, id)) as {
    name?: string
    notes?: string | null
    visit_count?: number
  }

  // Plan gate → null brief on locked (best-effort, 200 preview — no LLM).
  if (!(await featureAllowedForBusiness(businessId, 'aiKaruteGeneration'))) {
    return ok(ctx, { brief: null })
  }

  // Re-derive the prompt inputs server-side (the client sent only ids).
  const records = await getCustomerKaruteRecordsWithClient(synqed, id, 10)
  // Customer-bound: an appointment belonging to another customer must not leak
  // its memo into this customer's brief (the id pair comes from the client).
  const apptNotes = appointmentId
    ? await synqed.appointments
        .get(appointmentId)
        .then((a) => (a?.customer_id === id ? ((a?.notes ?? null) as string | null) : null))
        .catch(() => null)
    : null
  const reservationMemo = memoContent(apptNotes) ?? memoContent(customer.notes ?? null)

  // The generator is null-on-failure by contract (exact web fallback parity).
  const brief = await getAiPreSessionBriefWithClient(synqed, businessId, {
    customerId: id,
    customerName: customer.name ?? 'Unknown',
    visitCount: customer.visit_count ?? 0,
    records,
    reservationMemo,
    locale,
    now: new Date(),
  })
  return ok(ctx, { brief })
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
