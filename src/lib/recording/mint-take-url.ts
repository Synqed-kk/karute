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
  composeSegmentKey,
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
  storageMessageKind,
  warnStorageUnknown,
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
  /** The OWNER'S HAND — `business.manage` AND `recordings.viewAll` together
   *  (holdsOwnerKeys, auth/permissions.ts). Lets such a caller reserve a take on
   *  another staffer's session; everyone else is own-session only. The named
   *  grant ALONE does NOT reach here: it grants hearing and reading, never
   *  reserving (⚖ 9/3 council).   *
   *  ⚖ AND DELIBERATELY NOT STORE-CLAMPED, THE STANDING EXCEPTION (9/6): no
   *  store dimension exists at this layer — `recordings` rows carry no
   *  store_id (session-mint.ts:174 says so in the create payload), and at
   *  mint/bind time the karute that WOULD carry one does not exist yet. So the
   *  pair here is the owner's explicit hand and nothing narrows it. The store
   *  law is applied where a store can be known: the read doors (transcript ·
   *  playback, via the linked karute) and the karute-level acts (regenerate ·
   *  再学習). Recorded, not overlooked. */
  holdsOwnerKeys: boolean
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
  /** ⚖ THE SEGMENTS OF A TAKE STILL BEING RECORDED (slice five packet C, D6).
   *  The seqs this call wants keys for — the third act this one door mints, and
   *  the only one that reserves nothing AND writes nothing AND audits nothing.
   *  REQUIRES `takeId` (and through it `mimeType` + `recordingSessionId`), never
   *  rides with `stagedFor`, and is read by `mintSegmentUploadUrls` alone: the
   *  whole-take mint below ignores it, and the two doors branch on its presence
   *  before either body runs. */
  seqs?: number[] | null
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
   * ⚖ THE OBJECT IS ALREADY THERE, AND NOTHING IS SIGNED (fix round 2). The
   * STAGED branch and — since the 2026-09-05 hotfix — the TAKE branch both
   * answer this: a staged key is composable in advance now (slice five packet
   * B), so "an object exists at this key" stopped being proof that the device
   * put it there. No `url` and no `token` — deliberately absent rather than
   * empty strings, so a caller cannot PUT against this answer at all, and
   * every consumer must NARROW before it reaches for one.
   *
   * `existingSize` is what the STAGED caller compares against its OWN blob:
   * equal means this really is its own copy (the retry whose markTakeStaged
   * was lost), and ONLY that adopts the key. `null` means storage answered
   * without a size, which proves nothing and must never be adopted.
   *
   * ⚖ ON THE TAKE ARM IT IS DIAGNOSTIC ONLY (hotfix 2026-09-05). The client
   * does not compare it and must not: a take's key is reserved on the
   * caller's OWN row, and FINALIZE re-proves the object's size server-side
   * against the row it is handed — when storage reports one; a `size_unknown`
   * answer there still proceeds, just with `size_verified: false` — a second
   * proof the staged and segment consumers do not have. So this arm's `null`
   * costs nothing there.
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

/**
 * ONE segment's answer — the same two arms the take mint's success side has,
 * and for the same reason (fix round 2, ⚖ R2).
 *
 * The signed arm carries a `url` and its bare `token`; the already-there arm
 * carries NEITHER — deliberately absent rather than empty, so nothing reachable
 * from that answer can PUT, and every consumer must NARROW before it reaches
 * for one. `existingSize` is the only thing on it that means anything: the
 * device compares it against its OWN segment blob's length, and adopts the seq
 * only when the two agree.
 */
export type MintedSegment =
  | { seq: number; path: string; url: string; token: string; contentType: string }
  | { seq: number; path: string; contentType: string; existingSize: number | null }

export type MintSegmentUrlsResult =
  | { segments: MintedSegment[]; recordingSessionId: string }
  | {
      error:
        | 'bad_input'
        | 'bad_mime'
        | 'bad_take_id'
        | 'forbidden'
        | 'not_found'
        /** ⚖ THE ROW HAS NOT RESERVED THIS TAKE. Terminal for segments on the
         *  device side (TERMINAL_SECURE_ERRORS already holds the code — it is
         *  finalize's own twin), and the fence the whole segment door rests on. */
        | 'not_reserved'
        | 'upstream'
    }

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
 * it proves nothing, and no caller may adopt on it.
 *
 * ⚖ WHAT `size: null` COSTS IS THE CALLER'S CALL, and the two differ on purpose
 * (packet C fix round 1, K6). For the STAGED caller it is a MISMATCH: that port
 * refuses, the take stays unstaged, and the next mount tries again at the cost
 * of one JSON call. For the SEGMENT caller it is a RETRYABLE FAILURE — a
 * backoff, never `seg_mismatch` — because there the mark is terminal for the
 * take's whole life, and a storage version that stopped reporting sizes would
 * otherwise switch every take's pump off fleet-wide on a fact about the API
 * rather than about anybody's audio. For the TAKE arm's retry exit (hotfix
 * 2026-09-05) it costs NOTHING at all: the value is diagnostic only there, and
 * finalize re-proves the size server-side regardless of what this read said.
 * Finalize splits the same two off this same read (`size_unknown` vs
 * `size_mismatch`).
 *
 * ONE `info()` READ IN THIS FILE: objectExists below is this function with the
 * size dropped, so the two questions can never drift into two probes.
 */
export async function objectSize(
  key: string,
): Promise<{ exists: true; size: number | null } | { exists: false } | 'unknown'> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from('recordings').info(key)
  if (error) {
    if (isStorageNotFound(error)) return { exists: false }
    warnStorageUnknown('objectSize', error)
    return 'unknown'
  }
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
 * eventually drift from. One home, three callers (the hotfix took
 * planReservation off this list — it now reads objectSize directly).
 */
export async function objectExists(key: string): Promise<boolean | 'unknown'> {
  const answer = await objectSize(key)
  return answer === 'unknown' ? 'unknown' : answer.exists
}

type ReservationPlan =
  | { kind: 'update'; row: Recording }
  /** ⚖ THE PROBE'S ANSWER IS KEPT (hotfix 2026-09-05). A retry plan used to
   *  throw away what storage had just said, so the take arm signed over an
   *  object that was already there — and a non-upsert sign IS a create, which
   *  storage refuses. `existing` carries that answer to the one caller that
   *  has to branch on it. */
  | {
      kind: 'retry'
      row: Recording
      existing: { exists: true; size: number | null } | { exists: false }
    }

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
  // objectSize, not objectExists: the SIZE half is what the retry exit below
  // answers with. ⚠ It is an OBJECT — `{ exists: false }` is truthy, so the
  // refusal has to read the field, never the answer itself.
  const probe = await objectSize(key)
  if (probe === 'unknown') return { error: 'upstream' }
  if (probe.exists && pointer === null) return { error: 'exists' }

  // LEGACY ONLY (fix round 10): a row minted before sessions were born reserved.
  // Every row this app version creates for a client-named take already carries
  // its key, and lands on the retry exit below instead.
  if (pointer === null) return { kind: 'update', row }
  // ALREADY OURS. Either the ordinary path now (the row was BORN with this key,
  // fix round 10) or the legitimate retry (the PUT landed, the answer was lost):
  // the binding is already exactly what this call would write, so commit writes
  // nothing and audits nothing.
  return { kind: 'retry', row, existing: probe }
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
  where: 'staged' | 'take-server-named' | 'take' | 'segment',
): Promise<SignedUpload | { error: 'upstream' }> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from('recordings')
    .createSignedUploadUrl(composed.key)

  if (error || !data?.signedUrl) {
    // THE ALARM THIS DOOR LACKED (hotfix 2026-09-05). A silent 'upstream' here
    // is what hid the missing already-there arm for a day: every refused sign
    // became a facade 502 with nothing in the logs saying why. House style =
    // take-binding's own `storage_probe_unknown` line (one JSON object,
    // status/flags only — never the raw message, which embeds the key).
    // `where` names WHICH of the four call sites refused, mirroring
    // warnStorageUnknown's own `where` argument (take-binding.ts).
    const e = (error ?? {}) as { status?: unknown; statusCode?: unknown }
    console.warn(
      JSON.stringify({
        evt: 'sign_upload_refused',
        where,
        status: e.status,
        statusCode: e.statusCode,
        messageKind: storageMessageKind(error),
      }),
    )
    return { error: 'upstream' }
  }
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
 * The legitimate retry (the PUT landed, the finalize call was lost) is
 * answered BEFORE anything is signed (hotfix 2026-09-05): the sign is itself a
 * create, so storage refuses it for a key that already holds bytes and the
 * take could never be finalized at all. This door now takes the already-there
 * exit below — no url, nothing to PUT — and the client goes straight to
 * finalize, which verifies size and ownership. A 409 at a freshly signed PUT
 * remains a race this probe did not see a moment earlier, and the client still
 * reads it as the landing it is.
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
  // record onto it — and since fix round 4 (G2) that proof is STRICTER than the
  // take mint's: the caller must BE the recorder, view-all included out. The
  // client is tenant-scoped, so another business's session is not found at all.
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
    // ⚖ AND ONLY THE RECORDER THEMSELVES MAY STAGE (slice five fix round 4,
    // G2). `assertRecorderOwnsRow` admits the OWNER'S HAND (holdsOwnerKeys —
    // business.manage AND recordings.viewAll), which is right for the TAKE mint
    // — an owner reserving a colleague's take is a designed act there — and
    // wrong here. Staging is something the RECORDER'S OWN
    // DEVICE does: the discard word-collection reads the owner-gated take store
    // and nothing else in the app stages at all, so view-all has no legitimate
    // reach through this door. What it had instead was a lever: the staged key
    // is deterministic and immutable, so a view-all holder could mint a
    // colleague's key first, PUT anything, and that colleague's device would
    // meet a size mismatch for ever — its discard's words never landing, its
    // device copy never releasable. A plain equality, `holdsOwnerKeys`
    // deliberately not consulted; the tenant half stays where it is, one line
    // above.
    //
    // ⚖ THE CEILING, NAMED (P3, record only): the recorder can still pre-fill
    // their OWN session's key from outside the app. No audio is lost — the
    // device keeps it — and the only thing denied is that staffer's own
    // discard's words. Self-harm, out of this door's reach.
    if (row.staff_id !== actor.staffId) return { error: 'forbidden' }
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
    // (Round 3 named a residual ceiling here — a view-all holder pre-filling a
    // colleague's OWN take's key, where both halves are legitimate and this
    // fence cannot see the difference. Fix round 4's G2 above CLOSED it at the
    // door instead: view-all no longer reaches this branch at all.)
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
    const signed = await signUpload(composed, 'staged')
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
    const signed = await signUpload(composed, 'take-server-named')
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

  // ⚖ THE OBJECT IS ALREADY THERE, AND IT IS THIS ROW'S OWN (hotfix
  // 2026-09-05). The pointer named this exact key and storage holds it: the
  // PUT landed and only the finalize was lost. Signing here is what stranded
  // such a take for ever — a non-upsert sign is a CREATE, and the unique
  // (bucket_id, name) refuses it, so the door answered a silent 'upstream' on
  // every retry. There is nothing left to do: a 'retry' plan writes nothing at
  // commit (the pointer is already this key) and audits nothing, so the exit
  // loses none of the reservation the signed arm would have made — `plan.row.id`
  // is the same id it returns. The segment arm and the staged arm have had this
  // exit since fix round 2; the take arm was the one door without it.
  //
  // GIVEN UP ON PURPOSE: commitReservation's own re-reservation of a pointer
  // CLEARED between plan and commit (fix round 9, above) never runs on this
  // exit — no app code clears audio_storage_path, so that window is not one
  // this retry can meet, and a pointer that somehow WAS cleared would surface
  // as `not_reserved` at finalize rather than silently re-binding here.
  if (plan.kind === 'retry' && plan.existing.exists)
    return {
      path: composed.key,
      contentType: composed.contentType,
      recordingSessionId: plan.row.id,
      existingSize: plan.existing.size,
    }

  const signed = await signUpload(composed, 'take')
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

/** How many segment keys the door probes and signs at once (fix round 2, M2).
 *  Eight: enough that a full 60-seq catch-up is ~8 waves rather than 60, and
 *  small enough that one client's catch-up cannot open sixty sockets to storage
 *  at once. */
const SEGMENT_MINT_CONCURRENCY = 8

/** ONE segment key: does storage already hold it, and if not, a signed URL for
 *  it. Lifted out of the loop so the waves above can run it in parallel; the
 *  body is exactly what ran serially before — the probe first, `unknown` fails
 *  CLOSED, an object that exists comes back as a SIZE and is never signed over. */
async function mintOneSegment(one: {
  key: string
  ext: string
  contentType: string
  seq: number
}): Promise<MintedSegment | { error: 'upstream' }> {
  // Existence answered BEFORE anything is signed, with the shared single-object
  // read the staged mint uses (objectSize — ONE spelling in this file, so the
  // two questions can never drift into two probes).
  const existing = await objectSize(one.key)
  // Storage did not answer. Retryable, and nothing is signed meanwhile — the
  // same posture both of the other acts take.
  if (existing === 'unknown') return { error: 'upstream' }
  if (existing.exists)
    return {
      seq: one.seq,
      path: one.key,
      contentType: one.contentType,
      existingSize: existing.size,
    }
  const signed = await signUpload(one, 'segment')
  if ('error' in signed) return signed
  return { seq: one.seq, ...signed }
}

/**
 * Mint signed UPLOAD urls for a BATCH of this take's SEGMENTS — the bytes that
 * reach the server while the recording is still running (slice five packet C,
 * D6; design v2 items 2 + 4, design v1 §3 R1).
 *
 * ONE DOOR, ONE MORE SHAPE. This is the same door the whole-take mint uses, the
 * same parse, the same actor and the same fences — but it is the only act of the
 * three that RESERVES NOTHING, WRITES NOTHING AND AUDITS NOTHING. That is not an
 * omission: a segment hangs under a take whose key the row has ALREADY reserved,
 * so there is nothing left to bind, and the audited act is the FINALIZE at the
 * end of the take (⚖ 8/17 doc law — one core write, one audit row; a per-segment
 * row every 5 s would buy nothing the reserved pointer does not already say).
 *
 * ⚖ THE FENCE IS THE ROW'S OWN POINTER. `row.audio_storage_path` must equal
 * THIS take's composed key, or nothing is signed (`not_reserved`). It replaces
 * the reservation this door does not make:
 *   · an UNBOUND row is the whole-take mint's job at stop, not this one's —
 *     this door must never be the thing that binds a take;
 *   · a row bound to ANOTHER take is not this take's row at all, and signing
 *     segments under this take's folder against it would put a second take's
 *     fragments where the assembler will one day look for the first's.
 * `not_reserved` is TERMINAL on the device side (TERMINAL_SECURE_ERRORS), which
 * is right: the binding does not change because time passed. The take is not
 * lost by it — it is secured WHOLE at stop by the independent secure-take path,
 * which is the guarantee that supersedes every segment here.
 *
 * ⚖ NO UPSERT, AND "ALREADY THERE" IS NEVER ADOPTED ON ITS OWN (V2.1 + the R2
 * amendment that packet B's fix round 2 established for the staged path). A
 * segment key is COMPOSABLE IN ADVANCE — anyone who knows the take id can spell
 * it — so an object existing at one says nothing about who wrote it. And the
 * assembler will one day build a take FROM THESE OBJECTS, which is exactly the
 * consequence a pre-filled segment must never reach: bytes nobody recorded,
 * standing in for the device's own, inside evidence.
 *
 * So this door PROBES each requested seq BEFORE it signs, and answers the
 * object's SIZE instead of a URL when one is there. The device adopts such a seq
 * only when that length is its own segment blob's — the one fact a caller who
 * never held the recording cannot forge — and treats anything else as a
 * mismatch. Nothing is signed on that arm, so the answer hands out no way to
 * write; and on the arms that ARE signed a 409 at the PUT is a failure again,
 * because it is a race this probe did not see a moment earlier.
 *
 * The probes and the signings run in WAVES of SEGMENT_MINT_CONCURRENCY (fix
 * round 2, M2), so a full batch of 60 is about eight waves of two storage calls
 * rather than 120 round trips in a row — comfortably inside the caller's door
 * deadline (30 s on the phone), which serial was not. That deadline is the
 * offline-catch-up shape, not the steady one: while recording, the pump asks
 * for a single seq every ~5 s. And the device carries a belt of its own for the
 * day this is still too slow — segment-uploader's `batchAsk` halves the next
 * ask on `upstream`, down to a single seq, so a catch-up always converges on a
 * batch the door can carry.
 */
export async function mintSegmentUploadUrls(
  synqed: Core,
  actor: MintTakeActor,
  rawInput: MintTakeUrlInput,
): Promise<MintSegmentUrlsResult> {
  // THE parse, for BOTH doors — the same first line, and for the same reason,
  // as the whole-take mint above: the web action's argument is caller-supplied
  // JSON however it is typed. The schema's own rules already say a `seqs` body
  // carries takeId + mimeType + recordingSessionId and never `stagedFor`; a
  // body with no `seqs` at all is not this act and is refused here rather than
  // quietly minting something else.
  const parsed = UploadUrlMintSchema.safeParse(rawInput)
  if (!parsed.success) return { error: 'bad_input' }
  const input = parsed.data
  if (!input.seqs || input.seqs.length === 0) return { error: 'bad_input' }

  // Nothing to attribute these bytes to — the take mint's own first refusal,
  // asked before anything is composed or read.
  if (!actor.staffId) return { error: 'forbidden' }

  // Re-narrowed here rather than leaned on: the schema's pair rules are zod
  // refines, invisible to the compiler, and a fence that trusts a clause it
  // cannot see is one edit away from being gone.
  const takeId = input.takeId
  const mimeType = input.mimeType
  const recordingSessionId = input.recordingSessionId
  if (!takeId || !mimeType || !recordingSessionId) return { error: 'bad_input' }

  const businessId = actor.businessId
  let takeKey: string
  let composedSegments: { key: string; ext: string; contentType: string; seq: number }[]
  try {
    // The two refusals are SPLIT exactly as the take mint splits them, so a
    // client that sent a container this server does not store can renegotiate
    // instead of retrying an id that was never the problem.
    if (composeTakeKey(businessId, takeId, DEFAULT_MIME) === null) return { error: 'bad_take_id' }
    const composedTake = composeTakeKey(businessId, takeId, mimeType)
    if (composedTake === null) return { error: 'bad_mime' }
    takeKey = composedTake.key
    const composed: typeof composedSegments = []
    for (const seq of input.seqs) {
      // The schema already bounded every seq, so a null here can only be a
      // container the segment composer refuses that the take composer took —
      // impossible with one closed map, and still answered rather than assumed.
      const one = composeSegmentKey(businessId, takeId, seq, mimeType)
      if (one === null) return { error: 'bad_input' }
      composed.push(one)
    }
    composedSegments = composed
  } catch (err) {
    // Either composer THROWS when its own output fails the grammar — a DRIFT
    // bug between composer and parser, never caller input (every field is
    // validated above it). Caught at the choke point both doors share, so a
    // 'use server' export answers a settled retryable code instead of a 500.
    console.warn('[mint-take-url] segment key composition failed its own grammar:', err)
    return { error: 'upstream' }
  }

  let row: Recording
  try {
    row = await synqed.recordings.get(recordingSessionId)
  } catch (err) {
    // A session id core does not know is the client's error — never a
    // replacement minted for it, exactly as the take mint refuses.
    if (statusOf(err) === 404) return { error: 'not_found' }
    console.warn('[mint-take-url] segment session read failed:', err)
    return { error: 'upstream' }
  }
  const denied = assertRecorderOwnsRow(row, actor)
  if (denied) return denied
  // ⚖ AND ONLY THE RECORDER THEMSELVES MAY SEND SEGMENTS (fix round 1, K1 —
  // the staged door's own line, five hundred lines up, for the same reason).
  // `assertRecorderOwnsRow` admits the OWNER'S HAND (holdsOwnerKeys —
  // business.manage AND recordings.viewAll), which is right for the TAKE mint —
  // an owner reserving a colleague's take is a designed act there, and finalize
  // re-proves ownership and byte length behind it. Here it is
  // wrong twice over. Nothing in the app pumps segments for a take it does not
  // hold: the pump runs on the RECORDING DEVICE, off the owner-gated take
  // store, and it is the only caller — so view-all buys this door no legitimate
  // reach at all. What it did buy was a lever: a segment key is composable in
  // advance (the take id and the container are both readable off the
  // colleague's own row, by exactly this capability), so an owner could mint a
  // seq the device had not reached yet and PUT anything into it. The key is
  // immutable, so the real device could never write that seq again; its next
  // pump would meet a length that is not its own and go terminally quiet for
  // the rest of the take; and the folder an assembler will one day build from
  // would hold bytes nobody recorded. A plain equality, `holdsOwnerKeys`
  // deliberately not consulted; the tenant half stays where it is, one line
  // above.
  //
  // ⚖ THE CEILING, NAMED (P3, record only): the recorder can still pre-fill
  // their OWN take's segment keys from outside the app. No audio is lost — the
  // take secures whole at stop regardless — and the only thing denied is that
  // staffer's own head start. Self-harm, out of this door's reach.
  if (row.staff_id !== actor.staffId) return { error: 'forbidden' }

  // ⚖ THE FENCE (see the docblock). Asked AFTER ownership, so a caller who may
  // not record onto this row never learns anything about what it points at.
  if (row.audio_storage_path !== takeKey) return { error: 'not_reserved' }

  // ⚖ BOUNDED PARALLEL, BECAUSE THE BATCH HAS TO FIT THE DOOR (fix round 2,
  // M2). One seq is two storage calls, and sixty of them run one after another
  // is up to 120 round trips: at ordinary storage latency that is past the
  // CALLER's 30 s door (thin `doorFetch`, web `withDeadline`), so the whole
  // answer is thrown away, no prefix advances, and the pump asks for the same
  // sixty again for as long as the latency lasts — an offline recording that
  // can never catch up. In waves of SEGMENT_MINT_CONCURRENCY the worst case is
  // ~8 waves × 2 calls, a few seconds, comfortably inside the door.
  //
  // The ANSWER stays in seq order (the waves are consumed in order, and each
  // wave in its own), and the refusals are unchanged: the first seq in order
  // that could not be probed or signed ends the whole call — nothing is
  // half-minted, and a wave that was already in flight beside it has only read
  // and signed, never written.
  const segments: MintedSegment[] = []
  for (let i = 0; i < composedSegments.length; i += SEGMENT_MINT_CONCURRENCY) {
    const wave = await Promise.all(
      composedSegments.slice(i, i + SEGMENT_MINT_CONCURRENCY).map(mintOneSegment),
    )
    for (const answer of wave) {
      if ('error' in answer) return answer
      segments.push(answer)
    }
  }

  // The row is named back the way the take mint names it: the caller stamps
  // nothing new here (the take already carries this id), but an answer that did
  // not say which row it was fenced against would be a fact the client cannot
  // check.
  return { segments, recordingSessionId }
}
