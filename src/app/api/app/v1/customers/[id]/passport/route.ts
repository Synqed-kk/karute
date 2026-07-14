// Facade: upsert a staff passport field (packet 06 §Build 4). Field keys are
// validated against resolvePassportFields (locale-invariant → JA canonical set),
// so an un-allowlisted key is a 400 here (never an orphan row). Single-source:
// upsertPassportFieldWithClient runs the write (and re-checks the allowlist as
// its own safety net). Capability: customers-class (web enforces login only).

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { upsertPassportFieldWithClient } from '@/actions/memory'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { resolvePassportFields } from '@/lib/karute/business-ai-tokens'
import { proveCustomerInBusiness } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

const PassportSchema = z
  .object({ fieldKey: z.string().min(1), value: z.string().min(1) })
  .strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.passport.upsert', async (ctx) => {
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
  const parsed = PassportSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const businessType = orgSettings?.business_type ?? null
  // Route-level allowlist check → a bad key is 400 (not a 502 masking a write
  // failure). The core re-checks the same set as its single-source safety net.
  const allowed = new Set(resolvePassportFields(businessType, 'ja').map((f) => f.key))
  if (!allowed.has(parsed.data.fieldKey)) {
    throw new AppApiError('validation', 'unknown passport field key')
  }

  const result = await upsertPassportFieldWithClient(synqed, ctx.identity.businessId, businessType, {
    customerId: id,
    fieldKey: parsed.data.fieldKey,
    value: parsed.data.value,
  })
  if (!result.ok) throw new AppApiError('upstream_unavailable', 'passport upsert failed')
  return ok(ctx, { ok: true })
})

export const OPTIONS = POST
