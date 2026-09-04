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
  clearTakeStaged,
  ensureFinalizedPath,
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

/** The staged-copy prefix, mirroring key-grammar's own STAGED_PREFIX.
 *  ponytail: spelled here instead of imported — key-grammar is server-side and
 *  importing it would pull the whole grammar module into the thin (phone)
 *  bundle, which runs against a hard byte ceiling. It is NOT a fence
 *  (isStagedKeyFor, server-side, is): it only tells round 4's anonymous staged
 *  copy from a bound one, once, for the transitional cohort below. */
const STAGED_KEY_PREFIX = 'stg/'

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
    // …AFTER THE STOP HAS HAD ITS SAY (fix round 5). Both discard arms kick this
    // while the stop leg's whole-take PUT is still in flight, so the read below
    // answers "no key yet" and returns — and only a record-page MOUNT re-kicks
    // it. This is the one line that makes the FIRST sweep the one that lands.
    // Lazy for the reason the other two readers name (ai-pipeline.ts,
    // global-pipeline.ts): the recorder's graph reaches @/actions/recordings →
    // next/cache, which jest cannot load in a node-environment suite.
    await (await import('@/lib/global-recorder')).globalRecorder.awaitTakeSecured(takeId)
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
    // ⚖ …AND A TAKE FINALIZED BY SLICE THREE STILL HAS A KEY (fix round 7).
    // That deploy stamped `finalizedAt` alone, so such a take reads as
    // unsecured here and waited for an object it would never be able to name.
    // The key is deterministic; ensureFinalizedPath recomposes it once through
    // the port and remembers the answer (null on the phone, whose cohort is
    // empty by construction).
    const port = getRecordingPipelinePort()
    let path = (await ensureFinalizedPath(takeId, meta, port)) ?? meta.stagedPath
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
      // ⚖ …AND THE COPY IS NAMED FOR THIS SESSION (fix round 7). `stagedFor`
      // puts the session in the KEY, which is the only identity a row-less
      // object can carry — and without it the door had to accept any
      // same-tenant key as this discard's audio, so a colleague's finished take
      // could be claimed onto a session it has nothing to do with.
      // ⚖ …AND FOR ITS TAKE (slice five packet B, D10). The take fills the key's
      // uuid slot, so the whole copy is composable from the core row alone and
      // the copy of a take that is staged twice is the SAME object, not a second
      // one. `blob` carries the take's container, which the port sends on.
      path = (
        await port.prepareTranscription(blob, null, {
          stagedFor: pending.recordingSessionId,
          stagedTake: takeId,
        })
      ).path
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
    // ⚖ THE TRANSITIONAL COHORT (fix round 7). A take stamped BEFORE this round
    // carries a staged copy from round 4's staging — an anonymous, take-shaped
    // key the door now refuses, because a claim has to be named for its
    // session. Forget that pointer ONCE and leave the stamp: the next sweep
    // stages a bound copy and the words land. The old object is not touched —
    // nothing deletes audio — and a copy that IS bound never reaches here, so
    // this can neither loop nor re-upload anything twice. Only a CLAIM is
    // eligible: a forbidden on the take's own finalized key settles exactly as
    // it always did.
    if (
      'error' in res &&
      res.error === 'forbidden' &&
      path === meta.stagedPath &&
      !path.startsWith(STAGED_KEY_PREFIX)
    ) {
      await clearTakeStaged(takeId)
      return
    }
    await markDiscardTranscriptDone(takeId)
  } catch (err) {
    console.warn('[discard-transcript] persist run failed:', err)
  } finally {
    inFlight.delete(takeId)
  }
}

/** Record-page mount (and, on the phone, the launch drain): finish whatever a
 *  reload left owing. A take the discard arm kicked moments ago is still
 *  stamped while its run is in flight — the in-flight guard inside
 *  runDiscardTranscript is what stops this sweep from staging it a second time.
 *
 *  SEQUENTIAL BY DESIGN, and the ceiling is named: each run may wait on that
 *  take's own stop leg, which is belted at SECURE_SETTLE_BELT_MS (120 s), so a
 *  worklist whose first take has a hung leg holds the rest of the sweep for up
 *  to two minutes. That is the accepted cost of one take at a time on salon
 *  wifi — this is fire-and-forget, nothing rendered waits on it, and every
 *  unfinished take keeps its stamp for the next sweep to pick up. */
export async function sweepDiscardTranscripts(): Promise<void> {
  if (!discardTranscriptSupported()) return
  for (const t of await listPendingDiscardTakes()) {
    await runDiscardTranscript(t.takeId, t.discardPending)
  }
}
