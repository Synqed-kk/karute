// Facade: whole-summary karute edit (edit-layer W2 summary half — the
// 詳細記録 pencil, ⚖ Liam 7/29: one pencil, whole-section edit). Writes the
// edited_summary overlay via the SAME WithClient core the web action uses
// (src/actions/karute.ts) — ai_summary is never touched. No CAS on this
// path (core's record update has no expected_version); every change is
// preserved as a record-level lineage row core-side.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { updateKaruteDetailSummaryWithClient } from '@/actions/karute'

export const runtime = 'nodejs'

type Params = { id: string }

const PatchSummarySchema = z
  .object({
    content: z.string().min(1).max(4000),
  })
  .strict()

export const PATCH = facadeHandler<Params>('karute.summary.update', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = PatchSummarySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  // Proof-read BEFORE the mutation (sibling entry-route pattern) — a
  // cross-tenant/missing id 404s here via classifyGetError; also supplies
  // customer_id + the before-text for the core's choke-point audit detail.
  const record = await readKaruteRaw(synqed, id)
  const customerId = (record.customer_id as string | null) ?? null
  const summaryBefore =
    ((record.edited_summary as string | null) ?? (record.ai_summary as string | null)) ?? null

  const actorStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await updateKaruteDetailSummaryWithClient(
    synqed,
    id,
    { content: parsed.data.content, actorStaffId },
    {
      actorId: ctx.identity.authUserId,
      businessId: ctx.identity.businessId,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    customerId,
    summaryBefore,
  )
  // A content-validation failure is a genuine client-input problem → 400;
  // anything else in {error} is a real upstream failure → fixed generic
  // string, never result.error raw (no-internals-leak rule).
  if ('validationError' in result) {
    throw new AppApiError('validation', result.validationError)
  }
  if ('error' in result) {
    throw new AppApiError('upstream_unavailable', 'summary update failed')
  }
  return ok(ctx, { ok: true })
})

export const OPTIONS = PATCH
