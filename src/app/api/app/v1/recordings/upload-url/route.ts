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
import { mintTakeUploadUrl } from '@/lib/recording/mint-take-url'
import { UploadUrlMintSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.uploadUrl', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  // An EMPTY/absent body is valid and means today's behaviour (server-named
  // take, .webm) — the session mint's own posture. A non-empty body that fails
  // to parse is a client error, never a silent fall-back to the server naming:
  // the caller tried to name a take and must be told it did not land.
  const raw = await ctx.req.text()
  let body: unknown = {}
  if (raw.trim() !== '') {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new AppApiError('validation', 'malformed JSON body')
    }
  }
  const parsed = UploadUrlMintSchema.safeParse(body)
  if (!parsed.success) throw new AppApiError('validation', 'invalid upload-url payload')

  // The actor comes from the VERIFIED Bearer identity, never the body — the
  // shared core composes the tenant prefix from its businessId and re-parses
  // its own key, and attributes the take_named row to its authUserId (the same
  // id space the web twin's getCurrentUserStaffId returns).
  const minted = await mintTakeUploadUrl(
    {
      staffId: ctx.identity.authUserId,
      businessId: ctx.identity.businessId,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    parsed.data,
  )
  if ('error' in minted) {
    if (minted.error === 'upstream') {
      throw new AppApiError('upstream_unavailable', 'could not mint an upload URL')
    }
    // A take id or container this server will not store is the CLIENT's error,
    // and it is named so the recorder can renegotiate rather than retry blind.
    throw new AppApiError('validation', minted.error)
  }
  return ok(ctx, minted)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
