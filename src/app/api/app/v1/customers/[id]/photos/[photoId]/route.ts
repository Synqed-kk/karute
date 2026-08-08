// Facade: delete a customer photo (packet PR 9b device-wiring delta,
// 2026-08-09; ownership-proof hardening same day, blind round). Tenancy
// proof on the CUSTOMER, then OWNERSHIP proof that photoId actually belongs
// to them (provePhotoForCustomer — listPhotos IS the ownership read, same
// shape as provePackForCustomer). Calls the SAME core the web action uses
// (synqed.customers.deletePhoto) — single source of truth.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { proveCustomerInBusiness, provePhotoForCustomer } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string; photoId: string }

export const DELETE = facadeHandler<Params>('customer.photo.delete', async (ctx: FacadeContext<Params>) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const { id, photoId } = await ctx.route.params
  if (!id || !photoId) throw new AppApiError('validation', 'customer id and photo id are required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  // Tenancy proof BEFORE the delete — cross-tenant/missing customer id 404s here.
  await proveCustomerInBusiness(synqed, id)
  // Ownership proof — a photoId that isn't THIS customer's 404s here too,
  // before any delete call reaches core.
  await provePhotoForCustomer(synqed, id, photoId)

  try {
    await synqed.customers.deletePhoto(id, photoId)
    return ok(ctx, { ok: true })
  } catch (err) {
    console.error('[customer.photo.delete] upstream cause:', err)
    throw new AppApiError('upstream_unavailable', 'photo delete failed')
  }
})

export const OPTIONS = DELETE
