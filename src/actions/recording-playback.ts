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
import { getBusinessId, getCurrentUserStaffId, resolveUserId } from '@/lib/staff'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { mintPlaybackUrlWithClient } from '@/lib/recording/playback-url'

/** The viewer's store assignment for the recording ACL, web transport. `null` =
 *  unrestricted (`stores.viewAll` or floating staff); `[]` = we could not read
 *  it, which the ACL fails closed on — never widened into "every store"
 *  (⚖ 8/17 store isolation). Resolved ONLY when it can matter, so an assignment
 *  blip can never cost a recorder her own take. */
async function viewerAllowedStoreIds(canViewAll: boolean): Promise<readonly string[] | null> {
  if (!canViewAll) return null
  try {
    const scope = await resolveStoreScope()
    return scope.degraded ? [] : scope.allowedStoreIds
  } catch (err) {
    console.warn('[recording-playback] store scope read failed — failing closed:', err)
    return []
  }
}

export type MintRecordingPlaybackUrlResult =
  | { ok: true; url: string; expiresAt: string; durationSeconds: number | null }
  | { ok: false; error: 'not_found' | 'no_audio' | 'forbidden' | 'upstream' }

export async function mintRecordingPlaybackUrl(
  karuteId: string,
): Promise<MintRecordingPlaybackUrlResult> {
  try {
    if (!(await can('customers.view'))) return { ok: false, error: 'forbidden' }
  } catch (err) {
    // A capability read that THREW did not answer the permission question — a
    // transient auth/DB blip is not a refusal (D-8). `upstream`, like the outer
    // catch below; the two must not disagree about the same failure.
    console.warn('[recording-playback] capability read failed:', err)
    return { ok: false, error: 'upstream' }
  }

  try {
    const [businessId, actorId, staffId, canViewAll] = await Promise.all([
      getBusinessId(),
      // WHO is asking, vs WHICH roster identity the ACL compares — always both.
      resolveUserId(),
      getCurrentUserStaffId(),
      // The whole CAPABILITY floor: `recordings.viewAll` — owner by preset,
      // grantable per person by the owner only — and nothing else (fix round 2).
      // The viewer's STORE reach narrows it below (⚖ 8/17); nothing widens it.
      can('recordings.viewAll'),
    ])
    if (!businessId) return { ok: false, error: 'forbidden' }

    const result = await mintPlaybackUrlWithClient(
      newSynqedClient(businessId),
      {
        actorId,
        staffId,
        businessId,
        canViewAll,
        // The grant widens WHOSE recordings, never WHICH stores (⚖ 8/17;
        // Greptile #848 point 2) — the door compares this against the row's own
        // store_id, and a recorder's own take never reaches that branch.
        allowedStoreIds: await viewerAllowedStoreIds(canViewAll),
        source: 'web',
      },
      { karuteId },
    )
    return 'error' in result ? { ok: false, error: result.error } : { ok: true, ...result }
  } catch (err) {
    console.warn('[recording-playback] mint failed:', err)
    return { ok: false, error: 'upstream' }
  }
}
