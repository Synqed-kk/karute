// Facade: mint a service-role SIGNED UPLOAD URL for the take (packet 08
// Decision 2, leg 1). The server (service-role storage client — the /api/cleanup
// precedent) mints createSignedUploadUrl for a FLAT, TENANT-PREFIXED filename
// `app_${businessId}_${uuid}.webm`; the thin client PUTs the blob with plain
// fetch (no supabase-js in the Vite bundle — the dependency this kills). Flat
// name (not a folder) because /api/cleanup lists the bucket ROOT non-recursively
// — zero cleanup changes. The tenant prefix is what the transcribe leg verifies
// (`path` must start with `app_${identity.businessId}_`), so the SSRF surface
// disappears by construction there.
//
// Capability records.write (only recorders stage audio). No Idempotency-Key — an
// unused signed URL simply expires (mints no durable server state). POST →
// revocation-sensitive (recordings.uploadUrl).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.uploadUrl', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  // Tenant-prefixed flat filename — the transcribe leg proves `path` starts with
  // this exact prefix, so a cross-tenant path can never be transcribed.
  const path = `app_${ctx.identity.businessId}_${crypto.randomUUID()}.webm`

  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from('recordings')
    .createSignedUploadUrl(path)

  if (error || !data?.signedUrl) {
    throw new AppApiError('upstream_unavailable', 'could not mint an upload URL')
  }
  return ok(ctx, { path: data.path ?? path, url: data.signedUrl, token: data.token })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
