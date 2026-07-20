// Facade: log a 連絡済み (win-back contact attempt) (design-parity Gap B-1 PR
// 2). ANY staff, no capability gate beyond baseline customers.view (web
// parity: logCustomerContactAction enforces login only). RPC-style response:
// logCustomerContactActionWithClient's { ok, error? } rides the 200 body
// VERBATIM. No Idempotency-Key: not a redeem-class write (web sends none
// either) — a retried log call appends a second row, a mild data-quality
// concern, not a money/double-burn hazard.

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { logCustomerContactActionWithClient } from '@/actions/packs'
import { proveCustomerInBusiness, resolveSelfStaffId } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

const ContactSchema = z
  .object({
    channel: z.enum(['phone', 'sms', 'email', 'line', 'in_person']),
    note: z.string().optional(),
  })
  .strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.pack.contact.log', async (ctx) => {
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
  const parsed = ContactSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await logCustomerContactActionWithClient(synqed, staffId, {
    customerId: id, // PATH id — never the client's
    channel: parsed.data.channel,
    note: parsed.data.note,
  })
  return ok(ctx, result)
})

export const OPTIONS = POST
