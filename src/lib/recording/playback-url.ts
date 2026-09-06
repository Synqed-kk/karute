// "Let me hear this again" — the ONE server body that turns a karute on screen
// into a short-lived signed READ url for the audio behind it (build 23 slice ①,
// the play button inside the 文字起こし card).
//
// THE FALSIFIABLE CLAIMS THIS FILE MAKES, in the order it checks them —
// fence → ACL → object → signature → audit row:
//   1. THE FENCE. The key must be a TAKE of the caller's own tenant with the
//      row's own receipt on it (`serverHoldsTakeRow`, take-binding.ts). A null
//      pointer, an unlanded take, a `stg/` staged copy and another tenant's key
//      are one answer: no_audio.
//   2. THE ACL. Whoever may read the RAW TRANSCRIPT of this karute may hear its
//      audio — canViewTranscript, on the SAME input the words use
//      (`recordings.viewAll`: owner by preset, grantable per person by the
//      owner only). One rule, one place, literally: there is no second
//      capability that reaches the sound. A record with no owner keeps its
//      shared answer for the sound exactly as for the words.
//   3. AND ONLY THEN, THE OBJECT. Storage is asked whether the bytes are really
//      there, because the fence's helper is a heuristic and its own header says
//      so: a reasoned discard stamps a client-reported duration on the row with
//      no object proof, and the ordinary discard leaves the row on its TAKE
//      key. A row whose object is simply gone joins the same no_audio answer.
//      It runs AFTER the ACL (fix round 3) so this really is one storage probe
//      per LISTEN rather than per attempt, and so a caller who may not hear the
//      take learns nothing about whether its bytes exist. Per VIEW it would not
//      be affordable at all — which is why the card keeps the heuristic and
//      this door keeps the proof.
//   4. ONE ROW PER MINT. Every successful mint writes exactly one
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
import { canViewAllInStore, canViewTranscript } from '@/lib/auth/recording-acl'
import { objectExists } from '@/lib/recording/mint-take-url'
import { serverHoldsTakeRow } from '@/lib/recording/take-binding'
import { createServiceClient } from '@/lib/supabase/service'
import { lookupProfileIdForSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'

type Core = Pick<SynqedClient, 'karuteRecords' | 'recordings'>

/** The repo's existing signed-url lifetime (process-recording.ts:96). An hour
 *  is longer than any single take, so a normal listen never meets it; a long
 *  one that does re-mints ONCE and resumes, which is an honest second row. */
export const PLAYBACK_URL_TTL_S = 3600

export interface PlaybackActor {
  /** WHO IS ASKING — the authenticated auth-user id, always present. Separate
   *  from `staffId` since fix round 2: a caller who is not on this business's
   *  roster has a null staffId, and for an OWNERLESS karute (D-14) the ACL says
   *  yes to them — which used to file `actorType:'staff'` with `actorId:null`,
   *  an unattributable listen. The row now always names someone. */
  actorId: string
  /** The ROSTER-PROVEN staff identity used for the ACL compare, resolved by the
   *  caller and NEVER read from a request body. Null = not on this roster, which
   *  the ACL reads as "not the recorder". Same id space the detail screen uses. */
  staffId: string | null
  /** The caller's verified tenant — the prefix the take key must carry. */
  businessId: string
  /** `recordings.viewAll` — the SAME input the raw transcript uses, and the
   *  whole floor (fix round 2: `business.manage` is a different grantable row
   *  and never reaches the sound; viewAll is owner by preset, grantable per
   *  person by the owner only — still ONE capability, still the whole floor).
   *  Silently, per ⚖ 9/3 — no staff ping, no sentence. */
  canViewAll: boolean
  /** The stores this viewer is assigned to, or null when unrestricted
   *  (`stores.viewAll`, or floating staff). The CALLER resolves it — web via
   *  resolveStoreScope, facade via resolveStoreForRequest — and a degraded
   *  lookup arrives as `[]`, which fails closed. Only the viewAll branch is
   *  narrowed by it: a recorder's own take is untouched (⚖ 8/17 store
   *  isolation; Greptile #848 point 2). The record's store id is NOT a caller
   *  input — this door reads it off the row it already fetches. */
  allowedStoreIds: readonly string[] | null
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

  // 3. THE FENCE (claim 1): take-only by the shared grammar, plus
  //    the row's own receipt — the same predicate the card's presence uses, so
  //    a player never appears for audio this door would not even consider.
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
  //    THE STORE HALF (⚖ 8/17 store isolation; Greptile #848 point 2): the
  //    grant widens WHOSE recordings, never WHICH stores. `row.store_id` is the
  //    session's own store — read here rather than passed in, because the
  //    caller has not seen the row yet when it builds the actor.
  if (
    !canViewTranscript({
      ownerStaffId,
      viewerStaffId: actor.staffId,
      canViewAll: canViewAllInStore({
        canViewAll: actor.canViewAll,
        allowedStoreIds: actor.allowedStoreIds,
        recordStoreId: row.store_id,
      }),
    })
  ) {
    return { error: 'forbidden' }
  }

  // 5. ASK STORAGE (claim 3) — and it runs AFTER the ACL (fix
  //    round 3). The row is only a heuristic (see the helper's own header: a
  //    reasoned discard stamps an unproven duration, and the ordinary discard
  //    keeps the take key), so the only honest fact about whether these bytes
  //    exist is the bucket's. The repo's ONE existence spelling, shared with the
  //    upload mint and the session mint — never a third.
  //
  //    ⚠ WHY IT SITS HERE AND NOT ABOVE THE ACL. It used to run first, which
  //    bought two things nobody wanted: the bucket paid for every REFUSED
  //    attempt (the header promises "one probe per LISTEN", not per try), and a
  //    same-tenant staffer who may not hear a colleague's take could still tell
  //    "the bytes are there" (forbidden) from "they are gone" (no_audio) — new
  //    information about someone else's audio, handed out before the permission
  //    question was even asked. Below the ACL, every authorized answer is
  //    identical and an unauthorized caller learns nothing.
  //
  //    A proven MISS is `no_audio`: there is genuinely nothing to hear. A probe
  //    that could not ANSWER ('unknown') is `upstream`, never a miss — telling a
  //    staffer her recording has no audio when storage merely blipped is the one
  //    wrong thing to say here, and it is the same fail-closed reading the mint
  //    and the discard door already take. A THROW is the same answer: wrapped
  //    like session-cleanup.ts's twin of this probe, so it leaves as this door's
  //    own 502 rather than escaping to the handler as a 500.
  let exists: boolean | 'unknown'
  try {
    exists = await objectExists(audioPath)
  } catch (err) {
    console.warn('[playback-url] object probe failed:', err)
    return { error: 'upstream' }
  }
  if (exists === false) return { error: 'no_audio' }
  if (exists === 'unknown') return { error: 'upstream' }

  // 6. The signed READ url — service-role, same by-construction posture as the
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

  // 7. ONE ROW PER MINT (claim 4). Legal hygiene, never a notification: an
  //    owner listening to a staffer's take is `breakGlass`, and nobody is told.
  //    ⚖ 8/17 doc law keeps content out of details — ids and the TTL only.
  audit({
    category: 'recording',
    action: 'recording.play',
    actorId: actor.actorId,
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
