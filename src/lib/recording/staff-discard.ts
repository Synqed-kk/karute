// THE ONE READ behind "did a staff member deliberately discard this session?"
// Two callers with two failure contracts share it: the from-session door
// (returns a refusal a human can act on) and the job worker (throws into
// core's requeue). The POLARITY stays at the call site; the read does not.
//
// ⚖ THE FENCE CHECKS, IT NEVER COUNTS (fix round 2, R1): the rows are re-read
// in code, because a fence does not trust the query filter it asked for. If
// core ever stopped honouring `recording_session_id`, a bare count would turn
// ONE reasoned discard anywhere in the business into a refusal on EVERY save.
// ⚖ AND A ROW IT CANNOT READ IS NOT AN ANSWER (fix round 3, R1): this check
// needs a discard to be ABSENT before a save proceeds, so a field core stopped
// sending would let the save through — 'unreadable' is its own verdict.
// `page_size: 1` is sound only while core honours `source`; the code-side
// re-read guards the session filter, not that one.
// (recording-discard-transcript.ts's hasStaffDiscard is the OPPOSITE polarity
// — it needs a discard WITH a reason to EXIST before it writes — and stays its
// own function; it is not the same question.)
import type { SynqedClient } from '@synqed-kk/client'

export type StaffDiscardVerdict = 'discarded' | 'clear' | 'unreadable'

export async function readStaffDiscard(
  synqed: Pick<SynqedClient, 'recordingDiscards'>,
  recordingSessionId: string,
): Promise<StaffDiscardVerdict> {
  const res = await synqed.recordingDiscards.list({
    recording_session_id: recordingSessionId,
    source: 'STAFF',
    page_size: 1,
  })
  const events = res?.events ?? []
  const unreadable = events.some(
    (e) => typeof e?.recording_session_id !== 'string' || typeof e?.source !== 'string',
  )
  if (unreadable) return 'unreadable'
  const hit = events.some((e) => e?.source === 'STAFF' && e.recording_session_id === recordingSessionId)
  return hit ? 'discarded' : 'clear'
}
