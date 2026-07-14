// Facade: update / pin / delete a customer-memory item (packet 06 §Build 4).
// PATCH accepts ONLY the allowlisted keys label|detail|pinned (strict schema —
// any other key is a validation error, never forwarded). Tenancy is proven via
// the item's owning customer, so a cross-tenant OR missing item id is 404 before
// any write. Single-source: the WithClient cores run the writes.

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import {
  updateMemoryItemWithClient,
  toggleMemoryPinWithClient,
  deleteMemoryItemWithClient,
} from '@/actions/memory'
import { proveMemoryItemInBusiness } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string; itemId: string }

// Allowlist — un-listed keys rejected by .strict(); at least one field required,
// and `detail` only travels WITH a label (the edit model updates them together).
const PatchMemorySchema = z
  .object({
    // F8 hygiene (packet 07 §Build 3): caps consistent with PartialCustomerSchema.
    label: z.string().min(1).max(100).optional(),
    detail: z.string().max(4000).nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.label !== undefined || d.pinned !== undefined, {
    message: 'at least one of label|pinned is required',
  })
  .refine((d) => d.detail === undefined || d.label !== undefined, {
    message: 'detail requires label',
  })

async function itemId(ctx: FacadeContext<Params>): Promise<string> {
  const { itemId } = await ctx.route.params
  if (!itemId) throw new AppApiError('validation', 'memory item id is required')
  return itemId
}

export const PATCH = facadeHandler<Params>('customer.memory.update', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await itemId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveMemoryItemInBusiness(synqed, id)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = PatchMemorySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  if (parsed.data.pinned !== undefined) {
    const r = await toggleMemoryPinWithClient(synqed, id, parsed.data.pinned)
    if (!r.ok) throw new AppApiError('upstream_unavailable', 'memory pin failed')
  }
  if (parsed.data.label !== undefined) {
    const r = await updateMemoryItemWithClient(synqed, {
      id,
      label: parsed.data.label,
      detail: parsed.data.detail ?? null,
    })
    if (!r.ok) throw new AppApiError('upstream_unavailable', 'memory update failed')
  }
  return ok(ctx, { ok: true })
})

export const DELETE = facadeHandler<Params>('customer.memory.delete', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await itemId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveMemoryItemInBusiness(synqed, id)

  const r = await deleteMemoryItemWithClient(synqed, id)
  if (!r.ok) throw new AppApiError('upstream_unavailable', 'memory delete failed')
  return ok(ctx, { ok: true })
})

export const OPTIONS = PATCH
