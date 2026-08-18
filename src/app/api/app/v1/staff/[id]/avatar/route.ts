// Facade: upload a staff avatar (design-parity packet 12 §S4a, multipart).
// TRUST BOUNDARY — same idiom as customers/[id]/photos/route.ts VERBATIM
// (S1 facts block): the web action only checks a file is present; the
// facade validates server-side — file present + non-empty, content-type
// image/* allowlist, a size cap, and a magic-byte sniff of the real bytes
// (the declared content-type is caller-controlled). Single-source:
// uploadStaffAvatarCore runs the write.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { ensureStaffWriteInScope } from '@/lib/app-api/store-clamp'
import { newSynqedClient } from '@/lib/synqed/client'
import { uploadStaffAvatarCore } from '@/actions/staff'

export const runtime = 'nodejs'

type Params = { id: string }

// Same ceiling as the customer photo upload facade route (Supabase Storage's
// global limit — the web avatar action has no app-level cap of its own).
const MAX_AVATAR_BYTES = 50 * 1024 * 1024

async function staffId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')
  return id
}

/** Magic-byte sniff over the common photo containers the store devices
 *  produce — VERBATIM copy of customers/[id]/photos/route.ts's helper (not
 *  shared across routes; matches that file's own existing convention). */
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

export const POST = facadeHandler<Params>('staff.uploadAvatar', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage') // changing a staff avatar = managing staff (Greptile #159, same as web)
  const id = await staffId(ctx)
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  // Actor store scope BEFORE the body is even read — a refused upload touches
  // nothing (and never pays for a 50MB multipart parse).
  await ensureStaffWriteInScope({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    targetStaffId: id,
  })

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
  if (file.size > MAX_AVATAR_BYTES) {
    throw new AppApiError('validation', 'file exceeds the 50MB limit')
  }
  if (!(await looksLikeImage(file))) {
    throw new AppApiError('validation', 'file content is not a recognized image format')
  }

  const result = await uploadStaffAvatarCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade', requestId: ctx.meta.requestId },
    id,
    file,
  )
  return ok(ctx, result, 'url' in result ? 201 : 200)
})

export const OPTIONS = POST
