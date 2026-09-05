'use server'

// The WEB door onto the playback mint — Karute web's twin of the
// …/recordings/playback-url facade route. Both call the SAME body
// (mintPlaybackUrlWithClient), so the browser and the phone cannot answer the
// same karute differently, and one listen files one audit row on either door.
//
// Same gate as the route: 'customers.view', the capability that shows the
// karute screen. Whose recording it is stays the twin's question.
//
// NEVER THROWS — the ok/error union the player branches on (the
// getDiscardTranscript shape). A play button that threw would surface as an
// unhandled rejection in a card the staffer is reading.

import { newSynqedClient } from '@/lib/synqed/client'
import { can } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { mintPlaybackUrlWithClient } from '@/lib/recording/playback-url'

export type MintRecordingPlaybackUrlResult =
  | { ok: true; url: string; expiresAt: string; durationSeconds: number | null }
  | { ok: false; error: 'not_found' | 'no_audio' | 'forbidden' | 'upstream' }

export async function mintRecordingPlaybackUrl(
  karuteId: string,
): Promise<MintRecordingPlaybackUrlResult> {
  try {
    if (!(await can('customers.view'))) return { ok: false, error: 'forbidden' }
  } catch {
    return { ok: false, error: 'forbidden' }
  }

  try {
    const [businessId, staffId, canViewAll, canManage] = await Promise.all([
      getBusinessId(),
      getCurrentUserStaffId(),
      can('recordings.viewAll'),
      // The owner floor, silently (⚖ 9/3) — resolved beside viewAll, never
      // folded into it.
      can('business.manage'),
    ])
    if (!businessId) return { ok: false, error: 'forbidden' }

    const result = await mintPlaybackUrlWithClient(
      newSynqedClient(businessId),
      { staffId, businessId, canHearAll: canViewAll || canManage, source: 'web' },
      { karuteId },
    )
    return 'error' in result ? { ok: false, error: result.error } : { ok: true, ...result }
  } catch (err) {
    console.warn('[recording-playback] mint failed:', err)
    return { ok: false, error: 'upstream' }
  }
}
