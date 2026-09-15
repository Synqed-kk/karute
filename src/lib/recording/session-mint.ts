// Recording-session mint — the ONE door that creates a `recording_sessions`
// row. Shared by the web action (src/actions/recordings.ts#startRecordingSession)
// and the facade route (src/app/api/app/v1/recordings/session/route.ts).
//
// MOVED HERE (fix round 11). This function used to live inside
// src/actions/recordings.ts, a 'use server' file — every top-level export of
// such a file is a client-invokable server action, so
// startRecordingSessionWithClient was reachable directly with a
// caller-supplied `businessId`, the exact escape mint-take-url.ts's own
// header warns about: businessId decides the composed key's TENANT PREFIX, so
// a caller free to name it could reserve a key under ANY business's prefix.
//
// NO 'use server' directive here, deliberately — same rule as
// mint-take-url.ts, discard.ts and session-cleanup.ts: businessId is the
// AUTHENTICATED tenant the caller (the web action's cookie session, or the
// facade's Bearer identity) vouches for, never a body field a caller
// controls.

import type { SynqedClient } from '@synqed-kk/client'
import { composeTakeKey } from '@/lib/recording/key-grammar'
import { objectExists } from '@/lib/recording/mint-take-url'

/** Three refusals this core can produce, all settled objects, never a throw:
 *  `bad_input` (a take pair it will not compose a key from), `exists` (fix
 *  round 11, fresh-eyes #7 P2 — the composed key already holds bytes with no
 *  row of this caller's reserving it: a hard-deleted sibling row's audio,
 *  most concretely, staying on storage after session-cleanup deletes its row
 *  — refused before any row is created, never repointed onto it), and
 *  `upstream` (storage failed to answer whether the key is free — retryable,
 *  and no row is created meanwhile). `null` stays what it has always been —
 *  no staff identity to attribute a row to, the fail-OPEN case. */
export type StartRecordingSessionResult =
  | { id: string }
  | { error: 'bad_input' | 'exists' | 'upstream' }
  | null

/**
 * Recording-session mint core — EXPLICIT business-scoped client + a resolved
 * self staff id, no cookie (packet 08 §Build 3). Shared by the web action
 * (cookie → getCurrentUserStaffId) and the facade route (Bearer → selfStaffId).
 * Recorder-first attribution with the appointment-staff fallback; a null on any
 * unresolvable staff preserves the web action's fail-OPEN contract (capture
 * proceeds without dedupe — never blocked on the mint). Throws only on a genuine
 * SDK failure, which the callers swallow to null.
 *
 * BORN RESERVED (fix round 10). This is the ONE door that mints rows, and as of
 * this round every row it mints for a client-named take is created WITH the
 * take's key on it. Why: the upload mint used to reserve the key by UPDATING an
 * unbound row, and two mints naming DIFFERENT takes on one unbound row can both
 * read `audio_storage_path === null` and then write in turn — the second
 * silently repoints the row and orphans the first take's object, and core's
 * unique key never fires because the two keys differ. Closing that from this
 * repo needs a conditional update core does not expose (Anthony addendum #4).
 * A row that is never unbound cannot be raced for: the recorder already owns
 * its take id (take-store) and has already negotiated its container at start(),
 * so the binding can be part of the create itself — one write, no window. The
 * mint's update path survives only for LEGACY rows minted before this round.
 *
 * THE EXISTS FENCE (fix round 11, fresh-eyes #7 P2). Born-reserved closed the
 * two-rows-one-key race, but not a colder path: session-cleanup HARD-DELETES a
 * row (the abandoned/system path — see session-cleanup.ts) while its finalized
 * object stays on storage, never deleted alongside it. A caller who can name
 * that exact take id again (it rides in cleartext on the audit trail's own
 * recording.take_named / karute-save rows) would otherwise get a FRESH row
 * created pointing straight at somebody else's audio, with finalize accepting
 * it outright — no bytes ever uploaded, because the object was already there.
 * So this door now runs the SAME check the mint runs before ITS reservation
 * (objectExists, mint-take-url.ts): a composed key that already holds bytes is
 * refused, `exists`, before any row is created — a fresh mint's row is never
 * allowed to be BORN pointing at somebody else's take.
 *
 * KNOWN CEILING, and it is the one fix round 7 moved row-minting HERE to escape:
 * a create that carries a key is no longer a safe blind retry. Round 7's
 * argument was that this door's retry "carries no key" — as of this round a
 * client-named start does, so a LOST RESPONSE after a successful create leaves
 * the client with no session id, and re-sending the SAME take composes the SAME
 * key, which core's unique index refuses (409). That throw is swallowed to the
 * fail-OPEN null by both doors, so capture is never blocked, but the take is
 * unrecoverable: no id to name its row with, and the key is spoken for.
 * THE CLIENT RULE that closes it (PR3, and the reason the client contract says
 * so explicitly): a take-carrying start that comes back null must be retried
 * with a FRESH take id, never the same one — a new take id is free, and it is
 * the client that owns the take store. Nothing server-side can recover the
 * first row, because core exposes no lookup by audio_storage_path.
 *
 * NEVER AN ORACLE, NEVER UNFINALIZABLE (fix round 12, fresh-eyes #8, P3). Two
 * findings closed with one fix: refuse a take-carrying start outright when
 * the CALLER's own identity (input.selfStaffId) does not resolve, before
 * either the appointment-staff fallback or the exists probe below ever runs.
 * Without it: (1) the fallback would mint a row stamped with the
 * APPOINTMENT's staff_id, not the id assertRecorderOwnsRow checks against the
 * caller who actually finalizes — a reservation nobody but an owner could
 * ever complete; (2) the exists probe used to run before this door knew
 * whether it even had an identity to attribute a row to, so a caller who
 * could never end up with a row still learned whether a given take id's key
 * already held bytes — an EXISTENCE ORACLE open to anyone who can reach this
 * door. Both close the same way: input.selfStaffId is required up front for
 * a take-carrying start, and the exists probe now runs only once staffId is
 * resolved. The absent-take path is untouched — it has always allowed the
 * fallback and mints nothing that needs finalizing.
 */
export async function startRecordingSessionWithClient(
  synqed: Pick<SynqedClient, 'appointments' | 'recordings'>,
  input: {
    customerId?: string | null
    appointmentId?: string | null
    selfStaffId: string | null
    /** The caller's VERIFIED tenant — the prefix the composed key carries, and
     *  the only thing standing between a caller and another tenant's audio once
     *  a service-role client reaches that key. Cookie on web, Bearer identity on
     *  the facade; NEVER a body field. Read only when `takeId` is present. */
    businessId?: string | null
    /** The device's own take id. Absent → today's unbound row, byte for byte. */
    takeId?: string | null
    /** The recorder's negotiated container, for the key's extension. */
    mimeType?: string | null
    /** THE STORE THIS RECORDING WAS MADE IN — the actor's ACTIVE store at mint,
     *  the SAME value the job payload has always stamped (web
     *  `resolveStoreScope().storeId`, facade `resolveStoreForRequest(...)
     *  .storeId`). REQUIRED, never optional: both doors must decide it, and a
     *  door that forgot would silently mint a store-less row that the take
     *  doors then read as open. Since ⚖ amendment 10 / addendum 10.1 NEITHER door
     *  passes `null` any more — the facade 403s (store-clamp.ts:335) and the web
     *  action returns its fail-open null (actions/recordings.ts:101). The type
     *  keeps `| null` because the core column and every pre-③ row still do. */
    storeId: string | null
  },
): Promise<StartRecordingSessionResult> {
  // THE FENCES, composed BEFORE anything is created: a key this server would
  // refuse must never leave a row behind for the client to inherit, and a
  // malformed take pair is refused on its own terms — no staff lookup, no
  // storage probe.
  let composed: ReturnType<typeof composeTakeKey> = null
  if (input.takeId != null || input.mimeType != null) {
    // THE FIELD-PAIR RULE, for BOTH doors. The facade's zod refine says the same
    // thing, but the web action is a 'use server' export that runs no schema at
    // all, so the rule has to live where both doors pass through — the same
    // reason mintTakeUploadUrl parses on its own first line. businessId is
    // checked HERE rather than merely typed: an empty tenant would compose
    // `app__<uuid>.ext`, a prefix no fence can attribute to anyone.
    if (!input.takeId || !input.mimeType || !input.businessId) return { error: 'bad_input' }
    // The SAME fence the upload mint runs — case-exact uuid, the closed MIME
    // map, and a re-parse of its own output, so the only key that reaches a row
    // is one `isOwnRecordingKey` would accept for this same business. A THROW
    // from it is a composer/parser DRIFT bug, never caller input (both fields
    // are validated inside it first): it is deliberately not caught, because
    // both doors already swallow a throw to their fail-open null, which leaves
    // no row and no reservation — the safe side.
    composed = composeTakeKey(input.businessId, input.takeId, input.mimeType)
    if (composed === null) return { error: 'bad_input' }
    // FIX ROUND 12 (fresh-eyes #8, P3) — see the header. Refused here, before
    // either the appointment fallback or the exists probe below ever run.
    if (!input.selfStaffId) return { error: 'bad_input' }
  }

  let staffId: string | null = input.selfStaffId
  if (!staffId && input.appointmentId) {
    const appt = await synqed.appointments.get(input.appointmentId).catch(() => null)
    staffId = appt?.staff_id ?? null
  }
  if (!staffId) return null

  // THE RESERVATION. staffId is guaranteed non-null here (a take-carrying
  // start already required input.selfStaffId above), so the exists probe
  // below — moved AFTER staff resolution, fix round 12 — now only ever runs
  // for a call that is actually going to mint, never as an existence oracle
  // for a caller who was never getting a row either way.
  let reservation: { audio_storage_path: string; status: 'UPLOADING' } | undefined
  if (composed) {
    // THE FENCE the mint has and this door didn't (fix round 11, fresh-eyes #7
    // P2): refuse BEFORE any row is created, exactly like the mint's own
    // planReservation. `exists` here can only mean the key is spoken for by
    // something this fresh row never wrote — never a legitimate retry, because
    // a brand-new row has no prior reservation to retry against.
    const exists = await objectExists(composed.key)
    if (exists === 'unknown') return { error: 'upstream' }
    if (exists) return { error: 'exists' }
    // UPLOADING, the status the mint's own reservation writes: the take's bytes
    // are on their way and nothing owns this row yet — there is no job to
    // preserve a status for, the row is one call old.
    reservation = { audio_storage_path: composed.key, status: 'UPLOADING' }
  }

  // THE STORE RIDES ALONG (slice three ③). Two questions, two answers:
  //   · WHERE WAS THE DEVICE? — this row's `store_id`, the actor's active store
  //     at mint, resolved by each door from its own session (never a body
  //     field) and identical to the store the job payload already stamps. It is
  //     written HERE and nowhere else: `UpdateRecordingInput` carries no
  //     store_id, so the stamp is forward-only by construction and every row
  //     minted before this round keeps a null the take doors read as OPEN.
  //   · WHERE DOES THE KARUTE BELONG? — still the karute's own resolver
  //     (resolveKaruteStoreId, actions/karute.ts), which may pick the booking's
  //     store later. The two can differ, and both are true.
  //     ⚖ WHO READS THIS COLUMN, AND WHERE IT SITS IN THE ORDER (③ fix round 4,
  //     the ruling R1′ settled):
  //       – the READ doors (transcript on the web page and the facade screen
  //         route, sound on playback-url) take the KARUTE's store FIRST and this
  //         column SECOND — one spelling, `readDoorStoreId` in
  //         auth/recording-acl.ts. A karute that names no store of its own
  //         inherits the branch the device was actually in.
  //       – the ACT doors (the two 再生成 button flags and the server gate in
  //         actions/regenerate-karute.ts) take exactly the same pair, in the
  //         same order: an act is never more permissive than the read.
  //       – the TAKE doors take this column ALONE
  //         (take-binding.ts#assertRecorderOwnsRow) — they run before any karute
  //         exists to ask, which is why there is nothing to put first.
  //       – the `recording.play` AUDIT line shares the read doors' expression as
  //         a report filter, never as an access decision.
  // Sent on BOTH paths — a store-less absent-take row would be a second shape
  // for the same fact.
  const recording = await synqed.recordings.create({
    staff_id: staffId,
    customer_id: input.customerId ?? null,
    appointment_id: input.appointmentId ?? null,
    store_id: input.storeId,
    ...reservation,
  })
  return { id: recording.id }
}
