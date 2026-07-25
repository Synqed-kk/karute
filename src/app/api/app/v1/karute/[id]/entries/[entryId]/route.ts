// Facade: per-entry karute edit (edit-layer W2 PR-B — edit-save only, no
// delete; that's PR-B2). CAS-guarded: expectedVersion is REQUIRED, a stale
// value maps to 409 (the 'conflict' code). Calls the SAME WithClient core the
// web action uses (src/actions/karute.ts) — never core's update({entries}).

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { updateKaruteDetailEntryWithClient } from '@/actions/karute'

export const runtime = 'nodejs'

type Params = { id: string; entryId: string }

// Same 8-value display taxonomy as SessionEntrySchema (karute-detail-screen-dto.ts)
// — the core translates it to the DB enum (SESSION_CATEGORY_TO_ENTRY_CATEGORY).
const PatchEntrySchema = z
  .object({
    content: z.string().min(1).optional(),
    category: z
      .enum(['treatment', 'concern', 'condition', 'preference', 'lifestyle', 'product', 'next', 'note'])
      .optional(),
    expectedVersion: z.number().int(),
  })
  .strict()

export const PATCH = facadeHandler<Params>('karute.entry.update', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')
  const { id, entryId } = await ctx.route.params
  if (!id || !entryId) throw new AppApiError('validation', 'karute id and entry id are required')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = PatchEntrySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  const actorStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await updateKaruteDetailEntryWithClient(synqed, id, entryId, {
    content: parsed.data.content,
    category: parsed.data.category,
    expectedVersion: parsed.data.expectedVersion,
    actorStaffId,
  })
  if ('conflict' in result) {
    throw new AppApiError('conflict', 'entry was updated elsewhere')
  }
  if ('error' in result) {
    throw new AppApiError('upstream_unavailable', result.error)
  }
  return ok(ctx, { ok: true })
})

export const OPTIONS = PATCH
