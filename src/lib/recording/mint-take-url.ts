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
//
// WHAT CHANGED AGAIN (fix round 10) — EVERY SESSION IS BORN RESERVED, so this
// mint's UPDATE path is now the LEGACY path. startRecordingSession composes the
// take's key and creates the row WITH it (src/actions/recordings.ts), which
// closes the last reservation race in this file by deleting the window it lived
// in: two mints naming DIFFERENT takes on one UNBOUND row could both read a null
// pointer and write in turn, and core's unique key never fires because the two
// keys differ. Only a conditional update in core could close that (Anthony
// addendum #4) — a row that is never unbound does not need one.
//
// So the ordinary mint of this app version meets its OWN key already on the row
// and takes the "already ours" exit below: no write, no audit row, nothing to
// race. The pointer-is-null branch is kept, unchanged, for rows minted BEFORE
// this round (bounded: they age out with the 7-day take window), and it carries
// the same residual race it always did, with core's unique index as the belt.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import {
  composeStagedKey,
  composeTakeKey,
  parseRecordingKey,
} from '@/lib/recording/key-grammar'
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
  /** ⚖ STAGE A COPY FOR THIS SESSION (PR4 fix round 7). The discard's
   *  word-collection stages the disk blob of a take that can never be sealed
   *  under a finalized key, and the key it gets NAMES this session, so the
   *  transcribe door can verify the claim instead of trusting it. Never
   *  together with `takeId` (the schema refuses the pair): a staged copy is
   *  not a take, reserves nothing and is bound to no row. */
  stagedFor?: string | null
  /** ⚖ …AND IT NAMES ITS TAKE (slice five packet B, D10). The take whose bytes
   *  these are, which goes in the key's uuid slot: with it the whole staged key
   *  is composable from the core row alone (session = the row id, take + ext =
   *  the row's own reserved pointer), so an object that has no row of its own
   *  is still FINDABLE from the row that owes it. Requires `stagedFor`; absent
   *  or unusable, the server names the slot as it always did.
   *
   *  ⚖ A HINT, NEVER THE AUTHORITY (fix round 3, F4). When the row named by
   *  `stagedFor` already carries a take pointer, THAT take fills the slot and a
   *  value disagreeing with it is `bad_input`. See the staged branch. */
  stagedTake?: string | null
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
  /**
   * ⚖ THE OBJECT IS ALREADY THERE, AND NOTHING IS SIGNED (fix round 2). Only
   * the STAGED branch answers this: a staged key is composable in advance now
   * (slice five packet B), so "an object exists at this key" stopped being
   * proof that the device put it there. No `url` and no `token` — deliberately
   * absent rather than empty strings, so a caller cannot PUT against this
   * answer at all, and every consumer must NARROW before it reaches for one.
   *
   * `existingSize` is what the caller compares against its OWN blob: equal
   * means this really is its own copy (the retry whose markTakeStaged was
   * lost), and ONLY that adopts the key. `null` means storage answered without
   * a size, which proves nothing and must never be adopted.
   */
  | {
      path: string
      contentType: string
      recordingSessionId: string | null
      existingSize: number | null
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
 * What the bucket holds at this key, and how big it is.
 *
 * `info()` is the same cheap single-object read finalize uses (one GET for one
 * key). Storage failing to ANSWER is not "free": every caller fails CLOSED on
 * `'unknown'` rather than act on a key that may already hold somebody else's
 * audio.
 *
 * THE SIZE IS THE NEW HALF (fix round 2). A staged key is composable in
 * advance since slice five packet B, so "something exists here" no longer says
 * the DEVICE put it there — only its byte length, compared against the blob
 * the device still holds, can. `size: null` is storage answering without one:
 * it proves nothing, and the caller must treat it as a mismatch.
 *
 * ONE `info()` READ IN THIS FILE: objectExists below is this function with the
 * size dropped, so the two questions can never drift into two probes.
 */
export async function objectSize(
  key: string,
): Promise<{ exists: true; size: number | null } | { exists: false } | 'unknown'> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from('recordings').info(key)
  if (error) return isStorageNotFound(error) ? { exists: false } : 'unknown'
  if (!data) return { exists: false }
  return { exists: true, size: typeof data.size === 'number' ? data.size : null }
}

/**
 * Does the bucket already hold this key?
 *
 * EXPORTED (fix round 11, fresh-eyes #7 P2): the session-start reservation
 * (session-mint.ts) runs this SAME check before its own create — a
 * hard-deleted sibling row's object staying on storage while its row is gone
 * is exactly the gap a second, independent "does this exist" spelling would
 * eventually drift from. One home, four callers.
 */
export async function objectExists(key: string): Promise<boolean | 'unknown'> {
  const answer = await objectSize(key)
  return answer === 'unknown' ? 'unknown' : answer.exists
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

  const pointer = row.audio_storage_path

  // ⚖ THE POINTER IS ASKED FIRST (packet rider, from the PR2/PR3 review loops).
  // Bound to another take already. Never repointed here: the displaced object
  // would keep its bytes and lose its only row. Answered BEFORE storage is
  // touched, because `key` is composed from the CLIENT's takeId and a row whose
  // pointer is something else never reserved it — probing it would tell the
  // caller whether an object they merely NAMED exists, an oracle over a
  // colleague's takes (the same one finalize's superseded branch just lost).
  // The refusal is identical either way: `exists` and `reserved_elsewhere` are
  // both TERMINAL for the client — start a new session — so nothing but the
  // oracle is lost by settling it here.
  if (pointer !== null && pointer !== key) return { error: 'reserved_elsewhere' }

  // BYTES BEFORE THE BINDING = somebody else's take. The only caller allowed to
  // meet an existing object here is the one whose own row already reserved this
  // exact key (the legitimate retry: the PUT landed, the answer was lost) — and
  // by the line above, this row's pointer is now either null or exactly `key`.
  const exists = await objectExists(key)
  if (exists === 'unknown') return { error: 'upstream' }
  if (exists && pointer === null) return { error: 'exists' }

  // LEGACY ONLY (fix round 10): a row minted before sessions were born reserved.
  // Every row this app version creates for a client-named take already carries
  // its key, and lands on the retry exit below instead.
  if (pointer === null) return { kind: 'update', row }
  // ALREADY OURS. Either the ordinary path now (the row was BORN with this key,
  // fix round 10) or the legitimate retry (the PUT landed, the answer was lost):
  // the binding is already exactly what this call would write, so commit writes
  // nothing and audits nothing.
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
    //
    // FIX ROUND 10 CLOSED IT BY REMOVING THE UNBOUND ROW, not by winning the
    // race: a session created by this app version is born carrying its key, so
    // the only rows that can still reach the write below are LEGACY ones from
    // before that round. The residual is bounded by their 7-day window, and
    // core's unique index remains the belt underneath it.
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

  // THE LEGACY WRITE (fix round 10). Reachable only for a row minted before
  // sessions were born reserved — a current row met its own key above.
  // Status stays the job's when a job owns the row:
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

  // ⚖ A STAGED COPY IS NAMED FOR ITS SESSION (PR4 fix round 7). It is still
  // ROW-LESS — nothing is reserved, nothing is written, nothing is audited —
  // but it is no longer ANONYMOUS: the key carries the session, so the
  // transcribe door can check the binding rather than accept any same-tenant
  // key as that discard's audio. The row is read only to prove the caller may
  // record onto it, with the SAME staff rule the take mint applies: the client
  // is tenant-scoped, so another business's session simply is not found.
  if (input.stagedFor) {
    // Nothing to attribute a staging to — the take mint's own first refusal.
    if (!actor.staffId) return { error: 'forbidden' }
    let row: Recording
    try {
      row = await synqed.recordings.get(input.stagedFor)
    } catch (err) {
      if (statusOf(err) === 404) return { error: 'not_found' }
      console.warn('[mint-take-url] staged session read failed:', err)
      return { error: 'upstream' }
    }
    const denied = assertRecorderOwnsRow(row, actor)
    if (denied) return denied
    // ⚖ THE ROW NAMES THE SLOT, NOT THE CALLER (slice five fix round 3, F4).
    // Packet B fenced the SESSION here and nothing else, so `stagedTake` was
    // interpolated into the key on a shape check alone: a `recordings.viewAll`
    // holder could read a colleague's row, learn both halves of the identity
    // D10 deliberately made composable, and PUT arbitrary bytes at that take's
    // staged key before the device ever staged it. The key is immutable and the
    // ports adopt only their own byte length, so no audio is lost — but the
    // take can then never be staged, its discard's words are never collected,
    // and it never becomes releasable. That is a denial the door can close.
    //
    // The row already knows the answer. Its `audio_storage_path` is this
    // session's OWN reserved pointer, `app_<biz>_<take>.<ext>` — the same value
    // D10 composes the staged key from — so when it parses as a take, THAT take
    // id is the slot and a client naming a different one is `bad_input`. The
    // row outranks the caller because the reservation was written by the mint
    // that bound the recording; the caller's field is a hint about it.
    //
    // A row with no take pointer — a legacy unbound row, or the row of a
    // `no_uuid` take that could never reserve one — has nothing to outrank the
    // caller with, so the client's slot stands if it is a uuid and
    // composeStagedKey mints a random one if it is not (F3's cohort).
    //
    // ⚖ THE CEILING, NAMED: a `recordings.viewAll` holder can still pre-fill
    // the staged key of a colleague's OWN take — the row is theirs to bind and
    // the take is the row's, so both halves are legitimate and this fence
    // cannot see the difference. That denies the discard its words; it loses no
    // audio (the size fence and serverHoldsTake both hold), and it is
    // owner-level trust by construction.
    const rowKey = parseRecordingKey(row.audio_storage_path, businessId)
    const rowTake = rowKey?.kind === 'take' ? rowKey.takeId : null
    if (rowTake && input.stagedTake && input.stagedTake !== rowTake) {
      return { error: 'bad_input' }
    }
    // ⚖ THE COPY IS THE TAKE'S, CONTAINER AND ALL (slice five packet B, D10).
    // `stagedTake` fills the key's uuid slot, which is what makes this row-less
    // object composable from the core row alone; `mimeType` is the TAKE's own
    // negotiated container, so an iOS copy is finally `.mp4` instead of the
    // `.webm` every staged copy carried — and both ports now PUT it under the
    // contentType this same composition answers with. DEFAULT_MIME still stands
    // in for the in-tab fallback, which names neither: nothing ever claims ITS
    // path to a discard, so it has no identity to compose.
    const composed = composeStagedKey(
      businessId,
      input.stagedFor,
      input.mimeType ?? DEFAULT_MIME,
      rowTake ?? input.stagedTake,
    )
    // Only the SESSION and the container can fail the grammar now — the slot
    // never does, because composeStagedKey mints its own for anything that is
    // not a lowercase take uuid.
    if (composed === null) return { error: 'bad_input' }
    // ⚖ EXISTENCE IS ANSWERED HERE, NOT AT THE PUT (fix round 2). Packet B made
    // this key composable in advance, and the ports read a PUT's "already
    // there" refusal as a SUCCESS — so a records.write holder could mint their
    // OWN discarded session's staged key, PUT any bytes under it before the
    // device staged, and the device would adopt those bytes as its copy, mark
    // the take staged, and (D11) release the only real recording it had. The
    // ⚖ 9/3 rule is that no staffer action can erase a recording.
    //
    // So the door refuses to SIGN over an object that is already there and
    // answers its SIZE instead. The device adopts the key only when that size
    // is its own blob's, which is the one thing a caller cannot forge without
    // already holding the recording. Nothing is signed on this arm, so the
    // answer hands out no way to write.
    const existing = await objectSize(composed.key)
    // Storage did not answer. Retryable, and nothing is signed meanwhile — the
    // same posture the take mint's own exists check takes.
    if (existing === 'unknown') return { error: 'upstream' }
    if (existing.exists) {
      return {
        path: composed.key,
        contentType: composed.contentType,
        recordingSessionId: input.stagedFor,
        existingSize: existing.size,
      }
    }
    const signed = await signUpload(composed)
    if ('error' in signed) return signed
    return { ...signed, recordingSessionId: input.stagedFor }
  }

  const takeId = input.takeId ?? crypto.randomUUID()
  // ⚖ A CLIENT-NAMED TAKE BRINGS ITS OWN CONTAINER (fix round 1, rider 3's
  // second half). The schema's field-pair rule says so for both doors, and this
  // is where that rule is CASHED: `?? DEFAULT_MIME` applied to a take the
  // CLIENT named would compose `.webm` onto audio that is not webm — the wrong
  // extension on the one object the whole pipeline now reads, and invisible to
  // finalize, which composes from the same pair and would agree with it. Only
  // the SERVER-named take (no takeId, so no mimeType either) keeps the default.
  // Re-narrowed here because a zod refine is invisible to the compiler, and a
  // fence that leans on a schema clause it cannot see is one edit away from
  // being gone.
  const mimeType = input.mimeType ?? (input.takeId ? null : DEFAULT_MIME)
  if (mimeType === null) return { error: 'bad_input' }
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
