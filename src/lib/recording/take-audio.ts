// WHERE A TAKE'S AUDIO ACTUALLY LIVES — the ONE precedence every reader shares
// (⚖ Liam 2026-09-06, "b"; design amendment 9).
//
// Since the nightly assembler stopped writing under the take's own key, a take
// can have its bytes in either of two places, and for a little while in BOTH:
//
//   app_<biz>_<take>.<ext>       the phone's own object — the WHOLE take, put
//                                there by the device's stop leg or its drain;
//   rsc/app_<biz>_<take>.<ext>   the rescue — the contiguous prefix the nightly
//                                job rebuilt out of the segments a silent
//                                device left behind (assembler.ts).
//
// THE PRECEDENCE IS THE PHONE'S OBJECT, ALWAYS. The rescue is by construction a
// prefix and by construction partial (nothing on today's main declares how long
// a take was meant to be), so whenever the device's own copy exists it is the
// longer, truer one. The rescue is the fallback for the case it was built for:
// the device that never came back.
//
// AND THAT IS WHY BOTH MAY EXIST. A phone paused for two days is indistinguish-
// able from a dead one, so the job rescues it; when that phone resumes it finds
// its own key FREE, uploads, and finalizes at the size it declared. Nothing is
// stuck and nothing mismatches — the cost is one extra partial object, which is
// never deleted (⚖ audio is never deleted) and which this helper stops reading
// the moment the real take lands.
//
// 'unknown' STOPS THE WHOLE QUESTION. A storage blip at the phone's key must
// never be read as "the phone has nothing", because falling through on it would
// hand a reader the PARTIAL object while the full take sat there unseen — a
// silent downgrade of somebody's recording. So an unanswerable probe is an
// unanswerable probe, and the caller fails closed on it exactly as it does
// today. The rescue is reached only from a PROVEN miss.
//
// THE INPUT IS A PARSED TAKE, NEVER A RAW POINTER. Callers pass the businessId,
// take id and container they have already read out of a key their own fence
// accepted (serverHoldsTakeRow, parseRecordingKey), so this helper cannot be
// handed a foreign key — it composes both candidates itself, through the one
// grammar, and never touches a string a caller named.
//
// WHO IMPORTS IT: playback-url.ts (the play button signs whichever key
// resolves, and the play audit row carries the `rescued` flag), and the discard
// door's audio path (recording-discard-transcript.ts). PR-C's inbox derivation
// and its save-from-server door join them on the rebase — one precedence, one
// place, so no two doors can ever disagree about which object a take is.

import { composeRescueKeyFromExt, composeTakeKeyFromExt } from '@/lib/recording/key-grammar'
import { objectExists } from '@/lib/recording/mint-take-url'

/**
 * `{ key, rescued }` when audio exists — the phone's object first, the rescue
 * second. `'absent'` when both are proven missing, `'unknown'` when storage
 * could not answer (never a miss).
 *
 * `ext` is the container read off a key this caller has already parsed, so a
 * composition that comes back null means the grammar and the caller disagree
 * about a key the grammar itself produced — a programming error, never a
 * runtime state, and a throw rather than a quiet 'absent'.
 */
export async function resolveTakeAudio(
  businessId: string,
  takeId: string,
  ext: string,
): Promise<{ key: string; rescued: boolean } | 'absent' | 'unknown'> {
  const main = composeTakeKeyFromExt(businessId, takeId, ext)
  const rescue = composeRescueKeyFromExt(businessId, takeId, ext)
  if (main === null || rescue === null) {
    throw new Error('take audio key failed its own grammar')
  }

  const own = await objectExists(main.key)
  if (own === 'unknown') return 'unknown'
  if (own) return { key: main.key, rescued: false }

  const side = await objectExists(rescue.key)
  if (side === 'unknown') return 'unknown'
  return side ? { key: rescue.key, rescued: true } : 'absent'
}
