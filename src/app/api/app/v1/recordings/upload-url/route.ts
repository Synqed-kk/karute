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
// FIX ROUND 7. A client-named body never creates a row: it must carry the
// recordingSessionId of the row startRecordingSession already minted (the
// schema's field-pair rule — 400 without it).
//
// FIX PLAN v3 PR-2. A SERVER-named body can create one, but only with
// RECORDING_SWITCHES.bindUnboundUploads ON (it ships ON since 2026-09-24): the take's row, born
// on the key just signed. That row needs a store, so this door resolves one the
// session door's way (session/route.ts:130-165) — lazily, inside
// `bindIdentity`, which only that ON arm calls, and with every refusal or blip
// turned into "stay unbound" rather than a 403: the audio already exists, and
// this door never refuses it. With the switch OFF nothing here places a row and
// the server-named body makes no read beyond the sign, as before. Round 7's
// hazard does not return: the uuid is the server's own, so a lost reply costs
// one empty row, never a stranded take.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { extractBearer } from '@/lib/app-api/identity'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import {
  resolvePrimaryStoreId,
  resolveStoreForRequest,
  viewerAllowedStoreIds,
} from '@/lib/app-api/store-clamp'
import { reachesNoStore } from '@/lib/auth/store-gate'
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

  // ONLY a body that NAMES A SESSION pays for an identity UP FRONT — a
  // client-named take (which reserves a row) and, since fix round 7, a staged
  // copy (which reserves nothing but is bound to a session the SAME staff rule
  // has to clear). With RECORDING_SWITCHES.bindUnboundUploads OFF (ships ON since 2026-09-24),
  // a server-named mint stays byte-identical to before this round: no roster
  // read, and therefore none of its failure modes on the hot record-start
  // path. With the switch ON, a server-named mint still pays nothing up front
  // here — its own lazy roster + store read happens AFTER the sign, inside
  // bindIdentity below, and every failure there keeps the take unbound rather
  // than turning into a 403.
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
  // the roster identity resolved above. With RECORDING_SWITCHES.bindUnboundUploads
  // OFF, a null staffId can only reach the server-named path, which binds
  // nothing; the shared core still refuses to write anything without one. With
  // the switch ON, that path may still bind a row — bindIdentity below
  // resolves its own staff id from the roster, independent of this staffId.
  // The one field that depends on WHICH act this is — the store reach — is
  // added per arm below.
  const callerHoldsOwnerKeys = holdsOwnerKeys(ctx.identity.capabilities)
  const actor = {
    staffId,
    businessId: ctx.identity.businessId,
    holdsOwnerKeys: callerHoldsOwnerKeys,
    // ⚖ PR-2 — who and where a SERVER-named take's row would be (only the ON
    // server-named arm asks). The session door's exact resolution
    // (session/route.ts:93, :130-165), with ONE difference: every throw — a
    // `store_forbidden` from the clamp or the primary-store lookup, a roster
    // blip — becomes null, i.e. the take stays unbound. That door may 403
    // because the phone records on regardless; here the audio already exists.
    bindIdentity: async () => {
      try {
        const self = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
        if (!self) return null
        const clamp = await resolveStoreForRequest({
          synqed,
          authUserId: ctx.identity.authUserId,
          capabilities: ctx.identity.capabilities,
          requestedStoreId: ctx.req.headers.get('store-id'),
        })
        // ⚖ Liam 9/16: a caller who reaches NO store gets no row.
        if (reachesNoStore(clamp)) return null
        return { staffId: self, storeId: clamp.storeId ?? (await resolvePrimaryStoreId(synqed)) }
      } catch {
        return null
      }
    },
    source: 'facade' as const,
    requestId: ctx.meta.requestId,
  }
  // ③ THE OWNER'S HAND REACHES ONLY WHERE THE PERSON CAN SEE. The Bearer twin
  // of web's viewerScopeForActs, and the same call the regenerate/relearn act
  // routes already make (karute/[id]/regenerate/route.ts). Resolved ONLY when
  // the pair is held: a recorder acting on her OWN session never reaches the
  // store leg, so an assignment blip must not cost her the take. It reads the
  // ASSIGNMENT, never the `store-id` header — a phone-set pin can neither
  // widen nor narrow the owner's hand.
  const reach = async (): Promise<readonly string[] | null> =>
    callerHoldsOwnerKeys
      ? await viewerAllowedStoreIds({
          synqed,
          authUserId: ctx.identity.authUserId,
          capabilities: ctx.identity.capabilities,
          selfStaffId: staffId,
        })
      : null
  // ⚖ THE THIRD ACT (slice five packet C, D6). A body carrying `seqs` asks for
  // this take's SEGMENT keys — the bytes that reach the server while the
  // recording is still running. Branched HERE, before either body runs, because
  // the two answer different result unions and a caller must never be able to
  // get one where it asked for the other. The schema already proved a `seqs`
  // body carries a takeId (so `named` above is true and the roster gate ran)
  // and never carries `stagedFor`.
  //
  // ⚖ AND THE REACH IS RESOLVED PER ARM (③ fix round 1, L2 F2). The SEGMENT arm
  // passes null and asks core nothing: inert — the segment door refuses every
  // non-own row two lines after assertRecorderOwnsRow
  // (mint-take-url.ts:997), so a resolved scope there is a round trip that
  // changes no answer, once per segment batch, on the live-recording hot path
  // this route's own header (:64-67) exists to protect.
  const minted = parsed.data.seqs
    ? await mintSegmentUploadUrls(synqed, { ...actor, allowedStoreIds: null }, parsed.data)
    : await mintTakeUploadUrl(synqed, { ...actor, allowedStoreIds: await reach() }, parsed.data)
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
