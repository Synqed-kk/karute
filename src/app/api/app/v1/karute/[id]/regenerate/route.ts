// Server-side karute regenerate (packet 07 Decision 2) — the facade twin of the
// web action, running the SAME regenerateKaruteWithClient orchestration on the
// business-scoped Bearer client. The client sends NOTHING but the id: the route
// reads the authoritative transcript, enforces the recording-privacy ACL
// server-side (a viewer who can't see the transcript can't regenerate), and
// applies via the integrity cores. Effectful + expensive → Idempotency-Key
// REQUIRED (at-least-once documented); records.write; revocation-sensitive.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { regenerateKaruteWithClient } from '@/actions/regenerate-karute'

export const runtime = 'nodejs'

type Params = { id: string }

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const POST = facadeHandler<Params>('karute.regenerate', async (ctx) => {
  // records.write — re-writing a record's AI entries/summary (the web action
  // enforces the same). The facade capability set carries records.write via
  // capabilitiesForUser (role preset), so no extra mapping is needed.
  ensureCapability(ctx.identity.capabilities, 'records.write')
  requireIdempotencyKey(ctx.req)

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  const viewerStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const canViewAll = ctx.identity.capabilities.has('recordings.viewAll')

  // Tenancy (not_found), ACL (forbidden), and rate-limit (rate_limited) throw
  // AppApiError inside the orchestration → the handler maps them to a status.
  // The normal + soft-failure flow returns the button's RegenerateResult.
  const result = await regenerateKaruteWithClient(synqed, {
    karuteRecordId: id,
    viewerStaffId,
    canViewAll,
    locale: readLocale(ctx),
    businessId: ctx.identity.businessId,
  })
  return ok(ctx, result)
})

export const OPTIONS = POST
