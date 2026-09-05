// Facade: the play button's mint — a short-lived signed READ url for the audio
// behind ONE karute (build 23 slice ①). The phone arm's twin of the web
// mintRecordingPlaybackUrl() action, sharing the SAME body
// (mintPlaybackUrlWithClient, src/lib/recording/playback-url.ts) so the two
// doors cannot answer the same karute differently.
//
// GATE: 'customers.view' — the same capability that shows the karute screen at
// all. Deliberately not a new one: the audio of a karute you may open is
// governed by WHOSE recording it is (the twin's ACL), never by a second
// permission nobody has a settings toggle for.
//
// The viewer id is the ROSTER row keyed by the confirmed auth user id, never
// client input — resolveSelfStaffId, the same membership predicate the discard
// write door uses, so a records-holder who is not on this business's roster is
// nobody here and the ACL compares against null.
//
// audit: 'recordings.playbackUrl' is a deliberate 'skip' in FACADE_AUDIT_MAP
// citing the shared body — the generic hook would emit on every 2xx, and the
// body alone knows a mint happened rather than a refusal.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { mintPlaybackUrlWithClient } from '@/lib/recording/playback-url'
import { PlaybackUrlDTO } from '@/lib/app-api/recording-playback-dto'

export const runtime = 'nodejs'

export const GET = facadeHandler('recordings.playbackUrl', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  // This param IS the request — a missing one has no sane default, so it is
  // refused rather than guessed (the discard transcript route's rule).
  const karuteId = new URL(ctx.req.url).searchParams.get('karuteId')?.trim()
  if (!karuteId) throw new AppApiError('validation', 'karuteId is required')

  const businessId = ctx.identity.businessId
  let staffId: string | null
  try {
    staffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  } catch {
    // The roster read FAILED — we cannot say who is asking, so we do not guess
    // a null (which would read as "not the recorder" and refuse a recorder her
    // own take). 502 says we could not look.
    throw new AppApiError('upstream_unavailable', 'the staff roster is unavailable')
  }

  const result = await mintPlaybackUrlWithClient(
    newSynqedClient(businessId),
    {
      staffId,
      businessId,
      canViewAll: ctx.identity.capabilities.has('recordings.viewAll'),
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    { karuteId },
  )

  if ('error' in result) {
    // no_audio is a 404 WITH A REASON: the karute exists, the sound does not.
    // The reason rides the body so the log stream can tell the two 404s apart.
    if (result.error === 'no_audio') {
      throw new AppApiError('not_found', 'no playable audio for this karute', {
        reason: 'no_audio',
      })
    }
    if (result.error === 'not_found') throw new AppApiError('not_found', 'karute not found')
    if (result.error === 'forbidden') {
      throw new AppApiError('forbidden', 'that recording is not this caller’s to hear')
    }
    throw new AppApiError('upstream_unavailable', 'the recording could not be read')
  }

  // Parsed at the door, the #802 convention: the wire shape is a contract with
  // a baked phone, and a rename inside the shared twin would otherwise reach it
  // silently.
  return ok(ctx, PlaybackUrlDTO.parse(result))
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
