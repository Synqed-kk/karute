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
// only that one — this door resolves the same roster identity the finalize twin
// does, and can answer 403/404/409 for a session that is not the caller's to
// record onto. A server-named mint reserves nothing and is unchanged, down to
// the core reads it does not make. No Idempotency-Key still: the dedupe is
// SERVER-derived (the row's own pointer, read before write).
//
// FIX ROUND 7. The mint no longer CREATES rows, so a client-named body must
// carry the recordingSessionId of the row startRecordingSession already minted
// (the schema's field-pair rule — 400 without it), and this door has no store
// to clamp: nothing it calls places a row any more.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { extractBearer } from '@/lib/app-api/identity'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { viewerAllowedStoreIds } from '@/lib/app-api/store-clamp'
import { mintSegmentUploadUrls, mintTakeUploadUrl } from '@/lib/recording/mint-take-url'
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

  const synqed = newSynqedClient(ctx.identity.businessId, extractBearer(ctx.req))

  // ONLY a body that NAMES A SESSION pays for an identity — a client-named take
  // (which reserves a row) and, since fix round 7, a staged copy (which reserves
  // nothing but is bound to a session the SAME staff rule has to clear). A
  // server-named mint stays byte-identical to before this round: no roster read,
  // and therefore none of its failure modes on the hot record-start path.
  const named = Boolean(parsed.data.takeId ?? parsed.data.stagedFor)

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

  // The actor comes from the VERIFIED Bearer identity, never the body — the
  // shared core composes the tenant prefix from its businessId and re-parses
  // its own key, and attributes both the reservation and the take_named row to
  // the roster identity resolved above. A null staffId can only reach the
  // server-named path, which binds nothing; the shared core still refuses to
  // write anything without one.
  // ③ THE OWNER'S HAND REACHES ONLY WHERE THE PERSON CAN SEE. The Bearer twin
  // of web's viewerScopeForActs, and the same call the regenerate/relearn act
  // routes already make (karute/[id]/regenerate/route.ts). Resolved ONLY when
  // the pair is held: a recorder acting on her OWN session never reaches the
  // store leg, so an assignment blip must not cost her the take. It reads the
  // ASSIGNMENT, never the `store-id` header — a phone-set pin can neither
  // widen nor narrow the owner's hand.
  const callerHoldsOwnerKeys = holdsOwnerKeys(ctx.identity.capabilities)
  const allowedStoreIds = callerHoldsOwnerKeys
    ? await viewerAllowedStoreIds({
        synqed,
        authUserId: ctx.identity.authUserId,
        capabilities: ctx.identity.capabilities,
        selfStaffId: staffId,
      })
    : null

  const actor = {
    staffId,
    businessId: ctx.identity.businessId,
    holdsOwnerKeys: callerHoldsOwnerKeys,
    allowedStoreIds,
    source: 'facade' as const,
    requestId: ctx.meta.requestId,
  }
  // ⚖ THE THIRD ACT (slice five packet C, D6). A body carrying `seqs` asks for
  // this take's SEGMENT keys — the bytes that reach the server while the
  // recording is still running. Branched HERE, before either body runs, because
  // the two answer different result unions and a caller must never be able to
  // get one where it asked for the other. The schema already proved a `seqs`
  // body carries a takeId (so `named` above is true and the roster gate ran)
  // and never carries `stagedFor`.
  const minted = parsed.data.seqs
    ? await mintSegmentUploadUrls(synqed, actor, parsed.data)
    : await mintTakeUploadUrl(synqed, actor, parsed.data)
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
    //
    // `not_reserved` joins them (slice five packet C): the segment door refuses
    // to hang anything under a take the row has not reserved — an unbound row
    // is the whole-take mint's job at stop, and a row bound elsewhere is not
    // this take's. Same class of answer, same 409: a fact about the binding,
    // never a moment in time to retry.
    if (
      minted.error === 'exists' ||
      minted.error === 'reserved_elsewhere' ||
      minted.error === 'not_reserved'
    ) {
      throw new AppApiError('conflict', minted.error)
    }
    // A take id or container this server will not store is the CLIENT's error,
    // and it is named so the recorder can renegotiate rather than retry blind.
    throw new AppApiError('validation', minted.error)
  }
  return ok(ctx, minted)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
