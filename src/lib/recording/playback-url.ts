// "Let me hear this again" — the ONE server body that turns a karute on screen
// into a short-lived signed READ url for the audio behind it (build 23 slice ①,
// the play button inside the 文字起こし card).
//
// THE FALSIFIABLE CLAIMS THIS FILE MAKES, in the order it checks them:
//   1. THE FENCE. The object it signs is a FINALIZED TAKE of the caller's own
//      tenant — `serverHoldsTakeRow` (take-binding.ts), which is the shared
//      TAKE-only grammar AND the server's own receipt that the bytes landed.
//      The pointer alone would not do: the row is BORN RESERVED, so a take
//      still on the device carries a key with no object behind it. A null
//      pointer, an unlanded take, a discard's `stg/` staged copy and another
//      tenant's key are one answer: no_audio. Widening this to reach a
//      discarded take is a different surface (manager discard review), not a
//      loosened fence here.
//   2. THE ACL. Whoever may read the RAW TRANSCRIPT of this karute may hear its
//      audio — canViewTranscript, the same predicate the detail screen applies
//      to the words, with the owner floor (`business.manage`) OR'd in by the
//      CALLER through `canHearAll`. One rule, one place; a record with no owner
//      keeps its shared answer for the sound exactly as for the words.
//   3. ONE ROW PER MINT. Every successful mint writes exactly one
//      `recording.play` audit row and every refusal writes none — the audit
//      call lexically dominates the single success return (CP7), and each
//      refusal is an `{ error }` literal that returns before it.
//
// WHY THE INPUT IS THE KARUTE AND NOT A PATH. The caller names the record it is
// looking at; the server resolves karute → recording_session_id → row →
// audio_storage_path itself. A caller that could name a PATH would be naming
// the object, and every fence in this file would be checking a claim instead of
// a fact.
//
// MINTED ON THE FIRST PLAY TAP, never on mount — a mount-mint would file an
// audit row per VIEW rather than per LISTEN, which is not what the row means.
//
// NO 'use server' directive, deliberately — same rule as finalize-take.ts and
// discard.ts: `actor` is the authenticated identity the CALLER resolved and
// vouches for. As a server action a caller could supply its own.
//
// ONE choke point, two doors: the web action (src/actions/recording-playback.ts)
// and the facade route (…/recordings/playback-url). FACADE_AUDIT_MAP's
// 'recordings.playbackUrl' is therefore a deliberate 'skip' citing this
// function — one listen, one row, whichever door asked.
//
// NO DOWNLOAD, anywhere in Karute (⚖ 9/3). This mints a READ url for an
// <audio> element; the phone and Karute web both play it and neither offers to
// save it. Taking audio out of the product is SYNQED Business's desk, a
// different door in a different product.

import type { SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { canViewTranscript } from '@/lib/auth/recording-acl'
import { serverHoldsTakeRow } from '@/lib/recording/take-binding'
import { createServiceClient } from '@/lib/supabase/service'
import { lookupProfileIdForSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'

type Core = Pick<SynqedClient, 'karuteRecords' | 'recordings'>

/** The repo's existing signed-url lifetime (process-recording.ts:96). An hour
 *  is longer than any single take, so a normal listen never meets it; a long
 *  one that does re-mints ONCE and resumes, which is an honest second row. */
export const PLAYBACK_URL_TTL_S = 3600

export interface PlaybackActor {
  /** The AUTHENTICATED staff identity, resolved by the caller and NEVER read
   *  from a request body. Same id space the detail screen's ACL compares in. */
  staffId: string | null
  /** The caller's verified tenant — the prefix the take key must carry. */
  businessId: string
  /** `recordings.viewAll` OR `business.manage` (the owner floor, silently —
   *  ⚖ 9/3: no staff ping, no on-screen sentence). Resolved by the caller so
   *  the owner floor never widens the transcript rule it sits beside. */
  canHearAll: boolean
  source: 'web' | 'facade'
  requestId?: string
}

/**
 * `not_found` = there is no such karute for this tenant.
 * `no_audio`  = there IS a karute, and nothing playable hangs off it (no
 *               session, no row, no take key, a staged discard copy, another
 *               tenant's key). ONE answer, because the card shows no player for
 *               every one of them and says nothing about why.
 * `forbidden` = this take is someone else's to hear.
 * `upstream`  = we could not look. Never folded into `no_audio`: telling a
 *               staffer her recording has no audio when core merely blipped is
 *               the one wrong thing to say here.
 */
export type MintPlaybackUrlResult =
  | { url: string; expiresAt: string; durationSeconds: number | null }
  | { error: 'not_found' | 'no_audio' | 'forbidden' | 'upstream' }

function upstreamStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

export async function mintPlaybackUrlWithClient(
  synqed: Core,
  actor: PlaybackActor,
  input: { karuteId: string },
): Promise<MintPlaybackUrlResult> {
  // 1. The karute names the resource, and proves the tenancy: a business-scoped
  //    client reads a foreign id as 404 (packet-03 disc. #5).
  let karute: { staff_id?: string | null; recording_session_id?: string | null }
  try {
    karute = await synqed.karuteRecords.get(input.karuteId)
  } catch (err) {
    return { error: upstreamStatus(err) === 404 ? 'not_found' : 'upstream' }
  }

  const sessionId = karute.recording_session_id || null
  if (!sessionId) return { error: 'no_audio' }

  // 2. The row carries the pointer. A 404 here is a swept session — no audio,
  //    not a missing karute.
  let row: {
    id: string
    store_id?: string | null
    audio_storage_path: string | null
    duration_seconds: number | null
    status: string
  }
  try {
    row = await synqed.recordings.get(sessionId)
  } catch (err) {
    return { error: upstreamStatus(err) === 404 ? 'no_audio' : 'upstream' }
  }

  // 3. THE FENCE (claim 1). Take-only, by the shared grammar, AND the server's
  //    own receipt that the object is really there — the same predicate the
  //    card's presence uses, so a player never appears for audio this door
  //    would refuse to sign (defence in depth, one truth).
  if (!serverHoldsTakeRow(row, actor.businessId)) return { error: 'no_audio' }
  const audioPath = row.audio_storage_path

  // 4. THE ACL (claim 2). Recorder-lock fix (⚖ Liam 8/22): the karute's staff
  //    id sometimes carries a synqed-core staff CARD id rather than a profile
  //    id, which locked the recorder out of her own record. Translate for the
  //    compare only; `?? original` leaves profile-id rows and unlinked cards
  //    exactly as they are — the same translation both detail doors do.
  const ownerStaffId = karute.staff_id
    ? ((await lookupProfileIdForSynqedStaffIdForBusiness(
        karute.staff_id,
        actor.businessId,
      )) ?? karute.staff_id)
    : null
  if (
    !canViewTranscript({
      ownerStaffId,
      viewerStaffId: actor.staffId,
      canViewAll: actor.canHearAll,
    })
  ) {
    return { error: 'forbidden' }
  }

  // 5. The signed READ url — service-role, same by-construction posture as the
  //    job worker's Deepgram mint. The fence above is all that stands between a
  //    caller and another tenant's audio, which is why it runs first.
  const supabase = createServiceClient()
  const { data: signed, error: signErr } = await supabase.storage
    .from('recordings')
    .createSignedUrl(audioPath, PLAYBACK_URL_TTL_S)
  if (signErr || !signed?.signedUrl) {
    console.warn('[playback-url] storage refused the signature', signErr)
    return { error: 'upstream' }
  }

  // 6. ONE ROW PER MINT (claim 3). Legal hygiene, never a notification: an
  //    owner listening to a staffer's take is `breakGlass`, and nobody is told.
  //    ⚖ 8/17 doc law keeps content out of details — ids and the TTL only.
  audit({
    category: 'recording',
    action: 'recording.play',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    storeId: row.store_id ?? undefined,
    targetType: 'recording',
    targetId: row.id,
    severity: 'notice',
    breakGlass: ownerStaffId !== null && ownerStaffId !== actor.staffId,
    detail: { karute_id: input.karuteId, ttl_s: PLAYBACK_URL_TTL_S },
    requestId: actor.requestId,
    source: actor.source,
  })

  return {
    url: signed.signedUrl,
    expiresAt: new Date(Date.now() + PLAYBACK_URL_TTL_S * 1000).toISOString(),
    durationSeconds: row.duration_seconds,
  }
}
