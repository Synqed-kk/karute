// THE one delete path for a discard's staged audio object.
//
// Extracted from src/actions/recording-discard-transcript.ts (PHONEWIRE-2C fix
// round 3) because it grew a second caller: the facade route has to sweep on its
// OWN refusals, since the phone stages its audio BEFORE it posts and a
// route-level refusal would otherwise strand the object. Two callers, one
// implementation — a second `storage.remove` spelling is exactly how a fence
// gets forgotten on one of them.
//
// NO 'use server', deliberately, and for the same reason lib/recording/discard.ts
// carries none: this takes the tenant it is scoped to as an ARGUMENT. As a
// client-invokable server action a caller could name any business and have us
// delete that tenant's staged audio.

import { createServiceClient } from '@/lib/supabase/service'
import { isOwnRecordingKey } from './key-grammar'

/**
 * Best-effort removal of ONE staged take, fenced by the key grammar.
 *
 * THE FENCE LIVES HERE, not at the call sites, so a third caller cannot forget
 * it: a key that is not this business's own is never ours to delete. That is
 * what makes this safe to call from a blanket failure handler — the route
 * refuses a foreign staged key with a 403, and must not then reach into the
 * bucket for the object it just refused. `audioPath` is typed `unknown` for the
 * same reason isOwnRecordingKey's own key is: one caller hands it a field off an
 * UNVALIDATED body (the schema-refusal path), so the typeof guard has to run
 * before anything touches it.
 *
 * Never throws and never reports. The outcome a caller returns must reflect its
 * WRITE, never the janitor — a `finally` that threw would REPLACE the answer.
 * A failure here is one warn line, and /api/cleanup's flat-key sweep is the
 * backstop it always was.
 */
export async function sweepStagedDiscardAudio(
  businessId: string,
  audioPath: unknown,
): Promise<void> {
  if (!isOwnRecordingKey(audioPath, businessId)) return
  try {
    await createServiceClient().storage.from('recordings').remove([audioPath])
  } catch (err) {
    console.warn('[discard-transcript] staged audio sweep failed:', err)
  }
}
