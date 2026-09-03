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
// with the row it bound. So the session id is settled BEFORE the PUT — stamped
// here the moment the mint replies, because a kill between the PUT and the
// finalize must not leave uploaded audio with no way back to its row. And the
// mint's refusals are ANSWERS now, not throws: `exists` / `reserved_elsewhere`
// mean this take is spoken for and no retry helps.
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

/**
 * Upload the whole take to its finalized key and tell the server it is complete.
 *
 * @param durationSeconds the recorder's OWN measurement, when a caller has one
 *   (it subtracts paused time, and iOS fMP4 reports duration 0 — ⚖ v2 item 13).
 *   Omitted (the retry path, which has no recorder), the value the recorder
 *   STAMPED at stop stands in, and only failing that the take's flush window.
 */
export async function secureTake(
  port: RecordingPipelinePort,
  takeId: string,
  durationSeconds?: number,
): Promise<void> {
  if (inFlight.has(takeId)) return
  inFlight.add(takeId)
  try {
    const meta = await readTakeSecureMeta(takeId)
    // Gone, another staffer's, or already secured — all three mean there is
    // nothing to do, and the finalizedAt read is what makes a second call free.
    if (!meta || meta.finalizedAt) return
    // A refusal that can never turn into a yes — see TERMINAL_SECURE_ERRORS
    // (it lives in take-store, beside the field it judges). Read BEFORE the
    // blob so a terminal take costs one meta read, not a re-upload.
    if (meta.secureError && TERMINAL_SECURE_ERRORS.has(meta.secureError)) return
    const blob = await loadTakeBlob(takeId)
    // No segments on disk yet (a kill before the first flush, persistence
    // failed open to memory-only). Not an error, and not this PR's to fix.
    if (!blob || blob.size === 0) return

    const mimeType = meta.mimeType || DEFAULT_MIME
    // The row the mint must RESERVE this key on. Null when the start-mint never
    // landed — the mint then creates the row itself and answers with its id.
    const minted = await port.mintTakeUrl(takeId, mimeType, meta.recordingSessionId)
    // A refusal is a settled ANSWER now, the same as finalize's. Recorded
    // verbatim: TERMINAL_SECURE_ERRORS is the one place that judges which of
    // them can ever turn into a yes.
    if ('error' in minted) {
      await markTakeSecureError(takeId, minted.error)
      return
    }

    // THE SESSION IS SETTLED BEFORE THE BYTES. The server has already written
    // this key onto the row, so the device's copy of that fact must survive a
    // kill between the PUT and the finalize — a retry that arrives with no
    // session id could not name the row its own audio is already bound to.
    //
    // Only when the take carries none: a take that already has a session is the
    // row its discard and its karute write against, and re-pointing it from a
    // reply would orphan them.
    const recordingSessionId = meta.recordingSessionId ?? minted.recordingSessionId
    if (!recordingSessionId) {
      // A CLIENT-NAMED mint always answers with a row (mint-take-url.ts), so a
      // null here is a door that named the take itself — nothing this leg can
      // finalize against, and no retry changes which door answered.
      await markTakeSecureError(takeId, 'no_session')
      return
    }
    if (!meta.recordingSessionId) await stampTakeSession(takeId, recordingSessionId)

    const put = await fetch(minted.url, {
      method: 'PUT',
      // The SERVER's content type for the key it composed, never our own guess:
      // this is where the iOS "mp4 bytes under a .webm/audio-webm label" bug
      // dies for the finalized object.
      headers: { 'content-type': minted.contentType },
      body: blob,
    })
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
      // stamped at stop when this is a later retry; and only failing both,
      // the flush window — which counts paused time as recording.
      durationSeconds:
        durationSeconds ??
        (meta.durationMs !== undefined
          ? Math.max(0, meta.durationMs / 1000)
          : Math.max(0, (meta.updatedAt - meta.startedAt) / 1000)),
      byteLength: blob.size,
      // REQUIRED by the door now — proved non-null above, stamped on the take.
      recordingSessionId,
    })
    // `already: true` rides the ok arm on purpose — an exact retry and a take a
    // job already finished are both settled successes, not failures to re-run.
    // Nothing is stamped here: the session was settled at the mint, above.
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
