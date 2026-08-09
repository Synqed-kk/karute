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
import { proveCustomerInBusiness, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { parsePhotoUploadFields } from '@/lib/karute/photo-upload-fields'

export const runtime = 'nodejs'

type Params = { id: string }

// Effective ceiling of the web upload path (Supabase Storage global limit).
const MAX_PHOTO_BYTES = 50 * 1024 * 1024

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

/** Magic-byte sniff over the common photo containers the store devices
 *  produce: JPEG, PNG, GIF, WebP, and the ISO-BMFF family (HEIC/HEIF/AVIF —
 *  iPhone camera default). Trailing bytes are NOT validated — this is a
 *  container check, not a decoder; core re-processes uploads server-side. */
async function looksLikeImage(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (head.length < 12) return false
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true // JPEG
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return true // PNG
  if (ascii(0, 4) === 'GIF8') return true // GIF
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return true // WebP
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    return ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'avif', 'avis'].includes(brand)
  }
  return false
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
  // The declared content-type is caller-controlled (Greptile P1, security):
  // verify the BYTES are a real image container before anything is stored.
  if (!(await looksLikeImage(file))) {
    throw new AppApiError('validation', 'file content is not a recognized image format')
  }

  const category = form.get('category')
  const caption = form.get('caption')
  const { recording_session_id, taken_with_consent } = parsePhotoUploadFields(form)
  try {
    // captured_by_staff_id is SERVER-RESOLVED — never trust client input for
    // attribution (the #452 selfStaffId pattern; same helper the
    // consent/revoke sibling route resolves through).
    const captured_by_staff_id =
      (await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)) ?? undefined
    const photo = await uploadCustomerPhotoWithClient(synqed, id, file, {
      category: typeof category === 'string' ? category : undefined,
      caption: typeof caption === 'string' ? caption : undefined,
      recording_session_id,
      captured_by_staff_id,
      taken_with_consent,
    })
    return ok(ctx, { photo }, 201)
  } catch (err) {
    // logFacadeError only ever logs code+status — the upstream cause must be
    // named here or the next intermittent 502 is undiagnosable (8/1 field bug).
    console.error('[customer.photo.upload] upstream cause:', err)
    throw new AppApiError('upstream_unavailable', 'photo upload failed')
  }
})

export const OPTIONS = POST
