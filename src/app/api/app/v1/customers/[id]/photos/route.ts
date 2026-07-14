// Facade: upload a customer photo (packet 06 §Build 4, multipart). TRUST
// BOUNDARY — the web action only checks the file is present and the client's
// `accept="image/*"` is a browser hint, not enforcement; the facade validates
// server-side: file present + non-empty, content-type `image/*` allowlist, and a
// size cap. The web path has no app-level cap (it relies on Supabase Storage's
// 50 MB ceiling — see lib/global-recorder.ts), so the facade caps at that same
// number. Single-source: uploadCustomerPhotoWithClient runs the write.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { uploadCustomerPhotoWithClient } from '@/actions/customers'
import { proveCustomerInBusiness } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

// Effective ceiling of the web upload path (Supabase Storage global limit).
const MAX_PHOTO_BYTES = 50 * 1024 * 1024

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.photo.upload', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveCustomerInBusiness(synqed, id)

  let form: FormData
  try {
    form = await ctx.req.formData()
  } catch {
    throw new AppApiError('validation', 'multipart form-data body required')
  }

  const file = form.get('file')
  if (!(file instanceof File)) throw new AppApiError('validation', 'file is required')
  if (file.size === 0) throw new AppApiError('validation', 'file is empty')
  if (!file.type.startsWith('image/')) {
    throw new AppApiError('validation', 'file must be an image (image/* content-type)')
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new AppApiError('validation', 'file exceeds the 50MB limit')
  }

  const category = form.get('category')
  const caption = form.get('caption')
  try {
    const photo = await uploadCustomerPhotoWithClient(synqed, id, file, {
      category: typeof category === 'string' ? category : undefined,
      caption: typeof caption === 'string' ? caption : undefined,
    })
    return ok(ctx, { photo }, 201)
  } catch {
    throw new AppApiError('upstream_unavailable', 'photo upload failed')
  }
})

export const OPTIONS = POST
