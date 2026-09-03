// "This take is complete" — the ONE server body that turns an uploaded object
// into a fact on the core recording row (capture pipeline PR2, design R4/R8,
// ⚖ v2 items 2, 11, 13).
//
// WHY IT EXISTS. Today the app NEVER writes `audio_storage_path`: the audio's
// only durable link to its session is the job payload, so a take that is never
// enqueued (破棄, a kill, 録音を使用 never tapped) has no server-side record
// that its audio exists at all. Finalize is the moment the audio becomes SAFE,
// and it happens at stop — before any 結果 dialog, before consent, before the
// karute exists.
//
// NO 'use server' directive, deliberately — same rule as discard.ts and
// session-cleanup.ts: `actor` is the authenticated identity the CALLER
// resolved and vouches for. As a server action a caller could supply its own.
//
// ONE choke point, two doors: the web action (src/actions/recordings.ts) and
// the facade route (…/recordings/finalize). Both resolve the actor their own
// way and share this body, so the phone and the web page cannot drift into
// different finalize semantics. FACADE_AUDIT_MAP['recordings.finalize'] is
// therefore a deliberate 'skip' citing this function — one finalize, at most
// one audit row.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import { composeTakeKey, parseRecordingKey } from '@/lib/recording/key-grammar'
import { FinalizeTakeSchema } from '@/lib/app-api/record-schemas'

type Core = Pick<SynqedClient, 'recordings'>

/** Statuses the job pipeline owns. Finalize NEVER regresses one of these — a
 *  COMPLETED take that gets re-finalized by a late drain must not go back to
 *  UPLOADING and re-enter 要対応. */
const TERMINAL = new Set(['COMPLETED', 'FAILED'])

export interface FinalizeTakeActor {
  /** The AUTHENTICATED staff identity, resolved by the caller and NEVER read
   *  from a request body. Same id space recordings.create stamps on staff_id
   *  (auth user id on both surfaces — getCurrentUserStaffId / resolveSelfStaffId). */
  staffId: string | null
  /** The caller's verified tenant — the prefix the composed key must carry. */
  businessId: string
  /** Store for a row this call MINTS. Same source recording-jobs.ts's payload
   *  uses (resolveStoreScope on web, resolveStoreForRequest on the facade). */
  storeId: string | null
  /** Holds `recordings.viewAll` (owner-only). Lets a manager finalize a take
   *  recorded on another staffer's session; everyone else is own-session only. */
  canViewAll: boolean
  source: 'web' | 'facade'
  requestId?: string
}

export interface FinalizeTakeInput {
  takeId: string
  mimeType: string
  durationSeconds: number
  byteLength: number
  /** The session minted at record-start, when there is one. Absent (walk-in,
   *  a failed mint, a drained take from a killed app) → the row is minted HERE. */
  recordingSessionId?: string | null
}

/**
 * `already: true` means this call wrote NOTHING because the row already
 * carries a finalized pointer — an exact retry, or a terminal take whose
 * pointer must not be clobbered. A settled success either way, and it emits no
 * second audit row for one act.
 */
export type FinalizeTakeResult =
  | { ok: true; recordingSessionId: string; already?: true }
  | {
      error:
        | 'bad_input'
        | 'forbidden'
        | 'not_found'
        | 'object_missing'
        | 'size_mismatch'
        | 'busy'
        | 'failed'
    }

/** Core's HTTP status, duck-typed — the same structural check the rest of this
 *  family uses rather than an instanceof across module instances. */
function statusOf(err: unknown): number | undefined {
  return err && typeof err === 'object' && 'status' in err
    ? ((err as { status?: unknown }).status as number | undefined)
    : undefined
}

/**
 * Does the object this take claims actually exist, and is it the size claimed?
 *
 * `info()` (storage-js 2.99) is the CHEAPEST honest read: one GET
 * /object/info/<bucket>/<key> for the ONE key, carrying `size`. `list('', {
 * search })` would page the bucket ROOT — the sweep's whole world, ~thousands
 * of objects — to answer a single-object question, and `createSignedUrl` mints
 * a credential as a side effect of asking.
 *
 * Returns the byte verdict rather than throwing: a missing object is the
 * ordinary "the PUT has not landed yet" case the drain retries.
 */
async function objectVerdict(
  key: string,
  byteLength: number,
): Promise<'ok' | 'missing' | 'size_mismatch' | 'size_unknown' | 'unknown'> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from('recordings').info(key)
  // A 500, a timeout, a bad credential: storage did not ANSWER the question.
  // Reading that as 'missing' would tell the client its audio is gone and stop
  // the retry — the one wrong thing to say when we simply do not know.
  if (error) return isNotFound(error) ? 'missing' : 'unknown'
  if (!data) return 'missing'
  if (typeof data.size !== 'number') return 'size_unknown'
  return data.size === byteLength ? 'ok' : 'size_mismatch'
}

/** Storage's "no such object" — the ordinary "the PUT has not landed yet" case.
 *  storage-js answers a missing key with 404; the message text is the fallback
 *  for the shapes that carry no status. */
function isNotFound(error: unknown): boolean {
  if (statusOf(error) === 404) return true
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && /not found/i.test(message)
}

/**
 * Write the take's audio location, duration and status onto its core row.
 *
 * ORDER IS THE FENCE. The key is composed from the caller's take id and
 * container and re-parsed against the grammar (composeTakeKey) BEFORE the
 * service-role storage client is touched; the session row's ownership is
 * proved BEFORE anything is written to it. Nothing here deletes.
 *
 * PROCESSING is deliberately never WRITTEN: that status means "a job is
 * running" and belongs to enqueue (PR3/PR4). Finalize says UPLOADING — the
 * audio is on the server, nothing is processing it yet — and a row that is
 * ALREADY PROCESSING keeps its own status: it gets the pointer alone.
 */
export async function finalizeTakeWithClient(
  synqed: Core,
  actor: FinalizeTakeActor,
  rawInput: FinalizeTakeInput,
): Promise<FinalizeTakeResult> {
  // THE parse, for BOTH doors. The web action is a server action, so its
  // argument is caller-supplied JSON however it is typed — parsing here (not
  // at each door) is what makes the two doors refuse the same bodies, and it
  // is the FIRST line so no unvalidated number or id gets any further.
  const parsed = FinalizeTakeSchema.safeParse(rawInput)
  if (!parsed.success) return { error: 'bad_input' }
  const input = parsed.data

  // Nothing to attribute a recording to, so nothing may be written. Ahead of
  // the key work because it costs nothing and settles the caller.
  if (!actor.staffId) return { error: 'forbidden' }

  const composed = composeTakeKey(actor.businessId, input.takeId, input.mimeType)
  if (composed === null) return { error: 'bad_input' }
  const key = composed.key

  try {
    const verdict = await objectVerdict(key, input.byteLength)
    // The take says it is complete; the bucket says there is nothing there.
    // Refusing keeps a pointer to a non-existent object off the core row.
    if (verdict === 'missing') return { error: 'object_missing' }
    if (verdict === 'size_mismatch') return { error: 'size_mismatch' }
    // Storage could not answer. Retryable, and nothing is written meanwhile.
    if (verdict === 'unknown') return { error: 'failed' }

    let row: Recording | null = null
    // The row's pointer BEFORE this write, for the audit trail below — only
    // ever set when a session row was actually read (never for a minted row,
    // which has no prior pointer to have replaced).
    let priorPointer: string | null = null
    if (input.recordingSessionId) {
      try {
        row = await synqed.recordings.get(input.recordingSessionId)
      } catch (err) {
        if (statusOf(err) === 404) return { error: 'not_found' }
        throw err
      }
      // Core's GET is BUSINESS-scoped only, so both halves are checked here:
      // the tenant (belt — the client is already business-scoped) and the
      // recorder. A staffer may finalize their OWN session; only an owner
      // (recordings.viewAll) may finalize a colleague's.
      if (row.business_id !== actor.businessId) return { error: 'forbidden' }
      if (row.staff_id !== actor.staffId && !actor.canViewAll) return { error: 'forbidden' }

      // IDEMPOTENT, read-before-write: an exact retry writes nothing, and a
      // take the job pipeline already finished keeps the pointer it has.
      const pointer = row.audio_storage_path
      priorPointer = pointer
      if (pointer === key) return { ok: true, recordingSessionId: row.id, already: true }
      // A job is PROCESSING the object the row already points at — that job
      // never saw the new object, so overwriting the pointer mid-job would
      // leave the row pointing at audio no job transcribed. Retryable: the
      // drain tries again once the job settles.
      if (row.status === 'PROCESSING' && pointer !== null) return { error: 'busy' }
      if (pointer !== null && TERMINAL.has(row.status)) {
        return { ok: true, recordingSessionId: row.id, already: true }
      }
    }

    const durationSeconds = Math.floor(input.durationSeconds)
    // ⚖ v2 item 11: finalize MINTS the row when the take carries none — the
    // record-start mint is fire-and-forget today, so a take whose mint failed
    // (or never ran) must still get its audio recorded rather than be dropped.
    if (row === null) {
      row = await synqed.recordings.create({
        staff_id: actor.staffId,
        store_id: actor.storeId,
        customer_id: null,
        audio_storage_path: key,
        duration_seconds: durationSeconds,
        status: 'UPLOADING',
      })
    } else if (row.status === 'PROCESSING' || TERMINAL.has(row.status)) {
      // A NULL pointer on a row a job owns (PROCESSING here — a differing
      // pointer already left as `busy` above — or a finished COMPLETED/FAILED):
      // the audio location is the one fact still missing, and adding it
      // regresses nothing. Status and duration belong to that running or
      // finished job, never to us — writing UPLOADING over PROCESSING would
      // put a live take back into 要対応 mid-transcription.
      await synqed.recordings.update(row.id, { audio_storage_path: key })
    } else {
      await synqed.recordings.update(row.id, {
        audio_storage_path: key,
        // ⚖ v2 item 13: iOS fMP4 reports duration 0, so the player needs the
        // recorder's own measurement written here.
        duration_seconds: durationSeconds,
        status: 'UPLOADING',
      })
    }

    // A pointer replaced by THIS write, so the take it displaced stays
    // findable from the audit trail even after this row's pointer moves on —
    // only when the prior pointer was both real and a different object.
    const pointerReplaced = priorPointer !== null && priorPointer !== key

    // ⚖ 8/17 doc law — IDS, NUMBERS AND FLAGS ONLY. No key, no path, no
    // customer: the storage key embeds the take id, which the ids below
    // already carry honestly.
    audit({
      category: 'recording',
      action: 'recording.capture_finalized',
      actorId: actor.staffId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'recording',
      targetId: row.id,
      severity: 'notice',
      detail: {
        recording_session_id: input.recordingSessionId ?? null,
        minted_row: !input.recordingSessionId,
        take_id: input.takeId,
        ...(pointerReplaced
          ? { replaced_take_id: parseRecordingKey(priorPointer, actor.businessId)?.takeId ?? null }
          : {}),
        bytes: input.byteLength,
        duration_seconds: durationSeconds,
        ext: composed.ext,
        // Honest about what was actually proved: the listing did not carry a
        // size, so the byte match below is unverified for this row.
        size_verified: verdict === 'ok',
      },
      requestId: actor.requestId,
      source: actor.source,
    })
    return { ok: true, recordingSessionId: row.id }
  } catch (err) {
    console.warn('[finalize-take] failed:', err)
    return { error: 'failed' }
  }
}
