// Facade: 再学習 — rebuild a customer's AI memory from transcripts (packet 06
// §Build 4). LLM-effectful, so an Idempotency-Key is required (contract §8;
// at-least-once until a dedup store lands). The plan gate is resolved with THIS
// caller's business (featureAllowedForBusiness) and checked before the wipe by
// the shared core. Single-source: relearnCustomerMemoryWithClient runs it all.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { relearnCustomerMemoryWithClient } from '@/actions/memory'
import { featureAllowedForBusiness } from '@/lib/subscription/feature-gate'
import {
  proveCustomerInBusiness,
  requireIdempotencyKey,
} from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  return new URL(ctx.req.url).searchParams.get('locale') === 'en' ? 'en' : 'ja'
}

export const POST = facadeHandler<Params>('customer.memory.relearn', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  requireIdempotencyKey(ctx.req)
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveCustomerInBusiness(synqed, id)

  const planAllowed = await featureAllowedForBusiness(
    ctx.identity.businessId,
    'customerMemoryAutoExtract',
  )
  const result = await relearnCustomerMemoryWithClient(
    synqed,
    { businessId: ctx.identity.businessId, locale: readLocale(ctx), planAllowed },
    id,
  )
  // ok:false with locked → a plan wall (402-ish, but the web treats it as a
  // soft state); surface it as a 200 body so the client shows upgrade copy.
  // A genuine failure (no transcripts / write failed) → ok:false without locked.
  return ok(ctx, result)
})

export const OPTIONS = POST
