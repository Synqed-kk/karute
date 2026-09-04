'use client'

// A2-2 client half — getting the words of a reasoned discard to the server.
//
// Two origins, two costs:
//   - `review`: the take was already transcribed in-tab, so the words are in
//     hand and persisting them costs NOTHING extra.
//   - `recorder`: 使用 was never tapped, so the take's finalized audio has to be
//     transcribed once. Only above the accidental-tap floor (⚖ spend gate) —
//     the caller checks that before it stamps.
//
// DURABILITY. The take is stamped `discardPending` in take-store, and marked
// DONE only once the words have landed (or were deliberately not kept) — it is
// never deleted (PR4: audio is never deleted). A crash in between leaves a
// stamped take that the next record-page mount finishes. The stamp is also what
// keeps a discarded take out of every recovery offer — see listOwnTakes.
// The anchor's span, honestly: it starts at the STAMP, not at the discard. A
// crash between core accepting the discard and the stamp being written leaves a
// discarded session whose take is still offered as recovery — pre-existing
// shape (the same gap sat before proceedDiscard's deleteTake), not closed here.

import {
  isUnsecurableTake,
  listPendingDiscardTakes,
  loadTakeBlob,
  markDiscardTranscriptDone,
  markTakeStaged,
  readTakeSecureMeta,
  stampDiscardPending,
  type DiscardPending,
} from '@/lib/karute/take-store'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'

/** Whether this world can persist discard transcripts at all. Web: yes. Thin:
 *  yes since PHONEWIRE-2C — the phone's facade door landed, and the port's
 *  action twins POST it. Read BEFORE stamping, so a world that ever answers
 *  false again never keeps audio for a collection that cannot happen. */
export function discardTranscriptSupported(): boolean {
  return getRecordingPipelinePort().supportsDiscardTranscript
}

/** Lazy import, same reason as recording-port's own: the action module's import
 *  graph reaches server-only + ESM-only code jest cannot parse. */
function transcriptActions() {
  return import('@/actions/recording-discard-transcript')
}

/** Only `failed` is worth another attempt. `not_discarded` (there is no reasoned
 *  discard on that session — the words have no home) and `forbidden` (the caller
 *  lacks records.write, or the key is not this tenant's) cannot become true on a
 *  later mount, and treating them as retryable re-read the WHOLE audio on
 *  every record-page mount for the take-store's seven days. Settle them like a
 *  skip: the take is MARKED done (PR4 — it is no longer deleted). */
function retryable(res: object): boolean {
  return 'error' in res && (res as { error: string }).error === 'failed'
}

/** Takes whose persist run is in flight RIGHT NOW. The sweep fires on every
 *  record-page mount and the discard arms kick their own run, so navigating away
 *  and back inside a long transcription staged and transcribed the same audio a
 *  second time — doubled Deepgram spend, and two writes that both pass the
 *  write-once probe.
 *  Residual: this is a module-level set, so a SECOND TAB has its own and can
 *  still double-spend once. Bounded, not closed: both runs transcribe the same
 *  audio, and the loser's write is refused by the probe (or overwrites with the
 *  same words). A real lease belongs on the stamp. */
const inFlight = new Set<string>()

/**
 * The `review` origin. Returns TRUE when the take may now be deleted — the
 * words landed, or were deliberately not kept (no consent, nothing said). FALSE
 * means the write failed and the take has been stamped instead: keep it, the
 * sweep re-tries through the audio path.
 *
 * ⚖ EVERY ARM MARKS THE TAKE (fix round 4, G6). Until now only the FAILURE path
 * stamped, and "may be deleted" was read as "will be deleted" — which stopped
 * being true when the never-delete guard began refusing a take the server does
 * not have. On this arm's MAIN path (the words are in hand by definition here,
 * so the write usually succeeds) the caller then handed the take id to
 * finishReviewDiscard, its deleteTake was refused, and the take survived with
 * NO stamp: listOwnTakes' A2-2 exclusion never fired and the recovery banner
 * re-offered a session the staffer had deliberately discarded.
 *
 * The mark is written on all three paths now; what differs is what it says is
 * still OWED:
 *   - the words LANDED (or were deliberately not kept — a consent skip, a
 *     terminal refusal nothing can change): pending + DONE;
 *   - a world with nowhere to persist: pending, NOT done. The words were never
 *     looked for, so closing the record would be a lie — and the sweep is a
 *     no-op there anyway (it reads discardTranscriptSupported first), so the
 *     words are still collectable if that world ever gains support;
 *   - a FAILED write: pending, not done — unchanged, and its `false` still
 *     holds the take back for the audio retry.
 * The caller's own deleteTake is unchanged either way: refused for an unsecured
 * take (the mark is then what hides it), allowed for a finalized one.
 */
export async function persistReviewDiscardTranscript(
  takeId: string | null | undefined,
  pending: DiscardPending,
  transcript: string,
): Promise<boolean> {
  /** Mark it, settle it only if the words are actually settled, and let it go. */
  const settle = async (done: boolean) => {
    if (takeId && (await stampDiscardPending(takeId, pending)) && done) {
      await markDiscardTranscriptDone(takeId)
    }
    return true
  }
  if (!discardTranscriptSupported()) return settle(false)
  try {
    const { persistDiscardTranscript } = await transcriptActions()
    const res = await persistDiscardTranscript({
      recordingSessionId: pending.recordingSessionId,
      transcript,
      durationSeconds: pending.durationSeconds,
    })
    // A terminal refusal is settled, exactly like a skip — keeping the take back
    // would only buy the audio path one wasted upload before it refuses too.
    if (!retryable(res)) return settle(true)
  } catch (err) {
    console.warn('[discard-transcript] review persist failed:', err)
  }
  if (!takeId) return true
  return !(await stampDiscardPending(takeId, pending))
}

/**
 * Finish ONE stamped take: transcribe its audio onto the discarded session.
 *
 * ⚖ THE AUDIO IS THE TAKE'S OWN FINALIZED OBJECT (capture pipeline PR4). It was
 * PUT there at stop, so this stages nothing and — the change that matters —
 * drops nothing: a discarded recording's audio is kept in full (⚖ 8/20 discard
 * doctrine), and only its words are collected here. A settled answer (written,
 * or deliberately not kept) MARKS the take done; anything else leaves it
 * stamped for the next sweep.
 *
 * A take with no finalized object YET (an offline stop) is left exactly as it
 * is: the record page's mount retry secures it, and the next sweep finishes
 * this. Nothing here can create the object, and nothing here should destroy the
 * only copy while waiting.
 *
 * ⚖ …BUT "YET" HAS TO BE TRUE (capture pipeline PR4 fix round 2). Some takes
 * will NEVER be sealed under a finalized key — a tail that never landed, a stop
 * leg that died before it could stamp, a settled refusal (isUnsecurableTake).
 * For those, "wait for the object" is silence for ever: the discard record kept
 * its REASON and never its words, and the manager-review half of the ⚖ 8/20
 * doctrine was quietly lost on exactly the recordings most likely to need it.
 * So the disk blob is staged through the port's own fallback — the same one
 * prepareTranscription uses for a take the store never held, one upload, NO
 * delete — and the words are read from there. The staged copy is row-less on
 * the server by design: a take that must never be sealed under its finalized
 * key must not be sealed under a second one either.
 */
export async function runDiscardTranscript(
  takeId: string,
  pending: DiscardPending,
): Promise<void> {
  if (inFlight.has(takeId)) return
  inFlight.add(takeId)
  try {
    // null = the take is gone, or belongs to a DIFFERENT signed-in user (the
    // store's owner gate). Leave the stamp either way: the rightful owner's own
    // sweep can still finish it.
    const meta = await readTakeSecureMeta(takeId)
    if (!meta) return
    // ⚖ AND A STAGED COPY IS STAGED ONCE (fix round 4). The staging below is a
    // whole-take upload, and the sweep fires on EVERY record-page mount: a
    // transcription that genuinely keeps answering `failed` re-uploaded tens of
    // megabytes each time, for ever. The key of the first copy is remembered on
    // the take, so every later sweep re-reads THAT object — one API call per
    // mount, no upload. `finalizedPath` still wins wherever both exist: it is
    // the key the rest of the pipeline reads.
    let path = meta.finalizedPath ?? meta.stagedPath
    if (!path) {
      // Merely not secured YET — an offline stop, a retryable refusal. The
      // mount retry is coming for it; leave the stamp and let the next sweep
      // read the finalized key it will have by then.
      if (!isUnsecurableTake(meta)) return
      // It will never have one. The audio is still on the device, so the words
      // are still collectable — stage this take's own blob through the port's
      // existing fallback and transcribe from there. No blob (persistence
      // failed, the segments never landed) is the one case with nothing to
      // collect: leave the stamp rather than mark a take done whose words were
      // never even looked for.
      const blob = await loadTakeBlob(takeId)
      if (!blob || blob.size === 0) return
      path = (await getRecordingPipelinePort().prepareTranscription(blob, null)).path
      await markTakeStaged(takeId, path)
    }
    const { transcribeAndPersistDiscard } = await transcriptActions()
    const res = await transcribeAndPersistDiscard({
      recordingSessionId: pending.recordingSessionId,
      audioPath: path,
      durationSeconds: pending.durationSeconds,
      locale: pending.locale,
    })
    if (retryable(res)) return
    await markDiscardTranscriptDone(takeId)
  } catch (err) {
    console.warn('[discard-transcript] persist run failed:', err)
  } finally {
    inFlight.delete(takeId)
  }
}

/** Record-page mount: finish whatever a reload left owing. A take the discard
 *  arm kicked moments ago is still stamped while its run is in flight — the
 *  in-flight guard inside runDiscardTranscript is what stops this sweep from
 *  staging it a second time. */
export async function sweepDiscardTranscripts(): Promise<void> {
  if (!discardTranscriptSupported()) return
  for (const t of await listPendingDiscardTakes()) {
    await runDiscardTranscript(t.takeId, t.discardPending)
  }
}
