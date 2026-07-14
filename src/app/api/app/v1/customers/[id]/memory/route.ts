// Facade: add a staff-authored customer-memory item (packet 06 §Build 4).
// Single-source: addMemoryItemWithClient runs the validation + ownership guard +
// write. Capability: the web action enforces login + ownership only (memory
// curation is care work, not an admin privilege — see actions/memory.ts), so the
// facade gates at the customers-class capability (customers.view), recorded.

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { addMemoryItemWithClient } from '@/actions/memory'
import { proveCustomerInBusiness } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

const AddMemorySchema = z
  .object({
    category: z.enum(['personal', 'body', 'preference', 'goal', 'lifestyle']),
    label: z.string().min(1),
    detail: z.string().nullable().optional(),
  })
  .strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.memory.add', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveCustomerInBusiness(synqed, id)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = AddMemorySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const result = await addMemoryItemWithClient(synqed, ctx.identity.businessId, {
    customerId: id,
    category: parsed.data.category,
    label: parsed.data.label,
    detail: parsed.data.detail ?? null,
  })
  if (!result.ok) throw new AppApiError('upstream_unavailable', 'memory add failed')
  return ok(ctx, { ok: true }, 201)
})

export const OPTIONS = POST
