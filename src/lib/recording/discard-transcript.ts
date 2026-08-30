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
      customerId: pending.customerId,
    })
    if (!('error' in res)) return true
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
      customerId: pending.customerId,
      durationSeconds: pending.durationSeconds,
      locale: pending.locale,
    })
    if ('error' in res) return
    await deleteTake(takeId)
  } catch (err) {
    console.warn('[discard-transcript] persist run failed:', err)
  }
}

/** Record-page mount: finish whatever a reload left owing. */
export async function sweepDiscardTranscripts(): Promise<void> {
  if (!discardTranscriptSupported()) return
  for (const t of await listPendingDiscardTakes()) {
    await runDiscardTranscript(t.takeId, t.discardPending)
  }
}
