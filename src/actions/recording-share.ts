'use server'

// The WEB door onto the share toggle — Karute web's twin of the
// …/recordings/share facade route. Both call the SAME body
// (setRecordingSharedWithClient, src/lib/recording/share.ts), so a share can
// never mean something different on the two doors and one toggle files one
// audit row.
//
// Same gate as the discard receipt (records.write) — a frontdesk account
// that cannot record must not be able to change a share state either.
//
// NEVER THROWS — the ok/error union the button branches on (the
// getDiscardTranscript/mintRecordingPlaybackUrl shape).

import { newSynqedClient } from '@/lib/synqed/client'
import { can } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentAccessToken, getCurrentUserStaffId, resolveUserId } from '@/lib/staff'
import { setRecordingSharedWithClient } from '@/lib/recording/share'

export type SetRecordingSharedActionResult =
  | { ok: true; shared: boolean }
  | { ok: false; error: 'not_found' | 'no_recording' | 'forbidden' | 'upstream' }

export async function setRecordingShared(
  karuteId: string,
  shared: boolean,
): Promise<SetRecordingSharedActionResult> {
  try {
    if (!(await can('records.write'))) return { ok: false, error: 'forbidden' }
  } catch (err) {
    // A capability read that THREW did not answer the permission question —
    // a transient auth/DB blip is not a refusal (D-8), same rule
    // recording-playback.ts's gate takes.
    console.warn('[recording-share] capability read failed:', err)
    return { ok: false, error: 'upstream' }
  }

  try {
    const [businessId, accessToken, actorId, staffId] = await Promise.all([
      getBusinessId(),
      // core's PUT /recordings/:id answers 401 without the human Bearer
      // (client.ts:61-64; recording-discard.ts's discard door is the
      // precedent) — this IS a core write, unlike the playback mint's read.
      getCurrentAccessToken(),
      resolveUserId(),
      getCurrentUserStaffId(),
    ])
    if (!businessId) return { ok: false, error: 'forbidden' }

    const result = await setRecordingSharedWithClient(
      newSynqedClient(businessId, accessToken),
      { actorId, staffId, businessId, source: 'web' },
      { karuteId, shared },
    )
    return 'error' in result ? { ok: false, error: result.error } : { ok: true, shared: result.shared }
  } catch (err) {
    console.warn('[recording-share] write failed:', err)
    return { ok: false, error: 'upstream' }
  }
}
