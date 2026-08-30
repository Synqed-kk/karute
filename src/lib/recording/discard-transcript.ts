'use client'

// A2-2 client half — getting the words of a reasoned discard to the server.
//
// Two origins, two costs:
//   - `review`: the take was already transcribed in-tab, so the words are in
//     hand and persisting them costs NOTHING extra.
//   - `recorder`: 使用 was never tapped, so the audio has to be staged and
//     transcribed once. Only above the accidental-tap floor (⚖ spend gate) —
//     the caller checks that before it stamps.
//
// DURABILITY. The take is stamped `discardPending` in take-store BEFORE
// anything can delete it, and it is deleted only once the words have landed (or
// were deliberately not kept). A crash in between leaves a stamped take that
// the next record-page mount finishes. The stamp is also what keeps a discarded
// take out of every recovery offer — see listOwnTakes.
// The anchor's span, honestly: it starts at the STAMP, not at the discard. A
// crash between core accepting the discard and the stamp being written leaves a
// discarded session whose take is still offered as recovery — pre-existing
// shape (the same gap sat before proceedDiscard's deleteTake), not closed here.

import {
  deleteTake,
  loadTakeBlob,
  listPendingDiscardTakes,
  stampDiscardPending,
  type DiscardPending,
} from '@/lib/karute/take-store'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'

/** Whether this world can persist discard transcripts at all. Web: yes. Thin:
 *  no — the phone reaches server actions only through facade routes, and this
 *  family has none yet (queue item 2). Read BEFORE stamping so the phone never
 *  keeps audio for a collection that cannot happen; its discards behave exactly
 *  as they did before this build. */
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
 *  later mount, and treating them as retryable re-staged the WHOLE audio on
 *  every record-page mount for the take-store's seven days. Settle them like a
 *  skip: the take goes. */
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
 */
export async function persistReviewDiscardTranscript(
  takeId: string | null | undefined,
  pending: DiscardPending,
  transcript: string,
): Promise<boolean> {
  if (!discardTranscriptSupported()) return true
  try {
    const { persistDiscardTranscript } = await transcriptActions()
    const res = await persistDiscardTranscript({
      recordingSessionId: pending.recordingSessionId,
      transcript,
      durationSeconds: pending.durationSeconds,
    })
    // A terminal refusal is settled, exactly like a skip — keeping the take back
    // would only buy the audio path one wasted upload before it refuses too.
    if (!retryable(res)) return true
  } catch (err) {
    console.warn('[discard-transcript] review persist failed:', err)
  }
  if (!takeId) return true
  return !(await stampDiscardPending(takeId, pending))
}

/**
 * Finish ONE stamped take: stage its audio, transcribe it onto the discarded
 * session, then drop the audio. A settled answer (written, or deliberately not
 * kept) deletes the take; anything else leaves it stamped for the next sweep.
 */
export async function runDiscardTranscript(
  takeId: string,
  pending: DiscardPending,
): Promise<void> {
  if (inFlight.has(takeId)) return
  inFlight.add(takeId)
  try {
    // null = the audio is gone, or belongs to a DIFFERENT signed-in user. Leave
    // the stamp either way: the rightful owner's own sweep can still finish it,
    // and take-store's TTL is the backstop for one nobody ever will.
    const blob = await loadTakeBlob(takeId)
    if (!blob) return
    const { path } = await getRecordingPipelinePort().stageForJob(blob)
    const { transcribeAndPersistDiscard } = await transcriptActions()
    const res = await transcribeAndPersistDiscard({
      recordingSessionId: pending.recordingSessionId,
      audioPath: path,
      durationSeconds: pending.durationSeconds,
      locale: pending.locale,
    })
    if (retryable(res)) return
    await deleteTake(takeId)
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
