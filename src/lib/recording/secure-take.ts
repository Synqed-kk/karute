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
// path's own argument is that proof — and, inside the single-WebView shell
// only, a take no recorder can be holding (fix round 13: the stamp is a
// best-effort write, and losing it must not lose the take). One rule, one
// home: take-store's isStoppedTake, which the drain's worklist reads too.
//
// AND NO CALL WAITS FOREVER (fix round 7, P1). A phone that walks out of
// signal does not fail its requests — it STALLS them, and a stalled PUT held
// the take in `inFlight` for the whole page lifetime: the stop path was gone,
// every mount retry hit the guard and returned, and the sequential drain below
// never reached its second take. So the PUT carries a deadline (its own size
// at ~10 KB/s, floor 60 s — a 2 h take on slow cellular must still be allowed
// to finish), and the phone's three doors carry a 30 s one of their own
// (thin/ports/recording.vite.ts). A deadline lands as a RETRYABLE code and the
// loop moves on. The web arm's doors are server actions — no signal reaches
// them, so since fix round 12 they are bounded by a Promise.race deadline
// instead (10 s / 30 s, recording-port.ts): the action may still land, but a
// hung one no longer pins this take in `inFlight` and starves the drain.
//
// IT IS A HINT, NEVER A GUARANTEE (⚖ v2 item 2). Phase `recorded` renders
// before this is called and never waits on it; an offline stop simply records
// its failure on the take meta and the record page's mount retry — PR5's launch
// drain in full — finishes it later. So: never throws, never blocks, and every
// exit leaves the take either finalized or plainly un-finalized.

import type { RecordingPipelinePort } from '@/lib/ports/recording-port'
import {
  isStoppedTake,
  loadTakeBlob,
  markTakeFinalized,
  markTakeSecureError,
  markTakeStartBoundAttempted,
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
 *  object — the recorder singleton and a React effect.
 *
 *  ITS REACH IS ONE RUNTIME, and saying so is the honest part (fix round 13).
 *  A second browser tab has its own module instance and its own set, so two
 *  tabs CAN both PUT the same take at once. That is survivable, by
 *  construction rather than by luck: the key is immutable and per-take, so the
 *  loser's PUT is refused as a duplicate (putSaysAlreadyThere below reads both
 *  shapes of that refusal), and finalize is idempotent against the same object
 *  — an exact retry answers `already`, which rides the ok arm. The cost of the
 *  race is one wasted upload, never a lost or truncated take. The single-
 *  WebView shell, which is where staff actually record, cannot have two. */
const inFlight = new Set<string>()

/** The PUT's deadline, in ms: this take's own bytes at ~10 KB/s, never under a
 *  minute. A FLAT timeout cannot work here — a take is the whole recording, so
 *  the same number that mercy-kills a stalled 2 MB upload would cut a 90-minute
 *  one off mid-flight on salon wifi. Generous by design: this exists to release
 *  a socket that will never answer, not to police slow ones. */
const PUT_FLOOR_MS = 60_000
// ≈10 KB/s — an 80 kbps floor, not a target (fix round 10, P2). 50 assumed
// 400 kbps upstream, which a phone on salon wifi or a weak cell does not have:
// a take that could not sustain it was aborted, marked retryable, and re-PUT
// FROM ZERO on the next mount, forever. The ceiling this buys is the largest
// take the recorder can produce — 2 h at 48 kbps ≈ 43 MB — finishing in ~72
// min; the 60 s floor still mercy-kills a stalled small one.
const PUT_BYTES_PER_MS = 10
const putDeadlineMs = (bytes: number) =>
  Math.max(PUT_FLOOR_MS, Math.ceil(bytes / PUT_BYTES_PER_MS))

/** "The object is ALREADY there" — the storage answer that is a SUCCESS for us
 *  (see the long note at the call site), in both shapes it arrives in.
 *
 *  Supabase's signed-upload endpoint does not always give the conflict its own
 *  status: it has answered HTTP **400** with `{"statusCode":"409","error":
 *  "Duplicate", …}` — the real code demoted into the body. Read as a plain 400
 *  that was a retryable `upload_400`, so a take whose object LANDED and whose
 *  finalize was merely lost re-PUT its whole self on every cooldown, forever,
 *  and never finalized.
 *
 *  Defensive by construction: a `clone()` so nothing downstream loses the body,
 *  and one catch for every way a body can refuse to be JSON (an HTML proxy
 *  page, an already-consumed stream, a Response-shaped test double with no
 *  clone at all). Unreadable → not a duplicate, which keeps the take retryable
 *  — the safe side. */
async function putSaysAlreadyThere(put: Response): Promise<boolean> {
  if (put.status === 409) return true
  if (put.status !== 400) return false
  try {
    const body = (await put.clone().json()) as
      | { statusCode?: unknown; error?: unknown }
      | null
    return (
      String(body?.statusCode ?? '') === '409' || /duplicate/i.test(String(body?.error ?? ''))
    )
  } catch {
    return false
  }
}

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
    // ⚖ A TAKE WHOSE TAIL NEVER LANDED IS NOT ONE TO SEAL (fix round 16). The
    // stop's final flush was skipped — the next customer's recording cleared
    // the chunks out from under it — so the disk copy is SHORT of what that
    // recorder captured, and the finalized key is immutable: the rest could
    // never land. isStoppedTake reads the same flag for the drain's worklist;
    // this is the belt for a caller that names the take directly (the stop
    // path carries its own duration and would otherwise walk straight past
    // that rule). Mark NOTHING — the take has not FAILED at anything, it is
    // simply not whole, and that is a truth for a human to act on, not an
    // error to retry against.
    if (meta.tailIncomplete) return
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
    let measuredSeconds =
      durationSeconds ?? (meta.durationMs !== undefined ? meta.durationMs / 1000 : undefined)
    // ⚖ AND ON THE NATIVE SHELL, A LOST STAMP IS NOT A LOST TAKE (fix round
    // 13). isStoppedTake is the store's own rule, read here so the belt and the
    // drain's worklist can never disagree: inside the single-WebView shell a
    // take that no live recorder is holding, has bytes, and has been quiet
    // past the grace IS a stopped take whose best-effort stamp lost its write.
    // On the web it answers false and this take is left exactly where round 5
    // left it. Only then does the flush window come back:
    //
    // ⚠ (updatedAt − startedAt) counts PAUSED time as recording, so a take
    // paused for twenty minutes finalizes twenty minutes long. It is the
    // deliberate trade — a duration that is too generous versus audio that
    // never leaves the phone — and it is reached ONLY when no recorder ever
    // stamped this take. The transcript and the karute are unaffected; the
    // number on the row is.
    if (measuredSeconds === undefined && isStoppedTake(takeId, meta, isActive))
      measuredSeconds = Math.max(0, meta.updatedAt - meta.startedAt) / 1000
    if (measuredSeconds === undefined) return
    // A refusal that can never turn into a yes — see TERMINAL_SECURE_ERRORS
    // (it lives in take-store, beside the field it judges). Read BEFORE the
    // blob so a terminal take costs one meta read, not a re-upload.
    if (meta.secureError && TERMINAL_SECURE_ERRORS.has(meta.secureError)) return
    const blob = await loadTakeBlob(takeId)
    // No segments on disk (a kill before the first flush, persistence failed
    // open to memory-only). Nothing to send, and nothing this PR can fix — but
    // it IS recorded now (fix round 13): without a mark the take carried no
    // `lastSecureAttemptAt`, so the cooldown never started and the drain re-read
    // its meta and its (empty) blob on every tick, forever. RETRYABLE on
    // purpose — bytes can still arrive from a queued flush — it just costs one
    // read a minute instead of one a tick.
    if (!blob || blob.size === 0) {
      await markTakeSecureError(takeId, 'no_segments')
      return
    }

    const mimeType = meta.mimeType || DEFAULT_MIME

    // ⚖ A TAKE HAS ITS ROW BEFORE IT IS SECURED (fix round 6). The mint used to
    // create one for a take whose start-mint never landed; it does not any more
    // (PR2 fix round 7), because a create whose RESPONSE was lost left an orphan
    // row and a retry with no id to name it. Row minting has ONE home — the
    // session door the recorder's own start-mint knocks on — so this leg knocks
    // on the same one through the port, and the mint below always carries an id.
    let recordingSessionId = meta.recordingSessionId
    if (!recordingSessionId) {
      const attributed = {
        // Attributed exactly as the recorder's own start-mint would have: the
        // take remembers who the recording is for, and a row minted without
        // that is a row the karute could never be read beside.
        customerId: meta.target?.customerId ?? null,
        appointmentId: meta.target?.appointmentId ?? null,
        // The idempotency anchor (fix round 7) — one row per take, however many
        // times a lost reply sends us back here.
        takeId,
      }
      // ⚖ ONE BOUND ATTEMPT PER TAKE (fix round 9). With the container beside
      // the take, the door composes this take's finalized key and the row is
      // BORN pointing at it (fix round 8) — no unbound window for two
      // client-named mints to race in. But a create that carries a key is not
      // blind-retry-safe, which is PR2 fix round 10's own named ceiling: a
      // second bound create composes the SAME key, and core's unique index
      // refuses it forever. So the pair is offered only while this take has
      // never sent one, and the flag is stamped BEFORE the request leaves —
      // the failure it guards is the reply that never comes back.
      const bound = !meta.startBoundAttempted
      if (bound) await markTakeStartBoundAttempted(takeId)
      // Same container the mint is given one line down, never a second reading.
      let started = bound ? await port.startSession({ ...attributed, mimeType }) : null
      // ANY failure steps back to the argument-less start, ONCE — a 400 from a
      // server that predates the pair, a 409 on the key, a 5xx, a timeout, a
      // lost reply. The row it makes is UNBOUND, which the mint below still
      // reserves through its legacy update path, so the take is recoverable
      // where a second bound try could only be refused again.
      //
      // THE RESIDUAL, and it is bounded: when the lost reply followed a
      // SUCCESSFUL bound create, core keeps one born-reserved orphan row
      // (UPLOADING, a pointer, no duration) that nothing can hand back — core
      // exposes no lookup by audio_storage_path. The unbound row this makes is
      // then a second row for the take, and the mint's reservation on it
      // answers `reserved_elsewhere` against the orphan's key: TERMINAL, so
      // nothing re-uploads, and the take surfaces as 要対応 (R10) for a human
      // — instead of two rows quietly sharing one object.
      if (!started) started = await port.startSession(attributed)
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
      //
      // ⚖ AND THE FIRST STAMP WINS (fix round 10). The read above and this
      // write straddle a network create, and a start-mint reply can land in
      // between — so the take may already carry a row by now. That one is the
      // take's: the karute and the discard are written against what the take
      // says. Ours becomes the orphan and this leg follows the stamp, because
      // uploading to a key reserved on a row nothing points at is the strand
      // this round exists to close.
      if (!(await stampTakeSession(takeId, recordingSessionId)))
        recordingSessionId =
          (await readTakeSecureMeta(takeId))?.recordingSessionId ?? recordingSessionId
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
    //
    // And the refusal does not always carry 409 as its STATUS (fix round 12,
    // P2) — putSaysAlreadyThere above reads the body for the shape that hides
    // it in a 400.
    if (!put.ok && !(await putSaysAlreadyThere(put))) {
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
