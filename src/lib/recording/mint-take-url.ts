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
// object. So a CLIENT-NAMED mint RESERVES the key on the recorder's own
// session row, and the signed URL (the only way bytes can exist) is never
// handed to the caller until that reservation exists. Finalize then accepts
// nothing but a key its row already reserved.
//
// WHAT CHANGED AGAIN (fix round 6) — SIGN FIRST, RESERVE SECOND. "Reserve
// before sign" used to mean WRITE the row before calling storage. That made a
// transient signing failure durable: the row was already created/updated,
// but the caller got back an error with no session id, so its retry could
// only start a SECOND reservation — which core's own key correctly refuses
// (409 → reserved_elsewhere, terminal), stranding the take and orphaning the
// first row. A signed URL that is never handed out mints no durable state, so
// signing FIRST costs nothing: the fences and the exists check still run
// before it (nothing is signed for a key already known to be unreservable),
// and the actual row write happens only once signing has proven to work —
// return url + token + contentType + recordingSessionId together, or none of
// it. The BINDING-BEFORE-BYTES invariant is unchanged: the caller still never
// sees a URL before its row is reserved, because the function does not return
// until both have succeeded.
//
// WHAT CHANGED AGAIN (fix round 7) — THIS MINT NEVER CREATES A ROW. It used to
// mint one when a client-named take arrived with no session id. That branch is
// gone, deleted rather than flagged off: a LOST RESPONSE after a successful
// create left the client holding no session id, so its only possible retry was
// a second nameless mint — which core's own unique key rightly refuses (409 →
// reserved_elsewhere, TERMINAL), stranding the take behind an orphan row the
// caller could not even name. Row minting now has exactly ONE home,
// startRecordingSession (src/actions/recordings.ts), whose retry is safe
// because it is the client's own first step and carries no key. So a
// CLIENT-NAMED mint REQUIRES a recordingSessionId — bad_input without one —
// and this file only ever READS a row and UPDATES the one it was given.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import { composeTakeKey } from '@/lib/recording/key-grammar'
import { UploadUrlMintSchema } from '@/lib/app-api/record-schemas'
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
  /** The row this take's key is reserved on — REQUIRED whenever `takeId` is
   *  present (fix round 7; the schema's own field-pair rule). The client gets
   *  it from startRecordingSession, the ONE door that mints rows. Absent with
   *  no takeId → a server-named take, which reserves nothing. */
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
        | 'bad_input'
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
 * flags only; the key is the tenant prefix plus these two fields). Called
 * ONLY when this call actually wrote the binding (fix round 6, I3) — a retry
 * that finds its own reservation already in place writes nothing and files
 * nothing, so `reserved` is always true when this runs and is no longer a
 * parameter.
 *
 * It EMITS AND RETURNS (the emitSave idiom, src/actions/karute.ts
 * #createOrUpdateKaruteRecord) so the reservation's every success path is
 * dominated by the emit BY CONSTRUCTION: the reservation is a CORE WRITE now,
 * and a core write must never be silent.
 */
function auditTakeNamed(
  actor: MintTakeActor,
  takeId: string,
  ext: string,
  recordingSessionId: string,
): { recordingSessionId: string } {
  audit({
    category: 'recording',
    action: 'recording.take_named',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    severity: 'info',
    detail: { take_id: takeId, ext, recording_session_id: recordingSessionId, reserved: true },
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

type ReservationPlan = { kind: 'update'; row: Recording } | { kind: 'retry'; row: Recording }

/**
 * The FENCES and the exists check — everything that can refuse a client-named
 * take WITHOUT writing anything, so none of it needs a signed URL to run
 * first. Says what commitReservation must do once signing has actually
 * worked (fix round 6): reads only, never a write.
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
async function planReservation(
  synqed: Core,
  actor: MintTakeActor,
  recordingSessionId: string,
  key: string,
): Promise<ReservationPlan | { error: MintErrorCode }> {
  // A row is attributed to a staffer. No identity, nothing to bind to.
  if (!actor.staffId) return { error: 'forbidden' }

  let row: Recording
  try {
    row = await synqed.recordings.get(recordingSessionId)
  } catch (err) {
    if (statusOf(err) === 404) return { error: 'not_found' }
    throw err
  }
  const denied = assertRecorderOwnsRow(row, actor)
  if (denied) return denied

  // BYTES BEFORE THE BINDING = somebody else's take. The only caller allowed to
  // meet an existing object here is the one whose own row already reserved this
  // exact key (the legitimate retry: the PUT landed, the answer was lost).
  const exists = await objectExists(key)
  if (exists === 'unknown') return { error: 'upstream' }
  const pointer = row.audio_storage_path
  if (exists && pointer !== key) return { error: 'exists' }

  if (pointer === null) return { kind: 'update', row }
  // Bound to another take already. Never repointed here: the displaced object
  // would keep its bytes and lose its only row.
  if (pointer !== key) return { error: 'reserved_elsewhere' }
  // The retry. The binding is already exactly what this call would write.
  return { kind: 'retry', row }
}

/**
 * WRITE the binding — called ONLY after a successful sign (fix round 6): a
 * signed URL alone commits no durable state, so signing first and reserving
 * second means a transient signing failure leaves no row behind for the
 * caller's retry to collide with. A reservation failure AFTER a successful
 * sign (a race lost here) returns the error and the now-unused signed URL
 * just expires — nobody was ever handed it.
 *
 * IT RE-READS THE ROW FIRST (fix round 7). planReservation's read happened
 * before the sign, and a signing round trip is plenty of time for a concurrent
 * mint on the SAME row to reserve a DIFFERENT key. Writing this key from that
 * stale read would silently repoint the row and orphan the other take's object,
 * so the pointer is re-asserted here — still null for an update, still exactly
 * this key for a retry — and anything else is `reserved_elsewhere`. Core's
 * unique index catches the two-rows-one-key race; this catches the
 * one-row-two-keys race, which no index can see.
 */
async function commitReservation(
  synqed: Core,
  actor: MintTakeActor,
  plan: ReservationPlan,
  key: string,
  takeId: string,
  ext: string,
): Promise<{ recordingSessionId: string } | { error: MintErrorCode }> {
  let row: Recording
  try {
    // A NARROWER TOCTOU survives even this re-read (Greptile, fix round 8):
    // two DIFFERENT take ids racing to reserve this SAME unbound session can
    // both read null HERE, before either writes below — the second update then
    // silently overwrites the first's pointer, and core's unique key never
    // fires because the two keys are distinct. Not closable in this repo: it
    // needs a CONDITIONAL update in core (write only if audio_storage_path is
    // still the value this call read), a compare-and-swap the SDK does not
    // expose (Anthony addendum #4). This re-read still closes the WIDER window
    // above it — plan-to-commit, a whole signing round trip — which is the one
    // ordinary concurrency actually opens.
    row = await synqed.recordings.get(plan.row.id)
  } catch (err) {
    // The row went away between the plan and the commit (a 破棄 cleanup).
    if (statusOf(err) === 404) return { error: 'not_found' }
    throw err
  }
  // ALREADY OURS (fix round 8): the pointer is exactly this key on the fresh
  // read — a retry that matched at plan time, or a fresh 'update' beaten to
  // the write by a concurrent in-flight mint of the SAME take racing between
  // the plan's read and this one. Either way there is nothing to write and
  // nothing to audit; only a DIFFERENT non-null pointer is a real collision.
  if (row.audio_storage_path === key) return { recordingSessionId: row.id }
  // NULL now (fix round 9, Greptile): re-reserve regardless of plan.kind. A
  // fresh 'update' plan expected exactly this — its own pointer was still null
  // at plan time too. A 'retry' plan expected this key (having already failed
  // the check above), but a pointer CLEARED between plan and commit (a 破棄
  // cleanup racing the signing round trip) is not a foreign collision to
  // refuse — it is an open reservation to take, so the retry proceeds exactly
  // like a fresh update. Only a DIFFERENT non-null pointer is the real
  // reserved_elsewhere.
  if (row.audio_storage_path !== null) return { error: 'reserved_elsewhere' }

  // The reservation itself. Status stays the job's when a job owns the row:
  // UPLOADING over PROCESSING/COMPLETED would put a live or finished take back
  // into 要対応 for a key nobody has uploaded yet. The status is read off the
  // RE-READ row too — it is the fresher truth about who owns this row now.
  const write = isJobOwnedStatus(row.status)
    ? { audio_storage_path: key }
    : { audio_storage_path: key, status: 'UPLOADING' as const }
  try {
    await synqed.recordings.update(row.id, write)
  } catch (err) {
    // The core UNIQUE index is the belt this app-side check is only the
    // seatbelt for (Anthony addendum): two rows racing to reserve the same
    // key collapse to one winner, and the loser's 409 is a real answer —
    // TERMINAL for the client — never the catch-all 'upstream'.
    if (statusOf(err) === 409) return { error: 'reserved_elsewhere' }
    throw err
  }
  return auditTakeNamed(actor, takeId, ext, row.id)
}

type SignedUpload = { path: string; url: string; token: string; contentType: string }

/** The signing leg, shared by both paths. Hands back the FENCED key, never the
 *  upstream echo — `data.path` is Supabase's own report of what it signed, not
 *  a second source of truth to trust. Carries no `recordingSessionId` — the
 *  caller attaches it once the reservation (if any) has actually landed. */
async function signUpload(
  composed: { key: string; ext: string; contentType: string },
): Promise<SignedUpload | { error: 'upstream' }> {
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
  rawInput: MintTakeUrlInput = {},
): Promise<MintTakeUrlResult> {
  // THE parse, for BOTH doors. The facade parses at its route too, but the web
  // action is a 'use server' export — its argument is caller-supplied JSON
  // however it is typed — so parsing here, as the FIRST line, is what makes the
  // two doors refuse the same bodies (mirrors finalize-take.ts:156). Nothing
  // below reads `rawInput` again: recordingSessionId rides into a core URL PATH
  // unencoded (the SDK's recordings.get), so a free string there is a
  // request-forgery surface a client-side type annotation proves nothing against.
  const parsed = UploadUrlMintSchema.safeParse(rawInput)
  if (!parsed.success) return { error: 'bad_input' }
  const input = parsed.data

  const businessId = actor.businessId
  const takeId = input.takeId ?? crypto.randomUUID()
  const mimeType = input.mimeType ?? DEFAULT_MIME
  let composed: { key: string; ext: string; contentType: string } | null
  try {
    // Separate refusals so the caller can say WHICH field it rejected — a
    // client that sent a container we do not store must be able to renegotiate.
    if (composeTakeKey(businessId, takeId, DEFAULT_MIME) === null) return { error: 'bad_take_id' }
    composed = composeTakeKey(businessId, takeId, mimeType)
  } catch (err) {
    // composeTakeKey THROWS when its own output fails the grammar — a DRIFT
    // bug between composer and parser, never caller input (both fields are
    // validated above it). It is still reached from a request body, so it is
    // caught at the choke point both doors share: a settled retryable answer
    // beats a 500 out of a 'use server' export, which is what a caller saw
    // before this round.
    console.warn('[mint-take-url] key composition failed its own grammar:', err)
    return { error: 'upstream' }
  }
  if (composed === null) return { error: 'bad_mime' }

  // A SERVER-NAMED take: a fresh uuid nobody could have claimed, bound to no
  // row and claiming nothing. Signed and returned exactly as before this round.
  if (!input.takeId) {
    const signed = await signUpload(composed)
    if ('error' in signed) return signed
    return { ...signed, recordingSessionId: null }
  }

  // A CLIENT-NAMED take names its row. The schema's field-pair rule already
  // guarantees it; re-narrowed here because a zod refine is invisible to the
  // compiler, and a fence that leans on a schema clause it cannot see is one
  // edit away from being gone.
  const recordingSessionId = input.recordingSessionId
  if (!recordingSessionId) return { error: 'bad_input' }

  // The fences and the exists check run first (nothing is signed for a key
  // already known to be unreservable), THEN it is signed, THEN — only once
  // signing has actually worked — the binding is written (fix round 6, I1).
  // See the file header for why this order, not reserve-then-sign.
  let plan: ReservationPlan | { error: MintErrorCode }
  try {
    plan = await planReservation(synqed, actor, recordingSessionId, composed.key)
  } catch (err) {
    // Core did not answer. Retryable, and no URL is handed out meanwhile.
    console.warn('[mint-take-url] reservation planning failed:', err)
    return { error: 'upstream' }
  }
  if ('error' in plan) return plan

  const signed = await signUpload(composed)
  if ('error' in signed) return signed

  let reservation: { recordingSessionId: string } | { error: MintErrorCode }
  try {
    reservation = await commitReservation(synqed, actor, plan, composed.key, takeId, composed.ext)
  } catch (err) {
    // Core did not answer, AFTER a successful sign. Retryable exactly as
    // before anything was signed; the signed URL below just expires unused.
    console.warn('[mint-take-url] reservation commit failed:', err)
    return { error: 'upstream' }
  }
  if ('error' in reservation) return reservation
  return { ...signed, recordingSessionId: reservation.recordingSessionId }
}
