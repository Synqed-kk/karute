// The two rules every PUT to the recordings bucket obeys — LIFTED here whole
// from secure-take.ts (slice five packet B), unchanged in behaviour.
//
// WHY A MODULE OF ITS OWN. secure-take is the WHOLE-TAKE upload, but it is no
// longer the only writer: both ports stage a discard's copy through the same
// signed-URL door (lib/ports/recording-port.ts, thin/ports/recording.vite.ts),
// and each of them carried its own, weaker spelling of the same two questions —
// a flat `!put.ok` throw that read "the object is already there" as a failure,
// and no deadline at all. A staged key is DETERMINISTIC as of this round
// (key-grammar.ts#composeStagedKey), so "already there" is now a routine,
// correct answer on that path too: the same take staged twice lands on the same
// key and storage refuses the second PUT, exactly as it refuses a duplicate
// finalized take.
//
// It imports NOTHING app-side on purpose — no store, no port, no action — so
// any writer can reach it without a cycle.

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
export const putDeadlineMs = (bytes: number) =>
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
export async function putSaysAlreadyThere(put: Response): Promise<boolean> {
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
