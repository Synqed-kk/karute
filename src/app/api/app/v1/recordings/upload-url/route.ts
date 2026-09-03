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
// Capability records.write (only recorders stage audio). POST →
// revocation-sensitive (recordings.uploadUrl).
//
// FIX ROUND 4. A CLIENT-NAMED mint is no longer free of durable state: it
// RESERVES the take's key on the caller's own recording row (audio_storage_path
// + UPLOADING) before it signs anything, because the signed URL is the only way
// bytes can exist and the binding has to come first. So for THAT body — and
// only that one — this door resolves the same roster identity and store clamp
// the finalize twin does, and can answer 403/404/409 for a session that is not
// the caller's to record onto. A server-named mint reserves nothing and is
// unchanged, down to the core reads it does not make. No Idempotency-Key still:
// the dedupe is SERVER-derived (the row's own pointer, read before write).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
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

  const synqed = newSynqedClient(ctx.identity.businessId)

  // ONLY a CLIENT-NAMED take reserves a row, so only it pays for an identity.
  // A server-named mint stays byte-identical to before this round: no roster
  // read, no assignment lookup, and therefore none of their failure modes on
  // the hot record-start path.
  const named = Boolean(parsed.data.takeId)

  // ROSTER GATE — the same half a capability check cannot carry that the
  // finalize twin runs (#566). ctx.identity.authUserId carries no proof of
  // roster membership, and a reservation WRITES a core row attributed to that
  // id: the web twin's getCurrentUserStaffId IS such a probe, so the Bearer
  // door needs its own.
  const staffId = named
    ? await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
    : null
  if (named && !staffId) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; nothing was written')
  }

  // Store scope: the Bearer twin of the action's resolveStoreScope() (cookie-
  // only, unreachable here). Decides only which store a RESERVED row lands in.
  const clamp = named
    ? await resolveStoreForRequest({
        synqed,
        authUserId: ctx.identity.authUserId,
        capabilities: ctx.identity.capabilities,
        requestedStoreId: ctx.req.headers.get('store-id'),
      })
    : { storeId: null }

  // The actor comes from the VERIFIED Bearer identity, never the body — the
  // shared core composes the tenant prefix from its businessId and re-parses
  // its own key, and attributes both the reservation and the take_named row to
  // the roster identity resolved above. A null staffId can only reach the
  // server-named path, which binds nothing; the shared core still refuses to
  // write anything without one.
  const minted = await mintTakeUploadUrl(
    synqed,
    {
      staffId,
      businessId: ctx.identity.businessId,
      storeId: clamp.storeId,
      canViewAll: ctx.identity.capabilities.has('recordings.viewAll'),
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    parsed.data,
  )
  if ('error' in minted) {
    if (minted.error === 'upstream') {
      throw new AppApiError('upstream_unavailable', 'could not mint an upload URL')
    }
    // Another staffer's session row, or a session id core does not know: real
    // statuses, not a 2xx body nobody logs — the same posture the finalize twin
    // gives its one security refusal.
    if (minted.error === 'forbidden') {
      throw new AppApiError('forbidden', 'that recording session is not yours to record onto')
    }
    if (minted.error === 'not_found') {
      // A REAL 404, unlike the finalize twin's soft 2xx body: a mint is about
      // to WRITE a reservation, so a session id core does not know is refused
      // like any other client error, not folded into the "retry vs settle"
      // shape finalize's soft body exists for.
      throw new AppApiError('not_found', 'no such recording session')
    }
    // The take is already SPOKEN FOR — its object exists without this caller's
    // reservation, or this row is bound to a different take. 409 is the client's
    // "start a new take", never a retry of this one.
    if (minted.error === 'exists' || minted.error === 'reserved_elsewhere') {
      throw new AppApiError('conflict', minted.error)
    }
    // A take id or container this server will not store is the CLIENT's error,
    // and it is named so the recorder can renegotiate rather than retry blind.
    throw new AppApiError('validation', minted.error)
  }
  return ok(ctx, minted)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
