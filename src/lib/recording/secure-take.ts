'use client'

// "Make this take SAFE" — the client half of the capture pipeline (design R4/R6,
// ⚖ v2 items 1, 2, 12, 13).
//
// WHAT CHANGED. Until now audio left the device only after 録音を使用 and the
// 結果 dialog (durability trace §3), so a take that was never used — a kill, a
// 破棄, a staffer who simply walked away — existed nowhere but the phone. This
// runs at STOP instead: the whole take goes to its finalized key, the finalize
// door writes audio_storage_path/duration onto the core row, and the take is
// marked. Nothing here deletes, and the staged upload + job path are untouched
// (two copies briefly, by design).
//
// WHAT CHANGED AGAIN (fix round 4). The MINT binds now: it reserves this
// take's key on the recorder's own row before it signs anything, and answers
// with the row it bound. So the session id is settled BEFORE the PUT — because
// a kill between the PUT and the finalize must not leave uploaded audio with no
// way back to its row. And the mint's refusals are ANSWERS now, not throws:
// `exists` / `reserved_elsewhere` mean this take is spoken for and no retry
// helps.
//
// AND ONCE MORE (fix round 6). A take now gets its ROW first, from the session
// door — the same one the recorder's start-mint uses — and only then knocks on
// the mint. The mint stopped creating rows for client-named takes (PR2 fix
// round 7): a create whose response was lost orphaned a row the retry could
// not name. Two paths can therefore mint a take's session — the recorder's
// (start, or retryRecordingSessionMint) and this one — but never both: each
// reads the stamp on the take before it issues anything.
//
// A take is secured only once a recorder has MEASURED it (fix round 6, P1): a
// stop off-page leaves no live recorder for the isActive belt to ask, and
// sealing the segments flushed so far under the immutable key would truncate
// the tail still being written. `durationMs` (stamped at onstop) or the stop
// path's own argument is that proof.
//
// AND NO CALL WAITS FOREVER (fix round 7, P1). A phone that walks out of
// signal does not fail its requests — it STALLS them, and a stalled PUT held
// the take in `inFlight` for the whole page lifetime: the stop path was gone,
// every mount retry hit the guard and returned, and the sequential drain below
// never reached its second take. So the PUT carries a deadline (its own size
// at ~50 KB/s, floor 60 s — a 2 h take on slow cellular must still be allowed
// to finish), and the phone's three doors carry a 30 s one of their own
// (thin/ports/recording.vite.ts). A deadline lands as a RETRYABLE code and the
// loop moves on. The web arm's doors are server actions — no signal reaches
// them; they are bounded by the platform's own function timeout.
//
// IT IS A HINT, NEVER A GUARANTEE (⚖ v2 item 2). Phase `recorded` renders
// before this is called and never waits on it; an offline stop simply records
// its failure on the take meta and the record page's mount retry — PR5's launch
// drain in full — finishes it later. So: never throws, never blocks, and every
// exit leaves the take either finalized or plainly un-finalized.

import type { RecordingPipelinePort } from '@/lib/ports/recording-port'
import {
  loadTakeBlob,
  markTakeFinalized,
  markTakeSecureError,
  readTakeSecureMeta,
  stampTakeSession,
  TERMINAL_SECURE_ERRORS,
} from '@/lib/karute/take-store'

/** Takes stamped before the recorder persisted its negotiated container. The
 *  same default the mint applies server-side with no client input. */
const DEFAULT_MIME = 'audio/webm'

/** One attempt per take at a time. The stop path and the mount retry can both
 *  name the same take (a stop that failed offline, recovered on the next
 *  mount); without this they would PUT the same object twice concurrently and
 *  race each other's finalize. Module-level because the two callers share no
 *  object — the recorder singleton and a React effect. */
const inFlight = new Set<string>()

/** The PUT's deadline, in ms: this take's own bytes at ~50 KB/s, never under a
 *  minute. A FLAT timeout cannot work here — a take is the whole recording, so
 *  the same number that mercy-kills a stalled 2 MB upload would cut a 90-minute
 *  one off mid-flight on salon wifi. Generous by design: this exists to release
 *  a socket that will never answer, not to police slow ones. */
const PUT_FLOOR_MS = 60_000
const PUT_BYTES_PER_MS = 50 // ≈50 KB/s
const putDeadlineMs = (bytes: number) =>
  Math.max(PUT_FLOOR_MS, Math.ceil(bytes / PUT_BYTES_PER_MS))

/**
 * Upload the whole take to its finalized key and tell the server it is complete.
 *
 * @param durationSeconds the recorder's OWN measurement, when a caller has one
 *   (it subtracts paused time, and iOS fMP4 reports duration 0 — ⚖ v2 item 13).
 *   Omitted (the retry path, which has no recorder), the value the recorder
 *   STAMPED at stop stands in — and a take carrying neither is not one a
 *   recorder has finished, so it is not secured at all (fix round 6).
 * @param isActive answers "is this take the one you are CAPTURING right now?"
 *   — passed by callers that share a runtime with the recorder singleton
 *   (globalRecorder.isActiveTake). A caller with no recorder at all (PR5's
 *   launch drain in the native shell, where the single webview has just
 *   started) passes nothing rather than inventing a `() => false` that would
 *   read like a check it never made.
 */
export async function secureTake(
  port: RecordingPipelinePort,
  takeId: string,
  durationSeconds?: number,
  isActive?: (takeId: string) => boolean,
): Promise<void> {
  // ⚖ NEVER FINALIZE A LIVE TAKE (fix round 5) — the belt behind the drain's
  // stopped-only filter. Finalizing a take that is still recording (or paused
  // mid-session) would seal the segments flushed so far under the IMMUTABLE
  // finalized key, so the rest of the recording could never land. The drain
  // reads the stop stamp off disk; this reads the recorder itself, which is the
  // only thing that can answer for a take whose stamp is somehow already there.
  // Return, mark NOTHING: there is no failure here, just a take that is not
  // ready — the stop path will call this again in a moment.
  if (isActive?.(takeId)) return
  if (inFlight.has(takeId)) return
  inFlight.add(takeId)
  try {
    const meta = await readTakeSecureMeta(takeId)
    // Gone, another staffer's, or already secured — all three mean there is
    // nothing to do, and the finalizedAt read is what makes a second call free.
    if (!meta || meta.finalizedAt) return
    // ⚖ NO STOP STAMP, NO SECURING (fix round 6) — the belt's second half.
    // isActive above can only answer for the take the recorder in THIS runtime
    // is holding; a stop that happened off-page (the staffer navigates to 記録
    // before the tail flush resolves) leaves no live recorder to ask, and
    // securing then seals the segments flushed so far under the IMMUTABLE key
    // while the tail is still being written. `durationMs` is stamped at onstop
    // and `durationSeconds` is passed only BY the stop path, so between them
    // one of the two is present exactly when a take is complete. Mark NOTHING:
    // an unfinished take has not failed at anything.
    //
    // It is also the ONLY measurement this take will ever be finalized with:
    // the flush window (updatedAt − startedAt) that used to stand in behind it
    // counted paused time as recording, and this gate made it unreachable, so
    // it is gone (fix round 7) rather than left as a floor nothing can reach.
    const measuredSeconds =
      durationSeconds ?? (meta.durationMs !== undefined ? meta.durationMs / 1000 : undefined)
    if (measuredSeconds === undefined) return
    // A refusal that can never turn into a yes — see TERMINAL_SECURE_ERRORS
    // (it lives in take-store, beside the field it judges). Read BEFORE the
    // blob so a terminal take costs one meta read, not a re-upload.
    if (meta.secureError && TERMINAL_SECURE_ERRORS.has(meta.secureError)) return
    const blob = await loadTakeBlob(takeId)
    // No segments on disk yet (a kill before the first flush, persistence
    // failed open to memory-only). Not an error, and not this PR's to fix.
    if (!blob || blob.size === 0) return

    const mimeType = meta.mimeType || DEFAULT_MIME

    // ⚖ A TAKE HAS ITS ROW BEFORE IT IS SECURED (fix round 6). The mint used to
    // create one for a take whose start-mint never landed; it does not any more
    // (PR2 fix round 7), because a create whose RESPONSE was lost left an orphan
    // row and a retry with no id to name it. Row minting has ONE home — the
    // session door the recorder's own start-mint knocks on — so this leg knocks
    // on the same one through the port, and the mint below always carries an id.
    let recordingSessionId = meta.recordingSessionId
    if (!recordingSessionId) {
      const started = await port.startSession({
        // Attributed exactly as the recorder's own start-mint would have: the
        // take remembers who the recording is for, and a row minted without
        // that is a row the karute could never be read beside.
        customerId: meta.target?.customerId ?? null,
        appointmentId: meta.target?.appointmentId ?? null,
        // The idempotency anchor (fix round 7) — one row per take, however many
        // times a lost reply sends us back here.
        takeId,
        // …and, with the container beside it, what the door composes this
        // take's finalized key from (fix round 8): the row this drain mints is
        // born pointing at the very key the mint below is about to ask for, so
        // there is no unbound window between the two calls. Same container the
        // mint is given, never a second reading of it.
        mimeType,
      })
      if (!started) {
        // RETRYABLE. The door fails OPEN by contract — an unresolvable staff, a
        // dead socket, a core 5xx all answer null — and every one of those is a
        // moment in time, so the next drain asks again.
        await markTakeSecureError(takeId, 'session')
        return
      }
      recordingSessionId = started.id
      // THE SESSION IS SETTLED BEFORE THE BYTES, and before the mint that binds
      // them: a kill anywhere after this must not leave audio (or a reserved
      // key) whose retry cannot name the row it belongs to.
      await stampTakeSession(takeId, recordingSessionId)
    }

    // The row the mint RESERVES this key on — never null now, and never
    // re-pointed from the reply: a take's row is what its discard and its
    // karute write against.
    const minted = await port.mintTakeUrl(takeId, mimeType, recordingSessionId)
    // A refusal is a settled ANSWER now, the same as finalize's. Recorded
    // verbatim: TERMINAL_SECURE_ERRORS is the one place that judges which of
    // them can ever turn into a yes.
    if ('error' in minted) {
      await markTakeSecureError(takeId, minted.error)
      return
    }

    // AbortController + a timer, not AbortSignal.timeout: that static is absent
    // from jsdom (this file's own tests) and from WebViews older than Chrome
    // 103, where it would throw a TypeError and fail every take instead of
    // saving them. A plain timer is universal — and it is the only form jest's
    // fake timers can advance, which is what makes the stall provable.
    const deadline = new AbortController()
    const putTimer = setTimeout(() => deadline.abort(), putDeadlineMs(blob.size))
    let put: Response
    try {
      put = await fetch(minted.url, {
        method: 'PUT',
        // The SERVER's content type for the key it composed, never our own guess:
        // this is where the iOS "mp4 bytes under a .webm/audio-webm label" bug
        // dies for the finalized object.
        headers: { 'content-type': minted.contentType },
        body: blob,
        // An abort throws, so a stalled upload lands in the catch below as the
        // RETRYABLE 'network' — and the finally releases this take, which is
        // what lets the drain reach the next one.
        signal: deadline.signal,
      })
    } finally {
      clearTimeout(putTimer)
    }
    // 409 IS a success. The mint no longer signs for upsert (PR2 fix round 3):
    // a finalized key is immutable evidence, so storage refusing a second PUT
    // to it is exactly right — and for us that refusal means "the object is
    // ALREADY there". That is the retry case, and the only one that reaches
    // here: an earlier PUT landed and only the finalize call was lost (a dead
    // socket, a killed app). So fall through and finalize, which re-proves the
    // byte length and the ownership before it writes anything.
    //
    // Known ceiling: if that first PUT landed with the WRONG bytes, nothing can
    // replace them under this key. Finalize refuses on the size mismatch and
    // the take surfaces as 要対応 (R10) for a human to resolve.
    if (!put.ok && put.status !== 409) {
      // Nothing is finalized against an object storage refused to take.
      await markTakeSecureError(takeId, `upload_${put.status}`)
      return
    }

    const result = await port.finalizeTake({
      takeId,
      mimeType,
      // The recorder's live measurement when this IS the stop; the one it
      // stamped at stop when this is a later retry — settled at the gate above.
      durationSeconds: Math.max(0, measuredSeconds),
      byteLength: blob.size,
      // REQUIRED by the door — the take's own row, stamped on the take before
      // the mint was even asked.
      recordingSessionId,
    })
    // `already: true` rides the ok arm on purpose — an exact retry and a take a
    // job already finished are both settled successes, not failures to re-run.
    // Nothing is stamped here: the session was settled before the mint, above.
    if ('ok' in result) await markTakeFinalized(takeId)
    else await markTakeSecureError(takeId, result.error)
  } catch (err) {
    // A dead socket, or a door that threw instead of answering. The take keeps
    // its audio and stays un-finalized, which is exactly what the retry looks
    // for. Both doors NAME their refusals in their result now, so what reaches
    // here is only what nobody could classify.
    console.warn('[secure-take] failed:', err)
    await markTakeSecureError(takeId, 'network')
  } finally {
    inFlight.delete(takeId)
  }
}
