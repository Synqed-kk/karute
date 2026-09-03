// The signed-upload-URL mint, shared by both doors (web action + facade route).
//
// NO 'use server' directive, deliberately — same rule as discard.ts and
// session-cleanup.ts: `businessId` is the AUTHENTICATED tenant the caller
// vouches for. Exported from a 'use server' module it would become a
// client-invokable action taking any tenant id, which is the exact escape the
// grammar exists to prevent.
//
// WHAT CHANGED (capture pipeline PR2). The mint used to name the take itself
// (`crypto.randomUUID()`, hardcoded `.webm`). It now ACCEPTS a take id and a
// container from the client, because the device already owns the take id
// (take-store) and the recorder already negotiated the container — and a
// `.webm` name on iOS mp4 bytes is the live mislabelling bug. Accepting them
// costs a fence, which is composeTakeKey: validate, compose, then parse our
// own output. With no input the behaviour is byte-identical to before.
//
// WHAT CHANGED AGAIN (fix round 4) — BINDING BEFORE BYTES. Naming a take was
// not enough: a same-tenant staffer who learned a take uuid could finalize a
// colleague's audio onto a row of their own, and two rows could point at one
// object. So a CLIENT-NAMED mint now RESERVES the key on the recorder's own
// session row before it signs anything — it writes audio_storage_path first,
// and the signed URL (the only way bytes can exist) is handed out second.
// Finalize then accepts nothing but a key its row already reserved.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import { composeTakeKey } from '@/lib/recording/key-grammar'
import {
  assertRecorderOwnsRow,
  isJobOwnedStatus,
  isStorageNotFound,
  statusOf,
} from '@/lib/recording/take-binding'

type Core = Pick<SynqedClient, 'recordings'>

/** WHO asked for this key — resolved by the caller from its own session
 *  (cookie on web, Bearer identity on the facade), never read from a body.
 *  Same shape and same id space as FinalizeTakeActor (finalize-take.ts). */
export interface MintTakeActor {
  /** The ROSTERED staff identity (auth user id on both surfaces — resolved by
   *  getCurrentUserStaffId on web, resolveSelfStaffId on the facade). It is
   *  what a reserved row is attributed to, so it is never a body value. */
  staffId: string | null
  /** The caller's verified tenant — the prefix the composed key carries. */
  businessId: string
  /** Store for a row this mint CREATES. Same source recording-jobs.ts's payload
   *  uses (resolveStoreScope on web, resolveStoreForRequest on the facade). */
  storeId: string | null
  /** Holds `recordings.viewAll` (owner-only). Lets a manager reserve a take on
   *  another staffer's session; everyone else is own-session only. */
  canViewAll: boolean
  source: 'web' | 'facade'
  requestId?: string
}

export interface MintTakeUrlInput {
  /** The device's own take id. Absent → the server names the take, as before. */
  takeId?: string | null
  /** The recorder's negotiated MIME. Absent → audio/webm, as before. */
  mimeType?: string | null
  /** The session minted at record-start, when there is one. Absent on a
   *  client-named mint → this mint creates the row and returns its id, so the
   *  take is bound to a row either way. */
  recordingSessionId?: string | null
}

export type MintTakeUrlResult =
  | {
      path: string
      url: string
      token: string
      contentType: string
      /** The row this key is now reserved on — null ONLY for a server-named
       *  take, which claims nothing and reserves nothing. The client stamps it
       *  on the take and must send it back at finalize. */
      recordingSessionId: string | null
    }
  | {
      error:
        | 'bad_mime'
        | 'bad_take_id'
        | 'forbidden'
        | 'not_found'
        | 'exists'
        | 'reserved_elsewhere'
        | 'upstream'
    }

type MintErrorCode = Extract<MintTakeUrlResult, { error: string }>['error']

/** What the mint composed with no client input — today's exact shape. */
const DEFAULT_MIME = 'audio/webm'

/**
 * The ONE row a CLIENT-NAMED mint files (⚖ 8/17 doc law — ids, numbers and
 * flags only; the key is the tenant prefix plus these two fields).
 *
 * It EMITS AND RETURNS (the emitSave idiom, src/actions/karute.ts
 * #createOrUpdateKaruteRecord) so the reservation's every success path is
 * dominated by the emit BY CONSTRUCTION: the reservation is a CORE WRITE now,
 * and a core write must never be silent. That is also why the row is filed at
 * the RESERVATION rather than after the signing — the durable fact is the
 * binding, not the URL, and a sign that fails afterwards leaves a reservation
 * this row already explains.
 *
 * `reserved` says whether THIS call wrote the binding (a first mint) or found
 * it already there (a legitimate retry of the same take).
 */
function auditTakeNamed(
  actor: MintTakeActor,
  takeId: string,
  ext: string,
  recordingSessionId: string,
  reserved: boolean,
): { recordingSessionId: string } {
  audit({
    category: 'recording',
    action: 'recording.take_named',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    severity: 'info',
    detail: { take_id: takeId, ext, recording_session_id: recordingSessionId, reserved },
    requestId: actor.requestId,
    source: actor.source,
  })
  return { recordingSessionId }
}

/**
 * Does the bucket already hold this key?
 *
 * `info()` is the same cheap single-object read finalize uses (one GET for one
 * key). Storage failing to ANSWER is not "free": we fail CLOSED with the
 * caller's retryable error rather than reserve a key that may already hold
 * somebody else's audio.
 */
async function objectExists(key: string): Promise<boolean | 'unknown'> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from('recordings').info(key)
  if (error) return isStorageNotFound(error) ? false : 'unknown'
  return Boolean(data)
}

/**
 * RESERVE this key on the recorder's own session row, before a single byte can
 * exist. Writes `audio_storage_path` (and UPLOADING, unless a job owns the
 * row's status) and returns the row the take is now bound to.
 *
 * Refusals, in the order they are asked:
 *  - `forbidden`          nothing to attribute the take to, or another
 *                         staffer's/tenant's session row;
 *  - `not_found`          a session id core does not know — never mint a
 *                         replacement for it, the client must resend its own;
 *  - `exists`             the object is ALREADY on storage and no row of this
 *                         caller's reserved it. A colleague's finished audio is
 *                         never claimable, whatever id the caller sends;
 *  - `reserved_elsewhere` this row is already bound to a DIFFERENT take. One
 *                         row, one object: the client starts a new session.
 */
async function reserveTakeForRecorder(
  synqed: Core,
  actor: MintTakeActor,
  input: MintTakeUrlInput,
  key: string,
  ext: string,
  takeId: string,
): Promise<{ recordingSessionId: string } | { error: MintErrorCode }> {
  // A row is attributed to a staffer. No identity, nothing to bind to.
  if (!actor.staffId) return { error: 'forbidden' }

  let row: Recording | null = null
  if (input.recordingSessionId) {
    try {
      row = await synqed.recordings.get(input.recordingSessionId)
    } catch (err) {
      if (statusOf(err) === 404) return { error: 'not_found' }
      throw err
    }
    const denied = assertRecorderOwnsRow(row, actor)
    if (denied) return denied
  }

  // BYTES BEFORE THE BINDING = somebody else's take. The only caller allowed to
  // meet an existing object here is the one whose own row already reserved this
  // exact key (the legitimate retry: the PUT landed, the answer was lost).
  const exists = await objectExists(key)
  if (exists === 'unknown') return { error: 'upstream' }
  const ownsTheObject = row !== null && row.audio_storage_path === key
  if (exists && !ownsTheObject) return { error: 'exists' }

  if (row === null) {
    // No session row — a walk-in, or a record-start mint that never landed.
    // ONE place mints rows now (finalize's own mint branch is gone), so a take
    // carries its recorder and its store from its very first byte.
    const minted = await synqed.recordings.create({
      staff_id: actor.staffId,
      store_id: actor.storeId,
      customer_id: null,
      audio_storage_path: key,
      status: 'UPLOADING',
    })
    return auditTakeNamed(actor, takeId, ext, minted.id, true)
  }

  const pointer = row.audio_storage_path
  if (pointer === null) {
    // The reservation itself. Status stays the job's when a job owns the row —
    // UPLOADING over PROCESSING/COMPLETED would put a live or finished take
    // back into 要対応 for a key nobody has uploaded yet.
    const write = isJobOwnedStatus(row.status)
      ? { audio_storage_path: key }
      : { audio_storage_path: key, status: 'UPLOADING' as const }
    await synqed.recordings.update(row.id, write)
    return auditTakeNamed(actor, takeId, ext, row.id, true)
  }
  // Bound to another take already. Never repointed here: the displaced object
  // would keep its bytes and lose its only row.
  if (pointer !== key) return { error: 'reserved_elsewhere' }
  // The retry. The binding is already exactly what this call would have
  // written, so it writes nothing and still reports the claim.
  return auditTakeNamed(actor, takeId, ext, row.id, false)
}

/** The signing leg, shared by both paths. Hands back the FENCED key, never the
 *  upstream echo — `data.path` is Supabase's own report of what it signed, not
 *  a second source of truth to trust. */
async function signUpload(
  composed: { key: string; ext: string; contentType: string },
  recordingSessionId: string | null,
): Promise<MintTakeUrlResult> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from('recordings')
    .createSignedUploadUrl(composed.key)

  if (error || !data?.signedUrl) return { error: 'upstream' }
  return {
    path: composed.key,
    url: data.signedUrl,
    token: data.token,
    contentType: composed.contentType,
    recordingSessionId,
  }
}

/**
 * Mint a signed UPLOAD url for ONE finalized-take key.
 *
 * NO `upsert` (supersedes ⚖ v2 item 4, which asked for it). The key IS the
 * take's identity, so a second PUT to a key that already holds bytes must be
 * REFUSED by storage, never accepted: with upsert on a name the DEVICE chose,
 * a same-tenant staffer who names another recorder's take id overwrites that
 * take's finalized audio, and an audit row does not undo an overwrite.
 *
 * The legitimate retry (the PUT landed, the finalize call was lost) still
 * works: 409 is the client's SUCCESS signal — "the object is already there" —
 * and it proceeds to finalize, which verifies size and ownership.
 *
 * Known ceiling: a FIRST upload that landed with the WRONG bytes cannot be
 * replaced under this key. Finalize refuses on the size mismatch and the take
 * surfaces as 要対応 (R10) for a human. That is the price of immutable evidence.
 */
export async function mintTakeUploadUrl(
  synqed: Core,
  actor: MintTakeActor,
  input: MintTakeUrlInput = {},
): Promise<MintTakeUrlResult> {
  const businessId = actor.businessId
  const takeId = input.takeId ?? crypto.randomUUID()
  const mimeType = input.mimeType ?? DEFAULT_MIME
  // Separate refusals so the caller can say WHICH field it rejected — a client
  // that sent a container we do not store must be able to renegotiate.
  if (composeTakeKey(businessId, takeId, DEFAULT_MIME) === null) return { error: 'bad_take_id' }
  const composed = composeTakeKey(businessId, takeId, mimeType)
  if (composed === null) return { error: 'bad_mime' }

  // A SERVER-NAMED take: a fresh uuid nobody could have claimed, bound to no
  // row and claiming nothing. Signed and returned exactly as before this round.
  if (!input.takeId) return signUpload(composed, null)

  // A CLIENT-NAMED take is bound FIRST — the signed URL below is the only way
  // bytes can reach this key, so the row must own the key before it exists.
  let reservation: { recordingSessionId: string } | { error: MintErrorCode }
  try {
    reservation = await reserveTakeForRecorder(synqed, actor, input, composed.key, composed.ext, takeId)
  } catch (err) {
    // Core did not answer. Retryable, and no URL is handed out meanwhile.
    console.warn('[mint-take-url] reservation failed:', err)
    return { error: 'upstream' }
  }
  if ('error' in reservation) return reservation
  return signUpload(composed, reservation.recordingSessionId)
}
